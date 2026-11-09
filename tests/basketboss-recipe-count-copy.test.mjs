import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const configContext={window:{}};
vm.runInNewContext(read('bb-premium-preview-config.js'),configContext);
const config=configContext.window.BB173_PREMIUM_PREVIEW;
const total=config.freeRecipes+config.targetPremiumRecipes;
const webRelease=JSON.parse(read('catalogues/700/release/manifest.json'));
const webFree=webRelease.free_count,webTotal=webFree+webRelease.premium_count;
const index=read('index.html');
const app=read('app.html');
const stripComments=source=>source.replace(/<!--[\s\S]*?-->/g,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/[^\n]*/g,'$1');
const surfaces=['index.html','app.html','welcome.html','make-a-meal.html','compare.html','pricing-sandbox.html','bb-premium-features.js','bb-plan-premium-polish.js','bb-onboarding-v2.js','bb-real-app-tour.js','bb-real-app-tour-v82.js','bb-beta-landing.js','premium-upgrade.js'];

test('preserved legacy presentation metadata describes 100 Free plus 400 Premium without granting access',()=>{
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

test('preserved legacy Plan and Make a Meal copy agrees with its catalogue metadata',()=>{
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

test('public web pricing and comparison describe 200 Free and all 700 while retaining App Store availability',()=>{
 assert.equal(webRelease.catalogue_version,700);
 assert.equal(webFree,200);
 assert.equal(webRelease.premium_count,500);
 assert.equal(webTotal,700);
 const comparison=read('compare.html'),row=comparison.match(/Built-in recipes<\/th><td>(\d+) recipes<\/td><td>All (\d+) recipes/);
 assert.equal(Number(row?.[1]),webFree);
 assert.equal(Number(row?.[2]),webTotal);
 const pricing=read('pricing-sandbox.html');
 assert.equal(Number(pricing.match(/All (\d+) recipes/)?.[1]),webTotal);
 assert.equal(Number(pricing.match(/Same (\d+)-recipe access/)?.[1]),webTotal);
 assert.match(pricing,/Free: 200 recipes/);
 for(const page of [pricing,comparison]){
  assert.match(page,/App Store: currently 100 Free and 500 total/);
  assert.match(page,/expanded collection is coming in an update/);
 }
});

test('preserved legacy onboarding and tours continue to describe 100 Free and all 500',()=>{
 for(const file of ['bb-onboarding-v2.js','bb-real-app-tour.js','bb-real-app-tour-v82.js']){
  const source=read(file);
  assert.match(source,/100 (?:Free )?recipes|100 recipes free/);
  assert.match(source,new RegExp('(?:All|all) '+total+'(?: recipes)?(?: with Premium|, advanced planning)'));
 }
});

test('landing visible copy and metadata describe 200 Free and all 700 for the web',()=>{
 const page=read('welcome.html');
 assert.match(page,/<strong>200 free recipes<\/strong>/);
 assert.match(page,/<h3>Premium<\/h3>[\s\S]*?<strong>All 700 recipes<\/strong>/);
 assert.match(page,/App Store: currently 100 Free and 500 total/);
 assert.match(page,/expanded collection is coming in an update/);
 const schema=JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
 assert.match(schema.description,/200 free recipes, all 700 with Premium/);
 assert.ok(schema.featureList.includes('200 free recipes; all 700 with Premium'));
 for(const name of ['description','twitter:description','og:description']){
  const tag=page.match(new RegExp('<meta (?:name|property)="'+name+'" content="([^"]+)"'))?.[1];
  assert.match(tag,/200 free recipes/);
  assert.match(tag,/700 with Premium on the web/);
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

test('SmartReceipt landing copy stays hidden until the implemented feature is configured',()=>{
 assert.match(read('docs/SMART_RECEIPT_LANDING_DRAFT.md'),/hidden/);
 assert.match(read('welcome.html'),/<section[^>]*data-bb-smart-receipt-ready[^>]*hidden/);
 assert.match(read('functions/index.js'),/receiptInventoryConfigured\(request,env\)/);
 assert.doesNotMatch(read('bb-beta-landing.js'),/SmartReceipt/);
});
