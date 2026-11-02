import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as ReceiptCore from '../bb-receipt-inventory-core.mjs';
const {computeReceiptCredit} = ReceiptCore;

const source = fs.readFileSync(new URL('../bb-receipt-host.js', import.meta.url), 'utf8');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const STOCK = 'basketboss_321_v7_measured_pantry';
const tick = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag) {this.tagName = tag.toUpperCase();this.children = [];this.events = new Map();this.dataset = {};this.attributes = {};this.style = {};this.value = '';this.textContent = '';this.disabled = false;this.open = false;}
  append(...nodes) {for (const node of nodes) {if (!(node instanceof Element)) continue;node.remove();node.parentNode = this;this.children.push(node);}}
  prepend(...nodes) {for (const node of nodes.reverse()) {node.remove();node.parentNode = this;this.children.unshift(node);}}
  replaceChildren(...nodes) {for (const node of [...this.children]) node.remove();this.append(...nodes);}
  remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);this.parentNode = null;}
  setAttribute(key, value) {this.attributes[key] = String(value);if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);}
  getAttribute(key) {return this.attributes[key] ?? null;}
  removeAttribute(key) {delete this.attributes[key];}
  hasAttribute(key) {return Object.hasOwn(this.attributes, key);}
  addEventListener(name, callback) {const list = this.events.get(name) || [];list.push(callback);this.events.set(name, list);}
  dispatch(name, value = {}) {const event = {type: name, target: this, currentTarget: this, defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}, stopPropagation() {}, ...value};const returned = this['on' + name]?.(event);if (returned === false) event.preventDefault();for (const callback of this.events.get(name) || []) callback(event);return event;}
  dispatchEvent(event) {return !this.dispatch(event.type, event).defaultPrevented;}
  click() {if (this.disabled) return;const event = this.dispatch('click');if (!event.defaultPrevented && this.type === 'submit') this.closest('form')?.dispatch('submit');}
  closest(selector) {for (let node = this;node;node = node.parentNode) if (matches(node, selector)) return node;return null;}
  querySelector(selector) {return descendants(this).slice(1).find(node => matches(node, selector)) || null;}
  querySelectorAll(selector) {return descendants(this).slice(1).filter(node => matches(node, selector));}
  showModal() {this.open = true;}
  close() {this.open = false;this.dispatch('close');}
  focus() {}
  get isConnected() {return this.tagName === 'BODY' || !!this.parentNode?.isConnected;}
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
function matches(node, selector) {
  if (selector === 'form') return node.tagName === 'FORM';
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  const data = selector.match(/^\[data-bb-receipt-trip(?:=["']?([^\]"']+)["']?)?\]$/);
  if (data) return node.dataset.bbReceiptTrip !== undefined && (!data[1] || node.dataset.bbReceiptTrip === data[1]);
  return node.tagName.toLowerCase() === selector.toLowerCase();
}
function harness({credits = {}, status = {ok: true, premium: true, available: true}} = {}) {
  const values = new Map([[STOCK, JSON.stringify({'rice|g': 700})]]), events = new Map(), calls = [], scans = [], notices = [], body = new Element('body');
  const store = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  const document = {body, activeElement: body, createElement: tag => new Element(tag), getElementById: id => descendants(body).find(node => node.id === id) || null, querySelector: selector => body.querySelector(selector)};
  let currentSession = {access_token: 'synthetic-receipt-trip-token', expires_at: 4_000_000_000, user: {id: ACTOR}}, currentContext = {market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current'};
  let cached = null;const inventory = {configure() {}, getPendingConfirmation: () => ({}), getCachedProjection: () => cached};
  const scanner = {configure(value) {this.options = value;}, open(value) {scans.push(value);const modal = new Element('dialog');modal.id = 'mockReceiptScanner';body.append(modal);return modal;}, close() {}};
  const root = {localStorage: store, document, Date, Intl, console, queueMicrotask, addEventListener(name, callback) {const list = events.get(name) || [];list.push(callback);events.set(name, list);}};
  vm.runInNewContext(source, root, {filename: 'bb-receipt-host.js'});
  const host = root.BBReceiptHostFactory({storage: store, document, inventory, scanner, getSession: () => currentSession, getContext: () => currentContext,
    getFinishShopCredits: () => credits, fetch: async address => {calls.push(address);return {ok: true, json: async () => status};}, notify: message => notices.push(message), openUpgrade() {calls.push('upgrade');}, now: () => Date.parse('2026-11-02T12:00:00Z')});
  host.configure();
  return {host, root, values, credits, calls, scans, notices, body, helpers: root.BBReceiptHostHelpers, document,
    setScope(scope) {cached = {scope};}, setActor(id) {currentSession = {...currentSession, user: {id}};}, setToken(token) {currentSession = {...currentSession, access_token: token};}, setContext(value) {currentContext = {...currentContext, ...value};},
    event(name, value) {for (const callback of events.get(name) || []) callback(value);}};
}
const credit = (week, purchasedAt, extra = {}) => ({name: 'Rice', unit: 'g', credited: 500, qty: 400, stockBasis: 'full-purchase', week, purchasedAt, ...extra});
const ledger = {'shop-finished|rice|g': credit('shop-finished', '2026-11-01T16:30:00Z')};
async function choose(h, value) {
  for (let attempt = 0;attempt < 10 && !h.document.getElementById('bbReceiptTripChoice');attempt++) await tick();
  const dialog = h.document.getElementById('bbReceiptTripChoice');assert.ok(dialog, 'recorded stock must require an explicit trip choice');
  const select = descendants(dialog).find(node => node.dataset.bbReceiptTrip === 'select'), next = descendants(dialog).find(node => node.dataset.bbReceiptTrip === 'continue');
  assert.ok(select);assert.ok(next);select.value = value;select.dispatch('change');next.click();await tick();return dialog;
}

test('receipt opened after Finish links the explicitly chosen old trip and does not add its purchase twice', async () => {
  const h = harness({credits: ledger}), before = [...h.values];
  const opening = h.host.open();await choose(h, 'recorded:shop-finished');await opening;
  assert.equal(h.scans.length, 1);assert.equal(h.scans[0].shopSessionId, 'shop-finished');assert.equal(h.scans[0].shopSessionConfirmed, true);
  const item = {canonicalKey: 'rice', quantity: 500, unit: 'g'};
  assert.equal(computeReceiptCredit(item, ledger, {shopSessionId: 'shop-current'}).addedQuantity, 500, 'the archived-trip mismatch would have duplicated the purchase');
  const linked = computeReceiptCredit(item, ledger, {shopSessionId: h.scans[0].shopSessionId});
  assert.equal(linked.priorCreditedQuantity, 500);assert.equal(linked.addedQuantity, 0);assert.deepEqual([...h.values], before, 'choosing a trip never changes stock');
});

test('explicit Finish & scan keeps its original trip without choosing another one', async () => {
  const h = harness({credits: ledger});await h.host.open({shopSessionId: 'shop-finished'});
  assert.equal(h.scans.length, 1);assert.equal(h.scans[0].shopSessionId, 'shop-finished');assert.equal(h.scans[0].shopSessionConfirmed, true);assert.equal(h.document.getElementById('bbReceiptTripChoice'), null);
});

test('a new unrecorded purchase remains explicitly unlinked', async () => {
  const h = harness({credits: ledger}), opening = h.host.open();await choose(h, 'unrecorded');await opening;
  assert.equal(h.scans[0].shopSessionId, null);assert.equal(h.scans[0].shopSessionConfirmed, false);
});

test('current-trip choice is also explicit, while an ordinary scan without historic credit keeps the unchecked default', async () => {
  const h = harness({credits: ledger}), opening = h.host.open();await choose(h, 'current');await opening;
  assert.equal(h.scans[0].shopSessionId, 'shop-current');assert.equal(h.scans[0].shopSessionConfirmed, true);
  const fresh = harness();await fresh.host.open();assert.equal(fresh.scans[0].shopSessionId, 'shop-current');assert.equal(fresh.scans[0].shopSessionConfirmed, false);
});

test('explicitly unlinked caller context is retained rather than replaced by the current trip', async () => {
  const h = harness({credits: ledger});await h.host.open({shopSessionId: null});assert.equal(h.scans[0].shopSessionId, null);assert.equal(h.scans[0].shopSessionConfirmed, false);
});

test('cancel before selecting a receipt trip opens no scanner and changes no stock', async () => {
  const h = harness({credits: ledger}), before = [...h.values], opening = h.host.open();
  for (let attempt = 0;attempt < 10 && !h.document.getElementById('bbReceiptTripChoice');attempt++) await tick();
  const dialog = h.document.getElementById('bbReceiptTripChoice');assert.ok(dialog);descendants(dialog).find(node => node.dataset.bbReceiptTrip === 'cancel').click();await opening;
  assert.equal(h.scans.length, 0);assert.deepEqual([...h.values], before);
});

for (const [change, apply] of [
  ['account', h => h.setActor(OTHER)], ['token', h => h.setToken('another-synthetic-token')], ['market', h => h.setContext({market: 'US'})], ['retailer', h => h.setContext({retailer: 'Co-op'})], ['active trip', h => h.setContext({shopSessionId: 'shop-newer'})], ['pantry scope', h => h.setScope({kind: 'household', id: 'household-other'})]
]) test('changing ' + change + ' during trip choice cannot open a stale receipt scanner', async () => {
  const h = harness({credits: ledger}), opening = h.host.open();
  for (let attempt = 0;attempt < 10 && !h.document.getElementById('bbReceiptTripChoice');attempt++) await tick();
  apply(h);await choose(h, 'recorded:shop-finished');await opening;assert.equal(h.scans.length, 0);
});

test('recorded trip choices group proof, bound history and do not offer another region or malformed IDs', () => {
  const h = harness(), entries = {};
  for (let index = 1;index <= 25;index++) entries[`shop-${index}|rice|g`] = credit('shop-' + index, `2026-10-${String(index).padStart(2, '0')}T12:00:00Z`);
  entries['shop-25|pasta|g'] = {...credit('shop-25', '2026-10-25T13:00:00Z'), name: 'Pasta'};
  entries['shop-current|rice|g'] = credit('shop-current', '2026-11-02T12:00:00Z');
  entries['foreign|rice|g'] = credit('foreign', '2026-11-01', {market: 'US'});
  entries['store|rice|g'] = credit('other-store', '2026-11-01', {retailer: 'Co-op'});
  entries['bad|rice|g'] = credit('<script>alert(1)</script>', '2026-11-01');
  entries['zero|rice|g'] = credit('zero-credit', '2026-11-01', {credited: 0});
  entries['coerced|rice|g'] = credit('string-credit', '2026-11-01', {credited: '500'});
  const trips = copy(h.helpers.recordedTrips(entries, {market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current'}));
  assert.equal(trips.length, 20);assert.equal(trips[0].id, 'shop-25');assert.equal(trips[0].count, 2);assert.equal(trips.at(-1).id, 'shop-6');assert.ok(trips.every(trip => /^shop-\d+$/.test(trip.id)));
});

test('already fully receipted trip is visible as covered but cannot start a second confirmation', async () => {
  const covered = {'shop-finished|rice|g': credit('shop-finished', '2026-11-01', {receiptInventoryReceiptId: 'receipt-already-saved'})}, h = harness({credits: covered}), opening = h.host.open();
  const dialog = await choose(h, 'recorded:shop-finished');const next = descendants(dialog).find(node => node.dataset.bbReceiptTrip === 'continue');
  assert.equal(next.disabled, true);assert.equal(h.scans.length, 0);descendants(dialog).find(node => node.dataset.bbReceiptTrip === 'cancel').click();await opening;
});


test('an explicit old trip already covered by a saved receipt cannot be opened as a new receipt', async () => {
  const h = harness({credits: {'shop-finished|rice|g': credit('shop-finished', '2026-11-01', {receiptInventoryReceiptId: 'receipt-saved'})}});
  await h.host.open({shopSessionId: 'shop-finished'});assert.equal(h.scans.length, 0);assert.ok(h.notices.some(message => /already|recorded/i.test(message)));
});

test('the real scanner carries an explicit trip link without granting photo consent or starting a scan', async () => {
  const body = new Element('body'), head = new Element('head'), requests = [];
  const document = {body, head, activeElement: body, createElement: tag => new Element(tag), createTextNode: text => {const node = new Element('#text');node.textContent = text;return node;},
    getElementById: id => [...descendants(body), ...descendants(head)].find(node => node.id === id) || null, addEventListener() {}, removeEventListener() {}};
  const root = {document, Date, Intl, console, URL, AbortController, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, navigator: {},
    localStorage: {getItem: () => null}, crypto: {randomUUID: () => 'receipt-trip-fixture'}};
  root.window = root;
  const scannerSource = fs.readFileSync(new URL('../bb-receipt-scanner.js', import.meta.url), 'utf8');vm.runInNewContext(scannerSource, {window: root, globalThis: root, URL, AbortController, Date, console});
  const scanner = root.BBReceiptScannerFactory({document, core: ReceiptCore, inventory: {canonicalOptions: async () => []}, getSession: () => ({access_token: 'synthetic-trip-token', expires_at: 4_000_000_000, user: {id: ACTOR}}),
    getContext: () => ({market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current'}), fetch: async (url, options) => {requests.push({url, method: options.method});return {ok: true, json: async () => String(url).includes('/api/bb173/') ? {status: 'available', premium_ai: true, turnstileRequired: false} : {ok: true, available: true, premium: true, migrationReady: true}};}});
  const confirmed = await scanner.open({market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-finished', shopSessionConfirmed: true});
  const control = (dialog, name) => descendants(dialog).find(node => node.dataset.receiptTop === name);
  assert.equal(control(confirmed, 'shopLink').checked, true);assert.equal(control(confirmed, 'consent').checked, false);
  assert.equal(descendants(confirmed).find(node => node.dataset.receiptAction === 'scan').disabled, true);assert.ok(requests.every(request => request.method === 'GET'));
  const ordinary = await scanner.open({market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current'});assert.equal(control(ordinary, 'shopLink').checked, false);assert.equal(control(ordinary, 'consent').checked, false);scanner.close();
});


test('shared and generation source proofs use one matching canonical aggregate without counting raw rows twice', async () => {
  const id = 'shop-finished', canonical = id + '|rice|g', entries = {
    [id + '|shared:fixture']: credit(id, '2026-11-01', {canonicalKey: 'rice', credited: 100, canonicalCreditId: canonical}),
    [id + '|rice|g|home:1']: credit(id, '2026-11-01', {canonicalKey: 'rice', credited: 100, canonicalCreditId: canonical}),
    [canonical]: credit(id, '2026-11-01', {canonicalKey: 'rice', credited: 500, canonicalCreditId: canonical, sourceReceiptIds: [canonical, id + '|shared:fixture', id + '|rice|g|home:1']})
  }, h = harness({credits: entries});
  const trips = h.helpers.recordedTrips(entries, {market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current'});
  assert.equal(trips.length, 1);assert.equal(trips[0].count, 1);assert.equal(trips[0].linkable, true);
  const opening = h.host.open();await choose(h, 'recorded:' + id);await opening;assert.equal(h.scans[0].shopSessionId, id);
  assert.equal(computeReceiptCredit({canonicalKey: 'rice', quantity: 500, unit: 'g'}, entries, {shopSessionId: id}).addedQuantity, 0);
});

test('a noncanonical source proof without a verified aggregate blocks stock scanning for that trip', async () => {
  const id = 'shop-finished', entries = {[id + '|rice|g|home:1']: credit(id, '2026-11-01', {canonicalKey: 'rice', canonicalCreditId: id + '|rice|g'})}, h = harness({credits: entries});
  assert.equal(h.helpers.recordedTrips(entries, {shopSessionId: 'shop-current'})[0].linkable, false);
  await h.host.open({shopSessionId: id});assert.equal(h.scans.length, 0);assert.ok(h.notices.some(text => /stock record|review/i.test(text)));
});

test('an aggregate pointer cannot cross trip, canonical food or base unit identities', () => {
  const id = 'shop-finished', raw = id + '|shared:fixture', canonical = id + '|rice|g', h = harness();
  for (const bad of [
    {[canonical]: credit('shop-other', '2026-11-01', {canonicalKey: 'rice'}), [raw]: credit(id, '2026-11-01', {canonicalKey: 'rice', canonicalCreditId: canonical})},
    {[canonical]: credit(id, '2026-11-01', {canonicalKey: 'rice'}), [raw]: credit(id, '2026-11-01', {canonicalKey: 'pasta', canonicalCreditId: canonical})},
    {[canonical]: credit(id, '2026-11-01', {canonicalKey: 'rice', unit: 'ml'}), [raw]: credit(id, '2026-11-01', {canonicalKey: 'rice', canonicalCreditId: canonical})}
  ]) assert.equal(h.helpers.recordedTrips(bad, {shopSessionId: 'shop-current'}).find(trip => trip.id === id).linkable, false);
});

test('raw purchase proof totals cannot exceed the referenced canonical aggregate', () => {
  const id = 'shop-finished', canonical = id + '|rice|g', entries = {
    [canonical]: credit(id, '2026-11-01', {canonicalKey: 'rice', credited: 500}),
    [id + '|shared:one']: credit(id, '2026-11-01', {canonicalKey: 'rice', credited: 300, canonicalCreditId: canonical}),
    [id + '|shared:two']: credit(id, '2026-11-01', {canonicalKey: 'rice', credited: 300, canonicalCreditId: canonical})
  }, h = harness();assert.equal(h.helpers.recordedTrips(entries, {shopSessionId: 'shop-current'})[0].linkable, false);
});
