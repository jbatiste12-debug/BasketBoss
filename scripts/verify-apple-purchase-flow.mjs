// Node-only diagnostic. Every StoreKit and HTTP response below is an isolated
// fixture; this script is never part of the native/web client asset allowlist.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';

const DEFAULT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const APPLE_DIAGNOSTIC_PRODUCTS=Object.freeze({
 monthly:'uk.co.basketboss.premium.monthly',
 annual:'uk.co.basketboss.premium.annual'
});
const EXPECTED=Object.values(APPLE_DIAGNOSTIC_PRODUCTS);
const USER='90000000-0000-4000-8000-000000000001';
const ACCOUNT_TOKEN='90000000-0000-4000-8000-000000000002';
const SESSION_KEY='basketboss_cloud_session_v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const copy=value=>JSON.parse(JSON.stringify(value));
const ids=source=>[...new Set(source.match(/uk\.co\.basketboss\.premium\.[a-zA-Z0-9._-]+/g)||[])].sort();
const sameIds=value=>JSON.stringify([...value].sort())===JSON.stringify([...EXPECTED].sort());

export async function auditAppleProductIds(root=DEFAULT_ROOT){
 const sources=[];
 for(const name of ['native/apple-purchases.mjs','native/membership.mjs','ios/App/App/BasketBossPurchasesPlugin.swift','bb-server-lib/bb-apple-subscriptions.js']){
  const productIds=ids(await fs.readFile(path.join(root,name),'utf8'));
  sources.push({path:name,productIds,match:sameIds(productIds)});
 }
 const fixture=JSON.parse(await fs.readFile(path.join(root,'ios/App/App/BasketBossPremium.storekit'),'utf8'));
 const subscriptions=(fixture.subscriptionGroups||[]).flatMap(group=>group.subscriptions||[]);
 const productIds=subscriptions.map(product=>product.productID);
 sources.push({path:'ios/App/App/BasketBossPremium.storekit',productIds,match:sameIds(productIds)&&productIds.length===2});
 return {passed:sources.every(source=>source.match),products:{...APPLE_DIAGNOSTIC_PRODUCTS},sources,
  appStoreConnectProductMetadataVerified:false};
}

async function fixture(root,{status='purchased',ack=true,rejectVerification=false,missingProducts=false,waitForPurchase=false}={}){
 const {installNativeApplePurchases}=await import(pathToFileURL(path.join(root,'native/apple-purchases.mjs')).href);
 const app=await fs.readFile(path.join(root,'app.html'),'utf8');
 const marker='/* BB SECURE PREMIUM: runtime hydration from D1 after verified membership. */';
 const start=app.indexOf(marker),end=app.indexOf('\nif(!bbStorageSafe)',start);
 if(start<0||end<=start)throw Error('The real Premium catalogue loader could not be located.');
 const runtime=await fs.readFile(path.join(root,'native/runtime.mjs'),'utf8');
 const forward=runtime.split('\n').find(line=>line.includes("window.addEventListener('basketboss:apple-membership-updated'"));
 if(!forward)throw Error('The native membership-to-catalogue event bridge is missing.');
 const free=JSON.parse(await fs.readFile(path.join(root,'recipes.json'),'utf8'));
 if(free.length!==100)throw Error('The diagnostic expects the 100 public recipe catalogue.');
 const privateRecipes=Array.from({length:400},(_,index)=>({id:'diagnostic-private-'+index,name:'Diagnostic recipe '+index,title:'Diagnostic recipe '+index,cost:1,ingredients:[['Rice','100 g',1]]}));
 const storage=new Map(),trace=[],http=[],emissions=[];
 let backendPremium=false,resolvePurchase,purchaseStarted=false;
 let session={user:{id:USER},access_token:'synthetic-diagnostic-session',expires_at:Math.floor(Date.now()/1000)+3600};
 storage.set(SESSION_KEY,JSON.stringify(session));
 const win=new EventTarget(),doc=new EventTarget();win.Event=Event;win.BBNative={isNative:true,platform:'ios'};doc.hidden=false;
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
 const response=(body,statusCode=200)=>({ok:statusCode>=200&&statusCode<300,status:statusCode,json:async()=>copy(body)});
 const perform=async(address,args={})=>{
  const endpoint=new URL(address,'https://basketboss-diagnostic.invalid').pathname;http.push(endpoint);
  if(endpoint==='/api/apple/config')return response({available:true,productIds:[...EXPECTED],environment:'Sandbox',sandboxPurchaseAllowed:true});
  if(endpoint==='/api/subscription/status')return response({authenticated:true,premiumAccess:backendPremium,provider:backendPremium?'apple':null,tier:backendPremium?'premium':'free',mode:'sandbox'});
  if(endpoint==='/api/apple/purchase-context'){
   const body=JSON.parse(args.body||'{}');if(!EXPECTED.includes(body.productId))throw Error('Unexpected diagnostic product.');
   trace.push('accountPrepared');return response({canPurchase:true,productIds:[body.productId],appAccountToken:ACCOUNT_TOKEN,environment:'Sandbox',sandboxPurchaseAllowed:true});
  }
  if(endpoint==='/api/apple/verify'){
   if(rejectVerification){trace.push('serverRejected');return response({error:'Diagnostic verification rejected.',code:'diagnostic_rejected'},503);}
   trace.push(ack?'serverAcknowledged':'serverNotAcknowledged');backendPremium=ack;
   return response({ok:true,acknowledged:ack,premiumAccess:backendPremium});
  }
  if(endpoint==='/api/recipes/premium'){
   if(!backendPremium||!session)return response({error:'Premium required.'},403);
   trace.push('catalogueHydrated');return response({count:400,recipes:privateRecipes,normalized:privateRecipes.map(recipe=>({id:recipe.id,ingredients:[]}))});
  }
  throw Error('Unexpected diagnostic endpoint: '+endpoint);
 };
 const context=vm.createContext({window:win,document:doc,Event,localStorage,fetch:perform,
  RECIPES:copy(free),BB307_NORMALIZED:free.map(recipe=>({id:recipe.id})),BB307_SOURCE_RECIPES:copy(free),
  BB307_ORIGINAL_COSTS:new Map(free.map(recipe=>[recipe.id,recipe.cost])),BB307_VALID_IDS:new Set(free.map(recipe=>recipe.id)),
  bbVerifiedPaidRecipes:false,render(){},setInterval(){return 0;},queueMicrotask,console});
 vm.runInContext(await fs.readFile(path.join(root,'bb-recipe-planning.js'),'utf8'),context);
 context.BBRecipePlanning=win.BBRecipePlanning;
 vm.runInContext(app.slice(start,end)+'\nthis.diagnosticCatalogue=()=>({recipes:RECIPES.length,normalized:BB307_NORMALIZED.length,source:BB307_SOURCE_RECIPES.length,active:window.BasketBossVerifiedPremium.isActive()});',context);
 vm.runInContext(forward,context);
 const transaction={id:'diagnostic-transaction',originalId:'diagnostic-original',productId:APPLE_DIAGNOSTIC_PRODUCTS.monthly,
  appAccountToken:ACCOUNT_TOKEN,signedTransactionInfo:'synthetic-signed-transaction-fixture'};
 const plugin={
  async getProducts({productIds}){if(!sameIds(productIds))throw Error('Unexpected product request.');trace.push('productsRequested');return {products:missingProducts?[]:EXPECTED.map(id=>({id,displayPrice:id===EXPECTED[0]?'£4.99':'£39.99',subscriptionPeriod:{unit:id===EXPECTED[0]?'month':'year',value:1}}))};},
  async purchase(options){if(options.productId!==EXPECTED[0]||options.appAccountToken!==ACCOUNT_TOKEN||Object.keys(options).length!==2)throw Error('Unsafe native purchase arguments.');trace.push('nativeBuyTriggered');purchaseStarted=true;
   const result={status,transaction};if(waitForPurchase)return new Promise(resolve=>{resolvePurchase=()=>resolve(result);});return result;},
  async finishTransaction(options){if(options.transactionId!==transaction.id||options.serverVerified!==true)throw Error('Unsafe finish arguments.');trace.push('nativeFinished');},
  async getPendingTransactions(){return {transactions:[]};},
  async addListener(){return {remove(){}};}
 };
 const controller=installNativeApplePurchases({plugin,apiURL:value=>'https://basketboss-diagnostic.invalid'+value,readSession:()=>session,fetch:perform,window:win});
 const unsubscribe=controller.subscribeState(state=>emissions.push({phase:state.phase,productLoadState:state.productLoadState,premiumAccess:state.premiumAccess,membershipState:state.membershipState}));
 await controller.ready;await tick();
 return {controller,trace,http,emissions,catalogue:()=>context.diagnosticCatalogue(),get purchaseStarted(){return purchaseStarted;},releasePurchase:()=>resolvePurchase?.(),
  signOut(){session=null;storage.delete(SESSION_KEY);win.dispatchEvent(new Event('basketboss:session-changed'));},
  async settle(){for(let index=0;index<8;index++)await tick();},destroy(){unsubscribe();controller.destroy();}};
}

async function checkScenario(root,name,options,verify){
 const h=await fixture(root,options);
 try{return {name,...await verify(h)};}finally{h.destroy();}
}

export async function runApplePurchaseDiagnostic({root=DEFAULT_ROOT}={}){
 const productAudit=await auditAppleProductIds(root);
 const checks=[];
 if(productAudit.passed){
  checks.push(await checkScenario(root,'confirmed_purchase_unlocks_actual_catalogue',{},async h=>{
   const before=h.catalogue(),result=await h.controller.subscribe(EXPECTED[0]);await h.settle();const purchased=h.catalogue();
   const acknowledged=h.trace.indexOf('serverAcknowledged'),finished=h.trace.indexOf('nativeFinished');
   const pass=before.recipes===100&&!before.active&&result.ok===true&&result.premiumAccess===true&&acknowledged>=0&&finished>acknowledged&&h.controller.state.premiumAccess===true&&purchased.recipes===500&&purchased.normalized===500&&purchased.source===500&&purchased.active;
   h.signOut();const signedOut=h.catalogue();await h.settle();
   return {passed:pass&&signedOut.recipes===100&&!signedOut.active&&!h.controller.state.premiumAccess,trace:h.trace,
    before,purchased,signedOut,states:h.emissions};
  }));
  for(const status of ['cancelled','pending'])checks.push(await checkScenario(root,status+'_does_not_unlock',{status},async h=>{
   const result=await h.controller.subscribe(EXPECTED[0]);await h.settle();return {passed:result.status===status&&!h.controller.state.premiumAccess&&h.catalogue().recipes===100&&!h.trace.includes('serverAcknowledged')&&!h.trace.includes('nativeFinished'),trace:h.trace};
  }));
  for(const [name,options]of [['missing_acknowledgement',{ack:false}],['server_rejection',{rejectVerification:true}]])checks.push(await checkScenario(root,name,options,async h=>{
   const result=await h.controller.subscribe(EXPECTED[0]);await h.settle();return {passed:result.ok===false&&!h.controller.state.premiumAccess&&h.catalogue().recipes===100&&!h.trace.includes('nativeFinished'),trace:h.trace};
  }));
  checks.push(await checkScenario(root,'missing_metadata_still_retries_native_by_product_id',{missingProducts:true,status:'cancelled'},async h=>{
   const result=await h.controller.subscribe(EXPECTED[0]);await h.settle();return {passed:result.status==='cancelled'&&h.trace.includes('nativeBuyTriggered')&&!h.controller.state.premiumAccess&&h.catalogue().recipes===100,trace:h.trace,productLoadState:h.controller.state.productLoadState};
  }));
  checks.push(await checkScenario(root,'sign_out_during_sheet_rejects_late_transaction',{waitForPurchase:true},async h=>{
   const pending=h.controller.subscribe(EXPECTED[0]);for(let i=0;i<25&&!h.purchaseStarted;i++)await tick();
   if(!h.purchaseStarted)throw Error('Diagnostic native purchase did not start.');h.signOut();h.releasePurchase();const result=await pending;await h.settle();
   return {passed:result.ok===false&&!h.trace.includes('serverAcknowledged')&&!h.trace.includes('nativeFinished')&&!h.controller.state.premiumAccess&&h.catalogue().recipes===100,trace:h.trace};
  }));
 }
 return {passed:productAudit.passed&&checks.length===7&&checks.every(check=>check.passed),provenance:'Node-only local simulation of the real native controller and real client catalogue loader',
  storeKitSimulated:true,serverVerificationSimulated:true,catalogueResponseSimulated:true,releaseMockModeAdded:false,
  productionBillingTested:false,backendPremiumGranted:false,appStoreConnectProductMetadataVerified:false,
  productAudit,checks};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const report=await runApplePurchaseDiagnostic();
  const outputIndex=process.argv.indexOf('--output');if(outputIndex>=0){const file=process.argv[outputIndex+1];if(!file)throw Error('Provide a report filename after --output.');await fs.mkdir(path.dirname(path.resolve(file)),{recursive:true});await fs.writeFile(file,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
 }catch(error){console.error('Apple local diagnostic failed: '+error.message);process.exitCode=1;}
}
