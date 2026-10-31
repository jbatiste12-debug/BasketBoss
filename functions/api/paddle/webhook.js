/* BasketBoss guarded Paddle subscription webhook: Sandbox/Live secrets are isolated.
   Signed raw-body verification, idempotent D1 event lock, never trusts client tier.
   Strict created-event linkage: a subscription must reference a server-created txn. */
import {json,isBillingEnabled,isLive,expectedPrice,digestHex,recognizedSubscriptionEvent,verifyPaddleSignature,iso} from '../../../bb-server-lib/bb-billing.js';
import {ensureDeletionSchema,digestDeletionActor,digestDeletionRef,isAccountDeleting} from '../../../bb-server-lib/bb-account-deletion.js';
const statuses=new Set(['trialing','active','past_due','paused','canceled']);
const parseStatus=d=>statuses.has(d?.status)?d.status:null;
function itemPrice(d){
  if(!Array.isArray(d?.items)||d.items.length!==1||d.items[0]?.quantity!==1)return null;
  return d.items[0]?.price?.id||null;
}
async function deletionSuppressed(db,subscriptionRef,claimRef){
  return !!await db.prepare('SELECT ref_hash FROM bb_account_deletion_refs WHERE ref_hash IN (?,?) LIMIT 1')
    .bind(subscriptionRef,claimRef).first();
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
    await ensureDeletionSchema(env);
    const subscriptionRef=await digestDeletionRef('subscription',d.id);
    const claimRef=typeof d.custom_data?.bb_claim_id==='string'?await digestDeletionRef('claim',d.custom_data.bb_claim_id):subscriptionRef;
    if(await deletionSuppressed(db,subscriptionRef,claimRef))return json({ok:true,ignored:true});
    await db.prepare(`INSERT OR IGNORE INTO bb_paddle_event_inbox(event_id,processed,received_at_ms) VALUES(?,0,?)`).bind(id,now).run();
    const previous=await db.prepare(`SELECT processed FROM bb_paddle_event_inbox WHERE event_id=?`).bind(id).first();
    if(previous?.processed===1)return json({ok:true,duplicate:true});
    const lock=await db.prepare(`UPDATE bb_paddle_event_inbox SET locked_until_ms=?
      WHERE event_id=? AND processed=0 AND locked_until_ms<? RETURNING event_id`).bind(now+60000,id,now).first();
    if(!lock) return json({error:'Event already being processed; retry'},503);
    const existing=await db.prepare(`SELECT * FROM bb_paid_entitlements WHERE paddle_subscription_id=?`).bind(d.id).first();
    if(existing&&await isAccountDeleting(env,existing.user_id))return json({ok:true,ignored:true});
    let claim=null;
    if(!existing) {
      if(type!=='subscription.created'){
        if(await deletionSuppressed(db,subscriptionRef,claimRef))return json({ok:true,ignored:true});
        return json({error:'Awaiting subscription.created linkage'},503);
      }
      const claimId=d.custom_data?.bb_claim_id;
      if(typeof claimId!=='string'||!(/^[0-9a-f-]{36}$/.test(claimId)))return json({error:'Unlinked subscription'},422);
      claim=await db.prepare('SELECT * FROM bb_billing_claims WHERE claim_id=? AND transaction_id=? AND claim_state=?')
        .bind(claimId,d.transaction_id,'checkout_created').first();
      // Cleanup may have atomically added suppression references and erased the
      // claim after our first read. A signed replay should still be acknowledged.
      if(!claim&&await deletionSuppressed(db,subscriptionRef,claimRef))return json({ok:true,ignored:true});
      if(!claim || !claim.transaction_id || expectedPrice(env,claim.plan)!==claim.price_id || itemPrice(d)!==claim.price_id)
        return json({error:'Unverified subscription/price/transaction linkage'},422);
      if(await isAccountDeleting(env,claim.user_id))return json({ok:true,ignored:true});
      const deletionHash=await digestDeletionActor(claim.user_id);
      if(claim.plan==='founder'){
        const tokenHash=await digestHex(claimId);
        const reserved=await db.prepare('SELECT state,user_id,reservation_token_hash FROM bb_founder_slots WHERE slot_no=?').bind(claim.slot_no).first();
        if(!reserved || reserved.state!=='reserved' || reserved.user_id!==claim.user_id || reserved.reservation_token_hash!==tokenHash)
          return json({error:'Founder slot claim mismatch'},422);
      }
      await db.prepare(`INSERT INTO bb_paid_entitlements(paddle_subscription_id,user_id,paddle_customer_id,claim_id,price_id,plan,status,
        trial_ends_at,current_period_ends_at,cancellation_effective_at,cancel_at_period_end,last_occurred_at,updated_at_ms)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`).bind(d.id,claim.user_id,d.customer_id,claimId,claim.price_id,claim.plan,d.status,
          d.status==='trialing'?iso(d.next_billed_at):null,iso(d.current_billing_period?.ends_at),
          d.scheduled_change?.action==='cancel'?iso(d.scheduled_change?.effective_at):null,
          Number(d.scheduled_change?.action==='cancel'),occurredAt,now,deletionHash).run();
      await db.prepare(`UPDATE bb_billing_claims SET claim_state='subscription_linked' WHERE claim_id=?
        AND NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`).bind(claimId,deletionHash).run();
    } else {
      if(d.customer_id!==existing.paddle_customer_id)return json({error:'Customer ID mismatch'},422);
      if(occurredAt>existing.last_occurred_at) {
        // An unexpected price change never silently unlocks a different product.
        const validPrice=itemPrice(d)===existing.price_id && expectedPrice(env,existing.plan)===existing.price_id;
        const status=validPrice?d.status:'canceled';
        await db.prepare(`UPDATE bb_paid_entitlements SET status=?,trial_ends_at=?,current_period_ends_at=?,
          cancellation_effective_at=?,cancel_at_period_end=?,last_occurred_at=?,updated_at_ms=? WHERE paddle_subscription_id=? AND last_occurred_at<?
          AND NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
          .bind(status,status==='trialing'?iso(d.next_billed_at):null,iso(d.current_billing_period?.ends_at),
            d.scheduled_change?.action==='cancel'?iso(d.scheduled_change?.effective_at):null,
            Number(d.scheduled_change?.action==='cancel'),occurredAt,now,d.id,occurredAt,await digestDeletionActor(existing.user_id)).run();
      }
    }
    // Founder allocations remain permanently consumed after a confirmed subscription.
    const row=await db.prepare('SELECT plan,claim_id,status,user_id FROM bb_paid_entitlements WHERE paddle_subscription_id=?').bind(d.id).first();
    if(row?.plan==='founder') {
      const c=await db.prepare('SELECT slot_no FROM bb_billing_claims WHERE claim_id=?').bind(row.claim_id).first();
      const slotState=row.status==='canceled'?'retired':row.status==='trialing'?'trialing':'active';
      await db.prepare(`UPDATE bb_founder_slots SET state=?,paddle_subscription_id=?,updated_at_ms=?
        WHERE slot_no=? AND user_id=? AND (paddle_subscription_id IS NULL OR paddle_subscription_id=?)
        AND NOT EXISTS (SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
        .bind(slotState,d.id,now,c?.slot_no,row.user_id,d.id,await digestDeletionActor(row.user_id)).run();
    }
    await db.prepare('UPDATE bb_paddle_event_inbox SET processed=1,locked_until_ms=0 WHERE event_id=?').bind(id).run();
    return json({ok:true});
  }catch(err){console.error('Paddle webhook processing error',err);return json({error:'Webhook processing failed; retry'},503);}
}
export function onRequestGet(){return json({error:'Method not allowed'},405);}
