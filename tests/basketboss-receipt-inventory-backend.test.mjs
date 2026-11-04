import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet, onRequestPost, semanticReceiptPayload, validatePantryConfirmation} from '../functions/api/receipt-inventory.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const PRICE = 'pri_' + 'a'.repeat(26);
const bearer = 'header.' + Buffer.from(JSON.stringify({sub: USER, session_id: SESSION, exp: Date.now() / 1000 + 3600})).toString('base64url') + '.signature';
const food = {lineId: 'food-1', kind: 'food', canonicalKey: 'dried pasta', name: 'Pasta', brand: '', quantity: 500, unit: 'g', packCount: 1, packQuantity: 500, packUnit: 'g', pricePaid: 1.25, priceType: 'regular', location: 'cupboard', legacyCredit: {id: 'shop-test|dried pasta|g', quantity: 300, unit: 'g'}};
const essential = {lineId: 'essential-1', kind: 'essential', canonicalKey: null, name: 'Shampoo', brand: '', quantity: null, unit: null, packCount: null, packQuantity: null, packUnit: null, pricePaid: 3.5, priceType: 'regular', location: 'cupboard'};
const draft = () => ({action: 'confirm_receipt', expectedScope: {kind: 'user', id: USER}, requestId: 'request-1', receiptId: 'receipt-1', shopSessionId: 'shop-test', market: 'UK', currency: 'GBP', retailer: 'Test Store', purchasedAt: '2026-10-31T12:00:00Z', receiptTotal: 3.75, adjustments: [{lineId: 'discount-1', kind: 'discount', amount: -1, description: 'Coupon'}], inventoryBaseline: {stock: {'dried pasta|g': 300}, expectedRevision: 0, initialize: true}, lines: [structuredClone(food), structuredClone(essential)]});
function request(method = 'GET', body, query = '') {
  return new Request('https://basketboss.co.uk/api/receipt-inventory' + query, {method, headers: {Authorization: 'Bearer ' + bearer, Origin: 'https://basketboss.co.uk', 'Content-Type': 'application/json'}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
}
function setup(options = {}) {
  const original = globalThis.fetch;
  const rpc = [], prices = new Map(options.paid === false ? [] : [[USER, true]]);
  if (options.ownerPaid) prices.set(OWNER, true);
  const env = {BB_RECEIPT_INVENTORY_ENABLED: 'true', BB_PREMIUM_SINGLE_SESSION_ENABLED: 'true', BB_BILLING_MODE: 'live', BB_BILLING_ENABLED: 'true', BB_LIVE_WEBHOOK_ENABLED: 'true', SUPABASE_URL: 'https://kbhyosxuvlcazyzzinqv.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public_' + 'a'.repeat(30), SUPABASE_SECRET_KEY: 'sb_secret_' + 's'.repeat(40), PADDLE_LIVE_FOUNDER_PRICE_ID: PRICE, PADDLE_LIVE_STANDARD_PRICE_ID: 'pri_' + 'b'.repeat(26), CF_PAGES_BRANCH: 'main',
    BILLING_DB: {prepare() {let user;return {bind(id) {user = id;return this;}, async first() {return prices.get(user) ? {status: 'active', price_id: PRICE, plan: 'founder'} : null;}};}}};
  if (options.household) {env.BB_PARTNER_SHARING_ENABLED = 'true';env.BB_PARTNER_PRODUCTION_READY = 'true';}
  const household = {id: HOUSEHOLD, owner_user_id: options.householdOwner ? USER : OWNER, partner_user_id: options.householdOwner ? OWNER : USER, partner_email: 'member@example.test', invite_status: options.unlinked ? 'unlinked' : 'accepted'};
  let revision = 0, stock = {}, initialized = false;
  const receipts = new Map();
  function snapshot(scope, extras = {}) {
    return {ok: true, autoStockReady: options.autoStockReady !== false, scope, initialized, inventoryRevision: revision, stock: {...stock}, inventory: Object.entries(stock).map(([key, quantity]) => ({stockKey: key, canonicalKey: key.split('|')[0], unit: key.split('|')[1], quantity, location: 'cupboard', revision})), essentials: [], priceObservations: [], pantryReview: {required: true, shopSessionId: null, confirmedAt: null}, ...extras};
  }
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.endsWith('/auth/v1/user')) return options.unauthenticated ? Response.json({}, {status: 401}) : Response.json({id: USER, email: 'member@example.test', email_confirmed_at: '2026-10-30T00:00:00Z'});
    if (address.endsWith('/rpc/bb_hh_service_session_ok')) return Response.json(options.currentSession !== false);
    if (address.includes('/bb_households?')) return Response.json(options.household && (household.owner_user_id === USER || household.partner_user_id === USER && household.invite_status === 'accepted') ? [household] : []);
    if (address.endsWith('/rpc/bb_receipt_inventory_service')) {
      assert.equal(init.headers.apikey, env.SUPABASE_SECRET_KEY);assert.equal(init.headers.Authorization, undefined);
      const body = JSON.parse(init.body);rpc.push(body);
      if (options.migrationMissing) return Response.json({code: 'PGRST202'}, {status: 404});
      if (options.rpcError) return Response.json(options.rpcError);
      const scope = {kind: body.p_scope_kind, id: body.p_scope_id};
      if (body.p_action === 'status') return Response.json({ok: true, autoStockReady: options.autoStockReady !== false});
      if (body.p_action === 'get') {
        const saved = receipts.get(body.p_receipt_id);
        return Response.json(snapshot(scope, body.p_receipt_id ? {receiptFound: !!saved, ...(saved ? {receiptId: body.p_receipt_id, receiptRevision: saved.revision} : {})} : {}));
      }
      if (body.p_action === 'confirm_pantry') {
        if (body.p_payload.expectedRevision !== revision) return Response.json({ok: false, error: 'receipt_revision_conflict', conflict: true});
        stock = {...body.p_payload.stock};initialized = true;revision++;
        return Response.json(snapshot(scope, {pantryReview: {required: false, shopSessionId: body.p_payload.shopSessionId, confirmedAt: '2026-10-31T12:00:00Z'}}));
      }
      const saved = receipts.get(body.p_receipt_id);
      if (saved) return Response.json(saved.hash === body.p_payload_hash ? snapshot(scope, {duplicate: true, receiptId: body.p_receipt_id, receiptRevision: saved.revision}) : {ok: false, error: 'receipt_identity_conflict', conflict: true});
      if (body.p_payload.inventoryBaseline.expectedRevision !== revision) return Response.json({ok: false, error: 'receipt_revision_conflict', conflict: true});
      stock = {...body.p_payload.inventoryBaseline.stock};
      for (const line of body.p_payload.lines) if (line.kind === 'food' && body.p_payload.addToPantry !== false) stock[line.canonicalKey + '|' + line.unit] = (stock[line.canonicalKey + '|' + line.unit] || 0) + line.quantity - (line.legacyCredit?.quantity || 0);
      revision++;initialized = true;receipts.set(body.p_receipt_id, {hash: body.p_payload_hash, revision});
      return Response.json(snapshot(scope, {duplicate: false, receiptId: body.p_receipt_id, receiptRevision: revision, essentials: body.p_payload.lines.filter(x => x.kind === 'essential').map(x => ({...x, receiptId: body.p_receipt_id, shopSessionId: body.p_payload.shopSessionId})), priceObservations: body.p_payload.priceObservations}));
    }
    throw Error('Unexpected mock address');
  };
  return {env, rpc, restore() {globalThis.fetch = original;}};
}

test('disabled availability is supported without auth, database or stock writes', async () => {
  const fixture = setup();try {
    fixture.env.BB_RECEIPT_INVENTORY_ENABLED = 'false';
    const result = await onRequestGet({request: request('GET', undefined, '?mode=status'), env: fixture.env});
    assert.equal(result.status, 200);assert.equal((await result.json()).available, false);assert.equal(fixture.rpc.length, 0);
    assert.equal((await onRequestPost({request: request('POST', draft()), env: fixture.env})).status, 503);
  } finally {fixture.restore();}
});
test('unauthenticated, unpaid and stale-seat callers cannot mutate inventory', async () => {
  for (const [options, expected] of [[{unauthenticated: true}, 401], [{paid: false}, 403], [{currentSession: false}, 403]]) {
    const fixture = setup(options);try {assert.equal((await onRequestPost({request: request('POST', draft()), env: fixture.env})).status, expected);assert.equal(fixture.rpc.length, 0);} finally {fixture.restore();}
  }
});
test('verified app owner keeps personal review access without granting partner inheritance', async () => {
  const fixture = setup({paid: false});try {fixture.env.BB_OWNER_USER_ID = USER;assert.equal((await onRequestGet({request: request('GET', undefined, '?mode=status'), env: fixture.env})).status, 200);assert.equal(fixture.rpc[0].p_scope_kind, 'user');} finally {fixture.restore();}
});
test('missing migration reports unavailable and never claims the pantry was saved', async () => {
  const fixture = setup({migrationMissing: true});try {
    const response = await onRequestGet({request: request('GET', undefined, '?mode=status'), env: fixture.env});
    const value = await response.json();assert.equal(value.available, false);assert.equal(value.migrationReady, false);assert.equal(value.premium, true);
    assert.equal((await onRequestPost({request: request('POST', draft()), env: fixture.env})).status, 503);
  } finally {fixture.restore();}
});
test('confirmation sends measured net credit, separate essentials and scoped exact-pack price observations', async () => {
  const fixture = setup();try {
    const response = await onRequestPost({request: request('POST', draft()), env: fixture.env});assert.equal(response.status, 200);
    const result = await response.json();assert.equal(result.stock['dried pasta|g'], 500);assert.equal(result.inventory.length, 1);assert.equal(result.essentials[0].shopSessionId, 'shop-test');
    const call = fixture.rpc[0];assert.equal(call.p_actor, USER);assert.equal(call.p_scope_id, USER);assert.equal(call.p_scope_kind, 'user');
    assert.equal(call.p_payload.receiptTotal, 3.75);assert.equal(call.p_payload.adjustments[0].amount, -1);
    assert.equal(call.p_payload.priceObservations.length, 1);assert.equal(call.p_payload.priceObservations[0].scopeId, USER);assert.equal(call.p_payload.priceObservations[0].packPrice, 1.25);assert.equal(call.p_payload.priceObservations[0].packQuantity, 500);
    assert.match(call.p_payload_hash, /^[a-f0-9]{64}$/);assert.equal(JSON.stringify(call).includes('imageBase64'), false);
  } finally {fixture.restore();}
});
test('native iOS receipt confirmation keeps the same authenticated scope and net pantry transaction', async () => {
  const fixture = setup();try {
    const base = request('POST', draft());
    const headers = new Headers(base.headers);headers.set('Origin', 'capacitor://localhost');headers.set('Sec-Fetch-Site', 'cross-site');
    const response = await onRequestPost({request: new Request(base, {headers}), env: fixture.env});
    assert.equal(response.status, 200);const value = await response.json();
    assert.equal(value.stock['dried pasta|g'], 500);assert.equal(fixture.rpc.length, 1);
    assert.equal(fixture.rpc[0].p_actor, USER);assert.equal(fixture.rpc[0].p_scope_id, USER);
    assert.equal(fixture.rpc[0].p_scope_kind, 'user');
  } finally {fixture.restore();}
});
test('retry hash excludes synchronization baseline/request ID but changed receipt semantics conflict', async () => {
  const fixture = setup();try {
    assert.equal((await onRequestPost({request: request('POST', draft()), env: fixture.env})).status, 200);
    const retry = draft();retry.requestId = 'different-transport-id';retry.inventoryBaseline = {stock: {'dried pasta|g': 500}, expectedRevision: 1, initialize: false};
    const response = await onRequestPost({request: request('POST', retry), env: fixture.env});
    assert.equal(response.status, 200);const result = await response.json();assert.equal(result.duplicate, true);assert.equal(result.stock['dried pasta|g'], 500);assert.equal(result.receiptRevision, 1);
    assert.equal(fixture.rpc[0].p_payload_hash, fixture.rpc[1].p_payload_hash);
    retry.receiptTotal = 99;assert.equal((await onRequestPost({request: request('POST', retry), env: fixture.env})).status, 409);
  } finally {fixture.restore();}
});
test('recovery probe returns the receipt commit revision without another increment', async () => {
  const fixture = setup();try {
    await onRequestPost({request: request('POST', draft()), env: fixture.env});
    const response = await onRequestGet({request: request('GET', undefined, '?receiptId=receipt-1'), env: fixture.env});const result = await response.json();
    assert.equal(result.receiptFound, true);assert.equal(result.receiptRevision, 1);assert.equal(result.stock['dried pasta|g'], 500);
    const missing = await onRequestGet({request: request('GET', undefined, '?receiptId=missing'), env: fixture.env});assert.equal((await missing.json()).receiptFound, false);
  } finally {fixture.restore();}
});
test('accepted partner scope is derived from confirmed email and paid owner, never caller fields', async () => {
  const fixture = setup({paid: false, household: true, ownerPaid: true});try {
    const body = draft();body.expectedScope = {kind: 'household', id: HOUSEHOLD};
    const response = await onRequestPost({request: request('POST', body), env: fixture.env});assert.equal(response.status, 200);
    assert.equal(fixture.rpc[0].p_scope_kind, 'household');assert.equal(fixture.rpc[0].p_scope_id, HOUSEHOLD);assert.equal(fixture.rpc[0].p_actor, USER);
    const spoofed = draft();spoofed.scope = {kind: 'user', id: OWNER};assert.equal((await onRequestPost({request: request('POST', spoofed), env: fixture.env})).status, 400);
    assert.equal(fixture.rpc.length, 1);
  } finally {fixture.restore();}
});
test('a paid household owner retains the same scope after unlink while the former partner is denied', async () => {
  const owner = setup({household: true, householdOwner: true, unlinked: true});try {
    const response = await onRequestGet({request: request(), env: owner.env});assert.equal(response.status, 200);
    assert.equal(owner.rpc[0].p_scope_kind, 'household');assert.equal(owner.rpc[0].p_scope_id, HOUSEHOLD);
  } finally {owner.restore();}
  const partner = setup({paid: false, household: true, ownerPaid: true, unlinked: true});try {
    assert.equal((await onRequestGet({request: request(), env: partner.env})).status, 403);assert.equal(partner.rpc.length, 0);
  } finally {partner.restore();}
});
test('an old user or household snapshot cannot mutate a newly derived scope with the same revision', async () => {
  for (const options of [{}, {paid: false, household: true, ownerPaid: true}]) {
    const fixture = setup(options);try {
      const body = draft();
      body.expectedScope = options.household ? {kind: 'user', id: USER} : {kind: 'household', id: HOUSEHOLD};
      const response = await onRequestPost({request: request('POST', body), env: fixture.env});
      assert.equal(response.status, 409);assert.equal((await response.json()).error, 'receipt_scope_conflict');assert.equal(fixture.rpc.length, 0);
      const pantry = {action: 'confirm_pantry', expectedScope: body.expectedScope, stock: {'homemade pesto|g': 123}, expectedRevision: 0, shopSessionId: 'race'};
      assert.equal((await onRequestPost({request: request('POST', pantry), env: fixture.env})).status, 409);assert.equal(fixture.rpc.length, 0);
    } finally {fixture.restore();}
  }
});
test('household goods, unknown food keys, refunds-as-food and malformed stock are rejected before RPC', async () => {
  for (const mutate of [
    body => {body.lines[0].name = 'Shampoo';},
    body => {body.lines[0].canonicalKey = 'unknown-unlisted-ingredient';},
    body => {body.lines[0].pricePaid = -1;},
    body => {body.inventoryBaseline.stock = {'shampoo|ml': 500};},
    body => {body.actorId = OWNER;},
    body => {body.imageBase64 = 'a'.repeat(1000);}
  ]) {
    const fixture = setup();try {const body = draft();mutate(body);assert.equal((await onRequestPost({request: request('POST', body), env: fixture.env})).status, 400);assert.equal(fixture.rpc.length, 0);} finally {fixture.restore();}
  }
});
test('pantry confirmation is an absolute revision-checked replacement', async () => {
  const fixture = setup();try {
    await onRequestPost({request: request('POST', draft()), env: fixture.env});
    const body = {action: 'confirm_pantry', stock: {'dried pasta|g': 225}, expectedRevision: 1, expectedScope: {kind: 'user', id: USER}, shopSessionId: 'next-shop'};
    const response = await onRequestPost({request: request('POST', body), env: fixture.env});const result = await response.json();assert.equal(result.stock['dried pasta|g'], 225);assert.equal(result.pantryReview.required, false);
    assert.equal((await onRequestPost({request: request('POST', body), env: fixture.env})).status, 409);
    assert.throws(() => validatePantryConfirmation({...body, scope: USER}));
  } finally {fixture.restore();}
});
test('valid existing custom Kitchen food survives baseline sync without creating a learned price', async () => {
  const fixture = setup();try {
    const body = draft();body.inventoryBaseline.stock['homemade pesto|g'] = 75;
    const response = await onRequestPost({request: request('POST', body), env: fixture.env});
    assert.equal(response.status, 200);const result = await response.json();
    assert.equal(result.stock['homemade pesto|g'], 75);assert.equal(result.stock['dried pasta|g'], 500);
    assert.equal(fixture.rpc[0].p_payload.priceObservations.length, 1);
    assert.equal(fixture.rpc[0].p_payload.priceObservations[0].canonicalKey, 'dried pasta');
    assert.deepEqual(validatePantryConfirmation({action: 'confirm_pantry', stock: {'homemade pesto|g': 50}, expectedRevision: 1, expectedScope: {kind: 'user', id: USER}, shopSessionId: null}).stock, {'homemade pesto|g': 50});
  } finally {fixture.restore();}
});
test('cross-origin requests, oversized bodies and foreign scope queries fail closed', async () => {
  const fixture = setup();try {
    const foreign = request('POST', draft());foreign.headers.set('Origin', 'https://foreign.example');
    assert.equal((await onRequestPost({request: foreign, env: fixture.env})).status, 403);
    const huge = request('POST', {blob: 'x'.repeat(800000)});assert.equal((await onRequestPost({request: huge, env: fixture.env})).status, 413);
    assert.equal((await onRequestGet({request: request('GET', undefined, '?scope=' + OWNER), env: fixture.env})).status, 400);
    assert.equal(fixture.rpc.length, 0);
  } finally {fixture.restore();}
});
test('RPC scope denial and revision errors preserve proper HTTP semantics', async () => {
  for (const [rpcError, expected] of [[{ok: false, error: 'receipt_scope_forbidden', forbidden: true}, 403], [{ok: false, error: 'receipt_revision_conflict', conflict: true}, 409], [{ok: false, error: 'receipt_invalid_payload', invalid: true}, 400]]) {
    const fixture = setup({rpcError});try {assert.equal((await onRequestPost({request: request('POST', draft()), env: fixture.env})).status, expected);} finally {fixture.restore();}
  }
});
test('semantic payload includes total and adjustments while excluding transport synchronization metadata', () => {
  const body = semanticReceiptPayload(draft());assert.equal(body.requestId, undefined);assert.equal(body.inventoryBaseline, undefined);assert.equal(body.receiptTotal, 3.75);assert.equal(body.adjustments.length, 1);
});

test('pre-auto-stock schema remains unavailable so the receipt UI uses the safe local flow', async () => {
  const fixture = setup({autoStockReady: false});try {
    const result = await (await onRequestGet({request: request('GET', undefined, '?mode=status'), env: fixture.env})).json();
    assert.equal(result.available, false);assert.equal(result.migrationReady, false);assert.equal(result.reason, 'migration_unavailable');
  } finally {fixture.restore();}
});

test('explicit receipt pantry policy is server-bound and malformed policy is rejected', async () => {
  const fixture = setup();try {
    const body = draft();body.addToPantry = false;delete body.lines[0].legacyCredit;
    const response = await onRequestPost({request: request('POST', body), env: fixture.env});assert.equal(response.status, 200);
    assert.equal((await response.json()).stock['dried pasta|g'], 300);assert.equal(fixture.rpc[0].p_payload.addToPantry, false);assert.equal(fixture.rpc[0].p_payload.priceObservations.length, 1);
    const bad = draft();bad.addToPantry = 'false';assert.equal((await onRequestPost({request: request('POST', bad), env: fixture.env})).status, 400);
    assert.equal(fixture.rpc.length, 1);
  } finally {fixture.restore();}
});

test('API pantry sync round-trips partial packs and each balances without loosening receipt purchase counts', async () => {
  const fixture=setup();try {
    const body={action:'confirm_pantry',stock:{'eggs|each':1.5,'rice|packs':1/3,'herbs|g':1e-9},expectedRevision:0,expectedScope:{kind:'user',id:USER},shopSessionId:'next'};
    const response=await onRequestPost({request:request('POST',body),env:fixture.env});
    assert.equal(response.status,200);assert.deepEqual((await response.json()).stock,{'egg|each':1.5,'rice|pack':1/3,'herbs|g':1e-9});
    const get=await onRequestGet({request:request('GET'),env:fixture.env});assert.equal(get.status,200);assert.deepEqual((await get.json()).stock,{'egg|each':1.5,'rice|pack':1/3,'herbs|g':1e-9});
    const receipt=draft();Object.assign(receipt.lines[0],{quantity:1.5,unit:'pack',packQuantity:null,packUnit:null,packCount:null});
    assert.equal((await onRequestPost({request:request('POST',receipt),env:fixture.env})).status,400);
  } finally {fixture.restore();}
});
