import {json,authenticatedUser,requireSameOrigin} from '../../../bb-server-lib/bb-billing.js';
import {deletionConfigured,deletionReady,deletionRpc,ensureDeletionSchema,digestDeletionActor,digestDeletionRetry,reauthenticateDeletion,cancelAccountBilling,eraseAccountD1} from '../../../bb-server-lib/bb-account-deletion.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messages={
 deletion_database_pending:'Account deletion has not finished yet. Your saved device data has been kept. Retry to finish.',
 deletion_billing_pending:'We could not confirm that your subscription has been cancelled. Your saved device data has been kept. Retry to finish.',
 deletion_checkout_pending:'A previous checkout still needs to be checked before deletion can finish. Your saved device data has been kept. Please retry.',
 deletion_cloud_pending:'The cloud service has not yet confirmed your account deletion. Your saved device data has been kept. Retry to finish.',
 deletion_not_ready:'A server update is preventing deletion from finishing. Your saved device data has been kept. Please retry later.',
 deletion_auth_unavailable:'Your password could not be checked right now. Your saved device data has been kept. Please retry later.',
 deletion_state_unknown:'We could not check whether account deletion has started. Your saved device data has been kept. Please retry.'
};
const pending=(code='deletion_database_pending',status=202)=>json({ok:false,pending:true,code,error:messages[code]||messages.deletion_database_pending},status);
const rejected=(code,error,status,pendingState)=>json({ok:false,...(pendingState===undefined?{}:{pending:pendingState}),code,error},status);
export async function onRequestGet({request,env}){
 if(request&&new URL(request.url).searchParams.get('mode')==='status'){
  // Browsers normally omit Origin on a same-origin GET. Fetch metadata may
  // establish this read-only transport; bearer/actor checks still follow.
  const sameOriginRead=!request.headers.get('Origin')&&request.headers.get('Sec-Fetch-Site')==='same-origin';
  if(!requireSameOrigin(request,true)&&!sameOriginRead)return rejected('deletion_origin_rejected','Origin not allowed',403);
  const token=request.headers.get('Authorization')||'';
  if(!/^Bearer [^\s]+$/.test(token)||token.length>16000)return rejected('deletion_sign_in_required','Sign in to check account deletion.',401);
  const actor=new URL(request.url).searchParams.get('actor');
  if(!UUID.test(actor||''))return rejected('deletion_actor_required','The original account is required to check deletion.',400);
  if(!env.BILLING_DB)return rejected('deletion_state_unknown','Account deletion status could not be checked.',503);
  try{
   const db=env.BILLING_DB;
   const present=await db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='bb_account_deletions'").first();
   const retry=present?await db.prepare('SELECT actor_hash,completed_at_ms FROM bb_account_deletions WHERE retry_hash=?').bind(await digestDeletionRetry(token)).first():null;
   if(retry){
    if(retry.actor_hash!==await digestDeletionActor(actor))return rejected('deletion_actor_changed','Sign in with the original account to check deletion.',403);
    return json({ok:true,deletionState:retry.completed_at_ms?'deleted':'pending'});
   }
   const user=await authenticatedUser(request,env);
   if(!user||!UUID.test(user.id))return rejected('deletion_sign_in_required','Sign in again to check the earlier deletion request.',401);
   if(user.id!==actor)return rejected('deletion_actor_changed','Sign in with the original account to check deletion.',403);
   const row=present?await db.prepare('SELECT completed_at_ms FROM bb_account_deletions WHERE actor_hash=?').bind(await digestDeletionActor(user.id)).first():null;
   return json({ok:true,deletionState:row?(row.completed_at_ms?'deleted':'pending'):'not_started'});
  }catch{return rejected('deletion_state_unknown','Account deletion status could not be checked. Your saved data has been kept.',503);}
 }
 try{return json({ok:true,available:deletionConfigured(env),migrationReady:await deletionReady(env)});}
 catch{return json({ok:true,available:deletionConfigured(env),migrationReady:false});}
}
export async function onRequestPost({request,env}){
 if(!requireSameOrigin(request,true))return rejected('deletion_origin_rejected','Origin not allowed',403);
 if(!deletionConfigured(env))return rejected('deletion_unavailable','Account deletion is temporarily unavailable. Please try again later.',503);
 const token=request.headers.get('Authorization')||'';
 if(!/^Bearer [^\s]+$/.test(token)||token.length>16000)return rejected('deletion_sign_in_required','Sign in to delete your account.',401);
 let body;
 try{
  if(Number(request.headers.get('content-length')||0)>2048)throw Error();
  const reader=request.body?.getReader();if(!reader)throw Error();
  const chunks=[];let size=0;
  for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>2048){await reader.cancel();throw Error();}chunks.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!body||Object.keys(body).some(key=>!['confirmation','password'].includes(key))||body.confirmation!=='DELETE'||typeof body.password!=='string'||body.password.length<1||body.password.length>1024)throw Error();
 }catch{return rejected('deletion_confirmation_required','Enter DELETE and your current password to confirm.',400);}
 let row,locked=false,intentStarted=false,knownNoJournal=false,stage='state';
 try{
  await ensureDeletionSchema(env);
  const db=env.BILLING_DB,retryHash=await digestDeletionRetry(token);
  // A hash of the originally verified bearer authorizes only this destructive
  // retry, including after the auth identity was deleted but a response was lost.
  row=await db.prepare('SELECT * FROM bb_account_deletions WHERE retry_hash=?').bind(retryHash).first();
  if(row?.completed_at_ms)return json({ok:true,deleted:true});
  if(!row){
   const user=await authenticatedUser(request,env);
   if(!user||!UUID.test(user.id))return rejected('deletion_sign_in_required','Sign in to delete your account.',401);
   const actorHash=await digestDeletionActor(user.id);
   // A refreshed session may resume an existing actor's job even though its
   // token hash is different. Never call that job "not started" or unpause it.
   row=await db.prepare('SELECT * FROM bb_account_deletions WHERE actor_hash=?').bind(actorHash).first();
   knownNoJournal=!row;
   if(row?.completed_at_ms)return json({ok:true,deleted:true});
   stage='readiness';
   if(!await deletionReady(env))return row?pending('deletion_not_ready',503):
    rejected('deletion_not_ready','Account deletion is awaiting a server update. Nothing has been deleted. Please try again later.',503,false);
   stage='authentication';
   if(!await reauthenticateDeletion(env,user,body.password))return rejected('deletion_password_required','Your current password could not be verified.',403,!!row);
   if(!row){
    intentStarted=true;
    await db.prepare(`INSERT OR IGNORE INTO bb_account_deletions(actor_hash,retry_hash,user_id,email,started_at_ms) VALUES(?,?,?,?,?)`)
     .bind(actorHash,retryHash,user.id,user.email,Date.now()).run();
   }
   // Only a fresh authenticated/password-verified session can change a retry
   // credential. No plaintext token or password is persisted in the journal.
   await db.prepare('UPDATE bb_account_deletions SET retry_hash=? WHERE actor_hash=? AND completed_at_ms IS NULL').bind(retryHash,actorHash).run();
   row=await db.prepare('SELECT * FROM bb_account_deletions WHERE actor_hash=?').bind(actorHash).first();
  }
  stage='database';
  if(row?.completed_at_ms)return json({ok:true,deleted:true});
  if(!row||!UUID.test(row.user_id||'')||typeof row.email!=='string')throw Error('deletion_state_unavailable');
  locked=!!await db.prepare(`UPDATE bb_account_deletions SET locked_until_ms=? WHERE actor_hash=? AND completed_at_ms IS NULL AND locked_until_ms<? RETURNING actor_hash`)
   .bind(Date.now()+60000,row.actor_hash,Date.now()).first();
  if(!locked)return pending();
  stage='billing';
  const billing=await cancelAccountBilling(env,row.user_id);
  // Finish D1 before deleting auth, so an outage can still be retried. Both
  // stages are idempotent and the durable tombstone blocks data resurrection.
  stage='database';
  await eraseAccountD1(env,row.user_id,billing);
  stage='cloud';
  const result=await deletionRpc(env,'bb_account_delete_data',{p_user:row.user_id,p_email:row.email});
  if(result?.deleted!==true||result.version!==1)throw Error('deletion_not_confirmed');
  stage='database';
  await db.prepare(`UPDATE bb_account_deletions SET completed_at_ms=?,user_id=NULL,email=NULL,locked_until_ms=0 WHERE actor_hash=?`)
   .bind(Date.now(),row.actor_hash).run();
  return json({ok:true,deleted:true});
 }catch(error){
  // Only our fixed stage/enum leaves this boundary. Never echo a provider body,
  // request, SQL exception, password, bearer or email in a response or log.
  const code=stage==='billing'?(error?.message==='billing_checkout_pending'?'deletion_checkout_pending':'deletion_billing_pending'):
   stage==='cloud'?'deletion_cloud_pending':stage==='readiness'?'deletion_not_ready':
   stage==='authentication'?'deletion_auth_unavailable':'deletion_database_pending';
  console.warn('BB_ACCOUNT_DELETE: '+code);
  if(row||intentStarted)return pending(code);
  if(knownNoJournal)return rejected(stage==='readiness'?'deletion_not_ready':stage==='authentication'?'deletion_auth_unavailable':'deletion_unavailable',
   stage==='authentication'?'Your password could not be checked right now. Nothing has been deleted. Please retry later.':
    'Account deletion could not start. Your account and saved data have been kept. Please try again later.',503,false);
  return pending('deletion_state_unknown',503);
 }finally{
  if(locked&&row)try{await env.BILLING_DB.prepare('UPDATE bb_account_deletions SET locked_until_ms=0 WHERE actor_hash=?').bind(row.actor_hash).run();}catch{}
 }
}
