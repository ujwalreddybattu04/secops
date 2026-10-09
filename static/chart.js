"use strict";

// Draw the API's monthly points directly: no browser-side interpolation,
// clamping, or adjustment of the calculated values.
window.MonthlyChart=(()=>{
  const NS="http://www.w3.org/2000/svg";
  const colors=["#52729c","#b47458","#71937d","#88749e","#b19450","#62959c","#a5687f","#69717b"];
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function node(tag,attributes={},text){
    const element=document.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
    if(text!==undefined)element.textContent=text;return element;
  }
  function number(value){
    if(Math.abs(value)>=1e6 || (value!==0 && Math.abs(value)<.01))return value.toExponential(1);
    return new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value);
  }
  function draw(svg,rows,columns,keys,legend,readout,announcement){
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    let disposed=false,animations=[],geometry=null,active=-1,lastWidth=0,frame=0;
    const values=keys.map(key=>rows.map(row=>Number(row[key].slice(0,-1))));
    // Normalize coordinates before subtraction, avoiding overflow on huge
    // finite values. Normalization changes only screen coordinates.
    let scale=0;for(const series of values)for(const value of series)scale=Math.max(scale,Math.abs(value));scale=scale || 1;
    const normalized=values.map(series=>series.map(value=>value/scale));
    let low=Infinity,high=-Infinity;for(const series of normalized)for(const value of series){low=Math.min(low,value);high=Math.max(high,value);}
    const span=high-low || Math.max(Math.abs(high)*.1,.1);
    // Axis padding is display-only. Keep a zero baseline when appropriate;
    // monthly values themselves are never constrained here.
    const bottom=low>=0 ? Math.max(0,low-span*.08) : low-span*.08;
    const top=high<=0 ? Math.min(0,high+span*.08) : high+span*.08;
    const roughStep=(top-bottom)/4,unit=10**Math.floor(Math.log10(roughStep)+Math.log10(scale));
    const ratio=roughStep/(unit/scale),multiple=[1,2,2.5,5,10].reduce((best,value)=>Math.abs(value-ratio)<Math.abs(best-ratio) ? value : best,1);
    let tickStep=(unit/scale)*multiple;
    if(!Number.isFinite(tickStep) || tickStep<=0)tickStep=roughStep;
    legend.replaceChildren();
    columns.forEach((column,index)=>{
      const item=document.createElement("span"),dot=document.createElement("span"),label=document.createElement("span");
      item.className="legend-item";dot.className="legend-dot";dot.style.backgroundColor=colors[index%colors.length];label.textContent=column;
      item.append(dot,label);legend.append(item);
    });
    readout.replaceChildren();const hint=document.createElement("p");hint.textContent="Move across the curve to inspect a month.";readout.append(hint);
    function finishAnimations(){for(const animation of animations)animation.finish();animations=[];}
    function cancelAnimations(){for(const animation of animations)animation.cancel();animations=[];}
    function inspect(index,announce=false){
      if(!geometry || disposed)return;
      active=Math.min(rows.length-1,Math.max(0,index));
      const row=rows[active],{sx,sy,guide,markers}=geometry;
      guide.setAttribute("x1",sx(active));guide.setAttribute("x2",sx(active));guide.removeAttribute("visibility");
      markers.forEach((marker,i)=>{marker.setAttribute("cx",sx(active));marker.setAttribute("cy",sy(normalized[i][active]));marker.removeAttribute("visibility");});
      readout.replaceChildren();
      const time=document.createElement("strong");time.textContent=`${months[row.month-1]} ${row.year}`;readout.append(time);
      columns.forEach((column,i)=>{const value=document.createElement("span");value.textContent=`${column}: ${row[keys[i]]}`;readout.append(value);});
      if(announce)announcement.textContent=[...readout.children].map(element=>element.textContent).join(". ");
    }
    function paint(animate){
      if(disposed)return;
      cancelAnimations();
      const width=Math.max(240,svg.parentElement.clientWidth),height=width<500 ? 265 : 320;
      const left=scale>=1e6 || scale<.001 ? 88 : 64,right=width-14,upper=12,lower=height-36;
      const sx=index=>left+(right-left)*index/(rows.length-1),sy=value=>lower-(value-bottom)*(lower-upper)/(top-bottom);
      svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.style.height=`${height}px`;svg.replaceChildren();
      svg.append(node("title",{id:"chart-title"},"Monthly curve"),node("desc",{id:"chart-description"},"Monthly values calculated from your uploaded CSV. Use the left and right arrow keys to inspect each month. Values are also available in the table below."));
      const firstTick=Math.ceil(bottom/tickStep),lastTick=Math.floor(top/tickStep);
      for(let i=firstTick;i<=lastTick && i<firstTick+12;i++){
        const value=tickStep*i,y=sy(value),raw=value*scale;
        const label=Number.isFinite(raw) ? number(raw)+"%" : number(value)+" × "+scale.toExponential(1)+"%";
        svg.append(node("line",{x1:left,x2:right,y1:y,y2:y,class:"chart-grid"}),node("text",{x:left-10,y:y+4,"text-anchor":"end",class:"chart-tick"},label));
      }
      svg.append(node("path",{d:`M${left} ${upper}V${lower}H${right}`,class:"chart-axis"}));
      svg.querySelector(".chart-axis").setAttribute("fill","none");
      const labelWidth=Math.max(90,("Dec "+rows.at(-1).year).length*7);
      const tickCount=Math.max(2,Math.min(width<500 ? 3 : 6,Math.floor((right-left)/labelWidth)));
      for(let i=0;i<tickCount;i++){
        const index=Math.round((rows.length-1)*i/(tickCount-1)),row=rows[index];
        svg.append(node("text",{x:sx(index),y:height-10,"text-anchor":i===0 ? "start" : i===tickCount-1 ? "end" : "middle",class:"chart-tick"},`${months[row.month-1]} ${row.year}`));
      }
      normalized.forEach((series,i)=>{
        const path=node("path",{d:series.map((value,index)=>`${index ? "L" : "M"}${sx(index).toFixed(3)} ${sy(value).toFixed(3)}`).join(" "),fill:"none",stroke:colors[i%colors.length],"stroke-width":2.2,"stroke-linecap":"round","stroke-linejoin":"round",class:"chart-series"});
        svg.append(path);
        if(animate && !reduced.matches){const length=path.getTotalLength();path.style.strokeDasharray=String(length);animations.push(path.animate([{strokeDashoffset:String(length)},{strokeDashoffset:"0"}],{duration:900,delay:140,fill:"backwards",easing:"cubic-bezier(.25,.1,.25,1)"}));}
      });
      const guide=node("line",{y1:upper,y2:lower,class:"chart-guide",visibility:"hidden"});svg.append(guide);
      const markers=normalized.map((_,i)=>{const marker=node("circle",{r:4,fill:colors[i%colors.length],stroke:"#fff","stroke-width":2,visibility:"hidden"});svg.append(marker);return marker;});
      geometry={left,right,sx,sy,guide,markers};lastWidth=width;
      if(active>=0)inspect(active);
    }
    function pointer(event,announce=false){
      const rect=svg.getBoundingClientRect(),width=svg.viewBox.baseVal.width;
      const x=(event.clientX-rect.left)*width/rect.width;
      if(!geometry || x<geometry.left || x>geometry.right)return;
      inspect(Math.round((x-geometry.left)/(geometry.right-geometry.left)*(rows.length-1)),announce);
    }
    const move=event=>pointer(event),tap=event=>pointer(event,true);
    const key=event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();finishAnimations();
      inspect(event.key==="Home" ? 0 : event.key==="End" ? rows.length-1 : active<0 ? 0 : active+(event.key==="ArrowRight" ? 1 : -1),true);
    };
    const motion=()=>{if(reduced.matches)finishAnimations();};
    svg.addEventListener("pointermove",move);svg.addEventListener("click",tap);svg.addEventListener("keydown",key);reduced.addEventListener("change",motion);
    paint(true);
    const observer=new ResizeObserver(()=>{
      if(Math.abs(svg.parentElement.clientWidth-lastWidth)<1)return;
      cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>paint(false));
    });observer.observe(svg.parentElement);
    return ()=>{disposed=true;observer.disconnect();cancelAnimationFrame(frame);cancelAnimations();svg.removeEventListener("pointermove",move);svg.removeEventListener("click",tap);svg.removeEventListener("keydown",key);reduced.removeEventListener("change",motion);svg.replaceChildren();};
  }
  return {draw};
})();
