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


  // The server, not this interface, decides Premium access.
  let passOnce=null;
  async function paidAIAccess(){
    try{
      const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
      if(typeof s?.access_token!=='string'||
         Number(s.expires_at)*1000<=Date.now()+5000)return false;
      const r=await fetch('/api/bb173/status',{
        cache:'no-store',
        headers:{'Authorization':'Bearer '+s.access_token}
      });
      const d=r.ok?await r.json():null;
      return d?.status==='available'&&d?.premium_ai===true;
    }catch{return false;}
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.(premiumSelector);
    if(!trigger||!document.getElementById('bbToolStage'))return;
    if(passOnce===trigger){passOnce=null;return;}
    event.preventDefault();
    event.stopImmediatePropagation();
    void paidAIAccess().then(ok=>{
      if(ok){passOnce=trigger;trigger.click();}
      else showPremium(trigger);
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
