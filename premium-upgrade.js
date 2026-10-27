/* BasketBoss Premium upgrade modal — SANDBOX UI ONLY.
 * Intentionally denies access to AI controls for every visitor while verified
 * subscription entitlement and account sign-in have not yet been implemented.
 * IMPORTANT: A browser modal is NOT an authorization boundary. The server-side
 * /api/bb173 endpoints must verify paid entitlements before public launch.
 */
(() => {
  'use strict';
  const dialog = document.getElementById('bbPremiumDialog');
  if (!dialog) return;
  const feature = document.getElementById('bbPremiumFeature');
  const close = dialog.querySelector('[data-premium-dismiss]');
  const browse = dialog.querySelector('[data-premium-free-recipes]');
  let opener = null;
  const premiumSelector = '[data-open-tool="scan"], [data-open-tool="meal"], #scanBtn, #generate';

  function showPremium(trigger) {
    opener = trigger;
    const isScan = trigger.matches('[data-open-tool="scan"], #scanBtn');
    if (feature) feature.textContent = isScan ? 'AI ingredient scanning' : 'Personalised AI meal ideas';
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    close?.focus({preventScroll: true});
  }

  function hidePremium() {
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    opener?.focus({preventScroll: true});
  }


  // Use the same authenticated, server-verified Premium state as the Owner badge.
  // The /api/bb173 endpoints still independently enforce AI configuration,
  // authentication, quotas and Turnstile; this is presentation logic only.
  // The badge and AI opener share the same server-verified Premium state.
  // Protected /api/bb173 operations still independently enforce authorization.
  let passOnce=null;
  function showClickStatus(trigger,message){
    let notice=trigger.parentElement?.querySelector('.bb-ai-click-feedback');
    if(!notice){
      notice=document.createElement('p');
      notice.className='bb-ai-click-feedback';
      notice.setAttribute('role','status');
      notice.style.cssText='margin:8px 0;padding:9px 11px;border-radius:9px;background:#f1f8f1;color:#184a35;font-size:13px;font-weight:700;line-height:1.4';
      trigger.insertAdjacentElement('afterend',notice);
    }
    notice.textContent=message;
    return notice;
  }
  async function verifiedPremiumAccess(){
    if(window.BasketBossVerifiedPremium?.isActive?.()===true)return 'allowed';
    let token;
    try{
      const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
      if(typeof s?.access_token!=='string'||
         Number(s.expires_at)*1000<=Date.now()+5000)return 'signin';
      token=s.access_token;
    }catch{return 'signin';}
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const r=await fetch('/api/subscription/status',{
        cache:'no-store',credentials:'same-origin',redirect:'manual',signal:controller.signal,
        headers:{'Authorization':'Bearer '+token,'Accept':'application/json'}
      });
      if(r.status===401)return 'signin';
      if(!r.ok)return 'unavailable';
      const d=await r.json();
      return d?.authenticated===true&&d?.premiumAccess===true&&
        (d.tier==='owner'||d.tier==='premium')&&
        (d.mode==='sandbox'||d.mode==='live')?'allowed':'free';
    }catch{return 'unavailable';}
    finally{clearTimeout(timeout);}
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.(premiumSelector);
    if(!trigger||!document.getElementById('bbToolStage'))return;
    if(passOnce===trigger){passOnce=null;return;}
    // Already-verified Owner/Premium: do not swallow or replay the real click.
    if(window.BasketBossVerifiedPremium?.isActive?.()===true)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const notice=showClickStatus(trigger,'Checking Premium access…');
    void verifiedPremiumAccess().then(result=>{
      if(result==='allowed'){
        notice.remove();passOnce=trigger;trigger.click();
      }else if(result==='free'){
        notice.remove();showPremium(trigger);
      }else if(result==='signin'){
        notice.textContent='Sign in to your BasketBoss Premium account, then try again.';
      }else{
        notice.textContent='Could not verify Premium access. Check your connection and try again.';
      }
    }).catch(()=>{
      notice.textContent='Could not open the AI tool. Reload BasketBoss and try again.';
    });
  },true);

  close?.addEventListener('click', hidePremium);
  browse?.addEventListener('click', () => {
    hidePremium();
    const recipes = document.getElementById('bbRecipesDrawer');
    if (recipes) {
      recipes.open = true;
      recipes.scrollIntoView({behavior: 'smooth', block: 'start'});
      recipes.querySelector('summary')?.focus({preventScroll:true});
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); hidePremium(); });
  dialog.addEventListener('click', event => {
    // Click outside the content, on the native modal backdrop area.
    if (event.target === dialog) hidePremium();
  });
})();
