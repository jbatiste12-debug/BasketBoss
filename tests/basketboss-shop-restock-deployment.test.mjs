import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyLayoutDeployment} from '../scripts/verify-layout-deployment.mjs';

const layout=['bb-simple-layout.js','bb-pantry-inline.js','bb-pantry-inline.css','bb-plan-premium-polish.css','bb-premium-finish.css'];
const restock=['bb-shop-ownership.js','bb-shop-continuation.js','bb-shop-continuation.css','bb-receipt-host.js','bb-receipt-inventory.js','bb-home.js'];
const existingResult={ok:true,layoutAssets:5,plannerTabsBytesVerified:true,pantryTabsBytesVerified:true,shoppingPresentationBytesVerified:true};
function fixture(change){
 const requests=[];
 const perform=async(url,options)=>{
  requests.push(url);
  assert.equal(options.cache,'no-store');
  assert.equal(options.redirect,'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted,false);
  const name=new URL(url).pathname.slice(1),row=change?.(name)||{};
  return new Response(row.body??fs.readFileSync(new URL('../'+name,import.meta.url)),{status:row.status??200,headers:{'content-type':row.type??(name.endsWith('.css')?'text/css':'application/javascript')}});
 };
 return {perform,requests};
}

test('shop restock deployment proof checks the five layout and six shopping assets exactly once',async()=>{
 const h=fixture();
 assert.deepEqual(await verifyLayoutDeployment({includeShopRestock:true,perform:h.perform}),{...existingResult,shopRestockAssets:6,shopRestockBytesVerified:true});
 assert.deepEqual(h.requests,[...layout,...restock].map(name=>'https://basketboss.co.uk/'+name));
 assert.equal(new Set(h.requests).size,11);
});

test('the default layout proof keeps its existing result and skips all six restock assets',async()=>{
 const h=fixture();
 assert.deepEqual(await verifyLayoutDeployment({perform:h.perform}),existingResult);
 assert.deepEqual(h.requests,layout.map(name=>'https://basketboss.co.uk/'+name));
});

test('each shopping asset must match the current root bytes',async()=>{
 for(const asset of restock){
  const h=fixture(name=>name===asset?{body:'stale deployed asset'}:null);
  await assert.rejects(verifyLayoutDeployment({includeShopRestock:true,perform:h.perform}),/LAYOUT_ASSET_STALE/,asset);
  assert.equal(h.requests.at(-1),'https://basketboss.co.uk/'+asset);
 }
});

test('shopping CSS and JavaScript reject HTML fallbacks and unsuccessful responses',async()=>{
 for(const asset of restock){
  const h=fixture(name=>name===asset?{body:'<!doctype html><title>Fallback</title>',type:'text/html'}:null);
  await assert.rejects(verifyLayoutDeployment({includeShopRestock:true,perform:h.perform}),/LAYOUT_ASSET_UNAVAILABLE/,asset);
 }
 const h=fixture(name=>name==='bb-shop-ownership.js'?{status:404}:null);
 await assert.rejects(verifyLayoutDeployment({includeShopRestock:true,perform:h.perform}),/LAYOUT_ASSET_UNAVAILABLE/);
});

test('shopping asset responses are bounded at one MiB',async()=>{
 const h=fixture(name=>name==='bb-shop-continuation.js'?{body:'x'.repeat(1024*1024+1)}:null);
 await assert.rejects(verifyLayoutDeployment({includeShopRestock:true,perform:h.perform}),/LAYOUT_BODY_TOO_LARGE/);
});

test('every layout and restock request receives a fifteen second timeout signal',async()=>{
 const original=AbortSignal.timeout,delays=[];
 AbortSignal.timeout=delay=>{delays.push(delay);return original(delay);};
 try{
  const h=fixture();
  await verifyLayoutDeployment({includeShopRestock:true,perform:h.perform});
  assert.deepEqual(delays,Array(11).fill(15000));
 }finally{AbortSignal.timeout=original;}
});

test('the deployment workflow enables the shop restock proof',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/verify-web700-deployment.yml',import.meta.url),'utf8');
 assert.match(workflow,/node scripts\/verify-layout-deployment\.mjs --shop-restock\b/);
});
