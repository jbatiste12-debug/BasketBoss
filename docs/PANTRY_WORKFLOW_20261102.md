# Receipt → At home → Cook → next shop

This change connects reviewed receipt quantities and cooked servings to the
existing measured pantry. These are source changes; verification does not
publish the app, apply a production migration or update an installed iOS build.

## User flow

1. In Shop, choose **Scan receipt** and review the recognised items and prices.
   **Also add bought items & essentials to At Home pantry** starts enabled.
   Each included food or essential has editable bought quantities and units.
2. Check any **Estimated** amount. Explicit receipt measurements take priority,
   then UK catalogue/default pack sizes, then a matching shopping-list amount.
   An unmeasured essential can suggest one item; an unknown food receives no
   arbitrary pack. Estimates are suggestions until the user reviews and saves.
3. Save commits the reviewed price data and, when enabled, adds the purchases to
   At home and marks matching current shopping lines bought. Food matches use
   canonical ingredients; household essentials remain separate from recipe food.
   Turning the pantry option off leaves existing stock unchanged.
4. At the end of Cook, **Update your pantry?** offers **Yes, deduct ingredients**
   and **Review amounts**. Quantities reflect the cooked serving size. Review can
   change the amount used, including `0` to skip an ingredient.
5. Shop and At home use the remaining balance on the next render and future
   shopping sessions: `to buy = max(0, total needed − already got)`.

For example, `200 g` rice already at home plus a reviewed `1 kg` receipt gives
`1200 g`. Cooking with `600 g` leaves `600 g`. A later meal requiring `700 g`
therefore needs `100 g` from the next shop.

## Premium pantry photo scans

Small Fridge and Cupboard camera controls in At home open the existing Premium
AI food scanner, with its photo consent and review. Free users enter the existing
upgrade flow. The camera/file picker opens only after an explicit tap.

Reviewers choose a storage location and may enter a checked amount. That amount
replaces the confirmed amount in that location and preserves other confirmed
locations; saving the same review again cannot double the balance. Leaving the
amount blank saves the food name without granting measured stock. Unallocated
old stock and incompatible units require review instead of guessed credit.
Session, pantry-owner, pending-receipt and deletion changes guard the save, and a
storage failure rolls back the device writes. Returning to At home uses the new
measured balance for shopping immediately.

## Quantity and price rules

- Compatible mass units (`kg`, `g`) share a gram balance; compatible volume units
  (`l`, `ml`) share a millilitre balance. Counted units retain their identity.
- Cook uses exact units or compatible metric units. It does not infer a garlic
  bulb's clove count, a tin's contents, a spoon's density, or a food's weight from
  its count. Unknown amounts and incompatible units appear in review. Available
  matching units can still be deducted; other units stay in stock.
- Deduction cannot make stock negative. Exhausted entries leave active stock;
  their kitchen display quantities become zero. Multiple kitchen locations for
  one ingredient share one physical total.
- Existing regular-price eligibility and account/market/supermarket/exact-pack
  scoping still apply. A reviewed promotion or unknown price does not become a
  verified regular shelf price merely because the pantry was restocked.
- No recipe, stock or price is written by the quantity inference helper alone.

## Commit, replay and recovery behavior

The existing measured stock map remains the shared input to shopping arithmetic.
The receipt adapter also maintains the actor/scope-bound cloud projection and
purchase coverage. Receipt Save coordinates stock, kitchen display entries,
shopping state, essentials and learned-price changes through its local journal.

A retry of the same reviewed receipt identity must not increment stock or
essentials again. A changed payload under an already-used local receipt identity
is rejected. Cloud confirmations retain their existing request/receipt replay
checks and pending-confirmation recovery. This is Save/retry protection; a new
scan of the same physical receipt is not automatically identified as a duplicate.

Receipt coverage also tells Finish Shop that the purchase has already been
stocked, preventing a second credit. Historical surplus-only purchase records
require an explicit absolute At home review before Cook can consume them.

Cook previews are read-only. Confirmation checks the current actor, recipe,
planned occurrence, serving factor and saved pantry state. If they changed after
the preview, it requires a fresh review. A cooking session and a planned meal
occurrence each prevent repeated deduction; a separate real cook can create a
new completion. Stock, kitchen quantities and the completion record are committed
together. A failed write preserves retryability.

Cook commits the device balance before attempting online pantry confirmation.
Offline confirmation failure keeps the local result and explains that online
confirmation needs review or retry. Repeating Done does not deduct it again.
An unresolved receipt commit, account/scope change or conflicting remote pantry
revision still requires recovery or review. Confirmed leftover stock does not
expire when the shopping-session identifier changes.

## Implementation map

| Responsibility | Source |
| --- | --- |
| Receipt quantity inference and metric normalization | `bb-receipt-quantity.js` |
| Reviewed receipt controls | `bb-receipt-scanner.js`, `bb-price-scan.js` |
| Receipt normalization, validation and replay payloads | `bb-receipt-inventory-core.mjs` |
| Local/cloud stock projection, journal and essential checkpoints | `bb-receipt-inventory.js`, `bb-receipt-host.js` |
| Strict Cook deduction proposal | `bb-pantry-deduction.js` |
| Cook preview, atomic completion and replay guard | `bb-home.js` |
| Done confirmation and amount editor | `bb-cook-pantry.js` |
| Premium photo entry, reviewed amount proposal and guarded device save | `bb-pantry-camera.js`, `make-a-meal.js` |
| App host, shopping reconciliation and current list matching | matching `index.html` / `app.html` integration |

The web service worker and native build whitelist include the new runtime
modules. Installed iOS apps need a new bundled build to receive these changes.
Cloud receipt activation continues to use the configuration and authenticated
Premium checks in [RECEIPT_INVENTORY_DEPLOYMENT.md](RECEIPT_INVENTORY_DEPLOYMENT.md).
After its prerequisite `sql/basketboss_receipt_inventory_20261031.sql`, the
reviewed cloud policy requires
`supabase/migrations/20261102183209_receipt_auto_stock_policy.sql`.
API availability requires the migration's `autoStockReady` marker; an older
deployment retains the local receipt path until upgraded. Production SQL and
deployment are separate release actions; neither was performed by these checks.

## Verification

Run the focused behavior checks from the repository root:

```sh
node --test --test-isolation=none \
  tests/basketboss-receipt-quantity.test.mjs \
  tests/basketboss-pantry-deduction.test.mjs \
  tests/basketboss-pantry-cook-flow.test.mjs \
  tests/basketboss-pantry-ui.test.mjs \
  tests/basketboss-home-core.test.mjs
```

The closed-loop test executes the real receipt adapter, Cook controller,
measured-pantry reconciliation and basket estimator against synthetic receipt
data. It verifies stock increases, serving-scaled use, immediate shopping
recalculation, same-Save retry protection and balances carried to a new trip.
Other focused checks cover unknown amounts, incompatible units, zero floors,
edited amounts, actor/plan changes, stale previews, repeated Done, offline
confirmation and local-write rollback.

Run receipt backend/host integration and the Apple/keyboard regressions as part
of the normal release suite. Test mocks do not establish live OCR accuracy,
live household synchronization, a live subscription transaction or an actual
simulator run.

### Focused typecheck

The legacy app has no repository-wide TypeScript configuration. A focused
`strict` / `checkJs` / `noEmit` project checks the actual two pure JavaScript
models and their public input/output contracts. Positive calls, invalid-call
assertions and non-`any` result assertions prevent the contract harness from
passing through untyped exports. It does not claim to typecheck the legacy app.

Install the pinned verifier outside production dependencies:

```sh
npm install --prefix /workspace/work/pantry-typecheck \
  --cache /workspace/work/pantry-typecheck/npm-cache \
  --package-lock=false --save-exact --ignore-scripts --no-audit --no-fund typescript@5.9.3

BB_PANTRY_TYPESCRIPT_PATH=/workspace/work/pantry-typecheck/node_modules/typescript/lib/tsc.js \
  node scripts/check-pantry-types.mjs
```

`scripts/check-pantry-types.mjs` requires exactly TypeScript `5.9.3` and runs
`typechecks/tsconfig.pantry.json`. The checked contracts live in
`types/pantry-workflow.d.ts` and `typechecks/pantry-contracts.ts`. Syntax checks
and runtime tests remain separate from this type verification.

## Release checks recorded on 2 November 2026

- The focused receipt-quantity, deduction, Cook flow, confirmation/guide UI,
  existing At home and onboarding checks passed: 65 tests.
- The Apple subscription, native Apple UI, keyboard layout and native keyboard
  runtime regression subset passed: 50 tests.
- TypeScript `5.9.3` passed the strict model input/output check described above.
- A local Chromium check at widths `320`, `390` and `768` verified the Shared
  Household Additions card precedes the Shop overview, attribution appears,
  pending additions await explicit retry, and explicit Add item sends one
  request and updates the displayed count. Signed-out, Free, unlinked and
  unavailable states kept the form and pending additions gated and made no
  shopping-list read or write. These checks used a synthetic session and mocked
  household endpoint; the card had no horizontal overflow or browser errors.

The dedicated isolated SQL verification command is:

```sh
BB_RECEIPT_PGLITE_PATH=/workspace/work/pantry-sql-check/node_modules/@electric-sql/pglite/dist/index.js \
  node --test --test-isolation=none tests/basketboss-receipt-autostock-sql.test.mjs
```

The SQL verifier uses pinned PGlite `0.5.14`. These checks do not represent a
production deployment, production migration, new iOS compilation, simulator
validation or TestFlight upload. Those release actions remain separate.
