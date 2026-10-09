"""Verify the screen-only upload flow without sending selected data to an API."""
import argparse
import json


def click(browser, selector):
    browser.evaluate('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center",behavior:"instant"})')
    bounds=browser.evaluate('''(()=>{const r=document.querySelector('''+json.dumps(selector)+''').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()''')
    assert bounds['width']>0 and bounds['height']>0,selector
    for action in ['mousePressed','mouseReleased']:
        browser.command('Input.dispatchMouseEvent',{'type':action,'x':bounds['x'],'y':bounds['y'],'button':'left','clickCount':1})


def check_upload(browser,url):
    browser.command('Page.navigate',{'url':url})
    browser.wait('location.href.startsWith('+json.dumps(url)+') && typeof UploadScreen!=="undefined"')
    assert browser.evaluate('UploadScreen.selection()===null && document.getElementById("file-chip").hidden && typeof Workspace==="undefined" && typeof Review==="undefined" && !document.getElementById("chart")')
    assert browser.evaluate('document.fonts.check("14px Inter") || document.fonts.status==="loading"')
    browser.evaluate('window.calls=[];window.originalFetch=window.fetch;window.fetch=(...args)=>{window.calls.push(args[0]);return originalFetch(...args)};')
    # A real file-input change, including Unicode and markup-like literal names.
    browser.evaluate('''(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['year,value\\n2022,6%\\n2023,8%\\n'],'采用率 <img onerror=alert(1)>.csv'));const input=document.getElementById('file-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()''')
    assert browser.evaluate('UploadScreen.selection().name==="采用率 <img onerror=alert(1)>.csv" && !document.getElementById("file-chip").hidden && !document.querySelector("#file-chip img") && document.querySelectorAll(".recent-file").length===1 && calls.length===0')
    browser.evaluate('document.getElementById("method-selector").value="exit";document.getElementById("method-selector").dispatchEvent(new Event("change"))')
    assert browser.evaluate('UploadScreen.mode()==="exit" && calls.length===0')
    # Invalid replacement must preserve the existing selection.
    for name,content,message in [('wrong.xlsx','not csv','CSV file'),('empty.csv','','empty')]:
        browser.evaluate('''(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['''+json.dumps(content)+'''],'''+json.dumps(name)+'''));document.getElementById('upload-composer').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()''')
        assert browser.evaluate('!document.getElementById("upload-error").hidden && document.getElementById("upload-error").textContent.includes('+json.dumps(message)+') && UploadScreen.selection().name.startsWith("采用率")')
    browser.evaluate('''(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['year,value\\n2022,7%\\n'],'second.csv'));document.getElementById('upload-composer').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()''')
    assert browser.evaluate('UploadScreen.selection().name==="second.csv" && document.getElementById("upload-error").hidden && document.querySelectorAll(".recent-file").length===2 && calls.length===0')
    click(browser,'#remove-file')
    assert browser.evaluate('UploadScreen.selection()===null && document.activeElement.id==="choose-file-prompt"')
    click(browser,'.recent-file')
    assert browser.evaluate('UploadScreen.selection().name==="second.csv"')
    click(browser,'#new-upload')
    assert browser.evaluate('UploadScreen.selection()===null && document.getElementById("file-chip").hidden')
    click(browser,'#dismiss-intro')
    assert browser.evaluate('document.getElementById("intro-card").hidden && document.activeElement.id==="choose-file-prompt"')
    click(browser,'#sidebar-toggle')
    assert browser.evaluate('document.body.classList.contains("sidebar-collapsed") && document.getElementById("sidebar-toggle").getAttribute("aria-expanded")==="false"')
    click(browser,'#sidebar-toggle')
    browser.command('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    browser.wait('document.getElementById("sidebar").inert')
    click(browser,'#mobile-toggle')
    assert browser.evaluate('document.body.classList.contains("sidebar-open") && !document.getElementById("sidebar").inert && document.querySelector(".main-shell").inert && document.activeElement.id==="sidebar-toggle"')
    browser.command('Input.dispatchKeyEvent',{'type':'keyDown','key':'Escape','code':'Escape'})
    assert browser.evaluate('!document.body.classList.contains("sidebar-open") && document.getElementById("sidebar").inert && document.activeElement.id==="mobile-toggle"')
    assert browser.evaluate('window.calls.length===0')
    # Reload returns to the empty reference layout, not a preloaded sample.
    browser.command('Page.navigate',{'url':url})
    browser.wait('typeof UploadScreen!=="undefined" && UploadScreen.selection()===null && document.getElementById("recent-empty").hidden===false && !document.getElementById("intro-card").hidden')
    print('PASS: empty upload screen, literal/Unicode filenames, file selection/drop/removal, invalid replacement preservation, method selection, session files, dismiss, collapsed/mobile navigation and zero automatic API calculations.',flush=True)


class PlaywrightBrowser:
    def __init__(self,page):self.page=page;self.session=page.context.new_cdp_session(page)
    def command(self,method,params=None):return self.session.send(method,params or {})
    def evaluate(self,expression):return self.page.evaluate(expression)
    def wait(self,expression,timeout=30):self.page.wait_for_function(expression,timeout=timeout*1000)


if __name__=='__main__':
    from playwright.sync_api import sync_playwright
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8000/');options=parser.parse_args()
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch();page=browser.new_page(viewport={'width':1366,'height':768})
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        check_upload(PlaywrightBrowser(page),options.url);assert not errors,errors;browser.close()
