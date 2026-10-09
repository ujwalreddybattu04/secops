"use strict";

// Portable projects contain analyst data. They stay in memory until downloaded.
// Imported result snapshots are historical only: both inputs are recalculated.
const Scenarios = (() => {
  let baseline=null, alternative=null, active="baseline", dirty=false;
  let draft=null, editorPage=0, differenceColumn=null;
  const clone=(value)=>structuredClone(value);
  const stamp=()=>new Date().toISOString();
  const safeName=(value,max)=>typeof value==="string" && value.trim().length>0 && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);
  const csvField=(value)=>`"${String(value).replaceAll('"','""')}"`;
  const csvFile=(source)=>new File([[['year',...source.columns],...source.rows.map(row=>[row.year,...source.columns.map(column=>row[column])])].map(row=>row.map(csvField).join(',')).join('\r\n')+'\r\n'],"alternative-input.csv",{type:"text/csv;charset=utf-8"});
  const current=()=>active==="baseline" ? baseline : alternative;
  function snapshot(){return {name:"Baseline",file:state.file,source:clone(state.source),sample:state.sample,rows:[],mode:null,engineId:null,generatedAt:null};}
  function captureInput(){baseline=snapshot();render();}
  function clearSnapshot(item){if(item){item.rows=[];item.mode=null;item.engineId=null;item.generatedAt=null;item.review=null;item.influence=null;}}
  function captureReview(){const item=current();if(item){item.review=state.review;item.influence=state.influence;dirty=true;}}
  function capture(){
    const item=current();if(!item)return;
    item.rows=clone(state.rows);item.mode=state.resultMode;item.engineId=state.engineId;item.generatedAt=stamp();item.review=state.review || null;item.influence=state.influence || null;dirty=true;
    if(active==="alternative" && baseline.engineId!==item.engineId){clearSnapshot(item);clearResult();throw new Error("The calculation service changed during comparison. Generate again to use one version for both curves.");}
  }
  async function checkedSource(file,signal){
    const source=await (await post('/preview',file,signal)).json();
    if(source.columns.includes('month'))throw new Error("Rename the value column 'month'; it is reserved for generated month numbers.");
    return source;
  }
  async function calculate(item,mode,signal){
    const response=await post(`/convert?mode=${mode}&format=json`,item.file,signal);
    const rows=await response.json(),engineId=response.headers.get('X-Calculation-Engine');
    if(!engineId || !Array.isArray(rows) || rows.length!==item.source.rows.length*12)throw new Error("The calculation service returned an incomplete result. Please regenerate.");
    for(let index=0;index<rows.length;index++){
      const row=rows[index];
      if(row.year!==item.source.rows[Math.floor(index/12)].year || row.month!==index%12+1 || item.source.columns.some(column=>typeof row[column]!=="string" || !Number.isFinite(numeric(row[column]))))throw new Error("The calculation service returned unexpected monthly values.");
    }
    return {rows,mode,engineId,generatedAt:stamp(),review:null,influence:null};
  }
  async function prepare(signal){
    if(active!=="alternative")return;
    $("process-status").textContent="Calculating the original inputs for a consistent comparison…";
    const result=await calculate(baseline,state.mode,signal);
    if(window.Review?.accepts(baseline.review,baseline.source,result.rows,state.mode,result.engineId)){
      result.review=baseline.review;result.influence=baseline.influence;
    }
    Object.assign(baseline,result);
  }
  function comparison(){
    return active==="alternative" && state.rows.length && baseline?.rows.length===state.rows.length && baseline.mode===state.resultMode && baseline.engineId===state.engineId ? baseline : null;
  }
  function activate(which){
    if(state.busy || !(which==="baseline" ? baseline : alternative))return;
    active=which;const item=current();
    state.file=item.file;state.source=clone(item.source);state.sample=item.sample;state.rows=clone(item.rows);state.resultMode=item.mode;state.engineId=item.engineId;state.review=item.review || null;state.influence=item.influence || null;
    state.yearIndex=0;state.sourcePage=0;state.tab="monthly";state.inspected=null;state.stats=calculateRanges();hideInspection();window.render();
    window.Workspace?.selectedResult();
    $("process-status").textContent=state.rows.length ? "Curve ready to review." : "Assumptions ready. Generate to calculate this scenario.";
  }
  function controls(){
    for(const id of ['open-project','project-name','baseline-scenario','alternative-scenario','edit-alternative'])$(id).disabled=state.busy;
    $("create-alternative").disabled=state.busy || !baseline;
    $("save-project").disabled=state.busy || !baseline;
    $("comparison-key").querySelector('input').disabled=state.busy;
  }
  function render(){
    $("alternative-scenario").hidden=!alternative;
    $("create-alternative").hidden=Boolean(alternative);
    $("edit-alternative").hidden=!alternative;
    for(const which of ['baseline','alternative']){
      const tab=$(`${which}-scenario`);tab.classList.toggle('active',active===which);tab.setAttribute('aria-selected',String(active===which));tab.tabIndex=active===which ? 0 : -1;
    }
    if(alternative){
      $("alternative-label").textContent=alternative.name;
      const changed=changes(alternative.source);
      $("alternative-description").textContent=`${changed} changed ${changed===1 ? 'target' : 'targets'}`;
    }
    const ready=Boolean(comparison());$("comparison-key").hidden=!ready;$("difference-tab").hidden=!ready;
    if(!ready && state.tab==="difference")state.tab="monthly";
    $("profile-title").textContent=active==="baseline" ? "Original monthly curve" : `${alternative.name} · monthly curve`;
    const time=current()?.generatedAt;
    if(state.rows.length && time)$("updated-at").textContent=`Updated ${new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(time))}`;
  }
  function changes(source){return source.rows.reduce((count,row,index)=>count+source.columns.filter(column=>row[column]!==baseline.source.rows[index][column]).length,0);}
  function editor(){
    if(state.busy || !baseline)return;
    const source=alternative?.source || baseline.source;
    draft={columns:[...source.columns],rows:source.rows.map(row=>({year:row.year,values:source.columns.map(column=>String(row[column]))}))};editorPage=0;
    $("scenario-name").value=alternative?.name || "Alternative";$("editor-error").hidden=true;
    const history=alternative?.revisions || [];$("editor-history").hidden=!history.length;$("revision-select").replaceChildren();
    history.forEach((revision,index)=>{const option=node('option',`${revision.name} · ${new Date(revision.at).toLocaleString()}`);option.value=index;$("revision-select").append(option);});
    renderEditor();$("scenario-editor").showModal();$("scenario-name").focus();
  }
  function renderEditor(){
    const table=$("editor-table"),head=table.querySelector('thead'),body=table.querySelector('tbody');head.replaceChildren();body.replaceChildren();
    const header=node('tr');for(const label of ['Year',...draft.columns]){const th=node('th',label);th.scope='col';header.append(th);}head.append(header);
    draft.rows.slice(editorPage*12,editorPage*12+12).forEach((row,offset)=>{
      const tr=node('tr'),year=node('th',String(row.year));year.scope='row';tr.append(year);
      row.values.forEach((value,columnIndex)=>{
        const cell=node('td'),input=node('input');input.type='text';input.inputMode='decimal';input.value=value;input.maxLength=100;
        input.dataset.row=String(editorPage*12+offset);input.dataset.column=String(columnIndex);input.setAttribute('aria-label',`${draft.columns[columnIndex]}, ${yearName(row.year)}`);
        input.addEventListener('input',()=>{row.values[columnIndex]=input.value;$("draft-change-count").textContent="Draft changes · Apply to validate and calculate later";});cell.append(input);tr.append(cell);
      });body.append(tr);
    });
    $("editor-page-label").textContent=`Years ${editorPage*12+1}–${Math.min(editorPage*12+12,draft.rows.length)} of ${draft.rows.length}`;
    $("editor-previous").disabled=editorPage===0;$("editor-next").disabled=(editorPage+1)*12>=draft.rows.length;
    $("draft-change-count").textContent="Original input stays unchanged";
  }
  async function apply(event){
    event.preventDefault();if(state.busy || !draft)return;
    const name=$("scenario-name").value.trim();if(!safeName(name,64)){editorError("Enter a scenario name of 1–64 characters.");return;}
    const source={columns:[...draft.columns],rows:[]};
    for(let index=0;index<draft.rows.length;index++){
      const record=draft.rows[index],row=Object.assign(Object.create(null),{year:record.year});
      for(let column=0;column<draft.columns.length;column++){
        const value=record.values[column].trim().replace(/%$/,'').trim();
        if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))){
          editorPage=Math.floor(index/12);renderEditor();editorError(`Enter a finite number for ${draft.columns[column]}, ${yearName(row.year)}.`);
          const input=$("editor-table").querySelector(`input[data-row="${index}"][data-column="${column}"]`);input.setAttribute('aria-invalid','true');input.focus();return;
        }
        row[draft.columns[column]]=Number(value);
      }source.rows.push(row);
    }
    const revision=operation('Validating the alternative assumptions…'),timer=setTimeout(()=>state.controller.abort(),90000);editorBusy(true);
    try{
      const file=csvFile(source),checked=await checkedSource(file,state.controller.signal);
      if(alternative && alternative.name===name && JSON.stringify(checked)===JSON.stringify(alternative.source)){
        $("scenario-editor").close();state.busy=false;activate('alternative');toast('Assumptions are unchanged.');return;
      }
      const history=alternative ? [{name:alternative.name,at:stamp(),source:clone(alternative.source)},...(alternative.revisions || [])].slice(0,5) : [];
      alternative={name,file,source:checked,sample:false,rows:[],mode:null,engineId:null,generatedAt:null,revisions:history};dirty=true;
      $("scenario-editor").close();state.busy=false;activate('alternative');$("alternative-scenario").focus();toast("Assumptions applied. Generate to compare the monthly curves.");
    }catch(error){editorError(error.name==='AbortError' ? 'Validation timed out. Please try again.' : error.message);}finally{clearTimeout(timer);editorBusy(false);finish(revision);}
  }
  function editorError(message){$("editor-error").textContent=message;$("editor-error").hidden=false;}
  function editorBusy(value){for(const element of $("scenario-form").querySelectorAll('button,input,select'))element.disabled=value;if(!value)renderEditor();}
  function differenceRows(){
    const base=comparison();if(!base)return [];
    const column=differenceColumn || state.source.columns[0];
    return state.rows.slice(state.yearIndex*12,state.yearIndex*12+12).map((row,index)=>{
      const before=base.rows[state.yearIndex*12+index][column],delta=numeric(row[column])-numeric(before);
      return [row.year,months[row.month-1],before,row[column],Number.isFinite(delta) ? `${delta>0 ? '+' : ''}${percent(delta).slice(0,-1)} pp` : 'Outside display range'];
    });
  }
  function renderDifference(){
    if(!comparison())return false;
    for(const tab of ['monthly','yearly','difference']){const element=$(`${tab}-tab`);element.classList.toggle('active',tab==='difference');element.setAttribute('aria-selected',String(tab==='difference'));element.tabIndex=tab==='difference' ? 0 : -1;}
    $("data-content").setAttribute('aria-labelledby','difference-tab');$("difference-series-control").hidden=false;$("year-control").hidden=false;
    const series=$("difference-series");series.replaceChildren();state.source.columns.forEach(column=>{const option=node('option',column);option.value=column;option.selected=column===(differenceColumn || state.source.columns[0]);series.append(option);});
    const select=$("year-select");select.replaceChildren();state.source.rows.forEach((row,index)=>{const option=node('option',String(row.year));option.value=index;option.selected=index===state.yearIndex;select.append(option);});
    const table=$("data-table"),head=table.querySelector('thead'),body=table.querySelector('tbody');head.replaceChildren();body.replaceChildren();
    const header=node('tr');['Year','Month','Original',alternative.name,'Change (pp)'].forEach(label=>{const th=node('th',label);th.scope='col';header.append(th);});head.append(header);
    for(const row of differenceRows()){const tr=node('tr');row.forEach(value=>tr.append(node('td',String(value))));body.append(tr);}
    table.hidden=false;$("table-empty").hidden=true;$("table-count").textContent=`${state.yearIndex*12+1}–${state.yearIndex*12+12} of ${state.rows.length} monthly differences · rounded values`;
    $("page-label").textContent=`${state.yearIndex+1} / ${state.source.rows.length}`;$("previous-page").disabled=state.yearIndex===0;$("next-page").disabled=state.yearIndex===state.source.rows.length-1;controls();return true;
  }
  async function hash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');}
  function encode(bytes){let result='';for(let index=0;index<bytes.length;index+=32768)result+=String.fromCharCode(...bytes.subarray(index,index+32768));return btoa(result);}
  function decode(value){if(typeof value!=='string' || value.length>14*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('The project contains an invalid original CSV.');const text=atob(value);return Uint8Array.from(text,char=>char.charCodeAt(0));}
  const results=(item)=>item.rows.length ? {mode:item.mode,engineId:item.engineId,generatedAt:item.generatedAt,rows:item.rows,review:item.review || null,influence:item.influence || null} : null;
  async function projectDocument(){
    const bytes=new Uint8Array(await baseline.file.arrayBuffer());
    const name=$("project-name").value.trim() || 'Untitled analysis';
    if(!safeName(name,80))throw new Error('Use a project name of 1–80 characters without control characters.');
    return {schema:'interpolation-project',version:1,name,savedAt:stamp(),mode:state.mode,active,workspaceSettings:window.Review?.settings(),
      baseline:{filename:baseline.file.name,encoding:'base64',bytes:encode(bytes),sha256:await hash(bytes),result:results(baseline)},
      alternative:alternative ? {name:alternative.name,source:clone(alternative.source),revisions:clone(alternative.revisions),result:results(alternative)} : null};
  }
  async function saveProject(){
    if(state.busy || !baseline)return;const revision=operation('Preparing the project file…');
    try{const project=await projectDocument();saveBlob(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),`${filename(project.name)}.interpolation.json`);dirty=false;toast('Project download ready. Keep this file to reopen your analysis.');}
    catch(error){handleFailure(error,revision);}finally{finish(revision);}
  }
  function validateSource(source,base){
    if(!source || !Array.isArray(source.columns) || !Array.isArray(source.rows) || JSON.stringify(source.columns)!==JSON.stringify(base.columns) || source.rows.length!==base.rows.length)throw new Error('Alternative assumptions must use the baseline years and series.');
    if(source.rows.some((row,index)=>!row || row.year!==base.rows[index].year || source.columns.some(column=>typeof row[column]!=='number' || !Number.isFinite(row[column]))))throw new Error('The project contains invalid alternative targets.');
    return source;
  }
  async function openProject(file){
    if(!file || state.busy)return;
    if(file.size>40*1024*1024){showError('Project files must be smaller than 40 MB.');return;}
    if(!mayReplace())return;
    const revision=operation('Opening and recalculating the project…'),timer=setTimeout(()=>state.controller.abort(),180000);
    try{
      const project=JSON.parse(await file.text());
      if(project.schema!=='interpolation-project' || project.version!==1 || !safeName(project.name,80) || !['average','exit'].includes(project.mode) || !['baseline','alternative'].includes(project.active) || !project.baseline || project.baseline.encoding!=='base64' || !safeName(project.baseline.filename,255) || !project.baseline.filename.toLowerCase().endsWith('.csv'))throw new Error('This is not a supported Interpolation project (version 1).');
      const bytes=decode(project.baseline.bytes);
      if(bytes.length>10*1024*1024 || await hash(bytes)!==project.baseline.sha256)throw new Error('The original CSV does not match its saved checksum. Open the CSV separately to start a new project.');
      const baseFile=new File([bytes],project.baseline.filename,{type:'text/csv'}),baseSource=await checkedSource(baseFile,state.controller.signal);
      const nextBase={name:'Baseline',file:baseFile,source:baseSource,sample:false};let nextAlt=null;
      if(project.alternative!==null){
        const saved=project.alternative;
        if(!saved || !safeName(saved.name,64) || !Array.isArray(saved.revisions) || saved.revisions.length>5)throw new Error('The alternative scenario is not valid.');
        const source=validateSource(saved.source,baseSource),altFile=csvFile(source);
        const history=saved.revisions.map(item=>{if(!item || !safeName(item.name,64) || !Number.isFinite(Date.parse(item.at)))throw new Error('A saved assumption revision is invalid.');return {name:item.name,at:item.at,source:clone(validateSource(item.source,baseSource))};});
        nextAlt={name:saved.name,file:altFile,source:await checkedSource(altFile,state.controller.signal),sample:false,revisions:history};
      }
      if(project.active==='alternative' && !nextAlt)throw new Error('The selected alternative scenario is missing.');
      Object.assign(nextBase,await calculate(nextBase,project.mode,state.controller.signal));
      if(nextAlt){Object.assign(nextAlt,await calculate(nextAlt,project.mode,state.controller.signal));if(nextAlt.engineId!==nextBase.engineId)throw new Error('The service changed during recalculation. Open the project again.');}
      // Saved diagnostics are history, not evidence. Recompute if the analyst
      // previously reviewed that scenario. Never trust imported pass/fail flags.
      if(project.baseline.result?.review && window.Review)nextBase.review=await Review.fetchReport(nextBase,project.mode,state.controller.signal);
      if(nextAlt && project.alternative.result?.review && window.Review)nextAlt.review=await Review.fetchReport(nextAlt,project.mode,state.controller.signal);
      baseline=nextBase;alternative=nextAlt;state.mode=project.mode;$("project-name").value=project.name;
      for(const input of document.querySelectorAll('input[name="mode"]'))input.checked=input.value===state.mode;
      state.visible=new Set(baseSource.columns.slice(0,3));state.busy=false;dirty=false;activate(project.active);
      window.Review?.restoreSettings(project.workspaceSettings);render();
      const oldEngine=project.baseline.result?.engineId;
      toast(oldEngine && oldEngine!==nextBase.engineId ? 'Project reopened using the current engine. Download it to keep the recalculated results.' : 'Project reopened and recalculated.');
    }catch(error){handleFailure(error instanceof SyntaxError ? new Error('This project file is not valid JSON.') : error,revision);}finally{clearTimeout(timer);finish(revision);}
  }
  function filename(value){return value.replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,80) || 'analysis';}
  function exportName(format){return active==='alternative' ? `${filename(alternative.name)}_monthly_${state.resultMode}.${format}` : `monthly_${state.resultMode}.${format}`;}
  function mayReplace(){return !dirty || !alternative || window.confirm('Replace this project? Download it first if you want to keep the alternative assumptions.');}
  function reset(){baseline=null;alternative=null;active='baseline';dirty=false;differenceColumn=null;$("project-name").value='Untitled analysis';render();}
  function methodChanged(){clearSnapshot(baseline);clearSnapshot(alternative);dirty=true;}
  $("create-alternative").addEventListener('click',editor);$("edit-alternative").addEventListener('click',editor);
  $("close-editor").addEventListener('click',()=>$("scenario-editor").close());
  $("scenario-editor").addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
  $("scenario-form").addEventListener('submit',apply);
  for(const [id,delta] of [['editor-previous',-1],['editor-next',1]])$(id).addEventListener('click',()=>{editorPage+=delta;renderEditor();});
  $("restore-revision").addEventListener('click',()=>{const item=alternative.revisions[Number($("revision-select").value)];draft={columns:[...item.source.columns],rows:item.source.rows.map(row=>({year:row.year,values:item.source.columns.map(column=>String(row[column]))}))};$("scenario-name").value=item.name;editorPage=0;renderEditor();toast('Revision loaded into the draft. Apply to use it.');});
  for(const which of ['baseline','alternative']){
    $(`${which}-scenario`).addEventListener('click',()=>activate(which));
    $(`${which}-scenario`).addEventListener('keydown',event=>{if(alternative && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home' ? 'baseline' : event.key==='End' ? 'alternative' : active==='baseline' ? 'alternative' : 'baseline';activate(next);$(`${next}-scenario`).focus();}});
  }
  $("difference-tab").addEventListener('click',()=>switchTab('difference'));
  // All three data tabs share one keyboard navigation order.
  for(const tab of ['monthly','yearly','difference'])$(`${tab}-tab`).addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopImmediatePropagation();const tabs=comparison() ? ['monthly','yearly','difference'] : ['monthly','yearly'];
    const index=event.key==='Home' ? 0 : event.key==='End' ? tabs.length-1 : (tabs.indexOf(tab)+(event.key==='ArrowRight' ? 1 : -1)+tabs.length)%tabs.length;switchTab(tabs[index]);$(`${tabs[index]}-tab`).focus();
  },true);
  $("difference-series").addEventListener('change',event=>{differenceColumn=event.target.value;renderTable();});
  $("compare-baseline").addEventListener('change',()=>{hideInspection();renderChart();});
  $("save-project").addEventListener('click',saveProject);$("open-project").addEventListener('click',()=>$("project-file").click());
  $("project-file").addEventListener('change',event=>{openProject(event.target.files[0]);event.target.value='';});
  $("project-name").addEventListener('input',()=>{dirty=true;});
  return {captureInput,capture,captureReview,prepare,comparison,controls,render,renderDifference,differenceRows,exportName,mayReplace,reset,methodChanged,projectDocument,openProject};
})();
window.Scenarios=Scenarios;
render();sample();
