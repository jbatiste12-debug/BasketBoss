/* Authoritative Owner + sandbox subscriber status. Never trust a browser tier. */
import {json,authenticatedUser,entitlementForStatus,isBillingEnabled,billingMode,expectedPrice,isConfigured} from '../../../bb-server-lib/bb-billing.js';
import {sharedHouseholdPremiumOwner} from '../../../bb-server-lib/bb-household-premium.js';
export async function onRequestGet({request,env}) {
  if(!isConfigured(env)) return json({tier:'free',premium:false,reason:'server_not_configured'},503);
  const user=await authenticatedUser(request,env);
  if(!user) return json({tier:'free',premium:false,reason:'authentication_required'},401);
  if(user.id===env.BB_OWNER_USER_ID && !!env.BB_OWNER_USER_ID)
    return json({authenticated:true,mode:billingMode(env),tier:'owner',premium:true,premiumAccess:true,subscription:null});
  if(!isBillingEnabled(env)) return json({authenticated:true,mode:billingMode(env),tier:'free',premium:false,premiumAccess:false,subscription:null,reason:'billing_not_enabled'});
  try {
    const row=await env.BILLING_DB.prepare(`SELECT paddle_subscription_id,paddle_customer_id,status,price_id,plan,
      trial_ends_at,current_period_ends_at,cancellation_effective_at,cancel_at_period_end
      FROM bb_paid_entitlements WHERE user_id=? ORDER BY updated_at_ms DESC LIMIT 1`).bind(user.id).first();
    if(!row){
      const householdOwner=await sharedHouseholdPremiumOwner(request,env,user);
      if(householdOwner)return json({authenticated:true,mode:billingMode(env),tier:'premium',
        premium:true,premiumAccess:true,householdRole:'partner',subscription:null,portalUrl:null});
      return json({authenticated:true,mode:billingMode(env),tier:'free',premium:false,premiumAccess:false,subscription:null});
    }
    const expected=expectedPrice(env,row.plan);
    const premiumAccess=!!(expected && row.price_id===expected && entitlementForStatus(row.status));
    if(!premiumAccess){
      const householdOwner=await sharedHouseholdPremiumOwner(request,env,user);
      if(householdOwner)return json({authenticated:true,mode:billingMode(env),tier:'premium',
        premium:true,premiumAccess:true,householdRole:'partner',subscription:null,portalUrl:null});
    }
    return json({authenticated:true,mode:billingMode(env),tier:premiumAccess?'premium':'free',premium:premiumAccess,premiumAccess,
      subscription:{id:row.paddle_subscription_id,plan:row.price_id===expected?row.plan:null,status:row.status,trialEndsAt:row.trial_ends_at,
        currentPeriodEndsAt:row.current_period_ends_at,cancellationEffectiveAt:row.cancellation_effective_at,
        cancelAtPeriodEnd:row.cancel_at_period_end===1},portalUrl:null});
  } catch(err) {
    console.error('BasketBoss subscription status query failed',err);
    return json({tier:'free',premium:false,reason:'billing_database_unavailable'},503);
  }
}
export function onRequestPost(){return json({error:'Method not allowed'},405);}
