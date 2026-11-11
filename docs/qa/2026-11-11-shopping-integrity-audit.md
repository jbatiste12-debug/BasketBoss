# Shopping presentation isolation audit — 11 November 2026

The emergency audit covers the green Buying controls, purchase checkboxes, household routing, readable quantities and missing shopping estimates. It preserves the existing calculation and reconciliation contracts.

## Findings and changes

- A legacy aisle classifier interpreted plural Toilet rolls as Bakery. The semantic household classification now takes precedence in the existing routing wrapper; household purchases update Weekly essentials rather than measured food stock. Stored names, IDs and canonical keys are preserved.
- Existing household food balances require an explicit reviewed move. The view shows both saved balances and defaults to keeping the actual food balance as the total; combining balances is a separate explicit choice. The move uses the existing guarded journal and pantry queue, removes only linked household food keys/rows, preserves the essentials target/ID and leaves receipt history intact. Nothing moves merely from rendering.
- Visible g/ml labels round to whole numbers; count labels use at most one decimal. Positive tiny quantities remain visible as less than one unit. Inputs, confirmation fingerprints and stored quantities retain their exact values. Day done exposes exact model values only in data attributes used for isolation checks.
- Unknown household/custom quotes remain unknown in the catalogue and calculation model. A separate £2.50 display guide fills the shopping presentation. A selected pack scales that guide, and an optional manual total overrides it once. Tapping the row price opens the existing total-cost field.
- Whole loose citrus can use an integer-count Buying suggestion backed by the existing pantry policy weights. The canonical stock stays in grams. An actor-scoped optional UI proof records an explicit count selection; only proved balances display as each. Old/unproved measured stock remains measured and asks for a count check. No old 1,000 g balance is assumed to mean one item.

## Isolation verification

The 14 protected functions and eight complete core/catalogue files are byte-identical to the frozen baseline `0b8ff949265f2f0f31f3606ec5a288b5c462ad31`. No recipe scaling, canonical ingredient matcher, core pricing table, pantry subtraction or conversion function changed. The At home conversion/step helpers retain their original exported contracts; presentation adapters call them.

The user authorized exactly two pre-existing tiny-quantity display assertions to change from `0.000001 g` to `<1 g`; their exact saved-quantity assertions remain unchanged. The user also authorized updating the existing unpriced-budget display test for the £2.50 guide. That test still asserts null catalogue price, exact known-price subtotal, pending counts and unchanged spending history; only display expectations change. Other pre-existing calculation assertions are unchanged. New display helper tests follow the requested maximum-one-decimal count formatting.

## Automated coverage

- Actual Chromium at 320/390 px: scaled Shop rows, opened row details, At home All, expanded Plan and Day done contain no visible numeric strings with more than two decimal places, NaN, undefined or Infinity. Exact recipe and measured-stock snapshots are unchanged after these renders.
- Actual Buying pill/preset/checkbox interactions for food and spaced/compact household names; choosing a pack alone does not tick or credit stock, and the subsequent checkbox persists the selected canonical-base quantity.
- Household targets/owned quantities, online acknowledgement, Finish, reload and confirmed essentials editing preserve one credit and never create food stock.
- Unknown essential/custom estimates, pack scaling, manual total price, matching Plan/header estimates and zero remaining after purchase.
- Reviewed household migration guards: stale identity/trip/storage, duplicate or incompatible essentials, write/queue failures and cancellation leave data intact.
- Whole-produce metadata validation, cross-account isolation, stale measured stock, count purchase/readout/step behavior and exact gram storage.

The final full-suite result, native packet proof and live PWA byte checks are included with the build verification artifact. Browser requests use local fixtures; automated tests never write production user data.
