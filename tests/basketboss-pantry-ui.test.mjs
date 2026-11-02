import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const guide = createRequire(import.meta.url)('../bb-how-it-works.js');
const cookSource = fs.readFileSync(new URL('../bb-cook-pantry.js', import.meta.url), 'utf8');
const SETUP = 'bb_onboarding_fresh_once_20261028_v1';
const next = () => new Promise(resolve => setImmediate(resolve));

function environment(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  const listeners = new Map();
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const matches = (node, selector) => selector.split(',').some(part => {
    if (part.startsWith('#')) return node.id === part.slice(1);
    if (part.startsWith('.')) return node.className.split(' ').includes(part.slice(1));
    if (part === 'dialog[open]') return node.tagName === 'DIALOG' && node.open;
    if (part === '[aria-modal="true"]') return node.getAttribute('aria-modal') === 'true';
    if (part === 'button:not(:disabled)') return node.tagName === 'BUTTON' && !node.disabled;
    return node.tagName.toLowerCase() === part;
  });
  let doc;
  class Element {
    constructor(tag) {this.tagName = tag.toUpperCase();this.children = [];this.className = '';this.attributes = new Map();this.events = new Map();this.style = {};this.value = '';this.disabled = false;this.open = false;this.textContent = '';this.ownerDocument = doc;const classes = new Set();this.classList = {add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value)};}
    append(...nodes) {for (const node of nodes) {node.remove();node.parent = this;this.children.push(node);}}
    replaceChildren(...nodes) {for (const node of this.children) node.parent = null;this.children = [];this.append(...nodes);}
    remove() {if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this);this.parent = null;}
    setAttribute(key, value) {this.attributes.set(key, String(value));}
    removeAttribute(key) {this.attributes.delete(key);}
    hasAttribute(key) {return this.attributes.has(key);}
    getAttribute(key) {return this.attributes.get(key) ?? null;}
    addEventListener(name, fn) {const list = this.events.get(name) || [];list.push(fn);this.events.set(name, list);}
    dispatch(name, event = {}) {for (const fn of this.events.get(name) || []) fn({target: this, preventDefault() {}, ...event});}
    querySelectorAll(selector) {return descendants(this).slice(1).filter(node => matches(node, selector));}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    matches(selector) {return matches(this, selector);}
    closest(selector) {for (let node = this;node;node = node.parent) if (matches(node, selector)) return node;return null;}
    contains(other) {return descendants(this).includes(other);}
    focus() {doc.activeElement = this;}
    showModal() {this.open = true;this.setAttribute('open', '');}
    close() {this.open = false;this.removeAttribute('open');this.dispatch('close');}
    getBoundingClientRect() {return {width: 320, height: 600, left: 0, right: 320, top: 0, bottom: 600};}
    checkValidity() {const n = Number(this.value);return this.value !== '' && Number.isFinite(n) && n >= Number(this.min || 0) && n <= Number(this.max || Infinity);}
    reportValidity() {this.reported = true;}
    get isConnected() {return this === doc.documentElement || !!this.parent?.isConnected;}
    [Symbol.for('nodejs.util.inspect.custom')]() {return this.tagName + (this.id ? '#' + this.id : '');}
  }
  doc = {visibilityState: 'visible', readyState: 'complete', createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), {textContent: text}),
    addEventListener(name, fn) {const list = listeners.get(name) || [];list.push(fn);listeners.set(name, list);},
    removeEventListener(name, fn) {listeners.set(name, (listeners.get(name) || []).filter(value => value !== fn));},
    getElementById: id => descendants(doc.body).find(node => node.id === id) || null,
    querySelector: selector => doc.body.querySelector(selector), querySelectorAll: selector => doc.body.querySelectorAll(selector)
  };
  doc.documentElement = new Element('html');doc.body = new Element('body');doc.documentElement.append(doc.body);doc.activeElement = doc.body;doc.body.style.overflow = 'auto';
  const store = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  const win = {document: doc, localStorage: store, queueMicrotask, scrollX: 0, scrollY: 0, scrollTo() {}, getComputedStyle: () => ({display: 'block', visibility: 'visible'}),
    addEventListener(name, fn) {const list = listeners.get(name) || [];list.push(fn);listeners.set(name, list);}
  };
  const dispatch = (name, event = {}) => {for (const fn of [...(listeners.get(name) || [])]) fn({target: doc.body, preventDefault() {}, stopPropagation() {}, ...event});};
  return {win, doc, values, store, dispatch, descendants, text: node => descendants(node).map(value => value.textContent).join(' '), buttons: () => doc.body.querySelectorAll('button:not(:disabled)')};
}

test('the first-use weekly guide waits for completed setup and is then shown only once', async () => {
  const h = environment(), api = guide.install(h.win);api.start();await next();
  assert.equal(api.isOpen(), false);
  h.store.setItem(SETUP, JSON.stringify({complete: true}));api.setupFinished();await next();assert.equal(api.isOpen(), true);
  assert.match(h.text(h.doc.body), /Plan Your Meals/);assert.match(h.text(h.doc.body), /Scan & Cook/);
  h.dispatch('keydown', {key: 'Escape'});assert.equal(api.isOpen(), false);
  api.setupFinished();h.dispatch('focus');await next();assert.equal(api.isOpen(), false);
  assert.equal(JSON.parse(h.store.getItem(guide.KEY)).seen, true);
});

test('returning users get no automatic guide and manual open preserves all plan/account/pantry data', async () => {
  const h = environment({[SETUP]: {complete: true}, basketboss_321_unified_state_v1: {planned: [{recipeId: 'rice', day: 'Mon'}]}, basketboss_321_v7_measured_pantry: {'rice|g': 500}, basketboss_cloud_session_v1: {user: {id: 'account'}}});
  const before = [...h.values];let planned = 0;h.win.BBHowItWorksHost = {openPlan: () => planned++};
  const api = guide.install(h.win);api.start();await next();assert.equal(api.isOpen(), false);
  assert.equal(api.open(), true);
  h.buttons().find(node => node.textContent === 'Got it, let’s plan').dispatch('click');
  assert.equal(api.isOpen(), false);assert.equal(planned, 1);
  for (const [key, value] of before) assert.equal(h.store.getItem(key), value, key + ' remains unchanged');
});

test('guide close restores scroll lock, original focus and pre-existing inert state', () => {
  const h = environment({[SETUP]: {complete: true}}), app = h.doc.createElement('main'), old = h.doc.createElement('aside'), focus = h.doc.createElement('button');
  old.setAttribute('inert', '');app.append(focus);h.doc.body.append(app, old);focus.focus();
  const api = guide.install(h.win);assert.equal(api.open(), true);assert.equal(app.hasAttribute('inert'), true);assert.equal(h.doc.body.style.overflow, 'hidden');
  const buttons = h.doc.getElementById('bbHowItWorksDialog').querySelectorAll('button:not(:disabled)');buttons.at(-1).focus();let prevented = false;
  h.dispatch('keydown', {key: 'Tab', preventDefault() {prevented = true;}});
  assert.equal(prevented, true);assert.equal(h.doc.activeElement, buttons[0]);
  assert.equal(api.close(), true);assert.equal(app.hasAttribute('inert'), false);assert.equal(old.hasAttribute('inert'), true);
  assert.equal(h.doc.activeElement, focus);assert.equal(h.doc.body.style.overflow, 'auto');
});

test('the automatic guide waits for typing and cannot open during account deletion', async () => {
  const h = environment(), input = h.doc.createElement('input');h.doc.body.append(input);input.focus();const api = guide.install(h.win);api.start();
  h.store.setItem(SETUP, JSON.stringify({complete: true}));api.setupFinished();await next();assert.equal(api.isOpen(), false);
  h.doc.body.focus();h.win.BBAccountDeletion = {isDeleting: () => true};assert.equal(api.open(), false);
  h.win.BBAccountDeletion = {isDeleting: () => false};h.dispatch('focusout');await next();assert.equal(api.isOpen(), true);api.close();
});

function cookFixture(home) {
  const h = environment();h.win.BBHome = home;vm.runInNewContext(cookSource, {window: h.win});
  const container = h.doc.createElement('div');h.doc.body.append(container);
  const row = {id: 'rice|g', name: 'Rice', unit: 'g', required: 300, owned: 1000, deduct: 300, canDeduct: true, issueLabel: ''};
  return {...h, row, mount: () => h.win.BBCookPantry.mount({container, event: {sessionId: 'cook'}})};
}

test('Done never deducts automatically and double taps share one explicit confirmation', async () => {
  let calls = 0, resolve;const h = cookFixture({previewCook: () => ({ok: true, rows: [h.row], issues: [], fingerprint: 'first'}), cooked: event => {calls++;assert.equal(event.expected, 'first');assert.equal(event.amounts[0].quantity, 300);return new Promise(done => {resolve = done;});}});
  h.mount();assert.equal(calls, 0);const button = h.buttons().find(node => node.textContent === 'Yes, deduct ingredients');
  const first = button.onclick();await button.onclick();assert.equal(calls, 1);assert.equal(button.disabled, true);
  resolve({ok: true, message: 'At home updated.'});await first;assert.equal(h.buttons().some(node => node.textContent === 'Yes, deduct ingredients'), false);
});

test('stale Done amounts require an explicit refreshed review before a new confirmation', async () => {
  const seen = [];let previews = 0;const h = cookFixture({previewCook: () => ({ok: true, rows: [{...h.row, required: ++previews === 1 ? 300 : 400}], issues: [], fingerprint: 'preview-' + previews}), cooked: async event => {seen.push(event);return seen.length === 1 ? {ok: false, needsReview: true, message: 'Pantry changed.'} : {ok: true, message: 'At home updated.'};}});
  h.mount();await h.buttons().find(node => node.textContent === 'Yes, deduct ingredients').onclick();
  assert.equal(seen.length, 1);const refresh = h.buttons().find(node => node.textContent === 'Review latest amounts');assert.ok(refresh);
  refresh.onclick();assert.equal(seen.length, 1, 'refresh itself does not deduct');
  await h.buttons().find(node => node.textContent === 'Yes, deduct ingredients').onclick();
  assert.equal(seen[1].expected, 'preview-2');assert.equal(seen[1].amounts[0].quantity, 400);
});

test('blank edited Cook amounts are rejected before deduction rather than treated as zero', async () => {
  let calls = 0;const h = cookFixture({previewCook: () => ({ok: true, rows: [h.row], issues: [], fingerprint: 'first'}), cooked: async () => {calls++;return {ok: true};}});
  h.mount();const input = h.doc.body.querySelector('input');input.value = '';
  await h.buttons().find(node => node.textContent === 'Yes, deduct ingredients').onclick();assert.equal(calls, 0);assert.equal(h.doc.activeElement, input);
});
