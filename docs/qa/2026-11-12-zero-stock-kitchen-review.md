# Weekly kitchen check: depleted, unused food rows

Status: PASS

The review panel was rendering every retained pantry-editor record, including
Passata and Garlic baguette with no stock, planned requirement or shopping need.

The panel now resolves the existing balances before choosing its visible rows.
An ordinary food row is omitted only when all three balances are exactly zero
and it has no pending shopping request. Unknown amounts, read-only legacy units,
tracked staples, tiny positive balances, stock in another storage area, meal
requirements and manual restocks remain eligible. The item count, search results
and empty state use the same visible rows.

Only `paintRows()` in `bb-kitchen-review.js` changed. Its controller, snapshot,
stale-edit checks, balance projection and edit/restock actions are unchanged.
No stock records are deleted or written by the filter. App HTML, inventory
arithmetic, serving scaling, matching, subtraction, unit conversion and catalogue
prices are unchanged from cb82e642037269545bf3c0b4747d185b2f7cf203.

Validation: one sequential process passed all 51 targeted tests with zero
failures, cancellations or skips. The two new browser cases exercise 390px and
320px: depleted records remain stored but absent from review, Refresh/reopen and
search/filter do not revive them, sufficient toilet-roll stock stays visible,
a 0.000001 g reserve remains exact, and a genuine 100 g Passata restock makes it
visible again. Saved stock/inventory bytes remain identical through the review.
The earlier full-suite result is not represented as a new full-suite run.

Rebuilt standard native, catalogue-700 native and PWA bundles pass local parity:
204 client JS/CSS comparisons, 1,163 native files, 33 generated PWA manifest
entries and 238 precache URLs. Cache version:
5a7e4a241e377f316707b46338fa7b44357b3f50c11c238ac023cf1028def36d.

Native archive numbering/signing and App Store upload are separate from this
presentation fix. Existing Build 43 release pins remain unchanged in this commit.
