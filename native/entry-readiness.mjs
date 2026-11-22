// Use the already-rendered local planner before optional deferred enhancements
// finish loading. First-time setup additionally waits for its real module so
// the existing native-ready event prepares onboarding under the native cover.
export function nativeEntryPresentationReady(doc){
 const app=doc.getElementById('app'),view=doc.body?.dataset?.bbnextView;
 if(!app?.firstElementChild||!view)return false;
 const key={week:'plan',discover:'discover',shop:'kitchen','shop-list':'shop'}[view];
 if(!key)return false;
 const nav=doc.getElementById('bbPrimaryNavigation');
 if(nav?.dataset?.bbNavigation!=='polished')return false;
 const current=nav.querySelectorAll('[data-bb-nav-current="true"]');
 if(current.length!==1||current[0].dataset.bbNavItem!==key)return false;
 if(!doc.querySelector('.shell>header.top[data-bb-account-polish="banner"]'))return false;
 if(view!=='week')return true;
 // Existing local markers distinguish the final card from raw renderer DOM.
 return app.dataset.bbCompactPlan==='true'&&app.dataset.bbCompactHeader==='true'&&
  !!app.querySelector('.bbpc-week-header')&&!!app.querySelector('.bbpc-week-price')&&
  !!app.querySelector('.bbnext-plan-budget[data-bb-simple-budget]')&&
  !!app.querySelector('#bbPlanHomeSnapshot');
}

export function watchNativeEntryReadiness({window:win=globalThis.window,document:doc=globalThis.document,startup,prepareMembership=()=>{},presentationReady=()=>nativeEntryPresentationReady(doc)}={}){
 let observer,stopped=false,deletionStarted=false;
 const stop=()=>{stopped=true;observer?.disconnect();};
 const entry=/(?:^|\/)(?:index|app)\.html$|\/$/.test(win.location.pathname);
 let complete=false;
 try{complete=JSON.parse(win.localStorage.getItem('bb_onboarding_fresh_once_20261028_v1')||'null')?.complete===true;}catch{}
 const ready=()=>{if(stopped)return;if(entry)check();else{stop();startup.ready();}};
 if(!entry)return {stop,ready};
 function check(){
  if(stopped||doc.readyState==='loading'||!doc.body||!doc.getElementById('app')?.firstElementChild)return;
  // A classic deferred onboarding script runs after parsing, installs its
  // native-ready handler synchronously, and exposes this API in the same turn.
  // Never use old welcome/session markers to skip incomplete modern setup.
  if(!complete&&typeof win.BBOnboard2026?.willShow!=='function')return;
  const deletion=win.BBAccountDeletion;
  if(typeof deletion?.start!=='function')return;
  // start() restores unfinished deletion locks synchronously and is idempotent.
  // Do this before any controls become interactive, even if DOMContentLoaded
  // has not run the module's own startup listener yet.
  if(!deletionStarted){deletion.start();deletionStarted=true;}
  // Fresh setup still hands off to its real module. Returning entries wait
  // only for current local presentation, never a membership/network response.
  if(complete&&!presentationReady())return;
  prepareMembership();
  stop();startup.ready();
 }
 observer=new win.MutationObserver(check);
 observer.observe(doc.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-bbnext-view','data-bb-navigation','data-bb-nav-current','data-bb-compact-plan','data-bb-compact-header','data-bb-account-polish']});
 check();
 return {stop,ready};
}
