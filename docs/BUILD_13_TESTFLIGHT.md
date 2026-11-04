# BasketBoss 1.0 (13) — personal meal preferences and weekly kitchen review

Build 13 includes Build 12's account and swipe improvements, plus onboarding answers that carry into the app:

- Vegetarian, Vegan, Gluten-free and Dairy-free constrain Auto-fill, pantry suggestions and Discover using the listed ingredients. Neither pantry scores nor rotation resets relax a dietary choice. If too few suitable dinners remain, some days stay open with a clear explanation.
- Cook’s library and AI drafts use the same dietary rules. AI requests carry the household serving count (up to the existing eight-serving limit); conflicting input/output is rejected and changing preferences invalidates an in-flight draft.
- Household size and shopping region keep using the existing servings and regional-price controls. Planning goals can favour lower estimated meal costs, pantry ingredients and recipes not recently planned; they never override dietary eligibility.
- Plan → Meal preferences shows the active choices and lets people change them. Existing dinners are preserved. Existing completed survey answers are imported once; later edits and explicit clearing take precedence.
- At home gains a weekly kitchen check for reviewing what remains and choosing restocks. Food and household stock keep their existing guarded saves, cooking deductions and purchase reconciliation.

The first import of a completed legacy device-wide survey binds it to the current account or guest. It is not imported again into another account. Preferences travel in the existing plan backup; no Premium or account-verification rules change.

## Open in Xcode

Use Node 22+, CocoaPods and Xcode 26+ on your Mac:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build13-XXXXXX")" &&
git clone --depth 1 --branch testflight-build13-meal-preferences \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0, Build 13, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Select Any iOS Device (arm64) → Product → Archive, then Distribute App → App Store Connect → Upload. Use the next unused build number if 13 has already been uploaded.

PWA publication does not update an installed TestFlight app. These client changes require a new iOS build. Portable checks and mocked browser checks do not sign or upload a binary or verify live email delivery.

## Validation

- Full regression suite: 2,153 cases; 2,146 passed; zero failures; five skipped and two TODOs.
- Native packaging and portable iOS verification passed with 924 assets and 100 free recipes, without bundling the private Premium catalogue.
- Browser checks exercise the actual interface with synthetic state and mocked HTTP: onboarding migration and editable diet pills, a confirmed seven-dinner Vegetarian week, dietary Discover results, remaining-stock edits, Used up, manual restock without pantry credit, preserved household targets and Continue to Shop.
- Controller tests cover canonical/count/regional conversion, unknown-unit preservation, account and stale-state guards, completed or externally changed restock requests, receipt settlement and rollback on failed saves.
- AI tests use mocked provider responses. They verify input/output dietary gates, household servings, preference changes in flight and recipe-bound image tickets. Server bundling with the shared dietary helper passed.

Tester notes: [build13-what-to-test.txt](../release-assets/build13-what-to-test.txt).
