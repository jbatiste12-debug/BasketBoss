import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=async p=>fs.readFile(new URL(p,root),'utf8');
const list=JSON.parse(await read('recipes.json'));
const ids=new Set(list.map(r=>r.id));
const config=await read('bb-premium-preview-config.js');
const match=config.match(/window\.BB173_FREE_RECIPE_IDS=Object\.freeze\((\[[^\n]+\])\);/);
assert.ok(match,'free ID configuration present');
const free=new Set(JSON.parse(match[1]));
test('only 100 unique Free recipe contents are public',()=>{
  assert.equal(list.length,100);assert.equal(ids.size,100);assert.equal(free.size,100);
  assert.deepEqual([...ids].sort(),[...free].sort());
});
test('Make a Meal uses authenticated Premium delivery, not a 321-item public bundle',async()=>{
  const source=await read('make-a-meal.js');
  assert.match(source,/fetch\('\/api\/recipes\/premium'/);
  assert.match(source,/bbSecurePremiumIds/);
  assert.doesNotMatch(source,/data\.length!==321/);
  assert.doesNotMatch(source,/bb174_premium_local_demo_v1/);
});
test('service worker uses a fresh cache and avoids public full-catalogue caching',async()=>{
  const source=await read('service-worker.js');
  assert.match(source,/basketboss-premium-secure-shell-20261030-v14-beta-live/);
  const core=source.match(/const CORE\s*=\s*\[([\s\S]*?)\]\s*\.map\(/)?.[1];
  assert.ok(core,'precache declaration present');
  assert.doesNotMatch(core,/['"]manifest\.webmanifest['"]/);
});
test('authenticated server API retains access gate and no-store',async()=>{
  const api=await read('functions/api/recipes/premium.js');
  const billing=await read('bb-server-lib/bb-billing.js');
  assert.match(api,/authenticatedUser\(request,env\)/);
  assert.match(api,/bb_paid_entitlements/);
  assert.match(api,/bb_private_premium_recipes/);
  assert.match(billing,/'Cache-Control':'no-store'/);
});
test('verified UI is presentation-only and checks the server',async()=>{
  const source=await read('bb-verified-premium-ui.js');
  assert.match(source,/\/api\/subscription\/status/);
  assert.match(source,/premiumAccess===true/);
  assert.doesNotMatch(source,/setActive\s*[:=(]/);
});
