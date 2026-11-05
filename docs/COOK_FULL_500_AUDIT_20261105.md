# Full Cook audit — 500 current recipes

All **500 current recipes** were individually reviewed: 100 public records and 400 protected Premium records retrieved from the live catalogue. Each review checked the ingredient list, ordered method and ingredient prep notes. This is an editorial, data and application-flow audit; the recipes have not been physically kitchen-tested as part of this work.

| Final coverage | Public | Protected | Total |
| --- | ---: | ---: | ---: |
| Individually reviewed | 100 | 400 | 500 |
| Recipes with corrections | 98 | 267 | 365 |
| Methods corrected | 90 | 264 | 354 |
| Prep notes corrected or added | 270 | 1,295 | 1,565 |
| Accepted author findings resolved | 15 | 18 | 33 |
| Outstanding findings from this author review | 0 | 0 | 0 |

These totals compare the final accepted catalogue against the source before the Cook audit, so recipes corrected in both passes are counted once. There are now 4,232 ingredient lines: the original 4,227 plus five explicitly measured ingredients.

## Accepted recommendations

The owner explicitly accepted recommendations for all **33 findings across 31 distinct recipes**: 13 public and 18 protected recipes. The follow-up supplies missing recipe-use weights/volumes, measured frying oil, oven settings, chronological preparation, realistic time estimates, and a wonton wrapper quantity that matches the filling. Methods refer to listed ingredient amounts or proportions so household serving changes remain consistent.

Accepted amount changes are synchronized with normalized pantry/shopping requirements. Changed indicative costs and timing aliases use existing fields; recipe identities, serving counts, access tiers, ingredient names/keys and allergy metadata are preserved. The public detail is in [PUBLIC_RECIPE_RECOMMENDATIONS_ACCEPTED_20261105.md](PUBLIC_RECIPE_RECOMMENDATIONS_ACCEPTED_20261105.md). These are accepted culinary specifications and estimates, not a kitchen-testing claim.

The initial editorial pass preserved quantities and normalized records. The separately authorized follow-up changes only the accepted recipe fields and normalized amounts/prices. Existing unrelated quantity-review flags remain visible to the internal audit: three public source quantities (ginger and herb handfuls) still require checked measurements before canonical aggregation. They are safely preserved, separate from the 33 resolved author findings.

## Current source and protected release

The original protected snapshot was acquired through a fixed SELECT with a dedicated read token. Authenticated GitHub run `42075016412`, commit `c72cfe3f1c5be7f6df7a99705dfdafef12790c35`, bound the encrypted snapshot to its publisher, source hash and session recipient. Five review batches cover every protected row exactly once.

- Original protected rows: `61733dd3cbb63f56dabad75572b54739c8fd39edf90bea0e468e24db3be2be68`.
- First content correction release: `1e54c10834b144142fab94b0fca88d12fc904c6ea3da1137d8307b7f5a887eb8`; production activation run `42080854115` completed with exact readback and unchanged normalized/legacy records.
- Final accepted recommendation release (production activation run `42087938810`, exact full readback verified): `f89eaecc9b2ca71fbd8018c7f733e51c630f6992e5ad5def902f609a71fcbc2e`.

The 18-recipe follow-up validates explicit source quantities against normalized numbers and dimensions, and changed ingredient prices against normalized price hints. It preserves all other 382 rows byte for byte. The actual 400-row candidate passed an atomic local SQLite import and exact full readback. Production uses a pinned D1 file importer, checks every source row in the same atomic transaction, seals rollback before writing, and verifies all 400 candidate rows and the unchanged legacy catalogue afterward. Exact publisher/artifact hashes and current-main checks prevent stale activation; replays are idempotent.

Protected methods and review evidence stay outside the checkout with restricted permissions. Public release files contain only encrypted content, hashes and aggregate evidence. No protected catalogue is included in the iOS bundle.

## Engine and mobile verification

Display, speech and Chef Boss context use one conservative method parser. It handles markdown and structured steps while preserving card positions. Invalid cards are rejected. Preparation reordering retains the corresponding original card for timer extraction, so a prep duration cannot replace the cooking timer.

The final regression run passed **2,525 tests with zero failures**, one platform skip and two existing Paddle TODOs (2,528 cases). All 500 final accepted methods pass normalization invariants: no empty cards, lost measurements, mutations or idempotence failures. The full regression suite uses isolated PostgreSQL and mocked provider/auth responses. Exact current counts and production activation evidence are recorded in [COOK_FULL_500_AUDIT_20261105.json](COOK_FULL_500_AUDIT_20261105.json).

Cook styling changes paint and typography only. Six native-layout states at 375×812 show zero overflow/errors and unchanged control dimensions. The final full-catalogue browser audit exercised 2,477 cards, 12,385 timer actions, 14,385 navigation actions and 3,477 Chef Boss context checks across all 500 recipes, with zero issues, horizontal overflow, page/console errors or API write attempts. It uses actual native-bundle controllers with network requests mocked. App Store screenshots contain actual app captures, with promotional captions outside the unchanged app pixels.

Native signing and the signed TestFlight upload require the owner's Mac. [Build 18 instructions](BUILD_18_TESTFLIGHT.md) include a clean checkout command and Xcode upload steps.
