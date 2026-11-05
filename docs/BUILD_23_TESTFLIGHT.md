# BasketBoss 1.0 (23) — stable tab navigation

Tab changes now reset scrolling once, as the destination renders. The selected navigation pill matches the new screen immediately. Older scroll restores and saved-shop redirects stop when a newer tap or scroll takes priority, so rapid tab changes no longer pull the page back. Returning from Cook opens the requested tab directly.

The existing visual design, inventory calculations, shopping state and Premium access rules are unchanged. This build retains Build 22’s contained Foods to avoid picker and the day-badge completion gesture.

Verification: all 33 focused navigation, viewport and swipe tests passed. The complete local suite finished with 2,561 passes, zero failures, one platform skip and two existing TODOs. Browser checks against the generated native bundle passed at 320px and 375px: one reset per tab, correct first-frame selection, no late reset after manual scrolling, direct requested-tab startup, saved-shop redirect cancellation, and Cook return without scrolling the departing page. Browser checks do not replace a physical iPhone test. Portable iOS verification passed: 935 files, 100 public recipes and no protected recipe bundle. Signing and the TestFlight upload require your Mac.

## Build on your Mac

```bash
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build23-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --branch testflight-build23-navigation \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Use Node 22+, CocoaPods and Xcode 26+. Confirm Version 1.0 / Build 23, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Choose Any iOS Device (arm64), then Product → Archive → Distribute App → App Store Connect → Upload. If 23 has already been uploaded, use the next unused build number.

The fresh checkout preserves your existing project folder and signing edits.
