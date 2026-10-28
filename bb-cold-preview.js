/* Logged-out only, visual product tour. No auth, Paddle, AI, D1, or app-state writes. */
(()=>{'use strict';
  const $=id=>document.getElementById(id);
  function validSession(){
    try{
      const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
      return !!(s?.user?.id && typeof s.access_token==='string' && Number(s.expires_at)*1000>Date.now()+5000);
    }catch(_){return false;}
  }
  function refresh(){
    const panel=$('bbColdVisitor');if(!panel)return;
    panel.hidden=validSession();
  }
  function exploreFree(){
    // Existing public Free catalogue is the actual app; do not write example pantry/plan state.
    document.querySelector('.shell .tabs [data-tab="discover"]')?.click();
    $('app')?.scrollIntoView({block:'start',behavior:'smooth'});
  }
  function wire(){
    const panel=$('bbColdVisitor');if(!panel)return;
    panel.querySelector('[data-bbc-free]')?.addEventListener('click',exploreFree);
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
  window.addEventListener('storage',e=>{if(e.key==='basketboss_cloud_session_v1')refresh();});
  window.addEventListener('basketboss:session-changed',refresh);
  window.addEventListener('focus',refresh);
})();
