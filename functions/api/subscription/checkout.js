import {json,isSandbox,isConfigured,authenticatedUser,requireSameOrigin,expectedPrice,paddleApi,digestHex} from '../../../bb-server-lib/bb-billing.js';
const MAX_BODY=1024;
export async function onRequestPost({request,env}) {
  if (!isSandbox(env)||!isConfigured(env)||!env.PADDLE_SANDBOX_API_KEY)
    return json({error:'Sandbox billing disabled or not configured'},503);
  if(!requireSameOrigin(request)) return json({error:'Origin not allowed'},403);
  const user=await authenticatedUser(request,env);
  if(!user) return json({error:'Sign in with a verified account first'},401);
  if(user.id===env.BB_OWNER_USER_ID) return json({error:'Owner already has free Premium'},403);
  let raw;
  try { raw=await request.text(); if(raw.length>MAX_BODY) throw Error(); }
  catch { return json({error:'Invalid request'},400); }
  let plan;
  try{ plan=JSON.parse(raw)?.plan; } catch{ return json({error:'Invalid JSON'},400); }
  const priceId=expectedPrice(env,plan);
  if(!priceId) return json({error:'Plan unavailable'},400);
  const db=env.BILLING_DB;
  try {
    const hasSub=await db.prepare("SELECT 1 AS found FROM bb_paid_entitlements WHERE user_id=? AND status IN ('trialing','active') LIMIT 1").bind(user.id).first();
    if(hasSub) return json({error:'You already have an eligible subscription'},409);
    const existing=await db.prepare("SELECT 1 AS found FROM bb_billing_claims WHERE user_id=? AND claim_state IN ('pending','checkout_created') LIMIT 1").bind(user.id).first();
    if(existing) return json({error:'Existing checkout pending; contact support to reconcile before starting another'},409);
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
        custom_data:{bb_claim_id:claimId,bb_plan:plan,bb_environment:'sandbox'}
      });
    } catch(err) {
      console.error('Paddle transaction creation failed; claim held for reconciliation',err);
      return json({error:'Checkout could not be prepared; claim retained for safe reconciliation'},502);
    }
    if(!/^txn_[a-z0-9]{26}$/.test(transaction?.id||''))
      return json({error:'Invalid transaction response; claim held for reconciliation'},502);
    await db.prepare(`UPDATE bb_billing_claims SET transaction_id=?,claim_state='checkout_created'
      WHERE claim_id=? AND user_id=? AND transaction_id IS NULL`).bind(transaction.id,claimId,user.id).run();
    return json({transactionId:transaction.id,plan,mode:'sandbox'});
  } catch(err) {
    console.error('BasketBoss checkout server error',err);
    return json({error:'Billing database unavailable; no checkout started'},503);
  }
}
export function onRequestGet(){return json({error:'Method not allowed'},405);}
