/* BasketBoss authenticated SANDBOX checkout. Server chooses price and creates transaction.
 * Requires configured Cloudflare Pages Functions; Python http.server cannot run this.
 * A checkout event is NEVER proof of Premium entitlement. */
(() => {
  'use strict';
  /* BB-20261026-FAIL-CLOSED-LIVE: no Sandbox checkout on public website. */
  const publicBetaHost = /^(?:www\.)?basketboss\.co\.uk$|^basketboss-site\.pages\.dev$/i.test(location.hostname);
  if(publicBetaHost){
    document.querySelectorAll('[data-plan]').forEach(b=>{b.disabled=true;b.setAttribute('aria-disabled','true');});
    const status=document.getElementById('checkoutMessage');
    if(status){status.textContent='Secure Live checkout is being finalised. No real payments are enabled yet.';status.className='checkout-message';}
    return;
  }
  const TOKEN='test_8591040552729f8dee37069a8c7'; // Paddle public client-side token, NOT an API secret
  const buttons=Array.from(document.querySelectorAll('[data-plan]'));
  const message=document.getElementById('checkoutMessage');
  function notify(text,type=''){
    if(!message)return;
    message.textContent=text;
    message.className='checkout-message'+(type?' '+type:'');
  }
  function accessToken(){
    try{
      const session=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
      if(!session?.access_token || !session.expires_at || session.expires_at*1000<Date.now()+5000)return null;
      return session.access_token;
    }catch{return null;}
  }
  if(!window.Paddle?.Initialize || !window.Paddle?.Checkout?.open){notify('Paddle checkout unavailable.','error');return;}
  try{
    window.Paddle.Environment.set('sandbox');
    window.Paddle.Initialize({token:TOKEN,checkout:{settings:{displayMode:'overlay',theme:'light',locale:'en'}},
      eventCallback(event){
        if(event?.name==='checkout.completed')notify('Sandbox checkout completed. Premium awaits server-confirmed subscription activation.','success');
        else if(event?.name==='checkout.closed')notify('Test checkout closed.');
      }});
  }catch(err){console.error('Paddle checkout init error',err);notify('Sandbox checkout unavailable.','error');return;}
  for(const button of buttons){
    const plan=button.dataset.plan;
    // Founding CTA can use data-plan="founder". Legacy 'monthly' is STANDARD pricing.
    // Annual is intentionally held pending a separately approved trial/price policy.
    if(plan==='annual'){button.disabled=true;button.title='Annual plan pending billing approval';continue;}
    if(plan!=='monthly' && plan!=='founder'){button.disabled=true;continue;}
    button.disabled=false;
    button.addEventListener('click',async()=>{
      const token=accessToken();
      if(!token){notify('Please sign in to your verified BasketBoss account before checkout.','error');return;}
      button.disabled=true;
      try{
        const response=await fetch('/api/subscription/checkout',{
          method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
          body:JSON.stringify({plan:plan==='founder'?'founder':'standard'})
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok || !/^txn_[a-z0-9]{26}$/.test(data.transactionId||''))throw Error(data.error||'Checkout unavailable');
        window.Paddle.Checkout.open({transactionId:data.transactionId,settings:{displayMode:'overlay',theme:'light',locale:'en'}});
        notify('Opening secure Sandbox checkout. No real payment will be taken.');
      }catch(err){notify(err.message||'Unable to prepare checkout.','error');}
      finally{button.disabled=false;}
    });
  }
  notify('Sandbox checkout ready. Sign in first; Premium activates only after a verified Paddle subscription event.');
})();
