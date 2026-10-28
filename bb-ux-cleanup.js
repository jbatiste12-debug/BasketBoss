/* BasketBoss surgical UI visibility only. No backend, auth, payment, budget, pantry,
   calculation, checkout, or install-guard changes. */
(()=>{'use strict';
  const SESSION_KEY='basketboss_cloud_session_v1';
  const byId=(id)=>document.getElementById(id);
  function signedIn(){
    try{
      const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      return !!(s?.user?.id && typeof s.access_token==='string' &&
        Number(s.expires_at)*1000>Date.now()+5000);
    }catch(_){return false;}
  }
  function positive(value){
    const n=Number(String(value||'').replace(/[^\d.\-]/g,''));
    return Number.isFinite(n)&&n>0;
  }
  function refreshStats(){
    const bar=document.querySelector('.shell > .stats');
    if(!bar)return;
    const planned=(byId('statMeals')?.textContent||'0').split('/')[0];
    const spend=byId('statSpend')?.textContent||'0';
    const pantry=byId('statPantry')?.textContent||'0';
    const hasData=positive(planned)||positive(spend)||positive(pantry);
    const hide=!signedIn()||!hasData;
    if(bar.hidden!==hide)bar.hidden=hide;
  }
  function mountSettingsAction(){
    const section=byId('bbuiLinksSection');
    if(!section||byId('bbuxInstallFromSettings'))return;
    const button=document.createElement('button');
    button.id='bbuxInstallFromSettings';button.type='button';
    button.textContent='Install BasketBoss on this device';
    button.addEventListener('click',()=>{
      // Delegate to the original install trigger. Its existing Safari / Samsung
      // protection and native-install prompt remain the only execution path.
      const original=document.querySelector('[data-bb173-install-banner] [data-bb173-install-open]');
      if(original){original.click();return;}
      const fallback=document.querySelector('[data-bb173-install-open]');
      if(fallback&&fallback!==button){fallback.click();return;}
      window.alert('Open BasketBoss in Safari or Chrome and choose Add to Home Screen from your browser menu.');
    });
    section.appendChild(button);
  }
  function start(){
    refreshStats();
    mountSettingsAction();
    const meals=byId('statMeals'),spend=byId('statSpend'),pantry=byId('statPantry');
    if(typeof MutationObserver==='function'){
      const counterObserver=new MutationObserver(refreshStats);
      for(const node of [meals,spend,pantry]){
        if(node)counterObserver.observe(node,{childList:true,subtree:true,characterData:true});
      }
      // Settings is built by the original app at DOMContentLoaded; watch only
      // until the single install action has been mounted.
      if(!byId('bbuxInstallFromSettings')){
        const settingsObserver=new MutationObserver(()=>{
          mountSettingsAction();
          if(byId('bbuxInstallFromSettings'))settingsObserver.disconnect();
        });
        settingsObserver.observe(document.body,{childList:true,subtree:true});
      }
    }
    window.addEventListener('basketboss:session-changed',refreshStats);
    window.addEventListener('storage',e=>{if(e.key===SESSION_KEY)refreshStats();});
    window.addEventListener('focus',refreshStats);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
