/* Plan presentation only. Read the existing current-pantry gate and hosts;
 * never calculate amounts, fetch, save, or replace any existing controls. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root?.document)api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const CONTROLS='button,input,select,textarea,a[href],summary,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="switch"],[tabindex]';
 function install(win){
  if(win.BBPlanHomeSnapshot)return win.BBPlanHomeSnapshot;
  const doc=win.document;let node=null,signature=null,queued=false,observer=null;
  const make=(tag,cls,copy)=>{const element=doc.createElement(tag);if(cls)element.className=cls;if(copy!==undefined)element.textContent=copy;return element;};
  const mark=(element,name,value)=>{if(element&&element.getAttribute(name)!==value)element.setAttribute(name,value);};
  const informational=element=>!!element&&!element.matches(CONTROLS)&&!element.querySelector(CONTROLS);
  function snapshot(){
   const unavailable={ready:false,foods:[],essentials:[]};
   try{
    if(win.BBAccountDeletion?.isDeleting?.()===true||win.BBReceiptHost?.getConsumptionStatus?.()?.ready!==true)return unavailable;
    const host=win.BBHomeHost;if(typeof host?.stock!=='function'||typeof host?.household!=='function')return unavailable;
    const stock=host.stock(),household=host.household();
    if(!stock||typeof stock!=='object'||Array.isArray(stock)||!Array.isArray(household))return unavailable;
    // physicalStock already owns validation and quantities. This projection
    // selects names for display; no balance, coverage or purchase math lives here.
    const foods=Object.entries(stock).filter(([,value])=>Number(value)>0).map(([key])=>key.includes('|')?key.slice(0,key.lastIndexOf('|')):key).filter(name=>name.trim());
    const essentials=household.filter(row=>row?.selected===true&&typeof row.name==='string'&&row.name.trim()).map(row=>row.name);
    return {ready:true,foods,essentials};
   }catch{return unavailable;}
  }
  function tidy(app){
   const extras=app.querySelector('#bb1756PlannerExtras');
   if(extras){const empty=informational(extras);mark(extras,'data-bbph-information',String(empty));}
   const advanced=app.querySelector('#bb1759MealsEditor'),original=advanced?.querySelector('.bb1759-original-meals');
   if(original){
    for(const heading of original.querySelectorAll(':scope>#bb1756Dinners')){
     for(const copy of heading.querySelectorAll('h3,p'))if(informational(copy))mark(copy,'data-bbph-information','true');
     if(informational(heading))mark(heading,'data-bbph-information','true');
    }
    for(const copy of original.querySelectorAll(':scope>.notice'))if(/^Tip:/i.test(copy.textContent.trim())&&informational(copy))mark(copy,'data-bbph-information','true');
    // This existing card's closure keeps its own button/upgrade handler. Moving
    // the same node retains that action inside the original planning disclosure.
   }
   for(const card of app.querySelectorAll('.bb173-leftover-card')){
    if(original){if(!original.contains(card)&&!card.contains(doc.activeElement))original.append(card);}
    else for(const copy of card.querySelectorAll('h3,p'))if(informational(copy))mark(copy,'data-bbph-information','true');
   }
   return {extras,advanced};
  }
  function paint(model){
   const next=JSON.stringify(model);if(signature===next)return;signature=next;node.replaceChildren();
   const heading=make('h3','','At home snapshot');heading.id='bbPlanHomeSnapshotTitle';
   node.append(heading);const grid=make('div','bbph-grid');node.append(grid);
   for(const [title,rows,kind]of[['Pantry',model.foods,'stocked item'],['Weekly essentials',model.essentials,'selected item']]){
    const section=make('section','bbph-section');section.append(make('h4','',title));grid.append(section);
    if(!model.ready){section.append(make('p','bbph-empty','Review your saved stock in At home.'));continue;}
    section.append(make('p','bbph-count',rows.length+' '+kind+(rows.length===1?'':'s')));
    if(!rows.length){section.append(make('p','bbph-empty','Nothing recorded yet.'));continue;}
    const list=make('ul','bbph-list');for(const name of rows.slice(0,5))list.append(make('li','',name));section.append(list);
    if(rows.length>5)section.append(make('p','bbph-more','Showing the first 5 items.'));
   }
  }
  function refresh(){
   queued=false;const app=doc.getElementById('app');
   if(doc.body.dataset.bbnextView!=='week'||!app?.classList.contains('bbnext-plan'))return;
   const {extras,advanced}=tidy(app);
   if(!node?.isConnected||!app.contains(node)){
    node=make('section','bb-plan-home-snapshot');node.id='bbPlanHomeSnapshot';node.setAttribute('aria-labelledby','bbPlanHomeSnapshotTitle');signature=null;
    if(extras)extras.before(node);else if(advanced)advanced.before(node);else app.append(node);
   }
   paint(snapshot());
  }
  function schedule(){if(queued)return;queued=true;if(win.queueMicrotask)win.queueMicrotask(refresh);else Promise.resolve().then(refresh);}
  function start(){
   const app=doc.getElementById('app');if(!app)return;refresh();
   observer=new win.MutationObserver(records=>{if(records.some(record=>!node||record.target!==node&&!node.contains(record.target)))schedule();});observer.observe(app,{childList:true,subtree:true});
   new win.MutationObserver(schedule).observe(doc.body,{attributes:true,attributeFilter:['data-bbnext-view']});
   for(const event of ['basketboss:session-changed','basketboss:household-changed','bb:pantry-editor','basketboss:account-deletion-started','basketboss:account-deletion-deleted','basketboss:account-deletion-cancelled'])win.addEventListener(event,schedule);
   win.addEventListener('storage',schedule);
  }
  const api=Object.freeze({refresh});win.BBPlanHomeSnapshot=api;
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
  return api;
 }
 return Object.freeze({install});
});
