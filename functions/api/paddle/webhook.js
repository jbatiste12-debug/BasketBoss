/* BasketBoss guarded Paddle subscription webhook: Sandbox/Live secrets are isolated.
   Signed raw-body verification, idempotent D1 event lock, never trusts client tier.
   Strict created-event linkage: a subscription must reference a server-created txn. */
import {json,isBillingEnabled,isLive,expectedPrice,digestHex,recognizedSubscriptionEvent,verifyPaddleSignature,iso} from '../../../bb-server-lib/bb-billing.js';
const statuses=new Set(['trialing','active','past_due','paused','canceled']);
const parseStatus=d=>statuses.has(d?.status)?d.status:null;
function itemPrice(d){
  if(!Array.isArray(d?.items)||d.items.length!==1||d.items[0]?.quantity!==1)return null;
  return d.items[0]?.price?.id||null;
}
export async function onRequestPost({request,env}) {
  const secret=isLive(env)?env.PADDLE_LIVE_WEBHOOK_SECRET:env.PADDLE_SANDBOX_WEBHOOK_SECRET;
  // Live webhook deliberately OFF unless independently enabled for testing.
  if(!isBillingEnabled(env)||!env.BILLING_DB||!secret||
     (isLive(env)&&env.BB_LIVE_WEBHOOK_ENABLED!=='true'))
    return json({error:'Webhook unavailable'},503);
  if(Number(request.headers.get('content-length')||0)>128000) return json({error:'Too large'},413);
  let raw;try{raw=await request.text();if(raw.length>128000)return json({error:'Too large'},413);}catch{return json({error:'Invalid body'},400);}
  if(!await verifyPaddleSignature(request,raw,secret))
    return json({error:'Invalid webhook signature'},401);
  let event;try{event=JSON.parse(raw)}catch{return json({error:'Invalid event'},400)}
  const {event_id:id,event_type:type,data:d,occurred_at:occurredAt}=event;
  if(typeof id!=='string'||!/^evt_[a-z0-9]{26}$/.test(id)||!iso(occurredAt)||!d || typeof type!=='string')return json({error:'Malformed event'},400);
  if(!recognizedSubscriptionEvent(type)) return json({ok:true,ignored:true});
  if(typeof d.id!=='string'||!/^sub_[a-z0-9]{26}$/.test(d.id)||!parseStatus(d)||!/^ctm_[a-z0-9]{26}$/.test(d.customer_id||''))
    return json({error:'Malformed subscription'},400);
  const db=env.BILLING_DB,now=Date.now();
  try {
    await db.prepare(`INSERT OR IGNORE INTO bb_paddle_event_inbox(event_id,processed,received_at_ms) VALUES(?,0,?)`).bind(id,now).run();
    const previous=await db.prepare(`SELECT processed FROM bb_paddle_event_inbox WHERE event_id=?`).bind(id).first();
    if(previous?.processed===1)return json({ok:true,duplicate:true});
    const lock=await db.prepare(`UPDATE bb_paddle_event_inbox SET locked_until_ms=?
      WHERE event_id=? AND processed=0 AND locked_until_ms<? RETURNING event_id`).bind(now+60000,id,now).first();
    if(!lock) return json({error:'Event already being processed; retry'},503);
    const existing=await db.prepare(`SELECT * FROM bb_paid_entitlements WHERE paddle_subscription_id=?`).bind(d.id).first();
    let claim=null;
    if(!existing) {
      if(type!=='subscription.created')return json({error:'Awaiting subscription.created linkage'},503);
      const claimId=d.custom_data?.bb_claim_id;
      if(typeof claimId!=='string'||!(/^[0-9a-f-]{36}$/.test(claimId)))return json({error:'Unlinked subscription'},422);
      claim=await db.prepare('SELECT * FROM bb_billing_claims WHERE claim_id=? AND transaction_id=? AND claim_state=?')
        .bind(claimId,d.transaction_id,'checkout_created').first();
      if(!claim || !claim.transaction_id || expectedPrice(env,claim.plan)!==claim.price_id || itemPrice(d)!==claim.price_id)
        return json({error:'Unverified subscription/price/transaction linkage'},422);
      if(claim.plan==='founder'){
        const tokenHash=await digestHex(claimId);
        const reserved=await db.prepare('SELECT state,user_id,reservation_token_hash FROM bb_founder_slots WHERE slot_no=?').bind(claim.slot_no).first();
        if(!reserved || reserved.state!=='reserved' || reserved.user_id!==claim.user_id || reserved.reservation_token_hash!==tokenHash)
          return json({error:'Founder slot claim mismatch'},422);
      }
      await db.prepare(`INSERT INTO bb_paid_entitlements(paddle_subscription_id,user_id,paddle_customer_id,claim_id,price_id,plan,status,
        trial_ends_at,current_period_ends_at,cancellation_effective_at,cancel_at_period_end,last_occurred_at,updated_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(d.id,claim.user_id,d.customer_id,claimId,claim.price_id,claim.plan,d.status,
          d.status==='trialing'?iso(d.next_billed_at):null,iso(d.current_billing_period?.ends_at),
          d.scheduled_change?.action==='cancel'?iso(d.scheduled_change?.effective_at):null,
          Number(d.scheduled_change?.action==='cancel'),occurredAt,now).run();
      await db.prepare("UPDATE bb_billing_claims SET claim_state='subscription_linked' WHERE claim_id=?").bind(claimId).run();
    } else {
      if(d.customer_id!==existing.paddle_customer_id)return json({error:'Customer ID mismatch'},422);
      if(occurredAt>existing.last_occurred_at) {
        // An unexpected price change never silently unlocks a different product.
        const validPrice=itemPrice(d)===existing.price_id && expectedPrice(env,existing.plan)===existing.price_id;
        const status=validPrice?d.status:'canceled';
        await db.prepare(`UPDATE bb_paid_entitlements SET status=?,trial_ends_at=?,current_period_ends_at=?,
          cancellation_effective_at=?,cancel_at_period_end=?,last_occurred_at=?,updated_at_ms=? WHERE paddle_subscription_id=? AND last_occurred_at<?`)
          .bind(status,status==='trialing'?iso(d.next_billed_at):null,iso(d.current_billing_period?.ends_at),
            d.scheduled_change?.action==='cancel'?iso(d.scheduled_change?.effective_at):null,
            Number(d.scheduled_change?.action==='cancel'),occurredAt,now,d.id,occurredAt).run();
      }
    }
    // Founder allocations remain permanently consumed after a confirmed subscription.
    const row=await db.prepare('SELECT plan,claim_id,status FROM bb_paid_entitlements WHERE paddle_subscription_id=?').bind(d.id).first();
    if(row?.plan==='founder') {
      const c=await db.prepare('SELECT slot_no FROM bb_billing_claims WHERE claim_id=?').bind(row.claim_id).first();
      const slotState=row.status==='canceled'?'retired':row.status==='trialing'?'trialing':'active';
      await db.prepare(`UPDATE bb_founder_slots SET state=?,paddle_subscription_id=?,updated_at_ms=?
        WHERE slot_no=? AND (paddle_subscription_id IS NULL OR paddle_subscription_id=?)`)
        .bind(slotState,d.id,now,c?.slot_no,d.id).run();
    }
    await db.prepare('UPDATE bb_paddle_event_inbox SET processed=1,locked_until_ms=0 WHERE event_id=?').bind(id).run();
    return json({ok:true});
  }catch(err){console.error('Paddle webhook processing error',err);return json({error:'Webhook processing failed; retry'},503);}
}
export function onRequestGet(){return json({error:'Method not allowed'},405);}
