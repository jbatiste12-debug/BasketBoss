/* Authoritative Owner + sandbox subscriber status. Never trust a browser tier. */
import {json,authenticatedUser,entitlementForStatus,isBillingEnabled,billingMode,expectedPrice,isConfigured} from '../../../bb-server-lib/bb-billing.js';
import {paidBillingEnabled,readMemberPaidAccess} from '../../../bb-server-lib/bb-paid-access.js';
import {sharedHouseholdPremiumOwner} from '../../../bb-server-lib/bb-household-premium.js';
export async function onRequestGet({request,env}) {
  if(!isConfigured(env)) return json({tier:'free',premium:false,reason:'server_not_configured'},503);
  const user=await authenticatedUser(request,env);
  if(!user) return json({tier:'free',premium:false,reason:'authentication_required'},401);
  if(user.id===env.BB_OWNER_USER_ID && !!env.BB_OWNER_USER_ID)
    return json({authenticated:true,mode:billingMode(env),tier:'owner',premium:true,premiumAccess:true,subscription:null});
  if(!paidBillingEnabled(env)) return json({authenticated:true,mode:billingMode(env),tier:'free',premium:false,premiumAccess:false,subscription:null,reason:'billing_not_enabled'});
  try {
    // Keep complete Paddle management metadata, then consider verified Apple.
    // bb_paid_entitlements remains the web billing authority.
    const row=isBillingEnabled(env)?await env.BILLING_DB.prepare(`SELECT paddle_subscription_id,paddle_customer_id,status,price_id,plan,
      trial_ends_at,current_period_ends_at,cancellation_effective_at,cancel_at_period_end
      FROM bb_paid_entitlements WHERE user_id=? ORDER BY updated_at_ms DESC LIMIT 1`).bind(user.id).first():null;
    const access=await readMemberPaidAccess(request,env,user,{paddleRow:row});
    if(access.householdOwnerId)return json({authenticated:true,mode:billingMode(env),tier:'premium',
      premium:true,premiumAccess:true,householdRole:'partner',subscription:null,portalUrl:null});
    const apple=access.apple;
    if(access.provider==='apple'||(!access.premiumAccess&&apple))return json({
      authenticated:true,mode:apple.environment==='Production'?'live':'sandbox',provider:'apple',
      tier:access.premiumAccess?'premium':'free',premium:access.premiumAccess,premiumAccess:access.premiumAccess,
      subscription:{provider:'apple',plan:apple.plan,status:apple.status,
        currentPeriodEndsAt:apple.currentPeriodEndsAt,cancelAtPeriodEnd:apple.cancelAtPeriodEnd,
        environment:apple.environment},portalUrl:null
    });
    const paddle=access.paddleRow||row;
    const expected=paddle?expectedPrice(env,paddle.plan):null;
    return json({authenticated:true,mode:billingMode(env),provider:paddle?'paddle':null,
      tier:access.premiumAccess?'premium':'free',premium:access.premiumAccess,premiumAccess:access.premiumAccess,
      subscription:paddle?{provider:'paddle',id:paddle.paddle_subscription_id,plan:paddle.price_id===expected?paddle.plan:null,
        status:paddle.status,trialEndsAt:paddle.trial_ends_at,currentPeriodEndsAt:paddle.current_period_ends_at,
        cancellationEffectiveAt:paddle.cancellation_effective_at,cancelAtPeriodEnd:paddle.cancel_at_period_end===1}:null,portalUrl:null});
  } catch(err) {
    console.error('BasketBoss subscription status query failed',err);
    return json({tier:'free',premium:false,reason:'billing_database_unavailable'},503);
  }
}
export function onRequestPost(){return json({error:'Method not allowed'},405);}
