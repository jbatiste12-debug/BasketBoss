# BasketBoss 1.0 (26) — stock buffers and supermarket packs

The separate pantry item panel adds Extra stock buffer below Total needed. Total needed stays separate from the buffer and starts from the meal plan; the buffer adds backup stock for breakfasts, snacks and household use. Shop deducts compatible stock across storage locations from the combined amount, never below zero.

Optional Buy in multiples of rounds the missing purchase up to the selected pack size, with regional presets and a custom size. For example, 200 ml at home and 333.33 ml needed gives a 1 L purchase when a 1 L pack is chosen. With rounding off, the existing exact-quantity behavior remains. Container contents and the chosen purchase multiple remain separate settings.

Buffer and pack preferences persist per account and ingredient, including after a shop is finished, while completed one-off stock targets retain their existing lifecycle. Reopening and confirming the same panel does not add the buffer twice. Typing stays in the form until confirmation. Weekly review shows the combined Planned amount and the rounded To Shop purchase.

Only shopping demand is rounded. Recipes and cooking deductions keep exact ingredient quantities. Checking a row buys the displayed amount; Finish shop transfers the actual purchased quantity once. The saved price baseline and Premium access rules are unchanged.

Verification: the full automated suite passed with 2,610 passes, zero failures, one platform skip and two existing TODOs. Source browser checks passed at 320px and 375px, with US unit precision and stale-preference checks at 375px. Portable native verification passed with 935 files, 100 public recipes and no protected recipe bundle. Browser keyboard checks simulate viewport changes; they do not replace physical iPhone testing.

## Build on your Mac

~~~bash
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build26-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --branch testflight-build26-stock-buffer-packs \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
~~~

Use Node 22+, CocoaPods and Xcode 26+. Confirm Version 1.0 / Build 26, team Jason Batiste (J25UTUATD2), bundle uk.co.basketboss.app. Choose Any iOS Device (arm64), then Product → Archive → Distribute App → App Store Connect → Upload. If 26 has already been uploaded, use the next unused build number.

The fresh checkout preserves your existing project folder and signing edits. Signing and the TestFlight upload require your Mac.
