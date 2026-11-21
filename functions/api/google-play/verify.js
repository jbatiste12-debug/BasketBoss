import {json} from '../../../bb-server-lib/bb-billing.js';
import {googlePlayAuthenticatedRequest,googlePlayRequestJSON,googlePlayErrorResponse} from '../../../bb-server-lib/bb-google-play-http.js';
import {GooglePlayBillingError,reconcileGooglePlayPurchase,googlePlayEntitlementFromRow} from '../../../bb-server-lib/bb-google-play-subscriptions.js';
export async function onRequestPost({request,env}){
 try{
  const {config,user}=await googlePlayAuthenticatedRequest(request,env),body=await googlePlayRequestJSON(request);
  if(body.productId!==config.productId)throw new GooglePlayBillingError('google_play_product_unavailable','Choose an available Google Play subscription.',400);
  const saved=await reconcileGooglePlayPurchase(env,config,user.id,body.purchaseToken),entitlement=googlePlayEntitlementFromRow(config,saved);
  return json({ok:true,acknowledged:saved.acknowledged===1,provider:'google_play',premiumAccess:entitlement?.premiumAccess===true,
   subscription:{provider:'google_play',plan:entitlement?.plan,status:entitlement?.status,currentPeriodEndsAt:entitlement?.currentPeriodEndsAt,cancelAtPeriodEnd:entitlement?.cancelAtPeriodEnd===true,environment:entitlement?.environment}});
 }catch(error){return googlePlayErrorResponse(error);}
}
