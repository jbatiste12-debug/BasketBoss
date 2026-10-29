/* BasketBoss onboarding refinement — scoped, read-only tutorial screens.
 * Reuses existing crowned-basket motion and genuine free-recipe card data.
 * Never writes plan/pantry/billing/auth tokens; household & region go through
 * the existing app save and market handlers, only when the user finishes.
 */
(()=>{'use strict';
 const SHOW_FOUNDER_STORY=false;
 const KEY='bb_onboarding_fresh_once_20261028_v1'; // New rollout only: never clear earlier state or credentials.
 const PREVIEW_HOST='basketboss-preview.basketboss-site.pages.dev';
 const LOGO='icons/basketboss-crowned-v1766-512.png';
 const STEP_MAX=9;
 // Exact public Free recipe facts from the pinned recipes.json catalogue.
 // These are static read-only samples, never copies of user plans.
 const RECIPES=[
  {id:'fajitas',name:'Sheet-pan chicken fajitas',mins:30,servings:6,category:'Mexican · Family favourite',tag:'TRAYBAKE',cost:22.6,ingredientCount:8,image:'release-assets/basketboss-v17/images/existing/fajitas.webp',tip:'Set everything in the middle of the table and let everyone build their own.'},
  {id:'creamy-pasta',name:'Creamy garlic parmesan chicken pasta',mins:30,servings:4,category:'Italian · Comfort food',tag:'ONE-PAN',cost:15.11,ingredientCount:0,image:'release-assets/basketboss-v17/images/existing/creamy-pasta.webp'},
  {id:'chickpea-curry',name:'Creamy chickpea & spinach curry',mins:25,servings:4,category:'Vegetarian · Pantry-friendly',tag:'ONE-POT',cost:11.99,ingredientCount:0,image:'release-assets/basketboss-v17/images/existing/chickpea-curry.webp'}
 ];
 const HOUSE_SERVINGS={'Just me':1,'2 people':2,'3–4 people':4,'5+ people':5};
 const HOUSE=['Just me','2 people','3–4 people','5+ people'];
 const GOALS=['Spend less on groceries','Plan dinners faster','Waste less food','Make shopping simpler','Try new recipes'];
 const DIETS=['No specific preference','Vegetarian','Vegan','Gluten-free','Dairy-free'];
 const REGIONS=['UK','Jersey','Guernsey','US'];
 const id=x=>document.getElementById(x);
 const read=k=>{try{return localStorage.getItem(k)}catch(_){return null}};
 const write=(k,v)=>{try{localStorage.setItem(k,v);return localStorage.getItem(k)===v}catch(_){return false}};
 const validSession=()=>{try{const s=JSON.parse(read('basketboss_cloud_session_v1')||'null');return !!(s?.user?.id&&typeof s.access_token==='string'&&Number(s.expires_at)*1000>Date.now()+5000)}catch(_){return false}};
 const installed=()=>{try{return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}catch(_){return navigator.standalone===true}};
 const preview=()=>location.hostname===PREVIEW_HOST&&new URLSearchParams(location.search).get('bb_onboarding_v2_preview')==='1';
 function restoreState(){try{const v=JSON.parse(read(KEY)||'null');return v&&typeof v==='object'?v:null}catch(_){return null}}
 function willShow(){
   // The new version deliberately runs once for everyone, including signed-in
   // members and users with existing plans, without deleting older state.
   if(preview())return true;
   return restoreState()?.complete!==true;
 }
 // Returning and paying members keep their existing opening experience.
 window.BBOnboard2026={willShow,preview,getPreferences:()=>({house:state.house,region:state.region,goals:[...state.goals],diets:[...state.diets]})};
 // Founder story is retained on compare.html; no homepage element is modified here.
 function trimFounder(){return SHOW_FOUNDER_STORY;}
 let state=restoreState()||{step:0,house:'',goals:[],diets:[],region:'',started:false,complete:false};
 let host=null,form=null,message=null,formMarker=null,messageMarker=null,oldOverflow='';
 function persist(){return write(KEY,JSON.stringify({step:state.step,house:state.house,goals:state.goals,diets:state.diets,region:state.region,started:state.started,complete:state.complete}));}
 const btn=(label,action,kind='primary')=>`<button type="button" class="bbob-btn bbob-${kind}" data-bbob="${action}">${label}</button>`;
 // Reuse exactly the SVG basket/crown paths and keyframe names from the original
 // bb-welcome-splash.js / bb-welcome-splash.css. No second splash dialog fires.
 const originalCrownAnimation=()=>`<div class="bbob-original-logo-motion" role="img" aria-label="Animated BasketBoss crowned basket logo"><div class="bbob-motion-square"></div><svg class="bbob-motion-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true"><g class="bbob-motion-basket"><path d="M18 30 25 23M46 30 39 23" fill="none" stroke="#44484B" stroke-width="4" stroke-linecap="round"/><path d="M11 31h42l-5 24H16l-5-24Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path class="bbob-motion-slots" d="M22 38v10M32 38v10M42 38v10" stroke="#F8F8F8" stroke-width="4" stroke-linecap="round"/></g><g class="bbob-motion-crown"><path d="M22 18 18 10 27 14 32 6 37 14 46 10 42 18Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path d="M21 21h22" stroke="#44484B" stroke-width="3" stroke-linecap="round"/></g></svg></div>`;
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Real BasketBoss Discover DOM class names, not the fake cards from the mockup.
 // There are no active buttons, data-recipe, add-to-plan or shopping handlers.
 const recipeCard=(r,featured=false)=>`<article class="card ${featured?'bb-featured-card':'mini-recipe'} bbob-recipe-card" aria-label="Example recipe: ${esc(r.name)}"><div class="recipe-image"><img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" decoding="async"><span class="pill">${esc(r.tag)}</span><span class="time-pill">◷ ${r.mins} min</span></div><div class="recipe-body"><div class="eyebrow">${esc(r.category)} · serves ${r.servings}</div><h3>${esc(r.name)}</h3><div class="chips"><span class="chip">£${r.cost.toFixed(2)} estimated</span>${r.ingredientCount?`<span class="chip">${r.ingredientCount} ingredients</span>`:''}</div>${r.tip?`<div class="tip">${esc(r.tip)}</div>`:''}</div></article>`;
 function figure(key){
   const lead=RECIPES[0];
   if(key==='discover')return `<div class="bbob-figure bbob-recipe-gallery" aria-label="Read-only examples from the actual BasketBoss Free recipe catalogue"><div class="bbob-mock-top">REAL BASKETBOSS RECIPE CARDS <span>100 FREE</span></div>${recipeCard(lead,true)}<div class="bbob-more-recipes">${RECIPES.slice(1).map(r=>recipeCard(r)).join('')}</div><p class="bbob-preview-disclaimer">Example cards only. No recipe has been opened, saved or added to your plan. Estimates vary by region.</p></div>`;
   if(key==='plan')return `<div class="bbob-figure bbob-real-plan" aria-label="Read-only sample weekly meal plan"><div class="bbob-mock-top">YOUR WEEK · EXAMPLE ONLY <span>7 DAYS</span></div><div class="bbob-days"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span></div><div class="bbob-sample-day"><img src="${lead.image}" alt="${esc(lead.name)}" loading="lazy"><div><small>Monday · Dinner planned</small><strong>${esc(lead.name)}</strong><span>${lead.mins} min · serves ${lead.servings}</span></div></div><div class="bbob-mealrow">Tuesday <strong>Open dinner slot</strong></div><div class="bbob-mealrow">Wednesday <strong>Open dinner slot</strong></div><p class="bbob-preview-disclaimer">Illustration only. Your saved week is never changed by this tour.</p></div>`;
   // The eight rows below exactly reproduce the Free "fajitas" catalogue item's
   // names, quantities and indicative per-item prices (total £22.60). No writes.
   const groups=[
     ['Produce', [['Mixed peppers','3 peppers',2.48],['Lime','1',0.37]]],
     ['Meat & Fish', [['Chicken breast','1 kg',10.05]]],
     ['Cupboard', [['Tortilla wraps','12 medium tortilla wraps',1.77],['Fajita seasoning','2 tbsp',0.89],['Cooking oil','2 tbsp',0.30]]],
     ['Dairy & Chilled', [['Soured cream','180 g',2.13],['Cheddar','400 g',4.61]]]
   ];
   const total=groups.flatMap(([,rows])=>rows).reduce((sum,[,,price])=>sum+price,0);
   const rows=groups.map(([aisle,items])=>`<section class="bbob-shop-aisle" aria-label="${esc(aisle)}"><h3 class="bbob-aisle-heading">${esc(aisle)}</h3>${items.map(([name,quantity,price])=>`<div class="bbob-shop-item"><span class="bbob-shop-check" aria-hidden="true">○</span><div class="bbob-shop-item-name"><strong>${esc(name)}</strong><small>${esc(quantity)}</small></div><span class="bbob-shop-price">£${price.toFixed(2)} est.</span></div>`).join('')}</section>`).join('');
   return `<div class="bbob-figure bbob-real-shop" aria-label="Read-only BasketBoss aisle shopping example"><div class="bbob-mock-top">FAJITAS SHOPPING LIST · EXAMPLE <span>BY AISLE</span></div><div class="bbob-shop-total"><span>Indicative basket estimate</span><strong>£${total.toFixed(2)}</strong></div>${rows}<p class="bbob-preview-disclaimer">Real ingredients and indicative £ estimates from ${esc(lead.name)} (6 servings). Local market prices, pack sizes and pantry deductions vary. This example does not change your shopping list.</p></div>`;
 }

 function options(items,selected,multiple){return `<div class="bbob-options ${multiple?'bbob-goals':''}">${items.map((v,i)=>`<button type="button" class="bbob-option ${selected.includes(v)?'chosen':''}" data-bbob-opt="${i}" aria-pressed="${selected.includes(v)}"><span class="bbob-choice-mark" aria-hidden="true">${selected.includes(v)?'✓':' '}</span><span>${v}</span></button>`).join('')}</div>`;}
 const titles=['Welcome','Account','Household','Goals','Preferences','Discover','Plan','Shop','All set','Membership'];
 function content(){
   let headline='',eyebrow='',description='',art='',foot='',actions='';
   switch(state.step){
     case 0:
       eyebrow='WELCOME TO BASKETBOSS';headline=installed()? 'Thanks for downloading BasketBoss!' : 'Welcome to BasketBoss.';
       description='Plan Smarter. Eat Better. Less Waste. Plan solo today; Premium partner sharing for two phones is coming after secure activation.';
       art='<div class="bbob-intro-art bbob-restored-animation">'+originalCrownAnimation()+'<span>Built for real-life food shopping.</span></div>';
       actions=btn('Let’s get started','next')+btn('Browse 100 free recipes instead','free','link');break;
     case 1:
       eyebrow='YOUR ACCOUNT';
       if(validSession()){
         headline='You’re already signed in.';
         description='Your existing BasketBoss account and saved meals are ready. There is no need to sign in again.';
         art='<div class="bbob-auth-ready" role="status">✓ Your account is connected</div>';
         actions=btn('Continue setup','next')+btn('Explore Free','free','link');
       }else{
         headline='One account. Your plans, wherever you are.';
         description='Create a free account or sign in using the existing secure email form. No card needed. Plan solo now; Premium household sharing with one partner is being prepared for secure activation. If your email needs confirmation, you can continue setup and confirm later.';
         art='<div id="bbobAuthSlot" class="bbob-auth-slot"></div><div id="bbobMessageSlot" class="bbob-message-slot" aria-live="polite"></div>';
         foot='If you create an account, you may need to confirm your email before signing in.';
         actions=btn('Continue setup','next','outline')+btn('Explore Free without an account','free','link');
       }
       break;
     case 2:
       eyebrow='A LITTLE ABOUT YOUR HOUSEHOLD';headline='How many people are you usually cooking for?';
       description='Choose a starting household size and shopping region. These update your actual portions and estimated prices when you finish. Both can be changed later.';
       art=options(HOUSE,state.house?[state.house]:[],false)+`<label class="bbob-market-label" for="bbob-region">Where do you shop? (optional)<select id="bbob-region" data-bbob-region><option value="">Choose later in Settings</option>${REGIONS.map(r=>`<option value="${r}" ${state.region===r?'selected':''}>${r==='US'?'United States':r}</option>`).join('')}</select></label>`;
       actions=btn('Continue','next')+btn('Skip question','skip','link');break;
     case 3:
       eyebrow='WHAT MATTERS MOST';headline='What would make dinner easier?';
       description='Choose up to three. We save your answers on this device; this does not silently change recipes or meal plans.';
       art=options(GOALS,state.goals,true);actions=btn('Continue','next')+btn('Skip question','skip','link');break;
     case 4:
       eyebrow='YOUR PREFERENCES';headline='Any dietary preferences?';
       description='Optional. Saved on this device for future reference; recipes are NOT automatically filtered and allergens must always be checked on packaging.';
       art=options(DIETS,state.diets,true);actions=btn('Show me BasketBoss','next')+btn('Skip question','skip','link');break;
     case 5:
       eyebrow='STEP 1 OF 3 · DISCOVER';headline='Dinner ideas without the endless scrolling.';
       description='Explore 100 recipes free. Browse for something the family will actually enjoy.';
       art=figure('discover');actions=btn('Next · Meal planning','next')+btn('Back','back','link');break;
     case 6:
       eyebrow='STEP 2 OF 3 · PLAN';headline='A delicious week, sorted.';
       description='Pick dinners for each day. BasketBoss brings your week together in one place.';
       art=figure('plan');actions=btn('Next · Shopping lists','next')+btn('Back','back','link');break;
     case 7:
       eyebrow='STEP 3 OF 3 · SHOP';headline='One shopping list, organised by aisle.';
       description='Your meals become one clear aisle-by-aisle list, with useful cost estimates.';
       art=figure('shop');actions=btn('Finish the tour','next')+btn('Back','back','link');break;
     case 8:
       eyebrow='READY WHEN YOU ARE';headline='You’re all set.';
       description='Less time wondering what’s for dinner. More time enjoying it.';
       art='<div class="bbob-finish-art">'+originalCrownAnimation()+'<span class="bbob-sheen" aria-hidden="true"></span></div>';
       actions=btn('Choose how to get started','next');break;
     default:
       eyebrow='ONE LAST THING';headline='Choose your BasketBoss experience.';
       description='Start with BasketBoss Free or explore Premium. You decide — there’s no need to subscribe to use your free account.';
       art='<div class="bbob-plan-options"><div class="bbob-plan"><strong>BasketBoss Free</strong><b>£0</b><p>100 recipes and basic meal planning.</p><span>No card needed</span></div><div class="bbob-plan bbob-plan-premium"><strong>Premium / Founder offer</strong><b>See plans</b><p>Optional advanced planning and eligible Premium AI features. 👥 Shared Household Sync for one partner email (pending secure activation).</p><span>Standard Premium £4.99/month. Founder £1.99/month after a 7-day trial if eligible among the first 25 confirmed members. Final prices, renewals and trial terms are shown at checkout.</span></div></div>';
       foot='Standard is monthly, not annual. Founder eligibility is verified at checkout. Subscription checkout requires a signed-in account; payment, taxes and renewal terms are confirmed on the existing secure Paddle page.';
       actions=btn('Explore Premium plans','premium')+btn('Continue with BasketBoss Free','free-complete','outline');
   }
   const counter=state.step===0?'':`<div class="bbob-progress" aria-label="Onboarding step ${state.step} of ${STEP_MAX}"><span style="width:${Math.min(100,Math.round(100*state.step/STEP_MAX))}%"></span></div>`;
   return `<div class="bbob-shell"><header class="bbob-header"><div class="bbob-brand"><img src="${LOGO}" alt=""><span>Basket<span>Boss</span></span></div><button type="button" class="bbob-exit" data-bbob="free" aria-label="Exit onboarding and explore free recipes">Explore Free <span aria-hidden="true">×</span></button></header>${counter}<section class="bbob-main" aria-labelledby="bbob-title"><p class="bbob-eyebrow">${eyebrow}</p><h1 id="bbob-title">${headline}</h1><p class="bbob-description">${description}</p>${art}${foot?`<p class="bbob-footnote">${foot}</p>`:''}<p id="bbobSaveError" role="alert" class="bbob-save-error"></p></section><footer class="bbob-footer">${actions}<div class="bbob-stepname">${titles[state.step]} · ${state.step+1} of 10</div></footer></div>`;
 }
 function restoreAuth(){
   if(form&&formMarker?.parentNode)formMarker.parentNode.insertBefore(form,formMarker);
   if(message&&messageMarker?.parentNode)messageMarker.parentNode.insertBefore(message,messageMarker);
 }
 function mountAuth(){
   form=id('cloud-auth');message=id('cloud-message');
   if(!form||!message)return;
   if(!formMarker){formMarker=document.createComment('BasketBoss original Supabase auth position');form.parentNode.insertBefore(formMarker,form);}
   if(!messageMarker){messageMarker=document.createComment('BasketBoss original Supabase message position');message.parentNode.insertBefore(messageMarker,message);}
   id('bbobAuthSlot')?.appendChild(form);id('bbobMessageSlot')?.appendChild(message);
   form.hidden=false;
   id('cloud-email')?.focus({preventScroll:true});
 }
 function render(){if(!host)return;restoreAuth();host.innerHTML=content();
   if(state.step===1&&!validSession())mountAuth();
   host.scrollTop=0;host.querySelector('[data-bbob="next"]')?.focus({preventScroll:true});
 }
 // No changes to app state take place on preview, survey selection or Back.
 // Commit to the existing app's OWN setters only when the user exits onboarding.
 function applyChosenPreferences(){
   if(state.house){
     const servings=HOUSE_SERVINGS[state.house];
     if(servings&&typeof window.BasketBossSetOnboardingServings==='function'){
       if(window.BasketBossSetOnboardingServings(servings)!==true)return 'Could not save household servings. Please retry or choose Skip.';
     }else if(servings)return 'Household controls are unavailable. Please retry after refreshing.';
   }
   if(REGIONS.includes(state.region)){
     // The existing market setter handles its own local storage, price update & render.
     if(typeof window.bb307SwitchIsland!=='function'||window.bb307SwitchIsland(state.region)!==true)
       return 'Could not save shopping region. Please retry or edit it later in Settings.';
   }
   return '';
 }
 function complete(goPremium=false){
   if(!host)return;
   if(!persist()){
     host.querySelector('#bbobSaveError')?.replaceChildren(document.createTextNode('Unable to save your setup on this device. Please check browser storage and retry.'));
     return;
   }
   const error=applyChosenPreferences();
   if(error){
     const status=host.querySelector('#bbobSaveError');
     if(status)status.textContent=error;
     return;
   }
   state.complete=true;state.started=false;
   if(!persist()){state.complete=false;state.started=true;
     const status=host.querySelector('#bbobSaveError');
     if(status)status.textContent='Could not save onboarding completion. Please retry.';
     return;
   } // Goals and diets stay in the existing local onboarding app state.
   write('basketboss_onboarding_seen_v1','true');
   try{sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1')}catch(_){}
   restoreAuth();host.remove();host=null;document.body.style.overflow=oldOverflow;
   // Do not dispatch legacy splash-finished: it can open a duplicate sales modal.
   if(goPremium){
     // Hand off to the EXISTING Paddle checkout page. Only its original
     // authenticated data-plan buttons may create transactions; never here.
     if(typeof window.location?.assign==='function')window.location.assign('pricing-sandbox.html#monthly');
     else if(window.BBIntroTrialOffer?.open)void window.BBIntroTrialOffer.open();
   }else{
     document.querySelector('.shell .tabs [data-tab="discover"]')?.click();
   }
 }

 function chooseOption(i){
   const items=state.step===2?HOUSE:state.step===3?GOALS:DIETS;
   const v=items[i];if(v===undefined)return;
   if(state.step===2)state.house=v;
   if(state.step===3){const set=new Set(state.goals);set.has(v)?set.delete(v):(set.size<3&&set.add(v));state.goals=[...set];}
   if(state.step===4){const set=new Set(state.diets);if(v===DIETS[0]){state.diets=[v];}
     else{set.delete(DIETS[0]);set.has(v)?set.delete(v):set.add(v);state.diets=[...set];}}
   persist();render();
 }
 function begin(){
   if(!willShow()||host)return;
   state=restoreState()||state;
   // Everyone sees the new rollout once; saved recipes, plans and sessions stay intact.
   if(!state.started){state={step:0,house:'',goals:[],diets:[],region:'',started:true,complete:false};persist();}
   if(!Number.isInteger(state.step)||state.step<0||state.step>STEP_MAX)state.step=0;
   oldOverflow=document.body.style.overflow;
   host=document.createElement('div');host.id='bbNewOnboarding';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','BasketBoss welcome and setup');
   document.body.appendChild(host);document.body.style.overflow='hidden';
   host.addEventListener('click',e=>{
     const option=e.target.closest('[data-bbob-opt]');if(option){chooseOption(Number(option.dataset.bbobOpt));return;}
     const action=e.target.closest('[data-bbob]')?.dataset.bbob;if(!action)return;
     if(action==='free'||action==='free-complete'){complete();return;}
     if(action==='premium'){complete(true);return;}
     if(action==='next'){state.step=Math.min(STEP_MAX,state.step+1);persist();render();return;}
     if(action==='skip'){if(state.step===2){state.house='';state.region='';}if(state.step===3)state.goals=[];if(state.step===4)state.diets=[];state.step=Math.min(STEP_MAX,state.step+1);persist();render();return;}
     if(action==='back'){state.step=Math.max(0,state.step-1);persist();render();}
   });
   host.addEventListener('change',e=>{if(e.target.matches('[data-bbob-region]')){state.region=e.target.value;persist();}});
   host.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();complete();}});
   window.addEventListener('basketboss:session-changed',()=>{
     if(host&&state.step===1&&validSession()){state.step=2;persist();render();}
   });
   render();
 }
 function start(){trimFounder();begin();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
