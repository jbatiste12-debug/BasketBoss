import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';
import {inlineArray} from '../tools/catalogue700/build-client.mjs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('700 presentation updates actual client copy without changing recipe data or legacy hydration contracts', () => {
  for (const file of ['index.html', 'app.html']) {
    const source = read(file), result = transform700Presentation(source);
    assert.deepEqual(inlineArray(result, 'RECIPES').value, inlineArray(source, 'RECIPES').value);
    assert.deepEqual(inlineArray(result, 'BB307_NORMALIZED').value, inlineArray(source, 'BB307_NORMALIZED').value);
    assert.ok(result.includes("fetch('/api/recipes/premium?catalogue=500'"));
    assert.ok(result.includes('if(![221,400].includes(data?.count)'));
    assert.match(result, /700 recipes<\/strong> \(200 recipes stay free\)/);
    assert.match(result, /50 breakfast options/);
    assert.doesNotMatch(result, /Search 500 BasketBoss recipes/);
    assert.match(result, /Search BasketBoss recipes/);
    assert.match(result, /Up to 5 AI photo scans\/day/);
    assert.match(result, /Up to 10 AI meal ideas\/day/);
    assert.match(result, /£1\.99\/month/);
    assert.match(result, /£4\.99\/month/);
  }
});

test('700 presentation updates the actual onboarding, membership and recipe-upgrade copy', () => {
  const expectations = [
    ['bb-premium-features.js', /200 free recipes today · All 700 with Premium/, /500 more recipes in Premium/, /50 breakfast options/],
    ['bb-membership-compare.js', /'200 recipes','All 700 recipes'/],
    ['bb-onboarding-v2.js', /200 FREE/, /200 free recipes/, /All 700 recipes, including 50 breakfast options/],
    ['bb-real-app-tour-v82.js', /200 Free recipes; all 700 recipes/],
    ['bb-real-app-tour.js', /200 Free recipes, or all 700 with Premium/],
    ['bb-plan-premium-polish.js', /Discover 700 recipes/],
    ['bb-intro-trial.js', /Explore 200 Free Recipes/],
    ['bb-welcome-splash.js', /Explore 200 Free Recipes/],
    ['bb174-trial-ux.js', /200 starter recipes/],
    ['native/membership.html', /Use 200 recipes free/],
    ['native/membership.mjs', /Use 200 recipes free/],
    ['make-a-meal.html', /Explore 200 free recipes/, /full 700-recipe library/, /include all 700 recipes/],
  ];
  for (const [file, ...patterns] of expectations) {
    const result = transform700Presentation(read(file));
    for (const pattern of patterns) assert.match(result, pattern, file);
    assert.equal(transform700Presentation(result), result, file + ' must remain stable when transformed twice');
  }
});

test('presentation cannot turn legacy or versioned numerical security and transport contracts into another catalogue', () => {
  const contract = `
    const legacy = {freeRecipes:100,totalRecipes:500,targetPremiumRecipes:400,acceptedPremiumRecipeCounts:[221,400]};
    const current = {catalogueVersion:700,free_count:200,premium_count:500};
    if (data.count!==500 || data.recipes.length!==500 || data.normalized.length!==500) throw Error('invalid');
    for (let index=0;index<500;index++) verify(data.recipes[index]);
    const legacyURL='/api/recipes/premium?catalogue=500', currentURL='/api/recipes/v700/premium?catalogue=700';
    const stock={'rice|g':500,'milk|ml':400}, timer=100, quota=[5,10], price=4.99;
  `;
  assert.equal(transform700Presentation(contract), contract);
  const original = {window:{}}, transformed = {window:{}};
  vm.runInNewContext(read('bb-premium-preview-config.js'), original);
  vm.runInNewContext(transform700Presentation(read('bb-premium-preview-config.js')), transformed);
  assert.equal(JSON.stringify(transformed.window), JSON.stringify(original.window));
});

test('transformed client scripts remain executable syntax', () => {
  for (const file of ['bb-premium-features.js', 'bb-membership-compare.js', 'bb-onboarding-v2.js', 'bb-real-app-tour-v82.js', 'bb-real-app-tour.js', 'bb-plan-premium-polish.js', 'bb-intro-trial.js', 'bb-welcome-splash.js', 'bb174-trial-ux.js']) {
    assert.doesNotThrow(() => new vm.Script(transform700Presentation(read(file)), {filename:file}));
  }
  assert.throws(() => transform700Presentation(null), TypeError);
});

test('public web copy distinguishes the expanded PWA from the existing App Store version and preserves billing terms', () => {
  const landing = read('welcome.html'), pricing = read('pricing-sandbox.html'), subscriptions = read('subscriptions.html'), compare = read('compare.html'), terms = read('terms.html');
  assert.match(landing, /200 free recipes/);
  assert.match(landing, /All 700 recipes/);
  assert.match(landing, /50 breakfast options/);
  assert.match(landing, /App Store: currently 100 Free and 500 total/);
  assert.match(landing, /expanded collection is coming in an update/);
  assert.doesNotMatch(landing, /BasketBoss is currently in Beta|BasketBoss · Beta/);
  assert.match(pricing, /All 700 recipes/);
  assert.match(pricing, /50 breakfast options/);
  assert.match(pricing, /Same 700-recipe access/);
  assert.match(pricing, /7-day free trial/);
  assert.match(pricing, /3-day free trial/);
  assert.match(pricing, /first 25 qualifying places remain/);
  assert.match(pricing, /£1\.99\/month/);
  assert.match(pricing, /£4\.99\/month/);
  assert.match(subscriptions, /No annual web plan is currently available/);
  assert.match(subscriptions, /£39\.99\/year paid upfront/);
  assert.match(subscriptions, /web trials above do not automatically apply/);
  assert.match(compare, /All 700 recipes/);
  assert.match(compare, /50 options across the full collection/);
  assert.match(compare, /App Store: currently 100 Free and 500 total/);
  assert.match(terms, /complete collection available in your app version/);
  assert.match(terms, /Recipe counts may vary by app version/);
  for (const source of [landing, pricing, compare, terms, subscriptions]) assert.equal(transform700Presentation(source), source, 'already updated web copy and its App Store availability note stay stable');
});

test('the refreshed PWA install description preserves its existing app identity and launch route', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.id, './index.html');
  assert.equal(manifest.start_url, '/app');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.name, 'BasketBoss');
  assert.doesNotMatch(manifest.description, /Beta/i);
  assert.match(manifest.description, /200 free recipes/);
});

test('expanded catalogue copy offers supported breakfast and dessert planning without inventing starter slots', () => {
  const unsupported = /breakfast,\s*starters?\s+and\s+desserts?|optional starters?\s+and\s+dessert(?:s)?\s+(?:planning|slots)/i;
  for (const file of ['welcome.html', 'pricing-sandbox.html', 'compare.html']) {
    const source = read(file);
    assert.doesNotMatch(source, unsupported, file);
    assert.match(source, /(?:optional breakfast and dessert|Optional breakfast and dessert)/, file);
  }
  for (const file of ['index.html', 'app.html']) {
    const transformed = transform700Presentation(read(file));
    assert.doesNotMatch(transformed, unsupported, file);
    assert.match(transformed, /optional breakfast and dessert planning/);
  }
  assert.equal(transform700Presentation('100 starter recipes'), '200 starter recipes', 'starter collection terminology is independent from meal-type planner slots');
});
