import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {create,KEY,ENDPOINT}=require('../bb-weekly-shop.js');
const ACTOR_A='11111111-1111-4111-8111-111111111111';
const ACTOR_B='22222222-2222-4222-8222-222222222222';
const IDS=[
 '33333333-3333-4333-8333-333333333333',
 '44444444-4444-4444-8444-444444444444',
 '55555555-5555-4555-8555-555555555555'
];
const signedIn=(actor=ACTOR_A,token='synthetic-client-token-a')=>({user:{id:actor},access_token:token,expires_at:Math.floor(Date.now()/1000)+3600});
const status=(extra={})=>({ok:true,premium:false,weekStart:'2026-11-02',nextResetAt:'2026-11-09T00:00:00.000Z',sessionId:null,used:false,...extra});
const allowed=(extra={})=>status({allowed:true,sessionId:IDS[0],used:true,...extra});
const response=(data,code=200)=>({ok:code>=200&&code<300,status:code,json:async()=>data});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture({storage=new Map(),session=signedIn()}={}){
 const h={storage,session,shop:'canonical-shop-a',blocked:false,opens:0,closes:0,requests:[],writes:[],notices:[],states:[],uuidCount:0,replies:[]};
 h.options={
  getSession:()=>h.session,getShopSessionId:()=>h.shop,isBlocked:()=>h.blocked,
  openShop(){h.opens++;},closeShop(){h.closes++;},
  storage:{getItem:key=>h.storage.get(key)??null,setItem(key,value){h.writes.push([key,value]);h.storage.set(key,value);}},
  uuid(){return IDS[h.uuidCount++];},
  fetch(url,init){
   h.requests.push({url,init,storedAtRequest:h.storage.get(KEY)});
   const next=h.replies.shift();
   assert.ok(next,'Every client request must have an explicit synthetic reply.');
   return typeof next==='function'?next(url,init):Promise.resolve(next);
  },
  onNotice:(kind,data)=>h.notices.push({kind,data}),onState:value=>h.states.push(value)
 };
 h.controller=create(h.options);
 h.record=(actor=ACTOR_A)=>JSON.parse(h.storage.get(KEY)||'{"byActor":{}}').byActor[actor];
 return h;
}

test('an unreadable existing shopping session preserves recovery data and cannot consume an allowance',async()=>{
 const h=fixture();h.options.getShopSessionId=()=>{throw Error('existing session needs recovery');};
 assert.equal(await h.controller.start(),false);assert.equal(h.controller.mayOpen(),false);
 assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.equal(h.opens,0);
 assert.equal(h.notices.at(-1).kind,'unavailable');
});

test('the first Free trip persists its retry ID before requesting server approval and opens only after approval',async()=>{
 const h=fixture(),pending=deferred();h.replies.push(pending.promise);
 const result=h.controller.start();assert.equal(h.controller.mayOpen(),false);assert.equal(h.opens,0);
 await Promise.resolve();assert.equal(h.requests.length,1);assert.equal(h.opens,0);
 const sent=h.requests[0];assert.equal(sent.url,ENDPOINT);assert.equal(sent.init.method,'POST');
 assert.deepEqual(JSON.parse(sent.init.body),{sessionId:IDS[0]});
 assert.equal(sent.init.headers.Authorization,'Bearer synthetic-client-token-a');
 assert.equal(sent.init.cache,'no-store');assert.equal(sent.init.redirect,'manual');
 assert.deepEqual(JSON.parse(sent.storedAtRequest).byActor[ACTOR_A],{shopSessionId:h.shop,sessionId:IDS[0],approved:false});
 pending.resolve(response(allowed()));assert.equal(await result,true);
 assert.equal(h.record().approved,true);assert.equal(h.controller.mayOpen(),true);assert.equal(h.opens,1);
});

test('two synchronous launch proxies share exactly one request and one successful open',async()=>{
 const h=fixture(),pending=deferred();h.replies.push(pending.promise);
 const first=h.controller.start(),second=h.controller.start();assert.equal(first,second);
 await Promise.resolve();assert.equal(h.requests.length,1);assert.equal(h.uuidCount,1);
 pending.resolve(response(allowed()));assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(h.opens,1);
});

test('a lost approval response keeps the pending UUID and retries the same trip without consuming another ID',async()=>{
 const h=fixture();h.replies.push(()=>Promise.reject(Error('synthetic connection loss')));
 assert.equal(await h.controller.start(),false);assert.equal(h.record().approved,false);assert.equal(h.opens,0);
 h.replies.push(response(allowed()));assert.equal(await h.controller.start(),true);
 assert.equal(h.uuidCount,1);assert.deepEqual(h.requests.map(r=>JSON.parse(r.init.body).sessionId),[IDS[0],IDS[0]]);
 assert.equal(h.notices[0].kind,'unavailable');assert.equal(h.record().approved,true);
});

test('GET status and restored local approval never grant access; an unfinished trip is reapproved on resume',async()=>{
 const storage=new Map([[KEY,JSON.stringify({version:1,byActor:{[ACTOR_A]:{shopSessionId:'canonical-shop-a',sessionId:IDS[0],approved:true}}})]]);
 const h=fixture({storage});assert.equal(h.controller.mayOpen(),false);
 h.replies.push(response(status({used:true,sessionId:IDS[0]})));await h.controller.refresh();
 assert.equal(h.requests[0].init.method,'GET');assert.equal(h.requests[0].init.body,undefined);assert.equal(h.opens,0);assert.equal(h.controller.mayOpen(),false);
 h.replies.push(response(allowed({resumed:true})));assert.equal(await h.controller.resume(),true);
 assert.equal(h.requests[1].init.method,'POST');assert.equal(JSON.parse(h.requests[1].init.body).sessionId,IDS[0]);assert.equal(h.uuidCount,0);assert.equal(h.opens,1);
});

test('concurrent status reads coalesce into one GET and reuse its short-lived result without granting a trip',async()=>{
 const h=fixture(),pending=deferred();h.replies.push(pending.promise);
 const first=h.controller.refresh(),second=h.controller.refresh(),third=h.controller.refresh();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].init.method,'GET');
 pending.resolve(response(status()));
 const results=await Promise.all([first,second,third]);assert.ok(results.every(value=>value?.used===false));
 assert.equal((await h.controller.refresh()).used,false);assert.equal(h.requests.length,1,'Repeated renders reuse status instead of another GET.');
 assert.equal(h.writes.length,0);assert.equal(h.uuidCount,0);assert.equal(h.opens,0);assert.equal(h.controller.mayOpen(),false);
});

test('a cached unused status cannot bypass a fresh launch approval or carry over to another actor or token',async()=>{
 const h=fixture();h.replies.push(response(status()));await h.controller.refresh();
 h.replies.push(response({error:'weekly_shop_limit',nextResetAt:'2026-11-09T00:00:00.000Z'},429));
 assert.equal(await h.controller.start(),false);assert.deepEqual(h.requests.map(r=>r.init.method),['GET','POST']);
 assert.equal(h.opens,0);assert.equal(h.controller.mayOpen(),false);assert.equal(h.controller.snapshot().used,true);
 h.session=signedIn(ACTOR_B,'synthetic-client-token-b');assert.equal(h.controller.snapshot(),null);
 h.replies.push(response(status({used:false})));assert.equal((await h.controller.refresh()).used,false);
 assert.equal(h.requests.length,3);assert.equal(h.requests[2].init.headers.Authorization,'Bearer synthetic-client-token-b');
 h.session=signedIn(ACTOR_B,'synthetic-refreshed-token-b');assert.equal(h.controller.snapshot(),null);
 h.replies.push(response(status({used:true})));assert.equal((await h.controller.refresh()).used,true);
 assert.equal(h.requests.length,4);assert.equal(h.requests[3].init.headers.Authorization,'Bearer synthetic-refreshed-token-b');
 assert.equal(h.controller.mayOpen(),false);assert.equal(h.opens,0);assert.equal(h.uuidCount,1);
});

for(const outcome of ['unused result','network failure'])test('a late GET '+outcome+' cannot replace a newer successful trip approval',async()=>{
 const h=fixture(),pending=deferred();h.replies.push(pending.promise);
 const read=h.controller.refresh();assert.equal(h.requests[0].init.method,'GET');
 h.replies.push(response(allowed()));assert.equal(await h.controller.start(),true);
 assert.equal(h.controller.snapshot().used,true);assert.equal(h.controller.snapshot().sessionId,IDS[0]);
 if(outcome==='unused result')pending.resolve(response(status({used:false,sessionId:null})));
 else pending.reject(Error('synthetic delayed read failure'));
 await read;
 assert.equal(h.controller.snapshot().used,true);assert.equal(h.controller.snapshot().sessionId,IDS[0]);
 assert.equal(h.controller.mayOpen(),true);assert.equal(h.opens,1);assert.equal(h.requests.length,2);
});

test('automatic resume cannot allocate a new trip or consume an unapproved pending trip',async()=>{
 const h=fixture();assert.equal(await h.controller.resume(),false);assert.equal(h.requests.length,0);assert.equal(h.uuidCount,0);
 h.storage.set(KEY,JSON.stringify({version:1,byActor:{[ACTOR_A]:{shopSessionId:h.shop,sessionId:IDS[0],approved:false}}}));
 assert.equal(await h.controller.resume(),false);assert.equal(h.requests.length,0);assert.equal(h.opens,0);assert.equal(h.notices.length,0);
});

test('finishing and changing the canonical session requires a new approval; a second Free trip is blocked with the reset date',async()=>{
 const h=fixture();h.replies.push(response(allowed()));assert.equal(await h.controller.start(),true);
 const old=h.shop;h.shop='canonical-shop-b';h.controller.end(old);assert.equal(h.controller.mayOpen(),false);
 h.replies.push(response({error:'weekly_shop_limit',nextResetAt:'2026-11-09T00:00:00.000Z'},429));
 assert.equal(await h.controller.start(),false);assert.equal(h.opens,1);assert.equal(h.uuidCount,2);
 assert.equal(h.record().sessionId,IDS[1]);assert.equal(h.record().approved,false);assert.equal(h.controller.mayOpen(),false);
 assert.equal(h.notices.at(-1).kind,'limit');assert.equal(h.notices.at(-1).data.nextResetAt,'2026-11-09T00:00:00.000Z');
 assert.deepEqual(h.requests.map(r=>JSON.parse(r.init.body).sessionId),[IDS[0],IDS[1]]);
});

test('verified Premium responses permit multiple new trips but each still goes through the authoritative endpoint',async()=>{
 const h=fixture();
 for(let index=0;index<3;index++){
  if(index){const old=h.shop;h.shop='canonical-shop-'+index;h.controller.end(old);}
  h.replies.push(response(allowed({premium:true,unlimited:true,used:false,sessionId:IDS[index]})));
  assert.equal(await h.controller.start(),true);assert.equal(h.controller.mayOpen(),true);
 }
 assert.equal(h.opens,3);assert.equal(h.requests.length,3);assert.ok(h.requests.every(r=>r.init.method==='POST'));assert.equal(h.controller.snapshot().premium,true);
});

test('signed-out guests and expired sessions receive sign-in guidance with zero quota requests',async()=>{
 for(const session of [null,{...signedIn(),expires_at:0}]){
  const h=fixture({session});assert.equal(await h.controller.start(),false);assert.equal(await h.controller.refresh(),null);
  assert.equal(h.requests.length,0);assert.equal(h.uuidCount,0);assert.equal(h.writes.length,0);assert.equal(h.opens,0);assert.equal(h.notices[0].kind,'sign-in');
 }
});

test('401 approval responses cannot open the shop or mark a pending trip approved',async()=>{
 const h=fixture();h.replies.push(response({error:'sign_in_required'},401));
 assert.equal(await h.controller.start(),false);assert.equal(h.record().approved,false);assert.equal(h.opens,0);assert.equal(h.notices[0].kind,'sign-in');
});

for(const change of ['actor','token','expiry','deletion','canonical'])test('a late approval cannot open or save approval after a change to '+change,async()=>{
 const h=fixture(),pending=deferred();h.replies.push(pending.promise);
 const result=h.controller.start();await Promise.resolve();assert.equal(h.requests.length,1);
 if(change==='actor')h.session=signedIn(ACTOR_B,'synthetic-client-token-b');
 if(change==='token')h.session=signedIn(ACTOR_A,'synthetic-refreshed-token');
 if(change==='expiry')h.session={...h.session,expires_at:0};
 if(change==='deletion')h.blocked=true;
 if(change==='canonical')h.shop='canonical-shop-b';
 pending.resolve(response(allowed()));assert.equal(await result,false);assert.equal(h.opens,0);assert.equal(h.controller.mayOpen(),false);
 assert.equal(h.record().approved,false);assert.equal(h.record(ACTOR_B),undefined);assert.equal(h.notices.length,0);
});

test('explicit invalidation cancels an in-flight approval even when the original actor and token later return',async()=>{
 const h=fixture(),pending=deferred();h.replies.push(pending.promise);
 const result=h.controller.start();await Promise.resolve();h.controller.invalidate();
 pending.resolve(response(allowed()));assert.equal(await result,false);assert.equal(h.opens,0);assert.equal(h.controller.mayOpen(),false);assert.equal(h.record().approved,false);
});

for(const change of ['actor','invalidation','deletion','canonical'])test('a queued launch must not write or consume an allowance after a pre-request '+change+' change',async()=>{
 const h=fixture();h.replies.push(response(allowed()));
 const result=h.controller.start();
 if(change==='actor')h.session=signedIn(ACTOR_B,'synthetic-client-token-b');
 if(change==='invalidation')h.controller.invalidate();
 if(change==='deletion')h.blocked=true;
 if(change==='canonical')h.shop='canonical-shop-b';
 assert.equal(await result,false);assert.equal(h.requests.length,0,'A superseded queued launch must never reach the quota endpoint.');
 assert.equal(h.writes.length,0,'A superseded launch must not create old-account trip metadata.');assert.equal(h.opens,0);
});

test('an unfinished trip resumed across the weekly boundary retains its existing request UUID',async()=>{
 const h=fixture();h.replies.push(response(allowed()));assert.equal(await h.controller.start(),true);
 const resumed=create(h.options);assert.equal(resumed.mayOpen(),false);
 h.replies.push(response(allowed({weekStart:'2026-11-09',nextResetAt:'2026-11-16T00:00:00.000Z',used:false,resumed:true,sessionWeekStart:'2026-11-02'})));
 assert.equal(await resumed.resume(),true);assert.equal(h.uuidCount,1);assert.equal(JSON.parse(h.requests[1].init.body).sessionId,IDS[0]);
 assert.equal(resumed.snapshot().used,false);assert.equal(resumed.snapshot().sessionWeekStart,'2026-11-02');
});

test('unavailable storage prevents consuming an allowance that the client cannot recover',async()=>{
 const h=fixture();h.options.storage.setItem=()=>{throw Error('synthetic quota exceeded');};
 h.controller=create(h.options);assert.equal(await h.controller.start(),false);assert.equal(h.requests.length,0);assert.equal(h.opens,0);assert.equal(h.notices[0].kind,'unavailable');
});

test('blocked account deletion starts neither authentication nor allowance consumption',async()=>{
 const h=fixture();h.blocked=true;assert.equal(await h.controller.start(),false);
 assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.equal(h.notices[0].kind,'unavailable');
});
