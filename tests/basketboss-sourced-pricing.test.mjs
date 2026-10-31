import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const day = 86400000;
const shift = (date, days) => new Date(Date.parse(date) + days * day).toISOString().slice(0, 10);
const cents = n => Math.round((n + Number.EPSILON) * 100) / 100;
const observations = () => JSON.parse(read('supermarket-price-observations.json'));

function pricing(selected = {}) {
  const saved = new Map();
  const context = vm.createContext({
    BBSupermarkets: {getSelected: market => selected[market] ?? null},
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value)
    }
  });
  vm.runInContext(read('basketboss-aisles-v20.js'), context);
  vm.runInContext(read('basketboss-pricing-v19.js'), context);
  return context.BBPriceV19;
}

function request(row, extra = {}) {
  return {name: row.ingredient, unit: row.unit, market: row.market,
    retailer: row.retailer, asOf: row.retrieved_at, ...extra};
}

test('checked-in public price snapshots identify a product, shop, region and retrieval date', () => {
  const rows = observations();
  assert.ok(Array.isArray(rows) && rows.length >= 5);
  for (const row of rows) {
    assert.ok(row.ingredient && row.unit && row.retailer && row.market && row.product_name);
    assert.ok(row.pack_quantity > 0 && row.pack_price > 0);
    assert.match(row.source_url, /^https:\/\//);
    assert.match(row.retrieved_at, /^\d{4}-\d{2}-\d{2}(?:T.*)?$/);
    assert.ok(Number.isFinite(Date.parse(row.retrieved_at)));
    assert.equal(row.currency, row.market === 'US' ? 'USD' : 'GBP');
    assert.equal(row.price_type, 'standard');
    assert.equal(row.max_age_days, 14);
  }
});

test('same-region selected-shop source prices retain their exact pack price and provenance', () => {
  const api = pricing();
  for (const row of observations()) {
    const found = api.findSourcedPrice(request(row));
    assert.ok(found, row.ingredient);
    assert.equal(found.pack_price, row.pack_price);
    const quote = api.price(request(row, {quantity: row.pack_quantity}));
    assert.equal(quote.source, 'public_online_price');
    assert.equal(quote.priceKind, 'public_online');
    assert.equal(quote.packQty, row.pack_quantity);
    assert.equal(quote.packAmount, row.pack_price,
      'A sourced £3.59 pack must remain £3.59 rather than a rounded five-penny guide');
    assert.equal(quote.sourceRetailer, row.retailer);
    assert.equal(quote.sourceUrl, row.source_url);
    assert.equal(quote.sourceDate, row.retrieved_at);
    assert.equal(quote.productName, row.product_name);
  }
});

test('sourced pack quantity steps up the exact shelf-price cost at the boundary', () => {
  const api = pricing();
  for (const row of observations()) {
    const quantity = row.pack_quantity + (row.unit === 'each' ? 1 : .01);
    const quote = api.price(request(row, {quantity}));
    assert.equal(quote.packCount, 2, row.ingredient);
    assert.equal(quote.packAmount, cents(row.pack_price * 2), row.ingredient);
  }
});

test('public source snapshots expire after fourteen days and reject future retrieval dates', () => {
  const api = pricing();
  for (const row of observations()) {
    assert.ok(api.findSourcedPrice(request(row, {asOf: shift(row.retrieved_at, 14)})));
    for (const days of [-1, 15, 60]) {
      const req = request(row, {quantity: row.pack_quantity, asOf: shift(row.retrieved_at, days)});
      assert.equal(api.findSourcedPrice(req), null, `${row.ingredient}: age ${days}`);
      const quote = api.price(req);
      assert.equal(quote.priceKind, 'regional_estimate');
      assert.notEqual(quote.source, 'public_online_price');
    }
  }
});

test('a source price is never reused across regions, supermarkets or incompatible units', () => {
  const api = pricing();
  const row = observations()[0];
  for (const extra of [
    {market: 'Guernsey'}, {market: 'Jersey'}, {market: 'US'},
    {retailer: 'An unrelated supermarket'}, {retailer: null}, {unit: 'unsupported-unit'}
  ]) {
    assert.equal(api.findSourcedPrice(request(row, extra)), null, JSON.stringify(extra));
  }
});

test('unmatched selected-supermarket items and unselected shops retain regional fallback prices', () => {
  const api = pricing();
  const row = observations()[0];
  const quote = api.price(request(row, {quantity: row.pack_quantity, retailer: 'An unrelated supermarket'}));
  const unselected = api.price(request(row, {quantity: row.pack_quantity, retailer: null}));
  assert.equal(quote.priceKind, 'regional_estimate');
  assert.equal(unselected.priceKind, 'regional_estimate');
  assert.equal(quote.packAmount, unselected.packAmount);
  assert.ok(quote.packAmount > 0);
});

test('the saved regional supermarket supplies the default source while an explicit shop wins', () => {
  const row = observations()[0];
  const api = pricing({[row.market]: row.retailer});
  const implicit = api.price({name: row.ingredient, unit: row.unit, market: row.market,
    quantity: row.pack_quantity, asOf: row.retrieved_at});
  assert.equal(implicit.priceKind, 'public_online');
  assert.equal(implicit.sourceRetailer, row.retailer);
  const explicit = api.price(request(row, {quantity: row.pack_quantity, retailer: 'An unrelated supermarket'}));
  assert.equal(explicit.priceKind, 'regional_estimate');
});

test('personal shelf-price overrides take priority over public online sources', () => {
  const row = observations()[0];
  const api = pricing({[row.market]: row.retailer});
  api.setPriceOverride({name: row.ingredient, unit: row.unit, market: row.market, price: 7.13});
  const quote = api.price(request(row, {quantity: row.pack_quantity}));
  assert.equal(quote.priceKind, 'user_price');
  assert.equal(quote.source, 'user_shelf_price');
  assert.equal(quote.userOverride, true);
  assert.equal(quote.packAmount, 7.13);
  api.clearPriceOverride({name: row.ingredient, unit: row.unit, market: row.market});
  assert.equal(api.price(request(row, {quantity: row.pack_quantity})).priceKind, 'public_online');
});

test('sourced oil costs only the measured usage in a meal, while Shopping buys its bottle', () => {
  const row = observations().find(x => /oil/.test(x.ingredient));
  assert.ok(row);
  const api = pricing({[row.market]: row.retailer});
  const quote = api.price(request(row, {quantity: 15}));
  assert.equal(quote.priceKind, 'public_online');
  assert.equal(quote.packAmount, row.pack_price);
  assert.equal(quote.portionAmount, cents(15 / row.pack_quantity * row.pack_price));
  assert.ok(quote.portionAmount < quote.packAmount);
  const meal = api.estimateMeal({
    recipe: {id: 'oil-source', servings: 2},
    normalized: {id: 'oil-source', ingredients: [{key: row.ingredient, quantity: 5, unit: row.unit}]},
    servings: 6, market: row.market, retailer: row.retailer, asOf: row.retrieved_at
  });
  assert.equal(meal.amount, quote.portionAmount);
  assert.equal(meal.items[0].sourceUrl, row.source_url);
});

test('snapshot data and the runtime source index contain identical observations', () => {
  const api = pricing();
  assert.deepEqual(JSON.parse(JSON.stringify(api.sourcedPrices)), observations());
});

test('only valid standard-price records can enter the source resolver', () => {
  const api = pricing();
  const row = observations()[0];
  for (const change of [
    {pack_price: 0}, {pack_price: -1}, {pack_price: Number.NaN},
    {pack_quantity: 0}, {pack_quantity: -5}, {pack_quantity: Number.NaN},
    {currency: 'EUR'}, {source_url: ''}, {source_url: 'http://example.com/product'},
    {retrieved_at: 'not-a-date'}, {retrieved_at: null},
    {price_type: 'loyalty'}, {price_type: 'promotion'}, {price_type: 'member'}
  ]) {
    const found = api.findSourcedPrice(request(row, {observations: [{...row, ...change}]}));
    assert.equal(found, null, JSON.stringify(change));
  }
});

test('a malformed snapshot cannot extend the fourteen-day freshness window', () => {
  const api = pricing();
  const row = observations()[0];
  assert.equal(api.findSourcedPrice(request(row, {
    asOf: shift(row.retrieved_at, 15), observations: [{...row, max_age_days: 365}]
  })), null);
});

test('the most recently checked eligible standard product wins over older prices and promotions', () => {
  const api = pricing();
  const row = observations()[0];
  const recent = {...row, retrieved_at: shift(row.retrieved_at, 1), pack_price: 2.67};
  const promotion = {...row, retrieved_at: shift(row.retrieved_at, 2), pack_price: .01, price_type: 'promotion'};
  const found = api.findSourcedPrice(request(row, {
    asOf: shift(row.retrieved_at, 2), observations: [row, promotion, recent]
  }));
  assert.equal(found, recent);
});

test('ingredient aliases and compatible metric units reuse the source without changing quantities', () => {
  const api = pricing();
  const row = observations().find(x => x.unit === 'g' && x.ingredient_aliases?.length);
  assert.ok(row);
  const quote = api.price(request(row, {
    name: row.ingredient_aliases[0], unit: 'kg', quantity: row.pack_quantity / 1000
  }));
  assert.equal(quote.source, 'public_online_price');
  assert.equal(quote.packCount, 1);
  assert.equal(quote.packAmount, row.pack_price);
});
