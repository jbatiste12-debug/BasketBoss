# BasketBoss 1.0 (20) — clearer Plan options

Build 20 includes Build 19 and makes the Plan options easier to notice and read. The buttons now read Budget & household, Meal preferences and Foods to avoid, with warm gold backgrounds, dark green text and compact selection badges. Existing controls, saved preferences, budget calculations and shopping logic are preserved.

Verification: 47 focused tests passed. Actual native-layout checks passed at 375px and 320px: matching 44px buttons, labels within two lines, original open/close actions, selected-count badges and no horizontal overflow. Default text/background contrast is 7.68:1. The native bundle contains 935 client files and 100 free recipes; portable iOS verification passes.

Use Node 22+, CocoaPods and Xcode 26+ on your Mac:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build20-XXXXXX")" &&
git clone --depth 1 --branch testflight-build20-plan-options \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0 / Build 20, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Choose Any iOS Device (arm64), then Product → Archive → Distribute App → App Store Connect → Upload. If 20 has already been uploaded, use the next unused build number. A signed Apple upload requires your Mac; it has not been performed here.
