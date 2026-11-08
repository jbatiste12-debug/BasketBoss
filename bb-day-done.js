/* Confirm the day's planned food once; opening this review never consumes stock. */
(function(root){'use strict';
 const DAYS=new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
 const mounted=new Map();let sequence=0,statusNode=null;
 function mount({container,day,win=root,onConfirmed=()=>{},onUndone=()=>{},badge:providedBadge}={}){
  const doc=container?.ownerDocument||win?.document,home=win?.BBHome;
  if(!container||!doc?.createElement||!DAYS.has(day))return null;
  let disposed=false,dialog=null,busy=false,preview=null,actorId=null,revision=0,returnFocus=null,dialogId=0,identity=null,complete=false,mode='finish';
  const card=container.closest?.('.bbnext-day[data-bbnext-day]');
  const badge=providedBadge||card?.querySelector?.('.bbnext-day-badge,.bbnext-day-label');
  const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;};
  const trigger=make('button','small-btn bb-day-done-trigger','Day done');trigger.type='button';trigger.dataset.bbDayDone=day;trigger.setAttribute('aria-label','Confirm all planned food for '+day);container.append(trigger);
  const actor=()=>typeof home?.actor==='function'?home.actor():'guest';
  // The core fingerprint also pins pantry, all planned food and its portions.
  // Keep the UI tied to the same account and token while previews are awaited.
  const context=()=>{let session;try{session=win.localStorage?.getItem('basketboss_cloud_session_v1');}catch{return null;}return JSON.stringify([actor(),session,win.BBAccountDeletion?.isDeleting?.()===true]);};
  const sameContext=()=>identity!==null&&context()===identity&&actor()===actorId&&!win.BBAccountDeletion?.isDeleting?.();
  const current=()=>!disposed&&!!dialog&&dialog.isConnected!==false&&sameContext();
  function announce(message){
   if(disposed||!message)return;
   if(!statusNode||statusNode.ownerDocument!==doc||statusNode.isConnected===false){statusNode=make('div','bb-day-done-announcement');statusNode.setAttribute('role','status');statusNode.setAttribute('aria-live','polite');statusNode.setAttribute('aria-atomic','true');(doc.body||container).append(statusNode);}
   statusNode.textContent=message;
  }
  function paintComplete(value){
   complete=!!value;
   trigger.textContent=complete?'Undo day done':'Day done';trigger.dataset.bbDayDoneState=complete?'complete':'planned';trigger.setAttribute('aria-label',complete?'Review undoing Day done for '+day:'Review all planned food for '+day);
   if(!badge)return;
   badge.classList.toggle('bb-day-is-done',!!complete);badge.dataset.bbDayComplete=complete?'true':'false';
   badge.title=complete?day+' done. Hold to move dinner; double-tap to review undoing Day done.':'Hold to move '+day+' dinner. Double-tap to review Day done; nothing changes until you confirm.';
   badge.setAttribute('aria-label',day+(complete?', all planned food confirmed; double-tap to review undo':', hold to move dinner; double-tap to review Day done'));
   let check=badge.querySelector?.('.bb-day-done-check');
   if(complete&&!check){check=make('span','bb-day-done-check','✓');check.setAttribute('aria-hidden','true');badge.append(check);}
   if(!complete)check?.remove();
  }
  function refreshCompletion(){
   if(disposed)return;
   // Read the existing occurrence ledger through its public API. No separate
   // day flag can drift from individual Cook, lunch, dessert or leftover state.
   let value=false;
   try{const meals=win.BBHomeHost?.dayMeals?.(day);value=Array.isArray(meals)&&meals.length>0&&typeof home?.isCooked==='function'&&meals.every(meal=>typeof meal?.occurrence==='string'&&home.isCooked(meal.occurrence));}catch{}
   paintComplete(value);
  }
  function setBusy(value){busy=value;trigger.disabled=value;if(badge){badge.classList.toggle('bb-day-is-checking',value);badge.setAttribute('aria-busy',String(value));}}
  function close(force=false){
   if(busy&&!force)return;
   revision++;const previous=dialog;dialog=null;preview=null;
   try{previous?.close?.();}catch{}previous?.remove();
   if(!disposed&&returnFocus?.isConnected)returnFocus.focus?.({preventScroll:true});
  }
  function mealLabel(item){
   const kind=({dinner:'Dinner',breakfast:'Breakfast',dessert:'Bake / dessert',lunch:'Lunch',leftover:'Leftover meal',note:'Custom meal'})[item.kind]||'Meal';
   const servings=item.servingsLabel||(Number.isFinite(item.servings)?item.servings+' servings':'');
   return [kind,servings,item.already?'Already confirmed':''].filter(Boolean).join(' · ');
  }
  function appendRows(content,value,undo=false){
   if(value.items?.length){
    const list=make('ul','bb-day-done-meals');
    for(const item of value.items){const row=make('li',item.already?'is-complete':'');row.append(make('strong','',item.name||'Planned food'),make('span','',mealLabel(item)));list.append(row);}
    content.append(list);
   }
   if(value.rows?.length){
    const details=make('details','bb-day-done-amounts');details.append(make('summary','',undo?'Amounts to return to At home':'Review ingredient amounts'));
    for(const row of value.rows){
     const line=make('div','bb-day-done-amount');line.append(make('strong','',row.name||'Ingredient'));
     const unit=row.unit?' '+row.unit:'';
     line.append(make('span','',undo?(Number.isFinite(row.restore)?'Return '+row.restore+unit:'Amount needs review'):row.staple?(row.stockLabel||'Staple status kept; no spoonful deduction'):Number.isFinite(row.deduct)?'Use up to '+row.deduct+unit:'Amount needs review'));
     if(row.issueLabel)line.append(make('small','bb-day-done-issue',row.issueLabel));
     for(const assumption of row.assumptions||[])line.append(make('small','',assumption));details.append(line);
    }
    if(value.rows.some(row=>row.estimated)){details.open=true;content.append(make('p','bb-day-done-issue','Some conversions use estimated ingredient weights. Check these amounts before confirming.'));}
    content.append(details);
   }
   if(value.issues?.length){
    const issues=make('div','bb-day-done-issues');
    issues.append(make('p','',undo?'Some recorded amounts need a check before undoing this day.':'Some planned amounts need a check. Review the messages below before confirming.'));
    for(const issue of value.issues){const message=typeof issue==='string'?issue:issue.message||issue.issueLabel;if(message)issues.append(make('p','bb-day-done-issue',message));}
    content.append(issues);
   }
  }
  async function load(nextMode=mode){
   if(!dialog||disposed)return;
   mode=nextMode;const undo=mode==='undo',active=dialog,version=++revision;preview=null;
   active.replaceChildren();
   const heading=make('h2','',undo?'Undo '+day+' Day done?':'Confirm '+day+' is done');heading.id='bbDayDoneTitle'+dialogId;heading.tabIndex=-1;active.setAttribute('aria-labelledby',heading.id);
   const explanation=make('p','',undo?'Reopen only the meals confirmed by this Day done action and return their recorded amounts to At home. Meals you cooked earlier stay confirmed.':'Confirm the planned food you used today. Pantry amounts update for meals still to confirm; already confirmed meals keep their recorded amounts.');
   const content=make('div','bb-day-done-content'),status=make('p','bb-day-done-status','Checking your plan and pantry…');status.setAttribute('role','status');
   const actions=make('div','bb-day-done-actions'),cancel=make('button','btn','Cancel');cancel.type='button';cancel.dataset.bbDayAction='close';cancel.onclick=()=>close();actions.append(cancel);active.append(heading,explanation,content,status,actions);
   heading.focus?.({preventScroll:true});
   let value,undoPreview=null;
   try{
    if(undo)value=typeof home?.previewUndoDay==='function'?await home.previewUndoDay({day,actorId}):{ok:false,needsReview:true,message:'This day has no saved undo record. Review the remaining amounts in At home before changing them.'};
    else{
     [value,undoPreview]=await Promise.all([home?.previewDay?.({day,actorId}),typeof home?.previewUndoDay==='function'?home.previewUndoDay({day,actorId}):null]);
    }
   }
   catch{value={ok:false,message:'Your day could not be checked. Close this review and try again.'};}
   if(disposed||dialog!==active||version!==revision)return;
   if(!current()){refreshCompletion();status.textContent='Your account changed or your session refreshed. Close this review and reopen Day done.';return;}
   value=value||{ok:false,message:'Day confirmation is still loading. Try again shortly.'};preview=value;content.replaceChildren();appendRows(content,value,undo);
   status.textContent=value.message||(undo?(value.already?'This Day done action has already been undone.':value.ok?'Check the recorded amounts before undoing this Day done action.':'Review At home before changing these amounts.'):value.already?'All planned food for this day is already confirmed.':value.ok?'Confirming updates At home using these planned amounts.':'Review your pantry or plan before confirming this day.');
   if(!undo&&undoPreview?.ok&&!undoPreview.already){
    const reviewUndo=make('button','btn bb-day-undo-review','Review undo day done');reviewUndo.type='button';reviewUndo.dataset.bbDayAction='review-undo';reviewUndo.onclick=()=>{if(!busy)void load('undo');};actions.append(reviewUndo);
   }
   if(value.already){if(undo)refreshCompletion();else paintComplete(true);cancel.textContent='Back to Plan';return;}
   if(!value.ok){
    if(typeof win.BBHomeHost?.reviewDay==='function'){const review=make('button','btn','Review plan & pantry');review.type='button';review.dataset.bbDayAction='review';review.onclick=()=>{close();win.BBHomeHost.reviewDay(day);};actions.append(review);}
    return;
   }
   if(typeof value.fingerprint!=='string'||!value.fingerprint||undo&&(typeof home?.undoDay!=='function'||value.needsReview||!Array.isArray(value.rows)||value.rows.some(row=>!Number.isFinite(row.restore)||row.restore<0))){status.textContent='Your day could not be checked safely. Close this review and try again.';return;}
   const confirm=make('button','btn primary',undo?'Confirm undo day done':'Confirm day done');confirm.type='button';confirm.dataset.bbDayAction=undo?'undo':'confirm';actions.append(confirm);
   confirm.onclick=async()=>{
    if(busy||disposed||dialog!==active)return;
    if(!current()){refreshCompletion();confirm.disabled=true;status.textContent='Your account changed or your session refreshed. Close this review and reopen Day done.';return;}
    setBusy(true);for(const button of actions.children)button.disabled=true;status.textContent=undo?'Returning recorded amounts to At home…':'Updating At home…';
    let result;
    try{result=await (undo?home.undoDay({day,actorId,expected:preview.fingerprint}):home.finishDay({day,actorId,expected:preview.fingerprint}));}
    catch{result={ok:false,needsReview:true,message:undo?'The day could not be undone. Review the latest plan and pantry before retrying.':'The day could not be confirmed. Review the latest plan and pantry before retrying.'};}
    setBusy(false);
    if(disposed||dialog!==active)return;
    if(!current()){refreshCompletion();close(true);return;}
    for(const button of actions.children)button.disabled=false;
    status.textContent=result?.message||'Review At home to check the remaining amounts.';
    if(result?.ok){
     if(undo)refreshCompletion();else paintComplete(true);
     announce((undo?day+' Day done undone. ':day+' done. ')+(result.message||'At home updated.'));confirm.remove();cancel.textContent='Back to Plan';
     if(!undo){
      for(const button of [...actions.children])if(button.dataset.bbDayAction==='review-undo')button.remove();
      if(typeof home?.previewUndoDay==='function'){const reviewUndo=make('button','btn bb-day-undo-review','Review undo day done');reviewUndo.type='button';reviewUndo.dataset.bbDayAction='review-undo';reviewUndo.onclick=()=>{if(!busy)void load('undo');};actions.append(reviewUndo);}
     }
     if(!result.already)try{if(undo)onUndone(result);else onConfirmed(result);}catch{}
    }else{
     confirm.textContent='Review latest amounts';confirm.disabled=false;confirm.dataset.bbDayAction='refresh';confirm.onclick=()=>{if(!busy&&!disposed)void load(mode);};
    }
   };
  }
  function open(event){
   event?.preventDefault?.();event?.stopPropagation?.();
   if(disposed||busy||dialog)return;
   actorId=actor();identity=context();returnFocus=doc.activeElement||trigger;dialogId=++sequence;
   refreshCompletion();mode=complete?'undo':'finish';
   dialog=make('dialog','bb-day-done-dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Review '+day+' planned food');
   const active=dialog;
   active.addEventListener('cancel',event=>{if(busy)event.preventDefault();else close();});
   active.addEventListener('close',()=>{if(dialog===active)close(true);});
   (doc.body||container).append(active);try{active.showModal?.();}catch{}void load();
  }
  trigger.onclick=open;
  // Retain the gesture entry point for installed planner scripts. A double tap
  // opens the same review as the visible button and never confirms implicitly.
  async function quickComplete(){
   if(disposed||busy||dialog)return {ok:false,busy:true};
   open();announce('Review '+day+' planned food. Nothing changes until you confirm.');
   return {ok:true,review:true};
  }
  const onStorage=()=>refreshCompletion(),onVisible=()=>{if(doc.visibilityState!=='hidden')refreshCompletion();};
  win.addEventListener?.('storage',onStorage);win.addEventListener?.('focus',onStorage);win.addEventListener?.('pageshow',onStorage);doc.addEventListener?.('visibilitychange',onVisible);
  const ui=Object.freeze({open,quickComplete,refresh:refreshCompletion,dispose(){disposed=true;close(true);trigger.remove();if(mounted.get(day)===ui)mounted.delete(day);win.removeEventListener?.('storage',onStorage);win.removeEventListener?.('focus',onStorage);win.removeEventListener?.('pageshow',onStorage);doc.removeEventListener?.('visibilitychange',onVisible);}});
  mounted.set(day,ui);refreshCompletion();return ui;
 }
 if(root)root.BBDayDone=Object.freeze({mount,quickComplete:day=>mounted.get(day)?.quickComplete()});
})(typeof window==='undefined'?null:window);
