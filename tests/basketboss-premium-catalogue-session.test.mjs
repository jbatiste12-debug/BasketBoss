import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const marker='/* BB SECURE PREMIUM: runtime hydration from D1 after verified membership. */';
const start=html.indexOf(marker),source=html.slice(start,html.indexOf('\nif(!bbStorageSafe)',start));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function pending(){let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};}
function fixture(){
 const storage=new Map(),requests=[],win=new EventTarget(),doc=new EventTarget();doc.hidden=false;
 const session=(id,token=id)=>id?storage.set('basketboss_cloud_session_v1',JSON.stringify({user:{id},access_token:token,expires_at:Date.now()/1000+3600})):storage.delete('basketboss_cloud_session_v1');
 session('a');
 const free=Array.from({length:100},(_,i)=>({id:'free-'+i,ingredients:[]}));
 const context=vm.createContext({window:win,document:doc,Event,Date,localStorage:{getItem:key=>storage.get(key)??null},
  RECIPES:free,BB307_NORMALIZED:free.map(r=>({id:r.id})),BB307_SOURCE_RECIPES:[...free],BB307_ORIGINAL_COSTS:new Map(),BB307_VALID_IDS:new Set(),
  BBRecipePlanning:{metadata:()=>({})},bbVerifiedPaidRecipes:false,render(){},setInterval(){},queueMicrotask,
  fetch:()=>{const item=pending();requests.push(item);return item.promise;}});
 vm.runInContext(source+'\nthis.readCatalogue=()=>({active:window.BasketBossVerifiedPremium.isActive(),count:RECIPES.length,normalized:BB307_NORMALIZED.length});',context);
 const data={count:400,recipes:Array.from({length:400},(_,i)=>({id:'paid-'+i,cost:1,ingredients:[]})),normalized:Array.from({length:400},(_,i)=>({id:'paid-'+i,ingredients:[]}))};
 return {win,session,requests,data,state:()=>context.readCatalogue(),signal:()=>win.dispatchEvent(new Event('basketboss:session-changed')),async grant(index=requests.length-1){requests[index].resolve({ok:true,json:async()=>data});await tick();}};
}
test('the real catalogue purges Premium immediately on account switch, before the Free response arrives',async()=>{
 const h=fixture();await tick();await h.grant();assert.equal(h.state().count,500);assert.equal(h.state().active,true);
 h.session('b');h.signal();assert.equal(h.state().active,false);assert.equal(h.state().count,100);
 h.requests.at(-1).resolve({ok:false});await tick();assert.equal(h.state().normalized,100);
});
test('a late private JSON body cannot hydrate the next account or a reused prior token',async()=>{
 for(const next of['b','a']){
  const h=fixture();await tick();const body=pending();h.requests[0].resolve({ok:true,json:()=>body.promise});await tick();
  h.session(null);h.win.BasketBossVerifiedPremium.invalidate();h.signal();h.session(next);h.signal();
  body.resolve(h.data);await tick();assert.equal(h.state().active,false);assert.equal(h.state().count,100);
  h.requests.at(-1).resolve({ok:false});await tick();
 }
});
test('the active getter rejects a different actor even when its stored token is unchanged and no event fired',async()=>{
 const h=fixture();await tick();await h.grant();h.session('b','a');assert.equal(h.state().active,false);assert.equal(h.state().count,100);
});
