# Catalogue 700 delivery and import boundary

This is a separate future catalogue. Creating recipe data or generating an import file does not activate it. The current app, native build, root `recipes.json`, existing 221/400 Premium endpoint, price catalogue and importers keep their existing behavior and exact counts.

| Client request | Public recipes | Private recipes | Delivery |
|---|---:|---:|---|
| Existing unversioned Premium request | 100 | 221 | Existing `/api/recipes/premium` |
| Existing `catalogue=500` | 100 | 400 | Existing `/api/recipes/premium?catalogue=500` |
| Future explicit catalogue 700 | 200 | 500 | Separate public release files and `/api/recipes/v700/premium?catalogue=700` |

The existing endpoint is unchanged, including its existing missing-table fallback rules. The new endpoint never falls back, changes an old client's response, or accepts a lower-bound count.

## Private assembly

`tools/catalogue700/release.mjs` exports `assembleCatalogue700`, `catalogue700Metadata`, `catalogue700UpsertSql` and `canonicalHash`. Inputs are:

- `freeRecipes`: the unchanged 100 root Free recipe objects.
- `freeNormalized`: the unchanged corresponding 100 normalized objects, or their existing `{recipes:[...]}` envelope.
- `privateRows`: the protected 400-row export in exact existing order, retaining each `recipe_json` and `normalized_json` string unchanged.
- `additions`: all 200 new recipes, with the exact numbers 501–700 and 100 Free/100 Premium tiers.
- `additionNormalized`: the corresponding 200 positional normalized objects, or `{recipes:[...]}`.

The normal command fixes all three baseline hashes to the approved protected data. The pure assembly function exposes an explicit `protectedHashes` argument for synthetic isolated tests; command-line inputs cannot override these pins. All old IDs, objects, row strings and row order remain unchanged. New Premium rows occupy indexes 400–499; new Free objects follow the original 100 in the separate 200-record Free export.

Use an owner-only staged input JSON and an output directory outside the public checkout:

```sh
node tools/catalogue700/release.mjs \
  --staged-inputs /private/path/catalogue700-inputs.json \
  --output-dir /private/path/catalogue700-review \
  --release-id catalogue700-reviewed-release
```

The command generates a private assembled bundle, private UPSERT SQL and release metadata. It makes no network request, applies no SQL and marks the output `STAGED_FILES_ONLY` with `activationEligible:false`. Complete schema, deduplication, pantry, price, photo and planning regression reports remain separate release requirements; merely assembling the counts does not prove culinary or release readiness.

## Non-destructive SQL

The generated SQL creates only `bb_private_premium_recipes_700_v1` and `bb_recipe_catalogue_releases_v1`. Its primary key is `recipe_id`, matching the existing database naming convention, so conflict clauses use `ON CONFLICT(recipe_id)`.

Before importing, the SQL compares all 400 source rows in `bb_private_premium_recipes_500_v1` with the protected export. Existing protected copies in the new table use `DO NOTHING` and must match exactly afterward; the file cannot overwrite them. Only the 100 new Premium IDs use `DO UPDATE`. Every final row, exact count and metadata record is checked. There is no table-wide DELETE, REPLACE, mutation of either legacy table, or lower-bound count.

Import the entire file atomically through D1's Wrangler remote file-import facility after release review. Do not split it into individual statements. The file intentionally contains no BEGIN/COMMIT statements because D1 file import owns that transaction. A failed guard or insert must roll back all rows and release metadata. Local SQLite transaction tests cover idempotence, new-record updates, protected-record refusal and late-failure rollback. No database import has been performed by this implementation.

## Release pins and authorization

The route remains unavailable unless all of the following are configured together for the reviewed release:

```text
BB_CATALOGUE700_ENABLED=true
BB_CATALOGUE700_RELEASE_ID=<metadata.release_id>
BB_CATALOGUE700_ROWS_SHA256=<metadata.premium_rows_sha256>
BB_CATALOGUE700_FREE_SHA256=<metadata.free_recipes_sha256>
BB_CATALOGUE700_NORMALIZED_SHA256=<metadata.free_normalized_sha256>
```

These are release identifiers and digests, not subscription credentials. Keep the enable flag off during preparation. Metadata must report exactly 200 Free and 500 Premium records, match every configured pin and retain the protected 400-row hash. The route hashes all returned row strings and the old 400-row prefix before delivery. Missing tables, unknown or duplicate version parameters, malformed JSON, duplicate IDs, partial counts, misordered rows and mismatched digests fail closed with no old-table fallback.

The route uses the existing verified Supabase account and server-owned Apple/Paddle/household Premium authorization. Its path is registered in the existing API middleware's protected-route list so current-device session and pending account-deletion rules remain in force. Native CORS and preflight handling remain the existing middleware behavior. Private responses use the existing `no-store` and `Vary: Authorization` headers; errors never log private recipe rows.

Premium data must be sealed with the existing private-catalogue recipient before being committed. The new envelope needs its own explicit release kind and future reviewed activation process; the old 400-record activation workflows must never be reused or weakened to accept 500 records. Plaintext bundle, SQL and private verification details stay outside the public checkout.

The complete release envelope is staged at `.github/private-catalogue/catalogue700-release.sealed.json`. An owner environment holding the existing recipient's decryption token can recreate the exact guarded UPSERT and metadata without any network request:

```sh
node tools/catalogue700/prepare-import.mjs \
  --public-release "$PWD/catalogues/700/release" \
  --output-dir /private/path/catalogue700-import
```

Read the token from the existing secret environment as `BB_CATALOGUE_DECRYPT_TOKEN` or `CLOUDFLARE_API_TOKEN`; never put it in a command argument, source file or PR. The command verifies the envelope pins, exact protected 400-row prefix, public 200-record hashes and complete 500-row payload before writing owner-only SQL. It neither imports that SQL nor enables a feature flag. The token must correspond to the existing recipient fingerprint; rotating a Cloudflare API token does not change an encrypted envelope's recipient.

## Future client integration

The future 1.0.2 client must deliberately select catalogue 700, load the separate 200-record Free data, verify both canonical Free hashes against the reviewed manifest and private response, and combine only a complete matching 200/500 pair. Recipe and normalized IDs must be unique and aligned across all 700 before replacing client state. A changed sign-in must discard delayed private responses. Existing clients continue loading their original files and route.

Digest encoding is SHA-256 of UTF-8 `JSON.stringify(array)` with no extra newline. The array is `free` for `free_recipes_sha256`, `freeNormalized` for `free_normalized_sha256`, and the ordered four-field Premium rows for `premium_rows_sha256`; the old 400-row prefix produces `protected_rows_sha256`. Pretty-printed file-byte hashes can also be recorded, but they are different values and cannot replace these pins.

New images retain their canonical slug paths inside the isolated `catalogues/700/release/assets/` mirror until release. The future build must materialize or route that mirror deliberately. Future version-specific normalized data, explicit pack additions and planning roles must be loaded together; they must not mutate the old catalogue's aliases or units. The existing dinner predicate is retained for every old ID. Breakfast and other non-dinner roles must remain outside dinner Auto-Fill. The explicit 700 client builder now materializes those assets and roles for 1.0.2. Catalogue activation remains a separate production release step.
