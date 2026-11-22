import {json} from '../../../bb-server-lib/bb-billing.js';
import {appleErrorResponse,appleAuthenticatedRequest,appleRequestJSON} from '../../../bb-server-lib/bb-apple-http.js';
import {AppleBillingError,appleConfigForSignedData,assertAppleAccountReady,getAppleServices,verifyAppleTransaction,resolveVerifiedAppleAccount,fetchAppleCurrentSubscriptionForAccount,persistAppleSubscription,appleEntitlementFromRow} from '../../../bb-server-lib/bb-apple-subscriptions.js';
import {PurchaseIntentError,purchaseIntentsEnabled,purchaseIntentActor} from '../../../bb-server-lib/bb-purchase-intents.js';
export async function onRequestPost({request,env}){
 try{
  const {config:baseConfig,user}=await appleAuthenticatedRequest(request,env);
  const body=await appleRequestJSON(request);
  const config=appleConfigForSignedData(baseConfig,body.signedTransactionInfo,user.id);
  await assertAppleAccountReady(env,config,user.id);
  const service=await getAppleServices(env,config);
  const transaction=await verifyAppleTransaction(service,body.signedTransactionInfo);
  if(body.transactionId!==undefined&&body.transactionId!==transaction.transactionId)throw new AppleBillingError('apple_transaction_mismatch','The Apple transaction identifier does not match.',400);
  const binding=await resolveVerifiedAppleAccount(env,config,transaction,{userId:user.id});
  if(!binding)throw new AppleBillingError('apple_account_mismatch','Restore this subscription using the original BasketBoss account.',409);
  // Re-query Apple for CURRENT status; a correctly signed historic receipt by
  // itself can never resurrect an expired or refunded subscription.
  const state=await fetchAppleCurrentSubscriptionForAccount(env,service,transaction.originalTransactionId,binding.appAccountToken,user.id);
  let actor=null;
  if(purchaseIntentsEnabled(env)&&body.reservation&&typeof body.reservation==='object'&&!Array.isArray(body.reservation)){
   try{actor=await purchaseIntentActor(request,env,user);}catch(error){if(!(error instanceof PurchaseIntentError))throw error;}
  }
  // An absent/stale reservation must never strand a genuine paid transaction.
  // Only exact authenticated correlation may finish a checkout reservation.
  const saved=await persistAppleSubscription(env,user.id,state,{reservation:body.reservation,actor});
  const entitlement=appleEntitlementFromRow(config,saved);
  return json({ok:true,acknowledged:true,provider:'apple',premiumAccess:entitlement?.premiumAccess===true,
   subscription:{plan:entitlement?.plan,status:entitlement?.status,currentPeriodEndsAt:entitlement?.currentPeriodEndsAt,cancelAtPeriodEnd:entitlement?.cancelAtPeriodEnd===true}});
 }catch(error){return appleErrorResponse(error);}
}
