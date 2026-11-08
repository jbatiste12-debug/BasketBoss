# Catalogue 700 rollout status

The release targets BasketBoss iOS 1.0.2, build 33. The complete data/client source and activation preparation at commit `75797bb323af6369add3b9d3c7553398480141cb` passed [all three native verification jobs](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/42533363839): unsigned iPhone archive and Cook, real keyboard, and hosted StoreKit. The full portable suite passes 3,162 tests with zero failures, one existing platform skip and two existing Paddle TODOs. This verifies an unsigned build; it does not upload or sign an App Store release. Baseline, planner and versioned-catalogue PRs #91, #92 and #93 are merged using merge commits, preserving the reviewed data ancestry.

All 700 recipes contain methods, ingredients and portions. All 3,491 method cards retain their quantities, times and temperatures through the existing parser. There are 200 additional reviewed images and 50 breakfast options overall. The recipe, pantry, pricing and browser evidence is linked from PR #93 and `catalogues/700/release`.

## Optional-meal cloud backup

Production project: `basketboss-auth` (`kbhyosxuvlcazyzzinqv`). The existing installer `sql/basketboss-planner-extras-v1.sql` was applied through Supabase on 8 November 2026 as migration `20261108224217_basketboss_planner_extras_v1`. Installer SHA-256: `68c993db30c66b698d91acb79560607214d4d0e711dfc5c9fa0e251043519003`.

The live table has RLS enabled, three owner policies, a composite owner/generation key and an Auth deletion cascade. The save function is SECURITY INVOKER and authenticated-only. Rollback-only probes using the designated review account verified creation, updates, stale-revision rejection, owner-reassignment rejection, cross-user read/write isolation and anonymous denial. All probe records were rolled back. The existing `basketboss_data` columns and its four saved rows were retained. Security advisors introduced no new planner-extras notice; existing unrelated baseline notices remain outside this change.

## Versioned recipe backend

The new catalogue uses its own D1 table and exact release/hash settings. Existing 221-row and 400-row endpoints remain separate. The guarded 700 import, activation workflow and current production inspection must pass before a real client can hydrate all 500 Premium records.

A replacement account-owned token with Pages Edit and D1 Edit is saved in the `github-pages` GitHub environment. [Trusted main inspection](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/42534502092/job/128895877102) verified management API access and returned only its public encryption recipient. The separate read-only website checker now compares the live headline against the checked-in `welcome.html`; its obsolete numerical-savings assertion was removed, with all asset/status/receipt-section checks retained. Twenty focused checker tests pass, including the actual landing page and rejection of the retired headline. No D1 import or v700 release-setting change has been made yet.

The frozen release is resealed to the replacement public recipient `a0cd1fd90382242a516b7801ffef09171215ae4f71cb1801835f305eb07d6d4e`, using a dedicated `catalogue700-recipient.json`. The historical recipient files remain unchanged. The exact 4,484,709 plaintext bytes retain SHA-256 `35733d23fe954318dba2c66bdcf566ce6f3f29d5f038166e3c83e41ef9356e7b`; the regenerated guarded SQL retains SHA-256 `51d9bd2d46ce3461cb7fc6090606de6aa1189069fcfe95190565efa214a8318f`. No recipe, image, release identity or protected-row hash changes. Complete private staging inputs are retained outside the public checkout. Never paste a deployment token into chat, logs or source control.

## Native handoff

After the reviewed backend is imported and enabled, prepare the Mac workspace using the dedicated `tools/catalogue700/sync-ios.mjs` wrapper described in `catalogue700-client-build.md`. Ordinary `npm run ios:sync` stages the legacy catalogue and must not replace the verified 700 output afterward.

Test the real device against the activated release, including Premium purchase, Premium recipes, Restore Purchases and the breakfast/shopping flow. In App Store Connect create version 1.0.2, attach build 33 and include Monthly Premium, Annual Premium and their subscription group in the same review submission. The first subscriptions must accompany this new app version. No Apple upload or submission has been performed by this rollout preparation.
