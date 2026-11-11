/* Foreground account pantry refresh only. The host owns authentication, scope,
   the durable outbox, conflict handling and every inventory write. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&!root.BBAccountPantryLive){root.BBAccountPantryLive=api.install(root);root.BBAccountPantryLive.start();}
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const installations=new WeakMap(),INTERVAL=4000;
 const SESSION='basketboss_cloud_session_v1',DELETION='basketboss_account_deletion_v1';
 function install(win,options={}){
  if(installations.has(win))return installations.get(win);
  const doc=win.document,storage=options.storage||win.localStorage;
  const later=options.setTimeout||win.setTimeout?.bind(win),cancel=options.clearTimeout||win.clearTimeout?.bind(win),now=options.now||Date.now;
  let started=false,attached=false,ready=!doc||doc.readyState==='complete',timer=null,flight=null,flightIdentity=null,wakeAfterFlight=false,connectAfterFlight=false,deletionPaused=false;
  const host=()=>options.getHost?.()||win.BBReceiptHost;
  const enabled=()=>{try{return host()?.accountPantrySyncEnabled?.()===true;}catch{return false;}};
  const foreground=()=>!doc||doc.visibilityState!=='hidden'&&doc.hidden!==true;
  function deleting(){
   try{
    if(deletionPaused||win.BBAccountDeletion?.isDeleting?.()===true)return true;
    const lock=JSON.parse(storage?.getItem(DELETION)||'null');
    return !!lock&&['pending','deleting','deleted'].includes(lock.phase);
   }catch{return true;}
  }
  function identity(){
   try{
    const value=win.BasketBossSession?.read?.()||JSON.parse(storage?.getItem(SESSION)||'null');
    if(typeof value?.user?.id!=='string'||!value.user.id||typeof value.access_token!=='string'||!value.access_token)return null;
    if(value.expires_at!==undefined&&(!Number.isFinite(Number(value.expires_at))||Number(value.expires_at)*1000<=now()+5000))return null;
    return JSON.stringify([value.user.id,value.access_token]);
   }catch{return null;}
  }
  function paused(connect=false){
   if(!started)return 'stopped';if(!ready)return 'loading';if(!foreground())return 'hidden';if(deleting())return 'deleting';
   if(win.navigator?.onLine===false)return 'offline';if(!enabled())return 'disabled';if(!identity())return 'signed-out';
   try{
    const status=host()?.getAccountPantryStatus?.()?.status;
    if(['blocked','signed-out'].includes(status)||status==='conflict'&&!connect)return status;
   }catch{return 'blocked';}
   return null;
  }
  function clearTimer(){if(timer!==null){cancel?.(timer);timer=null;}}
  function schedule(){
   clearTimer();
   // A blocked/conflicting host is checked locally again later, never forced
   // through a remote read or an automatic replacement of either pantry.
   if(!started||!ready||!foreground()||deleting()||win.navigator?.onLine===false||!enabled()||!identity()||!later)return;
   timer=later(()=>{timer=null;void refresh();},INTERVAL);
  }
  function run(connect=false){
   clearTimer();const reason=paused(connect);
   if(reason){schedule();return Promise.resolve({ok:true,skipped:true,reason});}
   if(flight){if(identity()!==flightIdentity)wakeAfterFlight=true;if(connect){wakeAfterFlight=true;connectAfterFlight=true;}return flight;}
   const current=host(),action=connect?current?.connectHouseholdPantry:current?.refreshAccountPantry;
   if(typeof action!=='function'){schedule();return Promise.resolve({ok:true,skipped:true,reason:'unavailable'});}
   flightIdentity=identity();const captured=flightIdentity;
   const operation=Promise.resolve().then(()=>{
    if(paused(connect)||identity()!==captured)return {ok:true,skipped:true,reason:'context-changed'};
    return action.call(current);
   }).catch(()=>({ok:false,retryable:true,refreshed:false})).finally(()=>{
    if(flight!==operation)return;
    flight=null;flightIdentity=null;
    const again=wakeAfterFlight,nextConnect=connectAfterFlight;wakeAfterFlight=false;connectAfterFlight=false;
    if(again&&!paused(nextConnect))void run(nextConnect);else schedule();
   });
   flight=operation;return operation;
  }
  const refresh=()=>run(false);
  const wake=()=>{if(started)void refresh();};
  const changed=()=>{if(!started)return;if(flight&&identity()!==flightIdentity){wakeAfterFlight=true;connectAfterFlight=false;}void refresh();};
  const householdChanged=event=>{
   if(!started)return;const action=event?.detail?.action;
   if(action==='invite'||action==='accept'){void run(true);return;}
   connectAfterFlight=false;if(flight)wakeAfterFlight=true;void refresh();
  };
  const visibility=()=>{if(!foreground())clearTimer();else wake();};
  const deletionStarted=()=>{deletionPaused=true;wakeAfterFlight=false;connectAfterFlight=false;clearTimer();};
  const deletionCancelled=()=>{deletionPaused=false;if(!started)return;if(flight)wakeAfterFlight=true;void refresh();};
  const loaded=()=>{if(ready)return;ready=true;wake();};
  function attach(){
   if(attached)return;attached=true;
   for(const event of ['focus','pageshow','online','basketboss:native-resumed'])win.addEventListener?.(event,wake);
   win.addEventListener?.('offline',clearTimer);
   win.addEventListener?.('basketboss:session-changed',changed);
   win.addEventListener?.('basketboss:household-changed',householdChanged);
   win.addEventListener?.('basketboss:account-deletion-started',deletionStarted);
   win.addEventListener?.('basketboss:account-deletion-deleted',deletionStarted);
   win.addEventListener?.('basketboss:account-deletion-cancelled',deletionCancelled);
   win.addEventListener?.('storage',event=>{if(event.key===SESSION||event.key===DELETION||event.key===null)changed();});
   doc?.addEventListener?.('visibilitychange',visibility);
   if(!ready){doc?.addEventListener?.('DOMContentLoaded',loaded,{once:true});win.addEventListener?.('load',loaded,{once:true});}
  }
  function start(){if(started)return;started=true;attach();if(ready)void refresh();}
  function stop(){started=false;wakeAfterFlight=false;connectAfterFlight=false;clearTimer();}
  function state(){return {started,enabled:enabled(),signedIn:!!identity(),foreground:foreground(),refreshing:!!flight,timerScheduled:timer!==null,paused:paused()};}
  const api=Object.freeze({start,stop,refresh,state});installations.set(win,api);return api;
 }
 return Object.freeze({install,intervalMs:INTERVAL});
});
