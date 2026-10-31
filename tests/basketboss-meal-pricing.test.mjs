import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const recipes = JSON.parse(read('recipes.json'));
const normalized = JSON.parse(read('normalized-ingredient-database.json')).recipes;
const markets = ['UK', 'Jersey', 'Guernsey', 'US'];
const cents = n => Math.round((n + Number.EPSILON) * 100) / 100;

function pricing() {
  const saved = new Map();
  const context = vm.createContext({
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value)
    }
  });
  vm.runInContext(read('basketboss-aisles-v20.js'), context);
  vm.runInContext(read('basketboss-pricing-v19.js'), context);
  return context.BBPriceV19;
}

function fixture(ingredients, servings = 2) {
  return {
    recipe: {
      id: 'quantity-regression', servings, cost: 5.49,
      ingredients: ingredients.map(x => [x.name, `${x.quantity} ${x.unit}`, 1, 'Other'])
    },
    normalized: {
      id: 'quantity-regression', servings,
      ingredients: ingredients.map(x => ({...x, key: x.name, status: 'PARSED'}))
    }
  };
}

test('scaling two portions to five or six buys one pesto jar and one potato bag', () => {
  const api = pricing();
  const data = fixture([
    {name: 'pesto', quantity: 40, unit: 'g'},
    {name: 'potato', quantity: 500, unit: 'g'}
  ]);
  const base = api.estimateMeal({...data, servings: 2, market: 'UK'});
  for (const servings of [5, 6]) {
    const result = api.estimateMeal({...data, servings, market: 'UK'});
    assert.equal(result.unpriced, 0);
    assert.equal(result.amount, base.amount,
      'Scaling required grams within existing packs must not multiply full-pack prices');
    for (const source of data.normalized.ingredients) {
      const quantity = source.quantity / 2 * servings;
      const quote = api.price({...source, quantity, market: 'UK'});
      assert.equal(quote.packCount, 1, `${source.name}: ${quantity} g fits one pack`);
    }
  }
});

test('protein packs step up only after their regional quantity boundary', () => {
  const api = pricing();
  for (const market of markets) {
    for (const [name, unit] of [
      ['lean beef mince', 'g'], ['salmon fillets', 'each'], ['sausages', 'each']
    ]) {
      const pack = api.getPack(name, unit, market);
      const one = api.price({name, unit, quantity: pack.standard_pack_size, market});
      const two = api.price({name, unit, quantity: pack.standard_pack_size + .01, market});
      assert.equal(one.packCount, 1, `${market} ${name}: exact pack boundary`);
      assert.equal(two.packCount, 2, `${market} ${name}: amount just over boundary`);
      assert.ok(two.packAmount > one.packAmount);
      const data = fixture([{name, unit, quantity: pack.standard_pack_size}], 2);
      const six = api.estimateMeal({...data, servings: 6, market});
      assert.equal(six.amount,
        api.price({name, unit, quantity: pack.standard_pack_size * 3, market}).packAmount,
        `${market} ${name}: six portions need three ingredient packs`);
    }
  }
});

test('oil, flour, spices, stock and condiments use fractional meal costs', () => {
  const api = pricing();
  for (const market of markets) {
    for (const ingredient of [
      {name: 'cooking oil', quantity: 5, unit: 'ml'},
      {name: 'plain flour', quantity: 10, unit: 'g'},
      {name: 'paprika', quantity: 1, unit: 'g'},
      {name: 'chicken stock', quantity: 50, unit: 'ml'},
      {name: 'soy sauce', quantity: 5, unit: 'ml'}
    ]) {
      const data = fixture([ingredient]);
      const result = api.estimateMeal({...data, servings: 6, market});
      const quote = api.price({...ingredient, quantity: ingredient.quantity * 3, market});
      assert.equal(result.amount, quote.portionAmount,
        `${market} ${ingredient.name} must cost only the amount used`);
      assert.ok(result.amount > 0 && result.amount < quote.packAmount,
        `${market} ${ingredient.name} must not charge a full container`);
    }
  }
});

test('beef hash estimate includes the required beef even if its editorial cost is too low', () => {
  const api = pricing();
  const data = fixture([
    {name: 'lean beef mince', quantity: 500, unit: 'g'},
    {name: 'potato', quantity: 800, unit: 'g'},
    {name: 'cooking oil', quantity: 15, unit: 'ml'}
  ], 4);
  data.recipe.cost = 3.66; // Old linear estimate would display £5.49 for six.
  const result = api.estimateMeal({...data, servings: 6, market: 'UK'});
  const beef = api.price({name: 'lean beef mince', unit: 'g', quantity: 750, market: 'UK'});
  assert.equal(beef.packCount, 2);
  assert.ok(result.amount >= beef.packAmount);
  assert.ok(result.amount > 5.49);
  data.recipe.cost = 9999;
  assert.equal(api.estimateMeal({...data, servings: 6, market: 'UK'}).amount, result.amount,
    'Editorial recipe totals cannot influence ingredient-based meal estimates');
});

test('real sausage and salmon meals retain shared packs as servings increase', () => {
  const api = pricing();
  for (const id of ['traybake-sausage', 'pesto-salmon-potatoes']) {
    const recipe = recipes.find(x => x.id === id);
    const normal = normalized.find(x => x.id === id);
    assert.ok(recipe && normal);
    const amounts = [2, 5, 6].map(servings =>
      api.estimateMeal({recipe, normalized: normal, servings, market: 'UK'}));
    assert.ok(amounts.every(x => x.unpriced === 0 && x.amount > 0));
    assert.ok(amounts[2].amount >= amounts[1].amount);
    assert.ok(amounts[2].amount < amounts[0].amount * 3,
      `${id}: a six-portion meal must share pantry and vegetable packs`);
    const potatoes = normal.ingredients.find(x => x.key === 'potato');
    assert.equal(api.price({name: potatoes.key, unit: potatoes.unit,
      quantity: potatoes.quantity / recipe.servings * 6, market: 'UK'}).packCount, 1);
  }
});

test('every supported region resolves its own pack size, price and currency', () => {
  const api = pricing();
  for (const market of markets) {
    const pack = api.getPack('potato', 'g', market);
    assert.ok(pack.standard_pack_size > 0);
    assert.ok(pack.pack_price > 0);
    const result = api.price({name: 'potato', unit: 'g', quantity: pack.standard_pack_size, market});
    assert.equal(result.packQty, pack.standard_pack_size);
    assert.equal(result.currency, market === 'US' ? '$' : '£');
    assert.equal(api.money(result.packAmount, market)[0], result.currency);
  }
  const uk = api.getPack('potato', 'g', 'UK');
  const us = api.getPack('potato', 'g', 'US');
  assert.notEqual(us.standard_pack_size, uk.standard_pack_size,
    'US grocery pack quantities must not silently reuse UK packs');
  assert.notEqual(us.pack_price, uk.pack_price);
});

test('local shelf-price overrides use regional pack sizes and stay in their region', () => {
  const api = pricing();
  const request = {name: 'potato', unit: 'g'};
  const usBefore = api.price({...request, quantity: 1000, market: 'US'});
  api.setPriceOverride({...request, market: 'UK', price: 3.17});
  const ukPack = api.getPack(request.name, request.unit, 'UK');
  assert.equal(api.getPriceOverride(ukPack, 'UK'), 3.17);
  const uk = api.price({...request, quantity: ukPack.standard_pack_size + 1, market: 'UK'});
  assert.equal(uk.packAmount, 6.34);
  assert.equal(uk.userOverride, true);
  assert.equal(api.price({...request, quantity: 1000, market: 'US'}).packAmount, usBefore.packAmount);
  api.setPriceOverride({...request, market: 'US', price: 4.29});
  const usPack = api.getPack(request.name, request.unit, 'US');
  assert.equal(api.getPriceOverride(usPack, 'US'), 4.29);
  assert.equal(api.price({...request, quantity: usPack.standard_pack_size, market: 'US'}).packAmount, 4.29);
  api.clearPriceOverride({...request, market: 'US'});
  assert.equal(api.getPriceOverride(usPack, 'US'), null);
  assert.equal(api.getPriceOverride(ukPack, 'UK'), 3.17);
});

test('meal totals reconcile to ingredient costs without accumulating rounded pack multipliers', () => {
  const api = pricing();
  const data = fixture([
    {name: 'pesto', quantity: 40, unit: 'g'},
    {name: 'salmon fillets', quantity: 2, unit: 'each'},
    {name: 'soy sauce', quantity: 10, unit: 'ml'}
  ]);
  for (const market of markets) {
    const actual = api.estimateMeal({...data, servings: 6, market});
    const expected = cents(
      api.price({name: 'pesto', unit: 'g', quantity: 120, market}).packAmount +
      api.price({name: 'salmon fillets', unit: 'each', quantity: 6, market}).packAmount +
      api.price({name: 'soy sauce', unit: 'ml', quantity: 30, market}).portionAmount);
    assert.equal(actual.amount, expected, market);
  }
});

test('repeated ingredient lines share packs after compatible units are converted', () => {
  const api = pricing();
  const data = fixture([
    {name: 'potato', quantity: .4, unit: 'kg'},
    {name: 'potato', quantity: 500, unit: 'g'}
  ]);
  const result = api.estimateMeal({...data, servings: 4, market: 'UK'});
  const together = api.price({name: 'potato', unit: 'g', quantity: 1800, market: 'UK'});
  assert.equal(together.packCount, 1);
  assert.equal(result.amount, together.packAmount,
    'Ingredients split between preparation steps must not buy the same bag twice');
});

test('missing ingredient quantities produce an unavailable estimate rather than a cheap partial meal', () => {
  const api = pricing();
  const data = fixture([
    {name: 'lean beef mince', quantity: null, unit: 'g'},
    {name: 'potato', quantity: 800, unit: 'g'}
  ]);
  const result = api.estimateMeal({...data, servings: 6, market: 'UK'});
  assert.equal(result.amount, null);
  assert.equal(result.unpriced, 1);
  assert.equal(api.estimateMeal({recipe: data.recipe, servings: 6, market: 'UK'}).amount, null);
});

test('many tiny staple costs reconcile to displayed ingredient rows in every region', () => {
  const api = pricing();
  const data = fixture([
    {name: 'cooking oil', quantity: 5, unit: 'ml'},
    {name: 'olive oil', quantity: 5, unit: 'ml'},
    {name: 'sesame oil', quantity: 5, unit: 'ml'},
    {name: 'plain flour', quantity: 1, unit: 'g'},
    {name: 'cornflour', quantity: 1, unit: 'g'}
  ]);
  for (const market of markets) {
    for (const servings of [1, 2, 5, 6, 12]) {
      const result = api.estimateMeal({...data, servings, market});
      assert.equal(result.unpriced, 0);
      assert.equal(result.amount, cents(result.items.reduce((sum, item) => sum + item.amount, 0)),
        `${market}, ${servings} portions: total must match displayed ingredient pennies`);
      assert.ok(result.items.every(item => item.amount >= 0));
    }
  }
});

test('splitting a few pennies among repeated ingredient lines never creates a negative cost', () => {
  const api = pricing();
  const data = fixture(Array.from({length: 8}, () =>
    ({name: 'cooking oil', quantity: 2.5, unit: 'ml'})));
  for (const market of markets) {
    const result = api.estimateMeal({...data, servings: 2, market});
    assert.ok(result.items.every(item => item.amount >= 0), market);
    assert.equal(result.amount, cents(result.items.reduce((sum, item) => sum + item.amount, 0)));
  }
});

test('runtime pack and regional guides exactly match the checked-in catalog', () => {
  const api = pricing();
  const catalog = JSON.parse(read('ingredient-pack-catalog.json'));
  assert.deepEqual(JSON.parse(JSON.stringify(api.catalog)), catalog.ingredients);
  assert.deepEqual(JSON.parse(JSON.stringify(api.regionalMarkets)), catalog.metadata.regional_markets);
});

test('ground meat and dried meal ingredients are not mistaken for pantry spices', () => {
  const api = pricing();
  for (const name of ['ground beef', 'dried lentils', 'dried egg noodles', 'dried apricots']) {
    assert.equal(api.isPantryStaple(name, 'g'), false, name);
    const data = fixture([{name, quantity: 100, unit: 'g'}]);
    const quote = api.price({name, quantity: 100, unit: 'g', market: 'UK'});
    assert.equal(api.estimateMeal({...data, servings: 2, market: 'UK'}).amount, quote.packAmount, name);
  }
});
