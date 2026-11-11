/* Auto-fill preference only. The existing planner owns proposals and commits. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&!root.BBPantryFirstControls)root.BBPantryFirstControls=api.install(root);
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const installations=new WeakMap();
 const choices=[['pantry-first','Prioritize what’s at home'],['fresh','Fresh weekly plan']];
 function install(win){
  if(installations.has(win))return installations.get(win);
  const doc=win.document;let selected='pantry-first',started=false,queued=false,nextBusy=false;
  const mode=()=>selected,capture=()=>selected;
  function paint(group,working){
   const busy=nextBusy||working.disabled||working.getAttribute('aria-busy')==='true';
   for(const button of group.querySelectorAll('[data-bb-pantry-first-mode]')){
    const pressed=String(button.getAttribute('data-bb-pantry-first-mode')===selected);
    if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);
    if(button.disabled!==busy)button.disabled=busy;
   }
   const next=group.parentNode.querySelector('[data-bb-start-next-week]');
   const unavailable=busy||typeof win.BBPantryFirstHost?.startNextWeek!=='function';
   if(next&&next.disabled!==unavailable)next.disabled=unavailable;
  }
  function mount(){
   const app=doc.querySelector('#app.bbnext-plan'),actions=app?.querySelector('.bbnext-plan-actions');
   const working=actions?.querySelector('#bb172FillSixDinners');
   if(!working)return false;
   let group=actions.querySelector('.bb-pantry-first-controls');
   if(!group){
    group=doc.createElement('div');group.className='bb-pantry-first-controls';
    group.setAttribute('role','group');group.setAttribute('aria-label','Auto-fill preference');
    for(const [value,label]of choices){
     const button=doc.createElement('button');button.type='button';button.className='bb-pantry-first-choice';
     button.setAttribute('data-bb-pantry-first-mode',value);button.textContent=label;group.append(button);
    }
    // Keep this inside the live actions node. The existing Plan decorator
    // owns the surrounding card order and can move this node unchanged.
    actions.prepend(group);
   }
   if(!actions.querySelector('[data-bb-start-next-week]')){
    const next=doc.createElement('button');next.type='button';next.className='bb-pantry-first-next-week';
    next.setAttribute('data-bb-start-next-week','');next.textContent='Start next week';
    const status=doc.createElement('p');status.className='bb-pantry-first-status';status.hidden=true;
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');actions.append(next,status);
   }
   paint(group,working);return true;
  }
  async function startNext(event,button){
   const actions=button.parentNode,app=actions?.closest?.('#app.bbnext-plan'),working=actions?.querySelector('#bb172FillSixDinners');
   if(!app||actions!==app.querySelector('.bbnext-plan-actions'))return;
   event.preventDefault();event.stopPropagation();
   if(nextBusy||button.disabled||!working||working.disabled||working.getAttribute('aria-busy')==='true'||typeof win.BBPantryFirstHost?.startNextWeek!=='function')return;
   const chosen=capture();nextBusy=true;paint(actions.querySelector('.bb-pantry-first-controls'),working);
   let result;
   try{result=await win.BBPantryFirstHost.startNextWeek({mode:chosen});}
   catch{result={ok:false,message:'Could not start next week. Your current week has been kept.'};}
   finally{nextBusy=false;mount();}
   const status=doc.querySelector('#app.bbnext-plan')?.querySelector('.bb-pantry-first-status');
   if(status&&result?.ok===false&&result.message){status.textContent=result.message;status.hidden=false;}
  }
  function choose(event){
   const nextWeek=event.target?.closest?.('[data-bb-start-next-week]');
   if(nextWeek){void startNext(event,nextWeek);return;}
   const button=event.target?.closest?.('[data-bb-pantry-first-mode]');
   const group=button?.closest('.bb-pantry-first-controls'),app=group?.closest('#app.bbnext-plan');
   if(!app||group.parentNode!==app.querySelector('.bbnext-plan-actions'))return;
   const next=button.getAttribute('data-bb-pantry-first-mode');
   if(!choices.some(([value])=>value===next))return;
   event.preventDefault();event.stopPropagation();
   const working=group.parentNode.querySelector('#bb172FillSixDinners');
   if(nextBusy||!working||working.disabled||working.getAttribute('aria-busy')==='true')return;
   selected=next;paint(group,working);
  }
  function schedule(){
   if(queued)return;queued=true;
   const update=()=>{queued=false;mount();};
   if(typeof win.requestAnimationFrame==='function')win.requestAnimationFrame(update);
   else win.setTimeout(update,0);
  }
  function start(){
   if(started)return;started=true;
   doc.addEventListener('click',choose);
   if(typeof win.MutationObserver==='function'){
    const target=doc.querySelector('#app')||doc.body;
    if(target)new win.MutationObserver(schedule).observe(target,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','aria-busy']});
   }
   mount();
  }
  const api=Object.freeze({mode,capture,mount});installations.set(win,api);
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
  return api;
 }
 return Object.freeze({install});
});
