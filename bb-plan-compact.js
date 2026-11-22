/* Presentation only. Preserve real controls and handlers; only disclosure,
   text labels and layout wrappers are owned by this adapter. */
(()=>{'use strict';
 if(window.BBPlanCompact)return;
 const doc=document;let queued=false,pointerMenu=null,pointerFinish=null;
 function finishPointerMenu(){
  if(pointerFinish!==null)window.clearTimeout(pointerFinish);
  const wrap=pointerMenu;pointerMenu=null;pointerFinish=null;
  if(wrap&&!wrap.contains(doc.activeElement)&&!doc.getElementById('bbQaConfirmOverlay')){
   const menu=wrap.querySelector('.bbpc-meal-menu');if(menu)menu.hidden=true;
   wrap.querySelector('.bbpc-overflow-trigger')?.setAttribute('aria-expanded','false');
  }
 }
 function deferPointerFinish(){
  if(pointerFinish!==null)window.clearTimeout(pointerFinish);
  pointerFinish=window.setTimeout(finishPointerMenu,0);
 }
 function closeMenus(except=null){
  for(const menu of doc.querySelectorAll?.('.bbpc-meal-menu')||[]){
   if(menu===except)continue;menu.hidden=true;
   menu.parentNode?.querySelector('.bbpc-overflow-trigger')?.setAttribute('aria-expanded','false');
  }
 }
 function polishWeekOverview(app){
  const overview=app.querySelector('.bbpc-budget-overview'),copy=overview?.querySelector('.bbnext-plan-budget-text');
  const heading=copy?.querySelector('h2'),feed=app.querySelector('.bbfeed-global');
  const emblem=overview?.querySelector('.bb-myweek-emblem'),price=emblem?.querySelector('.bbnext-plan-donut');
  if(!heading||!feed||!price)return;
  // Reuse the original live controls and copy. Their existing references,
  // listeners and saved values remain owned by the Plan renderer.
  let header=copy.querySelector(':scope>.bbpc-week-header');
  if(!header){header=doc.createElement('div');header.className='bbpc-week-header';copy.prepend(header);}
  if(heading.parentNode!==header)header.append(heading);
  if(feed.parentNode!==header)header.append(feed);
  let row=emblem.querySelector(':scope>.bbpc-week-price');
  if(!row){row=doc.createElement('div');row.className='bbpc-week-price';emblem.append(row);}
  if(price.parentNode!==row)row.append(price);
  let info=row.querySelector(':scope>.bbpc-week-info');
  if(!info){
   info=doc.createElement('details');info.className='bbpc-week-info';
   const summary=doc.createElement('summary');summary.textContent='ⓘ';summary.setAttribute('aria-label','About your weekly shopping estimate');
   const body=doc.createElement('div');body.className='bbpc-week-info-body';
   info.append(summary,body);row.append(info);
  }
  const body=info.querySelector('.bbpc-week-info-body');
  // The first count paragraph must remain a direct child: Simple Layout
  // updates its live dinner/lunch totals through that existing selector.
  for(const node of copy.querySelectorAll(':scope>.bb77-pantry-savings,:scope>.bb77-price-note'))body.append(node);
  const disclaimer=app.querySelector('#bbSimpleBudget>.bbs-budget-body>small');
  if(disclaimer)body.append(disclaimer);
 }
 function polishDay(row){
  const toggle=row.querySelector(':scope>summary.bbnext-day-toggle'),desc=toggle?.querySelector('.bbnext-day-description');
  const label=toggle?.querySelector('.bbnext-day-label');
  if(!toggle||!desc)return;
  if(label&&row.classList.contains('has-meal')){
   let tags=desc.querySelector(':scope>.bbpc-day-tags');
   if(!tags){tags=doc.createElement('span');tags.className='bbpc-day-tags';desc.prepend(tags);}
   if(label.parentNode!==tags)tags.append(label);
   const tonight=desc.querySelector(':scope>.bb77-tonight');if(tonight)tags.append(tonight);
  }
  const remove=toggle.querySelector('button.bb77-clear-day');
  if(!remove||remove.closest('.bbpc-meal-overflow'))return;
  const day=row.dataset.bbnextDay,wrap=doc.createElement('span'),trigger=doc.createElement('button'),menu=doc.createElement('span');
  wrap.className='bbpc-meal-overflow';trigger.type='button';trigger.className='bbpc-overflow-trigger';trigger.textContent='…';
  trigger.setAttribute('aria-label','More options for '+day+' dinner');trigger.setAttribute('aria-expanded','false');
  menu.id='bbPlanMealOptions-'+day;menu.className='bbpc-meal-menu';menu.hidden=true;menu.setAttribute('role','group');menu.setAttribute('aria-label',day+' dinner actions');
  trigger.setAttribute('aria-controls',menu.id);
  remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+day+' dinner');remove.title='Remove '+day+' dinner';
  const show=()=>{
   closeMenus(menu);menu.classList.remove('bbpc-menu-above');menu.hidden=false;trigger.setAttribute('aria-expanded','true');
   const nav=doc.getElementById('bbPrimaryNavigation'),bottom=Math.min(window.innerHeight-12,nav?.getBoundingClientRect().top-8||window.innerHeight-12);
   if(menu.getBoundingClientRect().bottom>bottom)menu.classList.add('bbpc-menu-above');
   remove.focus({preventScroll:true});
  };
  trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(menu.hidden)show();else{menu.hidden=true;trigger.setAttribute('aria-expanded','false');}});
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();show();}});
  wrap.addEventListener('focusout',event=>{if(pointerMenu!==wrap&&!wrap.contains(event.relatedTarget)&&!doc.getElementById('bbQaConfirmOverlay')){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}});
  toggle.append(wrap);wrap.append(trigger,menu);menu.append(remove);
 }
 function refresh(){
  queued=false;
  const app=doc.querySelector('#app.bbnext-plan[data-bb-compact-plan="true"]');if(!app)return;
  const card=app.querySelector('#bbpolAutofillCard'),actions=card?.querySelector(':scope>.bbnext-plan-actions');
  if(!app.querySelector('.bbpc-budget-overview')||!card?.querySelector('.bbpc-filter-row')||
   !actions?.querySelector(':scope>.bb-pantry-first-controls')||!actions.querySelector(':scope>[data-bb-start-next-week]')||
   !actions.querySelector('#bb172FillSixDinners')||!actions.querySelector('.bbnext-plan-secondary')||
   !card.querySelector(':scope>#bbnextPlanAutofill')||!app.querySelector('#bbSimplePlannerTabs'))return;
  if(app.dataset.bbCompactHeader!=='true')app.dataset.bbCompactHeader='true';
  polishWeekOverview(app);
  // The delegated mode/week handlers depend on their current DOM parents.
  // This native disclosure reveals those same secondary controls with CSS;
  // it never moves, clones, clicks or replaces a planning control.
  const filters=card.querySelector('.bbpc-filter-row');
  const add=actions.querySelector('.bbnext-plan-secondary:not(#bbPantryPlannerButton)');
  if(!filters.id)filters.id='bbPlanSecondaryOptions';
  if(add&&!add.id)add.id='bbPlanAddMealControl';
  let more=card.querySelector(':scope>.bbpc-more-options');
  if(!more){
   more=doc.createElement('details');more.className='bbpc-more-options';more.id='bbPlanMoreOptions';
   const summary=doc.createElement('summary');summary.textContent='More options';
   summary.setAttribute('aria-controls',[filters.id,add?.id].filter(Boolean).join(' '));
   more.append(summary);card.append(more);
  }
  const clear=app.querySelector('#clearWeek');
  if(clear&&clear.parentNode!==more)more.append(clear);
  const controls=[filters.id,add?.id,clear?.id].filter(Boolean).join(' '),summary=more.querySelector?.('summary')||more.children[0];
  if(summary?.getAttribute?.('aria-controls')!==controls)summary?.setAttribute('aria-controls',controls);
  const mode=actions.querySelector('[data-bb-pantry-first-mode="pantry-first"]');
  if(mode){
   const spelling=window.BasketBossMarket?.get?.()==='US'?'Prioritize':'Prioritise';
   const text=mode.textContent.replace(/\bPrioriti[sz]e\b/,spelling);if(mode.textContent!==text)mode.textContent=text;
  }
  for(const row of app.querySelectorAll?.('.bbnext-day[data-bbnext-day]')||[])polishDay(row);
  // Existing validation may open Budget or preferences after a failed save.
  // Keep the owner's actual feedback visible instead of hiding an open form.
  if(card.querySelector('#bbSimpleBudget[open],#bbSimpleMealPreferences[open],#bbAvoidIngredientTab[aria-expanded="true"]'))more.open=true;
  const heading=app.querySelector('#bb1759MealsSummary>.bb1759-summary-heading');
  const paragraph=heading?.querySelector('p');
  if(paragraph&&!paragraph.closest('.bb-plan-compact-tips')){
   const details=doc.createElement('details');details.className='bb-plan-compact-tips';
   const summary=doc.createElement('summary');summary.textContent='Tap a day to plan · More tips';
   paragraph.before(details);details.append(summary,paragraph);
  }
 }
 // The simple layout creates our prerequisites in the same mutation turn.
 // Converge before paint instead of showing another intermediate Plan frame.
 function schedule(){if(queued)return;queued=true;queueMicrotask(refresh);}
 function start(){
  const app=doc.getElementById('app');if(!app)return;
  refresh();new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
  // Menu padding is decoration, not a tap on the underlying day summary.
  for(const type of ['pointerdown','touchstart','click'])window.addEventListener?.(type,event=>{
   if(event.target?.closest?.('.bbpc-meal-menu')&&!event.target.closest('button')){event.preventDefault();event.stopPropagation();}
  },{capture:true,passive:false});
  doc.addEventListener?.('pointerdown',event=>{
   if(pointerFinish!==null){window.clearTimeout(pointerFinish);pointerFinish=null;}
   pointerMenu=event.button===0?event.target?.closest?.('.bbpc-meal-overflow'):null;
   if(!event.target?.closest?.('.bbpc-meal-overflow')&&!doc.getElementById('bbQaConfirmOverlay'))closeMenus();
  },true);
  // Keep the pressed action present through mouseup and click, even if the
  // browser moves focus during mousedown. Otherwise click reaches the summary.
  doc.addEventListener?.('pointerup',event=>{if(pointerMenu&&!pointerMenu.contains(event.target))deferPointerFinish();},true);
  doc.addEventListener?.('pointercancel',finishPointerMenu,true);
  doc.addEventListener?.('click',event=>{
   if(!pointerMenu)return;
   const button=event.target?.closest?.('button');
   if(button&&pointerMenu.contains(button)&&!button.disabled)button.focus({preventScroll:true});
   deferPointerFinish();
  },true);
  doc.addEventListener?.('keydown',event=>{
   if(event.key==='Tab'||event.key==='Escape'){if(pointerFinish!==null)window.clearTimeout(pointerFinish);pointerMenu=null;pointerFinish=null;}
   const wrap=event.target?.closest?.('.bbpc-meal-overflow'),menu=wrap?.querySelector('.bbpc-meal-menu');
   if(event.key==='Escape'&&menu&&!menu.hidden){event.preventDefault();event.stopPropagation();closeMenus();wrap.querySelector('.bbpc-overflow-trigger')?.focus();}
  },true);
  window.addEventListener?.('basketboss:market-changed',schedule);
  // Browser scrolling to a lower day's trigger can finish after it opens.
  // Keep that menu reachable; outside taps, focus changes and Escape close it.
 }
 window.BBPlanCompact=Object.freeze({refresh});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
