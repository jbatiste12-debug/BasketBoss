import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const recipes = JSON.parse(read('recipes.json'));
const normalized = JSON.parse(read('normalized-ingredient-database.json')).recipes;
const recipe = id => recipes.find(row => row.id === id);
const ingredient = (id, name) => normalized.find(row => row.id === id).ingredients.find(row => row.name === name);
const accepted = [
  'creamy-pasta', 'lemon-chicken-orzo', 'mushroom-risotto', 'sweet-potato-soup',
  'spinach-ricotta-shells', 'sausage-lentil-stew', 'chicken-noodle-soup',
  'chicken-katsu-curry', 'aubergine-parmigiana', 'miso-salmon-rice',
  'family-chicken-wraps', 'extra-15-minute-pesto-tortellini', 'extra-lentil-shepherdless-pie'
];

function basketHarness(entry) {
  const html = read(entry), context = vm.createContext({ Intl });
  for (const file of ['basketboss-aisles-v20.js', 'basketboss-pricing-v19.js']) vm.runInContext(read(file), context);
  const start = html.indexOf('const bb307EstimateBasket=(()=>{');
  const end = html.indexOf('// BasketBoss 321 v7 original-design', start);
  assert(start !== -1 && end > start, 'shopping and pantry functions are present');
  vm.runInContext(html.slice(start, end) + ';this.basket=bb307EstimateBasket;this.pantry=BB307Pantry;', context);
  return context;
}

for (const entry of ['app.html', 'index.html']) {
  test(entry + ': accepted recipe-use amounts merge and credit UK/US pantry stock before pack rounding', () => {
    const context = basketHarness(entry);
    for (const market of ['UK', 'US']) {
      const pantry = { 'parmesan|g': 100, 'stock|ml': 500, 'pasta shells|g': 100 };
      const before = JSON.stringify(pantry);
      const result = context.basket({ market, recipes, normalized, pantry, selections: [
        { id: 'creamy-pasta', servings: 2 },
        { id: 'mushroom-risotto', servings: 4 },
        { id: 'aubergine-parmigiana', servings: 4 },
        { id: 'sausage-lentil-stew', servings: 4 },
        { id: 'chicken-noodle-soup', servings: 2 },
        { id: 'spinach-ricotta-shells', servings: 2 }
      ] });
      const parmesan = result.items.filter(row => row.key === 'parmesan');
      assert.equal(parmesan.length, 1, 'three measured cheese uses must not create an each/gram duplicate');
      assert.equal(parmesan[0].unit, 'g');
      assert.equal(parmesan[0].required, 150, '40 g half-pasta + 60 g risotto + 50 g parmigiana');
      assert.equal(parmesan[0].pantryUsed, 100);
      assert.equal(parmesan[0].toBuy, 50);
      const stock = result.items.filter(row => row.key === 'stock');
      assert.equal(stock.length, 1, 'prepared stock uses must not leave carton/each duplicates');
      assert.equal(stock[0].unit, 'ml');
      assert.equal(stock[0].required, 1750, '1000 ml stew + 750 ml half-soup');
      assert.equal(stock[0].pantryUsed, 500);
      assert.equal(stock[0].toBuy, 1250);
      const shells = result.items.filter(row => row.key === 'pasta shells');
      assert.equal(shells.length, 1, 'large-shell preparation must retain the existing pantry identity');
      assert.equal(shells[0].required, 125);
      assert.equal(shells[0].pantryUsed, 100);
      assert.equal(shells[0].toBuy, 25);
      assert.equal(JSON.stringify(pantry), before, 'shopping estimation must preserve saved pantry stock');
      assert(!result.unresolved.some(row => /parmesan|stock|pasta shells/.test(row.ingredient) && /^MIXED_UNITS/.test(row.status)));
    }
  });
}

test('measured stock and Parmesan recommendations have explicit source-aligned units and resolved ambiguity', () => {
  for (const [id, name, quantity, unit] of [
    ['creamy-pasta', 'Parmesan', 80, 'g'],
    ['lemon-chicken-orzo', 'Chicken stock', 1200, 'ml'],
    ['mushroom-risotto', 'Vegetable stock', 1000, 'ml'],
    ['mushroom-risotto', 'Parmesan', 60, 'g'],
    ['sweet-potato-soup', 'Vegetable stock', 1000, 'ml'],
    ['sausage-lentil-stew', 'Stock', 1000, 'ml'],
    ['chicken-noodle-soup', 'Stock', 1500, 'ml'],
    ['aubergine-parmigiana', 'Parmesan', 50, 'g'],
    ['extra-lentil-shepherdless-pie', 'Vegetable stock', 600, 'ml']
  ]) {
    const row = ingredient(id, name), source = recipe(id).ingredients.find(line => line[0] === name);
    assert.equal(row.quantity, quantity, id + ': amount');
    assert.equal(row.unit, unit, id + ': unit');
    assert.equal(source[1], quantity + ' ' + unit, id + ': source amount');
    assert.equal(row.needs_review, false, id + ': resolved pack ambiguity');
    assert.equal(row.status, 'PARSED');
    assert(!row.unit_assumption, 'old unspecified-pack assumption must be removed');
  }
});

test('recipe-use estimates follow existing unit rates and source totals add up', () => {
  const parmesanRate = recipe('extra-15-minute-pesto-tortellini').ingredients.find(line => line[0] === 'Parmesan')[2] / 50;
  for (const id of ['creamy-pasta', 'mushroom-risotto', 'aubergine-parmigiana']) {
    const line = recipe(id).ingredients.find(line => line[0] === 'Parmesan');
    assert.equal(line[2], Math.round(ingredient(id, 'Parmesan').quantity * parmesanRate * 100) / 100);
  }
  assert.equal(recipe('spinach-ricotta-shells').ingredients[0][2], 0.89, '250 g uses half the former 500 g £1.77 estimate, rounded to pennies');
  for (const id of accepted) {
    const row = recipe(id);
    assert.equal(row.cost, Math.round(row.ingredients.reduce((sum, line) => sum + line[2], 0) * 100) / 100, id + ': ingredient cost total');
    assert.deepEqual(row.steps, row.method);
    assert.equal(row.culinary_prep_notes.length, row.ingredients.length);
    assert.deepEqual(row.ingredient_display_lines, row.ingredients.map(line => line[0] + ' — ' + line[1]), id + ': ingredient display copy');
    for (const estimate of Object.values(row.ci_estimates || {})) {
      assert(estimate.range_low_gbp <= estimate.estimate_gbp && estimate.estimate_gbp <= estimate.range_high_gbp, id + ': indicative cost range');
      assert.equal(estimate.per_serving_estimate_gbp, Math.round(estimate.estimate_gbp / row.servings * 100) / 100, id + ': regional cost per serving');
    }
  }
});

test('oven routes give settings, cooking windows and completion checks without unlisted frying fat', () => {
  for (const id of ['chicken-katsu-curry', 'miso-salmon-rice', 'family-chicken-wraps']) {
    const method = recipe(id).method.join(' ');
    assert.match(method, /200°C \(180°C fan\)/, id);
    assert.match(method, /bake for (?:about )?\d+[–-]\d+ minutes/i, id);
    assert.match(method, /thickest/);
    assert.doesNotMatch(method, /shallow-fry|pan-fry|grill/);
    assert.doesNotMatch(method, /\b\d+\s*(?:g|ml)\b/, 'whole-recipe quantities stay in the scalable ingredient list');
  }
  const wraps = recipe('family-chicken-wraps').method.join(' ');
  assert.match(wraps, /three quarters of the Caesar dressing/);
  assert.match(wraps, /remaining quarter of the dressing/);
  assert.match(wraps, /separate.*reserved dressing/);
  const pie = recipe('extra-lentil-shepherdless-pie');
  assert.equal(pie.mins, 65);
  assert.match(pie.method.join(' '), /As soon as the lentils are simmering.*potatoes/);
  assert.match(pie.method.join(' '), /fully tender/);
  assert.match(pie.method.join(' '), /older lentils may need extra simmering time/i);
  assert.equal(recipe('extra-15-minute-pesto-tortellini').name, '20-minute pesto tortellini');
  assert.equal(recipe('extra-15-minute-pesto-tortellini').mins, 20);
});
