"""Real-browser checks for the minimal upload screen and existing API integration.

Run against a local server or the isolated development service. This uses the
actual multipart endpoints; controlled response faults exercise recovery only.
"""
import argparse
import json
from browser_upload import click, PlaywrightBrowser


def select_csv(browser, text, name='curve.csv'):
    browser.evaluate('''(()=>{const data=new DataTransfer();data.items.add(new File(['''+json.dumps(text)+'''],'''+json.dumps(name)+''',{type:'text/csv'}));const input=document.getElementById('file-input');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()''')


def generate(browser, count):
    click(browser, '#generate')
    browser.wait('!UploadScreen.busy() && UploadScreen.result()?.rows.length==='+str(count), 120)
    assert browser.evaluate('document.getElementById("upload-error").hidden && !document.getElementById("result-panel").hidden && !document.getElementById("download-csv").disabled')


def change_method(browser, mode):
    browser.evaluate('document.getElementById("method-selector").value='+json.dumps(mode)+';document.getElementById("method-selector").dispatchEvent(new Event("change"))')
    assert browser.evaluate('UploadScreen.result()===null && document.getElementById("result-panel").hidden && document.getElementById("download-pdf").disabled')


def check_conversion(browser, url):
    browser.command('Emulation.setDeviceMetricsOverride', {'width':1366,'height':900,'deviceScaleFactor':1,'mobile':False})
    browser.command('Page.navigate', {'url':url})
    browser.wait('typeof UploadScreen!=="undefined" && typeof MonthlyChart!=="undefined"')
    browser.evaluate('''window.realFetch=window.fetch;window.requests=[];window.monthlyResponse=null;window.fetch=async (...args)=>{requests.push(args[0]);const response=await realFetch(...args);if(String(args[0]).includes('format=json') && response.ok)window.monthlyResponse=await response.clone().json();return response;};''')
    select_csv(browser,'year,Slow,Moderate\r2024,12%,18%\r2022,6%,9%\r2023,8%,12%\r')
    assert browser.evaluate('requests.length===0 && !document.getElementById("generate").disabled')
    generate(browser,36)
    assert browser.evaluate('requests.length===2 && requests[0]==="/preview" && requests[1]==="/convert?mode=average&format=json" && JSON.stringify(UploadScreen.result().rows)===JSON.stringify(monthlyResponse)')
    assert browser.evaluate('''(()=>{const r=UploadScreen.result();return r.source.columns.every((c,i)=>r.source.rows.every((target,year)=>Math.abs(r.rows.slice(year*12,year*12+12).reduce((s,row)=>s+Number(row[r.keys[i]].slice(0,-1))/12,0)-target[c])<=.00500001));})()''')
    assert browser.evaluate('document.querySelectorAll("#monthly-table tbody tr").length===12 && document.querySelectorAll(".chart-series").length===2 && !document.querySelector("#chart path[d*=NaN]")')
    assert browser.evaluate('getComputedStyle(document.querySelector(".chart-axis")).fill==="none"')
    browser.evaluate('document.getElementById("table-year").value="2024";document.getElementById("table-year").dispatchEvent(new Event("change"));')
    assert browser.evaluate('document.querySelector("#monthly-table caption").textContent.includes("2024") && document.querySelector("#monthly-table tbody td").textContent===UploadScreen.result().rows[24].Slow')
    click(browser,'#chart')
    for key in ['Home','ArrowRight','End']:
        browser.command('Input.dispatchKeyEvent',{'type':'keyDown','key':key,'code':key})
        expected={'Home':'Jan 2022','ArrowRight':'Feb 2022','End':'Dec 2024'}[key]
        assert browser.evaluate('document.getElementById("chart-readout").textContent.includes('+json.dumps(expected)+') && document.getElementById("chart-announcement").textContent.includes('+json.dumps(expected)+')')
    change_method(browser,'exit');generate(browser,36)
    assert browser.evaluate('''(()=>{const r=UploadScreen.result();return r.mode==='exit' && r.source.columns.every((c,i)=>r.source.rows.every((target,year)=>Number(r.rows[year*12+11][r.keys[i]].slice(0,-1))===target[c]));})()''')
    print('PASS: genuine multipart preview/conversion, Average annual means, Exit December targets, sorted CR input, exact API-to-table values and keyboard graph inspection.',flush=True)

    # Invalid CSV and unsafe magnitude errors must be clear, without old data.
    change_method(browser,'average')
    for text,fragment in [('date,value\n2022,6%\n','year'),('year,value\n2022,1%\n2023,1e308%\n','ratio')]:
        select_csv(browser,text);click(browser,'#generate');browser.wait('!UploadScreen.busy()',120)
        detail=browser.evaluate('document.getElementById("upload-error").textContent')
        assert fragment in detail.lower(),detail
        assert browser.evaluate('UploadScreen.result()===null && document.getElementById("result-panel").hidden && !document.getElementById("generate").disabled')

    # Literal names, prototype-like names and the backend's month alias.
    select_csv(browser,'year,采用率,<img onerror=window.injected=1>,__proto__,month,month_value,$notacommand$\n2022,6,8,10,12,14,16\n2023,8,10,12,14,16,18\n','采用率.csv')
    generate(browser,24)
    assert browser.evaluate('!window.injected && !document.querySelector("#monthly-table img") && !document.querySelector("#series-legend img") && UploadScreen.result().keys.includes("month_value_value") && UploadScreen.result().rows[0].month===1 && document.querySelector("#monthly-table thead").textContent.includes("采用率")')
    select_csv(browser,'year,value\n2022,7%\n')
    for mode in ['average','exit']:
        change_method(browser,mode);generate(browser,12)
        assert browser.evaluate('UploadScreen.result().rows.every(row=>row.value==="7%")')
    # No invalid chart coordinates for legal enormous flat input.
    change_method(browser,'average');select_csv(browser,'year,value\n2022,1e308\n');generate(browser,12)
    assert browser.evaluate('!document.getElementById("chart").innerHTML.includes("NaN") && !document.getElementById("chart").innerHTML.includes("Infinity")')
    print('PASS: backend validation and precision errors, Unicode/literal/prototype headers, month alias, one-year flat results and finite graph coordinates for 1e308.',flush=True)

    # Hold a response even after abort; it must never restore an old result.
    browser.evaluate('window.savedFetch=window.fetch;window.fetch=(...args)=>new Promise(resolve=>window.releasePreview=()=>resolve(new Response(JSON.stringify({columns:["value"],rows:[{year:2022,value:7}]}),{headers:{"Content-Type":"application/json"}})));')
    select_csv(browser,'year,value\n2022,7\n');click(browser,'#generate')
    assert browser.evaluate('UploadScreen.busy() && document.getElementById("generate").disabled')
    select_csv(browser,'year,value\n2023,9\n','replacement.csv')
    browser.evaluate('releasePreview();window.fetch=window.savedFetch;')
    browser.wait('!UploadScreen.busy()')
    assert browser.evaluate('UploadScreen.result()===null && UploadScreen.selection().name==="replacement.csv" && document.getElementById("upload-error").hidden')
    generate(browser,12)
    assert browser.evaluate('UploadScreen.result().rows[0].year===2023 && UploadScreen.result().rows[0].value==="9%"')
    # Cancellation, busy-service retry, network and malformed-response recovery.
    browser.evaluate('window.fetch=(...args)=>new Promise(resolve=>window.releasePreview=()=>resolve(new Response("{}",{headers:{"Content-Type":"application/json"}})));')
    click(browser,'#generate');click(browser,'#cancel-request');browser.evaluate('releasePreview();window.fetch=window.savedFetch;')
    assert browser.evaluate('!UploadScreen.busy() && UploadScreen.result()===null && document.getElementById("selection-status").textContent.includes("canceled")')
    browser.evaluate('''window.retryCount=0;window.fetch=(...args)=>{if(retryCount++===0)return Promise.resolve(new Response('{"detail":"Busy"}',{status:503,headers:{"Retry-After":"1","Content-Type":"application/json"}}));return savedFetch(...args);};''')
    generate(browser,12)
    assert browser.evaluate('retryCount===3')
    for fault,fragment in [('Promise.reject(new TypeError("offline"))','connection'),('Promise.resolve(new Response("<html>oops</html>",{headers:{"Content-Type":"text/html"}}))','unexpected')]:
        browser.evaluate('window.fetch=()=>'+fault)
        click(browser,'#generate');browser.wait('!UploadScreen.busy()')
        assert fragment in browser.evaluate('document.getElementById("upload-error").textContent').lower()
    browser.evaluate('window.fetch=window.savedFetch;');generate(browser,12)
    # The exports must not claim to belong to a different engine version.
    browser.evaluate('''window.fetch=async (...args)=>{const response=await savedFetch(...args);const headers=new Headers(response.headers);headers.set('X-Calculation-Engine','sha256:'+'0'.repeat(64));return new Response(await response.blob(),{status:response.status,headers});};''')
    click(browser,'#download-csv');browser.wait('!UploadScreen.busy()',120)
    assert browser.evaluate('UploadScreen.result()===null && document.getElementById("upload-error").textContent.includes("updated") && document.getElementById("download-pdf").disabled')
    browser.evaluate('window.fetch=window.savedFetch;');generate(browser,12)
    # Reject same-engine CSV data that differs from the graph/table.
    browser.evaluate('''window.fetch=async (...args)=>{const response=await savedFetch(...args);return new Response('year,month,value\\n2023,1,123%\\n',{status:response.status,headers:response.headers});};''')
    click(browser,'#download-csv');browser.wait('!UploadScreen.busy()',120)
    assert browser.evaluate('document.getElementById("export-status").textContent.includes("differ") && !document.getElementById("download-csv").disabled')
    browser.evaluate('window.fetch=window.savedFetch;')
    print('PASS: stale responses cannot restore old files; cancel, retry, network recovery, unexpected responses, engine changes and mismatched CSV downloads are handled.',flush=True)


if __name__=='__main__':
    from playwright.sync_api import sync_playwright
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8000/');options=parser.parse_args()
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch();page=browser.new_page(viewport={'width':1366,'height':900})
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        check_conversion(PlaywrightBrowser(page),options.url);assert not errors,errors;browser.close()
