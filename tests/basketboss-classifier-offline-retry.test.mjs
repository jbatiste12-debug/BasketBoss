import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
const inventory=fs.readFileSync(new URL('../pwa700/precache.js',import.meta.url),'utf8');
const origin='https://basketboss.co.uk',rules=origin+'/bb-kitchen-choice-rules.mjs';
function fixture({current={},old={},online=false}={}){
 const handlers={},opened=[],crossCache=[],writes=[],requests=[];
 const key=value=>typeof value==='string'?value:value.url;
 let context;
 const self={registration:{scope:origin+'/'},location:{origin},addEventListener:(name,fn)=>handlers[name]=fn};
 const caches={
  match:async request=>{crossCache.push(key(request));const body=current[key(request)]??old[key(request)];return body===undefined?undefined:new Response(body);},
  open:async name=>{opened.push(name);return {match:async request=>{const body=current[key(request)];return body===undefined?undefined:new Response(body);},put:async(request,response)=>{writes.push({url:key(request),body:await response.text()});}}}
 };
 context=vm.createContext({self,caches,URL,Response,Request,Promise,fetch:async request=>{requests.push(key(request));if(!online)throw Error('offline');return new Response('CURRENT NETWORK MODULE');},importScripts:()=>vm.runInContext(inventory,context)});
 vm.runInContext(source+'\nglobalThis.currentCacheName=CACHE;',context);
 async function request(url,options={}){let result;const pending=[];handlers.fetch({request:new Request(url,options),respondWith:value=>result=value,waitUntil:value=>pending.push(value)});const response=result===undefined?undefined:await result;await Promise.all(pending);return response;}
 return {request,opened,crossCache,writes,requests,cacheName:context.currentCacheName};
}

test('offline classifier retry uses the unversioned module from the current release cache only',async()=>{
 const h=fixture({current:{[rules]:'CURRENT RELEASE'},old:{[rules+'?bbRulesRetry=2']:'OLD RETRY',[rules]:'OLD RELEASE'}});
 assert.equal(await(await h.request(rules+'?bbRulesRetry=2')).text(),'CURRENT RELEASE');
 assert.deepEqual(h.opened,[h.cacheName]);assert.deepEqual(h.crossCache,[]);assert.deepEqual(h.writes,[]);
});
test('an old cache cannot satisfy a classifier retry when this release has no module',async()=>{
 const h=fixture({old:{[rules]:'OLD RELEASE',[rules+'?bbRulesRetry=2']:'OLD RETRY'}}),response=await h.request(rules+'?bbRulesRetry=2');
 assert.equal(response.type,'error');assert.equal(response.status,0);assert.deepEqual(h.crossCache,[]);assert.deepEqual(h.writes,[]);
});
test('an exact retry module already in the current cache wins over the base module',async()=>{
 const h=fixture({current:{[rules]:'CURRENT BASE',[rules+'?bbRulesRetry=3']:'CURRENT RETRY'}});
 assert.equal(await(await h.request(rules+'?bbRulesRetry=3')).text(),'CURRENT RETRY');assert.deepEqual(h.crossCache,[]);
});
test('classifier retry fallback accepts only the bounded retry query and never strips unrelated parameters',async()=>{
 for(const query of ['bbRulesRetry=0','bbRulesRetry=bad','bbRulesRetry=2&other=1','bbRulesRetry=2&bbRulesRetry=3']){
  const h=fixture({current:{[rules]:'CURRENT BASE'},old:{[rules+'?'+query]:'OLD RETRY'}});
  assert.equal((await h.request(rules+'?'+query)).type,'error',query);assert.deepEqual(h.crossCache,[]);
 }
});
test('online retry remains network first and unrelated release fallbacks preserve their existing contract',async()=>{
 const online=fixture({online:true,current:{[rules]:'CACHED BASE'}});
 assert.equal(await(await online.request(rules+'?bbRulesRetry=2')).text(),'CURRENT NETWORK MODULE');
 assert.equal(online.writes[0].url,rules+'?bbRulesRetry=2');assert.deepEqual(online.opened,[online.cacheName]);
 const other=origin+'/bb-shop-purchase-ui.js',offline=fixture({old:{[other]:'EXISTING FALLBACK'}});
 assert.equal(await(await offline.request(other)).text(),'EXISTING FALLBACK');assert.deepEqual(offline.crossCache,[other]);assert.deepEqual(offline.opened,[]);
});
test('account authorization and API requests still bypass service-worker caching',async()=>{
 const h=fixture();assert.equal(await h.request(rules+'?bbRulesRetry=2',{headers:{Authorization:'Bearer fixture'}}),undefined);
 assert.equal(await h.request(origin+'/api/household'),undefined);assert.deepEqual(h.requests,[]);assert.deepEqual(h.opened,[]);assert.deepEqual(h.crossCache,[]);
});
