/* No browser-submitted subscription IDs. Paddle returns temporary management URLs. */
import {json,isBillingEnabled,isConfigured,authenticatedUser,paddleApi} from '../../../bb-server-lib/bb-billing.js';
export async function onRequestGet({request,env}) {
  if(!isBillingEnabled(env)||!isConfigured(env)) return json({error:'Billing disabled'},503);
  const user=await authenticatedUser(request,env);if(!user) return json({error:'Sign in required'},401);
  if(user.id===env.BB_OWNER_USER_ID) return json({error:'Owner has no subscription to manage'},404);
  try {
    const row=await env.BILLING_DB.prepare('SELECT paddle_subscription_id,paddle_customer_id FROM bb_paid_entitlements WHERE user_id=? ORDER BY updated_at_ms DESC LIMIT 1').bind(user.id).first();
    if(!row) return json({error:'No subscription to manage'},404);
    // Create a short-lived authenticated session for THIS user's verified Paddle customer.
    // Paddle customer_portal_session.write is required; no client-selected customer/sub IDs.
    if(!/^sub_[a-z0-9]{26}$/.test(row.paddle_subscription_id)||
       !/^ctm_[a-z0-9]{26}$/.test(row.paddle_customer_id))
      return json({error:'Invalid stored subscription'},503);
    const session=await paddleApi(env,'/customers/'+encodeURIComponent(row.paddle_customer_id)+'/portal-sessions',
      'POST',{subscription_ids:[row.paddle_subscription_id]});
    const item=Array.isArray(session?.urls?.subscriptions)
      ? session.urls.subscriptions.find(x=>x?.id===row.paddle_subscription_id) : null;
    const url=item?.view_subscription;
    if(!url) return json({error:'Secure management link unavailable'},503);
    const link=new URL(url);
    if(link.protocol!=='https:' || !/(^|\.)paddle\.(com|net)$/.test(link.hostname)) return json({error:'Invalid management link'},502);
    return json({url:link.href});
  } catch(err){ console.error('Paddle customer management unavailable',err);return json({error:'Unable to open subscription management'},503); }
}
