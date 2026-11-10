# BasketBoss inventory loop and ingredient parser audit

10 November 2026. This pass changes data parsing and arithmetic only. It preserves existing storage keys, billing gates, state objects and purchase/Cook handlers. The original PWA UI fixes were already deployed and publicly verified at commit 5c98e9564e5e0645f00b4dd98843f1112bba2916. The new logic fixes require the subsequent release; installed iOS build 36 needs a new build 37 binary.

## Six-stage regression assessment

| Stage | Before this patch | Patched result and exact call path |
| --- | --- | --- |
| 1. Meal plan aggregation | ❌ Invalid `null`, blank and boolean quantities could become known zero; duplicate saved occurrences could add servings twice. | ✅ `bb307Selections` counts each day/recipe/kind once and retains repeated recipes on different days. `bbHomeCanonicalRecipeNeeds` → `BBRecipeCanonical.project` → `aggregate` preserves unknown inputs as review records and merges compatible quantities. |
| 2. Unit conversion | ⚠️ Reliable for explicit compatible measures; containers, ingredient densities and approximate whole-produce sizes require their disclosed conversion facts. | ✅ Known units convert; unsupported dimensions remain pending review, without NaN or invented zero coverage. g/kg and ml/l use ×1,000. Spoons use culinary volumes and ingredient-specific density only where known. Reviewed pack contents override estimates. Unchecked packs do not become an arbitrary weight. |
| 3. Needed / Got / To Buy | ❌ The final `mergeLunchShopping` rounded arithmetic to two decimals; a 0.004g requirement could disappear. | ✅ Six-decimal quantity precision throughout the merged shopping calculation. Aggregate requirements first, then credit each physical source once; `toBuy = max(0, required - pantryUsed)`. Planning never writes a reduced physical balance. |
| 4. Purchase / receipt restock | ✅ Compatible confirmed purchases add to physical stock; existing location and metadata remain intact. Sparse-restored-account failures were fixed in the preceding pantry repair. | ✅ `bbPartialSet` records actual bought amount; `bb83TransferBought({defer:true})` prepares the additive deposit; `bbShopV7Close` commits it with the receipt/archive/session rotation. Matching receipt credits and repeat Finish calls prevent a second deposit. |
| 5. Cook deduction | ✅ Actual scaled ingredients deduct once, floor at zero, and remain pinned to actor and meal occurrence. | ✅ `BBHome.cooked` → `cookSnapshot` → `BBPantryDeduction.proposal` → `commitConsumption` writes balances and completion identity together. A simultaneous second completion returns `already:true`. Completed occurrences stop contributing to future shopping. |
| 6. Persistence / races | ⚠️ Confirmed local operations are saved synchronously; cloud backup is optional and asynchronous. | ✅ The browser dry-run survives re-render and refresh, including checked purchase amount, Cook receipt and serving change. Storage exceptions and stale snapshots are rejected or rolled back by existing contracts. **No claim of immediate database synchronization:** `queueCloudSave` debounces 1,400ms, and offline/server failures retain the local result with pending/review messaging. Unconfirmed editor text remains draft input. |

`localStorage` is not a transactional database across independent browser tabs or a process crash in the middle of multiple writes. The current compare-before-write and rollback protection handles the tested stale-read and storage-error cases; this audit does not claim stronger cross-process ACID guarantees.

## Exact Rice dry-run using the actual generated app functions

Network responses and account identity were synthetic; planner, parser, reconciliation, purchase, Finish, Cook and local persistence functions were the real catalogue-700 application. Test-only fixture recipes supplied the requested 300g and 400g Rice requirements. No live account or database data was written.

| Action | `required` | `pantryUsed` | `toBuy` | Physical `stock['rice|g']` |
| --- | ---: | ---: | ---: | ---: |
| Add Meal A 300g + Meal B 400g | 700 | 450 | 250 | 450 |
| Record buying 500g | 700 | 450 | 250 | 450 |
| Re-render and refresh before Finish | 700 | 450 | 250 | 450 |
| Finish & update At home | 700 | 700 | 0 | 950 |
| Cook Meal A | 400 | 400 | 0 | 650 |
| Simultaneous second completion | 400 | 400 | 0 | 650 |
| Scale remaining Meal B from 4 to 6 portions | 600 | 600 | 0 | 650 |
| Refresh | 600 | 600 | 0 | 650 |
| Remove Meal B | no remaining Rice requirement | — | no Rice purchase | 650 |

The purchase record contains `qty:250` (the demand snapshot) and **`actualQty:500`** (what was bought). The tick persists on re-render and refresh. Tick alone does not deposit food; explicit Finish/receipt confirmation does. Finish adds all 500g to the existing 450g, not merely the 250g shortage. One compatible Rice inventory row remains.

For the surplus edge case, 1,000g owned against 300g planned gives `toBuy:0`. Physical stock remains 1,000g until cooking; 700g is the *projected* remainder. Deducting during both planning and cooking would be incorrect. With 450g owned and 600g planned, the exact shortage is 150g; an optional pack guide may round the purchase separately.

## Parser failures found and corrected

The built-in catalogue already carries structured normalized ingredient records. The free-text failures below affected `bb172ParseOwnIngredient` and personal-recipe ingestion/loading; they do not mean every catalogue recipe was parsed from text at runtime.

| Input or failure | Previous behavior | Patched structure / behavior |
| --- | --- | --- |
| `1 large onion, diced` | Name included size/prep; comma ingestion could create another ingredient called diced. | `name:onion`, `quantity:1`, `unit:each`, `size:large`, `prep_note:diced`; original source retained. |
| `salt and pepper to taste` | Invented `quantity:1`, `unit:each`. | `quantity:null`, `unit:to taste`, explicit review. No fabricated measured amount. |
| `2-3 cloves garlic` | Fell back to one each with the whole line as the name. | `name:garlic`, `unit:clove`, range 2–3, shopping upper amount 3, estimated/review warning retained through projection and aggregation. Confirm actual use in Cook. |
| `400g tin chopped tomatoes` | Entire text became a name with quantity one each. | 400g, tinned tomato identity, explicit 400g contents; no second multiplication by a tin default. |
| `2 x 400g tins chopped tomatoes` | Misread as two each. | 800g, two explicit 400g containers. |
| `1.5 kg chicken breast` | Misread as 1.5 each of “kg chicken breast”. | 1,500g with clean food name and metric display text. |
| `1/3 cup rice`, mixed or Unicode fractions | Fell back to one each. | Numeric fraction for arithmetic; readable fraction source retained. Convert and quantize only in the base measure. |
| Unknown, negative, infinite, zero-denominator or oversized amounts | Could default to one, create bad names, or lose review state. | Unknown/reviewable structured record or explicit input rejection; original valid-sized source string preserved. No NaN quantities or silent one-unit default. |
| Parenthetical dietary identity | Blind comma splitting could cut a food descriptor. | Bracket-aware splitting and prep extraction preserve e.g. oat/unsweetened milk as distinct from dairy milk. |
| Olive oil grade | Extra Virgin Olive Oil could remain a separate group. | One exact approved alias to olive oil; vegetable/cooking oil, milk variants and fresh/canned food distinctions remain separate. |

The parser keeps existing output fields `name`, `source`, `key`, `quantity`, `unit`, `status`, `recipe_id` and `ingredient_index`; new range, contents and review metadata are additive. Saved personal-recipe lines are reparsed without a migration or storage reset. The loader uses clean quantity text for scaling while keeping original source text in normalized records. Unsafe map keys and nontext/oversized input are rejected, not executed or silently truncated into another ingredient.

Counts retain exact recipe arithmetic: 3 eggs for 4 servings scales to **0.75 egg** for one serving and **5.25 eggs** for seven. Whole-unit checkout rounds separately to 1 or 6 eggs. Rounding recipe use to whole eggs before aggregation would overstate need and deduction. The existing Cook review can confirm the actual amount used. Container/status-tracked cupboard staples remain a separate inventory mode; precise ml/g accounting requires measured tracking or reviewed contents, never an assumed bottle capacity.

## Validation

- Frozen full suite: **3,491 passed, 0 failed, 1 Swift-only skip, 2 pre-existing Paddle TODOs** (3,494 total). The skipped Swift fixtures require the macOS runner.
- Dedicated parser and inventory math tests include the supplied examples, legacy suffix quantities, ranges, mixed/Unicode fractions, unit conversion, six-decimal totals, duplicate occurrences, aliases, protected dietary descriptors, classification and 600 generated malformed text cases.
- Saved-personal-recipe browser load also passes with five parsed ingredient lines: chicken requires 1,500g; 1/3 cup Rice becomes an explicitly approximate 61.666667g. Source notes survive and there are no page errors.
- Real catalogue-700 browser dry-run: exact Rice results above; tick and actual bought amount persist through re-render and refresh; double Cook deducts once; scaling and removing a meal recalculate without changing physical stock.
- Negative control with the old canonical module fails the unknown-quantity review assertion; the patched module passes it.
- Existing receipt, cloud conflict/offline, partial-purchase, rollback and Cook regressions remain in the full suite. No live AI, paid purchase or production database mutation was used.
- Portable native and explicit catalogue-700 packages build: 200 public recipes, 500 authenticated Premium recipes, 1,149 files, no private recipe bundle.
- Public deployment verification now includes the exact canonical/parser-policy runtime bytes (18 root assets). The iOS catalogue-700 workflow now triggers for the changed app and core ingredient files.

The two existing Paddle TODOs are refund/chargeback entitlement policy and full lifecycle integration acceptance. A separate protected private Cook-content read audit is blocked by its configured read permission; this work does not weaken that boundary or claim a successful live private-content audit.
