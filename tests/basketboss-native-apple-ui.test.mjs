import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeApplePurchases} from '../native/apple-purchases.mjs';
const MONTH='uk.co.basketboss.premium.monthly',YEAR='uk.co.basketboss.premium.annual',DELETED_FOUNDER='uk.co.basketboss.premium.founder.monthly';
const TOKEN='c6376990-2814-47bc-b66f-4d5b4ca09538';
const transaction={id:'123456',originalId:'123000',productId:MONTH,appAccountToken:TOKEN,signedTransactionInfo:'server-verifies-this-signed-JWS'};
const verificationError='This Apple purchase environment is not available for this account.';
const restoreError='Apple purchases could not be restored. Please try again.';
const restoreNetworkError='Apple could not restore purchases because the App Store connection is unavailable. Check your connection, then try Restore Purchases again.';
const restoreDiagnostics=['SKErrorDomain:0','ASDErrorDomain:500','AMSErrorDomain:100'];
const restoreFailure=(code='BB_APPLE_RESTORE',diagnostics=restoreDiagnostics)=>Object.assign(Error('private account person@example.com; receipt private-JWS; provider-description'),{code,data:{restoreDiagnostics:diagnostics,NSLocalizedDescription:'private provider-description',userInfo:{account:'person@example.com'}}});
const signedApp='eyJhbGciOiJFUzI1NiJ9.eyJidW5kbGVJZCI6InVrLmNvLmJhc2tldGJvc3MuYXBwIn0.c2lnbmF0dXJl';
const beta={expiresAt:'2026-12-01T00:00:00.000Z',startedAt:'2026-11-03T00:00:00.000Z',applicationVersion:'6',environment:'Sandbox'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 let session={access_token:'actor-A-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'actor-A'}},deleting=false,premium=false,provider='apple';
 const calls=[],order=[],nativeListeners=new Map();
 const win=new EventTarget();win.Event=Event;win.BBNative=options.native===false?null:{isNative:true,platform:options.platform||'ios'};
 win.BasketBossVerifiedPremium={refresh:async force=>{calls.push(['premiumRefresh',force]);return premium;}};
 win.addEventListener('basketboss:apple-membership-updated',()=>calls.push(['membershipUpdate']));
 const plugin={
  async getProducts(args){calls.push(['products',args]);if(options.productsWait)return options.productsWait; if(options.productsError)throw Error('StoreKit prices are unavailable.');if(options.products)return {products:options.products};return {products:[{id:MONTH,displayPrice:'€5,49',subscriptionPeriod:{unit:'month',value:1}},{id:YEAR,displayPrice:'€43,99',subscriptionPeriod:{unit:'year',value:1}}]};},
  async purchase(args){calls.push(['purchase',args]);return options.purchase?options.purchase(args):{status:'purchased',transaction};},
  async restorePurchases(){calls.push(['restore']);return options.restore?options.restore():{transactions:[transaction]};},
  async getPendingTransactions(){return {transactions:[]};},
  async finishTransaction(args){calls.push(['finish',args]);order.push('finish');},
  async manageSubscriptions(){calls.push(['manage']);},
  async getAppTransaction(){calls.push(['appTransaction']);return options.appTransaction?options.appTransaction():{signedAppTransaction:signedApp};},
  async addListener(name,listener){calls.push(['listener',name]);nativeListeners.set(name,listener);return {remove(){nativeListeners.delete(name);calls.push(['removeListener',name]);}};}
 };
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
 const perform=async(address,args)=>{
  const route=new URL(address).pathname;calls.push(['http',route,args]);
  if(options.fetch){const custom=await options.fetch(route,args,response);if(custom)return custom;}
  if(route==='/api/apple/config')return response(options.config||{available:true,productIds:[MONTH,YEAR]});
  if(route==='/api/subscription/status')return response(options.membership||{authenticated:true,premiumAccess:premium,provider:premium?provider:null,...(premium&&provider==='testflight_beta'?{beta}: {})});
  if(route==='/api/apple/purchase-context')return response({canPurchase:true,appAccountToken:TOKEN,productIds:[MONTH,YEAR]});
  if(route==='/api/apple/verify'){order.push('verified');premium=options.verifiedAccess!==false;return response({ok:true,acknowledged:options.ack!==false,premiumAccess:premium});}
  if(route==='/api/apple/testflight-beta'){premium=true;provider='testflight_beta';return response({ok:true,premiumAccess:true,provider,beta});}
  throw Error('Unexpected endpoint '+route);
 };
 const controller=installNativeApplePurchases({plugin,apiURL:path=>'https://basketboss.co.uk'+path,readSession:()=>session,fetch:perform,window:win,isDeleting:()=>deleting,...(options.productLoadTimeoutMs?{productLoadTimeoutMs:options.productLoadTimeoutMs}:{})});
 return {controller,calls,order,plugin,win,response,nativeListeners,receiveIntent(productId){nativeListeners.get('purchaseIntentReceived')?.({productId});},setAccount(id){session=id?{...session,access_token:id+'-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id}}:null;win.dispatchEvent(new Event('basketboss:session-changed'));},deleteAccount(){deleting=true;win.dispatchEvent(new Event('basketboss:account-deletion-started'));},get session(){return session;}};
}
async function withFixture(options,run){const h=fixture(options);try{await h.controller.ready;await run(h);}finally{h.controller.destroy();}}
const purchases=h=>h.calls.filter(call=>call[0]==='purchase');
const finishes=h=>h.calls.filter(call=>call[0]==='finish');
const verifications=h=>h.calls.filter(call=>call[0]==='http'&&call[1]==='/api/apple/verify');
const membershipChecks=h=>h.calls.filter(call=>call[0]==='http'&&call[1]==='/api/subscription/status');

test('prices come from StoreKit; an eligible web subscriber is never sent to Apple purchase',async()=>withFixture({membership:{authenticated:true,premiumAccess:true,provider:'paddle'}},async h=>{
 assert.deepEqual(h.controller.state.products.map(p=>p.displayPrice),['€5,49','€43,99']);
 const result=await h.controller.subscribe(MONTH);
 assert.equal(result.reason,'already_premium');assert.equal(purchases(h).length,0);
 assert.equal(h.calls.filter(c=>c[1]==='/api/apple/purchase-context').length,0);
}));

test('household Premium suppresses another purchase',async()=>withFixture({membership:{authenticated:true,premiumAccess:true,householdRole:'partner'}},async h=>{
 assert.equal(h.controller.state.provider,'household');
 assert.equal((await h.controller.subscribe(YEAR)).reason,'already_premium');assert.equal(purchases(h).length,0);
}));

test('an unavailable Apple price catalogue cannot hide verified existing web Premium',async()=>withFixture({productsError:true,membership:{authenticated:true,premiumAccess:true,provider:'paddle'}},async h=>{
 assert.equal(h.controller.state.premiumAccess,true);assert.equal(h.controller.state.provider,'paddle');
 assert.equal(h.controller.state.available,false);assert.equal(h.controller.state.phase,'ready');
 assert.equal((await h.controller.subscribe(MONTH)).reason,'already_premium');assert.equal(purchases(h).length,0);
}));

test('fresh server context rejects a web subscription activated after initial status check',async()=>withFixture({fetch:(route,args,response)=>route==='/api/apple/purchase-context'?response({canPurchase:false,reason:'already_premium',error:'Your existing membership already provides Premium.'},409):null},async h=>{
 const result=await h.controller.subscribe(MONTH);assert.equal(result.ok,false);assert.equal(purchases(h).length,0);assert.equal(finishes(h).length,0);
}));

test('successful purchase finishes only after backend acknowledgement and sends no bearer to StoreKit',async()=>withFixture({},async h=>{
 const result=await h.controller.subscribe(MONTH);
 assert.equal(result.premiumAccess,true);assert.deepEqual(h.order,['verified','finish']);
 assert.deepEqual(purchases(h)[0][1],{productId:MONTH,appAccountToken:TOKEN});
 assert.deepEqual(finishes(h)[0][1],{transactionId:transaction.id,serverVerified:true});
 assert.deepEqual(JSON.parse(h.calls.find(c=>c[1]==='/api/apple/purchase-context')[2].body),{productId:MONTH});
 const verification=verifications(h)[0][2];assert.equal(verification.headers.Authorization,'Bearer actor-A-token');
 assert.deepEqual(JSON.parse(verification.body),{transactionId:transaction.id,signedTransactionInfo:transaction.signedTransactionInfo});
 assert.equal(h.controller.state.provider,'apple');
}));

test('a locally verified transaction never grants Premium without server acknowledgement',async()=>withFixture({ack:false},async h=>{
 const result=await h.controller.subscribe(MONTH);
 assert.equal(result.ok,false);assert.equal(finishes(h).length,0);assert.equal(h.controller.state.premiumAccess,false);
}));

for(const operation of ['subscribe','restore'])test('a failed '+operation+' keeps its verification reason across manual, focus and same-session refreshes',async()=>withFixture({fetch:(route,args,response)=>route==='/api/apple/verify'?response({code:'apple_environment_mismatch',error:verificationError},403):null},async h=>{
 const result=await h.controller[operation](MONTH);
 assert.equal(result.reason,'apple_environment_mismatch');assert.equal(result.error,verificationError);
 assert.equal(h.controller.state.message,verificationError);assert.equal(finishes(h).length,0);
 await h.controller.refresh();
 for(const event of ['focus','basketboss:session-changed']){
  h.win.dispatchEvent(new Event(event));await tick();
  assert.equal(h.controller.state.message,verificationError);assert.equal(h.controller.state.phase,'error');
  assert.equal(h.controller.state.membershipState,'free');assert.equal(h.controller.state.premiumAccess,false);
 }
 assert.equal(verifications(h).length,1);assert.equal(finishes(h).length,0);
}));

for(const operation of ['subscribe','restore'])test('a failed '+operation+' keeps its verification reason when same-session membership refreshes return 503',async()=>{
 let statusUnavailable=false;
 const statusError='Membership status is temporarily unavailable.';
 await withFixture({fetch:(route,args,response)=>{
  if(route==='/api/apple/verify')return response({code:'apple_environment_mismatch',error:verificationError},403);
  if(route==='/api/subscription/status'&&statusUnavailable)return response({error:statusError},503);
 }},async h=>{
  assert.equal((await h.controller[operation](MONTH)).reason,'apple_environment_mismatch');
  statusUnavailable=true;const checks=membershipChecks(h).length;
  await h.controller.refresh();assert.equal(h.controller.state.message,verificationError);
  for(const event of ['focus','basketboss:session-changed']){
   h.win.dispatchEvent(new Event(event));await tick();
   assert.equal(h.controller.state.message,verificationError);assert.equal(h.controller.state.phase,'error');
   assert.equal(h.controller.state.membershipState,'unavailable');assert.equal(h.controller.state.premiumAccess,false);
  }
  assert.equal(membershipChecks(h).length,checks+3);assert.equal(verifications(h).length,1);assert.equal(finishes(h).length,0);
  h.setAccount('actor-B');await tick();
  assert.equal(h.controller.state.message,statusError);assert.equal(h.controller.state.phase,'error');
 });
});

test('missing server acknowledgement remains actionable after a Free membership refresh',async()=>withFixture({fetch:(route,args,response)=>route==='/api/apple/verify'?response({ok:true,acknowledged:false,premiumAccess:true}):null},async h=>{
 const result=await h.controller.subscribe(MONTH);assert.equal(result.ok,false);
 await h.controller.refresh();assert.match(h.controller.state.message,/awaiting server confirmation.*Restore Purchases/);
 assert.equal(h.controller.state.phase,'error');assert.equal(h.controller.state.premiumAccess,false);assert.equal(finishes(h).length,0);
}));

test('a queued verification failure survives a later acknowledged inactive transaction and membership refresh',async()=>withFixture({verifiedAccess:false,fetch:(route,args,response)=>route==='/api/apple/verify'&&JSON.parse(args.body).transactionId===transaction.id?response({code:'apple_environment_mismatch',error:verificationError},403):null},async h=>{
 const next={...transaction,id:'123457',signedTransactionInfo:'another-server-verified-JWS'};
 h.nativeListeners.get('transactionsUpdated')({transactions:[transaction,next]});
 while(h.controller.state.busy)await tick();
 assert.equal(verifications(h).length,2);assert.deepEqual(finishes(h).map(call=>call[1].transactionId),[next.id]);
 assert.equal(h.controller.state.message,verificationError);assert.equal(h.controller.state.phase,'error');
 assert.equal(h.controller.state.membershipState,'free');assert.equal(h.controller.state.premiumAccess,false);
 await h.controller.refresh();assert.equal(h.controller.state.message,verificationError);
}));

test('authoritative Premium clears a retained verification failure without a local grant',async()=>{
 let premium=false;
 await withFixture({fetch:(route,args,response)=>{
  if(route==='/api/apple/verify')return response({code:'apple_environment_mismatch',error:verificationError},403);
  if(route==='/api/subscription/status')return response({authenticated:true,premiumAccess:premium,provider:premium?'apple':null});
 }},async h=>{
  await h.controller.subscribe(MONTH);assert.equal(h.controller.state.premiumAccess,false);
  premium=true;await h.controller.refresh();assert.equal(h.controller.state.premiumAccess,true);assert.equal(h.controller.state.phase,'ready');
  assert.match(h.controller.state.message,/Apple Premium subscription is available/);assert.equal(finishes(h).length,0);
  premium=false;await h.controller.refresh();assert.equal(h.controller.state.premiumAccess,false);assert.match(h.controller.state.message,/Choose a plan/);
 });
});

for(const operation of ['subscribe','restore'])test('successful inactive '+operation+' verification clears the previous failure while access stays Free',async()=>{
 let reject=true;
 await withFixture({verifiedAccess:false,fetch:(route,args,response)=>route==='/api/apple/verify'&&reject?response({code:'apple_environment_mismatch',error:verificationError},403):null},async h=>{
  await h.controller.subscribe(MONTH);reject=false;
  assert.equal((await h.controller[operation](MONTH)).ok,true);assert.equal(finishes(h).length,1);
  await h.controller.refresh();assert.equal(h.controller.state.premiumAccess,false);assert.equal(h.controller.state.phase,'ready');assert.match(h.controller.state.message,/Choose a plan/);
 });
});

for(const change of ['account','signout','token','expiry','silent-account'])test('a verification failure is cleared by '+change+' identity change',async()=>withFixture({fetch:(route,args,response)=>route==='/api/apple/verify'?response({code:'apple_environment_mismatch',error:verificationError},403):null},async h=>{
 await h.controller.subscribe(MONTH);assert.equal(h.controller.state.message,verificationError);
 if(change==='account'||change==='signout')h.setAccount(change==='account'?'actor-B':null);
 else{
  if(change==='token')h.session.access_token='new-token';
  if(change==='expiry')h.session.expires_at+=60;
  if(change==='silent-account')h.session.user={id:'actor-B'};
  if(change!=='silent-account')h.win.dispatchEvent(new Event('basketboss:session-changed'));
 }
 const refreshed=h.controller.refresh();assert.notEqual(h.controller.state.message,verificationError);
 await refreshed;assert.notEqual(h.controller.state.message,verificationError);assert.equal(h.controller.state.phase,'ready');
 assert.equal(h.controller.state.membershipState,change==='signout'?'signed_out':'free');assert.equal(h.controller.state.premiumAccess,false);
}));

for(const operation of ['cancelled-purchase','empty-restore','product-error'])test('an explicit '+operation+' retry clears the previous verification failure',async()=>{
 let attempts=0;
 await withFixture({restore:async()=>({transactions:[]}),purchase:async()=>{
  if(++attempts===1)return {status:'purchased',transaction};
  if(operation==='product-error')throw Object.assign(Error('private lookup details'),{code:'BB_APPLE_PRODUCT_UNAVAILABLE'});
  return {status:'cancelled'};
 },fetch:(route,args,response)=>route==='/api/apple/verify'?response({code:'apple_environment_mismatch',error:verificationError},403):null},async h=>{
  await h.controller.subscribe(MONTH);
  if(operation==='empty-restore')await h.controller.restore();else await h.controller.subscribe(MONTH);
  assert.notEqual(h.controller.state.message,verificationError);
  if(operation==='product-error')assert.match(h.controller.state.message,/purchase sheet could not be opened/);
  await h.controller.refresh();assert.match(h.controller.state.message,/Choose a plan/);assert.equal(h.controller.state.phase,'ready');
  assert.equal(h.controller.state.premiumAccess,false);assert.equal(finishes(h).length,0);
 });
});

test('destroying the controller during verification prevents late failure publication',async()=>{
 const reply=deferred();let verifying=false;
 await withFixture({fetch:async(route,args,response)=>{if(route==='/api/apple/verify'){verifying=true;await reply.promise;return response({code:'apple_environment_mismatch',error:verificationError},403);}}},async h=>{
  let updates=0;h.controller.subscribeState(()=>updates++);
  const operation=h.controller.subscribe(MONTH);while(!verifying)await tick();
  h.controller.destroy();const before=updates;reply.resolve();assert.equal((await operation).reason,'account_changed');
  h.win.dispatchEvent(new Event('focus'));await h.controller.refresh();assert.equal(updates,before);assert.equal(finishes(h).length,0);
 });
});

test('verified inactive/refunded purchase can be finished without granting Premium',async()=>withFixture({verifiedAccess:false},async h=>{
 const result=await h.controller.subscribe(MONTH);
 assert.equal(result.premiumAccess,false);assert.equal(finishes(h).length,1);assert.equal(h.controller.state.premiumAccess,false);
}));

for(const status of ['cancelled','pending'])test(status+' does not verify, finish or unlock a purchase',async()=>withFixture({purchase:async()=>({status})},async h=>{
 const result=await h.controller.subscribe(MONTH);assert.equal(result.status,status);
 assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);assert.equal(h.controller.state.premiumAccess,false);
}));

test('already-owned native result verifies existing ownership instead of starting another transaction',async()=>withFixture({purchase:async()=>({status:'alreadyOwned',transaction})},async h=>{
 assert.equal((await h.controller.subscribe(MONTH)).status,'verified');assert.equal(verifications(h).length,1);assert.equal(finishes(h).length,1);
}));

test('switching BasketBoss accounts while Apple sheet is open never links or finishes the old transaction',async()=>{
 const sheet=deferred();
 await withFixture({purchase:()=>sheet.promise},async h=>{
  const operation=h.controller.subscribe(MONTH);while(!purchases(h).length)await tick();
  h.setAccount('actor-B');sheet.resolve({status:'purchased',transaction});
  assert.equal((await operation).reason,'account_changed');assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
 });
});

test('late backend acknowledgement after account switch is ignored and transaction remains unfinished',async()=>{
 const reply=deferred();let verifying=false;
 await withFixture({fetch:async(route,args,response)=>{if(route==='/api/apple/verify'){verifying=true;await reply.promise;return response({ok:true,acknowledged:true,premiumAccess:true});}}},async h=>{
  const operation=h.controller.subscribe(MONTH);while(!verifying)await tick();
  h.setAccount('actor-B');reply.resolve();
  assert.equal((await operation).reason,'account_changed');assert.equal(finishes(h).length,0);
 });
});

test('account deletion started during Apple purchase prevents backend verification and finishing',async()=>{
 const sheet=deferred();
 await withFixture({purchase:()=>sheet.promise},async h=>{
  const operation=h.controller.subscribe(MONTH);while(!purchases(h).length)await tick();
  h.deleteAccount();sheet.resolve({status:'purchased',transaction});await operation;
  assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);assert.equal(h.controller.state.available,false);
 });
});

test('restore verifies purchases on the signed-in BasketBoss account before finishing',async()=>withFixture({},async h=>{
 const result=await h.controller.restore();assert.equal(result.restored,1);assert.equal(result.premiumAccess,true);assert.deepEqual(h.order,['verified','finish']);
 assert.deepEqual(finishes(h)[0][1],{transactionId:transaction.id,serverVerified:true});
 assert.equal(h.controller.state.premiumAccess,true);assert.equal(h.controller.state.provider,'apple');
 const finished=h.calls.indexOf(finishes(h)[0]);assert(h.calls.findIndex((call,index)=>index>finished&&call[0]==='http'&&call[1]==='/api/subscription/status')>finished);
}));

for(const premium of [false,true])test('a cancelled Restore preserves server-verified '+(premium?'Premium':'Free')+' and skips verification, finishing and status refresh',async()=>withFixture({membership:{authenticated:true,premiumAccess:premium,provider:premium?'apple':null},restore:async()=>({status:'cancelled',transactions:[transaction]})},async h=>{
 const checks=membershipChecks(h).length;
 assert.deepEqual(await h.controller.restore(),{ok:true,status:'cancelled'});
 assert.equal(h.controller.state.message,'Restore cancelled. Your access has not changed.');
 assert.equal(h.controller.state.phase,'ready');assert.equal(h.controller.state.busy,false);
 assert.equal(h.controller.state.premiumAccess,premium);assert.equal(h.controller.state.membershipState,premium?'premium':'free');
 assert.equal(h.controller.state.provider,premium?'apple':null);
 assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);assert.equal(membershipChecks(h).length,checks);
 assert.equal(h.calls.some(call=>call[0]==='membershipUpdate'),false);
}));

for(const premium of [false,true])test('a native Restore failure preserves '+(premium?'Premium':'Free')+' and safe support details across manual, focus and same-session refreshes',async()=>withFixture({membership:{authenticated:true,premiumAccess:premium,provider:premium?'apple':null},restore:async()=>{throw restoreFailure();}},async h=>{
 const checks=membershipChecks(h).length,message=restoreError+' Support code: '+restoreDiagnostics.join(', ')+'.';
 const result=await h.controller.restore();
 assert.deepEqual(result,{ok:false,reason:'BB_APPLE_RESTORE',error:message});
 assert.equal(h.controller.state.message,message);assert.equal(h.controller.state.phase,'error');assert.equal(h.controller.state.busy,false);
 assert.equal(h.controller.state.premiumAccess,premium);assert.equal(h.controller.state.provider,premium?'apple':null);
 assert.equal(membershipChecks(h).length,checks);assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
 await h.controller.refresh();assert.equal(h.controller.state.message,message);
 for(const event of ['focus','basketboss:session-changed']){
  h.win.dispatchEvent(new Event(event));await tick();
  assert.equal(h.controller.state.message,message);assert.equal(h.controller.state.phase,'error');
  assert.equal(h.controller.state.membershipState,premium?'premium':'free');assert.equal(h.controller.state.premiumAccess,premium);
 }
 assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
 assert.equal(h.calls.some(call=>call[0]==='membershipUpdate'),false);
}));

test('a network Restore failure displays a fixed connection action and only bounded native domain/code data',async()=>withFixture({restore:async()=>{throw restoreFailure('BB_APPLE_RESTORE_NETWORK',['NSURLErrorDomain:-1009','StoreKitErrorDomain:0','NSCocoaErrorDomain:4097','ASDErrorDomain:500']);}},async h=>{
 const message=restoreNetworkError+' Support code: NSURLErrorDomain:-1009, StoreKitErrorDomain:0, NSCocoaErrorDomain:4097.';
 assert.deepEqual(await h.controller.restore(),{ok:false,reason:'BB_APPLE_RESTORE_NETWORK',error:message});
 assert.equal(h.controller.state.message,message);assert.doesNotMatch(message,/person@|private-JWS|provider-description|ASDErrorDomain/);
 assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
}));

test('Restore accepts the exact typed StoreKit domain through nested Capacitor data and excludes lookalike domains',async()=>withFixture({restore:async()=>{throw restoreFailure('BB_APPLE_RESTORE_NETWORK',['StoreKit.StoreKitError:3','StoreKitXStoreKitError:3','StoreKit.StoreKitError.private:1','ArbitraryDomain:123','NSURLErrorDomain:-1009','StoreKit.StoreKitError:-9223372036854775808']);}},async h=>{
 const message=restoreNetworkError+' Support code: StoreKit.StoreKitError:3, NSURLErrorDomain:-1009, StoreKit.StoreKitError:-9223372036854775808.';
 assert.deepEqual(await h.controller.restore(),{ok:false,reason:'BB_APPLE_RESTORE_NETWORK',error:message});
 assert.equal(h.controller.state.message,message);assert.doesNotMatch(message,/StoreKitX|\.private|ArbitraryDomain|person@|private-JWS/);
 assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
}));

test('malformed Restore diagnostics cannot reveal descriptions or arbitrary provider data',async()=>{
 const invalid=['UnknownDomain:123','SKErrorDomain:1 person@example.com','SKErrorDomain:0\n',' SKErrorDomain:0','SKErrorDomain:+1','SKErrorDomain:01','SKErrorDomain:-0','SKErrorDomain:1.2','SKErrorDomain:1e3','SKErrorDomain:12345678901234567890','SKErrorDomain:１２３',123,null,{domain:'SKErrorDomain',code:0},'NSURLErrorDomain:-1009\nprivate-JWS'];
 for(const supplied of [undefined,null,'SKErrorDomain:0',{code:'SKErrorDomain:0'},invalid])await withFixture({restore:async()=>{const error=restoreFailure();error.data.restoreDiagnostics=supplied;throw error;}},async h=>{
  const result=await h.controller.restore();assert.equal(result.error,restoreError);assert.equal(h.controller.state.message,restoreError);
 });
 await withFixture({restore:async()=>{throw restoreFailure('BB_APPLE_RESTORE',[...invalid,'NSURLErrorDomain:-1009','SKErrorDomain:0']);}},async h=>{
  const result=await h.controller.restore();assert.equal(result.error,restoreError+' Support code: NSURLErrorDomain:-1009, SKErrorDomain:0.');
  assert.doesNotMatch(result.error,/person@|private-JWS|UnknownDomain/);
 });
});

test('Restore uses the Capacitor data envelope and ignores diagnostic-looking descriptions and direct properties',async()=>{
 for(const error of [Object.assign(Error('Support code: NSURLErrorDomain:-1009; person@example.com'),{code:'BB_APPLE_RESTORE',restoreDiagnostics:['NSURLErrorDomain:-1009']}),{code:'unexpected-private-code',message:'person@example.com',data:{error:{restoreDiagnostics:['SKErrorDomain:0']}}}])await withFixture({restore:async()=>{throw error;}},async h=>{
  assert.deepEqual(await h.controller.restore(),{ok:false,reason:'BB_APPLE_RESTORE',error:restoreError});
  await h.controller.refresh();assert.equal(h.controller.state.message,restoreError);
 });
});

test('background acknowledgement and authoritative Premium do not erase a native Restore failure',async()=>withFixture({restore:async()=>{throw restoreFailure();}},async h=>{
 await h.controller.restore();const message=h.controller.state.message;
 h.nativeListeners.get('transactionsUpdated')({transactions:[transaction]});
 while(h.controller.state.busy)await tick();
 assert.deepEqual(h.order,['verified','finish']);assert.equal(h.controller.state.premiumAccess,true);
 assert.equal(h.controller.state.message,message);assert.equal(h.controller.state.phase,'error');
 await h.controller.refresh();assert.equal(h.controller.state.premiumAccess,true);assert.equal(h.controller.state.message,message);
}));

for(const operation of ['empty-restore','cancelled-restore','cancelled-purchase','product-error'])test('a new explicit '+operation+' clears a native Restore failure without retaining unrelated errors',async()=>{
 let attempts=0;
 await withFixture({restore:async()=>{if(++attempts===1)throw restoreFailure();return operation==='cancelled-restore'?{status:'cancelled',transactions:[]}:{transactions:[]};},purchase:async()=>{
  if(operation==='product-error')throw Object.assign(Error('private lookup details'),{code:'BB_APPLE_PRODUCT_LOOKUP'});
  return {status:'cancelled'};
 }},async h=>{
  await h.controller.restore();assert.match(h.controller.state.message,/Support code:/);
  if(operation.endsWith('restore'))await h.controller.restore();else await h.controller.subscribe(MONTH);
  assert.doesNotMatch(h.controller.state.message,/Support code:/);
  if(operation==='product-error')assert.match(h.controller.state.message,/purchase sheet could not be opened/);
  await h.controller.refresh();assert.match(h.controller.state.message,/Choose a plan/);assert.equal(h.controller.state.phase,'ready');
  assert.equal(h.controller.state.premiumAccess,false);assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
 });
});

for(const change of ['account','signout','token','expiry','silent-account','expired'])test('a native Restore failure is cleared by '+change+' session change',async()=>withFixture({restore:async()=>{throw restoreFailure();}},async h=>{
 await h.controller.restore();assert.match(h.controller.state.message,/Support code:/);
 if(change==='account'||change==='signout')h.setAccount(change==='account'?'actor-B':null);
 else{
  if(change==='token')h.session.access_token='new-token';
  if(change==='expiry')h.session.expires_at+=60;
  if(change==='silent-account')h.session.user={id:'actor-B'};
  if(change==='expired')h.session.expires_at=Math.floor(Date.now()/1000)-1;
  if(change!=='silent-account')h.win.dispatchEvent(new Event('basketboss:session-changed'));
 }
 const refreshed=h.controller.refresh();assert.doesNotMatch(h.controller.state.message,/Support code:/);
 await refreshed;assert.doesNotMatch(h.controller.state.message,/Support code:/);assert.equal(h.controller.state.phase,'ready');
 assert.equal(h.controller.state.premiumAccess,false);assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
}));

for(const change of ['account','destroy'])test('a late native Restore error after '+change+' cannot publish or retain details',async()=>{
 const reply=deferred();
 await withFixture({restore:async()=>{await reply.promise;throw restoreFailure();}},async h=>{
  const messages=[];h.controller.subscribeState(state=>messages.push(state.message));
  const operation=h.controller.restore();while(!h.calls.some(call=>call[0]==='restore'))await tick();
  if(change==='account')h.setAccount('actor-B');else h.controller.destroy();
  const count=messages.length;reply.resolve();assert.equal((await operation).reason,'account_changed');
  if(change==='destroy')assert.equal(messages.length,count);
  await h.controller.refresh();assert.equal(messages.some(message=>/Support code:/.test(message)),false);
  assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
 });
});

for(const acknowledged of [false,true])test('Restore only acknowledges '+(acknowledged?'server-verified inactive purchases':'purchases with server acknowledgement'),async()=>withFixture({ack:acknowledged,verifiedAccess:false},async h=>{
 const result=await h.controller.restore();assert.equal(result.ok,acknowledged);
 assert.equal(h.controller.state.premiumAccess,false);assert.equal(finishes(h).length,acknowledged?1:0);
 assert.equal(verifications(h).length,1);
}));

test('restore cannot take an Apple purchase belonging to a different BasketBoss account',async()=>withFixture({fetch:(route,args,response)=>route==='/api/apple/verify'?response({error:'This purchase belongs to another BasketBoss account.',code:'account_mismatch'},409):null},async h=>{
 const result=await h.controller.restore();assert.equal(result.ok,false);assert.equal(result.reason,'account_mismatch');assert.equal(finishes(h).length,0);assert.equal(h.controller.state.premiumAccess,false);
}));

test('unconfigured Apple backend prevents both purchase and restore sheets',async()=>withFixture({fetch:(route,args,response)=>route==='/api/apple/config'?response({available:false}):null},async h=>{
 assert.equal((await h.controller.subscribe(MONTH)).ok,false);assert.equal((await h.controller.restore()).ok,false);assert.equal(purchases(h).length,0);assert.equal(h.calls.filter(c=>c[0]==='restore').length,0);
}));

test('concurrent taps cannot open two purchase sheets',async()=>{
 const sheet=deferred();
 await withFixture({purchase:()=>sheet.promise},async h=>{
  const operation=h.controller.subscribe(MONTH);while(!purchases(h).length)await tick();
  assert.equal((await h.controller.subscribe(YEAR)).reason,'busy');assert.equal(purchases(h).length,1);
  sheet.resolve({status:'cancelled'});await operation;
 });
});

test('signed-out user and unexpected product ID cannot start purchases',async()=>withFixture({},async h=>{
 assert.equal((await h.controller.subscribe('unapproved.sku')).ok,false);assert.equal(purchases(h).length,0);
 h.setAccount(null);assert.equal((await h.controller.subscribe(MONTH)).reason,'signin_required');assert.equal((await h.controller.restore()).reason,'signin_required');assert.equal(purchases(h).length,0);
}));


test('the Apple catalogue requests only the monthly and annual launch products',async()=>withFixture({},async h=>{
 assert.deepEqual(h.controller.state.products.map(product=>product.id),[MONTH,YEAR]);
 assert.deepEqual(h.calls.filter(call=>call[0]==='products').map(call=>call[1].productIds),[[MONTH,YEAR]]);
}));

for(const invalid of [DELETED_FOUNDER,'uk.co.basketboss.premium.unexpected.monthly'])test('an advertised unsupported product cannot be offered or purchased: '+invalid,async()=>withFixture({
 config:{available:true,productIds:[MONTH,YEAR,invalid],founderAvailable:true},
 products:[{id:MONTH,displayPrice:'£4.99',subscriptionPeriod:{unit:'month',value:1}},{id:YEAR,displayPrice:'£39.99',subscriptionPeriod:{unit:'year',value:1}},{id:invalid,displayPrice:'£1.99',subscriptionPeriod:{unit:'month',value:1}}]
},async h=>{
 assert.deepEqual(h.controller.state.products.map(product=>product.id),[MONTH,YEAR]);
 assert.deepEqual(h.calls.filter(call=>call[0]==='products').map(call=>call[1].productIds),[[MONTH,YEAR]]);
 assert.equal((await h.controller.subscribe(invalid)).ok,false);
 assert.equal(purchases(h).length,0);assert.equal(h.calls.filter(call=>call[1]==='/api/apple/purchase-context').length,0);
}));

test('an existing web Founding Member retains verified Premium without another Apple subscription',async()=>withFixture({membership:{authenticated:true,premiumAccess:true,provider:'paddle',subscription:{provider:'paddle',plan:'founder',status:'active'}}},async h=>{
 assert.equal(h.controller.state.premiumAccess,true);assert.equal(h.controller.state.provider,'paddle');
 assert.deepEqual(h.controller.state.subscription,{provider:'paddle',plan:'founder',status:'active'});
 for(const productId of [MONTH,YEAR])assert.equal((await h.controller.subscribe(productId)).reason,'already_premium');
 assert.equal(purchases(h).length,0);assert.equal(h.calls.filter(call=>call[1]==='/api/apple/purchase-context').length,0);
}));


test('a misconfigured Apple billing period cannot be presented under a misleading annual label',async()=>withFixture({products:[{id:MONTH,displayPrice:'£4.99',subscriptionPeriod:{unit:'month',value:1}},{id:YEAR,displayPrice:'£39.99',subscriptionPeriod:{unit:'week',value:1}}]},async h=>{
 assert.equal(h.controller.state.available,false);assert.equal(h.controller.state.products.some(p=>p.id===YEAR),false);
 assert.equal((await h.controller.subscribe(YEAR)).ok,false);assert.equal(purchases(h).length,0);
}));

test('an external purchase intent only opens the bundled account page, requiring sign-in and a fresh explicit purchase',async()=>withFixture({},async h=>{
 const destinations=[];h.win.location={href:'capacitor://localhost/index.html',assign:target=>destinations.push(target)};
 h.setAccount(null);await tick();
 h.receiveIntent(MONTH);await tick();
 assert.deepEqual(destinations,['capacitor://localhost/pricing-sandbox.html?appleIntent='+MONTH]);
 assert.equal(h.controller.state.requestedProductId,MONTH);
 assert.equal(purchases(h).length,0);assert.equal(h.calls.filter(c=>c[1]==='/api/apple/purchase-context').length,0);
 assert.equal((await h.controller.subscribe(MONTH)).reason,'signin_required');
 h.setAccount('actor-A');await tick();
 assert.equal(purchases(h).length,0);
 await h.controller.subscribe(MONTH);
 assert.equal(purchases(h).length,1);assert.equal(h.calls.filter(c=>c[1]==='/api/apple/purchase-context').length,1);
}));

test('unsupported external intents and intents during deletion cannot navigate or start billing',async()=>withFixture({},async h=>{
 const destinations=[];h.win.location={href:'capacitor://localhost/index.html',assign:target=>destinations.push(target)};
 h.receiveIntent('unapproved.sku');await tick();assert.equal(h.controller.state.requestedProductId,null);
 h.deleteAccount();h.receiveIntent(YEAR);await tick();
 assert.equal(destinations.length,0);assert.equal(purchases(h).length,0);assert.equal(verifications(h).length,0);
}));

test('a deleted Founder purchase intent cannot navigate or prepare an Apple payment',async()=>withFixture({},async h=>{
 const destinations=[];h.win.location={href:'capacitor://localhost/index.html',assign:target=>destinations.push(target)};
 h.receiveIntent(DELETED_FOUNDER);await tick();
 assert.equal(h.controller.state.requestedProductId,null);assert.equal(destinations.length,0);
 assert.equal((await h.controller.subscribe(DELETED_FOUNDER)).ok,false);assert.equal(purchases(h).length,0);
 assert.equal(h.calls.filter(call=>call[1]==='/api/apple/purchase-context').length,0);
}));

test('destroying the purchase controller removes both retained native listeners',async()=>{
 const h=fixture();await h.controller.ready;await tick();
 assert.equal(h.nativeListeners.size,2);h.controller.destroy();await tick();assert.equal(h.nativeListeners.size,0);
});


test('membership presentation distinguishes verified Free from malformed or unavailable account status',async()=>{
 await withFixture({},async h=>assert.equal(h.controller.state.membershipState,'free'));
 await withFixture({membership:{authenticated:true,premiumAccess:true,provider:'paddle'}},async h=>assert.equal(h.controller.state.membershipState,'premium'));
 await withFixture({membership:{authenticated:true}},async h=>{assert.equal(h.controller.state.membershipState,'unavailable');assert.equal(h.controller.state.available,false);});
 await withFixture({membership:{authenticated:true,premiumAccess:false,reason:'billing_not_enabled'}},async h=>assert.equal(h.controller.state.membershipState,'unavailable'));
});

test('signing out invalidates the previous membership presentation immediately',async()=>withFixture({membership:{authenticated:true,premiumAccess:true,provider:'paddle'}},async h=>{
 assert.equal(h.controller.state.membershipState,'premium');h.setAccount(null);
 assert.equal(h.controller.state.membershipState,'signed_out');assert.equal(h.controller.state.premiumAccess,false);
}));

test('TestFlight beta unlock works without StoreKit products and trusts only refreshed server membership',async()=>withFixture({config:{available:false}},async h=>{
 assert.equal(h.controller.state.available,false);assert.equal(h.controller.state.premiumAccess,false);
 const result=await h.controller.claimBeta();assert.deepEqual(result,{ok:true,premiumAccess:true,provider:'testflight_beta'});
 const claim=h.calls.find(c=>c[0]==='http'&&c[1]==='/api/apple/testflight-beta');
 assert.deepEqual(JSON.parse(claim[2].body),{signedAppTransaction:signedApp});assert.equal(claim[2].headers.Authorization,'Bearer actor-A-token');
 assert.equal(h.controller.state.provider,'testflight_beta');assert.deepEqual(h.controller.state.beta,beta);assert.equal(h.controller.state.membershipState,'premium');assert.match(h.controller.state.message,/without a subscription charge/);
 assert.equal(h.calls.filter(c=>c[0]==='premiumRefresh'&&c[1]===true).length,1);assert.equal(h.calls.filter(c=>c[0]==='membershipUpdate').length,1);
 const claimAt=h.calls.indexOf(claim),statusAt=h.calls.findIndex((c,i)=>i>claimAt&&c[0]==='http'&&c[1]==='/api/subscription/status'),refreshAt=h.calls.findIndex(c=>c[0]==='premiumRefresh');assert(statusAt>claimAt&&refreshAt>statusAt);
 assert.equal((await h.controller.subscribe(MONTH)).reason,'already_premium');assert.equal(purchases(h).length,0);assert.equal(finishes(h).length,0);assert.equal(h.calls.some(c=>c[0]==='restore'),false);
}));

test('claim acknowledgement alone cannot unlock beta UI without current authoritative Premium status',async()=>withFixture({membership:{authenticated:true,premiumAccess:false}},async h=>{
 const result=await h.controller.claimBeta();assert.equal(result.ok,false);assert.equal(h.controller.state.premiumAccess,false);assert.equal(h.controller.state.beta,null);
 assert.match(h.controller.state.message,/Premium could not be confirmed/);assert.equal(h.calls.some(c=>c[0]==='premiumRefresh'||c[0]==='membershipUpdate'),false);
}));

test('a stalled initial StoreKit catalogue cannot block or later overwrite a beta claim',{timeout:1000},async()=>{
 const products=deferred(),h=fixture({productsWait:products.promise});
 try{
  await tick();assert.equal(h.calls.filter(c=>c[0]==='products').length,1);
  assert.equal((await h.controller.claimBeta()).ok,true);assert.equal(h.controller.state.provider,'testflight_beta');
  assert.equal(h.calls.filter(c=>c[0]==='products').length,1,'claim does not start or await product loading');
  products.resolve({products:[]});await h.controller.ready;assert.equal(h.controller.state.premiumAccess,true);assert.equal(h.controller.state.provider,'testflight_beta');
 }finally{products.resolve({products:[]});h.controller.destroy();}
});

test('beta unlock requires signed-in native iOS and never calls purchase, restore or local entitlement setters',async()=>{
 for(const options of [{native:false},{platform:'android'}])await withFixture(options,async h=>{
  assert.equal((await h.controller.claimBeta()).ok,false);assert.equal(h.calls.some(c=>c[0]==='appTransaction'||c[1]==='/api/apple/testflight-beta'),false);assert.equal(h.controller.state.premiumAccess,false);
 });
 await withFixture({},async h=>{
  h.setAccount(null);assert.equal((await h.controller.claimBeta()).reason,'signin_required');assert.equal(h.calls.some(c=>c[0]==='appTransaction'),false);assert.match(h.controller.state.message,/Sign in/);
 });
});

test('old native plugins and unverifiable app proof show actionable fixed errors without a server claim',async()=>{
 for(const mode of ['missing','unimplemented','unverified','badProof'])await withFixture({appTransaction:async()=>{
  if(mode==='badProof')return {signedAppTransaction:'not-a-signed-app'};
  throw Object.assign(Error('private-Apple-error'),{code:mode==='unimplemented'?'UNIMPLEMENTED':'BB_APPLE_APP_TRANSACTION_UNVERIFIED'});
 }},async h=>{
  if(mode==='missing')delete h.plugin.getAppTransaction;
  assert.equal((await h.controller.claimBeta()).ok,false);assert.equal(h.calls.some(c=>c[1]==='/api/apple/testflight-beta'),false);assert.equal(h.controller.state.premiumAccess,false);
  assert.match(h.controller.state.message,/Update|latest|could not be verified/);assert.doesNotMatch(h.controller.state.message,/private-Apple/);
 });
});

test('server beta proof, ownership, expiry and verification failures do not grant client Premium',async()=>{
 for(const status of [401,403,409,410,503])await withFixture({fetch:(route,args,response)=>route==='/api/apple/testflight-beta'?response({ok:false,code:'testflight_beta_unavailable',error:'Beta access could not be verified. Try again.'},status):null},async h=>{
  assert.equal((await h.controller.claimBeta()).ok,false);assert.equal(h.controller.state.premiumAccess,false);assert.equal(h.calls.some(c=>c[0]==='premiumRefresh'||c[0]==='membershipUpdate'),false);assert.match(h.controller.state.message,/could not be verified/);
 });
});

test('account changes and deletion during native beta proof collection cannot submit or unlock another account',async()=>{
 for(const change of ['account','deletion','signout']){
  const proof=deferred();await withFixture({appTransaction:()=>proof.promise},async h=>{
   const pending=h.controller.claimBeta();await tick();
   if(change==='deletion')h.deleteAccount();else h.setAccount(change==='account'?'actor-B':null);
   proof.resolve({signedAppTransaction:signedApp});assert.equal((await pending).ok,false);assert.equal(h.calls.some(c=>c[1]==='/api/apple/testflight-beta'),false);assert.equal(h.controller.state.premiumAccess,false);
  });
 }
});

test('a late beta acknowledgement after account switch is discarded and its request is aborted',async()=>{
 const server=deferred();let claim;
 await withFixture({fetch:async(route,args,response)=>{if(route==='/api/apple/testflight-beta'){claim=args;await server.promise;return response({ok:true,premiumAccess:true,provider:'testflight_beta',beta});}}},async h=>{
  const pending=h.controller.claimBeta();while(!claim)await tick();h.setAccount('actor-B');assert.equal(claim.signal.aborted,true);server.resolve();assert.equal((await pending).ok,false);
  assert.equal(h.controller.state.premiumAccess,false);assert.equal(h.calls.some(c=>c[0]==='premiumRefresh'||c[0]==='membershipUpdate'),false);
 });
});

test('repeated beta taps share the existing busy boundary without requesting another app proof',async()=>{
 const proof=deferred();await withFixture({appTransaction:()=>proof.promise},async h=>{
  const pending=h.controller.claimBeta();await tick();assert.equal((await h.controller.claimBeta()).reason,'busy');assert.equal(h.calls.filter(c=>c[0]==='appTransaction').length,1);
  proof.resolve({signedAppTransaction:signedApp});assert.equal((await pending).ok,true);assert.equal(h.calls.filter(c=>c[1]==='/api/apple/testflight-beta').length,1);
 });
});

test('unavailable StoreKit products retain an informative fixed reason without native error details',async()=>withFixture({productsError:true},async h=>{
 assert.equal(h.controller.state.available,false);assert.match(h.controller.state.message,/prices could not be loaded.*App Store connection/);assert.equal(h.controller.state.premiumAccess,false);
}));


test('missing StoreKit metadata preserves an explicit fixed-ID native purchase attempt',async()=>{
 for(const options of [{products:[]},{productsError:true}])await withFixture(options,async h=>{
  assert.equal(h.controller.state.available,false);assert.equal(h.controller.state.purchaseServiceReady,true);assert.equal(h.controller.state.products.length,0);
  assert.equal((await h.controller.subscribe(MONTH)).ok,true);assert.equal(purchases(h).length,1);assert.equal(purchases(h)[0][1].productId,MONTH);
  assert.equal(verifications(h).length,1);assert.equal(finishes(h).length,1);
 });
});

for(const productId of [MONTH,YEAR])test('an empty native lookup reports no purchase sheet and permits an explicit retry: '+productId,async()=>{
 let attempt=0;
 const lookup=deferred();
 await withFixture({products:[],purchase:async()=>{
  if(++attempt===1){await lookup.promise;throw Object.assign(Error('private StoreKit lookup details'),{code:'BB_APPLE_PRODUCT_UNAVAILABLE'});}
  return {status:'purchased',transaction:{...transaction,productId}};
 }},async h=>{
  const messages=[],stop=h.controller.subscribeState(state=>messages.push(state.message));
  const operation=h.controller.subscribe(productId);while(!purchases(h).length)await tick();
  assert.equal(h.controller.state.message,'Checking this subscription with Apple…');assert.equal(h.controller.state.busy,true);
  lookup.resolve();const result=await operation;
  assert.equal(result.ok,false);assert.equal(result.reason,'BB_APPLE_PRODUCT_UNAVAILABLE');
  assert.match(result.error,/Apple did not return this subscription.*sheet could not be opened/);
  assert.equal(h.controller.state.message,result.error);assert.equal(h.controller.state.phase,'error');assert.equal(h.controller.state.busy,false);
  assert.equal(h.controller.state.membershipState,'free');assert.equal(h.controller.state.premiumAccess,false);
  assert.equal(h.controller.state.products.length,0);assert.equal(h.controller.state.purchaseServiceReady,true);
  assert.equal(purchases(h).length,1);assert.deepEqual(purchases(h)[0][1],{productId,appAccountToken:TOKEN});
  assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
  assert.equal(h.calls.filter(c=>c[1]==='/api/apple/purchase-context').length,1);
  assert.equal(messages.some(message=>/Confirm.*purchase sheet|private StoreKit|could not be completed/.test(message)),false);
  assert.equal((await h.controller.subscribe(productId)).status,'verified');
  assert.equal(purchases(h).length,2);assert.equal(verifications(h).length,1);assert.equal(finishes(h).length,1);assert.equal(h.controller.state.premiumAccess,true);
  stop();
 });
});

test('a failed native product lookup preserves its distinct safe reason without verifying or unlocking',async()=>withFixture({products:[],purchase:async()=>{throw Object.assign(Error('private StoreKit connection details'),{code:'BB_APPLE_PRODUCT_LOOKUP'});}},async h=>{
 const result=await h.controller.subscribe(MONTH);
 assert.equal(result.ok,false);assert.equal(result.reason,'BB_APPLE_PRODUCT_LOOKUP');
 assert.match(result.error,/could not load this subscription.*sheet could not be opened.*App Store connection/);
 assert.doesNotMatch(result.error,/private StoreKit|could not be completed/);assert.equal(h.controller.state.message,result.error);
 assert.equal(h.controller.state.busy,false);assert.equal(h.controller.state.membershipState,'free');assert.equal(h.controller.state.premiumAccess,false);
 assert.equal(purchases(h).length,1);assert.equal(verifications(h).length,0);assert.equal(finishes(h).length,0);
}));

test('StoreKit empty, partial, invalid and timeout states are explicit and never invent a price',async()=>{
 await withFixture({products:[]},async h=>{assert.equal(h.controller.state.productLoadState,'empty');assert.match(h.controller.state.productLoadMessage,/returned no subscription products/);});
 await withFixture({products:[{id:MONTH,displayPrice:'£4.99',subscriptionPeriod:{unit:'month',value:1}}]},async h=>{assert.equal(h.controller.state.productLoadState,'partial');assert.match(h.controller.state.productLoadMessage,/Annual Premium/);assert.equal((await h.controller.subscribe(YEAR)).ok,true);});
 await withFixture({products:[{id:YEAR,displayPrice:'£39.99',subscriptionPeriod:{unit:'week',value:1}}]},async h=>{assert.equal(h.controller.state.productLoadState,'invalid');assert.equal((await h.controller.subscribe(YEAR)).ok,false);assert.equal(purchases(h).length,0);});
 const pending=deferred();await withFixture({productsWait:pending.promise,productLoadTimeoutMs:5},async h=>{assert.equal(h.controller.state.productLoadState,'timeout');assert.equal(h.controller.state.products.length,0);assert.match(h.controller.state.productLoadMessage,/timed out/);});pending.resolve({products:[]});
});

test('an allowed existing Beta or web member can explicitly test Apple only in server-selected Sandbox',async()=>{
 for(const provider of ['testflight_beta','paddle','apple'])await withFixture({membership:{authenticated:true,premiumAccess:true,provider},config:{available:true,productIds:[MONTH,YEAR],environment:'Sandbox',sandboxPurchaseAllowed:true},fetch:(route,args,response)=>route==='/api/apple/purchase-context'?response({canPurchase:true,appAccountToken:TOKEN,productIds:[MONTH,YEAR],environment:'Sandbox',sandboxPurchaseAllowed:true}):null},async h=>{
  assert.equal(h.controller.state.sandboxPurchaseAllowed,true);assert.equal((await h.controller.subscribe(MONTH)).ok,true);
  const context=h.calls.find(c=>c[0]==='http'&&c[1]==='/api/apple/purchase-context');assert.deepEqual(JSON.parse(context[2].body),{productId:MONTH,testPurchase:true});assert.equal(purchases(h).length,1);assert.deepEqual(h.order,['verified','finish']);
 });
});

test('a Sandbox test flag cannot bypass a Production environment or unconfirmed context',async()=>{
 await withFixture({membership:{authenticated:true,premiumAccess:true,provider:'testflight_beta'},config:{available:true,productIds:[MONTH,YEAR],environment:'Production',sandboxPurchaseAllowed:true}},async h=>{assert.equal(h.controller.state.sandboxPurchaseAllowed,false);assert.equal((await h.controller.subscribe(MONTH)).reason,'already_premium');assert.equal(purchases(h).length,0);});
 await withFixture({membership:{authenticated:true,premiumAccess:true,provider:'testflight_beta'},config:{available:true,productIds:[MONTH,YEAR],environment:'Sandbox',sandboxPurchaseAllowed:true}},async h=>{assert.equal((await h.controller.subscribe(MONTH)).ok,false);assert.equal(purchases(h).length,0);assert.match(h.controller.state.message,/could not be authorized/);});
});

test('changing accounts clears Sandbox purchase permission immediately while the next account is checked',async()=>{
 const wait=deferred();let hold=false;
 await withFixture({membership:{authenticated:true,premiumAccess:true,provider:'testflight_beta'},fetch:async(route,args,response)=>{
  if(route==='/api/apple/config'){if(hold)return wait.promise;return response({available:true,productIds:[MONTH,YEAR],environment:'Sandbox',sandboxPurchaseAllowed:true});}return null;
 }},async h=>{
  assert.equal(h.controller.state.sandboxPurchaseAllowed,true);hold=true;h.setAccount('actor-B');assert.equal(h.controller.state.sandboxPurchaseAllowed,false);assert.equal(h.controller.state.premiumAccess,false);
  wait.resolve(h.response({available:true,productIds:[MONTH,YEAR],environment:'Production',sandboxPurchaseAllowed:false}));await tick();assert.equal(h.controller.state.sandboxPurchaseAllowed,false);
 });
});
