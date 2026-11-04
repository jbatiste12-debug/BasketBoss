# BasketBoss 1.0 (9) — welcome and compact planning tools

Build 9 includes all build 8 functionality and the “Your kitchen, made simple”
welcome. The latest source is `testflight-build9-basketboss` on
`fix/confirmed-cook-pantry` (PR #40). Earlier release tags remain unchanged.

The welcome uses the established BasketBoss crowned-basket branding, Cook-page
forest/cream/gold styling and an existing recipe photograph. The four numbered
steps use the same icons and names as the app’s navigation. Money metaphors and
the cupboard illustration have been removed. The slide fits a 390 × 844 viewport;
shorter phones can scroll while keeping the primary action visible.

The first-use guide explains the real actions: start in Plan or choose recipes
in Discover; confirm quantities in At home; use the automatically reconciled
Shop list (including a simple eggs example) and optional additional manual top-ups; Finish shop or confirm a receipt to
restock; use Confirm cooked or Day done to record food used. Day done covers all
planned food that day. Leftovers and essentials are reviewed for the next week,
and remaining pantry stock carries forward.

On a fresh setup, the guide opens after completion and its action leads to Plan.
Existing completion state remains intact. Returning users can replay the welcome
from Settings → Replay welcome & setup, or open How BasketBoss Works. Viewing
these instructions does not change stock or meal plans.

Saved weeks and Saved meals remain compact tab-style buttons above the dinner
plan. Both start closed. Switching preserves draft names and existing save/load
and delete actions. The pantry balance, Day done, manual Shop, receipt handling,
weighted Auto-fill, unit conversion and earlier AI/Premium features are inherited
from build 8. See BUILD_8_TESTFLIGHT.md for details.

## Mac upload

Use Xcode 26+, Node 22+ and CocoaPods. This fresh checkout preserves local changes
in previous folders:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build9-XXXXXX")" &&
git clone --depth 1 --branch testflight-build9-basketboss \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

In Xcode confirm Version 1.0 / Build 9, team Jason Batiste (J25UTUATD2), and bundle
ID uk.co.basketboss.app. Select Any iOS Device (arm64), then Product → Archive.
In Organizer choose Distribute App → App Store Connect → Upload. After Apple
processing, assign build 9 to the TestFlight group and use
release-assets/build9-what-to-test.txt for tester notes.

GitHub checks and unsigned archives do not perform the signed Apple upload.
Native CI for this source is tracked in PR #40. Local checks cover onboarding,
saved weeks, native packaging and browser layouts at 320, 390 and 768 px.

## Backend prerequisite

Cloud pantry sync still needs the matching Cloudflare API deployment and these
Supabase migrations, in order:

1. 20261102183209_receipt_auto_stock_policy.sql
2. 20261104074737_pantry_fractional_stock_balances.sql

The production audit was read-only. The welcome/layout changes do not deploy
those migrations or the API. Until rollout, incompatible cloud validation leaves
the locally recorded pantry update intact with a review notice.
