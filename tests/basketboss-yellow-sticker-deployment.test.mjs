import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyYellowStickerDeployment} from '../scripts/check-cloudflare-catalogue.mjs';
test('production checks public feature assets and an unauthenticated native request without creating reports',async()=>{
 const calls=[];const result=await verifyYellowStickerDeployment(async(address,options)=>{
  calls.push({address,options});assert.notEqual(options.method,'POST');assert.equal(options.headers?.Authorization,undefined);assert.equal(options.cache,'no-store');
  const api=address.includes('/api/');if(api)assert.equal(options.headers.Origin,'capacitor://localhost');
  return new Response(api?'{}':'public source',{status:api?401:200,headers:{'Content-Type':api?'application/json':address.endsWith('.css')?'text/css':'application/javascript'}});
 });
 assert.deepEqual(result,{assets:5,authenticationRequired:true});assert.equal(calls.length,6);
});
test('a missing asset, HTML fallback or unavailable or public API cannot be reported as deployed',async()=>{
 for(const status of [200,403,404,503])await assert.rejects(verifyYellowStickerDeployment(async address=>new Response('{}',{status:address.includes('/api/')?status:200,headers:{'Content-Type':address.includes('/api/')?'application/json':address.endsWith('.css')?'text/css':'application/javascript'}})),/could not be verified/);
 await assert.rejects(verifyYellowStickerDeployment(async()=>new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}})),/could not be verified/);
});
