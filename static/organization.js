"use strict";

// Navigation only: changing views never edits inputs or runs a calculation.
const Workspace = (() => {
  const pages=["input","results","methods","signals","record"];
  const ids={input:"input-workflow-tab",results:"results-workflow-tab",methods:"methods-review-tab",signals:"signals-review-tab",record:"record-review-tab"};
  const panelIds={input:"input-workflow",results:"results-workflow",methods:"methods-review",signals:"signals-review",record:"record-review"};
  let active=state.rows.length ? "results" : "input";
  const reviewPage=()=>["methods","signals","record"].includes(active);
  const descriptions={
    methods:{title:"Compare Average and Exit",kicker:"STEP 03 · COMPARE",copy:"See how the same yearly inputs produce different monthly values under each method.",action:"Calculate comparison",empty:"Calculate both methods to see their curves together. Your selected result and input file stay unchanged.",cards:[["Average","A yearly value of 6% means the twelve months average to 6%. Monthly values can vary above and below that value."],["Exit","A yearly value of 6% means December is 6%. The other months follow a smooth path between the yearly targets."]]},
    signals:{title:"Understand your curve",kicker:"STEP 04 · EXPLAIN",copy:"Find where the curve changes direction and understand the role of your yearly inputs.",action:"Analyze this curve",empty:"Prepare the analysis to find changes and see which calculation rules shaped this result.",cards:[["Find changes","Inspect unusually large yearly changes and months where the curve switches between rising and falling."],["Test an input","Temporarily change one yearly target and measure the monthly response. The experiment does not edit your saved input."]]},
    record:{title:"Checks and calculation record",kicker:"STEP 05 · RECORD",copy:"Review numerical checks and keep the settings needed to reproduce your result.",action:"Check this result",empty:"Run the checks to inspect the unrounded monthly values and prepare a downloadable calculation record.",cards:[["Check the numbers","Average checks each year's mean. Exit checks each December. Both check finite values and the first-month rule."],["Keep your work","Download the calculation record, or Save project to keep inputs, settings and requested checks in a file you can reopen."]]}
  };
  function controls(){
    for(const page of pages)$(ids[page]).disabled=state.busy || (page!=="input" && !state.rows.length);
    $("change-input").hidden=active==="input";$("change-input").disabled=state.busy;
    for(const id of ["open-method-comparison","open-curve-explanation"])$(id).disabled=state.busy || !state.rows.length;
  }
  function navigation(){
    for(const page of pages){const button=$(ids[page]),current=page===active;button.classList.toggle("active",current);button.setAttribute("aria-selected",String(current));button.tabIndex=current ? 0 : -1;}
    $("input-workflow").hidden=active!=="input";$("results-workflow").hidden=active!=="results";$("curve-review").hidden=!reviewPage();
    const title=state.file?.name || "No file selected";
    $("workflow-context-copy").textContent=state.source ? `${title} · ${state.source.rows.length} years · ${state.source.columns.length} data columns · ${state.mode==="average" ? "Average" : "Exit"}` : state.file ? `${title} · Input needs attention` : "Start with a yearly CSV.";
    $("workflow-origin").hidden=!state.sample;
    if(reviewPage()){
      const detail=descriptions[active];$("curve-review-title").textContent=detail.title;$("review-page-kicker").textContent=detail.kicker;$("review-page-description").textContent=detail.copy;$("review-placeholder-copy").textContent=detail.empty;
      $("review-purpose-cards").replaceChildren(...detail.cards.map(([title,text])=>{const card=node("div",undefined,"review-purpose-card");card.append(node("h3",title),node("p",text));return card;}));
      $("review-placeholder").hidden=Boolean(state.review);
      $("review-selection-note").textContent=active==="methods" ? "Both methods use this same column" : `Reviewing the ${state.resultMode==="average" ? "Average" : "Exit"} result`;
    }
    controls();
  }
  function show(page,{fromReview=false,focus=false,force=false}={}){
    if(!pages.includes(page) || (!force && state.busy) || (page!=="input" && !state.rows.length))return;
    const changed=active!==page;active=page;
    if(changed && page!=="results"){hideInspection();finishChartMotion();}
    if(reviewPage() && !fromReview)window.Review?.selectTab(page);
    navigation();
    if(active==="results"){if(changed)renderChart();renderTable();}
    else if(active==="input")renderInput();
    window.Review?.controls();
    if(changed && window.scrollY>document.querySelector(".workflow-navigation").getBoundingClientRect().top+window.scrollY){document.querySelector(".workflow-navigation").scrollIntoView({block:"start",behavior:"instant"});}
    if(focus)$(ids[page]).focus({preventScroll:true});
  }
  function renderInput(){
    const table=$("input-preview-table"),head=table.querySelector("thead"),body=table.querySelector("tbody");head.replaceChildren();body.replaceChildren();
    const source=state.source;table.hidden=!source;$("input-preview-empty").hidden=Boolean(source);
    const pagesCount=source ? Math.ceil(source.rows.length/12) : 0;
    if(source){
      state.sourcePage=Math.max(0,Math.min(state.sourcePage,pagesCount-1));
      const header=node("tr");for(const column of ["Year",...source.columns]){const th=node("th",column);th.scope="col";header.append(th);}head.append(header);
      for(const row of source.rows.slice(state.sourcePage*12,state.sourcePage*12+12)){const tr=node("tr");tr.append(node("td",String(row.year)));for(const column of source.columns)tr.append(node("td",percent(row[column],6)));body.append(tr);}
    }
    $("input-preview-description").textContent=source ? `${source.rows.length} consecutive years · ${source.columns.length} columns · These are the inputs used for the calculation.` : "Your validated input will appear here before calculation.";
    $("input-page-label").textContent=source ? `${state.sourcePage+1} / ${pagesCount}` : "—";
    $("input-previous").disabled=state.busy || !source || state.sourcePage===0;$("input-next").disabled=state.busy || !source || state.sourcePage>=pagesCount-1;
    $("method-example-copy").textContent=state.mode==="average" ? "Months may be above or below 6%. Together, their average is 6% before display rounding." : "December is 6%. The other months form a smooth path; their average does not have to be 6%.";
  }
  function render(){
    if(!state.rows.length && active!=="input")active="input";
    navigation();renderInput();
  }
  function selectedResult(focus=false){
    show(state.rows.length ? "results" : "input",{force:true});
    // The Generate button becomes hidden; keep keyboard focus in the visible view.
    if(focus)requestAnimationFrame(()=>{if(active==="results" && !state.busy)$(ids.results).focus({preventScroll:true});});
  }
  function reviewAction(){return reviewPage() ? descriptions[active].action : "Prepare analysis";}
  for(const page of pages){
    $(ids[page]).addEventListener("click",event=>{event.stopImmediatePropagation();show(page);},true);
    $(ids[page]).addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();event.stopImmediatePropagation();const available=pages.filter(page=>!$(ids[page]).disabled);
      const index=event.key==="Home" ? 0 : event.key==="End" ? available.length-1 : (available.indexOf(active)+(event.key==="ArrowRight" ? 1 : -1)+available.length)%available.length;
      show(available[index],{focus:true});
    },true);
  }
  $("change-input").addEventListener("click",()=>show("input"));
  $("open-method-comparison").addEventListener("click",()=>show("methods"));$("open-curve-explanation").addEventListener("click",()=>show("signals"));
  for(const [id,delta] of [["input-previous",-1],["input-next",1]])$(id).addEventListener("click",()=>{state.sourcePage+=delta;renderInput();});
  return {show,render,controls,navigation,selectedResult,reviewAction,page:()=>active};
})();
window.Workspace=Workspace;
Workspace.render();
