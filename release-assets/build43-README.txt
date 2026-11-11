BasketBoss 1.0.2 — build 43

On your Mac:
1. Open prepare-build43-mac.command. It downloads the pinned source, installs dependencies, stages the 700-recipe client, and opens Xcode.
2. Confirm Version 1.0.2 and Build 43. Choose your Apple signing team if requested.
3. To test first, connect your iPhone, select it at the top of Xcode, and press the play button (Product > Run). When ready to upload, select Any iOS Device (arm64), then Product > Archive.
4. In Organizer choose Distribute App > App Store Connect > Upload.
5. After Apple processes the upload, select build 43 in TestFlight.

Requires Xcode and Node.js 22 or newer. This prepares source; signing/upload happen on your Mac. A TestFlight upload does not replace or withdraw an App Store review submission.

Existing users keep their completed setup. To see the new three-screen flow, use Settings > Replay welcome & setup. This avoids deleting your plans or pantry data.

The main My Week amount is estimated shopping still to buy, including pantry credit and full-pack rounding. Recorded purchases remain in the separate combined weekly total inside Budget & household.

The Premium offer opens the existing verified purchase page. Apple shows the actual localized product price; no free trial is promised by setup. Continue free applies setup choices without changing an entitlement.

At home hides items whose saved stock is exactly zero and excludes them from its counters. Confirming a cooked meal keeps any positive leftovers visible. Saved restock targets and cooking history are preserved.

Inventory edge-case fixes: new pantry food uses its compatible planned unit, generic food names match recipe fillet/portion descriptions without renaming saved stock, partial kg/l purchases retain their supported physical quantity, and offline cooking/undo retries safely when connection returns. See docs/qa/2026-11-11-inventory-edge-audit.md for the full audit and regression coverage.

An already-saved amount such as 200 each is kept for explicit review. To correct the haddock example: At home > Fridge > Edit Smoked haddock > clear the At home amount > choose g > enter 200 > Add to Shop. This gives 600 g required and 400 g to buy.

Shopping pack controls: tap the green Buying pill on an item. A preset saves with one tap; use Custom for a different amount or total estimated price. Choosing an unticked pack does not add stock. Ticking confirms the selected physical amount; Finish/reopening does not credit it again. The core calculations, canonical matcher and price catalogue are unchanged. See docs/qa/2026-11-11-shopping-pack-controls.md.

Do not run ordinary npm run ios:sync after this launcher; that selects the legacy catalogue instead of the 700-recipe release.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/b6a8e2bcef58dfd73ede16d4ffbc064297ec47f5

Complete source ZIP:
https://github.com/jbatiste12-debug/BasketBoss/archive/b6a8e2bcef58dfd73ede16d4ffbc064297ec47f5.zip

See build43-whats-new.txt for Apple Connect notes and build43-what-to-test.txt for regression checks.

Shopping checkbox reliability: checkbox events stop independently of Buying controls. A failed purchase does not leave a false tick. If online and device pantry amounts differ, the existing review opens within Shop; Use this device’s amounts prefills the saved values, and confirmation retries only the intended purchase. Other successful purchases are kept.

Emergency presentation audit: whole-unit display labels now cover confirmation messages and Cook from pantry too. Unknown household/custom prices have an editable guide estimate. Household purchases stay in Weekly essentials; existing food-filed household stock is moved only after you review the actual total. Whole lime/lemon/orange count purchases retain canonical grams and an optional count-display proof. See docs/qa/2026-11-11-shopping-integrity-audit.md.
