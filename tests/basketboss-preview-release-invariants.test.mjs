/* BasketBoss Preview non-regression tests against REAL repository files.
   Read-only. No credentials, network, checkout, or D1 calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readWorkerInventory} from './helpers/service-worker-inventory.mjs';
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
  const inventory=readWorkerInventory(sw);
  assert.equal(inventory.imports,1);assert.ok(inventory.core.length>=50,'expected the existing protected shell inventory');
  assert.ok(inventory.pwa.length>=150,'expected the generated public700 inventory to be included');
  const assetFile=async address=>{
    const url=new URL(address,'https://basketboss.co.uk/');assert.equal(url.origin,'https://basketboss.co.uk');
    const path=url.pathname.slice(1);
    assert.ok(!path.startsWith('api/')&&!path.endsWith('.webmanifest')&&path!=='recipes.json',`${path} must not be pre-cached`);
    assert.doesNotMatch(path,/(?:^|\/)(?:functions|bb-server-lib|native|dist|sql|scripts|tests|docs|node_modules)(?:\/|$)|(?:^|\/)\.[^/]+|\.(?:private|sealed|backup)(?:\.json)?$/i);
    for(const key of ['code','token_hash','access_token','refresh_token','error_code'])assert.equal(url.searchParams.has(key),false,'credential query must not enter the cache');
    let source=new URL(path,root);
    try{assert.ok((await fs.stat(source)).isFile());}catch{source=new URL(path+'.html',root);assert.ok((await fs.stat(source)).isFile());}
    return source;
  };
  for (const url of inventory.core) await assetFile(url);
  const proof=[];
  for(const url of inventory.pwa){assert.ok(inventory.core.includes(new URL(url,'https://basketboss.co.uk/').href),'generated entry must join actual CORE');proof.push({url,sha256:createHash('sha256').update(await fs.readFile(await assetFile(url))).digest('hex')});}
  assert.deepEqual(inventory.pwa,inventory.pwa.slice().sort(),'cache hash uses sorted exact URLs including query versions');
  assert.equal(inventory.version,createHash('sha256').update(JSON.stringify(proof)).digest('hex'),'cache identity binds the actual generated and shared asset bytes');
  assert.equal(inventory.cache,inventory.base+'-'+inventory.version);
  const publicFree=JSON.parse(await read('pwa700/recipes.json'));
  assert.equal(publicFree.length,200);assert.equal(new Set(publicFree.map(row=>row.id)).size,200);
  for(const recipe of publicFree){
    assert.notEqual(recipe.premium,true);assert.notEqual(recipe.accessTier,'premium');
  }
});

test('Complete legacy and 400-record Premium releases still pass through authenticated private D1 API', async () => {
  const [api, app] = await Promise.all([read('functions/api/recipes/premium.js'), read('make-a-meal.js')]);
  assert.match(api, /authenticatedUser\(request,env\)/);
  assert.match(api, /bb_private_premium_recipes/);
  assert.match(api, /\[221,400\]\.includes\(rows\.results\.length\)/);
  assert.match(app, /bbMealJSON\('\/api\/recipes\/premium\?catalogue=500',\{\s*cache:'no-store',credentials:'same-origin',redirect:'manual',\s*headers:\{'Accept':'application\/json','Authorization':'Bearer '\+token\}/);
  assert.match(app, /bbSecureFreeIds\.has\(recipe\.id\)\|\|bbSecurePremiumIds\.has\(recipe\.id\)/);
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
