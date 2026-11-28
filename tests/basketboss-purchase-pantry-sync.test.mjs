import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../bb-receipt-inventory-core.mjs';

const [hostSource, adapterSource] = await Promise.all(['../bb-receipt-host.js', '../bb-receipt-inventory.js'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
const actor = 'purchase_user_01', otherActor = 'purchase_user_02';
const copy = value => JSON.parse(JSON.stringify(value));
function memoryStorage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
}
function server() {
  return {
    stock: {'rice|g': 100}, revision: 3, available: true, posts: [], afterPost: null,
    scope: {kind: 'user', id: actor},
    snapshot() {return {ok: true, stock: copy(this.stock), scope: copy(this.scope), initialized: true, inventoryRevision: this.revision, pantryReview: {required: false}, inventory: [], essentials: [], receipts: [], priceObservations: []};},
    async fetch(url, options = {}) {
      const response = (value, status = 200) => ({ok: status < 400, status, json: async () => copy(value)});
      if (url.includes('mode=status')) return response({available: this.available, premium: true, configured: true});
      if (options.method !== 'POST') return response(this.snapshot());
      const body = JSON.parse(options.body);this.posts.push(body);
      if (body.expectedRevision !== this.revision || JSON.stringify(body.expectedScope) !== JSON.stringify(this.scope)) return response({error: 'inventory_revision_conflict'}, 409);
      this.stock = copy(body.stock);this.revision++;
      const result = this.snapshot();await this.afterPost?.(body);
      return response(result);
    }
  };
}
async function fixture({store = memoryStorage(), remote = server(), initialize = true, guest = false, household = false, accountPantrySync = false} = {}) {
  if (household) remote.scope = {kind: 'household', id: '33333333-3333-4333-8333-333333333333'};
  const events = new Map(), root = {localStorage: store, Intl, Date, console, queueMicrotask, addEventListener(name, fn) {events.set(name, [...(events.get(name) || []), fn]);}};
  vm.runInNewContext(adapterSource, root);vm.runInNewContext(hostSource, root);
  const session = {value: guest ? null : {user: {id: actor}, access_token: 'private-token-never-persist', expires_at: 9999999999}};
  const context = {value: {market: 'UK', retailer: 'Tesco', shopSessionId: 'purchase-trip'}};
  const getSession = () => session.value, getContext = () => context.value;
  const inventory = root.BBReceiptInventoryFactory({core, storage: store, fetch: remote.fetch.bind(remote), getSession, getContext});
  if (initialize && !guest) await inventory.synchronize();
  const host = root.BBReceiptHostFactory({storage: store, inventory, fetch: remote.fetch.bind(remote), getSession, getContext, accountPantrySync, getStock: () => JSON.parse(store.getItem(inventory.keys.stock) || '{}')});host.configure();
  const stock = () => JSON.parse(store.getItem(inventory.keys.stock) || '{}');
  const outboxKey = 'basketboss_purchase_pantry_sync_v1:' + actor;
  const outbox = () => JSON.parse(store.getItem(outboxKey) || 'null');
  const commit = target => {
    const prepared = host.preparePurchasedPantry({stock: target, beforeStock: stock(), shopSessionId: context.value.shopSessionId});
    for (const [key, expected] of Object.entries(prepared.expected)) assert.equal(store.getItem(key), expected);
    // The production shop journal writes these changes with its pantry/ledger.
    for (const [key, value] of Object.entries(prepared.updates)) value === null ? store.removeItem(key) : store.setItem(key, JSON.stringify(value));
    store.setItem(inventory.keys.stock, JSON.stringify(target));return prepared;
  };
  return {root, store, remote, session, context, host, inventory, stock, outbox, outboxKey, commit, event(name) {for (const fn of events.get(name) || []) fn();}};
}

function sharedEngine(f) {
  const key = 'basketboss_household_auto_test_outbox_v2', edits = [], flushes = [];
  const engine = {isReady: () => true, preparePantryEdit(value) {edits.push(copy(value));return {updates: {[key]: {version: 2, value: copy(value)}}, expected: {[key]: f.store.getItem(key)}};}, async flush() {flushes.push(true);return {ok: true, queued: false};}};
  f.root.BBHouseholdSharingAuto = engine;return {engine, key, edits, flushes};
}

test('a tagged manual shared pantry edit prepares only the per-item outbox without writing or echoing legacy stock', async () => {
  const f = await fixture({household: true, accountPantrySync: true}), shared = sharedEngine(f), before = new Map(f.store.values);
  const prepared = f.host.preparePurchasedPantry({beforeStock: f.stock(), stock: {'rice|g': 275}, sharedUserEdit: true});
  assert.deepEqual(f.store.values, before);assert.equal(prepared.shared, true);assert.equal(prepared.queued, true);
  assert.deepEqual(shared.edits, [{beforeStock: {'rice|g': 100}, stock: {'rice|g': 275}}]);
  assert.deepEqual(Object.keys(prepared.updates), [shared.key]);assert.equal(prepared.expected[f.inventory.keys.owner], before.get(f.inventory.keys.owner));
  assert.equal(Object.hasOwn(prepared.updates, f.outboxKey), false);assert.equal(f.remote.posts.length, 0);
});

test('an explicit edit can stage before the protocol read is ready without flushing or replacing legacy stock', async () => {
  const f = await fixture({household: true, accountPantrySync: true}), shared = sharedEngine(f), before = new Map(f.store.values);
  shared.engine.isReady = () => false;shared.engine.canCapture = () => true;
  const prepared = f.host.preparePurchasedPantry({beforeStock: f.stock(), stock: {'rice|g': 275}, sharedUserEdit: true});
  assert.equal(prepared.shared, true);assert.equal(shared.edits.length, 1);assert.deepEqual(f.store.values, before);
  assert.equal((await f.host.retryPurchasedPantry()).queued, false);assert.equal(shared.flushes.length, 0);assert.equal(f.remote.posts.length, 0);
});

test('untagged household receipt accounting keeps its existing preparation and private or guest pantry edits never enter the shared outbox', async () => {
  for (const options of [{household: true, accountPantrySync: true}, {accountPantrySync: true}, {guest: true, accountPantrySync: true}]) {
    const f = await fixture(options), shared = sharedEngine(f), before = new Map(f.store.values);
    const prepared = f.host.preparePurchasedPantry({beforeStock: f.stock(), stock: {'rice|g': 275}, sharedUserEdit: options.household !== true});
    assert.deepEqual(shared.edits, []);assert.deepEqual(f.store.values, before);
    if (!options.guest) assert.ok(Object.hasOwn(prepared.updates, f.outboxKey));else assert.equal(prepared.localOnly, true);
  }
});

test('ready household retries preserve the old whole-stock queue in quarantine and flush only the new engine', async () => {
  const f = await fixture({household: true, accountPantrySync: true});f.commit({'rice|g': 500});const raw = f.store.getItem(f.outboxKey), shared = sharedEngine(f);
  const result = await f.host.retryPurchasedPantry();
  assert.equal(result.ok, true);assert.equal(result.legacyQueueQuarantined, true);assert.equal(f.outbox(), null);assert.equal(shared.flushes.length, 1);assert.equal(f.remote.posts.length, 0);
  const backups = [...f.store.values].filter(([key]) => key.startsWith('basketboss_household_legacy_pantry_queue_v1:'));
  assert.equal(backups.length, 1);assert.deepEqual(JSON.parse(backups[0][1]).queue, JSON.parse(raw));assert.deepEqual(f.stock(), {'rice|g': 500});
});

test('a failed quarantine backup retains the old intent and never sends its whole-household stock', async () => {
  const f = await fixture({household: true, accountPantrySync: true});f.commit({'rice|g': 500});const before = new Map(f.store.values), shared = sharedEngine(f), write = f.store.setItem;
  f.store.setItem = (key, value) => {if (key.startsWith('basketboss_household_legacy_pantry_queue_v1:')) throw Error('synthetic storage full');write(key, value);};
  await assert.rejects(f.host.retryPurchasedPantry(), /storage full/);assert.deepEqual(f.store.values, before);assert.equal(shared.flushes.length, 0);assert.equal(f.remote.posts.length, 0);
});

test('a verified same-household snapshot uses the original inventory projection without generating a local edit', async () => {
  const f = await fixture({household: true, accountPantrySync: true}), shared = sharedEngine(f);
  f.remote.stock = {'rice|g': 250, 'milk|ml': 200};f.remote.revision++;
  const result = await f.host.receiveSharedAutoSnapshot(f.remote.snapshot(), {precondition: () => true});
  assert.equal(result.ok, true);assert.equal(result.localApplied, true);assert.deepEqual(f.stock(), f.remote.stock);
  assert.equal(f.inventory.getCachedProjection().inventoryRevision, f.remote.revision);assert.deepEqual(shared.edits, []);assert.equal(f.remote.posts.length, 0);
});

test('a shared snapshot cannot silently adopt a personal pantry or bypass pending pantry edits', async () => {
  const personal = await fixture({accountPantrySync: true});personal.remote.scope = {kind: 'household', id: '33333333-3333-4333-8333-333333333333'};
  let before = new Map(personal.store.values);assert.equal((await personal.host.receiveSharedAutoSnapshot(personal.remote.snapshot(), {precondition: () => true})).deferred, true);assert.deepEqual(personal.store.values, before);
  const f = await fixture({household: true, accountPantrySync: true});f.remote.stock = {'rice|g': 250};f.remote.revision++;
  for (const reason of ['editor', 'caller', 'legacy-queue']) {
    f.root.BBPantryLive = {hasPending: () => reason === 'editor'};
    if (reason === 'legacy-queue') f.commit({'rice|g': 500});
    before = new Map(f.store.values);
    assert.equal((await f.host.receiveSharedAutoSnapshot(f.remote.snapshot(), {precondition: () => reason !== 'caller'})).deferred, true);assert.deepEqual(f.store.values, before);
  }
});

test('a local write while a shared projection awaits the inventory lock prevents stale snapshot application', async () => {
  const f = await fixture({household: true, accountPantrySync: true});f.remote.stock = {'rice|g': 250};f.remote.revision++;
  let unlock, started;const gate = new Promise(resolve => {unlock = resolve;}), entered = new Promise(resolve => {started = resolve;});
  f.inventory.configure({locks: {async request(_name, _options, work) {started();await gate;return work();}}});
  const pending = f.host.receiveSharedAutoSnapshot(f.remote.snapshot(), {precondition: () => true});await entered;
  f.store.setItem(f.inventory.keys.stock, JSON.stringify({'rice|g': 600}));const before = new Map(f.store.values);unlock();
  assert.equal((await pending).deferred, true);assert.deepEqual(f.store.values, before);
});

test('shared projection storage failure rolls back stock, Kitchen and projection metadata together', async () => {
  const f = await fixture({household: true, accountPantrySync: true});f.remote.stock = {'rice|g': 250};f.remote.revision++;
  const before = new Map(f.store.values), write = f.store.setItem;let fail = true;
  f.store.setItem = (key, value) => {if (fail && key === f.inventory.keys.owner) {fail = false;throw Error('synthetic projection storage full');}write(key, value);};
  assert.equal((await f.host.receiveSharedAutoSnapshot(f.remote.snapshot(), {precondition: () => true})).deferred, true);
  for (const [key, value] of before) assert.equal(f.store.getItem(key), value);
  assert.equal([...f.store.values].filter(([key]) => key.startsWith('basketboss_household_auto_premerge_v2:')).length, 1, 'the durable recovery copy survives a failed projection');
});

test('an acknowledged manual edit plus another partner item projects the absolute stock once and keeps receipt accounting intact', async () => {
  const f = await fixture({household: true, accountPantrySync: true}), shared = sharedEngine(f);
  const ledger = JSON.stringify({original: {credited: 11, receiptId: 'original-receipt'}}), budgetKey = 'basketboss_v172_weekly_budget_target_v1';
  f.store.setItem(f.inventory.keys.finishShop, ledger);f.store.setItem(budgetKey, '85');
  f.store.setItem(f.inventory.keys.stock, JSON.stringify({'rice|g': 500}));
  const beforeOwner = f.store.getItem(f.inventory.keys.owner);
  f.remote.stock = {'rice|g': 500, 'milk|ml': 700};f.remote.revision++;
  const snapshot = f.remote.snapshot();
  assert.equal((await f.host.receiveSharedAutoSnapshot(snapshot, {precondition: () => true})).ok, true);assert.deepEqual(f.stock(), snapshot.stock);
  const backups = [...f.store.values].filter(([key]) => key.startsWith('basketboss_household_auto_premerge_v2:'));assert.equal(backups.length, 1);
  const backup = JSON.parse(backups[0][1]);assert.equal(backup.before[f.inventory.keys.owner], beforeOwner);assert.equal(backup.before[f.inventory.keys.stock], JSON.stringify({'rice|g': 500}));
  assert.equal((await f.host.receiveSharedAutoSnapshot(snapshot, {precondition: () => true})).ok, true);assert.deepEqual(f.stock(), snapshot.stock);
  assert.equal([...f.store.values].filter(([key]) => key.startsWith('basketboss_household_auto_premerge_v2:')).length, 1);
  assert.equal(f.store.getItem(f.inventory.keys.finishShop), ledger);assert.equal(f.store.getItem(budgetKey), '85');assert.deepEqual(shared.edits, []);assert.equal(f.remote.posts.length, 0);
});

test('a shared snapshot recovery-copy failure aborts before replacing physical stock or account metadata', async () => {
  const f = await fixture({household: true, accountPantrySync: true});f.remote.stock = {'rice|g': 250};f.remote.revision++;
  const before = new Map(f.store.values), write = f.store.setItem;
  f.store.setItem = (key, value) => {if (key.startsWith('basketboss_household_auto_premerge_v2:')) throw Error('synthetic backup storage full');write(key, value);};
  assert.equal((await f.host.receiveSharedAutoSnapshot(f.remote.snapshot(), {precondition: () => true})).deferred, true);assert.deepEqual(f.store.values, before);
});

test('shared physical projection preserves cached receipt history and never invokes receipt-accounting hooks', async () => {
  const f = await fixture({household: true, accountPantrySync: true}), owner = JSON.parse(f.store.getItem(f.inventory.keys.owner)), cached = JSON.parse(f.store.getItem(owner.cacheKey));
  const histories = {essentials: [{id: 'saved-essential', name: 'Soap', addToPantry: true}], receipts: [{receiptId: 'saved-receipt', receiptTotal: 12.5}], priceObservations: [{id: 'saved-price', scopeId: owner.scope.id, market: 'UK', currency: 'GBP', retailer: 'Tesco', canonicalKey: 'rice', packQuantity: 1000, packUnit: 'g', packCount: 1, packPrice: 2, priceType: 'regular'}]};
  Object.assign(cached, histories);f.store.setItem(owner.cacheKey, JSON.stringify(cached));
  const confirmed = f.store.getItem(f.inventory.keys.confirmed);let accountingCalls = 0;
  f.inventory.configure({prepareReceiptSave() {accountingCalls++;throw Error('shared reads must not invoke receipt accounting');}});
  f.remote.stock = {'rice|g': 250};f.remote.revision++;
  const snapshot = f.remote.snapshot();for (const field of Object.keys(histories)) delete snapshot[field];
  assert.equal((await f.host.receiveSharedAutoSnapshot(snapshot, {precondition: () => true})).ok, true);
  const after = f.inventory.getCachedProjection();for (const [field, value] of Object.entries(histories)) assert.deepEqual(copy(after[field]), value);
  assert.equal(accountingCalls, 0);assert.equal(f.store.getItem(f.inventory.keys.confirmed), confirmed);
  const fresh = {...f.remote.snapshot(), receipts: [...histories.receipts, {receiptId: 'partner-receipt', receiptTotal: 7.5}], essentials: histories.essentials, priceObservations: histories.priceObservations};
  assert.equal((await f.host.receiveSharedAutoSnapshot(fresh, {precondition: () => true})).ok, true);
  assert.deepEqual(copy(f.inventory.getCachedProjection().receipts), fresh.receipts);assert.equal(accountingCalls, 0);
});

test('shared snapshots reject malformed stock and stale inventory revisions without losing saved data', async () => {
  const f = await fixture({household: true, accountPantrySync: true}), original = f.remote.snapshot();
  for (const changed of [{stock: {'rice|g': -1}}, {stock: {'rice|g': '250'}}, {stock: {'__proto__|g': 1}}, {inventoryRevision: 2}, {initialized: 'true'}]) {
    const before = new Map(f.store.values);
    assert.equal((await f.host.receiveSharedAutoSnapshot({...original, ...changed}, {precondition: () => true})).deferred, true);assert.deepEqual(f.store.values, before);
  }
});

test('a local purchase durably prepares its CAS and acknowledges the exact stock without adding twice', async () => {
  const f = await fixture(), before = [...f.store.values];
  const prepared = f.host.preparePurchasedPantry({beforeStock: f.stock(), stock: {'rice|g': 500}});
  assert.deepEqual([...f.store.values], before, 'preparing is read-only so the purchase journal can own the write');
  assert.equal(prepared.queued, true);f.commit({'rice|g': 500});
  assert.equal(f.outbox().expectedRevision, 3);assert.deepEqual(f.outbox().baselineStock, {'rice|g': 100});
  const result = await f.host.retryPurchasedPantry();
  assert.equal(result.queued, false);assert.equal(f.outbox(), null);assert.deepEqual(f.remote.stock, {'rice|g': 500});
  assert.deepEqual(f.stock(), {'rice|g': 500});assert.equal(f.host.canConsumePantry(), true);
  assert.equal((await f.inventory.synchronize()).localApplied, true);assert.deepEqual(f.stock(), {'rice|g': 500});
  assert.ok([...f.store.values].every(([, value]) => !value.includes('private-token-never-persist')));
});

test('offline purchases survive a new host and remain usable until exact-baseline sync is available', async () => {
  const f = await fixture();f.remote.available = false;f.commit({'rice|g': 500});
  const offline = await f.host.retryPurchasedPantry();
  assert.equal(offline.localOnly, true);assert.equal(offline.queued, true);assert.equal(offline.needsReview, false);
  assert.equal(f.host.canConsumePantry(), true);assert.equal(f.remote.posts.length, 0);
  f.remote.available = true;const reloaded = await fixture({store: f.store, remote: f.remote, initialize: false});
  assert.equal((await reloaded.host.retryPurchasedPantry()).queued, false);
  assert.deepEqual(reloaded.stock(), {'rice|g': 500});assert.deepEqual(f.remote.stock, {'rice|g': 500});
});

test('the app journal can serialize a cancelled outbox as JSON null without blocking the pantry', async () => {
  const f = await fixture();f.commit({'rice|g': 500});
  const undo = f.host.preparePurchasedPantry({stock: {'rice|g': 100}, beforeStock: f.stock()});
  assert.equal(undo.updates[f.outboxKey], null);
  for (const [key, value] of Object.entries(undo.updates)) f.store.setItem(key, JSON.stringify(value));
  f.store.setItem(f.inventory.keys.stock, JSON.stringify({'rice|g': 100}));
  assert.equal(f.host.canConsumePantry(), true);assert.equal((await f.host.retryPurchasedPantry()).queued, false);
  f.commit({'rice|g': 500});assert.equal((await f.host.retryPurchasedPantry()).queued, false);
});

test('a lost successful response recovers its retained attempt without duplicating purchases', async () => {
  const f = await fixture();f.commit({'rice|g': 500});
  f.remote.afterPost = () => {f.remote.afterPost = null;throw Error('connection lost after commit');};
  const interrupted = await f.host.retryPurchasedPantry();
  assert.equal(interrupted.retryable, true);assert.equal(f.outbox().attempt.expectedRevision, 3);
  assert.equal(f.host.canConsumePantry(), true);assert.deepEqual(f.remote.stock, {'rice|g': 500});
  const reloaded = await fixture({store: f.store, remote: f.remote, initialize: false});
  assert.equal((await reloaded.host.retryPurchasedPantry()).queued, false);
  assert.deepEqual(reloaded.stock(), {'rice|g': 500});assert.deepEqual(f.remote.stock, {'rice|g': 500});
});

test('a second purchase during the first request advances from its acknowledged baseline', async () => {
  const f = await fixture();let release, began;
  const started = new Promise(resolve => {began = resolve;});
  const waiting = new Promise(resolve => {release = resolve;});
  f.remote.afterPost = async () => {f.remote.afterPost = null;began();await waiting;};
  f.commit({'rice|g': 500});const first = f.host.retryPurchasedPantry();await started;
  assert.equal(f.host.allowLegacyTransfer(), false);assert.equal(f.host.allowPurchaseTransfer(), true);
  f.commit({'rice|g': 800});assert.deepEqual(f.outbox().attempt.stock, {'rice|g': 500});
  release();assert.equal((await first).queued, false);
  assert.deepEqual(f.remote.posts.map(row => row.stock), [{'rice|g': 500}, {'rice|g': 800}]);
  assert.deepEqual(f.stock(), {'rice|g': 800});assert.deepEqual(f.remote.stock, {'rice|g': 800});
});

test('a cross-tab purchase arriving between the success snapshot and projection read is retained', async () => {
  const f = await fixture();f.commit({'rice|g': 500});let injected = false, completedProjectionReads = 0;
  const wrapped = Object.create(f.inventory);
  Object.defineProperty(wrapped, 'getCachedProjection', {value() {
    const saved = f.inventory.getCachedProjection();
    if (!injected && saved.inventoryRevision === 4 && f.outbox()?.attempt && ++completedProjectionReads === 2) {
      injected = true;f.commit({'rice|g': 800});
    }
    return saved;
  }});
  f.host.configure({inventory: wrapped});
  const raced = await f.host.retryPurchasedPantry();
  assert.equal(injected, true);assert.equal(raced.queued, true);assert.equal(raced.retryable, true);
  assert.deepEqual(f.outbox().stock, {'rice|g': 800});assert.deepEqual(f.stock(), {'rice|g': 800});
  assert.equal((await f.host.retryPurchasedPantry()).queued, false);assert.deepEqual(f.remote.stock, {'rice|g': 800});
});

test('an interrupted earlier purchase can recover while a later local purchase is still queued', async () => {
  const f = await fixture();f.commit({'rice|g': 500});
  f.remote.afterPost = () => {f.remote.afterPost = null;throw Error('lost response');};
  await f.host.retryPurchasedPantry();f.commit({'rice|g': 800});
  const reloaded = await fixture({store: f.store, remote: f.remote, initialize: false});
  assert.equal((await reloaded.host.retryPurchasedPantry()).queued, false);
  assert.deepEqual(reloaded.stock(), {'rice|g': 800});assert.deepEqual(f.remote.stock, {'rice|g': 800});
});

test('a genuinely different remote balance retains both quantities and requires a review after reload', async () => {
  const f = await fixture();f.commit({'rice|g': 500});f.remote.stock = {'rice|g': 250};f.remote.revision++;
  const conflict = await f.host.retryPurchasedPantry();
  assert.equal(conflict.conflict, true);assert.equal(conflict.needsReview, true);assert.equal(f.outbox().needsReview, true);
  assert.deepEqual(f.stock(), {'rice|g': 500});assert.deepEqual(f.remote.stock, {'rice|g': 250});
  const reloaded = await fixture({store: f.store, remote: f.remote, initialize: false});
  assert.equal(reloaded.host.canConsumePantry(), false);assert.equal(reloaded.host.requiresPantryReview(), true);
  const review = await reloaded.host.reviewPantry();
  assert.deepEqual(copy(review.local), {'rice|g': 500});assert.deepEqual(copy(review.data.stock), {'rice|g': 250});
  assert.equal((await reloaded.host.retryPurchasedPantry()).conflict, true);assert.equal(f.remote.posts.length, 1);
});

test('the source trip can close before retry without changing purchase identity', async () => {
  const f = await fixture();f.commit({'rice|g': 500});f.context.value = {...f.context.value, shopSessionId: 'next-trip'};
  assert.equal((await f.host.retryPurchasedPantry()).queued, false);
  assert.equal(f.remote.posts[0].shopSessionId, 'purchase-trip');assert.deepEqual(f.stock(), {'rice|g': 500});
});

test('a changed household scope is a conflict even when its quantities happen to match', async () => {
  const f = await fixture();f.commit({'rice|g': 500});const priorOwner = f.store.getItem(f.inventory.keys.owner);
  f.remote.scope = {kind: 'household', id: 'different_household'};
  const result = await f.host.retryPurchasedPantry();
  assert.equal(result.conflict, true);assert.equal(f.host.allowPurchaseTransfer(), false);
  assert.equal(f.store.getItem(f.inventory.keys.owner), priorOwner);assert.deepEqual(f.stock(), {'rice|g': 500});
});

test('failure saving a durable attempt leaves the purchase available for retry', async () => {
  const f = await fixture();f.commit({'rice|g': 500});
  const setItem = f.store.setItem;let fail = true;
  f.store.setItem = (key, value) => {if (key === f.outboxKey && fail) {fail = false;throw Error('quota');}return setItem(key, value);};
  const failed = await f.host.retryPurchasedPantry();
  assert.equal(failed.retryable, true);assert.equal(f.remote.posts.length, 0);assert.deepEqual(f.stock(), {'rice|g': 500});assert.ok(f.outbox());
  assert.equal((await f.host.retryPurchasedPantry()).queued, false);assert.deepEqual(f.remote.stock, {'rice|g': 500});
});

test('a newer revision with unchanged known balances is safe to retry without replacing unseen stock', async () => {
  const f = await fixture();f.commit({'rice|g': 500});f.remote.revision++;
  const result = await f.host.retryPurchasedPantry();
  assert.equal(result.needsReview, false);assert.equal(result.queued, false);
  assert.deepEqual(f.remote.stock, {'rice|g': 500});assert.deepEqual(f.stock(), {'rice|g': 500});
});

test('a pending receipt is recovered before a queued purchase can send its CAS', async () => {
  const f = await fixture();f.commit({'rice|g': 500});
  const journal = 'basketboss_receipt_inventory_journal_v1:' + actor;f.store.setItem(journal, '{}');
  const waiting = await f.host.retryPurchasedPantry();assert.equal(waiting.pending, true);assert.equal(f.remote.posts.length, 0);
  f.store.removeItem(journal);assert.equal((await f.host.retryPurchasedPantry()).queued, false);
});

test('offline cooking updates the same durable purchase target instead of later restoring consumed ingredients', async () => {
  const f = await fixture();f.remote.available = false;f.commit({'rice|g': 500});await f.host.retryPurchasedPantry();
  f.store.setItem(f.inventory.keys.stock, JSON.stringify({'rice|g': 300}));
  const cooked = await f.host.confirmCookedPantry({stock: {'rice|g': 300}});
  assert.equal(cooked.localOnly, true);assert.deepEqual(f.outbox().stock, {'rice|g': 300});assert.equal(f.host.canConsumePantry(), true);
  f.remote.available = true;const reloaded = await fixture({store: f.store, remote: f.remote, initialize: false});
  assert.equal((await reloaded.host.retryPurchasedPantry()).queued, false);assert.deepEqual(f.remote.stock, {'rice|g': 300});
});

test('an unverified local baseline remains usable offline and waits for explicit online review', async () => {
  const f = await fixture();f.remote.available = false;
  f.store.setItem(f.inventory.keys.stock, JSON.stringify({'rice|g': 120}));f.commit({'rice|g': 500});
  assert.equal(f.outbox().needsReview, true);assert.equal(f.outbox().remoteConflict, undefined);
  const offline = await f.host.retryPurchasedPantry();
  assert.equal(offline.localOnly, true);assert.equal(offline.needsReview, false);assert.equal(f.host.canConsumePantry(), true);
  f.store.setItem(f.inventory.keys.stock, JSON.stringify({'rice|g': 300}));
  assert.equal((await f.host.confirmCookedPantry({stock: {'rice|g': 300}})).localOnly, true);
  f.remote.available = true;const reloaded = await fixture({store: f.store, remote: f.remote, initialize: false});
  const online = await reloaded.host.retryPurchasedPantry();
  assert.equal(online.needsReview, true);assert.equal(online.conflict, false);assert.equal(f.remote.posts.length, 0);
  assert.deepEqual(reloaded.stock(), {'rice|g': 300});assert.equal(reloaded.host.canConsumePantry(), false);
});

test('late request completion after token rotation retains the queue and cannot change ownership', async () => {
  const f = await fixture();let release, began;
  const started = new Promise(resolve => {began = resolve;});const waiting = new Promise(resolve => {release = resolve;});
  f.remote.afterPost = async () => {f.remote.afterPost = null;began();await waiting;};
  f.commit({'rice|g': 500});const pending = f.host.retryPurchasedPantry();await started;
  const oldOwner = f.store.getItem(f.inventory.keys.owner);f.session.value = {...f.session.value, access_token: 'rotated-token'};
  release();assert.equal((await pending).queued, true);assert.equal(f.store.getItem(f.inventory.keys.owner), oldOwner);
  assert.deepEqual(f.stock(), {'rice|g': 500});assert.ok(f.outbox().attempt);
  assert.equal((await f.host.retryPurchasedPantry()).queued, false);
});

test('switching accounts during a request keeps the original outbox and the new account pantry separate', async () => {
  const f = await fixture();let release, began;
  const started = new Promise(resolve => {began = resolve;});const waiting = new Promise(resolve => {release = resolve;});
  f.remote.afterPost = async () => {began();await waiting;};
  f.commit({'rice|g': 500});const pending = f.host.retryPurchasedPantry();await started;
  f.session.value = {user: {id: otherActor}, access_token: 'other-token'};f.event('basketboss:session-changed');
  f.store.setItem(f.inventory.keys.stock, JSON.stringify({'milk|ml': 200}));
  release();assert.equal((await pending).queued, true);
  assert.deepEqual(f.stock(), {'milk|ml': 200});assert.deepEqual(f.outbox().stock, {'rice|g': 500});
  assert.equal(f.store.getItem('basketboss_purchase_pantry_sync_v1:' + otherActor), null);
});

test('guest and unowned local purchases do not require receipt activation or create a cloud baseline', async () => {
  for (const guest of [true, false]) {
    const f = await fixture({initialize: false, guest});f.store.setItem(f.inventory.keys.stock, JSON.stringify({'rice|g': 100}));
    const prepared = f.commit({'rice|g': 500});assert.equal(prepared.localOnly, true);assert.equal(prepared.queued, false);
    assert.equal(f.host.canConsumePantry(), true);assert.equal(f.outbox(), null);assert.equal(f.remote.posts.length, 0);
  }
});
