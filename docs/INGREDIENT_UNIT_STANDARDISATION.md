# Ingredient names and measurement units — build 7

The basket previously grouped the same ingredient under different unit keys. For example, `Carrot|each` and `Carrots|g` were priced as two shopping requirements. `BBPriceV19.canonicalMeasure` now provides the shared planning projection used before basket and meal-price aggregation, day/source totals, lunchbox shopping, and recipe measurement display.

## Rules

- Existing exact singular/plural identities are shared with Pantry and receipt identity. Food states and varieties remain distinct: fresh/cooked/frozen/canned/dried foods do not acquire a generic equivalence.
- Compatible metric spellings use g and ml (`kg`, grams, litres, etc.). Spoon handling retains the existing named dry-weight assumptions and 5/15 ml volume rules.
- Counts of the exact whole-produce identities listed below project to estimated grams. Fractions are preserved until purchasing, rather than rounding each recipe separately. The combined requirement receives one pack-price calculation.
- Source-proven garlic cloves and bulbs retain their explicit units; an unspecified garlic `each` remains ambiguous. Explicit produce bags, bunches and packs never acquire a single-vegetable weight.
- Recipe source text and amounts remain intact. Recipe views show the estimated mass alongside the original count. Shopping source totals use the same projection, with the estimation disclosed. Saved pantry quantities, receipt/purchase identifiers, and shared-shopping revisions are not migrated.
- Stock reconciliation projects compatible quantities in memory and allocates each stock source once. Cook stock confirmation retains its strict source-unit rules: an estimated shopping conversion is not authority to silently rewrite or deduct historical stock in another dimension.
- Unreviewed mass/volume conversions, arbitrary packages, fish-cut sizes and herb bunch sizes remain separate with the existing unit-review flag. There is no blanket g-to-ml density conversion.

## Disclosed whole-item planning weights

These are illustrative planning assumptions, not measured stock quantities or retailer pack sizes. Exact product labels and weighing take precedence.

| Exact identity | Estimated grams per item |
| --- | ---: |
| Aubergine | 250 |
| Courgette | 200 |
| Pepper / mixed pepper | 160 |
| Onion / red onion | 150 |
| Cucumber | 300 |
| Sweet potato / baking potato | 200 |
| Avocado | 150 |
| Carrot | 80 |
| Potato | 180 |
| Tomato | 120 |
| Spring onion | 15 |
| Shallot | 40 |
| Lettuce head | 300 |

The map is immutable and shared by pricing, shopping-count guidance and pantry projection. Existing legacy whole-produce aliases, plus a small set of audited malformed preparation keys such as `onion finely` and `potatoes peeled and`, are corrected only in the planning projection; historical receipt keys remain unchanged.

Examples: two carrots plus 250 g become one approximately 410 g requirement. The real four-serving lentil bolognese and sausage traybake produce one 510 g carrot row (160 g estimated from two carrots + 350 g), with the two source meals retained.

## Catalogue audit

A fixed, read-only production audit succeeded in [run 41735450186](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/41735450186), at main commit `064274000451aeea3868c745729e8a0fd27d4a2e`.

| Current catalogue | Recipes | Ingredient lines | Mixed-unit identity groups before projection |
| --- | ---: | ---: | ---: |
| Free | 100 | 730 | 12 |
| Premium | 400 | 3,497 | 24 |

The current 500 recipes contain 4,227 ingredient lines; none had invalid numeric quantities in this audit. The historical 321-recipe snapshot was checked separately and overlaps the current catalogue. Naming-difference flags include intentional editorial aliases and are not a count of confirmed errors. The private catalogue was read into runner memory only; retained results contain ingredient/unit/count aggregates, with no recipe IDs, amounts, methods, credentials or customer data.

A confirmed public source/data mismatch was repaired: Tuscan salmon's **60 g sun-dried tomatoes** had been stored under **200 g asparagus**, causing a false second asparagus requirement. The reviewed normalized JSON and both app entrypoints now agree with the original recipe. The actual 250 g asparagus line is retained.

## Validation and delivery

Focused cases cover real recipes, the reported 2-count/250 g pattern, serving fractions, one-pack pricing in all four markets, pantry credit conservation, source-day totals, uncertain packages and prepared-food boundaries. Real Chromium checks at 390 and 768 px show one carrot requirement, the estimated recipe measure, no page errors and no horizontal overflow.

Build 7 includes the earlier build 6 candidate changes plus ingredient standardisation. The native web bundle contains 100 Free recipes and no private Premium recipe bundle. A new Xcode archive/TestFlight upload is required to deliver these client changes. Server API-key corrections remain independent and can work with the existing TestFlight build.

Latest full portable run: 1,543 pass, zero failures, three skipped and two TODO. The viewport fixture captures the current WebKit probe message, and the onboarding assertion uses the installed asset version. The onboarding close regression checks that native keyboard dismissal follows form restoration, handles retained credential focus and does not refocus a credential field. Native portable verification passes; signing and TestFlight upload require Xcode on the Mac.
