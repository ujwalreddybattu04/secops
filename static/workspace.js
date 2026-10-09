"use strict";

const $ = (id) => document.getElementById(id);
const colors = ["#416fa6", "#ba795c", "#548879", "#8b7ba6", "#ac9153", "#688f9e"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const state = {file:null, sample:false, source:null, rows:[], mode:"average", resultMode:null, visible:new Set(), yearIndex:0, sourcePage:0, tab:"monthly", busy:false, revision:0, controller:null, stats:[], inspected:null};
let toastTimer;
const percent = (value, digits=2) => `${new Intl.NumberFormat("en-US", {minimumFractionDigits:0, maximumFractionDigits:digits, useGrouping:false}).format(Object.is(value,-0) ? 0 : value)}%`;
const numeric = (value) => Number(String(value).replace(/%$/, ""));
const yearName = (year) => year >= 1000 && year <= 9999 ? String(year) : `Year ${year}`;
const monthName = (row, short=false) => `${short ? months[row.month-1].slice(0,3) : months[row.month-1]} ${row.year >= 1000 && row.year <= 9999 ? row.year : `Y${row.year}`}`;
const node = (tag, text, className) => {const element=document.createElement(tag); if(text !== undefined) element.textContent=text; if(className) element.className=className; return element;};
const svgNode = (tag, attributes={}) => {const element=document.createElementNS("http://www.w3.org/2000/svg",tag); for(const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value)); return element;};
function toast(message){clearTimeout(toastTimer); $("toast").textContent=message; $("toast").hidden=false; toastTimer=setTimeout(()=>{$("toast").hidden=true;},4000);}
function showError(message){$("error").textContent=message; $("error").hidden=!message;}
function operation(message){state.controller?.abort(); state.controller=new AbortController(); state.revision++; state.busy=true; showError(""); $("process-status").textContent=message; controls(); return state.revision;}
function finish(revision){if(revision!==state.revision)return; state.busy=false; controls(); if(state.file && !state.source)$("file-description").textContent="Input needs attention"; $("process-status").textContent=state.rows.length ? "Curve ready to review." : state.source ? "Input checked. Ready to generate." : "Upload a file to get started.";}
function controls(){
  $("analysis").setAttribute("aria-busy",String(state.busy));
  $("generate").disabled=state.busy || !state.source;
  $("generate").querySelector("span").textContent=state.busy ? "Processing…" : "Generate monthly curve";
  $("generate").classList.toggle("working",state.busy);
  $("process-status").classList.toggle("working",state.busy);
  for(const id of ["dropzone","file-input"]) $(id).disabled=state.busy;
  for(const input of document.querySelectorAll('input[name="mode"]'))input.disabled=state.busy;
  for(const id of ["export-csv","export-pdf"])$(id).disabled=state.busy || !state.rows.length;
  $("copy-table").disabled=state.busy || !(state.tab==="yearly" ? state.source : state.rows.length);
  window.Scenarios?.controls();
}
function retryDelay(milliseconds,signal){
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException("Request cancelled","AbortError"));return;}
    const cancelled=()=>{clearTimeout(timer);reject(new DOMException("Request cancelled","AbortError"));};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",cancelled);resolve();},milliseconds);
    signal.addEventListener("abort",cancelled,{once:true});
  });
}
async function post(path,file,signal){
  const form=new FormData(); form.append("file",file,file.name);
  let response;
  for(let attempt=0;attempt<3;attempt++){
    response=await fetch(path,{method:"POST",body:form,signal});
    const delay=Number(response.headers.get("Retry-After"));
    if(response.status!==503 || attempt===2 || !Number.isFinite(delay) || delay<=0 || delay>5)break;
    await response.body?.cancel();
    $("process-status").textContent="Calculation capacity is busy. Retrying shortly…";
    await retryDelay(delay*1000,signal);
  }
  if(!response.ok){let message=`The service could not complete this request (${response.status}). Please try again.`; try{const body=await response.json(); if(typeof body.detail==="string")message=body.detail; else if(Array.isArray(body.detail))message=body.detail.map(item=>item.msg).join(" ");}catch{} throw new Error(message);}
  return response;
}
function clearResult(){state.rows=[]; state.resultMode=null; state.engineId=null; state.stats=[]; state.yearIndex=0; state.inspected=null; $("chart-tooltip").hidden=true;}
function handleFailure(error,revision){if(revision!==state.revision)return; showError(error.name==="AbortError" ? "The request took too long. Please try again; a sleeping development service may need time to start." : error.message);}
async function generateResult(revision){
  await window.Scenarios?.prepare(state.controller.signal);
  $("process-status").textContent="Generating the monthly profile…";
  const response=await post(`/convert?mode=${state.mode}&format=json`,state.file,state.controller.signal);
  const rows=await response.json();
  if(revision!==state.revision)return;
  if(!response.headers.get("X-Calculation-Engine"))throw new Error("The calculation version is missing. Please reload the workspace.");
  if(!Array.isArray(rows) || rows.length!==state.source.rows.length*12)throw new Error("The response did not contain the expected monthly rows.");
  for(const [index,row] of rows.entries()){if(row.year!==state.source.rows[Math.floor(index/12)].year || row.month!==index%12+1 || state.source.columns.some(column=>typeof row[column]!=="string" || !Number.isFinite(numeric(row[column]))))throw new Error("This response cannot be displayed safely in the interactive workspace. Please use the API to inspect it.");}
  state.rows=rows; state.resultMode=state.mode; state.engineId=response.headers.get("X-Calculation-Engine"); state.tab="monthly"; state.yearIndex=0; state.inspected=null;
  window.Scenarios?.capture();
  state.stats=calculateRanges(); render();
  $("updated-at").textContent=`Updated ${new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"}).format(new Date())}`;
}
async function loadFile(file,sample=false,autoGenerate=false){
  if(!file)return;
  if(!file.name.toLowerCase().endsWith(".csv")){showError("Choose a .csv file. Excel workbooks must first be saved as CSV.");return;}
  if(file.size>10*1024*1024){showError("The workspace supports CSV files up to 10 MB.");return;}
  if(!window.Scenarios?.mayReplace())return;
  const revision=operation("Checking the yearly input…");
  const timer=setTimeout(()=>state.revision===revision && state.controller.abort(),90000);
  state.file=file; state.sample=sample; state.source=null; state.sourcePage=0; clearResult(); render();
  window.Scenarios?.reset();
  try{
    const response=await post("/preview",file,state.controller.signal); const source=await response.json();
    if(revision!==state.revision)return;
    if(source.rows.some(row=>!Number.isSafeInteger(row.year)))throw new Error("Year identifiers are too large for the interactive view. Use the API directly to preserve their precision.");
    // Reserved output names would collide with the generated year/month fields.
    if(source.columns.includes("month"))throw new Error("Rename the value column 'month' before using the workspace; 'month' is reserved for generated month numbers.");
    state.source=source; state.visible=new Set(source.columns.slice(0,3)); render();
    window.Scenarios?.captureInput();
    if(autoGenerate)await generateResult(revision);
  }catch(error){handleFailure(error,revision);}finally{clearTimeout(timer);finish(revision);}
}
async function generate(){if(!state.source || state.busy)return;const revision=operation("Generating the monthly profile…"); const timer=setTimeout(()=>state.revision===revision && state.controller.abort(),90000); clearResult();render();try{await generateResult(revision);}catch(error){handleFailure(error,revision);}finally{clearTimeout(timer);finish(revision);}}
async function sample(){if(state.busy)return;const startingRevision=state.revision;try{showError("");const response=await fetch("/assets/adoption-sample.csv");if(!response.ok)throw new Error("The sample file could not be loaded.");const blob=await response.blob();if(state.busy || state.revision!==startingRevision)return;await loadFile(new File([blob],"adoption-sample.csv",{type:"text/csv"}),true,true);}catch(error){if(state.revision===startingRevision)showError(error.message);}}
function calculateRanges(){
  return state.source.columns.map(column=>{
    const targets=state.source.rows.map(row=>row[column]);
    return {column,low:targets.reduce((a,b)=>Math.min(a,b),Infinity),high:targets.reduce((a,b)=>Math.max(a,b),-Infinity)};
  });
}
function render(){
  const hasSource=Boolean(state.source),hasResult=state.rows.length>0;
  $("source-file").hidden=!state.file; $("source-links").hidden=!hasSource;$("sample-tag").hidden=!state.sample;
  $("file-name").textContent=state.file?.name || "";$("file-name").title=state.file?.name || "";
  $("file-description").textContent=hasSource ? `${state.source.rows.length} years · ${state.source.columns.length} ${state.source.columns.length===1 ? "series" : "series"}` : state.file ? "Checking input" : "";
  $("method-explanation").textContent=state.mode==="average" ? "Monthly values vary smoothly. Their yearly mean matches your input before display rounding." : "December matches your yearly target. Other months follow a smooth profile across all years.";
  $("profile-subtitle").textContent=hasResult ? `${yearName(state.source.rows[0].year)} – ${yearName(state.source.rows.at(-1).year)} · ${state.resultMode==="average" ? "Average" : "Exit"} method · ${state.rows.length} months` : hasSource ? "Input is ready. Generate a monthly curve to continue." : "Upload a file or explore the sample dataset.";
  $("target-caption").textContent=state.resultMode==="exit" ? "Markers show yearly December targets." : "Markers show yearly mean targets at mid-year.";
  if(!hasResult)$("updated-at").textContent="No result generated";
  $("chart-empty").hidden=hasResult;
  window.Scenarios?.render();
  renderLegend();renderChart();renderTable();controls();
}
function renderLegend(){
  const legend=$("series-legend");legend.replaceChildren();
  if(!state.source)return;
  state.source.columns.forEach((column,index)=>{
    const button=node("button",undefined,"legend-button");button.type="button";button.style.setProperty("--series-color",colors[index%colors.length]);button.setAttribute("aria-pressed",String(state.visible.has(column)));button.title=`${state.visible.has(column) ? "Hide" : "Show"} ${column}`;
    button.append(node("span",undefined,"legend-line"),node("span",column));
    button.addEventListener("click",()=>{if(state.visible.has(column)){if(state.visible.size===1){toast("Keep at least one series visible.");return;}state.visible.delete(column);}else state.visible.add(column);state.inspected=null;$("chart-tooltip").hidden=true;renderLegend();renderChart();});legend.append(button);
  });
}
let chartGeometry=null;
let renderedChartRows=null;
const motionPreference=window.matchMedia("(prefers-reduced-motion: reduce)");
const chartMotion={animations:[],observer:null,pending:false,restore:null,onVisibility:null};
function finishChartMotion(){
  chartMotion.observer?.disconnect();chartMotion.observer=null;
  if(chartMotion.onVisibility)document.removeEventListener("visibilitychange",chartMotion.onVisibility);
  chartMotion.onVisibility=null;
  for(const animation of chartMotion.animations)animation.cancel();
  chartMotion.animations=[];chartMotion.pending=false;
  chartMotion.restore?.();chartMotion.restore=null;
  $("chart").dataset.motion=state.rows.length ? "complete" : "empty";
}
function revealChart(axes,axisLines,reveal,width,animate,elapsed=0){
  const chart=$("chart");
  if(!animate || motionPreference.matches || typeof reveal.animate!=="function" || typeof window.IntersectionObserver!=="function")return;
  const axisDuration=220,curveDelay=240,curveDuration=1100;
  axes.style.opacity="0";reveal.style.width="0px";
  chartMotion.pending=true;chart.dataset.motion="pending";
  chartMotion.restore=()=>{axes.style.opacity="";reveal.style.width="";};
  function inView(){const rect=chart.getBoundingClientRect(),visibleHeight=Math.min(rect.bottom,window.innerHeight)-Math.max(rect.top,0);return visibleHeight>=Math.min(rect.height*.2,window.innerHeight*.5) && rect.right>0 && rect.left<window.innerWidth;}
  function start(){
    if(!chartMotion.pending || document.hidden || !inView())return;
    chartMotion.observer?.disconnect();chartMotion.observer=null;
    chartMotion.pending=false;chart.dataset.motion="drawing";
    // The underlying SVG is already complete. Animation only reveals it;
    // finishing/cancelling always restores the actual, unmodified coordinates.
    axes.style.opacity="";reveal.style.width="";
    chartMotion.animations.push(axes.animate([{opacity:0},{opacity:1}],{duration:axisDuration,easing:"ease-out"}));
    for(const line of axisLines){const length=line.getTotalLength();chartMotion.animations.push(line.animate([
      {strokeDasharray:String(length),strokeDashoffset:String(length)},
      {strokeDasharray:String(length),strokeDashoffset:"0"}
    ],{duration:axisDuration,easing:"ease-out"}));}
    const drawing=reveal.animate([{width:"0px"},{width:`${width}px`}],{
      duration:curveDuration,delay:curveDelay,fill:"backwards",easing:"cubic-bezier(.4,0,.2,1)"
    });
    chartMotion.animations.push(drawing);
    if(elapsed>0)for(const animation of chartMotion.animations)animation.currentTime=elapsed;
    drawing.onfinish=()=>{if(chartMotion.animations.includes(drawing))finishChartMotion();};
  }
  chartMotion.onVisibility=()=>{
    if(chartMotion.pending){start();return;}
    for(const animation of chartMotion.animations){
      if(document.hidden && animation.playState==="running")animation.pause();
      else if(!document.hidden && animation.playState==="paused")animation.play();
    }
  };
  document.addEventListener("visibilitychange",chartMotion.onVisibility);
  chartMotion.observer=new IntersectionObserver(start,{threshold:[0,.05,.1,.2,.5,1]});chartMotion.observer.observe(chart);
  // On narrow screens, do not spend the animation while the chart is below
  // the upload form. It starts when the analyst scrolls it into view.
  start();
}
motionPreference.addEventListener("change",()=>{if(motionPreference.matches)finishChartMotion();});
function renderChart(){
  const sameResult=state.rows===renderedChartRows;
  const elapsed=sameResult ? chartMotion.animations.at(-1)?.currentTime || 0 : 0;
  const animate=!sameResult || chartMotion.pending || chartMotion.animations.length>0;
  finishChartMotion();renderedChartRows=state.rows.length ? state.rows : null;
  const chart=$("chart");chart.replaceChildren();const title=svgNode("title",{id:"chart-title"});title.textContent="Monthly curve";const description=svgNode("desc",{id:"chart-description"});description.textContent="Monthly estimates and yearly target markers. Use left and right arrow keys to inspect months, or see the values in the table below.";chart.append(title,description);
  const width=Math.max(360,Math.min(800,chart.clientWidth)),height=window.innerWidth<480 ? 275 : 310,left=58,right=25,top=25,bottom=42,plotWidth=width-left-right,plotHeight=height-top-bottom;
  chart.setAttribute("viewBox",`0 0 ${width} ${height}`);chart.style.setProperty("--chart-font-size",window.innerWidth<480 ? "12px" : "11px");
  if(!state.rows.length){for(let i=0;i<5;i++)chart.append(svgNode("line",{x1:left,x2:width-right,y1:top+i*plotHeight/4,y2:top+i*plotHeight/4,stroke:"#f0f3f7","stroke-width":1}));chartGeometry=null;return;}
  const columns=state.source.columns.filter(column=>state.visible.has(column));
  const comparison=window.Scenarios?.comparison();
  const values=[];for(const column of columns){for(const row of state.rows)values.push(numeric(row[column]));for(const row of state.source.rows)values.push(row[column]);}
  if(comparison && $("compare-baseline").checked)for(const column of columns)for(const row of comparison.rows)values.push(numeric(row[column]));
  let low=values.reduce((a,b)=>Math.min(a,b),Infinity),high=values.reduce((a,b)=>Math.max(a,b),-Infinity);
  const span=high-low || Math.max(Math.abs(high)*0.2,1);
  if(!Number.isFinite(span)){chartGeometry=null;$("chart-empty").hidden=false;$("chart-empty").querySelector("strong").textContent="These values exceed interactive chart precision";$("chart-empty").querySelector("span").textContent="Inspect the table or download the CSV to review the result.";return;}
  $("chart-empty").querySelector("strong").textContent="Your monthly profile will appear here";$("chart-empty").querySelector("span").textContent="Generate a curve to review its shape and values.";
  const roughStep=span/5;const power=10**Math.floor(Math.log10(roughStep));const step=[1,2,2.5,5,10].map(value=>value*power).find(value=>value>=roughStep) || power*10;
  if(high===low){low-=span/2;high+=span/2;}else{low=low>=0 && low<span*.1 ? 0 : low-span*.06;high+=span*.08;}
  const x=(position)=>left+position/(state.rows.length-1)*plotWidth;
  const y=(value)=>top+(high-value)/(high-low)*plotHeight;
  chartGeometry={width,height,left,right,top,bottom,plotWidth,plotHeight,x,y};
  const axes=svgNode("g",{"data-chart-layer":"axes"});
  const axisLines=[svgNode("line",{x1:left,x2:left,y1:height-bottom,y2:top,stroke:"#d8e1ec","stroke-width":1}),svgNode("line",{x1:left,x2:width-right,y1:height-bottom,y2:height-bottom,stroke:"#d8e1ec","stroke-width":1})];
  axes.append(...axisLines);chart.append(axes);
  const definitions=svgNode("defs"),clip=svgNode("clipPath",{id:"curve-reveal",clipPathUnits:"userSpaceOnUse"});
  const reveal=svgNode("rect",{x:left-5,y:0,width:plotWidth+10,height,"data-chart-reveal":""});clip.append(reveal);definitions.append(clip);chart.append(definitions);
  const curves=svgNode("g",{"data-chart-layer":"curves","clip-path":"url(#curve-reveal)"});chart.append(curves);
  const unit=svgNode("text",{x:left,y:12});unit.textContent="Percentage";axes.append(unit);
  for(let value=Math.ceil(low/step)*step,count=0;value<=high+step*0.01 && count<20;value+=step,count++){
    const line=svgNode("line",{x1:left,x2:width-right,y1:y(value),y2:y(value),stroke:Math.abs(value)<step*1e-6 ? "#d8e1ec" : "#eef1f5","stroke-width":1});axes.append(line);
    const label=svgNode("text",{x:left-11,y:y(value)+3,"text-anchor":"end"});label.textContent=Math.abs(value)>=1e6 ? `${value.toExponential(1)}%` : percent(value,Math.abs(step)<1 ? 2 : 0);axes.append(label);
  }
  const tickCount=window.innerWidth<480 ? 4 : 7;const ticks=new Set();
  for(let tick=0;tick<tickCount;tick++)ticks.add(Math.round(tick*(state.rows.length-1)/(tickCount-1)));
  for(const index of ticks){const label=svgNode("text",{x:x(index),y:height-18,"text-anchor":index===0 ? "start" : index===state.rows.length-1 ? "end" : "middle"});label.textContent=monthName(state.rows[index],true);axes.append(label);}
  for(const column of columns){
    const color=colors[state.source.columns.indexOf(column)%colors.length];
    if(comparison && $("compare-baseline").checked)curves.append(svgNode("polyline",{points:comparison.rows.map((row,index)=>`${x(index)},${y(numeric(row[column]))}`).join(" "),fill:"none",stroke:color,"stroke-width":1.5,"stroke-dasharray":"5 4","data-scenario":"baseline"}));
    const line=svgNode("polyline",{points:state.rows.map((row,index)=>`${x(index)},${y(numeric(row[column]))}`).join(" "),fill:"none",stroke:color,"stroke-width":2,"stroke-linejoin":"round","stroke-linecap":"round"});curves.append(line);
    if($("show-targets").checked)state.source.rows.forEach((row,index)=>{const point=svgNode("circle",{cx:x(index*12+(state.resultMode==="exit" ? 11 : 5.5)),cy:y(row[column]),r:3.2,fill:"white",stroke:color,"stroke-width":1.5});const pointTitle=svgNode("title");pointTitle.textContent=`${column} · ${yearName(row.year)} target: ${percent(row[column],6)}`;point.append(pointTitle);curves.append(point);});
  }
  chart.append(svgNode("line",{id:"crosshair",x1:left,x2:left,y1:top,y2:height-bottom,stroke:"#aab9ce","stroke-width":1,"stroke-dasharray":"3 3",visibility:"hidden"}));
  const focus=svgNode("g",{id:"focus-points"});chart.append(focus);
  revealChart(axes,axisLines,reveal,plotWidth+10,animate,elapsed);
}
function inspect(index){
  if(!chartGeometry || !state.rows.length)return;
  finishChartMotion();
  index=Math.max(0,Math.min(state.rows.length-1,index));state.inspected=index;
  const row=state.rows[index],geometry=chartGeometry,crosshair=$("crosshair"),points=$("focus-points"),tooltip=$("chart-tooltip");
  crosshair.setAttribute("x1",geometry.x(index));crosshair.setAttribute("x2",geometry.x(index));crosshair.setAttribute("visibility","visible");points.replaceChildren();tooltip.replaceChildren(node("strong",monthName(row)));
  for(const column of state.source.columns.filter(value=>state.visible.has(value))){
    const color=colors[state.source.columns.indexOf(column)%colors.length];points.append(svgNode("circle",{cx:geometry.x(index),cy:geometry.y(numeric(row[column])),r:3.5,fill:"white",stroke:color,"stroke-width":2}));
    const item=node("div",undefined,"tooltip-row"),label=node("span");label.style.setProperty("--series-color",color);label.append(node("span",undefined,"tooltip-dot"),node("span",column));item.append(label,node("b",row[column]));tooltip.append(item);
  }
  tooltip.hidden=false;const stage=$("chart-stage"),rect=$("chart").getBoundingClientRect(),stageRect=stage.getBoundingClientRect();
  const scale=Math.min(rect.width/geometry.width,rect.height/geometry.height),offset=(rect.width-geometry.width*scale)/2;
  let left=geometry.x(index)*scale+offset+rect.left-stageRect.left+14;if(left+tooltip.offsetWidth>stage.clientWidth-12)left-=tooltip.offsetWidth+28;
  tooltip.style.left=`${Math.max(8,left)}px`;tooltip.style.top="25px";
}
function hideInspection(){if($("crosshair"))$("crosshair").setAttribute("visibility","hidden");$("focus-points")?.replaceChildren();$("chart-tooltip").hidden=true;}
function tableRows(){if(!state.source)return [];return state.tab==="yearly" ? state.source.rows.slice(state.sourcePage*12,(state.sourcePage+1)*12) : state.rows.slice(state.yearIndex*12,(state.yearIndex+1)*12);}
function renderTable(){
  if(state.tab==="difference" && window.Scenarios?.renderDifference())return;
  const yearly=state.tab==="yearly",table=$("data-table"),head=table.querySelector("thead"),body=table.querySelector("tbody");head.replaceChildren();body.replaceChildren();
  for(const tab of ["monthly","yearly"]){const element=$(`${tab}-tab`);element.classList.toggle("active",state.tab===tab);element.setAttribute("aria-selected",String(state.tab===tab));element.tabIndex=state.tab===tab ? 0 : -1;}
  $("difference-tab").classList.remove("active");$("difference-tab").setAttribute("aria-selected","false");$("difference-tab").tabIndex=-1;$("difference-series-control").hidden=true;
  $("data-content").setAttribute("aria-labelledby",`${state.tab}-tab`);$("year-control").hidden=yearly || !state.rows.length;
  const select=$("year-select");select.replaceChildren();if(state.source)state.source.rows.forEach((row,index)=>{const option=node("option",String(row.year));option.value=index;option.selected=index===state.yearIndex;select.append(option);});
  const rows=tableRows(),columns=state.source ? ["year",...(yearly ? [] : ["month"]),...state.source.columns] : [];
  $("table-empty").hidden=rows.length>0;table.hidden=!rows.length;$("table-empty").textContent=yearly ? "Upload a yearly CSV to inspect its inputs." : "Monthly numbers will appear after generation.";
  if(rows.length){const header=node("tr");for(const column of columns){const th=node("th",column==="year" ? "Year" : column==="month" ? "Month" : column);th.scope="col";header.append(th);}head.append(header);
    rows.forEach((row)=>{const tr=node("tr");if(!yearly && state.inspected!==null && state.rows[state.inspected]===row)tr.className="selected";
      for(const column of columns){let value=column==="year" ? row.year : column==="month" ? months[row.month-1] : yearly ? percent(row[column],6) : row[column];const td=node("td",String(value));if(column==="year")td.className="year-cell";else if(column==="month")td.className="month-cell";else if(!yearly){const stats=state.stats.find(item=>item.column===column);if(stats && (numeric(row[column])<stats.low-1e-9 || numeric(row[column])>stats.high+1e-9)){td.className="range-value";td.title="Outside this series' yearly input range";}}tr.append(td);}body.append(tr);
    });
  }
  const total=yearly ? state.source?.rows.length || 0 : state.rows.length,page=yearly ? state.sourcePage : state.yearIndex,pages=yearly ? Math.ceil(total/12) : state.source?.rows.length || 0;
  $("table-count").textContent=total ? `${page*12+1}–${Math.min(page*12+12,total)} of ${total} ${yearly ? "yearly inputs" : "monthly values"}` : "No data to display";
  $("page-label").textContent=rows.length ? `${page+1} / ${pages}` : "—";$("previous-page").disabled=!rows.length || page===0;$("next-page").disabled=!rows.length || page>=pages-1;controls();
}
function switchTab(tab){state.tab=tab;renderTable();}
function movePage(direction){if(state.tab==="yearly")state.sourcePage+=direction;else state.yearIndex+=direction;state.inspected=null;hideInspection();renderTable();$("data-content").scrollTo(0,0);}
function saveBlob(blob,name){const url=URL.createObjectURL(blob);const a=node("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function exportResult(format){if(!state.rows.length || state.busy)return;const revision=operation(`Preparing ${format.toUpperCase()} download…`);const timer=setTimeout(()=>state.revision===revision && state.controller.abort(),90000);try{const response=await post(`/convert?mode=${state.resultMode}&format=${format}`,state.file,state.controller.signal);if(response.headers.get("X-Calculation-Engine")!==state.engineId)throw new Error("The calculation service has been updated. Generate again before downloading this result.");saveBlob(await response.blob(),window.Scenarios?.exportName(format) || `monthly_${state.resultMode}.${format}`);toast(`${format.toUpperCase()} download ready.`);}catch(error){handleFailure(error,revision);}finally{clearTimeout(timer);finish(revision);}}
async function copyTable(){const rows=tableRows();if(!rows.length)return;const columns=["year",...(state.tab==="yearly" ? [] : ["month"]),...state.source.columns];const text=state.tab==="difference" ? [['Year','Month','Baseline','Alternative','Change (pp)'].join('\t'),...Scenarios.differenceRows().map(row=>row.join('\t'))].join('\n') : [columns.join("\t"),...rows.map(row=>columns.map(column=>state.tab==="yearly" && column!=="year" ? percent(row[column],6) : row[column]).join("\t"))].join("\n");try{await navigator.clipboard.writeText(text);toast("Visible table copied. Paste it into Excel.");}catch{toast("Clipboard access is unavailable. Download the CSV instead.");}}

$("dropzone").addEventListener("click",()=>$("file-input").click());
$("file-input").addEventListener("change",event=>{loadFile(event.target.files[0]);event.target.value="";});
for(const eventName of ["dragenter","dragover"])$("dropzone").addEventListener(eventName,event=>{event.preventDefault();if(!state.busy)$("dropzone").classList.add("dragover");});
for(const eventName of ["dragleave","drop"])$("dropzone").addEventListener(eventName,event=>{event.preventDefault();$("dropzone").classList.remove("dragover");if(eventName==="drop" && !state.busy){if(event.dataTransfer.files.length!==1)showError("Upload one yearly CSV at a time.");else loadFile(event.dataTransfer.files[0]);}});
for(const input of document.querySelectorAll('input[name="mode"]'))input.addEventListener("change",()=>{state.mode=input.value;window.Scenarios?.methodChanged();clearResult();showError("");render();$("process-status").textContent=state.source ? "Method changed. Generate to apply it." : "Upload a file to get started.";});
$("generate").addEventListener("click",generate);
$("export-csv").addEventListener("click",()=>exportResult("csv"));$("export-pdf").addEventListener("click",()=>exportResult("pdf"));
$("download-input").addEventListener("click",()=>{if(state.file)saveBlob(state.file,state.file.name);});
$("view-input").addEventListener("click",()=>{switchTab("yearly");$("data-content").scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"nearest"});});
for(const tab of ["monthly","yearly"]){$(`${tab}-tab`).addEventListener("click",()=>switchTab(tab));$(`${tab}-tab`).addEventListener("keydown",event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const next=event.key==="Home" ? "monthly" : event.key==="End" ? "yearly" : tab==="monthly" ? "yearly" : "monthly";switchTab(next);$(`${next}-tab`).focus();}});}
$("year-select").addEventListener("change",event=>{state.yearIndex=Number(event.target.value);state.inspected=null;hideInspection();renderTable();});
$("previous-page").addEventListener("click",()=>movePage(-1));$("next-page").addEventListener("click",()=>movePage(1));$("copy-table").addEventListener("click",copyTable);
$("show-targets").addEventListener("change",()=>{hideInspection();renderChart();});
$("chart").addEventListener("pointermove",event=>{if(!chartGeometry)return;const rect=event.currentTarget.getBoundingClientRect(),scale=Math.min(rect.width/chartGeometry.width,rect.height/chartGeometry.height),offset=(rect.width-chartGeometry.width*scale)/2,x=(event.clientX-rect.left-offset)/scale;inspect(Math.round((x-chartGeometry.left)/chartGeometry.plotWidth*(state.rows.length-1)));});
$("chart").addEventListener("pointerleave",hideInspection);
$("chart").addEventListener("click",()=>{if(state.inspected===null)return;state.yearIndex=Math.floor(state.inspected/12);state.tab="monthly";renderTable();});
$("chart").addEventListener("keydown",event=>{if(!state.rows.length)return;if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const index=event.key==="Home" ? 0 : event.key==="End" ? state.rows.length-1 : (state.inspected??0)+(event.key==="ArrowRight" ? 1 : -1);inspect(index);state.yearIndex=Math.floor(state.inspected/12);state.tab="monthly";renderTable();}else if(event.key==="Escape")hideInspection();});
$("chart").addEventListener("blur",hideInspection);
let resizeTimer;window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{hideInspection();renderChart();},120);});
fetch("/health").then(response=>{if(!response.ok)throw new Error();$("connection").className="connection connected";$("connection").replaceChildren(node("span",undefined,"status-dot"),document.createTextNode("API connected"));}).catch(()=>{$("connection").className="connection disconnected";$("connection").replaceChildren(node("span",undefined,"status-dot"),document.createTextNode("Connection unavailable"));});
// scenarios.js initializes the workspace after installing project hooks.
