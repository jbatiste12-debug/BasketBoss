import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {APPROVED_RELEASE, validateCatalogueRows, validateApprovedPayload, legacyRowsDigest, verifyExpandedRows, requireReleaseEnvironment, verifyLivePublicRoutes} from '../scripts/activate-private-catalogue.mjs';

function catalogue() {
  const rows = Array.from({length: 400}, (_, i) => {
    const id = 'synthetic-recipe-' + i;
    const recipe = {id, ingredients: [['Test', '1 g']], accessTier: 'premium', premium: true, image: 'release-assets/basketboss-v17/images/new/' + id + '.webp', ...(i >= 221 ? {catalogueNumber: 322 + i - 221} : {})};
    return {recipe_id: id, sort_index: i, recipe_json: JSON.stringify(recipe), normalized_json: JSON.stringify({id, ingredients: [{name: 'Test', quantity: 1, unit: 'g'}]})};
  });
  return {rows, baseline: rows.slice(0, 221).map(row => row.recipe_id)};
}

test('SQL generator accepts complete structured rows and mutates only isolated versioned table', () => {
  const {rows, baseline} = catalogue();
  const sql = validateCatalogueRows(rows, baseline);
  assert.equal((sql.match(/^INSERT INTO /gm) || []).length, 400);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bb_private_premium_recipes_500_v1/);
  assert.doesNotMatch(sql, /(?:DELETE FROM|INSERT INTO|DROP TABLE|ALTER TABLE) bb_private_premium_recipes(?:\s|;)/);
});
test('rejects reordered baseline, duplicate IDs, wrong addition numbers and non-Premium rows', () => {
  for (const mutate of [
    data => data.baseline.reverse(),
    data => {data.rows[399] = {...data.rows[398], sort_index: 399};},
    data => {const r = JSON.parse(data.rows[221].recipe_json);r.catalogueNumber = 400;data.rows[221].recipe_json = JSON.stringify(r);},
    data => {const r = JSON.parse(data.rows[300].recipe_json);r.premium = false;data.rows[300].recipe_json = JSON.stringify(r);}
  ]) {
    const data = catalogue();mutate(data);assert.throws(() => validateCatalogueRows(data.rows, data.baseline));
  }
});
test('hard-pinned SQL hash refuses a different well-formed encrypted sender payload', () => {
  const {rows, baseline} = catalogue();
  const payload = {...APPROVED_RELEASE, rows, baselinePremiumIds: baseline};
  assert.throws(() => validateApprovedPayload(payload, APPROVED_RELEASE), /SQL hash does not match/);
  assert.throws(() => validateApprovedPayload({...payload, sqlSha256: 'a'.repeat(64)}, APPROVED_RELEASE), /approved release/);
  assert.throws(() => validateApprovedPayload(payload, {...APPROVED_RELEASE, sourceCommit: 'a'.repeat(40)}), /metadata/);
});
test('legacy digest preserves exact original content and rejects an unexpected saved-plan ID', () => {
  const {rows, baseline} = catalogue();const legacy = rows.slice(0, 221);
  const initial = legacyRowsDigest(legacy, baseline);
  legacy[0] = {...legacy[0], recipe_json: JSON.stringify({...JSON.parse(legacy[0].recipe_json), note: 'changed content'})};
  assert.notEqual(legacyRowsDigest(legacy, baseline), initial);
  const invalid = [...baseline];invalid[0] = 'unexpected';
  assert.throws(() => legacyRowsDigest(legacy, invalid), /differ from/);
});
test('post-import verification compares every ID, order and JSON byte', () => {
  const {rows} = catalogue();assert.equal(verifyExpandedRows(structuredClone(rows), rows), true);
  const changed = structuredClone(rows);changed[287].normalized_json += ' ';
  assert.throws(() => verifyExpandedRows(changed, rows), /does not match/);
  assert.throws(() => verifyExpandedRows(rows.slice(1), rows), /exactly 400/);
});
test('activation environment never permits a PR, foreign repository, or unrecognized mode', () => {
  const env = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jbatiste12-debug/BasketBoss', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), RUNNER_TEMP: '/tmp/runner', BB_IMPORT_MODE: 'inspect'};
  requireReleaseEnvironment(env);
  for (const patch of [{GITHUB_REF: 'refs/pull/1/merge'}, {GITHUB_REPOSITORY: 'foreign/repo'}, {BB_IMPORT_MODE: 'delete'}, {GITHUB_SHA: 'bad'}, {RUNNER_TEMP: 'relative'}]) assert.throws(() => requireReleaseEnvironment({...env, ...patch}));
});
test('live checks require public100, landing500, protected Premium and actual WebP', async () => {
  const {rows} = catalogue();const seen = [];
  await verifyLivePublicRoutes(rows, async (address, options) => {
    const url = new URL(address);seen.push({url, options});
    assert.equal(url.origin, 'https://basketboss.co.uk');assert.equal(options.redirect, 'manual');
    if (url.pathname === '/') return {ok: true, text: async () => '500 recipes'};
    if (url.pathname === '/recipes.json') return {ok: true, json: async () => Array(100).fill({id: 'free'})};
    if (url.pathname === '/api/recipes/premium') return {status: 401};
    return {ok: true, headers: new Headers({'content-type': 'image/webp'})};
  });
  assert.equal(seen.length, 4);assert.equal(seen[3].options.method, 'HEAD');
  await assert.rejects(verifyLivePublicRoutes(rows, async () => ({ok: true, text: async () => '321 recipes'})), /not yet published/);
});
test('live check accepts the shipped 500 with Premium landing wording', async () => {
  const {rows} = catalogue();const landing = fs.readFileSync(new URL('../welcome.html', import.meta.url), 'utf8');
  const result = await verifyLivePublicRoutes(rows, async address => {
    const url = new URL(address);
    if (url.pathname === '/') return {ok: true, text: async () => landing};
    if (url.pathname === '/recipes.json') return {ok: true, json: async () => Array(100).fill({id: 'free'})};
    if (url.pathname === '/api/recipes/premium') return {status: 403};
    return {ok: true, headers: new Headers({'content-type': 'image/webp'})};
  });
  assert.equal(result.landing500, true);
});
test('public route redirects may use www BasketBoss but never another host', async () => {
  const {rows} = catalogue();
  await assert.rejects(verifyLivePublicRoutes(rows, async () => ({status: 302, headers: new Headers({location: 'https://foreign.example/'})})), /outside BasketBoss/);
  let landingRedirected = false;
  const result = await verifyLivePublicRoutes(rows, async address => {
    const url = new URL(address);
    if (url.pathname === '/') {
      if (url.hostname === 'basketboss.co.uk') return {status: 301, headers: new Headers({location: 'https://www.basketboss.co.uk/'})};
      landingRedirected = true;return {ok: true, text: async () => '500 with Premium'};
    }
    if (url.pathname === '/recipes.json') return {ok: true, json: async () => Array(100).fill({id: 'free'})};
    if (url.pathname === '/api/recipes/premium') return {status: 401};
    return {ok: true, headers: new Headers({'content-type': 'image/webp'})};
  });
  assert.equal(landingRedirected, true);assert.equal(result.landing500, true);
});
