# Recipe expansion deployment route

Audit observed on 31 October 2026. The user has authorized the live release;
the final content, image and integration checks remain release gates. This
document records a route and blockers, not a completed deployment.

## Verified access and current blockers

| Item | Observed result |
| --- | --- |
| Git origin | `https://github.com/jbatiste12-debug/BasketBoss.git` |
| Read access | `git ls-remote origin HEAD` succeeded. |
| Write access | `git push --dry-run origin HEAD:refs/heads/codex/basketboss-release-access-check` succeeded. It did not create a branch or upload changes. |
| Latest main at audit | `de63fcab8c643d7e13916b2a08a66064762a0709` |
| Checkout base | `cc9188f1d8479aee73a3c7a6509cd388b03ecaa4`, on `work` |
| Repository automation | Neither the checkout nor fetched `origin/main` has `.github` workflows or a Wrangler project config. |
| Pages Git integration | The user subsequently confirmed production auto-deploys from GitHub main. Cloudflare account access is still needed to inspect the exact project, build configuration and production binding; successful Git push alone does not verify the deployed result. |
| Cloudflare auth | Wrangler 4.156.0 `whoami` reports unauthenticated. Current environment status has no configured secrets or outbound Cloudflare identity. |
| HTTP access | Restricted policy permits GitHub Git HTTPS but excludes `api.github.com`, `api.cloudflare.com` and `basketboss.co.uk`. GitHub REST requests return `Forbidden`. No proxy or policy bypass was attempted. |
| Production D1 | The application uses binding `BILLING_DB` and table `bb_private_premium_recipes`; live database ID, schema, contents and backups cannot yet be verified. |
| Private release draft | Outside the public checkout at `/workspace/basketboss-expansion-staging/release-draft`; 400 rows with `sort_index`, `recipe_json`, `normalized_json`. Its manifest is `CONTENT_COMPLETE_IMAGES_PENDING`, so it is not the release-ready import artifact. |

Cloudflare operation requires an authenticated account with Pages deployment
and D1 export/import permissions scoped to the correct account. The supported
network configuration also needs the exact API, production verification and
D1 presigned upload/download hosts. Do not put credentials in repository files,
CLI arguments, logs or messages. No network settings were changed in this audit.

## Preserve the latest published work

The fetched main contains six newer commits, including seven-dinner autofill
rotation, School Lunchboxes fixes, regional/supermarket pricing and reviewed
receipt prices. Thirty-six files differ from the checkout base. Overlapping
files include `index.html`, `app.html`, `basketboss-pricing-v19.js`,
`ingredient-pack-catalog.json`, `service-worker.js`, `bb-beta-landing.js` and
onboarding assets.

Integrate the expansion with the newest main in an isolated release checkout,
resolve the overlaps deliberately, and rerun affected checks. Preserve the
current working draft and all newer changes. Use an ordinary fast-forward push
or reviewed merge; never force-push main. Recheck remote main immediately
before release because the hash above is only the audit observation.

## Prepare and inspect before importing

1. Finish all 179 image files and the corrected legacy goujons image. Run the
   complete full-500 verifier, then run `scripts/prepare-recipe-release.mjs`
   without `--allow-pending-images`. The default output is the private
   `release-ready` directory outside the public checkout. Verify the manifest
   and payload hashes after the final integration changes.
2. Once Cloudflare access is configured, inspect the live Pages project and
   its production `BILLING_DB` binding. Match the actual account, database ID,
   production branch and production host; names in source are not proof of
   the deployed binding. Keep configuration inspection output limited to the
   relevant binding and deployment metadata.
3. Inspect `PRAGMA table_info(bb_private_premium_recipes)`, its schema/indexes/
   triggers, current row count and distinct recipe IDs. The current import
   bundle contains only the three queried columns; do not guess required
   primary keys or schema defaults.
4. Export a table-scoped backup using Wrangler's supported `d1 export` command
   with `--remote --table bb_private_premium_recipes --output <private-path>`.
   Store it outside the public checkout with restrictive permissions, record
   its checksum and confirm a usable rollback path. Do not print recipe data.
5. Build a SQL file matching the inspected schema from the verified 400-row
   release-ready bundle. Keep all replacement operations in that one file;
   escape values as SQL string literals and validate the result against a
   local copy of the actual table schema. Do not send a standalone destructive
   delete followed by separate insertion requests.

Wrangler 4.156.0's remote `d1 execute --file` implementation uses D1's import
API and explicitly reports that failed execution returns the database to its
original state. This is the available atomic file-import route; do not replace
it with a shell loop of independent writes. Actual production import has not
been attempted. Its API-provided presigned file-upload host must be permitted
by the supported network policy before execution.

## Deploy and activate in a compatible order

The currently published source requires exactly 221 Premium rows in both the
server API and the old recipe clients. Importing 400 rows first would make
that API return 503. New API and client code must accept the complete legacy
221 or expanded 400 catalogue before replacing the database contents.

Account for previously installed PWA clients as well: an old cached client
still rejects a 400-row response even after the server is updated. The reconciled implementation retains the original 221 rows for legacy requests;
new clients request `?catalogue=500` and receive all 400 when available. Both
versions authenticate and validate the complete underlying catalogue before
responding. The import bundle must preserve the original 221 rows first in
`sort_index` order. A changed service-worker filename/version alone does not
prove every open client has reloaded.

After the compatibility deployment is confirmed live, import the verified
400-row SQL file with `d1 execute <verified-production-database> --remote
--file <private-sql-path>`. Confirm the import completed, record its bookmark,
and verify 400 unique Premium IDs, expected hashes and normalized records.
Then activate the final 500-recipe presentation and confirm the deployed
revision, entitlement checks, 100 Free/500 Premium totals, new images,
autofill behavior and hidden dish-price badges on the live site.

Public assets must continue to contain only the 100 Free recipe records.
Private review JSON, SQL imports, backups and full Premium payloads stay
outside the Pages asset root and outside Git. Keep Shop prices and budget
calculation available. Billing, checkout and account settings are outside
this recipe deployment's scope.

No commit, push, deployment, database write or import was performed by this
audit. Only a read-only remote fetch and a non-mutating push dry run were used.

## Reconciled release worktree

The code reconciliation is isolated at `/workspace/BasketBoss-release`, branch
`release/recipes-500-20261031`, based on `de63fcab8c643d7e13916b2a08a66064762a0709`.
The original working tree and ongoing image generation are untouched. The
tracked draft snapshot is at
`/workspace/basketboss-expansion-staging/reconciliation/draft-tracked.full-index.patch`.
Untracked code/docs/tests were copied; new images and all private recipe JSON
remain outside this reconciliation until the final image sync.

The canonical merge retains main's existing pack edits, all regional guides,
retailer observations and personal product-price behavior. It adds 184 new
canonical pairs from the current draft (including the later cooking-water
entry) and the saffron pack correction. Both meal-estimate calling conventions
share the same calculator and aggregate pantry usage before rounding. The
seven-day controls use scoped strict rotation, import the prior main history
without changing storage on opening, and retain confirmation/save rollback.
When unused recipes cannot fill every requested day under the variety rules,
only valid suggestions are added; the tracker never resets early.

After images finish, sync only the approved image files from the original
worktree, reprice and verify the private catalogue against this merged runtime,
prepare a fresh release-ready bundle, and rerun the final gates. No part of
this reconciliation starts the separately requested Essentials/scanner phase.

Reconciliation verification: all 42 repository test files passed. A loopback
Chromium smoke test at 1408 px and 390 px confirmed readable ingredient names,
no horizontal overflow or visible dish-price badges, one working Auto-fill
control, and seven dinners plus seven rotation entries saved on confirmation.
No uncaught browser exceptions occurred. The detailed local report is
`/workspace/basketboss-expansion-staging/reconciliation/browser-smoke.json`.
Safari itself and the live deployment were not exercised by this local check.
