import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../bb-receipt-host.js', import.meta.url), 'utf8');
const actorA = '11111111-1111-4111-8111-111111111111';
const actorB = '22222222-2222-4222-8222-222222222222';
const keys = {stock: 'basketboss_321_v7_measured_pantry', kitchen: 'basketboss_makeameal_v1_inventory', confirmed: 'basketboss_ui_next_confirmed_pantry_v1', ledger: 'basketboss_purchase_receipts_v1', owner: 'basketboss_receipt_projection_owner_v1'};
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));let fail = null;
  return {values, getItem: key => values.get(key) ?? null, setItem(key, value) {if (key === fail) {fail = null;throw Error('quota');}values.set(key, String(value));}, removeItem: key => values.delete(key), failNext(key) {fail = key;}};
}
class Element {
  constructor(tag) {this.tagName = tag.toUpperCase();this.children = [];this.events = {};this.dataset = {};this.attributes = {};this.value = '';this.textContent = '';this.disabled = false;}
  append(...children) {for (const child of children) {child.parent = this;this.children.push(child);}}
  setAttribute(key, value) {this.attributes[key] = value;}
  addEventListener(name, handler) {this.events[name] = handler;}
  removeAttribute(name) {delete this.attributes[name];}
  remove() {if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this);}
  close() {this.events.close?.();}
  showModal() {this.open = true;}
  focus() {}
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
function harness({stock = {}, actor = actorA, cached = null, document = false, status = {ok: true, available: true, premium: true}, fetch: fetcher} = {}) {
  let currentSession = actor === 'guest' ? null : {access_token: 'synthetic-token-' + actor, expires_at: 9999999999, user: {id: actor}};
  let currentCache = cached, pending = {}, essentials = [], currentContext = {market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current'};
  const store = storage({[keys.stock]: JSON.stringify(stock)}), events = {}, notices = [], calls = [], body = new Element('body');
  const doc = document ? {createElement: tag => new Element(tag), body, getElementById: () => null} : undefined;
  const inventory = {
    configure(value) {this.options = value;}, getCachedProjection: () => currentCache, getPendingConfirmation: () => pending,
    recoverLocalTransaction() {}, async synchronize() {calls.push('synchronize');return {ok: true, localApplied: true};},
    async retryPendingConfirmation() {calls.push('retry');pending = {};return {ok: true, localApplied: true};},
    async confirmPantry(value) {calls.push(value);return {ok: true, committed: true, localApplied: true, projection: {stock: value.stock}};}
  };
  const root = {localStorage: store, document: doc, Intl, Date, console, queueMicrotask, addEventListener: (name, fn) => {events[name] = fn;}};
  vm.runInNewContext(source, root, {filename: 'bb-receipt-host.js'});
  const options = {storage: store, document: doc, inventory, getSession: () => currentSession, getContext: () => currentContext,
    getStock: () => JSON.parse(store.getItem(keys.stock) || '{}'), getEssentials: () => essentials, setEssentials: value => {essentials = value;return true;},
    fetch: fetcher || (async address => {calls.push(address);return {ok: true, json: async () => status};}), notify: value => notices.push(value),
    onProjection() {}, openUpgrade() {calls.push('upgrade');}, openLegacy() {calls.push('legacy');}, now: () => Date.parse('2026-10-31T12:00:00Z')};
  const host = root.BBReceiptHostFactory(options);host.configure();
  return {host, inventory, store, calls, notices, body, root, helpers: root.BBReceiptHostHelpers, options, setSession(value) {currentSession = value;}, setActor(id) {currentSession = id === 'guest' ? null : {access_token: 'synthetic-token-' + id, user: {id}};}, setContext(value) {currentContext = {...currentContext, ...value};}, setCached(value) {currentCache = value;}, setPending(value) {pending = value;}, getEssentials: () => essentials, setEssentials(value) {essentials = value;}, event(name) {events[name]?.();}};
}

test('weekly receipt subtotals separate food/non-food and exclude other markets, old or unknown dates', () => {
  const {helpers} = harness();
  const row = {receiptId: 'r1', market: 'UK', currency: 'GBP', purchasedAt: '2026-10-30', foodSubtotal: 5, essentialsSubtotal: 2, receiptTotal: 6.5};
  const result = helpers.weeklyReceiptSummary({receipts: [row, {...row}, {...row, receiptId: 'old', purchasedAt: '2026-10-01'}, {...row, receiptId: 'us', market: 'US', currency: 'USD'}, {...row, receiptId: 'unknown', purchasedAt: null}], essentials: [{receiptId: 'r1', lineId: 'e1', name: 'Shampoo', market: 'UK', currency: 'GBP', purchasedAt: '2026-10-30', pricePaid: 2}]}, {market: 'UK'}, Date.parse('2026-10-31'));
  assert.equal(result.food, 5);assert.equal(result.nonFood, 2);assert.equal(result.paid, 6.5);assert.equal(result.receipts.length, 1);assert.equal(result.essentials[0].name, 'Shampoo');assert.equal(result.unallocated, 1);
});
test('unread actual receipt totals remain unknown rather than becoming zero paid', () => {
  const {helpers} = harness();const result = helpers.weeklyReceiptSummary({receipts: [{receiptId: 'r', market: 'UK', currency: 'GBP', purchasedAt: '2026-10-31', foodSubtotal: 4, essentialsSubtotal: 0, receiptTotal: null}]}, {market: 'UK'}, Date.parse('2026-10-31'));
  assert.equal(result.paid, null);assert.equal(result.incomplete, true);
});
test('reviewed net refunds reduce actual paid totals without allocating discounts to food or essentials', () => {
  const {helpers} = harness();const row = {market: 'UK', currency: 'GBP', purchasedAt: '2026-10-31', foodSubtotal: 0, essentialsSubtotal: 0};
  const result = helpers.weeklyReceiptSummary({receipts: [{...row, receiptId: 'purchase', foodSubtotal: 10, receiptTotal: 10}, {...row, receiptId: 'refund', receiptTotal: -3}]}, {market: 'UK'}, Date.parse('2026-10-31'));
  assert.equal(result.paid, 7);assert.equal(result.food, 10);assert.equal(result.nonFood, 0);assert.equal(result.incomplete, false);
});
test('US Sunday evening remains in the local shopping week after UTC has reached Monday', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const {helpers} = harness(), now = Date.parse('2026-11-02T01:00:00Z');
    const bounds = helpers.weekBounds(now);assert.equal(bounds.start, '2026-10-26');assert.equal(bounds.end, '2026-11-02');
    const row = {market: 'US', currency: 'USD', foodSubtotal: 4, essentialsSubtotal: 0, receiptTotal: 4};
    const result = helpers.weeklyReceiptSummary({receipts: [{...row, receiptId: 'sunday', purchasedAt: '2026-11-02T00:30:00Z'}, {...row, receiptId: 'monday', purchasedAt: '2026-11-02'}]}, {market: 'US'}, now);
    assert.equal(result.receipts.length, 1);assert.equal(result.receipts[0].receiptId, 'sunday');
  } finally {if (previous === undefined) delete process.env.TZ;else process.env.TZ = previous;}
});
test('guest and two signed-in accounts restore their own pantry and essentials without token snapshots', () => {
  const h = harness({stock: {'rice|g': 100}, actor: 'guest'});h.setEssentials([{name: 'Guest soap'}]);
  h.setActor(actorA);h.host.switchActor();assert.equal(h.store.getItem(keys.stock), null);assert.equal(h.getEssentials().length, 0);
  h.store.setItem(keys.stock, JSON.stringify({'pasta|g': 500}));h.setEssentials([{name: 'A shampoo'}]);
  h.setActor(actorB);h.host.switchActor();assert.equal(h.store.getItem(keys.stock), null);assert.equal(h.getEssentials().length, 0);
  h.store.setItem(keys.stock, JSON.stringify({'lentils|g': 200}));
  h.setActor(actorA);h.host.switchActor();assert.equal(JSON.parse(h.store.getItem(keys.stock))['pasta|g'], 500);assert.equal(h.getEssentials()[0].name, 'A shampoo');
  h.setActor('guest');h.host.switchActor();assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 100);assert.equal(h.getEssentials()[0].name, 'Guest soap');
  assert.ok([...h.store.values].every(([key, value]) => !key.startsWith('basketboss_receipt_host_snapshot_') || !value.includes('synthetic-token')));
});
test('quota failure rolls account switch back without clearing the previous pantry', () => {
  const h = harness({stock: {'rice|g': 100}});h.setEssentials([{name: 'Keep me'}]);
  h.store.setItem('basketboss_receipt_host_snapshot_v1:' + actorB, JSON.stringify({version: 1, actorId: actorB, values: {...Object.fromEntries(Object.values(keys).map(key => [key, null])), [keys.stock]: JSON.stringify({'rice|g': 200}), [keys.kitchen]: '{}'}, essentials: []}));
  h.store.failNext(keys.kitchen);h.setActor(actorB);
  assert.throws(() => h.host.switchActor(), /quota/);assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 100);assert.equal(h.getEssentials()[0].name, 'Keep me');
  assert.equal(JSON.parse(h.store.getItem(h.host.keys.actor)).actorId, actorA);
});
test('tampered account archive cannot restore authentication or unrelated local keys', () => {
  const h = harness();h.store.setItem('basketboss_cloud_session_v1', 'do-not-change');h.store.setItem('basketboss_receipt_host_snapshot_v1:' + actorB, JSON.stringify({version: 1, actorId: actorB, values: {...Object.fromEntries(Object.values(keys).map(key => [key, null])), basketboss_cloud_session_v1: 'bad'}}));h.setActor(actorB);
  assert.throws(() => h.host.switchActor(), /snapshot_invalid/);assert.equal(h.store.getItem('basketboss_cloud_session_v1'), 'do-not-change');
});
test('Free account opens upgrade; gated-off Premium retains existing price-only scanner', async () => {
  const free = harness({status: {ok: true, available: false, premium: false}});await free.host.open();assert.ok(free.calls.includes('upgrade'));assert.ok(!free.calls.includes('legacy'));
  const paid = harness({status: {ok: true, available: false, premium: true}});await paid.host.open();assert.ok(paid.calls.includes('legacy'));assert.ok(!paid.calls.includes('synchronize'));
});
test('late availability response cannot enable receipt inventory for another account', async () => {
  let resolve;const h = harness({fetch: () => new Promise(done => {resolve = done;})});const pending = h.host.refreshAvailability();
  h.setActor(actorB);h.host.switchActor();resolve({ok: true, json: async () => ({ok: true, available: true, premium: true})});await pending;assert.equal(h.host.getAvailability().available, false);assert.ok(!h.calls.includes('synchronize'));
});
test('pending receipt blocks legacy FinishShop and pantry deduction until recovery', async () => {
  const h = harness();h.setPending({receiptId: 'pending'});assert.equal(h.host.allowLegacyTransfer(), false);assert.equal(h.host.requiresPantryReview(), true);
  await h.host.recoverReceipt({retry: true});assert.ok(h.calls.includes('retry'));assert.equal(h.host.hasPendingConfirmation(), false);
});
test('an interrupted local projection journal also blocks legacy transfers', () => {
  const h = harness();h.store.setItem('basketboss_receipt_inventory_journal_v1:' + actorA, '{}');assert.equal(h.host.hasPendingConfirmation(), true);assert.equal(h.host.allowLegacyTransfer(), false);assert.equal(h.host.confirmLocalPantryReview().ok, false);
});
test('downgraded users can confirm local pantry without claiming cloud sync or clearing pending receipts', async () => {
  const cached = {scope: {kind: 'user', id: actorA}, inventoryRevision: 2, lastReceiptId: 'r1', pantryReview: {required: true, shopSessionId: 'shop-old'}};
  const h = harness({cached, status: {ok: true, available: false, premium: false}});
  h.store.setItem(keys.confirmed, JSON.stringify({version: 1, confirmedAt: '2026-10-31T12:00:00Z', items: [{name: 'rice', qty: 100, unit: 'g'}]}));
  assert.equal(h.host.requiresPantryReview(), true);assert.equal(h.host.confirmLocalPantryReview().ok, true);assert.equal(h.host.requiresPantryReview(), false);assert.equal(cached.pantryReview.required, true);assert.ok(!h.calls.some(x => typeof x === 'object'));
  h.setPending({receiptId: 'unresolved'});assert.equal(h.host.requiresPantryReview(), true);assert.equal(h.host.confirmLocalPantryReview().ok, false);
});
test('a new shopping session requires review of receipt-backed pantry and bounds legacy coverage by actor/scope', () => {
  const scope = {kind: 'user', id: actorA};const h = harness({cached: {scope, inventoryRevision: 3, lastReceiptId: 'r1', pantryReview: {required: false, shopSessionId: 'shop-current'}}});
  const marker = {receiptPantryConfirmedActor: actorA, receiptPantryConfirmedScope: 'user:' + actorA, receiptPantryConfirmedRevision: 3, receiptPantryConfirmedShopSessionId: 'shop-current'};
  assert.equal(h.host.requiresPantryReview(), false);assert.equal(h.host.coversLegacyCredit(marker), true);assert.equal(h.host.coversLegacyCredit({...marker, receiptPantryConfirmedActor: actorB}), false);
  h.setContext({shopSessionId: 'shop-next'});assert.equal(h.host.requiresPantryReview(), true);assert.equal(h.host.coversLegacyCredit(marker), false);
});

function pantryHarness({scope = {kind: 'user', id: actorA}, revision = 2} = {}) {
  const data = {ok: true, initialized: true, scope, inventoryRevision: revision, stock: {'rice|g': 400}};
  const h = harness({stock: {'rice|g': 300}, document: true, fetch: async () => ({ok: true, json: async () => data})});
  h.store.setItem(keys.owner, JSON.stringify({actorId: actorA, scope: {kind: 'user', id: actorA}}));
  return {...h, data};
}
test('cancelling Pantry review performs no cloud write and retains quantities', async () => {
  const h = pantryHarness(), dialog = await h.host.reviewPantry();
  assert.equal(h.host.allowLegacyTransfer(), false);
  descendants(dialog).find(x => x.textContent === 'Review later').onclick();
  assert.equal(h.calls.length, 0);assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 300);assert.equal(h.host.allowLegacyTransfer(), true);
});
test('stale Pantry revision retains local values and offers a fresh review', async () => {
  const h = pantryHarness();h.inventory.confirmPantry = async () => {const error = Error('conflict');error.status = 409;throw error;};
  const dialog = await h.host.reviewPantry(), form = descendants(dialog).find(x => x.tagName === 'FORM');
  await form.events.submit({preventDefault() {}});
  assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 300);assert.ok(descendants(dialog).some(x => /changed on another device/.test(x.textContent)));assert.equal(descendants(dialog).find(x => x.type === 'submit').disabled, false);
});
test('explicit changed-scope review replaces full stock without summing cloud/device and marks reviewed legacy credit', async () => {
  const scope = {kind: 'household', id: 'household-reviewed'};const h = pantryHarness({scope});
  h.store.setItem(keys.ledger, JSON.stringify({'shop-current|rice|g': {week: 'shop-current', credited: 100}}));
  h.inventory.confirmPantry = async value => {
    assert.equal(JSON.parse(h.store.getItem(keys.owner)).scope.kind, 'user');assert.equal(value.stock['rice|g'], 400);assert.equal(value.expectedRevision, 2);assert.equal(value.expectedScope.id, scope.id);
    h.store.setItem(keys.stock, JSON.stringify(value.stock));h.store.setItem(keys.owner, JSON.stringify({actorId: actorA, scope}));h.setCached({scope, inventoryRevision: 3, lastReceiptId: 'r', pantryReview: {required: false, shopSessionId: 'shop-current'}});
    return {localApplied: true, projection: {stock: value.stock}};
  };
  const dialog = await h.host.reviewPantry();await descendants(dialog).find(x => x.tagName === 'FORM').events.submit({preventDefault() {}});
  assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 400);const receipt = JSON.parse(h.store.getItem(keys.ledger))['shop-current|rice|g'];assert.equal(h.host.coversLegacyCredit(receipt), true);assert.equal(h.host.requiresPantryReview(), false);
});
test('account change closes a Pantry dialog before exposing another account’s amounts', async () => {
  const h = pantryHarness(), dialog = await h.host.reviewPantry();assert.ok(h.body.children.includes(dialog));h.setActor(actorB);h.event('basketboss:session-changed');assert.ok(!h.body.children.includes(dialog));
});


test('deletion prevents receipt actor isolation from archiving deleted pantry into a guest account', () => {
  const h = harness({stock: {'rice|g': 100}});
  h.event('basketboss:account-deletion-started');h.store.values.clear();h.setActor('guest');
  h.event('basketboss:session-changed');h.host.switchActor();h.host.afterRender();
  assert.equal(h.store.values.size, 0);assert.equal(h.host.allowLegacyTransfer(), false);
  assert.equal(h.host.confirmLocalPantryReview().ok, false);
});

test('deletion invalidates a late receipt availability response and never starts projection sync', async () => {
  let release;
  const waiting = new Promise(resolve => {release = resolve;});
  const h = harness({fetch: async () => {await waiting;return {ok: true, json: async () => ({available: true, premium: true})};}});
  const pending = h.host.refreshAvailability();
  h.event('basketboss:account-deletion-started');release();await pending;
  assert.equal(h.host.getAvailability().available, false);assert.equal(h.calls.includes('synchronize'), false);
});

test('late Pantry confirmation cannot update receipt coverage after deletion starts or is cancelled', async () => {
  let release, began;
  const waiting = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {began = resolve;});
  const h = harness({stock: {'rice|g': 100}, cached: {scope: {kind: 'user', id: actorA}, inventoryRevision: 1}});
  h.inventory.confirmPantry = async () => {began();await waiting;return {ok: true, committed: true, localApplied: true, projection: {stock: {'rice|g': 500}}};};
  let projected = 0;h.options.onProjection = () => {projected++;};
  const pending = h.host.confirmCurrentPantry({stock: {'rice|g': 100}});await started;
  const before = [...h.store.values];h.event('basketboss:account-deletion-started');h.event('basketboss:account-deletion-cancelled');
  const afterCancellation = projected;release();const result = await pending;
  assert.equal(result.ok, false);assert.equal(projected, afterCancellation);
  assert.deepEqual([...h.store.values], before);
});
