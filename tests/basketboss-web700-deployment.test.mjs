import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {verifyWeb700Deployment,waitForWeb700Deployment} from '../scripts/verify-web700-deployment.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const inventory=JSON.parse(fs.readFileSync(path.join(root,'pwa700/manifest.json')));
function fixture({replace,headStatus=200,denial=401}={}){
 const requests=[];
 const perform=async(address,options)=>{
  requests.push({address,options});assert.equal(new URL(address).origin,'https://basketboss.co.uk');assert.equal(options.headers,undefined);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.ok(['GET','HEAD'].includes(options.method));
  const route=new URL(address).pathname;
  if(route.startsWith('/api/'))return new Response('Synthetic private error text must never be reported.',{status:denial});
  if(options.method==='HEAD')return new Response(null,{status:headStatus,headers:{'Content-Type':'image/webp'}});
  const name=route==='/app'?'pwa700/app.html':route.slice(1),file=path.join(root,name.endsWith('.html')||path.extname(name)?name:name+'.html');
  let body=fs.readFileSync(file),type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':'application/javascript';
  const change=replace?.(route,body);if(change){body=change.body??body;type=change.type??type;}
  return new Response(body,{headers:{'Content-Type':type}});
 };
 return {perform,requests};
}

test('public web700 deployment proof checks every generated asset, routed app, unchanged legacy Free100 and both paid boundaries',async()=>{
 const f=fixture(),result=await verifyWeb700Deployment({perform:f.perform});
 assert.deepEqual(result,{ok:true,catalogueVersion:700,publicRecipes:200,generatedFiles:inventory.files.length,generatedBytesVerified:true,routedAppVerified:true,rootAssets:4,newImageRewrite:true,legacyPublicRecipes:100,legacyPublicUnchanged:true,unauthenticatedPremiumDenied:true});
 assert.equal(f.requests.filter(row=>row.options.method==='HEAD').length,1);assert.equal(f.requests.filter(row=>new URL(row.address).pathname.startsWith('/api/')).length,2);
 assert.equal(f.requests.some(row=>/private|sealed|\.sql|\.github/.test(row.address)),false);
 assert.equal(f.requests.length,inventory.files.length+10);
});

test('deployment proof rejects a stale manifest before downloading the asset pack',async()=>{
 const f=fixture({replace:route=>route==='/pwa700/manifest.json'?{body:'{}'}:null});
 await assert.rejects(verifyWeb700Deployment({perform:f.perform}),/^Error: WEB700_MANIFEST_STALE$/);assert.equal(f.requests.length,1);
});

test('deployment proof rejects stale assets, missing HTML middleware, modified legacy recipes and MIME fallbacks',async()=>{
 for(const [route,change,code]of [
  ['/pwa700/recipes.json',{body:'[]'},'ASSET_BYTES'],
  ['/app',{body:'<html>Old app</html>'},'ROUTE'],
  ['/recipes.json',{body:'[]'},'LEGACY_PUBLIC'],
  ['/pwa700/bb-ui-continuity.js',{type:'text/html'},'PUBLIC_ASSET'],
  ['/bb-pantry-selection.css',{body:'stale'},'ROOT_ASSET']
 ]){
  const f=fixture({replace:pathname=>pathname===route?change:null});
  await assert.rejects(verifyWeb700Deployment({perform:f.perform}),new RegExp('^Error: WEB700_'+code+'$'));
 }
});

test('deployment proof requires the real image rewrite and refuses any anonymous paid-catalogue success',async()=>{
 await assert.rejects(verifyWeb700Deployment({perform:fixture({headStatus:404}).perform}),/WEB700_IMAGE_REWRITE/);
 await assert.rejects(verifyWeb700Deployment({perform:fixture({denial:200}).perform}),/WEB700_PAID_BOUNDARY/);
});

test('bounded retries recover after propagation and never expose provider messages or response contents',async()=>{
 const good=fixture();let calls=0,pauses=0;
 const perform=(...args)=>{if(++calls===1)throw Error('Synthetic provider credential and account details');return good.perform(...args);};
 assert.equal((await waitForWeb700Deployment({perform,attempts:2,pause:async()=>{pauses++;}})).ok,true);assert.equal(pauses,1);
 await assert.rejects(waitForWeb700Deployment({perform:async()=>{throw Error('synthetic-private-provider-detail');},attempts:2,pause:async()=>{}}),/^Error: WEB700_NETWORK$/);
 await assert.rejects(waitForWeb700Deployment({perform,attempts:13}),/WEB700_ATTEMPTS/);
});
