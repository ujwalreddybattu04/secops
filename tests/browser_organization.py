"""Real-browser workflow organization, reachability and saved-view checks."""
import argparse
import json


def visible_click(browser,selector):
    browser.evaluate('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center",behavior:"instant"})')
    bounds=browser.evaluate('''(()=>{const r=document.querySelector('''+json.dumps(selector)+''').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()''')
    assert bounds['width']>0 and bounds['height']>0,selector+' is not visible'
    for action in ['mousePressed','mouseReleased']:
        browser.command('Input.dispatchMouseEvent',{'type':action,'x':bounds['x'],'y':bounds['y'],'button':'left','clickCount':1})


def check_organization(browser,url):
    browser.command('Page.navigate',{'url':url})
    browser.wait('location.href.startsWith('+json.dumps(url)+') && typeof Workspace!=="undefined" && !state.busy && state.rows.length===156',90)
    assert browser.evaluate('Workspace.page()==="results" && !document.getElementById("results-workflow").hidden && document.getElementById("input-workflow").hidden && document.getElementById("curve-review").hidden')
    assert browser.evaluate('document.querySelectorAll(".workflow-tabs [aria-selected=true]").length===1 && !document.getElementById("workflow-origin").hidden')
    browser.evaluate('window.originalRows=JSON.stringify(state.rows);window.originalSource=JSON.stringify(state.source);window.originalPost=post;window.requests=[];post=async(...args)=>{window.requests.push(args[0]);return window.originalPost(...args);};')
    visible_click(browser,'#input-workflow-tab')
    assert browser.evaluate('Workspace.page()==="input" && document.querySelectorAll("#input-preview-table tbody tr").length===12 && document.getElementById("method-example-copy").textContent.includes("average is 6%")')
    visible_click(browser,'#input-next')
    assert browser.evaluate('document.querySelectorAll("#input-preview-table tbody tr").length===1 && document.getElementById("input-preview-table").textContent.includes("100%")')
    for page,tab in [('methods','methods-review-tab'),('signals','signals-review-tab'),('record','record-review-tab'),('results','results-workflow-tab')]:
        visible_click(browser,'#'+tab)
        assert browser.evaluate('Workspace.page()==='+json.dumps(page)+' && document.querySelectorAll(".workflow-tabs [aria-selected=true]").length===1')
    assert browser.evaluate('window.requests.length===0 && JSON.stringify(state.rows)===window.originalRows && JSON.stringify(state.source)===window.originalSource')
    visible_click(browser,'#methods-review-tab')
    assert browser.evaluate('!document.getElementById("review-placeholder").hidden && document.querySelectorAll("#review-purpose-cards h3").length===2 && document.getElementById("run-review").textContent.includes("Calculate comparison")')
    visible_click(browser,'#run-review')
    browser.wait('!state.busy && Boolean(state.review)',90)
    assert browser.evaluate('Workspace.page()==="methods" && document.getElementById("review-placeholder").hidden && document.querySelectorAll("#method-review-chart polyline").length===2')
    visible_click(browser,'#signals-review-tab')
    assert browser.evaluate('!document.getElementById("signals-review").hidden && document.getElementById("plain-curve-explanation").textContent.includes("twelve months") && !document.getElementById("target-experiment").open && !document.querySelector(".curve-drivers details").open')
    visible_click(browser,'#target-experiment > summary')
    assert browser.evaluate('document.getElementById("target-experiment").open && document.getElementById("run-influence").getBoundingClientRect().height>0')
    visible_click(browser,'#run-influence')
    browser.wait('!state.busy && Boolean(state.influence)',90)
    assert browser.evaluate('JSON.stringify(state.rows)===window.originalRows && JSON.stringify(state.source)===window.originalSource')
    # A flag takes the analyst to the actual monthly graph, with inspection set.
    assert browser.evaluate('document.querySelectorAll("#review-signals button").length>0')
    visible_click(browser,'#review-signals button')
    assert browser.evaluate('Workspace.page()==="results" && state.inspected!==null && !document.getElementById("chart-tooltip").hidden')
    visible_click(browser,'#record-review-tab')
    browser.evaluate('window.confirm=()=>true;window.savedDocument=null;Scenarios.projectDocument().then(project=>window.savedDocument=project)')
    browser.wait('window.savedDocument!==null')
    assert browser.evaluate('window.savedDocument.workspaceSettings.workflowPage==="record"')
    browser.evaluate('Scenarios.openProject(new File([JSON.stringify(window.savedDocument)],"organized.json"))')
    browser.wait('!state.busy && Boolean(state.review)',90)
    assert browser.evaluate('Workspace.page()==="record" && !document.getElementById("record-review").hidden && document.getElementById("results-workflow").hidden')
    # Keyboard navigation includes all five views, not two nested tab groups.
    browser.evaluate('document.getElementById("record-review-tab").dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true}))')
    assert browser.evaluate('Workspace.page()==="input" && document.activeElement.id==="input-workflow-tab"')
    visible_click(browser,'input[name=mode][value=exit]')
    assert browser.evaluate('Workspace.page()==="input" && state.rows.length===0 && !state.review && document.getElementById("results-workflow-tab").disabled && document.getElementById("method-example-copy").textContent.includes("December is 6%")')
    visible_click(browser,'#generate')
    browser.wait('!state.busy && state.rows.length===156',90)
    browser.wait('document.activeElement.id==="results-workflow-tab"')
    assert browser.evaluate('Workspace.page()==="results" && state.resultMode==="exit" && state.source.columns.every(column=>state.source.rows.every((row,index)=>numeric(state.rows[index*12+11][column])===row[column]))')
    browser.evaluate('post=window.originalPost')
    print('PASS: real pointer navigation, all five views, no calculations on navigation, input preview/paging, clear method examples, reachable comparison and experiment, flag-to-graph navigation, saved view reopening, keyboard order and automatic Results after generation.',flush=True)


if __name__=='__main__':
    from browser_scenarios import PlaywrightBrowser
    from playwright.sync_api import sync_playwright
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8000/');options=parser.parse_args()
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':1080})
        check_organization(PlaywrightBrowser(page),options.url);browser.close()
