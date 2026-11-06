import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const {install}=createRequire(import.meta.url)('../bb-session.js');
const KEY='basketboss_cloud_session_v1',LOCK='basketboss_account_deletion_v1';
const actor='11111111-1111-4111-8111-111111111111',clock=1800000000000;
const saved={user:{id:actor,email:'example@example.invalid'},access_token:'expired-access',refresh_token:'saved-refresh',expires_at:clock/1000-10};
const fresh={...saved,access_token:'renewed-access',refresh_token:'rotated-refresh',expires_in:3600,expires_at:clock/1000+3600};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function harness({session=saved,respond=()=>Response.json(fresh),online=true,lock=null,loading=false}={}){
 const values=new Map(session?[[KEY,JSON.stringify(session)]]:[]),timers=new Map(),calls=[];let id=0,time=clock,events=0;
 if(lock)values.set(LOCK,JSON.stringify(lock));
 const win=new EventTarget(),doc=new EventTarget();doc.readyState=loading?'loading':'complete';doc.visibilityState='visible';
 Object.assign(win,{document:doc,Event,navigator:{onLine:online},BASKETBOSS_CLOUD_CONFIG:{url:'https://example.supabase.co',anonKey:'public'},localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}});
 win.addEventListener('basketboss:session-changed',()=>events++);
 const api=install(win,{now:()=>time,fetch:async(url,options)=>{calls.push({url,options});return respond(url,options);},setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key)});
 const event=(type,props={})=>{const e=new Event(type);Object.assign(e,props);win.dispatchEvent(e);};
 return {win,doc,api,values,calls,timers,event,get events(){return events},setTime:t=>time=t,read:()=>JSON.parse(values.get(KEY)||'null')};
}

test('reopening refreshes an expired access token and persists the rotated session for another launch',async()=>{
 const h=harness();h.api.start();await tick();assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/grant_type=refresh_token$/);assert.deepEqual(JSON.parse(h.calls[0].options.body),{refresh_token:'saved-refresh'});
 assert.equal(h.read().refresh_token,'rotated-refresh');assert.equal(h.api.state().remembered,true);assert.equal(h.events,1);
 const reopened=harness({session:h.read()});reopened.api.start();await tick();assert.equal(reopened.calls.length,0);assert.equal(reopened.read().access_token,'renewed-access');
});
test('focus, visibility and native resume share one refresh exchange',async()=>{
 const response=defer(),h=harness({respond:()=>response.promise});h.api.start();h.event('focus');h.event('basketboss:native-resumed');h.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(h.calls.length,1);
 response.resolve(Response.json(fresh));await tick();assert.equal(h.read().access_token,'renewed-access');
});
test('offline, network failures, 429 and 5xx preserve credentials and recover online',async()=>{
 for(const failure of ['offline','network',429,500,503]){
  let broken=true;
  const h=harness({online:failure!=='offline',respond:()=>{if(!broken)return Response.json(fresh);if(failure==='network')throw Error('offline');return Response.json({message:'temporarily unavailable'},{status:typeof failure==='number'?failure:503});}});
  const before=h.values.get(KEY);h.api.start();await tick();assert.equal(h.values.get(KEY),before);assert.equal(h.api.state().remembered,true);assert.equal(h.api.state().needsConnection,true);
  broken=false;h.win.navigator.onLine=true;h.event('online');await tick();assert.equal(h.read().access_token,'renewed-access');
 }
});
test('only a definitive rejected refresh signs out; ambiguous errors keep the saved session',async()=>{
 for(const code of ['refresh_token_not_found','refresh_token_already_used','session_expired']){
  const h=harness({respond:()=>Response.json({code},{status:400})});h.api.start();await tick();assert.equal(h.values.has(KEY),false);assert.equal(h.api.state().remembered,false);
 }
 const h=harness({respond:()=>Response.json({message:'Gateway configuration problem'},{status:401})});h.api.start();await tick();assert.equal(h.read().refresh_token,'saved-refresh');
});
test('late refresh responses cannot resurrect logout, deletion or an account switch',async()=>{
 for(const action of ['logout','deletion','switch','cross-tab-rotation']){
  const response=defer(),h=harness({respond:()=>response.promise});h.api.start();assert.equal(h.calls.length,1);
  if(action==='logout')h.api.remember(null);
  if(action==='deletion'){h.values.set(LOCK,JSON.stringify({phase:'pending',actorId:actor}));h.event('basketboss:account-deletion-started');}
  if(action==='switch')h.api.remember({...fresh,user:{id:'22222222-2222-4222-8222-222222222222'},access_token:'other-account'});
  if(action==='cross-tab-rotation')h.values.set(KEY,JSON.stringify({...fresh,access_token:'newer-tab-token'})); // storage event may not have arrived yet
  const expected=h.values.get(KEY);response.resolve(Response.json(fresh));await tick();assert.equal(h.values.get(KEY),expected);
 }
});
test('persisted deletion locks block refresh before deferred deletion UI initializes',async()=>{
 for(const phase of ['pending','deleting','deleted']){
  const h=harness({lock:{actorId:actor,phase},loading:true});h.api.start();h.event('focus');h.doc.dispatchEvent(new Event('DOMContentLoaded'));await tick();assert.equal(h.calls.length,0);assert.equal(h.api.state().remembered,false);
 }
});
test('fresh sessions wait until near expiry and backgrounding cancels refresh timers',async()=>{
 const h=harness({session:fresh});h.api.start();await tick();assert.equal(h.calls.length,0);assert.equal(h.timers.size,1);
 h.doc.visibilityState='hidden';h.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(h.timers.size,0);
 h.setTime(clock+3550000);h.doc.visibilityState='visible';h.doc.dispatchEvent(new Event('visibilitychange'));await tick();assert.equal(h.calls.length,1);
});
test('malformed or wrong-account refresh responses do not replace remembered credentials',async()=>{
 for(const response of [{...fresh,user:{id:'different-account'}},{...fresh,refresh_token:null},{...fresh,expires_in:undefined,expires_at:undefined}]){
  const h=harness({respond:()=>Response.json(response)});h.api.start();await tick();assert.deepEqual(h.read(),saved);
 }
});
test('session lifecycle remains separate from Premium verification and never edits plans or stock',async()=>{
 const h=harness();h.values.set('basketboss_321_unified_state_v1','meal plan');h.values.set('basketboss_321_v7_measured_pantry','stock');h.api.start();await tick();assert.equal(h.values.get('basketboss_321_unified_state_v1'),'meal plan');assert.equal(h.values.get('basketboss_321_v7_measured_pantry'),'stock');assert.equal(h.win.BasketBossVerifiedPremium,undefined);
 const source=fs.readFileSync(new URL('../bb-onboarding-v2.js',import.meta.url),'utf8');assert.match(source,/const accountRemembered=\(\)=>validSession\(\)\|\|window.BasketBossSession\?\.state\(\).remembered===true/);
 assert.match(source,/const validSession=\(\)=>\{try\{const s=.*expires_at/);
});

test('successful sign-out invalidates membership before session observers run, without touching local stock',()=>{
 const h=harness({session:fresh}),order=[];
 h.values.set('basketboss_321_unified_state_v1','local plan');h.values.set('basketboss_321_v7_measured_pantry','local stock');
 h.win.BasketBossVerifiedPremium={invalidate(){order.push({step:'membership',session:h.values.get(KEY)});}};
 h.win.BBReceiptHost={hasPendingConfirmation:()=>true};
 h.win.addEventListener('basketboss:session-changed',()=>order.push({step:'session',session:h.values.get(KEY)}));
 assert.equal(h.api.remember(null),true);assert.deepEqual(order,[{step:'membership',session:undefined},{step:'session',session:undefined}]);
 assert.equal(h.values.get('basketboss_321_unified_state_v1'),'local plan');assert.equal(h.values.get('basketboss_321_v7_measured_pantry'),'local stock');
});

test('account replacement invalidates the previous grant while ordinary token renewal leaves verification to session observers',()=>{
 const h=harness({session:fresh});let resets=0;h.win.BasketBossVerifiedPremium={invalidate(){resets++;}};
 assert.equal(h.api.remember({...fresh,access_token:'rotated-again'}),true);assert.equal(resets,0);
 assert.equal(h.api.remember({...fresh,user:{id:'22222222-2222-4222-8222-222222222222'},access_token:'free-b'}),true);assert.equal(resets,1);
});

test('a Premium display repaint failure cannot prevent a persisted sign-out or its session notification',()=>{
 const h=harness({session:fresh});h.win.BasketBossVerifiedPremium={invalidate(){throw Error('view no longer mounted');}};
 assert.equal(h.api.remember(null),true);assert.equal(h.values.has(KEY),false);assert.equal(h.events,1);
});

test('a stalled refresh times out without losing sign-in and a later resume can retry',async()=>{
 let stalled=true;
 const h=harness({respond:()=>stalled?new Promise(()=>{}):Response.json(fresh)});h.api.start();
 const timeout=[...h.timers.values()].find(timer=>timer.delay===15000);assert.ok(timeout);timeout.fn();await tick();
 assert.equal(h.api.state().refreshing,false);assert.deepEqual(h.read(),saved);
 stalled=false;h.event('basketboss:native-resumed');await tick();assert.equal(h.calls.length,2);assert.equal(h.read().refresh_token,'rotated-refresh');
});

test('Web Locks serialize token rotation across two pages sharing the same stored session',async()=>{
 const response=defer(),h=harness({respond:()=>response.promise});
 let queue=Promise.resolve();const locks={request(_name,_options,run){const pending=queue.then(run);queue=pending.catch(()=>{});return pending;}};
 h.win.navigator.locks=locks;
 const other=new EventTarget();Object.assign(other,{document:h.doc,Event,navigator:{onLine:true,locks},BASKETBOSS_CLOUD_CONFIG:h.win.BASKETBOSS_CLOUD_CONFIG,localStorage:h.win.localStorage});
 let extra=0;const second=install(other,{now:()=>clock,fetch:async()=>{extra++;return Response.json(fresh)}});
 h.api.start();second.start();await tick();assert.equal(h.calls.length,1);assert.equal(extra,0);
 response.resolve(Response.json(fresh));await tick();await tick();assert.equal(extra,0);assert.equal(second.read().refresh_token,'rotated-refresh');
});

test('membership notifications and unchanged storage events do not discard a rotated token',async()=>{
 const response=defer(),h=harness({respond:()=>response.promise});h.api.start();
 h.event('basketboss:session-changed');h.event('storage',{key:KEY,newValue:h.values.get(KEY)});
 response.resolve(Response.json(fresh));await tick();assert.equal(h.read().refresh_token,'rotated-refresh');assert.equal(h.calls.length,1);
});

test('cancelling deletion during a refresh schedules a fresh attempt after the stale exchange ends',async()=>{
 const response=defer();let first=true;
 const h=harness({respond:()=>{if(first){first=false;return response.promise;}return Response.json(fresh);}});h.api.start();
 h.values.set(LOCK,JSON.stringify({phase:'pending',actorId:actor}));h.event('basketboss:account-deletion-started');h.values.delete(LOCK);h.event('basketboss:account-deletion-cancelled');
 response.resolve(Response.json(fresh));await tick();assert.equal(h.read().refresh_token,'saved-refresh');
 const next=[...h.timers.values()].find(timer=>timer.delay===1000);assert.ok(next);next.fn();await tick();assert.equal(h.calls.length,2);assert.equal(h.read().refresh_token,'rotated-refresh');
});
