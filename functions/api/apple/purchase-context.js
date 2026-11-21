import {json} from '../../../bb-server-lib/bb-billing.js';
import {appleErrorResponse,appleAuthenticatedRequest,appleRequestJSON} from '../../../bb-server-lib/bb-apple-http.js';
import {AppleBillingError,appleConfigForUser,appleSandboxPurchaseAllowed,appleAccountToken,hasExistingWebPremium,assertNoPendingWebCheckout,readAppleEntitlement} from '../../../bb-server-lib/bb-apple-subscriptions.js';
import {readTestFlightBetaGrant} from '../../../bb-server-lib/bb-testflight-beta.js';
import {googlePlayBillingEnabled,readGooglePlayEntitlement} from '../../../bb-server-lib/bb-google-play-subscriptions.js';
export async function onRequestPost({request,env}){
 try{
  const authenticated=await appleAuthenticatedRequest(request,env),{user}=authenticated;
  const config=appleConfigForUser(authenticated.config,user.id),body=await appleRequestJSON(request,2000);
  const sandboxPurchaseAllowed=appleSandboxPurchaseAllowed(config,user.id);
  if(body.testPurchase!==undefined&&typeof body.testPurchase!=='boolean')throw new AppleBillingError('invalid_request','Choose a valid Apple purchase request.',400);
  if(body.testPurchase===true&&!sandboxPurchaseAllowed)throw new AppleBillingError('apple_test_purchase_not_allowed','Apple purchase testing is not enabled for this account.',403);
  const explicitSandboxTest=body.testPurchase===true&&sandboxPurchaseAllowed;
  if(!explicitSandboxTest&&await readTestFlightBetaGrant(env,user.id))return json({ok:false,canPurchase:false,reason:'already_premium',provider:'testflight_beta',error:'Your Beta Premium access is already available. No purchase is needed.'},409);
  if(!Object.values(config.products).includes(body.productId))throw new AppleBillingError('apple_product_unavailable','Choose an available Apple subscription.',400);
  // A verified web, household or Apple entitlement suppresses another charge.
  // Errors fail closed; a billing outage is never treated as a Free account.
  const checkGooglePlay=!explicitSandboxTest&&googlePlayBillingEnabled(env);
  let webProvider,providerError,apple;
  try{webProvider=explicitSandboxTest?null:await hasExistingWebPremium(env,user);}
  catch(error){if(!checkGooglePlay)throw error;providerError=error;}
  if(webProvider)return json({ok:false,canPurchase:false,reason:'already_premium',provider:webProvider,error:'Your existing Premium access is already available.'},409);
  try{await assertNoPendingWebCheckout(env,user.id);}
  catch(error){if(!checkGooglePlay)throw error;providerError ||= error;}
  try{apple=explicitSandboxTest?null:await readAppleEntitlement(env,user.id);}
  catch(error){if(!checkGooglePlay)throw error;providerError ||= error;}
  if(apple?.premiumAccess)return json({ok:false,canPurchase:false,reason:'already_premium',provider:'apple',error:'Your Apple subscription is already active.'},409);
  if(checkGooglePlay){
   let googlePlay;
   try{googlePlay=await readGooglePlayEntitlement(env,user.id);}catch(error){providerError ||= error;}
   if(googlePlay?.premiumAccess||['pending','on_hold','paused'].includes(googlePlay?.status))return json({ok:false,canPurchase:false,reason:googlePlay.premiumAccess?'already_premium':'existing_subscription',provider:'google_play',error:'Manage or complete your existing Google Play subscription before starting another subscription.'},409);
  }
  if(providerError)throw providerError;
  const appAccountToken=await appleAccountToken(env,user.id,{create:true});
  const allowedProductIds=[body.productId];
  return json({canPurchase:true,appAccountToken,productIds:allowedProductIds,allowedProductIds,environment:config.environment,sandboxPurchaseAllowed});
 }catch(error){return appleErrorResponse(error);}
}
