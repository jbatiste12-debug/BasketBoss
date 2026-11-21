/* Server-owned coordination, NEVER an entitlement or a store cancellation API.
 * Native cancellation is an authenticated client report, not signed proof that a
 * store cannot charge later. Pending/uncertain outcomes have no automatic expiry.
 * Legacy compatibility checks existing slots but cannot reserve safely without
 * a start/outcome handshake. Strict mode requires protocol 1 for NEW checkout;
 * verify, restore, status and management must never require an intent.
 */
import {Buffer} from 'node:buffer';
import {authenticatedUser,digestHex,requireSameOrigin} from './bb-billing.js';
import {digestDeletionActor,digestDeletionRef} from './bb-account-deletion.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const PROVIDERS=new Set(['apple','google_play','paddle']);
const MODES=new Set(['test','live']);
const ACTIVE="('prepared','started','pending','unknown')";
const PREPARED_MS=120000;
export class PurchaseIntentError extends Error {
 constructor(code,message,status=409){super(message);this.name='PurchaseIntentError';this.code=code;this.status=status;}
}
const fail=(code,message,status)=>{throw new PurchaseIntentError(code,message,status);};
const unavailable=()=>fail('purchase_intent_unavailable','Purchase coordination is temporarily unavailable. Restore and manage existing purchases remain available.',503);
export const purchaseIntentsEnabled=env=>env.BB_PURCHASE_INTENTS_ENABLED==='true';
export const purchaseIntentsStrict=env=>purchaseIntentsEnabled(env)&&env.BB_PURCHASE_INTENTS_STRICT==='true';

// Absence is the ONLY optional-schema fallback. Transport, SQL or partial-schema
// failures must retry instead of silently bypassing coordination/proof recording.
export async function purchaseIntentSchemaReady(env){
 const db=env.BILLING_DB;if(!db?.prepare||!db?.batch)unavailable();
 try{
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bb_purchase_intent_schema','bb_purchase_intent_slots','bb_purchase_intents','bb_purchase_intent_events','bb_purchase_intent_proofs')").all()).results||[];
  if(!tables.length)return false;
  if(tables.length!==5)unavailable();
  if((await db.prepare('SELECT version FROM bb_purchase_intent_schema WHERE id=1').first())?.version!==1)unavailable();
  for(const query of [
   'SELECT user_id,mode,generation,billing_revision,active_intent_id,updated_at_ms FROM bb_purchase_intent_slots LIMIT 0',
   'SELECT id,user_id,mode,provider,product_id,base_plan_id,offer_id,protocol,generation,phase,version,session_hash,capability_hash,deletion_ref_hash,billing_revision,prepared_expires_at_ms,created_at_ms,updated_at_ms,reference_hash,pending_seen,proof_seen,last_action,last_request_version,cause FROM bb_purchase_intents LIMIT 0',
   'SELECT intent_id,version,phase,action,cause,created_at_ms FROM bb_purchase_intent_events LIMIT 0',
   'SELECT provider,mode,reference_hash,user_id,product_id,intent_id,phase,observed_at_ms FROM bb_purchase_intent_proofs LIMIT 0',
   'SELECT actor_hash FROM bb_account_deletions LIMIT 0',
   'SELECT ref_hash FROM bb_account_deletion_refs LIMIT 0'
  ])await db.prepare(query).all();
  return true;
 }catch(error){if(error instanceof PurchaseIntentError)throw error;unavailable();}
}
export async function assertPurchaseIntentReady(env){
 if(!purchaseIntentsEnabled(env))return false;
 if(!await purchaseIntentSchemaReady(env))unavailable();
 return true;
}

// Authenticate THIS bearer before reading its claims. This also prevents callers
// accidentally passing an unrelated cached user. session_id survives JWT refresh;
// neither client-supplied session IDs nor user_metadata authorize any operation.
export async function purchaseIntentActor(request,env,user){
 if(!purchaseIntentsEnabled(env))return null;
 if(!requireSameOrigin(request))fail('origin_not_allowed','This request is not allowed.',403);
 const verified=await authenticatedUser(request,env);
 if(!verified||user&&verified.id!==user.id)fail('authentication_required','Sign in with a confirmed account.',401);
 const authorization=request.headers.get('Authorization')||'',token=authorization.slice(7);
 try{
  const parts=token.split('.');if(parts.length!==3||parts.some(part=>!part||part.length>16000||!/^[A-Za-z0-9_-]+$/.test(part)))throw Error();
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  const issuer=String(env.SUPABASE_URL||'').replace(/\/$/,'')+'/auth/v1';
  if(!UUID.test(verified.id)||claims.sub!==verified.id||claims.iss!==issuer||!UUID.test(claims.session_id||'')||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())throw Error();
  return Object.freeze({userId:verified.id,sessionHash:await digestHex('basketboss:purchase-intent:session:'+issuer+':'+verified.id+':'+claims.session_id)});
 }catch{fail('purchase_intent_session_unavailable','Sign in again before starting a new purchase.',401);}
}
function actorReady(actor){if(!UUID.test(actor?.userId||'')||!HASH.test(actor?.sessionHash||''))fail('authentication_required','Sign in before starting a purchase.',401);}
function selectionReady({provider,mode,productId,basePlanId=null,offerId=null}){
 if(!PROVIDERS.has(provider)||!MODES.has(mode)||!ID.test(productId||'')||basePlanId!==null&&!ID.test(basePlanId)||offerId!==null&&!ID.test(offerId))fail('invalid_purchase_intent','Choose an available subscription.',400);
 return {provider,mode,productId,basePlanId,offerId};
}
const capabilityHash=value=>digestHex('basketboss:purchase-intent:capability:'+value);
const referenceHash=(provider,mode,value)=>digestHex('basketboss:purchase-intent:reference:'+provider+':'+mode+':'+value);
const actorSafe='NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)';
const refSafe='NOT EXISTS(SELECT 1 FROM bb_account_deletion_refs WHERE ref_hash=bb_purchase_intents.deletion_ref_hash)';
function view(row,capability){
 if(!row)return null;
 return {protocol:1,id:row.id,version:row.version,generation:row.generation,phase:row.phase,provider:row.provider,mode:row.mode,productId:row.product_id,basePlanId:row.base_plan_id??null,offerId:row.offer_id??null,preparedExpiresAt:row.prepared_expires_at_ms,billingRevision:row.billing_revision,...(capability?{capability}:{})};
}
async function barrier(env,actor){
 if(await env.BILLING_DB.prepare('SELECT 1 AS found FROM bb_account_deletions WHERE actor_hash=?').bind(await digestDeletionActor(actor.userId)).first())fail('account_deletion_pending','Account deletion is in progress.',409);
}
async function runBatch(env,list){try{return await env.BILLING_DB.batch(list);}catch(error){if(error instanceof PurchaseIntentError)throw error;unavailable();}}
async function readRow(env,id){return await env.BILLING_DB.prepare('SELECT * FROM bb_purchase_intents WHERE id=?').bind(id).first();}
function expirePreparedStatements(db,actor,mode,now,actorHash){return [
 db.prepare(`UPDATE bb_purchase_intents SET phase='canceled',version=version+1,last_action='expire',last_request_version=version,cause='prepared_expired',updated_at_ms=? WHERE user_id=? AND mode=? AND phase='prepared' AND prepared_expires_at_ms<=? AND id=(SELECT active_intent_id FROM bb_purchase_intent_slots WHERE user_id=? AND mode=?) AND ${actorSafe} AND ${refSafe}`).bind(now,actor.userId,mode,now,actor.userId,mode,actorHash),
 db.prepare(`INSERT OR IGNORE INTO bb_purchase_intent_events(intent_id,version,phase,action,cause,created_at_ms) SELECT id,version,phase,last_action,cause,updated_at_ms FROM bb_purchase_intents WHERE user_id=? AND mode=? AND phase='canceled' AND last_action='expire' AND updated_at_ms=? AND ${actorSafe} AND ${refSafe}`).bind(actor.userId,mode,now,actorHash),
 db.prepare(`UPDATE bb_purchase_intent_slots SET active_intent_id=NULL,updated_at_ms=? WHERE user_id=? AND mode=? AND ${actorSafe} AND EXISTS(SELECT 1 FROM bb_purchase_intents WHERE id=active_intent_id AND phase IN ('canceled','completed') AND ${refSafe})`).bind(now,actor.userId,mode,actorHash)
 ];}

export async function reservePurchaseIntent(env,actor,input={}){
 if(!await assertPurchaseIntentReady(env))return null;
 actorReady(actor);const selection=selectionReady(input),db=env.BILLING_DB,now=Date.now(),actorHash=await digestDeletionActor(actor.userId);
 await barrier(env,actor);
 if(input.protocol!==1){
  if(purchaseIntentsStrict(env))fail('purchase_intent_upgrade_required','Update BasketBoss before starting a new subscription. Restore and manage existing purchases remain available.',426);
  // Compatibility does NOT claim protection against a legacy sheet that opens
  // after this check. No unsafe expiring reservation is invented for old clients.
  await runBatch(env,expirePreparedStatements(db,actor,selection.mode,now,actorHash));
  const current=await readPurchaseIntent(env,actor,{mode:selection.mode});
  if(current)fail('purchase_intent_busy','Another purchase is awaiting confirmation. Restore or manage that purchase before starting another.',409);
  return null;
 }
 const id=crypto.randomUUID(),capability=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const capHash=await capabilityHash(capability),deletionRef=await digestDeletionRef('purchase_intent',id);
 const safe=actorSafe+' AND NOT EXISTS(SELECT 1 FROM bb_account_deletion_refs WHERE ref_hash=?)';
 await runBatch(env,[
  db.prepare(`INSERT INTO bb_purchase_intent_slots(user_id,mode,generation,billing_revision,active_intent_id,updated_at_ms) SELECT ?,?,0,0,NULL,? WHERE ${safe} ON CONFLICT(user_id,mode) DO NOTHING`).bind(actor.userId,selection.mode,now,actorHash,deletionRef),
  ...expirePreparedStatements(db,actor,selection.mode,now,actorHash),
  db.prepare(`INSERT INTO bb_purchase_intents(id,user_id,mode,provider,product_id,base_plan_id,offer_id,protocol,generation,phase,version,session_hash,capability_hash,deletion_ref_hash,billing_revision,prepared_expires_at_ms,created_at_ms,updated_at_ms,last_action)
   SELECT ?,user_id,mode,?,?,?,?,1,generation+1,'prepared',1,?,?,?,billing_revision,?,?,?,'reserve' FROM bb_purchase_intent_slots WHERE user_id=? AND mode=? AND active_intent_id IS NULL AND ${safe}`)
   .bind(id,selection.provider,selection.productId,selection.basePlanId,selection.offerId,actor.sessionHash,capHash,deletionRef,now+PREPARED_MS,now,now,actor.userId,selection.mode,actorHash,deletionRef),
  db.prepare(`UPDATE bb_purchase_intent_slots SET active_intent_id=?,generation=generation+1,updated_at_ms=? WHERE user_id=? AND mode=? AND active_intent_id IS NULL AND ${safe} AND EXISTS(SELECT 1 FROM bb_purchase_intents WHERE id=? AND generation=bb_purchase_intent_slots.generation+1)`)
   .bind(id,now,actor.userId,selection.mode,actorHash,deletionRef,id),
  db.prepare(`INSERT OR IGNORE INTO bb_purchase_intent_events(intent_id,version,phase,action,cause,created_at_ms) SELECT id,version,phase,last_action,cause,updated_at_ms FROM bb_purchase_intents WHERE id=? AND ${actorSafe} AND ${refSafe}`).bind(id,actorHash)
 ]);
 const row=await readRow(env,id);await barrier(env,actor);
 if(!row)fail('purchase_intent_busy','Another purchase is awaiting confirmation. Restore or manage that purchase before starting another.',409);
 return view(row,capability);
}

async function authorized(env,actor,input){
 await assertPurchaseIntentReady(env);if(!purchaseIntentsEnabled(env))fail('purchase_intents_disabled','New purchase coordination is disabled.',503);
 actorReady(actor);
 if(!UUID.test(input?.id||'')||!HASH.test(input?.capability||'')||!Number.isSafeInteger(input.version)||input.version<1)fail('invalid_purchase_intent','A current purchase authorization is required.',400);
 const row=await readRow(env,input.id),hash=await capabilityHash(input.capability);
 if(!row||row.user_id!==actor.userId||row.session_hash!==actor.sessionHash||row.capability_hash!==hash||input.generation!==undefined&&input.generation!==row.generation)fail('purchase_intent_mismatch','This purchase authorization belongs to another account or session.',409);
 await barrier(env,actor);
 if(await env.BILLING_DB.prepare('SELECT 1 AS found FROM bb_account_deletion_refs WHERE ref_hash=?').bind(row.deletion_ref_hash).first())fail('purchase_intent_deleted','This purchase authorization is no longer available.',409);
 return row;
}
function mutationGuard(checkRevision=false){return `id=? AND user_id=? AND session_hash=? AND capability_hash=? AND generation=? AND version=? AND ${actorSafe} AND ${refSafe} AND EXISTS(SELECT 1 FROM bb_purchase_intent_slots WHERE user_id=bb_purchase_intents.user_id AND mode=bb_purchase_intents.mode AND active_intent_id=bb_purchase_intents.id AND generation=bb_purchase_intents.generation${checkRevision?' AND billing_revision=bb_purchase_intents.billing_revision':''})`;}
async function mutationArgs(row,actor){return [row.id,actor.userId,actor.sessionHash,row.capability_hash,row.generation,row.version,await digestDeletionActor(actor.userId)];}
function eventStatement(db,id,version,actorHash){return db.prepare(`INSERT OR IGNORE INTO bb_purchase_intent_events(intent_id,version,phase,action,cause,created_at_ms) SELECT id,version,phase,last_action,cause,updated_at_ms FROM bb_purchase_intents WHERE id=? AND version=? AND ${actorSafe} AND ${refSafe}`).bind(id,version,actorHash);}
async function finishMutation(env,actor,input,old,phase,action){
 const saved=await authorized(env,actor,{...input,version:input.version});
 if(saved.phase!==phase||saved.version!==old.version+1||saved.last_action!==action||saved.last_request_version!==old.version)fail('purchase_intent_changed','Purchase status changed. Refresh before continuing.',409);
 return view(saved,input.capability);
}
export async function startPurchaseIntent(env,actor,input={}){
 const row=await authorized(env,actor,input);
 if(row.phase==='started'&&row.last_action==='start'&&row.last_request_version===input.version){
  const current=await env.BILLING_DB.prepare('SELECT 1 AS found FROM bb_purchase_intent_slots WHERE user_id=? AND mode=? AND active_intent_id=? AND generation=? AND billing_revision=?').bind(actor.userId,row.mode,row.id,row.generation,row.billing_revision).first();
  if(!current)fail('purchase_intent_changed','Membership changed. Refresh before continuing.',409);
  return view(row,input.capability);
 }
 if(row.version!==input.version||row.phase!=='prepared')fail('purchase_intent_changed','Purchase status changed. Refresh before continuing.',409);
 if(row.prepared_expires_at_ms<=Date.now())fail('purchase_intent_expired','Purchase authorization expired. Refresh prices and try again.',409);
 const db=env.BILLING_DB,now=Date.now(),actorHash=await digestDeletionActor(actor.userId);
 await runBatch(env,[
  db.prepare(`UPDATE bb_purchase_intents SET phase='started',version=version+1,last_action='start',last_request_version=version,cause=NULL,updated_at_ms=? WHERE ${mutationGuard(true)} AND phase='prepared' AND prepared_expires_at_ms>? AND pending_seen=0 AND proof_seen=0`).bind(now,...await mutationArgs(row,actor),now),
  eventStatement(db,row.id,row.version+1,actorHash)
 ]);
 return finishMutation(env,actor,input,row,'started','start');
}
async function reportIntent(env,actor,input={},uncreatedPaddle=false){
 const row=await authorized(env,actor,input),outcome=input.outcome;
 if(!['pending','unknown','canceled'].includes(outcome))fail('invalid_purchase_intent_outcome','Use verified purchase proof to complete a purchase.',400);
 const cause=outcome==='canceled'?input.cause:outcome==='pending'?'native_pending':'native_unknown';
 if(outcome==='canceled'&&!['native_user_cancelled','not_launched'].includes(cause))fail('invalid_purchase_intent_outcome','A definite native cancellation result is required.',400);
 if(outcome==='canceled'&&row.provider==='paddle'&&(!uncreatedPaddle||row.reference_hash||!['prepared','started'].includes(row.phase)))fail('purchase_intent_store_confirmation_required','The existing checkout must be canceled and confirmed by its payment provider.',409);
 const action='report:'+outcome;
 if(row.phase===outcome&&row.last_action===action&&row.last_request_version===input.version&&row.cause===cause)return view(row,input.capability);
 if(row.version!==input.version)fail('purchase_intent_changed','Purchase status changed. Refresh before continuing.',409);
 if(outcome==='canceled'&&(row.pending_seen||row.proof_seen||!['prepared','started','unknown'].includes(row.phase)||row.phase==='unknown'&&cause!=='native_user_cancelled'))fail('purchase_intent_unresolved','This purchase is pending or requires verification. Restore or manage it before starting another.',409);
 if(outcome!=='canceled'&&!['started','unknown'].includes(row.phase))fail('purchase_intent_unresolved','This purchase requires verification before its status can change.',409);
 const db=env.BILLING_DB,now=Date.now(),actorHash=await digestDeletionActor(actor.userId);
 await runBatch(env,[
  db.prepare(`UPDATE bb_purchase_intents SET phase=?,version=version+1,pending_seen=CASE WHEN ?='pending' THEN 1 ELSE pending_seen END,last_action=?,last_request_version=version,cause=?,updated_at_ms=? WHERE ${mutationGuard()} AND proof_seen=0 AND pending_seen=0 AND phase IN ('prepared','started','unknown')`)
   .bind(outcome,outcome,action,cause,now,...await mutationArgs(row,actor)),
  eventStatement(db,row.id,row.version+1,actorHash),
  db.prepare(`UPDATE bb_purchase_intent_slots SET active_intent_id=NULL,updated_at_ms=? WHERE user_id=? AND mode=? AND active_intent_id=? AND generation=? AND ${actorSafe} AND EXISTS(SELECT 1 FROM bb_purchase_intents WHERE id=? AND phase='canceled' AND version=? AND ${refSafe})`)
   .bind(now,actor.userId,row.mode,row.id,row.generation,actorHash,row.id,row.version+1)
 ]);
 return finishMutation(env,actor,input,row,outcome,action);
}
export const reportPurchaseIntent=(env,actor,input={})=>reportIntent(env,actor,input);
// Server-only rollback after guards prevent remote creation, or the provider
// DEFINITIVELY rejects creation. Never expose this helper through a client action
// and never use it for timeouts/5xx, unknown results or known payable references.
export const cancelUncreatedPurchaseIntent=(env,actor,input={})=>reportIntent(env,actor,{...input,outcome:'canceled',cause:'not_launched'},true);
export async function readPurchaseIntent(env,actor,{id,mode}={}){
 if(!await assertPurchaseIntentReady(env))return null;actorReady(actor);await barrier(env,actor);
 if(id!==undefined&&!UUID.test(id)||id===undefined&&!MODES.has(mode))fail('invalid_purchase_intent','A valid purchase authorization is required.',400);
 const row=id?await readRow(env,id):await env.BILLING_DB.prepare('SELECT i.* FROM bb_purchase_intent_slots s JOIN bb_purchase_intents i ON i.id=s.active_intent_id WHERE s.user_id=? AND s.mode=?').bind(actor.userId,mode).first();
 if(!row||row.user_id!==actor.userId)return null;
 if(await env.BILLING_DB.prepare('SELECT 1 AS found FROM bb_account_deletion_refs WHERE ref_hash=?').bind(row.deletion_ref_hash).first())return null;
 return view(row);
}

// Server-only: append these statements AFTER the verified provider persistence
// statements in the SAME D1 batch. guardSQL/guardBindings must establish that its
// ownership-safe provider write actually succeeded; they must never be client SQL.
// Missing/invalid correlation never rejects paid proof and never clears a newer
// slot. A trustedIntentId is ONLY a store-verified per-attempt identifier (e.g.
// Play obfuscatedExternalProfileId), never a raw client intentId.
export async function proofStatements(env,{userId,provider,mode,productId,reference,phase='completed',trustedIntentId=null,reservation=null,actor=null,guardSQL='1',guardBindings=[]}={}){
 if(!purchaseIntentsEnabled(env))return [];
 if(!await purchaseIntentSchemaReady(env))return [];
 selectionReady({provider,mode,productId});
 if(!UUID.test(userId||'')||typeof reference!=='string'||!reference||reference.length>16384||!['pending','completed','canceled','unknown'].includes(phase)||typeof guardSQL!=='string'||!guardSQL||!Array.isArray(guardBindings))fail('invalid_purchase_intent_proof','Invalid verified purchase correlation.',500);
 const db=env.BILLING_DB,now=Date.now(),hash=await referenceHash(provider,mode,reference),actorHash=await digestDeletionActor(userId),proofRef=await digestDeletionRef('purchase_intent_proof',hash);
 let match='0',matchArgs=[];
 const known=await db.prepare('SELECT intent_id FROM bb_purchase_intent_proofs WHERE provider=? AND mode=? AND reference_hash=? AND user_id=?').bind(provider,mode,hash,userId).first();
 const bound=known?.intent_id?await readRow(env,known.intent_id):await db.prepare('SELECT * FROM bb_purchase_intents WHERE provider=? AND mode=? AND reference_hash=? AND user_id=?').bind(provider,mode,hash,userId).first();
 if(bound){match='id=?';matchArgs=[bound.id];}
 else if(UUID.test(trustedIntentId||'')){match='id=?';matchArgs=[trustedIntentId];}
 else if(actor?.userId===userId&&HASH.test(actor?.sessionHash||'')&&UUID.test(reservation?.id||'')&&HASH.test(reservation?.capability||'')&&Number.isSafeInteger(reservation.version)&&Number.isSafeInteger(reservation.generation)){
  match='id=? AND session_hash=? AND capability_hash=? AND version=? AND generation=?';
  matchArgs=[reservation.id,actor.sessionHash,await capabilityHash(reservation.capability),reservation.version,reservation.generation];
 }
 const safe=`${actorSafe} AND NOT EXISTS(SELECT 1 FROM bb_account_deletion_refs WHERE ref_hash=?) AND (${guardSQL})`;
 const safeArgs=[actorHash,proofRef,...guardBindings];
 const proofExists=`EXISTS(SELECT 1 FROM bb_purchase_intent_proofs p WHERE p.provider=? AND p.mode=? AND p.reference_hash=? AND p.user_id=? AND p.product_id=? AND p.observed_at_ms=?)`;
 const proofArgs=[provider,mode,hash,userId,productId,now];
 return [
  db.prepare(`INSERT INTO bb_purchase_intent_proofs(provider,mode,reference_hash,user_id,product_id,intent_id,phase,observed_at_ms) SELECT ?,?,?,?,?,NULL,?,? WHERE ${safe}
   ON CONFLICT(provider,mode,reference_hash) DO UPDATE SET phase=excluded.phase,observed_at_ms=excluded.observed_at_ms WHERE bb_purchase_intent_proofs.user_id=excluded.user_id AND bb_purchase_intent_proofs.product_id=excluded.product_id AND excluded.observed_at_ms>=bb_purchase_intent_proofs.observed_at_ms`)
   .bind(provider,mode,hash,userId,productId,phase,now,...safeArgs),
  db.prepare(`INSERT INTO bb_purchase_intent_slots(user_id,mode,generation,billing_revision,active_intent_id,updated_at_ms) SELECT ?,?,0,1,NULL,? WHERE ${safe} AND ${proofExists}
   ON CONFLICT(user_id,mode) DO UPDATE SET billing_revision=billing_revision+1,updated_at_ms=excluded.updated_at_ms`)
   .bind(userId,mode,now,...safeArgs,...proofArgs),
  db.prepare(`UPDATE bb_purchase_intents SET reference_hash=COALESCE(reference_hash,?),proof_seen=1,pending_seen=CASE WHEN ?='pending' THEN 1 ELSE pending_seen END,
   phase=CASE WHEN phase='completed' OR ?='completed' THEN 'completed' WHEN ?='canceled' THEN 'canceled' WHEN phase IN ${ACTIVE} AND EXISTS(SELECT 1 FROM bb_purchase_intent_slots s WHERE s.user_id=bb_purchase_intents.user_id AND s.mode=bb_purchase_intents.mode AND s.active_intent_id=bb_purchase_intents.id AND s.generation=bb_purchase_intents.generation) THEN ? ELSE phase END,
   version=version+1,last_action='proof',last_request_version=NULL,cause=?,updated_at_ms=?
   WHERE (${match}) AND user_id=? AND provider=? AND mode=? AND product_id=? AND (reference_hash IS NULL OR reference_hash=?) AND ${refSafe} AND ${safe} AND ${proofExists}
   AND NOT EXISTS(SELECT 1 FROM bb_purchase_intents other WHERE other.provider=? AND other.mode=? AND other.reference_hash=? AND other.id<>bb_purchase_intents.id)`)
   .bind(hash,phase,phase,phase,phase,'verified_'+phase,now,...matchArgs,userId,provider,mode,productId,hash,...safeArgs,...proofArgs,provider,mode,hash),
  db.prepare(`UPDATE bb_purchase_intent_proofs SET intent_id=(SELECT id FROM bb_purchase_intents WHERE reference_hash=? AND provider=? AND mode=? AND user_id=? AND product_id=? AND ${refSafe}) WHERE provider=? AND mode=? AND reference_hash=? AND user_id=? AND intent_id IS NULL AND ${safe} AND ${proofExists}`)
   .bind(hash,provider,mode,userId,productId,provider,mode,hash,userId,...safeArgs,...proofArgs),
  db.prepare(`INSERT OR IGNORE INTO bb_purchase_intent_events(intent_id,version,phase,action,cause,created_at_ms) SELECT id,version,phase,last_action,cause,updated_at_ms FROM bb_purchase_intents WHERE reference_hash=? AND provider=? AND mode=? AND user_id=? AND last_action='proof' AND updated_at_ms=? AND ${refSafe} AND ${safe} AND ${proofExists}`)
   .bind(hash,provider,mode,userId,now,...safeArgs,...proofArgs),
  db.prepare(`UPDATE bb_purchase_intent_slots SET active_intent_id=NULL,updated_at_ms=? WHERE user_id=? AND mode=? AND ${safe} AND ${proofExists}
   AND EXISTS(SELECT 1 FROM bb_purchase_intents WHERE id=bb_purchase_intent_slots.active_intent_id AND generation=bb_purchase_intent_slots.generation AND reference_hash=? AND provider=? AND phase IN ('completed','canceled') AND proof_seen=1 AND ${refSafe})`)
   .bind(now,userId,mode,...safeArgs,...proofArgs,hash,provider)
 ];
}
export const purchaseIntentProofStatements=proofStatements;

// Bind a known provider reference after its server-side creation. This is not
// proof of payment and does not release the slot or permit an uncertain retry.
export async function associatePurchaseIntentReference(env,actor,input={}){
 const row=await authorized(env,actor,input);
 if(!['started','unknown','pending'].includes(row.phase)||typeof input.reference!=='string'||!input.reference||input.reference.length>16384)fail('purchase_intent_changed','Purchase status changed. Reconcile the existing purchase.',409);
 const hash=await referenceHash(row.provider,row.mode,input.reference),actorHash=await digestDeletionActor(actor.userId),db=env.BILLING_DB;
 if(row.reference_hash===hash&&(row.version===input.version||row.last_action==='reference'&&row.last_request_version===input.version))return view(row,input.capability);
 if(row.version!==input.version)fail('purchase_intent_changed','Purchase status changed. Reconcile the existing purchase.',409);
 await runBatch(env,[
  db.prepare(`UPDATE bb_purchase_intents SET reference_hash=?,version=version+1,last_action='reference',last_request_version=version,updated_at_ms=? WHERE ${mutationGuard()} AND reference_hash IS NULL`).bind(hash,Date.now(),...await mutationArgs(row,actor)),
  eventStatement(db,row.id,row.version+1,actorHash)
 ]);
 return finishMutation(env,actor,input,row,row.phase,'reference');
}
