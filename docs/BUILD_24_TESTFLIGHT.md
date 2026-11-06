# BasketBoss 1.0 (24) — stable pantry confirmation panel

Add food and Edit now open a separate panel above the pantry. The background stays at its saved position while the keyboard is open. Amounts, units and subcategory choices stay in the form until confirmation; typing does not rebuild the pantry list. The panel keeps its header and confirmation action visible as the viewport changes.

Enter At home and check Total needed, which starts from the meal plan and can be increased for extra stock. Add to Shop shows the shortfall after compatible stock is deducted, with a minimum of zero. Confirm with Add to Shop, or Done when covered. Existing meal requirements and direct Shop top-ups are preserved. Confirming the same total again updates the same target rather than accumulating duplicate demand.

Weekly kitchen check opens the same separate food editor, or the existing essentials confirmation panel, and returns to the unchanged list with Save & back to check. Opening the check focuses Close rather than search, and list steppers or Out update stock without the keyboard. The cupboard, fridge and freezer lists keep their compact controls; + / − outside the panel still save immediately. Duplicate bottom spacing and category auto-scroll calls have been removed. Basic stock editing remains Free, and Premium access rules are unchanged. The in-app introduction, walkthrough and written guides describe the confirmation flow.

Verification: 2,578 local automated tests passed with zero failures, one platform skip and two existing TODOs. Source mobile browser checks passed at 320px and 375px; generated native 375px checks passed for panel drafts, repaint/keyboard behavior, confirmation math, repeat protection and weekly review save-and-return. US pound/ounce round trips are checked against exact persisted grams and targets. Portable iOS verification passed: 935 files, 100 public recipes and no protected recipe bundle. Browser keyboard viewport checks do not replace a physical iPhone test. Signing and the TestFlight upload require your Mac.

## Build on your Mac

~~~bash
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build24-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --branch testflight-build24-pantry-panel \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
~~~

Use Node 22+, CocoaPods and Xcode 26+. Confirm Version 1.0 / Build 24, team Jason Batiste (J25UTUATD2), bundle uk.co.basketboss.app. Choose Any iOS Device (arm64), then Product → Archive → Distribute App → App Store Connect → Upload. If 24 has already been uploaded, use the next unused build number.

The fresh checkout preserves your existing project folder and signing edits.
