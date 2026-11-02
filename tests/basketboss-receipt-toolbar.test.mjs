import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../bb-receipt-host.js', import.meta.url), 'utf8');
const actor = '11111111-1111-4111-8111-111111111111';
const all = node => [node, ...node.children.flatMap(all)];
class Element {
  constructor(tag) {this.tagName = tag;this.children = [];this.dataset = {};this.attributes = {};this.text = '';this.style = {removeProperty() {}};}
  get textContent() {return this.text + this.children.map(node => node.textContent).join('');}
  set textContent(value) {this.replaceChildren();this.text = value;}
  get parentNode() {return this.parent;}
  get nextElementSibling() {return this.parent?.children[this.parent.children.indexOf(this) + 1] || null;}
  append(...nodes) {for (const node of nodes) {node.remove();node.parent = this;this.children.push(node);}}
  prepend(node) {node.remove();node.parent = this;this.children.unshift(node);}
  before(node) {const parent = this.parent;node.remove();node.parent = parent;parent.children.splice(parent.children.indexOf(this), 0, node);}
  remove() {if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this);this.parent = null;}
  replaceChildren(...nodes) {for (const node of [...this.children]) node.remove();this.append(...nodes);}
  querySelector(selector) {return all(this).slice(1).find(node => selector[0] === '#' ? node.id === selector.slice(1) : selector === '[data-bb-receipt-entry]' && node.dataset.bbReceiptEntry === '1') || null;}
  setAttribute(key, value) {this.attributes[key] = value;}
  removeAttribute(key) {delete this.attributes[key];}
}
function harness({state = 'free', comparison = true, overview = true, cached = null, available = true} = {}) {
  const values = new Map(), calls = [], events = {}, body = new Element('body'), app = new Element('main');app.id = 'app';
  const snapshot = new Element('section');snapshot.id = 'bbReleaseShopOverview';
  if (overview) body.append(snapshot);body.append(app);
  const document = {body, createElement: tag => new Element(tag), getElementById: id => all(body).find(node => node.id === id) || null};
  let tab = 'shop-list', currentState = state, now = Date.parse('2026-10-31T12:00:00Z');
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  const root = {document, localStorage: storage, Intl, Date, queueMicrotask,
    addEventListener: (name, fn) => {events[name] = fn;},
    BasketBossVerifiedPremium: {isActive: () => currentState === 'premium'},
    BasketBossMembershipUI: comparison ? {state: () => currentState, open() {calls.push('comparison');}} : undefined};
  vm.runInNewContext(source, root, {filename: 'bb-receipt-host.js'});
  const scanner = {configure() {}, open(value) {calls.push({scan: value});}, close() {calls.push('close');}};
  const host = root.BBReceiptHostFactory({document, storage, scanner, now: () => now,
    inventory: {configure() {}, getCachedProjection: () => cached, getPendingConfirmation: () => null, recoverLocalTransaction() {}, async synchronize() {calls.push('synchronize');return {localApplied: true};}},
    getTab: () => tab, getSession: () => ({access_token: 'test-token', user: {id: actor}}),
    getContext: () => ({market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current'}),
    getEssentials: () => [], setEssentials() {}, getStock: () => ({}),
    isPremium: () => currentState === 'premium',
    async fetch(url) {calls.push(url);return {ok: true, json: async () => ({ok: true, available, premium: currentState === 'premium'})};},
    openUpgrade() {calls.push('upgrade');}, openLegacy() {calls.push('legacy');}});
  host.configure();
  return {host, calls, root, body, app, snapshot, document, events,
    entry: () => document.getElementById('bbReceiptToolbar').querySelector('[data-bb-receipt-entry]'),
    setTab(value) {tab = value;host.afterRender();}, setState(value) {currentState = value;},
    stale() {now += 31000;}};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('the existing receipt action stays above the mobile snapshot without moving receipt history', async () => {
  const cached = {receipts: [{receiptId: 'r1', market: 'UK', currency: 'GBP', purchasedAt: '2026-10-31', foodSubtotal: 5, essentialsSubtotal: 0, receiptTotal: 5}], pantryReview: {shopSessionId: 'shop-current'}};
  const h = harness({cached});await settle();
  const toolbar = h.document.getElementById('bbReceiptToolbar'), entry = h.entry(), mount = h.document.getElementById('bbReceiptHostMount');
  assert.equal(entry.textContent, 'Scan receipt · Premium');
  assert.equal(toolbar.nextElementSibling, h.snapshot);
  assert.ok(h.body.children.indexOf(mount) > h.body.children.indexOf(h.snapshot));
  assert.equal(h.document.getElementById('bbReceiptWeeklyActuals').parentNode, mount);
  h.snapshot.replaceChildren(new Element('h2'));h.host.afterRender();h.host.afterRender();
  assert.equal(h.entry(), entry);assert.equal(all(h.body).filter(node => node.id === 'bbReceiptToolbar').length, 1);
  h.setTab('discover');assert.equal(toolbar.hidden, true);
  h.setTab('shop');assert.equal(toolbar.hidden, true);
  h.setTab('shop-list');assert.equal(toolbar.hidden, false);assert.equal(h.entry(), entry);
});

for (const state of ['free', 'checking', 'unavailable', 'signed_out']) {
  test(`${state} receipt click opens membership without receipt API or scanner access`, async () => {
    const h = harness({state});await settle();h.calls.length = 0;h.stale();
    h.entry().onclick();await settle();
    assert.deepEqual(h.calls, ['comparison']);
  });
}
test('Free receipt entry retains the existing upgrade fallback when comparison is not loaded', async () => {
  const h = harness({comparison: false});await settle();h.calls.length = 0;h.stale();
  h.entry().onclick();await settle();assert.deepEqual(h.calls, ['upgrade']);
});
test('verified Premium receipt click retains the original fresh availability and scanner context', async () => {
  const h = harness({state: 'premium'});await settle();h.calls.length = 0;h.stale();
  h.entry().onclick();await settle();
  assert.equal(h.calls[0], '/api/receipt-inventory?mode=status');
  const scan = h.calls.find(value => value?.scan)?.scan;
  assert.equal(scan?.market, 'UK');assert.equal(scan?.retailer, 'Tesco');assert.equal(scan?.shopSessionId, 'shop-current');
  assert.equal(typeof scan?.onSaved, 'function');assert.ok(!h.calls.includes('comparison'));assert.ok(!h.calls.includes('upgrade'));
});
test('Premium service rollout and deletion protections stay on the original path', async () => {
  const h = harness({state: 'premium', available: false, overview: false});await settle();h.calls.length = 0;
  assert.equal(h.document.getElementById('bbReceiptToolbar').nextElementSibling, h.document.getElementById('bbReceiptHostMount'));
  h.entry().onclick();await settle();assert.deepEqual(h.calls, ['legacy']);
  h.events['basketboss:account-deletion-started']();h.calls.length = 0;
  h.entry().onclick();await settle();assert.deepEqual(h.calls, []);
});
