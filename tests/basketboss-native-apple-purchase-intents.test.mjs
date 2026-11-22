import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeApplePurchases} from '../native/apple-purchases.mjs';
const MONTH='uk.co.basketboss.premium.monthly',YEAR='uk.co.basketboss.premium.annual',TOKEN='c6376990-2814-47bc-b66f-4d5b4ca09538';
const transaction={id:'123456',productId:MONTH,signedTransactionInfo:'synthetic-signed-transaction'};
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let n=0;n<100;n++){if(predicate())return;await tick();}assert.fail('Expected synthetic operation was not reached');}
function fixture(options={}){
 const win=new EventTarget();win.Event=Event;let session={user:{id:'synthetic-user'},access_token:options.token||'synthetic-bearer',expires_at:Date.now()/1000+3600},deleting=false,premium=false,next=0,reservation;
 const calls=[],listeners=new Map();
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
 const plugin={getProducts:async()=>({products:[{id:MONTH,displayPrice:'synthetic monthly price',subscriptionPeriod:{unit:'month',value:1}},{id:YEAR,displayPrice:'synthetic annual price',subscriptionPeriod:{unit:'year',value:1}}]}),
  purchase:async args=>{calls.push({kind:'native',args});return options.purchase?options.purchase():{status:'purchased',transaction};},
  finishTransaction:async args=>{calls.push({kind:'finish',args});},getPendingTransactions:async()=>({transactions:[]}),restorePurchases:async()=>({transactions:[transaction]}),
  addListener:async(name,listener)=>{listeners.set(name,listener);return {remove(){listeners.delete(name);}};}};
 const request=async(address,args)=>{
  const path=new URL(address).pathname,body=args.body?JSON.parse(args.body):undefined;calls.push({kind:'http',path,body,authorization:args.headers.Authorization});
  if(path==='/api/apple/config')return response({available:true,productIds:[MONTH,YEAR]});
  if(path==='/api/subscription/status')return response({authenticated:true,premiumAccess:premium,provider:premium?'apple':null});
  if(path==='/api/apple/purchase-context'){
   reservation={protocol:1,id:'00000000-0000-4000-8000-'+String(++next).padStart(12,'0'),capability:'a'.repeat(64),version:1,generation:next,phase:'prepared',provider:'apple',mode:'test',productId:MONTH,basePlanId:null,offerId:null,preparedExpiresAt:Date.now()+120000,billingRevision:0,...options.patch};
   return response({canPurchase:true,appAccountToken:TOKEN,productIds:[MONTH,YEAR],environment:'Sandbox',reservation:options.legacy?undefined:reservation});
  }
  if(path==='/api/subscription/purchase-intent'){
   if(options.intent){const custom=await options.intent(body,{get reservation(){return reservation;},set reservation(value){reservation=value;}},response);if(custom)return custom;}
   if(!body){const {capability:ignored,...projection}=reservation;return response({ok:true,reservation:projection});}
   reservation={...reservation,version:reservation.version+1,phase:body.action==='start'?'started':body.outcome};return response({ok:true,reservation});
  }
  if(path==='/api/apple/verify'){premium=true;return response({ok:true,acknowledged:options.ack!==false,premiumAccess:true});}
  throw Error('Unexpected synthetic endpoint');
 };
 const api=installNativeApplePurchases({plugin,window:win,readSession:()=>session,isDeleting:()=>deleting,apiURL:path=>'https://basketboss.co.uk'+path,fetch:request});
 return {api,calls,listeners,response,replaceToken(token){session={...session,access_token:token};win.dispatchEvent(new Event('basketboss:session-changed'));},change(kind){if(kind==='deletion'){deleting=true;win.dispatchEvent(new Event('basketboss:account-deletion-started'));}else{session={...session,user:{id:kind==='actor'?'other-user':session.user.id},access_token:kind==='token'?'other-token':session.access_token};win.dispatchEvent(new Event('basketboss:session-changed'));}}};
}
const requests=(h,path)=>h.calls.filter(call=>call.path===path);
const intents=h=>requests(h,'/api/subscription/purchase-intent');
const native=h=>h.calls.filter(call=>call.kind==='native');

test('optional Apple handshake starts before StoreKit and attaches only the direct attempt reference',async()=>{
 for(const legacy of [false,true]){const h=fixture({legacy});try{
  await h.api.ready;assert.equal((await h.api.subscribe(MONTH)).premiumAccess,true);
  const context=requests(h,'/api/apple/purchase-context')[0];assert.equal(context.body.reservationProtocol,1);
  const verify=requests(h,'/api/apple/verify')[0];
  if(legacy){assert.equal(intents(h).length,0);assert.equal(verify.body.reservation,undefined);}
  else{assert.ok(h.calls.indexOf(intents(h)[0])<h.calls.indexOf(native(h)[0]));assert.deepEqual(verify.body.reservation,{id:'00000000-0000-4000-8000-000000000001',capability:'a'.repeat(64),version:2,generation:1});}
  assert.ok(h.calls.indexOf(verify)<h.calls.findIndex(call=>call.kind==='finish'));assert.deepEqual(native(h)[0].args,{productId:MONTH,appAccountToken:TOKEN});
 }finally{h.api.destroy();}}
});

for(const outcome of ['cancelled','pending','unknown','not_launched'])test('Apple reports '+outcome+' without granting access or finishing a transaction',async()=>{
 const h=fixture({purchase:async()=>{if(outcome==='not_launched')throw Object.assign(Error('Product lookup failed'),{code:'BB_APPLE_PRODUCT_LOOKUP'});if(outcome==='unknown')throw Error('Uncertain native failure');return {status:outcome};}});try{
  await h.api.ready;await h.api.subscribe(MONTH);const report=intents(h).at(-1).body;
  assert.equal(report.action,'report');assert.equal(report.outcome,['cancelled','not_launched'].includes(outcome)?'canceled':outcome);
  assert.equal(report.cause,outcome==='cancelled'?'native_user_cancelled':outcome==='not_launched'?'not_launched':undefined);
  assert.equal(h.api.state.premiumAccess,false);assert.equal(requests(h,'/api/apple/verify').length,0);assert.equal(h.calls.some(call=>call.kind==='finish'),false);
 }finally{h.api.destroy();}
});

test('failed definite cancellation delivery retries its exact reference before a new context',async()=>{
 let fail=true;const h=fixture({purchase:async()=>({status:'cancelled'}),intent:async(body,_state,response)=>{if(body?.action==='report'&&fail){fail=false;return response({error:'Coordination is unavailable'},503);}}});try{
  await h.api.ready;assert.equal((await h.api.subscribe(MONTH)).ok,false);assert.doesNotMatch(h.api.state.message,/Purchase cancelled/);
  assert.equal((await h.api.subscribe(MONTH)).status,'cancelled');const reports=intents(h).filter(call=>call.body?.action==='report');assert.deepEqual(reports[0].body,reports[1].body);
  assert.ok(h.calls.indexOf(reports[1])<h.calls.indexOf(requests(h,'/api/apple/purchase-context')[1]));assert.equal(h.api.state.premiumAccess,false);
 }finally{h.api.destroy();}
});

test('a lost start response recovers the never-launched attempt without opening StoreKit',async()=>{
 const h=fixture({intent:async(body,state,response)=>{if(body?.action==='start'){state.reservation={...state.reservation,phase:'started',version:2};return response({error:'Start response was lost'},503);}}});try{
  await h.api.ready;assert.equal((await h.api.subscribe(MONTH)).ok,false);assert.equal(native(h).length,0);
  assert.deepEqual(intents(h).map(call=>call.body?.action||'status'),['start','status','report']);assert.equal(intents(h).at(-1).body.cause,'not_launched');assert.equal(intents(h).at(-1).body.reservation.version,2);
 }finally{h.api.destroy();}
});

test('queued updates and explicit restores never inherit a current reservation',async()=>{
 const sheet=deferred(),h=fixture({purchase:()=>sheet.promise});try{
  await h.api.ready;const attempt=h.api.subscribe(MONTH);await until(()=>native(h).length);
  h.listeners.get('transactionsUpdated')({transactions:[transaction]});sheet.resolve({status:'pending'});await attempt;await until(()=>!h.api.state.busy);
  assert.equal(requests(h,'/api/apple/verify').length,1);assert.equal(requests(h,'/api/apple/verify')[0].body.reservation,undefined);
  await h.api.restore();assert.equal(requests(h,'/api/apple/verify').at(-1).body.reservation,undefined);
 }finally{h.api.destroy();}
});

test('selection mismatch and identity changes during start block payment launch',async()=>{
 for(const patch of [{provider:'google_play'},{productId:YEAR},{mode:'live'},{basePlanId:'monthly'},{offerId:'unexpected'}]){const h=fixture({patch});try{await h.api.ready;assert.equal((await h.api.subscribe(MONTH)).ok,false);assert.equal(intents(h).length,0);assert.equal(native(h).length,0);}finally{h.api.destroy();}}
 for(const kind of ['actor','token','deletion']){const start=deferred(),h=fixture({intent:async body=>body?.action==='start'?start.promise:null});try{
  await h.api.ready;const attempt=h.api.subscribe(MONTH);await until(()=>intents(h).length);h.change(kind);
  start.resolve(h.response({ok:true,reservation:{protocol:1}}));assert.equal((await attempt).ok,false);assert.equal(native(h).length,0);assert.equal(requests(h,'/api/apple/verify').length,0);assert.equal(h.calls.some(call=>call.kind==='finish'),false);
 }finally{h.api.destroy();}}
});

test('a coordinated transaction still cannot finish without the original server acknowledgement',async()=>{
 const h=fixture({ack:false});try{await h.api.ready;assert.equal((await h.api.subscribe(MONTH)).ok,false);assert.equal(h.calls.some(call=>call.kind==='finish'),false);assert.equal(h.api.state.premiumAccess,false);assert.equal(intents(h).at(-1).body.outcome,'unknown');}finally{h.api.destroy();}
});

test('JWT refresh permits only definite Apple cleanup while original paid-proof guards remain strict',async()=>{
 const jwt=nonce=>'header.'+Buffer.from(JSON.stringify({iss:'https://fixture.supabase.co/auth/v1',sub:'synthetic-user',session_id:'11111111-1111-4111-8111-111111111111',nonce})).toString('base64url')+'.signature';
 for(const outcome of ['cancelled','not_launched','purchased']){
  const sheet=deferred(),h=fixture({token:jwt(1),purchase:async()=>{await sheet.promise;if(outcome==='not_launched')throw Object.assign(Error('Product unavailable'),{code:'BB_APPLE_PRODUCT_UNAVAILABLE'});return {status:outcome,transaction};}});try{
   await h.api.ready;const attempt=h.api.subscribe(MONTH);await until(()=>native(h).length);h.replaceToken(jwt(2));sheet.resolve();
   assert.equal((await attempt).reason,'account_changed');assert.equal(requests(h,'/api/apple/verify').length,0);assert.equal(h.calls.some(call=>call.kind==='finish'),false);
   const reports=intents(h).filter(call=>call.body?.action==='report');assert.equal(reports.length,outcome==='purchased'?0:1);
   if(reports.length){assert.equal(reports[0].authorization,'Bearer '+jwt(2));assert.equal(reports[0].body.outcome,'canceled');}
  }finally{h.api.destroy();}
 }
});

test('an existing Apple token mismatch releases only a coordinated unused intent and requests restoration',async()=>{
 const message='This Apple subscription belongs to another BasketBoss account.';
 for(const legacy of [false,true]){
  const h=fixture({legacy,purchase:async()=>{throw Object.assign(Error(message),{code:'BB_APPLE_ACCOUNT_MISMATCH'});}});try{
   await h.api.ready;const result=await h.api.subscribe(MONTH);assert.equal(result.reason,'BB_APPLE_ACCOUNT_MISMATCH');assert.equal(native(h).length,1);
   assert.equal(requests(h,'/api/apple/verify').length,0);assert.equal(h.calls.some(call=>call.kind==='finish'),false);assert.equal(h.api.state.premiumAccess,false);
   if(legacy){assert.equal(intents(h).length,0);assert.equal(h.api.state.message,message);}
   else{const report=intents(h).at(-1).body;assert.equal(report.outcome,'canceled');assert.equal(report.cause,'not_launched');assert.match(h.api.state.message,/Use Restore Purchases/);assert.doesNotMatch(h.api.state.message,/another BasketBoss account/);}
  }finally{h.api.destroy();}
 }
});
