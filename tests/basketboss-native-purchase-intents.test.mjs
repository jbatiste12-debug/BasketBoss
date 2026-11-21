import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupActor,createPurchaseIntentClient,PURCHASE_INTENT_PROTOCOL} from '../native/purchase-intents.mjs';

const actor={user:'synthetic-user',token:'synthetic-bearer'};
const prepared=()=>({protocol:1,id:'11111111-1111-4111-8111-111111111111',capability:'a'.repeat(64),version:1,generation:3,phase:'prepared',provider:'apple',mode:'test',productId:'uk.co.basketboss.premium.monthly',basePlanId:null,offerId:null,preparedExpiresAt:Date.now()+120000,billingRevision:2});
const ref=value=>({id:value.id,capability:value.capability,version:value.version,generation:value.generation});
const rejects=error=>error?.code==='purchase_intent_unavailable';

test('legacy/default-off contexts perform no coordination requests',async()=>{
 const client=createPurchaseIntentClient({request:()=>{throw Error('must not request');}});
 assert.equal(PURCHASE_INTENT_PROTOCOL,1);assert.equal(await client.start(undefined,actor),null);assert.equal(await client.report(null,'pending',actor),null);assert.equal(client.reference(null),null);
});

test('start and exact outcome reports use only explicit capability/version references',async()=>{
 const calls=[];let active=prepared();
 const client=createPurchaseIntentClient({request:async(path,pin,body)=>{
  calls.push({path,pin,body});assert.equal(pin,actor);
  active={...active,version:active.version+1,phase:body.action==='start'?'started':body.outcome};
  return {ok:true,reservation:active};
 }});
 active=await client.start(active,actor);assert.equal(active.phase,'started');assert.deepEqual(calls[0].body,{action:'start',reservation:{...ref(active),version:1}});
 active=await client.report(active,'cancelled',actor);assert.deepEqual(calls[1].body,{action:'report',reservation:{...ref(active),version:2},outcome:'canceled',cause:'native_user_cancelled'});
 assert.equal(active.phase,'canceled');assert.equal(JSON.stringify(calls.map(call=>call.body)).includes(actor.token),false);
 for(const [outcome,expected,cause] of [['not_launched','canceled','not_launched'],['pending','pending'],['unknown','unknown']]){
  active={...prepared(),phase:'started',version:2};await client.report(active,outcome,actor);
  assert.equal(calls.at(-1).body.outcome,expected);assert.equal(calls.at(-1).body.cause,cause);
 }
});

test('malformed and changed start responses never authorize launching a store',async()=>{
 for(const patch of [{phase:'prepared'},{version:1},{generation:99},{provider:'google_play'},{capability:'b'.repeat(64)},{productId:'another-product'},{billingRevision:99}]){
  const reservation=prepared(),client=createPurchaseIntentClient({request:async()=>({ok:true,reservation:{...reservation,phase:'started',version:2,...patch}})});
  await assert.rejects(client.start(reservation,actor),rejects);
 }
 const client=createPurchaseIntentClient({request:async()=>{throw Error('synthetic lost start response');}});
 await assert.rejects(client.start(prepared(),actor),/lost start/);
 await assert.rejects(client.start({...prepared(),phase:'unknown'},actor),rejects);
 await assert.rejects(client.report(prepared(),'completed',actor),rejects);
 await assert.rejects(client.report(prepared(),'canceled',actor,'empty_owned_query'),rejects);
});

test('restart status is observational and cannot release pending/unknown or recover capabilities',async()=>{
 for(const phase of ['pending','unknown']){
  const reservation={...prepared(),phase,version:4},client=createPurchaseIntentClient({request:async(path,pin,body)=>{
   assert.equal(body,undefined);assert.equal(pin,actor);assert.match(path,/\?mode=test&id=/);return {ok:true,reservation};
  }});
  const observed=await client.status({mode:'test',id:reservation.id},actor);
  assert.equal(observed.phase,phase);assert.equal(observed.capability,undefined);
  await assert.rejects(client.start(observed,actor),rejects);assert.throws(()=>client.reference(observed),rejects);
 }
});

test('definite cancellation reports retry the original reference only for the same account and token',async()=>{
 const calls=[];let fail=true;const reservation={...prepared(),phase:'started',version:2};
 const client=createPurchaseIntentClient({request:async(_path,pin,body)=>{
  calls.push({pin,body});if(fail){fail=false;throw Error('synthetic lost cancellation response');}
  return {ok:true,reservation:{...reservation,phase:'canceled',version:3}};
 }});
 await assert.rejects(client.report(reservation,'cancelled',actor),/lost cancellation/);
 await client.flush({...actor,generation:99});assert.equal(calls.length,2);assert.deepEqual(calls[1].body,calls[0].body);
 await client.flush(actor);assert.equal(calls.length,2,'confirmed cancellation is not queued again');
 for(const replacement of [{...actor,user:'other-user'},{...actor,token:'replacement-token'}]){
  fail=true;await assert.rejects(client.report(reservation,'not_launched',actor),/lost cancellation/);
  const before=calls.length;await client.flush(replacement);await client.flush(actor);assert.equal(calls.length,before,'changed identities discard rather than rebind cancellation authority');
 }
});

test('failed pending and unknown reports never become queued cancellation or restart authority',async()=>{
 for(const outcome of ['pending','unknown']){
  let calls=0;const client=createPurchaseIntentClient({request:async()=>{calls++;throw Error('synthetic unavailable');}});
  await assert.rejects(client.report({...prepared(),phase:'started',version:2},outcome,actor));await client.flush(actor);assert.equal(calls,1);
 }
});

test('lost or rejected starts recover only an observed matching never-launched attempt',async()=>{
 for(const phase of ['prepared','started']){
  const reservation=prepared(),calls=[];let current={...reservation,phase,version:2};
  const client=createPurchaseIntentClient({request:async(path,_pin,body)=>{
   calls.push({path,body});
   if(body?.action==='start')throw Object.assign(Error('synthetic start failure'),{status:409});
   if(body?.action==='report'){assert.equal(body.reservation.version,2);current={...current,phase:'canceled',version:3};return {ok:true,reservation:current};}
   const {capability:ignored,...projection}=current;return {ok:true,reservation:projection};
  }});
  await assert.rejects(client.start(reservation,actor),/start failure/);
  assert.deepEqual(calls.map(call=>call.body?.action||'status'),['start','status','report']);assert.equal(calls[2].body.outcome,'canceled');assert.equal(calls[2].body.cause,'not_launched');
 }
 for(const patch of [{phase:'pending'},{phase:'unknown'},{generation:99},{productId:'other-product'}]){
  const reservation=prepared(),calls=[];
  const client=createPurchaseIntentClient({request:async(_path,_pin,body)=>{calls.push(body);if(body)throw Error('start failure');const {capability:ignored,...projection}=reservation;return {ok:true,reservation:{...projection,phase:'started',version:2,...patch}};}});
  await assert.rejects(client.start(reservation,actor),/start failure/);assert.equal(calls.some(body=>body?.action==='report'),false);
 }
});

test('definite cleanup routes refreshed JWTs only within the exact account, issuer and stable session',async()=>{
 const jwt=(session='11111111-1111-4111-8111-111111111111',extra={})=>'header.'+Buffer.from(JSON.stringify({iss:'https://fixture.supabase.co/auth/v1',sub:'synthetic-user',session_id:session,...extra})).toString('base64url')+'.signature';
 const original={user:'synthetic-user',token:jwt()},refreshed={...original,token:jwt(undefined,{exp:9999999999}),generation:9};
 assert.equal(cleanupActor(original,refreshed),refreshed);
 for(const replacement of [{...refreshed,user:'other-user'},{...refreshed,token:jwt('22222222-2222-4222-8222-222222222222')},{...refreshed,token:jwt(undefined,{iss:'https://other.supabase.co/auth/v1'})}])assert.equal(cleanupActor(original,replacement),null);
 const reservation={...prepared(),phase:'started',version:2},calls=[];let fail=true;
 const client=createPurchaseIntentClient({request:async(_path,pin,body)=>{calls.push({pin,body});if(fail){fail=false;throw Error('cancellation response lost');}return {ok:true,reservation:{...reservation,phase:'canceled',version:3}};}});
 await assert.rejects(client.report(reservation,'cancelled',original));await client.flush(refreshed);
 assert.equal(calls[1].pin,refreshed);assert.deepEqual(calls[1].body,calls[0].body);assert.equal(calls.length,2);
});
