import test from 'node:test';
import assert from 'node:assert/strict';
import {googlePlayOffers,installAndroidGooglePlayPurchases} from '../native/google-play-purchases.mjs';

const PRODUCT='uk.co.basketboss.premium';
const configuration=()=>({available:true,provider:'google_play',productId:PRODUCT,productIds:[PRODUCT],packageName:'uk.co.basketboss.app',plans:[{plan:'monthly',basePlanId:'monthly',offerIds:['trial']},{plan:'annual',basePlanId:'annual',offerIds:[]}],mode:'test'});
const phase=(billingPeriod='P1M',extra={})=>({formattedPrice:'€4.49',priceCurrencyCode:'EUR',priceAmountMicros:'4490000',billingPeriod,recurrenceMode:1,billingCycleCount:0,...extra});
const catalogue=()=>[{id:PRODUCT,title:'Premium',subscriptionOfferDetails:[{basePlanId:'monthly',offerId:null,offerToken:'monthly-token',pricingPhases:[phase()]},{basePlanId:'monthly',offerId:'trial',offerToken:'eligible-trial-token',pricingPhases:[phase('P7D',{formattedPrice:'€0.00',priceAmountMicros:'0',recurrenceMode:2,billingCycleCount:1}),phase()]},{basePlanId:'annual',offerId:null,offerToken:'annual-token',pricingPhases:[phase('P1Y',{formattedPrice:'€39.99',priceAmountMicros:'39990000'})]}]}];
const session=(actor='actor-a',token='session-a')=>({user:{id:actor},access_token:token,expires_at:Date.now()/1000+3600});
const purchased=(token='purchase-proof')=>({purchaseToken:token,productId:PRODUCT,products:[PRODUCT],state:'purchased',acknowledged:false,obfuscatedAccountId:'server-account-hash'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let count=0;count<100;count++){if(predicate())return;await tick();}assert.fail('Expected asynchronous operation did not occur');}

function fixture(options={}){
 const win=new EventTarget();win.Event=Event;
 const h={session:options.signedOut?null:session(),config:options.config??configuration(),products:catalogue(),owned:[],premium:false,provider:null,deleted:false,calls:[],native:[],verifiedRefreshes:0,overrides:new Map(),purchaseResult:{status:'purchased',purchases:[purchased()]},listeners:new Map()};
 win.localStorage={getItem(){throw Error('Controller must use its session reader');},setItem(){throw Error('Purchase proof and entitlements must never be persisted');}};
 win.BasketBossVerifiedPremium={refresh:async()=>{h.verifiedRefreshes++;}};
 const plugin={
  getProducts:async args=>{h.native.push(['getProducts',args]);return h.getProducts?h.getProducts(args):{products:h.products};},
  getPurchases:async()=>{h.native.push(['getPurchases']);return h.getPurchases?h.getPurchases():{purchases:h.owned};},
  purchase:async args=>{h.native.push(['purchase',args]);return h.purchase?h.purchase(args):h.purchaseResult;},
  manageSubscriptions:async args=>{h.native.push(['manageSubscriptions',args]);return {opened:true};},
  addListener:async(name,callback)=>{h.listeners.set(name,callback);return {remove:async()=>h.listeners.delete(name)};}
 };
 const perform=async(url,options)=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):undefined;
  const call={path,options,body};h.calls.push(call);
  if(h.overrides.has(path))return h.overrides.get(path)(call);
  if(path==='/api/google-play/config')return Response.json(h.config);
  if(path==='/api/subscription/status')return Response.json({authenticated:true,premiumAccess:h.premium,...(h.premium?{tier:'premium',mode:'sandbox',provider:h.provider||'google_play',subscription:{plan:'monthly',productId:PRODUCT}}:{})});
  if(path==='/api/google-play/purchase-context')return Response.json({canPurchase:true,...body,obfuscatedAccountId:'server-account-hash',mode:h.config.mode});
  if(path==='/api/google-play/verify'){h.premium=true;h.provider='google_play';return Response.json({ok:true,acknowledged:true,provider:'google_play',premiumAccess:true});}
  throw Error('Unexpected API path: '+path);
 };
 h.api=installAndroidGooglePlayPurchases({plugin,window:win,readSession:()=>h.session,isDeleting:()=>h.deleted,apiURL:path=>'https://basketboss.co.uk'+path,fetch:perform,productLoadTimeoutMs:options.timeout??30,requestTimeoutMs:100});
 h.win=win;h.changeSession=value=>{h.session=value;win.dispatchEvent(new Event('basketboss:session-changed'));};h.callback=()=>h.listeners.get('purchasesUpdated')?.({purchases:[purchased('untrusted-event-payload')]});
 h.subscribe=()=>h.api.subscribe(h.api.state.offers.find(offer=>offer.plan==='monthly'&&offer.offerId===null)?.key);
 return h;
}

test('Play plan prices, free trials and paid introductory cycles come only from eligible Google phases and server allowlists',()=>{
 const config=configuration(),products=catalogue(),offers=googlePlayOffers(config,products);
 assert.equal(offers.length,3);assert.equal(offers[0].price,'€4.49 / month');assert.equal(offers[1].price,'Free for 7 days, then €4.49 / month');assert.equal(offers[1].hasTrial,true);assert.equal(offers[2].price,'€39.99 / year');
 config.plans[0].offerIds=[];assert.equal(googlePlayOffers(config,products).length,2);
 config.plans[0].offerIds=['trial'];products[0].subscriptionOfferDetails[1].pricingPhases[0]=phase('P1M',{formattedPrice:'€1.00',priceAmountMicros:'1000000',recurrenceMode:2,billingCycleCount:3});
 assert.equal(googlePlayOffers(config,products)[1].price,'€1.00 every 1 month for 3 months, then €4.49 / month');
 assert.equal(googlePlayOffers(config,products)[1].hasTrial,false);
 for(const invalid of [phase('P1W'),phase('P1M',{priceAmountMicros:'0'}),phase('P1M',{recurrenceMode:3}),phase('P1M',{formattedPrice:''}),phase('P1M',{priceCurrencyCode:'GBP',priceAmountMicros:'NaN'})]){
  const altered=catalogue();altered[0].subscriptionOfferDetails[0].pricingPhases=[invalid];assert.equal(googlePlayOffers(configuration(),altered).some(offer=>offer.offerId===null&&offer.plan==='monthly'),false);
 }
 assert.deepEqual(googlePlayOffers({...configuration(),available:false},catalogue()),[]);
 const unallowlisted=catalogue();unallowlisted[0].subscriptionOfferDetails[1].offerId=null;
 assert.equal(googlePlayOffers(configuration(),unallowlisted).some(offer=>offer.hasTrial),false,'a base plan cannot invent a trial');
 delete unallowlisted[0].subscriptionOfferDetails[0].offerId;
 assert.equal(googlePlayOffers(configuration(),unallowlisted).some(offer=>offer.plan==='monthly'),false,'offer identity must be explicit');
});

test('signed out and unconfigured builds have no fabricated product prices or native purchase attempts',async()=>{
 for(const options of [{signedOut:true},{config:{available:false,provider:'google_play',reason:'not_enabled'}}]){
  const h=fixture(options);try{
   await h.api.ready;assert.equal(h.api.state.available,false);assert.deepEqual(h.api.state.offers,[]);assert.deepEqual(h.native,[]);
   const result=await h.api.subscribe('invented-plan');assert.equal(result.ok,false);assert.equal(h.native.some(call=>call[0]==='purchase'),false);
   if(options.signedOut){assert.equal(h.calls.length,0);assert.match(h.api.state.message,/Sign in/);}else assert.match(h.api.state.availabilityMessage,/not available yet/);
   assert.equal(h.verifiedRefreshes,0);
  }finally{h.api.destroy();}
 }
});

test('a fresh server purchase context authorizes the exact Google offer and final server status refreshes Premium',async()=>{
 const h=fixture();try{
  await h.api.ready;h.calls=[];h.native=[];
  const result=await h.subscribe();assert.deepEqual(result,{ok:true,status:'verified',premiumAccess:true});
  const context=h.calls.find(call=>call.path.endsWith('/purchase-context')),verify=h.calls.find(call=>call.path.endsWith('/verify'));
  assert.deepEqual(context.body,{productId:PRODUCT,basePlanId:'monthly',offerId:null});assert.deepEqual(verify.body,{purchaseToken:'purchase-proof',productId:PRODUCT});
  assert.deepEqual(h.native.find(call=>call[0]==='purchase')[1],{productId:PRODUCT,basePlanId:'monthly',offerToken:'monthly-token',obfuscatedAccountId:'server-account-hash'});
  for(const call of h.calls){assert.equal(call.options.headers.Authorization,'Bearer session-a');assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');assert.equal(call.options.cache,'no-store');}
  assert.equal(h.api.state.premiumAccess,true);assert.equal(h.verifiedRefreshes,1);assert.equal(h.win.BasketBossVerifiedPremium.isActive,undefined,'controller never creates an authorization flag');
 }finally{h.api.destroy();}
});

test('existing Premium from every provider blocks a second subscription',async()=>{
 for(const provider of ['google_play','apple','paddle','household']){
  const h=fixture();try{await h.api.ready;h.premium=true;h.provider=provider;const result=await h.subscribe();assert.equal(result.reason,'already_premium');assert.equal(h.native.some(call=>call[0]==='purchase'),false);assert.equal(h.calls.some(call=>call.path.endsWith('/purchase-context')),false);assert.match(h.api.state.message,/do not need another subscription/);}finally{h.api.destroy();}
 }
});

test('cancelled, pending and native purchase errors never verify or grant Premium',async()=>{
 for(const outcome of ['cancelled','pending','error']){
  const h=fixture();try{
   await h.api.ready;h.purchaseResult={status:outcome,purchases:[purchased()]};if(outcome==='error')h.purchase=async()=>{throw Object.assign(Error('private Play debug details'),{code:'BB_PLAY_PURCHASE_FAILED'});};
   const result=await h.subscribe();assert.equal(result.ok,outcome!=='error');assert.equal(h.api.state.premiumAccess,false);assert.equal(h.calls.some(call=>call.path.endsWith('/verify')),false);assert.equal(h.verifiedRefreshes,0);assert.doesNotMatch(h.api.state.message,/private Play debug details/);
   assert.match(h.api.state.message,outcome==='pending'?/pending/:outcome==='cancelled'?/cancelled/:/could not be checked/);
  }finally{h.api.destroy();}
 }
});

test('verification 503 and malformed context fail closed without client acknowledgement',async()=>{
 for(const failure of ['verify','context']){
  const h=fixture();try{
   await h.api.ready;
   h.overrides.set('/api/google-play/'+(failure==='verify'?'verify':'purchase-context'),async()=>failure==='verify'?Response.json({error:'private service failure'},{status:503}):Response.json({canPurchase:true,productId:PRODUCT,basePlanId:'monthly',offerId:null,mode:'test',obfuscatedAccountId:'wrong account id with spaces'}));
   assert.equal((await h.subscribe()).ok,false);assert.equal(h.api.state.premiumAccess,false);assert.equal(h.verifiedRefreshes,0);assert.doesNotMatch(h.api.state.message,/private service failure/);
   if(failure==='context')assert.equal(h.native.some(call=>call[0]==='purchase'),false);
  }finally{h.api.destroy();}
 }
});

test('catalogue timeout or failure still permits owned-purchase reconciliation after reinstall',async()=>{
 for(const failure of ['timeout','error','empty']){
  const h=fixture({signedOut:true,timeout:5});try{
   await h.api.ready;h.owned=[purchased()];
   h.getProducts=()=>failure==='timeout'?new Promise(()=>{}):failure==='error'?Promise.reject(Error('private store error')):Promise.resolve({products:[]});
   h.session=session();await h.api.refresh();
   assert.equal(h.native.some(call=>call[0]==='getPurchases'),true);assert.equal(h.calls.filter(call=>call.path.endsWith('/verify')).length,1);assert.equal(h.api.state.premiumAccess,true);assert.equal(h.api.state.available,false);assert.deepEqual(h.api.state.offers,[]);assert.equal(h.verifiedRefreshes,1);
  }finally{h.api.destroy();}
 }
});

test('already-owned results and duplicate callbacks use fresh ownership and verify each token once',async()=>{
 const h=fixture();try{
  await h.api.ready;h.purchaseResult={status:'alreadyOwned',purchases:[]};h.owned=[purchased()];
  assert.equal((await h.subscribe()).premiumAccess,true);assert.equal(h.calls.filter(call=>call.path.endsWith('/verify')).length,1);
  h.callback();h.callback();await until(()=>!h.api.state.busy);await tick();await until(()=>!h.api.state.busy);
  assert.equal(h.calls.filter(call=>call.path.endsWith('/verify')).length,1);assert.equal(h.calls.some(call=>call.body?.purchaseToken==='untrusted-event-payload'),false);assert.ok(h.native.filter(call=>call[0]==='getPurchases').length>=2);
 }finally{h.api.destroy();}
});

test('a Play completion delivered while the purchase operation is pending queues an owned-purchase retry',async()=>{
 const h=fixture();try{
  await h.api.ready;const purchase=deferred();h.purchase=()=>purchase.promise;const attempt=h.subscribe();await until(()=>h.native.some(call=>call[0]==='purchase'));
  h.owned=[purchased()];h.callback();purchase.resolve({status:'pending',purchases:[]});await attempt;
  await until(()=>h.calls.some(call=>call.path.endsWith('/verify')));await until(()=>!h.api.state.busy);assert.equal(h.api.state.premiumAccess,true);
 }finally{h.api.destroy();}
});

test('a server verified token retries core membership refresh after a temporary final-status outage',async()=>{
 const h=fixture();try{
  await h.api.ready;h.owned=[purchased()];
  h.overrides.set('/api/subscription/status',async()=>h.premium?new Response('{}',{status:503}):Response.json({authenticated:true,premiumAccess:false}));
  assert.equal((await h.subscribe()).ok,false);assert.equal(h.verifiedRefreshes,0);assert.equal(h.api.state.premiumAccess,false);
  h.overrides.delete('/api/subscription/status');assert.equal((await h.api.restore()).premiumAccess,true);assert.equal(h.verifiedRefreshes,1);assert.equal(h.calls.filter(call=>call.path.endsWith('/verify')).length,1);
 }finally{h.api.destroy();}
});

test('actor/token switches and deletion invalidate delayed proof before verification',async()=>{
 for(const change of ['actor','token','deletion']){
  const h=fixture();try{
   await h.api.ready;const purchase=deferred();h.purchase=()=>purchase.promise;const attempt=h.subscribe();await until(()=>h.native.some(call=>call[0]==='purchase'));
   if(change==='deletion'){h.deleted=true;h.win.dispatchEvent(new Event('basketboss:account-deletion-started'));}else h.changeSession(session(change==='actor'?'actor-b':'actor-a',change==='token'?'session-b':'session-a'));
   purchase.resolve({status:'purchased',purchases:[purchased()]});assert.equal((await attempt).reason,'account_changed');
   await tick();assert.equal(h.calls.some(call=>call.path.endsWith('/verify')),false);assert.equal(h.verifiedRefreshes,0);assert.equal(h.api.state.premiumAccess,false);assert.deepEqual(h.api.state.offers,change==='deletion'?[]:h.api.state.offers);
  }finally{h.api.destroy();}
 }
});

test('session replacement aborts in-flight verification and a hung product request without retaining proof',async()=>{
 const h=fixture();try{
  await h.api.ready;const verification=deferred();h.overrides.set('/api/google-play/verify',()=>verification.promise);const attempt=h.subscribe();await until(()=>h.calls.some(call=>call.path.endsWith('/verify')));
  const verify=h.calls.find(call=>call.path.endsWith('/verify'));h.changeSession(null);verification.resolve(Response.json({ok:true,acknowledged:true,provider:'google_play',premiumAccess:true}));
  assert.equal((await attempt).reason,'account_changed');assert.equal(verify.options.signal.aborted,true);assert.equal(h.api.state.membershipState,'signed_out');assert.equal(h.verifiedRefreshes,0);assert.deepEqual(h.api.state.offers,[]);
  h.getProducts=()=>new Promise(()=>{});h.session=session();const refresh=h.api.refresh();await until(()=>h.native.filter(call=>call[0]==='getProducts').length>=3);h.changeSession(null);await refresh;assert.equal(h.api.state.membershipState,'signed_out');
 }finally{h.api.destroy();}
});

test('foreground and reconnection restore current ownership, pending ownership remains Free',async()=>{
 const h=fixture();try{
  await h.api.ready;h.owned=[{...purchased(),state:'pending'}];h.win.dispatchEvent(new Event('online'));
  await until(()=>h.api.state.message.includes('payment is pending'));assert.equal(h.api.state.premiumAccess,false);assert.equal(h.calls.some(call=>call.path.endsWith('/verify')),false);
  h.owned=[purchased()];h.win.dispatchEvent(new Event('basketboss:native-resumed'));await until(()=>h.api.state.premiumAccess);assert.equal(h.verifiedRefreshes,1);
 }finally{h.api.destroy();}
});

test('Google Play management uses verified product metadata and remains reachable when new purchases are disabled',async()=>{
 const h=fixture();try{
  await h.api.ready;h.premium=true;await h.api.refresh({restore:false});assert.equal((await h.api.manage()).ok,true);
  assert.deepEqual(h.native.find(call=>call[0]==='manageSubscriptions')[1],{productId:PRODUCT});
  h.config={available:false,provider:'google_play'};h.premium=false;await h.api.refresh();await h.api.manage();
  assert.deepEqual(h.native.filter(call=>call[0]==='manageSubscriptions').at(-1)[1],{});
  assert.equal(h.native.some(call=>call[0]==='purchase'),false);assert.equal(h.verifiedRefreshes,0);
 }finally{h.api.destroy();}
});
