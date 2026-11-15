BasketBoss 1.0.3 — Build 46

This launcher creates a separate fresh Xcode project containing the compact
Discover update. It does not change your existing project, upload an archive,
or change an App Store submission.

Requirements: macOS, Xcode 26+, Node.js 22+ and CocoaPods.
Run: bash prepare-build46-mac.command

The launcher downloads the pinned source, installs dependencies, sets both App
Debug and Release to version 1.0.3/build 46, prepares the verified 700-recipe
assets and opens ios/App/App.xcworkspace. Signing team and bundle ID remain
unchanged. The internal catalogue/client protocol remains 1.0.2; it is separate
from the App Store version and must not be changed by hand.

This update includes the compact Discover header/search/category rail, wide
spotlight photograph, original recipe actions, horizontal leftover matches,
and two-column recipe grid. Existing recipe, pantry, shopping and account
logic remains in its original owners. Separate unfinished onboarding/paywall
work is not part of this release.

In Xcode, select your connected iPhone and press Run to test. For an archive,
select Any iOS Device and Product > Archive, then use Organizer > Distribute
App > App Store Connect > Upload when ready. Use the paid Apple Developer
team belonging to your app if Xcode needs signing configuration.

Optional Terminal archive mode: bash prepare-build46-mac.command --archive
It verifies the actual archive is version 1.0.3, build 46 and bundle ID
uk.co.basketboss.app before opening Organizer. It never uploads automatically.
Use a higher unused build number if Apple already has Build 46.

Do not run ordinary ios:sync afterward: it replaces the verified catalogue700
assets. Device signing, Apple authentication and purchase/restore behavior
still require checks on the signed iPhone before submission.

Historical Build 43, Build 44 and Build 45 launchers remain unchanged.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/1a6da3abe757e0ed3ca5420a249e8bee35fed728
Complete source:
https://github.com/jbatiste12-debug/BasketBoss/archive/1a6da3abe757e0ed3ca5420a249e8bee35fed728.zip
