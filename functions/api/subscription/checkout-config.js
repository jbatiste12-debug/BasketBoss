import {
  json,isBillingEnabled,isLive,isConfigured,expectedPrice
} from '../../../bb-server-lib/bb-billing.js';

export function onRequestGet({env}){
  const live=isLive(env);
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

  return json({enabled,mode:live?'live':'sandbox'});
}
export function onRequestPost(){
  return json({error:'Method not allowed'},405);
}
