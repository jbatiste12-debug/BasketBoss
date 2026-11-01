// Use the already-rendered local planner before optional deferred enhancements
// finish loading. First-time setup additionally waits for its real module so
// the existing native-ready event prepares onboarding under the native cover.
export function watchNativeEntryReadiness({window:win=globalThis.window,document:doc=globalThis.document,startup,prepareMembership=()=>{}}={}){
 let observer,stopped=false;
 const stop=()=>{stopped=true;observer?.disconnect();};
 const entry=/(?:^|\/)(?:index|app)\.html$|\/$/.test(win.location.pathname);
 let complete=false;
 try{complete=JSON.parse(win.localStorage.getItem('bb_onboarding_fresh_once_20261028_v1')||'null')?.complete===true;}catch{}
 if(!entry)return {stop};
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
  deletion.start();
  prepareMembership();
  stop();startup.ready();
 }
 observer=new win.MutationObserver(check);
 observer.observe(doc.documentElement,{childList:true,subtree:true});
 check();
 return {stop};
}
