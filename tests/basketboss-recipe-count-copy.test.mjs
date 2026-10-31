import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const configContext={window:{}};
vm.runInNewContext(read('bb-premium-preview-config.js'),configContext);
const config=configContext.window.BB173_PREMIUM_PREVIEW;
const total=config.freeRecipes+config.targetPremiumRecipes;
const index=read('index.html');
const app=read('app.html');
const stripComments=source=>source.replace(/<!--[\s\S]*?-->/g,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/[^\n]*/g,'$1');
const surfaces=['index.html','app.html','welcome.html','make-a-meal.html','compare.html','pricing-sandbox.html','bb-premium-features.js','bb-plan-premium-polish.js','bb-onboarding-v2.js','bb-real-app-tour.js','bb-real-app-tour-v82.js','bb-beta-landing.js','premium-upgrade.js'];

test('presentation metadata describes the actual 100 Free plus 400 Premium catalogue without granting access',()=>{
 const free=JSON.parse(read('recipes.json'));
 assert.equal(config.freeRecipes,100);
 assert.equal(config.targetPremiumRecipes,400);
 assert.equal(config.totalRecipes,total);
 assert.equal(config.targetRecipes,total);
 assert.equal(total,500);
 assert.equal(free.length,config.freeRecipes);
 assert.equal(new Set(configContext.window.BB173_FREE_RECIPE_IDS).size,100);
 assert.deepEqual([...configContext.window.BB173_FREE_RECIPE_IDS].sort(),free.map(r=>r.id).sort());
 assert.deepEqual([...config.acceptedPremiumRecipeCounts],[221,400]);
 assert.equal(config.subscriptionVerified,false);
});

test('Plan and Make a Meal upgrade/search copy agrees with catalogue metadata',()=>{
 assert.equal(index,app,'The app entrypoints must remain identical.');
 for(const source of [index,app]){
  assert.equal(Number(source.match(/placeholder="Search (\d+) BasketBoss recipes"/)?.[1]),total);
  assert.equal(Number(source.match(/Premium · (\d+) recipes \+ Leftover Magic/)?.[1]),total);
  assert.equal(Number(source.match(/All <strong>(\d+) recipes<\/strong> \(100 recipes stay free\)/)?.[1]),total);
 }
 const meal=read('make-a-meal.html');
 assert.equal(Number(meal.match(/Premium unlocks all (\d+)/)?.[1]),total);
 assert.equal(Number(meal.match(/full (\d+)-recipe library/)?.[1]),total);
 assert.equal(Number(meal.match(/Premium \((\d+) recipes\)/)?.[1]),total);
 const premium=read('bb-premium-features.js');
 assert.equal(Number(premium.match(/(\d+) more recipes in Premium/)?.[1]),config.targetPremiumRecipes);
 assert.match(premium,/100 recipes stay free/);
 assert.equal(Number(premium.match(/Includes (\d+) recipes/)?.[1]),total);
});

test('pricing, onboarding and tours describe the same 500-recipe Premium access',()=>{
 assert.equal(Number(read('compare.html').match(/Built-in recipes<\/th><td>100 recipes<\/td><td>(\d+) recipes/)?.[1]),total);
 const pricing=read('pricing-sandbox.html');
 assert.equal(Number(pricing.match(/All (\d+) recipes/)?.[1]),total);
 assert.equal(Number(pricing.match(/Same (\d+)-recipe access/)?.[1]),total);
 assert.match(pricing,/Free: 100 recipes/);
 for(const file of ['bb-onboarding-v2.js','bb-real-app-tour.js','bb-real-app-tour-v82.js']){
  const source=read(file);
  assert.match(source,/100 (?:Free )?recipes|100 recipes free/);
  assert.match(source,new RegExp('(?:All|all) '+total+'(?: recipes)?(?: with Premium|, advanced planning)'));
 }
});

test('landing visible copy and metadata retain 100 Free and disclose 500 with Premium',()=>{
 const page=read('welcome.html');
 assert.match(page,/100 recipes free <span class="sep">·<\/span> 500 with Premium/);
 assert.match(page,/Premium unlocks all 500 recipes/);
 const schema=JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
 assert.match(schema.description,/100 free recipes, all 500 with Premium/);
 assert.ok(schema.featureList.includes('100 free recipes; all 500 with Premium'));
 for(const name of ['description','twitter:description','og:description']){
  const tag=page.match(new RegExp('<meta (?:name|property)="'+name+'" content="([^"]+)"'))?.[1];
  assert.match(tag,/100 free recipes/);
  assert.match(tag,/500 with Premium/);
 }
 // The landing demo still loads only the public 100, never a private 500-record bundle.
 assert.match(read('bb-beta-landing.js'),/data\.length!==100/);
});

test('no active product surface advertises an obsolete catalogue size',()=>{
 const obsolete=/\b(?:321|[23]00\s*\+)\s*(?:[-–]\s*)?(?:BasketBoss\s+)?recipes?\b|\b221\s+more\s+recipes\b|\b(?:all|full|Premium(?:\s+unlocks\s+all)?)\s+321\b/i;
 for(const file of surfaces)assert.doesNotMatch(stripComments(read(file)),obsolete,file);
});

test('copy changes preserve legacy storage identities and Premium compatibility',()=>{
 for(const source of [index,app]){
  for(const key of ['basketboss_321_unified_state_v1','basketboss_321_v7_measured_pantry','basketboss_321_v7_market'])assert.ok(source.includes(key),key);
  assert.match(source,/\[221,400\]\.includes\(data\?\.count\)/);
 }
 const meal=read('make-a-meal.js');
 assert.match(meal,/basketboss_321_unified_state_v1/);
 assert.match(meal,/\[221,400\]\.includes\(data\?\.count\)/);
});

test('SmartReceipt landing copy stays draft-only before its workflow is implemented',()=>{
 assert.match(read('docs/SMART_RECEIPT_LANDING_DRAFT.md'),/draft only/);
 for(const file of ['welcome.html','bb-beta-landing.js'])assert.doesNotMatch(read(file),/SmartReceipt/);
});
