import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const continuation = require('../bb-shop-continuation.js');
const display = require('../bb-shop-purchase-ui.js');
const actor = '11111111-1111-4111-8111-111111111111';
const household = '22222222-2222-4222-8222-222222222222';
const archiveKey = 'basketboss_shop_session_archive_v7';
const sharedKey = 'basketboss_shared_shopping_requests_v1:' + actor;
const trip = {version: 7, id: 'shop-display-fixture', createdAt: '2026-11-11T10:00:00.000Z'};
const rows = [
  {id: 'rice|g', name: 'Rice', quantity: 833.333333, unit: 'g'},
  {id: 'herbs|g', name: 'Tiny herbs', quantity: .000001, unit: 'g'},
  {id: 'eggs|each', name: 'Eggs', quantity: 2.333333, unit: 'each'},
  {id: 'unknown|pack', name: 'Kitchen rolls', quantity: null, unit: 'pack', quantityNeedsReview: true},
];
const snapshot = continuation.prepareContinuation(trip, rows, {actor, market: 'UK'}).snapshot;
const format = (row, saved) => display.formatDisplayQty(row.quantity, row.unit, {market: saved.market, countMode: 'balance'});

test('saved-list copy formatting is optional and never rounds the archived quantities', () => {
  const before = JSON.stringify(snapshot);
  const legacy = continuation.formatList(snapshot);
  assert.match(legacy, /833\.333333 g Rice/);
  const formatted = continuation.formatList(snapshot, format);
  assert.match(formatted, /833 g Rice/);
  assert.match(formatted, /<1 g Tiny herbs/);
  assert.match(formatted, /2\.3 each Eggs/);
  assert.match(formatted, /Check quantity Kitchen rolls/);
  assert.doesNotMatch(formatted, /833\.333333|0\.000001|2\.333333/);
  assert.equal(continuation.formatList(snapshot), legacy);
  assert.equal(JSON.stringify(snapshot), before);
});

test('an unavailable optional formatter retains the existing saved-list fallback', () => {
  const legacy = continuation.formatList(snapshot);
  assert.equal(continuation.formatList(snapshot, () => undefined), legacy);
  assert.equal(continuation.formatList(snapshot, () => {throw Error('unavailable');}), legacy);
});

let chromium, browser;
try {({chromium} = require(process.env.BB_PLAYWRIGHT_MODULE || 'playwright'));} catch {}
before(async () => {
  if (chromium) browser = await chromium.launch({headless: true, executablePath: process.env.BB_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
});
after(async () => {await browser?.close();});

test('saved, shared, bought and pending UI quantities use the optional formatter without changing state or form drafts', {
  skip: !chromium ? 'Set BB_PLAYWRIGHT_MODULE to exercise the real DOM adapters' : false,
}, async () => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const sharedItem = (id, name, quantity, unit, completed = false) => ({id, household_id: household, name, quantity, unit, created_by: actor, added_by_name: 'Fixture', completed, completed_by: completed ? actor : null, revision: 1});
  const items = [
    sharedItem('33333333-3333-4333-8333-333333333333', 'Rice', 833.333333, 'g'),
    sharedItem('44444444-4444-4444-8444-444444444444', 'Tiny herbs', .000001, 'g'),
    sharedItem('55555555-5555-4555-8555-555555555555', 'Eggs', 2.333333, 'each', true),
  ];
  const pending = {id: '66666666-6666-4666-8666-666666666666', household_id: household, actor, name: 'Syrup', quantity: 17.123456, unit: 'ml'};
  try {
    await context.route('https://basketboss.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><html><body data-bbnext-view="shop-list"><main id="app"></main><div id="saved"></div></body></html>'}));
    await page.goto('https://basketboss.test/');
    await page.evaluate(({actor, household, items, pending, sharedKey, archiveKey, trip, snapshot}) => {
      localStorage.setItem('basketboss_cloud_session_v1', JSON.stringify({user: {id: actor}, access_token: 'fixture-token', expires_at: Math.floor(Date.now() / 1000) + 3600}));
      localStorage.setItem(sharedKey, JSON.stringify({version: 1, adds: [pending], completions: []}));
      localStorage.setItem(archiveKey, JSON.stringify({[trip.id]: {...trip, savedRemaining: snapshot}}));
      window.__requests = [];
      window.fetch = async (url, init = {}) => {
        window.__requests.push({url: String(url), method: init.method || 'GET'});
        return {ok: true, status: 200, json: async () => String(url).includes('mode=status') ? {configured: true, premium: true, household_id: household} : {ok: true, household_id: household, items}};
      };
    }, {actor, household, items, pending, sharedKey, archiveKey, trip, snapshot});
    for (const file of ['bb-shop-continuation.js', 'bb-shared-shopping.js']) await page.addScriptTag({content: await fs.readFile(new URL('../' + file, import.meta.url), 'utf8')});
    await page.evaluate(actor => {
      window.__savedView = BBShopContinuation.mount({container: document.getElementById('saved'), win: window, context: {actor, market: 'UK'}, onCopy: value => {window.__copied = value; return true;}});
    }, actor);
    await page.waitForFunction(() => BBSharedShopping.snapshot().phase === 'ready');
    await page.locator('.bbss-quantity').filter({hasText: '833.333333 g'}).waitFor();
    await page.locator('.bb-shop-continuation-details > summary').click();
    assert.match(await page.locator('.bb-shop-continuation-list').innerText(), /833\.333333/);
    const before = await page.evaluate(({sharedKey, archiveKey}) => ({stored: [localStorage.getItem(sharedKey), localStorage.getItem(archiveKey)], items: BBSharedShopping.snapshot().items, pending: BBSharedShopping.snapshot().pendingAdds}), {sharedKey, archiveKey});
    await page.evaluate(() => BBSharedShopping.openAdd());
    await page.locator('#bbSharedShoppingForm [name="quantity"]').fill('17.123456');
    await page.locator('#bbSharedShoppingForm [name="unit"]').selectOption('ml');
    await page.addScriptTag({content: await fs.readFile(new URL('../bb-shop-purchase-ui.js', import.meta.url), 'utf8')});
    await page.evaluate(() => {BBSharedShopping.afterRender(); window.__savedView.refresh();});
    await page.waitForFunction(() => [...document.querySelectorAll('.bbss-quantity')].some(node => node.textContent === '833 g'));
    await page.locator('.bb-shop-continuation-details > summary').click();
    assert.match(await page.locator('.bbss-list').innerText(), /<1 g/);
    assert.equal(await page.locator('.bbss-history .bbss-quantity').textContent(), '2.3 eggs');
    assert.match(await page.locator('.bbss-pending-list').innerText(), /Syrup · 17 ml · Not shared yet/);
    assert.match(await page.locator('.bb-shop-continuation-list').innerText(), /833 g/);
    assert.match(await page.locator('.bb-shop-continuation-list').innerText(), /<1 g/);
    await page.locator('.bb-shop-continuation-copy').click();
    await page.waitForFunction(() => typeof window.__copied === 'string');
    assert.doesNotMatch(await page.evaluate(() => window.__copied), /833\.333333|0\.000001|2\.333333/);
    assert.equal(await page.locator('#bbSharedShoppingForm [name="quantity"]').inputValue(), '17.123456');
    assert.equal(await page.locator('#bbSharedShoppingForm [name="unit"]').inputValue(), 'ml');
    const after = await page.evaluate(({sharedKey, archiveKey}) => ({stored: [localStorage.getItem(sharedKey), localStorage.getItem(archiveKey)], items: BBSharedShopping.snapshot().items, pending: BBSharedShopping.snapshot().pendingAdds}), {sharedKey, archiveKey});
    assert.deepEqual(after, before, 'rendering and copying preserve raw snapshots and stored bytes');
    assert.deepEqual(await page.evaluate(() => window.__requests.filter(request => request.method !== 'GET')), []);
    assert.deepEqual(errors, []);
  } finally {await context.close();}
});
