import {json} from '../../../bb-server-lib/bb-billing.js';
import {appleErrorResponse,appleAuthenticatedRequest,appleRequestJSON} from '../../../bb-server-lib/bb-apple-http.js';
import {AppleBillingError,appleConfigForUser,appleAccountToken,hasExistingWebPremium,assertNoPendingWebCheckout,readAppleEntitlement} from '../../../bb-server-lib/bb-apple-subscriptions.js';
import {readTestFlightBetaGrant} from '../../../bb-server-lib/bb-testflight-beta.js';
export async function onRequestPost({request,env}){
 try{
  const authenticated=await appleAuthenticatedRequest(request,env),{user}=authenticated;
  const config=appleConfigForUser(authenticated.config,user.id),body=await appleRequestJSON(request,2000);
  if(await readTestFlightBetaGrant(env,user.id))return json({ok:false,canPurchase:false,reason:'already_premium',provider:'testflight_beta',error:'Your Beta Premium access is already available. No purchase is needed.'},409);
  if(!Object.values(config.products).includes(body.productId))throw new AppleBillingError('apple_product_unavailable','Choose an available Apple subscription.',400);
  // A verified web, household or Apple entitlement suppresses another charge.
  // Errors fail closed; a billing outage is never treated as a Free account.
  const webProvider=await hasExistingWebPremium(env,user);
  if(webProvider)return json({ok:false,canPurchase:false,reason:'already_premium',provider:webProvider,error:'Your existing Premium access is already available.'},409);
  await assertNoPendingWebCheckout(env,user.id);
  const apple=await readAppleEntitlement(env,user.id);
  if(apple?.premiumAccess)return json({ok:false,canPurchase:false,reason:'already_premium',provider:'apple',error:'Your Apple subscription is already active.'},409);
  const appAccountToken=await appleAccountToken(env,user.id,{create:true});
  const allowedProductIds=[body.productId];
  return json({canPurchase:true,appAccountToken,productIds:allowedProductIds,allowedProductIds,environment:config.environment});
 }catch(error){return appleErrorResponse(error);}
}
