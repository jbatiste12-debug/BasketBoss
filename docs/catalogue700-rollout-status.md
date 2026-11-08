# Catalogue 700 rollout status

The release targets BasketBoss iOS 1.0.2, build 33. The complete data/client source at commit `050d77f6862245052c88127cdff8caeed127e13f` passed [all three native verification jobs](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/42528224402): unsigned iPhone archive and Cook, real keyboard, and hosted StoreKit. This verifies an unsigned build; it does not upload or sign an App Store release.

All 700 recipes contain methods, ingredients and portions. All 3,491 method cards retain their quantities, times and temperatures through the existing parser. There are 200 additional reviewed images and 50 breakfast options overall. The recipe, pantry, pricing and browser evidence is linked from PR #93 and `catalogues/700/release`.

## Optional-meal cloud backup

Production project: `basketboss-auth` (`kbhyosxuvlcazyzzinqv`). The existing installer `sql/basketboss-planner-extras-v1.sql` was applied through Supabase on 8 November 2026 as migration `20261108224217_basketboss_planner_extras_v1`. Installer SHA-256: `68c993db30c66b698d91acb79560607214d4d0e711dfc5c9fa0e251043519003`.

The live table has RLS enabled, three owner policies, a composite owner/generation key and an Auth deletion cascade. The save function is SECURITY INVOKER and authenticated-only. Rollback-only probes using the designated review account verified creation, updates, stale-revision rejection, owner-reassignment rejection, cross-user read/write isolation and anonymous denial. All probe records were rolled back. The existing `basketboss_data` columns and its four saved rows were retained. Security advisors introduced no new planner-extras notice; existing unrelated baseline notices remain outside this change.

## Versioned recipe backend

The new catalogue uses its own D1 table and exact release/hash settings. Existing 221-row and 400-row endpoints remain separate. The guarded 700 import, activation workflow and current production inspection must pass before a real client can hydrate all 500 Premium records.

A fresh read-only production inspection on 8 November 2026 returned Cloudflare HTTP 401 / code 10000 while listing Pages projects. No D1 import or release-setting change was made. The deployment token must be replaced in the `github-pages` GitHub environment with access to the intended account's Pages and D1 resources.

The original recipe recipient was derived from the original deployment token. Since that token is no longer available privately, replacing the API credential also requires resealing the frozen release to the replacement token's observed public recipient. Complete private staging inputs are retained outside the public checkout; no recipes or photographs need recreating. Public-key transport changes must preserve the approved plaintext/SQL digests, all recipe data hashes and existing recipient files for historical releases. Never paste a deployment token into chat, logs or source control.

## Native handoff

After the reviewed backend is imported and enabled, prepare the Mac workspace using the dedicated `tools/catalogue700/sync-ios.mjs` wrapper described in `catalogue700-client-build.md`. Ordinary `npm run ios:sync` stages the legacy catalogue and must not replace the verified 700 output afterward.

Test the real device against the activated release, including Premium purchase, Premium recipes, Restore Purchases and the breakfast/shopping flow. In App Store Connect create version 1.0.2, attach build 33 and include Monthly Premium, Annual Premium and their subscription group in the same review submission. The first subscriptions must accompany this new app version. No Apple upload or submission has been performed by this rollout preparation.
