/* Guarded Live/Sandbox checkout. Server controls readiness and prices. */
(()=>{
'use strict';

const buttons=[...document.querySelectorAll('button[data-plan]')];
const message=document.getElementById('checkoutMessage');
let openFounderTransaction=null;
let checkoutReady=false;
let checkoutIssue='Checking secure Paddle checkout availability…';

function notify(text,type=''){
  if(message){
    message.textContent=text;
    message.className='checkout-message'+(type?' '+type:'');
  }
}

function accessToken(){
  try{
    const session=JSON.parse(
      localStorage.getItem('basketboss_cloud_session_v1')||'null'
    );
    if(typeof session?.access_token==='string' &&
       Number(session.expires_at)*1000>Date.now()+5000)
      return session.access_token;
  }catch{}
  return null;
}

buttons.forEach(button=>{
  button.disabled=false;
  button.setAttribute('aria-disabled','false');
  button.addEventListener('click',()=>{
    if(checkoutReady && button.dataset.bbCheckoutReady==='true')return;
    notify(checkoutIssue,'error');
  });
});

async function boot(){
  notify('Checking secure Paddle checkout availability…');

  let config;
  try{
    const bearer=accessToken();
    const response=await fetch('/api/subscription/checkout-config',{
      cache:'no-store',
      credentials:'same-origin',
      headers:bearer?{'Authorization':'Bearer '+bearer}:{}
    });
    if(!response.ok)throw Error('Checkout server returned HTTP '+response.status);
    config=await response.json();
  }catch(err){
    checkoutIssue='Could not check Paddle Live checkout: '+String(err.message||'network error').slice(0,110)+'. Please try again.';
    notify(checkoutIssue,'error');
    return;
  }

  if(config?.enabled!==true || !['live','sandbox'].includes(config.mode)){
    // Only an authenticated Owner receives specific variable names from the API.
    // Never reveal key *values* or let a public browser bypass server gates.
    const missing=Array.isArray(config?.missing)&&config.missing.every(x=>typeof x==='string')
      ?config.missing.slice(0,12).join(', '):null;
    checkoutIssue=missing
      ?'Paddle checkout configuration needs: '+missing+'.'
      :'Secure checkout is not enabled by the server. Please contact BasketBoss support.';
    notify(checkoutIssue,'error');
    return;
  }

  // Public domain never opens a test-money Sandbox checkout.
  if(['basketboss.co.uk','www.basketboss.co.uk'].includes(location.hostname) && config.mode!=='live'){
    checkoutIssue='Live checkout is required on basketboss.co.uk; Sandbox payments are blocked.';
    notify(checkoutIssue,'error');
    return;
  }

  if(!window.Paddle?.Initialize || !window.Paddle?.Checkout?.open){
    checkoutIssue='Paddle checkout script did not load. Check your connection or content blockers, then reload this page.';
    notify(checkoutIssue,'error');
    return;
  }

  // These are Paddle PUBLIC client-side tokens, never API secrets.
  const clientToken=config.mode==='live'
    ? 'live_5eb02615c434c5900f61e54d1ed'
    : 'test_8591040552729f8dee37069a8c7';

  try{
    if(config.mode==='sandbox')
      window.Paddle.Environment.set('sandbox');

    window.Paddle.Initialize({
      token:clientToken,
      checkout:{
        settings:{
          displayMode:'overlay',
          theme:'light',
          locale:'en'
        }
      },
      eventCallback(event){
        if(event?.name==='checkout.completed'){
          openFounderTransaction=null;
          notify('Checkout completed. Premium awaits verified confirmation.','success');
        }else if(event?.name==='checkout.closed'){
          const id=openFounderTransaction;
          openFounderTransaction=null;
          if(id && (!event.data?.transaction_id || event.data.transaction_id===id)){
            const bearer=accessToken();
            const founder=buttons.find(b=>b.dataset.plan==='founder');
            if(bearer){
              if(founder)founder.disabled=true;
              void fetch('/api/subscription/checkout',{
                method:'POST',cache:'no-store',credentials:'same-origin',
                headers:{'Content-Type':'application/json','Authorization':'Bearer '+bearer},
                body:JSON.stringify({plan:'founder',abandonTransactionId:id})
              }).catch(()=>{}).finally(()=>{if(founder)founder.disabled=false;});
            }
          }
          notify('Checkout closed.');
        }
      }
    });
  }catch(err){
    checkoutIssue='Paddle Live checkout initialization failed. Please contact BasketBoss support.';
    console.error('Paddle checkout initialization failed',err);
    notify(checkoutIssue,'error');
    return;
  }

  for(const button of buttons){
    const plan=button.dataset.plan;
    if(plan!=='founder' && plan!=='monthly')continue;

    button.disabled=false;
    button.setAttribute('aria-disabled','false');
    button.dataset.bbCheckoutReady='true';
    button.textContent=plan==='founder'
      ? 'Start 7-day Founder trial'
      : 'Start 3-day Standard trial';

    button.addEventListener('click',async()=>{
      const bearer=accessToken();
      if(!bearer){
        notify('Sign in to BasketBoss first using the link below, then return to start your trial.','error');
        return;
      }

      button.disabled=true;
      try{
        const response=await fetch('/api/subscription/checkout',{
          method:'POST',
          cache:'no-store',
          credentials:'same-origin',
          headers:{
            'Content-Type':'application/json',
            'Authorization':'Bearer '+bearer
          },
          body:JSON.stringify({
            plan:plan==='founder'?'founder':'standard'
          })
        });

        const result=await response.json().catch(()=>({}));

        if(!response.ok ||
           result.mode!==config.mode ||
           !/^txn_[a-z0-9]{26}$/.test(result.transactionId||''))
          throw Error(result.error||'Checkout unavailable');

        openFounderTransaction=plan==='founder'?result.transactionId:null;
        window.Paddle.Checkout.open({
          transactionId:result.transactionId
        });
        notify('Opening secure Paddle checkout.');
      }catch(err){
        notify(String(err.message||'Checkout failed').slice(0,180),'error');
      }finally{
        button.disabled=false;
      }
    });
  }

  checkoutReady=true;
  checkoutIssue='Paddle checkout is ready.';

  if(config.mode==='live'){
    const ribbon=document.querySelector('.test-ribbon');
    if(ribbon)
      ribbon.textContent='SECURE PADDLE LIVE CHECKOUT · MONTHLY SUBSCRIPTIONS';

    const pending=document.querySelector('.test-info');
    if(pending)pending.hidden=true;

    const note=document.querySelector('p[role="note"]');
    if(note)note.hidden=true;

    const footer=document.querySelector('.footer');
    if(footer)
      footer.innerHTML=
        'BasketBoss · <a href="subscriptions.html">Cancellations & refunds</a> · '+
        '<a href="terms.html">Terms</a> · '+
        '<a href="privacy.html">Privacy</a>';
  }

  notify(config.mode==='live'
    ? 'Paddle Live checkout available. Review the amount before subscribing.'
    : 'Sandbox checkout ready — no real payments.');
}

void boot();
})();
