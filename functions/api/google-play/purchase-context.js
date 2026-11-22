import {json} from '../../../bb-server-lib/bb-billing.js';
import {googlePlayAuthenticatedRequest,googlePlayRequestJSON,googlePlayErrorResponse} from '../../../bb-server-lib/bb-google-play-http.js';
import {GooglePlayBillingError,googlePlayAccountId,googlePlayPlan,liveGooglePlayCheckoutEnabled} from '../../../bb-server-lib/bb-google-play-subscriptions.js';
import {assertNoPendingWebCheckout} from '../../../bb-server-lib/bb-apple-subscriptions.js';
import {readMemberPaidAccess} from '../../../bb-server-lib/bb-paid-access.js';
import {purchaseIntentActor,reservePurchaseIntent,reportPurchaseIntent} from '../../../bb-server-lib/bb-purchase-intents.js';
import {readResumableCheckoutBlock} from '../../../bb-server-lib/bb-checkout-state.js';
export async function onRequestPost({request,env}){
 let reservation=null,actor=null;
 try{
  // Sales require the reviewed start/outcome protocol and a separate explicit live gate.
  if(env.GOOGLE_PLAY_BILLING_MODE==='live'&&!liveGooglePlayCheckoutEnabled(env))throw new GooglePlayBillingError('google_play_live_checkout_not_ready','New Google Play purchases are not enabled yet. Restore and manage existing purchases remain available.',503);
  const {config,user}=await googlePlayAuthenticatedRequest(request,env),body=await googlePlayRequestJSON(request,3000);
  const offerId=body.offerId??null;
  if(body.productId!==config.productId||!googlePlayPlan(config,body.basePlanId,offerId))throw new GooglePlayBillingError('google_play_product_unavailable','Choose an available Google Play subscription.',400);
  actor=await purchaseIntentActor(request,env,user);
  // Reserve before fresh entitlement checks: any concurrent verified proof
  // advances the billing revision and prevents this authorization from starting.
  reservation=await reservePurchaseIntent(env,actor,{provider:'google_play',mode:config.mode,productId:config.productId,basePlanId:body.basePlanId,offerId,protocol:body.reservationProtocol});
  if(user.id===env.BB_OWNER_USER_ID)return json({canPurchase:false,reason:'already_premium',provider:'owner',error:'Your Premium access is already available.'},409);
  // All payment providers must be freshly verified; an unavailable provider is
  // never evidence that opening a second payment sheet is safe.
  const access=await readMemberPaidAccess(request,env,user);
  if(access.premiumAccess)return json({canPurchase:false,reason:'already_premium',provider:access.provider,error:'Your existing Premium access is already available.'},409);
  const blocked=await readResumableCheckoutBlock(env,user.id,{mode:config.mode});
  if(blocked)return json({ok:false,canPurchase:false,...blocked},409);
  if(['pending','on_hold','paused'].includes(access.googlePlay?.status))return json({canPurchase:false,reason:'google_play_subscription_pending',provider:'google_play',error:'Resolve your existing Google Play subscription before starting another purchase.'},409);
  try{await assertNoPendingWebCheckout(env,user.id);}
  catch(error){if(error?.code==='web_checkout_pending')throw new GooglePlayBillingError('web_checkout_pending','Your web checkout is still awaiting confirmation. Complete or safely cancel it before subscribing through Google Play.',409);throw error;}
  const obfuscatedAccountId=await googlePlayAccountId(env,user.id,{create:true});
  const response=json({canPurchase:true,productId:config.productId,basePlanId:body.basePlanId,offerId,obfuscatedAccountId,mode:config.mode,...(reservation?{reservation}:{})});
  reservation=null;return response;
 }catch(error){return googlePlayErrorResponse(error);}
 finally{if(reservation)try{await reportPurchaseIntent(env,actor,{...reservation,outcome:'canceled',cause:'not_launched'});}catch{/* A failed cleanup keeps the reservation held; it never authorizes a second sheet. */}}
}
