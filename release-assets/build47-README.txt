BasketBoss 1.0.3 — Build 47

This launcher prepares a separate fresh Xcode project containing the reviewed
Plan polish and the first, UI-only pantry editor simplification. It preserves
your existing checkout and does not upload or change an App Store submission.

Requirements: macOS, Xcode 26+, Node.js 22+ and CocoaPods.
Run: bash prepare-build47-mac.command

The launcher fetches the pinned application source, installs locked dependencies,
sets both App Debug and Release to version 1.0.3/build 47, prepares and verifies
the 700-recipe assets, then opens ios/App/App.xcworkspace. The catalogue/client
protocol remains 1.0.2. Bundle ID and signing team are not changed.

Changes in this update:
- Lighter BasketBoss header, smaller outlined Upgrade and distinct Auto-fill.
- Day labels off meal photographs; cooking time beneath the title.
- Spaced swap/serving controls, with 44px tap targets and small-screen support.
- Remove inside the meal overflow menu; Clear week inside More options.
- Compact pantry amount/unit entry, with optional settings under More options.
- Relevant input focus and automatic disclosure of fields needing attention.
- Existing qualitative spice/oil tracking and exact reconciliation preserved.

No pack levels, pack-count controls, photo defaults or capacity-sync changes
are included. Pantry/shopping maths, authentication, billing, entitlements and
analytics event names are unchanged by these UI changes.

In Xcode, select your connected iPhone and press Product > Run. Check the Plan
and pantry editors, keyboard/scrolling, a 500g meal need with 250g pantry stock,
and your existing account, sharing and purchase/restore flows on the device.
Select the Apple Developer team for your app if Xcode requests signing setup.

To archive, select Any iOS Device and Product > Archive. In Organizer choose
Distribute App > App Store Connect > Upload when ready.

Optional Terminal archive: bash prepare-build47-mac.command --archive
The launcher verifies the actual archive has version 1.0.3, build 47 and bundle
ID uk.co.basketboss.app before opening it. It never uploads automatically.
Use a higher unused build number if Apple already has Build 47. If App Store
version 1.0.3 has already been released, select your next App Store version
before preparing the submission; the launcher preserves the established 1.0.3
release version and does not query or change App Store Connect.

Do not run ordinary ios:sync afterward: it replaces the verified catalogue700
assets. Physical-device testing, signing and Apple upload are Mac actions;
Linux tests and matching web assets do not certify a signed iPhone build.
Historical Build 43 through Build 46 launchers remain unchanged.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/7cdb72e756cff2baa7d481c567dc04e2b55fa5e5
Complete source:
https://github.com/jbatiste12-debug/BasketBoss/archive/7cdb72e756cff2baa7d481c567dc04e2b55fa5e5.zip
