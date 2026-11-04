/* Confirm the day's planned food once; opening this review never consumes stock. */
(function(root){'use strict';
 const DAYS=new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
 let sequence=0;
 function mount({container,day,win=root,onConfirmed=()=>{}}={}){
  const doc=container?.ownerDocument||win?.document,home=win?.BBHome;
  if(!container||!doc?.createElement||!DAYS.has(day))return null;
  let disposed=false,dialog=null,busy=false,preview=null,actorId=null,revision=0,returnFocus=null,dialogId=0;
  const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;};
  const trigger=make('button','small-btn bb-day-done-trigger','Day done');trigger.type='button';trigger.dataset.bbDayDone=day;trigger.setAttribute('aria-label','Confirm all planned food for '+day);container.append(trigger);
  const actor=()=>typeof home?.actor==='function'?home.actor():'guest';
  const current=()=>!disposed&&!!dialog&&dialog.isConnected!==false&&actor()===actorId;
  function close(force=false){
   if(busy&&!force)return;
   revision++;const previous=dialog;dialog=null;preview=null;
   try{previous?.close?.();}catch{}previous?.remove();
   if(!disposed&&returnFocus?.isConnected)returnFocus.focus?.({preventScroll:true});
  }
  function mealLabel(item){
   const kind=({dinner:'Dinner',dessert:'Bake / dessert',lunch:'Lunch',leftover:'Leftover meal',note:'Custom meal'})[item.kind]||'Meal';
   const servings=item.servingsLabel||(Number.isFinite(item.servings)?item.servings+' servings':'');
   return [kind,servings,item.already?'Already confirmed':''].filter(Boolean).join(' · ');
  }
  function appendRows(content,value){
   if(value.items?.length){
    const list=make('ul','bb-day-done-meals');
    for(const item of value.items){const row=make('li',item.already?'is-complete':'');row.append(make('strong','',item.name||'Planned food'),make('span','',mealLabel(item)));list.append(row);}
    content.append(list);
   }
   if(value.rows?.length){
    const details=make('details','bb-day-done-amounts');details.append(make('summary','','Review ingredient amounts'));
    for(const row of value.rows){
     const line=make('div','bb-day-done-amount');line.append(make('strong','',row.name||'Ingredient'));
     const unit=row.unit?' '+row.unit:'';
     line.append(make('span','',Number.isFinite(row.deduct)?'Use up to '+row.deduct+unit:'Amount needs review'));
     if(row.issueLabel)line.append(make('small','bb-day-done-issue',row.issueLabel));
     for(const assumption of row.assumptions||[])line.append(make('small','',assumption));details.append(line);
    }
    if(value.rows.some(row=>row.estimated)){details.open=true;content.append(make('p','bb-day-done-issue','Some conversions use estimated ingredient weights. Check these amounts before confirming.'));}
    content.append(details);
   }
   if(value.issues?.length){
    const issues=make('div','bb-day-done-issues');
    issues.append(make('p','','Some planned amounts need a check. Review the messages below before confirming.'));
    for(const issue of value.issues){const message=typeof issue==='string'?issue:issue.message||issue.issueLabel;if(message)issues.append(make('p','bb-day-done-issue',message));}
    content.append(issues);
   }
  }
  async function load(){
   if(!dialog||disposed)return;
   const active=dialog,version=++revision;preview=null;
   active.replaceChildren();
   const heading=make('h2','','Confirm '+day+' is done');heading.id='bbDayDoneTitle'+dialogId;heading.tabIndex=-1;active.setAttribute('aria-labelledby',heading.id);
   const explanation=make('p','','Confirm the planned food you used today. Pantry amounts update for meals still to confirm; already confirmed meals keep their recorded amounts.');
   const content=make('div','bb-day-done-content'),status=make('p','bb-day-done-status','Checking your plan and pantry…');status.setAttribute('role','status');
   const actions=make('div','bb-day-done-actions'),cancel=make('button','btn','Cancel');cancel.type='button';cancel.dataset.bbDayAction='close';cancel.onclick=()=>close();actions.append(cancel);active.append(heading,explanation,content,status,actions);
   heading.focus?.({preventScroll:true});
   let value;
   try{value=await home?.previewDay?.({day,actorId});}
   catch{value={ok:false,message:'Your day could not be checked. Close this review and try again.'};}
   if(disposed||dialog!==active||version!==revision)return;
   if(!current()){status.textContent='Your account changed. Close this review and reopen Day done.';return;}
   value=value||{ok:false,message:'Day confirmation is still loading. Try again shortly.'};preview=value;content.replaceChildren();appendRows(content,value);
   status.textContent=value.message||(value.already?'All planned food for this day is already confirmed.':value.ok?'Confirming updates At home using these planned amounts.':'Review your pantry or plan before confirming this day.');
   if(value.already){trigger.textContent='Day done ✓';cancel.textContent='Back to Plan';return;}
   if(!value.ok){
    if(typeof win.BBHomeHost?.reviewDay==='function'){const review=make('button','btn','Review plan & pantry');review.type='button';review.dataset.bbDayAction='review';review.onclick=()=>{close();win.BBHomeHost.reviewDay(day);};actions.append(review);}
    return;
   }
   const confirm=make('button','btn primary','Confirm day done');confirm.type='button';confirm.dataset.bbDayAction='confirm';actions.append(confirm);
   confirm.onclick=async()=>{
    if(busy||disposed||dialog!==active)return;
    if(!current()){confirm.disabled=true;status.textContent='Your account changed. Close this review and reopen Day done.';return;}
    busy=true;trigger.disabled=true;confirm.disabled=cancel.disabled=true;status.textContent='Updating At home…';
    let result;
    try{result=await home.finishDay({day,actorId,expected:preview.fingerprint});}
    catch{result={ok:false,needsReview:true,message:'The day could not be confirmed. Review the latest plan and pantry before retrying.'};}
    busy=false;trigger.disabled=false;
    if(disposed||dialog!==active)return;
    if(!current()){close(true);return;}
    cancel.disabled=false;
    status.textContent=result?.message||'Review At home to check the remaining amounts.';
    if(result?.ok){
     trigger.textContent='Day done ✓';confirm.remove();cancel.textContent='Back to Plan';
     if(!result.already)try{onConfirmed(result);}catch{}
    }else{
     confirm.textContent='Review latest amounts';confirm.disabled=false;confirm.dataset.bbDayAction='refresh';confirm.onclick=()=>{if(!busy&&!disposed)void load();};
    }
   };
  }
  trigger.onclick=event=>{
   event?.preventDefault?.();event?.stopPropagation?.();
   if(disposed||busy||dialog)return;
   actorId=actor();returnFocus=doc.activeElement||trigger;dialogId=++sequence;
   dialog=make('dialog','bb-day-done-dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Confirm '+day+' planned food');
   const active=dialog;
   active.addEventListener('cancel',event=>{if(busy)event.preventDefault();else close();});
   active.addEventListener('close',()=>{if(dialog===active)close(true);});
   (doc.body||container).append(active);try{active.showModal?.();}catch{}void load();
  };
  return Object.freeze({dispose(){disposed=true;close(true);trigger.remove();}});
 }
 if(root)root.BBDayDone=Object.freeze({mount});
})(typeof window==='undefined'?null:window);
