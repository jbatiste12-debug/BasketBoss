import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInput, validateGeminiResult, geminiRequest, onRequest, RECEIPT_INVENTORY_SCHEMA} from '../functions/api/bb173/[action].js';

const user = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const bearer = 'header.' + Buffer.from(JSON.stringify({sub: user, session_id: session, exp: Date.now() / 1000 + 3600})).toString('base64url') + '.signature';
const photo = {mimeType: 'image/jpeg', imageBase64: btoa('\xff\xd8\xff' + 'a'.repeat(90))};
const input = {...photo, scanKind: 'receipt_inventory', expectedCurrency: 'GBP', turnstileToken: ''};
const food = {lineId: 'one', name: 'Pasta 500 g', brand: '', kind: 'food', canonicalKey: 'dried pasta', quantity: 500, unit: 'g', packCount: 1, packQuantity: 500, packUnit: 'g', pricePaid: 1.25, priceType: 'regular', confidence: 'high', notes: ''};
const essential = {...food, lineId: 'two', name: 'Shampoo', kind: 'essential', canonicalKey: '', quantity: null, unit: 'unknown', packCount: null, packQuantity: null, packUnit: 'unknown', pricePaid: 3.5};
const discount = {...essential, lineId: 'three', name: 'Coupon', kind: 'discount', pricePaid: -1};
const receipt = {currency: 'GBP', retailer: 'Test Supermarket', purchasedAt: '2026-10-31T12:00:00Z', receiptTotal: 3.75, items: [food, essential, discount], notes: ''};

test('full receipt input uses the same image gate without requiring basket product context', () => {
  assert.equal(validateInput('scan', input), null);
  for (const extra of [{expectedCurrency: 'EUR'}, {imageBase64: 'bad image'}, {mimeType: 'application/pdf'}, {scanKind: 'unlimited_inventory'}]) assert.ok(validateInput('scan', {...input, ...extra}));
});
test('full receipt schema preserves food, essentials, visible adjustments and actual total', () => {
  assert.equal(validateGeminiResult('scan', receipt, input), true);
  const unknown = {...food, lineId: 'unknown', kind: 'unknown', canonicalKey: '', quantity: null, unit: 'unknown', packCount: null, packQuantity: null, packUnit: 'unknown', pricePaid: null};
  assert.equal(validateGeminiResult('scan', {...receipt, items: [unknown], currency: '', purchasedAt: null, receiptTotal: null}, input), true);
  assert.equal(geminiRequest('scan', input).schema, RECEIPT_INVENTORY_SCHEMA);
});
test('receipt output rejects invented canonical keys, duplicated rows, invalid packs and non-finite prices', () => {
  for (const extra of [
    {items: [{...food, canonicalKey: 'imaginary ingredient'}]}, {items: [food, food]}, {items: [{...food, packCount: 0}]},
    {items: [{...food, quantity: -1}]}, {items: [{...food, pricePaid: Infinity}]}, {items: [{...essential, canonicalKey: 'dried pasta'}]},
    {items: Array.from({length: 201}, (_, i) => ({...food, lineId: String(i)}))}, {purchasedAt: 'not a timestamp'}, {receiptTotal: '3.75'}
  ]) assert.equal(validateGeminiResult('scan', {...receipt, ...extra}, input), false);
});
test('receipt prompt enforces privacy, no inferred packs and the distinction from owned stock', () => {
  const request = geminiRequest('scan', input), prompt = request.parts[0].text;
  assert.match(prompt, /UNTRUSTED DATA/);assert.match(prompt, /payment numbers/);assert.match(prompt, /Never infer a pack size/);
  assert.match(prompt, /TOTAL paid for this receipt line/);assert.match(prompt, /nothing enters Pantry/);assert.match(prompt, /must never become food/);
  assert.deepEqual(request.parts[1].inline_data, {mime_type: photo.mimeType, data: photo.imageBase64});
});

function setup({enabled = true, migrated = true, quota = true} = {}) {
  const original = globalThis.fetch, calls = [], bindings = [];
  const env = {BB_RECEIPT_INVENTORY_ENABLED: String(enabled), BB_PREMIUM_SINGLE_SESSION_ENABLED: 'true', BB_PREMIUM_AI_ENABLED: 'true', BB_BILLING_MODE: 'live', BB_BILLING_ENABLED: 'true', BB_OWNER_USER_ID: user, CF_PAGES_BRANCH: 'main', SUPABASE_URL: 'https://kbhyosxuvlcazyzzinqv.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public_' + 'p'.repeat(30), SUPABASE_SECRET_KEY: 'sb_secret_' + 's'.repeat(40), GEMINI_API_KEY: 'test-secret', TURNSTILE_SECRET_KEY: 'test-secret', TURNSTILE_SITE_KEY: 'test-site', BB_AI_GLOBAL_DAILY_CAP: '20',
    BILLING_DB: {prepare(sql) {return {bind(...values) {bindings.push({sql, values});return this;}, async first() {return sql.includes('bb_paid_entitlements') ? null : quota ? {used: 1} : null;}};}}};
  globalThis.fetch = async (address, options) => {
    calls.push(String(address));
    if (String(address).endsWith('/auth/v1/user')) return Response.json({id: user, email: 'owner@example.test', email_confirmed_at: '2026-10-31T00:00:00Z'});
    if (String(address).endsWith('/rpc/bb_hh_service_session_ok')) return Response.json(true);
    if (String(address).endsWith('/rpc/bb_receipt_inventory_service')) return migrated ? Response.json({ok: true}) : Response.json({code: 'PGRST202'}, {status: 404});
    if (String(address).includes('generativelanguage')) {
      const body = JSON.parse(options.body);assert.equal(body.generationConfig.responseSchema.required.includes('receiptTotal'), true);
      return Response.json({candidates: [{content: {parts: [{text: JSON.stringify(receipt)}]}}]});
    }
    throw Error('Unexpected mocked request');
  };
  const make = () => new Request('https://basketboss.co.uk/api/bb173/scan', {method: 'POST', headers: {Authorization: 'Bearer ' + bearer, Origin: 'https://basketboss.co.uk', 'Content-Type': 'application/json'}, body: JSON.stringify(input)});
  return {env, calls, bindings, make, restore() {globalThis.fetch = original;}};
}
test('full receipt request retains the existing five-scan quota and returns a separate review-only draft', async () => {
  const fixture = setup();try {
    const response = await onRequest({request: fixture.make(), env: fixture.env, params: {action: 'scan'}});
    assert.equal(response.status, 200);const result = await response.json();assert.equal(result.reviewRequired, true);assert.deepEqual(result.receiptInventory, receipt);assert.equal(result.receiptPrices, undefined);assert.equal(result.scan, undefined);
    assert.equal(fixture.bindings.some(row => row.values[1] === 'user:' + user && row.values[2] === 'scan' && row.values[3] === 5), true);
    assert.equal(fixture.calls.filter(url => url.endsWith('/rpc/bb_receipt_inventory_service')).length, 1);
  } finally {fixture.restore();}
});
test('disabled or missing inventory migration prevents quota use and sending any photograph', async () => {
  for (const options of [{enabled: false}, {migrated: false}]) {
    const fixture = setup(options);try {
      assert.equal((await onRequest({request: fixture.make(), env: fixture.env, params: {action: 'scan'}})).status, 503);
      assert.equal(fixture.calls.some(url => url.includes('generativelanguage')), false);
      assert.equal(fixture.bindings.some(row => row.sql.includes('bb_ai_daily_usage')), false);
    } finally {fixture.restore();}
  }
});
test('the existing scan quota cannot be bypassed by choosing receipt_inventory', async () => {
  const fixture = setup({quota: false});try {
    assert.equal((await onRequest({request: fixture.make(), env: fixture.env, params: {action: 'scan'}})).status, 429);
    assert.equal(fixture.calls.some(url => url.includes('generativelanguage')), false);
  } finally {fixture.restore();}
});
