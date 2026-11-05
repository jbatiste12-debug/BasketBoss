import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectCloudflare,classifyBuildFailure,verifyLandingDeployment,verifyNativeApiDeployment,verifyReviewDeployment,verifyFoodThumbnailDeployment,verifyInterfaceDeployment,inspectDeletionSchema} from '../scripts/check-cloudflare-catalogue.mjs';

const token = 'synthetic-secret-that-must-not-appear-in-results';
const env = {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32)};
const databaseId = '12345678-1234-1234-1234-123456789012';
const project = {name: 'basketboss', domains: ['basketboss.co.uk']};
const response = (result, result_info) => ({ok: true, status: 200, json: async () => ({success: true, result, result_info})});

test('polished interface deployment checks every script/style without invoking AI or sending auth',async()=>{
 const requests=[];
 const result=await verifyInterfaceDeployment(async(address,options)=>{
  requests.push(address);assert.equal(options.headers,undefined);assert.notEqual(options.method,'POST');assert.equal(options.redirect,'error');
  assert.match(new URL(address).pathname,/^\/(?:bb-(cook-studio|cook-result|meal-image|navigation-polish|account-polish|plan-premium-polish)\.(js|css)|tutorial|basketboss-latest-guide|bb-real-app-tour-v82\.js)$/);
  return new Response('public asset',{headers:{'Content-Type':address.endsWith('.js')?'application/javascript':address.endsWith('.css')?'text/css':'text/html'}});
 });
 assert.deepEqual(result,{cookStudio:true,createdMeal:true,mealPictures:true,navigation:true,accountSettings:true,budget:true,guides:true});assert.equal(requests.length,15);
});

test('polished interface deployment rejects missing or HTML fallback assets and hides unexpected network text',async()=>{
 for(const perform of [async()=>new Response('missing',{status:404}),async()=>new Response('fallback',{headers:{'Content-Type':'text/html'}}),async()=>{throw Error('synthetic-private-provider-error');}]){
  await assert.rejects(verifyInterfaceDeployment(perform),error=>{assert.equal(error.message,'The polished app interface assets could not be verified on production.');return true;});
 }
});

test('review readiness rejects an outdated privacy revision even when it is a valid public HTML page',async()=>{
 await assert.rejects(verifyReviewDeployment(async()=>new Response('Last updated 1 November 2026.',{headers:{'Content-Type':'text/html'}})),/App review compliance routes/);
});

function landingFixture({hidden=false,assetType,assetStatus=200,headline='Your kitchen.<br><em>Made simple.</em>'}={}){
 const requests=[];
 const perform=async(address,options)=>{
  requests.push({address,options});
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers,undefined);
  const pathname=new URL(address).pathname;
  if(pathname==='/')return new Response('<h1>'+headline+'</h1><link rel="stylesheet" href="bb-family-landing.css?v=release"><script src="/bb-family-landing.js?v=release"></script><section id="smart-receipt" data-bb-smart-receipt-ready'+(hidden?' hidden':'')+'></section>',{headers:{'Content-Type':'text/html'}});
  return new Response('public asset',{status:assetStatus,headers:{'Content-Type':assetType||(pathname.endsWith('.css')?'text/css':'application/javascript')}});
 };
 return {requests,perform};
}

test('landing verification reports enabled and hidden receipt marketing without exposing page contents',async()=>{
 for(const hidden of [false,true]){
  const {requests,perform}=landingFixture({hidden});
  assert.deepEqual(await verifyLandingDeployment(perform),{headline:true,stylesheet:true,script:true,smartReceiptSectionVisible:!hidden});
  assert.deepEqual(requests.map(({address})=>address),['https://basketboss.co.uk/','https://basketboss.co.uk/bb-family-landing.css?v=release','https://basketboss.co.uk/bb-family-landing.js?v=release']);
 }
});

test('landing verification rejects stale copy, missing assets and HTML fallback assets',async()=>{
 await assert.rejects(verifyLandingDeployment(landingFixture({headline:'Previous landing'}).perform),/headline is not present/);
 await assert.rejects(verifyLandingDeployment(landingFixture({assetStatus:404}).perform),/asset is not available/);
 await assert.rejects(verifyLandingDeployment(landingFixture({assetType:'text/html'}).perform),/asset is not available/);
});

test('landing verification replaces unexpected network messages with a fixed diagnostic',async()=>{
 await assert.rejects(verifyLandingDeployment(async()=>{throw Error('synthetic-private-provider-text');}),error=>{
  assert.equal(error.message,'The public landing page could not be checked.');return true;
 });
});

function foodAssetFixture({badPath,status=404,type,signature,source}={}){
 const requests=[];let cancelled=0;
 const perform=async(address,options)=>{
  requests.push({address,options});
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers?.Authorization,undefined);
  const path=new URL(address).pathname;
  if(path==='/bb-food-visuals.js')return new Response(source??readFileSync(new URL('../bb-food-visuals.js',import.meta.url),'utf8'),{headers:{'Content-Type':'application/javascript'}});
  if(path==='/bb-food-visuals.css')return new Response('.bb-food-visual{}',{headers:{'Content-Type':'text/css'}});
  assert.match(path,/^\/food-thumbs\/v2\/foods-\d{2}\.webp$/);assert.equal(options.headers.Range,'bytes=0-11');
  if(path===badPath)return new Response(signature??'missing',{status,headers:{'Content-Type':type??'text/html'}});
  const prefix=new TextEncoder().encode('RIFF0000WEBP');
  return new Response(new ReadableStream({start(controller){controller.enqueue(prefix.subarray(0,4));controller.enqueue(prefix.subarray(4));},cancel(){cancelled++;}}),{status:206,headers:{'Content-Type':'image/webp'}});
 };
 return {requests,perform,cancelled:()=>cancelled};
}

test('food deployment verifies all thirteen public image signatures and cancels streams without credentials',async()=>{
 const fixture=foodAssetFixture();
 assert.deepEqual(await verifyFoodThumbnailDeployment(fixture.perform),{script:true,stylesheet:true,foods:78,imageAtlases:13});
 assert.equal(fixture.requests.length,15);assert.equal(fixture.cancelled(),13);
 assert.equal(fixture.requests.at(-1).address,'https://basketboss.co.uk/food-thumbs/v2/foods-12.webp');
});

test('food deployment rejects missing images, HTML fallback and invalid image signatures with a fixed diagnostic',async()=>{
 for(const invalid of [
  {badPath:'/food-thumbs/v2/foods-00.webp'},
  {badPath:'/food-thumbs/v2/foods-12.webp'},
  {badPath:'/food-thumbs/v2/foods-12.webp',status:200,type:'text/html'},
  {badPath:'/food-thumbs/v2/foods-12.webp',status:200,type:'image/webp',signature:'not a webp image'}
 ])await assert.rejects(verifyFoodThumbnailDeployment(foodAssetFixture(invalid).perform),error=>{
  assert.equal(error.message,'Shared food thumbnail assets could not be verified on production.');return true;
 });
});

test('food deployment rejects a stale manifest and never reports response or network text',async()=>{
 await assert.rejects(verifyFoodThumbnailDeployment(foodAssetFixture({source:'const MANIFEST = {"version":1};'}).perform),/Shared food thumbnail assets could not be verified/);
 await assert.rejects(verifyFoodThumbnailDeployment(async()=>{throw Error('synthetic-private-provider-text');}),error=>{
  assert.equal(error.message,'Shared food thumbnail assets could not be verified on production.');return true;
 });
});

test('private build messages never leave the runner, only fixed failure categories',()=>{
 const privateText='synthetic-private-token-and-recipe-data';
 assert.deepEqual(classifyBuildFailure([{line:'ERROR Expected semicolon but found with '+privateText}]),['json_import_syntax']);
 assert.deepEqual(classifyBuildFailure([{line:'Could not resolve '+privateText}]),['module_resolution']);
 assert.deepEqual(classifyBuildFailure([{line:privateText}]),['unclassified_build_failure']);
 assert.ok(!JSON.stringify(classifyBuildFailure([{line:'ERROR '+privateText}])).includes(privateText));
});

function cloudflare({pages, expanded = true} = {}) {
  const requests = [];
  const perform = async (address, options) => {
    const url = new URL(address);
    requests.push({url, options});
    assert.equal(url.origin, 'https://api.cloudflare.com');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    if (url.pathname.endsWith('/pages/projects')) {
      assert.equal(url.searchParams.get('per_page'), '10');
      const page = Number(url.searchParams.get('page'));
      assert.ok(Number.isInteger(page) && page > 0);
      const list = pages?.[page - 1] ?? (page === 1 ? [project] : []);
      return response(list, {page, per_page: 10, count: list.length, total_count: pages?.flat().length ?? 1, total_pages: pages?.length ?? 1});
    }
    if (url.pathname.endsWith('/pages/projects/basketboss')) {
      return response({...project, production_branch: 'main', deployment_configs: {production: {d1_databases: {BILLING_DB: {id: databaseId}}}}, canonical_deployment: {deployment_trigger: {metadata: {commit_hash: 'verified-production-commit'}}}});
    }
    if (url.pathname.endsWith('/d1/database/' + databaseId + '/query')) {
      assert.equal(options.method, 'POST');
      const {sql} = JSON.parse(options.body);
      assert.match(sql, /^SELECT /);
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE)\b/i);
      if (sql.includes('sqlite_master')) {
        return response([{success: true, results: [{name: 'bb_private_premium_recipes'}, ...(expanded ? [{name: 'bb_private_premium_recipes_500_v1'}] : [])]}]);
      }
      return response([{success: true, results: [{count: sql.includes('500_v1') ? 400 : 221}]}]);
    }
    throw Error('Unexpected API request: ' + url.pathname);
  };
  return {requests, perform};
}

test('finds production on page two using safe Pages pagination', async () => {
  const first = Array.from({length: 10}, (_, n) => ({name: 'unrelated-' + n, domains: ['unrelated-' + n + '.pages.dev']}));
  const {requests, perform} = cloudflare({pages: [first, [project]]});
  const result = await inspectCloudflare(env, perform);
  assert.equal(result.project, 'basketboss');
  const listRequests = requests.filter(r => r.url.pathname.endsWith('/pages/projects'));
  assert.deepEqual(listRequests.map(r => r.url.search), ['?per_page=10&page=1', '?per_page=10&page=2']);
});

test('reports 221 legacy and 400 versioned rows without mutations or credential output', async () => {
  const {requests, perform} = cloudflare();
  const result = await inspectCloudflare(env, perform);
  assert.deepEqual(result.counts, {bb_private_premium_recipes: 221, bb_private_premium_recipes_500_v1: 400});
  assert.equal(result.expandedCatalogueReady, true);
  assert.equal(result.databaseId, databaseId);
  assert.equal(result.productionCommit, 'verified-production-commit');
  assert.ok(!JSON.stringify(result).includes(token));
  assert.equal(requests.filter(r => r.options.method === 'POST').length, 4);
  assert.ok(requests.every(r => r.options.method === 'GET' || r.url.pathname.endsWith('/query')));
});

test('missing versioned table is reported as pending rather than a completed import', async () => {
  const {perform} = cloudflare({expanded: false});
  const result = await inspectCloudflare(env, perform);
  assert.deepEqual(result.counts, {bb_private_premium_recipes: 221, bb_private_premium_recipes_500_v1: null});
  assert.equal(result.expandedCatalogueReady, false);
});

test('missing token stops before making any request', async () => {
  let called = false;
  await assert.rejects(inspectCloudflare({}, async () => {called = true;}), /Add CLOUDFLARE_API_TOKEN/);
  assert.equal(called, false);
});

test('403 identifies the failing operation and code without exposing provider text or token', async () => {
  const perform = async () => ({ok: false, status: 403, json: async () => ({success: false, errors: [{code: 9109, message: 'untrusted provider text ' + token}]})});
  await assert.rejects(inspectCloudflare(env, perform), error => {
    assert.match(error.message, /Pages project listing failed \(HTTP 403; Cloudflare codes 9109\)/);
    assert.ok(!error.message.includes(token));
    assert.ok(!error.message.includes('untrusted provider text'));
    return true;
  });
});


test('native production transport verifies exact preflight, response CORS and foreign-origin denial without auth',async()=>{
 const requests=[];
 const perform=async(address,options)=>{
  requests.push({address,options});assert.equal(options.headers.Authorization,undefined);
  const allowed=options.headers.Origin==='capacitor://localhost';
  return new Response(null,{status:options.method==='OPTIONS'?(allowed?204:405):200,headers:allowed?{'Access-Control-Allow-Origin':'capacitor://localhost'}:{}});
 };
 assert.deepEqual(await verifyNativeApiDeployment(perform),{preflight:true,responseHeaders:true,foreignOriginDenied:true});assert.equal(requests.length,3);
 await assert.rejects(verifyNativeApiDeployment(async()=>new Response(null,{status:200,headers:{'Access-Control-Allow-Origin':'*'}})),/preflight is not available/);
});


test('review verification reports public legal/native checkout readiness without credentials or account deletion',async()=>{
 const calls=[];
 const check=async ready=>verifyReviewDeployment(async(address,options)=>{
  calls.push({address,options});assert.notEqual(options.method,'POST');assert.equal(options.headers?.Authorization,undefined);
  if(/\/(privacy|terms)$/.test(address))return new Response(address.endsWith('/privacy')?'Last updated 5 November 2026.':'Last updated 1 November 2026.',{headers:{'Content-Type':'text/html'}});
  if(address.endsWith('checkout-config'))return Response.json({enabled:false});
  return Response.json({ok:true,available:true,migrationReady:ready},{headers:{'Access-Control-Allow-Origin':'capacitor://localhost'}});
 });
 assert.deepEqual(await check(false),{privacy:true,terms:true,deletionRoute:true,deletionConfigured:true,deletionMigrationReady:false,nativeWebCheckoutDisabled:true});
 assert.equal((await check(true)).deletionMigrationReady,true);assert.equal(calls.length,8);
 await assert.rejects(verifyReviewDeployment(async()=>{throw Error('untrusted-provider-body')}),/^Error: App review compliance routes/);
});


test('deletion schema inspection reads only allowlisted metadata and emits fixed booleans',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE bb_paid_entitlements(user_id TEXT,paddle_subscription_id TEXT);CREATE TABLE bb_ai_daily_usage(unrelated TEXT);');
 const queries=[];
 try{
  const result=await inspectDeletionSchema(async sql=>{queries.push(sql);assert.match(sql,/^SELECT name FROM (sqlite_master|pragma_table_info)/);return db.prepare(sql).all();});
  assert.deepEqual(result.paidEntitlements,{present:true,compatible:true});
  assert.deepEqual(result.aiDailyUsage,{present:true,compatible:false});
  assert.deepEqual(result.billingClaims,{present:false,compatible:false});
  assert.equal(queries.length,3);assert.doesNotMatch(JSON.stringify(result),/unrelated|user_id|paddle_subscription_id/);
 }finally{db.close();}
});
