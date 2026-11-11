import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const policy = require('../bb-pantry-policy.js');
const ui = require('../bb-shop-purchase-ui.js');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const catalog = JSON.parse(read('ingredient-pack-catalog.json'));
const names = ['prepared coleslaw', 'cabbage slaw'];
const plain = value => JSON.parse(JSON.stringify(value));

function harness(market = 'Guernsey') {
  const context = vm.createContext({bb307Market: market, BBPantryPolicy: policy, BBShopPurchaseUI: ui});
  context.window = context;
  vm.runInContext(read('basketboss-pricing-v19.js'), context);
  const source = read('app.html');
  for (const name of ['bb84DisplayedPurchase', 'bbShopPurchasePack', 'bbShopPurchaseBase', 'bbShopPurchaseRecommended']) {
    const start = source.indexOf('function ' + name + '('), end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, name);
    vm.runInContext(source.slice(start, end + 2), context);
  }
  const item = (name, quantity, unit = 'g') => ({id: name + '|' + unit, name, basketItem: {key: name, unit, required: quantity, toBuy: quantity, priceQuote: context.BBPriceV19.price({name, quantity, unit, market})}});
  return {api: context.BBPriceV19, context, item};
}

test('UI recommendations leave the loaded price table and source files unchanged', () => {
  const {api, context, item} = harness(), before = plain(api.catalog);
  const files = ['ingredient-pack-catalog.json', 'basketboss-pricing-v19.js'].map(file => [file, read(file)]);
  for (const name of names) context.bbShopPurchaseRecommended(item(name, 200), 200);
  assert.deepEqual(plain(api.catalog), before);
  for (const [file, source] of files) assert.equal(read(file), source);
});

test('runtime packs and regional guides retain exact checked-in catalogue parity', () => {
  const {api} = harness();
  assert.deepEqual(plain(api.catalog), catalog.ingredients);
  assert.deepEqual(plain(api.regionalMarkets), catalog.metadata.regional_markets);
  for (const name of names) assert.equal(api.getPack(name, 'g', 'Guernsey').standard_pack_size, catalog.ingredients[name + '|g'].standard_pack_size);
});

test('a 200 g coleslaw requirement recommends one 300 g tub in the UI without repricing the base guide', () => {
  for (const market of ['UK', 'Guernsey', 'Jersey']) {
    const {api, context, item} = harness(market), before = JSON.stringify(api.catalog);
    for (const name of names) {
      for (const [needed, expectedCount] of [[200, 1], [300, 1], [301, 2]]) {
        const row = item(name, needed), original = JSON.stringify(row), baseQuote = plain(row.basketItem.priceQuote);
        const recommendation = context.bbShopPurchaseRecommended(row, needed);
        assert.equal(recommendation.unit, 'g');
        assert.equal(recommendation.packQuantity, 300);
        assert.equal(recommendation.packCount, expectedCount);
        assert.equal(recommendation.quantity, 300 * expectedCount);
        assert.equal(recommendation.label, 'tub');
        assert.equal(ui.buyingLabel(recommendation, row.name), expectedCount === 1 ? 'Buying: 300 g tub' : 'Buying: 2 × 300 g tubs');
        assert.equal(JSON.stringify(row), original, 'the recommendation cannot replace recipe requirements or base prices');
        assert.deepEqual(plain(api.price({name, quantity: needed, unit: 'g', market})), baseQuote);
      }
    }
    assert.equal(JSON.stringify(api.catalog), before);
  }
});

test('UI tub recommendations do not rewrite the original physical purchase calculator', () => {
  const {api, context, item} = harness();
  for (const name of names) {
    const row = item(name, 200), quote = row.basketItem.priceQuote;
    const catalogSize = api.getPack(name, 'g', 'Guernsey').standard_pack_size;
    assert.equal(context.bb84DisplayedPurchase(row.basketItem, 200), catalogSize);
    assert.equal(context.bbShopPurchaseRecommended(row, 200).quantity, 300);
    assert.equal(context.bb84DisplayedPurchase({...row.basketItem, buyMultiple: 250, buyMultipleUnit: 'g'}, 200), 250);
    assert.equal(context.bb84DisplayedPurchase({...row.basketItem, buyMultiple: 500, buyMultipleUnit: 'g'}, 200), 500);
    assert.equal(context.bb84DisplayedPurchase(row.basketItem, 0), 0);
    assert.equal(row.basketItem.required, 200);
    assert.equal(row.basketItem.toBuy, 200);
    assert.equal(row.basketItem.priceQuote, quote);
  }
});

test('the unchanged row price is the visible default baseline and selected multiples scale only the UI estimate', () => {
  const {api, context, item} = harness(), before = plain(api.catalog);
  for (const name of names) for (const needed of [200, 600]) {
    const row = item(name, needed), basePrice = row.basketItem.priceQuote.amount;
    const current = context.bbShopPurchaseRecommended(row, needed), original = JSON.stringify(row);
    assert.equal(ui.estimatePrice(basePrice, current.quantity, null), basePrice, 'no buying override retains the original row cost');
    assert.equal(ui.estimatePrice(basePrice, current.quantity, current), basePrice, 'saving the current visible default cannot change its price');
    const doubled = {...current, packCount: current.packCount * 2, quantity: current.quantity * 2, boughtQtyOverride: current.quantity * 2};
    assert.equal(ui.estimatePrice(basePrice, current.quantity, doubled), basePrice * 2);
    assert.equal(ui.estimatePrice(basePrice, current.quantity, {...doubled, priceOverride: 3.25}), 3.25);
    assert.equal(JSON.stringify(row), original);
  }
  assert.deepEqual(plain(api.catalog), before);
});

test('garlic UI names its one-bulb guide while keeping all ten canonical cloves and prices', () => {
  const {api, context, item} = harness(), before = JSON.stringify(api.catalog);
  for (const unit of ['each', 'clove']) {
    const entry = catalog.ingredients['garlic|' + unit], row = item('garlic', 4, unit), original = JSON.stringify(row);
    assert.equal(entry.standard_pack_size, 10);
    assert.equal(entry.standard_pack_unit, unit);
    assert.equal(entry.source, 'bulb_average_10_cloves_review');
    const recommendation = context.bbShopPurchaseRecommended(row, 4);
    assert.equal(recommendation.quantity, 10);
    assert.equal(recommendation.packQuantity, 10);
    assert.equal(recommendation.packCount, 1);
    assert.equal(recommendation.label, 'bulb');
    assert.equal(ui.buyingLabel(recommendation, 'Garlic'), 'Buying: 1 bulb');
    assert.equal(context.bb84DisplayedPurchase(row.basketItem, 4), 10);
    assert.equal(JSON.stringify(row), original);
  }
  const bulb = api.getPack('garlic', 'bulb', 'Guernsey');
  assert.equal(bulb.standard_pack_size, 1);
  assert.equal(bulb.standard_pack_unit, 'bulb');
  assert.equal(JSON.stringify(api.catalog), before);
});

test('count-only coleslaw and garlic preparations are not converted into tub grams or whole bulbs', () => {
  const {context, item} = harness();
  const count = context.bbShopPurchaseRecommended(item('coleslaw', 1, 'each'), 1);
  assert.equal(count.unit, 'each');
  assert.equal(count.quantity, 1);
  for (const name of ['garlic powder', 'garlic bread', 'garlic sauce']) assert.notEqual(context.bbShopPurchaseRecommended(item(name, 4), 4)?.label, 'bulb');
  assert.equal(catalog.ingredients['coleslaw|each'].standard_pack_size, 1);
  assert.equal(Object.hasOwn(catalog.ingredients, 'coleslaw|g'), false);
  const overlay = JSON.parse(read('catalogues/700/release/pack-additions.json'));
  for (const name of names) assert.equal(Object.hasOwn(overlay, name + '|g'), false);
});
