/* Apple App Store Server Notifications V2. Signature authentication replaces
 * browser authentication here. Only an existing lineage or exact server-issued
 * intent token can link a signed notification to an account.
 */
import {json} from '../../../bb-server-lib/bb-billing.js';
import {isAccountDeleting,digestDeletionActor} from '../../../bb-server-lib/bb-account-deletion.js';
import {appleErrorResponse,appleRequestJSON} from '../../../bb-server-lib/bb-apple-http.js';
import {AppleBillingError,appleConfigForSignedData,getVerifiedAppleConfig,getAppleServices,validateAppleJWS,verifyAppleTransaction,ensureAppleSchema,assertAppleAccountReady,resolveVerifiedAppleAccount,fetchAppleCurrentSubscriptionForAccount,persistAppleSubscription,appleAppIdentifierMatches,isAppleRetryableVerificationFailure} from '../../../bb-server-lib/bb-apple-subscriptions.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function onRequestPost({request,env}){
 try{
  const baseConfig=getVerifiedAppleConfig(env);
  if(!baseConfig)throw new AppleBillingError('apple_disabled','Apple notifications are not configured.');
  const body=await appleRequestJSON(request,100000);
  const config=appleConfigForSignedData(baseConfig,body.signedPayload),service=await getAppleServices(env,config);
  let notification;
  try{validateAppleJWS(body.signedPayload);notification=await service.verifier.verifyAndDecodeNotification(body.signedPayload);}
  catch(error){if(await isAppleRetryableVerificationFailure(error))throw new AppleBillingError('apple_unavailable','Apple verification is temporarily unavailable.');throw new AppleBillingError('apple_notification_unverified','The Apple notification could not be verified.',400);}
  if(notification.version!=='2.0'||!UUID.test(notification.notificationUUID||'')||!Number.isSafeInteger(notification.signedDate)||notification.signedDate>Date.now()+300000)
   throw new AppleBillingError('apple_notification_invalid','Invalid Apple notification.',400);
  // Apple's signed TEST notification validates delivery without transaction data.
  if(notification.notificationType==='TEST')return json({ok:true,test:true});
  if(!notification.data?.signedTransactionInfo)return json({ok:true,ignored:true});
  if(notification.data.bundleId!==config.bundleId||notification.data.environment!==config.environment||!appleAppIdentifierMatches(config,notification.data.appAppleId))
   throw new AppleBillingError('apple_notification_mismatch','Apple notification does not match this app.',400);
  await ensureAppleSchema(env);
  const duplicate=await env.BILLING_DB.prepare('SELECT 1 AS found FROM bb_apple_notifications WHERE environment=? AND notification_uuid=?').bind(config.environment,notification.notificationUUID).first();
  if(duplicate)return json({ok:true,duplicate:true});
  const transaction=await verifyAppleTransaction(service,notification.data.signedTransactionInfo);
  const binding=await resolveVerifiedAppleAccount(env,config,transaction);
  // Legacy unlinked notifications remain unable to claim an account. A new
  // signed intent token resolves only its exact server-issued account mapping.
  if(!binding)return json({ok:true,ignored:true});
  if(await isAccountDeleting(env,binding.userId))return json({ok:true,ignored:true});
  await assertAppleAccountReady(env,config,binding.userId);
  const state=await fetchAppleCurrentSubscriptionForAccount(env,service,transaction.originalTransactionId,binding.appAccountToken,binding.userId);
  await persistAppleSubscription(env,binding.userId,state);
  // Record AFTER successful reconciliation. An interrupted attempt is retryable;
  // concurrent duplicates merely perform the same monotonic, ownership-safe write.
  await env.BILLING_DB.prepare(`INSERT OR IGNORE INTO bb_apple_notifications(environment,notification_uuid,original_transaction_id,signed_at_ms,processed_at_ms)
   SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bb_apple_subscriptions WHERE user_id=? AND app_account_token=? AND environment=? AND original_transaction_id=?)
   AND NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
   .bind(config.environment,notification.notificationUUID,transaction.originalTransactionId,notification.signedDate,Date.now(),binding.userId,state.appAccountToken,config.environment,transaction.originalTransactionId,await digestDeletionActor(binding.userId)).run();
  return json({ok:true});
 }catch(error){return appleErrorResponse(error);}
}
