/* No browser-submitted subscription IDs. Paddle returns temporary management URLs. */
import {json,isSandbox,isConfigured,authenticatedUser,paddleApi} from '../../../bb-server-lib/bb-billing.js';
export async function onRequestGet({request,env}) {
  if(!isSandbox(env)||!isConfigured(env)) return json({error:'Billing disabled'},503);
  const user=await authenticatedUser(request,env);if(!user) return json({error:'Sign in required'},401);
  if(user.id===env.BB_OWNER_USER_ID) return json({error:'Owner has no subscription to manage'},404);
  try {
    const row=await env.BILLING_DB.prepare('SELECT paddle_subscription_id FROM bb_paid_entitlements WHERE user_id=? ORDER BY updated_at_ms DESC LIMIT 1').bind(user.id).first();
    if(!row) return json({error:'No subscription to manage'},404);
    const sub=await paddleApi(env,'/subscriptions/'+encodeURIComponent(row.paddle_subscription_id));
    const url=sub?.management_urls?.cancel || sub?.management_urls?.update_payment_method;
    if(!url) return json({error:'Secure management link unavailable'},503);
    const link=new URL(url);
    if(link.protocol!=='https:' || !/(^|\.)paddle\.(com|net)$/.test(link.hostname)) return json({error:'Invalid management link'},502);
    return json({url:link.href});
  } catch(err){ console.error('Paddle customer management unavailable',err);return json({error:'Unable to open subscription management'},503); }
}
