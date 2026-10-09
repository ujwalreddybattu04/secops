"use strict";

// Reports are bound to an input, selected result and engine. Archived reports
// are recalculated on open; no imported validation status is trusted.
const Review = (() => {
  const tabs=["signals","methods","record"];
  const view={tab:"signals",column:null,yearIndex:0};
  let reviewing=false,measuring=false;
  const unit=(value,digits=3)=>{
    const number=Number(value);
    if(!Number.isFinite(number))return String(value);
    if(number!==0 && (Math.abs(number)<1e-4 || Math.abs(number)>=1e7))return number.toExponential(3);
    return new Intl.NumberFormat("en-US",{maximumFractionDigits:digits,useGrouping:false}).format(number);
  };
  const selected=()=>state.review?.methods[state.resultMode];
  const series=()=>selected()?.series.find(item=>item.column===view.column);
  const otherMode=()=>state.resultMode==="average" ? "exit" : "average";
  function error(message){$("review-error").textContent=message;$("review-error").hidden=!message;}
  function controls(){
    $("run-review").disabled=state.busy || !state.rows.length;
    $("run-review").firstChild.textContent=reviewing ? "Reviewing…" : state.review ? "Refresh review" : "Run review";
    $("run-influence").textContent=measuring ? "Measuring…" : "Measure influence";
    $("curve-review").setAttribute("aria-busy",String(reviewing || measuring));
    for(const id of ["run-influence","influence-year","influence-change","review-series","method-review-year","download-review"])$(id).disabled=state.busy || !state.review;
  }
  function accepts(report,source,rows,mode,engineId){
    return report?.schema==="interpolation-review" && report.version===1 && report.engine?.id===engineId &&
      JSON.stringify(report.source)===JSON.stringify(source) && report.methods?.[mode]?.status==="available" &&
      JSON.stringify(report.methods[mode].rows)===JSON.stringify(rows);
  }
  async function fetchReport(item,mode,signal){
    const response=await post(`/review?mode=${mode}`,item.file,signal),report=await response.json();
    if(response.headers.get("X-Calculation-Engine")!==item.engineId || !accepts(report,item.source,item.rows,mode,item.engineId))throw new Error("The calculation service or result changed. Generate again before reviewing this curve.");
    return report;
  }
  async function run(){
    if(state.busy || !state.rows.length)return;
    reviewing=true;
    const revision=operation("Reviewing both methods against the same input…");
    const timer=setTimeout(()=>state.revision===revision && state.controller.abort(),180000);
    error("");$("review-status").textContent="Checking targets, detecting changes and calculating the comparison…";
    try{
      const item={file:state.file,source:structuredClone(state.source),rows:structuredClone(state.rows),engineId:state.engineId};
      const report=await fetchReport(item,state.resultMode,state.controller.signal);
      if(revision!==state.revision)return;
      state.review=report;state.influence=null;window.Scenarios?.captureReview();render();
      toast("Curve review ready. Save project to keep its settings and checks.");
    }catch(failure){if(revision===state.revision){error(failure.name==="AbortError" ? "Review timed out. Your generated curve is still available; try again." : failure.message);$("review-status").textContent=state.review ? "Previous review retained. Refresh did not complete." : "Review did not complete. Your monthly result is unchanged.";}}
    finally{clearTimeout(timer);reviewing=false;finish(revision);}
  }
  function options(select,items,value){
    select.replaceChildren();for(const [key,label] of items){const option=node("option",label);option.value=String(key);option.selected=String(key)===String(value);select.append(option);}
  }
  function render(){
    const report=state.review;
    if(!report){$("review-content").hidden=true;$("review-status").textContent=state.rows.length ? "Ready to review this result. Both methods use the same yearly inputs." : "Generate a curve to start its review.";error("");controls();return;}
    if(!state.source.columns.includes(view.column))view.column=state.source.columns[0];
    view.yearIndex=Math.max(0,Math.min(view.yearIndex,state.source.rows.length-1));
    options($("review-series"),state.source.columns.map(column=>[column,column]),view.column);
    const years=state.source.rows.map((row,index)=>[index,yearName(row.year)]);
    options($("method-review-year"),years,view.yearIndex);options($("influence-year"),years,view.yearIndex);
    $("review-content").hidden=false;
    $("review-status").textContent=`${state.resultMode==="average" ? "Average" : "Exit"} result reviewed · ${new Date(report.generated_at).toLocaleString()} · Raw values checked`;
    switchTab(view.tab);renderSignals();renderDrivers();renderMethods();renderRecord();renderInfluence();controls();
  }
  function switchTab(tab){
    view.tab=tabs.includes(tab) ? tab : "signals";
    for(const name of tabs){const active=name===view.tab,button=$(`${name}-review-tab`);button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));button.tabIndex=active ? 0 : -1;$(`${name}-review`).hidden=!active;}
    if(view.tab==="methods" && state.review)renderMethodChart();
  }
  function renderSignals(){
    const item=series(),list=$("review-signals");list.replaceChildren();
    const events=[...item.sharp_changes.map(event=>({...event,source:"yearly"})),
      ...item.yearly_turns.map(event=>({...event,source:"yearly",index:event.index*12+(state.resultMode==="exit" ? 11 : 5)})),
      ...item.monthly_turns.map(event=>({...event,source:"monthly"}))].sort((a,b)=>a.index-b.index);
    if(!events.length){const empty=node("div",undefined,"signal-empty");empty.append(node("strong","No sharp changes or turning points detected."),node("p","A steady rise, fall or flat profile can have no flags. This does not assess forecast accuracy."));list.append(empty);return;}
    for(const event of events.slice(0,8)){
      const button=node("button",undefined,"signal-item");button.type="button";button.dataset.kind=event.kind;
      const copy=node("span");
      if(event.kind.startsWith("sharp")){
        copy.append(node("strong",`${event.kind==="sharp_rise" ? "Sharp rise" : "Sharp fall"} in yearly targets`),node("small",`${yearName(event.from_year)} → ${yearName(event.to_year)} · ${unit(event.change)} pp. Inspect the monthly response.`));
      }else{
        const at=event.source==="monthly" ? monthName(event.at,true) : yearName(event.at.year);
        const through=event.source==="monthly" ? monthName(event.through,true) : yearName(event.through.year);
        copy.append(node("strong",`${event.source==="monthly" ? "Monthly" : "Yearly target"} ${event.kind}`),node("small",`${at}${at!==through ? ` – ${through}` : ""} · ${percent(event.value,3)}. ${event.kind==="peak" ? "Rise changes to fall." : "Fall changes to rise."}`));
      }
      button.append(node("span",undefined,"signal-marker"),copy);button.addEventListener("click",()=>{
        if(!state.visible.has(view.column)){state.visible.add(view.column);renderLegend();renderChart();}
        state.yearIndex=Math.min(state.source.rows.length-1,Math.floor(event.index/12));state.tab="monthly";renderTable();inspect(event.index);$("chart").scrollIntoView({block:"center",behavior:motionPreference.matches ? "instant" : "smooth"});$("chart").focus({preventScroll:true});
      });list.append(button);
    }
    const total=Object.values(item.event_counts).reduce((sum,count)=>sum+count,0);
    if(total>8)list.append(node("p",`Showing the first 8 of ${total} flags. The record includes up to 200 events per kind.`,"review-footnote"));
  }
  function renderDrivers(){
    const item=series(),container=$("review-drivers");container.replaceChildren();
    const add=(title,description)=>{const div=node("div",undefined,"driver-item");div.append(node("strong",title),node("p",description));container.append(div);};
    add(state.resultMode==="average" ? "Your yearly means are fixed" : "Your December targets are fixed",state.resultMode==="average" ? `All ${item.annual_checks.length} yearly means are checked against their targets before rounding. A midpoint marker is a reference, not a required value for that month.` : `Each December equals its yearly target. Other months are solved together across the timeline; their yearly mean is not pinned.`);
    add("The optimizer discourages abrupt bends",`It minimizes squared second differences across adjacent months, including year boundaries. This favors gradual changes; it does not guarantee a monotonic curve. Normalized curvature cost: ${unit(item.curvature_cost_normalized,6)}.${item.solution_kind==="flat fallback" ? " Constant targets use the flat fallback; no optimization is needed for this series." : ""}`);
    if(state.resultMode==="average")add("The range is a preference, not a limit",`This series' yearly range is ${percent(item.input_min,3)} to ${percent(item.input_max,3)}. Outside values receive a squared penalty with weight ${state.review.settings.average.range_penalty_weight}. Measured excursions: ${unit(item.below_range)} pp below, ${unit(item.above_range)} pp above. No fixed 0–100 boundary.`);
    else add("Exit has no range penalty",`Monthly values may go outside the yearly target range. The model prioritizes smoothness, December targets and a non-negative first month.`);
    add("First-month constraint",`The minimum is ${percent(item.first_month_minimum,6)}; the unrounded result is ${percent(item.first_month,6)}.${item.first_month_near_floor ? " The result is numerically close to this floor." : " The result is above this floor."} This observation does not measure the constraint's causal contribution.`);
  }
  function table(element,headers,rows){
    const head=element.querySelector("thead"),body=element.querySelector("tbody");head.replaceChildren();body.replaceChildren();
    const tr=node("tr");for(const title of headers){const th=node("th",title);th.scope="col";tr.append(th);}head.append(tr);
    for(const row of rows){const line=node("tr");for(const value of row)line.append(node("td",String(value)));body.append(line);}
  }
  function renderMethods(){
    const report=state.review,average=report.methods.average,exit=report.methods.exit,ready=average.status==="available" && exit.status==="available";
    $("method-review-chart").hidden=!ready;$("method-review-table").hidden=!ready;$("method-chart-note").textContent="";
    $("method-chart-note").className=ready ? "review-caption" : "method-unavailable";
    if(!ready){const failed=report.methods[otherMode()];$("method-chart-note").textContent=`${otherMode()==="average" ? "Average" : "Exit"} could not be calculated for this input: ${failed.detail}. The selected method's result and review remain available.`;return;}
    const start=view.yearIndex*12;
    table($("method-review-table"),["Month","Average","Exit","Average − Exit (pp)"],average.rows.slice(start,start+12).map((row,index)=>{
      const other=exit.rows[start+index][view.column],difference=numeric(row[view.column])-numeric(other);
      return [months[row.month-1],row[view.column],other,Number.isFinite(difference) ? unit(difference,2) : "Beyond display precision"];
    }));
    renderMethodChart();
  }
  function renderMethodChart(){
    const chart=$("method-review-chart");chart.replaceChildren();
    const report=state.review;if(!report || report.methods.average.status!=="available" || report.methods.exit.status!=="available")return;
    const title=svgNode("title");title.textContent=`Average and Exit for ${view.column}`;chart.append(title);
    const description=svgNode("desc");description.textContent="Same yearly inputs, full timeline. Solid blue is Average; dashed brown is Exit. Monthly numbers are in the comparison table.";chart.append(description);
    const width=Math.max(340,Math.min(850,chart.clientWidth || 650)),height=230,left=63,right=18,top=20,bottom=35;
    chart.setAttribute("viewBox",`0 0 ${width} ${height}`);
    const values=[...report.methods.average.rows,...report.methods.exit.rows].map(row=>numeric(row[view.column]));
    const minimum=values.reduce((a,b)=>Math.min(a,b),Infinity),maximum=values.reduce((a,b)=>Math.max(a,b),-Infinity);
    const span=maximum-minimum || Math.max(Math.abs(maximum)*.2,1),low=minimum-span*.07,high=maximum+span*.07;
    if(!Number.isFinite(span) || !Number.isFinite(high-low)){$("method-chart-note").textContent="These magnitudes exceed interactive graph precision. Use the comparison table and downloaded record.";return;}
    $("method-chart-note").textContent="Full timeline · same inputs and engine · solid Average, dashed Exit";
    const count=report.methods.average.rows.length,x=index=>left+index/(count-1)*(width-left-right),y=value=>top+(high-value)/(high-low)*(height-top-bottom);
    for(let i=0;i<5;i++){const value=low+(high-low)*i/4,yy=y(value);chart.append(svgNode("line",{x1:left,x2:width-right,y1:yy,y2:yy,stroke:"#e9edf3"}));const label=svgNode("text",{x:left-9,y:yy+3,"text-anchor":"end"});label.textContent=Math.abs(value)>=1e6 ? `${value.toExponential(1)}%` : percent(value,1);chart.append(label);}
    for(let i=0;i<4;i++){const index=Math.round(i*(count-1)/3),label=svgNode("text",{x:x(index),y:height-10,"text-anchor":i===0 ? "start" : i===3 ? "end" : "middle"});label.textContent=monthName(report.methods.average.rows[index],true);chart.append(label);}
    for(const mode of ["average","exit"]){chart.append(svgNode("polyline",{points:report.methods[mode].rows.map((row,index)=>`${x(index)},${y(numeric(row[view.column]))}`).join(" "),fill:"none",stroke:mode==="average" ? "#416fa6" : "#ac795b","stroke-width":2,"stroke-dasharray":mode==="exit" ? "5 4" : "none","stroke-linejoin":"round","data-method":mode}));}
  }
  function renderRecord(){
    const report=state.review,item=series(),record=$("review-record");record.replaceChildren();
    const add=(label,value,code=false)=>{record.append(node("dt",label));const dd=node("dd");dd.append(node(code ? "code" : "span",value));record.append(dd);};
    add("Selected method",state.resultMode==="average" ? "Average · yearly means" : "Exit · December targets");
    add("Verified input",`${state.source.rows.length} years · ${state.source.columns.length} series · ${selected().validation.checked_values} monthly values`);
    add("Raw checks",`Finite values: ${selected().validation.finite_values ? "pass" : "fail"}; annual constraints: ${selected().validation.annual_targets ? "pass" : "fail"}; first month: ${selected().validation.first_month ? "pass" : "fail"}`);
    add("Generated",new Date(report.generated_at).toLocaleString());add("Engine",report.engine.id,true);
    add("Display precision","2 decimal places; rounding can slightly change the displayed yearly mean");
    table($("review-validation-table"),["Year","Target","Raw constraint error","Allowed tolerance","Displayed error","Check"],item.annual_checks.map(check=>[check.year,percent(check.target,6),unit(check.raw_error,9),unit(check.tolerance,9),unit(check.display_error,6),check.passed ? "Pass" : "Fail"]));
    $("review-settings").textContent=JSON.stringify({settings:report.settings,dependencies:report.engine.dependencies},null,2);$("review-limits").replaceChildren(...report.limits.map(limit=>node("li",limit)));
  }
  async function measure(event){
    event.preventDefault();if(state.busy || !state.review)return;
    const text=$("influence-change").value.trim();
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) || !Number.isFinite(Number(text)) || Number(text)===0){error("Enter a finite, non-zero target change.");$("influence-change").focus();return;}
    const yearIndex=Number($("influence-year").value),year=state.source.rows[yearIndex].year,column=view.column;
    const query=new URLSearchParams({mode:state.resultMode,column,year:String(year),change:text});
    measuring=true;
    const revision=operation("Measuring one target's influence…"),timer=setTimeout(()=>state.revision===revision && state.controller.abort(),180000);error("");
    try{
      const response=await post(`/influence?${query}`,state.file,state.controller.signal),result=await response.json();
      if(revision!==state.revision)return;
      if(response.headers.get("X-Calculation-Engine")!==state.engineId || result.engine_id!==state.engineId || result.mode!==state.resultMode || result.column!==column || result.year!==year)throw new Error("The service changed during measurement. Generate and review again.");
      state.influence=result;window.Scenarios?.captureReview();renderInfluence();
    }catch(failure){if(revision===state.revision)error(failure.name==="AbortError" ? "Influence measurement timed out. Your inputs and curve are unchanged." : failure.message);}
    finally{clearTimeout(timer);measuring=false;finish(revision);}
  }
  function renderInfluence(){
    const result=state.influence,element=$("influence-result");element.hidden=!result;
    if(result)element.textContent=`Measured ${result.column}, ${yearName(result.year)}: target ${percent(result.before_target,6)} → ${percent(result.after_target,6)}. Largest monthly response: ${unit(result.largest_monthly_change,6)} pp in ${monthName(result.at)}. All other yearly targets stayed fixed. This is a temporary experiment, not an applied change or causal explanation.`;
  }
  function settings(){return {...view,visibleSeries:[...state.visible],showTargets:$("show-targets").checked,compareBaseline:$("compare-baseline").checked};}
  function restoreSettings(saved){
    view.tab=tabs.includes(saved?.tab) ? saved.tab : "signals";view.column=state.source?.columns.includes(saved?.column) ? saved.column : null;
    view.yearIndex=Number.isInteger(saved?.yearIndex) && saved.yearIndex>=0 && saved.yearIndex<state.source.rows.length ? saved.yearIndex : 0;
    if(Array.isArray(saved?.visibleSeries)){const visible=saved.visibleSeries.filter(value=>state.source.columns.includes(value));if(visible.length)state.visible=new Set(visible);}
    if(typeof saved?.showTargets==="boolean")$("show-targets").checked=saved.showTargets;
    if(typeof saved?.compareBaseline==="boolean")$("compare-baseline").checked=saved.compareBaseline;
  }
  $("run-review").addEventListener("click",run);$("influence-form").addEventListener("submit",measure);
  $("review-series").addEventListener("change",event=>{view.column=event.target.value;render();});
  $("method-review-year").addEventListener("change",event=>{view.yearIndex=Number(event.target.value);$("influence-year").value=String(view.yearIndex);renderMethods();});
  $("influence-year").addEventListener("change",event=>{view.yearIndex=Number(event.target.value);$("method-review-year").value=String(view.yearIndex);renderMethods();});
  for(const tab of tabs){$(`${tab}-review-tab`).addEventListener("click",()=>switchTab(tab));$(`${tab}-review-tab`).addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const index=event.key==="Home" ? 0 : event.key==="End" ? tabs.length-1 : (tabs.indexOf(tab)+(event.key==="ArrowRight" ? 1 : -1)+tabs.length)%tabs.length;switchTab(tabs[index]);$(`${tabs[index]}-review-tab`).focus();});}
  $("download-review").addEventListener("click",()=>{if(state.busy || !state.review)return;saveBlob(new Blob([JSON.stringify({review:state.review,influence:state.influence || null,selectedMethod:state.resultMode,view:settings()},null,2)],{type:"application/json"}),"curve-review.json");toast("Calculation record download ready.");});
  let resize;window.addEventListener("resize",()=>{clearTimeout(resize);resize=setTimeout(()=>{if(view.tab==="methods" && state.review)renderMethodChart();},120);});
  return {render,controls,settings,restoreSettings,fetchReport,accepts};
})();
window.Review=Review;
Review.render();
