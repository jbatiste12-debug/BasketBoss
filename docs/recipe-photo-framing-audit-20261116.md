# Recipe picture review — 16 November 2026

All 700 primary recipe photographs were reviewed for full-source framing and the actual centred 16:9 Discover crop. This refresh replaces 268 older, low-resolution or unsuitable portrait/square sources, three overly tight high-resolution compositions, and the tuna-toastie composition with inappropriate cutlery. The other 428 primary images remain unchanged, including suitable deliberate close-ups.

The 272 replacements follow the existing picture schema: 1448 × 1086 WebP, stable recipe IDs and image paths, warm natural light, believable household food and crockery. The collection mixes overhead, oblique and lower views, closer compositions and wider dishes, cut portions, serving gaps and partly eaten meals. Cutlery is selective and appropriate to the food; finger foods do not receive decorative forks.

For 271 replacements, exact current public or owner-approved protected recipe records supplied the ingredient, cut and cooked-form checks. The tuna-toastie replacement is a composition-only edit of its approved source photograph: the fork and background cup were removed while preserving the original visible sandwich filling and cooked form. No recipe record was edited. Private recipe rows, methods, prompts and generation ledgers remain outside the repository and client bundles.

Every replacement received an independent review against its current output hash, including the full 4:3 image, centred 16:9 hero, square thumbnail and 70 × 88 planner crop. Reasonable closer views were retained when the dish remained clear. Rejected attempts and original source photographs were preserved in private staging.

`recipe-photo-framing-audit-20261116.json` records all 700 asset paths and before hashes, the 272 replacement hashes, and the independent crop outcomes. The catalogue-700 image manifest and naturalness record were updated only for the changed image; all recipe, normalised-ingredient, pricing, planning-role and protected-payload bytes remain unchanged.

The service worker changes only its two public cache identities. This expires older photograph bytes at unchanged image paths. Its cache guards and fetch behaviour are unchanged; no account, household, pantry, saved-plan, billing or analytics logic changes.

## Verification

- All272 exports verified as opaque1448×1086WebP with unique hashes.
- All700 primary photo hashes match the generated native700 bundle exactly; zero web/native mismatches.
-70 targeted tests passed:69 in the combined run, plus the one packaging test rerun successfully after removing disposable render HTML. The initial failure was temporary filesystem capacity.
-18 protected source/data files remain byte-for-byte unchanged; service-worker differences are exactly its two cache identities.
- Mobile before/after evidence uses the real generated app at 390 × 844, with identical card geometry and no page errors. Only the served photograph differs.
- Native web assets are verified here; Xcode compilation and device testing need macOS. The separate release launcher prepares the iOS project without uploading an archive or changing the App Store submission.

## Reproduce the packaging checks

```sh
node tools/catalogue700/build-pwa.mjs
node tools/catalogue700/build-client.mjs --source-root "$PWD" --public-release "$PWD/catalogues/700/release" --output-dir /tmp/BasketBoss-photo-review-native700
node --test --test-concurrency=1 tests/basketboss-pwa-release-cache.test.mjs tests/basketboss-pwa700-cache.test.mjs tests/basketboss-beta-domain-cache.test.mjs tests/basketboss-signup-funnel.test.mjs tests/basketboss-premium-recipe-security.test.mjs tests/basketboss-catalogue700-client.test.mjs tests/basketboss-catalogue700-pwa.test.mjs tests/basketboss-native-asset-versions.test.mjs
```

The native output directory must be empty or new. Browser tests additionally need Playwright and Chromium, as documented by the existing test fixtures.
