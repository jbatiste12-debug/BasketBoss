import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const storageKey = 'basketboss_ui_next_local_shelf_prices_v1';
const item = {name: 'rice', unit: 'g', market: 'UK'};

function pricing({selected = {UK: 'Aldi'}, saved = new Map()} = {}) {
  let writes = 0;
  const context = vm.createContext({
    BBSupermarkets: {getSelected: market => selected[market] ?? null},
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => {writes++; saved.set(key, value);}
    }
  });
  vm.runInContext(read('basketboss-aisles-v20.js'), context);
  vm.runInContext(read('basketboss-pricing-v19.js'), context);
  return {api: context.BBPriceV19, saved, selected, writes: () => writes};
}

const baseKey = (entry, market) =>
  [market, entry.ingredient, entry.standard_pack_size, entry.standard_pack_unit].join('|');

test('a usual brand and pack price persist and appear as the user’s own price', () => {
  const h = pricing();
  h.api.setPriceOverride({...item, price: 2.39, brand: '  Tilda Easy Cook  '});
  const entry = h.api.getPack(item.name, item.unit, item.market);
  const product = h.api.getProductOverride(entry, item.market);
  assert.equal(product.price, 2.39);
  assert.equal(product.brand, 'Tilda Easy Cook');
  assert.ok(Number.isFinite(Date.parse(product.updatedAt)));
  assert.equal(h.api.getPriceOverride(entry, item.market), 2.39,
    'Existing callers still receive a numeric shelf price');
  const quote = h.api.price({...item, quantity: entry.standard_pack_size});
  assert.equal(quote.packAmount, 2.39);
  assert.equal(quote.userBrand, 'Tilda Easy Cook');
  assert.equal(quote.productName, 'Tilda Easy Cook');
  assert.equal(quote.source, 'user_shelf_price');
  assert.equal(quote.priceKind, 'user_price');
  assert.equal(quote.sourceUrl, null);
  const reloaded = pricing({saved: h.saved});
  assert.equal(reloaded.api.getProductOverride(entry, item.market).brand, 'Tilda Easy Cook');
  assert.equal(reloaded.api.getPriceOverride(entry, item.market), 2.39);
});

test('brand is optional and an older price-only caller remains supported', () => {
  const h = pricing();
  h.api.setPriceOverride({...item, price: 1.89});
  const entry = h.api.getPack(item.name, item.unit, item.market);
  assert.equal(h.api.getPriceOverride(entry, item.market), 1.89);
  assert.equal(h.api.getProductOverride(entry, item.market).brand || '', '');
  assert.equal(h.api.price({...item, quantity: 100}).source, 'user_shelf_price');
});

test('usual products belong to their supermarket and region', () => {
  const h = pricing();
  h.api.setPriceOverride({...item, price: 2.39, brand: 'Aldi usual rice'});
  const ukEntry = h.api.getPack(item.name, item.unit, item.market);
  h.selected.UK = 'Tesco';
  assert.equal(h.api.getProductOverride(ukEntry, 'UK'), null);
  h.api.setPriceOverride({...item, price: 3.17, brand: 'Tesco usual rice'});
  h.selected.UK = 'Aldi';
  assert.equal(h.api.getProductOverride(ukEntry, 'UK').brand, 'Aldi usual rice');
  assert.equal(h.api.getPriceOverride(ukEntry, 'UK'), 2.39);
  const islandEntry = h.api.getPack(item.name, item.unit, 'Guernsey');
  assert.equal(h.api.getProductOverride(islandEntry, 'Guernsey'), null);
  const usEntry = h.api.getPack(item.name, item.unit, 'US');
  assert.equal(h.api.getProductOverride(usEntry, 'US'), null);
  assert.equal(h.api.getProductOverride(ukEntry, 'UK', 'Tesco').brand, 'Tesco usual rice');
});

test('an explicit supermarket overrides the selected shop without changing the preference', () => {
  const h = pricing();
  h.api.setPriceOverride({...item, retailer: 'Tesco', price: 3.17, brand: 'My Tesco rice'});
  const entry = h.api.getPack(item.name, item.unit, item.market, 'Tesco');
  assert.equal(h.api.getProductOverride(entry, 'UK', 'Tesco').brand, 'My Tesco rice');
  assert.equal(h.api.getProductOverride(entry, 'UK'), null);
  assert.equal(h.selected.UK, 'Aldi');
  assert.equal(h.api.price({...item, retailer: 'Tesco', quantity: entry.standard_pack_size}).packAmount, 3.17);
});

test('legacy numeric regional prices are read without migration writes', () => {
  const h = pricing();
  const entry = h.api.getPack(item.name, item.unit, item.market);
  const raw = JSON.stringify({[baseKey(entry, 'UK')]: 4.29});
  h.saved.set(storageKey, raw);
  assert.equal(h.api.getPriceOverride(entry, 'UK'), 4.29);
  const product = h.api.getProductOverride(entry, 'UK');
  assert.equal(product.price, 4.29);
  assert.equal(product.brand || '', '');
  h.api.price({...item, quantity: entry.standard_pack_size});
  assert.equal(h.writes(), 0);
  assert.equal(h.saved.get(storageKey), raw);
});

test('reset suppresses a legacy price only for the chosen supermarket', () => {
  const h = pricing();
  const entry = h.api.getPack(item.name, item.unit, item.market);
  h.saved.set(storageKey, JSON.stringify({[baseKey(entry, 'UK')]: 4.29}));
  assert.equal(h.api.getPriceOverride(entry, 'UK'), 4.29);
  h.api.clearPriceOverride(item);
  assert.equal(h.api.getProductOverride(entry, 'UK'), null);
  assert.equal(h.api.getPriceOverride(entry, 'UK'), null);
  assert.equal(h.api.getPriceOverride(entry, 'UK', 'Tesco'), 4.29,
    'Resetting Aldi must leave a legacy regional price available in another shop');
  const records = JSON.parse(h.saved.get(storageKey));
  assert.equal(records[baseKey(entry, 'UK')], 4.29);
  assert.equal(records[baseKey(entry, 'UK') + '|shop:' + encodeURIComponent('Aldi')], null);
  h.api.clearPriceOverride({...item, retailer: null});
  assert.equal(h.api.getPriceOverride(entry, 'UK', 'Tesco'), null);
});

test('resetting a shop-specific usual product keeps other shops and restores guide pricing', () => {
  const h = pricing();
  h.api.setPriceOverride({...item, price: 2.39, brand: 'Aldi rice'});
  h.api.setPriceOverride({...item, retailer: 'Tesco', price: 3.17, brand: 'Tesco rice'});
  h.api.clearPriceOverride(item);
  const quote = h.api.price({...item, quantity: 100});
  assert.equal(quote.userOverride, false);
  assert.equal(quote.priceKind, 'regional_estimate');
  assert.equal(quote.userBrand || '', '');
  assert.equal(h.api.price({...item, retailer: 'Tesco', quantity: 100}).userBrand, 'Tesco rice');
});

test('invalid brands and prices are rejected before changing stored products', () => {
  const h = pricing();
  h.api.setPriceOverride({...item, price: 2.39, brand: 'Usual rice'});
  const before = h.saved.get(storageKey);
  const writes = h.writes();
  for (const bad of [
    {brand: 'x'.repeat(81)}, {brand: 123}, {brand: {label: 'rice'}},
    {price: 0}, {price: -1}, {price: Number.NaN}, {price: 10000.01}
  ]) {
    assert.throws(() => h.api.setPriceOverride({...item, price: 2.39, brand: 'Usual rice', ...bad}));
    assert.equal(h.saved.get(storageKey), before);
  }
  assert.equal(h.writes(), writes);
});

test('corrupt prices are ignored and stored brand text is safely bounded', () => {
  const h = pricing();
  const entry = h.api.getPack(item.name, item.unit, item.market);
  const key = baseKey(entry, 'UK') + '|shop:' + encodeURIComponent('Aldi');
  for (const record of [{price: 0, brand: 'Rice'}, {price: -1, brand: 'Rice'}, {price: 10001, brand: 'Rice'}]) {
    h.saved.set(storageKey, JSON.stringify({[key]: record}));
    assert.equal(h.api.getProductOverride(entry, 'UK'), null);
  }
  for (const brand of ['x'.repeat(81), ['Rice']]) {
    h.saved.set(storageKey, JSON.stringify({[key]: {price: 2.39, brand}}));
    const result = h.api.getProductOverride(entry, 'UK');
    assert.equal(result.price, 2.39);
    assert.equal(typeof result.brand, 'string');
    assert.ok(result.brand.length <= 80);
  }
  assert.equal(h.writes(), 0);
});
