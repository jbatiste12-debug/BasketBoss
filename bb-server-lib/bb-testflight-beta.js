/* Temporary beta access is a server grant, never a client tier or a purchase.
 * Keep only a hash of Apple's verified app transaction, not its signed payload.
 * A Sandbox app transaction proves Apple sandbox acquisition; Apple does not
 * include a distinct TestFlight claim. Native receipt checks are presentation. */
import {APPLE_BUNDLE_ID,AppleBillingError,validateAppleJWS,getAppleAppTransactionVerifier,classifyAppleVerificationFailure} from './bb-apple-subscriptions.js';
import {digestHex} from './bb-billing.js';
import {ensureDeletionSchema,isAccountDeleting,digestDeletionActor} from './bb-account-deletion.js';
export const TESTFLIGHT_BETA_END_MS=Date.parse('2027-02-01T00:00:00.000Z');
export const TESTFLIGHT_BETA_TERM_MS=90*24*60*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const initialized=new WeakSet();
export const testFlightBetaEnabled=(env,now=Date.now())=>env.BB_TESTFLIGHT_BETA_ENABLED!=='false'&&Number.isSafeInteger(now)&&now<TESTFLIGHT_BETA_END_MS;
const fail=(code,message,status=503)=>{throw new AppleBillingError(code,message,status);};
const APPLE_VERIFY_REFERENCES=new Set([
 ...['VERIFICATION_FAILURE','RETRYABLE_VERIFICATION_FAILURE','INVALID_APP_IDENTIFIER','INVALID_ENVIRONMENT','INVALID_CHAIN_LENGTH','INVALID_CERTIFICATE','FAILURE','UNEXPECTED','TIMEOUT','REQUEST_FORMAT'].map(label=>'BB_BETA_APPLE_VERIFY_'+label),
 ...['CONFIGURATION','ENVIRONMENT','BUNDLE_ID','APP_ID','APP_TRANSACTION_ID','APPLICATION_VERSION','RECEIPT_CREATION_DATE'].map(label=>'BB_BETA_APPLE_CLAIM_'+label)
]);
export function testFlightBetaFailureReference(error){
 let reference;try{reference=error?.betaReference;}catch{return null;}
 return typeof reference==='string'&&APPLE_VERIFY_REFERENCES.has(reference)?reference:null;
}
function appleProofError(code,message,status,reference){
 if(!APPLE_VERIFY_REFERENCES.has(reference))throw Error('Invalid fixed Apple proof diagnostic');
 const error=new AppleBillingError(code,message+' Reference: '+reference+'.',status);
 error.betaReference=reference;return error;
}
export async function ensureTestFlightBetaSchema(env){
 const db=env.BILLING_DB;
 if(!db?.prepare||!db?.batch)fail('testflight_beta_unavailable','Beta Premium is temporarily unavailable.');
 if(initialized.has(db))return;
 try{
  await db.batch([
   db.prepare(`CREATE TABLE IF NOT EXISTS bb_testflight_beta_grants (
    proof_hash TEXT PRIMARY KEY,user_id TEXT UNIQUE,started_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,application_version TEXT NOT NULL,
    receipt_created_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER)`),
   db.prepare('CREATE INDEX IF NOT EXISTS bb_testflight_beta_grants_user ON bb_testflight_beta_grants(user_id)')
  ]);
  await db.prepare('SELECT proof_hash,user_id,started_at_ms,expires_at_ms,application_version,receipt_created_at_ms,revoked_at_ms FROM bb_testflight_beta_grants LIMIT 0').all();
 }catch{fail('testflight_beta_unavailable','Beta Premium is temporarily unavailable.');}
 initialized.add(db);
}
export function validateTestFlightAppClaims(env,claims,now=Date.now()){
 const configuredAppId=env.APPLE_APP_ID===undefined||env.APPLE_APP_ID===''?null:Number(env.APPLE_APP_ID);
 if(configuredAppId!==null&&(!Number.isSafeInteger(configuredAppId)||configuredAppId<=0))
  throw appleProofError('testflight_beta_unavailable','Beta Premium is temporarily unavailable.',503,'BB_BETA_APPLE_CLAIM_CONFIGURATION');
 let reason=null;
 if(claims?.receiptType!=='Sandbox')reason='ENVIRONMENT';
 else if(claims.bundleId!==APPLE_BUNDLE_ID)reason='BUNDLE_ID';
 else if(configuredAppId!==null&&claims.appAppleId!==undefined&&claims.appAppleId!==configuredAppId||claims.appAppleId!==undefined&&(!Number.isSafeInteger(claims.appAppleId)||claims.appAppleId<=0))reason='APP_ID';
 else if(typeof claims.appTransactionId!=='string'||!/^\d{1,80}$/.test(claims.appTransactionId))reason='APP_TRANSACTION_ID';
 else if(typeof claims.applicationVersion!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(claims.applicationVersion))reason='APPLICATION_VERSION';
 else if(!Number.isSafeInteger(claims.receiptCreationDate)||claims.receiptCreationDate<=0||claims.receiptCreationDate>now+300000)reason='RECEIPT_CREATION_DATE';
 if(reason)throw appleProofError('testflight_beta_invalid_proof','This Apple app transaction is not eligible for Beta Premium.',403,'BB_BETA_APPLE_CLAIM_'+reason);
 return claims;
}
export async function verifyTestFlightAppTransaction(env,signed,{verifier,now=Date.now()}={}){
 try{validateAppleJWS(signed);}catch(error){
  if(error instanceof AppleBillingError)throw appleProofError(error.code,error.message,error.status,'BB_BETA_APPLE_VERIFY_REQUEST_FORMAT');throw error;
 }
 const service=verifier||await getAppleAppTransactionVerifier();
 let timer,claims;
 try{
  claims=await Promise.race([service.verifyAndDecodeAppTransaction(signed),new Promise((_,reject)=>{timer=setTimeout(()=>reject(appleProofError('testflight_beta_unavailable','Apple app verification is temporarily unavailable.',503,'BB_BETA_APPLE_VERIFY_TIMEOUT')),22000);})]);
 }catch(error){
  if(error instanceof AppleBillingError)throw error;
  const status=await classifyAppleVerificationFailure(error),reference='BB_BETA_APPLE_VERIFY_'+status;
  if(status==='RETRYABLE_VERIFICATION_FAILURE')throw appleProofError('testflight_beta_unavailable','Apple app verification is temporarily unavailable.',503,reference);
  throw appleProofError('testflight_beta_unverified','Apple could not verify this beta installation.',403,reference);
 }finally{clearTimeout(timer);}
 return validateTestFlightAppClaims(env,claims,now);
}
export function testFlightBetaMetadata(row){
 return {expiresAt:new Date(row.expires_at_ms).toISOString(),startedAt:new Date(row.started_at_ms).toISOString(),applicationVersion:row.application_version,environment:'Sandbox'};
}
export async function readTestFlightBetaGrant(env,userId,{now=Date.now()}={}){
 if(!testFlightBetaEnabled(env,now)||!UUID.test(userId||'')||!env.BILLING_DB?.prepare)return null;
 try{
  const row=await env.BILLING_DB.prepare(`SELECT proof_hash,user_id,started_at_ms,expires_at_ms,application_version,revoked_at_ms
   FROM bb_testflight_beta_grants WHERE user_id=? AND revoked_at_ms IS NULL
   AND NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
   .bind(userId,await digestDeletionActor(userId)).first();
  if(!row||row.user_id!==userId||!Number.isSafeInteger(row.started_at_ms)||row.started_at_ms>now||
     !Number.isSafeInteger(row.expires_at_ms)||row.expires_at_ms<=now||row.expires_at_ms>TESTFLIGHT_BETA_END_MS||
     row.expires_at_ms>row.started_at_ms+TESTFLIGHT_BETA_TERM_MS)return null;
  return {premiumAccess:true,provider:'testflight_beta',expiresAtMs:row.expires_at_ms,beta:testFlightBetaMetadata(row)};
 }catch{
  // Optional beta storage being absent/unavailable cannot grant access or take
  // away an independently verified subscription. Activation checks readiness.
  return null;
 }
}
export async function persistTestFlightBetaGrant(env,userId,claims,{now=Date.now()}={}){
 if(!testFlightBetaEnabled(env,now))fail('testflight_beta_ended','The Beta Premium testing period has ended.',410);
 if(!UUID.test(userId||''))fail('authentication_required','Sign in with a confirmed email address.',401);
 validateTestFlightAppClaims(env,claims,now);
 await ensureDeletionSchema(env);await ensureTestFlightBetaSchema(env);
 if(await isAccountDeleting(env,userId))fail('account_deletion_pending','Account deletion is in progress.',409);
 const proofHash=await digestHex('basketboss:testflight-beta:'+APPLE_BUNDLE_ID+':'+claims.appTransactionId);
 const expires=Math.min(now+TESTFLIGHT_BETA_TERM_MS,TESTFLIGHT_BETA_END_MS);
 // Immutable ownership and dates make duplicate/racing taps idempotent and
 // prevent renewal by replay or a second app transaction on the same account.
 await env.BILLING_DB.prepare(`INSERT OR IGNORE INTO bb_testflight_beta_grants
  (proof_hash,user_id,started_at_ms,expires_at_ms,application_version,receipt_created_at_ms)
  SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
  .bind(proofHash,userId,now,expires,claims.applicationVersion,claims.receiptCreationDate,await digestDeletionActor(userId)).run();
 const row=await env.BILLING_DB.prepare('SELECT * FROM bb_testflight_beta_grants WHERE proof_hash=?').bind(proofHash).first();
 if(await isAccountDeleting(env,userId))fail('account_deletion_pending','Account deletion is in progress.',409);
 if(!row||row.user_id!==userId||row.revoked_at_ms!==null)fail('testflight_beta_account_mismatch','This beta installation cannot be activated for this BasketBoss account.',409);
 const grant=await readTestFlightBetaGrant(env,userId,{now});
 if(!grant)fail('testflight_beta_ended','The Beta Premium testing period has ended.',410);
 return grant;
}
