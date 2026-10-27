/* BasketBoss Preview non-regression tests against REAL repository files.
   Read-only. No credentials, network, checkout, or D1 calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = p => fs.readFile(new URL(p, root), 'utf8');

test('Free catalogue, inline planner and static allowlist agree on exactly 100 unique recipe IDs', async () => {
  const [recipeSource, index, config] = await Promise.all([
    read('recipes.json'), read('index.html'), read('bb-premium-preview-config.js')
  ]);
  const recipes = JSON.parse(recipeSource);
  const inline = index.match(/const RECIPES=(\[[^\n]+\]);/);
  assert.ok(inline, 'expected original planner inline recipe source');
  const embedded = JSON.parse(inline[1]);
  const freeMatch = config.match(/window\.BB173_FREE_RECIPE_IDS=Object\.freeze\((\[[^\n]+\])\);/);
  assert.ok(freeMatch, 'expected Free recipe allowlist');
  const ids = JSON.parse(freeMatch[1]);
  for (const [name, list] of [['public JSON', recipes], ['inline planner', embedded]]) {
    assert.equal(list.length, 100, `${name}: only 100 public recipes`);
    assert.equal(new Set(list.map(r => r.id)).size, 100, `${name}: IDs unique`);
  }
  assert.equal(ids.length, 100);
  assert.deepEqual(ids.slice().sort(), recipes.map(r => r.id).sort());
  assert.deepEqual(embedded.map(r => r.id).sort(), recipes.map(r => r.id).sort());
});

test('Public normalized recipe data does not expose the protected 221 catalogue', async () => {
  const norm = JSON.parse(await read('normalized-ingredient-database.json'));
  assert.equal(norm.count_recipes, 100);
  assert.equal(norm.recipes?.length, 100);
});

test('All locally pre-cached PWA assets exist, without manifest or API paths', async () => {
  const sw = await read('service-worker.js');
  const match = sw.match(/const CORE\s*=\s*\[([\s\S]*?)\]\s*\.map\(/);
  assert.ok(match, 'expected a static CORE list');
  const assets = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(assets.length >= 50, 'expected the existing protected shell inventory');
  for (const url of assets) {
    const path = url.replace(/^\.\//, '').split('?')[0];
    assert.ok(!path.startsWith('api/') && path !== 'manifest.webmanifest' && path !== 'recipes.json',
      `${path} must not be pre-cached`);
    await fs.access(new URL(path, root));
  }
});

test('Owner 221 additional recipes still pass through authenticated private D1 API', async () => {
  const [api, app] = await Promise.all([read('functions/api/recipes/premium.js'), read('make-a-meal.js')]);
  assert.match(api, /authenticatedUser\(request,env\)/);
  assert.match(api, /bb_private_premium_recipes/);
  assert.match(api, /rows\.results\.length!==221/);
  assert.match(app, /fetch\('\/api\/recipes\/premium'/);
  assert.doesNotMatch(app, /data\.length!==321/);
});

test('Preview AI Owner-only and live billing security flags are not loosened', async () => {
  const [ai, checkout, webhook] = await Promise.all([
    read('functions/api/bb173/[action].js'),
    read('functions/api/subscription/checkout.js'),
    read('functions/api/paddle/webhook.js')
  ]);
  assert.match(ai, /BB_OWNER_AI_PREVIEW_BRANCH==='billing-premium-secure-20261026-2'/);
  assert.match(ai, /BB_BILLING_MODE==='sandbox'/);
  assert.match(ai, /BB_BILLING_ENABLED==='false'/);
  assert.match(ai, /BB_LIVE_CHECKOUT_ENABLED!=='true'/);
  assert.match(ai, /BB_LIVE_WEBHOOK_ENABLED!=='true'/);
  assert.match(checkout, /BB_LIVE_CHECKOUT_ENABLED!=='true'/);
  assert.match(checkout, /BB_LIVE_WEBHOOK_ENABLED!=='true'/);
  assert.match(webhook, /BB_LIVE_WEBHOOK_ENABLED!=='true'/);
});
