BasketBoss 1.0.4 — Build 51

A simpler Add food screen keeps the stock choices close to hand and puts the
existing amount fields inside Add amount. Extra unopened packs is clearer,
and Out shows None at home only when the total stock really is zero.
Estimated amounts and their existing explanatory notes remain available.

This is a presentation change. The original controls still handle amounts,
validation and saving. Choosing an unknown pack size or an incomplete stock
amount still requires confirmation; Add amount opens when a field needs
attention. Shopping quantities, recipe deductions and stock arithmetic retain
their existing behaviour.

FRESH PROJECT
Run bash prepare-build51-mac.command on your Mac. Requirements: Xcode 26+,
Node.js 22+ and CocoaPods. It creates a separate project folder and fetches the
reviewed Add food application source:
21e2016ad8bfdd15695b63d0483e31b121f822a2

The launcher installs locked dependencies, sets both App Debug and Release to
1.0.4 (51), stages/verifies the catalogue 700 bundle and opens
ios/App/App.xcworkspace.
Use this fresh project to include the Add food changes. Changing the version
numbers in an older prepared project does not add the new application code.
Previous projects and archives remain intact. Do not run ordinary ios:sync
afterwards: it would replace the verified recipe assets.

Connect your iPhone and choose Product > Run before archiving. The launcher
can also create an archive with --archive; it verifies the actual app version,
build and bundle ID but does not upload it or change App Store Connect.
Organizer must show 1.0.4 (51), uk.co.basketboss.app. Use the 1.0.4 version in
App Store Connect and select the processed Build 51 after uploading.
The approved 1.0.3 release train is closed; an old 1.0.3 archive cannot be used.

The internal catalogue client version stays 1.0.2 with catalogue 700.
Historical Build 43–50 release assets and tests remain byte-identical.
