BasketBoss 1.0.4 — Build 50

Apple has approved 1.0.3 and closed that release train. New submissions must
use a higher marketing version. This launcher prepares 1.0.4 (50), preserving
the reviewed application source d63a73590efee1d5aa5f05a771c8c5e1315428e4.
Only native marketing version/build settings change; catalogue protocol 1.0.2,
recipes, pantry reconciliation, authentication and billing stay unchanged.

QUICKEST FIX IF YOUR BUILD 49 PROJECT IS ALREADY OPEN
1. In Xcode select the App target, then General.
2. Set Version to 1.0.4 and Build to 50.
3. Choose Product > Archive to create a NEW archive.
4. In Organizer confirm 1.0.4 (50), then Distribute App > App Store Connect.
5. Create the 1.0.4 version in App Store Connect and select the processed build.
   Retrying the old 1.0.3 archive cannot fix its embedded version metadata.

FRESH PROJECT
Run bash prepare-build50-mac.command on your Mac. Requirements: Xcode 26+,
Node.js 22+ and CocoaPods. It creates a separate project folder, installs locked
dependencies, sets both App configurations to 1.0.4 (50), stages/verifies the
catalogue 700 bundle and opens ios/App/App.xcworkspace. Previous projects and
archives remain intact. Do not run ordinary ios:sync afterwards.

Connect your iPhone and choose Product > Run before archiving. The launcher
can also create an archive with --archive; it verifies the actual version,
build and bundle ID but does not upload it or change App Store Connect.

Includes the same Got it / Running low / Out pantry controls, opened pack and
full spares, exact amount editor, compact shopping check and guarded household
capacity sync. Historical Build 43–49 launchers remain byte-identical.
