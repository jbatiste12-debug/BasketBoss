# Pantry-first planning and remaining-stock credit — 11 November 2026

**Status: PASS — local sequential regressions, protected math isolation and rebuilt asset parity.** Publication and signed-device checks are scoped separately below.

## Remaining stock after cooking

- The failure was a mismatch between two existing receipt-host meanings: `requiresPantryReview()` can remain true for a routine weekly reminder while `getConsumptionStatus().ready` is true for trusted physical stock. The app previously treated every reminder as an empty pantry. Its derived-stock adapter now keeps valid stock available while pending receipts, account changes, unreadable state and genuine conflicts remain blocked. The host's review requirement and receipt/CAS protections remain intact.
- Example: 1,200 g purchased minus Monday's 666.666667 g leaves **533.333333 g**. Tuesday needs 600 g, so its exact shortfall is **66.666667 g**, displayed as **67 g needed** with **533 g at home**. Completed Monday is excluded from outstanding meal requirements.
- Fresh-food top-ups in **Produce or Meat & Fish, measured in g/kg only**, use the exact practical purchase suggestion, **67 g** in the chicken example, rather than carrying forward the old 1 kg guide. Packaged foods retain their existing pack suggestions. The proportional displayed estimate is **£0.68** for the covered chicken fixture; the catalogue quote and price table remain unchanged. Confirming a 67 g purchase adds 67 g, preserving the distinction between exact recipe need and actual purchase.
- Buying choices use the existing receipt generation in their UI context. A consumed purchase's old choice therefore cannot become the next top-up's choice. Earlier UI records and durable purchase receipts are retained.
- An old ownership marker is ignored only for the same actor, a different receipt generation and a provably inactive marker checked against persisted purchase progress. Active, other-actor, missing, throwing or indeterminate activity checks continue rejecting the change. Same-generation correction/rewind and duplicate-credit guards are unchanged.

Relevant adapters: `bbReceiptPantryReviewRequired`, `bbShopPurchaseViewContext`, `bbShopPurchaseRecommended` and `bbShopOwnedChanges` in `app.html`/`index.html`; receipt-host safety remains in `bb-receipt-host.js`.

## One pantry balance to confirm

`reviewPantry` no longer offers separate “Use saved online amounts” and “Use this device’s amounts” buttons. Each food has one editable balance and the existing Confirm / Review later actions. Equal or verified current local balances prefill from At home. Genuine scope/revision conflicts retain the established safe default, show compact differences and require explicit confirmation against the fetched scope/revision; balances are never summed.

Labels and inputs show whole g/ml values and at most one decimal for counts. The exact original value is held separately: confirming an untouched rounded field retains its six-decimal quantity; an actual edit changes that field only. No quantities change merely from opening the review.

The existing checkbox-isolation browser test changes only its obsolete source-button click to fill the existing amount input. Its assertions are unchanged. New host/ownership tests cover exact remainder credit, unsafe-state rejection, untouched precision, conflict defaults, fresh top-ups, duplicate completion and undo.

## Pantry-first Auto-fill

"Prioritize what’s at home" ranks eligible dinners by ingredient availability percentage, then allocated quantity coverage. Existing recent-meal and protein-variety preferences remain available to break otherwise equal pantry scores. Reservations share one physical stock ledger across existing uncooked meals and each proposed addition, preventing repeated use of the same stock. Existing dietary, recipe-access and meal suitability rules still apply. "Fresh weekly plan" opts out of pantry scoring. Ordinary Auto-fill fills currently empty days and leaves existing meals in place until the user confirms a proposal.

**Start next week is implemented and covered by focused transaction and browser checks.** It stages a saved copy of the current week and a fresh dinner proposal without writing storage before confirmation. On confirmation, saved-week, rotation/history, planner, lunches/notes and shopping-trip changes use the existing guarded transaction. The old shopping list is archived while the old in-memory plan is still current; the new planner becomes current only after the write succeeds. At home quantities and cooking/receipt history remain unchanged. Breakfasts, desserts, school lunches and dinner notes start empty, as stated in the confirmation.

Coverage checks the visible Plan controls and pantry-first/fresh choices, cancellation, saving/replacing the current week, exact pantry preservation, stale account/plan/pantry or access changes, storage rollback, a newer external purchase during failure, and rapid duplicate taps. Browser coverage exercises the real planner transition; the transaction tests check failure boundaries independently. The final sequential full-suite run passed with zero failures.

## Final verification

- One clean sequential Node test process completed on 11 November 2026: **4,142 tests discovered; 4,139 passed; zero failures; zero cancellations; one skipped; two TODOs** (793.65 seconds). The skip is the existing Swift-only fixture on this Linux host; the two existing TODOs are not claimed as passing coverage.
- Actual browser regressions passed for post-cooking chicken stock and the 67 g top-up, a consumed purchase's next generation, trusted online stock with a routine review reminder, Plan mode controls and Start next week. No failing DOM selectors remain. Existing assertions are unchanged; one obsolete source-selection action now edits the surviving quantity input.
- All 14 protected calculation functions and eight complete core/catalogue files are byte-identical to baseline `0b8ff949265f2f0f31f3606ec5a288b5c462ad31`. Source `app.html` and `index.html` are byte-identical.
- Latest source/PWA/native asset parity passes: 200 compiled source assets, 1,159 native files, 1,158 native manifest entries, 33 PWA manifest entries and 234 offline precache URLs. Both new pantry controls assets are in the explicit service-worker fallback core and the allowlist.
- Version remains **1.0.2 (43)**. The Mac launcher is pinned separately to the tested application-source commit. Publication/deployment status is recorded in the release packet after pushing; local parity does not certify live bytes.

This certificate covers source, local browser/unit checks and unsigned web assets. It does not claim a fresh physical iPhone test, real StoreKit transaction, signed Xcode archive, TestFlight upload or App Store approval.
