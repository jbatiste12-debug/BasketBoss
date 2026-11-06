# BasketBoss 1.0 (25) — compact review and restock

At home → Review & restock opens a separate panel with one compact row per item: Item, At home, Planned and To Shop. Planned includes the meal requirement and any extra stock requested in the item editor. To Shop uses the existing shortfall calculation, including compatible stock in other storage locations. Unknown or incompatible amounts stay marked for review rather than appearing as confirmed zero stock.

Tap an item row to open its separate quantity panel. Confirm with Save & back to check to return to the same review position and update Shop. Opening the check does not focus a text field or show the keyboard. Food and weekly essentials use their existing editors and stock reconciliation. The main pantry retains its quick quantity controls.

The desktop My Week budget ring now fits fully within its card. Its phone layout is unchanged. Free and Premium access rules are unchanged.

Verification: the full automated suite passed with zero failures (2,582 passes, one platform skip and two existing TODOs), followed by 30 focused review and native-verification checks, including the final added reconciliation case. Portable native verification passed with 935 files, 100 public recipes and no protected recipe bundle. Mobile browser checks cover the compact columns, unknown quantities, separate item editors, confirmation, scroll restoration and keyboard focus; physical iPhone signing and testing remain part of the Mac upload process.

## Build on your Mac

~~~bash
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build25-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --branch testflight-build25-weekly-review \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
~~~

Use Node 22+, CocoaPods and Xcode 26+. Confirm Version 1.0 / Build 25, team Jason Batiste (J25UTUATD2), bundle uk.co.basketboss.app. Choose Any iOS Device (arm64), then Product → Archive → Distribute App → App Store Connect → Upload. If 25 has already been uploaded, use the next unused build number.

The fresh checkout preserves your existing project folder and signing edits. Signing and the TestFlight upload require your Mac.
