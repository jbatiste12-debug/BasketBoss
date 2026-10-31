import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCloudflare} from '../scripts/check-cloudflare-catalogue.mjs';

const token = 'synthetic-secret-that-must-not-appear-in-results';
const env = {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32)};
const databaseId = '12345678-1234-1234-1234-123456789012';
const project = {name: 'basketboss', domains: ['basketboss.co.uk']};
const response = (result, result_info) => ({ok: true, status: 200, json: async () => ({success: true, result, result_info})});

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
