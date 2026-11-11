import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Core from '../bb-receipt-inventory-core.mjs';

const source = fs.readFileSync(process.env.BB_PANTRY_GET_ACK_SOURCE || new URL('../bb-receipt-inventory.js', import.meta.url), 'utf8');
const ACTOR = 'user_get_ack_0001', OTHER = 'user_get_ack_0002';
const SCOPE = {kind: 'user', id: ACTOR};
const KEYS = {stock: 'basketboss_321_v7_measured_pantry', kitchen: 'basketboss_makeameal_v1_inventory', owner: 'basketboss_receipt_projection_owner_v1'};
const cacheKey = scope => 'basketboss_receipt_inventory_v1:' + ACTOR + ':' + scope.kind + ':' + scope.id;
const clone = value => JSON.parse(JSON.stringify(value));
const stock = {'rice|g': 1000, 'egg|each': 8.666667};
const kitchen = {
  first: {name: 'Rice', qty: .3, unit: 'kg', loc: 'fridge', selected: true, bb173StockKey: 'rice|g', bb173StockValue: 300, notes: 'Opened bag', lotId: 'lot-one', useByISO: '2026-11-14'},
  frozen: {name: 'Rice', qty: 700, unit: 'g', loc: 'freezer', selected: true, bb173StockKey: 'rice|g', bb173StockValue: 700, packReviewed: true, packQuantity: 500, packUnit: 'g', bbReduced: {version: 1, actor: ACTOR, urgent: false, at: '2026-11-10T12:00:00Z', frozenAt: '2026-11-10T13:00:00Z', sources: ['receipt:original:rice']}},
  eggs: {name: 'Egg', qty: 8.666667, unit: 'each', loc: 'fridge', selected: true, bb173StockKey: 'egg|each', bb173StockValue: 8.666667, lotId: 'egg-lot'},
  empty: {name: 'Bread', qty: 0, unit: 'each', loc: 'cupboard', selected: true, bb173StockKey: 'bread|each', bb173StockValue: 0, notes: 'Keep this row for undo'}
};

function fixture({localStock = stock, localKitchen = kitchen, owner = null, serverStock = localStock, revision = 2, initialized = true, scope = SCOPE, tracking = true, mutateResponse, afterGet} = {}) {
  const values = new Map([[KEYS.stock, JSON.stringify(localStock)], [KEYS.kitchen, JSON.stringify(localKitchen)]]), projections = [], settlements = [], requests = [];
  let failKey = null, session = {user: {id: ACTOR}, access_token: 'acknowledgement-token'}, context = {market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-ack'};
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {if (key === failKey) {failKey = null;throw Error('test storage failure');} values.set(key, String(value));},
    removeItem(key) {values.delete(key);}
  };
  if (owner) {
    const record = {version: 1, actorId: ACTOR, cacheKey: cacheKey(SCOPE), scope: SCOPE, initialized: true, inventoryRevision: 1, serverStock: {}, ...owner};
    values.set(KEYS.owner, JSON.stringify(record));
    values.set(record.cacheKey, JSON.stringify({version: 1, actorId: record.actorId, scope: record.scope, initialized: record.initialized, inventoryRevision: record.inventoryRevision, serverStock: record.serverStock, appliedReceiptIds: {existing_receipt: true}}));
  }
  const root = {localStorage: storage, BBReducedStock: {settleInventory({after}) {settlements.push(clone(after));return after;}}};
  vm.runInNewContext(source, {window: root, URL, Date, console});
  const adapter = root.BBReceiptInventoryFactory({core: Core, storage, pantryPolicy: tracking, getSession: () => session, getContext: () => context, canonicalize: value => String(value).trim().toLowerCase(), onProjection: value => projections.push(clone(value)), async fetch(url, options) {
    requests.push({url, method: options.method});assert.equal(options.method, 'GET');assert.equal(options.headers.Authorization, 'Bearer ' + session.access_token);
    const response = {ok: true, initialized, inventoryRevision: revision, scope: clone(scope), stock: clone(serverStock), inventory: Object.entries(Core.normalizeStockMap(serverStock)).map(([stockKey, quantity]) => ({stockKey, canonicalKey: stockKey.slice(0, stockKey.lastIndexOf('|')), unit: stockKey.slice(stockKey.lastIndexOf('|') + 1), quantity, location: 'cupboard', revision})), essentials: [], receipts: [], priceObservations: [], pantryReview: {required: true}};
    mutateResponse?.(response);afterGet?.({setSession: value => {session = value;}, setContext: value => {context = value;}});
    return {ok: true, status: 200, json: async () => clone(response)};
  }});
  return {adapter, storage, values, projections, settlements, requests, failWrite: key => {failKey = key;}};
}

test('an identical initialized first-owner GET adopts its authoritative balance without duplicating food or rewriting physical lots', async () => {
  const h = fixture(), beforeKitchen = h.storage.getItem(KEYS.kitchen);
  const result = await h.adapter.synchronize();assert.equal(result.localApplied, true, result.localError);
  assert.deepEqual(JSON.parse(h.storage.getItem(KEYS.stock)), stock);assert.equal(h.storage.getItem(KEYS.kitchen), beforeKitchen);assert.equal(h.settlements.length, 0);
  const owner = JSON.parse(h.storage.getItem(KEYS.owner)), cached = h.adapter.getCachedProjection();
  assert.equal(owner.actorId, ACTOR);assert.deepEqual(owner.scope, SCOPE);assert.equal(owner.inventoryRevision, 2);assert.deepEqual(owner.serverStock, stock);
  assert.equal(cached.inventoryRevision, owner.inventoryRevision);assert.deepEqual(clone(cached.serverStock), stock);assert.equal(cached.initialized, true);assert.equal(cached.pantryReview.required, true);
  assert.equal(h.projections.length, 1);assert.equal(h.requests.length, 1);
});

test('a newer GET already equal to locally changed stock acknowledges the revision instead of adding its delta again', async () => {
  const h = fixture({owner: {serverStock: {'rice|g': 500, 'egg|each': 4}}}), beforeKitchen = h.storage.getItem(KEYS.kitchen);
  const result = await h.adapter.synchronize();assert.equal(result.localApplied, true, result.localError);
  assert.deepEqual(JSON.parse(h.storage.getItem(KEYS.stock)), stock);assert.equal(h.storage.getItem(KEYS.kitchen), beforeKitchen);assert.equal(h.settlements.length, 0);
  const owner = JSON.parse(h.storage.getItem(KEYS.owner)), cached = h.adapter.getCachedProjection();
  assert.equal(owner.inventoryRevision, 2);assert.deepEqual(owner.serverStock, stock);assert.equal(cached.inventoryRevision, 2);assert.deepEqual(clone(cached.serverStock), stock);assert.equal(cached.appliedReceiptIds.existing_receipt, true);
  const repeated = await h.adapter.synchronize();assert.equal(repeated.localApplied, true);assert.deepEqual(JSON.parse(h.storage.getItem(KEYS.stock)), stock, 'acknowledging again must not reapply the old server delta');
});

test('identical normalized empty stock retains zero rows and their physical metadata on first-owner and newer-owner acknowledgement', async () => {
  for (const owner of [null, {serverStock: {'rice|g': 500}}]) for (const localStock of [{}, {'rice|g': 0, 'bread|each': 0}]) {
    const localKitchen = {empty: kitchen.empty, rice: {...kitchen.first, qty: 0, bb173StockValue: 0}}, h = fixture({owner, localStock, localKitchen, serverStock: {'rice|g': 0}}), beforeKitchen = h.storage.getItem(KEYS.kitchen);
    const result = await h.adapter.synchronize();assert.equal(result.localApplied, true, result.localError);assert.deepEqual(JSON.parse(h.storage.getItem(KEYS.stock)), {});assert.equal(h.storage.getItem(KEYS.kitchen), beforeKitchen);assert.equal(h.settlements.length, 0);
    assert.deepEqual(JSON.parse(h.storage.getItem(KEYS.owner)).serverStock, {});assert.equal(h.adapter.getCachedProjection().inventoryRevision, 2);
  }
});

test('different first-owner and independently changed local and remote balances still require explicit review without writes', async () => {
  for (const owner of [null, {serverStock: {'rice|g': 500}}]) {
    const h = fixture({owner, serverStock: {'rice|g': 900, 'egg|each': 8.666667}}), before = [...h.values];
    const result = await h.adapter.synchronize();assert.equal(result.localApplied, false);assert.match(result.localError, /pantry_merge_required/);assert.deepEqual([...h.values], before);assert.equal(h.projections.length, 0);
  }
  const exact = fixture({owner: {serverStock: {'rice|g': 500}}, serverStock: {...stock, 'egg|each': 8.666668}}), before = [...exact.values];
  assert.equal((await exact.adapter.synchronize()).localApplied, false);assert.deepEqual([...exact.values], before, 'one millionth of an item is a real difference');
});

test('an equal balance reconstructed from a partial response cannot acknowledge an absolute pantry', async () => {
  for (const owner of [null, {serverStock: {'rice|g': 500}}]) {
    const h = fixture({owner, mutateResponse: response => {response.projectionMode = 'patch';}}), before = [...h.values], result = await h.adapter.synchronize();
    assert.equal(result.localApplied, false);assert.match(result.localError, /pantry_merge_required/);assert.deepEqual([...h.values], before);assert.equal(h.projections.length, 0);
  }
});

test('stale revisions, another actor and changed household scope cannot use identical stock to adopt a projection', async () => {
  for (const options of [
    {owner: {serverStock: stock, inventoryRevision: 3}},
    {scope: {kind: 'user', id: OTHER}},
    {owner: {actorId: OTHER}},
    {owner: {serverStock: stock}, scope: {kind: 'household', id: 'household_ack_0001'}}
  ]) {
    const h = fixture(options), before = [...h.values], result = await h.adapter.synchronize();
    assert.equal(result.localApplied, false);assert.match(result.localError, /stale_server|actor_mismatch|other_account|scope_changed/);assert.deepEqual([...h.values], before);assert.equal(h.projections.length, 0);
  }
});

test('identical balances still validate the entire inventory payload and current account context before writing', async () => {
  for (const mutateResponse of [response => {response.inventory[0].quantity++;}, response => {response.inventory[0].location = 'garage';}, response => {response.inventory = {};}, response => {response.initialized = 'yes';}, response => {response.inventoryRevision = -1;}]) {
    const h = fixture({mutateResponse}), before = [...h.values], result = await h.adapter.synchronize();
    assert.equal(result.localApplied, false);assert.deepEqual([...h.values], before);assert.equal(h.projections.length, 0);
  }
  for (const afterGet of [({setSession}) => setSession({user: {id: OTHER}, access_token: 'another-token'}), ({setSession}) => setSession({user: {id: ACTOR}, access_token: 'refreshed-token'}), ({setContext}) => setContext({market: 'UK', retailer: 'Aldi'})]) {
    const h = fixture({afterGet}), before = [...h.values];await assert.rejects(h.adapter.synchronize(), /context_changed/);assert.deepEqual([...h.values], before);assert.equal(h.projections.length, 0);
  }
});

test('a pending receipt is recovered with its original proof rather than treated as an identical stock acknowledgement', async () => {
  const receiptId = 'pending-ack-receipt', h = fixture(), pendingKey = 'basketboss_receipt_pending_confirmation_v1:' + ACTOR;
  h.storage.setItem(pendingKey, JSON.stringify({version: 1, actorId: ACTOR, receiptId, requestId: 'pending-ack-request', body: {action: 'confirm_receipt', receiptId, requestId: 'pending-ack-request', lines: []}}));
  const before = [...h.values], result = await h.adapter.synchronize();assert.equal(result.pendingReceipt, true);assert.equal(result.localApplied, false);assert.deepEqual([...h.values], before);assert.match(h.requests[0].url, /receiptId=pending-ack-receipt/);assert.equal(h.projections.length, 0);
  const recovered = fixture({mutateResponse: response => {response.receiptId = receiptId;response.receiptRevision = 2;}});
  recovered.storage.setItem(pendingKey, h.storage.getItem(pendingKey));const saved = [...recovered.values], response = await recovered.adapter.synchronize();
  assert.equal(response.localApplied, false);assert.match(response.localError, /initial_pantry_merge_required/);assert.deepEqual([...recovered.values], saved, 'receipt recovery must retain its baseline and cannot enter the GET acknowledgement path');
});

test('owner and cache adoption roll back together if the atomic acknowledgement cannot be saved', async () => {
  for (const owner of [null, {serverStock: {'rice|g': 500}}]) {
    const h = fixture({owner}), before = [...h.values];h.failWrite(KEYS.owner);
    const result = await h.adapter.synchronize();assert.equal(result.localApplied, false);assert.match(result.localError, /test storage failure/);assert.deepEqual([...h.values], before);assert.equal(h.projections.length, 0);
  }
});

test('an existing recovery journal blocks identical acknowledgement without changing any saved bytes', async () => {
  const h = fixture(), journalKey = 'basketboss_receipt_inventory_journal_v1:' + ACTOR;
  h.storage.setItem(journalKey, JSON.stringify({version: 1, actorId: ACTOR, before: {}, after: {}}));
  const before = [...h.values], result = await h.adapter.synchronize();assert.equal(result.localApplied, false);assert.equal(result.localError, 'receipt_recovery_required');assert.deepEqual([...h.values], before);assert.equal(h.projections.length, 0);
});
