# Inventory edge-case regression audit — 11 November 2026

Scope: the current 700-recipe PWA/native client, pantry entry and comparison,
weekly meal and school-lunch requirements, shopping purchases and receipts,
confirmed cooking/undo, and local/cloud persistence. Existing test assertions,
storage keys, `canonicalName`, `getCanonicalMatchKey`, inventory reconciliation
formulae and receipt/database contracts are preserved.

## 🔴 Confirmed faults fixed

| Fault | Before | Corrected behaviour | Source |
| --- | --- | --- | --- |
| Generic food name and recipe cut did not match | `Smoked haddock` and `Smoked haddock fillets` were separate comparison identities, even in grams. | A comparison-only fallback recognises the same declared food with a terminal fillet/portion description. Species, named varieties, dietary restrictions, physical states and coatings remain protected. Saved names and comparison-key outputs do not change. | `bb-pantry-policy.js`, `stockCompatible` / `cutCompatible` |
| New pantry entry missed its planned unit | The unit suggestion looked for an exact storage name. Haddock fell back to `each`, with a misleading zero planned total. | New/unmeasured selections use the existing protected compatibility check when finding planned units. The sole compatible recipe unit supplies the default; saved quantities and units are preserved. | `shopping-inventory.js`, `bb5PlannedRequirements` |
| Partial kilogram/litre purchases lost physical quantity | `0.333333 kg` was rounded to `0.333 kg`, depositing 333 g. | The input retains the existing server purchase precision in canonical g/ml: `0.333333 kg` deposits 333.333 g. Unsupported extra precision is rejected before writes; an intentional zero can undo a purchase. | `app.html` / `index.html`, `bbPartialRound`, `bbPartialSet` |
| Supported household counts could not be corrected | Partial `bag`, `tin`, `bunch` and `loaf` amounts were rejected by a narrower shopping whitelist. | Those existing household units accept whole purchase counts. Fractional purchase counts still fail before mutation. | `app.html` / `index.html`, `bbPartialSet` and existing amount controls |
| Offline cooking could leave another device with old stock | With a verified pantry but no pending purchase, local 100 → 70 g cooking had no durable cloud retry intent. | Confirmed cooking/undo reuse the existing absolute-stock queue and verified server revision. Reopening/reconnecting sends 70 g once, while preserving conflict and account guards. | `bb-receipt-host.js`, `confirmCookedPantry` |
| Reconnect could keep a valid queue dormant | A reconnect within the 30-second unavailable-status cache still returned local-only. | An explicit queued retry refreshes an unavailable status. Concurrent retries coalesce and do not duplicate stock changes. | `bb-receipt-host.js`, `retryPurchasedPantry` |

## 🟡 Assumptions and deliberate review boundaries

- **Potatoes: 800 g required versus 2,000 g at home.** The displayed default
  purchase is one illustrative 2 kg bag. Ticking that purchase records the whole
  bag; it does not change the recipe to 2 kg. The user confirmed this explained
  the potato example. This purchase contract is retained.
- A different amount can be saved in an active shop through **Bought → item
  `•••` → Enter different amount → Total bought → Save amount**. An actual
  800 g correction updates purchase, stock and ownership records together.
  A finished/archived trip may no longer expose that row in the active Bought
  view; current stock can still be corrected in At home.
- **Existing `200 each` is not silently changed to `200 g`.** The fixed app
  identifies the unit mismatch. The verified explicit repair is **At home →
  Fridge → Edit Smoked haddock → clear At home amount → Unit `g` → enter
  `200` → Add to Shop**. This replaces the incorrect count record with 200 g.
- A generic fish may be planned by mass or by count. Cod and salmon have
  multiple declared catalogue units, so no universal fish weight or guessed
  grams-per-fillet conversion is introduced. Mixed dimensions require review.
- Purchase lines retain the deployed receipt/RPC contract: three canonical
  decimal places in g/ml and whole purchase counts. Kilogram/litre inputs can
  therefore need six decimal places. Derived pantry balances and cloud pantry
  snapshots retain their finer existing precision. Core receipt rules and SQL
  were not changed. Historical credits outside the purchase contract remain a
  review concern rather than permission to reinterpret stored quantities.
- An explicit zero staple source can retain an existing cupboard-status
  reminder. Missing/unknown stock does not automatically buy a jar (`toBuy: 0`).
  This existing container/status design is preserved.
- Genuine edits from another device still require review. The retry fix does
  not overwrite a changed household, account or server revision.

## 🟢 Verified behaviours retained

| Loop stage | Grade after fixes | Verification |
| --- | --- | --- |
| Plan → aggregated ingredients | ✅ SOLID | Repeated meals, separate days, per-day servings, duplicate lines and compatible g/kg quantities aggregate before pantry subtraction. |
| Pantry comparison and units | ✅ SOLID for declared compatible units | Specific stock is reserved before generic pools; each physical quantity is allocated once. Dietary, state and species conflicts remain separate. Unknown/ambiguous units require review. |
| Shopping reconciliation | ✅ SOLID | Partial/surplus stock, one-day autofill, swaps and meal removal recalculate the current basket without spending stock or erasing purchases. |
| Purchases/receipt → pantry | ✅ SOLID within the declared purchase contract | Full packs, actual-amount corrections, partial purchases, supported counts, receipt replay and Finish avoid duplicate deposits. |
| Cook/Day done/school lunches | ✅ SOLID | Preview and cancellation do not mutate stock. Confirmation deducts only scaled usage, floors at zero and shares occurrence identities to prevent double deduction. Lunch-week and Day done overlaps are idempotent. |
| Persistence/reconnect/undo | ✅ SOLID for tested local and PostgreSQL contracts | Rollback, lost responses, duplicate retries, account switching, shared-scope changes, offline completion, undo and tiny remaining balances are covered. |

## Concrete results using actual functions and browser flows

```text
Mornay, four servings:
  Smoked haddock fillets required       600 g
  Smoked haddock recorded at home       200 g
  Shopping shortfall                   400 g

Other real planned ingredients:
  Milk                                 600 ml - 200 ml = 400 ml to buy
  Cod fillets                          350 g - 200 g = 150 g to buy
  Salmon fillets                       4 each - 1 each = 3 each to buy
  Eggs                                 6 each - 2 each = 4 each to buy

Potato bag scenario:
  Recipe required                      800 g
  Displayed bag marked bought           2,000 g at home
  Confirmed cooking uses               800 g
  Remaining                            1,200 g
  Correct actual purchase to 800 g      800 g at home
  Confirm that meal                     0 g; exhausted row disappears

Rice conservation and replay:
  Start                                450 g
  Meal A + Meal B                       300 g + 400 g
  Needed / Got / To Buy                 700 / 450 / 250 g
  Reviewed purchase +500 g              950 g
  Replay same receipt                  950 g
  Confirm Meal A, use 300 g             650 g
  Repeat that confirmation             650 g
  Meal B still requires 400 g           0 g to buy

Offline cooking:
  Verified local and cloud              100 g
  Confirm cooking offline               local 70 g; durable target 70 g
  Reconnect/reopen                      local 70 g; cloud 70 g
  Repeat retry                         unchanged; one replacement
  Concurrent remote edit               review; neither balance overwritten
```

## Repeatable verification

New regression files:

- `tests/basketboss-pantry-cut-matching.test.mjs`: 9 tests; matching,
  protected conflicts, unchanged names/keys, generic pool conservation.
- `tests/basketboss-pantry-planned-unit-browser.test.mjs`: 14 actual generated
  700-client browser tests at 320 px and 390 px; new units, haddock repair,
  milk, counted fish, eggs, Shop and budget updates.
- `tests/basketboss-partial-purchase-precision.test.mjs`: 22 actual-handler
  tests; units, correction/undo, serialization, invalid input, supported
  household counts and preservation of existing tiny pantry balances.
- `tests/basketboss-offline-cook-sync.test.mjs`: 16 tests; local/cloud retry,
  actual production reconnect listener, PostgreSQL RPC, account/scope/revision
  guards, empty stock, tiny balances and lost-response recovery.
- `tests/basketboss-inventory-edge-conservation.test.mjs`: 5 tests, including
  129 deduction variants, shared-pool ordering, portions and the real rice loop.

The original controllers fail the new regression cases for the faults they
exercise. Existing assertions are unchanged. PostgreSQL checks run against
the actual migration/RPC definitions in an isolated database; this audit does
not query production users or alter database schemas.
