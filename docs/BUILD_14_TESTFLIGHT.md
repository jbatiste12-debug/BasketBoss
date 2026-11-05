# BasketBoss 1.0 (14) — clearer Weekly essentials and Shop

Build 14 includes Build 13 and simplifies the handoff from At home to Shop:

- Tap a Weekly essentials thumbnail or Add to review the total needed, the amount already at home, the unit and the subcategory. The preview shows the shortfall. **Confirm & update Shop** saves it immediately; there is no second pantry acceptance step.
- A compact confirmed list states **On your Shop list**, **Already at home** or **Amend to restock**, with Amend and Delete actions. Delete removes the weekly request and preserves recorded stock and purchase history.
- Weekly essentials use their saved subcategories in the Shop overview, full list, Begin shop and copied checklist. Search, To buy and Bought filters retain those groups and the original purchase controls.
- The legacy cupboard thumbnail picker is no longer created in Shop. Food quantities remain editable in At home.
- Reviewed receipt prices appear as a small historical **Last paid** line beneath existing Kitchen items, showing the pack, shop and date. There is no additional Shop row or price card. Prices remain scoped to the current account and region; eligible regular prices inform future estimates, with shop, brand and pack matching preserved.
- Confirmation keeps the existing account, stale-state, receipt, stock and purchase safeguards. Confirming an essential does not mark it bought or credit pantry stock. The Shop checkbox records buying it; Finish shop follows the existing stock-credit flow.

The regular Premium paywalls remain in place. No membership grants, authentication settings or email delivery settings change in this build.

## Open in Xcode

Use Node 22+, CocoaPods and Xcode 26+ on your Mac:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build14-XXXXXX")" &&
git clone --depth 1 --branch testflight-build14-shop-confirmation \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0, Build 14, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Select **Any iOS Device (arm64)** → **Product → Archive**, then **Distribute App → App Store Connect → Upload**. Use the next unused build number if 14 has already been uploaded.

PWA publication does not update an installed TestFlight app. These client changes require a new iOS upload. Portable verification and browser checks do not sign or upload the binary.

## Validation

- Full regression suite: 2,212 cases; 2,207 passed; zero failures; three skipped and two TODOs. The two receipt PostgreSQL cases ran against isolated PGlite, rather than being skipped.
- Native packaging and portable iOS verification passed with 929 assets and 100 free recipes. The private Premium catalogue remains excluded from the bundle.
- The household receipt metadata migration was applied to `basketboss-auth`. A live read-only query verified the metadata, existing auto-stock readiness, empty function search path and service-only execution. No stock balances or receipt payloads were changed. The migration also passed an idempotence and stock/history preservation test in isolated PostgreSQL.

The confirmation and grouping tests cover shortfalls, zero-to-buy amounts, new and existing essentials, container amounts, repeated taps, cancellation, stale accounts, duplicate names, purchase settlement, rollback, soft removal and preserved stock/history. They also cover default/custom subcategories, missing metadata, direct Shop launches, copied lists, search and purchase controls.

Browser checks use the actual mobile interface with synthetic state and mocked HTTP. They exercise thumbnail → Cancel, thumbnail → Confirm, Amend without duplicates, custom Add, Shop overview, full list, Begin shop, removal and the absence of the legacy Shop picker. No real authentication emails, purchases or paid AI calls are made.

Kitchen price checks cover food and household historical labels, multipack prices, explicit offers, US display units, invalid data and account/region isolation. Receipt learning uses the newest 21 matching regular purchases rather than the oldest 21. Browser checks also verify that historical labels add no Shop rows.

Tester notes: [build14-what-to-test.txt](../release-assets/build14-what-to-test.txt).
