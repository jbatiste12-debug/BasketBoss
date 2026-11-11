# Final pre-submission release gate — 11 November 2026

This audit uses one local browser runner at a time and a fresh sequential full-suite run. It adds a continuous browser journey instead of treating isolated unit checks as an end-to-end purchase proof. All browser network requests are local fixtures; no audit purchase charges a real account or changes production stock.

## 1. Visible text and exact state

The continuous journey scans rendered text nodes across 47 UK/US views, expanded disclosures, shopping drawers, pantry and essentials editors, Cook prep/method screens, Day done and purchase/completion toasts. Quantity text permits at most one decimal; gram/ml readouts are whole units, with explicit less-than labels for tiny positive amounts. Invalid numeric strings, null/undefined and Check estimate are rejected. Exact monetary values are excluded from quantity rounding, including Apple's localized prices. Editable inputs retain source precision.

The stricter sweep found additional two-decimal US measures, pantry modal helpers, legacy shopping details, receipt provenance and raw household previews. These now use view adapters. Legacy conversion APIs and the frozen BBHome core remain unchanged; source recipe and stock snapshots are asserted separately from labels. Only the two tsp display expectations changed from 1.33/0.67 to 1.3/0.7; exact stored-quantity assertions remain.

## 2. One-session purchase/cook journey

The browser delays classifier hydration, attempts an essential checkbox and verifies zero tick/stock/ownership writes. After hydration it chooses six buns for four required, confirms purchase and Finish, then uses the real Day done confirmation to deduct four, leaving two. The same session selects twelve Toilet Rolls with two already owned, edits the total guide price, confirms purchase and Finish, and verifies fourteen in Weekly essentials with no household food-stock or Bakery entry. Unrelated six-decimal stock and recipe projections remain unchanged.

## 3. Touch and propagation

Real Buying, price and details controls are exercised in To buy and All items, including the Weekly essentials rows, at 375/390 px. Each independent tap preserves tick and purchase state. The audit found an inherited CSS rule shrinking the price button to 33 px; the scoped price-button minimum is now 44 px in both dimensions. Existing full-suite coverage also checks narrower 320 px layouts and Finish/reload idempotence.

## 4. Premium and payment hooks

A native legacy Premium information dialog had no visible purchase route because its web links are hidden in iOS. The shared entry now routes camera/locked-recipe/Discover prompts to the existing bundled Apple membership screen. The actual camera CTA and central entry are exercised in the browser with navigation capture; this does not begin billing.

The native bridge and purchase/restore/cancel/pending/account-pin/acknowledgement flows passed actual local StoreKit tests in run 43058453189 for the preceding compiled release. Native keyboard and Cook WebView checks also passed. The native payment/controller sources are unchanged by the routing fix. Production Apple authorization, real paid transactions, backend entitlement grants and a signed upload are not claimed by that local StoreKit evidence. Normal native membership entry always navigates; guarded startup/deletion refusals are preserved.

## 5. Offline and compiled parity

The rebuild audit compares all 198 compiled JS/MJS/CSS assets through the exact native/700 transforms, all 1,156 manifest entries in the 1,157-file native packet, all 33 PWA manifest entries and 232 precache URLs. It recomputes the cache version and checks dependency files and available content-version queries. Stable release-label imports are verified by compiled bytes and manifest hashes rather than being incorrectly treated as content hashes.

An explicit classifier retry previously could miss the unversioned offline module. It now falls back only to that module in the current release cache; unrelated queries, old caches, authenticated requests and API responses remain excluded. Portable worker fixtures exercise that behavior.

## 6. Full suite and handoff

The final full-suite log and release verification record contain the actual final counts and live deployment proof. The run uses node --test --test-concurrency=1 with no overlapping local browser test command. The PWA is published only after a clean result, then its public route, layouts, payment boundaries and release assets are verified against the merged source. The Mac launcher remains pinned to an immutable application commit; signing and submission occur on the user's Mac.
