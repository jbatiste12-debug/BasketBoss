import {
  json,isBillingEnabled,isLive,isConfigured,expectedPrice,authenticatedUser
} from '../../../bb-server-lib/bb-billing.js';

export async function onRequestGet({request,env}){
  const live=isLive(env);
  // Match the checkout POST gates exactly; NEVER enable public checkout
  // merely because Paddle approved the domain or a browser flag is set.
  const enabled=isBillingEnabled(env)&&isConfigured(env)&&
    (live
      ? env.BB_LIVE_CHECKOUT_ENABLED==='true' &&
        env.BB_LIVE_WEBHOOK_ENABLED==='true' &&
        !!env.PADDLE_LIVE_API_KEY &&
        !!env.PADDLE_LIVE_WEBHOOK_SECRET
      : !!env.PADDLE_SANDBOX_API_KEY
    ) &&
    !!expectedPrice(env,'founder') &&
    !!expectedPrice(env,'standard');
  const mode=env.BB_BILLING_MODE==='live'?'live':'sandbox';
  if(enabled)return json({enabled:true,mode});

  // Public visitors get a safe error. Only an authenticated Owner may see
  // which *names* of settings are absent; no key or secret values are returned.
  let owner=false;
  if(request.headers.get('Authorization')){
    const user=await authenticatedUser(request,env);
    owner=!!user&&!!env.BB_OWNER_USER_ID&&user.id===env.BB_OWNER_USER_ID;
  }
  if(!owner)return json({enabled:false,mode,reason:'checkout_configuration_incomplete'});

  const missing=[];
  if(env.BB_BILLING_MODE!=='live'&&env.BB_BILLING_MODE!=='sandbox') missing.push('BB_BILLING_MODE');
  if(env.BB_BILLING_ENABLED!=='true')missing.push('BB_BILLING_ENABLED');
  if(!env.BILLING_DB?.prepare)missing.push('BILLING_DB binding');
  if(!env.SUPABASE_URL)missing.push('SUPABASE_URL');
  if(!env.SUPABASE_PUBLISHABLE_KEY)missing.push('SUPABASE_PUBLISHABLE_KEY');
  if(mode==='live'){
    if(env.BB_LIVE_CHECKOUT_ENABLED!=='true')missing.push('BB_LIVE_CHECKOUT_ENABLED');
    if(env.BB_LIVE_WEBHOOK_ENABLED!=='true')missing.push('BB_LIVE_WEBHOOK_ENABLED');
    if(!env.PADDLE_LIVE_API_KEY)missing.push('PADDLE_LIVE_API_KEY');
    if(!env.PADDLE_LIVE_WEBHOOK_SECRET)missing.push('PADDLE_LIVE_WEBHOOK_SECRET');
    if(!expectedPrice(env,'founder'))missing.push('PADDLE_LIVE_FOUNDER_PRICE_ID (missing or invalid)');
    if(!expectedPrice(env,'standard'))missing.push('PADDLE_LIVE_STANDARD_PRICE_ID (missing or invalid)');
  }else{
    if(!env.PADDLE_SANDBOX_API_KEY)missing.push('PADDLE_SANDBOX_API_KEY');
    if(!expectedPrice(env,'founder'))missing.push('PADDLE_SANDBOX_FOUNDER_PRICE_ID (missing or invalid)');
    if(!expectedPrice(env,'standard'))missing.push('PADDLE_SANDBOX_STANDARD_PRICE_ID (missing or invalid)');
  }
  return json({enabled:false,mode,reason:'checkout_configuration_incomplete',missing});
}
export function onRequestPost(){return json({error:'Method not allowed'},405);}
