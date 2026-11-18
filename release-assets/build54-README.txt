BasketBoss 1.0.4 — Build 54

Shop your kitchen first.

Reviewed application source:
0c19df9f20adacac86d774d9909c17b0db222a0b

What this build adds

- Countable foods show How many left?, quick count buttons and one stepper.
- Eggs offer 1, 2, 4, 6 and 12; other countable foods offer 1, 2, 3 and 4.
- Running low suggests two eggs or one other counted item. Done confirms the
  displayed count; no pretend physical pack size is created to store that number.
- Measured foods keep pack and exact amount controls optional. Full pack, Half
  pack and Quarter left use the existing reviewed or ingredient-specific pack.
- Running low no longer requires another pack-confirmation step when a compatible
  saved or ingredient-specific pack is available. Estimates remain labelled.
- If no compatible item-specific size is known, unknown stock remains unknown
  and the shopping list asks for a check rather than assuming it covers a recipe.
- Existing unopened packs remain counted when the opened pack is marked Out.
- The amount section grows naturally instead of clipping its inputs. With the
  iPhone keyboard open, the sheet body scrolls and Done keeps its own space.
- Count buttons and the stepper do not focus the number field or summon a keyboard.

The pantry data model, deduction and shopping-gap formulas, billing, entitlements,
auth, analytics event names and Android build setup are unchanged.
For a 500 g requirement with 250 g at home, the shortfall remains 250 g before
buyable-pack rounding. Unknown stock does not reduce that shortfall.

Files changed

Presentation: bb-pantry-add-amount-presentation.js and bb-pantry-inline.css.
Pantry input handling: bb-pantry-inline.js and bb-pantry-stock-levels-ui.js.
Browser regression tests: tests/basketboss-add-food-presentation-browser.test.mjs
and tests/basketboss-pantry-simple-input-browser.test.mjs.
Generated PWA asset hashes: pwa700/app.html, pwa700/manifest.json and
pwa700/precache.js.

Prepare on your Mac

curl -fL --retry 3 'https://raw.githubusercontent.com/jbatiste12-debug/BasketBoss/main/release-assets/prepare-build54-mac.command' -o "$HOME/Downloads/BasketBoss-Build54.command" && bash "$HOME/Downloads/BasketBoss-Build54.command"

The launcher requires Xcode and Node.js 22 or newer. It creates a fresh project,
checks out the exact reviewed source above, installs locked dependencies, sets
both App Debug and Release to 1.0.4 (54), stages catalogue-700 assets and opens
the workspace. Connect your iPhone and choose Product > Run.

Complete build54-phone-checklist.txt before uploading. Then choose Product >
Archive, or rerun the launcher with --archive to create a fresh validated archive.
In Organizer choose Distribute App > App Store Connect > Upload when ready.
No archive uploads automatically. Existing projects and archives remain intact.

Do not run ordinary ios:sync afterwards; it replaces the prepared catalogue-700
assets. The internal catalogue/client protocol remains 1.0.2 independently of
the App Store version. The repository's native project baseline is unchanged.

Launcher syntax, version guards and mocked archive behaviour can be verified
on Linux. Real Xcode signing, native keyboard behaviour and device testing still
require your Mac and iPhone.
