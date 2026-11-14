import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const marker='<script id="bb16AccountShortcutJs">',start=html.indexOf(marker);
assert.ok(start>=0);const source=html.slice(start+marker.length,html.indexOf('</script>',start));

function fixture(){
 const events=new Map(),documentEvents=new Map(),attributes=new Map();
 let remembered=false,invalid=false,opens=0;
 const on=(map,name,fn)=>{const list=map.get(name)||[];list.push(fn);map.set(name,list);};
 const button={textContent:'♙ Sign in / Create account',setAttribute:(name,value)=>attributes.set(name,value),addEventListener:(name,fn)=>on(events,'button:'+name,fn)};
 const window={BasketBossSession:{state(){if(invalid)throw Error('Session unavailable');return {remembered};}},addEventListener:(name,fn)=>on(events,name,fn),alert(){throw Error('A configured account entry must not use the preview alert');}};
 const document={getElementById:id=>id==='bb16AccountShortcut'?button:id==='cloud-open'?{click(){opens++;}}:null,addEventListener:(name,fn)=>on(documentEvents,name,fn)};
 vm.runInNewContext(source,{window,document});
 for(const fn of documentEvents.get('DOMContentLoaded')||[])fn();
 return {button,attributes,setRemembered:value=>{remembered=value;},setInvalid:value=>{invalid=value;},get opens(){return opens;},event(name,payload={}){for(const fn of events.get(name)||[])fn(payload);},visibility(){for(const fn of documentEvents.get('visibilitychange')||[])fn();}};
}

test('the Settings account entry reflects the real remembered session after login, refresh and logout',()=>{
 const h=fixture();assert.equal(h.button.textContent,'♙ Sign in / Create account');
 h.setRemembered(true);h.event('basketboss:session-changed');
 assert.equal(h.button.textContent,'♙ Your account');assert.equal(h.attributes.get('aria-label'),'Open your BasketBoss account');
 h.event('basketboss:session-changed');assert.equal(h.button.textContent,'♙ Your account','a same-account token refresh cannot show a signed-out label');
 h.event('button:click');assert.equal(h.opens,1,'the original account handler remains authoritative');
 h.setRemembered(false);h.event('basketboss:session-changed');
 assert.equal(h.button.textContent,'♙ Sign in / Create account');assert.equal(h.attributes.get('aria-label'),'Open BasketBoss sign in or create account');
});

test('storage, foreground and deletion transitions refresh the label without creating or altering sessions',()=>{
 const h=fixture();h.setRemembered(true);h.event('storage',{key:'unrelated-preference'});
 assert.equal(h.button.textContent,'♙ Sign in / Create account');
 h.event('storage',{key:'basketboss_cloud_session_v1'});assert.equal(h.button.textContent,'♙ Your account');
 h.setRemembered(false);h.event('basketboss:account-deletion-started');assert.equal(h.button.textContent,'♙ Sign in / Create account');
 h.setRemembered(true);h.visibility();assert.equal(h.button.textContent,'♙ Your account','remembered offline sessions retain their account entry');
});

test('an unavailable session reader fails safely without claiming a signed-in account',()=>{
 const h=fixture();h.setRemembered(true);h.event('basketboss:auth-ready');assert.equal(h.button.textContent,'♙ Your account');
 h.setInvalid(true);assert.doesNotThrow(()=>h.visibility());assert.equal(h.button.textContent,'♙ Sign in / Create account');
 assert.equal(h.opens,0);
});
