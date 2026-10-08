"""Scenario workflow checks against a running workspace, using a real browser.

Optional local run (not a production dependency):
    python -m pip install playwright
    python -m playwright install chromium
    python tests/browser_scenarios.py --url http://127.0.0.1:8000
"""
import argparse
import json


def check_scenarios(browser, url):
    browser.command("Page.navigate", {"url": url})
    browser.wait('location.href.startsWith(' + json.dumps(url) + ') && typeof Scenarios!=="undefined" && !state.busy && state.rows.length===156', 90)
    browser.evaluate('window.confirm=()=>true; window.originalBaseline=JSON.stringify(state.rows); window.originalSource=JSON.stringify(state.source); window.originalBytes=null;')
    browser.evaluate('document.getElementById("create-alternative").click()')
    assert browser.evaluate('document.getElementById("scenario-editor").open')
    browser.evaluate('''{const field=document.querySelector('#editor-table input[data-row="2"][data-column="0"]');field.value='abc%';field.dispatchEvent(new Event('input'));document.getElementById('scenario-form').requestSubmit();}''')
    browser.wait('!state.busy')
    assert browser.evaluate('!document.getElementById("editor-error").hidden && document.getElementById("alternative-scenario").hidden && JSON.stringify(state.source)===window.originalSource')
    browser.evaluate('''{const field=document.querySelector('#editor-table input[data-row="2"][data-column="0"]');field.value='';field.dispatchEvent(new Event('input'));document.getElementById('scenario-form').requestSubmit();}''')
    assert browser.evaluate('!document.getElementById("editor-error").hidden && document.getElementById("scenario-editor").open')
    browser.evaluate('''{const field=document.querySelector('#editor-table input[data-row="2"][data-column="0"]');field.value='18%';field.dispatchEvent(new Event('input'));document.getElementById('scenario-name').value='Earlier uptake';document.getElementById('scenario-form').requestSubmit();}''')
    browser.wait('!state.busy && !document.getElementById("scenario-editor").open')
    assert browser.evaluate('state.rows.length===0 && document.getElementById("export-csv").disabled && state.source.rows[2][state.source.columns[0]]===18')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===156', 90)
    assert browser.evaluate('Scenarios.comparison()!==null && document.querySelectorAll("polyline[data-scenario=baseline]").length===3 && JSON.stringify(state.rows)!==window.originalBaseline')
    assert browser.evaluate('''state.source.columns.every(column=>state.source.rows.every((target,index)=>Math.abs(state.rows.slice(index*12,index*12+12).reduce((sum,row)=>sum+numeric(row[column])/12,0)-target[column])<0.00501))''')
    browser.evaluate('document.getElementById("difference-tab").click()')
    assert browser.evaluate('''document.querySelectorAll('#data-table tbody tr').length===12 && Scenarios.differenceRows().every((row,index)=>Math.abs(parseFloat(row[4])- (numeric(state.rows[index][state.source.columns[0]])-numeric(Scenarios.comparison().rows[index][state.source.columns[0]])))<0.00501)''')
    browser.evaluate('document.getElementById("compare-baseline").click()')
    assert browser.evaluate('document.querySelectorAll("polyline[data-scenario=baseline]").length===0')
    browser.evaluate('document.getElementById("compare-baseline").click(); document.getElementById("baseline-scenario").click()')
    assert browser.evaluate('JSON.stringify(state.rows)===window.originalBaseline && JSON.stringify(state.source)===window.originalSource && document.getElementById("difference-tab").hidden')
    browser.evaluate('document.getElementById("alternative-scenario").click();document.getElementById("edit-alternative").click();document.getElementById("editor-next").click()')
    assert browser.evaluate('document.querySelectorAll("#editor-table tbody tr").length===1')
    browser.evaluate('''document.getElementById('editor-previous').click();{const field=document.querySelector('#editor-table input[data-row="2"][data-column="0"]');field.value='22';field.dispatchEvent(new Event('input'));}document.getElementById('scenario-form').requestSubmit();''')
    browser.wait('!state.busy && !document.getElementById("scenario-editor").open')
    browser.evaluate('document.getElementById("edit-alternative").click()')
    assert browser.evaluate('!document.getElementById("editor-history").hidden')
    browser.evaluate('document.getElementById("restore-revision").click();document.getElementById("scenario-form").requestSubmit()')
    browser.wait('!state.busy && !document.getElementById("scenario-editor").open')
    assert browser.evaluate('state.source.rows[2][state.source.columns[0]]===18')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===156', 90)
    browser.evaluate('''window.downloads=[];window.realSaveBlob=saveBlob;saveBlob=async(blob,name)=>{window.downloads.push({name,text:await blob.text(),type:blob.type});};document.getElementById('project-name').value='Analyst comparison';document.getElementById('save-project').click();''')
    browser.wait('!state.busy && window.downloads.length===1')
    project = browser.evaluate('JSON.parse(window.downloads[0].text)')
    assert project['schema'] == 'interpolation-project'
    assert project['active'] == 'alternative'
    assert project['alternative']['name'] == 'Earlier uptake'
    assert project['baseline']['result']['engineId'] == project['alternative']['result']['engineId']
    assert len(project['baseline']['sha256']) == 64
    # An archived output must never bypass recalculation, even if tampered with.
    browser.evaluate('''window.savedProject=JSON.parse(window.downloads[0].text);window.savedProject.alternative.result.rows[0][state.source.columns[0]]='999%';{const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(window.savedProject)],'reopen.json'));document.getElementById('project-file').files=transfer.files;document.getElementById('project-file').dispatchEvent(new Event('change'));}''')
    browser.wait('!state.busy && state.rows.length===156', 90)
    assert browser.evaluate('state.rows[0][state.source.columns[0]]!=="999%" && Scenarios.comparison()!==null && document.getElementById("project-name").value==="Analyst comparison"')
    browser.evaluate('''window.beforeFailedImport=JSON.stringify(state.rows);window.badProject=structuredClone(window.savedProject);window.badProject.baseline.sha256='0'.repeat(64);Scenarios.openProject(new File([JSON.stringify(window.badProject)],'tampered.json'));''')
    browser.wait('!state.busy')
    assert browser.evaluate('document.getElementById("error").textContent.includes("checksum") && JSON.stringify(state.rows)===window.beforeFailedImport')
    browser.evaluate('Scenarios.openProject(new File(["{not json}"],"bad.json"))')
    browser.wait('!state.busy')
    assert browser.evaluate('document.getElementById("error").textContent.includes("valid JSON") && JSON.stringify(state.rows)===window.beforeFailedImport')
    browser.evaluate('''window.badProject=structuredClone(window.savedProject);window.badProject.alternative.source.rows[0].year=999;Scenarios.openProject(new File([JSON.stringify(window.badProject)],'mismatched.json'));''')
    browser.wait('!state.busy')
    assert browser.evaluate('document.getElementById("error").textContent.includes("invalid alternative") && JSON.stringify(state.rows)===window.beforeFailedImport')
    browser.evaluate('document.querySelector("input[value=exit]").click()')
    assert browser.evaluate('state.rows.length===0 && Scenarios.comparison()===null && document.getElementById("export-pdf").disabled')
    browser.evaluate('document.getElementById("baseline-scenario").click()')
    assert browser.evaluate('state.rows.length===0')
    browser.evaluate('document.getElementById("alternative-scenario").click();document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===156', 90)
    assert browser.evaluate('state.resultMode==="exit" && Scenarios.comparison().mode==="exit" && state.source.columns.every(column=>state.source.rows.every((row,index)=>numeric(state.rows[index*12+11][column])===row[column]))')
    browser.evaluate('document.getElementById("export-csv").click()')
    browser.wait('!state.busy && window.downloads.length===2', 90)
    assert browser.evaluate('window.downloads[1].name==="Earlier-uptake_monthly_exit.csv" && window.downloads[1].text.startsWith("year,month,")')
    browser.evaluate('document.getElementById("export-pdf").click()')
    browser.wait('!state.busy && window.downloads.length===3', 90)
    assert browser.evaluate('window.downloads[2].name==="Earlier-uptake_monthly_exit.pdf" && window.downloads[2].text.startsWith("%PDF")')
    browser.evaluate('''window.actualPost=post;post=async(...args)=>{const response=await window.actualPost(...args);const headers=new Headers(response.headers);headers.set('X-Calculation-Engine','changed-engine');return new Response(await response.blob(),{status:response.status,headers});};document.getElementById('export-csv').click();''')
    browser.wait('!state.busy', 90)
    assert browser.evaluate('window.downloads.length===3 && document.getElementById("error").textContent.includes("updated")')
    browser.evaluate('post=window.actualPost;saveBlob=window.realSaveBlob;showError("");')
    print('PASS: baseline preservation, transactional target editing, comparison curves/differences, revision drafts, project save/reopen/checksum, tampered archived outputs, failed import preservation, both modes, scenario export and engine-change protection.', flush=True)


def check_edge_cases(browser):
    browser.evaluate(r'''document.querySelector('input[value=average]').click();loadFile(new File(['\ufeffyear,__proto__,采用率,<img src=x onerror=window.__injected=1>\r\n2022,6,10,14\r\n2023,8,12,16\r\n'],'literal.csv'));''')
    browser.wait('!state.busy && state.source?.rows.length===2')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===24',90)
    browser.evaluate('document.getElementById("create-alternative").click()')
    browser.evaluate('''{const field=document.querySelector('#editor-table input[data-row="0"][data-column="0"]');field.value='7';field.dispatchEvent(new Event('input'));}document.getElementById('scenario-name').value='<img src=x onerror=window.__injected=1>';document.getElementById('scenario-form').requestSubmit();''')
    browser.wait('!state.busy && !document.getElementById("scenario-editor").open')
    assert browser.evaluate('state.source.rows[0]["__proto__"]===7 && !window.__injected && !document.querySelector("#alternative-label img")')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===24',90)
    assert browser.evaluate('Scenarios.comparison()!==null && state.rows.every(row=>Number.isFinite(numeric(row["__proto__"])))')
    browser.evaluate('window.literalProject=null;Scenarios.projectDocument().then(project=>window.literalProject=project)')
    browser.wait('window.literalProject!==null')
    assert browser.evaluate('''atob(window.literalProject.baseline.bytes).startsWith('\xef\xbb\xbfyear,__proto__')''')
    browser.evaluate('Scenarios.openProject(new File([JSON.stringify(window.literalProject)],"literal.json"))')
    browser.wait('!state.busy && state.rows.length===24',90)
    assert browser.evaluate('state.source.columns.includes("采用率") && !window.__injected && state.source.rows[0]["__proto__"]===7')
    browser.evaluate('''window.unsupported=structuredClone(window.literalProject);window.unsupported.version=99;Scenarios.openProject(new File([JSON.stringify(window.unsupported)],'unsupported.json'));''')
    browser.wait('!state.busy')
    assert browser.evaluate('document.getElementById("error").textContent.includes("supported Interpolation") && state.rows.length===24')
    browser.evaluate('Scenarios.openProject(new File(["x".repeat(40*1024*1024+1)],"oversized.json"))')
    assert browser.evaluate('document.getElementById("error").textContent.includes("40 MB") && state.rows.length===24')
    browser.evaluate('''window.actualPost=post;window.convertCalls=0;post=async(...args)=>{const response=await window.actualPost(...args);if(args[0].startsWith('/convert') && ++window.convertCalls===2){const headers=new Headers(response.headers);headers.set('X-Calculation-Engine','changed-engine');return new Response(await response.blob(),{status:response.status,headers});}return response;};document.getElementById('generate').click();''')
    browser.wait('!state.busy',90)
    assert browser.evaluate('state.rows.length===0 && document.getElementById("export-csv").disabled && Scenarios.comparison()===null && document.getElementById("error").textContent.includes("changed during comparison")')
    browser.evaluate('post=window.actualPost;loadFile(new File(["year,value\\n2022,1\\n2023,8\\n"],"precision.csv"))')
    browser.wait('!state.busy && state.source?.rows.length===2')
    browser.evaluate('document.getElementById("create-alternative").click()')
    browser.evaluate('''{const field=document.querySelector('#editor-table input[data-row="1"][data-column="0"]');field.value='1e308';field.dispatchEvent(new Event('input'));}document.getElementById('scenario-form').requestSubmit();''')
    browser.wait('!state.busy && !document.getElementById("scenario-editor").open')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy',90)
    assert browser.evaluate('state.rows.length===0 && document.getElementById("export-pdf").disabled && !document.getElementById("error").hidden')
    browser.evaluate(r'''loadFile(new File(['year,value\n2022,120\n2023,150\n'],'absolute.csv'));''')
    browser.wait('!state.busy && state.source?.rows.length===2')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===24',90)
    assert browser.evaluate('state.rows.some(row=>numeric(row.value)>100)')
    # Restore the synthetic comparison for responsive screenshots.
    print('PASS: Unicode/literal/prototype-named headers, original BOM bytes, unsupported/oversized projects, mid-comparison engine change, precision failure and values beyond 100 without hard bounds.',flush=True)


class PlaywrightBrowser:
    def __init__(self, page):
        self.page = page
        self.cdp = page.context.new_cdp_session(page)

    def command(self, method, params):
        if method == 'Page.navigate':
            self.page.goto(params['url'], wait_until='domcontentloaded')
        else:
            raise ValueError(method)

    def evaluate(self, script):
        result = self.cdp.send('Runtime.evaluate', {'expression': script,
            'returnByValue': True, 'awaitPromise': True, 'userGesture': True})
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def wait(self, expression, timeout=30):
        self.page.wait_for_function(expression, timeout=timeout*1000)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8000/')
    options = parser.parse_args()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1080})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        check_scenarios(PlaywrightBrowser(page), options.url)
        check_edge_cases(PlaywrightBrowser(page))
        assert not errors, errors
        browser.close()
