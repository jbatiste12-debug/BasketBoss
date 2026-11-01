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
 const regionValue=()=>{
   const value=typeof window.bb307ActiveMarket==='function'?window.bb307ActiveMarket():$('#bb307Island')?.value;
   return value==='US'?'United States':value||'Choose region';
 };
 function updateHeader(){
   const region=$('#bbpolRegionPill');if(region)region.textContent=regionValue()+' · Change';
   const upgrade=$('#bbpolUpgradePill');if(upgrade){upgrade.hidden=false;const status=window.BasketBossVerifiedPremium?.state?.();const label=window.BasketBossMembershipUI?.label?.()||(premiumActive()?'PREMIUM':status==='free'?'FREE · Upgrade to Premium':status==='checking'?'Checking membership…':'Check membership');if(upgrade.textContent!==label)upgrade.textContent=label;upgrade.setAttribute('aria-label',label);}
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
     if(window.BasketBossPremiumPreview?.show) window.BasketBossPremiumPreview.show(upgrade,'Discover 500 recipes, smarter Auto-Fill and more shopping tools.');
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
   setupHeader();decorateBudget();decorateMealRows();enhanceExistingProDialog();
   const app=$('#app');if(app){
     const observer=new MutationObserver(()=>{decorateBudget();decorateMealRows();enhanceExistingProDialog();});
     observer.observe(app,{childList:true,subtree:true});
   }
   // The original Smart Auto-Fill modal is attached to document.body.
   const dialogObserver=new MutationObserver(enhanceExistingProDialog);
   dialogObserver.observe(document.body,{childList:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,0),{once:true});
 else setTimeout(start,0);
})();
