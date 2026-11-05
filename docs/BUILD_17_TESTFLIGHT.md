# BasketBoss 1.0 (17) — Business lifecycle audit

Build 17 includes Build 16 and corrects stock, purchases, receipt spending and account backup behaviour across Plan → At home → Shop → Cook. It preserves the existing visual design and Premium entitlement checks.

## What changed

- Meal changes reconcile against canonical pantry quantities. Whole peppers remain measured produce; culinary pepper remains a staple. Ambiguous historical balances stay intact for review rather than being borrowed for a different ingredient. Confirmed cupboard stock no longer adds duplicate staple demand.
- Household checkbox and partial purchases record what was bought without increasing stock before Finish shop. Finishing transfers purchases once, keeps unticked requirements, and leaves existing freezer portions separate from fresh purchases.
- Receipts can reconcile against a verified finished trip. Food and household credit share an atomic journal; duplicate receipt lines and retries cannot add stock twice. Ordinary and reduced payments replace covered trip estimates rather than adding another charge.
- Ordinary purchase costs survive Finish shop. Money calculations use bounded integer cents. Reduced purchases affect this week's spending without changing saved standard prices. Priced receipt lines with uncertain quantities retain their payment evidence and flag uncertainty without inventing physical stock.
- Cooking uses urgent unfrozen stock first, preserves freezer allocations and floors balances at zero. Exhausted reduced stock loses its urgency. Meal completion and Day done remain replay-safe; Day done includes that day's planned dinners, lunches and desserts, with leftovers protected from double deduction.
- Clearing a plan and beginning a new week preserve pantry stock and saved prices. US rollover follows the device calendar; UK and Channel Islands rollover follows London time. Legacy completion records remain recognised without blocking a genuinely new week.
- The first account claim preserves guest stock and purchases. Subsequent account switches isolate plans, pantry balances, prices and shopping ledgers. Account backup now includes the kitchen and shopping state alongside the plan. Empty devices load their account copy before uploading; differing local stock is kept for review. Concurrent edits, failed storage writes and uncertain receipt confirmations cannot silently overwrite it.

## Verification

See [business-lifecycle-audit.md](business-lifecycle-audit.md) for final test counts, reproduction cases and remaining platform checks. The UK/US ingredient audit covers all 100 recipes and 730 ingredient lines. Application browser checks use a 375px viewport, synthetic accounts and mocked HTTP. Database tests use isolated PGlite; no production data, emails, paid AI calls or subscriptions are used.

No database migration is required for these changes. Complete account backups use the existing account JSON record and validated, actor-scoped data. Existing receipt ownership, receipt verification, Premium paywalls and receipt review remain enforced.

## Open the release in Xcode

Use Node 22+, CocoaPods and Xcode 26+ on your Mac. A fresh folder avoids overwriting your local signing settings:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build17-XXXXXX")" &&
git clone --depth 1 --branch testflight-build17-business-audit \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0, Build 17, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Select **Any iOS Device (arm64)** → **Product → Archive** → **Distribute App → App Store Connect → Upload**. Use the next unused build number if 17 has already been uploaded.

The PWA receives the merged deployment. Installed TestFlight copies receive these client changes after you upload the new signed build from your Mac.

Tester notes: [build17-what-to-test.txt](../release-assets/build17-what-to-test.txt).
