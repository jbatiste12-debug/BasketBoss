/* BasketBoss onboarding v2 — purely presentational; Supabase form and Paddle offer reused.
   Config: set SHOW_FOUNDER_STORY = true to restore the personal founder copy.
   No plan, pantry, auth-token, checkout or entitlement writes. */
(()=>{'use strict';
 const SHOW_FOUNDER_STORY=false;
 const KEY='bb_onboarding_v2_20261028';
 const PREVIEW_HOST='basketboss-preview.basketboss-site.pages.dev';
 const LOGO='icons/basketboss-crowned-v1766-512.png';
 const STEP_MAX=9;
 const RECIPE={name:'Sheet-pan chicken fajitas',mins:30,image:'release-assets/basketboss-v17/images/existing/fajitas.webp'}; // from recipes.json; read-only sample
 const HOUSE=['Just me','2 people','3–4 people','5+ people'];
 const GOALS=['Spend less on groceries','Plan dinners faster','Waste less food','Make shopping simpler','Try new recipes'];
 const DIETS=['No specific preference','Vegetarian','Vegan','Gluten-free','Dairy-free'];
 const REGIONS=['UK','Jersey','Guernsey','US'];
 const id=x=>document.getElementById(x);
 const read=k=>{try{return localStorage.getItem(k)}catch(_){return null}};
 const write=(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}};
 const validSession=()=>{try{const s=JSON.parse(read('basketboss_cloud_session_v1')||'null');return !!(s?.user?.id&&typeof s.access_token==='string'&&Number(s.expires_at)*1000>Date.now()+5000)}catch(_){return false}};
 const installed=()=>{try{return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}catch(_){return navigator.standalone===true}};
 const preview=()=>location.hostname===PREVIEW_HOST&&new URLSearchParams(location.search).get('bb_onboarding_v2_preview')==='1';
 function returningUser(){
   if(read('basketboss_onboarding_seen_v1')==='true')return true;
   if(validSession())return true;
   try{const s=JSON.parse(read('basketboss_321_unified_state_v1')||'null');
     if(s&&((s.planned?.length||0)||(s.plannedDesserts?.length||0)||(s.customPantry?.length||0)||Object.values(s.pantry||{}).some(Boolean)))return true;
   }catch(_){}
   return !!read('basketboss_v172_personal_food_tiles_v1');
 }
 function restoreState(){try{const v=JSON.parse(read(KEY)||'null');return v&&typeof v==='object'?v:null}catch(_){return null}}
 function willShow(){
   if(preview())return true;
   const previous=restoreState();
   if(previous?.complete)return false;
   if(previous?.started)return true; // Continue onboarding after email confirmation/reload.
   return !returningUser();
 }
 // Returning and paying members keep their existing opening experience.
 window.BBOnboard2026={willShow,preview};
 // Founder story is retained on compare.html; no homepage element is modified here.
 function trimFounder(){return SHOW_FOUNDER_STORY;}
 let state=restoreState()||{step:0,house:'',goals:[],diets:[],region:'',started:false,complete:false};
 let host=null,form=null,message=null,formMarker=null,messageMarker=null,oldOverflow='';
 function persist(){write(KEY,JSON.stringify({step:state.step,house:state.house,goals:state.goals,diets:state.diets,region:state.region,started:state.started,complete:state.complete}));}
 const btn=(label,action,kind='primary')=>`<button type="button" class="bbob-btn bbob-${kind}" data-bbob="${action}">${label}</button>`;
 const figure=(key)=>{
   if(key==='discover')return `<div class="bbob-figure bbob-discover"><div class="bbob-mock-top">DISCOVER RECIPES <span>100 FREE</span></div><div class="bbob-minirow"><img class="bbob-real-recipe-photo" loading="lazy" src="${RECIPE.image}" alt="${RECIPE.name}"><div><strong>${RECIPE.name}</strong><small>${RECIPE.mins} min · from the BasketBoss recipe catalogue</small></div></div><div class="bbob-mock-pill">Browse recipes</div></div>`;
   if(key==='plan')return `<div class="bbob-figure"><div class="bbob-mock-top">MY WEEK <span>7 DAYS</span></div><div class="bbob-days"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span></div><div class="bbob-mealrow">Monday <strong>${RECIPE.name}</strong></div><div class="bbob-mealrow">Tuesday <strong>Choose a recipe +</strong></div><div class="bbob-mealrow">Wednesday <strong>Choose a recipe +</strong></div></div>`;
   return `<div class="bbob-figure"><div class="bbob-mock-top">SHOPPING EXAMPLE <span>BY AISLE</span></div><div class="bbob-shoprow"><span>✓</span> Vegetables <small>Mixed peppers</small></div><div class="bbob-shoprow"><span>✓</span> Dairy <small>Cheddar</small></div><div class="bbob-shoprow"><span>○</span> Grains <small>Tortilla wraps</small></div></div>`;
 };
 function options(items,selected,multiple){return `<div class="bbob-options ${multiple?'bbob-goals':''}">${items.map((v,i)=>`<button type="button" class="bbob-option ${selected.includes(v)?'chosen':''}" data-bbob-opt="${i}" aria-pressed="${selected.includes(v)}"><span class="bbob-choice-mark" aria-hidden="true">${selected.includes(v)?'✓':' '}</span><span>${v}</span></button>`).join('')}</div>`;}
 const titles=['Welcome','Account','Household','Goals','Preferences','Discover','Plan','Shop','All set','Membership'];
 function content(){
   let headline='',eyebrow='',description='',art='',foot='',actions='';
   switch(state.step){
     case 0:
       eyebrow='WELCOME TO BASKETBOSS';headline=installed()? 'Thanks for downloading BasketBoss!' : 'Welcome to BasketBoss.';
       description='Plan Smarter. Eat Better. Less Waste. Take the stress out of deciding what to cook and what to buy.';
       art='<div class="bbob-intro-art"><div class="bbob-brand-halo"><img src="'+LOGO+'" alt="BasketBoss crowned basket logo"></div><span>Built for real-life food shopping.</span></div>';
       actions=btn('Let’s get started','next')+btn('Browse 100 free recipes instead','free','link');break;
     case 1:
       eyebrow='YOUR ACCOUNT';headline='One account. Your plans, wherever you are.';
       description='Create a free account or sign in using the existing secure email form. No card needed. If your email needs confirmation, you can continue setup and confirm later.';
       art='<div id="bbobAuthSlot" class="bbob-auth-slot"></div><div id="bbobMessageSlot" class="bbob-message-slot" aria-live="polite"></div>';
       foot='If you create an account, you may need to confirm your email before signing in.';
       actions=btn('Continue setup','next','outline')+btn('Explore Free without an account','free','link');break;
     case 2:
       eyebrow='A LITTLE ABOUT YOUR HOUSEHOLD';headline='How many people are you usually cooking for?';
       description='A quick introduction so BasketBoss can guide you to relevant tools.';
       art=options(HOUSE,state.house?[state.house]:[],false)+`<label class="bbob-market-label" for="bbob-region">Where do you shop? (optional)<select id="bbob-region" data-bbob-region><option value="">Choose later in Settings</option>${REGIONS.map(r=>`<option value="${r}" ${state.region===r?'selected':''}>${r==='US'?'United States':r}</option>`).join('')}</select></label>`;
       actions=btn('Continue','next')+btn('Skip question','next','link');break;
     case 3:
       eyebrow='WHAT MATTERS MOST';headline='What would make dinner easier?';
       description='Choose up to three. Your answers shape the introduction, not your saved recipes.';
       art=options(GOALS,state.goals,true);actions=btn('Continue','next')+btn('Skip question','next','link');break;
     case 4:
       eyebrow='YOUR PREFERENCES';headline='Any dietary preferences?';
       description='Optional. These choices are stored on this device; they do not automatically filter recipes.';
       art=options(DIETS,state.diets,true);actions=btn('Show me BasketBoss','next')+btn('Skip question','next','link');break;
     case 5:
       eyebrow='STEP 1 OF 3 · DISCOVER';headline='Dinner ideas without the endless scrolling.';
       description='Explore 100 recipes free. Browse for something the family will actually enjoy.';
       art=figure('discover');actions=btn('Next · Meal planning','next')+btn('Back','back','link');break;
     case 6:
       eyebrow='STEP 2 OF 3 · PLAN';headline='Turn dinner ideas into a plan.';
       description='Build your week one meal at a time. Premium Smart Auto-Fill is an optional upgrade.';
       art=figure('plan');actions=btn('Next · Shopping lists','next')+btn('Back','back','link');break;
     case 7:
       eyebrow='STEP 3 OF 3 · SHOP';headline='One shopping list, organised by aisle.';
       description='See what you need, check what you already have and shop with a clearer plan.';
       art=figure('shop');actions=btn('Finish the tour','next')+btn('Back','back','link');break;
     case 8:
       eyebrow='READY WHEN YOU ARE';headline='You’re all set.';
       description='Less time wondering what’s for dinner. More time enjoying it.';
       art='<div class="bbob-finish-art"><div class="bbob-finish-ring"><img src="'+LOGO+'" alt="BasketBoss crowned basket logo"></div><span class="bbob-sheen" aria-hidden="true"></span></div>';
       actions=btn('Choose how to get started','next');break;
     default:
       eyebrow='ONE LAST THING';headline='Choose your BasketBoss experience.';
       description='Start with BasketBoss Free or explore Premium. You decide — there’s no need to subscribe to use your free account.';
       art='<div class="bbob-plan-options"><div class="bbob-plan"><strong>BasketBoss Free</strong><b>£0</b><p>100 recipes and basic meal planning.</p><span>No card needed</span></div><div class="bbob-plan bbob-plan-premium"><strong>Premium / Founder offer</strong><b>7-day trial</b><p>More meal-planning tools and eligible Premium AI features.</p><span>Founder: £1.99/month after trial, only if eligible among the first 25 confirmed members. See full terms at checkout.</span></div></div>';
       foot='Founder places are not guaranteed by viewing this page. Pricing, taxes and renewal terms are confirmed at checkout.';
       actions=btn('Continue with BasketBoss Free','free-complete')+btn('Explore Premium plans','premium','outline');
   }
   const counter=state.step===0?'':`<div class="bbob-progress" aria-label="Onboarding step ${state.step} of ${STEP_MAX}"><span style="width:${Math.min(100,Math.round(100*state.step/STEP_MAX))}%"></span></div>`;
   return `<div class="bbob-shell"><header class="bbob-header"><div class="bbob-brand"><img src="${LOGO}" alt=""><span>Basket<span>Boss</span></span></div><button type="button" class="bbob-exit" data-bbob="free" aria-label="Exit onboarding and explore free recipes">Explore Free <span aria-hidden="true">×</span></button></header>${counter}<section class="bbob-main" aria-labelledby="bbob-title"><p class="bbob-eyebrow">${eyebrow}</p><h1 id="bbob-title">${headline}</h1><p class="bbob-description">${description}</p>${art}${foot?`<p class="bbob-footnote">${foot}</p>`:''}</section><footer class="bbob-footer">${actions}<div class="bbob-stepname">${titles[state.step]} · ${state.step+1} of 10</div></footer></div>`;
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
 function render(){if(!host)return;restoreAuth();host.innerHTML=content();if(state.step===1){if(validSession()){state.step=2;persist();render();return;}mountAuth();}
   host.scrollTop=0;host.querySelector('[data-bbob="next"]')?.focus({preventScroll:true});
 }
 function complete(goPremium=false){
   if(!host)return;
   restoreAuth();host.remove();host=null;document.body.style.overflow=oldOverflow;
   state.complete=true;state.started=false;persist();
   write('basketboss_onboarding_seen_v1','true');
   try{sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1')}catch(_){}
   // Legacy welcome finished event intentionally NOT fired: it would open a second sales dialog.
   if(goPremium){
     if(window.BBIntroTrialOffer?.open)void window.BBIntroTrialOffer.open();
     else window.location.assign('subscriptions.html');
   }else{
     document.querySelector('.shell .tabs [data-tab="discover"]')?.click();
   }
 }
 function applyRegion(){
   if(!REGIONS.includes(state.region))return;
   const selector=id('bb307Island'), save=id('bb307SaveMarket');
   if(!selector||!save)return;
   selector.value=state.region;selector.dispatchEvent(new Event('change',{bubbles:true}));
   save.click(); // Invoke original region-setting and pricing refresh handlers only.
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
   if(!preview()&&returningUser()&&!state.started)return;
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
     if(action==='next'){if(state.step===2)applyRegion();state.step=Math.min(STEP_MAX,state.step+1);persist();render();return;}
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
