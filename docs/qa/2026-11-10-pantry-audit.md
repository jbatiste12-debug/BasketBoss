# BasketBoss pantry, shopping and premium UI audit — 10 November 2026

This change fixes the reported pantry failures and preserves the existing state keys, purchase handlers, recipe eligibility checks and atomic storage operations. The existing Apple submission is untouched. Version 1.0.2 build 37 is prepared for a future native upload; installed build 36 cannot receive bundled JavaScript or CSS through a PWA refresh.

## 🔴 CRITICAL — confirmed bugs and broken interactions

| Finding | Trigger and effect | Correction |
| --- | --- | --- |
| Sparse restored Home records crash pantry confirmation | A valid actor restored with cooked or receipt history but without `targets` reaches `data.targets[id]`. Add/edit and purchased checkboxes fail, so Finish Shop has no recorded purchases to transfer. | Initialize absent/null `targets`, `cooked` and `planned` maps in the parsed proposal. Keep history, other actors, stock and compare-before-write protection. |
| Unsupported or unreadable Home history could be treated as a fresh record | Parsing failure or a non-v1 object previously fell back to empty metadata, allowing a later confirmation to replace history. | Reject mutations with a readable review message. Read-only screens safely display available valid data. Original bytes remain untouched. |
| Long-press release can cancel selection or select all | The selection toolbar appears under the held finger. A compatibility click can land on the new Cancel or Select all button instead of the original row. | Consume the release click belonging to that hold, including retargeted clicks. A new pointer press remains an intentional action; keyboard activation is preserved. |
| Native Release verification could pass without inspecting linkage | An `otool … | rg StoreKitTest` condition can evaluate false when an inspection tool is absent, falsely passing verification. | A shared Node verifier checks the executable with `otool`, rejects packaged test configuration and linked StoreKitTest, and fails if inspection fails. No evidence was found that the shipped binary contains StoreKitTest. |

## 🟡 WARNING — async races and UX friction

| Finding | Correction and evidence |
| --- | --- |
| Image decoding could outlive receipt cancellation or the scan deadline | Image preparation now races the captured signal and releases its listener. Canceled or late preparation cannot send a scan request or write pantry data. |
| An older receipt deadline could abort the replacement scan | Each deadline closes over its own controller. Regression tests exercise replacing the photo and firing the earlier callback. |
| Membership responses could arrive out of order | Refresh revisions and session pins prevent an older Free response, HTTP error, JSON failure or network rejection from replacing a newer verified status. Portal navigation also checks its original session and revision. |
| A covered stock buffer looked ineffective | The editor explains that stock already at home counts first, and explicitly says when it covers both meals and buffer. The buffer is a target reserve, not an unconditional extra purchase. |
| Long gallery titles could defeat uniform card sizing | The Discover-specific cascade now enforces three title lines, while keeping complete recipe names in existing accessible labels and full titles in the featured view. |
| Two different meanings of “selected” were shown in the pantry | Storage headers now show an item-count pill. Actual deletion selection retains its own selected count. |

## 🟢 2026 UI POLISH — applied

- One white, 22px storage card with `0 8px 24px rgba(16,42,29,0.06)` elevation; redundant inner “Food at home” headings and counters are hidden when the accordion provides them.
- Sage `#F8FBF9` rows with 16px corners. The right-side stepper is one visual 80×38 pill with a 1px divider; each real button keeps a 44×44 touch target.
- Tapping the row opens the existing editor. A compact `Edit ›` button preserves keyboard access. Action underlines are removed. Editing remains suppressed during selection.
- Existing reduced-food “Move to Freezer” stays available under the item details instead of expanding the right-side stepper.
- Full-width, 46px Add buttons use `#1B4D33`, white text and 14px corners. Quantities and prices use tabular numerals.
- Photo badges use a high-opacity forest fallback, white text and backdrop blur. Their width is constrained on narrow screens.
- Existing visual-viewport sizing, safe-area insets, focus handling, keyboard navigation suppression and sticky editor actions remain owned by their original components.

## Inventory and shopping results

The real generated catalogue-700 app was exercised in Chromium with synthetic accounts and mocked authenticated catalogue responses. No live customer account, payment, AI generation or database mutation was used.

- Existing Rice 500 g + buffer 600 g, with no meal need: Shop shows 100 g.
- Existing Rice 500 g + buffer 100 g: Shop shows 0 g and explains why.
- Planned need 400 g + buffer 300 g − owned 500 g: Shop requires 200 g.
- Rice editing, new Pasta entry and a real touch hold work after a sparse restore.
- Cancel deletion preserves stock; confirm deletes only the selected Rice. Pasta, unknown-quantity Tuna, meal preferences, plans, receipt metadata and the other actor remain intact.
- Real purchase checkbox handlers record Rice 500 g, chicken 2,000 g and frozen peas 450 g without pre-crediting stock.
- Real **Finish & update At home** adds full purchased quantities once: Rice to Cupboard, chicken to Fridge, peas to Freezer. Existing Rice 500 g becomes 1,000 g.
- Cooking the actual fajitas recipe deducts 1,000 g chicken, leaving 1,000 g. Repeating that same Cook confirmation does not deduct again.

The existing suite covers zeros, rejected negatives/nonfinite values, unit and container review, g/kg/ml/l conversions, duplicate recipe ingredients, portion scaling, multiple storage areas, purchase surplus, stale writes, storage failure rollback and repeated Cook/Finish operations. Unknown quantities remain unknown; incompatible units are reviewed instead of guessed.

## Validation

- Complete application suite: **3,435 passed, 0 failed, 1 skipped, 2 TODO** (3,438 total). The skipped test executes actual Swift endpoint fixtures and requires the macOS runner. The two pre-existing TODOs concern Paddle refund/chargeback policy and lifecycle integration acceptance; they are not counted as passes.
- Focused scanner and membership race tests: **49 passed**.
- Focused sparse Home and Release verifier tests: **58 passed** before the final full run.
- Real UI checks at 320×760, 390×844, 844×390 and 1280×900: **12 passed**, no page errors or horizontal overflow. Editor actions stayed visible with a 390px-high viewport.
- UK/US regional audit of the authoritative 100-recipe legacy set: 730 ingredient lines, 221 groups, **0 duplicate rows, 0 noncanonical rows, 0 conversion failures** in either market. Three existing recipe-review entries remain explicit.
- Portable native package builds successfully. The explicit catalogue-700 package contains **200 public recipes, 500 authenticated Premium recipes, no private recipe bundle** and 1,149 files.
- Generated PWA files and cache hashes were regenerated from the final source.

## Native and external limits

The Linux workspace cannot run Xcode, sign an archive or upload to App Store Connect. The Mac-only catalogue-700 sync command correctly refuses to run here. On a Mac with Xcode, run `npm ci`, then `node tools/catalogue700/sync-ios.mjs --output-dir /tmp/basketboss-build37-native` using a new empty output directory, and open `ios/App/App.xcworkspace`. Use version **1.0.2 (37)**. Do not run ordinary `ios:sync` afterward because it stages the legacy catalogue.

No Apple submission, live entitlement, owner-sharing flag, billing amount or production database was changed by this audit. Membership remains server-verified. Existing owner-sharing configuration is still default-off; ownership alone is not evidence that a household grant is active. Production AI latency and live StoreKit/Paddle purchase outcomes require their actual configured services and devices; local mocks and StoreKit fixtures do not prove those live outcomes.

## Complete replacement code

The accompanying ZIP contains complete changed and new files at their repository paths, including regenerated PWA assets, tests and native project settings. A unified patch is included for review. Apply these files to the existing repository; they are not a standalone copy of the entire application. No private catalogue payloads, tokens or customer data are included.
