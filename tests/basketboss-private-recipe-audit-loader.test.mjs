import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  PRIVATE_RECIPE_SELECT,
  fetchPrivateRecipeRows,
  writePrivateRecipeExport,
  validatePrivateRecipeExport,
  loadPrivateRecipeAudit
} from '../scripts/load-private-recipe-audit.mjs';

const token = 'synthetic-cloudflare-read-token-never-print';
const accountId = 'a'.repeat(32);
const databaseId = '12345678-1234-1234-1234-123456789012';
const env = { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_DATABASE_ID: databaseId };
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const rowsFixture = () => Array.from({ length: 400 }, (_, index) => {
  const id = 'premium-audit-' + index;
  const recipe = {
    id, name: 'Synthetic private dinner ' + index, mins: 30, servings: 4,
    accessTier: 'premium', premium: true,
    ingredients: [['Potatoes', '500 g', 1, 'Vegetables']],
    method: ['Cut the potatoes into even pieces.', 'Cook until tender.'],
    steps: ['Cut the potatoes into even pieces.', 'Cook until tender.']
  };
  const normalized = { id, ingredients: [{
    name: 'Potatoes', key: 'potatoes', quantity: 500, unit: 'g',
    recipe_id: id, ingredient_index: 0
  }] };
  return { recipe_id: id, sort_index: index, recipe_json: JSON.stringify(recipe), normalized_json: JSON.stringify(normalized) };
});
const apiResponse = (result, extra = {}) => new Response(JSON.stringify({ success: true, result, ...extra }), {
  status: 200, headers: { 'Content-Type': 'application/json' }
});
const queryResponse = rows => apiResponse([{ success: true, results: rows }]);
function withTemp(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-private-audit-loader-'));
  try { return run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function setupPaths(directory) {
  const publicRoot = path.join(directory, 'public-checkout');
  fs.mkdirSync(publicRoot);
  return { publicRoot, outputDirectory: path.join(directory, 'private-audit') };
}
function assertRedacted(error) {
  const text = String(error?.message || error);
  assert(!text.includes(token));
  assert(!text.includes('synthetic-private-provider-body'));
  assert(!text.includes('Synthetic private dinner'));
  return true;
}

test('configured database audit issues one fixed SELECT with read-only transport settings', async () => {
  const rows = rowsFixture(), calls = [];
  const result = await fetchPrivateRecipeRows({ env, perform: async (address, options) => {
    calls.push({ address, options });
    assert.equal(address, `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { sql: PRIVATE_RECIPE_SELECT });
    assert.equal(PRIVATE_RECIPE_SELECT, 'SELECT recipe_id,sort_index,recipe_json,normalized_json FROM bb_private_premium_recipes_500_v1 ORDER BY sort_index');
    assert(!/\b(?:insert|update|delete|drop|create|alter|pragma)\b/i.test(PRIVATE_RECIPE_SELECT));
    return queryResponse(rows);
  } });
  assert.equal(calls.length, 1);
  assert.equal(result.rows.length, 400);
  assert.equal(result.databaseId, databaseId);
  assert.equal(result.sha256, digest(rows));
});

test('database discovery reads only D1 listing and exactly matches basketboss_billing_live', async () => {
  const rows = rowsFixture(), calls = [];
  const discoveryEnv = { ...env }; delete discoveryEnv.CLOUDFLARE_DATABASE_ID;
  const result = await fetchPrivateRecipeRows({ env: discoveryEnv, perform: async (address, options) => {
    calls.push(address);
    const url = new URL(address);
    assert.equal(url.origin, 'https://api.cloudflare.com');
    assert.equal(options.redirect, 'error');
    if (url.pathname.endsWith('/d1/database')) {
      assert.equal(options.method || 'GET', 'GET');
      assert.equal(options.body, undefined);
      assert.equal(url.searchParams.get('per_page'), '100');
      assert.equal(url.searchParams.get('page'), '1');
      return apiResponse([
        { uuid: '99999999-1234-1234-1234-123456789012', name: 'basketboss_billing_live_backup' },
        { uuid: databaseId, name: 'basketboss_billing_live' }
      ], { result_info: { page: 1, per_page: 100, total_pages: 1 } });
    }
    assert.equal(url.pathname, `/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`);
    assert.deepEqual(JSON.parse(options.body), { sql: PRIVATE_RECIPE_SELECT });
    return queryResponse(rows);
  } });
  assert.equal(calls.length, 2);
  assert.equal(result.databaseId, databaseId);
});

test('missing or ambiguous exact database names stop before any recipe query', async () => {
  const discoveryEnv = { ...env }; delete discoveryEnv.CLOUDFLARE_DATABASE_ID;
  for (const databases of [
    [{ uuid: databaseId, name: 'basketboss_billing_live_backup' }],
    [{ uuid: databaseId, name: 'basketboss_billing_live' }, { uuid: '99999999-1234-1234-1234-123456789012', name: 'basketboss_billing_live' }],
    [{ uuid: databaseId, name: 'basketboss-billing-live' }, { uuid: '99999999-1234-1234-1234-123456789012', name: 'basketboss_billing_live' }]
  ]) {
    const calls = [];
    await assert.rejects(fetchPrivateRecipeRows({ env: discoveryEnv, perform: async address => {
      calls.push(address);
      assert(!new URL(address).pathname.endsWith('/query'));
      return apiResponse(databases, { result_info: { total_pages: 1 } });
    } }), assertRedacted);
    assert.equal(calls.length, 1);
  }
});

test('hyphenated production database name is accepted while similarly named backups are ignored', async () => {
  const discoveryEnv = { ...env }; delete discoveryEnv.CLOUDFLARE_DATABASE_ID;
  const calls = [];
  const result = await fetchPrivateRecipeRows({ env: discoveryEnv, perform: async (address, options) => {
    calls.push(address);
    if (!address.includes('/query')) return apiResponse([
      { uuid: '99999999-1234-1234-1234-123456789012', name: 'basketboss-billing-live-backup' },
      { uuid: databaseId, name: 'basketboss-billing-live' }
    ]);
    assert.deepEqual(JSON.parse(options.body), { sql: PRIVATE_RECIPE_SELECT });
    return queryResponse(rowsFixture());
  } });
  assert.equal(result.databaseId, databaseId);
  assert.equal(calls.length, 2);
});

test('database discovery follows bounded pages before choosing the unique exact match', async () => {
  const discoveryEnv = { ...env }; delete discoveryEnv.CLOUDFLARE_DATABASE_ID;
  const pages = [];
  const result = await fetchPrivateRecipeRows({ env: discoveryEnv, perform: async (address, options) => {
    const url = new URL(address);
    if (url.pathname.endsWith('/query')) {
      assert.deepEqual(pages, [1, 2]);
      assert.deepEqual(JSON.parse(options.body), { sql: PRIVATE_RECIPE_SELECT });
      return queryResponse(rowsFixture());
    }
    const page = Number(url.searchParams.get('page')); pages.push(page);
    return apiResponse(page === 1
      ? [{ uuid: '99999999-1234-1234-1234-123456789012', name: 'unrelated-database' }]
      : [{ uuid: databaseId, name: 'basketboss_billing_live' }],
    { result_info: { page, per_page: 100, total_pages: 2 } });
  } });
  assert.equal(result.databaseId, databaseId);
});

test('missing credentials and invalid account or database selectors make no request', async () => {
  for (const invalid of [
    { ...env, CLOUDFLARE_API_TOKEN: '' },
    { ...env, CLOUDFLARE_ACCOUNT_ID: '' },
    { ...env, CLOUDFLARE_ACCOUNT_ID: '../other-account' },
    { ...env, CLOUDFLARE_DATABASE_ID: '../../other-database' }
  ]) {
    let called = false;
    await assert.rejects(fetchPrivateRecipeRows({ env: invalid, perform: async () => { called = true; throw Error('unexpected request'); } }), assertRedacted);
    assert.equal(called, false);
  }
});

test('denied, redirected, invalid and exceptional API responses never reveal provider text or credentials', async () => {
  const secretBody = 'synthetic-private-provider-body ' + token;
  for (const perform of [
    async () => new Response(secretBody, { status: 403 }),
    async () => new Response(secretBody, { status: 302, headers: { Location: 'https://untrusted.example/' } }),
    async () => new Response(secretBody, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    async () => new Response(JSON.stringify({ success: false, errors: [{ message: secretBody }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    async () => apiResponse([{ success: false, error: secretBody, results: [] }]),
    async () => { throw Error(secretBody); }
  ]) await assert.rejects(fetchPrivateRecipeRows({ env, perform }), assertRedacted);
});

test('recipe reads reject incomplete, duplicate, reordered and inconsistent protected rows', async () => {
  const changes = [
    rows => rows.pop(),
    rows => { rows[399] = structuredClone(rows[0]); },
    rows => { rows[399].sort_index = 400; },
    rows => { rows[399].recipe_id = 'wrong-id'; },
    rows => { rows[399].recipe_json = '{invalid JSON'; },
    rows => { const value = JSON.parse(rows[399].recipe_json); value.premium = false; rows[399].recipe_json = JSON.stringify(value); },
    rows => { const value = JSON.parse(rows[399].recipe_json); value.method = []; rows[399].recipe_json = JSON.stringify(value); },
    rows => { const value = JSON.parse(rows[399].normalized_json); value.id = 'wrong-id'; rows[399].normalized_json = JSON.stringify(value); },
    rows => { const value = JSON.parse(rows[399].normalized_json); value.ingredients = []; rows[399].normalized_json = JSON.stringify(value); }
  ];
  for (const change of changes) {
    const rows = rowsFixture(); change(rows);
    await assert.rejects(fetchPrivateRecipeRows({ env, perform: async () => queryResponse(rows) }), assertRedacted);
  }
});

test('private exports stay outside public checkout with restrictive directory/file permissions and exact integrity hash', () => withTemp(directory => {
  const { publicRoot, outputDirectory } = setupPaths(directory), rows = rowsFixture();
  const result = writePrivateRecipeExport({ publicRoot, outputDirectory, rows, databaseId });
  assert.equal(result.sha256, digest(rows));
  assert.equal(fs.statSync(outputDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(result.exportPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(result.exportPath).nlink, 1);
  assert(fs.realpathSync(result.exportPath).startsWith(fs.realpathSync(outputDirectory) + path.sep));
  const value = JSON.parse(fs.readFileSync(result.exportPath, 'utf8'));
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.source.kind, 'cloudflare-d1-read-only');
  assert.equal(value.source.table, 'bb_private_premium_recipes_500_v1');
  assert.equal(value.source.databaseId, databaseId);
  assert(Number.isFinite(Date.parse(value.source.readAt)));
  assert.equal(value.rowsSha256, digest(rows));
  assert.deepEqual(value.rows, rows);
  const validated = validatePrivateRecipeExport(value);
  assert.equal(validated.recipes.length, 400);
  assert.equal(validated.normalized.recipes.length, 400);
  assert.equal(validated.sha256, digest(rows));
  assert(!JSON.stringify(result).includes('Synthetic private dinner'));
  assert(!JSON.stringify(result).includes(token));
}));

test('export creation refuses public paths and public-directory symlink aliases before writing recipes', () => withTemp(directory => {
  const { publicRoot } = setupPaths(directory), rows = rowsFixture();
  const inside = path.join(publicRoot, 'private-data');
  assert.throws(() => writePrivateRecipeExport({ publicRoot, outputDirectory: inside, rows, databaseId }), assertRedacted);
  assert.equal(fs.existsSync(inside), false);
  const alias = path.join(directory, 'alias'); fs.symlinkSync(publicRoot, alias, 'dir');
  assert.throws(() => writePrivateRecipeExport({ publicRoot, outputDirectory: alias, rows, databaseId }), assertRedacted);
  assert.deepEqual(fs.readdirSync(publicRoot), []);
}));

test('creating another private export never overwrites an existing export', () => withTemp(directory => {
  const { publicRoot, outputDirectory } = setupPaths(directory), rows = rowsFixture();
  const first = writePrivateRecipeExport({ publicRoot, outputDirectory, rows, databaseId });
  const before = fs.readFileSync(first.exportPath);
  let second;
  try { second = writePrivateRecipeExport({ publicRoot, outputDirectory, rows, databaseId }); }
  catch (error) { assertRedacted(error); }
  if (second) assert.notEqual(second.exportPath, first.exportPath);
  assert.deepEqual(fs.readFileSync(first.exportPath), before);
}));

test('pre-existing symlink or hardlink export paths cannot redirect writes into public files', () => withTemp(directory => {
  const { publicRoot, outputDirectory } = setupPaths(directory), rows = rowsFixture();
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  const target = path.join(publicRoot, 'unchanged.txt');
  fs.writeFileSync(target, 'sentinel-public-file');
  const exportPath = path.join(outputDirectory, 'current-premium.json');
  fs.symlinkSync(target, exportPath);
  assert.throws(() => writePrivateRecipeExport({ publicRoot, outputDirectory, rows, databaseId }), assertRedacted);
  assert.equal(fs.readFileSync(target, 'utf8'), 'sentinel-public-file');
  fs.unlinkSync(exportPath);
  fs.linkSync(target, exportPath);
  assert.throws(() => writePrivateRecipeExport({ publicRoot, outputDirectory, rows, databaseId }), assertRedacted);
  assert.equal(fs.readFileSync(target, 'utf8'), 'sentinel-public-file');
}));

test('private export validation rejects tampering, unsupported provenance and unexpected table names', () => withTemp(directory => {
  const { publicRoot, outputDirectory } = setupPaths(directory);
  const exported = writePrivateRecipeExport({ publicRoot, outputDirectory, rows: rowsFixture(), databaseId });
  const valid = JSON.parse(fs.readFileSync(exported.exportPath, 'utf8'));
  for (const change of [
    value => { value.rows[0].recipe_json = value.rows[0].recipe_json.replace('Synthetic private dinner', 'Altered private dinner'); },
    value => { value.rowsSha256 = '0'.repeat(64); },
    value => { value.source.kind = 'historical'; },
    value => { value.source.table = 'arbitrary_table'; },
    value => { value.schemaVersion = 999; }
  ]) {
    const value = structuredClone(valid); change(value);
    assert.throws(() => validatePrivateRecipeExport(value), assertRedacted);
  }
}));

test('orchestration reads fixed recipe rows then writes only the selected private directory', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-private-audit-load-'));
  try {
    const { publicRoot, outputDirectory } = setupPaths(directory), calls = [];
    const result = await loadPrivateRecipeAudit({ publicRoot, outputDirectory, env, perform: async (address, options) => {
      calls.push(address);
      assert.deepEqual(JSON.parse(options.body), { sql: PRIVATE_RECIPE_SELECT });
      return queryResponse(rowsFixture());
    } });
    assert.equal(calls.length, 1);
    assert.equal(fs.existsSync(result.exportPath), true);
    assert.deepEqual(fs.readdirSync(publicRoot), []);
    assert(!JSON.stringify(result).includes('Synthetic private dinner'));
    assert(!JSON.stringify(result).includes(token));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
