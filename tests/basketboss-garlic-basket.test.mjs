import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function harness(entry = 'index.html') {
  const html = read(entry), context = vm.createContext({Intl});
  for (const file of ['basketboss-aisles-v20.js', 'basketboss-pricing-v19.js']) vm.runInContext(read(file), context);
  for (const name of ['RECIPES', 'BB307_NORMALIZED']) {
    const declaration = html.match(new RegExp('^const ' + name + '=.*;$', 'm'));
    assert.ok(declaration, entry + ': actual catalogue declaration is present');
    vm.runInContext(declaration[0], context);
  }
  const start = html.indexOf('const bb307EstimateBasket=(()=>{');
  const end = html.indexOf('\nconst BB307Pantry=', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end), context);
  vm.runInContext('this.recipes=RECIPES;this.normalized=BB307_NORMALIZED;this.basket=bb307EstimateBasket;', context);
  return {html, context, pricing: context.BBPriceV19, recipes: context.recipes, normalized: context.normalized,
    basket: (selections, market = 'Guernsey') => context.basket({selections, market, recipes: context.recipes, normalized: context.normalized})};
}

test('legacy Garlic each resolves only from a unique explicit matching source label', () => {
  const {pricing: p} = harness();
  const ingredient = Object.freeze({key: 'garlic', quantity: 3, unit: 'each'});
  const resolve = lines => p.recipeIngredientUnit(ingredient, lines);
  assert.equal(resolve([['Garlic', '3 cloves']]), 'clove');
  assert.equal(resolve([['Garlic clove', '1 clove']]), 'clove');
  assert.equal(resolve([['Garlic', '1 bulb']]), 'bulb');
  for (const lines of [undefined, [], [['Garlic', '3 each']], [['Garlic', '1 bulb (10 cloves)']],
    [['Garlic', '3 cloves'], ['Garlic', '1 bulb']], [['Garlic powder', '3 cloves']]]) {
    assert.equal(resolve(lines), 'each', JSON.stringify(lines));
  }
  assert.equal(p.recipeIngredientUnit({...ingredient, unit: 'g'}, [['Garlic', '3 cloves']]), 'g');
  assert.equal(p.recipeIngredientUnit({...ingredient, key: 'onion'}, [['Onion', '3 cloves']]), 'each');
  assert.deepEqual(ingredient, {key: 'garlic', quantity: 3, unit: 'each'});
});

// Reproduce the reported five-day quantities before purchase rounding:
// .5 + 1 + 1 + 2 cloves, plus creamy-pasta's legacy 1.5 'each', equals 6 cloves.
const planned = [
  {day: 'Tuesday', recipeId: 'salmon', servings: 1},
  {day: 'Wednesday', recipeId: 'creamy-pasta', servings: 2},
  {day: 'Thursday', recipeId: 'beef-chilli', servings: 3},
  {day: 'Friday', recipeId: 'tuscan-salmon', servings: 1},
  {day: 'Saturday', recipeId: 'pulled-pork', servings: 4}
];

for (const entry of ['index.html', 'app.html']) test(entry + ': real basket merges source-proven Garlic cloves before full-pack pricing', () => {
  const h = harness(entry), before = JSON.stringify(h.normalized);
  const selections = planned.map(slot => ({id: slot.recipeId, servings: slot.servings}));
  for (const market of ['UK', 'Guernsey', 'Jersey', 'US']) {
    const result = h.basket(selections, market);
    const garlic = result.items.filter(item => h.pricing.canonical(item.key) === 'garlic');
    assert.equal(garlic.length, 1, market + ': one Garlic row');
    assert.equal(garlic[0].unit, 'clove');
    assert.equal(garlic[0].required, 6, 'fractional needs sum before rounding to a purchase');
    assert.equal(garlic[0].toBuy, 6);
    assert.equal(garlic[0].sharedAcrossRecipes, 5);
    const expected = h.pricing.price({name: 'garlic', quantity: 6, unit: 'clove', market});
    assert.equal(garlic[0].spend, expected.packAmount);
    assert.equal(garlic[0].sourcePackCount, 1, 'one bulb pack charged once');
    assert.equal(garlic[0].quantityBought, expected.packQty);
  }
  assert.equal(JSON.stringify(h.normalized), before, 'saved catalogue amounts are not rewritten');
});

for (const entry of ['index.html', 'app.html']) test(entry + ': source day details use the same Garlic unit as basket aggregation', () => {
  const h = harness(entry), {context: ctx, html} = h;
  Object.assign(ctx, {
    state: {planned},
    getRecipe: id => h.recipes.find(recipe => recipe.id === id),
    bb176AllowedRecipe: () => true,
    bbBatchPairs: () => [], bbBatchPairFor: () => null,
    BBServing: {forMeal: (_state, slot) => slot.servings, ratio: (servings, recipe) => servings / recipe.servings},
    BB307Pantry: {pantryId: (key, unit) => h.pricing.canonical(key) + '|' + unit}
  });
  const start = html.indexOf('function bb321ShoppingSources(){');
  const end = html.indexOf('\nfunction bb321UsedInLine(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end), ctx);
  const sources = ctx.bb321ShoppingSources(), cloves = sources.get('garlic|clove');
  assert.equal(sources.has('garlic|each'), false);
  assert.equal(cloves.length, 5);
  assert.equal(cloves.reduce((sum, source) => sum + source.qty, 0), 6);
  assert.deepEqual(plain(cloves.map(source => source.day)), planned.map(slot => slot.day));
  assert.equal(cloves.find(source => source.day === 'Wednesday').unit, 'clove');
});

test('source-proven whole Garlic bulbs remain separate from cloves without guessing a conversion', () => {
  const h = harness();
  const result = h.basket([{id: 'creamy-pasta', servings: 2}, {id: 'tomato-mozzarella-pasta', servings: 4}]);
  const garlic = result.items.filter(item => h.pricing.canonical(item.key) === 'garlic');
  assert.equal(garlic.length, 2);
  assert.equal(garlic.find(item => item.unit === 'clove').required, 1.5);
  assert.equal(garlic.find(item => item.unit === 'bulb').required, 1);
  assert.ok(result.unresolved.some(item => item.ingredient === 'garlic' && item.status.startsWith('MIXED_UNITS_REQUIRE_MANUAL_REVIEW')));
});

test('meal estimates use source-proven cloves while keeping explicit bulb quantities intact', () => {
  const h = harness();
  for (const [id, unit, quantity] of [['creamy-pasta', 'clove', 1.5], ['tomato-mozzarella-pasta', 'bulb', .5]]) {
    const recipe = h.recipes.find(item => item.id === id), normalized = h.normalized.find(item => item.id === id);
    const result = h.pricing.estimateMeal({recipe, normalized, servings: 2, market: 'UK'});
    const garlic = result.items.find(item => h.pricing.canonical(item.name) === 'garlic');
    assert.equal(garlic.unit, unit);
    assert.equal(garlic.quantity, quantity);
  }
});
