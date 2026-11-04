/* Progressive disclosure only: keep the original controls, live totals and
   event handlers. Open choices live in this page session, never user data. */
(()=>{'use strict';
 if(window.BBSimpleLayout)return;
 const doc=document,choices=new Map(),seen=new WeakSet();let queued=false;
 const setText=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 function remember(details,key,initial=false){
  if(seen.has(details))return;seen.add(details);
  details.open=choices.has(key)?choices.get(key):initial;
  details.addEventListener('toggle',()=>{if(details.isConnected)choices.set(key,details.open);});
 }
 function disclosure(id,label,key){
  const details=doc.createElement('details');details.id=id;details.className='bbs-disclosure';
  const summary=doc.createElement('summary');summary.textContent=label;details.append(summary);remember(details,key);return details;
 }
 function plan(app){
  const budget=app.querySelector('.bbnext-plan-budget');
  if(budget&&!app.querySelector('#bbSimpleBudget')){
   const form=budget.querySelector('.bb77-budget-form'),copy=budget.querySelector('.bbnext-plan-budget-text'),emblem=budget.querySelector('.bb-myweek-emblem');
   if(form&&copy&&emblem){
    const details=disclosure('bbSimpleBudget','Budget & household settings', 'budget');
    const content=doc.createElement('div');content.className='bbs-budget-body';
    const feed=copy.querySelector('.bbfeed-global'),line=copy.querySelector('.bbnext-plan-budget-line'),note=copy.querySelector(':scope>small:not(.bb77-price-note)');
    for(const node of[feed,line,form,note].filter(Boolean))content.append(node);
    const overview=doc.createElement('div');overview.className='bbpc-budget-overview';overview.append(emblem,copy);
    details.append(content);budget.prepend(overview);budget.append(details);
    // The old presentation-only edit pill toggles this same form. Its new
    // details summary replaces that duplicate toggle; original save stays.
    budget.querySelector('.bb-r7-budget-pill')?.remove();form.hidden=false;
    form.addEventListener('keydown',event=>{if(event.key==='Escape'){form.hidden=false;details.open=false;details.firstElementChild.focus({preventScroll:true});}});
    budget.dataset.bbSimpleBudget='true';
   }
  }
  const filters=app.querySelector('#bbpolAutofillCard .bb81-pro-filters'),pills=filters?.querySelector('.bb81-pro-pills');
  if(filters&&pills){
   let details=filters.querySelector('#bbSimpleMealPreferences');
   if(!details){details=disclosure('bbSimpleMealPreferences','Meal preferences','meal-preferences');filters.append(details);details.append(pills);}
   let mealBody=details.querySelector(':scope > .bb-meal-preference-body');
   if(!mealBody){mealBody=doc.createElement('div');mealBody.className='bb-meal-preference-body';mealBody.append(pills);details.append(mealBody);}
   if(window.BBMealPreferences&&!details.querySelector('.bb-meal-preferences')){
    const controls=window.BBMealPreferences.controls({onSave:()=>window.BasketBossMealPreferenceFeedback?.(),onError:message=>window.BasketBossMealPreferenceFeedback?.(message)});
    if(controls)mealBody.insertBefore(controls,pills);
   }
   const count=pills.querySelectorAll('[aria-pressed="true"]').length+(window.BBMealPreferences?.get?.().diets.length||0);
   setText(details.firstElementChild,count?'Meal preferences · '+count+' active':'Meal preferences');
  }
  const settings=app.querySelector('#bbSimpleBudget'),status=settings?.querySelector('.bb77-budget-status');
  if(status&&/could not|not verified|enter a target|unchanged|try again/i.test(status.textContent||''))settings.setAttribute('open','');
 }
 function kitchen(app){
  const card=app.querySelector('#bb173ShopFridge');if(!card)return;
  for(const area of card.querySelectorAll('.bb76-store[data-bb76-store]'))remember(area,'storage-'+area.dataset.bb76Store);
  const review=card.querySelector('#bb8WhatIHave');if(!review)return;
  let details=card.querySelector('#bbSimplePantry');
  if(!details){
   details=disclosure('bbSimplePantry','Your pantry','pantry');
   const count=doc.createElement('span');count.className='bbs-pantry-count';details.firstElementChild.append(count);
   review.before(details);details.append(review);
   const jump=card.querySelector('#bb76JumpPantry');
   jump?.addEventListener('click',()=>{details.open=true;},true);
  }
  const count=review.querySelector('#bb5SelectedCount')?.textContent||'';
  setText(details.querySelector(':scope>summary>.bbs-pantry-count'),count?count+' selected':'Review quantities');
  const status=review.querySelector('#bb5StockStatus')?.textContent||'';
  // A changed draft, failed save, validation error or required receipt review
  // is a task to finish, so keep its original quantities and confirmation open.
  if(/selection updated|food added|removed from draft|check |select a valid|could not|recover |changed elsewhere|no changes saved|review .*first/i.test(status)||window.BBReceiptHost?.requiresPantryReview?.()===true||window.BBReceiptHost?.hasPendingConfirmation?.()===true)details.open=true;
 }
 function refresh(){
  queued=false;const app=doc.getElementById('app');if(!app)return;
  const tab=doc.body.dataset.bbnextView;
  if(tab==='week')plan(app);else if(tab==='shop')kitchen(app);
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
 function start(){
  refresh();const app=doc.getElementById('app');if(!app)return;
  new MutationObserver(records=>{
   if(records.some(record=>record.target===app||record.target.closest?.('.bb77-budget-status,#bb5StockStatus,#bb5SelectedCount,.bb81-pro-pills')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('.bbnext-plan-budget,#bbpolAutofillCard,#bb173ShopFridge,.bb81-pro-filters')||node.querySelector?.('.bbnext-plan-budget,#bb173ShopFridge')))))schedule();
  }).observe(app,{childList:true,subtree:true,characterData:true});
 }
 window.BBSimpleLayout=Object.freeze({refresh});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
