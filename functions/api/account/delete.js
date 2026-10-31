import {json,authenticatedUser,requireSameOrigin} from '../../../bb-server-lib/bb-billing.js';
import {deletionConfigured,deletionReady,deletionRpc,ensureDeletionSchema,digestDeletionActor,digestDeletionRetry,reauthenticateDeletion,cancelAccountBilling,eraseAccountD1} from '../../../bb-server-lib/bb-account-deletion.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pending=()=>json({ok:false,pending:true,error:'Deletion is in progress. Retry here to finish. Your account data has not been cleared from this device yet.'},202);
export async function onRequestGet({env}){
 try{return json({ok:true,available:deletionConfigured(env),migrationReady:await deletionReady(env)});}
 catch{return json({ok:true,available:deletionConfigured(env),migrationReady:false});}
}
export async function onRequestPost({request,env}){
 if(!requireSameOrigin(request,true))return json({ok:false,error:'Origin not allowed'},403);
 if(!deletionConfigured(env))return json({ok:false,error:'Account deletion is temporarily unavailable. Please try again later.'},503);
 const token=request.headers.get('Authorization')||'';
 if(!/^Bearer [^\s]+$/.test(token)||token.length>16000)return json({ok:false,error:'Sign in to delete your account.'},401);
 let body;
 try{
  if(Number(request.headers.get('content-length')||0)>2048)throw Error();
  const reader=request.body?.getReader();if(!reader)throw Error();
  const chunks=[];let size=0;
  for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>2048){await reader.cancel();throw Error();}chunks.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!body||Object.keys(body).some(key=>!['confirmation','password'].includes(key))||body.confirmation!=='DELETE'||typeof body.password!=='string'||body.password.length<1||body.password.length>1024)throw Error();
 }catch{return json({ok:false,error:'Enter DELETE and your current password to confirm.'},400);}
 let row,locked=false,intentStarted=false;
 try{
  await ensureDeletionSchema(env);
  const db=env.BILLING_DB,retryHash=await digestDeletionRetry(token);
  // A hash of the originally verified bearer authorizes only this destructive
  // retry, including after the auth identity was deleted but a response was lost.
  row=await db.prepare('SELECT * FROM bb_account_deletions WHERE retry_hash=?').bind(retryHash).first();
  if(row?.completed_at_ms)return json({ok:true,deleted:true});
  if(!row){
   const user=await authenticatedUser(request,env);
   if(!user||!UUID.test(user.id))return json({ok:false,error:'Sign in to delete your account.'},401);
   if(!await deletionReady(env))return json({ok:false,error:'Account deletion is awaiting a server update. Please try again later.'},503);
   if(!await reauthenticateDeletion(env,user,body.password))return json({ok:false,error:'Your current password could not be verified.'},403);
   const actorHash=await digestDeletionActor(user.id);
   intentStarted=true;
   await db.prepare(`INSERT OR IGNORE INTO bb_account_deletions(actor_hash,retry_hash,user_id,email,started_at_ms) VALUES(?,?,?,?,?)`)
    .bind(actorHash,retryHash,user.id,user.email,Date.now()).run();
   // A fresh authenticated/password-verified session can resume an earlier job.
   await db.prepare('UPDATE bb_account_deletions SET retry_hash=? WHERE actor_hash=? AND completed_at_ms IS NULL').bind(retryHash,actorHash).run();
   row=await db.prepare('SELECT * FROM bb_account_deletions WHERE actor_hash=?').bind(actorHash).first();
  }
  if(row?.completed_at_ms)return json({ok:true,deleted:true});
  if(!row||!UUID.test(row.user_id||'')||typeof row.email!=='string')throw Error('deletion_state_unavailable');
  locked=!!await db.prepare(`UPDATE bb_account_deletions SET locked_until_ms=? WHERE actor_hash=? AND completed_at_ms IS NULL AND locked_until_ms<? RETURNING actor_hash`)
   .bind(Date.now()+60000,row.actor_hash,Date.now()).first();
  if(!locked)return pending();
  const billing=await cancelAccountBilling(env,row.user_id);
  // Finish D1 before deleting auth, so an outage can still be retried. Both
  // stages are idempotent and the durable tombstone blocks data resurrection.
  await eraseAccountD1(env,row.user_id,billing);
  const result=await deletionRpc(env,'bb_account_delete_data',{p_user:row.user_id,p_email:row.email});
  if(result?.deleted!==true||result.version!==1)throw Error('deletion_not_confirmed');
  await db.prepare(`UPDATE bb_account_deletions SET completed_at_ms=?,user_id=NULL,email=NULL,locked_until_ms=0 WHERE actor_hash=?`)
   .bind(Date.now(),row.actor_hash).run();
  return json({ok:true,deleted:true});
 }catch{
  // Fixed diagnostics only: never log credentials, email, provider response or
  // request body. Retain retry state rather than claiming a partial deletion.
  console.warn('BB_ACCOUNT_DELETE: retry_required');
  return row||intentStarted?pending():json({ok:false,error:'Account deletion is temporarily unavailable. Please try again later.'},503);
 }finally{
  if(locked&&row)try{await env.BILLING_DB.prepare('UPDATE bb_account_deletions SET locked_until_ms=0 WHERE actor_hash=?').bind(row.actor_hash).run();}catch{}
 }
}
