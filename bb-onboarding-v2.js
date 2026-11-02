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
 const STEP_MAX=10;
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
 // Remembered identity only controls account presentation; invite actions still require a fresh token.
 const accountRemembered=()=>validSession()||window.BasketBossSession?.state().remembered===true;
 const native=()=>window.BBNative?.isNative===true||location.protocol==='capacitor:';
 const installed=()=>{try{return native()||window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}catch(_){return native()||navigator.standalone===true}};
 const deleting=()=>window.BBAccountDeletion?.isDeleting?.()===true;
 const startupPending=()=>document.documentElement?.classList?.contains?.('bb-native-starting')===true;
 const deletionDialogOpen=()=>id('bbAccountDeletionDialog')?.open===true;
 const blocked=()=>deleting()||startupPending()||deletionDialogOpen();
 const preview=()=>location.hostname===PREVIEW_HOST&&new URLSearchParams(location.search).get('bb_onboarding_v2_preview')==='1';
 function restoreState(){try{const v=JSON.parse(read(KEY)||'null');return v&&typeof v==='object'?v:null}catch(_){return null}}
 function willShow(){
   // The new version deliberately runs once for everyone, including signed-in
   // members and users with existing plans, without deleting older state.
   if(deleting()||deletionDialogOpen())return false;
   if(host)return true;
   if(accountRequested||location.hash==='#account')return false;
   if(preview())return true;
   return restoreState()?.complete!==true;
 }
 // Returning and paying members keep their existing opening experience.
 window.BBOnboard2026={willShow,preview,open:replay,pauseForAccount,getPreferences:()=>({house:state.house,region:state.region,goals:[...state.goals],diets:[...state.diets]})};
 // Founder story is retained on compare.html; no homepage element is modified here.
 function trimFounder(){return SHOW_FOUNDER_STORY;}
 let state=restoreState()||{step:0,house:'',goals:[],diets:[],region:'',started:false,complete:false,partnerStepV2:true,wantsPartnerInvite:false,partnerIntent:'none'};
 let host=null,form=null,message=null,formMarker=null,messageMarker=null,oldOverflow='',lastFocus=null,accountRequested=false,fullViewportHeight=0;
 let background=[],pagePosition={x:0,y:0};
 function lockWelcomeBackground(){
   pagePosition={x:window.scrollX||0,y:window.scrollY||0};
   document.documentElement.style.setProperty('--bbob-page-top',-pagePosition.y+'px');
   document.documentElement.classList.add('bb-onboarding-open');
   background=[...document.querySelectorAll('.shell,.bbui-settings-overlay')].filter(node=>!node.contains(host)).map(node=>({node,inert:node.hasAttribute('inert')}));
   for(const {node} of background)node.setAttribute('inert','');
 }
 function unlockWelcomeBackground(){
   if(host?.contains(document.activeElement))document.activeElement.blur?.();
   for(const {node,inert} of background)if(!inert)node.removeAttribute('inert');
   background=[];
   document.documentElement.classList.remove('bb-onboarding-open');
   document.documentElement.style.removeProperty('--bbob-page-top');
   document.body.style.overflow=oldOverflow;
   window.scrollTo(pagePosition.x,pagePosition.y);
 }
 // Replay uses memory until Finish; closing or reloading keeps prior setup intact.
 let replaying=false,replayOriginal=null;
 const changedPreferences=new Set();
 function persist(commitReplay=false){if(blocked())return false;if(replaying&&!commitReplay)return true;return write(KEY,JSON.stringify({step:state.step,house:state.house,goals:state.goals,diets:state.diets,region:state.region,started:state.started,complete:state.complete,partnerStepV2:true,wantsPartnerInvite:state.wantsPartnerInvite===true,partnerIntent:state.partnerIntent||'none'}));}
 const btn=(label,action,kind='primary')=>`<button type="button" class="bbob-btn bbob-${kind}" data-bbob="${action}">${label}</button>`;
 // Reuse exactly the SVG basket/crown paths and keyframe names from the original
 // bb-welcome-splash.js / bb-welcome-splash.css. No second splash dialog fires.
 const originalCrownAnimation=()=>`<div class="bbob-original-logo-motion" role="img" aria-label="Animated BasketBoss crowned basket logo"><div class="bbob-motion-square"></div><svg class="bbob-motion-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true"><g class="bbob-motion-basket"><path d="M18 30 25 23M46 30 39 23" fill="none" stroke="#44484B" stroke-width="4" stroke-linecap="round"/><path d="M11 31h42l-5 24H16l-5-24Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path class="bbob-motion-slots" d="M22 38v10M32 38v10M42 38v10" stroke="#F8F8F8" stroke-width="4" stroke-linecap="round"/></g><g class="bbob-motion-crown"><path d="M22 18 18 10 27 14 32 6 37 14 46 10 42 18Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path d="M21 21h22" stroke="#44484B" stroke-width="3" stroke-linecap="round"/></g></svg></div>`;
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Real BasketBoss Discover DOM class names, not the fake cards from the mockup.
 // There are no active buttons, data-recipe, add-to-plan or shopping handlers.
 const recipeCard=(r,featured=false)=>`<article class="card ${featured?'bb-featured-card':'mini-recipe'} bbob-recipe-card" aria-label="Example recipe: ${esc(r.name)}"><div class="recipe-image"><img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" decoding="async"><span class="pill">${esc(r.tag)}</span><span class="time-pill">◷ ${r.mins} min</span></div><div class="recipe-body"><div class="eyebrow">${esc(r.category)} · serves ${r.servings}</div><h3>${esc(r.name)}</h3><div class="chips">${r.ingredientCount?`<span class="chip">${r.ingredientCount} ingredients</span>`:''}</div>${r.tip?`<div class="tip">${esc(r.tip)}</div>`:''}</div></article>`;
 function figure(key){
   const lead=RECIPES[0];
   if(key==='discover')return `<div class="bbob-figure bbob-recipe-gallery" aria-label="Read-only examples from the actual BasketBoss Free recipe catalogue"><div class="bbob-mock-top">REAL BASKETBOSS RECIPE CARDS <span>100 FREE</span></div>${recipeCard(lead,true)}<div class="bbob-more-recipes">${RECIPES.slice(1).map(r=>recipeCard(r)).join('')}</div><p class="bbob-preview-disclaimer">Example cards only. No recipe has been opened, saved or added to your plan.</p></div>`;
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
   return `<div class="bbob-figure bbob-real-shop" aria-label="Read-only BasketBoss aisle shopping example"><div class="bbob-mock-top">FAJITAS SHOPPING LIST · EXAMPLE <span>BY AISLE</span></div><div class="bbob-shop-total"><span>Indicative basket estimate</span><strong>£${total.toFixed(2)}</strong></div>${rows}<p class="bbob-preview-disclaimer">Example ingredient quantities and prices for ${esc(lead.name)} (6 servings). Your actual list recalculates quantities, packs and pantry deductions for your region and supermarket. This example does not change your shopping list.</p></div>`;
 }

 function options(items,selected,multiple){return `<div class="bbob-options ${multiple?'bbob-goals':''}">${items.map((v,i)=>`<button type="button" class="bbob-option ${selected.includes(v)?'chosen':''}" data-bbob-opt="${i}" aria-pressed="${selected.includes(v)}"><span class="bbob-choice-mark" aria-hidden="true">${selected.includes(v)?'✓':' '}</span><span>${v}</span></button>`).join('')}</div>`;}
 const titles=['Welcome','Account','Partner sharing','Household','Goals','Preferences','Discover','Plan','Shop','All set','Membership'];
 function content(){
   let headline='',eyebrow='',description='',art='',foot='',actions='';
   switch(state.step){
     case 0:
       eyebrow='WELCOME TO BASKETBOSS';headline=installed()? 'Thanks for downloading BasketBoss!' : 'Welcome to BasketBoss.';
       description='Plan meals. Shop smarter. Waste less. Start with 100 free recipes, then set BasketBoss up for your household.';
       art='<div class="bbob-intro-art bbob-restored-animation">'+originalCrownAnimation()+'<strong class="bbob-intro-wordmark">Basket<span>Boss</span></strong><span>Built for real-life food shopping.</span></div>';
       actions=btn('Let’s get started','next')+btn('Browse 100 free recipes instead','free','link');break;
     case 1:
       eyebrow='YOUR ACCOUNT';
       if(accountRemembered()){
         headline='You’re already signed in.';
         description='Your existing BasketBoss account and saved meals are ready. There is no need to sign in again.';
         art='<div class="bbob-auth-ready" role="status">✓ Your account is connected</div>';
         actions=btn('Continue setup','next')+btn('Explore Free','free','link');
       }else{
         headline=state.partnerIntent==='join'?'Sign in to join your partner.':'One account. Your plans, wherever you are.';
         description=state.partnerIntent==='join'?'Use the email address your partner invited. Once your email is verified and you sign in, we’ll check for their invitation before asking you to create a separate plan.':'Create a free account or sign in using the existing secure email form. No card needed. Partner Sharing is available to one verified partner when enabled for Premium.';
         art='<div id="bbobAuthSlot" class="bbob-auth-slot"></div><div id="bbobMessageSlot" class="bbob-message-slot" aria-live="polite"></div>';
         foot='If you create an account, you may need to confirm your email before signing in.';
         actions=btn('Continue without signing in','next','outline')+btn('Back','back','link');
       }
       break;
     case 2:
       eyebrow='ONE PLAN · TWO PHONES';headline='Would you like to share with a partner?';
       description='Premium households can link one verified partner email, so you both see the same planned meals, pantry and shopping list. You can choose now even without an account.';
       art=`<div class="bbob-partner-choices" role="group" aria-label="Partner Sharing options">
         <button type="button" class="bbob-partner-choice ${state.wantsPartnerInvite?'chosen':''}" data-bbob="partner-invite" aria-pressed="${!!state.wantsPartnerInvite}"><span class="bbob-partner-icon">👥</span><span><strong>Invite one partner (Premium)</strong><small>Plan together across two phones</small></span></button>
         <button type="button" class="bbob-partner-choice" data-bbob="partner-join"><span class="bbob-partner-icon">✉️</span><span><strong>Join an invitation</strong><small>Sign in with your invited email to accept securely</small></span></button>
         <button type="button" class="bbob-partner-choice" data-bbob="partner-later"><span class="bbob-partner-icon">✓</span><span><strong>Not now</strong><small>Continue meal planning on your own</small></span></button>
       </div>${state.wantsPartnerInvite?'<p class="bbob-partner-saved" role="status">✓ Choice saved. Once your account is verified and Premium is active, we’ll help you invite and link your partner. No email has been sent yet.</p>':''}`;
       actions=btn('Continue meal planning','next')+btn('Back','back','link');break;
     case 3:
       eyebrow='A LITTLE ABOUT YOUR HOUSEHOLD';headline='How many people are you usually cooking for?';
       description='Choose a starting household size and shopping region. These update your actual portions and pack estimates when you finish. Both can be changed later.';
       foot='After setup, choose your supermarket in region settings or Shopping. The store list matches your region, and each region remembers its own choice.';
       art=options(HOUSE,state.house?[state.house]:[],false)+`<label class="bbob-market-label" for="bbob-region">Shopping region (optional)<select id="bbob-region" data-bbob-region><option value="">Choose later in Settings</option>${REGIONS.map(r=>`<option value="${r}" ${state.region===r?'selected':''}>${r==='US'?'United States':r}</option>`).join('')}</select></label>`;
       actions=btn('Continue','next')+btn('Skip question','skip','link');break;
     case 4:
       eyebrow='WHAT MATTERS MOST';headline='What would make dinner easier?';
       description='Choose up to three. We save your answers on this device; this does not silently change recipes or meal plans.';
       art=options(GOALS,state.goals,true);actions=btn('Continue','next')+btn('Skip question','skip','link');break;
     case 5:
       eyebrow='YOUR PREFERENCES';headline='Any dietary preferences?';
       description='Optional. Saved on this device for future reference; recipes are NOT automatically filtered and allergens must always be checked on packaging.';
       art=options(DIETS,state.diets,true);actions=btn('Show me BasketBoss','next')+btn('Skip question','skip','link');break;
     case 6:
       eyebrow='STEP 1 OF 3 · DISCOVER';headline='Dinner ideas without the endless scrolling.';
       description='Explore 100 recipes free. Browse for something the family will actually enjoy.';
       art=figure('discover');actions=btn('Next · Meal planning','next')+btn('Back','back','link');break;
     case 7:
       eyebrow='STEP 2 OF 3 · PLAN';headline='A delicious week, sorted.';
       description='Pick dinners for each day and adjust servings for the people eating. Ingredient quantities scale first, then the app counts the packs needed.';
       art=figure('plan');actions=btn('Next · Shopping lists','next')+btn('Back','back','link');break;
     case 8:
       eyebrow='STEP 3 OF 3 · SHOP';headline='One shopping list, organised by aisle.';
       description='Your meals become one clear aisle-by-aisle list. Choose your supermarket in region settings or Shopping; available stores match your region.';
       foot='Dated online guides cover selected UK products; regional estimates fill gaps. Meal estimates count the share of staples used, while Shopping includes full replacement packs when needed.';
       art=figure('shop');actions=btn('Finish the tour','next')+btn('Back','back','link');break;
     case 9:
       eyebrow='READY WHEN YOU ARE';headline='You’re all set.';
       description='Less time wondering what’s for dinner. More time enjoying it.';
       art='<div class="bbob-finish-art">'+originalCrownAnimation()+'<span class="bbob-sheen" aria-hidden="true"></span></div>';
       actions=btn('Choose how to get started','next');break;
     default:
       if(native()){
         eyebrow='READY TO GET STARTED';headline='Your BasketBoss is ready.';
         description='Start planning with 100 Free recipes. You can sign in to an existing account and check your account status in Settings.';
         art='<div class="bbob-auth-ready" role="status">✓ Your setup is ready</div>';
         foot='No purchase is needed to use BasketBoss Free.';
         actions=btn('Start using BasketBoss','free-complete')+btn('Back','back','link');
         break;
       }
       eyebrow='ONE LAST THING';headline='Choose your BasketBoss experience.';
       description='Start with BasketBoss Free or explore Premium. You decide — there’s no need to subscribe to use your free account.';
       art='<div class="bbob-plan-options"><div class="bbob-plan"><strong>BasketBoss Free</strong><b>£0</b><p>100 recipes and basic meal planning.</p><span>No card needed</span></div><div class="bbob-plan bbob-plan-premium"><strong>Premium / Founder offer</strong><b>See plans</b><p>All 500 recipes, advanced planning and eligible Premium AI features.</p><span>Standard Premium £4.99/month. Founder £1.99/month after a 7-day trial if eligible among the first 25 confirmed members. Final prices, renewals and trial terms are shown at checkout.</span></div></div>';
       foot='Standard is monthly, not annual. Founder eligibility is verified at checkout. Subscription checkout requires a signed-in account; payment, taxes and renewal terms are confirmed on the existing secure Paddle page.';
       actions=btn('Explore Premium plans','premium')+btn('Continue with BasketBoss Free','free-complete','outline');
   }
   const counter=state.step===0?'':`<div class="bbob-progress" aria-label="Onboarding step ${state.step+1} of ${STEP_MAX+1}"><span style="width:${Math.min(100,Math.round(100*state.step/STEP_MAX))}%"></span></div>`;
   return `<div class="bbob-shell"><header class="bbob-header"><div class="bbob-brand"><img src="${LOGO}" alt=""><span>Basket<span>Boss</span></span></div><button type="button" class="bbob-exit" data-bbob="${replaying?'replay-cancel':'free'}" aria-label="${replaying?'Cancel setup and keep existing preferences':'Exit onboarding and explore free recipes'}">${replaying?'Cancel setup':'Explore Free'} <span aria-hidden="true">×</span></button></header>${counter}<section class="bbob-main" aria-labelledby="bbob-title"><p class="bbob-eyebrow">${eyebrow}</p><h1 id="bbob-title">${headline}</h1><p class="bbob-description">${description}</p>${art}${foot?`<p class="bbob-footnote">${foot}</p>`:''}<p id="bbobSaveError" role="alert" class="bbob-save-error"></p></section><footer class="bbob-footer">${actions}<div class="bbob-stepname">${titles[state.step]} · ${state.step+1} of 11</div></footer></div>`;
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
 }
 function accountInput(){const active=document.activeElement;return state.step===1&&active?.matches?.('#cloud-email,#cloud-password')&&host?.contains?.(active)?active:null;}
 function keepAuthFocusVisible(){
   const active=accountInput(),main=host?.querySelector('.bbob-main');if(!active||!main)return;
   const bounds=main.getBoundingClientRect(),field=active.getBoundingClientRect();
   const top=bounds.top+16,bottom=bounds.bottom-16;
   let delta=field.top<top?field.top-top:field.bottom>bottom?field.bottom-bottom:0;
   const login=id('cloud-login');
   if(active.id==='cloud-password'&&login?.getClientRects().length){
     delta+=Math.min(Math.max(0,login.getBoundingClientRect().bottom-delta-bottom),Math.max(0,field.top-delta-top));
   }
   if(delta)main.scrollTop+=delta;
 }
 function sizeWelcomeViewport(){
   const view=window.visualViewport;
   const height=Math.min(view?.height||window.innerHeight,window.innerHeight);
   if(!host||!Number.isFinite(height)||height<=0)return;
   for(const [name,value] of Object.entries({height,width:Math.min(view?.width||window.innerWidth,window.innerWidth),top:Math.max(0,view?.offsetTop||0),left:Math.max(0,view?.offsetLeft||0)})){
     host.style?.setProperty?.('--bbob-viewport-'+name,value+'px');
   }
   fullViewportHeight=Math.max(fullViewportHeight,height);
   // Keep this layout until the keyboard actually closes. Removing it on input
   // blur moves Sign in between touch-down and touch-up and loses the tap.
   const editing=!!accountInput()||host.classList?.contains('bbob-keyboard');
   host.classList?.toggle('bbob-keyboard',state.step===1&&editing&&height<fullViewportHeight-100);
   window.requestAnimationFrame?.(keepAuthFocusVisible);
 }
 function render(){if(!host)return;restoreAuth();host.innerHTML=content();
   if(state.step===1&&!accountRemembered())mountAuth();
   sizeWelcomeViewport();host.scrollTop=0;
   if(state.step===1&&!accountRemembered()){
     const heading=host.querySelector('#bbob-title');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});
   }else host.querySelector('[data-bbob="next"]')?.focus({preventScroll:true});
 }
 // No changes to app state take place on preview, survey selection or Back.
 // Commit to the existing app's OWN setters only when the user exits onboarding.
 function applyChosenPreferences(){
   if(state.house&&(!replaying||changedPreferences.has('house'))){
     const servings=HOUSE_SERVINGS[state.house];
     if(servings&&typeof window.BasketBossSetOnboardingServings==='function'){
       if(window.BasketBossSetOnboardingServings(servings)!==true)return 'Could not save household servings. Please retry or choose Skip.';
     }else if(servings)return 'Household controls are unavailable. Please retry after refreshing.';
   }
   if(REGIONS.includes(state.region)&&(!replaying||changedPreferences.has('region'))){
     // The existing market setter handles its own local storage, price update & render.
     if(typeof window.bb307SwitchIsland!=='function'||window.bb307SwitchIsland(state.region)!==true)
       return 'Could not save shopping region. Please retry or edit it later in Settings.';
   }
   return '';
 }
 function complete(goPremium=false){
   if(!host||blocked())return;
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
   if(!persist(true)){state.complete=false;state.started=true;
     const status=host.querySelector('#bbobSaveError');
     if(status)status.textContent='Could not save onboarding completion. Please retry.';
     return;
   } // Goals and diets stay in the existing local onboarding app state.
   write('basketboss_onboarding_seen_v1','true');
   try{sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1')}catch(_){}
   dismiss(false);
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

 function finishJoinHandoff(){
   if(!host||blocked()||!validSession())return;
   // Only consent to join is saved; backend still checks the verified email,
   // the actual invite and Premium membership. No local plan is imported.
   state.complete=true;state.started=false;
   if(!persist(true)){
     const e=host.querySelector('#bbobSaveError');if(e)e.textContent='Could not save onboarding on this device. Please retry.';
     return;
   }
   write('basketboss_onboarding_seen_v1','true');
   dismiss(false);
   queueMicrotask(()=>{
     const button=document.querySelector('#cloud-signed [data-bbhs-trigger], [data-bbhs-trigger]');
     if(button)button.click();
     else document.getElementById('cloud-open')?.click();
   });
 }
 function chooseOption(i){
   if(blocked())return;
   const items=state.step===3?HOUSE:state.step===4?GOALS:DIETS;
   const v=items[i];if(v===undefined)return;
   if(state.step===3){state.house=v;changedPreferences.add('house');}
   if(state.step===4){const set=new Set(state.goals);set.has(v)?set.delete(v):(set.size<3&&set.add(v));state.goals=[...set];}
   if(state.step===5){const set=new Set(state.diets);if(v===DIETS[0]){state.diets=[v];}
     else{set.delete(DIETS[0]);set.has(v)?set.delete(v):set.add(v);state.diets=[...set];}}
   persist();render();
 }
 function dismiss(restoreReplay=true){
   const closeSettings=!restoreReplay&&replaying;
   unlockWelcomeBackground();restoreAuth();host?.remove();host=null;
   if(restoreReplay&&replaying&&replayOriginal)state=replayOriginal;
   replaying=false;replayOriginal=null;changedPreferences.clear();
   if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
   if(closeSettings)document.querySelector('.bbui-settings-overlay:not([hidden]) .bbui-settings-close')?.click();
 }
 function replay(){
   if(host||blocked())return false;
   accountRequested=false;
   replayOriginal=JSON.parse(JSON.stringify(restoreState()||state));
   state={house:'',goals:[],diets:[],region:'',partnerStepV2:true,wantsPartnerInvite:false,partnerIntent:'none',...replayOriginal,step:0,started:true,complete:false};
   state.goals=Array.isArray(state.goals)?[...state.goals]:[];state.diets=Array.isArray(state.diets)?[...state.diets]:[];
   replaying=true;changedPreferences.clear();
   return begin(true);
 }
 function begin(force=false){
   if((!force&&!willShow())||host||blocked()||(!force&&accountRequested))return false;
   if(!force)state=restoreState()||state;
   // Everyone sees the new rollout once; saved recipes, plans and sessions stay intact.
   if(!state.started){state={step:0,house:'',goals:[],diets:[],region:'',started:true,complete:false,partnerStepV2:true,wantsPartnerInvite:false,partnerIntent:'none'};persist();}
   else if(!state.partnerStepV2){
     // Resume older incomplete onboarding at the corresponding screen; never
     // reset or repeat the tour for users who already completed it.
     if(Number.isInteger(state.step)&&state.step>=2&&state.step<=9)state.step++;
     state.partnerStepV2=true;
     if(!persist())return;
   }
   if(!Number.isInteger(state.step)||state.step<0||state.step>STEP_MAX)state.step=0;
   oldOverflow=document.body.style.overflow;lastFocus=document.activeElement;
   host=document.createElement('div');host.id='bbNewOnboarding';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','BasketBoss welcome and setup');
   document.body.appendChild(host);document.body.style.overflow='hidden';lockWelcomeBackground();
   fullViewportHeight=window.visualViewport?.height||window.innerHeight||0;
   host.addEventListener('focusin',sizeWelcomeViewport);
   host.addEventListener('focusout',()=>queueMicrotask(sizeWelcomeViewport));
   host.addEventListener('click',e=>{
     if(blocked())return;
     const option=e.target.closest('[data-bbob-opt]');if(option){chooseOption(Number(option.dataset.bbobOpt));return;}
     const action=e.target.closest('[data-bbob]')?.dataset.bbob;if(!action)return;
     if(action==='replay-cancel'){dismiss();return;}
     if(action==='free'||action==='free-complete'){complete();return;}
     if(action==='premium'){complete(true);return;}
     if(action==='partner-invite'){
       state.partnerIntent='invite';state.wantsPartnerInvite=true;persist();render();return;
     }
     if(action==='partner-join'){
       state.partnerIntent='join';state.wantsPartnerInvite=false;persist();
       if(validSession())finishJoinHandoff();else{state.step=1;persist();render();}
       return;
     }
     if(action==='partner-later'){
       state.partnerIntent='none';state.wantsPartnerInvite=false;
       state.step=3;persist();render();return;
     }
     if(action==='next'){
       if(state.step===2 && state.partnerIntent==='join' && validSession()){finishJoinHandoff();return;}
       state.step=Math.min(STEP_MAX,state.step+1);persist();render();return;
     }
     if(action==='skip'){
       if(state.step===3){state.house=replaying?(replayOriginal.house||''):'';state.region=replaying?(replayOriginal.region||''):'';changedPreferences.delete('house');changedPreferences.delete('region');}
       if(state.step===4)state.goals=replaying?[...(replayOriginal.goals||[])]:[];
       if(state.step===5)state.diets=replaying?[...(replayOriginal.diets||[])]:[];
       state.step=Math.min(STEP_MAX,state.step+1);persist();render();return;
     }
     if(action==='back'){state.step=Math.max(0,state.step-1);persist();render();}
   });
   host.addEventListener('change',e=>{if(!blocked()&&e.target.matches('[data-bbob-region]')){state.region=e.target.value;changedPreferences.add('region');persist();}});
   host.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation?.();if(replaying)dismiss();else complete();}});
   render();return true;
 }
 function pauseForAccount(){
   // Direct account requests keep unfinished setup intact without covering login.
   accountRequested=true;if(host)dismiss();
 }
 function replayLabel(){
   let button=id('bbOnboardingReplay');
   if(!button){
     const parent=id('bbuiAccountSection')||id('bbuiLinksSection');if(!parent)return;
     button=document.createElement('button');button.id='bbOnboardingReplay';button.type='button';button.className='bb-beta-replay';
     parent.appendChild(button);
   }
   if(button.textContent!=='Replay welcome & setup')button.textContent='Replay welcome & setup';
   const reason=deleting()?'Finish account deletion before restarting setup.':deletionDialogOpen()?'Close account deletion before restarting setup.':startupPending()?'BasketBoss is opening. Setup will be available shortly.':'';
   button.disabled=!!reason;button.title=reason;button.setAttribute('aria-describedby','bbOnboardingReplayStatus');
   let hint=id('bbOnboardingReplayStatus');
   if(!hint&&button.parentNode){hint=document.createElement('p');hint.id='bbOnboardingReplayStatus';hint.setAttribute('role','status');button.parentNode.appendChild(hint);}
   if(hint){hint.hidden=!reason;if(hint.textContent!==reason)hint.textContent=reason;}
 }
 function start(){
   window.visualViewport?.addEventListener?.('resize',sizeWelcomeViewport);
   window.visualViewport?.addEventListener?.('scroll',sizeWelcomeViewport);
   window.addEventListener('resize',sizeWelcomeViewport);
   window.addEventListener('orientationchange',sizeWelcomeViewport);
   trimFounder();begin();replayLabel();
   document.addEventListener('click',event=>{
     if(!event.target.closest?.('#bbOnboardingReplay,#bbBetaWelcomeReplay'))return;
     event.preventDefault();event.stopImmediatePropagation();replay();
   },true);
   if(typeof MutationObserver==='function')new MutationObserver(replayLabel).observe(document.body,{childList:true,subtree:true});
   window.addEventListener('basketboss:session-changed',()=>{
     if(blocked()||!host||state.step!==1)return;
     if(validSession()){if(state.partnerIntent==='join')finishJoinHandoff();else{state.step=2;persist();render();}}else render();
   });
   window.addEventListener('basketboss:account-deletion-started',()=>{if(host)dismiss();replayLabel();});
   window.addEventListener('basketboss:account-deletion-deleted',()=>{if(host)dismiss();replayLabel();});
   window.addEventListener('basketboss:account-deletion-cancelled',event=>queueMicrotask(()=>{replayLabel();if(!event.detail?.reconciled)begin();}));
   window.addEventListener('basketboss:native-startup-ready',()=>{replayLabel();begin();});
   document.addEventListener('close',event=>{if(event.target?.id==='bbAccountDeletionDialog'){replayLabel();if(!deleting())begin();}},true);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
