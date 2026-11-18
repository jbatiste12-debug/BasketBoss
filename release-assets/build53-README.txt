BasketBoss 1.0.4 — Build 53

Shop your kitchen first.

Reviewed application source:
bde71537e216d5280d62f6f5760e5e322ee13323

What this build adds

- A simpler Add food sheet: food name, Got it / Running low / Out, one optional amount row and Done.
- Got it can save new food without an amount. Unknown stock never reduces the shopping gap; the list asks you to check it.
- Pack-size choices, Full / Half pack, extra unopened packs and exact amounts remain inside Add amount.
- Out shows None at home only when total stock is zero. Unopened packs remain counted.
- The header, food, status selector and Done stay in view while optional controls scroll.
- Start next week opens a blank meal plan while keeping Auto-fill as a separate action.
- If days are unfinished, you can choose a pantry review or keep stock as it is. Starting a new week does not assume those meals were cooked or deduct their ingredients.

Existing measured stock and reconciliation calculations remain unchanged.
Suggested amounts retain Estimated labelling and the reminder to check the label.
Your previous week and unfinished shopping trip retain the existing archive flow.
Billing, Premium entitlements, sign-in and analytics event names are unchanged.

Files changed

Presentation: bb-pantry-add-amount-presentation.js and bb-pantry-inline.css.
Approved pantry UI controller logic: bb-pantry-inline.js and bb-pantry-stock-levels-ui.js.
Approved new-week behaviour: matching app.html/index.html, bb-pantry-first-controls.js
and bb-pantry-first-controls.css. The week regression tests are
tests/basketboss-saved-week-host.test.mjs,
tests/basketboss-pantry-first-controls.test.mjs and
tests/basketboss-after-cooking-shop-deficit-browser.test.mjs.
Pantry regression tests are tests/basketboss-pantry-stock-levels.test.mjs and
tests/basketboss-add-food-presentation-browser.test.mjs.
Generated PWA files: pwa700/app.html, pwa700/make-a-meal.html,
pwa700/manifest.json and pwa700/precache.js. These refresh source-derived asset
hashes, including full checked asset references, for consistent offline versions.
Core quantity maths, reconciliation, the pantry data model, billing, entitlements,
auth and analytics event names are not changed by this release.

Prepare on your Mac

Download prepare-build53-mac.command, then run:

bash "$HOME/Downloads/BasketBoss-Build53.command"

If the download kept its original filename, use:

bash "$HOME/Downloads/prepare-build53-mac.command"

The launcher requires Xcode and Node.js 22 or newer. It creates a fresh project,
checks out the exact reviewed source above, installs locked dependencies, sets
both App Debug and Release to 1.0.4 (53), stages catalogue-700 assets and opens
the Xcode workspace. Connect your iPhone and choose Product > Run.

Complete the phone checklist before uploading. After testing, choose Product >
Archive, or rerun this launcher with --archive to create a fresh, validated archive.
In Organizer choose Distribute App > App Store Connect > Upload when ready.
No archive uploads automatically and earlier projects and archives stay intact.

Do not run ordinary ios:sync afterwards; it replaces the prepared catalogue-700
assets. The internal catalogue/client protocol remains 1.0.2 independently of
the App Store version. The repository's native project baseline is unchanged.

Launcher syntax, version guards and mocked archive behaviour can be verified
on Linux. A real Xcode build, signing and device run still require your Mac.
The earlier AI failure-reporting changes do not prove the underlying generation
timeout resolved: one controlled phone generation test is still needed.
