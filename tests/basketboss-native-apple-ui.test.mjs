import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeApplePurchases} from '../native/apple-purchases.mjs';
const MONTH='uk.co.basketboss.premium.monthly',YEAR='uk.co.basketboss.premium.annual',DELETED_FOUNDER='uk.co.basketboss.premium.founder.monthly';
const TOKEN='c6376990-2814-47bc-b66f-4d5b4ca09538';
const transaction={id:'123456',originalId:'123000',productId:MONTH,appAccountToken:TOKEN,signedTransactionInfo:'server-verifies-this-signed-JWS'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 let session={access_token:'actor-A-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'actor-A'}},deleting=false,premium=false;
 const calls=[],order=[],nativeListeners=new Map();
 const win=new EventTarget();win.Event=Event;
 const plugin={
  async getProducts(args){calls.push(['products',args]);if(options.productsError)throw Error('StoreKit prices are unavailable.');if(options.products)return {products:options.products};return {products:[{id:MONTH,displayPrice:'€5,49',subscriptionPeriod:{unit:'month',value:1}},{id:YEAR,displayPrice:'€43,99',subscriptionPeriod:{unit:'year',value:1}}]};},
  async purchase(args){calls.push(['purchase',args]);return options.purchase?options.purchase(args):{status:'purchased',transaction};},
  async restorePurchases(){calls.push(['restore']);return options.restore?options.restore():{transactions:[transaction]};},
  async getPendingTransactions(){return {transactions:[]};},
  async finishTransaction(args){calls.push(['finish',args]);order.push('finish');},
  async manageSubscriptions(){calls.push(['manage']);},
  async addListener(name,listener){calls.push(['listener',name]);nativeListeners.set(name,listener);return {remove(){nativeListeners.delete(name);calls.push(['removeListener',name]);}};}
 };
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
 const perform=async(address,args)=>{
  const route=new URL(address).pathname;calls.push(['http',route,args]);
  if(options.fetch){const custom=await options.fetch(route,args,response);if(custom)return custom;}
  if(route==='/api/apple/config')return response(options.config||{available:true,productIds:[MONTH,YEAR]});
  if(route==='/api/subscription/status')return response(options.membership||{authenticated:true,premiumAccess:premium,provider:premium?'apple':null});
  if(route==='/api/apple/purchase-context')return response({canPurchase:true,appAccountToken:TOKEN,productIds:[MONTH,YEAR]});
  if(route==='/api/apple/verify'){order.push('verified');premium=options.verifiedAccess!==false;return response({ok:true,acknowledged:options.ack!==false,premiumAccess:premium});}
  throw Error('Unexpected endpoint '+route);
 };
 const controller=installNativeApplePurchases({plugin,apiURL:path=>'https://basketboss.co.uk'+path,readSession:()=>session,fetch:perform,window:win,isDeleting:()=>deleting});
 return {controller,calls,order,plugin,win,response,nativeListeners,receiveIntent(productId){nativeListeners.get('purchaseIntentReceived')?.({productId});},setAccount(id){session=id?{...session,access_token:id+'-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id}}:null;win.dispatchEvent(new Event('basketboss:session-changed'));},deleteAccount(){deleting=true;win.dispatchEvent(new Event('basketboss:account-deletion-started'));},get session(){return session;}};
}
async function withFixture(options,run){const h=fixture(options);try{await h.controller.ready;await run(h);}finally{h.controller.destroy();}}
const purchases=h=>h.calls.filter(call=>call[0]==='purchase');
const finishes=h=>h.calls.filter(call=>call[0]==='finish');
const verifications=h=>h.calls.filter(call=>call[0]==='http'&&call[1]==='/api/apple/verify');

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
