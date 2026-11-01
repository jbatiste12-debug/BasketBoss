/* Server-only deletion journal. Hashes suppress late billing events; identifiers
 * exist only while a deletion needs retry. No passwords/tokens are persisted. */
import {digestHex,paddleApi} from './bb-billing.js';
export const digestDeletionActor = id => digestHex('basketboss:account-deletion:actor:'+id);
export const digestDeletionRef = (kind,id) => digestHex('basketboss:account-deletion:'+kind+':'+id);
export const digestDeletionRetry = token => digestHex('basketboss:account-deletion:retry:'+token);
const initialized=new WeakSet();
export async function ensureDeletionSchema(env){
 const db=env.BILLING_DB;
 if(!db?.prepare||!db?.batch)throw Error('deletion_database_unavailable');
 if(initialized.has(db))return;
 await db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS bb_account_deletions (
   actor_hash TEXT PRIMARY KEY, retry_hash TEXT NOT NULL, user_id TEXT, email TEXT,
   started_at_ms INTEGER NOT NULL, completed_at_ms INTEGER, locked_until_ms INTEGER NOT NULL DEFAULT 0)`),
  db.prepare('CREATE INDEX IF NOT EXISTS bb_account_deletions_retry ON bb_account_deletions(retry_hash)'),
  db.prepare('CREATE TABLE IF NOT EXISTS bb_account_deletion_refs(ref_hash TEXT PRIMARY KEY)')
 ]);
 initialized.add(db);
}
export async function isAccountDeleting(env,userId){
 await ensureDeletionSchema(env);
 return !!await env.BILLING_DB.prepare('SELECT 1 AS found FROM bb_account_deletions WHERE actor_hash=?').bind(await digestDeletionActor(userId)).first();
}
const serviceKey=env=>env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';
export function deletionConfigured(env){
 return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(String(env.SUPABASE_URL||''))&&
  typeof env.SUPABASE_PUBLISHABLE_KEY==='string'&&serviceKey(env).length>30&&!!env.BILLING_DB?.prepare;
}
export async function deletionRpc(env,name,body={}){
 const key=serviceKey(env);
 const response=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:key,...(/^sb_secret_/.test(key)?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json'},
  body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw Error('deletion_database_unavailable');
 return response.json();
}
export async function deletionReady(env){
 if(!deletionConfigured(env))return false;
 const ready=await deletionRpc(env,'bb_account_deletion_ready');
 return ready?.ready===true&&ready.version===1;
}
export async function reauthenticateDeletion(env,user,password){
 const response=await fetch(env.SUPABASE_URL+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email:user.email,password}),redirect:'manual',signal:AbortSignal.timeout(9000)
 });
 if(!response.ok&&![400,401,403].includes(response.status))throw Error('deletion_auth_unavailable');
 const result=await response.json().catch(()=>null);
 return response.ok&&result?.user?.id===user.id&&!!result.user.email_confirmed_at;
}
const subscriptionId=id=>/^sub_[a-z0-9]{26}$/.test(id||'');
const transactionId=id=>/^txn_[a-z0-9]{26}$/.test(id||'');
async function cancelSubscription(env,id){
 if(!subscriptionId(id))throw Error('billing_reconciliation_required');
 let subscription=await paddleApi(env,'/subscriptions/'+id);
 if(subscription?.id!==id)throw Error('billing_reconciliation_required');
 if(subscription.status==='canceled')return;
 subscription=await paddleApi(env,'/subscriptions/'+id+'/cancel','POST',{effective_from:'immediately'});
 if(subscription?.id!==id||subscription.status!=='canceled')throw Error('billing_cancellation_pending');
}
export async function cancelAccountBilling(env,userId){
 const db=env.BILLING_DB;
 const entitlements=(await db.prepare('SELECT paddle_subscription_id FROM bb_paid_entitlements WHERE user_id=?').bind(userId).all()).results||[];
 const claims=(await db.prepare('SELECT claim_id,transaction_id,claim_state,slot_no FROM bb_billing_claims WHERE user_id=?').bind(userId).all()).results||[];
 const subscriptions=new Set(entitlements.map(row=>row.paddle_subscription_id)),confirmedSlots=new Set();
 for(const claim of claims){
  // An in-flight/ambiguous checkout must remain recoverable until Paddle has
  // confirmed its outcome. Never erase evidence and silently leave a charge.
  if(!claim.transaction_id){if(claim.claim_state!=='subscription_linked')throw Error('billing_checkout_pending');continue;}
  if(!transactionId(claim.transaction_id))throw Error('billing_reconciliation_required');
  const path='/transactions/'+claim.transaction_id;
  let transaction=await paddleApi(env,path);
  if(transaction?.id!==claim.transaction_id||transaction.custom_data?.bb_claim_id!==claim.claim_id)throw Error('billing_reconciliation_required');
  if(subscriptionId(transaction.subscription_id)){subscriptions.add(transaction.subscription_id);if(Number.isInteger(claim.slot_no))confirmedSlots.add(claim.slot_no);}
  if(['draft','ready'].includes(transaction.status)){
   transaction=await paddleApi(env,path,'PATCH',{status:'canceled'});
   if(transaction?.id!==claim.transaction_id||transaction.status!=='canceled')throw Error('billing_cancellation_pending');
  }else if(transaction.status!=='canceled'){
   if(!subscriptionId(transaction.subscription_id))throw Error('billing_checkout_pending');
   subscriptions.add(transaction.subscription_id);
  }
 }
 for(const id of subscriptions)await cancelSubscription(env,id);
 return {claims,subscriptions:[...subscriptions],confirmedSlots:[...confirmedSlots]};
}
export async function eraseAccountD1(env,userId,billing){
 const db=env.BILLING_DB,statements=[];
 for(const claim of billing.claims)statements.push(db.prepare('INSERT OR IGNORE INTO bb_account_deletion_refs(ref_hash) VALUES(?)').bind(await digestDeletionRef('claim',claim.claim_id)));
 for(const id of billing.subscriptions)statements.push(db.prepare('INSERT OR IGNORE INTO bb_account_deletion_refs(ref_hash) VALUES(?)').bind(await digestDeletionRef('subscription',id)));
 for(const slot of billing.confirmedSlots||[])statements.push(db.prepare("UPDATE bb_founder_slots SET state='retired' WHERE slot_no=? AND user_id=?").bind(slot,userId));
 const tableExists=async name=>!!await db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
 const appleSubscriptions=await tableExists('bb_apple_subscriptions');
 if(appleSubscriptions&&await tableExists('bb_apple_notifications'))statements.push(db.prepare(`DELETE FROM bb_apple_notifications
  WHERE EXISTS(SELECT 1 FROM bb_apple_subscriptions s WHERE s.user_id=?
   AND s.environment=bb_apple_notifications.environment
   AND s.original_transaction_id=bb_apple_notifications.original_transaction_id)`).bind(userId));
 if(appleSubscriptions)statements.push(db.prepare('DELETE FROM bb_apple_subscriptions WHERE user_id=?').bind(userId));
 if(await tableExists('bb_apple_account_tokens'))statements.push(db.prepare('DELETE FROM bb_apple_account_tokens WHERE user_id=?').bind(userId));
 statements.push(
  db.prepare(`UPDATE bb_founder_slots SET state=CASE WHEN state='reserved' AND paddle_subscription_id IS NULL THEN 'available' ELSE 'retired' END,
   user_id=NULL,reservation_token_hash=NULL,paddle_subscription_id=NULL,reservation_expires_at_ms=NULL,updated_at_ms=? WHERE user_id=?`).bind(Date.now(),userId),
  db.prepare('DELETE FROM bb_paid_entitlements WHERE user_id=?').bind(userId),
  db.prepare('DELETE FROM bb_billing_claims WHERE user_id=?').bind(userId)
 );
 // Usage is created lazily on the first AI request. An account with no AI
 // history must still be deletable before that optional table exists. The
 // durable actor gate already prevents any in-flight usage write recreating
 // this account's rows if another request creates the table after this check.
 const usage=await db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='bb_ai_daily_usage'").first();
 if(usage)statements.push(db.prepare('DELETE FROM bb_ai_daily_usage WHERE actor=?').bind('user:'+userId));
 await db.batch(statements);
}
