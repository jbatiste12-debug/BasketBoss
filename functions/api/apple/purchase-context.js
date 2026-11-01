import {json} from '../../../bb-server-lib/bb-billing.js';
import {appleErrorResponse,appleAuthenticatedRequest,appleRequestJSON} from '../../../bb-server-lib/bb-apple-http.js';
import {AppleBillingError,appleConfigForUser,appleAccountToken,hasExistingWebPremium,assertNoPendingWebCheckout,readAppleEntitlement} from '../../../bb-server-lib/bb-apple-subscriptions.js';
import {reserveAppleFounder} from '../../../bb-server-lib/bb-apple-founder.js';
export async function onRequestPost({request,env}){
 try{
  const authenticated=await appleAuthenticatedRequest(request,env),{user}=authenticated;
  const config=appleConfigForUser(authenticated.config,user.id),body=await appleRequestJSON(request,2000);
  if(!Object.values(config.products).includes(body.productId))throw new AppleBillingError('apple_product_unavailable','Choose an available Apple subscription.',400);
  // A verified web, household or Apple entitlement suppresses another charge.
  // Errors fail closed; a billing outage is never treated as a Free account.
  const webProvider=await hasExistingWebPremium(env,user);
  if(webProvider)return json({ok:false,canPurchase:false,reason:'already_premium',provider:webProvider,error:'Your existing Premium access is already available.'},409);
  await assertNoPendingWebCheckout(env,user.id);
  const apple=await readAppleEntitlement(env,user.id);
  if(apple?.premiumAccess)return json({ok:false,canPurchase:false,reason:'already_premium',provider:'apple',error:'Your Apple subscription is already active.'},409);
  const appAccountToken=await appleAccountToken(env,user.id,{create:true});
  let founder;
  if(body.productId===config.products.founder)founder=await reserveAppleFounder(env,user.id,appAccountToken,config.environment);
  const allowedProductIds=[body.productId];
  return json({canPurchase:true,appAccountToken,productIds:allowedProductIds,allowedProductIds,environment:config.environment,...(founder?{founder:{slot:founder.slot,claimId:founder.claimId}}:{})});
 }catch(error){return appleErrorResponse(error);}
}
