# BasketBoss 1.0.2 / Build 43: Bought, pantry aliases and layout

Status: PASS / READY

## Result

- The single clean sequential suite discovered 4,308 tests: **4,305 passed, zero failures, zero cancellations**, 1 existing platform skip and 2 existing TODOs. Duration: 16.14 minutes.
- No source HTML, JavaScript or CSS changed during that process. All 745 captured source hashes still match.
- Rebuilt public PWA and native catalogue-700 assets pass parity: 204 compiled client JS/CSS assets, 206 including native runtime/CSS, 1,163 native files, 1,162 native manifest entries, 33 generated PWA manifest entries and 238 precache URLs. No private recipe bundle is shipped.

## Shopping and pantry behavior

Confirmed purchases have presentation history for the current actor and shopping trip. Crediting At home no longer removes them from Bought or resets the progress counter. Full and partial purchase changes share the existing atomic purchase journal; a failed save cannot leave a phantom completion. Finish shop archives the completed trip and starts a fresh one.

Unticking an eligible current purchase uses the existing proven reversal. Used or externally changed stock is preserved and the unsafe correction is refused. Existing purchases can be displayed after an upgrade only from same-actor, same-trip verified ownership markers; settled purchases additionally require matching receipt and settlement history. Stock balances alone never infer a purchase.

A partial purchase remains in Bought while its remaining shortfall stays in To buy. Cooking and later receipt generations keep the old purchase record without hiding a later meal's live shortfall. Increasing a plan during an active shop also preserves the purchase and exposes the additional requirement. Existing numeric requirement, partial-purchase and spending assertions remain intact.

The regression loop starts with 3 sausages, buys a 6-pack, shows one Pork Sausages row containing 9 each, preserves Bought through account refresh/reload, and unticks back to 3 without disturbing another purchase. Monday cooking retains exactly 533.333333 g of chicken; Tuesday displays 533 g at home and a 67 g top-up.

## Exact household aliases

The central table has 29 explicit groups. It applies name equivalence at application boundaries, never fuzzy substring matching. Generic rice defaults to long-grain rice; basmati, jasmine and brown rice remain distinct. Generic milk defaults to semi-skimmed milk, while whole and skimmed milk remain distinct. Salted/unsalted butter, different onions, proteins, cuts, food states and culinary types remain protected.

A read-only audit covered all 700 recipe IDs, including all 500 Premium recipes, across 23 sources and 43,459 name observations / 984 unique labels. It found zero food/household classification collisions. The actual composed application canonicalizers produce 72 distinct IDs for the 72-name protein/cut matrix and pass all 20 explicit protection pairs. Private payloads and the full private-name report are excluded from the public handoff.

Load migration uses the existing pantry normalizer for exact compatible units and lot grouping. It preserves dated, reduced and frozen batches, unrelated ambiguous units and exact quantities. Verified active reversal footprints can be rebased atomically; ambiguous or stale footprints defer migration. Original stock/inventory/owner/shop bytes are backed up under an actor-specific key, and the ordinary absolute-stock sync outbox is committed in the same transaction. Server baselines and another actor's data are not rewritten by the migration.

## Display and layout

Review & restock is above the At home heading, below the main app header. It remains in document flow, outside the food/essentials panel sweep. Real 320px/390px checks preserve search, filters, selection, storage switching, mounted pantry nodes and navigation clearance, with a 48px review action.

The My Week controls adjustment changes only scoped rules in bb-plan-premium-polish.css: it removes the one-sided action gutter and centers the four rows, including Start next week plus its information icon. No JavaScript, labels, state, handlers or tests were changed for that alignment adjustment. Computed geometry passes at 320, 390, 430 and 768px with no horizontal overflow.

The yellow Shop reminder containment adjustment changes only scoped rules in bb-shop-purchase-ui.css. Reviewed keeps its natural width; text wraps and the button stays inside the card at 320, 375, 390, 430 and 768px. Its original click still dismisses only the reminder and leaves checkbox/pantry state unchanged.

## Isolation and regression evidence

The isolation certificate has 22 checks. Seven complete core files and twelve existing application calculation functions are byte-identical to baseline 0b8ff949265f2f0f31f3606ec5a288b5c462ad31. Two application functions differ only in approved identity callback wiring, and bb-home.js differs only in the approved name reader/callback adapters. Removing exactly those adapters reproduces the original calculation-source hashes. No subtraction, serving-scaling, conversion-factor, catalogue-price-table or six-decimal arithmetic implementation was changed.

Legacy browser fixtures now resolve the requested canonical names. The Mornay planned-unit fixture explicitly selects Whole milk so its original 600 ml requirement remains protected rather than being borrowed by the new semi-skimmed default. Existing quantity, unit, price and state assertions were retained; ambiguous name-only Bought selectors now target the intended purchase ID. The frozen bb-home calculation hash remains checked after the separately pinned identity adapter.

The audit also verifies the new modules' exact versioned URLs in the legacy service-worker precache and a defensive storefront fallback when optional browser UI globals are unavailable. These fixes belong to the previously requested shopping/alias release; the two later alignment/containment adjustments themselves are CSS only.

## Handoff boundary

The launcher pins the tested application source, prepares the 700-recipe iOS assets and opens Xcode. Version remains 1.0.2, Build 43. On the Mac, select the paid Apple Developer team and archive/upload in Xcode. No additional ordinary ios:sync is needed after this launcher. This Linux verification does not claim a signed Xcode archive, a physical-iPhone payment transaction, or an App Store upload. Live publication evidence is recorded separately in the release packet.
