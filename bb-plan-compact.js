/* Presentation only. Preserve real controls and handlers; only disclosure,
   text labels and layout wrappers are owned by this adapter. */
(()=>{'use strict';
 if(window.BBPlanCompact)return;
 const doc=document;let queued=false;
 function closeMenus(except=null){
  for(const menu of doc.querySelectorAll?.('.bbpc-meal-menu')||[]){
   if(menu===except)continue;menu.hidden=true;
   menu.parentNode?.querySelector('.bbpc-overflow-trigger')?.setAttribute('aria-expanded','false');
  }
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
  wrap.addEventListener('focusout',event=>{if(!wrap.contains(event.relatedTarget)&&!doc.getElementById('bbQaConfirmOverlay')){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}});
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
 function schedule(){if(queued)return;queued=true;window.requestAnimationFrame(refresh);}
 function start(){
  const app=doc.getElementById('app');if(!app)return;
  refresh();new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
  // Menu padding is decoration, not a tap on the underlying day summary.
  for(const type of ['pointerdown','touchstart','click'])window.addEventListener?.(type,event=>{
   if(event.target?.closest?.('.bbpc-meal-menu')&&!event.target.closest('button')){event.preventDefault();event.stopPropagation();}
  },{capture:true,passive:false});
  doc.addEventListener?.('pointerdown',event=>{if(!event.target?.closest?.('.bbpc-meal-overflow')&&!doc.getElementById('bbQaConfirmOverlay'))closeMenus();},true);
  doc.addEventListener?.('keydown',event=>{
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
