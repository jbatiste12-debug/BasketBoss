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
async function fixture({store = memoryStorage(), remote = server(), initialize = true, guest = false} = {}) {
  const events = new Map(), root = {localStorage: store, Intl, Date, console, queueMicrotask, addEventListener(name, fn) {events.set(name, [...(events.get(name) || []), fn]);}};
  vm.runInNewContext(adapterSource, root);vm.runInNewContext(hostSource, root);
  const session = {value: guest ? null : {user: {id: actor}, access_token: 'private-token-never-persist', expires_at: 9999999999}};
  const context = {value: {market: 'UK', retailer: 'Tesco', shopSessionId: 'purchase-trip'}};
  const getSession = () => session.value, getContext = () => context.value;
  const inventory = root.BBReceiptInventoryFactory({core, storage: store, fetch: remote.fetch.bind(remote), getSession, getContext});
  if (initialize && !guest) await inventory.synchronize();
  const host = root.BBReceiptHostFactory({storage: store, inventory, fetch: remote.fetch.bind(remote), getSession, getContext, getStock: () => JSON.parse(store.getItem(inventory.keys.stock) || '{}')});host.configure();
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
