BasketBoss 1.0.2 — build 43

On your Mac:
1. Open prepare-build43-mac.command. It downloads the pinned source, installs dependencies, stages the 700-recipe client, and opens Xcode.
2. Confirm Version 1.0.2 and Build 43. Choose your Apple signing team if requested.
3. Select Any iOS Device (arm64), then Product > Archive.
4. In Organizer choose Distribute App > App Store Connect > Upload.
5. After Apple processes the upload, select build 43 in TestFlight.

Requires Xcode and Node.js 22 or newer. This prepares source; signing/upload happen on your Mac. A TestFlight upload does not replace or withdraw an App Store review submission.

Existing users keep their completed setup. To see the new three-screen flow, use Settings > Replay welcome & setup. This avoids deleting your plans or pantry data.

The main My Week amount is estimated shopping still to buy, including pantry credit and full-pack rounding. Recorded purchases remain in the separate combined weekly total inside Budget & household.

The Premium offer opens the existing verified purchase page. Apple shows the actual localized product price; no free trial is promised by setup. Continue free applies setup choices without changing an entitlement.

At home hides items whose saved stock is exactly zero and excludes them from its counters. Confirming a cooked meal keeps any positive leftovers visible. Saved restock targets and cooking history are preserved.

Inventory edge-case fixes: new pantry food uses its compatible planned unit, generic food names match recipe fillet/portion descriptions without renaming saved stock, partial kg/l purchases retain their supported physical quantity, and offline cooking/undo retries safely when connection returns. See docs/qa/2026-11-11-inventory-edge-audit.md for the full audit and regression coverage.

An already-saved amount such as 200 each is kept for explicit review. To correct the haddock example: At home > Fridge > Edit Smoked haddock > clear the At home amount > choose g > enter 200 > Add to Shop. This gives 600 g required and 400 g to buy.

Do not run ordinary npm run ios:sync after this launcher; that selects the legacy catalogue instead of the 700-recipe release.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/6f50b87276e37463893f67d8328b972938904284

Complete source ZIP:
https://github.com/jbatiste12-debug/BasketBoss/archive/6f50b87276e37463893f67d8328b972938904284.zip

See build43-whats-new.txt for Apple Connect notes and build43-what-to-test.txt for regression checks.
