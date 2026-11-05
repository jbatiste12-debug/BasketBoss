import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import * as Core from '../bb-receipt-inventory-core.mjs';

// Exercise the production SQL in isolated PostgreSQL, never a live account.
// Keep PGlite outside the application dependencies, as in the auto-stock audit.
const modulePath = process.env.BB_RECEIPT_PGLITE_PATH;
test('household receipt price projection preserves stock, history, policy and service-only access', {skip: !modulePath}, async () => {
  const {PGlite} = await import(pathToFileURL(modulePath).href), db = new PGlite();
  const actor = '11111111-1111-4111-8111-111111111111', scope = {kind: 'user', id: actor};
  const migration = await readFile(new URL('../supabase/migrations/20261105084102_receipt_household_price_projection.sql', import.meta.url), 'utf8');
  const signature = 'public.bb_receipt_inventory_snapshot(text,uuid,text)';
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      CREATE TABLE public.bb_households(id uuid primary key,owner_user_id uuid,partner_user_id uuid,partner_email text,invite_status text);
      INSERT INTO auth.users VALUES ('${actor}','prices@example.test',now());`);
    await db.exec(await readFile(new URL('../sql/basketboss_receipt_inventory_20261031.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261104174441_receipt_auto_stock_policy.sql', import.meta.url), 'utf8'));
    const rpc = async (action, body = {}) => (await db.query(
      'SELECT public.bb_receipt_inventory_service($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS result',
      [actor, 'user', actor, action, body.requestId || null, body.receiptId || null, body.receiptId ? 'a'.repeat(64) : null, JSON.stringify(body)]
    )).rows[0].result;
    const body = Core.validateReceiptConfirmation({
      action: 'confirm_receipt', addToPantry: true, expectedScope: scope,
      requestId: 'price-projection-request', receiptId: 'price-projection-receipt', shopSessionId: 'shop-current',
      market: 'UK', currency: 'GBP', retailer: 'Tesco', purchasedAt: '2026-11-02T12:00:00Z',
      receiptTotal: 11, adjustments: [], inventoryBaseline: {stock: {'rice|g': 200}, expectedRevision: 0, initialize: true},
      lines: [
        {lineId: 'rice', kind: 'food', canonicalKey: 'rice', name: 'Rice', brand: '', quantity: 1, unit: 'kg', packQuantity: 1, packUnit: 'kg', packCount: 1, pricePaid: 2, priceType: 'regular', location: 'cupboard'},
        ...['regular', 'promotion', 'unknown'].map(priceType => ({
          lineId: 'soap-' + priceType, kind: 'essential', canonicalKey: null, name: 'Soap', brand: 'House brand',
          quantity: 6, unit: 'each', packQuantity: 6, packUnit: 'each', packCount: 1, pricePaid: 3,
          priceType, location: 'cupboard'
        }))
      ]
    }, {catalog: {'rice|g': true}});
    body.priceObservations = body.lines.map(line => Core.normalizePriceObservation(line, {...body, scope})).filter(Boolean);
    const original = await rpc('confirm_receipt', body);
    assert.equal(original.ok, true, JSON.stringify(original));
    assert.equal(original.stock['rice|g'], 1200);
    assert.equal(original.autoStockReady, true);
    assert.equal(original.essentials.length, 3);
    assert.equal(original.essentials[0].priceType, undefined);

    const storedRows = async () => {
      const tables = ['scopes', 'receipts', 'requests', 'legacy_claims'];
      return Promise.all(tables.map(async name => (await db.query(`SELECT to_jsonb(t) AS value FROM public.bb_receipt_inventory_${name} t ORDER BY to_jsonb(t)::text`)).rows));
    };
    const policy = async () => (await db.query(`SELECT p.prosecdef AS security_definer,p.proconfig,
      p.proacl::text AS acl,has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') AS service_role,
      NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS no_public_execute
      FROM pg_proc p WHERE p.oid=to_regprocedure($1)`, [signature])).rows[0];
    const beforeRows = await storedRows(), beforePolicy = await policy();
    await db.exec(migration);
    const upgraded = await rpc('get');
    assert.equal(upgraded.autoStockReady, true);
    assert.deepEqual(upgraded.stock, original.stock);
    assert.equal(upgraded.inventoryRevision, original.inventoryRevision);
    assert.deepEqual(upgraded.pantryReview, original.pantryReview);
    assert.deepEqual(upgraded.priceObservations, original.priceObservations);
    assert.deepEqual(upgraded.receipts, original.receipts);
    for (const entry of upgraded.essentials) {
      const priceType = entry.lineId.slice('soap-'.length);
      assert.equal(entry.priceType, priceType);
      assert.equal(entry.eligibleForRegularPrice, priceType === 'regular');
      assert.equal(entry.productName, 'Soap');
      assert.equal(entry.kind, 'essential');
      assert.equal(entry.brand, 'House brand');
      assert.equal(entry.packQuantity, 6);
      assert.equal(entry.packUnit, 'each');
      assert.equal(entry.market, 'UK');
      assert.equal(entry.currency, 'GBP');
      assert.equal(entry.retailer, 'Tesco');
      assert.equal(entry.addToPantry, true);
      assert.equal(entry.quantity, 6);
    }
    assert.deepEqual(await storedRows(), beforeRows);
    assert.deepEqual(await policy(), beforePolicy);
    assert.equal(beforePolicy.security_definer, true);
    assert.deepEqual(beforePolicy.proconfig, ['search_path=""']);
    assert.equal(beforePolicy.anon, false);
    assert.equal(beforePolicy.authenticated, false);
    assert.equal(beforePolicy.service_role, true);
    assert.equal(beforePolicy.no_public_execute, true);

    // The guard recognizes the applied metadata patch and does not reapply it.
    await db.exec(migration);
    assert.deepEqual(await rpc('get'), upgraded);
    assert.deepEqual(await storedRows(), beforeRows);
    assert.deepEqual(await policy(), beforePolicy);
    const rls = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname IN
      ('bb_receipt_inventory_scopes','bb_receipt_inventory_receipts','bb_receipt_inventory_requests','bb_receipt_inventory_legacy_claims')`)).rows;
    assert.equal(rls.length, 4);
    assert.ok(rls.every(row => row.relrowsecurity));
    const replay = await rpc('confirm_receipt', body);
    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.stock, original.stock);
    assert.deepEqual(await storedRows(), beforeRows);
  } finally {await db.close();}
});
