/* BasketBoss 17.5.13: A guided tour OVER the real application, not a demo copy.
   Read-only tour: only existing tab-navigation and My Week display clicks occur.
   No settings, meal plans, pantry, payments or account data are changed. */
(function(){
 'use strict';
 const isCook=/\bmake-a-meal\.html$/i.test(location.pathname);
 const mainSteps=[
  {title:'Welcome to your BasketBoss',desc:'You are looking at the real BasketBoss app. This guide will show you where everything lives, without changing your meals, shopping list or account.',tip:'The soft slate-grey background, rounded cards and green buttons are your new BasketBoss design.',target:'.shell .hero',tab:'overview'},
  {title:'Choose region and supermarket',desc:'Choose Jersey, Guernsey, the UK or the US, then use Where are you shopping? to pick a supermarket from that region’s list. Each region remembers its own supermarket. You can also change it in Shopping.',tip:'Dated online guides cover selected UK products; regional estimates fill gaps. The tutorial never saves a choice.',target:'#bb17RegionCard',tab:'overview'},
  {title:'Your BasketBoss account',desc:'The real Sign in / Create account button is at the top of the app. You can open it yourself when ready; this tour will never enter personal details or submit an account form.',tip:'Your existing local meal and shopping information is not reset by this walkthrough.',target:'#bb16AccountShortcut',tab:'overview'},
  {title:'Your six navigation buttons',desc:'These are your real app tabs: Overview, Discover, Planner, Kitchen, Shopping and Cook. On iPhone they appear together in one compact fixed row.',tip:'All six sections stay accessible. The bar should not block your screen.',target:'.shell .tabs',tab:'overview'},
  {title:'Overview is your home',desc:'Your Overview stays uncluttered and introduces your week at a glance. It is not replaced by the full planning dashboard.',tip:'The larger weekly snapshot is one tap away.',target:'.bb16-overview-heading',tab:'overview'},
  {title:'Open View My Week',desc:'This is the actual View My Week button. It opens one combined weekly snapshot — not seven separate pages.',tip:'Select Continue to open the real snapshot now.',target:'[data-bb16-go="my-week"]',tab:'overview'},
  {title:'My Week — your real plan',desc:'The snapshot shows your current week, using the meals and settings you have actually saved. Any unplanned dinners appear as open slots.',tip:'Swipe the meal cards sideways on your iPhone.',target:'#bbUiMyWeek .bb-ui-week-top',tab:'myweek'},
  {title:'Weekly budget',desc:'Here you can see your chosen budget, estimated spending and how much remains. The amount still to buy is shown separately.',tip:'Figures are calculated by BasketBoss and are indicative estimates.',target:'#bbUiMyWeek .bb-ui-week-panel:first-child',tab:'myweek'},
  {title:'Meals, lunches and shopping',desc:'My Week also shows Monday–Sunday dinners, a shopping preview and school lunches, plus shortcuts to the full editing screens.',tip:'It is a snapshot. Edit actual plans from Planner and shopping items from Shopping.',target:'#bbUiMyWeek .bb-ui-meal-strip',tab:'myweek'},
  {title:'Discover recipes',desc:'This is where you browse and search the real recipe collection. Free members see the free selection, and locked premium features are subject to your account access.',tip:'Use the search field or browse recipes. The tour does not add any to your plan.',target:'#recipeSearch',tab:'discover'},
  {title:'Plan your dinners',desc:'In Planner you can choose dinners for Monday through Sunday, use planning shortcuts and manage school lunches and essentials.',tip:'Servings scale ingredient quantities first, then packs. Meal estimates count only the share of cupboard staples used.',target:'#app .section-head',tab:'week'},
  {title:'School lunches',desc:'Your school-lunch planning tools are part of the Planner. Choose lunches and review the amounts before shopping.',tip:'The tutorial only points out the editor; it will not change anything.',target:'#bb1756Lunchboxes',tab:'week',optional:true},
  {title:'Kitchen — what have I got?',desc:'Use Kitchen to keep track of ingredients already in your cupboard, fridge or freezer. BasketBoss can use these records when calculating what you still need.',tip:'Only you can update the real pantry selections.',target:'.shell .tabs [data-tab="shop"]',tab:'shop'},
  {title:'Shopping list',desc:'Shopping combines your meals, lunches and essentials, deducting recognised pantry stock. Choose your supermarket here too. Unlike a meal’s share of cupboard staples, Shopping includes full replacement packs when needed.',tip:'Save your usual brand and price; optional Premium receipt scanning at the end of your shop suggests matches you review before saving for future estimates.',target:'.shell .tabs [data-tab="shop-list"]',tab:'shop-list'},
  {title:'Install on your iPhone',desc:'BasketBoss can be added to your Home Screen. In Safari, use Share → Add to Home Screen where supported, or follow the existing Install BasketBoss guidance in the app.',tip:'The tutorial does not install anything or change browser permissions.',target:'.bb173-install-banner, [data-bb173-install-open]',tab:'overview',optional:true},
  {title:'Cook — Make a Meal',desc:'The Cook button opens the real Make a Meal page, where you can manage ingredients and explore cooking tools. Some AI features require Premium and configured services.',tip:'Continue to see Make a Meal itself, or close the tour to explore on your own.',target:'.shell .tabs .bb173-make-meal-link',tab:'shop-list',nextLabel:'Show Make a Meal →'}
 ];
 const cookSteps=[
  {title:'The real Make a Meal screen',desc:'You are now inside Make a Meal, with the same BasketBoss branding and the Back to BasketBoss link.',tip:'This is the real app, not an illustration.',target:'.bb17513-meal-brand, .brand'},
  {title:'Choose how to cook',desc:'The real Make a Meal dashboard provides ingredient scanning and meal creation. Check any Premium labels before using a feature.',tip:'Touring does not start AI scanning or a checkout.',target:'#bbDashboardTitle'},
  {title:'Scan ingredients',desc:'This is the Scan Ingredients control. In the app, review recognised ingredients carefully before saving them.',tip:'Actual scanning may need Premium, permissions and a configured AI backend.',target:'.bb-action-scan'},
  {title:'Create a Meal',desc:'Create a Meal suggests a dish based on ingredients you provide. It is marked Premium where the app requires access.',tip:'The guided tour does not send requests or generate a recipe.',target:'.bb-action-meal'},
  {title:'Manage your ingredients',desc:'Review scanned and manually added ingredients before building a meal. You remain in control of what goes into the list.',tip:'Nothing has been added or removed by this tutorial.',target:'#bbScannedTitle'},
  {title:'Ready to use BasketBoss?',desc:'You can return to the main BasketBoss app to plan your week, shop and cook. Reopen Tutorial whenever you need a refresher.',tip:'Tap Finish to return to BasketBoss.',target:'.bb17513-meal-back, .back',nextLabel:'Finish →'}
 ];
 const steps=isCook?cookSteps:mainSteps;
 const qs=s=>document.querySelector(s);
 let current=-1,card=null,spot=null,active=false,restoreFocus=null,tick=0;
 const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 function findTarget(step){
  if(!step)return null;
  for(const selector of String(step.target||'').split(',').map(x=>x.trim())){
   const el=qs(selector);
   if(el && el.getClientRects().length && getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none')return el;
  }
  return null;
 }
 function goTab(tab){
  if(isCook)return;
  if(tab==='myweek'){
   const overview=qs('.shell .tabs [data-tab="overview"]');
   if(!qs('.bb16-overview'))overview?.click();
   const week=qs('#bbUiMyWeek');
   if(week?.hidden)qs('[data-bb16-go="my-week"]')?.click();
   return;
  }
  const btn=qs('.shell .tabs [data-tab="'+tab+'"]');
  if(btn && !btn.classList.contains('active'))btn.click();
  if(tab==='overview' && qs('#bbUiMyWeek')?.hidden===false){
   qs('[data-bb16-go="overview"]')?.click();
  }
 }
 function clearLocation(){
  try{const u=new URL(location.href);u.searchParams.delete('bb_tour');u.searchParams.delete('bb_step');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}catch(_){}
 }
 function close(){
  active=false; ++tick;
  card?.remove();spot?.remove();card=null;spot=null;
  document.removeEventListener('keydown',onKey);
  window.removeEventListener('scroll',position,true);
  window.removeEventListener('resize',position);
  clearLocation();
  if(restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});
 }
 function onKey(e){
  if(e.key==='Escape'){e.preventDefault();close();}
  else if(e.key==='ArrowRight' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();show(current+1);}
  else if(e.key==='ArrowLeft' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();show(current-1);}
 }
 function position(){
  if(!active||!spot||!card)return;
  const el=findTarget(steps[current]);
  const vw=innerWidth,vh=innerHeight,pad=9;
  spot.style.display=el?'block':'none';
  if(el){
   const r=el.getBoundingClientRect();
   const x=Math.max(6,r.left-pad),y=Math.max(6,r.top-pad);
   spot.style.left=x+'px'; spot.style.top=y+'px';
   spot.style.width=Math.max(14,Math.min(vw-x-6,r.width+2*pad))+'px';
   spot.style.height=Math.max(14,Math.min(vh-y-6,r.height+2*pad))+'px';
  }
  const cr=card.getBoundingClientRect(),h=cr.height,w=cr.width;
  const r=el?.getBoundingClientRect();
  const below=r ? r.bottom+18 : 20;
  const above=r ? r.top-h-18 : 20;
  let top=20;
  if(r){
   if(below+h<=vh-12)top=below;
   else if(above>=12)top=above;
   else top=Math.max(12,Math.min(vh-h-12,r.top+(r.height/2)-h/2));
  }
  top=Math.max(10,Math.min(top,vh-h-10));
  let left=Math.max(10,Math.round((vw-w)/2));
  if(r && vw>720){left=Math.max(10,Math.min(vw-w-10,r.right+14));if(left<r.right+10)left=Math.max(10,r.left-w-14);}
  card.style.left=left+'px';card.style.top=top+'px';
 }
 function renderStep(){
  const s=steps[current];if(!s||!card)return;
  const end=current===steps.length-1;
  card.innerHTML=`<div class="bb-lt-header"><span class="bb-lt-eyebrow">Real BasketBoss tour · ${current+1} / ${steps.length}</span><button class="bb-lt-close" type="button" data-bb-tour="close" aria-label="Close guided tour">×</button></div>
   <div class="bb-lt-progress" aria-hidden="true"><span style="width:${((current+1)/steps.length)*100}%"></span></div>
   <h2 id="bb-live-tour-title" tabindex="-1">${escapeHtml(s.title)}</h2>
   <p>${escapeHtml(s.desc)}</p><div class="bb-lt-hint">${escapeHtml(s.tip)}</div>
   <div class="bb-lt-actions"><button type="button" class="bb-lt-button" data-bb-tour="back" ${current===0?'disabled':''}>← Back</button><button type="button" class="bb-lt-button bb-lt-next" data-bb-tour="next">${escapeHtml(s.nextLabel|| (end?'Finish ✓':'Continue →'))}</button></div>`;
  card.querySelector('[data-bb-tour="close"]').addEventListener('click',close);
  card.querySelector('[data-bb-tour="back"]').addEventListener('click',()=>show(current-1));
  card.querySelector('[data-bb-tour="next"]').addEventListener('click',()=>{
   if(end){
    if(isCook){close();location.assign(new URL('index.html',location.href));}
    else {close();location.assign(new URL('make-a-meal.html?bb_tour=cook',location.href));}
   }else show(current+1);
  });
  card.querySelector('h2')?.focus({preventScroll:true});
 }
 function show(n){
  if(!active)return;
  current=Math.max(0,Math.min(n,steps.length-1));
  const seq=++tick;
  goTab(steps[current].tab);
  renderStep();
  const settle=()=>{
   if(!active||seq!==tick)return;
   const el=findTarget(steps[current]);
   if(el && !el.closest('.tabs')){
    const r=el.getBoundingClientRect();
    if(r.top<20||r.bottom>innerHeight-95){
      el.scrollIntoView({block:r.height>innerHeight*.62?'start':'center',behavior:'instant'});
    }
   }
   requestAnimationFrame(position);
  };
  requestAnimationFrame(()=>requestAnimationFrame(settle));
  setTimeout(settle,220);
 }
 function start(at=0){
  if(active){show(at);return;}
  restoreFocus=document.activeElement;
  active=true;
  spot=document.createElement('div');spot.id='bb-live-tour-spot';spot.setAttribute('aria-hidden','true');
  card=document.createElement('section');card.id='bb-live-tour-card';card.setAttribute('role','dialog');
  card.setAttribute('aria-modal','false');card.setAttribute('aria-labelledby','bb-live-tour-title');
  document.body.append(spot,card);
  document.addEventListener('keydown',onKey);
  window.addEventListener('scroll',position,true);
  window.addEventListener('resize',position);
  show(at);
 }
 window.BBRealAppTour={start,close};
 function bind(){
  if(isCook){
   const back=qs('.bb17513-meal-back, .back');
   if(back && !qs('#bbRealTourCookLaunch')){
    const launch=document.createElement('button');
    launch.id='bbRealTourCookLaunch';
    launch.type='button';
    launch.textContent='Tour this screen';
    launch.setAttribute('aria-label','Start the guided tour of Make a Meal');
    launch.addEventListener('click',()=>start(0));
    back.insertAdjacentElement('afterend',launch);
   }
  }
  if(!isCook){
   const button=qs('#bb172TutorialLaunch');
   if(button){
    button.setAttribute('aria-label','Start guided tour inside the real BasketBoss app');
    button.title='Guided tour of the real app';
    button.addEventListener('click',e=>{e.preventDefault();start(0);});
   }
  }
  const params=new URLSearchParams(location.search);
  if(params.has('bb_tour')){
   const requested=Number(params.get('bb_step'));
   const at=Number.isInteger(requested)&&requested>=1?requested-1:0;
   // Do not suppress or overwrite the user's first-visit welcome or trial steps.
   // Start only after any existing onboarding overlays are dismissed.
   let tries=0;
   const attempt=()=>{
    if(qs('#bb173WelcomeSplash')||qs('#bb172Onboarding')||qs('#bbIntroTrialDialog[open]')){
      if(tries++<240)setTimeout(attempt,500);
      return;
    }
    if(!isCook&&!qs('.shell .tabs')){
      if(tries++<40)setTimeout(attempt,250);
      return;
    }
    start(at);
   };
   setTimeout(attempt,350);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
