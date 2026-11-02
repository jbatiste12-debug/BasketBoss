import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';

const {install} = createRequire(import.meta.url)('../bb-home.js');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const receiptSource = fs.readFileSync(new URL('../bb-receipt-inventory.js', import.meta.url), 'utf8');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const STOCK = 'basketboss_321_v7_measured_pantry';
const INVENTORY = 'basketboss_makeameal_v1_inventory';
const HOME = 'basketboss_at_home_requirements_v1';
const SESSION = 'basketboss_cloud_session_v1';
const canonical = value => String(value).toLowerCase().trim();
const id = (name, unit) => canonical(name) + '|' + unit;
const clone = value => JSON.parse(JSON.stringify(value));

function fixture({stock = {'rice|g': 1000}, ingredients = [{key: 'rice', unit: 'g', required: 300}], occurrence = null} = {}) {
  const values = new Map([[STOCK, JSON.stringify(stock)], [INVENTORY, '{}'], [SESSION, JSON.stringify({user: {id: ACTOR}})]]);
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  const state = {ingredients, occurrence, pending: false, review: false, refreshes: 0, syncs: [], syncResult: {ok: true}};
  const host = {
    id, keys: () => ({stock: STOCK, inventory: INVENTORY}), stock: () => JSON.parse(storage.getItem(STOCK) || '{}'),
    recipeIngredients: (_, factor) => state.ingredients.map(row => ({...row, required: row.required === null ? null : row.required * factor})),
    occurrence: () => state.occurrence, refresh: () => state.refreshes++, requirements: () => [], household: () => []
  };
  const win = {localStorage: storage, document: {}, location: {search: ''}, BBHomeHost: host, BBReceiptHost: {
    hasPendingConfirmation: () => state.pending, requiresPantryReview: () => state.review,
    async confirmCurrentPantry(packet) {state.syncs.push(clone(packet));if (state.syncError) throw Error('Offline');return state.syncResult;}
  }};
  const home = install(win);win.BBHome = home;
  const event = {sessionId: 'cook-session', recipeId: 'rice-dinner', day: 'Mon', factor: 1, actorId: ACTOR, occurrence};
  return {values, storage, state, win, host, home, event, stock: host.stock, data: () => JSON.parse(storage.getItem(HOME) || '{}')};
}

test('Cook preview is read-only, scales servings and applies reviewed amounts to the real pantry', async () => {
  const h = fixture(), event = {...h.event, factor: 2}, before = [...h.values];
  const preview = h.home.previewCook(event);
  assert.equal(preview.ok, true);assert.equal(preview.rows[0].required, 600);
  assert.equal(preview.rows[0].deduct, 600);assert.deepEqual([...h.values], before);
  const result = await h.home.cooked({...event, expected: preview.fingerprint, amounts: [{id: 'rice|g', quantity: .55, unit: 'kg'}]});
  assert.equal(result.ok, true);assert.deepEqual(h.stock(), {'rice|g': 450});
  assert.deepEqual(h.state.syncs, [{stock: {'rice|g': 450}}]);
  assert.equal(h.data().byActor[ACTOR].cooked[event.sessionId].ingredients[0].quantity, 550);
});

test('Cook saves exactly once per session and planned meal occurrence, while a new real cook can deduct again', async () => {
  const h = fixture({occurrence: 'plan-week|Mon|rice-dinner'});
  assert.equal((await h.home.cooked(h.event)).ok, true);
  assert.equal((await h.home.cooked(h.event)).already, true);
  assert.equal((await h.home.cooked({...h.event, sessionId: 'reopened-session'})).already, true);
  assert.equal(h.stock()['rice|g'], 700);assert.equal(h.state.syncs.length, 1);
  assert.equal((await h.home.cooked({...h.event, sessionId: 'another-real-cook', occurrence: null})).ok, true);
  assert.equal(h.stock()['rice|g'], 400);
});

test('stale review fingerprints and changed planned occurrences require a fresh review before any write', async () => {
  const h = fixture({occurrence: 'plan-week|Mon|rice-dinner'}), preview = h.home.previewCook(h.event);
  h.storage.setItem(STOCK, JSON.stringify({'rice|g': 800}));const before = [...h.values];
  const stale = await h.home.cooked({...h.event, expected: preview.fingerprint});
  assert.equal(stale.ok, false);assert.equal(stale.needsReview, true);assert.deepEqual([...h.values], before);
  h.state.occurrence = 'plan-week|Tue|other-dinner';
  const moved = await h.home.cooked(h.event);
  assert.equal(moved.ok, false);assert.match(moved.message, /planned dinner changed/);assert.deepEqual([...h.values], before);
});

test('another account or a pending receipt cannot consume the original pantry', async () => {
  const h = fixture(), preview = h.home.previewCook(h.event);
  h.storage.setItem(SESSION, JSON.stringify({user: {id: '22222222-2222-4222-8222-222222222222'}}));
  const before = [...h.values];assert.equal((await h.home.cooked({...h.event, expected: preview.fingerprint})).ok, false);
  assert.deepEqual([...h.values], before);
  h.storage.setItem(SESSION, JSON.stringify({user: {id: ACTOR}}));h.state.pending = true;
  assert.equal(h.home.previewCook(h.event).ok, false);assert.equal((await h.home.cooked(h.event)).ok, false);
  assert.equal(h.stock()['rice|g'], 1000);assert.equal(h.storage.getItem(HOME), null);
});

test('unknown amounts and incompatible units stay visible while compatible ingredients deduct and floor at zero', async () => {
  const h = fixture({stock: {'rice|g': 200, 'milk|l': 1, 'garlic|bulb': 1, 'salt|g': 50}, ingredients: [
    {key: 'rice', unit: 'g', required: 300}, {key: 'milk', unit: 'ml', required: 250},
    {key: 'garlic', unit: 'clove', required: 3}, {key: 'salt', unit: 'g', required: null}
  ]});
  const preview = h.home.previewCook(h.event);
  assert.deepEqual(preview.rows.map(row => row.issue), [null, null, 'unit_mismatch', 'amount_unknown']);
  const result = await h.home.cooked({...h.event, expected: preview.fingerprint});
  assert.equal(result.ok, true);assert.equal(result.issues.length, 2);
  assert.deepEqual(h.stock(), {'milk|ml': 750, 'garlic|bulb': 1, 'salt|g': 50});
  assert.equal(h.data().byActor[ACTOR].cooked[h.event.sessionId].skipped.length, 2);
});

test('offline cloud confirmation preserves the local deduction and retry cannot consume twice', async () => {
  const h = fixture();h.state.syncError = true;
  const result = await h.home.cooked(h.event);
  assert.equal(result.ok, true);assert.match(result.message, /on this device/);
  assert.equal(h.stock()['rice|g'], 700);
  assert.equal((await h.home.cooked(h.event)).already, true);assert.equal(h.stock()['rice|g'], 700);
});

test('a failed local transaction restores stock, inventory and completion identity for a safe retry', async () => {
  const h = fixture(), put = h.storage.setItem;let fail = true;
  h.storage.setItem = (key, value) => {if (key === INVENTORY && fail) {fail = false;throw Error('quota');}return put(key, value);};
  const before = [...h.values];await assert.rejects(() => h.home.cooked(h.event), /quota/);
  assert.deepEqual([...h.values], before);assert.equal(h.state.syncs.length, 0);
  assert.equal((await h.home.cooked(h.event)).ok, true);assert.equal(h.stock()['rice|g'], 700);
});

function namedFunction(name, next) {
  const start = index.indexOf('function ' + name + '('), end = index.indexOf('\nfunction ' + next + '(', start);
  assert.ok(start >= 0 && end > start, name + ' remains available for integration verification');return index.slice(start, end);
}

function actualPlanner(h) {
  const price = {canonical, regionMultipliers: {UK: 1}, price: () => null, repriceBasket: value => value};
  const recipes = [{id: 'rice-dinner', servings: 2, ingredients: [['Rice', '600g', 1]]}];
  const normalized = [{id: 'rice-dinner', ingredients: [{name: 'Rice', key: 'rice', quantity: 600, unit: 'g', status: 'PARSED'}]}];
  let week = 'first-shop';
  const ctx = vm.createContext({window: h.win, BBPriceV19: price, BB_WHOLE_PRODUCE_GRAMS: {},
    BB307_SOURCE_RECIPES: recipes, BB307_NORMALIZED: normalized, BB321_RESEARCH_QUOTES: [], bb307Market: 'UK', bb307Stock: {},
    bb307Selections: () => [{id: 'rice-dinner', servings: 2}], bb307ActiveRetailer: () => 'Tesco', bb307ReadStock: h.stock,
    bbReceiptPantryReviewRequired: () => false, bbReceiptHasAuthoritativePantry: () => false, bbHomeLegacyPantry: () => ({}),
    bbBetaReceiptConstantsReady: true, bbReceiptHostReady: false, BB_BETA_RECEIPT_KEY: 'basketboss_purchase_receipts_v1',
    bb83ReadObject: key => JSON.parse(h.storage.getItem(key) || '{}'), bbBetaShopWeek: () => week
  });
  const engineStart = index.indexOf('const bb307EstimateBasket=(()=>{'), engineEnd = index.indexOf('// BasketBoss 321 v7 original-design PREVIEW', engineStart);
  vm.runInContext(index.slice(engineStart, engineEnd) + '\n' + namedFunction('bbBetaStockForCurrentWeek', 'bbBetaReceiptCandidate') + '\n' + namedFunction('bb307Plan', 'bb307SetPantry'), ctx);
  return {items: () => ctx.bb307Plan().items, nextWeek: () => {week = 'next-shop';}};
}

test('reviewed receipt stock flows through Cook into the real next-shopping calculation without a reload', async () => {
  const h = fixture({stock: {'rice|g': 200}}), shopping = actualPlanner(h);
  assert.equal(shopping.items()[0].toBuy, 400);
  const root = {console, localStorage: h.storage};vm.runInNewContext(receiptSource, root);
  const adapter = root.BBReceiptInventoryFactory({storage: h.storage, core: receiptCore, canonicalize: canonical,
    getSession: () => ({user: {id: ACTOR}, access_token: 'synthetic-local-receipt-token'}),
    getContext: () => ({market: 'UK', retailer: 'Tesco', shopSessionId: 'first-shop'}),
    getCatalog: () => ({ingredients: {'rice|g': {ingredient: 'rice', unit: 'g'}}})
  });
  const packet = {receiptId: 'receipt-closed-loop-1', market: 'UK', retailer: 'Tesco', shopSessionId: 'first-shop', stockPantry: true,
    items: [{key: 'rice', name: 'Rice 1kg', classification: 'food', sourceKind: 'purchase', quantity: 1, unit: 'kg', lineTotal: 2, reviewed: true}]};
  assert.equal((await adapter.commitLocalReceipt(packet)).ok, true);
  assert.equal(h.stock()['rice|g'], 1200);assert.equal(shopping.items()[0].toBuy, 0);
  assert.equal((await adapter.commitLocalReceipt(packet)).duplicate, true);assert.equal(h.stock()['rice|g'], 1200);
  assert.equal((await h.home.cooked({...h.event, factor: 2})).ok, true);assert.equal(h.stock()['rice|g'], 600);
  shopping.nextWeek();assert.equal(shopping.items()[0].toBuy, 0, 'remaining 600 g covers the next 600 g dinner');
  h.state.ingredients = [{key: 'rice', unit: 'g', required: 100}];
  assert.equal((await h.home.cooked({...h.event, sessionId: 'second-meal'})).ok, true);
  assert.equal(shopping.items()[0].toBuy, 100, '600 needed minus the updated 500 already got leaves 100 to buy');
});
