# BasketBoss 1.0 (15) — Premium yellow-sticker and reduced-food tools

Build 15 includes Build 14 and adds:

- A compact, collapsed Yellow sticker helper below the selected supermarket in Shop and Begin shop. UK, Guernsey and Jersey schedules use the supplied typical windows, with Sunday and London daylight-saving handling. They are estimates, not retailer guarantees.
- Premium-only Spotted and Not yet reports. The backend checks the verified membership, account and session, generates timestamps, enforces cooldown and duplicate protection, and returns only region/chain aggregates. Live sightings expire after 90 minutes. Offline reports say On this device.
- Bought reduced controls in the purchase drawer and quick-add form. Actual paid prices belong to the purchase and shopping trip. This week's budget uses those prices without replacing the usual price for future weeks. Partial receipts preserve uncovered purchase history and do not count the same cost twice.
- Use soon (Reduced) badges and first-row sorting inside Fridge and Cupboard. Move to Freezer preserves quantities, clears urgency and keeps frozen portions separate from later fresh purchases. Normal pantry edits and deductions retain their existing behaviour.
- The strongest pantry matching bonus for available Use soon food in pantry Auto-fill. This is a preference, not a filter, and cannot override dietary eligibility or reserve stock more than once.
- Updated landing page, Premium comparison/paywall descriptions, tutorials, walkthrough and privacy notice.

The helper follows the existing chain-level supermarket selector. Reports for one chain in a region do not guarantee availability at every branch. Ordinary promotions, loyalty discounts and nutritional descriptions such as reduced salt are not automatically treated as perishable reduced food. Receipt annotations require review; old receipts do not create fresh Live sightings.

New Premium actions are gated on the current verified membership. Existing stock and recorded spending remain intact when membership changes. Receipt annotations travel with the existing Kitchen records on the device; the crowd reports use the authenticated Supabase service.

## Open in Xcode

Use Node 22+, CocoaPods and Xcode 26+ on your Mac:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build15-XXXXXX")" &&
git clone --depth 1 --branch testflight-build15-reduced-food \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0, Build 15, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Select **Any iOS Device (arm64)** → **Product → Archive**, then **Distribute App → App Store Connect → Upload**. Use the next unused build number if 15 has already been uploaded.

Publishing the PWA does not update an installed TestFlight app. The client changes require a new iOS upload. Portable packaging checks do not sign or upload the binary.

## Validation

- Full regression suite: 2,299 cases; 2,296 passed; zero failures; one skipped and two TODOs. Receipt, report, shared-shopping and account-deletion PostgreSQL checks ran using isolated PGlite.
- Native packaging and portable iOS verification passed with 934 assets and 100 free recipes. The private Premium catalogue is not bundled.
- The report migration was applied to `basketboss-auth` as `20261105091222_yellow_sticker_reports`. Read-only production queries verified row-level security, service-only access, an empty initial report set and valid empty regional aggregates. No artificial sightings were published.

Automated checks cover regional schedules and expiry, current Premium and account guards, ordinary-offer exclusions, canonical ingredient merging, purchase and receipt reconciliation, freezer conservation, rollback, replay protection, and dietary-safe Auto-fill priority. The Supabase report migration is tested in isolated PostgreSQL; production verification reads aggregate readiness and permissions without posting artificial sightings.

Browser checks exercise the actual 375px interface with synthetic state and mocked HTTP: Premium and Free banners, Spotted, quick reduced purchase, Finish shop, Use soon, freezer transfer, baseline price protection and membership loss. Separate checks cover 390px and desktop landing/help layouts. No real authentication emails, purchases or paid AI calls are made by these checks.

Tester notes: [build15-what-to-test.txt](../release-assets/build15-what-to-test.txt).
