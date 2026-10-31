import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const original=fs.readFileSync(new URL('../bb-household-sharing.js',import.meta.url),'utf8');
// Expose the shipped closure's methods only within the isolated test VM; the
// production script keeps these private and executes unchanged apart from this.
const source=original.replace('function boot(){','window.__sharingUnderTest={api,synchronize,writeBaseline};function boot(){');
assert.notEqual(source,original);
const sessionKey='basketboss_cloud_session_v1',actor='11111111-1111-4111-8111-111111111111';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};
function harness(fetcher){
 const store=new Map([[sessionKey,JSON.stringify({access_token:'current-token',user:{id:actor}})]]),events=new Map(),calls=[];
 const window={addEventListener(name,handler){const all=events.get(name)||[];all.push(handler);events.set(name,all);}};
 const context={window,document:{readyState:'loading',addEventListener(){}},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},fetch:async(...args)=>{calls.push(args);return fetcher(...args);},navigator:{onLine:true},Date,JSON,console};
 vm.runInNewContext(source,context);
 return {api:window.__sharingUnderTest,store,calls,event(name){for(const fn of events.get(name)||[])fn();}};
}

test('household requests cannot return an old account response after deletion starts or cancels',async()=>{
 const gate=deferred(),h=harness(()=>gate.promise),pending=h.api.api('?mode=entries');
 h.event('basketboss:account-deletion-started');h.event('basketboss:account-deletion-cancelled');
 gate.resolve(Response.json({household_id:'old-household',entries:[{value:{recipeId:'private-meal'}}]}));
 await assert.rejects(pending,/Account changed/);
});

test('household response is pinned to both actor and access token',async()=>{
 const gate=deferred(),h=harness(()=>gate.promise),pending=h.api.api('?mode=status');
 h.store.set(sessionKey,JSON.stringify({access_token:'different-token',user:{id:actor}}));
 gate.resolve(Response.json({partner_email:'private@example.test'}));
 await assert.rejects(pending,/Account changed/);
});

test('pending account deletion blocks household requests and baseline writes',async()=>{
 const h=harness(async()=>Response.json({ok:true}));
 h.event('basketboss:account-deletion-started');
 await assert.rejects(h.api.api('',{action:'patch'}),/Sign in/);
 assert.throws(()=>h.api.writeBaseline('household',{privatePlan:true}),/deletion is in progress/);
 await h.api.synchronize();assert.equal(h.calls.length,0);assert.equal(h.store.size,1);
});
