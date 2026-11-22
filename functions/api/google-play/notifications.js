/* Authenticated Pub/Sub push, followed by a fresh Developer API lookup. A
 * notification never supplies an account ID or authorizes a client-tier grant. */
import {Buffer} from 'node:buffer';
import {json} from '../../../bb-server-lib/bb-billing.js';
import {isAccountDeleting,digestDeletionActor} from '../../../bb-server-lib/bb-account-deletion.js';
import {verifyGooglePlayPubSub} from '../../../bb-server-lib/bb-google-play-api.js';
import {googlePlayRequestJSON,googlePlayErrorResponse} from '../../../bb-server-lib/bb-google-play-http.js';
import {GooglePlayBillingError,getVerifiedGooglePlayConfig,ensureGooglePlaySchema,googlePlayTokenHash,reconcileGooglePlayPurchase} from '../../../bb-server-lib/bb-google-play-subscriptions.js';
export async function onRequestPost({request,env}){
 try{
  const config=getVerifiedGooglePlayConfig(env);
  if(!config)throw new GooglePlayBillingError('google_play_disabled','Google Play notifications are not available.');
  await verifyGooglePlayPubSub(request,config);
  const body=await googlePlayRequestJSON(request,30000),message=body.message;
  if(typeof config.pubsub.subscription!=='string'||!/^projects\/[^/]+\/subscriptions\/[^/]+$/.test(config.pubsub.subscription)||body.subscription!==config.pubsub.subscription||
   !message||typeof message.messageId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(message.messageId)||typeof message.data!=='string'||message.data.length>20000||!/^[A-Za-z0-9+/]+={0,2}$/.test(message.data))
   throw new GooglePlayBillingError('google_play_notification_invalid','Invalid Google Play notification.',400);
  let notice;try{notice=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(message.data,'base64')));}catch{throw new GooglePlayBillingError('google_play_notification_invalid','Invalid Google Play notification.',400);}
  if(notice?.packageName!==config.packageName||notice.version!=='1.0'||!/^\d{1,20}$/.test(String(notice.eventTimeMillis||''))||Number(notice.eventTimeMillis)>Date.now()+300000)
   throw new GooglePlayBillingError('google_play_notification_invalid','Invalid Google Play notification.',400);
  await ensureGooglePlaySchema(env);
  if(await env.BILLING_DB.prepare('SELECT 1 AS found FROM bb_google_play_notifications WHERE message_id=?').bind(message.messageId).first())return json({ok:true,duplicate:true});
  if(notice.testNotification)return json({ok:true,test:true});
  const event=notice.subscriptionNotification||notice.voidedPurchaseNotification;
  if(!event)return json({ok:true,ignored:true});
  const hash=await googlePlayTokenHash(event.purchaseToken);
  const existing=await env.BILLING_DB.prepare('SELECT * FROM bb_google_play_subscriptions WHERE token_hash=?').bind(hash).first();
  // A purchase can complete while the app is closed (including pending
  // payments). Google's verified opaque account identifier must resolve to a
  // context previously created by an authenticated BasketBoss purchase request.
  // Replacement history is also resolved only from Google's verified response.
  let owner=existing;
  if(!owner){
   const {createGooglePlayAPI}=await import('../../../bb-server-lib/bb-google-play-api.js');
   const purchase=await createGooglePlayAPI(env,config).get(event.purchaseToken);
   const accountId=purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
   if(typeof accountId==='string'&&/^[A-Za-z0-9_-]{32,64}$/.test(accountId))owner=await env.BILLING_DB.prepare('SELECT user_id,obfuscated_account_id FROM bb_google_play_account_tokens WHERE obfuscated_account_id=?').bind(accountId).first();
   const previous=purchase.linkedPurchaseToken||purchase.outOfAppPurchaseContext?.expiredPurchaseToken;
   if(!owner&&previous)owner=await env.BILLING_DB.prepare('SELECT * FROM bb_google_play_subscriptions WHERE token_hash=?').bind(await googlePlayTokenHash(previous)).first();
  }
  if(!owner||owner.replaced_by_hash||await isAccountDeleting(env,owner.user_id))return json({ok:true,ignored:true});
  await reconcileGooglePlayPurchase(env,config,owner.user_id,event.purchaseToken);
  await env.BILLING_DB.prepare(`INSERT OR IGNORE INTO bb_google_play_notifications(message_id,token_hash,processed_at_ms)
   SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM bb_google_play_account_tokens WHERE user_id=? AND obfuscated_account_id=?)
   AND NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
   .bind(message.messageId,hash,Date.now(),owner.user_id,owner.obfuscated_account_id,await digestDeletionActor(owner.user_id)).run();
  return json({ok:true});
 }catch(error){return googlePlayErrorResponse(error);}
}
