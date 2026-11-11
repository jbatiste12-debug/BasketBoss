import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {install,intervalMs}=createRequire(import.meta.url)('../bb-account-pantry-live.js');
const SESSION='basketboss_cloud_session_v1',DELETION='basketboss_account_deletion_v1';
const clock=1800000000000;
const account=(id='owner',token=id+'-token')=>({user:{id},access_token:token,expires_at:clock/1000+3600});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({session=account(),enabled=true,status='synced',online=true,visible=true,readyState='complete',respond=()=>({ok:true,refreshed:true}),lock=null}={}){
 const values=new Map([['basketboss_321_v7_measured_pantry','{"rice|g":233.333333}'],['basketboss_makeameal_v1_inventory','{"cupboard|rice":{"qty":233.333333,"unit":"g"}}']]);
 if(session)values.set(SESSION,JSON.stringify(session));if(lock)values.set(DELETION,JSON.stringify(lock));
 const win=new EventTarget(),doc=new EventTarget(),timers=new Map(),calls=[];let timerId=0,active=0,maximumActive=0,currentStatus=status,currentEnabled=enabled,answer=respond;
 Object.assign(doc,{readyState,visibilityState:visible?'visible':'hidden',hidden:!visible});
 const storage={getItem:key=>values.get(key)??null,setItem(){throw Error('Lifecycle must not write storage');},removeItem(){throw Error('Lifecycle must not remove storage');}};
 const read=()=>JSON.parse(values.get(SESSION)||'null');
 const host={accountPantrySyncEnabled:()=>currentEnabled,getAccountPantryStatus:()=>({enabled:currentEnabled,status:currentStatus}),
  async refreshAccountPantry(){calls.push({actor:read()?.user?.id,token:read()?.access_token});active++;maximumActive=Math.max(maximumActive,active);try{return await answer();}finally{active--;}}
 };
 Object.assign(win,{document:doc,Event,navigator:{onLine:online},localStorage:storage,BasketBossSession:{read},BBReceiptHost:host});
 const options={now:()=>clock,setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id)};
 const api=install(win,options);
 const emit=(type,fields={})=>{const event=new Event(type);Object.assign(event,fields);win.dispatchEvent(event);};
 const visibility=value=>{doc.hidden=!value;doc.visibilityState=value?'visible':'hidden';doc.dispatchEvent(new Event('visibilitychange'));};
 const fire=async()=>{assert.equal(timers.size,1,'one foreground timer only');const [id,timer]=[...timers][0];assert.equal(timer.delay,4000);timers.delete(id);timer.fn();await settle();};
 return {win,doc,values,timers,calls,api,host,options,emit,visibility,fire,read,
  setStatus:value=>{currentStatus=value;},setEnabled:value=>{currentEnabled=value;},setResponse:value=>{answer=value;},
  setSession:value=>{if(value)values.set(SESSION,JSON.stringify(value));else values.delete(SESSION);},
  get maximumActive(){return maximumActive;}};
}

test('one immediate foreground refresh and one four-second timer never write pantry or session storage',async()=>{
 const h=fixture(),before=new Map(h.values);assert.equal(intervalMs,4000);
 h.api.start();await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,1);
 await h.fire();assert.equal(h.calls.length,2);assert.equal(h.timers.size,1);
 await h.fire();assert.equal(h.calls.length,3);assert.equal(h.maximumActive,1);assert.deepEqual(h.values,before);
 assert.deepEqual(h.api.state(),{started:true,enabled:true,signedIn:true,foreground:true,refreshing:false,timerScheduled:true,paused:null});
});

test('guest, disabled, malformed and expired identities cannot start account pantry requests',async()=>{
 for(const options of [{session:null},{enabled:false},{session:{user:{id:'owner'},access_token:''}},{session:{...account(),expires_at:clock/1000}},{session:{...account(),expires_at:'invalid'}}]){
  const h=fixture(options);h.api.start();h.emit('focus');await settle();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
 }
 const h=fixture();h.values.set(SESSION,'{broken');h.api.start();await settle();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
 h.setSession(account());h.emit('basketboss:session-changed');await settle();assert.equal(h.calls.length,1);
});

test('loading waits for host configuration and DOM readiness before its first request',async()=>{
 const h=fixture({readyState:'interactive',enabled:false});h.api.start();h.emit('focus');await settle();assert.equal(h.calls.length,0);
 h.setEnabled(true);h.doc.readyState='complete';h.doc.dispatchEvent(new Event('DOMContentLoaded'));await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,1);
  h.emit('load');await settle();assert.equal(h.calls.length,1,'the later window load must not start a duplicate startup refresh');
});

test('focus, visibility, native resume and direct refresh share the same in-flight promise',async()=>{
 const pending=deferred(),h=fixture({respond:()=>pending.promise});h.api.start();await settle();
 const first=h.api.refresh();assert.equal(h.api.refresh(),first);
 h.emit('focus');h.emit('pageshow');h.emit('basketboss:native-resumed');h.doc.dispatchEvent(new Event('visibilitychange'));h.emit('online');
 await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 pending.resolve({ok:true,refreshed:true});await first;await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,1);assert.equal(h.maximumActive,1);
});

test('background and offline lifecycle events stop polling until foreground connectivity returns',async()=>{
 const h=fixture({visible:false});h.api.start();h.emit('focus');await settle();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
 h.visibility(true);await settle();assert.equal(h.calls.length,1);
 h.visibility(false);assert.equal(h.timers.size,0);h.emit('focus');await settle();assert.equal(h.calls.length,1);
 h.win.navigator.onLine=false;h.visibility(true);await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 h.win.navigator.onLine=true;h.emit('online');await settle();assert.equal(h.calls.length,2);assert.equal(h.timers.size,1);
 h.win.navigator.onLine=false;h.emit('offline');assert.equal(h.timers.size,0);
});

test('a slow refresh cannot create a second foreground runner and completion while hidden schedules nothing',async()=>{
 const pending=deferred(),h=fixture({respond:()=>pending.promise});h.api.start();await settle();
 h.visibility(false);h.emit('focus');await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 pending.resolve({ok:true,refreshed:true});await settle();assert.equal(h.timers.size,0);
 h.setResponse(()=>({ok:true,refreshed:true}));h.visibility(true);await settle();assert.equal(h.calls.length,2);assert.equal(h.maximumActive,1);
});

test('host conflict, blocked and signed-out states pause requests without resolving or replacing stock',async()=>{
 for(const status of ['conflict','blocked','signed-out']){
  const h=fixture({status}),before=new Map(h.values);
  h.host.syncAccountPantry=()=>{throw Error('Automatic conflict resolution is forbidden');};
  h.api.start();h.emit('basketboss:household-changed');await settle();await h.fire();assert.equal(h.calls.length,0);assert.equal(h.api.state().paused,status);assert.deepEqual(h.values,before);
  h.setStatus('pending');await h.fire();assert.equal(h.calls.length,1);assert.deepEqual(h.values,before);
 }
});

test('an unprobed host offline label can hydrate online and pending writes remain the host’s responsibility',async()=>{
 const h=fixture({status:'offline',respond:()=>({ok:false,queued:true,refreshed:false})});h.api.start();await settle();assert.equal(h.calls.length,1,'availability has not yet been probed; online host refresh may initialize it');
 h.setStatus('pending');await h.fire();assert.equal(h.calls.length,2);assert.equal(h.maximumActive,1);assert.equal(h.timers.size,1);
 assert.equal(h.values.get('basketboss_321_v7_measured_pantry'),'{"rice|g":233.333333}');
});

test('account and token changes wait for the earlier request then refresh the new identity once',async()=>{
 for(const next of [account('partner'),account('owner','rotated-token')]){
  const pending=deferred(),h=fixture({respond:()=>pending.promise});h.api.start();await settle();
  h.setSession(next);h.emit('basketboss:session-changed');h.emit('basketboss:session-changed');await settle();assert.equal(h.calls.length,1);
  h.setResponse(()=>({ok:true,refreshed:true}));pending.resolve({ok:false,refreshed:false});await settle();await settle();
  assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1],{actor:next.user.id,token:next.access_token});assert.equal(h.maximumActive,1);assert.equal(h.timers.size,1);
 }
});

test('logout during a request does not schedule or replay an earlier account refresh',async()=>{
 const pending=deferred(),h=fixture({respond:()=>pending.promise});h.api.start();await settle();h.setSession(null);h.emit('basketboss:session-changed');
 pending.resolve({ok:true,refreshed:true});await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);assert.equal(h.api.state().signedIn,false);
});

test('a household event queues only one follow-up and delegates scope adoption to the host',async()=>{
 const pending=deferred(),h=fixture({respond:()=>pending.promise});h.api.start();await settle();
 h.emit('basketboss:household-changed');h.emit('basketboss:household-changed');await settle();assert.equal(h.calls.length,1);
 h.setResponse(()=>({ok:true,refreshed:true}));pending.resolve({ok:true,refreshed:true});await settle();await settle();assert.equal(h.calls.length,2);assert.equal(h.maximumActive,1);
 h.setStatus('conflict');h.emit('basketboss:household-changed');await settle();assert.equal(h.calls.length,2,'a changed scope remains held for the existing host review');
});

test('only explicit invite or acceptance invokes the host connection path through a held scope conflict',async()=>{
 for(const action of ['invite','accept']){
  const h=fixture({status:'conflict'});let connections=0;
  h.host.connectHouseholdPantry=async()=>{connections++;h.setStatus('pending');return {ok:false,waitingForOwner:true};};
  h.api.start();await settle();assert.equal(h.calls.length,0);
  h.emit('basketboss:household-changed',{detail:{action}});await settle();assert.equal(connections,1);assert.equal(h.calls.length,0);
  await h.fire();assert.equal(connections,1,'normal polling stays on the guarded refresh path');assert.equal(h.calls.length,1,'the host can probe a waiting lead through refresh');
 }
});

test('explicit connection waits for the active refresh and cannot leak across an account switch or unlink',async()=>{
 for(const change of ['none','account','unlink']){
  const pending=deferred(),h=fixture({respond:()=>pending.promise});let connections=0;
  h.host.connectHouseholdPantry=async()=>{connections++;return {ok:true};};
  h.api.start();await settle();h.emit('basketboss:household-changed',{detail:{action:'accept'}});
  if(change==='account'){h.setSession(account('other'));h.emit('basketboss:session-changed');}
  if(change==='unlink')h.emit('basketboss:household-changed',{detail:{action:'unlink'}});
  await settle();assert.equal(connections,0,'connection never overlaps the existing refresh');
  h.setResponse(()=>({ok:true}));pending.resolve({ok:true});await settle();await settle();assert.equal(connections,change==='none'?1:0);
 }
});

test('an explicit household connection cannot bypass hidden or deletion pauses',async()=>{
 const h=fixture({visible:false,status:'conflict'});let connections=0;h.host.connectHouseholdPantry=async()=>{connections++;};
 h.api.start();h.emit('basketboss:household-changed',{detail:{action:'invite'}});await settle();assert.equal(connections,0);
 h.visibility(true);h.emit('basketboss:account-deletion-started');h.emit('basketboss:household-changed',{detail:{action:'accept'}});await settle();assert.equal(connections,0);
});

test('persisted and immediate deletion guards pause requests until deletion is cancelled',async()=>{
 for(const phase of ['pending','deleting','deleted']){
  const h=fixture({lock:{phase}});h.api.start();h.emit('focus');await settle();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
  h.values.delete(DELETION);h.emit('basketboss:account-deletion-cancelled');await settle();assert.equal(h.calls.length,1);
 }
 const h=fixture();h.api.start();await settle();h.emit('basketboss:account-deletion-started');assert.equal(h.timers.size,0);h.emit('focus');await settle();assert.equal(h.calls.length,1,'the lifecycle event blocks even before deferred deletion UI initializes');
 h.emit('basketboss:account-deletion-cancelled');await settle();assert.equal(h.calls.length,2);
});

test('host failures retry only on the next single interval and never write an alternate pantry',async()=>{
 let fail=true;const h=fixture({respond:()=>{if(fail)throw Error('network unavailable');return {ok:true,refreshed:true};}}),before=new Map(h.values);
 h.api.start();await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,1);
 fail=false;await h.fire();assert.equal(h.calls.length,2);assert.deepEqual(h.values,before);
});

test('installation and start are idempotent, stop cancels timers, and restart keeps one runner',async()=>{
 const h=fixture();assert.equal(install(h.win,h.options),h.api);h.api.start();h.api.start();await settle();assert.equal(h.calls.length,1);
 h.api.stop();assert.equal(h.timers.size,0);h.emit('focus');h.emit('online');await settle();assert.equal(h.calls.length,1);
 h.api.start();await settle();assert.equal(h.calls.length,2);assert.equal(h.timers.size,1);
 h.setEnabled(false);await h.fire();assert.equal(h.calls.length,2);assert.equal(h.timers.size,0);
});

test('cross-tab session changes wake the same guarded lifecycle, unrelated storage does not',async()=>{
 const h=fixture({session:null});h.api.start();h.setSession(account('partner'));h.emit('storage',{key:'unrelated'});await settle();assert.equal(h.calls.length,0);
 h.emit('storage',{key:SESSION});await settle();assert.equal(h.calls.length,1);
 h.values.set(DELETION,JSON.stringify({phase:'pending'}));h.emit('storage',{key:DELETION});await settle();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
