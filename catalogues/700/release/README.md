# BasketBoss catalogue 700 — iOS 1.0.2 / build 33

Complete staged expansion: 200 new recipes, 100 Free and 100 Premium, numbered 501–700. Together with the protected original 500 this gives 200 Free and 500 Premium recipes. All 700 have ingredients, portions and cooking instructions. The 39 additional breakfast recipes bring the breakfast collection to 50; breakfast is optional and excluded from dinner Auto-Fill.

The new collection covers 50 fakeaways, 50 date-night/fish dishes, 61 family dishes and 39 breakfasts. Existing recipe IDs, objects, ingredient positions and legacy API counts are preserved. Each new recipe has an individually generated and visually reviewed 1448 × 1086 WebP at its canonical slug path, source-aligned quantities/methods and indicative estimates for UK, Guernsey, Jersey and US markets.

`validation-summary.json` records 19,200 actual price-engine cases, 2,400 pantry cases, 200 image/hash checks and 1,000 legacy dinner-classification comparisons, with zero failures. All 22 similarity candidates were editorially resolved against actual dish ingredients and methods. Three candidate concepts that duplicated existing meals were replaced before the final data freeze. Estimates remain indicative, and no claim is made that recipes have been kitchen-tested.

The public Free files retain the original 100 as an unchanged prefix. All 500 private recipe rows and the 100 new Premium image briefs are encrypted in `.github/private-catalogue/catalogue700-release.sealed.json`; no Premium ingredient or method payload is published here. Image filenames, titles and meal roles are public metadata.

This directory is isolated staging. It does not activate catalogue 700, change old clients, update the live website, import a database or submit a build. Follow [the versioned release procedure](../../../docs/catalogue700-versioned-release.md) and [the explicit native build procedure](../../../docs/catalogue700-client-build.md). Normal `ios:sync` stages the legacy catalogue; use the dedicated 700 wrapper for this release.

Before TestFlight/App Store delivery, import and pin the matching versioned backend release, confirm native checks and device behavior, and include Monthly Premium, Annual Premium and their subscription group in the same new app-version review submission.
