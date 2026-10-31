import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf("const config=window.BASKETBOSS_CLOUD_CONFIG||{};");
const cloudCode=html.slice(html.lastIndexOf('(function(){',start),html.indexOf('</script>',start));
const sessionKey='basketboss_cloud_session_v1',stateKey='basketboss_321_unified_state_v1';
const actor='11111111-1111-4111-8111-111111111111';
const session={access_token:'current-access',refresh_token:'current-refresh',expires_at:Date.now()/1000+3600,user:{id:actor,email:'person@example.test'}};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness({saved=session,fetchResult}={}){
 const store=new Map(saved?[[sessionKey,JSON.stringify(saved)]]:[]),writes=[],events=new Map(),nodes=new Map(),timers=new Map(),requests=[];
 let timerId=0,reloads=0;
 function node(id){if(!nodes.has(id))nodes.set(id,{id,textContent:'',hidden:false,disabled:false,value:'',classList:{add(){},remove(){}}});return nodes.get(id);}
 const window={BASKETBOSS_CLOUD_CONFIG:{url:'https://example.supabase.co',anonKey:'public'},addEventListener(name,fn){const handlers=events.get(name)||[];handlers.push(fn);events.set(name,handlers);},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);}};
 const context={window,document:{getElementById:node},localStorage:{getItem:k=>store.get(k)??null,setItem(k,v){writes.push([k,v]);store.set(k,String(v));},removeItem(k){store.delete(k);}},navigator:{onLine:true},fetch:async(url,options)=>{requests.push({url,options});return fetchResult?fetchResult(url,options):Response.json([]);},confirm:()=>true,location:{reload(){reloads++;}},setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},Event,Date,JSON,console};
 vm.runInNewContext(cloudCode,context);
 const dispatch=(type,extra={})=>window.dispatchEvent({type,...extra});
 return {window,node,store,writes,dispatch,requests,timers,get reloads(){return reloads;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('an in-flight cloud restore cannot repopulate local meal plans after deletion starts',async()=>{
 const response=deferred(),h=harness({fetchResult:()=>response.promise});
 const pending=h.node('cloud-download').onclick();await tick();assert.equal(h.requests.length,1);
 h.dispatch('basketboss:account-deletion-started');h.store.clear();
 response.resolve(Response.json([{data:{version:2,planned:[{recipeId:'old'}]}}]));await pending;
 assert.equal(h.store.has(stateKey),false);assert.equal(h.reloads,0);assert.deepEqual(h.writes,[]);
});

test('deletion clears pending autosave timers and blocks new saves until cancellation',async()=>{
 const h=harness();h.window.BasketBossCloud.scheduleSave();assert.equal(h.timers.size,1);
 h.dispatch('basketboss:account-deletion-started');assert.equal(h.timers.size,0);
 h.window.BasketBossCloud.scheduleSave();await h.node('cloud-upload').onclick();assert.equal(h.requests.length,0);
 assert.equal(h.node('cloud-upload').disabled,true);
 h.dispatch('basketboss:account-deletion-cancelled');assert.equal(h.node('cloud-upload').disabled,false);
 h.window.BasketBossCloud.scheduleSave();assert.equal(h.timers.size,1);
});

test('an old sign-in response cannot recreate the erased account session',async()=>{
 const response=deferred(),h=harness({saved:null,fetchResult:()=>response.promise});
 h.node('cloud-email').value='person@example.test';h.node('cloud-password').value='correct password';
 const pending=h.node('cloud-login').onclick();await tick();h.dispatch('basketboss:account-deletion-started');h.store.clear();
 response.resolve(Response.json({...session,expires_in:3600}));await pending;
 assert.equal(h.store.has(sessionKey),false);assert.deepEqual(h.writes,[]);
});

test('a late token refresh cannot recreate the session after completed deletion',async()=>{
 const response=deferred(),h=harness({saved:{...session,expires_at:0},fetchResult:()=>response.promise});
 const pending=h.node('cloud-upload').onclick();await tick();h.dispatch('basketboss:account-deletion-deleted');h.store.clear();
 response.resolve(Response.json({...session,access_token:'new-token',expires_in:3600}));await pending;
 assert.equal(h.store.has(sessionKey),false);assert.equal(h.requests.length,1);assert.deepEqual(h.writes,[]);
});

test('switching accounts during a restore invalidates the earlier actor response',async()=>{
 const response=deferred(),h=harness({fetchResult:()=>response.promise});
 const pending=h.node('cloud-download').onclick();await tick();
 const replacement={...session,access_token:'other-token',user:{id:'22222222-2222-4222-8222-222222222222',email:'other@example.test'}};
 h.dispatch('storage',{key:sessionKey,newValue:JSON.stringify(replacement)});
 response.resolve(Response.json([{data:{version:2,planned:[{recipeId:'old-account-meal'}]}}]));await pending;
 assert.equal(h.store.has(stateKey),false);assert.equal(h.reloads,0);
});

test('both HTML entry points ship the same guarded cloud controller',()=>{
 assert.equal(html,fs.readFileSync(new URL('../app.html',import.meta.url),'utf8'));
 assert.match(cloudCode,/if\(!current\(pin\)\)return null/);
});

// Exercise the actual SQLite statements, including conflict updates. This
// checks the race barrier itself instead of mirroring it with a fake DB.
test('account quota writes cannot recreate or update user usage after a deletion tombstone',()=>{
 const source=fs.readFileSync(new URL('../functions/api/bb173/[action].js',import.meta.url),'utf8');
 const statement=source.match(/const mineInc=`([^`]+)`;/)?.[1];assert.ok(statement);
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE bb_ai_daily_usage(day_utc TEXT,actor TEXT,action TEXT,used INTEGER,PRIMARY KEY(day_utc,actor,action)); CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY);');
  const quota=db.prepare(statement),args=['2026-10-31','user:'+actor,'scan',5,'actor-hash',5,'actor-hash'];
  assert.equal(quota.get(...args).used,1);assert.equal(quota.get(...args).used,2);
  db.prepare('INSERT INTO bb_account_deletions VALUES(?)').run('actor-hash');
  assert.equal(quota.get(...args),undefined);assert.equal(db.prepare('SELECT used FROM bb_ai_daily_usage').get().used,2);
  db.exec('DELETE FROM bb_ai_daily_usage');assert.equal(quota.get(...args),undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bb_ai_daily_usage').get().count,0);
 }finally{db.close();}
});

const {onRequest:apiMiddleware}=await import('../functions/api/_middleware.js');
const {digestDeletionActor}=await import('../bb-server-lib/bb-account-deletion.js');
function middlewareDatabase(){
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){const params=[];return {sql,bind(...values){params.push(...values);return this;},async first(){return sqlite.prepare(sql).get(...params)??null;},async run(){sqlite.prepare(sql).run(...params);return {success:true};}};},async batch(statements){sqlite.exec('BEGIN');try{for(const statement of statements)sqlite.exec(statement.sql);sqlite.exec('COMMIT');return statements.map(()=>({success:true}));}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 return {db,sqlite};
}

test('API middleware blocks pending and completed account actors but leaves delete retry and signed webhooks reachable',async()=>{
 const originalFetch=globalThis.fetch,h=middlewareDatabase();let authRequests=0,nextCalls=0;
 const env={BILLING_DB:h.db,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test-key'};
 globalThis.fetch=async()=>{authRequests++;return Response.json({id:actor,email:'person@example.test',email_confirmed_at:'2026-10-31T00:00:00Z'});};
 const invoke=path=>apiMiddleware({request:new Request('https://basketboss.co.uk'+path,{headers:{Authorization:'Bearer test-secret',Origin:'capacitor://localhost'}}),env,next:()=>{nextCalls++;return Response.json({passed:true});}});
 try{
  assert.equal((await invoke('/api/subscription/status')).status,200);assert.equal(nextCalls,1);
  h.sqlite.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(actor),'retry',Date.now());
  const blocked=await invoke('/api/subscription/status');assert.equal(blocked.status,409);assert.equal((await blocked.json()).pending,true);assert.equal(nextCalls,1);assert.equal(blocked.headers.get('Access-Control-Allow-Origin'),'capacitor://localhost');
  h.sqlite.exec('UPDATE bb_account_deletions SET completed_at_ms=1');assert.equal((await invoke('/api/household')).status,409);
  const before=authRequests;assert.equal((await invoke('/api/account/delete')).status,200);assert.equal((await invoke('/api/paddle/webhook')).status,200);assert.equal(authRequests,before);
  assert.equal(nextCalls,3);
 }finally{globalThis.fetch=originalFetch;h.sqlite.close();}
});

test('unsigned public API status avoids deletion authentication while account-state failures fail closed',async()=>{
 const originalFetch=globalThis.fetch;let authRequests=0,nextCalls=0;
 globalThis.fetch=async()=>{authRequests++;return Response.json({id:actor,email:'person@example.test',email_confirmed_at:'2026-10-31T00:00:00Z'});};
 const env={BILLING_DB:{prepare(){throw Error('database unavailable');},batch(){}},SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test-key'};
 try{
  const invoke=authorization=>apiMiddleware({request:new Request('https://basketboss.co.uk/api/bb173/status',{headers:authorization?{Authorization:authorization}:{}}),env,next:()=>{nextCalls++;return Response.json({passed:true});}});
  assert.equal((await invoke()).status,200);assert.equal(authRequests,0);assert.equal(nextCalls,1);
  assert.equal((await invoke('Bearer test-secret')).status,503);assert.equal(authRequests,1);assert.equal(nextCalls,1);
 }finally{globalThis.fetch=originalFetch;}
});


test('the core planner cannot recreate a local meal plan or snapshot while deletion is pending or complete',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('function persist(){'),html.indexOf('function notify(msg)'));
 let writes=0;
 const context=vm.createContext({window:{BBAccountDeletion:{isDeleting:()=>true}},localStorage:{setItem(){writes++;},getItem(){throw Error('should not read deleted data');}},bbStorageSafe:true});
 vm.runInContext(source,context);assert.equal(vm.runInContext('persist()',context),false);assert.equal(writes,0);
});
