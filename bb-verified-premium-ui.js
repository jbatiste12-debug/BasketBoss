/* Server-verified Premium state for UI only. Never used as authorization.
 * Each successful verification is bound to the CURRENT Supabase login token.
 * The authoritative subscriptions and Owner entitlement remain on the server. */
(()=>{'use strict';
  let active=false, verifiedToken=null, lastToken=null, lastCheck=0, sequence=0;
  let phase='checking';
  function accessToken(){
    try{
      const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
      return typeof s?.access_token==='string' &&
        Number(s.expires_at)*1000>Date.now()+5000?s.access_token:null;
    }catch{return null;}
  }
  function isActive(){
    const token=accessToken();
    // Account switching or signing out invalidates a verified grant SYNCHRONOUSLY.
    return !!(active && token && token===verifiedToken && token===lastToken);
  }
  function state(){
    const token=accessToken();
    if(!token)return 'signed_out';
    if(token!==lastToken)return 'checking';
    return isActive()?'premium':phase;
  }
  function signal(){document.dispatchEvent(new Event('basketboss:premium-verified'));}
  async function refresh(force=false){
    const token=accessToken(),now=Date.now();
    if(!force&&token===lastToken&&now-lastCheck<30000)return isActive();
    const switched=token!==lastToken;
    lastToken=token;lastCheck=now;
    const id=++sequence;
    if(switched||!token){
      active=false;verifiedToken=null;
      phase=token?'checking':'signed_out';
      signal();
    }else if(!active){phase='checking';signal();}
    if(!token)return false;
    try{
      const response=await fetch('/api/subscription/status',{
        cache:'no-store',credentials:'same-origin',redirect:'manual',
        headers:{'Authorization':'Bearer '+token,'Accept':'application/json'}
      });
      if(id!==sequence||accessToken()!==token)return false;
      if(!response.ok){active=false;verifiedToken=null;phase=response.status===401?'signed_out':'unavailable';}
      else{
        const data=await response.json();
        const allowed=data?.authenticated===true && data?.premiumAccess===true &&
          (data.tier==='owner'||data.tier==='premium') &&
          (data.mode==='sandbox'||data.mode==='live');
        active=allowed;
        verifiedToken=allowed?token:null;
        phase=allowed?'premium':'free';
      }
    }catch(_){
      if(id===sequence&&accessToken()===token){
        active=false;verifiedToken=null;phase='unavailable';
      }
    }finally{
      if(id===sequence&&accessToken()===token)signal();
    }
    return isActive();
  }
  window.BasketBossVerifiedPremium=Object.freeze({isActive,state,refresh});
  window.addEventListener('focus',()=>{void refresh();});
  // Detect same-tab sign-in and sign-out; `storage` only covers other tabs.
  setInterval(()=>{if(accessToken()!==lastToken)void refresh(true);},1000);
  window.addEventListener('storage',e=>{
    if(e.key==='basketboss_cloud_session_v1')void refresh(true);
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)void refresh();
  });
  void refresh(true);
})();
