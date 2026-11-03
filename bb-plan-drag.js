/* Move dinner cards through the planner host. Gestures never mutate plans. */
(()=>{'use strict';
 if(window.BBPlanDrag)return;
 const doc=document,DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const HOLD_MS=450,MOVE_TOLERANCE=8;
 let pending=null,active=null,dialogState=null,statusNode=null,suppressed=null;
 let viewportWidth=innerWidth;
 const host=()=>window.BBPlanMoveHost;
 const connected=element=>!!element?.isConnected;
 const closest=(element,selector)=>element?.closest?.(selector)||null;
 const planHandle=element=>{
  if(closest(element,'button,input,select,textarea,a,label,[role="button"],[contenteditable="true"]'))return null;
  const handle=closest(element,'[data-bb-plan-handle],summary.bbnext-day-toggle');
  return handle&&closest(handle,'#app.bbnext-plan')?handle:null;
 };
 const handleDay=handle=>handle?.dataset.bbPlanHandle||closest(handle,'details.bbnext-day[data-bbnext-day]')?.dataset.bbnextDay;
 function status(message){
  if(!doc.body)return;
  if(!connected(statusNode)){
   statusNode=doc.getElementById('bbPlanDragStatus');
   if(!statusNode){statusNode=doc.createElement('div');statusNode.id='bbPlanDragStatus';statusNode.className='bb-plan-move-status';statusNode.setAttribute('role','status');statusNode.setAttribute('aria-live','polite');statusNode.setAttribute('aria-atomic','true');doc.body.append(statusNode);}
  }
  if(statusNode.textContent!==message)statusNode.textContent=message;
 }
 function notify(message){
  const text=typeof message==='string'&&message?message:'Your dinner could not be moved. Please try again.';
  status(text);try{host()?.notify?.(text);}catch{}
 }
 function snapshot(){
  try{
   const value=host()?.snapshot?.();
   if(!value||!Array.isArray(value.days)||value.days.length!==7)return null;
   const days=value.days.map(row=>row?.day);
   if(new Set(days).size!==7||DAYS.some(day=>!days.includes(day)))return null;
   return value;
  }catch{return null;}
 }
 function suppressClick(x,y){suppressed={until:Date.now()+900,x,y};}
 function clearPending(){if(pending){clearTimeout(pending.timer);pending=null;}}
 function clearTarget(drag){
  drag.targetRow?.classList.remove('bb-plan-drop-target','bb-plan-drop-blocked');
  drag.targetRow=null;drag.target=null;
 }
 function cleanDrag({suppress=false}={}){
  clearPending();const drag=active;if(!drag)return;
  active=null;cancelAnimationFrame(drag.frame);clearTarget(drag);
  drag.row.classList.remove('bb-plan-drag-source');drag.handle.classList.remove('bb-plan-holding');
  drag.ghost.remove();doc.body?.classList.remove('bb-plan-is-dragging');
  doc.documentElement.style.scrollBehavior=drag.scrollBehavior;
  if(drag.pointerType!=='touch')try{if(drag.handle.hasPointerCapture?.(drag.pointerId))drag.handle.releasePointerCapture(drag.pointerId);}catch{}
  if(suppress)suppressClick(drag.x,drag.y);
 }
 function cancelDrag(message='Move cancelled.'){
  const hadDrag=!!active;cleanDrag({suppress:hadDrag});if(hadDrag)status(message);
 }
 function blockingUI(element){return closest(element,'nav,.tabs,dialog,[role="dialog"],[aria-modal="true"]');}
 function placeGhost(drag){
  const width=drag.ghost.offsetWidth,height=drag.ghost.offsetHeight;
  const left=Math.max(8,Math.min(innerWidth-width-8,drag.x-width/2));
  const top=Math.max(8,Math.min(innerHeight-height-8,drag.y-height-18));
  drag.ghost.style.transform='translate3d('+left+'px,'+top+'px,0)';
 }
 function updateTarget(drag){
  const hit=doc.elementFromPoint(drag.x,drag.y);
  const row=!blockingUI(hit)&&closest(hit,'details.bbnext-day[data-bbnext-day]');
  const next=row&&closest(row,'#app.bbnext-plan')&&drag.snapshot.days.find(day=>day.day===row.dataset.bbnextDay);
  const target=next&&next.day!==drag.from?next:null;
  const key=target?target.day+'|'+!!target.blocked:'';
  const targetRow=target?row:null;
  if(targetRow!==drag.targetRow||key!==drag.targetKey){
   clearTarget(drag);drag.targetKey=key;
   if(target){
    drag.target=target;drag.targetRow=row;
    row.classList.add(target.blocked?'bb-plan-drop-blocked':'bb-plan-drop-target');
    drag.hint.textContent=target.blocked?(target.reason||'This day is unavailable'):(target.recipeId?'Release to swap with ':'Release to move to ')+target.day;
    status(target.blocked?target.day+': '+(target.reason||'This day is unavailable'):(target.recipeId?'Swap with ':'Move to ')+target.day+'. Release to confirm.');
   }else drag.hint.textContent='Move over another day';
  }
 }
 function visibleModal(){
  return [...doc.querySelectorAll('dialog[open],[aria-modal="true"]')].some(element=>{
   const r=element.getBoundingClientRect(),style=getComputedStyle(element);
   return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none';
  });
 }
 function scrollFrame(time){
  const drag=active;if(!drag)return;
  if(!connected(drag.handle)||!connected(drag.row)||!closest(drag.row,'#app.bbnext-plan')||visibleModal()){
   cancelDrag();return;
  }
  const delta=drag.lastFrame?Math.min(32,time-drag.lastFrame)/16.67:1;drag.lastFrame=time;
  let bottom=innerHeight;
  for(const dock of doc.querySelectorAll('nav.tabs,.shell>.tabs,nav.bb-r6-cook-nav')){
   const r=dock.getBoundingClientRect(),style=getComputedStyle(dock);
   if(r.width&&r.height&&style.position==='fixed'&&r.top>0&&r.top<bottom)bottom=r.top;
  }
  const edge=64;
  const speed=drag.y<edge?-14*Math.min(1,(edge-drag.y)/edge):drag.y>bottom-edge?14*Math.min(1,(drag.y-bottom+edge)/edge):0;
  if(speed)window.scrollBy(0,speed*delta);
  placeGhost(drag);updateTarget(drag);
  if(active===drag)drag.frame=requestAnimationFrame(scrollFrame);
 }
 function startHold(record){
  if(pending!==record)return;pending=null;
  if(!connected(record.handle)||!closest(record.handle,'#app.bbnext-plan'))return;
  const fresh=snapshot(),source=fresh?.days.find(day=>day.day===record.from);
  if(!fresh||fresh.fingerprint!==record.snapshot.fingerprint||source?.recipeId!==record.recipeId){
   suppressClick(record.x,record.y);notify('Your plan changed. Please hold the dinner again.');return;
  }
  if(source.blocked){suppressClick(record.x,record.y);notify(source.reason||'This dinner cannot be moved right now.');return;}
  const row=closest(record.handle,'details.bbnext-day[data-bbnext-day]');if(!row)return;
  const ghost=doc.createElement('div');ghost.className='bb-plan-move-ghost';ghost.setAttribute('aria-hidden','true');
  const title=doc.createElement('strong');title.textContent=source.name||'Dinner';
  const hint=doc.createElement('small');hint.textContent='Move over another day';ghost.append(title,hint);doc.body.append(ghost);
  active={...record,snapshot:fresh,row,ghost,hint,target:null,targetRow:null,targetKey:'',lastFrame:0,frame:0,scrollBehavior:doc.documentElement.style.scrollBehavior};
  row.classList.add('bb-plan-drag-source');record.handle.classList.add('bb-plan-holding');doc.body.classList.add('bb-plan-is-dragging');
  doc.documentElement.style.scrollBehavior='auto';
  if(record.pointerType!=='touch')try{record.handle.setPointerCapture(record.pointerId);}catch{}
  status('Picked up '+(source.name||'dinner')+' from '+record.from+'. Move over another day and release.');
  placeGhost(active);updateTarget(active);active.frame=requestAnimationFrame(scrollFrame);
 }
 function onDown(event){
  suppressed=null;
  // Touch Events retain control of a held gesture on iPhone while allowing
  // ordinary scrolling before the hold. Pointer cancellation during native
  // panning must not turn the whole meal header into a permanent no-scroll area.
  if(event.pointerType==='touch'&&'ontouchstart' in window)return;
  if(active&&active.pointerId!==event.pointerId){cancelDrag();return;}
  if(pending&&pending.pointerId!==event.pointerId){clearPending();return;}
  if(event.button!==0||event.isPrimary===false||dialogState)return;
  const handle=planHandle(event.target);if(!handle)return;
  clearPending();const current=snapshot(),source=current?.days.find(day=>day.day===handleDay(handle));
  if(!source?.recipeId)return;
  const record={handle,from:source.day,recipeId:source.recipeId,snapshot:current,pointerId:event.pointerId,pointerType:event.pointerType||'mouse',x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,timer:0};
  record.timer=setTimeout(()=>startHold(record),HOLD_MS);pending=record;
 }
 function onMove(event){
  if(pending?.pointerId===event.pointerId){
   pending.x=event.clientX;pending.y=event.clientY;
   if(Math.hypot(event.clientX-pending.startX,event.clientY-pending.startY)>MOVE_TOLERANCE)clearPending();
  }
  const drag=active;if(!drag||drag.pointerId!==event.pointerId)return;
  if(event.cancelable)event.preventDefault();drag.x=event.clientX;drag.y=event.clientY;
  placeGhost(drag);updateTarget(drag);
 }
 function focusDay(day,fallback){
  const target=[...doc.querySelectorAll('details.bbnext-day[data-bbnext-day]')].find(row=>row.dataset.bbnextDay===day)?.querySelector('.bbnext-day-toggle');
  const next=connected(target)?target:connected(fallback)?fallback:null;
  try{next?.focus?.({preventScroll:true});}catch{next?.focus?.();}
 }
 async function applyMove(request,fallback){
  let result;
  try{result=await host()?.move?.(request);}catch{result={ok:false,message:'Your dinner could not be moved. Your previous plan is kept.'};}
  notify(result?.message||(result?.ok?'Dinner moved.':'Your dinner could not be moved. Please try again.'));
  focusDay(result?.ok?request.to:request.from,fallback);
 }
 function onUp(event){
  if(pending?.pointerId===event.pointerId){clearPending();return;}
  const drag=active;if(!drag||drag.pointerId!==event.pointerId)return;
  if(event.cancelable)event.preventDefault();drag.x=event.clientX;drag.y=event.clientY;updateTarget(drag);
  const target=drag.target,request={from:drag.from,to:target?.day,expected:drag.snapshot.fingerprint,recipeId:drag.recipeId},fallback=drag.handle;
  cleanDrag({suppress:true});
  if(!target){status('Move cancelled.');return;}
  if(target.blocked){notify(target.reason||'This day is unavailable. Your plan is unchanged.');return;}
  void applyMove(request,fallback);
 }
 function onTouchStart(event){
  suppressed=null;
  if(event.touches.length!==1){cancelDrag();clearPending();return;}
  if(active||dialogState)return;
  const handle=planHandle(event.target);if(!handle)return;
  clearPending();const current=snapshot(),source=current?.days.find(day=>day.day===handleDay(handle));
  if(!source?.recipeId)return;
  const touch=event.changedTouches[0];if(!touch)return;
  const record={handle,from:source.day,recipeId:source.recipeId,snapshot:current,pointerId:'touch-'+touch.identifier,pointerType:'touch',touchId:touch.identifier,x:touch.clientX,y:touch.clientY,startX:touch.clientX,startY:touch.clientY,timer:0};
  record.timer=setTimeout(()=>startHold(record),HOLD_MS);pending=record;
 }
 function onTouchMove(event){
  const record=active?.pointerType==='touch'?active:pending?.pointerType==='touch'?pending:null;
  if(!record)return;
  if(event.touches.length!==1){cancelDrag();clearPending();return;}
  const touch=[...event.touches].find(value=>value.identifier===record.touchId);if(!touch)return;
  if(active===record&&!event.cancelable){cancelDrag();return;}
  onMove({pointerId:record.pointerId,clientX:touch.clientX,clientY:touch.clientY,cancelable:event.cancelable,preventDefault:()=>event.preventDefault()});
 }
 function onTouchEnd(event){
  const record=active?.pointerType==='touch'?active:pending?.pointerType==='touch'?pending:null;
  if(!record)return;
  const touch=[...event.changedTouches].find(value=>value.identifier===record.touchId);if(!touch)return;
  onUp({pointerId:record.pointerId,clientX:touch.clientX,clientY:touch.clientY,cancelable:event.cancelable,preventDefault:()=>event.preventDefault()});
 }
 function closeDialog({restore=true}={}){
  const current=dialogState;if(!current)return;dialogState=null;
  doc.removeEventListener('keydown',current.trap,true);
  try{if(current.node.open&&typeof current.node.close==='function')current.node.close();}catch{}
  current.node.remove();
  if(restore&&connected(current.source)){try{current.source.focus({preventScroll:true});}catch{current.source.focus();}}
 }
 function openDialog(button){
  cancelDrag();closeDialog();const current=snapshot(),from=button.dataset.bbPlanMoveDay,source=current?.days.find(day=>day.day===from);
  if(!source?.recipeId){notify('This dinner is no longer planned.');return;}
  if(source.blocked){notify(source.reason||'This dinner cannot be moved right now.');return;}
  const dialog=doc.createElement('dialog');dialog.className='bb-plan-move-dialog';dialog.setAttribute('aria-labelledby','bbPlanMoveTitle');dialog.setAttribute('aria-modal','true');
  const title=doc.createElement('h2');title.id='bbPlanMoveTitle';title.textContent='Move '+from+' dinner';
  const name=doc.createElement('p');name.className='bb-plan-move-name';name.textContent=source.name||'Dinner';
  const help=doc.createElement('p');help.className='bb-plan-move-help';help.textContent='Choose another day. Occupied days will swap dinners.';
  const choices=doc.createElement('div');choices.className='bb-plan-move-choices';
  for(const day of current.days){
   if(day.day===from)continue;
   const item=doc.createElement('div');item.className='bb-plan-move-choice';
   const choose=doc.createElement('button');choose.type='button';choose.disabled=!!day.blocked;
   const action=doc.createElement('strong');action.textContent=(day.recipeId?'Swap with ':'Move to ')+day.day;
   const label=doc.createElement('span');label.textContent=day.blocked?(day.reason||'Unavailable'):(day.name||(day.recipeId?'Planned dinner':'No dinner planned'));
   choose.append(action,label);item.append(choose);choices.append(item);
   choose.addEventListener('click',()=>{
    closeDialog({restore:false});
    void applyMove({from,to:day.day,expected:current.fingerprint,recipeId:source.recipeId},button);
   });
  }
  const cancel=doc.createElement('button');cancel.type='button';cancel.className='bb-plan-move-cancel';cancel.textContent='Cancel';cancel.addEventListener('click',()=>closeDialog());
  dialog.append(title,name,help,choices,cancel);doc.body.append(dialog);
  const trap=event=>{
   if(dialogState?.node!==dialog)return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDialog();return;}
   if(event.key!=='Tab')return;
   const buttons=[...dialog.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);
   if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
  };
  dialogState={node:dialog,source:button,trap};doc.addEventListener('keydown',trap,true);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  dialog.addEventListener('close',()=>{if(dialogState?.node===dialog)closeDialog();});
  dialog.addEventListener('click',event=>{
   if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();
   if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();
  });
  try{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}catch{dialog.setAttribute('open','');}
  (dialog.querySelector('button:not(:disabled)')||cancel).focus();
 }
 doc.addEventListener('pointerdown',onDown);
 doc.addEventListener('pointermove',onMove,{passive:false});
 doc.addEventListener('pointerup',onUp,{passive:false});
 doc.addEventListener('touchstart',onTouchStart,{passive:true});
 doc.addEventListener('touchmove',onTouchMove,{passive:false});
 doc.addEventListener('touchend',onTouchEnd,{passive:false});
 doc.addEventListener('touchcancel',()=>{cancelDrag();clearPending();});
 doc.addEventListener('pointercancel',event=>{if(active?.pointerId===event.pointerId||pending?.pointerId===event.pointerId)cancelDrag();});
 doc.addEventListener('lostpointercapture',event=>{if(active?.pointerId===event.pointerId)cancelDrag();});
 doc.addEventListener('contextmenu',event=>{if(planHandle(event.target))event.preventDefault();});
 doc.addEventListener('selectstart',event=>{if(planHandle(event.target))event.preventDefault();});
 doc.addEventListener('dragstart',event=>{if(planHandle(event.target))event.preventDefault();});
 doc.addEventListener('click',event=>{
  if(suppressed){
   const cancel=Date.now()<suppressed.until&&event.detail!==0&&Math.hypot(event.clientX-suppressed.x,event.clientY-suppressed.y)<30;
   suppressed=null;if(cancel){event.preventDefault();event.stopImmediatePropagation();return;}
  }
  const button=closest(event.target,'[data-bb-plan-move-day]');
  if(button&&closest(button,'#app.bbnext-plan')){event.preventDefault();event.stopPropagation();openDialog(button);}
 },true);
 doc.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&(active||pending)){const wasActive=!!active;cancelDrag();if(wasActive){event.preventDefault();event.stopPropagation();}}
 },true);
 doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState!=='visible')cancelDrag();});
 window.addEventListener('blur',()=>cancelDrag());
 // Safari changes viewport height when its address bar folds during scrolling.
 // Keep the held dinner active; a width change still cancels for orientation.
 window.addEventListener('resize',()=>{const width=innerWidth;if(width!==viewportWidth)cancelDrag();viewportWidth=width;});
 window.BBPlanDrag=Object.freeze({cancel(){cancelDrag();closeDialog();}});
})();
