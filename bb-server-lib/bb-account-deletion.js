/* Server-only deletion journal. Hashes suppress late billing events; identifiers
 * exist only while a deletion needs retry. No passwords/tokens are persisted. */
import {digestHex,paddleApi,billingMode} from './bb-billing.js';
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
const billingStages=new Set(['entitlements_read','claims_read','transaction_read','transaction_cancel','claim_linkage','subscription_reference','subscription_read','subscription_cancel']);
const billingReasons=new Set(['disabled','credential_missing','transport','timeout','http','response_invalid','database','table_missing','columns_missing','invalid_reference','transaction_mismatch','claim_mismatch','subscription_mismatch','cancellation_unconfirmed','checkout_pending','unknown']);
const billingColumns=new Set(['paddle_subscription_id','user_id','claim_id','transaction_id','claim_state','slot_no']);
export function accountDeletionBillingDiagnostic(value){
 if(!value||!billingStages.has(value.stage)||!billingReasons.has(value.reason)||!['live','sandbox'].includes(value.mode))return null;
 const safe={stage:value.stage,reason:value.reason,mode:value.mode};
 if(Number.isInteger(value.status)&&value.status>=100&&value.status<=599)safe.status=value.status;
 if(value.reason==='columns_missing'&&Array.isArray(value.missing)){
  const missing=[...new Set(value.missing.filter(name=>typeof name==='string'&&billingColumns.has(name)))].slice(0,billingColumns.size);
  if(missing.length)safe.missing=missing;
 }
 return safe;
}
async function cancelSubscription(id,provider,fail){
 if(!subscriptionId(id))fail('subscription_reference','invalid_reference','billing_reconciliation_required');
 let subscription=await provider('subscription_read','/subscriptions/'+id);
 if(subscription?.id!==id)fail('subscription_read','subscription_mismatch','billing_reconciliation_required');
 if(subscription.status==='canceled')return;
 subscription=await provider('subscription_cancel','/subscriptions/'+id+'/cancel','POST',{effective_from:'immediately'});
 if(subscription?.id!==id||subscription.status!=='canceled')fail('subscription_cancel','cancellation_unconfirmed','billing_cancellation_pending');
}
export async function cancelAccountBilling(env,userId,{onFailure}={}){
 const db=env.BILLING_DB;
 const report=value=>{const safe=accountDeletionBillingDiagnostic({...value,mode:billingMode(env)});if(safe)try{onFailure?.(safe);}catch{}};
 const fail=(stage,reason,message)=>{report({stage,reason});throw Error(message);};
 const provider=async(stage,path,method='GET',body)=>{
  let reported=false;
  try{return await paddleApi(env,path,method,body,{onFailure:value=>{reported=true;report({stage,...value});}});}
  catch(error){if(!reported)report({stage,reason:'unknown'});throw error;}
 };
 const readRows=async(stage,table,columns,query)=>{
  try{return (await db.prepare(query).bind(userId).all()).results||[];}
  catch(error){
   // Inspect only fixed table metadata after a failed read. Diagnostics must
   // never initialize billing tables or replace the original failure.
   let reason='database',missing;
   try{
    const present=await db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
    if(!present)reason='table_missing';
    else{
     const wanted=columns.map(name=>"'"+name+"'").join(',');
     const schema=(await db.prepare("SELECT name FROM pragma_table_info('"+table+"') WHERE lower(name) IN ("+wanted+") LIMIT "+columns.length).all()).results;
     if(Array.isArray(schema)){const names=new Set(schema.filter(row=>typeof row?.name==='string').map(row=>row.name.toLowerCase()));missing=columns.filter(name=>!names.has(name));if(missing.length)reason='columns_missing';}
    }
   }catch{}
   report({stage,reason,missing});throw error;
  }
 };
 const entitlements=await readRows('entitlements_read','bb_paid_entitlements',['paddle_subscription_id','user_id'],'SELECT paddle_subscription_id FROM bb_paid_entitlements WHERE user_id=?');
 const claims=await readRows('claims_read','bb_billing_claims',['claim_id','user_id','transaction_id','claim_state','slot_no'],'SELECT claim_id,transaction_id,claim_state,slot_no FROM bb_billing_claims WHERE user_id=?');
 const subscriptions=new Set(entitlements.map(row=>row.paddle_subscription_id)),confirmedSlots=new Set();
 for(const claim of claims){
  // An in-flight/ambiguous checkout must remain recoverable until Paddle has
  // confirmed its outcome. Never erase evidence and silently leave a charge.
  if(!claim.transaction_id){if(claim.claim_state!=='subscription_linked')fail('claim_linkage','checkout_pending','billing_checkout_pending');continue;}
  if(!transactionId(claim.transaction_id))fail('claim_linkage','invalid_reference','billing_reconciliation_required');
  const path='/transactions/'+claim.transaction_id;
  let transaction=await provider('transaction_read',path);
  if(transaction?.id!==claim.transaction_id)fail('claim_linkage','transaction_mismatch','billing_reconciliation_required');
  if(transaction.custom_data?.bb_claim_id!==claim.claim_id)fail('claim_linkage','claim_mismatch','billing_reconciliation_required');
  if(subscriptionId(transaction.subscription_id)){subscriptions.add(transaction.subscription_id);if(Number.isInteger(claim.slot_no))confirmedSlots.add(claim.slot_no);}
  if(['draft','ready'].includes(transaction.status)){
   transaction=await provider('transaction_cancel',path,'PATCH',{status:'canceled'});
   if(transaction?.id!==claim.transaction_id||transaction.status!=='canceled')fail('claim_linkage','cancellation_unconfirmed','billing_cancellation_pending');
  }else if(transaction.status!=='canceled'){
   if(!subscriptionId(transaction.subscription_id))fail('claim_linkage','checkout_pending','billing_checkout_pending');
   subscriptions.add(transaction.subscription_id);
  }
 }
 for(const id of subscriptions)await cancelSubscription(id,provider,fail);
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
 // Keep only a hash tombstone so a deleted installation proof cannot be
 // replayed to mint a new beta grant for another or recreated account.
 if(await tableExists('bb_testflight_beta_grants'))statements.push(db.prepare(`UPDATE bb_testflight_beta_grants
  SET user_id=NULL,revoked_at_ms=?,application_version='',receipt_created_at_ms=0 WHERE user_id=?`).bind(Date.now(),userId));
 if(await tableExists('bb_weekly_shop_trips'))statements.push(db.prepare('DELETE FROM bb_weekly_shop_trips WHERE actor_hash=?').bind(await digestDeletionActor(userId)));
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
