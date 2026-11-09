/* Generated catalogue-700 pages only: keep keyboard focus on a replaced action.
 * Never change application state, pointer focus, scrolling or modal ownership.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root?.document)api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const DAYS=new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
 const MODALS='dialog[open],[role="dialog"][aria-modal="true"],.cook-overlay';
 const TTL=1000;
 function install(win){
  if(win.BBUIContinuity?.version===1)return win.BBUIContinuity;
  const doc=win.document;
  let armed=null,pending=null,observer=null,frame=null,timer=null,destroyed=false;
  const visible=node=>{
   if(!node?.isConnected||node.hidden||node.closest?.('[hidden],[inert],[aria-hidden="true"]'))return false;
   const style=win.getComputedStyle(node);
   return style.display!=='none'&&style.visibility!=='hidden'&&node.getClientRects().length>0;
  };
  const available=node=>node?.tagName==='BUTTON'&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&visible(node);
  const modals=()=>[...doc.querySelectorAll(MODALS)].filter(visible);
  function describe(button){
   if(!available(button))return null;
   const app=button.closest('#app.bbnext-plan'),group=button.closest('[data-bbfeed-day][data-bbfeed-pos]');
   if(app&&group&&app.contains(group)){
    const day=group.dataset.bbfeedDay,pos=group.dataset.bbfeedPos,delta=button.dataset.bbfeedDelta;
    if(DAYS.has(day)&&['summary','expanded'].includes(pos)&&['-1','1'].includes(delta))return {kind:'planner',scope:app,day,pos,delta};
   }
   const overlay=button.closest('#modalRoot .cook-overlay'),panel=button.closest('.cook-panel');
   if(overlay&&panel&&overlay.contains(panel)&&['bbStart','bbNext'].includes(button.id))return {kind:'cook',scope:overlay,panel,id:button.id};
   return null;
  }
  function candidates(action){
   if(!action.scope.isConnected)return [];
   if(action.kind==='planner'){
    if(!action.scope.matches('#app.bbnext-plan')||doc.body.dataset.bbnextView!=='week')return [];
    return [...action.scope.querySelectorAll('[data-bbfeed-day][data-bbfeed-pos]')]
     .filter(group=>group.dataset.bbfeedDay===action.day&&group.dataset.bbfeedPos===action.pos)
     .flatMap(group=>[...group.querySelectorAll('button[data-bbfeed-delta]')].filter(button=>button.dataset.bbfeedDelta===action.delta));
   }
   if(!action.panel.isConnected||!action.scope.contains(action.panel)||action.panel.dataset.phase!=='cook')return [];
   return [...action.panel.querySelectorAll('#bbNext')];
  }
  function matches(action,node){return candidates(action).includes(node);}
  function rememberControl(record,node){
   record.control=node;record.removed=false;record.lineage=[];
   for(let parent=node;parent;parent=parent.parentElement){record.lineage.push(parent);if(parent===record.action.scope)break;}
  }
  function cancel(){
   armed=null;pending=null;observer?.disconnect();observer=null;
   if(frame!==null)win.cancelAnimationFrame(frame);frame=null;
   if(timer!==null)win.clearTimeout(timer);timer=null;
  }
  function sameContext(record){
   if(doc.visibilityState==='hidden'||record.view!==doc.body.dataset.bbnextView||!record.action.scope.isConnected)return false;
   const current=modals();
   return current.length===record.modals.length&&current.every(node=>record.modals.includes(node));
  }
  function restore(){
   frame=null;const record=pending;
   if(!record||destroyed)return;
   if(!sameContext(record)){cancel();return;}
   const active=doc.activeElement;
   // An intact control, newly focused input or an explicitly focused heading
   // already has an owner. Only repair focus lost with a detached action.
   if(record.control.isConnected&&!record.removed)return;
   if(active!==doc.body&&active?.isConnected!==false){cancel();return;}
   const found=candidates(record.action);
   if(found.length!==1||!available(found[0])){cancel();return;}
   rememberControl(record,found[0]);
   try{found[0].focus({preventScroll:true});}catch{cancel();}
  }
  function schedule(){if(pending&&frame===null)frame=win.requestAnimationFrame(restore);}
  function keydown(event){
   if(event.isTrusted===false)return;
   cancel();
   if(event.altKey||event.ctrlKey||event.metaKey||!['Enter',' '].includes(event.key))return;
   const control=event.target?.closest?.('button');
   if(doc.activeElement!==control)return;
   const action=describe(control);if(!action)return;
   const current=modals();
   if(action.kind==='planner'&&current.length||action.kind==='cook'&&(current.length!==1||current[0]!==action.scope))return;
   armed={action,view:doc.body.dataset.bbnextView,modals:current};rememberControl(armed,control);
  }
  function click(event){
   if(event.isTrusted===false)return;
   const activation=armed;
   if(!activation||event.detail!==0||event.target?.closest?.('button')!==activation.control){cancel();return;}
   armed=null;pending=activation;
   observer=new win.MutationObserver(records=>{
    // A decorator can move the focused node out and back in during one task.
    // isConnected alone misses that browser focus loss.
    if(pending)for(const change of records)for(const removed of change.removedNodes||[])
     if(pending.lineage.includes(removed)||removed.contains?.(pending.control))pending.removed=true;
    schedule();
   });
   observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-hidden','aria-modal','class','style']});
   timer=win.setTimeout(cancel,TTL);schedule();
  }
  function focusin(event){
   const record=pending||armed;if(!record)return;
   if(event.target===record.control)return;
   // The renderer may focus the matching replacement before a later repaint.
   if(pending&&matches(record.action,event.target)){rememberControl(record,event.target);return;}
   cancel();
  }
  const manual=event=>{if(event.isTrusted!==false)cancel();};
  const hidden=()=>{if(doc.visibilityState==='hidden')cancel();};
  doc.addEventListener('keydown',keydown,true);doc.addEventListener('click',click,true);doc.addEventListener('focusin',focusin,true);
  doc.addEventListener('pointerdown',manual,{capture:true,passive:true});doc.addEventListener('touchstart',manual,{capture:true,passive:true});
  win.addEventListener('wheel',manual,{capture:true,passive:true});win.addEventListener('touchmove',manual,{capture:true,passive:true});
  doc.addEventListener('visibilitychange',hidden);win.addEventListener('pagehide',cancel);
  const controller=Object.freeze({version:1,destroy(){if(destroyed)return;destroyed=true;cancel();doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('click',click,true);doc.removeEventListener('focusin',focusin,true);doc.removeEventListener('pointerdown',manual,true);doc.removeEventListener('touchstart',manual,true);win.removeEventListener('wheel',manual,true);win.removeEventListener('touchmove',manual,true);doc.removeEventListener('visibilitychange',hidden);win.removeEventListener('pagehide',cancel);}});
  win.BBUIContinuity=controller;return controller;
 }
 return Object.freeze({install});
});
