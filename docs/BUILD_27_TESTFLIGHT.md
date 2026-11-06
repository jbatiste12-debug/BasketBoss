# BasketBoss 1.0 (27) — account switching and Apple purchase review

Signing out immediately invalidates account-bound membership and private recipe caches. Switching to a Free account starts at Free; responses or transactions from the previous session cannot re-enable Premium. Plans, pantry quantities and pending receipt data remain on the device. Restoring an Apple purchase still requires the original confirmed BasketBoss account and server verification.

The iOS membership page and Settings always show monthly and annual Apple subscription actions. Apple plans appear before the separate TestFlight beta option. Product loading, empty results, partial results, errors and timeouts are shown explicitly. Missing local price metadata does not remove the action: purchase preparation and native StoreKit retry the exact product ID. Apple must still return a valid product before displaying a payment sheet.

An explicit sandbox purchase exercise is available to server-allowlisted accounts even when beta or web benefits already exist. The server requires Sandbox and the test allowlist; production duplicate-purchase prevention and transaction ownership checks remain in place. This does not enable Apple billing or change the production test-account allowlist.

The configured Supabase project lacks public.basketboss_data. Cloud backup now reports a friendly paused state while preserving local data and login. The separately supplied migration creates the exact client contract with owner-only RLS, grants and cascading account deletion. It has not been applied to production. See [cloud backup setup](CLOUD_BACKUP_SETUP.md).

## Product IDs and verification

- Monthly: `uk.co.basketboss.premium.monthly`
- Annual: `uk.co.basketboss.premium.annual`

Run `node scripts/verify-apple-purchase-flow.mjs --output artifacts/apple-purchase-local-diagnostic.json`. The audit compares five code/fixture sources, and isolated simulations cover native purchase, server acknowledgement, transaction finishing, Premium state, 100-to-500 recipe hydration, sign-out and failures. StoreKit, backend replies and catalogue delivery in this portable diagnostic are fixtures, not real Apple transactions. No release mock mode is added.

The hosted StoreKit cancellation scenario now runs before a successful subscription can contaminate it. Simulator resets assert that old entitlements are gone, and the native test records cancellation status, no transaction, released busy state and product-ID retry. The new hosted result is needed to establish those actual StoreKit checks. App Store Connect products, agreements, notifications, live verification and signed physical-device testing remain separate checks.

For the first App Store submission, complete the monthly and annual subscription metadata and review screenshots, then attach both subscriptions to version 1.0 in App Store Connect. This does not replace real sandbox verification or other App Review requirements.

Portable verification: 2,643 local automated tests passed with zero failures, one platform skip and two existing TODOs. The isolated PostgreSQL migration/client checks passed, both membership views passed touch-browser checks at 320px and 375px, and native web verification passed with 935 files, 100 public recipes and no protected recipe bundle. Hosted native StoreKit results and real Apple sandbox transactions remain separate from these checks.

## Build on your Mac

~~~bash
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build27-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --branch testflight-build27-account-iap-review \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
~~~

Use Node 22+, CocoaPods and Xcode 26+. Confirm Version 1.0 / Build 27, team Jason Batiste (J25UTUATD2), bundle uk.co.basketboss.app. Choose Any iOS Device (arm64), then Product → Archive → Distribute App → App Store Connect → Upload. Use the next unused build number if 27 is already uploaded. Signing and upload require your Mac.
