/* Confirm the day's planned food once; opening this review never consumes stock. */
(function(root){'use strict';
 const DAYS=new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
 const mounted=new Map();let sequence=0,statusNode=null;
 function mountReview({container,day,win=root,onConfirmed=()=>{},onUndone=()=>{},badge:providedBadge,lunchWeek=false}={}){
  const doc=container?.ownerDocument||win?.document,home=win?.BBHome;
  if(!container||!doc?.createElement||(!lunchWeek&&!DAYS.has(day)))return null;
  let disposed=false,dialog=null,busy=false,preview=null,actorId=null,revision=0,returnFocus=null,dialogId=0,identity=null,complete=false,mode='finish',pantryControllers=[];
  const mountKey=lunchWeek?'lunch-week':day;
  const card=lunchWeek?null:container.closest?.('.bbnext-day[data-bbnext-day]');
  const badge=providedBadge||card?.querySelector?.('.bbnext-day-badge,.bbnext-day-label');
  const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;};
  const trigger=make('button','small-btn bb-day-done-trigger',lunchWeek?'Confirm school lunches for the week':'Day done');trigger.type='button';if(lunchWeek)trigger.dataset.bbLunchWeekDone='true';else trigger.dataset.bbDayDone=day;trigger.setAttribute('aria-label',lunchWeek?'Confirm school lunches for the week':'Confirm all planned food for '+day);container.append(trigger);
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
   trigger.textContent=lunchWeek?(complete?'Review confirmed school lunches':'Confirm school lunches for the week'):complete?'Undo day done':'Day done';trigger.dataset.bbDayDoneState=complete?'complete':'planned';trigger.setAttribute('aria-label',lunchWeek?'Review school lunches for the week':complete?'Review undoing Day done for '+day:'Review all planned food for '+day);
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
   try{const meals=lunchWeek?win.BBHomeHost?.schoolLunchWeekMeals?.():win.BBHomeHost?.dayMeals?.(day);value=Array.isArray(meals)&&meals.length>0&&typeof home?.isCooked==='function'&&meals.every(meal=>typeof meal?.occurrence==='string'&&home.isCooked(meal.occurrence));}catch{}
   paintComplete(value);
  }
  function setBusy(value){busy=value;trigger.disabled=value;if(badge){badge.classList.toggle('bb-day-is-checking',value);badge.setAttribute('aria-busy',String(value));}}
  function close(force=false){
   if(busy&&!force)return;
   revision++;const previous=dialog;dialog=null;preview=null;
   for(const controller of pantryControllers.splice(0))try{controller.dispose({refresh:sameContext()});}catch{}
   try{previous?.close?.();}catch{}previous?.remove();
   if(!disposed&&returnFocus?.isConnected)returnFocus.focus?.({preventScroll:true});
  }
  function mealLabel(item){
   const kind=({dinner:'Dinner',breakfast:'Breakfast',dessert:'Bake / dessert',lunch:'Lunch',leftover:'Leftover meal',note:'Custom meal'})[item.kind]||'Meal';
   const servings=item.servingsLabel||(Number.isFinite(item.servings)?item.servings+' servings':'');
   return [lunchWeek?item.day:kind,servings,item.already?'Already confirmed':''].filter(Boolean).join(' · ');
  }
  function appendRows(content,value,undo=false){
   let lunchDetails=null;
   if(value.items?.length){
    const list=make('ul','bb-day-done-meals');
    for(const item of value.items){const row=make('li',item.already?'is-complete':'');row.append(make('strong','',item.name||'Planned food'),make('span','',mealLabel(item)));list.append(row);}
    if(lunchWeek){
     const pending=value.items.filter(item=>!item.already),days=[...new Set(pending.map(item=>item.day).filter(Boolean))],confirmedDays=new Set(value.items.filter(item=>item.already).map(item=>item.day).filter(Boolean)).size;
     const count=days.length||pending.length,summary=make('section','bb-day-done-lunch-summary');summary.setAttribute('aria-label','School lunch confirmation summary');
     summary.append(make('strong','',count?count+' lunch '+(count===1?'day':'days')+' to confirm':'All lunch days confirmed'));
     if(days.length)summary.append(make('span','bb-day-done-lunch-days',days.join(' · ')));
     summary.append(make('span','bb-day-done-lunch-confirmed',confirmedDays+' already confirmed'));
     content.append(summary);lunchDetails=make('details','bb-day-done-lunch-details');lunchDetails.append(make('summary','','View planned lunches'),list);
    }else content.append(list);
   }
   if(value.rows?.length){
    const amounts=make('section','bb-day-done-amounts');amounts.setAttribute('aria-label',undo?'Amounts to return to At home':'Ingredients used');
    const title=make('div','bb-day-done-amounts-heading');title.append(make('h3','',undo?'Return to At home':'Ingredients used'),make('span','',undo?'Recorded':'Planned amount'));amounts.append(title);
    for(const row of value.rows){
     const line=make('div','bb-day-done-amount'),main=make('div','bb-day-done-amount-main'),unit=row.unit?' '+row.unit:'';
     const required=Number.isFinite(row.required)?row.required:null;
     const amount=undo?(Number.isFinite(row.restore)?row.restore+unit:'Needs review'):required!==null?required+unit:row.staple?(row.stockLabel||'Staple'):'Needs review';
     main.append(make('strong','',row.name||'Ingredient'),make('span','bb-day-done-quantity',amount));line.append(main);
     if(!undo&&row.staple)line.append(make('small','',row.stockLabel||'Staple status kept; no spoonful deduction'));
     if(!undo&&required!==null&&Number.isFinite(row.deduct)&&Math.abs(row.deduct-required)>.000001)line.append(make('small','bb-day-done-issue','Planned '+required+unit+'; the recorded At home amount will reduce by '+row.deduct+unit+'. Check this difference before confirming.'));
     if(!undo&&required===null&&!row.staple&&Number.isFinite(row.deduct))line.append(make('small','','Recorded At home reduction: '+row.deduct+unit+'. Planned amount unavailable.'));
     if(row.issueLabel)line.append(make('small','bb-day-done-issue',row.issueLabel));
     for(const assumption of row.assumptions||[])line.append(make('small','',assumption));amounts.append(line);
    }
    if(value.rows.some(row=>row.estimated))amounts.append(make('p','bb-day-done-issue','Some conversions use estimated ingredient weights. Check these amounts before confirming.'));
    content.append(amounts);
   }
   if(lunchDetails)content.append(lunchDetails);
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
   const heading=make('h2','',undo?'Undo '+day+' Day done?':lunchWeek?'Confirm school lunches for the week':'Confirm ingredients used');heading.id='bbDayDoneTitle'+dialogId;heading.tabIndex=-1;active.setAttribute('aria-labelledby',heading.id);
   if(!undo)active.append(make('p','bb-day-done-kicker',lunchWeek?'SCHOOL LUNCHES · THIS WEEK':day.toUpperCase()+' · DAY DONE'));
   const explanation=make('p','bb-day-done-explanation',undo?'Reopen only the meals confirmed by this Day done action and return their recorded amounts to At home. Meals you cooked earlier stay confirmed.':'Check the ingredients you used. Confirm to update At home.');
   const content=make('div','bb-day-done-content'),status=make('p','bb-day-done-status','Checking your plan and pantry…');status.setAttribute('role','status');
   const actions=make('div','bb-day-done-actions'),cancel=make('button','btn',undo?'Cancel':'Not yet');cancel.type='button';cancel.dataset.bbDayAction='close';cancel.onclick=()=>close();actions.append(cancel);active.append(heading,explanation,content,status,actions);
   heading.focus?.({preventScroll:true});
   let value,undoPreview=null;
   try{
    if(undo)value=typeof home?.previewUndoDay==='function'?await home.previewUndoDay({day,actorId}):{ok:false,needsReview:true,message:'This day has no saved undo record. Review the remaining amounts in At home before changing them.'};
    else{
     [value,undoPreview]=await Promise.all([(lunchWeek?home?.previewLunchWeek?.({actorId}):home?.previewDay?.({day,actorId})),!lunchWeek&&typeof home?.previewUndoDay==='function'?home.previewUndoDay({day,actorId}):null]);
    }
   }
   catch{value={ok:false,message:'Your day could not be checked. Close this review and try again.'};}
   if(disposed||dialog!==active||version!==revision)return;
   if(!current()){refreshCompletion();status.textContent='Your account changed or your session refreshed. Close this review and reopen Day done.';return;}
   value=value||{ok:false,message:'Day confirmation is still loading. Try again shortly.'};preview=value;content.replaceChildren();appendRows(content,value,undo);
   status.textContent=value.message||(undo?(value.already?'This Day done action has already been undone.':value.ok?'Check the recorded amounts before undoing this Day done action.':'Review At home before changing these amounts.'):value.already?(lunchWeek?'All school lunches for this week are already confirmed.':'All planned food for this day is already confirmed.'):value.ok?(lunchWeek?'Lunches already confirmed are skipped.':'Meals already confirmed are skipped.'):'Review your pantry or plan before confirming this day.');
   if(!lunchWeek&&!undo&&undoPreview?.ok&&!undoPreview.already){
    const reviewUndo=make('button','btn bb-day-undo-review','Review undo day done');reviewUndo.type='button';reviewUndo.dataset.bbDayAction='review-undo';reviewUndo.onclick=()=>{if(!busy)void load('undo');};actions.append(reviewUndo);
   }
   if(value.already){if(undo)refreshCompletion();else paintComplete(true);cancel.textContent='Back to Plan';return;}
   if(!value.ok){
    if(value.reviewAction==='pantry'){
     const pantry=value.pantryStatus||{},receipt=win.BBReceiptHost;
     if(pantry.canReviewInline===true&&typeof receipt?.reviewPantry==='function'){
      const review=make('button','btn primary','Check saved stock');review.type='button';review.dataset.bbDayAction='review-pantry';actions.append(review);
      review.onclick=async()=>{
       if(busy||disposed||dialog!==active)return;
       if(!current()){review.disabled=true;status.textContent='Your account changed or your session refreshed. Close this review and reopen it.';return;}
       review.disabled=true;const inline=make('section','bb-day-done-pantry-review');content.append(inline);status.textContent='Check your At home amounts below, then return to the ingredients.';
       let settled=false,controller=null;
       try{controller=await receipt.reviewPantry({container:inline,deferProjection:true,onConfirmed:()=>{settled=true;if(dialog===active&&current())void load(mode);},onCancel:()=>{settled=true;if(dialog===active&&current()){inline.remove();review.disabled=false;status.textContent='Pantry review cancelled. No meals confirmed.';}}});}
       catch{if(dialog===active&&current())status.textContent='Your At home amounts could not be loaded. Try reviewing them again.';}
       if(controller){
        if(dialog!==active||!current())try{controller.dispose({refresh:false});}catch{}
        else {pantryControllers.push(controller);if(!settled){controller.element?.scrollIntoView?.({block:'nearest'});controller.element?.querySelector?.('h3')?.focus?.({preventScroll:true});}}
       }else if(!settled&&dialog===active&&current()){
        inline.remove();review.disabled=false;status.textContent='Your At home amounts could not be loaded. Try reviewing them again.';
       }
      };
     }else if(pantry.reason==='receipt_pending'&&typeof receipt?.recoverReceipt==='function'){
      const check=make('button','btn primary','Check receipt status');check.type='button';check.dataset.bbDayAction='check-receipt';actions.append(check);
      check.onclick=async()=>{
       if(busy||disposed||dialog!==active)return;
       if(!current()){check.disabled=true;status.textContent='Your account changed or your session refreshed. Close this review and reopen it.';return;}
       check.disabled=true;status.textContent='Checking your receipt status…';
       try{await receipt.recoverReceipt();}catch{}
       if(dialog===active&&current())void load(mode);
      };
     }
     return;
    }
    if(!lunchWeek&&typeof win.BBHomeHost?.reviewDay==='function'){const review=make('button','btn','Review plan & pantry');review.type='button';review.dataset.bbDayAction='review';review.onclick=()=>{close();win.BBHomeHost.reviewDay(day);};actions.append(review);}
    return;
   }
   if(typeof value.fingerprint!=='string'||!value.fingerprint||undo&&(typeof home?.undoDay!=='function'||value.needsReview||!Array.isArray(value.rows)||value.rows.some(row=>!Number.isFinite(row.restore)||row.restore<0))){status.textContent='Your day could not be checked safely. Close this review and try again.';return;}
   const confirm=make('button','btn primary',undo?'Confirm undo day done':lunchWeek?'Confirm lunches for the week':'Confirm ingredients used');confirm.type='button';confirm.dataset.bbDayAction=undo?'undo':'confirm';actions.append(confirm);
   confirm.onclick=async()=>{
    if(busy||disposed||dialog!==active)return;
    if(!current()){refreshCompletion();confirm.disabled=true;status.textContent='Your account changed or your session refreshed. Close this review and reopen Day done.';return;}
    setBusy(true);for(const button of actions.children)button.disabled=true;status.textContent=undo?'Returning recorded amounts to At home…':'Updating At home…';
    let result;
    try{result=await (undo?home.undoDay({day,actorId,expected:preview.fingerprint}):lunchWeek?home.finishLunchWeek({actorId,expected:preview.fingerprint}):home.finishDay({day,actorId,expected:preview.fingerprint}));}
    catch{result={ok:false,needsReview:true,message:undo?'The day could not be undone. Review the latest plan and pantry before retrying.':'The day could not be confirmed. Review the latest plan and pantry before retrying.'};}
    setBusy(false);
    if(disposed||dialog!==active)return;
    if(!current()){refreshCompletion();close(true);return;}
    for(const button of actions.children)button.disabled=false;
    status.textContent=result?.message||'Review At home to check the remaining amounts.';
    if(result?.ok){
     if(undo)refreshCompletion();else paintComplete(true);
     announce((lunchWeek?'School lunches confirmed. ':undo?day+' Day done undone. ':day+' done. ')+(result.message||'At home updated.'));confirm.remove();cancel.textContent='Back to Plan';
     if(!lunchWeek&&!undo){
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
   refreshCompletion();mode=!lunchWeek&&complete?'undo':'finish';
   dialog=make('dialog','bb-day-done-dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',lunchWeek?'Review school lunches for the week':'Review '+day+' planned food');
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
  const ui=Object.freeze({open,quickComplete,refresh:refreshCompletion,dispose(){disposed=true;close(true);trigger.remove();if(mounted.get(mountKey)===ui)mounted.delete(mountKey);win.removeEventListener?.('storage',onStorage);win.removeEventListener?.('focus',onStorage);win.removeEventListener?.('pageshow',onStorage);doc.removeEventListener?.('visibilitychange',onVisible);}});
  mounted.set(mountKey,ui);refreshCompletion();return ui;
 }
 if(root)root.BBDayDone=Object.freeze({mount:options=>mountReview(options),mountLunchWeek:options=>mountReview({...options,lunchWeek:true}),quickComplete:day=>mounted.get(day)?.quickComplete()});
})(typeof window==='undefined'?null:window);
