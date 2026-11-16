BasketBoss 1.0.3 — Build 49

Prepares a fresh, separate Xcode project from reviewed source:
d63a73590efee1d5aa5f05a771c8c5e1315428e4

Adds simpler stock controls in At home. Got it preserves an amount you already
know; it does not silently refill a pack. Running low estimates a quarter of one
opened pack after you confirm its size, then adds any same-size full spare packs.
Out removes the opened-pack amount while retaining those full spares. Edit
amount remains available for exact quantities. Save with the button below the
draft; closing the editor leaves the saved amount alone.

Shopping shows a compact Check stock prompt for estimated stock and opens the
same item editor. Reviewing a prompt does not add stock or change the deficit.
Confirmed pack capacities and stock-level metadata can sync within the existing
household sharing flow. Account and household checks, revision conflicts and
stale-editor guards protect later edits. Capacity metadata does not itself credit
physical stock. Unknown or incompatible pack sizes require review.

The core shopping deficit, cooking deduction and receipt reconciliation maths
are unchanged: 500g needed minus 250g stocked still leaves 250g to buy. Recipes,
authentication, billing and access allowances are unchanged. No SQL migration is
required by this build.

Requirements: macOS, Xcode 26+, Node.js 22+ and CocoaPods.
Run: bash prepare-build49-mac.command

The launcher creates a new folder, installs locked dependencies, updates both
native App Debug and Release settings from 1.0.2 (43) to 1.0.3 (49), stages and
verifies the 700-recipe assets, then opens ios/App/App.xcworkspace. The internal
catalogue client protocol stays 1.0.2, independently of the marketing version.
Bundle ID and signing team stay unchanged. Existing local projects are preserved.

In Xcode select your connected iPhone and Product > Run. Follow
build49-phone-checklist.txt before preparing your TestFlight archive.

To archive: select Any iOS Device, then Product > Archive. In Organizer choose
Distribute App > App Store Connect > Upload when ready.
Optional Terminal archive: bash prepare-build49-mac.command --archive
The launcher validates the actual archive's version, build and bundle ID first.
It does not upload or change an App Store submission automatically.

Do not run ordinary ios:sync afterwards; it replaces the verified catalogue 700
assets. Physical-device testing, code signing and Apple upload need your Mac.
Use a higher unused build number if 49 is already present in App Store Connect.
If 1.0.3 has already been released, choose the next App Store version for submission.
Historical Build 43–48 launchers remain byte-identical.
