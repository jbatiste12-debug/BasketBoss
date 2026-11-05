# BasketBoss 1.0 (19) — quicker pantry updates

Build 19 includes Build 18 and updates the At home inventory interface. The stock database, unit conversion, pantry deduction and shopping shortfall calculations retain their existing owners.

## Included

- Sticky Search, Add item and View filters controls, with Cupboard, Fridge and Freezer jump buttons.
- Saved inventory appears first in compact cards. Quantity controls stay beside each item; Use soon and Reduced badges remain visible on the card.
- Food choices and the manual add form appear when needed, keeping ordinary quantity updates short.
- Bottom spacing clears the floating navigation and the iPhone safe area.
- Weekly essentials retain their separate controls and existing shopping reconciliation.

## Verification and upload

The final automated run passed 2,527 tests with zero failures (2,530 cases: one platform skip and two existing TODOs). Native-layout checks passed at 375×812 and 320×812, including sticky controls, filter results, 44px targets, a live Carrots-to-Shop update, exact 200g typing under Low/Out, reduced stock, and bottom-dock clearance. All ten core stock/data files and seven quantity/conversion helpers remain unchanged.

The 935-file native bundle and portable iOS checks pass, with 100 free recipes and no private recipe catalogue bundled. Native Apple CI is tracked separately; physical device checks, signing and the TestFlight upload require your Mac. Build 18 remains available at its unchanged release tag. Detailed evidence: [Pantry UI audit](PANTRY_UI_AUDIT_20261105.json).

## Open in Xcode

Use Node 22+, CocoaPods and Xcode 26+ on your Mac. After the release tag has been published, run:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build19-XXXXXX")" &&
git clone --depth 1 --branch testflight-build19-pantry-ui \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0, Build 19, team Jason Batiste (J25UTUATD2), and bundle `uk.co.basketboss.app`. Use the next unused build number if 19 has already been uploaded.

For TestFlight, choose **Any iOS Device (arm64)**, then **Product → Archive**. This destination builds archives; use a connected iPhone or simulator for Run. In Organizer choose **Distribute App → App Store Connect → Upload**. Signing and the signed Apple upload must be completed from your Mac.

The PWA deployment and the signed iOS upload are separate. Existing TestFlight installations receive the new client interface after you upload and distribute the new build.

Tester notes: [build19-what-to-test.txt](../release-assets/build19-what-to-test.txt).
