import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCloudflare,classifyBuildFailure,verifyLandingDeployment} from '../scripts/check-cloudflare-catalogue.mjs';

const token = 'synthetic-secret-that-must-not-appear-in-results';
const env = {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32)};
const databaseId = '12345678-1234-1234-1234-123456789012';
const project = {name: 'basketboss', domains: ['basketboss.co.uk']};
const response = (result, result_info) => ({ok: true, status: 200, json: async () => ({success: true, result, result_info})});

function landingFixture({hidden=false,assetType,assetStatus=200,headline='Less dinner stress.<br><em>More family time.</em>'}={}){
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
  assert.equal(requests.filter(r => r.options.method === 'POST').length, 3);
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
