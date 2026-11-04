# BasketBoss 1.0 (11) — Weekly essentials in Shop

Build 11 keeps the Build 10 kitchen workflow and fixes missing household top-ups in Shop.
The new source tag is `testflight-build11-essentials`; earlier release tags stay unchanged.

## Changes

- A dedicated Weekly essentials section follows the food aisles in the basic shopping list and full-screen Shop Mode, and appears at the bottom of the phone Shop overview.
- Adding a saved or receipt-created household item selects it for the current shopping list. Editing its quantities reconciles the target against stock already at home.
- Shop uses only the remaining household shortfall. Items covered at home stay out of To buy; buying, unbuying, counts and known price estimates use the existing purchase handlers.
- Household purchases continue to update household balances separately from food stock. Membership, backend quotas, receipt review and Premium verification are unchanged.
- The PWA shell cache and changed asset URLs are refreshed. The native bundle is built from the same source, with Version 1.0 and Build 11 in Debug and Release.

## Validation

Portable native packaging and iOS configuration verification passed: **914 assets**, **100 Free recipes**, no private Premium recipe bundle, bundle ID `uk.co.basketboss.app`, team `J25UTUATD2` and minimum iOS 16.0. The generated bundle contains the exact changed household and Shop presentation modules.

Focused PWA cache/security regression tests: **22 passed, zero failed**. Existing Xcode-setting verification tests: **3 passed, zero failed**. The new worker precaches the changed asset URLs and keeps authenticated API/private data out of Cache Storage.

These checks do not compile or sign an Apple binary, exercise StoreKit on a device, or upload to App Store Connect. macOS CI and your local Xcode archive remain the native build checks.

## Open the release in Xcode

Use a fresh folder on your Mac to preserve local signing edits in any older checkout.
Requires Node 22+, Xcode 26+ and CocoaPods:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build11-XXXXXX")" &&
git clone --depth 1 --branch testflight-build11-essentials \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

In Xcode confirm Version **1.0**, Build **11**, team **Jason Batiste (J25UTUATD2)** and bundle ID **uk.co.basketboss.app**. If Build 11 has already been uploaded, choose the next unused build number before archiving.

Choose **Any iOS Device (arm64)**, then **Product → Archive**. In Organizer choose **Distribute App → App Store Connect → Upload**. After Apple processes the upload, assign it to your TestFlight group and use [the Build 11 tester notes](../release-assets/build11-what-to-test.txt).

The generic device destination is for archiving. Running directly requires a connected iPhone or an available simulator.

The PWA can receive these client fixes through its normal deployment; existing TestFlight installs need a newly uploaded native build to include the updated client bundle. Building this source does not change backend records or user membership.
