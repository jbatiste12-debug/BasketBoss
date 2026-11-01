import {confirmAppleFounder} from '../../../bb-server-lib/bb-apple-founder.js';
import {json} from '../../../bb-server-lib/bb-billing.js';
import {appleErrorResponse,appleAuthenticatedRequest,appleRequestJSON} from '../../../bb-server-lib/bb-apple-http.js';
import {AppleBillingError,appleConfigForSignedData,assertAppleAccountReady,appleAccountToken,getAppleServices,verifyAppleTransaction,fetchAppleCurrentSubscription,persistAppleSubscription,appleEntitlementFromRow} from '../../../bb-server-lib/bb-apple-subscriptions.js';
export async function onRequestPost({request,env}){
 try{
  const {config:baseConfig,user}=await appleAuthenticatedRequest(request,env);
  const body=await appleRequestJSON(request);
  const config=appleConfigForSignedData(baseConfig,body.signedTransactionInfo,user.id);
  await assertAppleAccountReady(env,config,user.id);
  const service=getAppleServices(env,config);
  const transaction=await verifyAppleTransaction(service,body.signedTransactionInfo);
  if(body.transactionId!==undefined&&body.transactionId!==transaction.transactionId)throw new AppleBillingError('apple_transaction_mismatch','The Apple transaction identifier does not match.',400);
  const accountToken=await appleAccountToken(env,user.id);
  if(transaction.appAccountToken.toLowerCase()!==accountToken)throw new AppleBillingError('apple_account_mismatch','Restore this subscription using the original BasketBoss account.',409);
  // Re-query Apple for CURRENT status; a correctly signed historic receipt by
  // itself can never resurrect an expired or refunded subscription.
  const state=await fetchAppleCurrentSubscription(service,transaction.originalTransactionId,accountToken);
  if(state.plan==='founder')await confirmAppleFounder(env,user.id,accountToken,state.originalTransactionId,config.environment);
  const saved=await persistAppleSubscription(env,user.id,state);
  const entitlement=appleEntitlementFromRow(config,saved);
  return json({ok:true,acknowledged:true,provider:'apple',premiumAccess:entitlement?.premiumAccess===true,
   subscription:{plan:entitlement?.plan,status:entitlement?.status,currentPeriodEndsAt:entitlement?.currentPeriodEndsAt,cancelAtPeriodEnd:entitlement?.cancelAtPeriodEnd===true}});
 }catch(error){return appleErrorResponse(error);}
}
