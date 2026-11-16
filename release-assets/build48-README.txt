BasketBoss 1.0.3 — Build 48

Prepares a fresh, separate Xcode project from reviewed source:
4c24972047af8543761fd970f0c1bb1031b3871b

Includes the calmer At home presentation and 272 refreshed recipe photographs.
All700 primary pictures were reviewed; suitable closer views remain, alongside
wider dishes, varied angles, cut portions and partly eaten servings.
New exports use the existing1448×1086WebP schema and stable image paths.
Recipe ingredients, quantities and methods, exact pantry reconciliation,
authentication, billing, entitlements and analytics event names are unchanged.

At home leads with Scan food when empty, with Add food and Scan receipt nearby.
Search, selection and storage filters appear after stock is added. Quick-add
staples retain their existing prefilled quantity editor and confirmation.
No new stock-level controls or free-scan allowances are included in this build.

Requirements: macOS, Xcode26+, Node.js22+ and CocoaPods.
Run: bash prepare-build48-mac.command

The launcher creates a new folder, installs locked dependencies, sets both
native App configurations to1.0.3(48), stages and verifies the700-recipe assets,
then opens ios/App/App.xcworkspace. The internal client protocol stays1.0.2.
Bundle ID and signing team stay unchanged. Existing local projects are preserved.

In Xcode select your connected iPhone and Product > Run. Check the new pictures
in Discover, Plan and Cook; the empty/populated pantry; scrolling and keyboard;
and500g recipe need /250g pantry stock producing250g to buy. Check your existing
account and optional Apple sign-in, household sharing and purchase/restore flows.

To archive: select Any iOS Device, then Product > Archive. In Organizer choose
Distribute App > App Store Connect > Upload when ready.
Optional Terminal archive: bash prepare-build48-mac.command --archive
The launcher validates the actual archive's version, build and bundle ID first.
It never uploads or changes an App Store submission automatically.

Do not run ordinary ios:sync afterwards; it replaces the verified catalogue700
assets. Physical-device testing, code signing and Apple upload need your Mac.
Use a higher unused build number if48 is already present in App Store Connect.
If1.0.3 has already been released, choose the next App Store version for submission.
Historical Build43–47 launchers remain byte-identical.
