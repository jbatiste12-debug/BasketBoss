import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Core from '../bb-receipt-inventory-core.mjs';

const modulePath = new URL('../bb-receipt-scanner.js', import.meta.url);
const clone = value => JSON.parse(JSON.stringify(value));
const PHOTO = { mimeType: 'image/jpeg', imageBase64: '/9j/' + 'A'.repeat(120) };
const SESSION = { access_token: 'receipt-fixture-token', expires_at: 4_000_000_000, user: { id: 'user_00000001' } };
const CONTEXT = { market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current' };
const CATALOG = { 'pasta|g': {}, 'milk|ml': {} };
const PRODUCT = { lineId: 'pasta-line', name: 'Pasta', brand: '', kind: 'food', canonicalKey: 'pasta', quantity: 500, unit: 'g', packCount: 1, packQuantity: 500, packUnit: 'g', pricePaid: 1.5, priceType: 'unknown', confidence: 'high', notes: '' };
const RECEIPT = { currency: 'GBP', retailer: 'Tesco', purchasedAt: '2026-10-31', receiptTotal: 1.5, items: [PRODUCT], notes: '' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const descendants = node => [node, ...node.children.flatMap(child => child instanceof Element ? descendants(child) : [])];
const dataName = name => name.replace(/-([a-z])/g, (_all, c) => c.toUpperCase());

function simpleMatch(node, selector) {
  if (!(node instanceof Element)) return false;
  let s = selector.trim().replace(/^:scope\s*>?\s*/, '');
  if (!s) return false;
  const nots = [...s.matchAll(/:not\(([^)]+)\)/g)].map(x => x[1]);
  s = s.replace(/:not\([^)]+\)/g, '');
  if (nots.some(x => simpleMatch(node, x))) return false;
  if (s === ':disabled') return node.disabled;
  const tag = s.match(/^[a-z][a-z0-9-]*/i)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  const id = s.match(/#([a-z0-9_-]+)/i)?.[1];
  if (id && node.id !== id) return false;
  for (const value of s.matchAll(/\.([a-z0-9_-]+)/gi)) if (!node.classList.contains(value[1])) return false;
  for (const match of s.matchAll(/\[([^\]\s=]+)(?:\s*=\s*["']?([^\]"']*)["']?)?\]/g)) {
    const actual = node.getAttribute(match[1]);
    if (actual === null || match[2] !== undefined && String(actual) !== match[2]) return false;
  }
  return true;
}
function matches(node, selector) {
  return selector.split(',').some(part => {
    const chain = part.trim().split(/\s+(?![^[]*\])/).filter(x => x !== '>');
    if (!simpleMatch(node, chain.pop() || '')) return false;
    let parent = node.parentElement;
    while (chain.length) {
      const target = chain.pop(); while (parent && !simpleMatch(parent, target)) parent = parent.parentElement;
      if (!parent) return false; parent = parent.parentElement;
    }
    return true;
  });
}
class Element {
  constructor(tag, document = null) {
    this.tagName = tag.toUpperCase(); this.nodeName = this.tagName; this.nodeType = 1; this.ownerDocument = document;
    this.children = []; this.parentElement = null; this.attributes = new Map(); this.dataset = {}; this.events = new Map();
    this.style = { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } };
    this.disabled = false; this.hidden = false; this.checked = false; this.selected = false; this.open = false; this.files = [];
    this.className = ''; this._value = ''; this._text = ''; this.isConnected = false;
    this.classList = { contains: token => this.className.split(/\s+/).includes(token), add: (...tokens) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...tokens])].join(' '); }, remove: (...tokens) => { this.className = this.className.split(/\s+/).filter(x => !tokens.includes(x)).join(' '); }, toggle: (token, force) => { const has = this.classList.contains(token), want = force ?? !has; want ? this.classList.add(token) : this.classList.remove(token); return want; } };
  }
  get value() { if (this.tagName === 'SELECT' && !this._value) return this.options.find(x => x.selected)?.value || this.options[0]?.value || ''; return this._value; }
  set value(value) { this._value = String(value ?? ''); if (this.tagName === 'INPUT' && this.type === 'file' && this._value === '') this.files = []; }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
  get options() { return descendants(this).filter(x => x !== this && x.tagName === 'OPTION'); }
  get selectedOptions() { return this.options.filter(x => x.value === this.value); }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children.find(x => x instanceof Element) || null; }
  get lastElementChild() { return this.children.filter(x => x instanceof Element).at(-1) || null; }
  get parentNode() { return this.parentElement; }
  get textContent() { return this._text + this.children.map(x => typeof x === 'string' ? x : x.textContent || '').join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.replaceChildren(); }
  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value; }
  append(...children) { for (let child of children) { if (child === null || child === undefined) continue; if (typeof child !== 'object') child = String(child); this.children.push(child); if (child instanceof Element) { child.parentElement = this; for (const x of descendants(child)) x.isConnected = this.isConnected; } } }
  appendChild(child) { this.append(child); return child; }
  prepend(...children) { const old = [...this.children]; this.children = []; this.append(...children, ...old); }
  insertBefore(child, before) { const i = this.children.indexOf(before); if (i < 0) this.append(child); else { this.children.splice(i, 0, child); child.parentElement = this; child.isConnected = this.isConnected; } return child; }
  replaceChildren(...children) { for (const child of this.children) if (child instanceof Element) { child.parentElement = null; for (const x of descendants(child)) x.isConnected = false; } this.children = []; this.append(...children); }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); if (child instanceof Element) { child.parentElement = null; for (const x of descendants(child)) x.isConnected = false; } return child; }
  remove() { this.parentElement?.removeChild(this); for (const x of descendants(this)) x.isConnected = false; }
  replaceWith(next) { const parent = this.parentElement; if (parent) { parent.insertBefore(next, this); this.remove(); } }
  setAttribute(key, value) { const str = String(value); this.attributes.set(key, str); if (key.startsWith('data-')) this.dataset[dataName(key.slice(5))] = str; else if (key === 'class') this.className = str; else if (key === 'id') this.id = str; else if (key === 'disabled') this.disabled = true; else if (key === 'hidden') this.hidden = true; else this[key] = str; }
  getAttribute(key) { if (key.startsWith('data-')) return this.dataset[dataName(key.slice(5))] ?? null; if (this.attributes.has(key)) return this.attributes.get(key); const value = key === 'class' ? this.className : this[key]; return typeof value === 'string' && value !== '' ? value : key === 'disabled' && this.disabled ? '' : null; }
  hasAttribute(key) { return this.getAttribute(key) !== null; }
  removeAttribute(key) { this.attributes.delete(key); if (key.startsWith('data-')) delete this.dataset[dataName(key.slice(5))]; else if (key === 'disabled') this.disabled = false; else if (key === 'hidden') this.hidden = false; else delete this[key]; }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(fn); }
  removeEventListener(type, fn) { this.events.set(type, (this.events.get(type) || []).filter(x => x !== fn)); }
  async emit(type, event = {}) { let stopped = false; const ev = { type, target: this, currentTarget: this, bubbles: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; }, ...event }; let node = this; do { ev.currentTarget = node; for (const fn of node.events.get(type) || []) await fn(ev); node = !stopped && ev.bubbles ? node.parentElement : null; } while (node); return ev; }
  dispatchEvent(event) { void this.emit(event.type, event); return true; }
  click() { return this.emit('click'); }
  matches(selector) { return matches(this, selector); }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentElement; } return null; }
  querySelectorAll(selector) { return descendants(this).slice(1).filter(node => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return descendants(this).includes(node); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; this.focused = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
  showModal() { this.open = true; }
  close() { this.open = false; return this.emit('close', { bubbles: false }); }
  getBoundingClientRect() { return { width: 320, height: 100, top: 0, left: 0, bottom: 100, right: 320 }; }
  checkValidity() { return true; }
  reportValidity() { return true; }
  setCustomValidity(message) { this.validationMessage = message; }
}
function createDocument() {
  const doc = new Element('#document'); doc.isConnected = true;
  doc.baseURI = 'https://basketboss.example/';
  doc.body = new Element('body', doc); doc.head = new Element('head', doc); doc.append(doc.head, doc.body);
  doc.activeElement = doc.body; doc.createElement = tag => {
    const node = new Element(tag, doc);
    if (tag === 'canvas') { node.getContext = () => ({ drawImage() {} }); node.toDataURL = () => 'data:image/jpeg;base64,' + PHOTO.imageBase64; }
    return node;
  };
  doc.createTextNode = text => { const node = new Element('#text', doc); node.nodeType = 3; node.textContent = text; return node; };
  doc.getElementById = id => descendants(doc).find(x => x.id === id) || null;
  return doc;
}
function harness(options = {}) {
  const document = createDocument(), requests = [], commits = [], cancels = [], normalizations = [], savedCallbacks = [], writes = [], createdURLs = [], revokedURLs = [];
  const session = { value: clone(SESSION) }, context = { value: clone(CONTEXT) };
  let prepareCount = 0, recoverCount = 0, retryCount = 0, pending = options.pending || null;
  const adapter = {
    async canonicalOptions() { return [{ key: 'pasta', name: 'pasta', units: ['g'] }, { key: 'milk', name: 'milk', units: ['ml'] }]; },
    async normalizeDraft(raw, input) { normalizations.push(clone(raw)); const draft = Core.normalizeReceiptDraft(raw, { ...input, catalog: CATALOG }); draft.receiptId ||= 'receipt-fixture-id'; return draft; },
    async commitReviewedReceipt(draft, input) { commits.push({ draft: clone(draft), options: { idempotencyKey: input?.idempotencyKey } }); if (options.commitError) { if (options.commitError.commitUnknown) pending = { receiptId: draft.receiptId }; throw options.commitError; } const result = options.commitResult || { ok: true, committed: true, localApplied: true, duplicate: false, receiptId: draft.receiptId, needsPantryConfirmation: true, projection: { stock: { 'pasta|g': 500 } }, summary: { foodLines: 1, essentialLines: 0 } }; if (!result.localApplied) pending = { receiptId: draft.receiptId }; return clone(result); },
    cancelDraft(value) { const receiptId = typeof value === 'string' ? value : value?.receiptId; cancels.push(receiptId); return { cancelled: true, inventoryChanged: false, cloudConfirmationPending: !!pending }; },
    getPendingConfirmation() { return pending ? clone(pending) : {}; },
    recoverLocalTransaction() { recoverCount++; return { recovered: false }; },
    async synchronize() { recoverCount++; const result = options.syncResult || { ok: true, localApplied: true, needsPantryConfirmation: true, projection: { stock: { 'pasta|g': 500 } } }; if (result.localApplied) pending = null; return clone(result); },
    async retryPendingConfirmation(input) { retryCount++; const result = options.retryResult || { ok: true, committed: true, localApplied: true, receiptId: pending?.receiptId || 'receipt-fixture-id', needsPantryConfirmation: true, projection: { stock: { 'pasta|g': 500 } } }; if (result.localApplied) pending = null; return clone(result); }
  };
  const urlAPI = { createObjectURL() { const value = 'blob:receipt-fixture-' + (createdURLs.length + 1); createdURLs.push(value); return value; }, revokeObjectURL(value) { revokedURLs.push(value); } };
  const fetch = async (url, input = {}) => {
    requests.push({ url: String(url), options: input });
    const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(data) });
    if (String(url).startsWith('/api/receipt-inventory?mode=status')) return reply(options.receiptStatus || { ok: true, configured: true, available: true, premium: true, migrationReady: true }, options.receiptStatusCode || 200);
    if (String(url) === '/api/bb173/status') return reply(options.aiStatus || { status: 'available', premium_ai: true, turnstileRequired: false, siteKey: null });
    if (String(url) === '/api/bb173/scan') {
      if (options.scanDeferred) await options.scanDeferred;
      if (options.scanError) return reply({ error: options.scanError }, options.scanStatusCode || 429);
      return reply({ ok: true, reviewRequired: true, receiptInventory: options.receipt || RECEIPT });
    }
    throw Error('Unexpected request: ' + url);
  };
  const schedule = (fn, delay) => { const timer = setTimeout(fn, delay); if (delay >= 1000) timer.unref(); return timer; };
  const root = { document, console, AbortController, URL: urlAPI, Date, setTimeout: schedule, clearTimeout, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: fn => fn(), cancelAnimationFrame() {}, location: { href: document.baseURI, origin: 'https://basketboss.example' },
    localStorage: { getItem() { return null; }, setItem(key, value) { writes.push({ key, value }); }, removeItem(key) { writes.push({ key, removed: true }); } },
    BBReceiptInventory: adapter, fetch, crypto: { randomUUID: () => 'scanner-fixture-id' }, navigator: {},
    createImageBitmap: async () => ({ width: 1200, height: 800, close() {} }), HTMLElement: Element, HTMLInputElement: Element, HTMLSelectElement: Element,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
  root.window = root; document.defaultView = root;
  root.addEventListener = document.addEventListener.bind(document); root.removeEventListener = document.removeEventListener.bind(document);
  root.dispatchEvent = document.dispatchEvent.bind(document);
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), { window: root, globalThis: root, document, console, URL, AbortController, Date, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Uint8Array });
  const preparePhoto = options.useRealResizer ? undefined : options.preparePhoto || (async () => { prepareCount++; return clone(PHOTO); });
  const config = { document, inventory: adapter, core: Core, fetch, getSession: () => session.value, getContext: () => context.value, preparePhoto, URL: urlAPI, createImageBitmap: root.createImageBitmap, setTimeout: schedule, clearTimeout };
  const api = root.BBReceiptScannerFactory ? root.BBReceiptScannerFactory(config) : root.BBReceiptScanner.configure(config);
  const opener = document.createElement('button'); opener.textContent = 'Open scanner'; document.body.append(opener); opener.focus();
  const open = args => api.open({ ...CONTEXT, onSaved: result => savedCallbacks.push(result), ...args });
  return { api, root, document, adapter, open, opener, session, context, requests, commits, cancels, normalizations, savedCallbacks, writes, createdURLs, revokedURLs, get prepareCount() { return prepareCount; }, get recoverCount() { return recoverCount; }, get retryCount() { return retryCount; } };
}
function node(dialog, predicate) { const found = descendants(dialog).find(predicate); assert.ok(found, 'Expected receipt control was rendered'); return found; }
const action = (dialog, name) => node(dialog, x => x.dataset.receiptAction === name);
const top = (dialog, name) => node(dialog, x => x.dataset.receiptTop === name);
const line = (dialog, id = 'pasta-line') => node(dialog, x => x.dataset.receiptLine === id);
const field = (row, name) => node(row, x => x.dataset.receiptField === name);
async function setValue(control, value, event = 'change') { if (control.type === 'checkbox') control.checked = value; else control.value = value; await control.emit(event); await tick(); }
async function selectPhoto(dialog) { const input = action(dialog, 'file'); input.files = [{ type: 'image/jpeg', size: 1000, name: 'receipt.jpg' }]; await input.emit('change'); await tick(); }
async function scanReceipt(h, args) { const dialog = await h.open(args); await selectPhoto(dialog); await setValue(top(dialog, 'consent'), true); await action(dialog, 'scan').emit('click'); await tick(); return dialog; }
async function reviewTop(dialog) { for (const key of ['currencyReviewed', 'storeReviewed', 'totalReviewed']) await setValue(top(dialog, key), true); }
async function submit(dialog) { const save = action(dialog, 'save'); const form = save.closest('form'); if (form && save.type !== 'button') await form.emit('submit'); else await save.emit('click'); await tick(); }
const scanPosts = h => h.requests.filter(x => x.url === '/api/bb173/scan');

test('availability fails closed until migration, Premium and existing AI readiness all pass', async () => {
  for (const options of [
    { receiptStatus: { ok: true, configured: true, premium: true, migrationReady: false, available: false } },
    { receiptStatus: { ok: true, configured: true, premium: true, migrationReady: false, available: true } },
    { receiptStatus: { ok: true, configured: true, premium: false, migrationReady: true, available: false } },
    { receiptStatusCode: 404 },
    { aiStatus: { status: 'disabled', premium_ai: false, turnstileRequired: true } }
  ]) { const h = harness(options), result = await h.api.availability(); assert.equal(result.available, false); assert.equal(scanPosts(h).length, 0); assert.equal(h.prepareCount, 0); }
  const h = harness(); assert.equal((await h.api.availability()).available, true);
  assert.equal(h.writes.length, 0);
});
test('a supermarket must be selected before capture or paid AI requests', async () => {
  const h=harness();h.context.value.retailer=null;
  const result=await h.api.availability();assert.equal(result.available,false);
  assert.match(result.reason,/supermarket/i);assert.equal(h.requests.length,0);
});
test('public readReceipt requires affirmative privacy consent before readiness, resizing or upload', async () => {
  const h = harness(); await assert.rejects(h.api.readReceipt({ file: {}, market: 'UK', retailer: 'Tesco' }), /agree|consent/i);
  assert.equal(h.requests.length, 0); assert.equal(h.prepareCount, 0);
  const raw = await h.api.readReceipt({ file: {}, market: 'UK', retailer: 'Tesco', consent: true });
  assert.equal(raw.currency, 'GBP'); assert.equal(scanPosts(h).length, 1);
  const post = scanPosts(h)[0]; const body = JSON.parse(post.options.body);
  assert.equal(body.scanKind, 'receipt_inventory'); assert.equal(body.expectedCurrency, 'GBP'); assert.equal(body.mimeType, 'image/jpeg'); assert.equal(body.turnstileToken, '');
  assert.equal(post.options.credentials, 'same-origin'); assert.equal(post.options.cache, 'no-store'); assert.match(post.options.headers.Authorization, /^Bearer /);
  assert.equal(h.writes.length, 0);
});
test('camera selection stays local until consent, and each scan uses the existing quota endpoint once', async () => {
  const h = harness(), dialog = await h.open(); await selectPhoto(dialog);
  assert.equal(action(dialog, 'scan').disabled, true); assert.equal(scanPosts(h).length, 0);
  assert.match(dialog.textContent, /Google Gemini/i); assert.match(dialog.textContent, /5|five/i);
  await setValue(top(dialog, 'consent'), true); await action(dialog, 'scan').emit('click'); await tick();
  assert.equal(scanPosts(h).length, 1); assert.equal(h.commits.length, 0); assert.equal(h.writes.length, 0);
});
test('migration-disabled scanner cannot prepare or upload a chosen photo', async () => {
  const h = harness({ receiptStatus: { ok: true, configured: true, premium: true, migrationReady: false, available: false } }), dialog = await h.open();
  await selectPhoto(dialog); await setValue(top(dialog, 'consent'), true); await action(dialog, 'scan').emit('click'); await tick();
  assert.equal(h.prepareCount, 0); assert.equal(scanPosts(h).length, 0); assert.equal(h.commits.length, 0);
});
test('review is explicit for each selected product, currency, store and total', async () => {
  const h = harness(), dialog = await scanReceipt(h), row = line(dialog);
  assert.equal(field(row, 'reviewed').checked, false); assert.equal(top(dialog, 'shopLink').checked, false);
  assert.equal(action(dialog, 'save').disabled, true); await submit(dialog); assert.equal(h.commits.length, 0);
  await setValue(field(row, 'reviewed'), true); assert.equal(action(dialog, 'save').disabled, true);
  await reviewTop(dialog); assert.equal(action(dialog, 'save').disabled, false);
  await submit(dialog); assert.equal(h.commits.length, 1); assert.equal(h.commits[0].draft.shopSessionId, null);
  assert.equal(h.commits[0].draft.lines[0].reviewed, true); assert.equal(h.commits[0].draft.lines[0].classification, 'food');
  assert.equal(h.savedCallbacks.length, 1); assert.equal(h.writes.length, 0);
});
test('unknown measured food stays pending instead of inheriting the guide pack', async () => {
  const receipt = { ...RECEIPT, items: [{ ...PRODUCT, quantity: null, unit: 'unknown', packCount: null, packQuantity: null, packUnit: 'unknown' }] };
  const h = harness({ receipt }), dialog = await scanReceipt(h), row = line(dialog); await reviewTop(dialog);
  assert.equal(field(row, 'quantity').value, ''); await setValue(field(row, 'reviewed'), true);
  assert.equal(action(dialog, 'save').disabled, true); await submit(dialog); assert.equal(h.commits.length, 0);
  await setValue(field(row, 'measurementMode'), 'total'); await setValue(field(row, 'quantity'), '400', 'input'); await setValue(field(row, 'unit'), 'g');
  await setValue(field(row, 'reviewed'), true); await submit(dialog);
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].draft.lines[0].quantity, 400);
});
test('unknown or incorrectly mapped canonical ingredient cannot be confirmed', async () => {
  const h = harness({ receipt: { ...RECEIPT, items: [{ ...PRODUCT, canonicalKey: '' }] } }), dialog = await scanReceipt(h), row = line(dialog);
  await reviewTop(dialog); await setValue(field(row, 'canonicalKey'), 'invented ingredient'); await setValue(field(row, 'reviewed'), true);
  await submit(dialog); assert.equal(h.commits.length, 0); assert.equal(action(dialog, 'save').disabled, true);
  await setValue(field(row, 'canonicalKey'), 'pasta'); await setValue(field(row, 'reviewed'), true); await submit(dialog);
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].draft.lines[0].canonicalKey, 'pasta');
});
test('editing an actual price resets its review and defaults ordinary price learning to unknown', async () => {
  const h = harness({ receipt: { ...RECEIPT, items: [{ ...PRODUCT, priceType: 'regular' }] } }), dialog = await scanReceipt(h), row = line(dialog);
  assert.equal(field(row, 'priceType').value, 'unknown'); await reviewTop(dialog); await setValue(field(row, 'reviewed'), true);
  await setValue(field(row, 'lineTotal'), '2.25', 'input'); assert.equal(field(row, 'reviewed').checked, false);
  await setValue(field(row, 'priceType'), 'promotion'); await setValue(field(row, 'reviewed'), true); await submit(dialog);
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].draft.lines[0].lineTotal, 2.25); assert.equal(h.commits[0].draft.lines[0].priceType, 'promotion');
});
test('household lines stay non-food essentials and keep a separate spend subtotal', async () => {
  const receipt = { ...RECEIPT, receiptTotal: 4.5, items: [PRODUCT, { lineId: 'soap-line', name: 'Laundry detergent', kind: 'food', canonicalKey: 'pasta', quantity: null, unit: 'unknown', pricePaid: 3, confidence: 'high', notes: '' }] };
  const h = harness({ receipt }), dialog = await scanReceipt(h), soap = line(dialog, 'soap-line'); await reviewTop(dialog);
  assert.equal(field(soap, 'classification').value, 'essential'); assert.match(dialog.textContent, /weekly essentials/i);
  await setValue(field(soap, 'classification'), 'food'); await setValue(field(soap, 'reviewed'), true); await setValue(field(line(dialog), 'reviewed'), true);
  await submit(dialog);
  if (h.commits.length) assert.equal(h.commits[0].draft.lines.find(x => x.id === 'soap-line').classification, 'essential');
  else assert.equal(action(dialog, 'save').disabled, true);
});
test('explicit current-trip link is off by default and only adds the provided session when reviewed', async () => {
  const h = harness(), dialog = await scanReceipt(h); await reviewTop(dialog); await setValue(field(line(dialog), 'reviewed'), true);
  await setValue(top(dialog, 'shopLink'), true); await submit(dialog);
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].draft.shopSessionId, 'shop-current');
});
test('account or active region/store changes block both scanning and confirmation', async () => {
  for (const property of ['market', 'retailer']) {
    const h = harness(), dialog = await h.open(); await selectPhoto(dialog); await setValue(top(dialog, 'consent'), true);
    h.context.value[property] = property === 'market' ? 'US' : 'Aldi'; await action(dialog, 'scan').emit('click'); await tick();
    assert.equal(scanPosts(h).length, 0);
  }
  const h = harness(), dialog = await scanReceipt(h); await reviewTop(dialog); await setValue(field(line(dialog), 'reviewed'), true);
  h.session.value = { ...h.session.value, access_token: 'new-account-token', user: { id: 'user_00000002' } }; await submit(dialog);
  assert.equal(h.commits.length, 0);
});
test('cloud-committed storage failure never announces that stock was added', async () => {
  const h = harness({ commitResult: { ok: true, committed: true, localApplied: false, syncRequired: true, receiptId: 'receipt-fixture-id', localError: 'storage quota' } }), dialog = await scanReceipt(h);
  await reviewTop(dialog); await setValue(field(line(dialog), 'reviewed'), true); await submit(dialog);
  assert.equal(h.commits.length, 1); assert.match(dialog.textContent, /saved|receipt/i); assert.match(dialog.textContent, /refresh|recover|storage|pantry/i);
  const status = node(dialog, x => x.getAttribute('role') === 'status').textContent;
  assert.ok(!/stock (?:was )?added|added to (?:your )?pantry/i.test(status));
  assert.ok(h.savedCallbacks.every(x => x.localApplied !== true));
});
test('quota failure does not retry the image scan automatically or write pantry state', async () => {
  const h = harness({ scanError: 'Daily scan allowance used. Try tomorrow.', scanStatusCode: 429 }), dialog = await scanReceipt(h);
  assert.equal(scanPosts(h).length, 1); assert.match(dialog.textContent, /allowance|tomorrow|limit/i); assert.equal(h.commits.length, 0); assert.equal(h.writes.length, 0);
});
test('closing discards the memory draft, revokes the preview and restores opener focus', async () => {
  const h = harness(), dialog = await scanReceipt(h); assert.ok(h.createdURLs.length > 0);
  await action(dialog, 'close').emit('click'); await tick();
  assert.ok(h.cancels.includes('receipt-fixture-id')); assert.ok(h.revokedURLs.includes(h.createdURLs[0])); assert.equal(h.document.activeElement, h.opener);
  assert.equal(h.commits.length, 0); assert.equal(h.writes.length, 0);
});
test('a late scan result after cancellation cannot render a draft or change stock', async () => {
  let resolve; const deferred = new Promise(r => { resolve = r; }); const h = harness({ scanDeferred: deferred }), dialog = await h.open();
  await selectPhoto(dialog); await setValue(top(dialog, 'consent'), true); const scan = action(dialog, 'scan').emit('click'); await tick();
  await action(dialog, 'close').emit('click'); resolve(); await scan; await tick();
  assert.equal(h.normalizations.length, 0); assert.equal(h.commits.length, 0); assert.equal(dialog.isConnected, false);
});
test('dialog has a labelled modal, live status and associated review controls', async () => {
  const h = harness(), dialog = await scanReceipt(h);
  assert.ok(dialog.getAttribute('aria-labelledby')); assert.ok(h.document.getElementById(dialog.getAttribute('aria-labelledby')));
  assert.ok(descendants(dialog).some(x => x.getAttribute('role') === 'status' || x.getAttribute('aria-live')));
  for (const control of descendants(dialog).filter(x => ['INPUT', 'SELECT'].includes(x.tagName) && !x.hidden && x.type !== 'hidden')) {
    assert.ok(control.closest('label') || control.getAttribute('aria-label') || control.id && descendants(dialog).some(x => x.tagName === 'LABEL' && x.getAttribute('for') === control.id), 'Every visible input has a label');
  }
});
test('explicit pack size and count produce their measured total without changing the actual line price', async () => {
  const h = harness(), dialog = await scanReceipt(h); let row = line(dialog);
  await setValue(field(row, 'measurementMode'), 'packs'); row = line(dialog);
  await setValue(field(row, 'packQuantity'), '500', 'input'); await setValue(field(row, 'packUnit'), 'g'); await setValue(field(row, 'packCount'), '2', 'input');
  await setValue(field(row, 'lineTotal'), '3', 'input'); await setValue(top(dialog, 'receiptTotal'), '3', 'input');
  await reviewTop(dialog); await setValue(field(row, 'reviewed'), true); await submit(dialog);
  assert.equal(h.commits.length, 1); const food = h.commits[0].draft.lines[0];
  assert.equal(food.quantity, 1000); assert.equal(food.unit, 'g'); assert.equal(food.packCount, 2); assert.equal(food.packQuantity, 500); assert.equal(food.lineTotal, 3);
});
test('adjustments are explicitly reviewed and cannot become positive food inventory', async () => {
  const h = harness({ receipt: { ...RECEIPT, receiptTotal: 1, items: [PRODUCT, { lineId: 'coupon-line', name: 'Coupon discount', kind: 'discount', pricePaid: -.5, quantity: null, unit: 'unknown', notes: '' }, { lineId: 'total-line', name: 'TOTAL', kind: 'total', pricePaid: 1 }] } });
  const dialog = await scanReceipt(h); await reviewTop(dialog); await setValue(field(line(dialog), 'reviewed'), true);
  const adjustment = line(dialog, 'coupon-line'); await setValue(field(adjustment, 'reviewed'), true); await submit(dialog);
  assert.equal(h.commits.length, 1); const rows = h.commits[0].draft.lines;
  assert.equal(rows.find(x => x.id === 'coupon-line').sourceKind, 'discount'); assert.equal(rows.find(x => x.id === 'coupon-line').classification, 'ignore');
  assert.equal(rows.filter(x => x.classification === 'food' && x.selected).length, 1);
  assert.equal(h.commits[0].draft.receiptTotal, 1);
});
test('an unreadable actual total requires an explicit unknown-total choice instead of an invented total', async () => {
  const h = harness({ receipt: { ...RECEIPT, receiptTotal: null } }), dialog = await scanReceipt(h);
  await setValue(field(line(dialog), 'reviewed'), true); await reviewTop(dialog);
  assert.equal(action(dialog, 'save').disabled, true); await setValue(top(dialog, 'totalUnknown'), true); await setValue(top(dialog, 'totalReviewed'), true); await submit(dialog);
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].draft.receiptTotal, null);
});
test('recovering a cloud-committed local failure does not upload the receipt a second time', async () => {
  const h = harness({ commitResult: { ok: true, committed: true, localApplied: false, syncRequired: true, receiptId: 'receipt-fixture-id' } }), dialog = await scanReceipt(h);
  await reviewTop(dialog); await setValue(field(line(dialog), 'reviewed'), true); await submit(dialog);
  await action(dialog, 'recover').emit('click'); await tick();
  assert.equal(h.commits.length, 1); assert.equal(scanPosts(h).length, 1); assert.ok(h.recoverCount > 0);
  assert.ok(h.savedCallbacks.some(x => x.localApplied === true)); assert.equal(h.writes.length, 0);
});
test('unknown commit outcome offers an idempotent pending retry without another photo scan', async () => {
  const error = Object.assign(Error('Network connection lost'), { commitUnknown: true, recoveryRequired: true });
  const h = harness({ commitError: error, syncResult: { ok: true, localApplied: false, pendingReceipt: true, syncRequired: true } }), dialog = await scanReceipt(h);
  await reviewTop(dialog); await setValue(field(line(dialog), 'reviewed'), true); await submit(dialog);
  await action(dialog, 'retry').emit('click'); await tick();
  assert.equal(h.commits.length, 1); assert.equal(h.retryCount, 1); assert.equal(scanPosts(h).length, 1);
  assert.ok(h.savedCallbacks.some(x => x.localApplied === true)); assert.equal(h.writes.length, 0);
});
test('a definitive failed confirmation retains the stable receipt/request identity for corrected retry', async () => {
  const options = { commitError: Object.assign(Error('Check the reviewed amount'), { status: 400 }) }, h = harness(options), dialog = await scanReceipt(h);
  await reviewTop(dialog); await setValue(field(line(dialog), 'reviewed'), true); await submit(dialog); options.commitError = null;
  await submit(dialog); assert.equal(h.commits.length, 2);
  assert.equal(h.commits[0].draft.receiptId, h.commits[1].draft.receiptId);
  assert.equal(h.commits[0].options.idempotencyKey, h.commits[1].options.idempotencyKey); assert.ok(h.commits[0].options.idempotencyKey);
  assert.equal(scanPosts(h).length, 1);
});
test('missing or expired sign-in prevents receipt photo preparation and provider requests', async () => {
  for (const session of [null, { ...SESSION, expires_at: 1 }]) {
    const h = harness(); h.session.value = session;
    await assert.rejects(h.api.readReceipt({ file: {}, market: 'UK', retailer: 'Tesco', consent: true }));
    assert.equal(h.prepareCount, 0); assert.equal(scanPosts(h).length, 0);
  }
});
test('the photo utility rejects non-images and oversized files before decoding or uploading', async () => {
  const h = harness({ useRealResizer: true });
  await assert.rejects(h.api.preparePhoto({ type: 'application/pdf', size: 100 }));
  await assert.rejects(h.api.preparePhoto({ type: 'image/jpeg', size: 13 * 1024 * 1024 }));
  const prepared = await h.api.preparePhoto({ type: 'image/jpeg', size: 1000 });
  assert.equal(prepared.mimeType, 'image/jpeg'); assert.ok(prepared.imageBase64.length < 2_500_000); assert.ok(!prepared.imageBase64.startsWith('data:'));
  assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
});
test('a context change while the photo is prepared prevents the provider upload', async () => {
  let h; h = harness({ preparePhoto: async () => { h.context.value.retailer = 'Aldi'; return PHOTO; } });
  await assert.rejects(h.api.readReceipt({ file: { type: 'image/jpeg', size: 1000 }, market: 'UK', retailer: 'Tesco', consent: true }), /context|account|supermarket|region/i);
  assert.equal(scanPosts(h).length, 0); assert.equal(h.commits.length, 0);
});
test('a required security challenge cannot be skipped by a direct receipt request', async () => {
  const h = harness({ aiStatus: { status: 'available', premium_ai: true, turnstileRequired: true, siteKey: 'fixture-site-key' } });
  await assert.rejects(h.api.readReceipt({ file: {}, market: 'UK', retailer: 'Tesco', consent: true }), /security|turnstile/i);
  assert.equal(scanPosts(h).length, 0); assert.equal(h.prepareCount, 0);
  await h.api.readReceipt({ file: {}, market: 'UK', retailer: 'Tesco', consent: true, turnstileToken: 'completed-security-check' });
  assert.equal(JSON.parse(scanPosts(h)[0].options.body).turnstileToken, 'completed-security-check');
});
test('a receipt in the wrong currency is not silently converted into the selected region', async () => {
  const h = harness({ receipt: { ...RECEIPT, currency: 'USD' } }), dialog = await scanReceipt(h);
  assert.match(node(dialog, x => x.getAttribute('role') === 'status').textContent, /currency|region/i);
  assert.equal(h.commits.length, 0); assert.equal(action(dialog, 'save').disabled, true);
});
test('a malformed oversized Vision result is not rendered or automatically retried', async () => {
  const h = harness({ receipt: { ...RECEIPT, items: Array.from({ length: 201 }, (_, i) => ({ ...PRODUCT, lineId: 'line-' + i })) } }), dialog = await scanReceipt(h);
  assert.equal(scanPosts(h).length, 1); assert.equal(h.normalizations.length, 0); assert.equal(h.commits.length, 0);
  assert.equal(action(dialog, 'save').disabled, true);
});
test('pending unknown rows can be explicitly deselected without inventing their food or quantity', async () => {
  const h = harness({ receipt: { ...RECEIPT, receiptTotal: 3.5, items: [PRODUCT, { lineId: 'unclear', name: 'Unreadable product', kind: 'unknown', canonicalKey: '', quantity: null, unit: 'unknown', pricePaid: 2 }] } });
  const dialog = await scanReceipt(h); await reviewTop(dialog); await setValue(field(line(dialog), 'reviewed'), true);
  assert.equal(action(dialog, 'save').disabled, true); await setValue(field(line(dialog, 'unclear'), 'selected'), false); await submit(dialog);
  assert.equal(h.commits.length, 1); const unknown = h.commits[0].draft.lines.find(x => x.id === 'unclear');
  assert.equal(unknown.selected, false); assert.equal(unknown.quantity, null); assert.equal(unknown.classification, 'pending');
});
test('known ingredients cannot invent a mass-to-volume mapping while being reviewed', async () => {
  const h = harness(), dialog = await scanReceipt(h); await setValue(field(line(dialog), 'measurementMode'), 'total');
  const row = line(dialog); await setValue(field(row, 'quantity'), '500', 'input'); await setValue(field(row, 'unit'), 'ml'); await reviewTop(dialog); await setValue(field(row, 'reviewed'), true);
  await submit(dialog); assert.equal(h.commits.length, 0); assert.equal(action(dialog, 'save').disabled, true);
});
test('responsive styles keep the modal scrollable and controls visibly keyboard-focusable', () => {
  const css = fs.readFileSync(new URL('../bb-receipt-scanner.css', import.meta.url), 'utf8');
  assert.match(css, /max-height\s*:\s*\d+dvh/); assert.match(css, /overflow-y\s*:\s*auto/);
  assert.match(css, /:focus-visible/); assert.match(css, /@media\s*\(max-width/); assert.match(css, /min-height\s*:\s*(?:4[4-9]|[5-9]\d)px/);
  assert.match(css, /prefers-reduced-motion/);
});
test('selecting a new photo preserves its file while revoking the old preview and resetting consent', async () => {
  const h = harness(), dialog = await h.open(); await selectPhoto(dialog); await setValue(top(dialog, 'consent'), true);
  const firstURL = h.createdURLs[0], input = action(dialog, 'file'), next = { type: 'image/jpeg', size: 1100, name: 'replacement.jpg' };
  input.files = [next]; await input.emit('change'); await tick();
  assert.equal(input.files[0], next); assert.equal(top(dialog, 'consent').checked, false); assert.ok(h.revokedURLs.includes(firstURL));
  assert.equal(action(dialog, 'scan').disabled, true); await setValue(top(dialog, 'consent'), true); await action(dialog, 'scan').emit('click'); await tick();
  assert.equal(scanPosts(h).length, 1); assert.equal(h.commits.length, 0);
});
test('excluded adjustment no longer contributes to the reviewed adjustment subtotal', async () => {
  const h = harness({ receipt: { ...RECEIPT, receiptTotal: 1, items: [PRODUCT, { lineId: 'coupon-line', name: 'Coupon discount', kind: 'discount', pricePaid: -.5 }] } }), dialog = await scanReceipt(h);
  const summary = node(dialog, x => x.classList.contains('bb-receipt-totals'));
  assert.match(summary.textContent, /Discounts\/refunds/);
  await setValue(field(line(dialog, 'coupon-line'), 'selected'), false);
  assert.ok(!/Discounts\/refunds/.test(summary.textContent));
});
test('no selected purchases means confirmation stays disabled even when totals were reviewed', async () => {
  const h = harness(), dialog = await scanReceipt(h); await reviewTop(dialog);
  await setValue(field(line(dialog), 'selected'), false); assert.equal(action(dialog, 'save').disabled, true);
  await submit(dialog); assert.equal(h.commits.length, 0);
});

test('Premium receipt review suggests explicit markdown food but still requires a checked item before saving', async () => {
  const h=harness({receipt:{...RECEIPT,items:[{...PRODUCT,name:'Pasta REDUCED'}]}});h.root.BBReducedFoodHost={isPremium:()=>true};
  const dialog=await scanReceipt(h),row=line(dialog);assert.equal(field(row,'reduced').checked,true);assert.equal(field(row,'priceType').value,'promotion');assert.equal(field(row,'priceType').disabled,true);assert.equal(field(row,'reviewed').checked,false);assert.equal(h.commits.length,0);
  await setValue(field(row,'reduced'),false);let next=line(dialog);assert.equal(field(next,'priceType').value,'unknown');assert.equal(field(next,'priceType').disabled,false);
  await setValue(field(next,'reduced'),true);next=line(dialog);await reviewTop(dialog);await setValue(field(next,'reviewed'),true);await submit(dialog);
  assert.equal(h.commits.length,1);assert.equal(h.commits[0].draft.lines[0].reduced,true);assert.equal(h.commits[0].draft.lines[0].priceType,'promotion');
});

test('receipt markdown controls are hidden without Premium and nutrition labels are never preselected as reduced', async () => {
  const h=harness({receipt:{...RECEIPT,items:[{...PRODUCT,name:'Pasta REDUCED'}]}}),dialog=await scanReceipt(h);assert.equal(descendants(dialog).some(x=>x.dataset?.receiptField==='reduced'),false);
  const g=harness({receipt:{...RECEIPT,items:[{...PRODUCT,name:'Reduced-salt pasta'}]}});g.root.BBReducedFoodHost={isPremium:()=>true};const other=await scanReceipt(g);assert.equal(field(line(other),'reduced').checked,false);
});

test('stalled receipt readiness times out and leaves the scanner closable with no writes',async()=>{
 const h=harness(),timers=new Map();let serial=0;
 h.api.configure({setTimeout:(fn,delay)=>{assert.equal(delay,15000);timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),fetch:(_url,input)=>new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(Error('receipt_scan_cancelled')),{once:true}))});
 const opening=h.open();await tick();assert.equal(timers.size,2);for(const expire of [...timers.values()])expire();const dialog=await opening;
 assert.match(dialog.textContent,/cancelled/);assert.equal(action(dialog,'scan').disabled,true);assert.equal(h.commits.length,0);assert.equal(h.writes.length,0);assert.equal(timers.size,0);
 await action(dialog,'close').emit('click');assert.equal(dialog.isConnected,false);assert.equal(h.document.activeElement,h.opener);
});

test('a second scanner launch preserves the existing reviewed draft instead of discarding it',async()=>{
 const h=harness(),dialog=await scanReceipt(h);await setValue(field(line(dialog),'lineTotal'),'2.25','input');
 const again=await h.open();assert.equal(again,dialog);assert.equal(field(line(dialog),'lineTotal').value,'2.25');assert.equal(h.cancels.length,0);assert.equal(scanPosts(h).length,1);
});

test('rapid receipt scan taps start only one paid image request',async()=>{
 let release;const deferred=new Promise(resolve=>{release=resolve;}),h=harness({scanDeferred:deferred}),dialog=await h.open();
 await selectPhoto(dialog);await setValue(top(dialog,'consent'),true);const button=action(dialog,'scan'),first=button.emit('click');
 assert.equal(button.disabled,true);await button.emit('click');await tick();assert.equal(scanPosts(h).length,1);
 release();await first;assert.equal(scanPosts(h).length,1);assert.equal(h.commits.length,0);
});
