import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installNativeAppleAuth} from '../native/apple-auth.mjs';

const credential=()=>({identityToken:'synthetic.identity.token',nonce:'a'.repeat(64)});
function fixture(){
 const events=new Map(),calls=[];let deleting=false,installed=true;
 const plugin={available:async()=>({available:true}),signIn:async()=>{calls.push('signIn');return credential();},cancel:async()=>{calls.push('cancel');}};
 const window={addEventListener:(name,fn)=>events.set(name,fn)};
 const api=installNativeAppleAuth({plugin,window,isAvailable:()=>installed,isDeleting:()=>deleting});
 return {api,plugin,calls,window,event:name=>events.get(name)?.(),setDeleting:x=>{deleting=x;},setInstalled:x=>{installed=x;}};
}

test('Apple bridge only forwards a bounded token and raw nonce to the verified auth owner',async()=>{
 const h=fixture();assert.equal(h.calls.length,0);assert.equal(await h.api.available(),true);
 assert.deepEqual(await h.api.signIn(),credential());assert.deepEqual(h.calls,['signIn']);
 assert.equal('session' in h.window,false);assert.equal('localStorage' in h.window,false);
});

test('Apple bridge rejects unavailable capability and account deletion before authorization',async()=>{
 const h=fixture();h.setInstalled(false);assert.equal(await h.api.available(),false);
 await assert.rejects(()=>h.api.signIn(),{code:'BB_APPLE_UNAVAILABLE'});
 h.setInstalled(true);h.setDeleting(true);assert.equal(await h.api.available(),false);
 await assert.rejects(()=>h.api.signIn(),{code:'BB_APPLE_UNAVAILABLE'});assert.deepEqual(h.calls,[]);
});

test('Apple rapid double taps cannot open two native authorization operations',async()=>{
 const h=fixture();let finish;
 h.plugin.signIn=()=>{h.calls.push('signIn');return new Promise(resolve=>{finish=resolve;});};
 const first=h.api.signIn();await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(()=>h.api.signIn(),{code:'BB_APPLE_BUSY'});assert.deepEqual(h.calls,['signIn']);
 finish(credential());assert.deepEqual(await first,credential());
 h.plugin.signIn=async()=>credential();assert.deepEqual(await h.api.signIn(),credential());
});

test('leaving the page cancels authorization and discards a late Apple credential',async()=>{
 const h=fixture();let finish;
 h.plugin.signIn=()=>new Promise(resolve=>{finish=resolve;});
 const pending=h.api.signIn();await new Promise(resolve=>setImmediate(resolve));
 h.event('pagehide');finish(credential());
 await assert.rejects(()=>pending,{code:'BB_APPLE_CANCELLED'});assert.deepEqual(h.calls,['cancel']);
});

test('account deletion cancels the Apple sheet and rejects any result arriving afterward',async()=>{
 const h=fixture();let finish;
 h.plugin.signIn=()=>new Promise(resolve=>{finish=resolve;});
 const pending=h.api.signIn();await new Promise(resolve=>setImmediate(resolve));
 h.setDeleting(true);h.event('basketboss:account-deletion-started');finish(credential());
 await assert.rejects(()=>pending,{code:'BB_APPLE_CANCELLED'});assert.deepEqual(h.calls,['cancel']);
});

test('a changed BasketBoss session invalidates an outstanding Apple sign-in',async()=>{
 const h=fixture();let finish;
 h.plugin.signIn=()=>new Promise(resolve=>{finish=resolve;});
 const pending=h.api.signIn();await new Promise(resolve=>setImmediate(resolve));
 h.event('basketboss:session-changed');finish(credential());
 await assert.rejects(()=>pending,{code:'BB_APPLE_CANCELLED'});assert.deepEqual(h.calls,['cancel']);
});

test('Apple malformed or oversized results never reach the Supabase token exchange',async()=>{
 const h=fixture();
 for(const result of [{},{identityToken:'bad',nonce:'a'.repeat(64)},{identityToken:'a'.repeat(16385),nonce:'a'.repeat(64)},{identityToken:'one.two.three',nonce:'not-a-random-nonce'}]){
  h.plugin.signIn=async()=>result;await assert.rejects(()=>h.api.signIn(),{code:'BB_APPLE_INVALID_CREDENTIAL'});
 }
 h.plugin.signIn=async()=>{throw Object.assign(Error('private diagnostic that must not leak'),{code:'UNKNOWN'});};
 await assert.rejects(()=>h.api.signIn(),error=>error.code==='BB_APPLE_AUTH_FAILED'&&!error.message.includes('private diagnostic'));
 h.plugin.signIn=async()=>{throw Object.assign(Error('cancelled'),{code:'BB_APPLE_CANCELLED'});};
 await assert.rejects(()=>h.api.signIn(),{code:'BB_APPLE_CANCELLED'});
});

test('fresh Apple authorization code is available only in the returned credential for account deletion',async()=>{
 const h=fixture();const result={...credential(),authorizationCode:'synthetic-authorization-code'};
 h.plugin.signIn=async()=>result;assert.deepEqual(await h.api.signIn(),result);
 for(const authorizationCode of ['', 'x'.repeat(4097), 'invalid\ncode']){
  h.plugin.signIn=async()=>({...credential(),authorizationCode});
  await assert.rejects(()=>h.api.signIn(),{code:'BB_APPLE_INVALID_CREDENTIAL'});
 }
});

test('native Apple source registers the real capability and binds nonce/state without persisting credentials',()=>{
 const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
 const swift=read('ios/App/App/BasketBossAppleAuthPlugin.swift'),project=read('ios/App/App.xcodeproj/project.pbxproj');
 assert.match(swift,/import AuthenticationServices/);assert.match(swift,/SecRandomCopyBytes/);
 assert.match(swift,/request\.nonce = SHA256\.hash/);assert.match(swift,/credential\.state == state/);
 assert.match(swift,/self\.pendingCall == nil/);assert.match(swift,/\.now\(\) \+ 120/);
 assert.match(swift,/rawNonce = nil; requestState = nil/);
 assert.doesNotMatch(swift,/UserDefaults|Keychain|print\(|NSLog|console\./);
 assert.match(read('ios/App/App/App.entitlements'),/<key>com\.apple\.developer\.applesignin<\/key>[\s\S]*<string>Default<\/string>/);
 assert.equal((project.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)||[]).length,2);
 assert.match(project,/com\.apple\.SignInWithApple = \{ enabled = 1;/);
 assert.match(project,/BasketBossAppleAuthPlugin\.swift in Sources/);
 assert.match(read('ios/App/App/AppDelegate.swift'),/registerPluginInstance\(BasketBossAppleAuthPlugin\(\)\)/);
 assert.match(read('native/runtime.mjs'),/registerPlugin\('BasketBossAppleAuth'\)/);
 const config=JSON.parse(read('capacitor.config.json'));
 assert.equal(config.ios.loggingBehavior,'none','Capacitor must not print native credential payloads to the Xcode console, including Debug builds');
});
