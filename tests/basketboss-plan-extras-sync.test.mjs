import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const extras=createRequire(import.meta.url)('../bb-plan-extras-sync.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',SESSION='basketboss_cloud_session_v1';
const plan=()=>({version:2,pantryPlanGeneration:'week-one',planned:[{day:'Monday',recipeId:'dinner',servings:4}],plannedBreakfasts:[{day:'Monday',recipeId:'eggs',servings:1},{day:'Tuesday',recipeId:'eggs',servings:3}],plannedDesserts:[{day:'Monday',recipeId:'brownies',servings:2}],pantry:{'eggs|each':12},mealServings:{eggs:4},access_token:'must-not-copy'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(){
 const values=new Map(),calls=[],rows=new Map();let actor=A,token='token-one',live=true,handler=null;
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const account=(next,nextToken='token-two')=>{actor=next;token=nextToken;storage.setItem(SESSION,JSON.stringify({user:{id:actor},access_token:token}));};account(A,'token-one');
 const request=async(path,method,body,suppliedToken)=>{
  calls.push({path,method,body:body&&structuredClone(body),token:suppliedToken});if(handler)return handler(path,method,body,suppliedToken);
  if(method==='GET'){
   const url=new URL('https://example.invalid'+path),scope=url.searchParams.get('user_id').slice(3),cycle=url.searchParams.get('plan_generation').slice(3),found=rows.get(scope+'|'+cycle);
   return found?[structuredClone(found)]:[];
  }
  assert.equal(path,extras.RPC);assert.equal(method,'POST');const key=actor+'|'+body.p_generation,current=rows.get(key);
  if((current?.revision||0)!==body.p_expected_revision)throw Object.assign(Error('planner_extras_conflict'),{code:'40001'});
  const saved={payload:structuredClone(body.p_payload),revision:body.p_expected_revision+1};rows.set(key,saved);return {ok:true,...structuredClone(saved)};
 };
 const model=extras.create({storage,request,current:()=>live}),args=()=>({actor,generation:'week-one',token,plan:plan()});
 return {storage,values,calls,rows,model,args,account,live:value=>{live=value;},handler:fn=>{handler=fn;}};
}

test('extension captures only meal choices and independent quantities; restore is immutable and idempotent',()=>{
 const original=plan();original.planned[0].annotation='Keep this existing local plan detail';
 const before=JSON.stringify(original),payload=extras.capture(original);
 assert.deepEqual(payload.plannedBreakfasts,[{day:'Monday',recipeId:'eggs'},{day:'Tuesday',recipeId:'eggs'}]);
 assert.equal(payload.portionOverrides.length,4);assert(!JSON.stringify(payload).includes('must-not-copy'));assert(!JSON.stringify(payload).includes('pantry'));
 const restored=extras.apply(original,payload);assert.deepEqual(restored,original);assert.deepEqual(extras.apply(restored,payload),restored);assert.equal(JSON.stringify(original),before);
});

test('deleted breakfasts and cleared independent portions survive as explicit tombstones',()=>{
 const payload=extras.capture({planned:[],plannedBreakfasts:[],plannedDesserts:[]}),original=plan(),restored=extras.apply(original,payload);
 assert.deepEqual(restored.plannedBreakfasts,[]);assert.equal(Object.hasOwn(restored.planned[0],'servings'),false);assert.equal(Object.hasOwn(restored.plannedDesserts[0],'servings'),false);
 assert.deepEqual(restored.pantry,original.pantry);assert.deepEqual(restored.mealServings,original.mealServings);assert.equal(original.plannedBreakfasts.length,2);
});

test('portion overlays never attach to a replaced dinner or a moved dessert',()=>{
 const original=plan(),payload=extras.capture(original);original.planned[0].recipeId='new-dinner';original.plannedDesserts[0].day='Friday';
 const restored=extras.apply(original,payload);assert.deepEqual(restored.planned,[{day:'Monday',recipeId:'new-dinner'}]);assert.deepEqual(restored.plannedDesserts,[{day:'Friday',recipeId:'brownies'}]);
 assert.equal(restored.plannedBreakfasts[0].servings,1);assert.equal(restored.plannedBreakfasts[1].servings,3);
});

test('invalid duplicates, payload fields, food IDs and serving counts cannot enter the extension',()=>{
 const bad=[value=>value.plannedBreakfasts.push({day:'Monday',recipeId:'other'}),value=>value.plannedBreakfasts[0].servings=13,value=>value.planned[0].servings='4',value=>value.plannedBreakfasts[0].recipeId='__proto__'];
 for(const change of bad){const value=plan();change(value);assert.throws(()=>extras.capture(value),/Review/);}
 for(const change of [value=>value.private='not-allowed',value=>value.portionOverrides.push(value.portionOverrides[0]),value=>value.plannedBreakfasts[0].servings=2,value=>value.portionOverrides[1].recipeId='missing-breakfast',value=>value.version=2]){const value=extras.capture(plan());change(value);assert.throws(()=>extras.validate(value),/Review/);}
});

test('first upload reads the scoped remote revision before creating; later edits use compare-and-set',async()=>{
 const h=fixture(),first=await h.model.save(h.args());assert.equal(first.ok,true);assert.equal(first.revision,1);
 assert.equal(h.calls.length,2);assert.match(h.calls[0].path,/user_id=eq\.11111111/);assert.match(h.calls[0].path,/plan_generation=eq\.week-one/);
 assert.equal(h.calls[1].body.p_expected_revision,0);assert.equal(h.calls[1].body.p_generation,'week-one');
 const edited=plan();edited.plannedBreakfasts[0].servings=2;const second=await h.model.save({...h.args(),plan:edited});assert.equal(second.revision,2);assert.equal(h.calls.length,4);assert.equal(h.calls[3].body.p_expected_revision,1);
 assert.equal(h.rows.get(A+'|week-one').payload.portionOverrides.find(row=>row.kind==='breakfast'&&row.day==='Monday').servings,2);
 assert(h.calls.every(call=>!call.path.startsWith('/rest/v1/basketboss_data')),'extension never rewrites the legacy whole-plan backup');
});

test('unknown remote differences require review; repeated or forced uploads cannot bypass the conflict',async()=>{
 const h=fixture(),remote=extras.capture(plan());remote.portionOverrides[1].servings=7;h.rows.set(A+'|week-one',{payload:remote,revision:3});
 const first=await h.model.save(h.args());assert.equal(first.status,'conflict');assert.equal(h.calls.length,1);
 assert.equal((await h.model.save({...h.args(),force:true})).status,'conflict');assert.equal(h.calls.length,1);assert.equal(h.rows.get(A+'|week-one').revision,3);
 const loaded=await h.model.load(h.args());assert.equal(loaded.status,'loaded');assert.equal(loaded.revision,3);
 const reviewed=extras.apply(plan(),loaded.payload);reviewed.plannedBreakfasts[0].servings=2;
 assert.equal((await h.model.save({...h.args(),plan:reviewed})).revision,4);
});

test('a remote revision race cannot overwrite another device’s breakfast changes',async()=>{
 const h=fixture();assert.equal((await h.model.save(h.args())).revision,1);h.rows.set(A+'|week-one',{payload:extras.capture({planned:[],plannedBreakfasts:[],plannedDesserts:[]}),revision:2});
 const result=await h.model.save(h.args());assert.equal(result.status,'conflict');assert.equal(h.rows.get(A+'|week-one').revision,2);assert.deepEqual(h.rows.get(A+'|week-one').payload.plannedBreakfasts,[]);
});

test('unchanged uploads and identical remote revisions converge without incrementing the cloud record',async()=>{
 const h=fixture();assert.equal((await h.model.save(h.args())).revision,1);
 const writes=()=>h.calls.filter(call=>call.path===extras.RPC).length;assert.equal(writes(),1);
 assert.equal((await h.model.save(h.args())).revision,1);assert.equal(writes(),1,'a Kitchen-only or unchanged upload does not write optional meals again');
 h.rows.set(A+'|week-one',{payload:extras.capture(plan()),revision:4});assert.equal((await h.model.save(h.args())).revision,4);assert.equal(writes(),1,'matching choices can adopt a newer revision without a spurious conflict');
});

test('two identical initial CAS saves converge after the first writer wins without retrying a write',async()=>{
 const h=fixture();let reads=0,writes=0;
 h.handler(async(_path,method,body)=>{if(method==='GET')return ++reads===1?[]:[{payload:extras.capture(plan()),revision:1}];writes++;assert.equal(body.p_expected_revision,0);throw Object.assign(Error('planner_extras_conflict'),{code:'40001'});});
 const result=await h.model.save(h.args());assert.equal(result.status,'synced');assert.equal(result.revision,1);assert.equal(reads,2);assert.equal(writes,1);
});

test('cloud loading replaces the matching generation and keeps different accounts or weeks separate',async()=>{
 const h=fixture(),payload=extras.capture(plan());h.rows.set(A+'|week-one',{payload,revision:2});
 assert.equal((await h.model.load(h.args())).revision,2);assert.equal((await h.model.load({...h.args(),generation:'week-two'})).status,'missing');
 h.account(B);assert.equal((await h.model.load(h.args())).status,'missing');assert.equal(h.model.remember(h.args()).ok,true);
 const accountKeys=[...h.values.keys()].filter(key=>key.startsWith(extras.KEY));assert.equal(accountKeys.length,2);assert(accountKeys.some(key=>key.includes(A)));assert(accountKeys.some(key=>key.includes(B)));
});

test('readLocal is a guarded read-only fallback for exactly the same account and generation',()=>{
 const h=fixture();assert.equal(h.model.remember(h.args()).ok,true);const before=[...h.values],cached=h.model.readLocal(h.args());
 assert.equal(cached.status,'local');assert.equal(cached.source,'device');assert.deepEqual(cached.payload,extras.capture(plan()));
 cached.payload.plannedBreakfasts.length=0;assert.equal(h.model.readLocal(h.args()).payload.plannedBreakfasts.length,2,'callers cannot mutate the saved extension');
 assert.equal(h.model.readLocal({...h.args(),generation:'week-two'}).status,'missing');assert.deepEqual([...h.values],before);assert.equal(h.calls.length,0);
 const prior=h.args();h.account(B);const accountBefore=[...h.values];assert.equal(h.model.readLocal(h.args()).status,'missing');assert.equal(h.model.readLocal(prior).ok,false);assert.deepEqual([...h.values],accountBefore);
});

test('staged cloud loads are read-only and supply an exact account-scoped cache proposal for atomic restore',async()=>{
 const h=fixture(),remote=extras.capture(plan());remote.portionOverrides[1].servings=6;h.rows.set(A+'|week-one',{payload:remote,revision:3});
 assert.equal((await h.model.save(h.args())).status,'conflict');const before=[...h.values];
 const staged=await h.model.load({...h.args(),stage:true});assert.equal(staged.status,'loaded');assert.deepEqual([...h.values],before);
 assert.equal(staged.cache.key,extras.KEY+A+':week-one');assert.equal(staged.cache.expected,h.storage.getItem(staged.cache.key));assert.equal(staged.cache.value.actor,A);assert.equal(staged.cache.value.generation,'week-one');assert.equal(staged.cache.value.revision,3);assert.deepEqual(staged.cache.value.payload,remote);
 assert.equal(h.model.readLocal(h.args()).payload.portionOverrides[1].servings,1,'staging does not establish the remote payload or revision locally');
 const calls=h.calls.length;assert.equal((await h.model.save(h.args())).status,'conflict');assert.equal(h.calls.length,calls,'staging does not clear a review-required conflict');
 const missing=await h.model.load({...h.args(),generation:'other-week',stage:true});assert.equal(missing.status,'missing');assert.equal(missing.cache,undefined);assert.deepEqual([...h.values],before);
});

test('a staged restore cannot produce a cache proposal after its session or page context changes',async()=>{
 for(const change of [h=>h.account(A,'refreshed-token'),h=>h.live(false)]){
  const h=fixture(),wait=deferred();h.handler(()=>wait.promise);const operation=h.model.load({...h.args(),stage:true});change(h);const before=[...h.values];wait.resolve([{payload:extras.capture(plan()),revision:1}]);
  const result=await operation;assert.equal(result.status,'stale');assert.equal(result.cache,undefined);assert.deepEqual([...h.values],before);
 }
});

test('missing setup pauses automatic retries while retaining local choices; manual retry is explicit',async()=>{
 const h=fixture();h.handler(async()=>{throw Object.assign(Error('Could not find the table public.basketboss_planner_extras_v1 in the schema cache'),{code:'PGRST205'});});
 assert.equal((await h.model.save(h.args())).status,'unavailable');const before=[...h.values];assert.equal(h.calls.length,1);
 assert.equal((await h.model.save(h.args())).status,'unavailable');assert.equal((await h.model.load(h.args())).status,'unavailable');assert.equal(h.calls.length,1);assert.deepEqual([...h.values],before);
 h.handler(null);assert.equal((await h.model.save({...h.args(),force:true})).status,'synced');assert.equal(h.calls.length,3);
});

test('session changes and expired contexts reject before a remote call or local cache change',async()=>{
 for(const reason of ['actor','token','current']){
  const h=fixture(),args=h.args();if(reason==='actor')h.account(B);if(reason==='token')h.account(A,'refreshed');if(reason==='current')h.live(false);
  const before=[...h.values];assert.equal((await h.model.save(args)).ok,false);assert.equal((await h.model.load(args)).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.calls.length,0);
 }
});

test('invalid generation tokens cannot create a different extension scope or reach the server',async()=>{
 const h=fixture();
 for(const generation of ['', 'week-one\n','space week','x'.repeat(81),'../other-week']){
  const before=[...h.values];assert.equal(h.model.remember({...h.args(),generation}).ok,false);assert.equal((await h.model.save({...h.args(),generation})).ok,false);assert.equal((await h.model.load({...h.args(),generation})).ok,false);assert.deepEqual([...h.values],before);
 }
 assert.equal(h.calls.length,0);
});

test('an account switch while a read is in flight cannot apply another account’s remote extras',async()=>{
 const h=fixture(),wait=deferred();h.handler(()=>wait.promise);const reading=h.model.load(h.args());h.account(B);const before=[...h.values];wait.resolve([{payload:extras.capture(plan()),revision:2}]);
 assert.equal((await reading).status,'stale');assert.deepEqual([...h.values],before);
});

test('edits during a read or write keep the newer local cache and never claim full sync',async()=>{
 for(const writing of [false,true]){
  const h=fixture();if(writing)assert.equal((await h.model.save(h.args())).ok,true);
  const wait=deferred();h.handler((_path,method)=>writing&&method==='GET'?[{payload:extras.capture(plan()),revision:1}]:wait.promise);const operation=writing?h.model.save({...h.args(),plan:{...plan(),plannedBreakfasts:[{day:'Monday',recipeId:'eggs',servings:2}]}}):h.model.load(h.args());
  if(writing)await new Promise(resolve=>setImmediate(resolve));
  const edited=plan();edited.plannedBreakfasts[0].servings=8;assert.equal(h.model.remember({...h.args(),plan:edited}).ok,true);const before=[...h.values];
  wait.resolve(writing?{ok:true,payload:extras.capture(plan()),revision:2}:[{payload:extras.capture(plan()),revision:1}]);
  assert.equal((await operation).status,'stale');assert.deepEqual([...h.values],before);
 }
});

test('concurrent rejected calls cannot release the first operation’s lock',async()=>{
 const h=fixture(),wait=deferred();h.handler(()=>wait.promise);const first=h.model.load(h.args());
 assert.equal((await h.model.load(h.args())).status,'busy');assert.equal((await h.model.save(h.args())).status,'busy');assert.equal((await h.model.load(h.args())).status,'busy');assert.equal(h.calls.length,1);
 wait.resolve([]);assert.equal((await first).status,'missing');
});

test('malformed remote responses and corrupt local cache are kept for review instead of overwritten',async()=>{
 for(const response of [{payload:{}},[{payload:{},revision:1}],[{payload:extras.capture(plan()),revision:0}],Array(2).fill({payload:extras.capture(plan()),revision:1})]){
  const h=fixture();assert.equal(h.model.remember(h.args()).ok,true);const before=[...h.values];h.handler(async()=>response);
  assert.equal((await h.model.load(h.args())).ok,false);assert.deepEqual([...h.values],before);
 }
 const h=fixture(),key=extras.KEY+A+':week-one';h.storage.setItem(key,'corrupt cache');const before=[...h.values];assert.equal(h.model.remember(h.args()).ok,false);assert.equal((await h.model.save(h.args())).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.calls.length,0);
});

test('failed local storage verification restores only its own write and retains newer tab data',()=>{
 const h=fixture();assert.equal(h.model.remember(h.args()).ok,true);const key=extras.KEY+A+':week-one',original=h.storage.getItem(key),write=h.storage.setItem;let fail=true;
 h.storage.setItem=(name,value)=>{write(name,value);if(fail){fail=false;throw Error('quota');}};
 const edited=plan();edited.plannedBreakfasts[0].servings=6;assert.equal(h.model.remember({...h.args(),plan:edited}).ok,false);assert.equal(h.storage.getItem(key),original);
 h.storage.setItem=(name)=>{write(name,'newer tab bytes');throw Error('denied');};assert.equal(h.model.remember({...h.args(),plan:edited}).ok,false);assert.equal(h.storage.getItem(key),'newer tab bytes');
});
