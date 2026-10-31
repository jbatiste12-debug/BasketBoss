import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bb-account-deletion.js', import.meta.url), 'utf8');
const SESSION = 'basketboss_cloud_session_v1';
const LOCK = 'basketboss_account_deletion_v1';
const actor = { actorId: 'user-a', token: 'synthetic-token-a', email: 'example@example.test' };
function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return { get length() { return map.size; }, key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), map };
}
function session(value = actor) {
  return JSON.stringify({ user: { id: value.actorId, email: value.email }, access_token: value.token, expires_at: 9999999999 });
}
function harness(fetcher, extras = {}) {
  const local = storage({ [SESSION]: session(), basketboss_321_unified_state_v1: 'meal plan', bb_onboarding: 'seen', unrelated_app: 'keep' });
  const tab = storage({ basketboss_welcome_splash_seen_v1: 'seen', unrelated_tab: 'keep' });
  const events = [], redirects = [], listeners = new Map();
  const host = { localStorage: local, sessionStorage: tab, fetch: fetcher, URL, AbortController,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent: event => { events.push(event); for (const handler of listeners.get(event.type) || []) handler(event); },
    addEventListener: (type, handler) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
    removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
    location: { href: 'https://basketboss.co.uk/app', protocol: 'https:', replace: url => redirects.push(url) },
    setTimeout, clearTimeout, ...extras };
  const context = vm.createContext({ window: host, URL });
  vm.runInContext(source, context);
  const api = host.BBAccountDeletionFactory({ root: host, document: null });
  const remove = values => api.requestDeletion({ password: 'synthetic-password', confirmation: 'DELETE', acknowledged: true, expectedSession: actor, ...values });
  return { api, host, local, tab, events, redirects, remove };
}
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('deletion requires the signed-in actor, typed confirmation, acknowledgement and password', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return response(200, { ok: true, deleted: true }); });
  for (const input of [{ confirmation: 'delete' }, { acknowledged: false }, { password: '' }, { expectedSession: { ...actor, actorId: 'user-b' } }, { expectedSession: { ...actor, token: 'stale-token' } }]) {
    assert.equal((await h.remove(input)).ok, false);
  }
  assert.equal(calls, 0);
  assert.equal(h.local.getItem('basketboss_321_unified_state_v1'), 'meal plan');
});

test('a verified success uses bearer reauthentication and clears only BasketBoss data and caches', async () => {
  const deletedCaches = [], unregistered = [], calls = [];
  const registrations = [
    { scope: 'https://basketboss.co.uk/', active: { scriptURL: 'https://basketboss.co.uk/service-worker.js' }, unregister: async () => unregistered.push('basketboss') },
    { scope: 'https://basketboss.co.uk/other/', active: { scriptURL: 'https://basketboss.co.uk/other/service-worker.js' }, unregister: async () => unregistered.push('other') },
    { scope: 'https://basketboss.co.uk/', active: { scriptURL: 'https://basketboss.co.uk/unrelated-worker.js' }, unregister: async () => unregistered.push('unrelated') }
  ];
  const h = harness(async (url, init) => { calls.push({ url, init }); return response(200, { ok: true, deleted: true }); }, {
    caches: { keys: async () => ['basketboss-premium-shell', 'basketboss-v-images', 'bb-owned-cache', 'unrelated-cache'], delete: async key => deletedCaches.push(key) },
    navigator: { serviceWorker: { getRegistrations: async () => registrations } }
  });
  const result = await h.remove();
  assert.equal(result.deleted, true);
  assert.equal(result.localCleared, true);
  assert.equal(calls[0].url, '/api/account/delete');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-token-a');
  assert.deepEqual(JSON.parse(calls[0].init.body), { confirmation: 'DELETE', password: 'synthetic-password' });
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual([...h.local.map], [['unrelated_app', 'keep']]);
  assert.deepEqual([...h.tab.map], [['unrelated_tab', 'keep']]);
  assert.deepEqual(deletedCaches, ['basketboss-premium-shell', 'basketboss-v-images', 'bb-owned-cache']);
  assert.deepEqual(unregistered, ['basketboss']);
  assert.deepEqual(h.redirects, ['https://basketboss.co.uk/app']);
  assert.deepEqual(h.events.map(event => event.type), ['basketboss:account-deletion-started', 'basketboss:account-deletion-deleted']);
});

test('a rejected password or deletion request keeps the account and local data', async () => {
  const h = harness(async () => response(401, { ok: false, error: 'Reauthentication failed' }));
  const result = await h.remove();
  assert.equal(result.ok, false);
  assert.equal(result.pending, false);
  assert.equal(h.api.isDeleting(), false);
  assert.equal(h.local.getItem(LOCK), null);
  assert.equal(h.local.getItem(SESSION), session());
  assert.equal(h.local.getItem('basketboss_321_unified_state_v1'), 'meal plan');
  assert.deepEqual(h.redirects, []);
  assert.deepEqual(h.events.map(event => event.type), ['basketboss:account-deletion-started', 'basketboss:account-deletion-cancelled']);
});

test('an accepted but pending deletion keeps device data and blocks further writes until retry succeeds', async () => {
  let calls = 0;
  const h = harness(async () => ++calls === 1 ? response(503, { ok: false, pending: true }) : response(200, { ok: true, deleted: true }));
  const result = await h.remove();
  assert.equal(result.pending, true);
  assert.equal(h.api.isDeleting(), true);
  assert.equal(h.local.getItem('basketboss_321_unified_state_v1'), 'meal plan');
  assert.equal(JSON.parse(h.local.getItem(LOCK)).actorId, actor.actorId);
  assert.deepEqual(h.redirects, []);
  assert.equal((await h.remove()).deleted, true);
  assert.equal(h.local.getItem(SESSION), null);
});

test('unknown network outcomes and malformed success responses never erase local data', async () => {
  for (const fetcher of [async () => { throw new Error('Connection lost'); }, async () => response(200, { ok: true }), async () => response(502, null)]) {
    const h = harness(fetcher);
    const result = await h.remove();
    assert.equal(result.ok, false);
    assert.equal(result.pending, true);
    assert.equal(h.api.isDeleting(), true);
    assert.equal(h.local.getItem('basketboss_321_unified_state_v1'), 'meal plan');
    assert.deepEqual(h.redirects, []);
  }
});

test('an account switch during the request cannot clear the newly signed-in account data', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const task = h.remove();
  h.local.setItem(SESSION, session({ actorId: 'user-b', token: 'synthetic-token-b', email: 'new@example.test' }));
  h.local.setItem('basketboss_321_unified_state_v1', 'new account meal plan');
  finish(response(200, { ok: true, deleted: true }));
  assert.equal((await task).reason, 'account_changed');
  assert.equal(h.local.getItem('basketboss_321_unified_state_v1'), 'new account meal plan');
  assert.deepEqual(h.redirects, []);
});

test('multiple submit attempts share one server request', async () => {
  let calls = 0, finish;
  const h = harness(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = h.remove(), second = h.remove();
  assert.equal(calls, 1);
  finish(response(200, { ok: true, deleted: true }));
  assert.equal((await first).deleted, true);
  assert.equal((await second).deleted, true);
  assert.equal(calls, 1);
});

test('native success returns to a bundled local page', async () => {
  const h = harness(async () => response(200, { ok: true, deleted: true }), {
    BBNative: { isNative: true }, location: { href: 'capacitor://localhost/index.html?old=account#settings', protocol: 'capacitor:', replace: () => {} }
  });
  assert.equal(h.api.freshURL(), 'capacitor://localhost/index.html');
});

test('cleanup failures report an already-deleted account without claiming all device data is gone', async () => {
  const h = harness(async () => response(200, { ok: true, deleted: true }), { caches: { keys: async () => { throw new Error('Storage unavailable'); } } });
  const result = await h.remove();
  assert.equal(result.deleted, true);
  assert.equal(result.localCleared, false);
  assert.equal(h.api.isDeleting(), true);
  assert.deepEqual(h.redirects, []);
});

test('an expired token can only resume a saved deletion for the same actor', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return response(200, { ok: true, deleted: true }); });
  const expired = JSON.parse(session()); expired.expires_at = 1;
  h.local.setItem(SESSION, JSON.stringify(expired));
  assert.equal(h.api.readSession(), null);
  assert.equal((await h.remove()).reason, 'account_changed');
  h.local.setItem(LOCK, JSON.stringify({ actorId: 'different-user', phase: 'pending' }));
  assert.equal(h.api.readSession(), null);
  h.local.setItem(LOCK, JSON.stringify({ actorId: actor.actorId, phase: 'pending' }));
  assert.equal(h.api.readSession().actorId, actor.actorId);
  assert.equal((await h.remove()).deleted, true);
  assert.equal(calls, 1);
});

test('a fast cross-tab completion uses the event payload, clears per-tab data, and reloads behind its write barrier', async () => {
  const h = harness(async () => { throw new Error('No request expected'); });
  const api = h.host.BBAccountDeletionFactory({ root: h.host, document: { body: {}, getElementById: () => null } });
  api.start();
  // The deleting tab may have completed and removed shared localStorage before
  // this tab's queued storage events run. Their exact newValue remains available.
  h.local.removeItem(SESSION); h.local.removeItem('basketboss_321_unified_state_v1');
  h.host.dispatchEvent({ type: 'storage', key: LOCK, newValue: JSON.stringify({ actorId: actor.actorId, phase: 'deleting' }) });
  assert.equal(api.isDeleting(), true);
  h.host.dispatchEvent({ type: 'storage', key: SESSION, newValue: null });
  h.host.dispatchEvent({ type: 'storage', key: LOCK, newValue: JSON.stringify({ actorId: actor.actorId, phase: 'deleted' }) });
  h.host.dispatchEvent({ type: 'storage', key: LOCK, newValue: null });
  await new Promise(setImmediate);
  assert.equal(api.isDeleting(), true);
  assert.deepEqual([...h.tab.map], [['unrelated_tab', 'keep']]);
  assert.deepEqual([...h.local.map], [['unrelated_app', 'keep']]);
  assert.deepEqual(h.redirects, ['https://basketboss.co.uk/app']);
  assert.ok(h.events.some(event => event.type === 'basketboss:account-deletion-deleted' && event.detail.crossTab));
  api.stop();
});

test('a cross-tab completion for another actor does not erase this actor data', async () => {
  const h = harness(async () => { throw new Error('No request expected'); });
  const api = h.host.BBAccountDeletionFactory({ root: h.host, document: { body: {}, getElementById: () => null } });
  api.start();
  h.host.dispatchEvent({ type: 'storage', key: LOCK, newValue: JSON.stringify({ actorId: 'different-user', phase: 'deleted' }) });
  await new Promise(setImmediate);
  assert.equal(h.local.getItem(SESSION), session());
  assert.equal(h.tab.getItem('basketboss_welcome_splash_seen_v1'), 'seen');
  assert.deepEqual(h.redirects, []);
  api.stop();
});

test('native temporary receipt photo cleanup is awaited before reopening', async () => {
  let finish, invoked = false;
  const h = harness(async () => response(200, { ok: true, deleted: true }), {
    BBNative: { isNative: true, clearTemporaryData: () => { invoked = true; return new Promise(resolve => { finish = resolve; }); } }
  });
  const task = h.remove();
  await new Promise(setImmediate);
  assert.equal(invoked, true);
  assert.deepEqual(h.redirects, []);
  finish({ ok: true });
  assert.equal((await task).localCleared, true);
  assert.equal(h.redirects.length, 1);
});

test('native temporary photo failures report partial cleanup after account deletion', async () => {
  for (const clearTemporaryData of [async () => { throw new Error('Native cleanup failed'); }, async () => ({ ok: false })]) {
    const h = harness(async () => response(200, { ok: true, deleted: true }), { BBNative: { isNative: true, clearTemporaryData } });
    const result = await h.remove();
    assert.equal(result.deleted, true);
    assert.equal(result.localCleared, false);
    assert.deepEqual(h.redirects, []);
  }
});

test('native temporary photo cleanup never runs on an unconfirmed deletion', async () => {
  let calls = 0;
  const h = harness(async () => response(503, { ok: false, pending: true }), { BBNative: { isNative: true, clearTemporaryData: async () => { calls++; } } });
  assert.equal((await h.remove()).pending, true);
  assert.equal(calls, 0);
});

test('a completed deletion resumes device cleanup after tab closure even if its JWT expired', async () => {
  const h = harness(async () => { throw new Error('No additional deletion request expected'); });
  const expired = JSON.parse(session()); expired.expires_at = 1;
  h.local.setItem(SESSION, JSON.stringify(expired));
  h.local.setItem(LOCK, JSON.stringify({ actorId: actor.actorId, phase: 'deleted' }));
  const api = h.host.BBAccountDeletionFactory({ root: h.host, document: { body: {}, getElementById: () => null } });
  api.start();
  await new Promise(setImmediate);
  assert.equal(api.isDeleting(), true);
  assert.equal(h.local.getItem(SESSION), null);
  assert.deepEqual(h.redirects, ['https://basketboss.co.uk/app']);
});

test('a navigation failure after confirmed deletion never reports the account as undeleted', async () => {
  const h = harness(async () => response(200, { ok: true, deleted: true }), { location: { href: 'https://basketboss.co.uk/app', replace: () => { throw new Error('Navigation unavailable'); } } });
  const result = await h.remove();
  assert.equal(result.deleted, true);
  assert.equal(result.localCleared, true);
  assert.equal(h.local.getItem(SESSION), null);
  assert.equal(h.events.filter(event => event.type === 'basketboss:account-deletion-cancelled').length, 0);
});


test('a definite pre-intent service rejection releases syncing and preserves every saved device record', async () => {
  const h = harness(async () => response(503, { ok: false, pending: false, code: 'deletion_not_ready', error: 'synthetic private upstream error' }));
  // This can repair a false pending lock made by an older UI, but only after the
  // server confirms that this actor has no deletion in progress.
  h.local.setItem(LOCK, JSON.stringify({ actorId: actor.actorId, phase: 'pending' }));
  const before = [...h.local.map].filter(([key]) => key !== LOCK);
  const result = await h.remove();
  assert.equal(result.pending, false); assert.equal(h.api.isDeleting(), false);
  assert.equal(h.local.getItem(LOCK), null); assert.deepEqual([...h.local.map], before);
  assert.match(result.message, /not available yet/); assert.match(result.message, /syncing can continue/);
  assert.doesNotMatch(result.message, /synthetic private|upstream/);
  assert.deepEqual(h.events.map(event => event.type), ['basketboss:account-deletion-started', 'basketboss:account-deletion-cancelled']);
  assert.deepEqual(h.redirects, []);
});

test('fixed pending stages explain the blocked step without showing provider text or clearing local data', async () => {
  const stages = {
    deletion_auth_unavailable: /We could not verify your sign-in right now/,
    deletion_state_unknown: /confirm your account deletion status/,
    deletion_checkout_pending: /previous checkout/,
    deletion_billing_pending: /subscription check or cancellation/,
    deletion_cloud_pending: /cloud account and saved data/,
    deletion_database_pending: /deleting your saved account data/,
    deletion_not_ready: /temporarily unavailable/,
    deletion_password_required: /password could not be verified/
  };
  for (const [code, expected] of Object.entries(stages)) {
    const h = harness(async () => response(code === 'deletion_password_required' ? 403 : 202, { ok: false, pending: true, code, error: 'synthetic-secret-provider-body' }));
    const result = await h.remove();
    assert.equal(result.pending, true); assert.equal(result.code, code); assert.match(result.message, expected);
    assert.match(result.message, /saved device data has been kept and syncing is paused/);
    assert.doesNotMatch(result.message, /synthetic-secret|provider-body/);
    assert.equal(h.api.isDeleting(), true); assert.equal(h.local.getItem('basketboss_321_unified_state_v1'), 'meal plan');
    assert.equal(h.local.getItem(SESSION), session()); assert.deepEqual(h.redirects, []);
    assert.equal(h.events.filter(event => event.type === 'basketboss:account-deletion-cancelled').length, 0);
  }
});

test('unknown or contradictory responses cannot release a saved pending deletion lock', async () => {
  for (const [status, data] of [
    [503, { ok: false }],
    [401, { error: 'Sign in required' }],
    [403, { error: 'Password rejected' }],
    [200, { ok: false, pending: false }],
    [202, { ok: false, pending: false }],
    [503, { ok: false, pending: false, deletion_pending: true }],
    [503, { ok: true, pending: false }]
  ]) {
    const h = harness(async () => response(status, data));
    h.local.setItem(LOCK, JSON.stringify({ actorId: actor.actorId, phase: 'pending' }));
    const result = await h.remove();
    assert.equal(result.pending, true, JSON.stringify({ status, data })); assert.equal(h.api.isDeleting(), true);
    assert.equal(h.local.getItem('basketboss_321_unified_state_v1'), 'meal plan'); assert.equal(h.local.getItem(SESSION), session());
  }
});

test('an unknown failure code and response body never become visible feedback', async () => {
  const h = harness(async () => response(202, { ok: false, pending: true, code: '<img src=x onerror=alert(1)>', error: 'private provider diagnostic' }));
  const result = await h.remove();
  assert.equal(result.pending, true); assert.equal(result.code, '');
  assert.match(result.message, /Deletion has not been confirmed yet/); assert.doesNotMatch(result.message, /<img|private provider|onerror/);
});


test('a sign-in provider outage is not presented as a rejected password', async () => {
  const h = harness(async () => response(503, { ok: false, pending: false, code: 'deletion_auth_unavailable', error: 'supabase private diagnostic' }));
  const result = await h.remove();
  assert.equal(result.pending, false); assert.equal(h.api.isDeleting(), false);
  assert.match(result.message, /We could not verify your sign-in right now/); assert.match(result.message, /syncing can continue/);
  assert.doesNotMatch(result.message, /password or session could not be verified|supabase|private diagnostic/);
  assert.equal(h.local.getItem(SESSION), session());
});
