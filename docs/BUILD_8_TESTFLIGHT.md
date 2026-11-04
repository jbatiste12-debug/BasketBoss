# BasketBoss 1.0 (8) — TestFlight handoff

Build 8 carries forward the build 7 release and adds the pantry running-balance
workflow. Build 8 with the compact saved-plan controls is frozen as
`testflight-build8-plan-tabs`. Build 9 adds the kitchen-balance welcome slide;
see `BUILD_9_TESTFLIGHT.md` for the latest upload. Source preparation and an unsigned CI archive
do not upload a build to Apple; signing and upload use Xcode on the owner's Mac.

## Added in build 8

- **Compact saved-plan controls.** Saved weeks and Saved meals share a small
  button row. Both start closed; tap to open one panel or close it again. Draft
  names stay intact while switching.

- **A persistent pantry balance.** Food and essentials stay in At home between
  weeks. Reviewed receipts and Finish Shop add confirmed purchases. Weekly
  review can correct what remains without clearing the pantry.
- **Confirm cooked.** One explicit confirmation deducts the ingredients used.
  Amounts can be adjusted first; revisiting Done or reopening a confirmed meal
  does not deduct again.
- **Day done.** One review covers that day's remaining planned dinner, lunch and
  dessert. Already confirmed meals are skipped. A cooked batch is counted once;
  its linked leftover meals do not use the same raw ingredients again.
- **Simple manual shopping extras.** Shop has Add item to buy with only Item and
  Quantity to buy. `4`, `500 g`, `2 packs`, `1 bag (500 g)` and `2x400g` are valid
  examples. The entered amount is an additional purchase, independent of stock
  already at home.
- **Partial purchases and trip carry-over.** Deposits satisfy automatic meal
  shortages first, then manual extras. Outstanding manual quantities carry into
  the next shopping trip. Bought checkboxes alone do not deposit stock; old
  receipts cannot fulfill a newer trip's manual request. Household essentials
  are restocked separately from food ingredients.
- **Pantry-aware Auto-fill.** Available non-staple foods increase a recipe's
  chance of selection. Recently planned recipes and yesterday's exact main
  protein reduce its score. Pantry stock is a weighted preference, so suitable
  recipes remain available even when their ingredients are not already owned.
- **Shared unit conversion.** Cooking, shopping shortfalls and Auto-fill share
  the same physical stock allocation. Metric aliases, reviewed package contents,
  food-specific weight/volume or item weights, and disclosed produce/spoon
  estimates can match different recipe units. Unknown or conflicting units stay
  in the pantry with a review message; partial packs and small balances are
  retained. The backend migration permits fractional stock while receipt
  purchase counts keep their whole-number checks.

## Carried forward from build 7

Build 8 also includes the existing photo-to-ingredients-to-meal Cook page and
matching AI meal pictures, TestFlight Beta Premium unlock, Apple subscription
and restore wiring, Chef Boss mentor conversation and voice recovery, ingredient
name/unit standardisation, garlic/carrot basket fixes, Prep ↔ Cook navigation,
named saved weeks, and onboarding keyboard fixes. These are inherited release
features rather than additional build 8 changes. AI features still need eligible
access, an internet connection and working production provider configuration.

## Backend rollout

The pantry source includes the Cloudflare API changes. Deploy the matching API
and apply these Supabase migrations in this order before enabling the build 8
pantry workflow for testers:

1. `supabase/migrations/20261104174441_receipt_auto_stock_policy.sql`
2. `supabase/migrations/20261104174450_pantry_fractional_stock_balances.sql`

Cloud pantry sync for the new balances requires both migrations and the matching
Cloudflare API rollout. Until then, a cloud validation failure keeps the local
update and asks for review rather than discarding the pantry balance.

The read-only production audit found the base receipt SQL still installed.
The fractional migration changes validation without rewriting inventory. Its
purchase validator preserves the existing receipt count restrictions and its
service authorization remains restricted. Use the release's recorded deployment
result to confirm these prerequisites; pushing a GitHub branch does not apply
Supabase migrations.

## Open the exact release in Xcode

Use Node 22 or later, full Xcode 26 or later, and CocoaPods. Start from a fresh
folder to keep any local signing edits in an older checkout intact. Once the
build 8 commit has been pushed, paste this into Terminal:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build8-XXXXXX")" &&
git clone --depth 1 --branch testflight-build8-plan-tabs \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Wait for **Ready for Xcode**. This project uses the CocoaPods **workspace**, not
only `App.xcodeproj`. The app's web assets are bundled locally, so Xcode must
receive the fresh `ios:sync` output before archiving.

In Xcode:

1. Select the **App** target and confirm **Version 1.0 / Build 8** under General.
2. Under Signing & Capabilities, enable automatic signing and select the
   BasketBoss Apple Developer team, **Jason Batiste — J25UTUATD2**. Keep bundle ID
   `uk.co.basketboss.app`.
3. Select the **App** scheme and **Any iOS Device (arm64)** as the destination.
4. Choose **Product → Archive**. That destination is for archiving; the Run
   button requires an actual iPhone or a simulator.
5. In Organizer, select the new **1.0 (8)** archive and choose
   **Distribute App → App Store Connect → Upload**. Complete validation/upload
   using the Apple account on the Mac.
6. After Apple finishes processing, add build 8 to the required TestFlight
   testing group. Use `release-assets/build8-what-to-test.txt` for tester notes.

GitHub's archive is unsigned and cannot by itself replace this signed upload.
Keep the installed app when updating so its saved pantry and plan remain.

## Acceptance checks

- Check the compact Saved weeks / Saved meals controls above the dinner plan.
  Open and close each, switch with a draft name entered, and save/load a week.

- Start with food and essentials already in At home. Plan a meal and verify
  Shop shows only the automatic shortfall.
- Add a manual top-up while plenty is already owned; the full additional amount
  must stay on the list. Purchase part, finish the trip, and verify the remainder
  carries into the next trip.
- Review a receipt or Finish Shop. Check food and household essentials increase
  once, including when the same receipt is opened again.
- Confirm one cooked meal, reopen it, then choose Day done. Dinner, lunch and
  dessert should each deduct only once. Test a batch and its linked leftovers.
- Check `1 bag (500 g)` against gram requirements, litres against millilitres,
  and counts against disclosed produce estimates. An unknown bag size must
  remain untouched with a review message.
- Reopen the app and start the following week. Remaining stock must still be
  present. Update essentials and leftovers, then Auto-fill and check that pantry
  overlap influences suggestions without restricting the recipe pool.
- Check Premium beta unlock, a typed mentor question, mentor speech, ingredient
  photo review, meal creation and its optional matching image on the iPhone.

Native CI status is tracked in [PR #40 checks](https://github.com/jbatiste12-debug/BasketBoss/pull/40/checks).

Local verification for the pantry implementation recorded 1,720 passing tests,
zero failures or skips, and two existing TODO tests, including actual PostgreSQL
checks. Strict pantry type checks, native packaging and portable iOS verification
also passed. Browser checks at 390 px and 768 px covered manual entry and daily
deduction through reload. Native CI, signing/upload, physical-device acceptance
and production rollout have separate release results; do not infer them from
these local checks.
