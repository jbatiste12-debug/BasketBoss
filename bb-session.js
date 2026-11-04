/* Persisted Supabase sessions: refresh short-lived access tokens without asking
 * for credentials again. Saved identity never grants server or Premium access. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&!root.BasketBossSession){root.BasketBossSession=api.install(root);root.BasketBossSession.start();}
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_cloud_session_v1',LOCK='basketboss_account_deletion_v1';
 const rejected=new Set(['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','user_not_found','user_banned','invalid_grant']);
 function install(win,options={}){
  const local=options.storage||win.localStorage,doc=win.document,now=options.now||Date.now;
  const fetcher=options.fetch||win.fetch?.bind(win),later=options.setTimeout||win.setTimeout?.bind(win),cancel=options.clearTimeout||win.clearTimeout?.bind(win);
  let started=false,epoch=0,flight=null,timer=null,retry=false,emitting=false;
  const raw=()=>{try{return local.getItem(KEY);}catch{return null;}};
  const lockRaw=()=>{try{return local.getItem(LOCK);}catch{return 'unavailable';}};
  let observedRaw=raw(),observedLock=lockRaw();
  const read=()=>{try{const s=JSON.parse(raw()||'null');return s&&typeof s.access_token==='string'&&s.access_token&&typeof s.user?.id==='string'&&s.user.id?s:null;}catch{return null;}};
  const usable=s=>!!s&&Number.isFinite(Number(s.expires_at))&&Number(s.expires_at)*1000>now()+5000;
  const renewable=s=>typeof s?.refresh_token==='string'&&!!s.refresh_token;
  const blocked=()=>{
   if(win.BBAccountDeletion?.isDeleting?.()===true)return true;
   try{const lock=JSON.parse(local.getItem(LOCK)||'null');return !!lock&&['pending','deleting','deleted'].includes(lock.phase);}catch{return true;}
  };
  const config=()=>win.BASKETBOSS_CLOUD_CONFIG||{};
  const enabled=()=>/^https:\/\//.test(config().url||'')&&!!config().anonKey&&!config().url.includes('YOUR_PROJECT')&&typeof fetcher==='function';
  const foreground=()=>!doc||doc.visibilityState!=='hidden';
  function stopTimer(){if(timer!==null){cancel?.(timer);timer=null;}}
  function emit(){emitting=true;try{win.dispatchEvent(new win.Event('basketboss:session-changed'));}finally{emitting=false;}}
  function schedule(delay){
   stopTimer();const s=read();
   if(!started||blocked()||!enabled()||!renewable(s)||!foreground()||win.navigator?.onLine===false||!later)return;
   const remaining=Number(s.expires_at)*1000-now()-90000;
   const wait=delay===undefined?(Number.isFinite(remaining)?Math.max(1000,Math.min(60000,remaining)):30000):delay;
   timer=later(()=>{timer=null;void ensureFresh();},wait);
  }
  function remember(s){
   if(blocked())return false;
   // Persist first. A failed storage write must not claim a remembered login.
   try{if(s){const value=JSON.stringify(s);local.setItem(KEY,value);if(local.getItem(KEY)!==value)return false;}else{local.removeItem(KEY);if(local.getItem(KEY)!==null)return false;}}catch{return false;}
   epoch++;observedRaw=raw();retry=false;stopTimer();emit();schedule();return true;
  }
  function state(){const s=read();return {remembered:!blocked()&&!!s&&(usable(s)||renewable(s)),refreshing:!!flight,needsConnection:!!s&&!usable(s)&&retry};}
  async function exchange(){
   const s=read(),before=raw(),version=epoch;
   if(blocked()||!s)return null;
   if(usable(s)&&Number(s.expires_at)*1000>now()+90000){retry=false;schedule();return s;}
   if(!renewable(s)||!enabled())return usable(s)?s:null;
   if(win.navigator?.onLine===false){retry=true;emit();return usable(s)?s:null;}
   let response,data;
   try{
    const Controller=win.AbortController||globalThis.AbortController,controller=Controller?new Controller():null;
    let deadline=null;
    const request=(async()=>{const result=await fetcher(config().url.replace(/\/$/,'')+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:config().anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token}),...(controller?{signal:controller.signal}:{})});return {response:result,data:await result.json()};})();
    const timeout=new Promise((_,reject)=>{if(later)deadline=later(()=>{controller?.abort();reject(new Error('Session refresh timed out'));},15000);});
    try{({response,data}=await Promise.race([request,timeout]));}finally{if(deadline!==null)cancel?.(deadline);}
    // A logout, deletion or another tab/account supersedes this response.
    if(version!==epoch||blocked()||raw()!==before)return usable(read())?read():null;
    if(!response.ok){
     const code=data?.code||data?.error_code||data?.error;
     if((response.status===400||response.status===401||response.status===403)&&rejected.has(code)){remember(null);return null;}
     retry=true;emit();schedule(30000);return usable(s)?s:null;
    }
    const expires=Number(data?.expires_in),expiry=Number(data?.expires_at)||Math.floor(now()/1000)+expires;
    if(typeof data?.access_token!=='string'||!data.access_token||typeof data?.refresh_token!=='string'||!data.refresh_token||data.user?.id!==s.user.id||!Number.isFinite(expiry)||expiry*1000<=now()+5000){retry=true;emit();schedule(30000);return usable(s)?s:null;}
    const next={...data,expires_at:expiry};
    if(!remember(next)){retry=true;emit();schedule(30000);return usable(s)?s:null;}
    return next;
   }catch{
    if(version===epoch&&!blocked()&&raw()===before){retry=true;emit();schedule(30000);}
    return usable(read())?read():null;
   }
  }
  function ensureFresh(){
   if(flight)return flight;
   if(blocked())return Promise.resolve(null);
   // Web Locks serialize rotated refresh tokens across tabs where supported.
   const run=()=>exchange();
   const job=win.navigator?.locks?.request?win.navigator.locks.request('basketboss-session-refresh',{mode:'exclusive'},run):run();
   const current=Promise.resolve(job).catch(()=>null).finally(()=>{if(flight===current){flight=null;schedule(retry?30000:undefined);}});
   flight=current;return current;
  }
  function resume(){if(!blocked()&&foreground())void ensureFresh();}
  function start(){
   if(started)return;started=true;
   win.addEventListener?.('focus',resume);win.addEventListener?.('online',resume);win.addEventListener?.('pageshow',resume);win.addEventListener?.('basketboss:native-resumed',resume);
   doc?.addEventListener?.('visibilitychange',()=>{if(foreground())resume();else stopTimer();});
   win.addEventListener?.('storage',event=>{if(event.key!==KEY&&event.key!==LOCK&&event.key!==null)return;const next=raw(),nextLock=lockRaw();if(next!==observedRaw||nextLock!==observedLock){epoch++;observedRaw=next;observedLock=nextLock;retry=false;}stopTimer();emit();resume();});
   win.addEventListener?.('basketboss:session-changed',()=>{if(emitting)return;const next=raw();if(next!==observedRaw){epoch++;observedRaw=next;retry=false;}stopTimer();schedule();});
   for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener?.(name,()=>{epoch++;stopTimer();});
   win.addEventListener?.('basketboss:account-deletion-cancelled',()=>{epoch++;resume();});
   // Deferred deletion setup restores its lock before any refresh network call.
   const ready=()=>{win.BBAccountDeletion?.start?.();resume();};
   if(doc?.readyState==='loading')doc.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
  }
  return Object.freeze({start,read,state,remember,ensureFresh});
 }
 return Object.freeze({install});
});
