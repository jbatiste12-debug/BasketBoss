/* Apple App Store Server Notifications V2. Signature authentication replaces
 * browser authentication here. An unlinked notification can NEVER claim a user.
 */
import {json} from '../../../bb-server-lib/bb-billing.js';
import {isAccountDeleting,digestDeletionActor} from '../../../bb-server-lib/bb-account-deletion.js';
import {appleErrorResponse,appleRequestJSON} from '../../../bb-server-lib/bb-apple-http.js';
import {AppleBillingError,appleConfigForSignedData,getVerifiedAppleConfig,getAppleServices,validateAppleJWS,verifyAppleTransaction,ensureAppleSchema,fetchAppleCurrentSubscription,persistAppleSubscription,appleUserAllowed,appleAppIdentifierMatches,isAppleRetryableVerificationFailure} from '../../../bb-server-lib/bb-apple-subscriptions.js';
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
  const existing=await env.BILLING_DB.prepare('SELECT user_id,app_account_token FROM bb_apple_subscriptions WHERE environment=? AND original_transaction_id=?').bind(config.environment,transaction.originalTransactionId).first();
  // Ownership is established only by an authenticated verify/restore request.
  if(!existing)return json({ok:true,ignored:true});
  if(!appleUserAllowed(config,existing.user_id)||await isAccountDeleting(env,existing.user_id))return json({ok:true,ignored:true});
  if(existing.app_account_token!==transaction.appAccountToken.toLowerCase())throw new AppleBillingError('apple_account_mismatch','Apple account linkage does not match.',409);
  const state=await fetchAppleCurrentSubscription(service,transaction.originalTransactionId,existing.app_account_token);
  await persistAppleSubscription(env,existing.user_id,state);
  // Record AFTER successful reconciliation. An interrupted attempt is retryable;
  // concurrent duplicates merely perform the same monotonic, ownership-safe write.
  await env.BILLING_DB.prepare(`INSERT OR IGNORE INTO bb_apple_notifications(environment,notification_uuid,original_transaction_id,signed_at_ms,processed_at_ms)
   SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bb_apple_account_tokens WHERE user_id=? AND app_account_token=?)
   AND NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
   .bind(config.environment,notification.notificationUUID,transaction.originalTransactionId,notification.signedDate,Date.now(),existing.user_id,existing.app_account_token,await digestDeletionActor(existing.user_id)).run();
  return json({ok:true});
 }catch(error){return appleErrorResponse(error);}
}
