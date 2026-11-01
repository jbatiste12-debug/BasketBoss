// Native StoreKit bridge controller. Only the server can grant Premium access.
import {nativeMembershipURL} from './routing.mjs';
const MONTHLY='uk.co.basketboss.premium.monthly',ANNUAL='uk.co.basketboss.premium.annual';
const PRODUCTS=Object.freeze([MONTHLY,ANNUAL]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accountChanged=()=>Object.assign(Error('Your account changed. Sign in to the account used for this purchase, then restore it.'),{code:'account_changed'});
export function installNativeApplePurchases({plugin,apiURL,readSession,fetch:perform=globalThis.fetch,window:win=globalThis.window,isDeleting=()=>false}){
 const url=value=>typeof apiURL==='function'?apiURL(value):String(apiURL||'')+value;
 let destroyed=false,generation=0,viewRevision=0,busy=false;
 const listenerHandles=[];
 const identity=()=>{const s=readSession();return JSON.stringify([s?.user?.id||null,s?.access_token||null,s?.expires_at||null]);};
 let lastIdentity=identity();
 const listeners=new Set(),requests=new Set(),queued=new Map();
 let requestedProductId=null;
 try{const requested=new URL(win?.location?.href).searchParams.get('appleIntent');if(PRODUCTS.includes(requested))requestedProductId=requested;}catch{}
 let state={available:false,authenticated:false,premiumAccess:false,provider:null,subscription:null,products:[],requestedProductId,busy:false,phase:'loading',message:'Checking Apple subscriptions…'};
 function emit(change){if(destroyed)return;state={...state,...change,busy};for(const listener of listeners)listener({...state,products:[...state.products]});}
 function pin(){const s=readSession();return s?.access_token&&s?.user?.id&&Number(s.expires_at)*1000>Date.now()+5000?{token:s.access_token,user:s.user.id,generation}:null;}
 function current(p){const now=pin();return !destroyed&&!isDeleting()&&p&&now&&now.generation===p.generation&&now.token===p.token&&now.user===p.user;}
 function requireCurrent(p){if(!current(p))throw accountChanged();}
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
 async function loadProducts(){
  const config=await request('/api/apple/config',{pin:pin(),authenticated:false});
  if(config.available!==true||!Array.isArray(config.productIds)||PRODUCTS.some(id=>!config.productIds.includes(id)))return {available:false,products:[]};
  // The web-only Founding Member offer cannot become an Apple plan through
  // stale server configuration or an unexpected StoreKit catalogue entry.
  const result=await plugin.getProducts({productIds:[...PRODUCTS]});
  const products=PRODUCTS.map(id=>(result.products||[]).find(product=>product.id===id)).filter(product=>product&&typeof product.displayPrice==='string'&&product.displayPrice.length>0&&product.displayPrice.length<80&&Number(product.subscriptionPeriod?.value)===1&&product.subscriptionPeriod?.unit===(product.id===ANNUAL?'year':'month'));
  return {available:PRODUCTS.every(id=>products.some(product=>product.id===id)),products};
 }
 async function refresh(){
  if(destroyed)return {...state};
  const revision=++viewRevision,actor=pin(),epoch=generation;
  if(isDeleting()){emit({available:false,authenticated:!!actor,premiumAccess:false,phase:'paused',message:'Account deletion is in progress. Purchases are paused.'});return {...state};}
  emit({authenticated:!!actor});
  try{
   const [catalog,membership]=await Promise.all([loadProducts().catch(()=>({available:false,products:[]})),actor?request('/api/subscription/status',{pin:actor}):Promise.resolve(null)]);
   if(destroyed||revision!==viewRevision||epoch!==generation||isDeleting()||(actor&&!current(actor)))return {...state};
   if(actor&&membership?.authenticated!==true)throw Error('Sign in again to check your membership.');
   const premium=membership?.premiumAccess===true;
   const provider=membership?.provider||membership?.subscription?.provider||(membership?.householdRole==='partner'?'household':premium?'paddle':null);
   emit({...catalog,authenticated:!!actor,premiumAccess:premium,provider,subscription:membership?.subscription||null,phase:'ready',message:premium?(provider==='apple'?'Your Apple Premium subscription is available.':'Your existing Premium membership is available. You do not need another subscription.'):
    !catalog.available?'Apple subscriptions are not available right now. Your Free recipes remain available.':requestedProductId?(actor?'Review the subscription options below, then choose a plan to continue your Apple purchase.':'Sign in or create your BasketBoss account, then choose a plan to continue your Apple purchase.'):actor?'Choose a plan to subscribe with Apple, or restore an existing Apple purchase.':'Use 100 recipes free. Sign in or create your BasketBoss account before subscribing.'});
  }catch(error){if(!destroyed&&revision===viewRevision&&epoch===generation&&(!actor||current(actor)))emit({available:false,authenticated:!!actor,premiumAccess:false,provider:null,subscription:null,phase:'error',message:error.message||'Membership could not be checked. Try again.'});}
  return {...state};
 }
 function notifyMembership(){if(win?.dispatchEvent&&win?.Event)win.dispatchEvent(new win.Event('basketboss:apple-membership-updated'));}
 async function verify(transaction,actor){
  requireCurrent(actor);
  if(!transaction||typeof transaction.id!=='string'||typeof transaction.signedTransactionInfo!=='string'||!PRODUCTS.includes(transaction.productId))throw Error('Apple returned a purchase that could not be verified.');
  const result=await request('/api/apple/verify',{pin:actor,body:{transactionId:transaction.id,signedTransactionInfo:transaction.signedTransactionInfo}});
  requireCurrent(actor);
  if(result.ok!==true||result.acknowledged!==true)throw Error('The purchase is awaiting server confirmation. Use Restore Purchases to retry.');
  // An expired/refunded transaction can be acknowledged without active Premium.
  // Finishing is strictly after server acknowledgement and account revalidation.
  await plugin.finishTransaction({transactionId:transaction.id,serverVerified:true});
  requireCurrent(actor);
  notifyMembership();
  return result;
 }
 async function run(operation){
  if(busy)return {ok:false,reason:'busy'};
  const actor=pin();
  if(!actor){emit({authenticated:false,phase:'error',message:'Sign in to your BasketBoss account before purchasing or restoring.'});return {ok:false,reason:'signin_required'};}
  if(isDeleting())return {ok:false,reason:'account_deleting'};
  busy=true;emit({phase:'busy',message:'Please wait…'});
  try{return await operation(actor);}
  catch(error){if(current(actor))emit({phase:'error',message:error.message||'Apple purchases are temporarily unavailable. Try again.'});return {ok:false,reason:error.code||'purchase_error',error:error.message};}
  finally{busy=false;if(!destroyed){emit({});if(queued.size)void drain();}}
 }
 async function subscribe(productId){return run(async actor=>{
  if(!PRODUCTS.includes(productId))throw Error('This subscription is not available.');
  await refresh();requireCurrent(actor);
  if(state.premiumAccess){emit({phase:'ready',message:'Your existing Premium membership is available. You do not need another subscription.'});return {ok:false,reason:'already_premium'};}
  if(!state.available||!state.products.some(product=>product.id===productId))throw Error('This Apple subscription is not available right now. Please refresh your membership and try again.');
  // The server checks current web/household/Apple access immediately before sale.
  const context=await request('/api/apple/purchase-context',{pin:actor,body:{productId}});requireCurrent(actor);
  if(context.canPurchase!==true||!UUID.test(context.appAccountToken||'')||!context.productIds?.includes(productId))throw Error('Your account is not ready for an Apple purchase. Refresh your membership and try again.');
  emit({message:'Confirm your subscription in Apple’s purchase sheet.'});
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
  // Confirm that the verification service is ready before opening Apple restore.
  const config=await request('/api/apple/config',{pin:actor,authenticated:false});requireCurrent(actor);
  if(config.available!==true)throw Error('Apple purchase verification is unavailable. Try Restore Purchases again later.');
  emit({message:'Restoring purchases from your Apple Account…'});
  const restored=await plugin.restorePurchases();requireCurrent(actor);
  const transactions=Array.isArray(restored.transactions)?restored.transactions:[];
  let active=false;
  for(const transaction of transactions){const result=await verify(transaction,actor);active=active||result.premiumAccess===true;}
  await refresh();requireCurrent(actor);
  emit({phase:'ready',message:active?'Your Apple Premium subscription has been restored.':state.premiumAccess?'Your existing Premium membership is available.':'No active Apple subscription was found for this BasketBoss account. Check that you are signed in to the account used for the original purchase.'});
  return {ok:true,restored:transactions.length,premiumAccess:active||state.premiumAccess};
 });}
 async function manage(){return run(async actor=>{requireCurrent(actor);if(state.provider!=='apple')throw Error('This account does not have an Apple subscription to manage.');await plugin.manageSubscriptions();requireCurrent(actor);await refresh();return {ok:true};});}
 async function drain(){
  if(busy||destroyed||isDeleting()||!pin()||!queued.size)return;
  await run(async actor=>{
   for(const [id,transaction]of queued){queued.delete(id);try{await verify(transaction,actor);}catch(error){if(!current(actor))throw error;emit({phase:'error',message:'An Apple purchase needs verification. Use Restore Purchases with the account used for the purchase.'});}}
   await refresh();return {ok:true};
  });
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
 function invalidate(event){const next=identity();if(event?.type==='basketboss:session-changed'&&next===lastIdentity&&!isDeleting()){void refresh();return;}lastIdentity=next;generation++;viewRevision++;for(const request of requests)request.abort();queued.clear();emit({authenticated:!!pin(),premiumAccess:false,provider:null,subscription:null});void refresh().then(recoverPending);}
 const accountEvents=['basketboss:session-changed','basketboss:account-deletion-started','basketboss:account-deletion-cancelled','basketboss:account-deletion-deleted'];
 for(const event of accountEvents)win?.addEventListener?.(event,invalidate);
 const onStorage=event=>{if(event.key==='basketboss_cloud_session_v1')invalidate(event);};
 const onFocus=()=>{void refresh();};
 win?.addEventListener?.('storage',onStorage);win?.addEventListener?.('focus',onFocus);
 if(plugin?.addListener)for(const [name,listener]of [['purchaseIntentReceived',receivePurchaseIntent],['transactionsUpdated',enqueue]])Promise.resolve(plugin.addListener(name,listener)).then(handle=>{if(destroyed)void handle?.remove?.();else listenerHandles.push(handle);}).catch(()=>{});
 async function recoverPending(){const actor=pin();if(!destroyed&&actor&&!isDeleting()&&plugin?.getPendingTransactions){try{const result=await plugin.getPendingTransactions();if(current(actor))enqueue(result);}catch{}}}
 const ready=refresh().then(recoverPending);
 return {ready,subscribe,restore,manage,refresh,loadProducts,subscribeState(listener){listeners.add(listener);listener({...state,products:[...state.products]});return ()=>listeners.delete(listener);},get state(){return {...state,products:[...state.products]};},destroy(){destroyed=true;generation++;for(const request of requests)request.abort();requests.clear();queued.clear();listeners.clear();for(const handle of listenerHandles)void handle?.remove?.();for(const event of accountEvents)win?.removeEventListener?.(event,invalidate);win?.removeEventListener?.('storage',onStorage);win?.removeEventListener?.('focus',onFocus);}};
}
