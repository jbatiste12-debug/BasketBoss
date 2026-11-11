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
  // Readable labels never become pantry amounts or confirmation inputs.
  function displayAmount(value,unit){
   if(!Number.isFinite(value)||value<0)return 'Check amount';
   try{const formatted=win.BBShopPurchaseUI?.formatDisplayQty?.(value,unit,{countMode:'balance'});if(formatted&&!/^Check\b/.test(formatted))return formatted;}catch{}
   const suffix=unit?' '+unit:'';if(value>0&&value<1&&['g','ml'].includes(unit))return '<1'+suffix;
   const counted=/^(?:each|counts?|cloves?|packs?|tins?|cans?|buns?|bulbs?|rolls?|eggs?|fillets?|bottles?|jars?|bags?|loaves?|slices?|pieces?|items?)$/i.test(unit||'');
   if(value>0&&value<.1&&!['g','ml'].includes(unit))return '<0.1'+suffix;
   return new Intl.NumberFormat('en-GB',{maximumFractionDigits:['g','ml'].includes(unit)?0:1,useGrouping:false}).format(value)+suffix;
  }
  function rawAmount(node,value,unit,field){if(Number.isFinite(value)){node.dataset.bbDayRawAmount=String(value);node.dataset.bbDayUnit=unit||'';node.dataset.bbDayQuantityField=field;}return node;}
  const displayNote=value=>{try{return win.BBShopPurchaseUI?.formatDisplayQuantityText?.(value)||value;}catch{return value;}};
  function produceCountProfile(row){
   if(row.unit!=='g'||row.staple||row.issue||!Number.isFinite(row.owned)||row.owned<0)return null;
   try{
    const ui=win.BBLooseProduceUI,policy=win.BBPantryPolicy,known=ui?.profile?.(row.name,policy),stock=win.BBHomeHost?.stock?.();
    if(!known||!stock||typeof stock!=='object'||Array.isArray(stock)||typeof ui.readStockProof!=='function')return null;
    let quantity=0,sources=0;
    for(const [stockKey,value]of Object.entries(stock)){
     const at=stockKey.lastIndexOf('|'),source=at>0?ui.profile(stockKey.slice(0,at),policy):null;if(source?.food!==known.food)continue;
     if(!(typeof value==='number'&&Number.isFinite(value)&&value>=0))return null;if(value===0)continue;
     if(stockKey.slice(at+1)!=='g')return null;
     const proof=ui.readStockProof(win.localStorage,{actor:actor(),stockKey,canonicalQuantity:value},policy);
     if(!proof||proof.food!==known.food||proof.gramsPerEach!==known.gramsPerEach)return null;
     quantity+=value;sources++;
    }
    return sources&&row.owned<=quantity+1e-9?known:null;
   }catch{return null;}
  }
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
   const amountDetails=[];
   if(value.rows?.length){
    const amounts=make('section','bb-day-done-amounts');amounts.setAttribute('aria-label',undo?'Amounts to return to At home':'Ingredients used');
    let table=null,body=null;
    if(undo){const title=make('div','bb-day-done-amounts-heading');title.append(make('h3','','Return to At home'),make('span','','Recorded'));amounts.append(title);}
    else{
     table=make('table','bb-day-done-ingredient-table');table.append(make('caption','','Ingredients used'));const head=make('thead'),headRow=make('tr');
     for(const text of ['Ingredient','Required','In pantry','Remaining']){const cell=make('th','',text);cell.setAttribute('scope','col');if(text==='Remaining'){cell.setAttribute('aria-label','Remaining after confirmation');cell.append(make('small','bb-day-done-projection-label','after confirmation'));}headRow.append(cell);}head.append(headRow);body=make('tbody');table.append(head,body);amounts.append(table);
    }
    for(const row of value.rows){
     const required=Number.isFinite(row.required)?row.required:null,countProfile=undo?null:produceCountProfile(row);
     const rowAmount=value=>countProfile?displayAmount(value/countProfile.gramsPerEach,'each'):displayAmount(value,row.unit);
     if(undo){
      const line=make('div','bb-day-done-amount'),main=make('div','bb-day-done-amount-main');main.append(make('strong','',row.name||'Ingredient'),rawAmount(make('span','bb-day-done-quantity',Number.isFinite(row.restore)?displayAmount(row.restore,row.unit):'Needs review'),row.restore,row.unit,'restore'));line.append(main);if(row.issueLabel)line.append(make('small','bb-day-done-issue',displayNote(row.issueLabel)));amounts.append(line);
     }else{
      const line=make('tr','bb-day-done-amount bb-day-done-amount-main'),name=make('td','bb-day-done-ingredient-name');name.append(make('strong','',row.name||'Ingredient'));if(row.estimated)name.append(make('small','','Estimated'));
      const needed=rawAmount(make('td','bb-day-done-quantity',required!==null?rowAmount(required):row.staple?'Staple':'Check amount'),required,row.unit,'required');let owned='Not checked',remaining='Not checked',check=false;
      if(row.staple){owned=({in:'In stock',low:'Low',out:'Out of stock'})[row.stapleStatus]||'Check stock';remaining='Unchanged';}
      else if(row.issue==='unit_mismatch'||row.issue==='unit_unknown'){owned=remaining='Check unit';check=true;}
      else if(row.issue==='amount_unknown'){owned=remaining='Check amount';check=true;}
      else{if(Number.isFinite(row.owned)&&row.owned>=0)owned=rowAmount(row.owned);if(Number.isFinite(row.remaining)&&row.remaining>=0)remaining=rowAmount(row.remaining);}
      const pantry=make('td',check?'bb-day-done-cell-review':'',owned),after=make('td',check?'bb-day-done-cell-review':'',remaining);if(!row.staple&&!check){rawAmount(pantry,row.owned,row.unit,'owned');rawAmount(after,row.remaining,row.unit,'remaining');}line.append(name,needed,pantry,after);body.append(line);
     }
     const notes=[row.issueLabel,...(row.assumptions||[])].filter(Boolean);if(row.staple&&row.stockLabel)notes.push(row.stockLabel);if(notes.length)amountDetails.push({name:row.name||'Ingredient',notes:[...new Set(notes)]});
    }
    content.append(amounts);
   }
   if(amountDetails.length){
    const details=make('details','bb-day-done-conversion-details');details.append(make('summary','','Amount details'));
    for(const entry of amountDetails){const item=make('div','bb-day-done-conversion-item');item.append(make('strong','',entry.name));for(const note of entry.notes)item.append(make('p','',displayNote(note)));details.append(item);}content.append(details);
   }
   if(lunchDetails)content.append(lunchDetails);
   const rowIssues=new Set((value.rows||[]).map(row=>row.issueLabel).filter(Boolean)),remainingIssues=(value.issues||[]).filter(issue=>!rowIssues.has(typeof issue==='string'?issue:issue.message||issue.issueLabel));
   if(remainingIssues.length){
    const issues=make('div','bb-day-done-issues');
    issues.append(make('p','',undo?'Some recorded amounts need a check before undoing this day.':'Some planned amounts need a check. Review the messages below before confirming.'));
    for(const issue of remainingIssues){const message=typeof issue==='string'?issue:issue.message||issue.issueLabel;if(message)issues.append(make('p','bb-day-done-issue',displayNote(message)));}
    content.append(issues);
   }
  }
  async function load(nextMode=mode){
   if(!dialog||disposed)return;
   mode=nextMode;const undo=mode==='undo',active=dialog,version=++revision;preview=null;
   active.replaceChildren();
   const heading=make('h2','',undo?'Undo '+day+' Day done?':lunchWeek?'Confirm school lunches for the week':'Confirm ingredients used');heading.id='bbDayDoneTitle'+dialogId;heading.tabIndex=-1;active.setAttribute('aria-labelledby',heading.id);
   const header=make('header','bb-day-done-header');
   if(!undo)header.append(make('p','bb-day-done-kicker',lunchWeek?'SCHOOL LUNCHES · THIS WEEK':day.toUpperCase()+' · DAY DONE'));
   const explanation=make('p','bb-day-done-explanation',undo?'Reopen only the meals confirmed by this Day done action and return their recorded amounts to At home. Meals you cooked earlier stay confirmed.':'Check the ingredients you used. Confirm to update At home.');
   const content=make('div','bb-day-done-content'),status=make('p','bb-day-done-status','Checking your plan and pantry…');status.setAttribute('role','status');
   const actions=make('div','bb-day-done-actions'),cancel=make('button','btn',undo?'Cancel':'Not yet');cancel.type='button';cancel.dataset.bbDayAction='close';cancel.onclick=()=>close();actions.append(cancel);header.append(heading,explanation);const footer=make('footer','bb-day-done-footer');footer.append(status,actions);active.append(header,content,footer);
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
   status.textContent=value.message||(undo?(value.already?'This Day done action has already been undone.':value.ok?'Check the recorded amounts before undoing this Day done action.':'Review At home before changing these amounts.'):value.already?(lunchWeek?'All school lunches for this week are already confirmed.':'All planned food for this day is already confirmed.'):value.ok?'Pantry changes only when you confirm.':'Review your pantry or plan before confirming this day.');
   if(!lunchWeek&&!undo&&undoPreview?.ok&&!undoPreview.already){
    const reviewUndo=make('button','btn bb-day-undo-review','Review undo day done');reviewUndo.type='button';reviewUndo.dataset.bbDayAction='review-undo';reviewUndo.onclick=()=>{if(!busy)void load('undo');};actions.append(reviewUndo);
   }
   if(value.already){if(undo)refreshCompletion();else paintComplete(true);cancel.textContent='Back to Plan';return;}
   if(!value.ok){
    if(value.reviewAction==='pantry'){
     const pantry=value.pantryStatus||{},receipt=win.BBReceiptHost;
     if(receipt?.accountPantrySyncEnabled?.()===true&&pantry.reason!=='receipt_pending'){
      const account=make('button','btn primary','Account & cloud sync');account.type='button';account.dataset.bbDayAction='review-pantry';actions.append(account);
      account.onclick=()=>{if(busy||!current())return;close();receipt.reviewPantry?.();};
     }else if(pantry.canReviewInline===true&&typeof receipt?.reviewPantry==='function'){
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
   const confirm=make('button','btn primary',undo?'Confirm undo day done':'Confirm & update pantry');confirm.type='button';confirm.dataset.bbDayAction=undo?'undo':'confirm';actions.append(confirm);
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
