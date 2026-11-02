import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import * as Core from '../bb-receipt-inventory-core.mjs';

// Runs the actual SQL functions in PostgreSQL (PGlite), never a live account.
// Supply an isolated installation using BB_RECEIPT_PGLITE_PATH; no app dependency.
const modulePath = process.env.BB_RECEIPT_PGLITE_PATH;
test('actual PostgreSQL receipt policy stocks, opts out, retries and preserves later Cook balances', {skip: !modulePath}, async () => {
  const {PGlite} = await import(pathToFileURL(modulePath).href), db = new PGlite();
  const actor = '11111111-1111-4111-8111-111111111111', scope = {kind: 'user', id: actor};
  const catalog = {'rice|g': true};
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      CREATE TABLE public.bb_households(id uuid primary key,owner_user_id uuid,partner_user_id uuid,partner_email text,invite_status text);
      INSERT INTO auth.users VALUES ('${actor}','cook@example.test',now());`);
    await db.exec(await readFile(new URL('../sql/basketboss_receipt_inventory_20261031.sql', import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261102183209_receipt_auto_stock_policy.sql', import.meta.url),'utf8'));
    const rpc = async (action, body = {}, receiptId = null) => (await db.query(`SELECT public.bb_receipt_inventory_service($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS result`, [actor, 'user', actor, action, body.requestId || null, receiptId || body.receiptId || null, body.receiptId ? 'a'.repeat(64) : null, JSON.stringify(body)])).rows[0].result;
    const make = (receiptId, addToPantry, revision, stock) => {
      const body = Core.validateReceiptConfirmation({action: 'confirm_receipt', addToPantry, expectedScope: scope, requestId: 'request-' + receiptId, receiptId, shopSessionId: 'shop-current', market: 'UK', currency: 'GBP', retailer: 'Tesco', purchasedAt: '2026-11-02T12:00:00Z', receiptTotal: 5, adjustments: [], inventoryBaseline: {stock, expectedRevision: revision, initialize: revision === 0}, lines: [
        {lineId: 'rice', kind: 'food', canonicalKey: 'rice', name: 'Rice', brand: '', quantity: 1, unit: 'kg', packQuantity: 1, packUnit: 'kg', packCount: 1, pricePaid: 2, priceType: 'regular', location: 'cupboard'},
        {lineId: 'soap', kind: 'essential', canonicalKey: null, name: 'Soap', brand: '', quantity: 6, unit: 'each', packQuantity: 6, packUnit: 'each', packCount: 1, pricePaid: 3, priceType: 'regular', location: 'cupboard'}
      ]}, {catalog});
      body.priceObservations = body.lines.map(line => Core.normalizePriceObservation(line, {...body, scope})).filter(Boolean);
      return body;
    };
    const status = await rpc('status');assert.equal(status.autoStockReady, true);
    const first = make('receipt-1', true, 0, {'rice|g': 200});
    const stocked = await rpc('confirm_receipt', first);
    assert.equal(stocked.ok, true, JSON.stringify(stocked));assert.equal(stocked.stock['rice|g'], 1200);
    assert.equal(stocked.essentials[0].quantity, 6);assert.equal(stocked.essentials[0].addToPantry, true);
    assert.equal(stocked.pantryReview.required, false);assert.equal(stocked.priceObservations.length, 1);
    const replay = await rpc('confirm_receipt', first);assert.equal(replay.duplicate, true);assert.equal(replay.stock['rice|g'], 1200);
    const priceOnly = await rpc('confirm_receipt', make('receipt-2', false, 1, stocked.stock));
    assert.equal(priceOnly.ok, true, JSON.stringify(priceOnly));assert.equal(priceOnly.stock['rice|g'], 1200);
    assert.equal(priceOnly.essentials.find(x => x.receiptId === 'receipt-2').addToPantry, false);
    assert.equal(priceOnly.priceObservations.length, 2);assert.equal(priceOnly.receipts.length, 2);
    const cooked = await rpc('confirm_pantry', {action: 'confirm_pantry', expectedScope: scope, expectedRevision: 2, stock: {'rice|g': 600}, shopSessionId: 'shop-next'});
    assert.equal(cooked.stock['rice|g'], 600);
    const laterRetry = await rpc('confirm_receipt', first);assert.equal(laterRetry.duplicate, true);assert.equal(laterRetry.stock['rice|g'], 600);
    const bad = make('receipt-3', true, 3, {'rice|g': 600});bad.addToPantry = 'yes';
    const rejected = await rpc('confirm_receipt', bad);assert.equal(rejected.ok, false);assert.equal(rejected.invalid, true);
    assert.equal((await rpc('get')).stock['rice|g'], 600);
    // The replacement keeps service-only execute grants and every existing RLS flag.
    const flags = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname IN ('bb_receipt_inventory_scopes','bb_receipt_inventory_receipts','bb_receipt_inventory_requests','bb_receipt_inventory_legacy_claims')`)).rows;
    assert.equal(flags.length, 4);assert.ok(flags.every(x => x.relrowsecurity));
    const access = (await db.query(`SELECT has_function_privilege('anon','public.bb_receipt_inventory_service(uuid,text,uuid,text,text,text,text,jsonb)','EXECUTE') AS anon, has_function_privilege('authenticated','public.bb_receipt_inventory_service(uuid,text,uuid,text,text,text,text,jsonb)','EXECUTE') AS authenticated`)).rows[0];
    assert.deepEqual(access, {anon: false, authenticated: false});
  } finally {await db.close();}
});
