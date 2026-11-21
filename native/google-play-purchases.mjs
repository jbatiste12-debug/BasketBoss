// Android Play Billing is a source of purchase proof, never a local entitlement.
// Only authenticated BasketBoss verification and membership responses grant access.
const PACKAGE='uk.co.basketboss.app';
const PERIOD=/^P([1-9]\d{0,2})(D|W|M|Y)$/;
const changed=()=>Object.assign(Error('Your account changed. Sign in to the account used for this purchase, then restore purchases.'),{code:'account_changed'});
const errorText=error=>error?.code==='account_changed'?error.message:error?.status===409&&error?.code==='already_premium'?'Your account already has Premium. You do not need another subscription.':error?.status===401?'Sign in again to continue.':error?.code==='BB_PLAY_TIMEOUT'||error?.code==='play_timeout'?'Google Play did not respond in time. Check your connection and refresh prices.':'Google Play purchases could not be checked. Try again when you are connected. If payment completed, use Restore purchases to retry verification.';

function periodText(value,count=1){
 const match=PERIOD.exec(value||'');if(!match)return null;
 const amount=Number(match[1])*count,unit={D:'day',W:'week',M:'month',Y:'year'}[match[2]];
 return amount+' '+unit+(amount===1?'':'s');
}
function phaseValue(phase){
 if(!phase||typeof phase.formattedPrice!=='string'||!phase.formattedPrice.trim()||phase.formattedPrice.length>80||/[\u0000-\u001f]/.test(phase.formattedPrice)||!/^[A-Z]{3}$/.test(phase.priceCurrencyCode||'')||!/^\d{1,16}$/.test(String(phase.priceAmountMicros))||!PERIOD.test(phase.billingPeriod||''))return null;
 return {formattedPrice:phase.formattedPrice,priceCurrencyCode:phase.priceCurrencyCode,priceAmountMicros:String(phase.priceAmountMicros),billingPeriod:phase.billingPeriod,recurrenceMode:Number(phase.recurrenceMode),billingCycleCount:Number(phase.billingCycleCount)};
}
// A native offer exists only if Google returned it as eligible for this account.
// The server additionally limits which base plans and offers this release sells.
export function googlePlayOffers(config,products){
 if(!validConfig(config)||!Array.isArray(products))return [];
 const product=products.find(item=>item?.id===config.productId),offers=[];
 for(const plan of config.plans){
  for(const raw of Array.isArray(product?.subscriptionOfferDetails)?product.subscriptionOfferDetails:[]){
   const offerId=raw.offerId;
   if(raw.basePlanId!==plan.basePlanId||(offerId!==null&&!plan.offerIds.includes(offerId))||typeof raw.offerToken!=='string'||!raw.offerToken||raw.offerToken.length>4096)continue;
   const phases=Array.isArray(raw.pricingPhases)&&raw.pricingPhases.length>0&&raw.pricingPhases.length<=5?raw.pricingPhases.map(phaseValue):[];
   if(!phases.length||phases.some(phase=>!phase)||phases.length>1&&offerId===null)continue;
   const last=phases.at(-1),period=plan.plan==='monthly'?'P1M':'P1Y';
   if(last.billingPeriod!==period||last.recurrenceMode!==1||Number(last.priceAmountMicros)<=0||phases.some(phase=>phase.priceCurrencyCode!==last.priceCurrencyCode)||phases.slice(0,-1).some(phase=>phase.recurrenceMode!==2||!Number.isInteger(phase.billingCycleCount)||phase.billingCycleCount<1||phase.billingCycleCount>100))continue;
   const renewal=last.formattedPrice+' / '+(plan.plan==='monthly'?'month':'year');
   const introductory=phases.slice(0,-1).map(phase=>(Number(phase.priceAmountMicros)===0?'Free':phase.formattedPrice+' every '+periodText(phase.billingPeriod))+' for '+periodText(phase.billingPeriod,phase.billingCycleCount));
   const hasTrial=phases.slice(0,-1).some(phase=>Number(phase.priceAmountMicros)===0);
   offers.push({key:JSON.stringify([config.productId,plan.basePlanId,offerId]),productId:config.productId,plan:plan.plan,basePlanId:plan.basePlanId,offerId,offerToken:raw.offerToken,pricingPhases:phases,hasTrial,title:plan.plan==='monthly'?'Monthly Premium':'Annual Premium',price:[...introductory,renewal].join(', then ')});
  }
 }
 return offers.filter((offer,index)=>offers.findIndex(item=>item.key===offer.key)===index);
}
function validConfig(value){
 return value?.available===true&&value.provider==='google_play'&&value.packageName===PACKAGE&&['test','live'].includes(value.mode)&&typeof value.productId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._]{0,199}$/.test(value.productId)&&Array.isArray(value.productIds)&&value.productIds.length===1&&value.productIds[0]===value.productId&&Array.isArray(value.plans)&&value.plans.length>0&&value.plans.length<=2&&value.plans.every(plan=>['monthly','annual'].includes(plan?.plan)&&typeof plan.basePlanId==='string'&&/^[a-z0-9][a-z0-9-]{0,62}$/.test(plan.basePlanId)&&Array.isArray(plan.offerIds)&&plan.offerIds.every(id=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)))&&new Set(value.plans.map(plan=>plan.plan)).size===value.plans.length;
}
export function installAndroidGooglePlayPurchases({plugin,readSession,apiURL,fetch:perform=globalThis.fetch,window:win=globalThis.window,isDeleting=()=>false,productLoadTimeoutMs=15000,requestTimeoutMs=15000}={}){
 let destroyed=false,generation=0,revision=0,operation=null,config=null,listenerHandle=null,reconcileQueued=false;
 const listeners=new Set(),requests=new Set(),timers=new Set(),cancellations=new Set(),verified=new Set(),verifying=new Map();
 const url=path=>typeof apiURL==='function'?apiURL(path):String(apiURL||'')+path;
 const identity=()=>{try{const value=readSession();return typeof value?.access_token==='string'&&value.access_token&&typeof value.user?.id==='string'&&value.user.id&&Number.isFinite(Number(value.expires_at))&&Number(value.expires_at)*1000>Date.now()+5000?{actor:value.user.id,token:value.access_token}:null;}catch{return null;}};
 const identityKey=()=>{const actor=identity();return actor?JSON.stringify([actor.actor,actor.token]):null;};
 let previousIdentity=identityKey();
 let state={available:false,authenticated:false,premiumAccess:false,provider:null,subscription:null,membershipState:'signed_out',offers:[],busy:false,phase:'loading',productLoadState:'unavailable',availabilityMessage:'',message:'Checking your BasketBoss membership…'};
 const snapshot=()=>({...state,offers:state.offers.map(offer=>({...offer,pricingPhases:offer.pricingPhases.map(phase=>({...phase}))}))});
 const emit=change=>{if(destroyed)return;state={...state,...change,busy:!!operation};for(const listener of listeners)listener(snapshot());};
 const pin=()=>{const actor=identity();return actor?{...actor,generation}:null;};
 const current=actor=>{const now=identity();return !destroyed&&!isDeleting()&&actor&&now&&actor.generation===generation&&actor.actor===now.actor&&actor.token===now.token;};
 const requireCurrent=actor=>{if(!current(actor))throw changed();};
 function invalidate(){
  generation++;revision++;config=null;operation=null;reconcileQueued=false;verified.clear();verifying.clear();
  for(const request of requests)request.abort();requests.clear();
  for(const cancel of cancellations)cancel();cancellations.clear();
  emit({available:false,authenticated:false,premiumAccess:false,provider:null,subscription:null,offers:[],membershipState:isDeleting()?'unavailable':'signed_out',phase:isDeleting()?'paused':'loading',availabilityMessage:'',productLoadState:'unavailable',message:isDeleting()?'Account changes are paused during deletion.':'Sign in to use your BasketBoss account and load Google Play plans.'});
 }
 function syncIdentity(){const next=identityKey();if(previousIdentity!==next){previousIdentity=next;invalidate();}}
 async function deadline(action,milliseconds){
  let timer,cancel;
  try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{cancel=()=>reject(changed());cancellations.add(cancel);timer=setTimeout(()=>reject(Object.assign(Error('Google Play timed out.'),{code:'play_timeout'})),milliseconds);timers.add(timer);})]);}
  finally{clearTimeout(timer);timers.delete(timer);cancellations.delete(cancel);}
 }
 async function request(path,actor,body){
  requireCurrent(actor);const controller=new AbortController();requests.add(controller);
  try{
   const response=await deadline(()=>perform(url(path),{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+actor.token,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',mode:'cors',redirect:'error',cache:'no-store',signal:controller.signal}),requestTimeoutMs);
   requireCurrent(actor);const data=await deadline(()=>response.json(),requestTimeoutMs);requireCurrent(actor);
   if(!response.ok)throw Object.assign(Error('Purchase service unavailable.'),{status:response.status,code:data?.reason||data?.code||data?.error});
   return data;
  }finally{controller.abort();requests.delete(controller);}
 }
 async function catalogue(actor){
  const data=await request('/api/google-play/config',actor);requireCurrent(actor);
  if(!validConfig(data))return {config:null,available:false,offers:[],productLoadState:'unavailable',availabilityMessage:'Google Play subscriptions are not available yet. Your Free recipes and existing membership remain available.'};
  let result;
  try{result=await deadline(()=>plugin.getProducts({productIds:[...data.productIds]}),productLoadTimeoutMs);requireCurrent(actor);}
  catch(error){requireCurrent(actor);return {config:data,available:false,offers:[],productLoadState:error?.code==='play_timeout'?'timeout':'error',availabilityMessage:errorText(error)};}
  const offers=googlePlayOffers(data,result?.products);
  return {config:data,available:offers.length>0,offers,productLoadState:offers.length?'ready':'empty',availabilityMessage:offers.length?'':'Google Play returned no eligible subscription plans. Refresh prices after the Play subscription setup is ready.'};
 }
 const validMembership=data=>data?.authenticated===true&&typeof data.premiumAccess==='boolean'&&(data.premiumAccess!==true||(['owner','premium'].includes(data.tier)&&['live','sandbox'].includes(data.mode)));
 async function refresh({restore=true,loadProducts=true}={}){
  if(destroyed)return snapshot();syncIdentity();
  if(isDeleting()){invalidate();return snapshot();}
  const actor=pin(),stamp=++revision;
  if(!actor){emit({authenticated:false,premiumAccess:false,provider:null,subscription:null,available:false,offers:[],membershipState:'signed_out',phase:'ready',message:'Sign in to use your BasketBoss account and load Google Play plans.'});return snapshot();}
  emit({authenticated:true,membershipState:'checking',...(loadProducts?{available:false,productLoadState:'loading'}:{}),phase:operation?'busy':'loading',message:'Checking your membership…'});
  const results=await Promise.allSettled([request('/api/subscription/status',actor),loadProducts?catalogue(actor):Promise.resolve({config,available:state.available,offers:state.offers,productLoadState:state.productLoadState,availabilityMessage:state.availabilityMessage})]);
  if(!current(actor)||stamp!==revision)return snapshot();
  const catalogueResult=results[1],catalog=catalogueResult.status==='fulfilled'?catalogueResult.value:{config:null,available:false,offers:[],productLoadState:catalogueResult.reason?.code==='play_timeout'?'timeout':'error',availabilityMessage:errorText(catalogueResult.reason)};
  config=catalog.config;
  const {config:ignored,...presentation}=catalog;
  if(results[0].status==='rejected'||!validMembership(results[0].value)){
   emit({...presentation,available:false,premiumAccess:false,provider:null,subscription:null,membershipState:results[0].reason?.status===401?'signed_out':'unavailable',phase:'error',message:'Membership could not be checked. Sign in again or try when you are connected.'});return snapshot();
  }
  const membership=results[0].value,premium=membership.premiumAccess,provider=membership.provider||membership.subscription?.provider||null;
  emit({...presentation,authenticated:true,premiumAccess:premium,provider,subscription:membership.subscription||null,membershipState:premium?'premium':'free',phase:operation?'busy':'ready',message:premium?(provider==='google_play'?'Your Google Play Premium membership is available. Manage or cancel it in Google Play.':'Your existing Premium membership is available. You do not need another subscription.'):'Your account currently has Free access. '+(catalog.available?'Choose a Google Play plan below.':catalog.availabilityMessage)});
  if(restore&&config&&!operation)await restorePurchases({automatic:true});
  return snapshot();
 }
 async function verify(purchase,actor){
  requireCurrent(actor);
  const token=purchase?.purchaseToken,productId=purchase?.productId||purchase?.products?.[0];
  if(purchase?.state==='pending')return {pending:true};
  if(purchase?.state!=='purchased'||typeof token!=='string'||!token||token.length>8192||productId!==config?.productId)throw Error('invalid_purchase');
  if(verified.has(token))return {duplicate:true,verified:true};
  if(verifying.has(token))return verifying.get(token);
  const pending=(async()=>{
   const result=await request('/api/google-play/verify',actor,{purchaseToken:token,productId});requireCurrent(actor);
   if(result?.ok!==true||result.acknowledged!==true||result.provider!=='google_play'||typeof result.premiumAccess!=='boolean')throw Error('verification_unavailable');
   verified.add(token);return {verified:true,premiumAccess:result.premiumAccess};
  })();
  verifying.set(token,pending);
  try{return await pending;}finally{if(current(actor)&&verifying.get(token)===pending)verifying.delete(token);}
 }
 async function verifiedRefresh(actor,proofVerified){
  await refresh({restore:false,loadProducts:false});requireCurrent(actor);
  if(!['free','premium'].includes(state.membershipState))throw Error('membership_unavailable');
  if(proofVerified){await win.BasketBossVerifiedPremium?.refresh?.(true);requireCurrent(actor);}
 }
 async function run(action){
  if(destroyed||isDeleting())return {ok:false,reason:'account_deleting'};
  syncIdentity();if(operation)return {ok:false,reason:'busy'};
  const actor=pin();
  if(!actor){emit({authenticated:false,membershipState:'signed_out',phase:'ready',message:'Sign in to your BasketBoss account to continue.'});return {ok:false,reason:'signin_required'};}
  const running={actor};operation=running;emit({phase:'busy',message:'Checking Google Play…'});
  try{return await action(actor);}
  catch(error){if(current(actor))emit({phase:'error',message:errorText(error)});return {ok:false,reason:error?.code||'purchase_unavailable'};}
  finally{if(operation===running){operation=null;emit({});if(reconcileQueued&&current(actor)){reconcileQueued=false;void restorePurchases({automatic:true});}}}
 }
 async function subscribe(key){return run(async actor=>{
  const selected=state.offers.find(offer=>offer.key===key);if(!selected)throw Error('offer_unavailable');
  await refresh({restore:false});requireCurrent(actor);
  if(state.premiumAccess){emit({phase:'ready',message:'Your existing membership covers Premium. You do not need another subscription.'});return {ok:false,reason:'already_premium'};}
  const offer=state.offers.find(item=>item.key===selected.key);
  if(!state.available||state.membershipState!=='free'||!offer||!config)throw Error('offer_unavailable');
  const context=await request('/api/google-play/purchase-context',actor,{productId:offer.productId,basePlanId:offer.basePlanId,offerId:offer.offerId});requireCurrent(actor);
  if(context?.canPurchase!==true||context.productId!==offer.productId||context.basePlanId!==offer.basePlanId||(context.offerId??null)!==offer.offerId||context.mode!==config.mode||typeof context.obfuscatedAccountId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(context.obfuscatedAccountId))throw Error('context_unavailable');
  // Fresh server authorization is the final step before opening Google's sheet.
  const result=await plugin.purchase({productId:offer.productId,basePlanId:offer.basePlanId,offerToken:offer.offerToken,obfuscatedAccountId:context.obfuscatedAccountId});requireCurrent(actor);
  if(result?.status==='cancelled'){emit({phase:'ready',message:'Purchase cancelled. Your access has not changed.'});return {ok:true,status:'cancelled'};}
  if(result?.status==='pending'){emit({phase:'ready',message:'Your payment is pending in Google Play. Premium becomes available after payment completes and BasketBoss verifies it.'});return {ok:true,status:'pending'};}
  if(!['purchased','alreadyOwned'].includes(result?.status))throw Error('purchase_unavailable');
  let purchases=result.purchases;
  if(result.status==='alreadyOwned'){const owned=await plugin.getPurchases();requireCurrent(actor);purchases=owned?.purchases;}
  if(!Array.isArray(purchases)||!purchases.length)throw Error('purchase_unavailable');
  let proofVerified=false,pending=false;
  for(const purchase of purchases){const result=await verify(purchase,actor);requireCurrent(actor);proofVerified=proofVerified||result.verified===true;pending=pending||result.pending===true;}
  await verifiedRefresh(actor,proofVerified);requireCurrent(actor);
  if(!state.premiumAccess)emit({phase:'ready',message:pending?'Your payment is pending in Google Play. Premium becomes available after payment completes and BasketBoss verifies it.':'Your Google Play purchase was checked. It does not currently provide active Premium access.'});
  return {ok:true,status:pending?'pending':'verified',premiumAccess:state.premiumAccess};
 });}
 async function restorePurchases({automatic=false}={}){return run(async actor=>{
  // Query current ownership, including reinstall/reconnection. Never retain an
  // event payload and attach it to whichever account happens to sign in next.
  const latest=await request('/api/google-play/config',actor);requireCurrent(actor);
  if(!validConfig(latest))throw Error('service_unavailable');config=latest;
  const owned=await deadline(()=>plugin.getPurchases(),productLoadTimeoutMs);requireCurrent(actor);
  if(!Array.isArray(owned?.purchases))throw Error('restore_unavailable');
  let proofVerified=false,pending=false,count=0;
  for(const purchase of owned.purchases){
   const productId=purchase?.productId||purchase?.products?.[0];if(productId!==config.productId)continue;
   const result=await verify(purchase,actor);requireCurrent(actor);proofVerified=proofVerified||result.verified===true;pending=pending||result.pending===true;count++;
  }
  await verifiedRefresh(actor,proofVerified);requireCurrent(actor);
  if(pending)emit({phase:'ready',message:'A Google Play payment is pending. Premium becomes available after payment completes and BasketBoss verifies it.'});
  else if(!automatic&&!count)emit({phase:'ready',message:'No BasketBoss subscription was found for this Google Play account. Check the Google account used for the purchase.'});
  else if(!automatic&&!state.premiumAccess)emit({phase:'ready',message:'Your Google Play purchases were checked. No active Premium membership was confirmed.'});
  return {ok:true,status:pending?'pending':'restored',premiumAccess:state.premiumAccess};
 });}
 async function manage(){return run(async actor=>{
  // Cancellation remains reachable when new purchases or membership checks are
  // unavailable. A SKU deep link comes only from verified server metadata.
  const productId=state.provider==='google_play'&&typeof state.subscription?.productId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._]{0,199}$/.test(state.subscription.productId)?state.subscription.productId:null;
  const result=await plugin.manageSubscriptions(productId?{productId}:{});requireCurrent(actor);
  if(result?.opened!==true)throw Error('manage_unavailable');
  emit({phase:'ready',message:'Google Play subscription settings opened. Manage or cancel a subscription there. BasketBoss checks your current access with the server.'});return {ok:true};
 });}
 const refreshEvent=()=>{syncIdentity();if(!operation)void refresh();};
 const sessionEvent=()=>{invalidate();previousIdentity=identityKey();void refresh();};
 const pause=()=>{invalidate();previousIdentity=identityKey();};
 const refreshEvents=['focus','online','basketboss:native-resumed','basketboss:household-changed','basketboss:account-deletion-cancelled'];
 for(const name of refreshEvents)win.addEventListener(name,refreshEvent);
 win.addEventListener('basketboss:session-changed',sessionEvent);
 for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener(name,pause);
 try{Promise.resolve(plugin.addListener('purchasesUpdated',()=>{syncIdentity();if(!identity()||isDeleting())return;if(operation)reconcileQueued=true;else void restorePurchases({automatic:true});})).then(handle=>{if(destroyed)void handle?.remove?.();else listenerHandle=handle;}).catch(()=>{});}catch{/* Foreground ownership queries remain available without a listener. */}
 // Listener failure does not invent access; explicit and foreground ownership
 // queries remain the recovery path when the native bridge is unavailable.
 const ready=refresh();
 return {ready,get state(){return snapshot();},subscribeState(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},refresh,subscribe,restore:()=>restorePurchases(),manage,destroy(){if(destroyed)return;invalidate();destroyed=true;listeners.clear();void listenerHandle?.remove?.();for(const name of refreshEvents)win.removeEventListener(name,refreshEvent);win.removeEventListener('basketboss:session-changed',sessionEvent);for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.removeEventListener(name,pause);}};
}
