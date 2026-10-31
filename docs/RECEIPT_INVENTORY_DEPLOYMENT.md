# Receipt inventory rollout

The 500-recipe catalogue is already activated in D1. This separate feature uses
Supabase for reviewed receipts, stock, price observations and revision tracking.

1. Deploy the reviewed frontend, API and migration source from `main`. Keep
   `BB_RECEIPT_INVENTORY_ENABLED` absent or `false` during preparation. Existing
   price-only receipt review remains available to eligible Premium accounts.
2. In the production BasketBoss Supabase project, use SQL Editor to run the
   complete `sql/basketboss_receipt_inventory_20261031.sql`. It depends on the
   existing household migration. Run the whole file; it is transactional and
   idempotent. Do not apply it to a different project.
3. Set `BB_RECEIPT_INVENTORY_ENABLED=true` in the Cloudflare Pages project's
   **Production** variables, then deploy that configuration. Existing Supabase
   server credentials, live Premium entitlement, current-session and AI quota
   configuration remain required. No secret belongs in browser code.
4. Sign in to an eligible Premium account, open Shop and choose Scan Receipt.
   Review a small receipt first, checking the food mapping, amounts, prices,
   actual total and non-food subtotal. Confirm it and review Pantry before the
   next shop. Verify another signed-in device receives the same quantities.

The status endpoint `/api/receipt-inventory?mode=status` fails closed until
configuration, authentication, Premium access and the migration are ready.
The new landing section is hidden until the production feature is configured.
No production Supabase migration is performed merely by pushing this source.

## Verification

Run the repository suite with `node --test tests/*.test.mjs`. The real SQL/RPC
verification uses an isolated PostgreSQL WASM engine, without production access:

```sh
npm install --prefix /tmp/basketboss-receipt-tests --no-audit --no-fund --save-exact @electric-sql/pglite@0.5.14
BB_PGLITE_MODULE=/tmp/basketboss-receipt-tests/node_modules/@electric-sql/pglite node scripts/verify-receipt-inventory-postgres.mjs
```

The script verifies atomic rollback, duplicate/aliased request handling, net
legacy credits, exact-once stock, household permissions, scope/revision changes,
separate non-food spend, custom manual food stock and service-only SQL access.
Browser checks use synthetic receipts and mocked AI/cloud responses; they do
not claim a live model parse or live subscriber purchase.

Rollback the feature by setting the production flag to `false` and redeploying.
Preserve receipt tables and inventory; do not delete user data to disable the UI.
