# BasketBoss 1.0 (31) — Verified current-purchase restoration

The user confirmed that the installed diagnostic version is Build 30. Its Restore action reports `StoreKit.StoreKitError:2` after Apple Account verification. This strongly corresponds to StoreKit's unknown error, rather than the cancellation code in the separate `SKErrorDomain`; the numeric code alone does not identify an authentication problem.

Build 31 reads Apple's verified current subscription entitlements before requesting a forced purchase-history sync. When an eligible current purchase is available, its genuine signed transaction is sent through the same server ownership and current-status checks. When none is available, the app retains the explicit `AppStore.sync()` recovery path. It does not ignore a failed sync or grant access from a local Premium flag.

Current entitlements can include a subscription in billing grace. The app leaves final expiry, grace, refund and revocation decisions to the server's fresh Apple status check. Unsupported products, unverified transactions and revoked local candidates cannot use the current-purchase path. Background delivery of unfinished transactions is unchanged.

Restore now distinguishes successful Apple restoration from an existing membership. Success requires an active verified Apple purchase and fresh server-confirmed Premium access. Empty results or a failed status refresh do not report a successful restoration. Typed unknown errors have a specific safe message and support code.

## Shopping and pantry matching

Finish shop adds the full confirmed purchase quantity to compatible existing stock rather than replacing it. Approved food aliases and compatible measurement units are normalized together. Fresh tomatoes, tinned tomatoes and tomato purée remain separate, as do meaningful dietary, species and food-state differences. Names, storage choices and saved metadata are retained. Ordinary purchases keep separate quantities from reduced and frozen lots so new stock does not inherit an older Use soon status.

Finish supports exact conversions such as 0.5 kg pasta plus 500 g becoming 1 kg, 1 litre milk plus 500 ml becoming 1.5 litres, and two reviewed 400 g tins plus 400 g becoming three tins. Unknown or conflicting pack contents, unconfirmed estimated weights and incompatible measurement types require review; they are kept separately instead of being silently treated as exact quantities. Fresh tomatoes and a name such as “Tomatoes (1 tin)” retain different food identities even when both amounts are in grams.

Previously saved keys that conflict with a surviving food label stop Finish for review without rewriting that pantry. Dated batches and newly bought undated stock retain their separate allocations through later shopping and receipt updates. Receipt and Finish credit guards prevent the same purchase being added twice. An ambiguous reduced receipt keeps existing lot annotations and displays a review message after saving. There are no database schema or component layout changes beyond that message.

## Verification and device check

The handoff records the exact tested source and results. Required checks include the complete automated suite, native Debug/Release builds, StoreKit restoration and ownership tests, Cook navigation, four strict keyboard cases and the unsigned Build 31 iPhone archive. A successful real-device Restore check is still required before submission sign-off.

After installing Build 31 from TestFlight, use the same BasketBoss and purchasing Apple Account. Tap Restore Purchases once and record the final message or support code. No new purchase is needed to exercise restoration of the existing subscription. Sandbox subscriptions remain subject to Apple's test renewal and expiry rules.

Apple references: [current entitlements](https://developer.apple.com/documentation/storekit/transaction/currententitlements), [forced sync](https://developer.apple.com/documentation/storekit/appstore/sync()).

## Mac upload

Use the verified tag `appstore-build31-restore-flow` when the release handoff confirms it exists:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build31-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --branch appstore-build31-restore-flow https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0 / Build 31, bundle `uk.co.basketboss.app` and signing team `J25UTUATD2`. Use Node 22+, CocoaPods and Xcode 26+. Archive and upload with your Apple signing account, then install from TestFlight and complete the device Restore check. See [submission steps and review notes](APP_STORE_SUBMISSION.md) before selecting the final build for App Review.
