import {json,isBillingEnabled,isLive,billingMode,isConfigured,authenticatedUser,requireSameOrigin,expectedPrice,paddleApi,digestHex} from '../../../bb-server-lib/bb-billing.js';
const MAX_BODY=1024;
// A Founder seat is a temporary hold until Paddle confirms a subscription.
// Release only AFTER Paddle confirms its unpaid transaction is canceled.
const FOUNDER_HOLD_MS=60*60*1000;
async function releaseUnpaidFounder(env,db,claim){
  if(claim?.plan!=='founder'||claim.claim_state!=='checkout_created'||
     !/^txn_[a-z0-9]{26}$/.test(claim.transaction_id||''))return false;
  const url='/transactions/'+claim.transaction_id;
  const tx=await paddleApi(env,url);
  if(tx?.id!==claim.transaction_id || tx.custom_data?.bb_claim_id!==claim.claim_id)return false;
  if(tx.status!=='canceled'){
    if(!['draft','ready'].includes(tx.status))return false; // paid/completed: wait for webhook
    const canceled=await paddleApi(env,url,'PATCH',{status:'canceled'});
    if(canceled?.id!==claim.transaction_id||canceled.status!=='canceled')return false;
  }
  const hash=await digestHex(claim.claim_id);
  const freed=await db.prepare(`UPDATE bb_founder_slots
    SET state='available',user_id=NULL,reservation_token_hash=NULL,reservation_expires_at_ms=NULL,updated_at_ms=?
    WHERE slot_no=? AND state='reserved' AND user_id=? AND reservation_token_hash=?
      AND paddle_subscription_id IS NULL RETURNING slot_no`)
    .bind(Date.now(),claim.slot_no,claim.user_id,hash).first();
  if(!freed)return false;
  await db.prepare(`DELETE FROM bb_billing_claims WHERE claim_id=? AND user_id=?
    AND plan='founder' AND claim_state='checkout_created' AND transaction_id=?`)
    .bind(claim.claim_id,claim.user_id,claim.transaction_id).run();
  return true;
}
async function releaseExpiredFounderHolds(env,db){
  const rows=await db.prepare(`SELECT claim_id,user_id,plan,slot_no,claim_state,transaction_id
    FROM bb_billing_claims WHERE plan='founder' AND claim_state='checkout_created'
    AND created_at_ms<? LIMIT 25`).bind(Date.now()-FOUNDER_HOLD_MS).all();
  // 25 is the entire Founder cap. Fail closed on Paddle/API errors.
  await Promise.all((rows?.results||[]).map(async claim=>{
    try{await releaseUnpaidFounder(env,db,claim)}
    catch(err){console.warn('Founder hold retained pending safe Paddle confirmation',err)}
  }));
}

export async function onRequestPost({request,env}) {
  // Two independent locks: Live backend may be configured before checkout can open.
  if (!isBillingEnabled(env)||!isConfigured(env)||
      !(isLive(env)?env.PADDLE_LIVE_API_KEY:env.PADDLE_SANDBOX_API_KEY)||
      (isLive(env)&&(
        env.BB_LIVE_CHECKOUT_ENABLED!=='true' ||
        env.BB_LIVE_WEBHOOK_ENABLED!=='true' ||
        !env.PADDLE_LIVE_WEBHOOK_SECRET
      )))
    return json({error:'Checkout disabled or not configured'},503);
  if(!requireSameOrigin(request)) return json({error:'Origin not allowed'},403);
  const user=await authenticatedUser(request,env);
  if(!user) return json({error:'Sign in with a verified account first'},401);
  if(user.id===env.BB_OWNER_USER_ID) return json({error:'Owner already has free Premium'},403);
  let raw;
  try { raw=await request.text(); if(raw.length>MAX_BODY) throw Error(); }
  catch { return json({error:'Invalid request'},400); }
  let plan,abandonTransactionId;
  try{ const body=JSON.parse(raw);plan=body?.plan;abandonTransactionId=body?.abandonTransactionId; }
  catch{ return json({error:'Invalid JSON'},400); }
  if(abandonTransactionId!==undefined && (plan!=='founder'||
      !/^txn_[a-z0-9]{26}$/.test(abandonTransactionId)))
    return json({error:'Invalid Founder checkout cancellation'},400);
  const priceId=expectedPrice(env,plan);
  if(!priceId) return json({error:'Plan unavailable'},400);
  const db=env.BILLING_DB;
  try {
    if(abandonTransactionId){
      const claim=await db.prepare(`SELECT claim_id,user_id,plan,slot_no,claim_state,transaction_id
        FROM bb_billing_claims WHERE user_id=? AND plan='founder'
        AND claim_state='checkout_created' AND transaction_id=? LIMIT 1`)
        .bind(user.id,abandonTransactionId).first();
      if(!claim)return json({released:false}); // already handled, or not this user's checkout
      const released=await releaseUnpaidFounder(env,db,claim);
      return json({released},released?200:409);
    }
    if(plan==='founder')await releaseExpiredFounderHolds(env,db);
    const hasSub=await db.prepare("SELECT 1 AS found FROM bb_paid_entitlements WHERE user_id=? AND status IN ('trialing','active') LIMIT 1").bind(user.id).first();
    if(hasSub) return json({error:'You already have an eligible subscription'},409);
    const existing=await db.prepare(`SELECT claim_id,user_id,plan,slot_no,claim_state,transaction_id
      FROM bb_billing_claims WHERE user_id=? AND claim_state IN ('pending','checkout_created') LIMIT 1`).bind(user.id).first();
    if(existing){
      if(plan==='founder'&&existing.plan==='founder'&&existing.claim_state==='checkout_created'){
        const tx=await paddleApi(env,'/transactions/'+existing.transaction_id);
        if(tx?.id===existing.transaction_id && tx.custom_data?.bb_claim_id===existing.claim_id){
          if(['draft','ready'].includes(tx.status))
            return json({transactionId:tx.id,plan,mode:billingMode(env),reused:true});
          if(tx.status==='canceled' && await releaseUnpaidFounder(env,db,existing)){
            // Reclaim the canceled checkout, then create a fresh Founder transaction.
          }else return json({error:'Checkout awaiting payment confirmation; try again shortly'},409);
        }else return json({error:'Existing checkout could not be verified'},409);
      }else return json({error:'Existing checkout pending; contact support to reconcile before starting another'},409);
    }
    const now=Date.now(); const claimId=crypto.randomUUID(); let slot=null;
    const tokenHash=await digestHex(claimId);
    if(plan==='founder') {
      // Atomic UPDATE: only one simultaneous customer can claim each numbered slot.
      // Do NOT recycle a slot after Paddle has created a payable transaction.
      const row=await db.prepare(`UPDATE bb_founder_slots SET state='reserved',user_id=?,reservation_token_hash=?,reservation_expires_at_ms=NULL,updated_at_ms=?
        WHERE slot_no=(SELECT slot_no FROM bb_founder_slots WHERE state='available' ORDER BY slot_no LIMIT 1)
        AND state='available' RETURNING slot_no`).bind(user.id,tokenHash,now).first();
      if(!row) return json({error:'All 25 founding places are currently claimed or reserved'},409);
      slot=row.slot_no;
    }
    try {
      await db.prepare(`INSERT INTO bb_billing_claims (claim_id,user_id,plan,price_id,slot_no,created_at_ms)
        VALUES (?,?,?,?,?,?)`).bind(claimId,user.id,plan,priceId,slot,now).run();
    } catch(err) {
      // Intentionally leave reserved founder seat untouched if DB integrity is uncertain.
      console.error('BasketBoss claim insert failed',err);
      return json({error:'Checkout preparation failed; contact support before retrying'},503);
    }
    let transaction;
    try {
      transaction=await paddleApi(env,'/transactions','POST',{
        items:[{price_id:priceId,quantity:1}],collection_mode:'automatic',
        custom_data:{bb_claim_id:claimId,bb_plan:plan,bb_environment:billingMode(env)}
      });
    } catch(err) {
      console.error('Paddle transaction creation failed; claim held for reconciliation',err);
      return json({error:'Checkout could not be prepared; claim retained for safe reconciliation'},502);
    }
    if(!/^txn_[a-z0-9]{26}$/.test(transaction?.id||''))
      return json({error:'Invalid transaction response; claim held for reconciliation'},502);
    await db.prepare(`UPDATE bb_billing_claims SET transaction_id=?,claim_state='checkout_created'
      WHERE claim_id=? AND user_id=? AND transaction_id IS NULL`).bind(transaction.id,claimId,user.id).run();
    return json({transactionId:transaction.id,plan,mode:billingMode(env)});
  } catch(err) {
    console.error('BasketBoss checkout server error',err);
    return json({error:'Billing database unavailable; no checkout started'},503);
  }
}
export function onRequestGet(){return json({error:'Method not allowed'},405);}
