import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEngine } = require('../bb-household-auto-sync.js');
const ACTOR = '00000000-0000-4000-8000-000000000071';
const HOUSEHOLD = '33333333-3333-4333-8333-333333333333';
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let nextUuid = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++nextUuid).padStart(12, '0')}`;
const dinner = { kind: 'dinner', key: '2026-11-30:Monday' };
const pantry = { kind: 'pantry', key: 'egg|each' };
const meal = recipeId => ({ recipeId, servings: null });
const stock = quantity => ({ quantity, location: 'fridge' });

class MemoryStorage {
  data = new Map();
  failWrites = false;
  writes = [];
  getItem(key) { return this.data.get(String(key)) ?? null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(String(key), String(value));
    this.writes.push({ key: String(key), value: String(value) });
  }
  removeItem(key) { this.data.delete(String(key)); }
  clear() { this.data.clear(); }
  snapshot() { return [...this.data.entries()]; }
}

function server() {
  const operations = new Map(), values = new Map(), calls = [];
  let clock = 7;
  const api = {
    calls, operations, values, intercept: null, protocol: 2,
    snapshot() {
      return {
        ok: true, protocol: api.protocol, household_id: HOUSEHOLD,
        clock, pruneFloor: 0,
        state: { entries: [], stock: {}, locations: {}, inventoryRevision: 0, initialized: true }
      };
    },
    async perform(action, payload) {
      if (action === 'auto_sync') return api.snapshot();
      assert.equal(payload.expectedHouseholdId, HOUSEHOLD);
      if (action === 'sync_reserve') {
        let operation = operations.get(payload.operationId);
        if (!operation) {
          operation = { id: payload.operationId, order: ++clock, status: 'reserved', target: clone(payload.target), value: clone(payload.value) };
          operations.set(operation.id, operation);
        }
        return { ok: true, operation: { id: operation.id, order: operation.order, status: operation.status } };
      }
      if (action === 'sync_apply') {
        const operation = operations.get(payload.operationId);
        assert.ok(operation, 'apply must refer to an existing reserved operation');
        assert.equal(payload.order, operation.order, 'retries preserve the immutable reservation order');
        const key = `${operation.target.kind}:${operation.target.key}`;
        const previous = values.get(key);
        if (previous && previous.order > operation.order) operation.status = 'superseded';
        else {
          operation.status = 'applied';
          values.set(key, clone(operation));
        }
        return { ok: true, operation: { id: operation.id, order: operation.order, status: operation.status } };
      }
      throw new Error(`Unexpected action: ${action}`);
    },
    async request(action, payload = {}) {
      calls.push({ action, payload: clone(payload) });
      return api.intercept ? api.intercept(action, payload, api.perform) : api.perform(action, payload);
    }
  };
  return api;
}

function fixture({ storage = new MemoryStorage(), remote = server(), identity = { actor: ACTOR, token: 'token-a', householdId: HOUSEHOLD }, allowStaging = false, onBackup = null, onApply = null } = {}) {
  const current = { identity, blocked: false }, applied = [], notifications = [];
  let backups = 0;
  const engine = createEngine({
    storage, allowStaging, identity: () => current.identity, blocked: () => current.blocked,
    request: (action, payload) => remote.request(action, payload),
    apply: (response, pendingTargets) => { applied.push({ response: clone(response), pendingTargets: clone(pendingTargets) }); return onApply ? onApply(response, pendingTargets) : true; },
    backup: () => { backups++; return onBackup?.(); }, notify: (...args) => notifications.push(args), uuid
  });
  return { engine, current, applied, notifications, storage, remote, get backups() { return backups; } };
}
const drain = async engine => { await Promise.resolve(engine.flush()).catch(() => {}); };
const posts = remote => remote.calls.filter(call => call.action !== 'auto_sync');
const reserves = remote => remote.calls.filter(call => call.action === 'sync_reserve');
const applies = remote => remote.calls.filter(call => call.action === 'sync_apply');

// All requests are adapter calls to the in-memory server above. No backend or
// external account is contacted by these persistence and concurrency tests.
test('initialization reads shared state without creating an upload; remote reads never capture intent', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  assert.equal(f.engine.read().ready, true);
  assert.ok(f.applied.length > 0);
  assert.equal(f.applied[0].response.household_id, HOUSEHOLD, 'apply receives the whole response');
  assert.deepEqual(f.applied[0].pendingTargets, []);
  await f.engine.refresh();
  assert.deepEqual(posts(f.remote), []);
  assert.deepEqual(f.engine.read().pending, []);
  f.engine.destroy();
});

test('capture requires protocol 2 capability and rejects unsupported or malformed targets', { timeout: 10000 }, async () => {
  const f = fixture();
  assert.equal(f.engine.capture(dinner, meal('private-plan')).queued, false);
  f.remote.protocol = 1;
  await f.engine.initialize();
  assert.equal(f.engine.read().ready, false);
  assert.equal(f.engine.capture(dinner, meal('private-plan')).queued, false);
  f.remote.protocol = 2;
  await f.engine.refresh();
  assert.equal(f.engine.read().ready, true);
  f.remote.intercept = async action => { throw new Error(`Offline ${action}`); };
  const invalid = [
    [{ kind: 'private_plan', key: 'Monday' }, meal('x')],
    [{ kind: 'setting', key: 'premium:default' }, true],
    [dinner, { recipeId: 'x', servings: 0 }],
    [dinner, { recipeId: 'x', servings: 13 }],
    [pantry, { quantity: -1, location: 'fridge' }],
    [pantry, { quantity: Infinity, location: 'fridge' }],
    [pantry, { quantity: 1, location: 'garage' }],
    [{ kind: 'setting', key: 'household_servings:default' }, { count: 0 }],
    [{ kind: 'setting', key: 'budget_target:weekly' }, { amount: -1 }],
    [{ kind: 'setting', key: 'shopping_checked:' }, true],
    [{ kind: 'setting', key: 'shopping_checked:egg' }, 'yes']
  ];
  const before = f.storage.snapshot();
  for (const [target, value] of invalid) assert.equal(f.engine.capture(target, value).queued, false, JSON.stringify(target));
  assert.deepEqual(f.storage.snapshot(), before, 'invalid captures cannot mutate durable storage');
  assert.equal(f.engine.capture({ kind: 'setting', key: 'household_servings:default' }, { count: 4 }).queued, true);
  assert.equal(f.engine.capture({ kind: 'setting', key: 'budget_target:weekly' }, { amount: 45.5 }).queued, true);
  assert.equal(f.engine.capture({ kind: 'setting', key: 'shopping_checked:egg' }, true).queued, true);
  assert.equal(f.engine.capture({ kind: 'setting', key: 'budget_target:weekly' }, null).queued, true);
  await drain(f.engine);
  f.engine.destroy();
});

test('offline intent survives reload with its original operation ID and capability', { timeout: 10000 }, async () => {
  const remote = server(), storage = new MemoryStorage(), first = fixture({ remote, storage });
  await first.engine.initialize();
  remote.intercept = async () => { throw new Error('Offline'); };
  const captured = first.engine.capture(dinner, meal('pasta'));
  assert.equal(captured.queued, true);
  assert.ok(storage.snapshot().some(([key]) => key.startsWith('bb_partner_auto_v2_')));
  await drain(first.engine);
  assert.equal(first.engine.read().pending.length, 1);
  first.engine.destroy();
  const second = fixture({ remote, storage });
  await second.engine.initialize();
  assert.equal(second.engine.read().ready, true, 'durable protocol capability permits offline recovery');
  assert.equal(second.engine.read().pending.length, 1);
  remote.intercept = null;
  await drain(second.engine);
  assert.ok(reserves(remote).length >= 2);
  assert.deepEqual(new Set(reserves(remote).map(call => call.payload.operationId)), new Set([captured.operationId]));
  assert.equal(second.engine.read().pending.length, 0);
  assert.equal(remote.values.get(`dinner:${dinner.key}`).value.recipeId, 'pasta');
  second.engine.destroy();
});

test('a reserve with an unknown POST outcome retries the same ID and order', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  let failOnce = true;
  f.remote.intercept = async (action, payload, perform) => {
    const result = await perform(action, payload);
    if (action === 'sync_reserve' && failOnce) { failOnce = false; throw new Error('Response body disconnected'); }
    return result;
  };
  const captured = f.engine.capture(dinner, meal('soup'));
  await drain(f.engine);
  assert.equal(f.engine.read().pending.length, 1);
  await drain(f.engine);
  assert.equal(f.remote.operations.size, 1);
  assert.deepEqual(new Set(reserves(f.remote).map(call => call.payload.operationId)), new Set([captured.operationId]));
  assert.equal(applies(f.remote).length, 1);
  assert.equal(f.engine.read().pending.length, 0);
  f.engine.destroy();
});

test('a newer edit of the same target survives an older reserve acknowledgement', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const started = deferred(), release = deferred();
  let hold = true;
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve' && hold) { hold = false; started.resolve(); await release.promise; }
    return perform(action, payload);
  };
  const first = f.engine.capture(dinner, meal('older'));
  await started.promise;
  const latest = f.engine.capture(dinner, meal('latest'));
  assert.notEqual(first.operationId, latest.operationId);
  release.resolve();
  await drain(f.engine);
  assert.equal(f.engine.read().pending.length, 0);
  assert.equal(f.remote.values.get(`dinner:${dinner.key}`).value.recipeId, 'latest');
  assert.ok(reserves(f.remote).some(call => call.payload.operationId === latest.operationId));
  f.engine.destroy();
});

test('independent keys remain queued and apply serially with immutable captured values', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const started = deferred(), release = deferred();
  let hold = true, active = 0, maximum = 0;
  f.remote.intercept = async (action, payload, perform) => {
    active++; maximum = Math.max(maximum, active);
    try {
      if (action === 'sync_reserve' && hold) { hold = false; started.resolve(); await release.promise; }
      return await perform(action, payload);
    } finally { active--; }
  };
  const value = meal('beans'), target = clone(dinner);
  f.engine.capture(target, value);
  value.recipeId = 'mutated'; target.key = 'wrong-day';
  await started.promise;
  f.engine.capture(pantry, stock(3));
  assert.deepEqual(f.engine.read().pendingTargets.sort((a, b) => a.kind.localeCompare(b.kind)), [dinner, pantry]);
  release.resolve();
  await drain(f.engine);
  assert.equal(maximum, 1, 'the coordinator never overlaps requests');
  assert.equal(f.remote.values.get(`dinner:${dinner.key}`).value.recipeId, 'beans');
  assert.equal(f.remote.values.get(`pantry:${pantry.key}`).value.quantity, 3);
  assert.equal(f.engine.read().pending.length, 0);
  f.engine.destroy();
});

test('returned order is durable before apply, and quota failure prevents sending apply', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const started = deferred(), release = deferred();
  let hold = true;
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve' && hold) { hold = false; started.resolve(); await release.promise; }
    if (action === 'sync_apply') assert.ok(f.storage.snapshot().some(([, value]) => value.includes(`"order":${payload.order}`)), 'reservation must be durable before apply');
    return perform(action, payload);
  };
  const captured = f.engine.capture(dinner, meal('durable'));
  await started.promise;
  const before = f.storage.snapshot();
  f.storage.failWrites = true;
  release.resolve();
  await drain(f.engine);
  assert.equal(applies(f.remote).length, 0);
  assert.deepEqual(f.storage.snapshot(), before, 'failed persistence leaves the prior durable intent intact');
  assert.equal(f.engine.read().pending.length, 1);
  f.storage.failWrites = false;
  await drain(f.engine);
  assert.deepEqual(new Set(reserves(f.remote).map(call => call.payload.operationId)), new Set([captured.operationId]));
  assert.equal(f.engine.read().pending.length, 0);
  f.engine.destroy();
});

test('capture quota failure preserves the durable queue and reports that the new local edit was not queued', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  f.remote.intercept = async () => { throw new Error('Offline'); };
  f.engine.capture(dinner, meal('previous'));
  await drain(f.engine);
  const before = f.storage.snapshot();
  f.storage.failWrites = true;
  const failed = f.engine.capture(pantry, stock(8));
  assert.equal(failed.queued, false);
  assert.deepEqual(f.storage.snapshot(), before);
  assert.ok(f.notifications.length > 0, 'the adapter can tell the user this local edit is not queued');
  assert.equal(f.engine.read().pending.some(operation => operation.target.kind === 'pantry'), false);
  assert.equal(f.engine.read().pendingTargets.some(target => target.kind === 'pantry'), true, 'volatile protection preserves the saved local edit');
  f.storage.failWrites = false;
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') throw new Error('Offline write');
    return perform(action, payload);
  };
  await f.engine.refresh();
  assert.ok(f.applied.at(-1).pendingTargets.some(target => target.kind === 'pantry'), 'a later read must preserve the local edit that could not be queued');
  f.engine.destroy();
});

test('an account switch while reserve is pending cannot send apply or mutate the new actor state', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const started = deferred(), release = deferred();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') { started.resolve(); await release.promise; }
    return perform(action, payload);
  };
  f.engine.capture(dinner, meal('old-account'));
  await started.promise;
  const before = f.storage.snapshot();
  f.current.identity = { actor: '00000000-0000-4000-8000-000000000099', token: 'token-b', householdId: HOUSEHOLD };
  release.resolve();
  await drain(f.engine);
  assert.equal(applies(f.remote).length, 0);
  assert.deepEqual(f.storage.snapshot(), before, 'the old acknowledgement cannot write under a switched actor');
  assert.equal(f.engine.read().ready, false);
  f.engine.destroy();
});

test('token rotation while reserve is pending invalidates the request generation', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const started = deferred(), release = deferred();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') { started.resolve(); await release.promise; }
    return perform(action, payload);
  };
  f.engine.capture(dinner, meal('token-pinned'));
  await started.promise;
  f.current.identity = { ...f.current.identity, token: 'token-refreshed' };
  release.resolve();
  await drain(f.engine);
  assert.equal(applies(f.remote).length, 0);
  f.engine.destroy();
});

test('blocked deletion and late completion cannot recreate deleted outbox keys', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const started = deferred(), release = deferred();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') { started.resolve(); await release.promise; }
    return perform(action, payload);
  };
  f.engine.capture(dinner, meal('removed-account'));
  await started.promise;
  f.current.blocked = true;
  f.storage.clear();
  f.engine.reset();
  const beforeApplied = f.applied.length;
  release.resolve();
  await drain(f.engine);
  assert.equal(f.engine.capture(pantry, stock(4)).queued, false);
  assert.equal(applies(f.remote).length, 0);
  assert.equal(f.applied.length, beforeApplied);
  assert.deepEqual(f.storage.snapshot(), []);
  f.engine.destroy();
});

test('a delayed read cannot apply after destroy', { timeout: 10000 }, async () => {
  const f = fixture(), started = deferred(), release = deferred();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'auto_sync') { started.resolve(); await release.promise; }
    return perform(action, payload);
  };
  const initializing = f.engine.initialize();
  await started.promise;
  f.engine.destroy();
  release.resolve();
  await initializing;
  assert.equal(f.applied.length, 0);
  assert.deepEqual(f.storage.snapshot(), []);
});

test('preparing an atomic local edit does not persist or send an uncommitted intent', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const before = f.storage.snapshot();
  const prepared = f.engine.prepareCapture(dinner, meal('rolled-back'));
  assert.equal(prepared.queued, true);
  assert.equal(prepared.operationIds.length, 1);
  assert.ok(Object.keys(prepared.updates).every(key => key.startsWith('bb_partner_auto_v2_')));
  assert.deepEqual(f.storage.snapshot(), before);
  for (const [key, expected] of Object.entries(prepared.expected)) assert.equal(f.storage.getItem(key), expected);
  await drain(f.engine);
  assert.deepEqual(posts(f.remote), [], 'an aborted host transaction must never reach the server');
  assert.deepEqual(f.engine.read().pending, []);
  f.engine.destroy();
});

test('an externally committed atomic batch sends each independent target after reading actual storage', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const prepared = f.engine.prepareMany([
    { target: dinner, value: meal('atomic-dinner') },
    { target: pantry, value: stock(6) }
  ]);
  assert.equal(prepared.queued, true);
  assert.equal(prepared.operationIds.length, 2);
  for (const [key, expected] of Object.entries(prepared.expected)) assert.equal(f.storage.getItem(key), expected);
  for (const [key, update] of Object.entries(prepared.updates)) f.storage.setItem(key, typeof update === 'string' ? update : JSON.stringify(update));
  await drain(f.engine);
  assert.equal(f.remote.values.get(`dinner:${dinner.key}`).value.recipeId, 'atomic-dinner');
  assert.equal(f.remote.values.get(`pantry:${pantry.key}`).value.quantity, 6);
  assert.equal(f.engine.read().pending.length, 0);
  f.engine.destroy();
});

test('an atomic batch larger than the durable bound is rejected without a partial upload', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const before = f.storage.snapshot();
  const prepared = f.engine.prepareMany(Array.from({ length: 257 }, (_, index) => ({
    target: { kind: 'pantry', key: `item-${index}|each` }, value: stock(1)
  })));
  assert.equal(prepared.queued, false);
  assert.deepEqual(f.storage.snapshot(), before);
  await drain(f.engine);
  assert.deepEqual(posts(f.remote), []);
  f.engine.destroy();
});

test('a remote refresh exposes pending target protection without converting the read into an upload', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') throw new Error('Offline write');
    return perform(action, payload);
  };
  f.engine.capture(dinner, meal('unsent-local'));
  await drain(f.engine);
  const count = posts(f.remote).length;
  await f.engine.refresh();
  assert.deepEqual(f.applied.at(-1).pendingTargets, [dinner], 'the host can protect local or actively edited targets');
  assert.equal(posts(f.remote).length, count, 'a refresh must not issue a new write attempt');
  assert.equal(f.engine.read().pending.length, 1);
  f.engine.destroy();
});

test('a superseded reservation refreshes state and is never requeued with a new ID', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') return { ok: true, operation: { id: payload.operationId, order: 1, status: 'superseded' } };
    return perform(action, payload);
  };
  f.engine.capture(dinner, meal('superseded-local'));
  await drain(f.engine);
  await drain(f.engine);
  assert.equal(reserves(f.remote).length, 1);
  assert.equal(applies(f.remote).length, 0);
  assert.equal(f.engine.read().pending.length, 0);
  assert.ok(f.remote.calls.filter(call => call.action === 'auto_sync').length >= 2);
  f.engine.destroy();
});

test('external deletion alone prevents a late reservation acknowledgement from resurrecting the outbox', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const started = deferred(), release = deferred();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') { started.resolve(); await release.promise; }
    return perform(action, payload);
  };
  f.engine.capture(dinner, meal('deleted-outbox'));
  await started.promise;
  f.storage.clear();
  release.resolve();
  await drain(f.engine);
  assert.equal(applies(f.remote).length, 0);
  assert.deepEqual(f.storage.snapshot(), []);
  f.engine.destroy();
});

test('explicit staging persists one original intent and obtains its base clock before any POST', { timeout: 10000 }, async () => {
  const f = fixture({ allowStaging: true }), started = deferred(), release = deferred();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'auto_sync') { started.resolve(); await release.promise; }
    return perform(action, payload);
  };
  const captured = f.engine.capture(dinner, meal('staged-local'));
  assert.equal(captured.queued, true);
  const flushing = f.engine.flush();
  await started.promise;
  assert.equal(f.engine.read().pending[0].baseClock, null);
  assert.deepEqual(posts(f.remote), [], 'the handshake must finish before a staged operation can be reserved');
  release.resolve();
  await flushing;
  await drain(f.engine);
  assert.equal(reserves(f.remote).length, 1);
  assert.equal(reserves(f.remote)[0].payload.operationId, captured.operationId);
  assert.equal(reserves(f.remote)[0].payload.baseClock, 7);
  assert.equal(f.engine.read().pending.length, 0);
  f.engine.destroy();
});

test('staged edits remain durable when the server does not offer protocol 2', { timeout: 10000 }, async () => {
  const f = fixture({ allowStaging: true });
  f.remote.protocol = 1;
  const captured = f.engine.capture(pantry, stock(9));
  assert.equal(captured.queued, true);
  await f.engine.initialize();
  await drain(f.engine);
  assert.equal(f.engine.read().ready, false);
  assert.equal(f.engine.read().pending.length, 1);
  assert.equal(f.engine.read().pending[0].id, captured.operationId);
  assert.equal(f.engine.read().pending[0].baseClock, null);
  assert.deepEqual(posts(f.remote), []);
  f.engine.destroy();
});

test('an expired reservation is removed once and refreshes without gaining a new order', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  f.remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') return { ok: true, operation: { id: payload.operationId, order: null, status: 'expired' } };
    return perform(action, payload);
  };
  f.engine.capture(dinner, meal('expired-local'));
  await drain(f.engine);
  await drain(f.engine);
  assert.equal(reserves(f.remote).length, 1);
  assert.equal(applies(f.remote).length, 0);
  assert.equal(f.engine.read().pending.length, 0);
  assert.ok(f.remote.calls.filter(call => call.action === 'auto_sync').length >= 2);
  f.engine.destroy();
});

test('an async backup is awaited and identity is checked again before remote state is applied', { timeout: 10000 }, async () => {
  const started = deferred(), release = deferred();
  const f = fixture({ onBackup: async () => { started.resolve(); await release.promise; } });
  const initializing = f.engine.initialize();
  await started.promise;
  assert.equal(f.applied.length, 0, 'local application must wait for backup to finish');
  f.current.identity = { ...f.current.identity, token: 'changed-during-backup' };
  release.resolve();
  await initializing;
  assert.equal(f.applied.length, 0, 'a delayed backup cannot authorize old-identity application');
  f.engine.destroy();
});

test('setting deletion survives offline reload in its canonical server representation', { timeout: 10000 }, async () => {
  const remote = server(), storage = new MemoryStorage(), first = fixture({ remote, storage });
  await first.engine.initialize();
  remote.intercept = async () => { throw new Error('Offline'); };
  const target = { kind: 'setting', key: 'budget_target:weekly' };
  const captured = first.engine.capture(target, null);
  assert.equal(captured.queued, true);
  await drain(first.engine);
  first.engine.destroy();
  const second = fixture({ remote, storage });
  await second.engine.initialize();
  assert.equal(second.engine.read().pending.length, 1, 'canonical deleted values remain readable after reload');
  remote.intercept = null;
  await drain(second.engine);
  const request = reserves(remote).find(call => call.payload.operationId === captured.operationId && call.payload.value?.deleted === true);
  assert.ok(request, 'the clear is sent as the typed deletion value accepted by the server');
  assert.equal(second.engine.read().pending.length, 0);
  second.engine.destroy();
});

test('clearing a dinner also clears its servings override', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  assert.equal(f.engine.capture(dinner, { recipeId: null, servings: 4 }).queued, true);
  await drain(f.engine);
  assert.deepEqual(reserves(f.remote)[0].payload.value, { recipeId: null, servings: null });
  f.engine.destroy();
});

test('captureMany commits all explicit edits with one atomic outbox write before sending any operation', { timeout: 10000 }, async () => {
  const f = fixture();
  await f.engine.initialize();
  const changes = [
    { target: dinner, value: meal('batch-dinner') },
    { target: pantry, value: stock(5) },
    { target: { kind: 'setting', key: 'household_servings:default' }, value: { count: 6 } }
  ];
  const writesBefore = f.storage.writes.length;
  const captured = f.engine.captureMany(changes);
  assert.equal(captured.queued, true);
  assert.equal(captured.operationIds.length, changes.length);
  assert.equal(new Set(captured.operationIds).size, changes.length);
  const writes = f.storage.writes.slice(writesBefore);
  assert.equal(writes.length, 1, 'the batch becomes durable in one storage commit');
  assert.ok(writes[0].key.startsWith('bb_partner_auto_v2_'));
  assert.equal(f.engine.read().pending.length, changes.length);
  assert.deepEqual(posts(f.remote), [], 'persistence finishes synchronously before network work starts');
  assert.deepEqual(new Set(f.engine.read().pending.map(operation => operation.id)), new Set(captured.operationIds));
  await drain(f.engine);
  assert.deepEqual(new Set(reserves(f.remote).map(call => call.payload.operationId)), new Set(captured.operationIds));
  assert.equal(f.remote.values.get(`dinner:${dinner.key}`).value.recipeId, 'batch-dinner');
  assert.equal(f.remote.values.get(`pantry:${pantry.key}`).value.quantity, 5);
  assert.deepEqual(f.remote.values.get('setting:household_servings:default').value, { count: 6 });
  assert.equal(f.engine.read().pending.length, 0);
  f.engine.destroy();
});

test('captureMany quota failure protects every saved dinner while preserving the prior durable outbox', { timeout: 10000 }, async () => {
  const localPlanKey = 'basketboss_test_saved_seven_day_plan';
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const changes = days.map(day => ({ target: { kind: 'dinner', key: `2026-11-30:${day}` }, value: meal(`local-${day}`) }));
  const localPlan = Object.fromEntries(changes.map(change => [change.target.key, change.value.recipeId]));
  const remote = server(), storage = new MemoryStorage();
  const f = fixture({
    remote, storage,
    onApply(response, pendingTargets) {
      const protectedDinners = new Set(pendingTargets.filter(target => target.kind === 'dinner').map(target => target.key));
      const incoming = response.state.entries.filter(row => row.section === 'planned_day');
      if (incoming.length) {
        const plan = JSON.parse(storage.getItem(localPlanKey));
        for (const row of incoming) if (!protectedDinners.has(row.entry_key)) plan[row.entry_key] = row.value.recipeId;
        storage.setItem(localPlanKey, JSON.stringify(plan));
      }
      return true;
    }
  });
  await f.engine.initialize();
  remote.intercept = async () => { throw new Error('Offline'); };
  const previous = f.engine.capture(pantry, stock(2));
  await drain(f.engine);
  storage.setItem(localPlanKey, JSON.stringify(localPlan));
  const savedPlan = storage.getItem(localPlanKey), before = storage.snapshot();
  const priorPending = f.engine.read().pending;
  storage.failWrites = true;
  const captured = f.engine.captureMany(changes);
  assert.equal(captured.queued, false);
  assert.equal(storage.getItem(localPlanKey), savedPlan, 'the successful local plan save remains intact');
  assert.deepEqual(storage.snapshot(), before, 'failed atomic outbox persistence cannot delete or replace prior data');
  assert.deepEqual(f.engine.read().pending, priorPending, 'none of the failed batch becomes durable');
  for (const { target } of changes) assert.ok(f.engine.read().pendingTargets.some(pending => pending.kind === target.kind && pending.key === target.key), target.key);
  await drain(f.engine);
  assert.deepEqual(new Set(reserves(remote).map(call => call.payload.operationId)), new Set([previous.operationId]), 'failed batch IDs are never uploaded');

  storage.failWrites = false;
  const snapshot = remote.snapshot;
  remote.snapshot = () => {
    const response = snapshot();
    response.state.entries = changes.map(({ target }) => ({ section: 'planned_day', entry_key: target.key, value: { recipeId: 'remote-old-dinner' }, revision: 1 }));
    return response;
  };
  remote.intercept = async (action, payload, perform) => {
    if (action === 'sync_reserve') throw new Error('Offline write');
    return perform(action, payload);
  };
  f.current.identity = { ...f.current.identity, token: 'refreshed-after-quota-failure' };
  await f.engine.refresh();
  const appliedTargets = f.applied.at(-1).pendingTargets;
  for (const { target } of changes) assert.ok(appliedTargets.some(pending => pending.kind === target.kind && pending.key === target.key), `refresh protects ${target.key}`);
  assert.deepEqual(JSON.parse(storage.getItem(localPlanKey)), localPlan, 'incoming remote dinners cannot overwrite any locally saved day');
  assert.deepEqual(new Set(reserves(remote).map(call => call.payload.operationId)), new Set([previous.operationId]));
  assert.ok(f.notifications.length > 0);
  f.engine.destroy();
});
