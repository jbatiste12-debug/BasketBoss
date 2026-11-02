# Recipe instruction audit — 2 November 2026

All 100 current public recipe methods were read against their ingredient lists and recorded times. This review corrected instructions in 39 records and aligned the four duplicate dessert records with their canonical public methods and times. It found no complete method belonging to an unrelated dish.

This is a source consistency review, not kitchen testing. The public 100 include the four desserts; the scope is **100 distinct recipes**, not 104. The normalized file supplies 730 matching public ingredient lines. Protected current Premium methods were not accessed, exported, changed or certified. The historical 321-record snapshot does not establish the complete current 500-record catalogue, and was not substituted for a current Premium review. The 179 newer protected additions still need their complete authorized records reviewed.

## Expanded catalogue coverage and remaining access boundary

The follow-up request expanded the sweep to every locally identifiable recipe, its presentation assets and the historical source. Coverage is recorded separately so a 500-file image check cannot be mistaken for a 500-method culinary audit:

| Source | Coverage established | Coverage still unavailable |
| --- | --- | --- |
| Current public source | 100 complete records; all methods read against ingredients; 730 normalized ingredient lines checked | Practical kitchen validation of timings and the explicitly listed author decisions |
| Current release presentation assets | 500 unique primary image IDs, valid WebP signatures, no duplicate primary IDs; all 100 public IDs and all 321 historical IDs have an asset | Current protected recipe titles, categories, ingredient amounts, serving scales, recorded times and method content cannot be established from image filenames |
| Historical source `9458903c4ba06fc54a558fbe05886bfa5326ab98:recipes.json` | Automated structural/method screen of 321 full historical records and 2,540 ingredient lines; 221 records / 1,810 lines outside the current public 100 | Equality with the current private Premium records is unverified; historical methods are not counted as current methods reviewed |
| Current protected source | The sealed release and its approved source/hash metadata are present; the release validator expects 400 Premium rows | **400 current complete Premium records remain unavailable for content audit**, including 221 IDs with historical records and 179 newer IDs with only local presentation identifiers |

The 500 primary image assets are 192 in `images/existing` plus 308 in `images/new`; three alternate preview images are duplicates and are excluded from the 500 count. Relative to the historical 321 IDs, the current presentation set contains 179 additional IDs. There were zero missing-ID, duplicate-ID or invalid-WebP-signature findings in that sweep. This verifies references and file signatures, not whether each photograph accurately depicts its recipe.

The current Premium route reads Cloudflare D1 `BILLING_DB.bb_private_premium_recipes_500_v1`. Its 400-row release exists locally as an encrypted envelope, with a recipient derived from the Cloudflare deployment credential. The current managed environment reports no configured secret bindings or outbound identities, so the source cannot be decrypted here. The connected `basketboss-auth` Supabase public schema was checked read-only and contains household/receipt tables, not the recipe catalogue. No customer rows were queried, credential values printed, access controls bypassed or live tables changed. Completing the current 400-record audit requires an authorized read-only D1 connection or a private export of those complete current rows outside public app assets.

### Prepared read-only connection and private export

The user selected a read-only Cloudflare connection. `scripts/load-private-recipe-audit.mjs` is prepared and tested with synthetic responses; it has not made a live call. Configure these through the task environment's credential/network settings:

- Secret `CLOUDFLARE_API_TOKEN`: an Account API token with **D1 Read**, restricted to the BasketBoss account. D1 Edit is unnecessary for this audit.
- Variable `CLOUDFLARE_ACCOUNT_ID`: the BasketBoss account's 32-character ID.
- Network destination `api.cloudflare.com`: allowed through the managed proxy.
- Optional variable `CLOUDFLARE_DATABASE_ID`: the intended database UUID. If omitted, the loader lists D1 metadata and accepts exactly one database named `basketboss-billing-live` or `basketboss_billing_live`. Both matching, duplicates or no match stop the read; similarly named backups do not match. A supplied UUID is an explicit database selection and skips listing.

Once readiness is confirmed, use:

```sh
node scripts/load-private-recipe-audit.mjs --out-dir /workspace/work/private-recipe-audit
node scripts/audit-recipe-instructions.mjs --current-private /workspace/work/private-recipe-audit/current-premium.json --json
```

The loader's only remote data query is this fixed statement, sent through Cloudflare's POST query endpoint (which accepts D1 Read permission):

```sql
SELECT recipe_id,sort_index,recipe_json,normalized_json
FROM bb_private_premium_recipes_500_v1
ORDER BY sort_index
```

There is no arbitrary-SQL option, import, activation, mutation or deployment path. Redirects are disabled; API responses are size-bounded, failed provider bodies are discarded and diagnostics use fixed error codes. The snapshot must contain 400 unique Premium rows in order with matching parsed identities and ingredient counts. The loader prints only recipe/ingredient counts and a rows SHA-256 hash.

The full snapshot is written exclusively to `current-premium.json` inside the user-selected private directory outside the checkout. New directories use mode `0700`; the new file uses `0600` and exclusive creation. Public paths, symlink redirects, permissive existing output directories and existing files/hardlinks are rejected. A second snapshot requires a new private directory; the loader never replaces the first. Hash validation detects export corruption and is not a cryptographic assertion that an arbitrary externally supplied export came from Cloudflare.

The audit CLI validates that private input remains outside the checkout with restrictive permissions, then screens the private rows alongside the public source. Its protected-source summary includes counts, the snapshot hash and rule codes/stable IDs, with no private recipe titles, methods, ingredient names or quantities. Current coverage rises from 100 to 500 only after an explicit valid 400-row current export is supplied. Historical source never raises that count. This is an automatic screen; manual inspection of flagged current records and ingredient/method review still follows. The observed coverage above remains 100 current full records until the live read actually succeeds.

### GitHub Actions route when the task has no direct Cloudflare connection

Putting a token into the production website's Cloudflare environment does not expose it to the task workspace or GitHub Actions. The prepared alternative is a separate job in the existing **Check Cloudflare catalogue connection** workflow. It runs only for a manual `workflow_dispatch` on `release/recipe-editorial-collections`; the existing `main` inspection job is unchanged. It does not use the deployment `github-pages` environment or the deployment token.

In **GitHub repository Settings → Secrets and variables → Actions**, configure repository secret `CLOUDFLARE_RECIPE_AUDIT_READ_TOKEN` with the dedicated Account D1 Read token, and repository secret or variable `CLOUDFLARE_ACCOUNT_ID`. An optional repository variable `CLOUDFLARE_DATABASE_ID` selects a specific database UUID. These are separate from existing deployment credentials; do not replace the deployment token. After the workflow code is pushed, choose **Actions → Check Cloudflare catalogue connection → Run workflow**, select the release branch and run it.

`scripts/recipe-audit-ci.mjs` verifies the repository, manual event, exact ref, commit, run ID and attempt; downloads the fixed 400-row table to a private runner-temporary directory; produces only a counts/hash summary; and encrypts the snapshot using the checked public recipient in `.github/private-catalogue/recipe-audit-recipient.json`. The existing X25519/HKDF/AES-GCM envelope implementation is reused. The high-entropy transport key remains in a `0600` file outside the checkout and is never sent to GitHub. The outer metadata binds `sourceCommit` and release ID `readonly-recipe-audit-RUN_ID-RUN_ATTEMPT`; all five run-context fields also appear inside the encrypted payload.

Plaintext cleanup runs in a `finally` block and a separate `always()` workflow step. The only uploaded artifact is `readonly-recipe-audit-encrypted-RUN_ID-RUN_ATTEMPT`, containing the one explicitly named `basketboss-recipe-audit.sealed.json` file, retained for one day. Private snapshots, methods, ingredients, tokens and the transport key are never uploaded or printed. A missing read secret/account fails with a fixed configuration diagnostic before contacting Cloudflare. No activation, deployment or D1 write step is added.

Download the artifact **from the selected trusted repository Actions run** into a directory outside the checkout. Confirm that run's commit SHA, run ID and attempt in GitHub, then open it locally with the corresponding expected values:

```sh
node scripts/open-private-recipe-audit.mjs \
  --sealed /workspace/work/private-recipe-audit-download/basketboss-recipe-audit.sealed.json \
  --key-file /workspace/work/private-recipe-audit-access/audit-transport.key \
  --out-dir /workspace/work/private-recipe-audit-current \
  --commit EXPECTED_COMMIT_SHA --run-id RUN_ID --run-attempt RUN_ATTEMPT
node scripts/audit-recipe-instructions.mjs \
  --current-private /workspace/work/private-recipe-audit-current/current-premium.json --json
```

Replace the three uppercase run placeholders with the verified values. The opener rejects wrong keys, tampered ciphertext, mismatched commit/ref/repository/run identity, permissive key files, public/symlink output paths and existing output files. It validates snapshot identity and integrity before writing a new `0600` private export, preserving the original query timestamp. Encryption authenticates the ciphertext but does not authenticate who created it: anyone with a public recipient can construct an envelope, so the trusted GitHub-run download is essential rather than treating the payload's own context as proof of its publisher.

Eight synthetic integration checks verify the 100-public + 400-protected sealed roundtrip, fixed SELECT, full-500 automatic coverage, original read-timestamp preservation, plaintext cleanup including a post-download sealing failure, all run-context mismatches, wrong keys/tampering, exclusive private output and workflow isolation. No live GitHub/Cloudflare audit run is claimed by these checks.

## Historical findings requiring current-record comparison

The historical 321-record screen found no duplicate IDs, empty methods or invalid numeric times. Its one `method`/`steps` drift is `pan-gnocchi-spinach`, already fixed in the current public source. The selected automatic regressions identify 24 historical consistency findings: 14 overlap current public records that have since been corrected, and 10 affect historical records outside the public 100. The script reports these separately and does not present them as new current errors.

Concrete issues were manually confirmed in **22 distinct historical records outside the public 100**:

| Historical IDs | Finding to compare with the authorized current method |
| --- | --- |
| `family-taco-bowls`, `family-mild-beef-chilli-with-rice` | Rice is told to absorb stock that is absent from the ingredient list. |
| `dessert-eton-mess`, `dessert-bread-butter-pudding`, `dessert-chocolate-mousse`, `dessert-raspberry-cheesecake`, `dessert-chocolate-ice-cream`, `dessert-tiramisu`, `dessert-lemon-cheesecake`, `family-baked-potato-spinach-and-egg-muffin-cups` | A generic flour-folding instruction appears without flour in the ingredient list. |
| `baking-cheddar-chive-scones`, `baking-rosemary-sea-salt-focaccia` | Scones contradict the avoid-kneading guidance with an elastic-dough/rising instruction; the named no-knead focaccia requires kneading. Confirm the intended dough method. |
| `family-15-minute-tomato-and-basil-gnocchi`, `family-one-pot-tomato-lentil-pasta`, `family-tomato-and-mozzarella-gnocchi-bake` | Direct-pan methods refer to reserving separate starchy cooking water that the method never produces. |
| `extra-air-fryer-pork-schnitzel`, `leftover-salmon-fishcakes`, `leftover-sausage-frittata`, `family-tuna-and-sweetcorn-jacket-potatoes`, `family-crispy-oven-chicken-goujons`, `family-chicken-broccoli-and-lemon-potato-cakes` | Garlic is assigned to a nonexistent softened-aromatics/sauce stage. |
| `family-quick-lemon-tuna-rice-bowls` | A searing instruction is appended to the serving step for drained tinned tuna. |

In total, 106 of the historical 221 records outside the current public source contain at least one repeated boilerplate marker. Marker presence is a review cue and is not automatically a defect: generic advice can be appropriate. Historical records were not changed or republished. The findings above need a current-row comparison before creating any protected recipe patch.

## Corrections made

The changes below use existing listed ingredients, remove unrelated copied instructions or clarify their order. `method` and `steps` now agree for every public recipe, including the pre-existing drift in `pan-gnocchi-spinach`. All 39 changed canonical records carry `culinary_data_version: ingredient-sync-all321-v3`, so the application's direct-method path uses the corrected content.

| Records | Verified problem and correction |
| --- | --- |
| `tomato-mozzarella-pasta`, `lemon-chicken-orzo` | Removed required unlisted Parmesan, oregano and grated cheese. Kept the listed mozzarella, lemon and spinach. |
| `banana-oat-pancakes`, `extra-cottage-cheese-egg-muffins` | Removed instructions to add flour when no flour is listed. Clarified the egg-muffin sequence and retained its set-centre check. Pancakes use the listed yoghurt for serving. |
| `loaded-nachos`, `extra-apple-cinnamon-baked-oats`, `tuna-sweetcorn-pasta`, `sausage-lentil-stew` | Removed phantom beans, required sweetener and an unlisted crème-fraîche substitution. Bread with the stew is explicitly an extra purchase. Tuna pasta uses its listed yoghurt, garlic and oregano. |
| `beef-chilli`, `turkey-chilli` | Removed a copied instruction to absorb seasoned stock into rice: no stock is listed, and the rice is served separately. Added explicit packet-direction rice cooking to the turkey method. |
| `chickpea-curry`, `honey-garlic-tofu`, `family-sweet-sour` | Added explicit cooking of the listed dry rice in parallel. The tofu method adds its listed ginger with garlic rather than referring to nonexistent softened aromatics. |
| `sausage-gnocchi`, `date-pesto-gnocchi`, `pan-gnocchi-spinach` | Removed instructions to reserve nonexistent separate cooking water from these direct-pan methods. Removed duplicated spinach/browning actions from the creamy spinach gnocchi. |
| `chicken-burgers`, `family-chicken-wraps`, `traybake-sausage`, `sweet-potato-soup`, `date-lemon-chicken`, `extra-sticky-orange-chicken` | Replaced generic garlic instructions referencing nonexistent sauces/aromatics with an actual stage: listed dressing, tray vegetables or pan before sauce. Soup garlic cooks before blending. Piccata potatoes cook before serving. |
| `bbq-chicken-pizza`, `spinach-ricotta-shells`, `lentil-bolognese`, `baked-feta-orzo`, `miso-salmon-rice` | Put listed paprika, oregano or ginger into the actual sauce/filling/glaze instead of a nonexistent or already completed liquid/aromatic stage. |
| `salmon`, `chicken-katsu-curry` | Salmon now makes one ginger/honey/soy/sesame glaze, keeps reserved glaze separate from raw fish, and uses it in the final two minutes of the existing cook window. Removed the unrelated glaze instruction from katsu. |
| `extra-air-fryer-garlic-parmesan-potatoes`, `extra-herb-roast-chicken-dinner`, `extra-korean-beef-bulgogi-bowls` | Parmesan is added once, near the end. Roast chicken includes heating and serving its listed gravy, with the cooking check before resting. Bulgogi includes cooking the listed stir-fry vegetables and uses the listed honey. |
| `extra-maple-glazed-gammon-roast` | Removed “no pink meat” as a cured-gammon criterion. Kept actual-cut/weight pack and food-thermometer guidance and explained that cured gammon may remain pink when cooked. |
| `chicken-noodle-soup`, `pesto-salmon-potatoes`, `extra-garlic-chickpea-flatbreads`, `extra-smoked-salmon-scrambled-eggs`, `extra-apple-cinnamon-baked-oats`, `dessert-apple-crumble` | Removed unrelated appended searing, sauce-making, roast-spacing, cooling/slicing or cake-folding boilerplate. |
| `extra-blueberry-overnight-oats` | The method now uses both listed milk and yoghurt; it previously said either despite listing both. Kept the existing refrigeration instruction and source quantities. |

No canonical recipe IDs, ingredient names/amounts, serving counts, numeric total minutes, prices, dietary metadata, images or saved plans were changed. `normalized-ingredient-database.json` was not changed. The duplicate `dessert_recipes.json` keeps its existing ingredient quantities and prices; its methods now match the canonical public source, and its outdated brownie/cake totals now match the already recorded 90/100 minutes rather than 45/70. No new timings were invented.

## Still requiring author or kitchen review

The repeatable script reports **12 findings across 10 records**, intentionally retained as review findings rather than asserting that the recipes are fully verified:

- Nine unspecified recipe quantities: Parmesan “1 block” in `creamy-pasta`, `mushroom-risotto`, `aubergine-parmigiana`; stock “1 carton” in `lemon-chicken-orzo`, `mushroom-risotto`, `sweet-potato-soup`, `sausage-lentil-stew`, `chicken-noodle-soup`; stock “1 standard pack (check recipe)” in `extra-lentil-shepherdless-pie`. Confirm measured cooking quantities before adjusting normalization or shopping maths.
- `extra-lentil-shepherdless-pie`: the 35-minute total does not allow preparation, dried-lentil cooking, a 15–20-minute potato boil and a following 20–25-minute bake. The actual lentil/pack method needs re-timing. The numeric total is preserved pending that decision.
- `extra-15-minute-pesto-tortellini`: the name promises 15 minutes while the recorded total is 20. Keep the recorded time visible; resolve the title with the recipe author.
- `spinach-ricotta-shells`: the method fills shells, but the ingredient only says “Pasta shells.” Confirm that large stuffing shells are intended.

There are also **77 pre-existing `needs_review` flags** on normalized ingredient lines, including approximate spoon conversions and assumed pack sizes. Those flags overlap some issues above; they are not 77 newly discovered method errors. Total times dependent on actual joint weight, dried ingredients, appliances and required cooling still need practical validation. Source-text checks do not establish food-safety certification.

## Repeatable verification

Run `node scripts/audit-recipe-instructions.mjs` (or add `--json`). It checks public/normalized identity and counts, ingredient shape, method/steps equality, duplicate dessert amounts/methods/times, selected high-confidence phantom-ingredient and copied-method regressions, and explicit timed phases. Storage/reheating windows are excluded from cooking-time comparisons. It exits nonzero on consistency errors; author-review findings remain visible and do not silently turn into accepted timings or quantities.

The default run also checks all 500 primary presentation IDs and WebP signatures. To screen an explicitly extracted historical file separately, run `node scripts/audit-recipe-instructions.mjs --historical /private/path/historical-recipes.json --json`; keep the extraction outside public assets. Historical findings do not raise the current-full-record count or become current-source failures.

Result after corrections: **100 recipes, 730 ingredient lines, four duplicate desserts, zero consistency errors, 12 author-review findings**. Negative-fixture checks verified that the script detects the original flour, cooking-water, cured-gammon and method/steps errors and rejects dessert quantity drift. A field-by-field comparison against the previous canonical file confirmed that every field outside `method`/`steps` is unchanged.

All 37 related editorial, pricing, private-recipe-import and Premium-content security checks passed after the parent integration refreshed its cache-version assertion. Nine dedicated audit regressions and 14 synthetic loader checks also pass, covering phantom ingredients/glazes, cured-meat criteria, method drift, nonexistent cooking water, storage-time exclusion, dessert amounts, separation of historical/current coverage, private-summary redaction, fixed-query transport, database discovery and private-file safeguards. The parent integration owns the full Apple-subscription/keyboard regression run. No live loader call, deployment, production database update or TestFlight update is claimed here.
