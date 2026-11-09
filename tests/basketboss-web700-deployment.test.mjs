import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyWeb700Deployment,waitForWeb700Deployment,web700DeploymentFailure,approvedEmailHintVariant} from '../scripts/verify-web700-deployment.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const inventory=JSON.parse(fs.readFileSync(path.join(root,'pwa700/manifest.json')));
const approvedLandingPrice=fs.readFileSync(path.join(root,'welcome.html'),'utf8').match(/Standard web Premium: (£\d{1,4}\.\d{2}\/month)/)[1];
function fixture({replace,headStatus=200,denial=401}={}){
 const requests=[];
 const perform=async(address,options)=>{
  requests.push({address,options});assert.equal(new URL(address).origin,'https://basketboss.co.uk');assert.equal(options.headers,undefined);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.ok(['GET','HEAD'].includes(options.method));
  const route=new URL(address).pathname;
  if(route.startsWith('/api/'))return new Response('Synthetic private error text must never be reported.',{status:denial});
  if(options.method==='HEAD')return new Response(null,{status:headStatus,headers:{'Content-Type':'image/webp'}});
  const name=route==='/'?'welcome.html':route==='/app'?'pwa700/app.html':route.slice(1),file=path.join(root,name.endsWith('.html')||path.extname(name)?name:name+'.html');
  let body=fs.readFileSync(file),type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':'application/javascript';
  const change=replace?.(route,body);if(change){body=change.body??body;type=change.type??type;}
  return new Response(body,{headers:{'Content-Type':type}});
 };
 return {perform,requests};
}

test('public web700 deployment proof checks every generated asset, routed app, unchanged legacy Free100 and both paid boundaries',async()=>{
 const f=fixture(),result=await verifyWeb700Deployment({perform:f.perform});
 assert.deepEqual(result,{ok:true,catalogueVersion:700,publicRecipes:200,generatedFiles:inventory.files.length,generatedApplicationBytesVerified:true,literalAssetBytesMatched:inventory.files.length,directiveVariantsVerified:0,routedAppVerified:true,routedAppDirectiveVariant:false,landingMonthlyPriceVerified:true,advertisedMonthlyPrice:approvedLandingPrice,rootAssets:6,newImageRewrite:true,legacyPublicRecipes:100,legacyPublicUnchanged:true,unauthenticatedPremiumDenied:true});
 assert.equal(f.requests.filter(row=>row.options.method==='HEAD').length,1);assert.equal(f.requests.filter(row=>new URL(row.address).pathname.startsWith('/api/')).length,2);
 assert.equal(f.requests.some(row=>/private|sealed|\.sql|\.github/.test(row.address)),false);
 assert.equal(f.requests.filter(row=>new URL(row.address).pathname==='/').length,1);
 assert.equal(f.requests.length,inventory.files.length+13);
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
  ['/bb-pantry-selection.css',{body:'stale'},'ROOT_ASSET'],
  ['/bb-membership-settings.js',{body:'stale'},'ROOT_ASSET'],
  ['/bb-us-market.js',{body:'stale'},'ROOT_ASSET']
 ]){
  const f=fixture({replace:pathname=>pathname===route?change:null});
  await assert.rejects(verifyWeb700Deployment({perform:f.perform}),new RegExp('^Error: WEB700_'+code+'$'));
 }
});

test('landing pricing must match the single approved advertised amount without logging returned HTML',async()=>{
 const edge=fixture({replace:(route,body)=>route==='/'?{body:Buffer.concat([body,Buffer.from('<script data-cfasync="false" src="/cdn-cgi/scripts/12345678/cloudflare-static/email-decode.min.js" defer></script>')])}:null});
 assert.equal((await verifyWeb700Deployment({perform:edge.perform})).landingMonthlyPriceVerified,true,'unrelated landing email protection must not require a whole-document byte match');
 for(const change of [
  body=>Buffer.from(body.toString().replace('Standard web Premium: '+approvedLandingPrice,'Standard web Premium: £4.99/month')),
  body=>Buffer.from(body.toString().replace('Standard web Premium: '+approvedLandingPrice,'No advertised monthly amount')),
  body=>Buffer.concat([body,Buffer.from('Standard web Premium: '+approvedLandingPrice)])
 ]){
  const f=fixture({replace:(route,body)=>route==='/'?{body:change(body)}:null});
  let failure;try{await verifyWeb700Deployment({perform:f.perform});assert.fail('stale, absent or ambiguous advertised pricing must fail');}catch(error){failure=error;}
  assert.equal(failure.message,'WEB700_LANDING_PRICE');
  assert.deepEqual(web700DeploymentFailure(Object.assign(failure,{details:{body:'synthetic-private-HTML',authorization:'synthetic-private-token'}})),{ok:false,error:'WEB700_LANDING_PRICE'});
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

test('byte mismatch diagnostics expose only the allowlisted public path, hashes, lengths and edge markers while still rejecting',async()=>{
 const suffix='<a data-cfemail="synthetic-private-text" href="/cdn-cgi/l/email-protection">hidden email</a><script src="https://static.cloudflareinsights.com/beacon.min.js"></script><script data-cf-settings="synthetic" src="/cdn-cgi/scripts/example/rocket-loader.min.js"></script>',original=fs.readFileSync(path.join(root,'pwa700/app.html'));
 const body=Buffer.concat([original,Buffer.from(suffix)]),f=fixture({replace:route=>route==='/pwa700/app'?{body}:null});
 let failure;try{await verifyWeb700Deployment({perform:f.perform});assert.fail('changed public bytes must remain a failed deployment proof');}catch(error){failure=error;}
 assert.equal(failure.message,'WEB700_ASSET_BYTES');const result=web700DeploymentFailure(failure);
 assert.deepEqual(result,{ok:false,error:'WEB700_ASSET_BYTES',details:{publicPath:'/pwa700/app',expectedBytes:original.length,receivedBytes:body.length,expectedSha256:createHash('sha256').update(original).digest('hex'),receivedSha256:createHash('sha256').update(body).digest('hex'),cloudflareEmailProtection:true,cloudflareInsights:true,rocketLoader:true}});
 assert.doesNotMatch(JSON.stringify(result),/synthetic|hidden email|<script|data-cfemail/);
});

test('diagnostic formatting drops arbitrary provider details, credentials, unsafe paths and malformed metadata',()=>{
 const good={publicPath:'/pwa700/app',expectedBytes:100,receivedBytes:101,expectedSha256:'a'.repeat(64),receivedSha256:'b'.repeat(64),cloudflareEmailProtection:false,cloudflareInsights:false,rocketLoader:false},error=Object.assign(Error('WEB700_ASSET_BYTES'),{details:{...good,body:'synthetic-provider-credential',authorization:'Bearer synthetic-secret'}});
 assert.deepEqual(web700DeploymentFailure(error).details,good);assert.doesNotMatch(JSON.stringify(web700DeploymentFailure(error)),/synthetic|Bearer|authorization|body/);
 for(const patch of [{publicPath:'/api/recipes/v700/premium'},{publicPath:'https://elsewhere.example/public.js'},{publicPath:'/pwa700/app?access_token=synthetic'},{publicPath:'/.github/private-catalogue/file'},{expectedBytes:Infinity},{receivedBytes:8*1024*1024+1025},{receivedSha256:'synthetic-provider-credential'},{rocketLoader:'synthetic-provider-credential'}])assert.deepEqual(web700DeploymentFailure(Object.assign(Error('WEB700_ASSET_BYTES'),{details:{...good,...patch}})),{ok:false,error:'WEB700_ASSET_BYTES'});
 assert.deepEqual(web700DeploymentFailure(Object.assign(Error('WEB700_SYNTHETIC_PROVIDER_SECRET'),{details:good})),{ok:false,error:'WEB700_UNAVAILABLE'});
 assert.deepEqual(web700DeploymentFailure(Object.assign(Error('synthetic-provider-credential'),{details:good})),{ok:false,error:'WEB700_UNAVAILABLE'});
 assert.deepEqual(web700DeploymentFailure(Object.assign(Error('WEB700_NETWORK'),{details:good})),{ok:false,error:'WEB700_NETWORK'});
});

test('the diagnostic CLI --once flag performs one read attempt and prints only the fixed failure object',()=>{
 const script=new URL('../scripts/verify-web700-deployment.mjs',import.meta.url);
 const program=`let calls=0;globalThis.fetch=async()=>{calls++;throw Error('synthetic-private-provider-body');};process.argv=['node',${JSON.stringify(fileURLToPath(script))},'--once'];process.on('exit',()=>console.log(JSON.stringify({calls})));await import(${JSON.stringify(script.href)});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,1);assert.equal(result.error,undefined);assert.deepEqual(JSON.parse(result.stdout.trim()),{calls:1});assert.deepEqual(JSON.parse(result.stderr.trim()),{ok:false,error:'WEB700_NETWORK'});assert.doesNotMatch(result.stderr,/synthetic|provider-body/);
});

const stripApprovedHints=body=>Buffer.from(body.toString('utf8').replace('<!--email_off-->','').replace('<!--/email_off-->',''));
test('deployment proof accepts only the exact approved HTML representation after both provider directives are consumed',async()=>{
 const htmlFiles=inventory.files.filter(row=>row.path.endsWith('.html')).length,f=fixture({replace:(route,body)=>route==='/app'||inventory.files.some(row=>row.path.endsWith('.html')&&route==='/pwa700/'+row.path.slice(0,-5))?{body:stripApprovedHints(body)}:null});
 const result=await verifyWeb700Deployment({perform:f.perform});assert.equal(result.generatedApplicationBytesVerified,true);assert.equal(result.directiveVariantsVerified,htmlFiles);assert.equal(result.literalAssetBytesMatched,inventory.files.length-htmlFiles);assert.equal(result.routedAppVerified,true);assert.equal(result.routedAppDirectiveVariant,true);assert.equal(result.legacyPublicUnchanged,true);assert.equal(result.unauthenticatedPremiumDenied,true);
});

test('consumed-directive variants still reject changed HTML, JS, JSON, email rewrites, decode scripts and incomplete or extra hints',async()=>{
 const edits=[
  ['/pwa700/app',body=>Buffer.from(stripApprovedHints(body).toString().replace('BasketBoss','Changed application text'))],
  ['/pwa700/app',body=>Buffer.concat([stripApprovedHints(body),Buffer.from('<script data-cfasync="false" src="/cdn-cgi/scripts/12345678/cloudflare-static/email-decode.min.js" defer></script>')])],
  ['/pwa700/app',body=>Buffer.concat([stripApprovedHints(body),Buffer.from('<a data-cfemail="synthetic">[email protected]</a>')])],
  ['/pwa700/app',body=>Buffer.from(body.toString().replace('<!--email_off-->',''))],
  ['/pwa700/app',body=>Buffer.concat([body,Buffer.from('<!--email_off--><!--/email_off-->')])],
  ['/pwa700/bb-ui-continuity.js',body=>Buffer.concat([body,Buffer.from('<!--email_off--><!--/email_off-->')])],
  ['/pwa700/recipes.json',body=>Buffer.from(JSON.stringify(JSON.parse(body).slice(0,-1)))],
  ['/app',body=>Buffer.concat([stripApprovedHints(body),Buffer.from('changed')])]
 ];
 for(const [route,edit]of edits){const f=fixture({replace:(pathname,body)=>pathname===route?{body:edit(body)}:null});await assert.rejects(verifyWeb700Deployment({perform:f.perform}),new RegExp('^Error: WEB700_'+(route==='/app'?'ROUTE':'ASSET_BYTES')+'$'));}
});

test('the approved HTML variant requires the manifest byte proof and exactly one directive pair at the real body boundaries',()=>{
 const good=Buffer.from('<!doctype html><html><head></head><body><!--email_off--><a href="mailto:help@example.com">Support</a><!--/email_off--></body></html>'),sha=value=>createHash('sha256').update(value).digest('hex');
 assert.deepEqual(approvedEmailHintVariant(good,good.length,sha(good)),stripApprovedHints(good));
 assert.throws(()=>approvedEmailHintVariant(good,good.length+1,sha(good)),/WEB700_LOCAL_FILES/);assert.throws(()=>approvedEmailHintVariant(good,good.length,'0'.repeat(64)),/WEB700_LOCAL_FILES/);
 for(const text of [good.toString().replace('<!--email_off-->',''),good.toString().replace('<!--/email_off-->',''),good.toString().replace('<!--/email_off-->','<!--email_off--><!--/email_off-->'),good.toString().replace('<body><!--email_off-->','<body><p>Unprotected</p><!--email_off-->'),good.toString().replace('<!--/email_off--></body>','<!--/email_off--><p>Unprotected</p></body>'),good.toString().replace('</body>','</body><body></body>'),'<script><!--email_off-->not HTML<!--/email_off--></script>']){const malformed=Buffer.from(text);assert.throws(()=>approvedEmailHintVariant(malformed,malformed.length,sha(malformed)),/WEB700_LOCAL_FILES/);}
});
