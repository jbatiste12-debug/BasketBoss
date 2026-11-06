// Native StoreKit bridge controller. Only the server can grant Premium access.
import {nativeMembershipURL} from './routing.mjs';
const MONTHLY='uk.co.basketboss.premium.monthly',ANNUAL='uk.co.basketboss.premium.annual';
const PRODUCTS=Object.freeze([MONTHLY,ANNUAL]);
const PRODUCT_ERRORS=new Map([
 ['BB_APPLE_PRODUCT_UNAVAILABLE','Apple did not return this subscription, so its purchase sheet could not be opened. Refresh prices or try again later.'],
 ['BB_APPLE_PRODUCT_LOOKUP','Apple could not load this subscription, so its purchase sheet could not be opened. Check your App Store connection, then try again.']
]);
const RESTORE_DIAGNOSTIC=/^(?:SKErrorDomain|StoreKitErrorDomain|StoreKit\.StoreKitError|ASDErrorDomain|AMSErrorDomain|NSURLErrorDomain|NSCocoaErrorDomain):(?:0|-?[1-9]\d{0,18})$/;
function restoreErrorMessage(error){
 const message=error?.code==='BB_APPLE_RESTORE_NETWORK'?'Apple could not restore purchases because the App Store connection is unavailable. Check your connection, then try Restore Purchases again.':'Apple purchases could not be restored. Please try again.';
 // Only the explicit native domain/code payload is suitable for display. Never
 // expose StoreKit descriptions, userInfo or arbitrary provider error text.
 const supplied=error?.data?.restoreDiagnostics;
 const diagnostics=Array.isArray(supplied)?supplied.filter(value=>typeof value==='string'&&value.length<=43&&value.trim()===value&&RESTORE_DIAGNOSTIC.test(value)).slice(0,3):[];
 return message+(diagnostics.length?' Support code: '+diagnostics.join(', ')+'.':'');
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accountChanged=()=>Object.assign(Error('Your account changed. Sign in to the account used for this purchase, then restore it.'),{code:'account_changed'});
export function installNativeApplePurchases({plugin,apiURL,readSession,fetch:perform=globalThis.fetch,window:win=globalThis.window,isDeleting=()=>false,productLoadTimeoutMs=15000}){
 const url=value=>typeof apiURL==='function'?apiURL(value):String(apiURL||'')+value;
 let destroyed=false,generation=0,viewRevision=0,busy=false,verificationFailure=null,nativeRestoreFailure=null;
 const listenerHandles=[];
 const identity=()=>{const s=readSession();return JSON.stringify([s?.user?.id||null,s?.access_token||null,s?.expires_at||null]);};
 let lastIdentity=identity();
 const listeners=new Set(),requests=new Set(),queued=new Map(),productTimers=new Set();
 let requestedProductId=null;
 try{const requested=new URL(win?.location?.href).searchParams.get('appleIntent');if(PRODUCTS.includes(requested))requestedProductId=requested;}catch{}
 let state={available:false,purchaseServiceReady:false,sandboxPurchaseAllowed:false,appleEnvironment:null,serverReadiness:'loading',productLoadState:'loading',productLoadMessage:'Loading subscription prices from Apple…',availabilityMessage:'',authenticated:false,premiumAccess:false,provider:null,subscription:null,beta:null,products:[],invalidProductIds:[],membershipState:'checking',requestedProductId,busy:false,phase:'loading',message:'Checking Apple subscriptions…'};
 function emit(change){if(destroyed)return;state={...state,...change,busy};for(const listener of listeners)listener({...state,products:[...state.products]});}
 function pin(){const s=readSession();return s?.access_token&&s?.user?.id&&Number(s.expires_at)*1000>Date.now()+5000?{token:s.access_token,user:s.user.id,generation}:null;}
 function current(p){const now=pin();return !destroyed&&!isDeleting()&&p&&now&&now.generation===p.generation&&now.token===p.token&&now.user===p.user;}
 function requireCurrent(p){if(!current(p))throw accountChanged();}
 const purchaseErrorMessage=error=>PRODUCT_ERRORS.get(error?.code)||error?.message||'Apple purchases are temporarily unavailable. Try again.';
 // Keep only transaction delivery failures, in memory and for the same session.
 function retainVerificationFailure(actor,message,expectedIdentity){if(current(actor)&&identity()===expectedIdentity)verificationFailure={identity:expectedIdentity,message};}
 async function request(path,{pin:actor,body,method=body===undefined?'GET':'POST',authenticated=true}={}){
  if(destroyed||isDeleting())throw Error('Account deletion is in progress. Purchases are paused.');
  if(authenticated)requireCurrent(actor);
  const controller=new AbortController();requests.add(controller);
  try{
   const response=await perform(url(path),{method,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(actor?{Authorization:'Bearer '+actor.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store',credentials:'omit'});
   if(authenticated)requireCurrent(actor);
   const payload=await response.json().catch(()=>({}));
   if(authenticated)requireCurrent(actor);
   if(!response.ok){const e=Object.assign(Error(String(payload.error||'Apple subscription verification is temporarily unavailable.').slice(0,240)),{status:response.status,code:payload.code||payload.reason,payload});throw e;}
   return payload;
  }finally{requests.delete(controller);}
 }
 function catalogueSnapshot(){return Object.fromEntries(['available','products','invalidProductIds','availabilityMessage','purchaseServiceReady','sandboxPurchaseAllowed','appleEnvironment','serverReadiness','productLoadState','productLoadMessage'].map(key=>[key,state[key]]));}
 async function storeProducts(){
  let timer;
  try{
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('StoreKit product loading timed out.'),{code:'storekit_timeout'})),productLoadTimeoutMs);productTimers.add(timer);});
   return await Promise.race([Promise.resolve().then(()=>plugin.getProducts({productIds:[...PRODUCTS]})),timeout]);
  }finally{if(timer){clearTimeout(timer);productTimers.delete(timer);}}
 }
 async function loadProducts(){
  // StoreKit product availability and server purchase readiness are independent.
  // Always ask Apple for the two fixed launch products, even when server setup
  // is unavailable, and retain an explicit retry path for each product ID.
  const [configured,listed]=await Promise.allSettled([request('/api/apple/config',{pin:pin(),authenticated:false}),storeProducts()]);
  const config=configured.status==='fulfilled'?configured.value:null;
  const purchaseServiceReady=config?.available===true&&Array.isArray(config.productIds)&&PRODUCTS.every(id=>config.productIds.includes(id));
  const serverReadiness=purchaseServiceReady?'ready':configured.status==='rejected'?'unreachable':config?.reason==='apple_not_enabled'?'not_enabled':'not_ready';
  const serverMessage=purchaseServiceReady?'':serverReadiness==='unreachable'?'Apple purchase verification could not be reached. Check your connection, then try again.':serverReadiness==='not_enabled'?'Apple subscription purchases are not enabled on the server yet.':'Apple subscription verification is not ready for this account. Try again after setup is checked.';
  const raw=listed.status==='fulfilled'&&Array.isArray(listed.value?.products)?listed.value.products:[];
  const products=PRODUCTS.map(id=>raw.find(product=>product.id===id)).filter(product=>product&&typeof product.displayPrice==='string'&&product.displayPrice.length>0&&product.displayPrice.length<80&&Number(product.subscriptionPeriod?.value)===1&&product.subscriptionPeriod?.unit===(product.id===ANNUAL?'year':'month'));
  const invalidProductIds=PRODUCTS.filter(id=>{const product=raw.find(item=>item.id===id);return product&&(Number(product.subscriptionPeriod?.value)!==1||product.subscriptionPeriod?.unit!==(id===ANNUAL?'year':'month'));});
  const complete=PRODUCTS.every(id=>products.some(product=>product.id===id));
  const productLoadState=listed.status==='rejected'?(listed.reason?.code==='storekit_timeout'?'timeout':'error'):complete?'ready':invalidProductIds.length?'invalid':products.length?'partial':'empty';
  const missing=PRODUCTS.filter(id=>!products.some(product=>product.id===id)).map(id=>id===MONTHLY?'Monthly Premium':'Annual Premium');
  const productLoadMessage=complete?'':productLoadState==='invalid'?'Apple returned an unexpected subscription billing period. Refresh prices after the plan setup is checked.':productLoadState==='timeout'?'StoreKit product loading timed out. Try the Apple subscription button or refresh prices.':productLoadState==='error'?'Apple subscription prices could not be loaded. Check your App Store connection, then try the Apple subscription button or refresh prices.':productLoadState==='empty'?'StoreKit returned no subscription products. Try an Apple subscription button to ask Apple again.':'Apple did not return '+missing.join(' and ')+'. You can retry the missing plan below.';
  return {available:purchaseServiceReady&&complete,purchaseServiceReady,sandboxPurchaseAllowed:purchaseServiceReady&&config.environment==='Sandbox'&&config.sandboxPurchaseAllowed===true,appleEnvironment:purchaseServiceReady?config.environment||null:null,serverReadiness,products,invalidProductIds,productLoadState,productLoadMessage,availabilityMessage:[serverMessage,productLoadMessage].filter(Boolean).join(' ')};
 }
 async function refresh(options={}){
  if(destroyed)return {...state};
  const staleFailure=(verificationFailure&&verificationFailure.identity!==identity())||(nativeRestoreFailure&&nativeRestoreFailure.identity!==identity());
  if(staleFailure){verificationFailure=null;nativeRestoreFailure=null;}
  const revision=++viewRevision,actor=pin(),epoch=generation;
  if(isDeleting()){emit({available:false,purchaseServiceReady:false,sandboxPurchaseAllowed:false,authenticated:!!actor,premiumAccess:false,membershipState:'unavailable',phase:'paused',message:'Account deletion is in progress. Purchases are paused.'});return {...state};}
  emit({authenticated:!!actor,membershipState:actor?'checking':'signed_out',...(staleFailure?{phase:'loading',message:'Checking Apple subscriptions…'}:{}),...(options.membershipOnly===true?{}:{productLoadState:'loading',productLoadMessage:'Loading subscription prices from Apple…'})});
  let catalog=catalogueSnapshot();
  try{
   const catalogRequest=options.membershipOnly===true?Promise.resolve(catalog):loadProducts();
   const [catalogue,membershipResult]=await Promise.allSettled([catalogRequest,actor?request('/api/subscription/status',{pin:actor}):Promise.resolve(null)]);
   if(destroyed||revision!==viewRevision||epoch!==generation||isDeleting()||(actor&&!current(actor)))return {...state};
   catalog=catalogue.status==='fulfilled'?catalogue.value:{...catalog,available:false,purchaseServiceReady:false,sandboxPurchaseAllowed:false,serverReadiness:'unreachable'};
   if(membershipResult.status==='rejected')throw membershipResult.reason;
   const membership=membershipResult.value;
   if(actor&&(membership?.authenticated!==true||typeof membership.premiumAccess!=='boolean'))throw Error('Sign in again to check your membership.');
   if(actor&&membership.reason==='billing_not_enabled')throw Error('Membership verification is not available right now.');
   const premium=membership?.premiumAccess===true;
   if(premium||!actor||verificationFailure?.identity!==identity())verificationFailure=null;
   if(!actor||nativeRestoreFailure?.identity!==identity())nativeRestoreFailure=null;
   // A successful membership read does not explain an earlier native sync
   // failure, even when that membership already provides Premium.
   const failureMessage=nativeRestoreFailure?.message||verificationFailure?.message;
   const provider=membership?.provider||membership?.subscription?.provider||(membership?.householdRole==='partner'?'household':premium?'paddle':null);
   emit({...catalog,authenticated:!!actor,premiumAccess:premium,membershipState:premium?'premium':actor?'free':'signed_out',provider,subscription:membership?.subscription||null,beta:provider==='testflight_beta'?membership?.beta||null:null,phase:failureMessage?'error':'ready',message:failureMessage||(premium?(provider==='testflight_beta'?'Your complimentary Premium access is active without a subscription charge.':provider==='apple'?'Your Apple Premium subscription is available.':'Your existing Premium membership is available. You do not need another subscription.'):(
    !catalog.available?(catalog.availabilityMessage||'Apple subscription options remain below. Try a plan or refresh prices. Your Free recipes remain available.'):requestedProductId?(actor?'Review the subscription options below, then choose a plan to continue your Apple purchase.':'Sign in or create your BasketBoss account, then choose a plan to continue your Apple purchase.'):actor?'Choose a plan to subscribe with Apple, or restore an existing Apple purchase.':'Use 100 recipes free. Sign in or create your BasketBoss account before subscribing.'))});
  }catch(error){if(!destroyed&&revision===viewRevision&&epoch===generation&&(!actor||current(actor)))emit({...catalog,available:false,authenticated:!!actor,premiumAccess:false,membershipState:actor?'unavailable':'signed_out',provider:null,subscription:null,beta:null,phase:'error',message:nativeRestoreFailure?.message||verificationFailure?.message||error.message||'Membership could not be checked. Try again.'});}
  return {...state};
 }
 function notifyMembership(){if(win?.dispatchEvent&&win?.Event)win.dispatchEvent(new win.Event('basketboss:apple-membership-updated'));}
 async function verify(transaction,actor){
  const actorIdentity=identity();
  try{
   requireCurrent(actor);
   if(!transaction||typeof transaction.id!=='string'||typeof transaction.signedTransactionInfo!=='string'||!PRODUCTS.includes(transaction.productId))throw Error('Apple returned a purchase that could not be verified.');
   const result=await request('/api/apple/verify',{pin:actor,body:{transactionId:transaction.id,signedTransactionInfo:transaction.signedTransactionInfo}});
   requireCurrent(actor);
   if(result.ok!==true||result.acknowledged!==true)throw Error('The purchase is awaiting server confirmation. Use Restore Purchases to retry.');
   // An expired/refunded transaction can be acknowledged without active Premium.
   // Finishing is strictly after server acknowledgement and account revalidation.
   await plugin.finishTransaction({transactionId:transaction.id,serverVerified:true});
   requireCurrent(actor);
   verificationFailure=null;
   notifyMembership();
   return result;
  }catch(error){retainVerificationFailure(actor,purchaseErrorMessage(error),actorIdentity);throw error;}
 }
 async function run(operation,{explicit=true}={}){
  if(busy)return {ok:false,reason:'busy'};
  const actor=pin();
  if(!actor){emit({authenticated:false,phase:'error',message:'Sign in to your BasketBoss account to continue.'});return {ok:false,reason:'signin_required'};}
  if(isDeleting())return {ok:false,reason:'account_deleting'};
  if(explicit)nativeRestoreFailure=null;
  busy=true;emit({phase:'busy',message:'Please wait…'});
  try{return await operation(actor);}
  catch(error){const message=purchaseErrorMessage(error);if(current(actor))emit({phase:'error',message});return {ok:false,reason:error.code||'purchase_error',error:message};}
  finally{busy=false;if(!destroyed){emit({});if(queued.size)void drain();}}
 }
 async function subscribe(productId){return run(async actor=>{
  if(!PRODUCTS.includes(productId))throw Error('This subscription is not available.');
  verificationFailure=null;
  await refresh();requireCurrent(actor);
  if(state.premiumAccess&&!state.sandboxPurchaseAllowed){emit({phase:'ready',message:'Your existing Premium membership already covers this account. No additional Apple subscription is needed. Use Manage or Restore Purchases for an existing Apple plan.'});return {ok:false,reason:'already_premium'};}
  // Missing catalogue metadata must not remove the real StoreKit attempt. The
  // server authorizes the account and the native bridge resolves the fixed ID
  // again before showing Apple's payment sheet; no price is invented locally.
  if(!state.purchaseServiceReady)throw Error(state.availabilityMessage||'Apple purchase verification is not ready. Refresh membership and prices, then try again.');
  if(state.invalidProductIds?.includes(productId))throw Error('Apple returned an unexpected billing period for this subscription. Refresh prices after its setup is checked.');
  const testPurchase=state.premiumAccess&&state.sandboxPurchaseAllowed===true;
  const context=await request('/api/apple/purchase-context',{pin:actor,body:{productId,...(testPurchase?{testPurchase:true}:{})}});requireCurrent(actor);
  if(testPurchase&&(context.environment!=='Sandbox'||context.sandboxPurchaseAllowed!==true))throw Error('Sandbox purchase testing could not be authorized for this account.');
  if(context.canPurchase!==true||!UUID.test(context.appAccountToken||'')||!context.productIds?.includes(productId))throw Error('Your account is not ready for an Apple purchase. Refresh your membership and try again.');
  emit({message:'Checking this subscription with Apple…'});
  const purchase=await plugin.purchase({productId,appAccountToken:context.appAccountToken});
  requireCurrent(actor);
  if(purchase.status==='cancelled'){emit({phase:'ready',message:'Purchase cancelled. Your access has not changed.'});return {ok:true,status:'cancelled'};}
  if(purchase.status==='pending'){emit({phase:'ready',message:'Your purchase is pending Apple approval. Premium will become available after it is approved and verified.'});return {ok:true,status:'pending'};}
  if(!['purchased','alreadyOwned'].includes(purchase.status))throw Error('Apple could not complete this purchase. Try again later.');
  const result=await verify(purchase.transaction,actor);
  await refresh();requireCurrent(actor);
  if(result.premiumAccess!==true)emit({phase:'ready',message:'Your Apple purchase was checked. It does not currently provide active Premium access.'});
  return {ok:true,status:'verified',premiumAccess:result.premiumAccess===true};
 });}
 async function restore(){return run(async actor=>{
  verificationFailure=null;
  const actorIdentity=identity();
  // Confirm that the verification service is ready before opening Apple restore.
  const config=await request('/api/apple/config',{pin:actor,authenticated:false});requireCurrent(actor);
  if(config.available!==true)throw Error('Apple purchase verification is unavailable. Try Restore Purchases again later.');
  emit({message:'Restoring purchases from your Apple Account…'});
  let restored;
  try{restored=await plugin.restorePurchases();}
  catch(error){
   requireCurrent(actor);
   const message=restoreErrorMessage(error);
   if(identity()===actorIdentity)nativeRestoreFailure={identity:actorIdentity,message};
   throw Object.assign(Error(message),{code:error?.code==='BB_APPLE_RESTORE_NETWORK'?'BB_APPLE_RESTORE_NETWORK':'BB_APPLE_RESTORE'});
  }
  requireCurrent(actor);
  if(restored?.status==='cancelled'){emit({phase:'ready',message:'Restore cancelled. Your access has not changed.'});return {ok:true,status:'cancelled'};}
  const transactions=Array.isArray(restored?.transactions)?restored.transactions:[];
  let active=false;
  for(const transaction of transactions){const result=await verify(transaction,actor);active=active||result.premiumAccess===true;}
  await refresh();requireCurrent(actor);
  emit({phase:'ready',message:active?'Your Apple Premium subscription has been restored.':state.premiumAccess?'Your existing Premium membership is available.':'No active Apple subscription was found for this BasketBoss account. Check that you are signed in to the account used for the original purchase.'});
  return {ok:true,restored:transactions.length,premiumAccess:active||state.premiumAccess};
 });}
 async function manage(){return run(async actor=>{requireCurrent(actor);if(state.provider!=='apple')throw Error('This account does not have an Apple subscription to manage.');await plugin.manageSubscriptions();requireCurrent(actor);await refresh();return {ok:true};});}
 async function claimBeta(){return run(async actor=>{
  if(win?.BBNative?.isNative!==true||win.BBNative.platform!=='ios')throw Error('TestFlight Beta Premium is available in the iPhone or iPad app from TestFlight.');
  if(typeof plugin?.getAppTransaction!=='function')throw Error('Update BasketBoss to the latest TestFlight build, then try unlocking Beta Premium again.');
  emit({message:'Verifying your TestFlight app…'});
  let proof;
  try{proof=await plugin.getAppTransaction();}
  catch(error){
   requireCurrent(actor);
   throw Error(['UNIMPLEMENTED','UNAVAILABLE'].includes(error?.code)?'Update BasketBoss to the latest TestFlight build, then try unlocking Beta Premium again.':'Your beta app could not be verified. Open the latest BasketBoss build from TestFlight, then try again.');
  }
  requireCurrent(actor);
  const signed=proof?.signedAppTransaction;
  if(typeof signed!=='string'||signed.length<50||signed.length>65536||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(signed))throw Error('Your beta app could not be verified. Update BasketBoss through TestFlight, then try again.');
  const result=await request('/api/apple/testflight-beta',{pin:actor,body:{signedAppTransaction:signed}});requireCurrent(actor);
  if(result.ok!==true)throw Error('Beta Premium could not be activated. Refresh membership, then try again.');
  // A successful claim is not a local entitlement. Re-read the same account's
  // authoritative status before changing presentation or exposing Premium UI.
  // StoreKit catalogue loading must never delay a purchase-free beta claim.
  await refresh({membershipOnly:true});requireCurrent(actor);
  if(state.premiumAccess!==true)throw Error('Beta access was checked, but Premium could not be confirmed. Refresh membership to retry.');
  await win.BasketBossVerifiedPremium?.refresh?.(true);requireCurrent(actor);
  notifyMembership();
  return {ok:true,premiumAccess:true,provider:state.provider};
 });}
 async function drain(){
  if(busy||destroyed||isDeleting()||!pin()||!queued.size)return;
  await run(async actor=>{
   const actorIdentity=identity();let failedMessage=null;
   for(const [id,transaction]of queued){queued.delete(id);try{await verify(transaction,actor);}catch(error){if(!current(actor))throw error;failedMessage=purchaseErrorMessage(error);emit({phase:'error',message:failedMessage});}}
   // A later acknowledged transaction must not hide another failed delivery.
   // Refresh can clear this warning only when the server confirms Premium.
   if(failedMessage)retainVerificationFailure(actor,failedMessage,actorIdentity);
   await refresh();return {ok:true};
  },{explicit:false});
 }
 function enqueue(event){for(const transaction of event?.transactions||[])if(transaction?.id)queued.set(transaction.id,transaction);if(!busy&&queued.size)void drain();}
 function receivePurchaseIntent(event){
  if(destroyed||isDeleting()||!PRODUCTS.includes(event?.productId))return;
  requestedProductId=event.productId;emit({requestedProductId});
  // Navigation is only to a bundled page. The intent cannot select a price,
  // grant access, or call subscribe; the user must choose a currently eligible
  // plan after the same authenticated server checks as an in-app purchase.
  try{
   const currentURL=new URL(win?.location?.href),target=new URL(nativeMembershipURL(currentURL.href));
   if(currentURL.pathname!==target.pathname){target.searchParams.set('appleIntent',requestedProductId);win.location.assign(target.href);return;}
  }catch{}
  void refresh();
 }
 function invalidate(event){const next=identity();if(event?.type==='basketboss:session-changed'&&next===lastIdentity&&!isDeleting()){void refresh();return;}lastIdentity=next;verificationFailure=null;nativeRestoreFailure=null;generation++;viewRevision++;for(const request of requests)request.abort();queued.clear();emit({authenticated:!!pin(),premiumAccess:false,sandboxPurchaseAllowed:false,appleEnvironment:null,membershipState:pin()?'checking':'signed_out',provider:null,subscription:null,beta:null,phase:'loading',message:'Checking Apple subscriptions…'});void refresh().then(recoverPending);}
 const accountEvents=['basketboss:session-changed','basketboss:account-deletion-started','basketboss:account-deletion-cancelled','basketboss:account-deletion-deleted'];
 for(const event of accountEvents)win?.addEventListener?.(event,invalidate);
 const onStorage=event=>{if(event.key==='basketboss_cloud_session_v1')invalidate(event);};
 const onFocus=()=>{void refresh();};
 win?.addEventListener?.('storage',onStorage);win?.addEventListener?.('focus',onFocus);
 if(plugin?.addListener)for(const [name,listener]of [['purchaseIntentReceived',receivePurchaseIntent],['transactionsUpdated',enqueue]])Promise.resolve(plugin.addListener(name,listener)).then(handle=>{if(destroyed)void handle?.remove?.();else listenerHandles.push(handle);}).catch(()=>{});
 async function recoverPending(){const actor=pin();if(!destroyed&&actor&&!isDeleting()&&plugin?.getPendingTransactions){try{const result=await plugin.getPendingTransactions();if(current(actor))enqueue(result);}catch{}}}
 const ready=refresh().then(recoverPending);
 return {ready,subscribe,restore,manage,claimBeta,refresh,loadProducts,subscribeState(listener){listeners.add(listener);listener({...state,products:[...state.products]});return ()=>listeners.delete(listener);},get state(){return {...state,products:[...state.products]};},destroy(){destroyed=true;verificationFailure=null;nativeRestoreFailure=null;generation++;for(const timer of productTimers)clearTimeout(timer);productTimers.clear();for(const request of requests)request.abort();requests.clear();queued.clear();listeners.clear();for(const handle of listenerHandles)void handle?.remove?.();for(const event of accountEvents)win?.removeEventListener?.(event,invalidate);win?.removeEventListener?.('storage',onStorage);win?.removeEventListener?.('focus',onFocus);}};
}
