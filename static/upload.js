"use strict";

// This release is the upload screen only. Selection stays local; conversion
// and analysis flows will be added when their next steps are specified.
const UploadScreen=(()=>{
  const byId=id=>document.getElementById(id);
  const input=byId("file-input"),composer=byId("upload-composer"),sidebar=byId("sidebar");
  const mobile=window.matchMedia("(max-width:760px)");
  let selected=null,files=[],drawerOpen=false;
  function error(message){byId("upload-error").textContent=message;byId("upload-error").hidden=!message;}
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
    selected=file;error("");files=[file,...files.filter(item=>item!==file)].slice(0,5);
    byId("file-name").textContent=file.name;byId("file-name").title=file.name;byId("file-size").textContent=`CSV · ${formatSize(file.size)}`;
    byId("file-chip").hidden=false;byId("choose-file-prompt").hidden=true;
    byId("selection-status").textContent=`Selected ${file.name}.`;renderFiles();
  }
  function clear(){selected=null;input.value="";error("");byId("file-chip").hidden=true;byId("choose-file-prompt").hidden=false;byId("selection-status").textContent="";renderFiles();}
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
  input.addEventListener("change",()=>{choose(input.files[0]);input.value="";});
  byId("remove-file").addEventListener("click",()=>{clear();byId("choose-file-prompt").focus();});
  byId("new-upload").addEventListener("click",()=>{clear();if(mobile.matches)setDrawer(false,true);byId("choose-file-prompt").focus();});
  for(const name of ["dragenter","dragover"])composer.addEventListener(name,event=>{event.preventDefault();composer.classList.add("dragover");});
  composer.addEventListener("dragleave",event=>{if(!composer.contains(event.relatedTarget))composer.classList.remove("dragover");});
  composer.addEventListener("drop",event=>{event.preventDefault();composer.classList.remove("dragover");if(event.dataTransfer.files.length!==1){error("Choose one CSV file at a time.");return;}choose(event.dataTransfer.files[0]);});
  window.addEventListener("dragover",event=>event.preventDefault());window.addEventListener("drop",event=>event.preventDefault());
  byId("dismiss-intro").addEventListener("click",()=>{byId("intro-card").hidden=true;byId("choose-file-prompt").hidden ? byId("remove-file").focus() : byId("choose-file-prompt").focus();});
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
  return {selection:()=>selected,mode:()=>byId("method-selector").value,clear};
})();
window.UploadScreen=UploadScreen;
