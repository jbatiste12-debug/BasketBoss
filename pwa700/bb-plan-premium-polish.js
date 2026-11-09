/* BasketBoss presentation-only Plan + upgrade touchpoints (Oct 2026).
   Existing DOM IDs, budget calculations, event handlers, pricing requests,
   entitlements and customer data stay owned by the original app.
   Never synthesise a click on a checkout / Paddle button. */
(()=>{'use strict';
 const $=(selector,root=document)=>root.querySelector(selector);
 const premiumActive=()=>window.BasketBossVerifiedPremium?.isActive?.()===true;
 const checkoutPage='pricing-sandbox.html#monthly';
 let headerReady=false;
 let liveBudgetObserver=null;
 let closingPlanPopover=false;
 function sizePlanPopovers(card){
   if(!card)return;
   const bottom=window.visualViewport?window.visualViewport.height+window.visualViewport.offsetTop:window.innerHeight;
   const space=Math.max(120,Math.min(480,Math.floor(bottom-card.getBoundingClientRect().bottom-116)));
   const value=space+'px';if(card.style.getPropertyValue('--bbpc-popover-height')!==value)card.style.setProperty('--bbpc-popover-height',value);
 }
 const regionValue=()=>{
   const value=typeof window.bb307ActiveMarket==='function'?window.bb307ActiveMarket():$('#bb307Island')?.value;
   return value==='US'?'United States':value||'Choose region';
 };
 function updateHeader(){
   const compact=['week','shop'].includes(document.body.dataset.bbnextView),name=regionValue(),regionLabel=(compact&&name==='United States'?'US':name)+' · Change';
   document.body.classList.toggle('bbpol-compact-header',compact);
   const region=$('#bbpolRegionPill');if(region){if(region.textContent!==regionLabel)region.textContent=regionLabel;region.title=name+' · Change region';region.setAttribute('aria-label','Shopping region: '+name+'. Change region.');}
   const upgrade=$('#bbpolUpgradePill');if(upgrade){upgrade.hidden=false;const status=window.BasketBossVerifiedPremium?.state?.();const label=window.BasketBossMembershipUI?.label?.()||(premiumActive()?'PREMIUM':status==='free'?'FREE · Upgrade to Premium':status==='checking'?'Checking membership…':'Check membership');const display=compact?(premiumActive()?'PREMIUM':['free','signed_out'].includes(status)?'Upgrade':status==='checking'?'Checking':'Account'):label;if(upgrade.textContent!==display)upgrade.textContent=display;upgrade.setAttribute('aria-label',label);upgrade.title=label;}
 }
 function setupHeader(){
   if(headerReady)return;
   const top=$('.shell > header.top'),actions=top?.querySelector('.bbui-header-actions');
   const gear=$('#bbuiOpenSettings'),card=$('#bb17RegionCard');
   if(!top||!actions||!gear||!card)return;
   headerReady=true;
   // Move the ORIGINAL region card, never copy its select or save button.
   // All pre-existing element listeners remain attached to the same nodes.
   actions.insertBefore(card,gear);
   card.classList.add('bbpol-region-popover');
   const region=document.createElement('button');region.type='button';region.id='bbpolRegionPill';region.className='bbpol-header-pill';region.setAttribute('aria-label','Change shopping region');
   region.addEventListener('click',()=>{
     const existing=$('.bb17513-region-change',card);
     if(existing) existing.click();
     else $('#bb307Island',card)?.focus({preventScroll:true});
   });
   const upgrade=document.createElement('button');upgrade.type='button';upgrade.id='bbpolUpgradePill';upgrade.className='bbpol-header-pill bbpol-upgrade';upgrade.textContent=window.BasketBossMembershipUI?.label?.()||'Checking membership…';
   upgrade.addEventListener('click',()=>{
     if(window.BasketBossMembershipUI?.open){window.BasketBossMembershipUI.open();return;}
     if(premiumActive()){$('#bbuiOpenSettings')?.click();return;}
     // Existing introductory Premium modal checks entitlement and provides
     // its configured route; never introduce a new checkout authorisation.
     if(window.BasketBossPremiumPreview?.show) window.BasketBossPremiumPreview.show(upgrade,'Discover 700 recipes, smarter Auto-Fill and more shopping tools.');
     else if(window.BBIntroTrialOffer?.open) void window.BBIntroTrialOffer.open();
     else window.location.assign(checkoutPage);
   });
   actions.insertBefore(region,card);actions.insertBefore(upgrade,card);
   window.addEventListener('basketboss:market-changed',updateHeader);
   document.addEventListener('basketboss:premium-verified',updateHeader);
   $('#bb307SaveMarket',card)?.addEventListener('click',()=>queueMicrotask(updateHeader));
   $('#bb307Island',card)?.addEventListener('change',()=>queueMicrotask(updateHeader));
   updateHeader();
   // The verified Premium status may arrive asynchronously from the existing
   // server check. This only reads its already-exposed boolean; no new requests.
   window.setInterval(updateHeader,6000);
 }
 function decorateBudget(){
   const donut=$('#app.bbnext-plan .bbnext-plan-donut');
   if(!donut||donut.dataset.bbpolRing)return;
   donut.closest('.bbnext-plan-budget')?.setAttribute('data-bb-budget-polish','premium');
   liveBudgetObserver?.disconnect();
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
   svg.setAttribute('viewBox','0 0 100 100');svg.classList.add('bbpol-ring-svg');svg.setAttribute('aria-hidden','true');
   const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
   defs.innerHTML='<linearGradient id="bbpolBudgetGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#72a987"/><stop offset="48%" stop-color="#2c7c55"/><stop offset="100%" stop-color="#174e38"/></linearGradient>';
   const make=(className)=>{const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','50');circle.setAttribute('cy','50');circle.setAttribute('r','42');circle.classList.add(className);return circle;};
   const detail=make('bbpol-ring-detail');detail.setAttribute('r','49');
   const track=make('bbpol-ring-track'),progress=make('bbpol-ring-progress');
   svg.append(defs,detail,track,progress);
   donut.insertBefore(svg,donut.firstChild);
   donut.dataset.bbpolRing='1';
   const update=()=>{
     // Read percentage produced by the ORIGINAL budget calculation, not a
     // second calculation or storage key. It already caps aria-valuenow 0–100.
     const n=Math.max(0,Math.min(100,Number(donut.getAttribute('aria-valuenow'))||0));
     progress.style.strokeDashoffset=String(2*Math.PI*42*(1-n/100));
     progress.style.opacity=n>0?'1':'0';
     const colour=donut.style.getPropertyValue('--bb77-budget-color')||'#287646';
     progress.style.stroke=colour==='#287646'?'url(#bbpolBudgetGradient)':colour;
   };
   update();
   liveBudgetObserver=new MutationObserver(update);
   liveBudgetObserver.observe(donut,{attributes:true,attributeFilter:['aria-valuenow','style']});
 }
 function decorateMealRows(){
   const app=$('#app.bbnext-plan');if(!app)return;
   for(const row of app.querySelectorAll('.bbnext-day.has-meal:not(.is-locked)')){
     const meta=$('.bbnext-day-description small',row);
     if(!meta||meta.classList.contains('bbpol-meta-done'))continue;
     // Keep legacy meal metadata focused on cooking time; prices live in Shop.
     const value=meta.textContent||'';
     const m=value.match(/^(.+?\bmin)(?:\s*·.*)?$/i);
     if(!m)continue;
     meta.classList.add('bbpol-meta-done');
     const time=document.createElement('span');
     time.className='bbpol-time';
     time.textContent='◷ '+m[1];
     meta.replaceChildren(time);
   }
 }
 function decorateAutofill(){
   const app=$('#app.bbnext-plan');if(!app)return;
   const actions=$('.bbnext-plan-actions',app),filters=$('.bb81-pro-filters',app);
   if(!actions||!filters)return;
   let card=$('#bbpolAutofillCard',app);
   if(!card){
     card=document.createElement('section');card.id='bbpolAutofillCard';card.className='bbpol-autofill-card';
     card.setAttribute('aria-label','Plan your week');
     filters.before(card);
   }
   const disclosure=$('#bbnextPlanAutofill',app),schedule=$('#bb1759MealsSummary',app);
   let row=$('.bbpc-filter-row',card);
   if(!row){row=document.createElement('div');row.className='bbpc-filter-row';row.setAttribute('role','group');row.setAttribute('aria-label','Planning options');card.append(row);}
   // Move original controls once; all existing entitlement checks, quantities,
   // form drafts and native disclosure handlers stay with their owners.
   const move=(parent,node,index)=>{if(node&&parent.children[index]!==node)parent.insertBefore(node,parent.children[index]||null);};
   move(card,row,0);move(card,actions,1);
   const settings=$('#bbSimpleBudget',app),ingredients=$('#bbIngredientPicker',app),pantry=$('#bbPantryPlannerButton',app),budget=$('.bbnext-plan-budget',app);
   const options=[settings,filters,ingredients].filter(Boolean);options.forEach((node,index)=>move(row,node,index));
   const avoid=ingredients?.querySelector('#bbAvoidIngredientTab'),count=ingredients?.querySelector('.bb-avoid-count')?.textContent||'None selected';
   if(avoid){const amount=count.match(/^\d+/)?.[0]||'0';if(avoid.dataset.bbpcCount!==amount)avoid.dataset.bbpcCount=amount;const label='Ingredients to avoid, '+count.toLowerCase();if(avoid.getAttribute('aria-label')!==label)avoid.setAttribute('aria-label',label);}
   if(pantry){
     if(pantry.textContent!=='✨ Autofill empty days using pantry stock')pantry.textContent='✨ Autofill empty days using pantry stock';
     pantry.setAttribute('aria-label','Autofill empty days using pantry stock');
     pantry.title='Autofill empty days using pantry stock';
   }
   if(disclosure){
     move(card,disclosure,2);
     const summary=$(':scope > summary',disclosure);
     if(summary){if(summary.textContent!=='ⓘ')summary.textContent='ⓘ';summary.setAttribute('aria-label','How Auto-fill works');summary.title='How Auto-fill works';}
     let body=$('.bbpc-info-content',disclosure);
     if(!body){body=document.createElement('div');body.className='bbpc-info-content';disclosure.append(body);}
     for(const node of [...disclosure.children])if(node!==summary&&node!==body)body.append(node);
     if(pantry&&body.firstElementChild!==pantry)body.prepend(pantry);
   }
   if(schedule){
     app.dataset.bbCompactPlan='true';
     if(budget){if(app.firstElementChild!==budget)app.prepend(budget);if(budget.nextElementSibling!==card)budget.after(card);}
     else if(app.firstElementChild!==card)app.prepend(card);
     if(card.nextElementSibling!==schedule)card.after(schedule);
     let previous=schedule;
     for(const node of[app.querySelector('[data-bb307-extras="week"]'),app.querySelector('.bbsw-next-step')].filter(Boolean)){
       if(previous.nextElementSibling!==node)previous.after(node);previous=node;
     }
   }
   const heading=$('.bb81-pro-filters-heading strong',filters),badge=$('.bb81-pro-filters-heading span',filters);
   if(heading&&heading.textContent!=='Smart Auto-Fill')heading.textContent='Smart Auto-Fill';
   if(badge){
     if(!badge.dataset.bbpolOriginalLabel){badge.dataset.bbpolOriginalLabel=badge.textContent;badge.setAttribute('title',badge.textContent);}
     if(badge.textContent!=='Premium filters')badge.textContent='Premium filters';
   }
   // Keep the original explanatory note available in the original disclosure,
   // leaving the everyday action area compact rather than repeating its copy.
   const note=$('.bb81-pro-filter-note',filters);
   const infoBody=disclosure?.querySelector('.bbpc-info-content');
   if(note&&infoBody&&note.parentNode!==infoBody)infoBody.append(note);
   const working=$('#bb172FillSixDinners',actions);
   card.dataset.bbAutofillReady=working&&pantry&&disclosure?'true':'false';
   sizePlanPopovers(card);
 }
 function closePlanPopovers(event){
   if(closingPlanPopover)return;
   const card=$('#app[data-bb-compact-plan="true"] #bbpolAutofillCard');if(!card)return;
   sizePlanPopovers(card);
   const escape=event.type==='keydown'&&event.key==='Escape';if(event.type==='keydown'&&!escape)return;
   const details=[...card.querySelectorAll('#bbSimpleBudget,#bbSimpleMealPreferences,#bbnextPlanAutofill')];
   let focus;
   for(const node of details)if(node.open&&(escape||!node.contains(event.target))){node.open=false;if(escape)focus=node.querySelector('summary');}
   const ingredients=$('#bbIngredientPicker',card),toggle=$('#bbAvoidIngredientTab',ingredients||card);
   if(toggle?.getAttribute('aria-expanded')==='true'&&(escape||!ingredients.contains(event.target))){closingPlanPopover=true;try{toggle.click();}finally{closingPlanPopover=false;}if(escape)focus=toggle;}
   if(escape&&focus){event.preventDefault();focus.focus({preventScroll:true});}
 }
 function enhanceExistingProDialog(){
   const dialog=$('#bb81PremiumPreviewDialog');if(!dialog||$('#bbpolDirectPlans',dialog)||premiumActive())return;
   const actions=$('.bb81-pro-modal-buttons',dialog);if(!actions)return;
   const link=document.createElement('a');link.id='bbpolDirectPlans';link.href=checkoutPage;
   link.className='bbpol-direct-plans';link.textContent='Choose a secure Premium plan →';
   link.setAttribute('aria-label','View monthly Premium plans and continue using the existing secure Paddle checkout');
   actions.append(link);
   const hint=$('.bb81-pro-hint',dialog);
   if(hint)hint.textContent='Your free plan stays available. Premium checkout requires an account, and eligibility and renewal terms are confirmed securely before payment.';
 }
 function start(){
   setupHeader();decorateBudget();decorateMealRows();decorateAutofill();enhanceExistingProDialog();
   const app=$('#app');if(app){
     const observer=new MutationObserver(()=>{updateHeader();decorateBudget();decorateMealRows();decorateAutofill();enhanceExistingProDialog();});
     observer.observe(app,{childList:true,subtree:true});
   }
   // The original Smart Auto-Fill modal is attached to document.body.
   const dialogObserver=new MutationObserver(enhanceExistingProDialog);
   dialogObserver.observe(document.body,{childList:true});
   document.addEventListener('click',closePlanPopovers);
   document.addEventListener('keydown',closePlanPopovers);
   let sizeFrame=null;
   const resizePlan=()=>{if(sizeFrame!==null)return;sizeFrame=requestAnimationFrame(()=>{sizeFrame=null;sizePlanPopovers($('#app[data-bb-compact-plan="true"] #bbpolAutofillCard'));});};
   window.addEventListener('resize',resizePlan,{passive:true});window.addEventListener('scroll',resizePlan,{passive:true});window.visualViewport?.addEventListener('resize',resizePlan,{passive:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,0),{once:true});
 else setTimeout(start,0);
})();
