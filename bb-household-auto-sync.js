/* BasketBoss household auto-sync outbox. Only explicit captured edits are sent.
 * adapter.apply receives the complete auto_sync response and pending targets.
 * prepareMany returns JSON values for an existing atomic local-storage commit;
 * commit its updates synchronously or call flush after a later async commit.
 * pendingTargets is [{kind, key}] using the literal canonical target keys.
 * Async host backups/applies must pin their own identity and local revision
 * before writing. reset/destroy invalidate work and preserve the durable queue.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BBHouseholdAutoSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PREFIX = 'bb_partner_auto_v2_';
  const MAX_PENDING = 256;
  const MAX_ACKNOWLEDGED = 256;
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const count = value => Number.isInteger(value) && value >= 1 && value <= 12;

  function validatedChange(target, value) {
    if (!object(target) || typeof target.key !== 'string' || !target.key || target.key.length > 200 || /[\u0000-\u001f]/.test(target.key))
      throw new Error('Invalid household sync target.');
    const nextTarget = {kind: target.kind, key: target.key};
    let nextValue;
    const deleted = value === null || object(value) && value.deleted === true;
    if (target.kind === 'dinner') {
      if (!object(value) || !(value.recipeId === null || typeof value.recipeId === 'string' && value.recipeId.length > 0 && value.recipeId.length <= 256) ||
          !(value.servings === null || count(value.servings))) throw new Error('Invalid shared dinner.');
      nextValue = {recipeId: value.recipeId, servings: value.recipeId === null ? null : value.servings};
    } else if (target.kind === 'pantry') {
      if (target.key.length > 180 || !object(value) || typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity < 0 || value.quantity > 1000000 ||
          !['cupboard', 'fridge', 'freezer'].includes(value.location)) throw new Error('Invalid shared pantry item.');
      nextValue = {quantity: value.quantity, location: value.location};
    } else if (target.kind === 'setting') {
      if (target.key === 'household_servings:default') {
        if (!(deleted || object(value) && count(value.count))) throw new Error('Invalid household servings.');
        nextValue = deleted ? {deleted: true} : {count: value.count};
      } else if (target.key === 'budget_target:weekly') {
        if (!(deleted || object(value) && typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 1 && value.amount <= 10000))
          throw new Error('Invalid weekly budget.');
        nextValue = deleted ? {deleted: true} : {amount: value.amount};
      } else if (/^shopping_checked:.+/.test(target.key)) {
        if (target.key.slice('shopping_checked:'.length).length > 180 || !(deleted || typeof value === 'boolean')) throw new Error('Invalid shopping checkmark.');
        nextValue = deleted ? {deleted: true} : value;
      } else throw new Error('Unsupported household setting.');
    } else throw new Error('Unsupported household sync target.');
    return {target: nextTarget, value: nextValue};
  }

  function defaultUUID() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure operation IDs are unavailable.');
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function createEngine(adapter) {
    if (!adapter || !adapter.storage || typeof adapter.identity !== 'function' || typeof adapter.request !== 'function' || typeof adapter.apply !== 'function')
      throw new TypeError('Household auto-sync requires storage, identity, request and apply adapters.');
    const storage = adapter.storage;
    let generation = 0, context = null, destroyed = false, capability = 0, requireHandshake = false;
    let lastError = null, latest = null, serial = Promise.resolve();
    const unqueuedTargets = new Map();
    let flushJob = null, refreshJob = null, scheduled = false, busy = 0;

    const isBlocked = () => { try { return adapter.blocked?.() === true; } catch (_) { return true; } };
    function identity() {
      try {
        const value = adapter.identity();
        if (!value || !['actor', 'token', 'householdId'].every(key => typeof value[key] === 'string' && value[key])) return null;
        return {actor: value.actor, token: value.token, householdId: value.householdId};
      } catch (_) { return null; }
    }
    const sameIdentity = (left, right) => !!left && !!right && left.actor === right.actor && left.token === right.token && left.householdId === right.householdId;
    const storageKey = pin => PREFIX + encodeURIComponent(pin.actor) + ':' + encodeURIComponent(pin.householdId);
    const valid = pin => !destroyed && !isBlocked() && !!pin && pin.generation === generation && sameIdentity(pin, context) && sameIdentity(pin, identity());
    function notify(type, message) {
      try { adapter.notify?.({type, message}); } catch (_) {}
    }
    function failure(reason, message) {
      lastError = {reason, message};
      notify(reason, message);
      return {queued: false, reason};
    }
    function emptyDocument(pin) {
      return {version: 2, actor: pin.actor, householdId: pin.householdId, protocol: capability, clock: 0, pruneFloor: 0, pending: [], acknowledged: []};
    }
    function parseDocument(raw, pin) {
      if (raw === null) return emptyDocument(pin);
      const doc = JSON.parse(raw);
      if (!object(doc) || doc.version !== 2 || doc.actor !== pin.actor || doc.householdId !== pin.householdId ||
          ![0, 2].includes(doc.protocol) || !integer(doc.clock) || !integer(doc.pruneFloor) || !Array.isArray(doc.pending) || doc.pending.length > MAX_PENDING)
        throw new Error('Saved household edits are unreadable.');
      const ids = new Set();
      for (const operation of doc.pending) {
        if (!object(operation) || typeof operation.id !== 'string' || !uuidPattern.test(operation.id) || ids.has(operation.id) || !(operation.baseClock === null || integer(operation.baseClock)) ||
            !(operation.order === null || integer(operation.order) && operation.order > 0)) throw new Error('Saved household edits are unreadable.');
        validatedChange(operation.target, operation.value);
        ids.add(operation.id);
      }
      if (doc.acknowledged === undefined) doc.acknowledged = [];
      if (!Array.isArray(doc.acknowledged) || doc.acknowledged.length > MAX_ACKNOWLEDGED) throw new Error('Saved household acknowledgements are unreadable.');
      const acknowledgedTargets = new Set();
      for (const proof of doc.acknowledged) {
        if (!object(proof) || typeof proof.id !== 'string' || !uuidPattern.test(proof.id) || ids.has(proof.id) || !integer(proof.order) || proof.order < 1)
          throw new Error('Saved household acknowledgements are unreadable.');
        validatedChange(proof.target, proof.value);
        const target = proof.target.kind + '\u001f' + proof.target.key;
        if (acknowledgedTargets.has(target)) throw new Error('Saved household acknowledgements are unreadable.');
        acknowledgedTargets.add(target);
        ids.add(proof.id);
      }
      return doc;
    }
    function load(pin) {
      if (!valid(pin)) return null;
      try {
        const key = storageKey(pin), raw = storage.getItem(key);
        const doc = parseDocument(raw, pin);
        if (!valid(pin)) return null;
        if (doc.protocol === 2 && !requireHandshake) capability = 2;
        return {key, raw, doc};
      } catch (error) {
        failure('storage', error?.message || 'Saved household edits could not be read.');
        return null;
      }
    }
    function ensureContext() {
      if (destroyed) return null;
      const next = identity();
      if (!sameIdentity(context, next)) {
        const sameScope = context && next && context.actor === next.actor && context.householdId === next.householdId;
        if (context) requireHandshake = true;
        generation++;
        context = next;
        capability = 0;
        latest = null;
        lastError = null;
        if (!sameScope) unqueuedTargets.clear();
      }
      if (!next || isBlocked()) return null;
      const pin = {...next, generation};
      load(pin);
      return pin;
    }
    function targets(doc) {
      const seen = new Set(), result = [];
      for (const operation of doc?.pending || []) {
        const key = operation.target.kind + '\u001f' + operation.target.key;
        if (!seen.has(key)) { seen.add(key); result.push(clone(operation.target)); }
      }
      for (const [key, target] of unqueuedTargets) if (!seen.has(key)) result.push(clone(target));
      return result;
    }
    function read() {
      const pin = ensureContext(), record = pin && load(pin);
      return {
        ok: !!record && capability === 2 && record.doc.pending.length === 0 && record.doc.acknowledged.length === 0 && !unqueuedTargets.size && !latest && !lastError,
        queued: !!record?.doc.pending.length,
        ready: !!record && capability === 2,
        busy: busy > 0,
        pending: record ? clone(record.doc.pending) : [],
        acknowledged: record ? clone(record.doc.acknowledged) : [],
        pendingTargets: targets(record?.doc),
        pendingApply: !!latest || !!record?.doc.acknowledged.length,
        lastError: lastError && {...lastError},
        identity: pin ? {actor: pin.actor, householdId: pin.householdId} : null
      };
    }
    function write(pin, record, doc) {
      if (!valid(pin)) return false;
      try {
        if (storage.getItem(record.key) !== record.raw) {
          failure('changed', 'Saved household edits changed before this update could be queued.');
          return false;
        }
        storage.setItem(record.key, JSON.stringify(doc));
        return valid(pin);
      } catch (_) {
        failure('storage', 'This edit was saved on this device, but could not be queued for household sync. Free some device storage and try the edit again.');
        return false;
      }
    }
    function enqueue(task) {
      busy++;
      const result = serial.then(task, task);
      serial = result.catch(() => {});
      return result.finally(() => { busy--; });
    }
    function scheduleFlush() {
      if (scheduled || destroyed) return;
      scheduled = true;
      Promise.resolve().then(() => {
        scheduled = false;
        if (!destroyed) void flush(true);
      });
    }
    function prepareMany(changes) {
      const pin = ensureContext();
      if (!pin) return failure('blocked', 'Household sync is unavailable for the current account.');
      const record = load(pin);
      if (!record) return {queued: false, reason: 'storage'};
      if (capability !== 2 && adapter.allowStaging !== true) return failure('not-ready', 'Household sync is still checking this account.');
      if (!Array.isArray(changes)) return failure('invalid', 'No household edits were supplied.');
      if (!changes.length) return {queued: true, updates: {}, expected: {}, operationIds: []};
      if (record.doc.pending.length + changes.length > MAX_PENDING) return failure('queue-full', 'Household sync has too many saved edits. Reconnect before making another shared edit.');
      const doc = clone(record.doc), ids = new Set([...doc.pending, ...doc.acknowledged].map(operation => operation.id)), operationIds = [];
      try {
        for (const change of changes) {
          if (!object(change)) throw new Error('Invalid household edit.');
          const normalized = validatedChange(change.target, change.value);
          const id = (adapter.uuid || defaultUUID)();
          if (typeof id !== 'string' || !uuidPattern.test(id) || ids.has(id)) throw new Error('A unique household operation ID is required.');
          ids.add(id);
          operationIds.push(id);
          doc.pending.push({id, baseClock: capability === 2 ? doc.clock : null, order: null, target: normalized.target, value: normalized.value});
        }
      } catch (error) { return failure('invalid', error?.message || 'Invalid household edit.'); }
      try {
        if (!valid(pin) || storage.getItem(record.key) !== record.raw) return failure('changed', 'Household sync changed while preparing this edit.');
      } catch (_) { return failure('storage', 'Saved household edits could not be read.'); }
      doc.protocol = capability;
      // The caller commits these values with its local edit. The microtask reads
      // storage again, so an abandoned/rolled-back preparation cannot be sent.
      scheduleFlush();
      return {queued: true, updates: {[record.key]: doc}, expected: {[record.key]: record.raw}, operationIds,
        ...(operationIds.length === 1 ? {operationId: operationIds[0]} : {})};
    }
    const prepareCapture = (target, value) => prepareMany([{target, value}]);
    function protectChanges(pin, changes) {
      if (!valid(pin) || !Array.isArray(changes)) return;
      for (const change of changes) {
        try {
          const {target} = validatedChange(change?.target, change?.value);
          unqueuedTargets.set(target.kind + '\u001f' + target.key, target);
        } catch (_) {}
      }
    }
    function captureMany(changes) {
      // The host has already saved these explicit edits. Capture their outbox
      // in one write, and protect every target if durable queuing is blocked.
      const pin = ensureContext(), prepared = prepareMany(changes);
      if (!prepared.queued) {
        if (['storage', 'queue-full', 'not-ready', 'changed'].includes(prepared.reason)) protectChanges(pin, changes);
        return prepared;
      }
      if (!prepared.operationIds.length) return {queued: true, operationIds: []};
      if (!valid(pin)) return failure('blocked', 'Household sync is unavailable for the current account.');
      const key = Object.keys(prepared.updates)[0];
      const record = {key, raw: prepared.expected[key]};
      if (!write(pin, record, prepared.updates[key])) {
        protectChanges(pin, changes);
        return {queued: false, reason: lastError?.reason || 'changed'};
      }
      for (const change of changes) unqueuedTargets.delete(change.target.kind + '\u001f' + change.target.key);
      lastError = null;
      return {queued: true, operationIds: prepared.operationIds,
        ...(prepared.operationId ? {operationId: prepared.operationId} : {})};
    }
    const capture = (target, value) => captureMany([{target, value}]);
    function operationReply(response, operation) {
      if (!response || response.ok !== true || !object(response.operation) || response.operation.id !== operation.id ||
          !(response.operation.status === 'expired' && response.operation.order === null || integer(response.operation.order) && response.operation.order > 0) ||
          !['reserved', 'applied', 'superseded', 'expired'].includes(response.operation.status)) throw new Error('Invalid household operation acknowledgement.');
      if (response.operation.status !== 'expired' && operation.order !== null && response.operation.order !== operation.order) throw new Error('Household operation order changed.');
      return response.operation;
    }
    const sameIntent = (left, right) => left.id === right.id && left.baseClock === right.baseClock &&
      JSON.stringify(left.target) === JSON.stringify(right.target) && JSON.stringify(left.value) === JSON.stringify(right.value);
    function updateOperation(pin, id, updater, expected) {
      const record = load(pin);
      if (!record) return false;
      const index = record.doc.pending.findIndex(operation => operation.id === id);
      if (index < 0) return false;
      if (expected && (!sameIntent(record.doc.pending[index], expected) || expected.order !== null && record.doc.pending[index].order !== expected.order)) {
        failure('changed', 'This saved household edit changed before its acknowledgement arrived.');
        return false;
      }
      const doc = clone(record.doc), next = updater(doc.pending[index]);
      if (next === null) doc.pending.splice(index, 1); else doc.pending[index] = next;
      return write(pin, record, doc);
    }
    function completeOperation(pin, operation, reply) {
      const record = load(pin);
      if (!record) return false;
      const index = record.doc.pending.findIndex(saved => saved.id === operation.id), saved = record.doc.pending[index];
      if (!saved) return false;
      if (!sameIntent(saved, operation) || operation.order !== null && saved.order !== operation.order ||
          reply.status !== 'expired' && saved.order !== null && saved.order !== reply.order) {
        failure('changed', 'This saved household edit changed before its acknowledgement arrived.');
        return false;
      }
      const doc = clone(record.doc);
      if (reply.status === 'applied' || reply.status === 'superseded') {
        const proof = {id: operation.id, order: reply.order, target: clone(operation.target), value: clone(operation.value)};
        const existing = doc.acknowledged.findIndex(item => item.target.kind === proof.target.kind && item.target.key === proof.target.key);
        if (existing < 0) {
          if (doc.acknowledged.length >= MAX_ACKNOWLEDGED) {
            failure('proof-full', 'Household changes are waiting to appear on this device. Finish the current screen before syncing more edits.');
            return false;
          }
          doc.acknowledged.push(proof);
        } else if (doc.acknowledged[existing].order <= proof.order) doc.acknowledged[existing] = proof;
        doc.clock = Math.max(doc.clock, proof.order);
      }
      doc.pending.splice(index, 1);
      // Removal and its original-value proof are one durable transaction. A
      // quota failure leaves the pending UUID/order available for safe retry.
      return write(pin, record, doc);
    }
    const expiredError = error => error?.status === 410 || ['operation_expired', 'sync_operation_expired', 'sync_expired'].includes(error?.code || error?.data?.code);
    async function applyLatest(pin) {
      const response = latest;
      if (!response || !valid(pin)) return false;
      const before = load(pin);
      if (!before || response.clock < before.doc.clock) return false;
      try {
        // The host also pins any asynchronous work inside its backup/apply.
        await adapter.backup?.();
        if (!valid(pin)) return false;
        const current = load(pin);
        if (!current || !valid(pin)) return false;
        if (response.clock < current.doc.clock) return false;
        const acknowledged = current.doc.acknowledged.filter(proof => proof.order <= response.clock);
        const applied = await adapter.apply(clone(response), targets(current.doc), {acknowledged: clone(acknowledged)});
        if (!valid(pin)) return false;
        if (applied === true && acknowledged.length) {
          const after = load(pin);
          if (!after || !valid(pin)) return false;
          const consumed = new Set(acknowledged.map(proof => proof.id));
          const remaining = after.doc.acknowledged.filter(proof => !consumed.has(proof.id));
          if (remaining.length !== after.doc.acknowledged.length && !write(pin, after, {...after.doc, acknowledged: remaining})) return false;
        }
        if (applied === true && latest === response) latest = null;
        return applied === true;
      } catch (error) {
        if (valid(pin)) failure('apply', error?.message || 'Shared changes will be applied when this device is ready.');
        return false;
      }
    }
    async function fetchLatest(pin) {
      const before = load(pin);
      if (!before || !valid(pin)) return false;
      let response;
      try { response = await adapter.request('auto_sync', {expectedHouseholdId: pin.householdId}); }
      catch (error) {
        if (valid(pin)) failure('network', error?.message || 'Household sync will retry when a connection is available.');
        return false;
      }
      if (!valid(pin)) return false;
      if (!response || response.ok !== true || response.protocol !== 2 || response.household_id !== pin.householdId ||
          !integer(response.clock) || !integer(response.pruneFloor) || !object(response.state)) {
        capability = 0;
        requireHandshake = true;
        failure('unsupported', 'Automatic household sync is unavailable.');
        return false;
      }
      const record = load(pin);
      // Account deletion can remove the outbox while a GET is in flight.
      if (!record || before.raw !== null && record.raw === null) return false;
      if (response.clock < record.doc.clock) {
        failure('stale', 'An older household update was ignored. Sync will retry.');
        return false;
      }
      const doc = clone(record.doc);
      doc.protocol = 2;
      doc.clock = Math.max(doc.clock, response.clock);
      doc.pruneFloor = Math.max(doc.pruneFloor, response.pruneFloor);
      for (const operation of doc.pending) if (operation.baseClock === null) operation.baseClock = response.clock;
      if (!write(pin, record, doc) || !valid(pin)) return false;
      capability = 2;
      requireHandshake = false;
      latest = clone(response);
      lastError = null;
      return applyLatest(pin);
    }
    function refresh() {
      const pin = ensureContext();
      if (!pin) return Promise.resolve(read());
      if (refreshJob && refreshJob.generation === pin.generation) return refreshJob.promise;
      const job = {generation: pin.generation};
      job.promise = enqueue(async () => {
        if (latest && valid(pin)) await applyLatest(pin);
        if (valid(pin)) await fetchLatest(pin);
        return read();
      }).finally(() => { if (refreshJob === job) refreshJob = null; });
      refreshJob = job;
      return job.promise;
    }
    async function sendPending(pin) {
      let acknowledged = false;
      while (valid(pin)) {
        const record = load(pin), operation = record?.doc.pending[0];
        if (!operation || capability !== 2) break;
        try {
          if (operation.order === null) {
            const response = await adapter.request('sync_reserve', {
              expectedHouseholdId: pin.householdId, operationId: operation.id,
              baseClock: operation.baseClock, target: clone(operation.target), value: clone(operation.value)
            });
            if (!valid(pin)) return;
            const reply = operationReply(response, operation);
            if (reply.status !== 'reserved') {
              if (!completeOperation(pin, operation, reply)) break;
              acknowledged = true;
              continue;
            }
            // Never apply an order that has not been saved. A lost reserve
            // response is retried with this same immutable operation ID.
            if (!updateOperation(pin, operation.id, saved => {
              if (saved.order !== null && saved.order !== reply.order) throw new Error('Household operation order changed.');
              return {...saved, order: reply.order};
            }, operation)) break;
          }
          if (!valid(pin)) return;
          const saved = load(pin)?.doc.pending.find(item => item.id === operation.id);
          if (!saved || saved.order === null) break;
          const response = await adapter.request('sync_apply', {expectedHouseholdId: pin.householdId, operationId: saved.id, order: saved.order});
          if (!valid(pin)) return;
          const reply = operationReply(response, saved);
          if (reply.status === 'reserved') throw new Error('Household operation was not applied.');
          if (!completeOperation(pin, saved, reply)) break;
          acknowledged = true;
          lastError = null;
        } catch (error) {
          if (!valid(pin)) return;
          if (expiredError(error)) {
            if (!completeOperation(pin, operation, {status: 'expired', order: null})) break;
            acknowledged = true;
            continue;
          }
          failure('network', error?.message || 'This saved household edit will retry when a connection is available.');
          break;
        }
      }
      if (valid(pin) && (acknowledged || load(pin)?.doc.acknowledged.length)) await fetchLatest(pin);
    }
    function flush(fromCapture) {
      const pin = ensureContext();
      const record = pin && load(pin);
      const staged = adapter.allowStaging === true && record?.doc.pending.some(operation => operation.baseClock === null);
      if (!pin || !record || capability !== 2 && !staged) return Promise.resolve(read());
      if (flushJob && flushJob.generation === pin.generation) {
        if (fromCapture === true) flushJob.again = true;
        return flushJob.promise;
      }
      const job = {generation: pin.generation, again: false};
      job.promise = enqueue(async () => {
        if (valid(pin) && capability !== 2 && staged) await fetchLatest(pin);
        if (valid(pin)) await sendPending(pin);
        return read();
      }).finally(() => {
        if (flushJob !== job) return;
        flushJob = null;
        if (job.again && valid(pin) && load(pin)?.doc.pending.length) scheduleFlush();
      });
      flushJob = job;
      return job.promise;
    }
    async function initialize() {
      const pin = ensureContext();
      if (!pin) return read();
      await refresh();
      if (valid(pin) && capability === 2) await flush();
      return read();
    }
    function reset() {
      generation++;
      context = null;
      capability = 0;
      requireHandshake = true;
      latest = null;
      lastError = null;
      unqueuedTargets.clear();
    }
    function destroy() { reset(); destroyed = true; }
    return {initialize, read, capture, captureMany, prepareCapture, prepareMany, flush, refresh, reset, destroy};
  }
  return {createEngine, PREFIX, MAX_PENDING, MAX_ACKNOWLEDGED};
});
