"""Real-browser checks for chart reveal, lifecycle cleanup and reduced motion.

Run after starting the server:
    python tests/browser_chart_motion.py --url http://127.0.0.1:8000/
Uses the same optional Playwright dependency as browser_scenarios.py.
"""
import argparse
import json


def check_chart_motion(browser, url):
    browser.command('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'no-preference'}]})
    browser.command('Emulation.setDeviceMetricsOverride', {'width':1440, 'height':1080, 'deviceScaleFactor':1, 'mobile':False})
    browser.command('Page.navigate', {'url': url})
    browser.wait('location.href.startsWith(' + json.dumps(url) + ') && typeof chartMotion!=="undefined" && !state.busy && state.rows.length===156',90)
    browser.evaluate('document.getElementById("chart").scrollIntoView({block:"center"});')
    browser.wait('document.getElementById("chart").dataset.motion==="complete"',10)
    # Trigger a new view of the same real response, then seek its animations.
    # This checks rendered geometry, not a mocked timer or an animation class.
    browser.evaluate('''window.motionRows=JSON.stringify(state.rows);renderedChartRows=null;renderChart();chartMotion.animations.forEach(animation=>{animation.pause();animation.currentTime=0;});''')
    assert browser.evaluate('document.getElementById("chart").dataset.motion==="drawing" && chartMotion.animations.length>0')
    assert browser.evaluate('''getComputedStyle(document.querySelector('[data-chart-layer="axes"]')).opacity==='0' && parseFloat(getComputedStyle(document.querySelector('[data-chart-reveal]')).width)===0''')
    browser.evaluate('chartMotion.animations.forEach(animation=>animation.currentTime=225)')
    assert browser.evaluate('''getComputedStyle(document.querySelector('[data-chart-layer="axes"]')).opacity==='1' && parseFloat(getComputedStyle(document.querySelector('[data-chart-reveal]')).width)===0''')
    browser.evaluate('chartMotion.animations.forEach(animation=>animation.currentTime=790)')
    assert browser.evaluate('''{const reveal=document.querySelector('[data-chart-reveal]');const width=parseFloat(getComputedStyle(reveal).width);width>0 && width<Number(reveal.getAttribute('width'));}''')
    assert browser.evaluate('''Array.from(document.querySelectorAll('[data-chart-layer="curves"] polyline')).every((line,index)=>line.getAttribute('points')===state.rows.map((row,month)=>chartGeometry.x(month)+','+chartGeometry.y(numeric(row[state.source.columns[index]]))).join(' '))''')
    assert browser.evaluate('JSON.stringify(state.rows)===window.motionRows')
    browser.evaluate('renderChart()')
    assert browser.evaluate('''document.getElementById('chart').dataset.motion==='drawing' && chartMotion.animations.at(-1).currentTime>=790 && parseFloat(getComputedStyle(document.querySelector('[data-chart-reveal]')).width)>0''')
    browser.evaluate('chartMotion.animations.forEach(animation=>animation.play())')
    browser.wait('document.getElementById("chart").dataset.motion==="complete"',10)
    assert browser.evaluate('''chartMotion.animations.length===0 && !chartMotion.observer && parseFloat(getComputedStyle(document.querySelector('[data-chart-reveal]')).width)===Number(document.querySelector('[data-chart-reveal]').getAttribute('width'))''')
    browser.evaluate('document.getElementById("show-targets").click()')
    assert browser.evaluate('document.getElementById("chart").dataset.motion==="complete" && chartMotion.animations.length===0')
    browser.evaluate('document.querySelector("#series-legend button").click()')
    assert browser.evaluate('document.getElementById("chart").dataset.motion==="complete" && chartMotion.animations.length===0')
    browser.evaluate('renderedChartRows=null;renderChart();inspect(0)')
    assert browser.evaluate('document.getElementById("chart").dataset.motion==="complete" && !document.getElementById("chart-tooltip").hidden')
    # Changing accessibility preferences while drawing must immediately reveal
    # the result, including any chart waiting below the mobile upload form.
    browser.evaluate('renderedChartRows=null;renderChart()')
    browser.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
    browser.wait('document.getElementById("chart").dataset.motion==="complete" && chartMotion.animations.length===0')
    browser.evaluate('renderedChartRows=null;renderChart()')
    assert browser.evaluate('document.getElementById("chart").dataset.motion==="complete" && chartMotion.animations.length===0')
    browser.command('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'no-preference'}]})
    browser.command('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':1,'mobile':False})
    browser.evaluate('window.scrollTo(0,0);renderedChartRows=null;renderChart()')
    browser.wait('document.getElementById("chart").dataset.motion==="pending"')
    assert browser.evaluate('chartMotion.animations.length===0 && Boolean(chartMotion.observer)')
    browser.evaluate('document.getElementById("chart").scrollIntoView({block:"center",behavior:"instant"})')
    browser.wait('document.getElementById("chart").dataset.motion==="drawing"',5)
    browser.wait('document.getElementById("chart").dataset.motion==="complete"',10)
    browser.evaluate('renderedChartRows=null;renderChart();clearResult();render()')
    assert browser.evaluate('chartMotion.animations.length===0 && !chartMotion.observer && document.getElementById("chart").dataset.motion==="empty" && !document.querySelector("[data-chart-reveal]")')
    # A genuine upload and calculation must animate as well as the initial demo.
    browser.evaluate(r'''window.scrollTo(0,0);loadFile(new File(['year,value\n2022,6%\n2023,8%\n2024,12%\n'],'motion-upload.csv'));''')
    browser.wait('!state.busy && state.source?.rows.length===3')
    browser.evaluate('document.getElementById("generate").click()')
    browser.wait('!state.busy && state.rows.length===36',90)
    assert browser.evaluate('document.getElementById("chart").dataset.motion==="pending"')
    browser.evaluate('document.getElementById("chart").scrollIntoView({block:"center",behavior:"instant"})')
    browser.wait('document.getElementById("chart").dataset.motion==="drawing"',5)
    browser.wait('document.getElementById("chart").dataset.motion==="complete"',10)
    assert browser.evaluate('state.source.rows.every((target,index)=>Math.abs(state.rows.slice(index*12,index*12+12).reduce((sum,row)=>sum+numeric(row.value)/12,0)-target.value)<0.00501)')
    # Simulate an older browser without Element.animate: keep the chart usable.
    browser.evaluate('''window.originalAnimate=Element.prototype.animate;Element.prototype.animate=undefined;renderedChartRows=null;renderChart();Element.prototype.animate=window.originalAnimate;''')
    assert browser.evaluate('document.getElementById("chart").dataset.motion==="complete" && chartMotion.animations.length===0')
    browser.evaluate('''window.originalObserver=window.IntersectionObserver;window.IntersectionObserver=undefined;renderedChartRows=null;renderChart();window.IntersectionObserver=window.originalObserver;''')
    assert browser.evaluate('document.getElementById("chart").dataset.motion==="complete" && chartMotion.animations.length===0')
    print('PASS: axes before curves, intermediate reveal, exact coordinates/data, cleanup, no replay on controls, immediate inspection, reduced-motion changes, mobile viewport entry, cancelled results, real upload and animation fallback.',flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8000/')
    options = parser.parse_args()
    from playwright.sync_api import sync_playwright
    from browser_scenarios import PlaywrightBrowser
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={'width':1440,'height':1080})
        errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        check_chart_motion(PlaywrightBrowser(page),options.url)
        assert not errors, errors
        browser.close()
