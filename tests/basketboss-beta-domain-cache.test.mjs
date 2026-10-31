import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
const SCOPE='https://basketboss.co.uk/';
function harness({offline=false}={}) {
  const handlers={};const seen=[];
  const self={registration:{scope:SCOPE},location:{origin:'https://basketboss.co.uk'},addEventListener:(type,fn)=>{handlers[type]=fn},skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  const caches={
    match:async()=>new Response('CACHED'),
    open:async()=>({put:async()=>{},addAll:async()=>{}}),
    keys:async()=>[],delete:async()=>true
  };
  const fetch=async req=>{seen.push(String(req.url||req));if(offline)throw Error('offline');return new Response('NEW',{status:200});};
  vm.runInNewContext(script,{self,caches,fetch,URL,Response,Request,Promise}, {filename:'service-worker.js'});
  function request(path){let responsePromise;const event={request:new Request(SCOPE+path),respondWith(p){responsePromise=p},waitUntil(p){void Promise.resolve(p).catch(()=>{})}};handlers.fetch(event);return responsePromise;}
  return {request,seen};
}
test('Beta cache is versioned past the production merge',()=>{
 assert.match(script,/basketboss-premium-secure-shell-20261031-v17-expanded-compatible-500/);
 assert.doesNotMatch(script,/20261028-v13-free-signup-funnel/);
});
test('Onboarding, partner sharing and per-day serving assets refresh from network',async()=>{
 const h=harness();for(const asset of ['bb-onboarding-v2.js?v=20261031-shop-prices','bb-household-sharing.js?v=20261030-rc1','bb-serving-scale.js']){
  assert.equal(await (await h.request(asset)).text(),'NEW');
 }assert.equal(h.seen.length,3);
});
test('Release assets retain a cached offline fallback',async()=>{
 const h=harness({offline:true});assert.equal(await (await h.request('bb-onboarding-v2.js')).text(),'CACHED');
});
test('API and account data are never intercepted or cached',()=>{
 const h=harness();assert.equal(h.request('api/household?mode=status'),undefined);assert.equal(h.request('api/subscription/status'),undefined);
 assert.equal(h.seen.length,0);
});
test('Premium recipe data stays network-only',async()=>{
 const h=harness();assert.equal(await (await h.request('recipes.json')).text(),'NEW');
});
test('No local plan reset, account rewrite or domain redirect in service worker',()=>{
 assert.doesNotMatch(script,/localStorage\.|sessionStorage\.|indexedDB\.|clients\.openWindow|location\.assign/);
});
