/* Server-only Founder reservations. Apple Production and Paddle share the same
 * immutable 25-place pool. No TTL or browser cancellation can free an Apple
 * hold: a pending Ask-to-Buy transaction may complete after the app closes.
 * Confirmation receives only already Apple-verified ownership, never client
 * entitlement flags. Subscription access remains the Apple verifier's decision.
 */
import {digestHex} from './bb-billing.js';
import {ensureDeletionSchema,digestDeletionActor,isAccountDeleting} from './bb-account-deletion.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const APPLE_FOUNDER_PRODUCT_ID='uk.co.basketboss.premium.founder.monthly';
export class AppleFounderError extends Error {
 constructor(code,message,status=503){super(message);this.name='AppleFounderError';this.code=code;this.status=status;}
}
export const appleFounderEnabled=env=>env.APPLE_BILLING_ENABLED==='true'&&env.APPLE_FOUNDER_ENABLED==='true';
export function appleFounderProductId(env){
 const value=env.APPLE_FOUNDER_PRODUCT_ID||APPLE_FOUNDER_PRODUCT_ID;
 if(typeof value!=='string'||!/^uk\.co\.basketboss\.[A-Za-z0-9.-]{1,180}$/.test(value))throw new AppleFounderError('FOUNDER_CONFIGURATION','The Apple Founder product is not configured.');
 return value;
}
function environmentName(value){if(!['Production','Sandbox'].includes(value))throw new AppleFounderError('FOUNDER_ENVIRONMENT','The Apple purchase environment is invalid.',400);return value;}
function userID(value){if(!UUID.test(value||''))throw new AppleFounderError('FOUNDER_ACCOUNT','Sign in to a valid BasketBoss account.',401);return value.toLowerCase();}
function tokenID(value){if(!UUID.test(value||''))throw new AppleFounderError('FOUNDER_TOKEN','The Apple account token is invalid.',400);return value.toLowerCase();}
const pool=environment=>environment==='Production'?'bb_founder_slots':'bb_apple_founder_sandbox_slots';
function configuredDB(env){if(!env.BILLING_DB?.prepare||!env.BILLING_DB?.batch)throw new AppleFounderError('FOUNDER_DATABASE','Founder availability cannot be checked right now.');return env.BILLING_DB;}
function sandboxActorAllowed(env,user,environment){
 if(environment==='Sandbox'&&!String(env.APPLE_SANDBOX_USER_IDS||'').split(',').map(x=>x.trim().toLowerCase()).includes(user))throw new AppleFounderError('FOUNDER_SANDBOX_ACCOUNT','This account is not enabled for Apple sandbox testing.',403);
}
async function currentClaim(db,user,environment){return db.prepare('SELECT * FROM bb_apple_founder_claims WHERE environment=? AND user_id=?').bind(environment,user).first();}
async function validateClaim(db,claim,user,token,environment){
 if(!claim||claim.environment!==environment||claim.user_id!==user||claim.app_account_token!==token)throw new AppleFounderError('FOUNDER_ACCOUNT_MISMATCH','This Founder reservation belongs to a different account.',409);
 if(!Number.isInteger(claim.slot_no)||claim.slot_no<1||claim.slot_no>25)throw new AppleFounderError('FOUNDER_RECONCILIATION','The Founder reservation needs secure reconciliation.');
 const row=await db.prepare(`SELECT state,user_id,reservation_token_hash,paddle_subscription_id FROM ${pool(environment)} WHERE slot_no=?`).bind(claim.slot_no).first();
 if(!row||row.user_id!==user||row.reservation_token_hash!==claim.reservation_token_hash||row.paddle_subscription_id!=null||!['reserved','active','retired'].includes(row.state))throw new AppleFounderError('FOUNDER_RECONCILIATION','The Founder reservation needs secure reconciliation.');
 if(claim.state==='retired')throw new AppleFounderError('FOUNDER_RETIRED','This Founder account has been retired.',409);
 return row;
}
async function checkedActor(env,user,environment){
 if(env.APPLE_BILLING_ENABLED!=='true')throw new AppleFounderError('APPLE_BILLING_DISABLED','Apple billing is not available.',503);
 sandboxActorAllowed(env,user,environment);await ensureDeletionSchema(env);
 if(await isAccountDeleting(env,user))throw new AppleFounderError('ACCOUNT_DELETING','Account deletion is in progress.',409);
 return digestDeletionActor(user);
}
function translate(error){if(error instanceof AppleFounderError)throw error;throw new AppleFounderError('FOUNDER_DATABASE','Founder availability cannot be verified right now.');}

export async function founderAvailability(env,userId,environment){
 if(!appleFounderEnabled(env))return {enabled:false,available:false,remaining:0,claimed:false,claimState:null,slot:null};
 environment=environmentName(environment);const db=configuredDB(env);
 try{
  const count=await db.prepare(`SELECT count(*) AS remaining FROM ${pool(environment)} WHERE state='available' AND slot_no BETWEEN 1 AND 25`).first();
  const remaining=Math.max(0,Math.min(25,Number(count?.remaining)||0));
  let claim=null;
  if(userId){const user=userID(userId);await checkedActor(env,user,environment);claim=await currentClaim(db,user,environment);if(claim)await validateClaim(db,claim,user,claim.app_account_token,environment);}
  return {enabled:true,available:!!claim||remaining>0,remaining,claimed:!!claim,claimState:claim?.state||null,slot:claim?.slot_no||null};
 }catch(error){return translate(error);}
}

export async function reserveAppleFounder(env,userId,appAccountToken,environment){
 if(!appleFounderEnabled(env))throw new AppleFounderError('FOUNDER_UNAVAILABLE','The Founding Member offer is not available.',409);
 appleFounderProductId(env);environment=environmentName(environment);const user=userID(userId),token=tokenID(appAccountToken),db=configuredDB(env);
 try{
  const actorHash=await checkedActor(env,user,environment);
  let claim=await currentClaim(db,user,environment);
  if(claim){await validateClaim(db,claim,user,token,environment);return {claimId:claim.claim_id,slot:claim.slot_no,appAccountToken:token,environment,reused:true};}
  const claimId=crypto.randomUUID(),hash=await digestHex('basketboss:apple-founder:'+environment+':'+claimId),now=Date.now(),table=pool(environment);
  // The UPDATE and INSERT are a single D1 transaction. A simultaneous Paddle
  // checkout competes for the exact same available slot under the same lock.
  try{
   await db.batch([
    db.prepare(`UPDATE ${table} SET state='reserved',user_id=?,reservation_token_hash=?,reservation_expires_at_ms=NULL,updated_at_ms=?
     WHERE slot_no=(SELECT slot_no FROM ${table} WHERE state='available' AND slot_no BETWEEN 1 AND 25 ORDER BY slot_no LIMIT 1)
       AND state='available' AND NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)
       AND NOT EXISTS (SELECT 1 FROM bb_apple_founder_claims WHERE environment=? AND user_id=?)
     RETURNING slot_no`).bind(user,hash,now,actorHash,environment,user),
    db.prepare(`INSERT INTO bb_apple_founder_claims(claim_id,environment,user_id,app_account_token,slot_no,reservation_token_hash,state,created_at_ms,updated_at_ms)
     SELECT ?,?,?,?,slot_no,?,'reserved',?,? FROM ${table}
     WHERE state='reserved' AND user_id=? AND reservation_token_hash=?
       AND NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?) RETURNING claim_id`)
     .bind(claimId,environment,user,token,hash,now,now,user,hash,actorHash)
   ]);
  }catch(error){
   // A duplicate same-account request may have won; reuse that reservation,
   // never take another place. D1 rolls back the losing batch atomically.
   claim=await currentClaim(db,user,environment);if(!claim)throw error;
  }
  claim=await currentClaim(db,user,environment);
  if(!claim){if(await isAccountDeleting(env,user))throw new AppleFounderError('ACCOUNT_DELETING','Account deletion is in progress.',409);throw new AppleFounderError('FOUNDER_SOLD_OUT','All 25 Founding Member places are claimed or reserved.',409);}
  await validateClaim(db,claim,user,token,environment);
  return {claimId:claim.claim_id,slot:claim.slot_no,appAccountToken:token,environment,reused:claim.claim_id!==claimId};
 }catch(error){return translate(error);}
}

export async function confirmAppleFounder(env,userId,appAccountToken,originalTransactionId,environment){
 // The offer can be switched off after a sheet opens. Honor a previously
 // reserved place and historical restores; do not require a new free place.
 environment=environmentName(environment);const user=userID(userId),token=tokenID(appAccountToken),db=configuredDB(env);
 if(!/^[0-9]{1,64}$/.test(String(originalTransactionId||'')))throw new AppleFounderError('FOUNDER_TRANSACTION','The Apple transaction identifier is invalid.',400);
 const original=String(originalTransactionId);
 try{
  const actorHash=await checkedActor(env,user,environment),claim=await currentClaim(db,user,environment);
  if(!claim)throw new AppleFounderError('FOUNDER_RESERVATION_REQUIRED','A verified Founder reservation is required for this Apple purchase.',409);
  await validateClaim(db,claim,user,token,environment);
  const existing=await db.prepare('SELECT user_id,claim_id FROM bb_apple_founder_transactions WHERE environment=? AND original_transaction_id=?').bind(environment,original).first();
  if(existing&&(existing.user_id!==user||existing.claim_id!==claim.claim_id))throw new AppleFounderError('FOUNDER_TRANSACTION_OWNED','This Apple purchase is already linked to another account.',409);
  const now=Date.now(),table=pool(environment);
  await db.batch([
   db.prepare(`INSERT INTO bb_apple_founder_transactions(environment,original_transaction_id,user_id,claim_id,linked_at_ms)
    SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)
      AND EXISTS (SELECT 1 FROM bb_apple_founder_claims WHERE claim_id=? AND user_id=? AND app_account_token=? AND state IN ('reserved','confirmed'))
    ON CONFLICT(environment,original_transaction_id) DO UPDATE SET linked_at_ms=bb_apple_founder_transactions.linked_at_ms
      WHERE bb_apple_founder_transactions.user_id=excluded.user_id AND bb_apple_founder_transactions.claim_id=excluded.claim_id
    RETURNING original_transaction_id`).bind(environment,original,user,claim.claim_id,now,actorHash,claim.claim_id,user,token),
   db.prepare(`UPDATE ${table} SET state='active',updated_at_ms=?
    WHERE slot_no=? AND user_id=? AND reservation_token_hash=? AND paddle_subscription_id IS NULL AND state IN ('reserved','active')
      AND NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)
      AND EXISTS (SELECT 1 FROM bb_apple_founder_transactions WHERE environment=? AND original_transaction_id=? AND user_id=? AND claim_id=?) RETURNING slot_no`)
     .bind(now,claim.slot_no,user,claim.reservation_token_hash,actorHash,environment,original,user,claim.claim_id),
   db.prepare(`UPDATE bb_apple_founder_claims SET state='confirmed',updated_at_ms=?
    WHERE claim_id=? AND user_id=? AND app_account_token=? AND state IN ('reserved','confirmed')
      AND NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)
      AND EXISTS (SELECT 1 FROM ${table} WHERE slot_no=? AND state='active' AND user_id=? AND reservation_token_hash=?) RETURNING claim_id`)
     .bind(now,claim.claim_id,user,token,actorHash,claim.slot_no,user,claim.reservation_token_hash)
  ]);
  if(await isAccountDeleting(env,user))throw new AppleFounderError('ACCOUNT_DELETING','Account deletion is in progress.',409);
  const linked=await db.prepare('SELECT user_id,claim_id FROM bb_apple_founder_transactions WHERE environment=? AND original_transaction_id=?').bind(environment,original).first();
  const final=await currentClaim(db,user,environment);
  if(linked?.user_id!==user||linked?.claim_id!==claim.claim_id||final?.state!=='confirmed')throw new AppleFounderError('FOUNDER_RECONCILIATION','The Founder purchase needs secure reconciliation.');
  return {confirmed:true,slot:claim.slot_no,claimId:claim.claim_id,reused:!!existing};
 }catch(error){return translate(error);}
}

export async function prepareAppleFounderDeletion(env,userId){
 const db=configuredDB(env),user=userID(userId);
 const present=await db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='bb_apple_founder_claims'").first();
 if(!present)return [];
 // Run these statements BEFORE the existing generic Founder cleanup. Even an
 // unconfirmed Apple hold can still complete remotely, so it must not be sold.
 return [
  ...['Production','Sandbox'].map(environment=>db.prepare(`UPDATE ${pool(environment)} SET state='retired',updated_at_ms=?
   WHERE user_id=? AND slot_no IN (SELECT slot_no FROM bb_apple_founder_claims WHERE environment=? AND user_id=?)`).bind(Date.now(),user,environment,user)),
  db.prepare('DELETE FROM bb_apple_founder_transactions WHERE user_id=?').bind(user),
  db.prepare('DELETE FROM bb_apple_founder_claims WHERE user_id=?').bind(user)
 ];
}
