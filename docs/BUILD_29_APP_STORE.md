# BasketBoss 1.0 (29) — Restore diagnostics candidate

Build 28's real monthly Apple Sandbox purchase, Premium activation, retained access after reopening and Premium recipe access were confirmed by the user. Restore Purchases still fails in `AppStore.sync()` after Apple Account verification. The existing bridge hides the underlying Apple error, so its generic message cannot identify the cause.

Build 29 distinguishes documented restore cancellation from failure, identifies network errors, and shows a safe support code made only from known error domains and numeric codes. It preserves receipt-verification failures across refreshes and keeps native restore failure details visible even when an existing Premium membership is active. Missing subscription products and failed product lookups also have separate safe messages.

Successful restoration still follows Apple's sync, verified native transaction collection, server ownership and current-status verification, acknowledgement, then transaction finishing. No local Premium override, cached-entitlement fallback or account relinking is introduced. No component structure or visual layout changes are included.

## Required verification

Run the full automated suite with PostgreSQL-backed checks, compile native Debug and Release, verify the unsigned Build 29 iPhone archive, exercise the hosted StoreKit tests including restore error privacy and cancellation, and retain the existing Cook and keyboard checks. A release tag is created only after the candidate's required checks pass.

After installing Build 29 from TestFlight, use the same BasketBoss and purchasing Apple Account. Tap Restore Purchases once. If it fails, record the displayed support code; no password, receipt or signed transaction is needed. A successful real-device restore remains unverified until this check completes. Sandbox success is not a Production billing test.

## Mac upload

Use the verified `appstore-build29-restore-diagnostics` tag when the release handoff confirms it exists:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build29-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --branch appstore-build29-restore-diagnostics https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0 / Build 29, bundle `uk.co.basketboss.app`, team `J25UTUATD2`. Use Node 22+, CocoaPods and Xcode 26+. Archive and upload with your Apple signing account. Signing, TestFlight installation and the real-device restore check cannot be performed by the Linux workspace.

The iPad marketing screenshots remain representative: the app's feature layouts are unchanged. See [submission steps and review notes](APP_STORE_SUBMISSION.md) after successful native verification and the device restore check.
