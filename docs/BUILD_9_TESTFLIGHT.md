# BasketBoss 1.0 (9) — welcome and compact planning tools

Build 9 includes all build 8 functionality plus the kitchen-balance welcome slide.
The illustrated release source is `testflight-build9-illustrated` on `fix/confirmed-cook-pantry` (PR #40).
The earlier build 8 tags remain unchanged.

The welcome slide uses an illustrated pantry between a shopping basket and a
cooking pot, four compact icon cards and a weekly-review banner. It fits a
390 × 844 phone viewport without scrolling; the main content can scroll on
shorter phones while the primary action stays visible. Motion stops after three
cycles and respects Reduce Motion.

The welcome tour explains the pantry like a bank account: planning is the budget,
At home is the balance, shopping tops it up, confirmed cooking deducts meal
ingredients, and a weekly review updates leftovers and essentials. The existing
completion state remains intact; returning users can replay the tour from
Settings → Replay welcome & setup. The slide does not change stock or plans.

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
git clone --depth 1 --branch testflight-build9-illustrated \
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
