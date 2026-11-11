import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const source=fs.readFileSync(new URL('../bb-onboarding-v2.js',import.meta.url),'utf8');
const KEY='bb_onboarding_fresh_once_20261028_v1';
const PLAN='basketboss_321_unified_state_v1',SESSION='basketboss_cloud_session_v1';
const prior={step:4,started:true,complete:false,house:'2 people',region:'UK',goals:['Plan dinners faster'],diets:['Vegetarian'],partnerStepV2:true,wantsPartnerInvite:true,partnerIntent:'invite'};

function harness({saved,native=false,hook=true,premium=false,store,script=source,quick=true}={}){
 const storage=store||new Map([[PLAN,'existing meals, pantry and budget']]);
 if(saved)storage.set(KEY,JSON.stringify(saved));
 const nodes=[],writes=[],preferences=[],navigation=[],events=new Map(),docEvents=new Map();
 let storageBlocked=false,completionBlocked=false,mealsSaved=true,activePremium=premium,howMany=0;
 const on=(map,name,fn)=>{const list=map.get(name)||[];list.push(fn);map.set(name,list);};
 const status={textContent:'',replaceChildren(node){this.textContent=node.textContent;}};
 const rootClasses=new Set();
 const replayButton={id:'bbOnboardingReplay',textContent:'',setAttribute(){},focus(){},isConnected:true};
 replayButton.parentNode={appendChild(){}};
 const location={hostname:native?'localhost':'basketboss.co.uk',protocol:native?'capacitor:':'https:',search:'',hash:'',assign(target){navigation.push({target,saved:JSON.parse(storage.get(KEY)),closed:!active()});}};
 const document={readyState:'complete',activeElement:replayButton,body:{style:{overflow:''},appendChild(node){nodes.push(node);}},documentElement:{style:{setProperty(){},removeProperty(){}},classList:{contains:name=>rootClasses.has(name),add:name=>rootClasses.add(name),remove:name=>rootClasses.delete(name)}},
  querySelector(selector){return quick&&selector==='meta[name="basketboss-onboarding"]'?{content:'quick-v1'}:null;},querySelectorAll:()=>[],getElementById:id=>id===replayButton.id?replayButton:null,createTextNode:text=>({textContent:text}),
  createElement(){const classes=new Set();return {innerHTML:'',events:new Map(),classList:{toggle(name,enabled){enabled?classes.add(name):classes.delete(name);},contains:name=>classes.has(name)},style:{setProperty(){}},contains:()=>false,setAttribute(){},addEventListener(name,fn){on(this.events,name,fn);},querySelector:selector=>selector==='#bbobSaveError'?status:null,remove(){this.removed=true;}};},addEventListener(name,fn){on(docEvents,name,fn);}};
 const active=()=>nodes.findLast(node=>!node.removed);
 const window={location,innerHeight:844,innerWidth:390,scrollTo(){},matchMedia:()=>({matches:false}),addEventListener(name,fn){on(events,name,fn);},BBNative:native?{isNative:true}:undefined,
  BasketBossVerifiedPremium:{isActive:()=>activePremium},BBHowItWorks:{setupFinished(){howMany++;}},BasketBossSetOnboardingServings(value){preferences.push({house:value});return true;},bb307SwitchIsland(value){preferences.push({region:value});return true;},BasketBossSetOnboardingMealPreferences(value){preferences.push({meals:JSON.parse(JSON.stringify(value))});return mealsSaved;}};
 if(native&&hook)window.BBNativeMembership={open(){navigation.push({target:'native-membership',saved:JSON.parse(storage.get(KEY)),closed:!active()});return true;}};
 const context={window,document,location,localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){if(storageBlocked||completionBlocked&&key===KEY&&JSON.parse(value).complete===true)throw Error('storage unavailable');writes.push([key,value]);storage.set(key,value);}},sessionStorage:{setItem(){}},navigator:{standalone:false},URLSearchParams,queueMicrotask,console};
 vm.runInNewContext(script,context,{timeout:1000});
 function tap(action,option,group){assert.ok(active(),'onboarding should be open');for(const fn of active().events.get('click')||[])fn({target:{closest(selector){if(selector==='[data-bbob-opt]'&&option!==undefined)return {dataset:{bbobOpt:String(option),bbobGroup:group}};if(selector==='[data-bbob]'&&action)return {dataset:{bbob:action}};return null;}}});}
 return {window,storage,writes,preferences,navigation,status,active,tap,read:()=>JSON.parse(storage.get(KEY)||'null'),setStorageBlocked:value=>{storageBlocked=value;},setCompletionBlocked:value=>{completionBlocked=value;},setMealsSaved:value=>{mealsSaved=value;},howMany:()=>howMany,
  region(value){for(const fn of active().events.get('change')||[])fn({target:{value,matches:()=>true}});},signIn(){storage.set(SESSION,JSON.stringify({user:{id:'existing-account'},access_token:'fresh-token',expires_at:9999999999}));},dispatch(name){for(const fn of events.get(name)||[])fn();},verifyPremium(value){activePremium=value;for(const fn of docEvents.get('basketboss:premium-verified')||[])fn();}};
}

test('current catalogue build renders 200 Free recipes while the preserved legacy source retains 100',()=>{
 const current=harness({script:transform700Presentation(source)});
 assert.match(current.active().innerHTML,/Explore 200 free recipes\./);
 assert.doesNotMatch(current.active().innerHTML,/100 recipes|100 free recipes/);
 const legacy=harness({quick:false});
 assert.match(legacy.active().innerHTML,/100 free recipes/);
 assert.match(legacy.active().innerHTML,/Welcome · 1 of 11/);
 assert.equal(harness().read().step,1);
});

test('quick setup has three screens, preserves drafts on Back and finishes Free without a tutorial or billing write',()=>{
 const h=harness();
 assert.equal(h.read().step,1);assert.match(h.active().innerHTML,/Setup step 1 of 3/);
 assert.match(h.active().innerHTML,/Have an account\? Sign in or create one/);
 assert.doesNotMatch(h.active().innerHTML,/bbob-original-logo-motion|Optional tour|of 11/);
 h.tap('next');assert.equal(h.read().step,3);
 h.tap(null,1,'house');h.region('Guernsey');h.tap(null,1,'diets');h.tap(null,0,'goals');
 assert.deepEqual(h.preferences,[]);
 h.tap('next');assert.equal(h.read().step,10);assert.match(h.active().innerHTML,/Setup step 3 of 3/);
 assert.match(h.active().innerHTML,/700 recipes|See Premium plans|Continue with BasketBoss Free/);
 assert.doesNotMatch(h.active().innerHTML,/£|free trial|Founder|Paddle|data-bbob="premium"/);
 h.tap('back');assert.equal(h.read().step,3);assert.equal(h.read().region,'Guernsey');
 h.tap('back');assert.equal(h.read().step,1);h.tap('next');h.tap('next');h.tap('free-complete');
 assert.equal(h.active(),undefined);assert.equal(h.read().complete,true);
 assert.deepEqual(h.preferences,[{house:2},{region:'Guernsey'},{meals:{diets:['Vegetarian'],goals:['Spend less on groceries']}}]);
 assert.equal(h.storage.get(PLAN),'existing meals, pantry and budget');assert.equal(h.navigation.length,0);assert.equal(h.howMany(),0);
 assert.ok(h.writes.every(([key])=>[KEY,'basketboss_onboarding_seen_v1'].includes(key)));
 const returning=harness({store:h.storage});assert.equal(returning.active(),undefined);
});

test('incomplete legacy screens map once without losing household, diet, goals or partner intent',()=>{
 for(let old=0;old<=10;old++){
  for(const partnerStepV2 of [true,false]){
   const saved={...prior,step:old,partnerStepV2},h=harness({saved});
   assert.equal(h.read().step,old<=1?1:old<=5?3:10);
   for(const key of ['house','region','goals','diets','wantsPartnerInvite','partnerIntent'])assert.deepEqual(h.read()[key],saved[key]);
   assert.equal(h.read().complete,false);assert.deepEqual(h.preferences,[]);
   const resumed=harness({store:h.storage});assert.equal(resumed.read().step,h.read().step);
  }
 }
 const h=harness({saved:{...prior,started:false}});assert.equal(h.read().house,'2 people');assert.deepEqual(h.read().diets,['Vegetarian']);
});

test('skip setup restores its pre-edit answers and never commits while navigating',()=>{
 const h=harness({saved:prior});h.tap(null,3,'house');h.region('US');h.tap(null,2,'diets');h.tap(null,2,'goals');
 h.tap('skip');assert.equal(h.read().step,10);
 for(const key of ['house','region','goals','diets','wantsPartnerInvite','partnerIntent'])assert.deepEqual(h.read()[key],prior[key]);
 assert.deepEqual(h.preferences,[]);
 h.tap('free-complete');assert.deepEqual(h.preferences,[{house:2},{region:'UK'},{meals:{diets:['Vegetarian'],goals:['Plan dinners faster']}}]);
});

test('successful optional authentication advances to household without completion or preference writes',()=>{
 const h=harness({saved:{...prior,step:1}});h.signIn();assert.equal(h.window.BBOnboard2026.authenticated(),true);
 assert.equal(h.read().step,3);assert.equal(h.read().complete,false);assert.deepEqual(h.preferences,[]);
 assert.ok(h.active());assert.match(h.active().innerHTML,/Who are you cooking for/);
 h.tap('next');assert.match(h.active().innerHTML,/See Premium plans/);
 const session=harness();session.signIn();session.dispatch('basketboss:session-changed');assert.equal(session.read().step,3);assert.equal(session.read().complete,false);assert.deepEqual(session.preferences,[]);
});

test('partner join still requires a fresh authenticated session and preserves its secure invitation handoff',()=>{
 const h=harness({saved:{...prior,step:3,partnerIntent:'none',wantsPartnerInvite:false}});
 h.tap('partner-join');assert.equal(h.read().step,1);assert.equal(h.read().partnerIntent,'join');assert.equal(h.read().complete,false);
 assert.equal(h.window.BBOnboard2026.authenticated(),false);assert.deepEqual(h.preferences,[]);
 h.signIn();h.tap('next');assert.equal(h.read().complete,true);assert.equal(h.active(),undefined);assert.deepEqual(h.preferences,[]);
});

test('Settings replay cancels without writes and only commits fields explicitly edited at Finish',()=>{
 const saved={...prior,step:10,complete:true,started:false},h=harness({saved}),before=h.storage.get(KEY);
 assert.equal(h.active(),undefined);assert.equal(h.window.BBOnboard2026.open(),true);assert.equal(h.storage.get(KEY),before);
 h.tap('next');h.tap(null,3,'house');h.tap(null,2,'diets');h.tap('next');assert.equal(h.storage.get(KEY),before);
 h.tap('replay-cancel');assert.equal(h.active(),undefined);assert.equal(h.storage.get(KEY),before);assert.deepEqual(h.preferences,[]);
 h.window.BBOnboard2026.open();h.tap('next');h.tap(null,3,'house');h.tap('next');h.tap('free-complete');
 assert.deepEqual(h.preferences,[{house:5}]);assert.equal(h.read().house,'5+ people');assert.deepEqual(h.read().diets,['Vegetarian']);
});

test('native Premium opens only after successful setup persistence and dismissal, with no purchase call',()=>{
 const h=harness({native:true,saved:prior});h.tap('next');
 assert.match(h.active().innerHTML,/Restore Purchases is available there/);
 h.tap('quick-premium');assert.equal(h.read().complete,true);assert.equal(h.active(),undefined);
 assert.equal(h.navigation.length,1);assert.equal(h.navigation[0].target,'native-membership');assert.equal(h.navigation[0].saved.complete,true);assert.equal(h.navigation[0].closed,true);
 assert.equal(h.storage.get(PLAN),'existing meals, pantry and budget');
});

test('native Premium leaves setup open if its navigation hook, storage or original preference setter is unavailable',()=>{
 const missing=harness({native:true,hook:false,saved:prior});missing.tap('next');missing.tap('quick-premium');
 assert.ok(missing.active());assert.equal(missing.read().complete,false);assert.deepEqual(missing.preferences,[]);assert.match(missing.status.textContent,/retry|continue with BasketBoss Free/);
 for(const failure of ['storage','completion','preferences']){
  const h=harness({native:true,saved:prior});h.tap('next');
  if(failure==='storage')h.setStorageBlocked(true);if(failure==='completion')h.setCompletionBlocked(true);if(failure==='preferences')h.setMealsSaved(false);
  h.tap('quick-premium');assert.ok(h.active(),failure);assert.equal(h.read().complete,false,failure);assert.equal(h.navigation.length,0,failure);assert.ok(h.status.textContent,failure);
  h.setStorageBlocked(false);h.setCompletionBlocked(false);h.setMealsSaved(true);h.tap('quick-premium');assert.equal(h.navigation.length,1,failure);assert.equal(h.read().complete,true,failure);
 }
});

test('quick web Premium delegates to existing checkout after setup, and never navigates on failed storage',()=>{
 const h=harness();h.tap('next');h.tap('next');h.setStorageBlocked(true);h.tap('quick-premium');
 assert.equal(h.navigation.length,0);assert.ok(h.active());h.setStorageBlocked(false);h.tap('quick-premium');
 assert.equal(h.navigation[0].target,'pricing-sandbox.html#monthly');assert.equal(h.navigation[0].saved.complete,true);assert.equal(h.navigation[0].closed,true);
});

test('verified Premium members get Continue without an upsell and Free completion never changes their entitlement',()=>{
 const h=harness();h.tap('next');h.tap('next');h.verifyPremium(true);
 assert.match(h.active().innerHTML,/Your Premium kitchen is ready|Continue to BasketBoss/);assert.doesNotMatch(h.active().innerHTML,/data-bbob="quick-premium"/);
 h.tap('free-complete');assert.equal(h.window.BasketBossVerifiedPremium.isActive(),true);assert.equal(h.navigation.length,0);
 const active=harness({premium:true});active.tap('next');active.tap('next');assert.doesNotMatch(active.active().innerHTML,/data-bbob="quick-premium"/);
});
