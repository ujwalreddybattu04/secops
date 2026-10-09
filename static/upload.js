"use strict";

// Selection stays local until Generate. Every result and export belongs to
// one file, method, request revision and backend calculation version.
const UploadScreen=(()=>{
  const byId=id=>document.getElementById(id);
  const input=byId("file-input"),composer=byId("upload-composer"),sidebar=byId("sidebar");
  const mobile=window.matchMedia("(max-width:760px)");
  let selected=null,files=[],drawerOpen=false,operation=null,revision=0,result=null,chartCleanup=null,introDismissed=false;
  const method=byId("method-selector"),generate=byId("generate");
  const monthNames=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function error(message){byId("upload-error").textContent=message;byId("upload-error").hidden=!message;}
  function status(message){byId("selection-status").textContent=message;}
  function updateControls(){
    generate.disabled=!selected || Boolean(operation);
    generate.querySelector(".icon").toggleAttribute("hidden",Boolean(operation));
    generate.querySelector(".spinner").hidden=!operation;
    generate.setAttribute("aria-label",operation ? "Processing CSV" : "Generate monthly curve");
    composer.setAttribute("aria-busy",String(Boolean(operation)));
    byId("cancel-request").hidden=!operation;
    for(const id of ["download-csv","download-pdf"])byId(id).disabled=!result || Boolean(operation);
  }
  function stopOperation(){
    if(operation){clearTimeout(operation.timer);operation.controller.abort();operation=null;}
    revision++;
    updateControls();
  }
  function resetResult(){
    stopOperation();result=null;
    if(chartCleanup){chartCleanup();chartCleanup=null;}
    byId("result-panel").hidden=true;document.body.classList.remove("has-result");
    byId("export-status").textContent="";byId("chart-announcement").textContent="";
    byId("intro-card").hidden=introDismissed;
    updateControls();
  }
  function formatSize(size){return size<1024 ? `${size} B` : size<1024*1024 ? `${(size/1024).toFixed(1)} KB` : `${(size/(1024*1024)).toFixed(1)} MB`;}
  function renderFiles(){
    const list=byId("recent-files");list.replaceChildren();byId("recent-empty").hidden=Boolean(files.length);
    for(const file of files){const button=document.createElement("button");button.className="recent-file";button.textContent=file.name;button.title=file.name;button.setAttribute("aria-pressed",String(file===selected));button.addEventListener("click",()=>{choose(file);if(mobile.matches)setDrawer(false);});list.append(button);}
  }
  function choose(file){
    if(!file)return;
    if(!file.name.toLowerCase().endsWith(".csv")){error("Choose a CSV file. Save an Excel workbook as CSV first.");return;}
    if(file.size===0){error("This file is empty. Choose a CSV containing your yearly data.");return;}
    if(file.size>10*1024*1024){error("Choose a CSV no larger than 10 MB.");return;}
    resetResult();selected=file;error("");files=[file,...files.filter(item=>item.name!==file.name)].slice(0,5);
    byId("file-name").textContent=file.name;byId("file-name").title=file.name;byId("file-size").textContent=`CSV · ${formatSize(file.size)}`;
    byId("file-chip").hidden=false;byId("choose-file-prompt").hidden=true;
    status(`Ready. Select a method and press the arrow to generate your curve.`);renderFiles();updateControls();
  }
  function clear(){resetResult();selected=null;input.value="";error("");byId("file-chip").hidden=true;byId("choose-file-prompt").hidden=false;status("");renderFiles();updateControls();}

  function startOperation(kind){
    const job={id:++revision,file:selected,mode:method.value,kind,controller:new AbortController(),timedOut:false};
    operation=job;
    job.timer=setTimeout(()=>{job.timedOut=true;job.controller.abort();},180000);
    error("");byId("export-status").textContent="";updateControls();return job;
  }
  function ensureCurrent(job){
    if(operation!==job || revision!==job.id || job.controller.signal.aborted)throw new DOMException("Request canceled","AbortError");
  }
  function finish(job){if(operation===job){clearTimeout(job.timer);operation=null;updateControls();}}
  function progress(job,message){ensureCurrent(job);status(message);if(job.kind!=="generate")byId("export-status").textContent=message;}
  function pause(ms,signal){
    return new Promise((resolve,reject)=>{
      if(signal.aborted){reject(new DOMException("Request canceled","AbortError"));return;}
      const abort=()=>{clearTimeout(timer);reject(new DOMException("Request canceled","AbortError"));};
      const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},ms);
      signal.addEventListener("abort",abort,{once:true});
    });
  }
  async function request(job,path){
    for(let attempt=0;attempt<3;attempt++){
      ensureCurrent(job);
      const form=new FormData();form.append("file",job.file,job.file.name);
      const response=await fetch(path,{method:"POST",body:form,signal:job.controller.signal,cache:"no-store"});
      ensureCurrent(job);
      if(response.status===503 && attempt<2){
        const delay=Number(response.headers.get("Retry-After")) || 3;
        await response.body?.cancel();
        progress(job,"The calculation service is busy. Retrying shortly…");
        await pause(Math.min(10,Math.max(1,delay))*1000,job.controller.signal);continue;
      }
      if(!response.ok){
        let detail;
        try{const body=await response.json();if(typeof body.detail==="string")detail=body.detail;}catch{}
        ensureCurrent(job);
        throw new Error(detail || (response.status===413 ? "This CSV exceeds the service limits. Choose a smaller file." : response.status>=500 ? "The calculation service is unavailable. Please try again." : `The CSV could not be processed (HTTP ${response.status}).`));
      }
      return response;
    }
  }
  async function readJSON(response){
    if(!response.headers.get("Content-Type")?.includes("application/json"))throw new Error("The service returned an unexpected response. Please try again.");
    try{return await response.json();}catch(caught){
      if(caught.name==="AbortError")throw caught;
      throw new Error("The service returned an invalid response. Please try again.");
    }
  }
  function validateSource(source){
    if(!source || !Array.isArray(source.columns) || !Array.isArray(source.rows) || !source.columns.length || !source.rows.length || source.columns.length>20 || source.rows.length>100)throw new Error("The service returned an invalid yearly preview.");
    if(source.columns.some(name=>typeof name!=="string" || !name) || new Set(source.columns).size!==source.columns.length)throw new Error("The service returned invalid column names.");
    source.rows.forEach((row,index)=>{
      if(!row || !Number.isSafeInteger(row.year) || (index && row.year!==source.rows[index-1].year+1) || source.columns.some(name=>!Object.hasOwn(row,name) || typeof row[name]!=="number" || !Number.isFinite(row[name])))throw new Error("The service returned invalid yearly targets.");
    });
  }
  function outputKeys(columns){
    // Match the backend's deterministic JSON alias for a value called month.
    const names=["year","month",...columns],used=new Set(names);
    for(let i=2;i<names.length;i++)if(names.slice(0,i).includes(names[i])){
      let alias=names[i]+"_value";while(used.has(alias))alias+="_value";
      names[i]=alias;used.add(alias);
    }
    return names.slice(2);
  }
  function validateMonthly(rows,source,keys){
    if(!Array.isArray(rows) || rows.length!==source.rows.length*12)throw new Error("The service returned an incomplete monthly result.");
    rows.forEach((row,index)=>{
      if(!row || row.year!==source.rows[Math.floor(index/12)].year || row.month!==index%12+1)throw new Error("The service returned an invalid monthly timeline.");
      for(const key of keys)if(!Object.hasOwn(row,key) || typeof row[key]!=="string" || !/^-?\d+(?:\.\d+)?%$/.test(row[key]) || !Number.isFinite(Number(row[key].slice(0,-1))))throw new Error("The service returned an invalid monthly value.");
    });
  }
  function engineId(response){
    const id=response.headers.get("X-Calculation-Engine");
    if(!/^sha256:[a-f0-9]{64}$/.test(id || ""))throw new Error("The calculation version could not be verified. Please try again.");
    return id;
  }
  function failure(job,caught){
    if(operation!==job)return;
    const message=job.timedOut ? "The request took too long. Please try again." : caught.name==="AbortError" ? "Request canceled. You can generate again." : caught instanceof TypeError ? "Could not reach the calculation service. Check your connection and try again." : caught.message || "The calculation could not be completed. Please try again.";
    error(message);status("");if(job.kind!=="generate")byId("export-status").textContent=message;
  }
  async function convert(){
    if(!selected || operation)return;
    resetResult();const job=startOperation("generate");
    try{
      progress(job,"Checking your yearly CSV… The service may take a moment to wake up.");
      const source=await readJSON(await request(job,"/preview"));ensureCurrent(job);validateSource(source);
      progress(job,`Creating your ${job.mode==="average" ? "Average" : "Exit"} monthly curve…`);
      const response=await request(job,`/convert?mode=${job.mode}&format=json`);
      const engine=engineId(response),rows=await readJSON(response);ensureCurrent(job);
      const keys=outputKeys(source.columns);validateMonthly(rows,source,keys);
      result={file:job.file,mode:job.mode,source,keys,rows,engine};
      renderResult();status(`Your ${job.mode==="average" ? "Average" : "Exit"} curve is ready. ${rows.length.toLocaleString()} months generated.`);
      if(!drawerOpen)byId("result-title").focus({preventScroll:true});
    }catch(caught){failure(job,caught);}
    finally{finish(job);}
  }
  function renderResult(){
    byId("result-panel").hidden=false;byId("intro-card").hidden=true;document.body.classList.add("has-result");
    byId("result-meta").textContent=`${result.mode==="average" ? "Average" : "Exit"} · ${result.source.rows.length} ${result.source.rows.length===1 ? "year" : "years"} · ${result.rows.length.toLocaleString()} months`;
    const years=byId("table-year");years.replaceChildren();
    for(const target of result.source.rows){const option=document.createElement("option");option.value=String(target.year);option.textContent=String(target.year);years.append(option);}
    renderTable();
    chartCleanup=window.MonthlyChart.draw(byId("chart"),result.rows,result.source.columns,result.keys,byId("series-legend"),byId("chart-readout"),byId("chart-announcement"));
  }
  function renderTable(){
    if(!result)return;
    const table=byId("monthly-table"),head=table.querySelector("thead"),body=table.querySelector("tbody");head.replaceChildren();body.replaceChildren();
    const heading=document.createElement("tr");
    for(const name of ["Month",...result.source.columns]){const th=document.createElement("th");th.scope="col";th.textContent=name;heading.append(th);}head.append(heading);
    const year=Number(byId("table-year").value);table.querySelector("caption").textContent=`Monthly values for year ${year}`;
    for(const row of result.rows.filter(row=>row.year===year)){
      const tr=document.createElement("tr"),month=document.createElement("th");month.scope="row";month.textContent=monthNames[row.month-1];tr.append(month);
      for(const key of result.keys){const td=document.createElement("td");td.textContent=row[key];tr.append(td);}body.append(tr);
    }
  }
  function csvText(run){
    const field=value=>/[",\r\n]/.test(String(value)) ? '"'+String(value).replaceAll('"','""')+'"' : String(value);
    return [["year","month",...run.source.columns],...run.rows.map(row=>[row.year,row.month,...run.keys.map(key=>row[key])])].map(row=>row.map(field).join(",")).join("\n")+"\n";
  }
  async function download(format){
    if(!result || operation)return;
    const run=result,job=startOperation(format);
    try{
      progress(job,`Preparing your ${format.toUpperCase()} download…`);
      const response=await request(job,`/convert?mode=${run.mode}&format=${format}`);
      if(engineId(response)!==run.engine){resetResult();error("The calculation service was updated. Generate the curve again before downloading.");status("");return;}
      const expected=format==="pdf" ? "application/pdf" : "text/csv";
      if(!response.headers.get("Content-Type")?.includes(expected))throw new Error("The service returned an invalid download. Please try again.");
      const blob=await response.blob();ensureCurrent(job);
      if(format==="pdf"){
        if(await blob.slice(0,5).text()!=="%PDF-")throw new Error("The service returned an invalid PDF. Please try again.");
      }else if((await blob.text()).replace(/^\uFEFF/,"").replaceAll("\r\n","\n")!==csvText(run))throw new Error("The downloaded values differ from this curve. Generate the curve again before downloading.");
      ensureCurrent(job);
      const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`monthly_${run.mode}.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
      const message=`${format.toUpperCase()} download ready.`;status(message);byId("export-status").textContent=message;
    }catch(caught){failure(job,caught);}finally{finish(job);}
  }
  function setDrawer(open,returnFocus=false){
    drawerOpen=mobile.matches && open;document.body.classList.toggle("sidebar-open",drawerOpen);
    byId("sidebar-backdrop").hidden=!drawerOpen;byId("mobile-toggle").setAttribute("aria-expanded",String(drawerOpen));
    sidebar.inert=mobile.matches && !drawerOpen;document.querySelector(".main-shell").inert=drawerOpen;
    byId("sidebar-toggle").setAttribute("aria-label",mobile.matches ? "Close navigation" : document.body.classList.contains("sidebar-collapsed") ? "Expand sidebar" : "Collapse sidebar");
    byId("sidebar-toggle").setAttribute("aria-expanded",String(mobile.matches ? drawerOpen : !document.body.classList.contains("sidebar-collapsed")));
    if(drawerOpen)byId("sidebar-toggle").focus();else if(returnFocus)byId("mobile-toggle").focus();
    document.body.style.overflow=drawerOpen ? "hidden" : "";
  }
  for(const button of document.querySelectorAll("[data-file-picker]"))button.addEventListener("click",()=>input.click());
  generate.addEventListener("click",convert);
  method.addEventListener("change",()=>{resetResult();error("");status(selected ? "Method changed. Press the arrow to generate your new curve." : "");});
  byId("cancel-request").addEventListener("click",()=>{stopOperation();status("Request canceled. You can try again.");byId("export-status").textContent="";generate.focus();});
  byId("download-csv").addEventListener("click",()=>download("csv"));
  byId("download-pdf").addEventListener("click",()=>download("pdf"));
  byId("table-year").addEventListener("change",renderTable);
  input.addEventListener("change",()=>{choose(input.files[0]);input.value="";});
  byId("remove-file").addEventListener("click",()=>{clear();byId("choose-file-prompt").focus();});
  byId("new-upload").addEventListener("click",()=>{clear();if(mobile.matches)setDrawer(false,true);byId("choose-file-prompt").focus();});
  for(const name of ["dragenter","dragover"])composer.addEventListener(name,event=>{event.preventDefault();composer.classList.add("dragover");});
  composer.addEventListener("dragleave",event=>{if(!composer.contains(event.relatedTarget))composer.classList.remove("dragover");});
  composer.addEventListener("drop",event=>{event.preventDefault();composer.classList.remove("dragover");if(event.dataTransfer.files.length!==1){error("Choose one CSV file at a time.");return;}choose(event.dataTransfer.files[0]);});
  window.addEventListener("dragover",event=>event.preventDefault());window.addEventListener("drop",event=>event.preventDefault());
  byId("dismiss-intro").addEventListener("click",()=>{introDismissed=true;byId("intro-card").hidden=true;byId("choose-file-prompt").hidden ? byId("remove-file").focus() : byId("choose-file-prompt").focus();});
  byId("sidebar-toggle").addEventListener("click",()=>{if(mobile.matches)setDrawer(false,true);else{document.body.classList.toggle("sidebar-collapsed");setDrawer(false);}});
  byId("mobile-toggle").addEventListener("click",()=>{document.body.classList.remove("sidebar-collapsed");setDrawer(!drawerOpen,true);});
  byId("sidebar-backdrop").addEventListener("click",()=>setDrawer(false,true));
  document.addEventListener("keydown",event=>{
    if(!drawerOpen)return;
    if(event.key==="Escape"){event.preventDefault();setDrawer(false,true);}
    if(event.key==="Tab"){
      const focusable=[...sidebar.querySelectorAll("a[href],button")].filter(element=>element.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  mobile.addEventListener("change",()=>{document.body.classList.remove("sidebar-collapsed");setDrawer(false);});
  setDrawer(false);
  updateControls();
  return {selection:()=>selected,mode:()=>method.value,busy:()=>Boolean(operation),result:()=>result,clear};
})();
window.UploadScreen=UploadScreen;
