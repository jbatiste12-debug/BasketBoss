import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applePlanPresentation,eligibleSevenDayAppleTrial} from '../native/membership.mjs';
import {installNativeApplePurchases} from '../native/apple-purchases.mjs';

const MONTH='uk.co.basketboss.premium.monthly',YEAR='uk.co.basketboss.premium.annual';
const plans=[{id:MONTH,period:'per month'},{id:YEAR,period:'per year'}];
const offer=()=>({paymentMode:'freeTrial',price:'0',periodCount:1,period:{unit:'week',value:1},eligible:true});
const product=(id=MONTH)=>({id,displayPrice:id===MONTH?'£4.99':'£39.99',subscriptionPeriod:{unit:id===MONTH?'month':'year',value:1},introductoryOffer:offer()});

test('only a real eligible zero-price seven-day Apple introductory offer is advertised',()=>{
 assert.equal(eligibleSevenDayAppleTrial(product()),true);
 const sevenDays=product();sevenDays.introductoryOffer.period={unit:'day',value:7};
 assert.equal(eligibleSevenDayAppleTrial(sevenDays),true);
 const invalid=[undefined,null,{}, {...offer(),eligible:false},{...offer(),eligible:'true'},
  {...offer(),paymentMode:'payAsYouGo'},{...offer(),price:'1.99'}, {...offer(),periodCount:2},
  {...offer(),period:{unit:'day',value:3}}, {...offer(),period:{unit:'week',value:2}},
  {...offer(),period:{unit:'month',value:1}}, {...offer(),period:{unit:'week',value:'1'}}];
 for(const introductoryOffer of invalid){
  const p={...product(),introductoryOffer};assert.equal(eligibleSevenDayAppleTrial(p),false);
  const shown=applePlanPresentation({products:[p],authenticated:true},plans[0]);
  assert.equal(shown.price,'£4.99 per month');assert.equal(shown.action,'Subscribe with Apple');
 }
 assert.equal(eligibleSevenDayAppleTrial({...product(),displayPrice:''}),false);
});

test('trial plans disclose their exact StoreKit renewal price and selected billing period',()=>{
 for(const plan of plans){
  const p=product(plan.id),shown=applePlanPresentation({products:[p],authenticated:true,premiumAccess:false},plan);
  assert.equal(shown.price,'7 days free, then '+p.displayPrice+' '+plan.period);
  assert.equal(shown.action,'Start 7-day free trial');assert.equal(shown.disabled,false);
 }
 const euro={...product(),displayPrice:'€5,49'};
 assert.equal(applePlanPresentation({products:[euro],authenticated:true},plans[0]).price,'7 days free, then €5,49 per month');
});

test('signed-out trial selection requires login; existing Premium never advertises another free trial',()=>{
 const products=[product()];
 assert.equal(applePlanPresentation({products,authenticated:false},plans[0]).action,'Sign in to start free trial');
 const premium=applePlanPresentation({products,authenticated:true,premiumAccess:true},plans[0]);
 assert.equal(premium.price,'£4.99 per month');assert.equal(premium.action,'Subscribe with Apple');
 assert.equal(applePlanPresentation({products,authenticated:true,premiumAccess:true,sandboxPurchaseAllowed:true},plans[0]).action,'Test subscription with Apple');
 assert.equal(applePlanPresentation({products,authenticated:true,busy:true},plans[0]).disabled,true);
 assert.deepEqual(applePlanPresentation({products:[],authenticated:true},plans[0]),{price:'Price shown by Apple',action:'Try Apple subscription',disabled:false});
});

test('trial metadata never starts a purchase or grants Premium; user consent uses unchanged StoreKit purchase path',async()=>{
 const purchases=[],requests=[];
 const win=new EventTarget();win.location={href:'capacitor://localhost/pricing-sandbox.html'};
 const session={access_token:'synthetic-token',expires_at:Date.now()/1000+3600,user:{id:'synthetic-account'}};
 const token='c6376990-2814-47bc-b66f-4d5b4ca09538';
 const plugin={getProducts:async()=>({products:[product(),product(YEAR)]}),purchase:async args=>{purchases.push(args);return {status:'cancelled'};}};
 const perform=async(address,args)=>{
  const route=new URL(address).pathname;requests.push(route);
  const body=route==='/api/apple/config'?{available:true,productIds:[MONTH,YEAR]}:
   route==='/api/subscription/status'?{authenticated:true,premiumAccess:false}:
   route==='/api/apple/purchase-context'?{canPurchase:true,appAccountToken:token,productIds:[MONTH,YEAR]}:null;
  assert.notEqual(body,null);return {ok:true,status:200,json:async()=>body};
 };
 const controller=installNativeApplePurchases({plugin,window:win,readSession:()=>session,apiURL:path=>'https://basketboss.co.uk'+path,fetch:perform});
 try{
  await controller.ready;assert.equal(purchases.length,0);assert.equal(controller.state.premiumAccess,false);
  assert.equal(eligibleSevenDayAppleTrial(controller.state.products[0]),true);
  assert.deepEqual(await controller.subscribe(MONTH),{ok:true,status:'cancelled'});
  assert.deepEqual(purchases,[{productId:MONTH,appAccountToken:token}]);
  assert.equal(controller.state.premiumAccess,false);assert.equal(requests.includes('/api/apple/verify'),false);
 }finally{controller.destroy();}
});

test('native introductory metadata requires both offer existence and current Apple eligibility',()=>{
 const source=fs.readFileSync(new URL('../ios/App/App/BasketBossPurchasesPlugin.swift',import.meta.url),'utf8');
 assert.match(source,/let offer = subscription\.introductoryOffer/);
 assert.match(source,/offer\.paymentMode == \.freeTrial, offer\.price == 0, offer\.periodCount == 1/);
 assert.match(source,/case \.day: unit = "day"; sevenDays = offer\.period\.value == 7/);
 assert.match(source,/case \.week: unit = "week"; sevenDays = offer\.period\.value == 1/);
 assert.match(source,/await subscription\.isEligibleForIntroOffer/);
 assert.match(source,/subscription\.purchase\(options: \[\.appAccountToken\(token\)\]\)/);
});
