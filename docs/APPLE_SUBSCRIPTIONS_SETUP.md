# Apple subscriptions rollout

The confirmed launch sells **£4.99/month and £39.99/year through Apple**. The **£1.99/month Founding Member offer stays web-only with its existing 25-place limit**. Existing web Founders sign into the same BasketBoss account to use Premium on iPhone without another charge. The native app must not steer users to web checkout for this offer.

This branch prepares StoreKit 2 purchases, Restore Purchases, Apple server verification and shared account entitlements. Creating products in App Store Connect does not activate billing. This document records configuration and release checks; it is not evidence that production keys, migrations, notifications or real purchases have been tested.

## Products recorded on 1 November 2026

The app bundle identifier is `uk.co.basketboss.app`. Prices below are the agreed UK prices; the app displays the localized price returned by StoreKit.

| Plan | Product ID used by StoreKit | Subscription Apple ID | Duration / UK price |
| --- | --- | --- | --- |
| Premium Monthly | `uk.co.basketboss.premium.monthly` | `6829460963` | 1 month / £4.99 |
| Premium Annual | `uk.co.basketboss.premium.annual` | `6829461623` | 1 year upfront / £39.99 |

Monthly and annual belong to one group with the internal reference name **Premium Monthly**; it can be renamed **BasketBoss Premium**. Equal Premium benefits should have the same subscription level. Annual is a yearly upfront payment, not a monthly payment with a 12-month commitment. Leave Apple Family Sharing off: BasketBoss's separately verified household partner feature is not Apple Family Sharing, and this implementation rejects Apple's `FAMILY_SHARED` transactions.

The two numeric IDs above identify subscription products. **Neither is `APPLE_APP_ID` or `APPLE_SUBSCRIPTION_GROUP_ID`.** The user confirmed **`APPLE_APP_ID=6829160611`** and **`APPLE_SUBSCRIPTION_GROUP_ID=22534568`** from [the Premium group URL](https://appstoreconnect.apple.com/apps/6829160611/distribution/subscription-groups/22534568). Configure those exact values in Cloudflare; the subscription product numbers are different.

Complete UK localization, price/availability, subscription group display name, review screenshot and review notes for **monthly and annual only**. Do not recreate or submit an Apple Founder product. First subscriptions must be submitted together with the new app version; do not submit the older build 1.0 (1), which has no StoreKit integration. The current submission candidate is build 1.0 (28); the user has confirmed that build 1.0 (27) is already uploaded to TestFlight. See [the App Store submission guide](APP_STORE_SUBMISSION.md).

## Founding Member stays web-only

The user deleted Apple product `uk.co.basketboss.premium.founder.monthly` (historical product Apple ID `6829462539`). Do not recreate or submit it. An ordinary discounted product can appear in Apple's subscription-management crossgrade options, which cannot enforce BasketBoss's shared 25-place eligibility before Apple charges. The confirmed scope therefore keeps the £1.99 Founding Member offer and its existing 25-place pool on the website. Apple products, server purchase/verification paths and migration support monthly and annual only; there is no Apple Founder enablement flag or reservation implementation. Existing verified web Founders retain Premium access on iPhone without buying again.

Turn off **Streamlined Purchasing** when Apple permits it, and do not configure promoted purchases, contingent pricing, win-back offers or offer/promo codes that bypass BasketBoss account preparation. Apple's setting requires the latest **approved** binary to implement `PurchaseIntent`; it covers supported App Store merchandising and explicitly does not cover all code redemptions. It must not be presented as a general guarantee against subscription-management crossgrades. See [Apple's subscription management guidance](https://developer.apple.com/app-store/subscriptions/), [group setup](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/) and [Streamlined Purchasing](https://developer.apple.com/help/app-store-connect/manage-subscriptions/manage-streamlined-purchasing).

## Cloudflare Pages configuration

Use the existing production Pages project and its existing `BILLING_DB` D1 binding. Keep all existing Supabase, Paddle, household, session and private-catalogue bindings/flags. Do not deploy a new root Wrangler configuration that discards Dashboard-managed bindings.

The pinned `@apple/app-store-server-library` uses Node crypto, X.509 verification and HTTP. Set the Pages Functions compatibility date to **`2026-10-01`**, matching local runtime verification. Cloudflare enables Node.js compatibility by default for dates on or after `2026-08-04`; an explicit `nodejs_compat` flag is optional for these dates. Remove explicit `no_nodejs_compat` or `no_nodejs_compat_v2` opt-outs. See [Cloudflare’s compatibility update](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/). The official library is loaded lazily inside an Apple request: its dependency initializes random state, which Workers forbid during global-scope startup. Keep that request-time boundary when editing imports. A successful JavaScript bundle alone does not establish a working Worker: smoke-test cold startup with Apple disabled, the first enabled Apple request, and live Apple HTTP/OCSP requests after deployment. Required egress includes Apple's App Store Server API and the certificate revocation endpoints used by the official verifier.

Apply the additive **`sql/basketboss_apple_subscriptions_20261101.sql`** migration to the D1 database bound as `BILLING_DB` before enabling billing. This is **D1/SQLite**, not Supabase/Postgres. It creates Apple account-token, subscription, notification and schema-version tables. It does not change existing Paddle entitlements or the web Founder pool. The existing account-deletion/household Supabase rollout prerequisites still apply.

Configure server-side variables:

| Variable | Value / purpose |
| --- | --- |
| `APPLE_BILLING_ENABLED` | `true` only after configuration and deployment checks |
| `APPLE_ENVIRONMENT` | `Production` for the production deployment |
| `APPLE_APP_ID` | `6829160611` — BasketBoss app ID, not a subscription ID |
| `APPLE_SUBSCRIPTION_GROUP_ID` | `22534568` — verified Premium group ID |
| `APPLE_ISSUER_ID` | Issuer UUID associated with the In-App Purchase key |
| `APPLE_KEY_ID` | The key's 10-character ID |
| `APPLE_MONTHLY_PRODUCT_ID` | Optional; defaults to the exact monthly Product ID above |
| `APPLE_ANNUAL_PRODUCT_ID` | Optional; defaults to the exact annual Product ID above |
| `APPLE_ALLOW_SANDBOX` | `true` only when testing/App Review sandbox accounts are configured |
| `APPLE_SANDBOX_USER_IDS` | Comma-separated, confirmed BasketBoss Auth user UUIDs allowed to test |

Store **`APPLE_PRIVATE_KEY` as an encrypted Cloudflare secret** containing the In-App Purchase `.p8` private key, with real PEM newlines (escaped `\n` is also supported). Generate the key in App Store Connect's In-App Purchase key section; use its matching key ID and issuer ID. Do not paste the private key into chat, commit it, put it in an app environment file or bundle it in the iOS app. This is a server credential; an Apple product ID, shared secret or signing certificate is not a replacement. See [Apple's server library](https://apple.github.io/app-store-server-library-node/) and [generating In-App Purchase keys](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/generate-keys-for-in-app-purchases).

The secret name is exactly `APPLE_PRIVATE_KEY`, with no `.p8` suffix. Its value is the complete PEM text, including the BEGIN/END PRIVATE KEY lines, rather than a filename or key ID. On Mac, drag a Notes attachment onto the Desktop, then use Open With → Other → TextEdit (Enable: All Applications if needed) to copy its contents directly into Cloudflare.

`APPLE_BUNDLE_ID` is optional and may only equal `uk.co.basketboss.app`. Missing/mismatched credentials or schema fail closed. Turning Apple billing off stops Apple access/purchases; do not use that as a routine rollback after customers have paid. Preserve verification/restore for existing purchasers while disabling new-sale availability at Apple if needed.

For isolated staging, `APPLE_ENVIRONMENT=Sandbox` still requires the explicit user allowlist. With Production plus `APPLE_ALLOW_SANDBOX=true`, only allowlisted users select the Sandbox namespace. These must be dedicated test/review accounts, not actual paid Production customers. Sandbox never inherits Premium to household partners. Apple subscriptions never allocate web Founder places. Remove test-only users/flags when no longer required, accounting for App Review's sandbox purchases.

## Notifications and ownership

In App Information, set **Version 2** Production and Sandbox Server Notifications URLs to:

```text
https://basketboss.co.uk/api/apple/notifications
```

Configure both explicitly. Use Apple's Request a Test Notification and Check Test Notification Status endpoints to verify delivery and a successful endpoint response. A signed TEST notification proves notification routing, not subscription entitlement reconciliation. See [Apple's notification URL setup](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/enter-server-urls-for-app-store-server-notifications).

The server pins Apple's root certificate and uses the official library's signature/certificate checks, exact bundle/Product ID/group/environment claims and a fresh App Store Server API status. A historic signed receipt cannot restore an expired/refunded subscription. Production and Sandbox records are separate. The server mints an opaque `appAccountToken` for the authenticated BasketBoss user; restoration must use the original BasketBoss account. An incoming notification cannot assign an unknown original transaction to a new account. The local StoreKit test environment is rejected by the real backend.

The app finishes a StoreKit transaction only after authenticated server acknowledgement. Interrupted purchases can be retried from unfinished/current transactions after relaunch. Cancellation of auto-renew retains access through the verified paid period. Expiry, billing retry without grace and refund/revocation remove it. Apple status is refreshed after 60 seconds; notification delivery normally shortens that interval, but access is not claimed to change instantaneously if notifications fail. Apple verification failures after the refresh deadline deny cached access until verification recovers.

Existing verified Paddle/household Premium suppresses an additional Production Apple purchase. Explicit purchase testing remains available only when the server authorizes the signed-in Sandbox test account. The shipping membership screen offers Apple plans and Restore Purchases, with no TestFlight beta activation control. An existing unfinished Paddle checkout also blocks Apple preparation until completed or safely cancelled. The website blocks another checkout for active Apple Premium. These checks do not claim an atomic lock against simultaneous *new* purchases in two different providers; do not test by racing real customer payments.

Deleting a BasketBoss account erases its Apple linkage and retains only the existing hashed deletion barrier against late events. **BasketBoss cannot cancel Apple billing for the user**; the deletion flow must clearly offer Apple subscription management and explain that deleting an account does not cancel an Apple subscription. Never reinstate linkage automatically for a recreated account. Existing Paddle account-deletion handling remains in place independently.

## Validation and release

Portable checks:

```sh
npm ci
npm run build:native
npm run ios:verify
npm run test:native
node --test --test-isolation=none tests/basketboss-apple*.test.mjs
```

The workflow also verifies real Cloudflare `workerd` cold startup, Node crypto/X.509 verification, tamper rejection and production rejection of a generated test certificate root (compatibility date `2026-10-01`, supported by the pinned local runtime). This does not contact Apple or test OCSP networking.

The Apple workflow also compiles Debug/Release on macOS and exercises real StoreKit calls using the local `.storekit` fixture, including prices, account tokens, purchase/restore, pending approval, cancellation and finish-after-ack. Release excludes the fixture. These are local StoreKit tests: **they do not prove Apple sandbox server credentials, notification delivery or Production billing**. Record actual workflow results rather than inferring them from this guide.

Recorded verification: [run 41326736655](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/41326736655) passed on 1 November 2026. The portable suite passed 752 tests with zero failures and two existing TODOs. The hosted XCTest run on iOS 26.2 passed all 12 purchase/restore/ownership/cancellation/pending/acknowledgement checks; Debug/Release builds, Release fixture/framework exclusion and Cook navigation also passed. [Diagnostics](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/41326736655/artifacts/13091797015). These results explicitly report `productionBillingTested=false` and `backendPremiumGranted=false`.

Before selecting build 1.0 (28) for App Review, validate on a signed physical iPhone/TestFlight using disposable, allowlisted BasketBoss accounts and Apple's sandbox:

- Monthly and yearly localized products load; the Apple sheet charges the selected test product and the server grants the correct account only.
- Relaunch during/after purchase, pending Ask to Buy, cancellation, duplicate taps, offline verification and Restore Purchases preserve transactions safely and recover once online.
- Reinstall/restore on the original BasketBoss account works; a different account cannot take ownership.
- Renewal, auto-renew cancellation, expiry, billing retry/grace, refund/revocation and delayed/replayed notifications update server access correctly.
- A real web subscriber and accepted household partner get their existing Premium without an Apple charge; Sandbox membership never grants partner access.
- Exercise Apple's actual subscription management, outside-app purchase entry points and original-account deletion/recreation cases. Confirm the deleted Founder product cannot be purchased or selected as a crossgrade. A web Founder receives existing Premium with no purchase buttons or web-checkout promotion in the native app.
- Verify Apple Premium can load the authenticated private recipes, AI/receipt features and eligible Production household benefits under existing session/deletion controls.
- Verify account creation/email confirmation, password recovery, account deletion, privacy/terms, support contact and App Store privacy labels reflect Apple transaction/account data processing. Do not declare that Paddle alone processes in-app payments.

Give App Review a disposable confirmed BasketBoss account that is allowlisted for sandbox purchases, clear navigation to Premium/Restore/Delete Account, and accurate review notes. Do not grant arbitrary client-selected tiers to bypass server verification. Archive/validate/upload from Xcode only after these release checks pass and the product metadata is ready.
