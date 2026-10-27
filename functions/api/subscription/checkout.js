import {json,isBillingEnabled,isLive,billingMode,isConfigured,authenticatedUser,requireSameOrigin,expectedPrice,paddleApi,digestHex} from '../../../bb-server-lib/bb-billing.js';
const MAX_BODY=1024;
// A Founder seat is a temporary hold until Paddle confirms a subscription.
// Release only AFTER Paddle confirms its unpaid transaction is canceled.
const FOUNDER_HOLD_MS=60*60*1000;
// A missing transaction ID is an unfinished server-side checkout, not a paid
// Founder seat. A 30-second lease prevents two taps from racing Paddle.
const PENDING_RECOVERY_MS=30*1000;
const TX_ID=/^txn_[a-z0-9]{26}$/;

// Retain Paddle's diagnostic text but redact any accidentally echoed API token.
function paddleErrorText(text){
  return String(text??'').replace(/[\r\n<>]/g,' ').replace(/(?:live|test)_[a-z0-9]{12,}/gi,'[redacted]')
    .slice(0,700);
}
function paddleFieldErrors(errors){
  if(!Array.isArray(errors))return [];
  return errors.slice(0,12).map(value=>({
    field:paddleErrorText(value?.field),
    message:paddleErrorText(value?.message)
  }));
}
function paddleErrorInfo(err){
  return err?.paddleError && typeof err.paddleError==='object'
    ?{paddle:err.paddleError}:{};
}

// Keep the explicit HTTP rejection reason visible without leaking the API key.
// On network failures, timeouts, 5xx or unparseable success, the outcome is
// ambiguous: keep the claim and its Founder reservation for safe recovery.
async function createPaddleCheckoutTransaction(env,priceId,claimId,plan){
  const host=isLive(env)?'https://api.paddle.com':'https://sandbox-api.paddle.com';
  const key=isLive(env)?env.PADDLE_LIVE_API_KEY:env.PADDLE_SANDBOX_API_KEY;
  let response;
  try{
    response=await fetch(host+'/transactions',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(9000),
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({items:[{price_id:priceId,quantity:1}],collection_mode:'automatic',
        custom_data:{bb_claim_id:claimId,bb_plan:plan,bb_environment:billingMode(env)}})
    });
  }catch(err){
    console.error('Paddle checkout transport error',err?.name||'request_failed');
    throw Error('Paddle did not confirm whether the transaction was created. Please retry after a short interval.');
  }
  const payload=await response.json().catch(()=>null);
  if(!response.ok){
    // Paddle's actual upstream status and JSON details must survive our public
    // 502 response. The UI already displays the top-level error string.
    const code=paddleErrorText(payload?.error?.code||'unavailable');
    const detail=paddleErrorText(payload?.error?.detail||'No JSON error detail returned by Paddle');
    const errors=paddleFieldErrors(payload?.error?.errors);
    const requestId=paddleErrorText(payload?.meta?.request_id||response.headers.get('Paddle-Request-Id')||'');
    const firstField=errors[0]?(' | '+errors[0].field+': '+errors[0].message):'';
    const msg=('Paddle HTTP '+response.status+' — '+code+': '+detail+firstField+
      (requestId?' (request '+requestId+')':'')).slice(0,1500);
    const err=Error(msg);
    err.paddleError={http_status:response.status,code,detail,errors,request_id:requestId};
    // Only a definitive 4xx rejection allows rollback. Timeout/5xx may have
    // created a remote transaction; leave the original claim for reconciliation.
    err.paddleRejected=response.status>=400&&response.status<500&&response.status!==408;
    throw err;
  }
  if(!TX_ID.test(payload?.data?.id||''))throw Error('Paddle returned an uncertain transaction result. Checkout reservation retained for safety.');
  return payload.data;
}

async function verifyPendingFounderSeat(db,claim){
  if(claim.plan!=='founder')return true;
  if(!Number.isInteger(claim.slot_no)||claim.slot_no<1||claim.slot_no>25)return false;
  const hash=await digestHex(claim.claim_id);
  const seat=await db.prepare(`SELECT state,user_id,reservation_token_hash,paddle_subscription_id
    FROM bb_founder_slots WHERE slot_no=?`).bind(claim.slot_no).first();
  return seat?.state==='reserved'&&seat.user_id===claim.user_id&&
    seat.reservation_token_hash===hash&&!seat.paddle_subscription_id;
}

// Exact-match cleanup; never touches confirmed Founder subscriptions or other
// people's reservations. The two writes are an atomic Cloudflare D1 batch.
async function releasePendingWithoutPaddle(db,claim){
  if(claim.claim_state!=='pending'||claim.transaction_id!=null||
     !await verifyPendingFounderSeat(db,claim))return false;
  const operations=[];
  if(claim.plan==='founder'){
    const hash=await digestHex(claim.claim_id);
    operations.push(db.prepare(`UPDATE bb_founder_slots
      SET state='available',user_id=NULL,reservation_token_hash=NULL,
        reservation_expires_at_ms=NULL,updated_at_ms=?
      WHERE slot_no=? AND state='reserved' AND user_id=?
        AND reservation_token_hash=? AND paddle_subscription_id IS NULL
      RETURNING slot_no`).bind(Date.now(),claim.slot_no,claim.user_id,hash));
  }
  operations.push(db.prepare(`DELETE FROM bb_billing_claims
    WHERE claim_id=? AND user_id=? AND plan=? AND claim_state='pending'
      AND transaction_id IS NULL AND created_at_ms=? RETURNING claim_id`)
      .bind(claim.claim_id,claim.user_id,claim.plan,claim.created_at_ms));
  const results=await db.batch(operations);
  // Fail closed if a row changed unexpectedly. No paid claim is deleted.
  return results.length===operations.length&&results.every(x=>x.results?.length===1);
}

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
    const existing=await db.prepare(`SELECT claim_id,user_id,plan,price_id,slot_no,claim_state,transaction_id,created_at_ms
      FROM bb_billing_claims WHERE user_id=? AND claim_state IN ('pending','checkout_created') LIMIT 1`).bind(user.id).first();
    const now=Date.now();let claimId=crypto.randomUUID(),slot=null,recovered=null;
    if(existing){
      if(existing.claim_state==='pending' && existing.transaction_id==null){
        // Reuse an orphan's ORIGINAL Founder reservation; never allocate a 2nd
        // seat or accidentally consume one of the first 25 places twice.
        if(!Number.isFinite(existing.created_at_ms)||now-existing.created_at_ms<PENDING_RECOVERY_MS)
          return json({error:'Checkout is being prepared. Please try again in 30 seconds.'},409);
        if(!await verifyPendingFounderSeat(db,existing))
          return json({error:'Founder reservation needs secure reconciliation; no new place was taken'},409);
        // Atomic compare-and-swap lease. Another tap cannot create in parallel.
        const lease=await db.prepare(`UPDATE bb_billing_claims SET created_at_ms=?
          WHERE claim_id=? AND user_id=? AND claim_state='pending'
            AND transaction_id IS NULL AND created_at_ms=?
          RETURNING claim_id`).bind(now,existing.claim_id,user.id,existing.created_at_ms).first();
        if(!lease)return json({error:'Checkout is already being recovered. Please try again shortly.'},409);
        recovered={...existing,created_at_ms:now};
        if(existing.plan===plan && existing.price_id===priceId){
          claimId=existing.claim_id;slot=existing.slot_no;
        }else{
          // Switching plans: release the old uncompleted claim/Founder hold,
          // then create a normal fresh claim for the selected plan.
          if(!await releasePendingWithoutPaddle(db,recovered))
            return json({error:'Previous uncompleted checkout could not be safely released'},503);
          recovered=null;
        }
      }else if(plan==='founder'&&existing.plan==='founder'&&existing.claim_state==='checkout_created'){
        const tx=await paddleApi(env,'/transactions/'+existing.transaction_id);
        if(tx?.id===existing.transaction_id && tx.custom_data?.bb_claim_id===existing.claim_id){
          if(['draft','ready'].includes(tx.status))
            return json({transactionId:tx.id,plan,mode:billingMode(env),reused:true});
          if(tx.status==='canceled' && await releaseUnpaidFounder(env,db,existing)){
            // Reclaim the canceled checkout, then create a fresh Founder transaction.
          }else return json({error:'Checkout awaiting payment confirmation; try again shortly'},409);
        }else return json({error:'Existing checkout could not be verified'},409);
      }else return json({error:'Existing checkout awaiting confirmation; contact support before starting another'},409);
    }
    if(!recovered){
      const tokenHash=await digestHex(claimId);
      if(plan==='founder'){
        const row=await db.prepare(`UPDATE bb_founder_slots SET state='reserved',user_id=?,reservation_token_hash=?,reservation_expires_at_ms=NULL,updated_at_ms=?
          WHERE slot_no=(SELECT slot_no FROM bb_founder_slots WHERE state='available' ORDER BY slot_no LIMIT 1)
          AND state='available' RETURNING slot_no`).bind(user.id,tokenHash,now).first();
        if(!row)return json({error:'All 25 founding places are currently claimed or reserved'},409);
        slot=row.slot_no;
      }
      try{
        await db.prepare(`INSERT INTO bb_billing_claims (claim_id,user_id,plan,price_id,slot_no,created_at_ms)
          VALUES (?,?,?,?,?,?)`).bind(claimId,user.id,plan,priceId,slot,now).run();
      }catch(err){
        console.error('BasketBoss claim insert failed',err);
        return json({error:'Checkout preparation failed; reservation retained for safety'},503);
      }
    }
    let transaction;
    try{
      transaction=await createPaddleCheckoutTransaction(env,priceId,claimId,plan);
    }catch(err){
      console.error('Paddle transaction creation:',String(err?.message||'unknown').slice(0,300));
      if(err?.paddleRejected===true){
        // HTTP 4xx: Paddle expressly rejected creation, so there is no remote
        // transaction to reconcile. Release only this claimant's pending hold.
        const claim={claim_id:claimId,user_id:user.id,plan,slot_no:slot,
          claim_state:'pending',transaction_id:null,created_at_ms:now};
        let released=false;
        try{released=await releasePendingWithoutPaddle(db,claim);}catch(e){console.error('Pending-claim rollback failed',e);}
        return json({
          error:err.message+(released?'':' — local claim retained for safe reconciliation'),
          ...paddleErrorInfo(err),
          claim_state:released?'released':'needs_reconciliation'
        },502);
      }
      return json({
        error:String(err?.message||'Paddle transaction creation uncertain'),
        ...paddleErrorInfo(err),
        claim_state:'pending_reconciliation'
      },502);
    }
    // Only the winning lease can finish the claim; do not leak a transaction
    // unless the user/account reservation was durably linked to it.
    const saved=await db.prepare(`UPDATE bb_billing_claims SET transaction_id=?,claim_state='checkout_created'
      WHERE claim_id=? AND user_id=? AND plan=? AND claim_state='pending'
        AND transaction_id IS NULL AND created_at_ms=? RETURNING claim_id`)
      .bind(transaction.id,claimId,user.id,plan,now).first();
    if(!saved)return json({error:'Paddle created a transaction, but its local claim could not be linked; contact support before retrying'},503);
    return json({transactionId:transaction.id,plan,mode:billingMode(env),recovered:!!recovered});
  } catch(err) {
    console.error('BasketBoss checkout server error',err);
    return json({error:'Billing database unavailable; no checkout started'},503);
  }
}
export function onRequestGet(){return json({error:'Method not allowed'},405);}
