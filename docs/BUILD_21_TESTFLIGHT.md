# BasketBoss 1.0 (21) — smoother Pantry and day completion

Build 21 includes Build 20. Plan now explains holding a day badge to move dinner and double-tapping it to complete the day. Completion uses the existing guarded, once-only stock reconciliation for all planned food that day. A saved completed day gains a green badge and checkmark. Uncertain amounts still use the existing review before confirmation. The explicit Day done button remains available.

Pantry category changes now close the previous section before scrolling, keep the tapped heading stable, and reuse inventory cards during quantity updates. Inner category containers grow with the document; the solid sticky toolbar and consistent amount-row heights remain stable. Inventory storage and stock calculations are unchanged.

The per-meal servings control is a smaller cream pill with subtle round controls and a clean people icon. Each button retains a 44px touch target; portion limits, scaling and persistence are unchanged.

The public landing page is shorter, with a real app screenshot, a qualified weekly savings target, yellow-sticker and stock benefits, and clear Free/Premium links. Existing authentication callbacks and Premium checks remain in place. The landing page is separate from the native app.

Verification: the complete suite passed with 2,542 passing tests, zero failures, one platform skip and two existing TODOs. Real browser checks at 375px and 320px verify stable accordion/category navigation, one document scroller, identical known/unknown row heights, and unchanged pantry stock. Multi-digit quantity editing passed after the scroll fix. Mobile touch checks confirmed all-day depletion once, repeat-tap idempotence and green status after reload. Landing layout/auth checks passed at 320, 375, 768 and 1440px. The native bundle contains 935 files and 100 free recipes, with no protected recipe bundle; portable iOS verification passed. Native signing and upload still require Xcode on your Mac.

## Build on your Mac

```bash
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build21-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --branch testflight-build21-premium-controls \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0 / Build 21, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Choose Any iOS Device (arm64), then Product → Archive → Distribute App → App Store Connect → Upload. If 21 has already been uploaded, use the next unused build number. A signed Apple upload requires your Mac; it has not been performed here.
