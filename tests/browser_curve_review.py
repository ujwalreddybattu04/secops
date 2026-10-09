"""Real-browser checks for the complete Phase 1 review workflow.

Optional run: python tests/browser_curve_review.py --url http://127.0.0.1:8000
Requires Playwright only for that standalone local command, not production.
"""
import argparse
import json


def check_review(browser,url):
    browser.command("Page.navigate",{"url":url})
    browser.wait('typeof Review!=="undefined" && !state.busy && state.rows.length===156',90)
    browser.evaluate('window.confirm=()=>true;window.originalRows=JSON.stringify(state.rows);window.originalSource=JSON.stringify(state.source);document.getElementById("run-review").click()')
    browser.wait('!state.busy && Boolean(state.review)',90)
    assert browser.evaluate('document.getElementById("review-error").hidden && !document.getElementById("review-content").hidden')
    assert browser.evaluate('Review.accepts(state.review,state.source,state.rows,state.resultMode,state.engineId)')
    assert browser.evaluate('state.review.methods.average.validation.annual_targets && state.review.methods.exit.validation.annual_targets')
    assert browser.evaluate('document.querySelector("#review-drivers").textContent.includes("No fixed 0–100")')
    assert browser.evaluate('JSON.stringify(state.rows)===window.originalRows && JSON.stringify(state.source)===window.originalSource')
    browser.evaluate('document.getElementById("methods-review-tab").click();document.getElementById("method-review-year").value="9";document.getElementById("method-review-year").dispatchEvent(new Event("change"))')
    assert browser.evaluate('document.querySelectorAll("#method-review-chart polyline").length===2 && document.querySelectorAll("#method-review-table tbody tr").length===12')
    assert browser.evaluate('''(()=>{
      const lines=[...document.querySelectorAll('#method-review-chart polyline')];
      const pairs=lines.flatMap(line=>[...line.points].map((point,index)=>({x:point.x,y:point.y,value:numeric(state.review.methods[line.dataset.method].rows[index][state.source.columns[0]])})));
      if(pairs.some(point=>!Number.isFinite(point.x) || !Number.isFinite(point.y)))return false;
      const first=pairs[0],different=pairs.reduce((farthest,point)=>Math.abs(point.value-first.value)>Math.abs(farthest.value-first.value) ? point : farthest,first);
      const slope=(different.y-first.y)/(different.value-first.value);
      return slope<0 && pairs.every(point=>Math.abs(point.y-first.y-slope*(point.value-first.value))<1e-3) && lines.every(line=>line.points.length===156 && [...line.points].every((point,index)=>index===0 || point.x>line.points[index-1].x));
    })()''')
    assert browser.evaluate('''[...document.querySelectorAll('#method-review-table tbody tr')].every((tr,index)=>tr.children[1].textContent===state.review.methods.average.rows[108+index][state.source.columns[0]] && tr.children[2].textContent===state.review.methods.exit.rows[108+index][state.source.columns[0]])''')
    # Keyboard tab navigation updates aria selection and focus.
    browser.evaluate('document.getElementById("methods-review-tab").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))')
    assert browser.evaluate('document.activeElement.id==="record-review-tab" && document.getElementById("record-review-tab").getAttribute("aria-selected")==="true"')
    assert browser.evaluate('document.getElementById("review-settings").textContent.includes("range_penalty_weight") && document.getElementById("review-record").textContent.includes(state.engineId)')
    browser.evaluate('document.getElementById("signals-review-tab").click();document.getElementById("influence-change").value="0";document.getElementById("influence-form").requestSubmit()')
    assert browser.evaluate('!document.getElementById("review-error").hidden && !state.busy')
    browser.evaluate('document.getElementById("influence-change").value="1";document.getElementById("influence-year").value="4";document.getElementById("influence-form").requestSubmit()')
    browser.wait('!state.busy && Boolean(state.influence)',90)
    assert browser.evaluate('!document.getElementById("influence-result").hidden && state.influence.year===state.source.rows[4].year && JSON.stringify(state.rows)===window.originalRows && JSON.stringify(state.source)===window.originalSource')
    browser.evaluate('''window.downloads=[];window.originalSaveBlob=saveBlob;saveBlob=async(blob,name)=>{window.downloads.push({name,text:await blob.text()});};document.getElementById('download-review').click();''')
    browser.wait('window.downloads.length===1')
    record=browser.evaluate('JSON.parse(window.downloads[0].text)')
    assert record['review']['schema']=='interpolation-review' and record['influence']['schema']=='interpolation-influence'
    # View settings and diagnostics are saved. Tampered diagnostics are not trusted.
    browser.evaluate('document.getElementById("show-targets").checked=false;document.getElementById("show-targets").dispatchEvent(new Event("change"));document.getElementById("save-project").click()')
    browser.wait('!state.busy && window.downloads.length===2')
    saved=browser.evaluate('JSON.parse(window.downloads[1].text)')
    assert saved['baseline']['result']['review']['methods']['average']['validation']['annual_targets']
    assert saved['baseline']['result']['influence']['year']==5
    assert saved['workspaceSettings']['showTargets'] is False
    browser.evaluate('''window.savedReviewProject=JSON.parse(window.downloads[1].text);window.savedReviewProject.baseline.result.review.methods.average.validation.annual_targets=false;window.savedReviewProject.baseline.result.review.methods.average.rows[0][state.source.columns[0]]='999%';Scenarios.openProject(new File([JSON.stringify(window.savedReviewProject)],'review.json'));''')
    browser.wait('!state.busy && Boolean(state.review)',90)
    assert browser.evaluate('state.review.methods.average.validation.annual_targets && state.review.methods.average.rows[0][state.source.columns[0]]!=="999%" && !document.getElementById("show-targets").checked && !state.influence')
    # A failed refresh keeps a prior valid review; a changed engine is rejected.
    browser.evaluate('''window.previousReview=JSON.stringify(state.review);window.realPost=post;post=async(...args)=>{const response=await window.realPost(...args);if(args[0].startsWith('/review')){const headers=new Headers(response.headers);headers.set('X-Calculation-Engine','other-engine');return new Response(await response.blob(),{status:200,headers});}return response;};document.getElementById('run-review').click();''')
    browser.wait('!state.busy',90)
    assert browser.evaluate('!document.getElementById("review-error").hidden && JSON.stringify(state.review)===window.previousReview')
    browser.evaluate('post=window.realPost;saveBlob=window.originalSaveBlob;document.querySelector("input[value=exit]").click()')
    assert browser.evaluate('!state.review && document.getElementById("review-content").hidden && document.getElementById("run-review").disabled')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===156',90)
    browser.evaluate('document.getElementById("run-review").click()')
    browser.wait('!state.busy && Boolean(state.review)',90)
    assert browser.evaluate('state.resultMode==="exit" && document.getElementById("review-drivers").textContent.includes("Exit has no range penalty")')
    # Editing a scenario invalidates its previous report while preserving baseline.
    browser.evaluate('document.getElementById("create-alternative").click()')
    browser.evaluate('''{const input=document.querySelector('#editor-table input[data-row="2"][data-column="0"]');input.value='18';input.dispatchEvent(new Event('input'));}document.getElementById('scenario-form').requestSubmit();''')
    browser.wait('!state.busy && !document.getElementById("scenario-editor").open',90)
    assert browser.evaluate('!state.review && document.getElementById("review-content").hidden')
    browser.evaluate('document.getElementById("baseline-scenario").click()')
    assert browser.evaluate('state.review?.methods.exit.status==="available"')
    print('PASS: same-input comparison, raw checks, keyboard navigation, target influence without mutation, record/project saves, tampered-report recalculation, engine guard and scenario invalidation.',flush=True)


def check_review_edges(browser):
    browser.evaluate(r'''document.querySelector('input[value=average]').click();loadFile(new File(['year,value\n1,1\n2,2\n3,3\n4,90\n5,91\n6,92\n'],'sharp.csv'));''')
    browser.wait('!state.busy && state.source?.rows.length===6')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===72',90)
    browser.evaluate('document.getElementById("run-review").click()')
    browser.wait('!state.busy && Boolean(state.review)',90)
    assert browser.evaluate('document.querySelectorAll("#review-signals [data-kind=sharp_rise]").length===1')
    browser.evaluate('document.querySelector("#review-signals [data-kind=sharp_rise]").click()')
    assert browser.evaluate('state.yearIndex===3 && state.inspected===36 && document.getElementById("chart-tooltip").hidden===false')
    browser.evaluate(r'''loadFile(new File(['year,__proto__,采用率,<img src=x onerror=window.__injected=1>\r1,6,10,14\r2,8,12,16\r'],'literal.csv'));''')
    browser.wait('!state.busy && state.source?.rows.length===2')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===24',90)
    browser.evaluate('document.getElementById("run-review").click()')
    browser.wait('!state.busy && Boolean(state.review)',90)
    browser.evaluate('document.getElementById("review-series").value="<img src=x onerror=window.__injected=1>";document.getElementById("review-series").dispatchEvent(new Event("change"))')
    assert browser.evaluate('!window.__injected && !document.querySelector("#curve-review img") && document.getElementById("review-series").value.includes("<img")')
    browser.evaluate(r'''loadFile(new File(['year,value\n1,-5\n'],'negative.csv'));''')
    browser.wait('!state.busy && state.source?.rows.length===1')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===12',90)
    browser.evaluate('document.getElementById("run-review").click()')
    browser.wait('!state.busy && Boolean(state.review)',90)
    browser.evaluate('document.getElementById("methods-review-tab").click()')
    assert browser.evaluate('document.getElementById("method-chart-note").textContent.includes("could not be calculated") && document.getElementById("method-review-table").hidden')
    # Failure and timeout paths must leave the current result usable.
    browser.evaluate('''window.beforeError=JSON.stringify(state.rows);window.actualPost=post;post=async()=>{throw new DOMException('Cancelled','AbortError');};document.getElementById('run-review').click();''')
    browser.wait('!state.busy')
    assert browser.evaluate('document.getElementById("review-error").textContent.includes("timed out") && JSON.stringify(state.rows)===window.beforeError && !document.getElementById("export-csv").disabled')
    browser.evaluate('post=window.actualPost')
    print('PASS: sharp-event graph navigation, literal/Unicode headers, unavailable comparison method, timeout preservation and usable exports.',flush=True)


if __name__=='__main__':
    from browser_scenarios import PlaywrightBrowser
    from playwright.sync_api import sync_playwright
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8000/');options=parser.parse_args()
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch()
        page=browser.new_page(viewport={"width":1440,"height":1080})
        adapter=PlaywrightBrowser(page)
        check_review(adapter,options.url);check_review_edges(adapter)
        browser.close()
