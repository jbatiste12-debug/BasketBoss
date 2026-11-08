# Recipe baseline cleanup — 8 November 2026

Baseline: `e28e2202c78102db14dc0ff885889251f947ba5a`. This change resolves the eleven approved recipe findings. It does not implement or activate the proposed 700-recipe catalogue.

## Changes

- Pricing: `tomato-mozzarella-pasta`, `prawn-linguine` and `baked-feta-orzo` can quote their explicit whole garlic bulb from the existing one-bulb/approximately-ten-clove pack guide. Bulbs remain distinct from cloves and unspecified items. Indicative-price provenance remains unchanged; no receipt, regional clove pack or unrelated bulb price is borrowed.
- Pantry: the explicit suffix form “Chopped tomatoes canned” now uses the established tinned-tomato identity. This resolves `moroccan-sardine-kefta-tomato`, `greek-green-bean-potato-ladera`, `beef-stifado-pearl-onions`, `fennel-rice-stuffed-squid`, `west-african-peanut-and-black-eyed-bean-stew`, `mild-chicken-corn-tamales` and `king-prawn-chupe`. Fresh/frozen/cooked/dried tomatoes, paste, purée and passata remain distinct.
- Display metadata: `tuscan-salmon.ingredient_display_lines[2]` now agrees with its existing source ingredient: 60 g chopped and drained sun-dried tomatoes. Its ingredient quantities and method are unchanged.
- Only the changed runtime asset queries and app-shell cache version advance. Existing image-cache and private/API cache protections remain unchanged.

## Validation on the corrected source

| Check | Result |
|---|---|
| Complete Node suite, including pinned PostgreSQL fixtures | 2,923 tests: 2,920 passed, zero failures, one existing skip, two existing TODOs |
| New regression tests | 76 passed: 40 pricing, 35 pantry, one display/embedded-copy check |
| Actual pricing adapters, before/after, 500 recipes × four markets × three portion scales × two adapters | 12,000 comparisons: 72 expected resolved target cases; all 11,928 other results identical |
| Direct normalized pricing, 500 recipes × four markets | All 2,000 results unchanged |
| Ingredient identity, before/after | 8,464 comparisons across 4,232 lines; only the seven approved canned-tomato cases changed |
| Food-form boundary checks | 252 passed |
| Catalogue preservation | 18 passed; 500 unique IDs, existing order, quantities, positional ingredient arrays, methods, portions, costs and images preserved except the single approved display field |
| Cache scope review | 10 passed |
| Strict pantry TypeScript checks | Passed, TypeScript 5.9.3, strict/checkJs/noEmit |
| Native web bundle and portable iOS verification | Passed; 936 files, 100 public Free recipes, no private recipe bundle |
| Regional pantry audit | UK/US: zero duplicate keys, non-canonical rows or conversion failures |
| Chromium browser journeys | Eight passed: Plan/Shop/At Home/Cook and saved weeks at 320/390/768 px, plus source-aware pricing and tinned-tomato preview checks; zero page/console errors |

The browser fixture intercepts all HTTP, uses a synthetic Premium account, and performs no real account, household, billing or AI writes. Chromium tests do not establish native iOS keyboard behavior.

The private 400 recipe/normalized-row snapshot retains SHA-256 `f89eaecc9b2ca71fbd8018c7f733e51c630f6992e5ad5def902f609a71fcbc2e`, matching the independently inspected live baseline. Normalized ingredient data, the ingredient-pack catalogue and desserts are unchanged.

## Explicit limits and separate baseline checks

The eleven targeted findings have no remaining failures. This is not a claim that every production or native check is green:

- The local suite's existing skip requires Swift/macOS; its two existing TODOs concern Paddle refund/chargeback and lifecycle integration acceptance. They have not been deleted or promoted to passing checks.
- Fresh remote checks on the original baseline passed simulator compilation, an unsigned archive, actual-WebView Cook, local StoreKit purchase/restore tests and the StoreKit workflow's four keyboard tests. A separate focused keyboard run passed three cases but failed its initial email case because no software keyboard appeared within ten seconds. Its cause remains unresolved; a passing alternative run does not erase that failure. No keyboard code or test was changed here.
- Fresh Cloudflare project inspection failed with HTTP 401/code 10000 at management metadata listing. A separate least-privilege D1 read passed for all 500 records. The public Apple configuration returned HTTP 200 with matching product IDs. The management failure is not proof of an application outage, but still blocks a completely green deployment inspection.
- Existing indicative/unverified price provenance and unrelated source-amount review markers remain honest. They are not suppressed to manufacture zero flags.

No production deployment, catalogue import, native release, new recipe data, breakfast UI, Day Done reversal or 700-catalogue implementation is included. The expansion plan and proposed titles require separate approval.
