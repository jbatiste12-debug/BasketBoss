/* BasketBoss onboarding refinement — scoped presentation and setup screens.
 * Reuses existing crowned-basket motion and genuine free-recipe card data.
 * Never writes plan/pantry/billing/auth tokens; household & region go through
 * the existing app save and market handlers. Four-step feeding taps reuse the
 * existing setter immediately; Settings replay still commits only on Finish.
 */
(()=>{'use strict';
 const SHOW_FOUNDER_STORY=false;
 const duration=minutes=>window.BBDuration?.format(minutes)??String(minutes)+'mins';
 const KEY='bb_onboarding_fresh_once_20261028_v1'; // New rollout only: never clear earlier state or credentials.
 const PREVIEW_HOST='basketboss-preview.basketboss-site.pages.dev';
 const LOGO='icons/basketboss-crowned-v1766-512.png';
 const STEP_MAX=10;
 // Only the current app document opts into the shorter setup. Older clients
 // retain their existing resumable presentation and the same completion key.
 const flowVersion=document.querySelector('meta[name="basketboss-onboarding"]')?.content;
 const four=flowVersion==='four-v1';
 const quick=four||flowVersion==='quick-v1';
 const QUICK_STEPS=[1,3,10];
 // Exact public Free recipe facts from the pinned recipes.json catalogue.
 // These are static read-only samples, never copies of user plans.
 const RECIPES=[
  {id:'fajitas',name:'Sheet-pan chicken fajitas',mins:30,servings:6,category:'Mexican · Family favourite',tag:'TRAYBAKE',cost:22.6,ingredientCount:8,image:'release-assets/basketboss-v17/images/existing/fajitas.webp',tip:'Set everything in the middle of the table and let everyone build their own.'},
  {id:'creamy-pasta',name:'Creamy garlic parmesan chicken pasta',mins:30,servings:4,category:'Italian · Comfort food',tag:'ONE-PAN',cost:15.11,ingredientCount:0,image:'release-assets/basketboss-v17/images/existing/creamy-pasta.webp'},
  {id:'chickpea-curry',name:'Creamy chickpea & spinach curry',mins:25,servings:4,category:'Vegetarian · Pantry-friendly',tag:'ONE-POT',cost:11.99,ingredientCount:0,image:'release-assets/basketboss-v17/images/existing/chickpea-curry.webp'}
 ];
 const HOUSE_SERVINGS={'Just me':1,'2 people':2,'3 people':3,'3–4 people':4,'5+ people':5,'Family with kids':4};
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
   // Preserve completed setup across releases. A returning member should open
   // their own app, while an unfinished explicit setup remains resumable.
   if(deleting()||deletionDialogOpen())return false;
   if(host)return true;
   if(accountRequested||location.hash==='#account')return false;
   if(preview())return true;
   const saved=restoreState();
   if(quick&&!saved?.started&&(accountRemembered()||read('basketboss_onboarding_seen_v1')==='true'))return false;
   return saved?.complete!==true;
 }
 // Returning and paying members keep their existing opening experience.
 window.BBOnboard2026={authenticated,willShow,preview,open:replay,pauseForAccount,getPreferences:()=>({house:state.house,region:state.region,goals:[...state.goals],diets:[...state.diets]})};
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
 let quickSetupOriginal=null,quickAccountOpen=false,quickPreferencesOpen=false,quickPartnerOpen=false;
 let quickAppleBusy=false,quickAppleMessage='';
 let quickGoogleBusy=false,quickGoogleMessage='';
 const GOOGLE_ICON='<svg viewBox="0 0 48 48" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.88 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
 // Presentation-only progress. Never part of the planner, auth or billing schema.
 const FLOW_KEY='bb_onboarding_four_step_v1';
 const FLOW_HOUSE=[['1','Just me'],['2','2 people'],['3','3 people'],['4+','3–4 people'],['Family with kids','Family with kids']];
 const FLOW_GOALS=[['£','Cut my weekly grocery bill','Spend less on groceries'],['♧','Stop wasting food in the fridge','Waste less food'],['ϟ','Faster weeknight dinners','Plan dinners faster'],['♡','Healthier / high-protein meals',null]];
 let flow=readFlow(),flowOriginal=null;
 function readFlow(){try{const value=JSON.parse(read(FLOW_KEY)||'null');return value&&value.version===1?value:{version:1,goal:'',authIntent:'',checkoutActor:''};}catch(_){return {version:1,goal:'',authIntent:'',checkoutActor:''};}}
 function saveFlow(commit=false){return replaying&&!commit?true:write(FLOW_KEY,JSON.stringify(flow));}
 const currentActor=()=>{try{return validSession()?JSON.parse(read('basketboss_cloud_session_v1')).user.id:'';}catch(_){return '';}};
 const flowAuthStep=()=>four&&state.step===2;
 function flowError(message){const status=host?.querySelector('#bbobSaveError');if(status)status.textContent=message;}
 function flowHouseLabel(){
   if(state.house==='Family with kids')return 'family';
   const size=HOUSE_SERVINGS[state.house];return size?size+'-person':'household';
 }

 function welcomeAppleAvailable(){
   try{return native()&&!blocked()&&!(four?validSession():accountRemembered())&&window.BBAuthFlow?.appleAvailable?.()===true;}catch(_){return false;}
 }
 function syncWelcomeApple(){
   if(!quick||!host||(four?!flowAuthStep():state.step!==1))return;
   const section=host.querySelector('[data-bbob-apple]');if(!section)return;
   const available=welcomeAppleAvailable(),visible=native()&&!blocked()&&!(four?validSession():accountRemembered())&&(available||quickAppleBusy);
   section.hidden=!visible;host.classList?.toggle('bbob-apple-ready',visible);
   const button=section.querySelector(four?'[data-bbob="flow-apple"]':'[data-bbob="quick-apple"]');
   if(button){button.disabled=quickAppleBusy||!available;button.setAttribute('aria-busy',String(quickAppleBusy));}
   const label=section.querySelector('[data-bbob-apple-label]');if(label)label.textContent=quickAppleBusy?'Connecting to Apple…':'Continue with Apple';
   const status=section.querySelector('[data-bbob-apple-status]');if(status){status.textContent=quickAppleMessage;status.hidden=!quickAppleMessage;}
 }
 async function signInWelcomeApple(){
   if(quickAppleBusy||!welcomeAppleAvailable())return;
   quickAppleBusy=true;quickAppleMessage='';syncWelcomeApple();
   try{
     const connected=await window.BBAuthFlow.signInWithApple({intent:four&&flow.authIntent==='return'?'sign-in':'sign-up'});
     if(connected!==true)quickAppleMessage='Apple sign-in wasn’t completed. Try again, or explore Free.';
   }catch(_){quickAppleMessage='Could not connect to Apple. Try again, or explore Free.';}
   finally{quickAppleBusy=false;syncWelcomeApple();}
 }
 function welcomeGoogleAvailable(){
   try{return four&&!blocked()&&!validSession()&&window.BBAuthFlow?.googleAvailable?.()===true;}catch(_){return false;}
 }
 function syncWelcomeGoogle(){
   if(!four||!host||!flowAuthStep())return;
   const section=host.querySelector('[data-bbob-google]');if(!section)return;
   const available=welcomeGoogleAvailable();section.hidden=!(available||quickGoogleBusy);
   const button=section.querySelector('[data-bbob="flow-google"]');
   if(button){button.disabled=quickGoogleBusy||!available;button.setAttribute('aria-busy',String(quickGoogleBusy));}
   const label=section.querySelector('[data-bbob-google-label]');if(label)label.textContent=quickGoogleBusy?'Connecting to Google…':'Continue with Google';
   const status=section.querySelector('[data-bbob-google-status]');if(status){status.textContent=quickGoogleMessage;status.hidden=!quickGoogleMessage;}
 }
 async function signInWelcomeGoogle(){
   if(quickGoogleBusy||!welcomeGoogleAvailable())return;
   // Preserve the same return/save intent across the existing OAuth redirect.
   if(!flow.authIntent){flow.authIntent='save';if(!saveFlow()){flowError('Could not save your progress. Please retry.');return;}}
   quickGoogleBusy=true;quickGoogleMessage='';syncWelcomeGoogle();
   try{
     const opened=await window.BBAuthFlow.signInWithGoogle({intent:flow.authIntent==='return'?'sign-in':'sign-up'});
     if(opened!==true)quickGoogleMessage=window.BBAuthFlow.state?.().message||'Google sign-in wasn’t completed. Try again, or use email.';
   }catch(_){quickGoogleMessage='Could not connect to Google. Try again, or use email.';}
   finally{quickGoogleBusy=false;syncWelcomeGoogle();}
 }
 const changedPreferences=new Set();
 function persist(commitReplay=false){if(blocked())return false;if(replaying&&!commitReplay)return true;return write(KEY,JSON.stringify({step:state.step,house:state.house,goals:state.goals,diets:state.diets,region:state.region,started:state.started,complete:state.complete,partnerStepV2:true,wantsPartnerInvite:state.wantsPartnerInvite===true,partnerIntent:state.partnerIntent||'none'}));}
 const btn=(label,action,kind='primary')=>`<button type="button" class="bbob-btn bbob-${kind}" data-bbob="${action}">${label}</button>`;
 // Reuse exactly the SVG basket/crown paths and keyframe names from the original
 // bb-welcome-splash.js / bb-welcome-splash.css. No second splash dialog fires.
 const originalCrownAnimation=()=>`<div class="bbob-original-logo-motion" role="img" aria-label="Animated BasketBoss crowned basket logo"><div class="bbob-motion-square"></div><svg class="bbob-motion-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true"><g class="bbob-motion-basket"><path d="M18 30 25 23M46 30 39 23" fill="none" stroke="#44484B" stroke-width="4" stroke-linecap="round"/><path d="M11 31h42l-5 24H16l-5-24Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path class="bbob-motion-slots" d="M22 38v10M32 38v10M42 38v10" stroke="#F8F8F8" stroke-width="4" stroke-linecap="round"/></g><g class="bbob-motion-crown"><path d="M22 18 18 10 27 14 32 6 37 14 46 10 42 18Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path d="M21 21h22" stroke="#44484B" stroke-width="3" stroke-linecap="round"/></g></svg></div>`;
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Real BasketBoss Discover DOM class names, not the fake cards from the mockup.
 // There are no active buttons, data-recipe, add-to-plan or shopping handlers.
 const recipeCard=(r,featured=false)=>`<article class="card ${featured?'bb-featured-card':'mini-recipe'} bbob-recipe-card" aria-label="Example recipe: ${esc(r.name)}"><div class="recipe-image"><img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" decoding="async"><span class="pill">${esc(r.tag)}</span><span class="time-pill">◷ ${duration(r.mins)}</span></div><div class="recipe-body"><div class="eyebrow">${esc(r.category)} · serves ${r.servings}</div><h3>${esc(r.name)}</h3><div class="chips">${r.ingredientCount?`<span class="chip">${r.ingredientCount} ingredients</span>`:''}</div>${r.tip?`<div class="tip">${esc(r.tip)}</div>`:''}</div></article>`;
 function figure(key){
   const lead=RECIPES[0];
   if(key==='discover')return `<div class="bbob-figure bbob-recipe-gallery" aria-label="Read-only examples from the actual BasketBoss Free recipe catalogue"><div class="bbob-mock-top">REAL BASKETBOSS RECIPE CARDS <span>200 FREE</span></div>${recipeCard(lead,true)}<div class="bbob-more-recipes">${RECIPES.slice(1).map(r=>recipeCard(r)).join('')}</div><p class="bbob-preview-disclaimer">Example cards only. No recipe has been opened, saved or added to your plan.</p></div>`;
   if(key==='plan')return `<div class="bbob-figure bbob-real-plan" aria-label="Read-only sample weekly meal plan"><div class="bbob-mock-top">YOUR WEEK · EXAMPLE ONLY <span>7 DAYS</span></div><div class="bbob-days"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span></div><div class="bbob-sample-day"><img src="${lead.image}" alt="${esc(lead.name)}" loading="lazy"><div><small>Monday · Dinner planned</small><strong>${esc(lead.name)}</strong><span>${duration(lead.mins)} · serves ${lead.servings}</span></div></div><div class="bbob-mealrow">Tuesday <strong>Open dinner slot</strong></div><div class="bbob-mealrow">Wednesday <strong>Open dinner slot</strong></div><p class="bbob-preview-disclaimer">Illustration only. Your saved week is never changed by this tour.</p></div>`;
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

 function options(items,selected,multiple,group=''){return `<div class="bbob-options ${multiple?'bbob-goals':''}">${items.map((v,i)=>`<button type="button" class="bbob-option ${selected.includes(v)?'chosen':''}" data-bbob-opt="${i}"${group?` data-bbob-group="${group}"`:''} aria-pressed="${selected.includes(v)}"><span class="bbob-choice-mark" aria-hidden="true">${selected.includes(v)?'✓':' '}</span><span>${v}</span></button>`).join('')}</div>`;}
 const titles=['Welcome','Account','Partner sharing','Household','Goals','Preferences','Discover','Plan','Shop','You’re all set','Membership'];
 function fourContent(){
   const screen=state.step===1?1:state.step===3?2:state.step===2?3:4;
   const premium=window.BasketBossVerifiedPremium?.isActive?.()===true;
   const eligible=native()&&window.BasketBossNativeTrialOffer?.isEligible?.()===true;
   const returning=flow.authIntent==='return';
   const progress=`<div class="bbob-flow-progress" aria-label="Step ${screen} of 4">${[1,2,3,4].map(n=>`<span class="${n<=screen?'is-done':''}"></span>`).join('')}</div>`;
   const header=screen===1?`<div class="bbob-flow-brand"><img src="${LOGO}" alt=""><span>BasketBoss</span></div>`:`<div class="bbob-flow-top"><button type="button" class="bbob-flow-back" data-bbob="flow-back" aria-label="Back">‹</button>${screen===4?btn('Continue with Free','flow-free','link'):progress}</div>`;
   let title='',description='',art='',actions='';
   if(screen===1){
     title='Your weekly shop,<br>sorted.';
     art=`<figure class="bbob-flow-hero"><img src="${RECIPES[1].image}" alt="Creamy garlic parmesan chicken pasta" width="500" height="300"><figcaption>Less dinner admin. More family time.</figcaption></figure><ul class="bbob-flow-benefits"><li><span aria-hidden="true">£</span><span>Cut your weekly grocery bill</span></li><li><span aria-hidden="true">✓</span><span>Use up what's already in your fridge</span></li><li><span aria-hidden="true">▤</span><span>Auto-build your shopping list in seconds</span></li></ul>`;
     actions=btn('Build My Weekly Plan','flow-build')+btn('Browse 200 free recipes','flow-browse','link')+btn('Already have an account? Sign in','flow-return','link');
   }else if(screen===2){
     title='Tailor your weekly plan';description='Two quick taps — make it work for your household.';
     art=`<section><h2>Who are you feeding?</h2><div class="bbob-flow-house" role="group" aria-label="Who are you feeding?">${FLOW_HOUSE.map(([label,value],i)=>`<button type="button" data-bbob-opt="${i}" data-bbob-group="flow-house" class="${state.house===value?'chosen':''}" aria-pressed="${state.house===value}">${label}</button>`).join('')}</div>${state.house==='Family with kids'?'<p class="bbob-flow-hint">Starts at 4 servings. Adjust anytime in Plan.</p>':''}</section><section><h2>What's your biggest goal?</h2><div class="bbob-flow-goals" role="group" aria-label="Your biggest goal">${FLOW_GOALS.map(([icon,label],i)=>`<button type="button" data-bbob-opt="${i}" data-bbob-group="flow-goal" class="${flow.goal===label?'chosen':''}" aria-pressed="${flow.goal===label}"><span aria-hidden="true">${icon}</span><span>${label}</span><span aria-hidden="true">${flow.goal===label?'●':'○'}</span></button>`).join('')}</div></section>`;
     actions=btn('Continue','flow-next');
   }else if(screen===3){
     title=returning?'Welcome back.':'Save your personalised plan';
     description=returning?'Sign in to your saved kitchen.':`Keep your ${esc(flowHouseLabel())} plan and shopping list synced across devices.`;
     const accountOpen=quickAccountOpen;
     art=`<section class="bbob-flow-auth"><div data-bbob-apple ${welcomeAppleAvailable()?'':'hidden'}><button type="button" class="bbob-btn bbob-apple" data-bbob="flow-apple"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.26 3.5 7.59 9.05 7.31c1.35.07 2.29.76 3.08.82 1.18-.24 2.31-.94 3.57-.85 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08zM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25z"/></svg><span data-bbob-apple-label>Continue with Apple</span></button><p data-bbob-apple-status role="status" hidden></p></div><div data-bbob-google ${welcomeGoogleAvailable()?'':'hidden'}><button type="button" class="bbob-btn bbob-google" data-bbob="flow-google" aria-label="Continue with Google">${GOOGLE_ICON}<span data-bbob-google-label>Continue with Google</span></button><p data-bbob-google-status role="status" hidden></p></div>${btn('✉　Continue with Email','flow-email','outline')}<div id="bbobQuickAccountPanel" class="bbob-quick-account-panel" ${accountOpen?'':'hidden'}><div id="bbobAuthSlot" class="bbob-auth-slot"></div><div id="bbobMessageSlot" class="bbob-message-slot" aria-live="polite"></div></div></section>`;
     actions=btn(returning?'Back to welcome':'Skip for now',returning?'flow-back':'flow-skip','link');
   }else{
     title=premium?'Your Premium kitchen is ready':`Your ${esc(flowHouseLabel())} plan is ready`;
     const goal=FLOW_GOALS.find(([,label])=>label===flow.goal)?.[2];
     description=goal==='Waste less food'?"Make the most of what's already in your fridge.":goal==='Plan dinners faster'?'Less dinner admin. More time for your evenings.':flow.goal===FLOW_GOALS[3][1]?'Find meals you enjoy and make planning easier.':'Built to cut your weekly grocery bill and use what’s already at home.';
     const terms=premium?'Your verified Premium membership is already active. No new subscription is needed.':native()?(eligible?'7 days free if eligible. Review the renewal price and cancellation terms with your store before subscribing.':'Review available trials and renewal prices in your store before subscribing.'):'Web trials: eligible Founder members get 7 days free, then £1.99/month. Standard gets 3 days free, then £3.99/month. Checkout confirms eligibility and terms.';
     art=`<div class="bbob-flow-panel"><h2>INCLUDED IN BASKETBOSS PREMIUM</h2><ul class="bbob-flow-includes"><li><span aria-hidden="true">✓</span>Smart Auto-Fill Pro</li><li><span aria-hidden="true">✓</span>At-home pantry savings</li><li><span aria-hidden="true">✓</span>Auto-scaled shopping lists</li></ul></div><div class="bbob-flow-panel"><ol class="bbob-flow-timeline"><li><span aria-hidden="true">1</span><div><strong>${premium?'Premium active':eligible?'Today — £0':'Choose your plan'}</strong><p>${premium?'Your access is already verified.':eligible?'Start your eligible 7-day free trial.':'See your available trial and renewal terms.'}</p></div></li><li><span aria-hidden="true">2</span><div><strong>Stay in control</strong><p>Manage or cancel through your subscription provider.</p></div></li><li><span aria-hidden="true">3</span><div><strong>${eligible?'Day 7 — Trial ends':'After your trial'}</strong><p>${eligible?'Your selected plan renews at the price your store shows.':'Your selected plan renews unless cancelled.'}</p></div></li></ol></div><p class="bbob-flow-terms bbob-flow-note">${terms}</p>`;
     actions=premium?btn('Continue to My Plan','flow-free'):btn(eligible?'Start 7-Day Free Trial':'See trial & Premium plans','flow-trial');
   }
   if(replaying)actions+=btn('Cancel setup','replay-cancel','link');
   return `<div class="bbob-flow-shell" data-flow-step="${screen}"><header>${header}</header><section class="bbob-flow-main bbob-main" aria-labelledby="bbob-title">${screen===4?'<span class="bbob-flow-tag">● PERSONALISED FOR YOU</span>':screen===3?'<div class="bbob-flow-auth-mark" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 21v-2a6.5 6.5 0 0 1 13 0v2Z"/></svg></div>':''}<h1 id="bbob-title">${title}</h1>${description?`<p class="bbob-description">${description}</p>`:''}${art}<p id="bbobSaveError" role="alert" class="bbob-save-error"></p></section><footer class="bbob-flow-footer bbob-footer">${actions}</footer></div>`;
 }
 function completeFour(destination='week'){
   if(!host||blocked())return false;
   flow.authIntent='';flow.checkoutActor='';
   if(!saveFlow(true)){flowError('Could not save your setup. Please check device storage and retry.');return false;}
   if(!complete(false,destination))return false;
   return true;
 }
 function flowStep(step){
   const previous=state.step;state.step=step;
   if(!persist()){state.step=previous;flowError('Could not save your progress. Please retry.');return false;}
   render();
   // Back/Skip leaves the shared credential form. Reuse the existing keyboard
   // bridge after its nodes move home, without touching the native controller.
   if(previous===2&&step!==2&&typeof window.BBNative?.dismissKeyboard==='function'){
     window.requestAnimationFrame?.(()=>{
       if(flowAuthStep()||document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
       try{Promise.resolve(window.BBNative.dismissKeyboard()).catch(()=>{});}catch(_){}
     });
   }
   return true;
 }
 function flowAuth(intent){
   flow.authIntent=intent;if(!saveFlow()){flowError('Could not save your progress. Please retry.');return;}
   quickAccountOpen=intent==='return';
   if(flowStep(2)&&quickAccountOpen)window.BBAuthFlow?.open?.('sign-in',{switchAccount:accountRemembered()&&!validSession()});
 }
 function finishVerifiedFlow(){
   if(!four||!host||state.step!==10||blocked()||!flow.checkoutActor)return false;
   if(flow.checkoutActor!==currentActor())return false;
   if(window.BasketBossVerifiedPremium?.isActive?.()!==true)return false;
   return completeFour();
 }
 function chooseFlowOption(i,group){
   if(group==='flow-house'){
     const selected=FLOW_HOUSE[i];if(!selected)return;
     const previous=state.house;state.house=selected[1];
     if(!replaying&&window.BasketBossSetOnboardingServings?.(HOUSE_SERVINGS[state.house])!==true){state.house=previous;flowError('Could not save your household size. Please retry.');return;}
     changedPreferences.add('house');
   }else if(group==='flow-goal'){
     const selected=FLOW_GOALS[i];if(!selected)return;
     flow.goal=selected[1];
     // High-protein is a local display preference, never a new planner goal.
     state.goals=selected[2]?[selected[2]]:[];changedPreferences.add('goals');
     if(!saveFlow()){flowError('Could not save your goal. Please retry.');return;}
   }
   if(!persist()){flowError('Could not save your choices. Please retry.');return;}render();
 }
 function fourAction(action){
   if(action==='flow-build'){flowStep(3);return;}
   if(action==='flow-browse'){completeFour('discover');return;}
   if(action==='flow-free'){completeFour();return;}
   if(action==='flow-return'){
     if(validSession()){flow.authIntent='';flow.checkoutActor='';if(!saveFlow()){flowError('Could not save your progress. Please retry.');return;}if(completeWelcomeAccount())document.querySelector('.shell .tabs [data-tab="week"]')?.click();}
     else flowAuth('return');return;
   }
   if(action==='flow-next'){
     if(validSession()){flow.authIntent='';saveFlow();flowStep(10);}else flowAuth('save');return;
   }
   if(action==='flow-skip'){flow.authIntent='';saveFlow();flowStep(10);return;}
   if(action==='flow-back'){
     const step=state.step;
     if(step===2){quickAccountOpen=false;flowStep(flow.authIntent==='return'?1:3);flow.authIntent='';saveFlow();}
     else if(step===10&&!validSession())flowAuth('save');else flowStep(step===10?3:1);
     return;
   }
   if(action==='flow-email'){
     const panel=host.querySelector('#bbobQuickAccountPanel');if(!panel)return;
     quickAccountOpen=true;panel.hidden=false;host.classList.add('bbob-account-open');
     window.BBAuthFlow?.open?.(flow.authIntent==='return'?'sign-in':'sign-up',{switchAccount:accountRemembered()&&!validSession()});sizeWelcomeViewport();
     panel.scrollIntoView?.({block:'nearest',behavior:'instant'});return;
   }
   if(action==='flow-apple'){void signInWelcomeApple();return;}
   if(action==='flow-google'){void signInWelcomeGoogle();return;}
   if(action==='flow-trial'){
     if(!validSession()){flowAuth('save');return;}
     if(window.BasketBossVerifiedPremium?.isActive?.()===true){completeFour();return;}
     const error=applyChosenPreferences();if(error){flowError(error);return;}
     if(native()&&typeof window.BBNativeMembership?.open!=='function'){flowError('Plans are still opening. Please retry, or continue with Free.');return;}
     flow.checkoutActor=currentActor();
     if(!saveFlow()||!persist()){flowError('Could not save your progress. Please retry.');return;}
     // Only navigate to the existing plan selectors. Their original purchase,
     // verification, acknowledgment and cancellation handlers stay in charge.
     if(replaying&&!completeFour())return;
     if(native())window.BBNativeMembership.open();
     else window.location.assign('pricing-sandbox.html#monthly');
   }
 }
 function quickContent(){
   const step=QUICK_STEPS.indexOf(state.step)+1;
   const premium=window.BasketBossVerifiedPremium?.isActive?.()===true;
   let title='',description='',art='',actions='';
   if(state.step===1){
     title=state.partnerIntent==='join'?'Join your partner’s kitchen.':'Your weekly shop, <span class="bbob-title-together">sorted. 👑</span>';
     description='Plan meals, organise your groceries and make better use of what you’ve already got.';
     art=`<div class="bbob-quick-welcome"><img src="${RECIPES[1].image}" alt="Creamy garlic parmesan chicken pasta" width="500" height="300"><div><span>LESS DINNER ADMIN. MORE FAMILY TIME.</span><strong>A little help for the whole week.</strong></div></div><ul class="bbob-quick-benefits" aria-label="What you can do with BasketBoss"><li><span aria-hidden="true">▦</span><span>Plan meals for the week.</span></li><li><span aria-hidden="true">✓</span><span>Organise groceries and household essentials.</span></li><li><span aria-hidden="true">♧</span><span>Use pantry ingredients and leftovers.</span></li></ul><div class="bbob-quick-free"><p><strong>Explore 200 free recipes.</strong><span>No subscription or account needed to get started.</span></p></div>`;
     if(accountRemembered()){
       art+='<div class="bbob-auth-ready" role="status">✓ You’re already signed in. Your account and saved meals are ready.</div>';
     }else{
       const accountOpen=quickAccountOpen||state.partnerIntent==='join';
       art+=`<section class="bbob-quick-account" data-bbob-account><div class="bbob-quick-apple" data-bbob-apple ${welcomeAppleAvailable()?'':'hidden'}><button type="button" class="bbob-btn bbob-apple" data-bbob="quick-apple" aria-label="Continue with Apple"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.26 3.5 7.59 9.05 7.31c1.35.07 2.29.76 3.08.82 1.18-.24 2.31-.94 3.57-.85 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08l.01-.01zM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25z"/></svg><span data-bbob-apple-label>Continue with Apple</span></button><p class="bbob-quick-apple-status" data-bbob-apple-status role="status" aria-live="polite" hidden></p></div><div class="bbob-quick-auth-actions">${btn('Create free account','quick-signup','outline')}${btn(state.partnerIntent==='join'?'Sign in with invited email':'Sign in','quick-signin','outline')}</div><p class="bbob-quick-account-note">Sign in to save and sync. Exploring Free needs no account.</p><div id="bbobQuickAccountPanel" class="bbob-quick-account-panel" ${accountOpen?'':'hidden'}><div id="bbobAuthSlot" class="bbob-auth-slot"></div><div id="bbobMessageSlot" class="bbob-message-slot" aria-live="polite"></div>${btn('Back to welcome','quick-account','link')}</div></section>`;
     }
     actions=btn(state.partnerIntent==='join'?'Continue without joining':'Explore BasketBoss Free','free-complete')+btn('Set up my household · Optional','next','link');
   }else if(state.step===3){
     title='Make it work for your household.';
     description='Set your usual portions and shopping region. Everything here is optional and can be changed later.';
     art=`<section class="bbob-quick-setup" aria-label="Household setup"><h2>Who are you cooking for?</h2>${options(HOUSE,state.house?[state.house]:[],false,'house')}<label class="bbob-market-label" for="bbob-region">Shopping region<select id="bbob-region" data-bbob-region><option value="">Choose later in Settings</option>${REGIONS.map(r=>`<option value="${r}" ${state.region===r?'selected':''}>${r==='US'?'United States':r}</option>`).join('')}</select></label></section><details class="bbob-quick-details" data-bbob-preferences ${quickPreferencesOpen?'open':''}><summary>Diet & planning preferences <span>Optional</span></summary><h2>Any dietary preferences?</h2>${options(DIETS,state.diets,true,'diets')}<p class="bbob-quick-note">Always check ingredient labels and allergens.</p><h2>What would make dinner easier?</h2><p class="bbob-quick-note">Choose up to three to guide Auto-fill suggestions.</p>${options(GOALS,state.goals,true,'goals')}</details><details class="bbob-quick-details" data-bbob-partner ${quickPartnerOpen?'open':''}><summary>Planning with a partner? <span>Optional</span></summary><p>Partner Sharing links one verified partner when enabled for Premium.</p><div class="bbob-quick-partner-actions">${btn(state.wantsPartnerInvite?'✓ Invite preference saved':'Invite one partner (Premium)','partner-invite','outline')}${btn('Join an invitation','partner-join','outline')}${state.wantsPartnerInvite?btn('Not now','partner-later','link'):''}</div>${state.wantsPartnerInvite?'<p class="bbob-quick-note" role="status">We’ll help you invite your partner after account verification and Premium activation. No email has been sent.</p>':''}</details>`;
     actions=btn('Continue','next')+btn('Skip setup for now','skip','link')+btn('Back','back','link');
   }else{
     title=premium?'Your Premium kitchen is ready.':'More possibilities. Less dinner admin.';
     description=premium?'Your verified Premium membership is already active. Your saved meals and preferences are ready to use.':'Make the most of your food, your time and your weekly shop with BasketBoss Premium.';
     art=`<div class="bbob-quick-offer"><div class="bbob-quick-offer-top"><span class="bbob-quick-crown" aria-hidden="true">♛</span><span>BASKETBOSS PREMIUM</span>${premium?'<b>ACTIVE</b>':'<b>YOUR KITCHEN, UPGRADED</b>'}</div><h2>${premium?'Everything you need, together.':'A little help for the whole week.'}</h2><ul><li><span aria-hidden="true">✦</span><div><strong>700 recipes to make your own</strong><p>More family favourites, fresh ideas and meals worth repeating.</p></div></li><li><span aria-hidden="true">✓</span><div><strong>Smarter weekly planning</strong><p>Smart Auto-fill, batch cooking and tools to make your basket go further.</p></div></li><li><span aria-hidden="true">⌁</span><div><strong>Turn pantry photos into a starting point</strong><p>Scan food and review the suggested ingredients before using them.</p></div></li><li><span aria-hidden="true">♫</span><div><strong>A helping hand while you cook</strong><p>Hands-free Voice Cook, plus optional AI meal ideas.</p></div></li></ul></div><p class="bbob-quick-note bbob-quick-offer-note">${premium?'Your membership stays exactly as it is. Continue to start planning.':native()?'Review current Apple plans and available prices on the next screen. Restore Purchases is available there.':'Review current plans, prices and subscription terms on the next screen.'}${premium?'':' AI tools have daily limits and depend on service availability.'}</p>`;
     actions=premium?btn('Continue to BasketBoss','free-complete'):btn('See Premium plans','quick-premium')+btn('Continue with BasketBoss Free','free-complete','outline');
     actions+=btn('Back','back','link');
   }
   return `<div class="bbob-shell"><header class="bbob-header"><div class="bbob-brand"><img src="${LOGO}" alt=""><span>Basket<span>Boss</span></span></div><button type="button" class="bbob-exit" data-bbob="${replaying?'replay-cancel':'free'}" aria-label="${replaying?'Cancel setup and keep existing preferences':'Continue with BasketBoss Free'}">${replaying?'Cancel setup':'Continue free'} <span aria-hidden="true">×</span></button></header>${state.step===1?'':`<div class="bbob-quick-progress" aria-label="Optional setup step ${step-1} of 2"><span>${step===2?'Your household':'Your BasketBoss'}</span><b>${step-1} of 2</b><div><i style="width:${(step-1)/2*100}%"></i></div></div>`}<section class="bbob-main" aria-labelledby="bbob-title"><p class="bbob-eyebrow">${state.step===10?'YOUR BASKETBOSS':'WELCOME TO BASKETBOSS'}</p><h1 id="bbob-title">${title}</h1><p class="bbob-description">${description}</p>${art}<p id="bbobSaveError" role="alert" class="bbob-save-error"></p></section><footer class="bbob-footer">${actions}</footer></div>`;
 }
 function content(){
   if(four)return fourContent();
   if(quick)return quickContent();
   let headline='',eyebrow='',description='',art='',foot='',actions='';
   switch(state.step){
     case 0:
       eyebrow='WELCOME TO BASKETBOSS';headline=installed()? 'Thanks for downloading BasketBoss!' : 'Welcome to BasketBoss.';
       description='Plan meals. Shop smarter. Waste less. Start with 200 free recipes, then set BasketBoss up for your household.';
       art='<div class="bbob-intro-art bbob-restored-animation">'+originalCrownAnimation()+'<strong class="bbob-intro-wordmark">Basket<span>Boss</span></strong><span>Built for real-life food shopping.</span></div>';
       actions=btn('Let’s get started','next')+btn('Browse 200 free recipes instead','free','link');break;
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
       description='Choose up to three. Your choices guide Auto-fill suggestions and can be changed later in Plan.';
       art=options(GOALS,state.goals,true);actions=btn('Continue','next')+btn('Skip question','skip','link');break;
     case 5:
       eyebrow='YOUR PREFERENCES';headline='Any dietary preferences?';
       description='Auto-fill uses these choices when suggesting meals. You can change them later in Plan. Always check ingredient labels and allergens.';
       art=options(DIETS,state.diets,true);actions=btn('Show me BasketBoss','next')+btn('Skip question','skip','link');break;
     case 6:
       eyebrow='STEP 1 OF 3 · DISCOVER';headline='Dinner ideas without the endless scrolling.';
       description='Explore 200 recipes free. Browse for something the family will actually enjoy.';
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
       eyebrow='THE BASKETBOSS WAY';headline='Your kitchen, <em>made simple.</em>';
       description='Plan your meals. Use what you have. Top up what you need.';
       const kitchenIcon=path=>`<span class="bbob-kitchen-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
       art=`<div class="bbob-kitchen-routine">
         <ol class="bbob-kitchen-steps">
           <li>${kitchenIcon('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>')}<div><strong>Plan</strong><p>Auto-fill, or choose meals in Discover. Set servings.</p></div><span class="bbob-kitchen-order" aria-hidden="true">01</span></li>
           <li>${kitchenIcon('<path d="m3 10 2 10h14l2-10H3Zm5 0V7a4 4 0 0 1 8 0v3m-7 4v3m6-3v3"/>')}<div><strong>At home</strong><p>Check what you have, then confirm the amounts.</p></div><span class="bbob-kitchen-order" aria-hidden="true">02</span></li>
           <li>${kitchenIcon('<path d="M10 5h11M10 12h11M10 19h11M3 5l1 1 2-3m-3 9 1 1 2-3m-3 9 1 1 2-3"/>')}<div><strong>Shop</strong><p>Buy what’s missing. Finish shop or confirm a receipt to restock.</p></div><span class="bbob-kitchen-order" aria-hidden="true">03</span></li>
           <li>${kitchenIcon('<path d="M5 10h14v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-7ZM3 10h18M9 7h6v3M2 13h3m14 0h3M8 3v1m8-1v1"/>')}<div><strong>Cook</strong><p>Tap Confirm cooked or Day done to record what you used.</p></div><span class="bbob-kitchen-order" aria-hidden="true">04</span></li>
           <li class="bbob-kitchen-repeat">${kitchenIcon('<path d="M19 8a8 8 0 0 0-13-3L3 8m0-5v5h5m-3 8a8 8 0 0 0 13 3l3-3m0 5v-5h-5"/>')}<div><strong>Next week starts with what’s left.</strong><p>Review leftovers and essentials, then plan again.</p></div></li>
         </ol>
       </div>`;
       foot='';
       actions=btn('Let’s get started','next')+btn('Back','back','link');break;
     default:
       if(native()){
         eyebrow='READY TO GET STARTED';headline='Your BasketBoss is ready.';
         description='Start planning with 200 Free recipes. You can sign in to an existing account and check your account status in Settings.';
         art='<div class="bbob-auth-ready" role="status">✓ Your setup is ready</div>';
         foot='No purchase is needed to use BasketBoss Free.';
         actions=btn('Start using BasketBoss','free-complete')+btn('Back','back','link');
         break;
       }
       eyebrow='ONE LAST THING';headline='Choose your BasketBoss experience.';
       description='Start with BasketBoss Free or explore Premium. You decide — there’s no need to subscribe to use your free account.';
       art='<div class="bbob-plan-options"><div class="bbob-plan"><strong>BasketBoss Free</strong><b>£0</b><p>200 recipes and basic meal planning.</p><span>No card needed</span></div><div class="bbob-plan bbob-plan-premium"><strong>Premium / Founder offer</strong><b>See plans</b><p>All 700 recipes, including 50 breakfast options, optional meal planning, advanced planning and eligible Premium AI features.</p><span>Standard Premium £3.99/month. Founder £1.99/month after a 7-day trial if eligible among the first 25 confirmed members. Final prices, renewals and trial terms are shown at checkout.</span></div></div>';
       foot='Standard is monthly, not annual. Founder eligibility is verified at checkout. Subscription checkout requires a signed-in account; payment, taxes and renewal terms are confirmed on the existing secure Paddle page.';
       actions=btn('Explore Premium plans','premium')+btn('Continue with BasketBoss Free','free-complete','outline');
   }
   const optionalTour=state.step>=6&&state.step<=9;
   if(optionalTour)actions+=btn('Skip tour','skip-tour','outline');
   const counter=state.step===0?'':`<div class="bbob-progress" aria-label="${optionalTour?'Optional tour · ':''}Onboarding step ${state.step+1} of ${STEP_MAX+1}"><span style="width:${Math.min(100,Math.round(100*state.step/STEP_MAX))}%"></span></div>`;
   const headingMarkup=`<p class="bbob-eyebrow">${eyebrow}</p><h1 id="bbob-title">${headline}</h1>`;
   const intro=state.step===9?`<div class="bbob-kitchen-hero"><div class="bbob-kitchen-hero-copy">${headingMarkup}</div><img class="bbob-kitchen-meal" src="release-assets/basketboss-v17/images/existing/creamy-pasta.webp" alt="" width="360" height="360"><span class="bbob-kitchen-ribbon">Plan. Shop. Cook. Repeat.</span></div><p class="bbob-description">${description}</p>`:`${headingMarkup}<p class="bbob-description">${description}</p>`;
   return `<div class="bbob-shell"><header class="bbob-header"><div class="bbob-brand"><img src="${LOGO}" alt=""><span>Basket<span>Boss</span></span></div><button type="button" class="bbob-exit" data-bbob="${replaying?'replay-cancel':'free'}" aria-label="${replaying?'Cancel setup and keep existing preferences':'Exit onboarding and explore free recipes'}">${replaying?'Cancel setup':'Explore Free'} <span aria-hidden="true">×</span></button></header>${counter}<section class="bbob-main" aria-labelledby="bbob-title">${intro}${art}${foot?`<p class="bbob-footnote">${foot}</p>`:''}<p id="bbobSaveError" role="alert" class="bbob-save-error"></p></section><footer class="bbob-footer">${actions}<div class="bbob-stepname">${optionalTour?'Optional tour · ':''}${titles[state.step]} · ${state.step+1} of 11</div></footer></div>`;
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
 function accountInput(){const active=document.activeElement;return (state.step===1||flowAuthStep())&&active?.matches?.('#cloud-email,#cloud-password')&&host?.contains?.(active)?active:null;}
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
   host.classList?.toggle('bbob-keyboard',(state.step===1||flowAuthStep())&&editing&&height<fullViewportHeight-100);
   window.requestAnimationFrame?.(keepAuthFocusVisible);
 }
 function render(){if(!host)return;
   const focused=document.activeElement;
   const choice=four&&host.contains(focused)&&focused?.dataset?.bbobOpt!==undefined?{index:focused.dataset.bbobOpt,group:focused.dataset.bbobGroup}:null;
   if(quick){
     const accountPanel=host.querySelector('#bbobQuickAccountPanel');if(accountPanel)quickAccountOpen=!accountPanel.hidden;
     for(const [selector,remember] of [['[data-bbob-preferences]',value=>{quickPreferencesOpen=value;}],['[data-bbob-partner]',value=>{quickPartnerOpen=value;}]]){
       const details=host.querySelector(selector);if(details)remember(details.open===true);
     }
   }
   host.classList?.toggle('bbob-four-step',four);
   host.classList?.toggle('bbob-quick',quick&&!four);host.classList?.toggle('bbob-quick-welcome-screen',quick&&state.step===1);host.classList?.toggle('bbob-account-open',four?flowAuthStep()&&quickAccountOpen:quick&&state.step===1&&(quickAccountOpen||state.partnerIntent==='join'));host.classList?.toggle('bbob-quick-premium',quick&&state.step===10);host.classList?.toggle('bbob-kitchen-slide',!quick&&state.step===9);restoreAuth();host.innerHTML=content();
   if((four?flowAuthStep()&&!validSession():state.step===1&&!accountRemembered()))mountAuth();
   syncWelcomeApple();syncWelcomeGoogle();
   sizeWelcomeViewport();host.scrollTop=0;
   if(four){
     const target=choice?host.querySelector('[data-bbob-opt="'+choice.index+'"][data-bbob-group="'+choice.group+'"]'):host.querySelector('#bbob-title');
     if(!choice)target?.setAttribute('tabindex','-1');target?.focus({preventScroll:true});
   }else if(state.step===1&&!accountRemembered()){
     const heading=host.querySelector('#bbob-title');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});
   }else (host.querySelector('[data-bbob="next"]')||host.querySelector('[data-bbob="free-complete"]'))?.focus({preventScroll:true});
 }
 // Existing app setters own every plan preference write. Legacy/replay drafts
 // commit on exit; fresh four-step feeding taps also use the same servings setter.
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
   const meals={};
   for(const key of ['diets','goals']){
     if(four&&key==='goals'&&flow.goal===FLOW_GOALS[3][1])continue;
     const selected=Array.isArray(state[key])?state[key]:[];
     if(replaying?changedPreferences.has(key):(selected.length>0||changedPreferences.has(key)))meals[key]=selected.slice();
   }
   if(Object.keys(meals).length){
     if(typeof window.BasketBossSetOnboardingMealPreferences!=='function')return 'Meal preference controls are unavailable. Please refresh and retry.';
     if(window.BasketBossSetOnboardingMealPreferences(meals)!==true)return 'Could not save your meal preferences. Please retry; your choices are kept.';
   }
   return '';
 }
 function authenticated(){
   if(!validSession()||blocked())return false;
   if(four&&!state.complete){
     if(state.partnerIntent==='join'&&host){finishJoinHandoff();return state.complete===true;}
     if(flow.authIntent==='return'){
       flow.authIntent='';flow.checkoutActor='';saveFlow(true);
       return completeWelcomeAccount();
     }
     if(flow.authIntent!=='save')return true;
     state.step=10;flow.authIntent='';
     if(!persist()||!saveFlow())return false;
     // The auth owner closes Account and selects Plan synchronously. Resume the
     // presentation afterwards, without modifying its callbacks or routing.
     queueMicrotask(()=>{
       if(blocked()||state.complete||!validSession())return;
       accountRequested=false;quickAccountOpen=false;
       if(host)render();else begin(true);
     });
     return true;
   }
   if(quick&&!state.complete){
     if(state.partnerIntent==='join'&&host){finishJoinHandoff();return state.complete===true;}
     // Account creation is enough to start. Household setup remains available
     // through its explicit optional action and Settings replay.
     if(host&&state.step===1&&!replaying)return completeWelcomeAccount();
     // Signing in is optional setup, not consent to finish or purchase. Keep
     // the mounted short flow moving without committing its preference draft.
     const previous=state.step;state.step=3;
     if(!persist()){
       state.step=previous;
       const status=host?.querySelector('#bbobSaveError')||id('cloud-message');
       if(status)status.textContent='Could not save your setup. Please retry; your choices are kept.';
       return false;
     }
     if(host)render();return true;
   }
   // Signing in must not commit a Settings replay draft or overwrite later
   // planner edits from an already completed survey.
   if(replaying){dismiss();return true;}
   if(state.complete)return true;
   const error=applyChosenPreferences();
   if(error){
     const status=host?.querySelector('#bbobSaveError')||id('cloud-message');
     if(status)status.textContent=error;
     return false;
   }
   state.complete=true;state.started=false;
   if(!persist(true)){
     state.complete=false;state.started=true;
     const status=host?.querySelector('#bbobSaveError')||id('cloud-message');
     if(status)status.textContent='Could not save your setup. Please retry; your choices are kept.';
     return false;
   }
   dismiss(false);return true;
 }
 function completeWelcomeAccount(){
   // Signing in commits no optional preference draft or planner changes.
   const previous={complete:state.complete,started:state.started};
   state.complete=true;state.started=false;
   if(!persist(true)){
     Object.assign(state,previous);
     const status=host?.querySelector('#bbobSaveError')||id('cloud-message');
     if(status)status.textContent='Signed in. Could not save welcome completion. Please retry; your choices are kept.';
     return false;
   }
   write('basketboss_onboarding_seen_v1','true');
   try{sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1')}catch(_){}
   dismiss(false);return true;
 }
 function complete(goPremium=false,destination='discover'){
   if(!host||blocked())return false;
   const firstSetup=!replaying;
   if(!persist()){
     host.querySelector('#bbobSaveError')?.replaceChildren(document.createTextNode('Unable to save your setup on this device. Please check browser storage and retry.'));
     return false;
   }
   const error=applyChosenPreferences();
   if(error){
     const status=host.querySelector('#bbobSaveError');
     if(status)status.textContent=error;
     return false;
   }
   state.complete=true;state.started=false;
   if(!persist(true)){state.complete=false;state.started=true;
     const status=host.querySelector('#bbobSaveError');
     if(status)status.textContent='Could not save onboarding completion. Please retry.';
     return false;
   } // Selected meal choices were saved through the planner preference setter.
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
     document.querySelector(destination==='week'?'.shell .tabs [data-tab="week"]':'.shell .tabs [data-tab="discover"]')?.click();
     if(firstSetup&&!quick)window.BBHowItWorks?.setupFinished?.();
   }
   return true;
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
 function chooseOption(i,group=''){
   if(blocked())return;
   const section=quick&&state.step===3?({house:3,goals:4,diets:5}[group]||3):state.step;
   const items=section===3?HOUSE:section===4?GOALS:DIETS;
   const v=items[i];if(v===undefined)return;
   if(section===3){state.house=v;changedPreferences.add('house');}
   if(section===4){const set=new Set(state.goals);set.has(v)?set.delete(v):(set.size<3&&set.add(v));state.goals=[...set];changedPreferences.add('goals');}
   if(section===5){const set=new Set(state.diets);if(v===DIETS[0]){state.diets=[v];}
     else{set.delete(DIETS[0]);set.has(v)?set.delete(v):set.add(v);state.diets=[...set];}changedPreferences.add('diets');}
   persist();render();
 }
 function dismiss(restoreReplay=true){
   const closeSettings=!restoreReplay&&replaying;
   const closingHost=host;
   const dismissNative=window.BBNative?.isNative===true&&form&&host?.contains(form)&&typeof window.BBNative.dismissKeyboard==='function'
     ?window.BBNative.dismissKeyboard.bind(window.BBNative):null;
   const editable=node=>node?.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')===true;
   // WKWebView can keep the keyboard attached when its focused input is moved
   // back to the account panel. End editing before restoring the shared form.
   const active=document.activeElement;
   if(active&&host?.contains(active))active.blur?.();
   unlockWelcomeBackground();restoreAuth();host?.remove();host=null;
   if(restoreReplay&&replaying&&replayOriginal){state=replayOriginal;if(four&&flowOriginal)flow=flowOriginal;}
   replaying=false;replayOriginal=null;changedPreferences.clear();
   // Restoring a credential field would immediately reopen the keyboard.
   if(lastFocus?.isConnected&&!editable(lastFocus))lastFocus.focus({preventScroll:true});
   if(closeSettings)document.querySelector('.bbui-settings-overlay:not([hidden]) .bbui-settings-close')?.click();
   if(dismissNative){
     // Let WebKit apply the restored form's hidden parent before UIKit ends
     // editing. Calling the bridge before this move races its responder update.
     const finishDismissal=()=>{
       if(host||closingHost?.isConnected===true)return;
       const current=document.activeElement;
       // A different visible field can belong to a newly opened form. The
       // original input retaining focus is the responder we still must dismiss.
       if(current!==active&&editable(current)&&current.getClientRects?.().length)return;
       if(editable(current))current.blur?.();
       try{Promise.resolve(dismissNative()).catch(()=>{});}catch(_){}
     };
     if(typeof window.requestAnimationFrame==='function')window.requestAnimationFrame(finishDismissal);
     else queueMicrotask(finishDismissal);
   }
 }
 function replay(){
   if(host||blocked())return false;
   accountRequested=false;
   replayOriginal=JSON.parse(JSON.stringify(restoreState()||state));
   if(four){flowOriginal=JSON.parse(JSON.stringify(flow));flow.authIntent='';flow.checkoutActor='';}
   state={house:'',goals:[],diets:[],region:'',partnerStepV2:true,wantsPartnerInvite:false,partnerIntent:'none',...replayOriginal,step:quick?1:0,started:true,complete:false};
   state.goals=Array.isArray(state.goals)?[...state.goals]:[];state.diets=Array.isArray(state.diets)?[...state.diets]:[];
   replaying=true;changedPreferences.clear();
   return begin(true);
 }
 function begin(force=false){
   if((!force&&!willShow())||host||blocked()||(!force&&accountRequested))return false;
   if(!force)state=restoreState()||state;
   // Everyone sees the new rollout once; saved recipes, plans and sessions stay intact.
   if(!state.started){state=quick?{...state,started:true,complete:false}:{step:0,house:'',goals:[],diets:[],region:'',started:true,complete:false,partnerStepV2:true,wantsPartnerInvite:false,partnerIntent:'none'};persist();}
   else if(!state.partnerStepV2){
     // Resume older incomplete onboarding at the corresponding screen; never
     // reset or repeat the tour for users who already completed it.
     if(!quick&&Number.isInteger(state.step)&&state.step>=2&&state.step<=9)state.step++;
     state.partnerStepV2=true;
     if(!persist())return;
   }
   if(!Number.isInteger(state.step)||state.step<0||state.step>STEP_MAX)state.step=0;
   if(quick){
     state.goals=Array.isArray(state.goals)?state.goals:[];state.diets=Array.isArray(state.diets)?state.diets:[];
     const mapped=four?(state.step<=1?1:[3,2,10].includes(state.step)?state.step:state.step<=5?3:10):state.step<=1?1:state.step<=5?3:10;
     if(state.step!==mapped){state.step=mapped;persist();}
     if(four&&state.step===2&&!flow.authIntent){flow.authIntent='save';saveFlow();}
     quickSetupOriginal={house:state.house,region:state.region,goals:[...state.goals],diets:[...state.diets]};
   }
   oldOverflow=document.body.style.overflow;lastFocus=document.activeElement;
   host=document.createElement('div');host.id='bbNewOnboarding';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','BasketBoss welcome and setup');
   document.body.appendChild(host);document.body.style.overflow='hidden';lockWelcomeBackground();
   fullViewportHeight=window.visualViewport?.height||window.innerHeight||0;
   host.addEventListener('focusin',sizeWelcomeViewport);
   host.addEventListener('focusout',()=>queueMicrotask(sizeWelcomeViewport));
   host.addEventListener('click',e=>{
     if(blocked())return;
     const option=e.target.closest('[data-bbob-opt]');if(option&&four){chooseFlowOption(Number(option.dataset.bbobOpt),option.dataset.bbobGroup);return;}if(option){chooseOption(Number(option.dataset.bbobOpt),option.dataset.bbobGroup);return;}
     const action=e.target.closest('[data-bbob]')?.dataset.bbob;if(!action)return;
     if(action==='replay-cancel'){dismiss();return;}
     if(four&&action.startsWith('flow-')){fourAction(action);return;}
     if(action==='quick-apple'&&quick&&state.step===1){void signInWelcomeApple();return;}
     if(['quick-account','quick-signup','quick-signin'].includes(action)&&quick&&state.step===1){
       const panel=host.querySelector('#bbobQuickAccountPanel'),toggle=host.querySelector('[data-bbob="quick-account"]');
       if(!panel)return;
       quickAccountOpen=action==='quick-account'?panel.hidden:true;
       if(!quickAccountOpen&&panel.contains(document.activeElement))document.activeElement.blur?.();
       panel.hidden=!quickAccountOpen;toggle?.setAttribute('aria-expanded',String(quickAccountOpen));
       host.classList?.toggle('bbob-account-open',quickAccountOpen);
       // Reveal the original controls in place: changing innerHTML here would
       // detach the credential fields and disrupt native focus and drafts.
       sizeWelcomeViewport();
       if(quickAccountOpen){
         if(action!=='quick-account'){
           window.BBAuthFlow?.open?.(action==='quick-signup'?'sign-up':'sign-in');
         }
         (toggle||panel).scrollIntoView?.({block:'start',behavior:'instant'});
       }
       return;
     }
     if(action==='free'||action==='free-complete'){complete();return;}
     if(action==='premium'){complete(true);return;}
     if(action==='quick-premium'&&quick&&state.step===10){
       if(!native()){complete(true);return;}
       const membership=window.BBNativeMembership;
       if(typeof membership?.open!=='function'){
         const status=host.querySelector('#bbobSaveError');
         if(status)status.textContent='Premium plans are still opening. Please retry, or continue with BasketBoss Free.';
         return;
       }
       // The native hook only navigates to the existing Apple membership
       // screen. Never leave before local setup and its original setters save.
       if(complete(false)===true&&state.complete&&!host)membership.open();
       return;
     }
     if(action==='skip-tour'&&state.step>=6&&state.step<=9){state.step=STEP_MAX;persist();render();return;}
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
       if((state.step===2||quick&&state.step===1) && state.partnerIntent==='join' && validSession()){finishJoinHandoff();return;}
       state.step=quick?(state.step===1?3:10):Math.min(STEP_MAX,state.step+1);persist();render();return;
     }
     if(action==='skip'){
       if(quick){
         if(state.step!==3)return;
         Object.assign(state,{...quickSetupOriginal,goals:[...quickSetupOriginal.goals],diets:[...quickSetupOriginal.diets]});
         for(const key of ['house','region','goals','diets'])changedPreferences.delete(key);
         state.step=10;persist();render();return;
       }
       if(state.step===3){state.house=replaying?(replayOriginal.house||''):'';state.region=replaying?(replayOriginal.region||''):'';changedPreferences.delete('house');changedPreferences.delete('region');}
       if(state.step===4){state.goals=replaying?[...(replayOriginal.goals||[])]:[];changedPreferences.delete('goals');}
       if(state.step===5){state.diets=replaying?[...(replayOriginal.diets||[])]:[];changedPreferences.delete('diets');}
       state.step=Math.min(STEP_MAX,state.step+1);persist();render();return;
     }
     if(action==='back'){state.step=quick?(state.step===10?3:1):Math.max(0,state.step-1);persist();render();}
   });
   host.addEventListener('change',e=>{if(!blocked()&&e.target.matches('[data-bbob-region]')){state.region=e.target.value;changedPreferences.add('region');persist();}});
   host.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation?.();if(replaying)dismiss();else if(four)completeFour(state.step===1?'discover':'week');else complete();}});
   render();if(four)finishVerifiedFlow();window.BBFunnel?.once?.('onboarding_viewed');return true;
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
   window.addEventListener('basketboss:auth-ready',syncWelcomeApple);
   window.addEventListener('basketboss:apple-auth-availability',syncWelcomeApple);
   window.addEventListener('basketboss:google-auth-availability',syncWelcomeGoogle);
   window.addEventListener('basketboss:auth-ready',syncWelcomeGoogle);
   trimFounder();begin();replayLabel();
   document.addEventListener('click',event=>{
     if(!event.target.closest?.('#bbOnboardingReplay,#bbBetaWelcomeReplay'))return;
     event.preventDefault();event.stopImmediatePropagation();replay();
   },true);
   if(typeof MutationObserver==='function')new MutationObserver(replayLabel).observe(document.body,{childList:true,subtree:true});
   window.addEventListener('basketboss:session-changed',()=>{
     if(four){syncWelcomeApple();syncWelcomeGoogle();return;}
     if(blocked()||!host||state.step!==1)return;
     // A late signed-out notification must not move the shared form while
     // someone is editing: reparenting it blurs the input and hides iOS's keyboard.
     if(validSession()){if(state.partnerIntent==='join')finishJoinHandoff();else if(quick&&!replaying)authenticated();else{state.step=quick?3:2;persist();render();}}else if(!accountInput())render();
   });
   document.addEventListener('basketboss:premium-verified',()=>{if(four){if(!finishVerifiedFlow()&&host&&state.step===10&&!blocked())render();return;}if(quick&&host&&state.step===10&&!blocked())render();});
   window.addEventListener('basketboss:trial-offer-changed',()=>{if(four&&host&&state.step===10&&!blocked())render();});
   window.addEventListener('basketboss:account-deletion-started',()=>{if(host)dismiss();if(four){flow.authIntent='';flow.checkoutActor='';saveFlow(true);}replayLabel();});
   window.addEventListener('basketboss:account-deletion-deleted',()=>{if(host)dismiss();replayLabel();});
   window.addEventListener('basketboss:account-deletion-cancelled',event=>queueMicrotask(()=>{replayLabel();if(!event.detail?.reconciled)begin();}));
   window.addEventListener('basketboss:native-startup-ready',()=>{replayLabel();begin();});
   document.addEventListener('close',event=>{if(event.target?.id==='bbAccountDeletionDialog'){replayLabel();if(!deleting())begin();}},true);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
