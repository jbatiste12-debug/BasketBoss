import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
import {installAndroidRuntime} from '../native/android-runtime.mjs';

function fixture({coldURL=null}={}){
 const listeners=new Map(),docListeners=new Map(),classes=new Set(),storage=new Map(),sessionStore=new Map(),writes=[],calls=[],assigned=[],callbacks=[],external=[];
 let deleted=false,memberships=0,blurred=0,cleanups=0,cleanupResult={ok:true};const plugins=[];
 const win=new EventTarget();win.Event=Event;win.crypto=webcrypto;win.location={href:'https://localhost/index.html',pathname:'/index.html',hash:'',assign:url=>assigned.push(url)};
 win.localStorage={getItem:key=>storage.get(key)??null,setItem(){throw Error('Android wrapper must not write app state');}};win.sessionStorage={getItem:key=>sessionStore.get(key)??null,setItem:(key,value)=>{writes.push([key,value]);sessionStore.set(key,value);}};win.requestAnimationFrame=fn=>fn();win.fetch=async(...args)=>{calls.push(args);return new Response('{}');};win.BBAuthFlow={handleCallbackURL:url=>callbacks.push(url)};win.BBAccountDeletion={isDeleting:()=>deleted};
 const doc={readyState:'loading',documentElement:{classList:{add:name=>classes.add(name),contains:name=>classes.has(name)}},activeElement:{blur(){blurred++;}},getElementById:()=>null,addEventListener:(name,handler)=>docListeners.set(name,handler)};
 const app={addListener:async(name,handler)=>{listeners.set(name,handler);return {remove(){}};},getLaunchUrl:async()=>coldURL?{url:coldURL}:null};
 const runtime=installAndroidRuntime({window:win,document:doc,app,browser:{open:async args=>external.push(args.url)},registerNative:name=>{plugins.push(name);return {clearReceiptPhotos:async()=>{cleanups++;return cleanupResult;}};},haptics:{notification:async()=>{},selectionStart:async()=>{},selectionChanged:async()=>{},selectionEnd:async()=>{},impact:async()=>{}},bars:{setStyle:async()=>{}},splash:{hide:async()=>{}},installStartup:()=>({ready(){}}),watchEntry:()=>({stop(){}}),installMembership:()=>{memberships++;return {refresh(){}};}});
 return {runtime,win,doc,listeners,docListeners,classes,storage,sessionStore,writes,calls,assigned,callbacks,external,plugins,set deleted(value){deleted=value;},set cleanupResult(value){cleanupResult=value;},get cleanups(){return cleanups;},get memberships(){return memberships;},get blurred(){return blurred;}};
}
test('Android runtime has no Apple native plugins or purchase controllers and registers only its real Android cleanup plugin',()=>{
 const h=fixture();assert.equal(h.classes.has('bb-native-android'),true);assert.equal(h.classes.has('bb-native-ios'),false);assert.equal(h.win.BBNative.platform,'android');assert.equal(h.win.BBNativeAppleAuth,undefined);assert.equal(typeof h.win.BBNative.clearTemporaryData,'function');assert.deepEqual(h.plugins,['BasketBossAndroid']);
 const source=fs.readFileSync(new URL('../native/android-runtime.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/installNativeApple|BasketBossPurchases|BasketBossNavigation|Camera\.getPhoto/);
 h.win.BBNative.dismissKeyboard();assert.equal(h.blurred,1);h.runtime.prepareMembership();h.runtime.prepareMembership();assert.equal(h.memberships,1);
 assert.equal(h.win.BBNativeMembership.open(),true);assert.deepEqual(h.assigned,['https://localhost/pricing-sandbox.html']);assert.deepEqual(h.writes,[]);assert.equal(h.win.BasketBossVerifiedPremium,undefined);
});
test('Android photo cleanup requires an explicit native success and propagates failure to account deletion',async()=>{
 const h=fixture();assert.deepEqual(await h.win.BBNative.clearTemporaryData(),{ok:true});assert.equal(h.cleanups,1);
 for(const result of [{ok:false},{},null]){h.cleanupResult=result;await assert.rejects(()=>h.win.BBNative.clearTemporaryData(),error=>error.code==='BB_NATIVE_CLEANUP');}
 assert.equal(h.cleanups,4);assert.deepEqual(h.writes,[]);
});
test('Android membership navigation respects startup and deletion barriers',()=>{
 const h=fixture();h.classes.add('bb-native-starting');assert.equal(h.win.BBNativeMembership.open(),false);h.classes.delete('bb-native-starting');h.deleted=true;assert.equal(h.win.BBNativeMembership.open(),false);assert.deepEqual(h.assigned,[]);
});
test('warm Android auth callbacks use only the existing strict auth endpoint and existing flow owner',async()=>{
 const h=fixture();for(const url of ['https://evil.example/auth/callback','basketboss://other/callback','basketboss://auth/elsewhere','basketboss://user@auth/callback','basketboss://auth:443/callback'])await h.runtime.authLink(url);
 assert.equal(h.callbacks.length,0);const url='basketboss://auth/callback?bb_auth=signup&code=synthetic-private-code';await h.runtime.authLink(url);await h.runtime.authLink(url);assert.deepEqual(h.callbacks,[url]);assert.equal(h.writes[0][0],'basketboss_last_auth_launch_v1');assert.match(h.writes[0][1],/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(h.writes).includes('synthetic-private-code'));assert.equal(h.calls.length,0,'auth controller, not wrapper, owns exchanges');
 h.deleted=true;await h.runtime.authLink('basketboss://auth/callback?code=another');assert.equal(h.callbacks.length,1);
});
test('cold callback fingerprint prevents replay without changing app localStorage keys',async()=>{
 const h=fixture(),url='basketboss://auth/callback?bb_auth=recovery&code=synthetic';await h.runtime.authLink(url,true);assert.equal(h.callbacks.length,1);
 const fingerprint=h.sessionStore.get('basketboss_last_auth_launch_v1'),next=fixture();next.sessionStore.set('basketboss_last_auth_launch_v1',fingerprint);await next.runtime.authLink(url,true);assert.equal(next.callbacks.length,0);assert.deepEqual(next.writes,[]);
});
test('foreground resume emits existing refresh signals and purchase links never open external payment',async()=>{
 const h=fixture();let focus=0,resume=0;h.win.addEventListener('focus',()=>focus++);h.win.addEventListener('basketboss:native-resumed',()=>resume++);h.listeners.get('appStateChange')({isActive:true});assert.equal(focus,1);assert.equal(resume,1);
 await h.win.BBNative.openExternal('https://checkout.paddle.com/fixture');assert.deepEqual(h.external,[]);assert.deepEqual(h.assigned,['https://localhost/pricing-sandbox.html']);await h.win.BBNative.openExternal('https://example.test/help');assert.deepEqual(h.external,['https://example.test/help']);
 const event={target:{closest:selector=>selector==='a[href]'?{getAttribute:()=>'/api/subscription/checkout'}:null},preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};h.docListeners.get('click')(event);assert.equal(event.prevented,true);assert.equal(h.assigned.length,2);
 const form={target:{getAttribute:()=>'/pricing-sandbox.html'},preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};h.docListeners.get('submit')(form);assert.equal(form.prevented,true);
});
