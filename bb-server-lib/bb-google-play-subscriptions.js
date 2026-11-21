/* Play owns payment state; D1 owns immutable BasketBoss account linkage.
 * Disabled by default. Test purchases require Google's proof and our allowlist.
 * Purchase tokens and credentials must never be returned to a browser or logged.
 */
import {createPrivateKey} from 'node:crypto';
import {digestHex} from './bb-billing.js';
import {ensureDeletionSchema,isAccountDeleting,digestDeletionActor,digestDeletionRef} from './bb-account-deletion.js';
import {GooglePlayBillingError,createGooglePlayAPI} from './bb-google-play-api.js';
export {GooglePlayBillingError} from './bb-google-play-api.js';
export const GOOGLE_PLAY_PACKAGE_NAME='uk.co.basketboss.app';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[a-z0-9][a-z0-9._-]{0,149}$/;
const OPAQUE=/^[A-Za-z0-9_-]{32,64}$/;
const REFRESH_MS=60000;
const fail=(code,message,status=503)=>{throw new GooglePlayBillingError(code,message,status);};
export const googlePlayBillingEnabled=env=>env.GOOGLE_PLAY_BILLING_ENABLED==='true'&&
 (env.GOOGLE_PLAY_BILLING_MODE==='test'||liveGooglePlayBillingEnabled(env));
export const liveGooglePlayBillingEnabled=env=>env.GOOGLE_PLAY_BILLING_ENABLED==='true'&&env.GOOGLE_PLAY_BILLING_MODE==='live'&&env.GOOGLE_PLAY_LIVE_BILLING_ENABLED==='true';
const csv=value=>String(value||'').split(',').map(v=>v.trim()).filter(Boolean);
export function getVerifiedGooglePlayConfig(env){
 if(!googlePlayBillingEnabled(env))return null;
 const mode=env.GOOGLE_PLAY_BILLING_MODE,productId=env.GOOGLE_PLAY_PRODUCT_ID;
 const plans=['monthly','annual'].map(plan=>({plan,basePlanId:env['GOOGLE_PLAY_'+plan.toUpperCase()+'_BASE_PLAN_ID'],offerIds:csv(env['GOOGLE_PLAY_'+plan.toUpperCase()+'_OFFER_IDS'])}));
 const testUsers=csv(env.GOOGLE_PLAY_TEST_USER_IDS).map(id=>id.toLowerCase());
 const serviceAccountEmail=env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
 const privateKey=typeof env.GOOGLE_PLAY_PRIVATE_KEY==='string'?env.GOOGLE_PLAY_PRIVATE_KEY.replace(/\\n/g,'\n'):'';
 const pubsub={email:env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL,audience:env.GOOGLE_PLAY_PUBSUB_AUDIENCE,subscription:env.GOOGLE_PLAY_PUBSUB_SUBSCRIPTION};
 let pushURL;try{pushURL=new URL(pubsub.audience);}catch{}
 if(!ID.test(productId||'')||plans.some(p=>!ID.test(p.basePlanId||'')||p.offerIds.some(id=>!ID.test(id)))||new Set(plans.map(p=>p.basePlanId)).size!==2||
  (env.GOOGLE_PLAY_PACKAGE_NAME&&env.GOOGLE_PLAY_PACKAGE_NAME!==GOOGLE_PLAY_PACKAGE_NAME)||
  !/^[a-z0-9._-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail||'')||
  testUsers.some(id=>!UUID.test(id))||(mode==='test'&&!testUsers.length)||!env.BILLING_DB?.prepare||!env.BILLING_DB?.batch||
  !/^[a-z0-9._-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(pubsub.email||'')||pushURL?.protocol!=='https:'||pushURL.username||pushURL.password||pushURL.pathname!=='/api/google-play/notifications'||pushURL.search||pushURL.hash||
  !/^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/.test(pubsub.subscription||''))
  fail('google_play_not_configured','Google Play subscriptions are not configured.');
 try{const key=createPrivateKey(privateKey);if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048)throw Error();}
 catch{fail('google_play_not_configured','Google Play subscriptions are not configured.');}
 return {mode,packageName:GOOGLE_PLAY_PACKAGE_NAME,productId,plans,testUsers,serviceAccountEmail,privateKey,pubsub};
}
export function googlePlayUserAllowed(config,userId){return UUID.test(userId||'')&&(config.mode==='live'||config.testUsers.includes(userId.toLowerCase()));}
export function googlePlayPlan(config,basePlanId,offerId=null){
 return config.plans.find(p=>p.basePlanId===basePlanId&&(offerId===null||p.offerIds.includes(offerId)))||null;
}
export async function ensureGooglePlaySchema(env){
 try{
  if((await env.BILLING_DB.prepare('SELECT version FROM bb_google_play_schema WHERE id=1').first())?.version!==1)throw Error();
  await env.BILLING_DB.prepare('SELECT token_hash,reconciliation_generation FROM bb_google_play_subscriptions LIMIT 0').all();
  await env.BILLING_DB.prepare('SELECT head_token_hash FROM bb_google_play_lineages LIMIT 0').all();
  await env.BILLING_DB.prepare('SELECT obfuscated_account_id FROM bb_google_play_account_tokens LIMIT 0').all();
  await env.BILLING_DB.prepare('SELECT generation FROM bb_google_play_leases LIMIT 0').all();
  await env.BILLING_DB.prepare('SELECT message_id FROM bb_google_play_notifications LIMIT 0').all();
 }catch{fail('google_play_schema_unavailable','Google Play subscriptions are temporarily unavailable.');}
}
export async function assertGooglePlayAccountReady(env,config,userId){
 if(!googlePlayUserAllowed(config,userId))fail('google_play_account_unavailable','Google Play subscriptions are not enabled for this account.',403);
 await ensureDeletionSchema(env);
 if(await isAccountDeleting(env,userId))fail('account_deletion_pending','Account deletion is in progress.',409);
 await ensureGooglePlaySchema(env);
}
export async function googlePlayAccountId(env,userId,{create=false}={}){
 let row=await env.BILLING_DB.prepare('SELECT obfuscated_account_id FROM bb_google_play_account_tokens WHERE user_id=?').bind(userId).first();
 if(!row&&create){
  const id=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  await env.BILLING_DB.prepare(`INSERT OR IGNORE INTO bb_google_play_account_tokens(user_id,obfuscated_account_id,created_at_ms)
   SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
   .bind(userId,id,Date.now(),await digestDeletionActor(userId)).run();
  row=await env.BILLING_DB.prepare('SELECT obfuscated_account_id FROM bb_google_play_account_tokens WHERE user_id=?').bind(userId).first();
 }
 if(!OPAQUE.test(row?.obfuscated_account_id||''))fail('google_play_account_unavailable','Prepare the Google Play purchase using the original BasketBoss account.',409);
 return row.obfuscated_account_id;
}
export function validateGooglePlayPurchaseToken(token){
 if(typeof token!=='string'||token.length<8||token.length>4096||!/^[\x21-\x7e]+$/.test(token))fail('invalid_google_play_token','Invalid Google Play purchase token.',400);
 return token;
}
export const googlePlayTokenHash=token=>digestHex('basketboss:google-play:purchase:'+validateGooglePlayPurchaseToken(token));
const timestamp=value=>{const n=typeof value==='string'?Date.parse(value):NaN;return Number.isSafeInteger(n)&&n>0?n:null;};
export function evaluateGooglePlaySubscription(config,purchase,accountId,userId,now=Date.now()){
 if(!googlePlayUserAllowed(config,userId)||!OPAQUE.test(accountId||'')||purchase?.externalAccountIdentifiers?.obfuscatedExternalAccountId!==accountId)
  fail('google_play_account_mismatch','Restore this subscription using the original BasketBoss account.',409);
 const test=purchase.testPurchase!==undefined;
 if((test&&(!purchase.testPurchase||typeof purchase.testPurchase!=='object'||Array.isArray(purchase.testPurchase)||!config.testUsers.includes(userId.toLowerCase())))||(config.mode==='test'&&!test))
  fail('google_play_environment_mismatch','This Google Play purchase environment is not enabled for this account.',403);
 if(!Array.isArray(purchase.lineItems)||purchase.lineItems.length!==1)fail('google_play_purchase_mismatch','This Google Play subscription is not supported.',400);
 const item=purchase.lineItems[0],offerId=item.offerDetails?.offerId??null,plan=googlePlayPlan(config,item.offerDetails?.basePlanId,offerId);
 const expiresAtMs=timestamp(item.expiryTime),start=timestamp(purchase.startTime);
 const statuses={SUBSCRIPTION_STATE_ACTIVE:'active',SUBSCRIPTION_STATE_CANCELED:'canceled',SUBSCRIPTION_STATE_IN_GRACE_PERIOD:'grace_period',SUBSCRIPTION_STATE_ON_HOLD:'on_hold',SUBSCRIPTION_STATE_PAUSED:'paused',SUBSCRIPTION_STATE_PENDING:'pending',SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED:'pending_canceled',SUBSCRIPTION_STATE_EXPIRED:'expired'};
 const status=statuses[purchase.subscriptionState];
 if(item.productId!==config.productId||!plan||!status||!item.autoRenewingPlan||typeof item.autoRenewingPlan.autoRenewEnabled!=='boolean'||
  !['ACKNOWLEDGEMENT_STATE_PENDING','ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'].includes(purchase.acknowledgementState)||
  ((!expiresAtMs||!start)&&!['pending','pending_canceled'].includes(status))||(start&&start>now+300000))
  fail('google_play_purchase_mismatch','The Google Play subscription does not match this app and plan.',400);
 return {productId:item.productId,basePlanId:plan.basePlanId,offerId,plan:plan.plan,status,environment:test?'test':'production',
  expiresAtMs:expiresAtMs||1,cancelAtPeriodEnd:status==='canceled'||item.autoRenewingPlan.autoRenewEnabled===false,
  acknowledged:purchase.acknowledgementState==='ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',lastVerifiedAtMs:now};
}
export function googlePlayEntitlementFromRow(config,row,now=Date.now()){
 if(!row||row.product_id!==config.productId||googlePlayPlan(config,row.base_plan_id,row.offer_id??null)?.plan!==row.plan)return null;
 const allowedEnvironment=row.environment==='production'?config.mode==='live':row.environment==='test'&&config.testUsers.includes(String(row.user_id).toLowerCase());
 const premiumAccess=allowedEnvironment&&!row.replaced_by_hash&&row.acknowledged===1&&['active','canceled','grace_period'].includes(row.status)&&row.expires_at_ms>now;
 return {provider:'google_play',productId:config.productId,premiumAccess,plan:row.plan,status:row.replaced_by_hash?'replaced':(['active','canceled','grace_period'].includes(row.status)&&row.expires_at_ms<=now?'expired':row.status),
  currentPeriodEndsAt:row.expires_at_ms>1?new Date(row.expires_at_ms).toISOString():null,cancelAtPeriodEnd:row.cancel_at_period_end===1,environment:row.environment};
}
async function tokenDeleted(env,hash){return !!await env.BILLING_DB.prepare('SELECT 1 AS found FROM bb_account_deletion_refs WHERE ref_hash=?').bind(await digestDeletionRef('google_play_token',hash)).first();}
async function acquireLease(env,hash){
 const now=Date.now();
 const lease=await env.BILLING_DB.prepare(`INSERT INTO bb_google_play_leases(token_hash,generation,locked_until_ms) VALUES(?,1,?)
  ON CONFLICT(token_hash) DO UPDATE SET generation=generation+1,locked_until_ms=excluded.locked_until_ms
  WHERE bb_google_play_leases.locked_until_ms<=? RETURNING generation`)
  .bind(hash,now+90000,now).first();
 if(!lease)fail('google_play_verification_pending','This purchase is already being verified. Please try again shortly.',409);
 return lease.generation;
}
export async function reconcileGooglePlayPurchase(env,config,userId,purchaseToken,{api=createGooglePlayAPI(env,config)}={}){
 await assertGooglePlayAccountReady(env,config,userId);
 const hash=await googlePlayTokenHash(purchaseToken),accountId=await googlePlayAccountId(env,userId);
 if(await tokenDeleted(env,hash))fail('google_play_account_mismatch','This purchase cannot be restored to this account.',409);
 const generation=await acquireLease(env,hash),db=env.BILLING_DB;
 try{
  const purchase=await api.get(purchaseToken);
  const existing=await db.prepare('SELECT * FROM bb_google_play_subscriptions WHERE token_hash=?').bind(hash).first();
  if(existing&&(existing.user_id!==userId||existing.obfuscated_account_id!==accountId))fail('google_play_account_mismatch','This purchase belongs to another BasketBoss account.',409);
  const relatedToken=purchase.linkedPurchaseToken||purchase.outOfAppPurchaseContext?.expiredPurchaseToken;
  const relatedHash=relatedToken?await googlePlayTokenHash(relatedToken):null;
  if(relatedHash&&(relatedHash===hash||await tokenDeleted(env,relatedHash)))fail('google_play_account_mismatch','This purchase cannot be restored to this account.',409);
  const related=relatedHash?await db.prepare('SELECT * FROM bb_google_play_subscriptions WHERE token_hash=?').bind(relatedHash).first():null;
  // A predecessor still being verified cannot be treated as an unrelated
  // lineage. Reject until its immutable ownership is recorded; otherwise a
  // delayed predecessor response could resurrect a second current head.
  if(relatedHash&&!related)fail('google_play_previous_purchase_unverified','Restore the original purchase before restoring its replacement, then try again.',409);
  if(related&&(related.user_id!==userId||related.obfuscated_account_id!==accountId))fail('google_play_account_mismatch','This replacement belongs to another BasketBoss account.',409);
  // Play-center resubscriptions can omit the new account identifier. Capture
  // Google's verified expired token + account linkage before acknowledgment
  // removes that context. Subsequent reads can use our immutable token binding.
  const returnedAccount=purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  const expiredAccount=purchase.outOfAppPurchaseContext?.expiredExternalAccountIdentifiers?.obfuscatedExternalAccountId;
  const inherited=returnedAccount===undefined&&(existing||(related&&purchase.outOfAppPurchaseContext?.expiredPurchaseToken&&expiredAccount===accountId));
  const boundPurchase=inherited?{...purchase,externalAccountIdentifiers:{...purchase.externalAccountIdentifiers,obfuscatedExternalAccountId:accountId}}:purchase;
  const state=evaluateGooglePlaySubscription(config,boundPurchase,accountId,userId);
  // Changing plans is outside this first integration. A deferred/pending
  // replacement must not retire an existing paid period before it completes.
  if(related&&['pending','pending_canceled'].includes(state.status))fail('google_play_verification_pending','The replacement payment is still pending. Your existing subscription remains available.',409);
  const lineageId=existing?.lineage_id||related?.lineage_id||hash,actorHash=await digestDeletionActor(userId);
  const safe=`EXISTS(SELECT 1 FROM bb_google_play_account_tokens WHERE user_id=? AND obfuscated_account_id=?)
   AND NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)
   AND EXISTS(SELECT 1 FROM bb_google_play_leases WHERE token_hash=? AND generation=? AND locked_until_ms>?)`;
  const guard=[userId,accountId,actorHash,hash,generation,Date.now()];
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO bb_google_play_lineages(lineage_id,user_id,obfuscated_account_id,head_token_hash) SELECT ?,?,?,? WHERE ${safe}`)
    .bind(lineageId,userId,accountId,hash,...guard),
   db.prepare(`UPDATE bb_google_play_lineages SET head_token_hash=? WHERE lineage_id=? AND user_id=? AND obfuscated_account_id=? AND head_token_hash IN (?,?) AND ${safe}`)
    .bind(hash,lineageId,userId,accountId,hash,relatedHash||hash,...guard),
   db.prepare(`INSERT INTO bb_google_play_subscriptions(token_hash,purchase_token,user_id,obfuscated_account_id,lineage_id,product_id,base_plan_id,offer_id,plan,status,environment,expires_at_ms,cancel_at_period_end,acknowledged,reconciliation_generation,last_verified_at_ms)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${safe} AND EXISTS(SELECT 1 FROM bb_google_play_lineages WHERE lineage_id=? AND user_id=? AND head_token_hash=?)
    ON CONFLICT(token_hash) DO UPDATE SET product_id=excluded.product_id,base_plan_id=excluded.base_plan_id,offer_id=excluded.offer_id,plan=excluded.plan,status=excluded.status,
    environment=excluded.environment,expires_at_ms=excluded.expires_at_ms,cancel_at_period_end=excluded.cancel_at_period_end,acknowledged=excluded.acknowledged,
    reconciliation_generation=excluded.reconciliation_generation,last_verified_at_ms=excluded.last_verified_at_ms
    WHERE bb_google_play_subscriptions.user_id=excluded.user_id AND bb_google_play_subscriptions.obfuscated_account_id=excluded.obfuscated_account_id AND bb_google_play_subscriptions.replaced_by_hash IS NULL`)
    .bind(hash,purchaseToken,userId,accountId,lineageId,state.productId,state.basePlanId,state.offerId,state.plan,state.status,state.environment,state.expiresAtMs,Number(state.cancelAtPeriodEnd),Number(state.acknowledged),generation,state.lastVerifiedAtMs,...guard,lineageId,userId,hash),
   db.prepare(`UPDATE bb_google_play_subscriptions SET replaced_by_hash=? WHERE lineage_id=? AND token_hash<>? AND replaced_by_hash IS NULL AND ${safe}
    AND EXISTS(SELECT 1 FROM bb_google_play_subscriptions WHERE token_hash=? AND reconciliation_generation=?) AND EXISTS(SELECT 1 FROM bb_google_play_lineages WHERE lineage_id=? AND head_token_hash=?)`)
    .bind(hash,lineageId,hash,...guard,hash,generation,lineageId,hash)
  ]);
  let saved=await db.prepare('SELECT * FROM bb_google_play_subscriptions WHERE token_hash=?').bind(hash).first();
  if(!saved||saved.user_id!==userId||saved.reconciliation_generation!==generation||saved.replaced_by_hash)
   fail('google_play_purchase_replaced','This purchase was replaced or could not be safely verified. Restore the current purchase.',409);
  if(!saved.acknowledged&&['active','canceled','grace_period'].includes(saved.status)&&saved.expires_at_ms>Date.now()){
   await api.acknowledge(purchaseToken,state.productId);
   await db.prepare(`UPDATE bb_google_play_subscriptions SET acknowledged=1 WHERE token_hash=? AND reconciliation_generation=? AND ${safe}
    AND replaced_by_hash IS NULL AND EXISTS(SELECT 1 FROM bb_google_play_lineages WHERE lineage_id=? AND head_token_hash=?)`)
    .bind(hash,generation,...guard,lineageId,hash).run();
   saved=await db.prepare('SELECT * FROM bb_google_play_subscriptions WHERE token_hash=?').bind(hash).first();
   if(!saved||saved.acknowledged!==1||saved.reconciliation_generation!==generation||await isAccountDeleting(env,userId))fail('google_play_verification_pending','Purchase confirmation is awaiting a safe retry.',409);
  }
  return saved;
 }finally{
  await db.prepare('UPDATE bb_google_play_leases SET locked_until_ms=0 WHERE token_hash=? AND generation=?').bind(hash,generation).run();
 }
}
export async function readGooglePlayEntitlement(env,userId){
 const config=getVerifiedGooglePlayConfig(env);if(!config||!googlePlayUserAllowed(config,userId))return null;
 await assertGooglePlayAccountReady(env,config,userId);
 const rows=(await env.BILLING_DB.prepare('SELECT * FROM bb_google_play_subscriptions WHERE user_id=? AND replaced_by_hash IS NULL ORDER BY last_verified_at_ms DESC LIMIT 21').bind(userId).all()).results||[];
 if(rows.length>20)fail('google_play_account_unavailable','Google Play subscription records require support review.');
 const results=[];let error;
 for(let row of rows){
  if(row.environment==='test'&&!config.testUsers.includes(userId.toLowerCase())||row.environment==='production'&&config.mode!=='live')continue;
  // Tokens cannot be queried beyond 60 days after expiry. Old inactive history
  // is never sufficient to grant access and need not make current access fail.
  try{
   if(row.expires_at_ms>Date.now()-60*86400000&&(!row.acknowledged||Date.now()-row.last_verified_at_ms>=REFRESH_MS))row=await reconcileGooglePlayPurchase(env,config,userId,row.purchase_token);
   const entitlement=googlePlayEntitlementFromRow(config,row);if(entitlement)results.push(entitlement);
  }catch(caught){error ||= caught;}
 }
 // A personal license test must not hide an independently verified production
 // membership when household callers apply their production-only requirement.
 const active=results.find(item=>item.premiumAccess&&item.environment==='production')||results.find(item=>item.premiumAccess);
 if(active)return active;
 if(error)throw error;
 // A newer terminal record cannot hide a different subscription whose payment
 // can still complete or resume. Checkout callers must see that management
 // state even though it grants no paid access.
 return results.find(item=>['pending','on_hold','paused'].includes(item.status))||results[0]||null;
}
