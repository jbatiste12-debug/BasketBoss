/* Presentation-only verified Premium state. This is NOT a security boundary.
 * Protected content & paid operations must still verify entitlements server-side. */
(()=>{'use strict';
  let active=false, lastToken=null, lastCheck=0, sequence=0;
  function accessToken(){
    try{
      const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
      return typeof s?.access_token==='string' &&
        Number(s.expires_at)*1000>Date.now()+5000?s.access_token:null;
    }catch{return null;}
  }
  async function refresh(force=false){
    const token=accessToken(),now=Date.now();
    if(!force&&token===lastToken&&now-lastCheck<30000)return active;
    lastToken=token;lastCheck=now;
    const id=++sequence;
    active=false;
    if(token){
      try{
        const response=await fetch('/api/subscription/status',{
          cache:'no-store',credentials:'same-origin',redirect:'manual',
          headers:{'Authorization':'Bearer '+token,'Accept':'application/json'}
        });
        if(response.ok){
          const data=await response.json();
          if(data?.authenticated===true&&data?.premiumAccess===true&&
             (data.tier==='owner'||data.tier==='premium')&&
             (data.mode==='sandbox'||data.mode==='live') &&
             accessToken()===token && id===sequence)active=true;
        }
      }catch(_){/* Fail closed. */}
    }
    if(id===sequence)document.dispatchEvent(new Event('basketboss:premium-verified'));
    return active;
  }
  window.BasketBossVerifiedPremium=Object.freeze({isActive:()=>active,refresh});
  window.addEventListener('focus',()=>{void refresh();});
  // Same-tab sign-in does not produce a window.storage event.
  setInterval(()=>{if(accessToken()!==lastToken)void refresh(true);},2000);
  window.addEventListener('storage',e=>{
    if(e.key==='basketboss_cloud_session_v1')void refresh(true);
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)void refresh();
  });
  void refresh(true);
})();
