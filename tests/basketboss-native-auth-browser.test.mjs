import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeAuthBrowser} from '../native/auth-browser.mjs';

const ORIGIN='https://native-test-project.supabase.co';
const authorize=ORIGIN+'/auth/v1/authorize?provider=google&redirect_to=basketboss%3A%2F%2Fauth%2Fcallback%3Fbb_auth%3Dgoogle&code_challenge=synthetic';
const callback='basketboss://auth/callback?bb_auth=google&code=synthetic-code';
function deferred(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
function fixture(){
 const listeners=[],events=new Map(),calls=[],timers=new Map(),dispatched=[];let timerId=0,deleting=false,starting=false,dialog=false,cancelled=0;
 const win={Event,dispatchEvent(event){dispatched.push(event.type);},BASKETBOSS_CLOUD_CONFIG:{url:ORIGIN},document:{getElementById:()=>({open:dialog}),documentElement:{classList:{contains:()=>starting}}},BBAuthFlow:{cancelGoogleSignIn(){cancelled++;}},addEventListener(name,handler){events.set(name,handler);},setTimeout(handler,delay){const id=++timerId;timers.set(id,{handler,delay});return id;},clearTimeout(id){timers.delete(id);}};
 const browser={async addListener(name,handler){assert.equal(name,'browserFinished');const entry={handler,removed:false};listeners.push(entry);return {async remove(){entry.removed=true;calls.push('remove');}};},async open(options){calls.push(['open',options]);},async close(){calls.push('close');}};
 const api=installNativeAuthBrowser({window:win,browser,isDeleting:()=>deleting});
 return {api,win,browser,calls,listeners,timers,dispatched,get cancelled(){return cancelled;},setDeleting(value){deleting=value;},setStarting(value){starting=value;},setDialog(value){dialog=value;},event(name){events.get(name)?.();},finish(index=listeners.length-1){listeners[index]?.handler();},timeout(delay){const entry=[...timers.entries()].find(([,value])=>value.delay===delay);assert.ok(entry,'expected bounded timer');timers.delete(entry[0]);entry[1].handler();}};
}

test('Google browser opens only the configured Supabase OAuth endpoint without creating sessions or entitlements',async()=>{
 const h=fixture();await h.api.open(authorize);
 assert.deepEqual(h.calls,[['open',{url:authorize,presentationStyle:'popover'}]]);assert.equal(h.cancelled,0);
 assert.equal(h.win.BBNativeAuthBrowser,h.api);assert.equal('localStorage' in h.win,false);assert.equal('BasketBossVerifiedPremium' in h.win,false);
 assert.equal(installNativeAuthBrowser({window:h.win,browser:h.browser}),h.api);assert.equal(h.listeners.length,1);
});

test('invalid origins, URL credentials, provider ambiguity and other paths never reach the browser',async()=>{
 const h=fixture();
 for(const value of ['http://native-test-project.supabase.co/auth/v1/authorize?provider=google','https://evil.example/auth/v1/authorize?provider=google','https://other-project.supabase.co/auth/v1/authorize?provider=google','https://native-test-project.supabase.co.evil.example/auth/v1/authorize?provider=google','https://user@native-test-project.supabase.co/auth/v1/authorize?provider=google',ORIGIN+':8443/auth/v1/authorize?provider=google',ORIGIN+'/auth/v1/token?provider=google',ORIGIN+'/auth/v1/authorize?provider=apple',ORIGIN+'/auth/v1/authorize?provider=google&provider=apple',authorize+'#unexpected','basketboss://auth/callback?code=synthetic','not a URL']){
  await assert.rejects(()=>h.api.open(value),{code:'BB_GOOGLE_BROWSER_URL'});
 }
 assert.deepEqual(h.calls,[]);assert.equal(h.listeners.length,0);
 delete h.win.BASKETBOSS_CLOUD_CONFIG;await assert.rejects(()=>h.api.open(authorize),{code:'BB_GOOGLE_BROWSER_URL'});
});

test('deletion, startup and the open deletion dialog block launch before allocating browser ownership',async()=>{
 const h=fixture();
 for(const [set,value]of [[h.setDeleting,true],[h.setStarting,true],[h.setDialog,true]]){set(value);await assert.rejects(()=>h.api.open(authorize),{code:'BB_GOOGLE_BROWSER_UNAVAILABLE'});set(false);}
 assert.deepEqual(h.calls,[]);assert.equal(h.listeners.length,0);
});

test('rapid Google taps share no second browser operation and a strict callback closes the owned browser',async()=>{
 const h=fixture();await h.api.open(authorize);await assert.rejects(()=>h.api.open(authorize),{code:'BB_GOOGLE_BROWSER_BUSY'});
 assert.equal(await h.api.complete(callback),true);assert.deepEqual(h.calls.map(value=>Array.isArray(value)?value[0]:value),['open','remove','close']);
 assert.equal(h.cancelled,0);assert.equal(h.listeners[0].removed,true);assert.equal(await h.api.complete(callback),false);
 await h.api.open(authorize);assert.equal(h.listeners.length,2);
});

test('unrelated callbacks cannot close the Google browser or trigger its cancellation',async()=>{
 const h=fixture();await h.api.open(authorize);
 for(const value of ['basketboss://auth/callback?bb_auth=apple&code=synthetic','basketboss://auth/callback?code=synthetic','basketboss://auth/callback?bb_auth=google','https://basketboss.co.uk/app?bb_auth=google&code=synthetic','basketboss://user@auth/callback?bb_auth=google&code=synthetic','basketboss://auth:443/callback?bb_auth=google&code=synthetic','basketboss://other/callback?bb_auth=google&code=synthetic','basketboss://auth/wrong?bb_auth=google&code=synthetic','basketboss://auth/callback?bb_auth=google&bb_auth=apple&code=synthetic'])assert.equal(await h.api.complete(value),false);
 assert.equal(h.calls.includes('close'),false);assert.equal(h.cancelled,0);
 assert.equal(await h.api.complete('basketboss://auth/callback?bb_auth=google#error=access_denied'),true);
});

test('browser user cancellation clears only the owned Google operation and permits retry',async()=>{
 const h=fixture();await h.api.open(authorize);h.finish();await flush();assert.equal(h.cancelled,1);assert.equal(h.listeners[0].removed,true);assert.equal(h.calls.includes('close'),false);
 await h.api.open(authorize);h.finish(0);await flush();assert.equal(h.cancelled,1,'an old event cannot cancel a new Google browser');
 h.finish(1);assert.equal(h.cancelled,2);
});

test('explicit cancellation and callback completion clear ownership before Browser.close emits browserFinished',async()=>{
 const h=fixture();h.browser.close=async()=>{h.calls.push('close');h.finish();};
 await h.api.open(authorize);assert.equal(await h.api.complete(callback),true);assert.equal(h.cancelled,0);
 await h.api.open(authorize);await h.api.cancel();assert.equal(h.cancelled,0,'explicit cancel must not recurse into the auth owner');
 const closes=h.calls.filter(value=>value==='close').length;await h.api.cancel();assert.equal(h.calls.filter(value=>value==='close').length,closes,'unowned browser is untouched');
});

test('native open failures release the browser and never leak provider/native error text',async()=>{
 const h=fixture();h.browser.open=async()=>{throw Error('secret native error payload');};
 await assert.rejects(()=>h.api.open(authorize),error=>error.code==='BB_GOOGLE_BROWSER_OPEN'&&!error.message.includes('secret'));await flush();
 assert.equal(h.listeners[0].removed,true);assert.equal(h.cancelled,0);
 h.browser.open=async()=>{};await h.api.open(authorize);assert.equal(h.listeners.length,2);
});

test('a hung launch times out at10 seconds, detaches its listener and allows a fresh launch',async()=>{
 const h=fixture(),gate=deferred();h.browser.open=()=>gate.promise;
 const pending=h.api.open(authorize);await flush();h.timeout(10000);
 await assert.rejects(()=>pending,{code:'BB_GOOGLE_BROWSER_TIMEOUT'});await flush();assert.equal(h.listeners[0].removed,true);assert.equal(h.cancelled,0);
 h.browser.open=async()=>{};await h.api.open(authorize);const closes=h.calls.filter(value=>value==='close').length;gate.resolve();await flush();
 assert.equal(h.calls.filter(value=>value==='close').length,closes,'a late old launch cannot close the newer owned operation');
 assert.equal(await h.api.complete(callback),true);
});

test('callback close failure or timeout cannot block the existing callback verifier indefinitely',async()=>{
 const h=fixture();await h.api.open(authorize);h.browser.close=async()=>{throw Error('native close error');};assert.equal(await h.api.complete(callback),true);assert.equal(h.cancelled,0);
 await h.api.open(authorize);h.browser.close=()=>new Promise(()=>{});const complete=h.api.complete(callback);await flush();h.timeout(1500);assert.equal(await complete,true);assert.equal(h.cancelled,0);
});

test('deletion and leaving the page close only an owned Google browser without granting or cancelling another actor',async()=>{
 for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted','pagehide']){
  const h=fixture();await h.api.open(authorize);if(name.startsWith('basketboss:'))h.setDeleting(true);h.event(name);await flush();
  assert.equal(h.calls.filter(value=>value==='close').length,1);assert.equal(h.cancelled,0);assert.equal(await h.api.complete(callback),false);
  h.event(name);await flush();assert.equal(h.calls.filter(value=>value==='close').length,1);
 }
});

test('a cold launch callback without an owned browser does not open, close or authenticate anything',async()=>{
 const h=fixture();assert.equal(await h.api.complete(callback),false);assert.equal(await h.api.complete('basketboss://auth/callback?bb_auth=google&error=access_denied'),false);await h.api.cancel();assert.deepEqual(h.calls,[]);assert.equal(h.cancelled,0);
});

test('a browser still closing cannot cancel or replace a newly opened Google operation',async()=>{
 const h=fixture(),gate=deferred();await h.api.open(authorize);h.browser.close=()=>gate.promise;
 const closing=h.api.complete(callback);await flush();await assert.rejects(()=>h.api.open(authorize),{code:'BB_GOOGLE_BROWSER_BUSY'});
 gate.resolve();assert.equal(await closing,true);await h.api.open(authorize);assert.equal(h.cancelled,0);
});

test('a strict callback arriving before Browser.open resolves finishes only the launch handoff',async()=>{
 const h=fixture(),gate=deferred();h.browser.open=()=>gate.promise;
 const opening=h.api.open(authorize);await flush();assert.equal(await h.api.complete(callback),true);
 gate.resolve();await opening;assert.equal(h.cancelled,0);assert.equal(h.calls.filter(value=>value==='close').length,1);
 assert.equal('localStorage' in h.win,false,'transport does not install any verified session');
});

test('Browser.open rejection caused by closing a completed return does not report cancellation over verification',async()=>{
 const h=fixture(),gate=deferred();h.browser.open=()=>gate.promise;
 h.browser.close=async()=>{h.calls.push('close');gate.reject(Error('native launch closed by completed return'));};
 const opening=h.api.open(authorize);await flush();assert.equal(await h.api.complete(callback),true);
 await opening;assert.equal(h.cancelled,0);assert.equal(h.listeners[0].removed,true);
});

test('late transport installation emits one readiness event after its API exists',()=>{
 const h=fixture();assert.deepEqual(h.dispatched,['basketboss:auth-browser-ready']);assert.equal(typeof h.win.BBNativeAuthBrowser.open,'function');
 assert.equal(installNativeAuthBrowser({window:h.win,browser:h.browser}),h.api);assert.deepEqual(h.dispatched,['basketboss:auth-browser-ready']);
});
