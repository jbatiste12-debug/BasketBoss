import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {readWorkerInventory} from './helpers/service-worker-inventory.mjs';

const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
const [html,privacy,script,css,handler,worker]=await Promise.all([
  'index.html','privacy.html','bb-funnel.js','bb-funnel.css','functions/api/funnel/[event].js','service-worker.js'
].map(read));

function visitor({store=new Map(),sessionStore=new Map(),storageBlocked=false,fetchThrows=false,readyState='complete',welcome=null}={}){
  const calls=[],listeners=new Map(),timers=[],classes=new Set(),nodes={};
  const on=(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);};
  const fire=(name,event={})=>{for(const fn of listeners.get(name)||[])fn(event);};
  class El{
    constructor(id){this.id=id;this.hidden=false;this.children={};this.value='';this.textContent='';this.nodeName='BUTTON';this.classList={contains:()=>false};}
    setAttribute(k,v){this[k]=v;}
    getAttribute(k){return k==='data-recipe'?this.recipe:null;}
    closest(selector){
      if(this.recipe&&selector==='[data-recipe]')return this;
      if(this.id==='cloud-signup'&&selector.includes('cloud-signup'))return this;
      if(this.id==='try-free'&&selector.includes('data-bbc-free'))return this;
      if(this.id==='cloud-open'&&selector.includes('cloud-open'))return this;
      return null;
    }
    querySelector(s){return this.children[s]||null;}
    addEventListener(n,fn){this[n]=fn;}
    click(){this.didClick=true;}
  }
  nodes.bbColdVisitor=new El('bbColdVisitor');nodes['cloud-open']=new El('cloud-open');
  const doc={readyState,documentElement:{classList:{contains:c=>classes.has(c)}},body:{appendChild(el){nodes.bbFunnelNudge=el;}},getElementById(id){return nodes[id]||null;},querySelector(){return null;},
    createElement(){const b=new El('bbFunnelNudge');b.children['[data-bbf-signup]']=new El('nudge-account');b.children['[data-bbf-dismiss]']=new El('nudge-dismiss');return b;},addEventListener:on};
  const modes=[];
  const win={addEventListener:on,setTimeout:fn=>timers.push(fn),BBAuthFlow:{open:mode=>modes.push(mode)},getComputedStyle:node=>({visibility:node.visibility||'visible'})};
  if(welcome){
    const host=new El('bbNewOnboarding');host.hidden=welcome.hidden===true;host.visibility=welcome.visibility||'visible';host.getClientRects=()=>welcome.rects===0?[]:[{}];nodes.bbNewOnboarding=host;
    // Match the real document order: onboarding's optional call happens before
    // the following deferred funnel script has installed its public API.
    win.BBFunnel?.once?.('onboarding_viewed');
  }
  const storage=map=>({getItem(k){if(storageBlocked)throw Error('Unavailable');return map.get(k)||null;},setItem(k,v){if(storageBlocked)throw Error('Unavailable');map.set(k,String(v));}});
  const context={document:doc,window:win,Element:El,localStorage:storage(store),sessionStorage:storage(sessionStore),Date,fetch:(url,options)=>{calls.push({url,options});if(fetchThrows)throw Error('Offline');return Promise.resolve({ok:true});}};
  vm.runInNewContext(script,context,{filename:'bb-funnel.js'});
  return {calls,store,sessionStore,nodes,win,doc,El,classes,modes,fire,click:t=>fire('click',{target:t}),count:event=>calls.filter(c=>c.url.endsWith('/'+event)).length,flush(){while(timers.length)timers.shift()();}};
}

test('Signup funnel retains account entrypoints and cache protections',()=>{
  assert.match(html,/<script defer src="bb-funnel\.js\?v=[a-z0-9-]+"><\/script>/);
  assert.match(html,/<link rel="stylesheet" href="bb-funnel\.css\?v=[a-z0-9-]+">/);
  assert.match(html,/id="cloud-signup"/);
  assert.match(html,/id="cloud-open"/);
  assert.match(html,/id="bbColdVisitor"/);
  assert.match(html,/<meta property="og:image"/);
  assert.match(worker,/20261116-add-food-amount1-web700/);
  const inventory=readWorkerInventory(worker);assert.equal(inventory.imports,1);assert.match(inventory.version,/^[a-f0-9]{64}$/);assert.equal(inventory.cache,inventory.base+'-'+inventory.version);
  assert.match(worker,/target\.pathname\.startsWith\(new URL\('api\/', APP_BASE\)\.pathname\)\) return/);
  assert.match(privacy,/Anonymous usage steps/);
  assert.match(privacy,/Local once-only flags/);
  assert.match(privacy,/not unique visitor counts or proof of a newly created account/);
});

test('Tracking accepts only named events, never reads credentials/content or writes business data',()=>{
  assert.doesNotMatch(script,/\b(?:BILLING_DB|GEMINI_API_KEY|service_role|access_token\s*:\s*|\/api\/paddle)\b/);
  assert.doesNotMatch(script,/cloud-email|cloud-password|MutationObserver|event\.detail|e\.detail/);
  assert.doesNotMatch(handler,/\.prepare\(|\bconsole\.log\(|read\(|\.json\(|get\('Cookie'\)/);
  assert.match(script,/credentials:'omit'/);
  assert.match(script,/referrerPolicy:'no-referrer'/);
  assert.match(script,/seenRecipes\.add\(key\)/);
  assert.match(script,/window\.BBFunnel=Object\.freeze\(\{track,once\}\)/);
  assert.match(css,/#bbFunnelNudge\[hidden\]/);
  assert.match(css,/min-height:44px/);
});

test('Anonymous endpoint allows all lifecycle steps, safe categories and legacy names only',async()=>{
  const mod=await import('data:text/javascript;base64,'+Buffer.from(handler).toString('base64'));
  const h=visitor({readyState:'loading'});
  const events=[...script.match(/const EVENTS=new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
  for(const event of events){
    assert.equal(h.win.BBFunnel.track(event),true,event);
    const yes=await mod.onRequestPost({params:{event}});
    assert.equal(yes.status,204,event);assert.equal(await yes.text(),'');assert.equal(yes.headers.get('Cache-Control'),'no-store');
  }
  for(const event of ['secret_email','signup_failed_person@example.test','signup_failed_bad_password_detail','__proto__',undefined]){
    assert.equal(h.win.BBFunnel.track(event),false);
    assert.equal((await mod.onRequestPost({params:{event}})).status,404);
  }
  const notGet=await mod.onRequestGet();assert.equal(notGet.status,405);assert.equal(notGet.headers.get('Allow'),'POST');
});

test('Recipe fallback remains optional; Create free account opens the real account panel in signup mode',()=>{
  const h=visitor();
  assert.equal(h.count('landing'),1);assert.equal(h.count('first_app_open'),1);
  const one=new h.El('recipe');one.recipe='123';h.click(one);h.click(one);
  assert.equal(h.nodes.bbFunnelNudge,undefined,'not shown after one unique recipe');
  const two=new h.El('recipe');two.recipe='456';h.click(two);
  assert.equal(h.nodes.bbFunnelNudge.hidden,false);assert.equal(h.count('nudge_shown'),1);
  h.nodes.bbFunnelNudge.children['[data-bbf-signup]'].click();
  assert.equal(h.nodes['cloud-open'].didClick,true);assert.deepEqual(h.modes,['sign-up']);assert.equal(h.nodes.bbFunnelNudge.hidden,true);
  assert.ok(h.calls.every(c=>c.options.body===undefined&&c.options.credentials==='omit'&&c.options.referrerPolicy==='no-referrer'));
});

test('Clicks do not imply signup API calls; real lifecycle retries count without exposing error details',()=>{
  const h=visitor();h.click(new h.El('cloud-signup'));
  assert.equal(h.count('signup_click'),1);assert.equal(h.count('signup_attempted'),0);assert.equal(h.count('signup_valid'),0);
  const api=h.win.BBFunnel;
  api.track('signup_screen_viewed');api.track('signup_screen_viewed');
  api.track('signup_method_email');api.track('signup_method_email');
  api.track('signup_attempted');api.track('signup_failed_network');
  api.track('signup_attempted');api.track('signup_confirmation_pending');
  assert.equal(h.count('signup_screen_viewed'),1);assert.equal(h.count('signup_method_selected'),1);
  assert.equal(h.count('signup_attempted'),2);assert.equal(h.count('signup_failed_network'),1);assert.equal(h.count('signup_failed'),1);
  assert.equal(h.count('signup_confirmation_pending'),1);assert.equal(h.count('confirmation_message'),1);assert.equal(h.count('signup_succeeded'),0);
  api.track('signup_failed_rate_limited');assert.equal(h.count('signup_failed'),2,'separate real failed attempts remain countable');
  api.track('signup_succeeded');assert.equal(h.count('signup_succeeded'),1,'only controller may signal verified persisted signup');
});

test('Restored or returning sessions never imply a successful signup or show a signup promotion',()=>{
  const h=visitor();
  h.store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:'FIXTURE_USER'},access_token:'FIXTURE_NEVER_TRANSMIT',expires_at:Math.floor(Date.now()/1000)+7200}));
  h.fire('basketboss:session-changed');h.fire('focus');
  assert.equal(h.count('signed_in'),1);assert.equal(h.count('signup_succeeded'),0);
  h.fire('basketboss:first-meal-plan-created');h.flush();
  assert.equal(h.count('first_meal_plan_created'),1);assert.equal(h.nodes.bbFunnelNudge,undefined);
  assert.ok(h.calls.every(x=>!JSON.stringify(x).includes('FIXTURE_NEVER_TRANSMIT')&&!JSON.stringify(x).includes('FIXTURE_USER')));
});

test('First steps persist once across reloads; milestone signup reminder never reads event content',()=>{
  const h=visitor();h.win.BBFunnel.once('onboarding_viewed');h.win.BBFunnel.once('onboarding_viewed');
  h.fire('basketboss:first-meal-plan-created',{get detail(){throw Error('Must not read saved content');}});
  h.fire('basketboss:first-shopping-list-created');h.flush();
  assert.equal(h.count('onboarding_viewed'),1);assert.equal(h.count('first_meal_plan_created'),1);assert.equal(h.count('first_shopping_list_created'),1);
  assert.match(h.nodes.bbFunnelNudge.innerHTML,/Like what you’ve planned\?/);
  assert.match(h.nodes.bbFunnelNudge.innerHTML,/Create your free account to save and sync it/);
  h.fire('basketboss:first-meal-plan-created');h.flush();assert.equal(h.count('first_meal_plan_created'),1);assert.equal(h.count('nudge_shown'),1);
  const reloaded=visitor({store:h.store});reloaded.win.BBFunnel.once('onboarding_viewed');reloaded.fire('basketboss:first-meal-plan-created');reloaded.flush();
  assert.equal(reloaded.count('first_app_open'),0);assert.equal(reloaded.count('onboarding_viewed'),0);assert.equal(reloaded.count('first_meal_plan_created'),0);assert.equal(reloaded.nodes.bbFunnelNudge,undefined);
});

test('Signup reminder waits for onboarding to close and respects dismissal',()=>{
  const h=visitor();h.classes.add('bb-onboarding-open');
  h.fire('basketboss:first-meal-plan-created');h.flush();assert.equal(h.nodes.bbFunnelNudge,undefined);
  h.classes.delete('bb-onboarding-open');h.fire('basketboss:welcome-finished');h.flush();assert.equal(h.nodes.bbFunnelNudge.hidden,false);
  h.nodes.bbFunnelNudge.children['[data-bbf-dismiss]'].click();h.fire('basketboss:first-shopping-list-created');h.flush();
  assert.equal(h.nodes.bbFunnelNudge.hidden,true);assert.equal(h.sessionStore.get('bb_funnel_nudge_dismissed_v1'),'1');
});

test('Storage and network failure never break app startup or auth lifecycle instrumentation',()=>{
  const h=visitor({storageBlocked:true,fetchThrows:true});
  assert.equal(h.count('first_app_open'),1);assert.equal(h.win.BBFunnel.once('first_app_open'),false);
  assert.equal(h.win.BBFunnel.once('onboarding_viewed'),true);assert.equal(h.win.BBFunnel.once('onboarding_viewed'),false);
  assert.equal(h.win.BBFunnel.track('signup_attempted'),true);assert.equal(h.win.BBFunnel.track('signup_failed_network'),true);
  assert.ok(h.calls.every(c=>c.options.body===undefined));
});

test('Safe API exists before DOM ready and DOM readiness cannot double-count first app open',()=>{
  const h=visitor({readyState:'loading'});
  assert.ok(h.win.BBFunnel);assert.equal(h.count('first_app_open'),0);
  h.win.BBFunnel.once('onboarding_viewed');h.fire('DOMContentLoaded');h.fire('DOMContentLoaded');
  assert.equal(h.count('first_app_open'),1);assert.equal(h.count('landing'),1);
});

test('the real deferred script order replays an already-visible welcome exactly once',()=>{
  const onboarding=html.indexOf('<script defer src="bb-onboarding-v2.js?'),funnel=html.indexOf('<script defer src="bb-funnel.js?');
  assert.ok(onboarding>=0&&funnel>onboarding,'the test reproduces the actual onboarding-before-funnel document order');
  const h=visitor({readyState:'interactive',welcome:{}});
  assert.equal(h.count('onboarding_viewed'),1,'the preceding welcome is recorded after the funnel API becomes available');
  h.win.BBFunnel.once('onboarding_viewed');h.fire('DOMContentLoaded');assert.equal(h.count('onboarding_viewed'),1);
  const next=visitor({store:h.store,readyState:'interactive',welcome:{}});assert.equal(next.count('onboarding_viewed'),0,'reload preserves durable milestone deduplication');
});

test('startup never invents an onboarding view for a missing or hidden welcome',()=>{
  for(const welcome of [null,{hidden:true},{rects:0},{visibility:'hidden'}]){
    const h=visitor({readyState:'interactive',welcome});assert.equal(h.count('onboarding_viewed'),0);
    assert.equal(h.count('first_app_open'),1,'ordinary startup tracking still works');
  }
});
