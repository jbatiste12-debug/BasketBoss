/* BasketBoss live checkout: guarded, tap-visible, retryable on mobile Safari.
   Transactions are created ONLY by the authenticated server with Founder inventory checks.
   The fallback link is only generated after receiving the verified transaction ID. */
(()=>{
'use strict';
const buttons=[...document.querySelectorAll('button[data-plan]')];
const message=document.getElementById('checkoutMessage');
const TOKEN_LIVE='live_5eb02615c434c5900f61e54d1ed';
const TOKEN_TEST='test_8591040552729f8dee37069a8c7';
let readyPromise=null, config=null, openFounderTransaction=null;
let readinessError='Checking secure Paddle checkout…';
function notify(text,type=''){
  if(!message)return;
  message.textContent=text;
  message.className='checkout-message'+(type?' '+type:'');
}
function feedback(button,text,type='error'){
  let target=button.parentElement.querySelector('.bb-checkout-feedback');
  if(!target){
    target=document.createElement('div');
    target.className='bb-checkout-feedback';
    target.setAttribute('role','status');target.setAttribute('aria-live','polite');
    button.insertAdjacentElement('afterend',target);
  }
  target.replaceChildren();
  target.dataset.type=type;
  target.append(document.createTextNode(text));
  notify(text,type==='error'?'error':'');
  if(type==='error'||type==='success')target.scrollIntoView({block:'nearest',behavior:'smooth'});
  return target;
}
function sessionToken(){
  try{
    const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
    return typeof s?.access_token==='string' && Number(s.expires_at)*1000>Date.now()+5000?s.access_token:null;
  }catch{return null;}
}
function checkoutLink(transactionId){
  // This page contains Paddle.js. The _ptxn query is Paddle's documented
  // transaction payment-link mechanism; never construct a link before POST.
  const url=new URL('pricing-sandbox.html',location.href);
  url.searchParams.set('_ptxn',transactionId);
  return url.href;
}
function showFallback(button,transactionId){
  const target=feedback(button,'Your secure Paddle transaction is ready. If the payment panel did not open, use the link below.','success');
  const link=document.createElement('a');
  link.href=checkoutLink(transactionId);
  link.className='bb-checkout-fallback';
  link.textContent='Open secure payment screen →';
  target.append(document.createElement('br'),link);
}
function configError(data){
  const missing=Array.isArray(data?.missing)&&data.missing.every(x=>typeof x==='string')
    ?data.missing.slice(0,12).join(', '):'';
  if(missing)return 'Live checkout is missing: '+missing+'.';
  return data?.mode==='sandbox'
    ?'Live payments are not active on this website. Please contact BasketBoss support.'
    :'The payment server has not enabled checkout yet. Please contact BasketBoss support.';
}
async function prepare(){
  const bearer=sessionToken();
  let response,data;
  try{
    response=await fetch('/api/subscription/checkout-config',{
      cache:'no-store',credentials:'same-origin',redirect:'manual',
      headers:bearer?{'Authorization':'Bearer '+bearer,'Accept':'application/json'}:{'Accept':'application/json'}
    });
    if(!response.ok)throw Error('payment configuration returned HTTP '+response.status);
    data=await response.json();
  }catch(err){throw Error('Cannot reach the checkout service: '+String(err.message||'network error').slice(0,120));}
  if(data?.enabled!==true||!['live','sandbox'].includes(data.mode))throw Error(configError(data));
  if(['basketboss.co.uk','www.basketboss.co.uk'].includes(location.hostname)&&data.mode!=='live')
    throw Error('Live payments are not enabled on basketboss.co.uk.');
  if(!window.Paddle?.Initialize||!window.Paddle?.Checkout?.open)
    throw Error('Paddle payment script did not load. Try Safari without a content blocker, then refresh.');
  try{
    if(data.mode==='sandbox')window.Paddle.Environment.set('sandbox');
    window.Paddle.Initialize({
      token:data.mode==='live'?TOKEN_LIVE:TOKEN_TEST,
      checkout:{settings:{displayMode:'overlay',theme:'light',locale:'en'}},
      eventCallback(event){
        if(event?.name==='checkout.completed'){
          openFounderTransaction=null;
          notify('Paddle checkout completed. Premium activates after verified subscription confirmation.','success');
        }
        if(event?.name==='checkout.closed'){
          const id=openFounderTransaction;openFounderTransaction=null;
          if(id&&(!event.data?.transaction_id||event.data.transaction_id===id)){
            const token=sessionToken();
            if(token){
              const founder=buttons.find(b=>b.dataset.plan==='founder');
              if(founder)founder.disabled=true;
              void fetch('/api/subscription/checkout',{
                method:'POST',cache:'no-store',credentials:'same-origin',
                headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
                body:JSON.stringify({plan:'founder',abandonTransactionId:id})
              }).catch(()=>{}).finally(()=>{if(founder)founder.disabled=false;});
            }
          }
          for(const button of buttons){
            const target=button.parentElement.querySelector('.bb-checkout-feedback');
            const link=target?.querySelector('a.bb-checkout-fallback');
            if(link){link.remove();target.textContent='Payment window closed. Tap the trial button again to start a new checkout.';}
          }
          notify('Payment window closed. No new Premium entitlement was granted.');
        }
      }
    });
  }catch(err){
    console.error('BasketBoss Paddle initialization',err);
    throw Error('Paddle payment initialization failed. Check Safari content blockers or contact BasketBoss support.');
  }
  config=data;
  const ribbon=document.querySelector('.test-ribbon');
  if(ribbon&&data.mode==='live')ribbon.textContent='SECURE PADDLE LIVE CHECKOUT · MONTHLY SUBSCRIPTIONS';
  const pending=document.querySelector('.test-info');if(pending&&data.mode==='live')pending.hidden=true;
  return data;
}
function ready(){
  if(!readyPromise)readyPromise=prepare().catch(err=>{readyPromise=null;throw err;});
  return readyPromise;
}
async function start(button){
  const bearer=sessionToken();
  if(!bearer){
    feedback(button,'Please sign in to your verified BasketBoss account first, then return to this page. Use the sign-in link below.');
    return;
  }
  button.disabled=true;
  feedback(button,'Connecting securely to Paddle…','info');
  try{
    const current=await ready();
    if(sessionToken()!==bearer)throw Error('Your account changed. Sign in again before starting a trial.');
    const plan=button.dataset.plan==='founder'?'founder':'standard';
    feedback(button,'Preparing your secure '+(plan==='founder'?'Founder':'Standard')+' trial…','info');
    const res=await fetch('/api/subscription/checkout',{
      method:'POST',cache:'no-store',credentials:'same-origin',redirect:'manual',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+bearer},
      body:JSON.stringify({plan})
    });
    const result=await res.json().catch(()=>({}));
    if(!res.ok||result.mode!==current.mode||!/^txn_[a-z0-9]{26}$/.test(result.transactionId||''))
      throw Error(result.error||'Checkout server could not prepare your trial (HTTP '+res.status+').');
    if(sessionToken()!==bearer)throw Error('Account changed after checkout preparation. Please sign in again.');
    openFounderTransaction=plan==='founder'?result.transactionId:null;
    try{window.Paddle.Checkout.open({transactionId:result.transactionId});}
    catch(err){console.warn('Paddle overlay failed; providing transaction payment link',err);}
    // Always provide a same-tab fallback for mobile Safari after server
    // transaction creation, even if the overlay silently fails to appear.
    showFallback(button,result.transactionId);
  }catch(err){
    feedback(button,String(err.message||'Unable to start checkout').slice(0,240));
  }finally{button.disabled=false;}
}
for(const button of buttons){
  if(!['founder','monthly'].includes(button.dataset.plan))continue;
  button.disabled=false;
  button.addEventListener('click',()=>{void start(button);});
}
notify('Select a plan to open secure Paddle checkout. Sign in first if you are new to BasketBoss.');
void ready().then(()=>notify('Paddle Live checkout is ready. Tap a trial button to continue.')).catch(err=>{
  readinessError=String(err.message||'Checkout unavailable').slice(0,240);
  notify(readinessError,'error');
});
})();
