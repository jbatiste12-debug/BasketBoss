# Pantry quantities, scanner grouping and navigation

At home now calculates meal demand automatically, saves extra stock without requiring a meal, distinguishes container counts from measured contents, and keeps category navigation anchored beneath the toolbar.

## Resulting behaviour

- A food not used by the plan explicitly says so. Reducing servings or removing meals recalculates the amount; an automatic review does not create a permanent copy of the old meal requirement.
- With no planned pasta meals, 250 g owned and a 500 g buffer creates one 250 g Shop request. Finishing the shop updates the existing pantry entry to 500 g. A new plan and reload retain that stock; actual cooking deducts its confirmed ingredients once.
- A half-used bottle is valid stock. A one-bottle buffer with 0.5 bottles owned requests one whole bottle. Finishing adds one bottle, leaving 1.5; repeating Finish does not add it again.
- One 20 g peppercorn jar is one jar with 20 g recorded as its contents. A reviewed measured entry can instead hold 20 g. Changing tracking mode requires a new quantity; old container counts are never silently treated as grams.
- Explicit restock targets and direct Shop requests remain intact. Incompatible measurements and ambiguous Pepper identities stay visible for review rather than receiving guessed conversions or stock credit.
- Approved compatible product aliases from an At home photo review share a food heading and retain individual brand/product details. Confirmed compatible amounts are grouped before the stocktake replaces that location's amount. Unknown amounts, packing liquids and net/drained weight differences require review. Existing measured branded stock is not automatically migrated. Drained tuna has a distinct physical identity from net pack weight; related meal quantities show Needs review instead of an incorrect zero-demand message.
- Moving between a long Cupboard list and short Fridge list reveals the chosen section beneath the toolbar. Unchanged item controls remain mounted; tapping an already active Food/Essentials tab does not reset the scroll position or flush again.

## Validation

- Full Node suite: 2,847 cases, 2,844 passed, zero failures, one unavailable Swift check skipped, two existing TODOs.
- Pinned TypeScript 5.9.3: strict/checkJs/noEmit pantry contracts passed.
- Generated native web bundle: 936 files, 100 Free recipes, no private recipe bundle. Portable iOS verification passed; Xcode signing and device compilation still require the Mac.
- Isolated touch Chromium at 375 px and 320 px: full plan/stock/shop/cook and scanner journeys passed, with no page or console errors and matching source hashes.
- Navigation probe at both widths: 44 of 44 unaffected item controls retained; selected Fridge items remained visible; modal dismissal restored the previous 850 px scroll position; active-tab re-clicks did not scroll or flush.

All browser HTTP traffic was intercepted and used synthetic accounts. No customer pantry, account, purchase or paid AI request was changed. Carry-over used a new plan generation and full reload, rather than a wall-clock shift. Layout-shift traces describe the isolated test and are not production Core Web Vitals.

One earlier 375 px attempt recorded an unexplained same-URL reload after reopening a jar editor. The focused repro and full traced rerun passed; the traced rerun contained only the six expected test navigations. This attempt remains in the QA history; no speculative navigation or account-security change was made.

## Native CI reporter

A Debug-only Cook test reporter could overwrite its completed atomic result with a later load/readystate/script progress message. Completion is now terminal in both the JavaScript reporter and its per-launch native writer, including a failed final result. Deterministic regressions reproduce the old race when the guard is removed. Production navigation, assertions, timers and timeouts are unchanged; the hook is excluded from Release.

## iPhone update

The live App Store binary needs a new signed build to receive these bundled UI changes. `release-assets/prepare-build32-mac.command` creates a fresh Mac checkout from the pinned `appstore-1.0.1-build32-pantry-final` handoff tag, prepares version 1.0.1 / Build 32 and opens Xcode. It preserves the bundle identifier and signing team. Archive/upload and App Store submission remain separate manual steps; the helper does not publish the app.
