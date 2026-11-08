import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const extras=createRequire(import.meta.url)('../bb-plan-extras-sync.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const SESSION='basketboss_cloud_session_v1',STATE='basketboss_321_unified_state_v1';
const plain=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{await tick();await tick();await tick();};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const plan=({generation='week-one',breakfast=true,dinner='dinner'}={})=>({version:2,pantryPlanGeneration:generation,planned:[{recipeId:dinner,day:'Monday'}],plannedBreakfasts:breakfast?[{recipeId:'eggs',day:'Monday',servings:1}]:[],plannedDesserts:[],pantry:{},servings:4});
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

function fixture({entry='app.html',initial=plan(),remote=initial,kitchen=false,signedIn=true}={}){
 const html=read(entry),start=html.indexOf('const config=window.BASKETBOSS_CLOUD_CONFIG||{};');
 let code=html.slice(html.lastIndexOf('(function(){',start),html.indexOf('</script>',start));
 const marker='window.BasketBossCloud={';assert(code.includes(marker));
 code=code.replace(marker,'window.__PlannerCloudTest={snapshot,cloudSnapshot,push,pull,connectedCloud,plannerExtras,plannerExtrasNeeded,rememberPlannerExtras};'+marker);
 const cycleCode=html.split('\n').find(line=>line.startsWith('window.BBPlanExtrasHost='));assert(cycleCode);
 const store=new Map(),calls=[],nodes=new Map(),events=new Map(),timers=new Map(),rows=new Map();
 let sequence=0,reloads=0,base=remote===null?null:plain(remote),intercept=null,onWrite=null;
 const session=(actor=A,token='token-one')=>({access_token:token,expires_at:Date.now()/1000+3600,user:{id:actor,email:'fixture@example.invalid'}});
 if(signedIn)store.set(SESSION,JSON.stringify(session()));store.set(STATE,JSON.stringify(initial));
 const storage={getItem:key=>store.get(key)??null,setItem(key,value){onWrite?.(key,String(value));store.set(key,String(value));},removeItem:key=>store.delete(key)};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,textContent:'',disabled:false,hidden:false,value:'',classList:{add(){},remove(){}}});return nodes.get(id);};
 const window={BBPlanExtrasSync:extras,BASKETBOSS_CLOUD_CONFIG:{url:'https://fixture.supabase.co',anonKey:'public-test-key'},addEventListener(name,listener){const items=events.get(name)||[];items.push(listener);events.set(name,items);},BasketBossSession:{state:()=>({remembered:false}),ensureFresh:async()=>JSON.parse(store.get(SESSION)||'null'),remember(value){if(value)storage.setItem(SESSION,JSON.stringify(value));else storage.removeItem(SESSION);return true;}}};
 if(kitchen)window.BBReceiptHost={hasLocalData:()=>!!store.get('stock'),exportBackup:()=>({version:1,actorId:A,values:{stock:JSON.parse(store.get('stock')||'null'),prices:JSON.parse(store.get('prices')||'null')}}),prepareBackupRestore(payload){assert.equal(payload.actorId,A);const updates={stock:payload.values.stock,prices:payload.values.prices};return {updates,expected:Object.fromEntries(Object.keys(updates).map(key=>[key,storage.getItem(key)])),requiresReview:false};}};
 const fetcher=async(url,input)=>{
  const parsed=new URL(url),body=input.body?JSON.parse(input.body):null,call={url,path:parsed.pathname,input,body};calls.push(call);
  if(intercept){const value=await intercept(call);if(value!==undefined)return value;}
  if(parsed.pathname==='/auth/v1/token')return Response.json({...session(),expires_in:3600});
  if(parsed.pathname==='/rest/v1/basketboss_data'){
   if(input.method==='GET')return Response.json(base===null?[]:[{data:plain(base)}]);
   base=plain(body.data);return new Response(null,{status:204});
  }
  if(parsed.pathname===extras.TABLE){const key=parsed.searchParams.get('user_id').slice(3)+'|'+parsed.searchParams.get('plan_generation').slice(3),found=rows.get(key);return Response.json(found?[plain(found)]:[]);}
  if(parsed.pathname===extras.RPC){
   const actor=JSON.parse(store.get(SESSION)).user.id,key=actor+'|'+body.p_generation,found=rows.get(key);
   if((found?.revision||0)!==body.p_expected_revision)return Response.json({code:'40001',message:'planner_extras_conflict'},{status:409});
   const saved={payload:plain(body.p_payload),revision:body.p_expected_revision+1};rows.set(key,saved);return Response.json({ok:true,...saved});
  }
  throw Error('Unexpected synthetic cloud route '+parsed.pathname);
 };
 const ctx={window,document:{getElementById:node,addEventListener(){}},navigator:{onLine:true},localStorage:storage,AbortController,Date,JSON,console,bbHomeWeekToken:()=> '2026-11-09',location:{hash:'',reload:()=>{reloads++;}},confirm:()=>true,setTimeout(fn,delay){timers.set(++sequence,{fn,delay});return sequence;},clearTimeout:id=>timers.delete(id),fetch:fetcher};
 vm.runInNewContext(cycleCode+'\n'+code,ctx);
 const cache=extras.create({storage,request:async()=>{throw Error('cache fixture must not network');}}),args=(generation=initial.pantryPlanGeneration)=>({actor:A,generation,plan:JSON.parse(store.get(STATE))});
 return {window,store,storage,calls,rows,node,cache,args,timers,ctx,get reloads(){return reloads;},get remote(){return base;},setRemote:value=>{base=plain(value);},intercept:fn=>{intercept=fn;},writeHook:fn=>{onWrite=fn;},event(name,payload={}){for(const listener of events.get(name)||[])listener({type:name,...payload});},expire(delay){const found=[...timers].find(([,timer])=>timer.delay===delay);assert(found,'expected timer '+delay);timers.delete(found[0]);found[1].fn();},switchSession(actor=B,token='token-two'){storage.setItem(SESSION,JSON.stringify(session(actor,token)));for(const listener of events.get('basketboss:session-changed')||[])listener();}};
}

for(const entry of ['app.html','index.html'])test(entry+': protected optional meals upload separately and unchanged uploads never increment their revision',async()=>{
 const h=fixture({entry});assert.equal(await h.node('cloud-upload').onclick(),true);
 assert.equal(h.rows.get(A+'|week-one').revision,1);assert.equal(h.calls.filter(call=>call.path===extras.RPC).length,1);assert.match(h.node('cloud-message').textContent,/Synced securely/);
 assert.equal(await h.node('cloud-upload').onclick(),true);assert.equal(h.rows.get(A+'|week-one').revision,1);assert.equal(h.calls.filter(call=>call.path===extras.RPC).length,1);
});

test('actual extras HTTP404 is an honest partial backup, pauses extras retries and leaves legacy backup usable',async()=>{
 const h=fixture();h.intercept(call=>call.path===extras.TABLE?Response.json({code:'PGRST205',message:'Could not find the table public.basketboss_planner_extras_v1'},{status:404}):undefined);
 assert.equal(await h.node('cloud-upload').onclick(),false);assert.deepEqual(h.remote.plannedBreakfasts,plan().plannedBreakfasts);
 assert.match(h.node('cloud-message').textContent,/Optional meals.*device.*needs setup/i);assert.doesNotMatch(h.node('cloud-message').textContent,/Synced securely|PGRST205|public\./);
 const extReads=h.calls.filter(call=>call.path===extras.TABLE).length;h.window.BasketBossCloud.scheduleSave();h.expire(1400);await settle();h.event('online');await settle();assert.equal(h.calls.filter(call=>call.path===extras.TABLE).length,extReads,'automatic retries stop for the unavailable extension without pausing the base backup');
 const edited=plan({dinner:'new-dinner'});h.store.set(STATE,JSON.stringify(edited));h.window.BasketBossCloud.scheduleSave();h.expire(1400);await settle();assert.equal(h.remote.planned[0].recipeId,'new-dinner');assert.doesNotMatch(h.node('cloud-message').textContent,/Synced securely/);
});

test('new account sign-in cannot replace partial extras feedback with a complete-backup success message',async()=>{
 const h=fixture({remote:null,signedIn:false});h.node('cloud-email').value='fixture@example.invalid';h.node('cloud-password').value='synthetic-password';
 h.intercept(call=>call.path===extras.TABLE?Response.json({code:'PGRST205',message:'missing extras table'},{status:404}):undefined);
 await h.node('cloud-login').onclick();assert.match(h.node('cloud-message').textContent,/Optional meals.*device.*needs setup/i);assert.doesNotMatch(h.node('cloud-message').textContent,/Synced securely|Account connected and this device.*backed up/);
});

test('protected extras augment an old base plan without duplicate breakfasts and commit their cache with Kitchen',async()=>{
 const remote=plan({breakfast:false,dinner:'remote-dinner'});delete remote.plannedBreakfasts;remote.atHomeBackup={version:1,actorId:A,values:{stock:{'eggs|each':8},prices:{eggs:2.5}}};
 const h=fixture({remote,kitchen:true}),payload=extras.capture({...plan({dinner:'remote-dinner'}),plannedBreakfasts:[{day:'Monday',recipeId:'porridge',servings:2}]});h.rows.set(A+'|week-one',{payload,revision:4});
 await h.node('cloud-download').onclick();assert.equal(h.reloads,1);let saved=JSON.parse(h.store.get(STATE));assert.deepEqual(saved.plannedBreakfasts,[{day:'Monday',recipeId:'porridge',servings:2}]);assert.equal(saved.planned[0].recipeId,'remote-dinner');assert.equal(Object.hasOwn(saved,'atHomeBackup'),false);
 assert.deepEqual(JSON.parse(h.store.get('stock')),{'eggs|each':8});assert.equal(h.cache.readLocal(h.args()).revision,4);
 await h.node('cloud-download').onclick();saved=JSON.parse(h.store.get(STATE));assert.equal(saved.plannedBreakfasts.length,1);assert.equal(h.cache.readLocal(h.args()).revision,4);
});

test('failed cache or base writes roll back the staged extension with Kitchen and retain the previous CAS baseline',async()=>{
 for(const failure of ['cache','plan']){
  const remote=plan({breakfast:false,dinner:'remote-dinner'});remote.atHomeBackup={version:1,actorId:A,values:{stock:{'eggs|each':8},prices:{eggs:2.5}}};
  const h=fixture({remote,kitchen:true});assert.equal(h.cache.remember(h.args()).ok,true);const before=[...h.store],key=extras.KEY+A+':week-one',payload=extras.capture({...plan(),plannedBreakfasts:[{day:'Monday',recipeId:'porridge',servings:2}]});h.rows.set(A+'|week-one',{payload,revision:7});
  let fail=true;h.writeHook(name=>{if(fail&&name===(failure==='cache'?key:STATE)){fail=false;throw Error('synthetic write failure');}});
  await h.node('cloud-download').onclick();assert.equal(h.reloads,0);assert.deepEqual([...h.store].sort(),before.sort());assert.equal(h.cache.readLocal(h.args()).revision,null);
  h.writeHook(null);assert.equal(await h.node('cloud-upload').onclick(),false);assert.equal(h.rows.get(A+'|week-one').revision,7);assert.equal(h.calls.filter(call=>call.path===extras.RPC).length,0,'a failed restore must not establish a trusted new CAS revision');
 }
});

test('a cloud CAS conflict leaves protected choices intact and never reports a fully synced account',async()=>{
 const h=fixture(),remote=extras.capture({...plan(),plannedBreakfasts:[{day:'Friday',recipeId:'porridge',servings:2}]});h.rows.set(A+'|week-one',{payload:remote,revision:5});
 assert.equal(await h.node('cloud-upload').onclick(),false);assert.equal(h.rows.get(A+'|week-one').revision,5);assert.deepEqual(h.rows.get(A+'|week-one').payload,remote);assert.equal(h.calls.filter(call=>call.path===extras.RPC).length,0);assert.match(h.node('cloud-message').textContent,/Restore.*review/i);assert.doesNotMatch(h.node('cloud-message').textContent,/Synced securely/);
});

test('a missing extras table keeps same-generation device choices with an explicit local-only restore message',async()=>{
 const h=fixture({remote:plan({breakfast:false,dinner:'remote-dinner'})});h.cache.remember(h.args());h.intercept(call=>call.path===extras.TABLE?Response.json({code:'PGRST205',message:'missing extras table'},{status:404}):undefined);
 await h.node('cloud-download').onclick();assert.equal(h.reloads,1);assert.deepEqual(JSON.parse(h.store.get(STATE)).plannedBreakfasts,plan().plannedBreakfasts);assert.match(h.node('cloud-message').textContent,/Optional meals from this device were kept/i);assert.doesNotMatch(h.node('cloud-message').textContent,/Synced securely/);
});

test('a new plan generation cannot reattach the previous week’s cached breakfast',async()=>{
 const h=fixture({remote:plan({generation:'week-two',breakfast:false,dinner:'remote-dinner'})});h.cache.remember(h.args());const prior=h.store.get(extras.KEY+A+':week-one');
 await h.node('cloud-download').onclick();assert.equal(h.reloads,1);const saved=JSON.parse(h.store.get(STATE));assert.equal(saved.pantryPlanGeneration,'week-two');assert.deepEqual(saved.plannedBreakfasts||[],[]);assert.equal(h.store.get(extras.KEY+A+':week-one'),prior);
});

test('session changes while awaiting the extension cannot apply its cache or replace the base plan',async()=>{
 const h=fixture({remote:plan({breakfast:false,dinner:'remote-dinner'})}),wait=deferred();h.intercept(call=>call.path===extras.TABLE?wait.promise:undefined);const before=h.store.get(STATE);
 const loading=h.node('cloud-download').onclick();await settle();assert(h.calls.some(call=>call.path===extras.TABLE));h.switchSession();wait.resolve(Response.json([{payload:extras.capture(plan()),revision:3}]));await loading;
 assert.equal(h.reloads,0);assert.equal(h.store.get(STATE),before);assert.equal([...h.store.keys()].filter(key=>key.startsWith(extras.KEY)).length,0);
});

test('a protected empty-array tombstone removes stale base breakfasts and remains idempotent',async()=>{
 const h=fixture(),payload={version:1,plannedBreakfasts:[],portionOverrides:[]};h.cache.remember(h.args());h.rows.set(A+'|week-one',{payload,revision:3});
 await h.node('cloud-download').onclick();assert.equal(h.reloads,1);assert.deepEqual(JSON.parse(h.store.get(STATE)).plannedBreakfasts,[]);assert.deepEqual(h.cache.readLocal(h.args()).payload,payload);
 await h.node('cloud-download').onclick();assert.deepEqual(JSON.parse(h.store.get(STATE)).plannedBreakfasts,[]);assert.equal(h.rows.get(A+'|week-one').revision,3);
});

test('matching old base data still probes protected extras and offers a deliberate restore choice',async()=>{
 const initial=plan({breakfast:false}),h=fixture({initial}),payload=extras.capture(plan());h.rows.set(A+'|week-one',{payload,revision:3});const before=h.store.get(STATE);
 await h.window.BasketBossCloud.connected();assert(h.calls.some(call=>call.path===extras.TABLE));assert.equal(h.reloads,0);assert.equal(h.store.get(STATE),before);assert.equal(h.calls.filter(call=>call.input.method==='POST').length,0);assert.match(h.node('cloud-message').textContent,/optional|breakfast/i);assert.match(h.node('cloud-message').textContent,/Restore/i);
});
