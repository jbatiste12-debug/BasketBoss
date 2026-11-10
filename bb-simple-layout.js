/* Progressive disclosure only: keep the original controls, live totals and
   event handlers. Open choices live in this page session, never user data. */
(()=>{'use strict';
 if(window.BBSimpleLayout)return;
 const doc=document,choices=new Map(),seen=new WeakSet();let queued=false,plannerChoice='dinners';
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
 // These tabs present the original dinner and lunchbox nodes in one card.
 // Their selected state lives only in this closure; saved planning data is read
 // and written exclusively by the original controls and their existing handlers.
 function plannerTabs(app){
  const card=app.querySelector('#bb1759MealsSummary'),grid=card?.querySelector('.bb1759-days'),intro=card?.querySelector('.bb1759-summary-heading');
  const lunch=app.querySelector('#bb321SchoolLunchbox');
  if(!card||!grid||!intro||!lunch)return;
  let bar=card.querySelector('#bbSimplePlannerTabs'),pane=card.querySelector('#bbSimpleSchoolLunchesPane');
  if(!bar){
   bar=doc.createElement('div');bar.id='bbSimplePlannerTabs';bar.className='bbs-planner-tabs';
   const tabs=doc.createElement('div');tabs.className='bbs-planner-tablist';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Weekly meal plans');
   for(const [key,label,controls] of [['dinners','Dinners','bbSimpleDinnersPane'],['lunches','School lunches','bbSimpleSchoolLunchesPane']]){
    const button=doc.createElement('button');button.type='button';button.id='bbSimplePlannerTab-'+key;button.dataset.bbPlannerTab=key;button.setAttribute('role','tab');button.setAttribute('aria-controls',controls);
    const title=doc.createElement('span');title.textContent=label;const count=doc.createElement('span');count.className='bbs-planner-tab-count';button.append(title,count);tabs.append(button);
    button.addEventListener('click',()=>select(key));
    button.addEventListener('keydown',event=>{
     if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
     event.preventDefault();const next=event.key==='Home'?'dinners':event.key==='End'?'lunches':key==='dinners'?'lunches':'dinners';
     select(next);tabs.querySelector('[data-bb-planner-tab="'+next+'"]').focus({preventScroll:true});
    });
   }
   bar.append(tabs);intro.before(bar);
   pane=doc.createElement('div');pane.id='bbSimpleSchoolLunchesPane';pane.className='bbs-school-lunches-pane';pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby','bbSimplePlannerTab-lunches');card.append(pane);
   grid.id='bbSimpleDinnersPane';grid.setAttribute('role','tabpanel');grid.setAttribute('aria-labelledby','bbSimplePlannerTab-dinners');
  }
  // Reparent each existing element once. No control or listener is copied.
  const lunchGroup=app.querySelector('#bb1756Lunchboxes');
  if(lunchGroup){
   if(lunchGroup.parentNode!==pane)pane.append(lunchGroup);
   lunchGroup.hidden=false;lunchGroup.open=true;
   const content=lunchGroup.querySelector(':scope>.bb1756-extra-content')||lunchGroup;
   if(lunch.parentNode!==content)content.append(lunch);
  }else if(lunch.parentNode!==pane)pane.append(lunch);
  const clear=intro.querySelector('#clearWeek');if(clear)bar.append(clear);
  card.dataset.bbPlannerTabs='true';
  setText(lunch.querySelector('h3'),'School Lunchboxes (Mon–Fri)');
  const summary=app.querySelector('.bbnext-plan-budget-text>p:not(.bb77-pantry-savings)'),copy=summary?.textContent||'';
  const dinners=copy.match(/\b([0-7])\s*\/\s*7\s+dinners/i)?.[1]??String(grid.querySelectorAll('.bbnext-day.has-meal').length);
  const lunches=lunch.querySelector('.section-head .chip')?.textContent.match(/\b([0-5])\s*\/\s*5/)?.[1]??String([...lunch.querySelectorAll('.bb15-lunch-day')].filter(day=>day.querySelector('.bb15-lunch-item')).length);
  setText(bar.querySelector('[data-bb-planner-tab="dinners"] .bbs-planner-tab-count'),'('+dinners+'/7)');
  setText(bar.querySelector('[data-bb-planner-tab="lunches"] .bbs-planner-tab-count'),'('+lunches+'/5)');
  if(summary){
   const base=copy.replace(/\s*[·•]\s*[0-5]\/5 school lunches(?: planned)?$/i,'').replace(/([0-7]\/7 dinners) planned\b/i,'$1');
   setText(summary,base+' • '+lunches+'/5 school lunches');
  }
  apply();
  function apply(){
   if(app.dataset.bbPlannerPane!==plannerChoice)app.dataset.bbPlannerPane=plannerChoice;
   for(const button of bar.querySelectorAll('[data-bb-planner-tab]')){
    const active=button.dataset.bbPlannerTab===plannerChoice;
    if(button.getAttribute('aria-selected')!==String(active))button.setAttribute('aria-selected',String(active));
    button.tabIndex=active?0:-1;
   }
   grid.hidden=plannerChoice!=='dinners';pane.hidden=plannerChoice!=='lunches';
  }
  function select(key){
   const at=window.scrollY;plannerChoice=key;apply();
   // Switching changes only this card. Keep the viewport at the same position.
   window.scrollTo({top:at,behavior:'instant'});
  }
 }
 function plan(app){
  plannerTabs(app);
  const budget=app.querySelector('.bbnext-plan-budget');
  if(budget&&!app.querySelector('#bbSimpleBudget')){
   const form=budget.querySelector('.bb77-budget-form'),copy=budget.querySelector('.bbnext-plan-budget-text'),emblem=budget.querySelector('.bb-myweek-emblem');
   if(form&&copy&&emblem){
    const details=disclosure('bbSimpleBudget','Budget & household', 'budget');
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
   setText(details.firstElementChild,'Meal preferences');
   if(details.firstElementChild.dataset.bbChoiceCount!==String(count))details.firstElementChild.dataset.bbChoiceCount=String(count);
   const label=count?'Meal preferences, '+count+' active':'Meal preferences';
   for(const attribute of ['aria-label','title'])if(details.firstElementChild.getAttribute(attribute)!==label)details.firstElementChild.setAttribute(attribute,label);
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
  // Existing section jumps and overview shortcuts keep their original handlers
  // and target IDs. Reveal their original lunch target before those handlers run.
  doc.addEventListener('click',event=>{
   if(!event.target.closest?.('[data-bb1759-jump="bb1756Lunchboxes"],[data-bb1756-jump="bb1756Lunchboxes"],[data-bb-ui-focus="bb321SchoolLunchbox"]'))return;
   plannerChoice='lunches';refresh();schedule();
  },true);
  refresh();const app=doc.getElementById('app');if(!app)return;
  new MutationObserver(records=>{
   if(records.some(record=>record.target===app||record.target.closest?.('.bb77-budget-status,#bb5StockStatus,#bb5SelectedCount,.bb81-pro-pills,.bbnext-plan-budget-text,#bb1759MealsSummary,#bb321SchoolLunchbox')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('.bbnext-plan-budget,#bbpolAutofillCard,#bb173ShopFridge,.bb81-pro-filters')||node.querySelector?.('.bbnext-plan-budget,#bb173ShopFridge')))))schedule();
  }).observe(app,{childList:true,subtree:true,characterData:true});
 }
 window.BBSimpleLayout=Object.freeze({refresh});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
