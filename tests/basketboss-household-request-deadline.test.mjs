import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE=fs.readFileSync(new URL('../bb-household-sharing.js',import.meta.url),'utf8');
const ACTOR='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const AUTH='basketboss_cloud_session_v1',STATE='basketboss_321_unified_state_v1',BUDGET='basketboss_v172_weekly_budget_target_v1';
const BASE='bb_partner_baseline_v1_hh_'+ACTOR,PLAN='planned_day\u001fMonday';
const DEADLINE=15000;
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const entries=recipeId=>({household_id:'hh',entries:[
 {section:'planned_day',entry_key:'Monday',value:{recipeId},revision:5},
 {section:'household_servings',entry_key:'default',value:{count:4},revision:1},
 {section:'budget_target',entry_key:'weekly',value:{amount:200},revision:1}
]});

function fixture({localRecipe='old-shared',fetcher=()=>response(entries('old-shared'))}={}){
 const values=new Map([[AUTH,JSON.stringify({user:{id:ACTOR},access_token:'token-a'})],
  [STATE,JSON.stringify({version:2,planned:[{day:'Monday',recipeId:localRecipe}],pantry:{},servings:4,feedingSet:true})],[BUDGET,'200'],
  [BASE,JSON.stringify({[PLAN]:{revision:5,value:{recipeId:'old-shared'}},'household_servings\u001fdefault':{revision:1,value:{count:4}},'budget_target\u001fweekly':{revision:1,value:{amount:200}}})]]);
 const calls=[],messages=[],refreshes=[],listeners=new Map(),timers=new Map();
 let now=0,nextTimer=1,fetchImpl=fetcher;
 const clock={advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}},pending:()=>timers.size};
 const dialog={open:true,close(){this.open=false;},querySelector:s=>s==='[data-bbhs-message]'?{set textContent(text){messages.push(text);}}:null};
 const window={addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);},
  BBHomeHost:{canRefreshSharedHousehold:()=>true,refreshSharedHousehold:pin=>{refreshes.push(pin);return true;}}};
 const localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const context=vm.createContext({window,document:{readyState:'loading',hidden:false,addEventListener(){},getElementById:()=>null},navigator:{onLine:true},localStorage,AbortController,
  fetch:(url,options)=>{calls.push({url,options});return fetchImpl(url,options);},
  setTimeout:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),setInterval(){},MutationObserver:class{},Event,
  location:{reload(){throw Error('Unexpected navigation');}}});
 const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();";
 assert.ok(SOURCE.includes(boot));
 vm.runInContext(SOURCE.replace(boot,"window.testAPI={accountRequest,synchronize,refreshStatus,runAction,message,set:(s,d)=>{status=s;dialog=d},bumpGeneration:()=>{generation++},get:()=>({busy,status,actionInFlight})};"),context);
 const api=window.testAPI;api.set({configured:true,premium:true,household_id:'hh',role:'owner',invite_status:'accepted'},dialog);
 return {api,values,calls,messages,refreshes,clock,window,dialog,setFetch:fn=>{fetchImpl=fn;},
  changeAccount:()=>values.set(AUTH,JSON.stringify({user:{id:OTHER},access_token:'token-b'})),
  changeToken:()=>values.set(AUTH,JSON.stringify({user:{id:ACTOR},access_token:'token-b'}))};
}

for(const phase of ['fetch','body'])test(`deadline settles a pending ${phase}, even when abort is ignored`,async()=>{
 const gate=pending();const h=fixture({fetcher:phase==='fetch'?()=>gate.promise:()=>({ok:true,status:200,json:()=>gate.promise})});
 let settled=false;const result=h.api.accountRequest('/api/household?mode=entries').then(v=>({value:v}),error=>({error})).finally(()=>{settled=true;});
 await flush();h.clock.advance(DEADLINE-1);await flush();assert.equal(settled,false);
 h.clock.advance(1);const {error}=await result;
 assert.equal(error.code,'BB_SHARING_REQUEST_TIMEOUT');assert.equal(error.requestMayHaveCompleted,false);
 assert.match(error.message,/timed out/);assert.equal(h.calls[0].options.signal.aborted,true);
 assert.equal(h.calls.length,1,'the wrapper never retries');assert.equal(h.clock.pending(),0);
 gate.resolve(phase==='fetch'?response(entries('late-dinner')):entries('late-dinner'));await flush();assert.equal(h.calls.length,1);
});

test('success preserves the exact request and clears the deadline',async()=>{
 const h=fixture();const data=await h.api.accountRequest('/api/household?mode=entries');
 assert.equal(data.household_id,'hh');assert.equal(h.clock.pending(),0);
 const {options}=h.calls[0];assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');assert.equal(options.headers.Authorization,'Bearer token-a');
 h.clock.advance(DEADLINE);assert.equal(options.signal.aborted,false);
});

for(const change of ['actor','token','generation','deletion'])test(`a completed response is still rejected after ${change} changes`,async()=>{
 const gate=pending();const h=fixture({fetcher:()=>({ok:true,status:200,json:()=>gate.promise})});
 const result=h.api.accountRequest('/api/household?mode=entries').then(value=>({value}),error=>({error}));await flush();
 if(change==='actor')h.changeAccount();if(change==='token')h.changeToken();if(change==='generation')h.api.bumpGeneration();if(change==='deletion')h.window.dispatchEvent(new Event('basketboss:account-deletion-started'));
 gate.resolve(entries('late-dinner'));const {error}=await result;assert.match(error.message,/Account changed during sharing request/);assert.equal(h.clock.pending(),0);
});

test('HTTP 403 remains a denial with the original status and response data',async()=>{
 const denial={error:'A newer session is active.',category:'newer_session'};
 const h=fixture({fetcher:()=>response(denial,403)});
 await assert.rejects(()=>h.api.accountRequest('/api/household?mode=status'),error=>error.status===403&&error.message===denial.error&&error.data.category==='newer_session');
 await assert.rejects(()=>h.api.refreshStatus({throwErrors:true}),error=>error.status===403);
 assert.equal(h.api.get().status,null,'a failed status check cannot grant access');assert.equal(h.clock.pending(),0);
});

test('HTTP 409 retains the existing CAS conflict message without baseline writes',async()=>{
 const h=fixture({localRecipe:'salmon-pesto',fetcher:(_url,options)=>options.method==='POST'?response({error:'conflict'},409):response(entries('old-shared'))});
 const before=new Map(h.values);await h.api.synchronize();
 assert.equal(h.messages.at(-1),'Another device changed the same item. No data was overwritten.');assert.deepEqual(h.values,before);assert.equal(h.api.get().busy,false);
 assert.equal(JSON.parse(h.calls[1].options.body).expected,5);
});

for(const phase of ['fetch','body'])test(`timed-out ${phase} cannot publish a late recipe or UI message after a newer sync`,async()=>{
 const gate=pending();let bodyReads=0;
 const h=fixture({fetcher:phase==='fetch'?()=>gate.promise:()=>({ok:true,status:200,json:()=>gate.promise})});
 const before=new Map(h.values);const first=h.api.synchronize();await flush();assert.equal(h.api.get().busy,true);assert.match(h.messages.at(-1),/^Checking your shared household/);
 h.clock.advance(DEADLINE);await first;assert.equal(h.api.get().busy,false);assert.match(h.messages.at(-1),/timed out/);assert.deepEqual(h.values,before);assert.equal(h.calls.length,1);
 h.setFetch(()=>response(entries('old-shared')));await h.api.synchronize();
 const messages=[...h.messages],after=new Map(h.values);
 gate.resolve(phase==='fetch'?{ok:true,status:200,json:async()=>{bodyReads++;return entries('late-dinner');}}:entries('late-dinner'));
 await flush();assert.deepEqual(h.messages,messages);assert.deepEqual(h.values,after);assert.equal(h.refreshes.length,0);assert.equal(bodyReads,0,'an already expired fetch does not consume a later body');
});

for(const change of ['actor','deletion'])test(`deadline cannot publish in a different ${change} context`,async()=>{
 const gate=pending();const h=fixture({fetcher:()=>gate.promise});const before=new Map(h.values);
 const sync=h.api.synchronize();await flush();if(change==='actor')h.changeAccount();else h.window.dispatchEvent(new Event('basketboss:account-deletion-started'));
 const messages=[...h.messages];h.clock.advance(DEADLINE);await sync;
 assert.deepEqual(h.messages,messages);assert.equal(h.api.get().busy,false);
 gate.resolve(response(entries('late-dinner')));await flush();assert.deepEqual(h.messages,messages);assert.equal(h.refreshes.length,0);
 assert.equal(h.values.get(STATE),before.get(STATE));assert.equal(h.values.get(BASE),before.get(BASE));
});

test('POST response timeout reports an unknown server outcome, preserves CAS, and never retries',async()=>{
 const body=pending();let serverRecipe='old-shared';
 const h=fixture({localRecipe:'salmon-pesto',fetcher:(_url,options)=>{
  if(options.method==='GET')return response(entries(serverRecipe));
  const patch=JSON.parse(options.body);assert.equal(patch.action,'patch');assert.equal(patch.expected,5);serverRecipe=patch.value.recipeId;
  return {ok:true,status:200,json:()=>body.promise};
 }});
 const before=new Map(h.values),sync=h.api.synchronize();await flush();assert.equal(serverRecipe,'salmon-pesto','synthetic server committed before response stalled');
 h.clock.advance(DEADLINE);await sync;
 assert.match(h.messages.at(-1),/A sent change may already be saved/);assert.doesNotMatch(h.messages.at(-1),/unchanged|rolled back|not saved/i);
 assert.equal(h.api.get().busy,false);assert.deepEqual(h.values,before);assert.equal(h.calls.length,2,'one GET and one POST; no retry');assert.equal(h.calls[1].options.signal.aborted,true);
 const messages=[...h.messages];body.resolve({revision:6});await flush();assert.deepEqual(h.messages,messages);assert.deepEqual(h.values,before);
});

test('a timed-out sharing action releases its button and action lock without late success',async()=>{
 const gate=pending();const h=fixture({fetcher:()=>gate.promise});const button={disabled:false};
 const action=h.api.runAction(button,()=>true,async()=>{await h.api.accountRequest('/api/household',{action:'invite',email:'synthetic@example.invalid'});h.api.message('Late invitation success');});
 await flush();assert.equal(button.disabled,true);assert.ok(h.api.get().actionInFlight);h.clock.advance(DEADLINE);await action;
 assert.equal(button.disabled,false);assert.equal(h.api.get().actionInFlight,null);assert.match(h.messages.at(-1),/A sent change may already be saved/);
 const messages=[...h.messages];gate.resolve(response({household_id:'hh'}));await flush();assert.deepEqual(h.messages,messages);assert.equal(h.calls.length,1);
});
