# BasketBoss on Google Play

The Android package is **`uk.co.basketboss.app`**, named **BasketBoss**, with
`versionName "1.0.4"` and `versionCode 4`. It uses Capacitor Android **8.6.0**,
minimum Android API 24, and compile/target API 36. The package name must match
your Play Console app. Increase `versionCode` for every later uploaded bundle.

Build 4 includes the merged automatic shared-plan refresh and account-deletion fixes, alongside an Android-only Google Play Billing bridge and membership flow.
An already linked household now loads its saved dinners on a fresh device even
before that device has a local plan record. Dinner and serving changes then
refresh both ways while the apps are open, without pressing Sync.
Purchases remain unavailable until the server, catalogue and account are
configured. New live sales require the additional checkout and shared purchase-intent
gates described below; they are off by default. Switching off new sales does not
disable configured restore, verification, management or an independently verified
existing membership. Prices and eligible trial offers come from Google Play;
they are not hardcoded in the app. Existing eligible Premium accounts should use their current
membership rather than buy another subscription. Android does not open Paddle or
iOS StoreKit. The new billing tables and server settings are not applied by a
local build or by this guide; activation requires a separate reviewed deployment.

## Build on your Mac

Use a checkout containing this Android setup. Install Node.js 22 or newer,
**JDK 21**, and Android SDK Platform 36, Build Tools 36.0.0 and Platform Tools.
Android Studio's SDK Manager can install those SDK packages. Set `JAVA_HOME` to
your JDK 21 and `ANDROID_HOME` to your SDK directory; the usual Mac SDK location
is `$HOME/Library/Android/sdk`. The [Capacitor setup guide](https://capacitorjs.com/docs/getting-started/environment-setup)
describes the Android tools. Builds below run entirely in Terminal.

This is an update to the existing Play app. Reuse your original upload key at
`$HOME/.basketboss-android/basketboss-upload-key.jks` and its existing
`basketboss-upload` alias. The launcher stops if that key is missing; restore it
from your private backup before building. Do not generate a replacement key for
this update. Keep the key and its passwords private. The [Android signing guide](https://developer.android.com/studio/publish/app-signing)
explains how your upload key differs from Google's Play App Signing key.

From the repository root, prepare signing and build the signed bundle:

```bash
npm ci --no-audit --no-fund && node scripts/android-signing.mjs --interactive --keystore-file "$HOME/.basketboss-android/basketboss-upload-key.jks" && npm run android:sync && npm run android:verify && (cd android && ./gradlew bundleRelease) && node scripts/verify-android-aab.mjs --bundle android/app/build/outputs/bundle/release/app-release.aab --require-signed
```

The signing helper asks for passwords privately, confirms the alias, and writes
`android/keystore.properties` with restricted permissions. Gradle reads its
`storeFile`, `storePassword`, `keyAlias` and `keyPassword` properties. Both that
file and keystores (`*.jks` / `*.keystore`) are ignored by Git; never commit them
or paste them into chat. Your private key remains outside the repository.

Upload this **signed** file to Play Console:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

Run `npm run android:sync` for future Android web-asset updates. It prepares a
separate Android catalogue-700 bundle and syncs Android only. The iOS project,
root Capacitor configuration and existing iOS native packaging path stay intact. The
convenience launcher is [prepare-android-mac.command](../release-assets/prepare-android-mac.command).

The bundle keeps all existing recipe pictures unchanged in a `recipe_images`
**install-time asset pack**. The base web assets are about 13 MB and the image
pack about 491 MB. Play installs both together, retaining offline image access.
An ordinary `assembleDebug` APK does not establish that the pack is installed:
test an AAB-derived installation through Play Internal testing or bundletool.
The final verifier downloads the official bundletool 1.18.3 JAR into a temporary
directory, checks its pinned SHA-256, validates both module manifests and the
actual bundled image bytes, and requires signed payloads for upload builds.

## Build in GitHub Actions instead

Open **Actions → Build Android App Bundle → Run workflow**.

- Leave **signed** off for compile verification. The artifact is labelled
  `BasketBoss-Android-UNSIGNED-CI-1.0.4-code4`; it cannot be uploaded to Play.
- For a signed bundle, first add the following repository Actions secrets, then
  run the workflow with **signed** on. Missing secrets stop the signed build.

| Actions secret | Value you supply privately in GitHub |
| --- | --- |
| `BB_ANDROID_KEYSTORE_BASE64` | Base64 encoding of your existing upload keystore |
| `BB_ANDROID_STORE_PASSWORD` | Its keystore password |
| `BB_ANDROID_KEY_PASSWORD` | Its signing-key password |
| `BB_ANDROID_KEY_ALIAS` | `basketboss-upload`, or your existing registered alias |

On your Mac, copy the encoded keystore directly to the clipboard, then paste it
into the named GitHub secret:

```bash
base64 < "$HOME/.basketboss-android/basketboss-upload-key.jks" | tr -d '\n' | pbcopy
```

The workflow creates temporary signing files, runs `./gradlew bundleRelease`,
uploads only the `.aab`, and removes its temporary signing material. Download the
`BasketBoss-Android-SIGNED-1.0.4-code4` artifact and extract `app-release.aab` for
manual upload. It does not create an upload key, upload to Play Console, or
release your app. No Play Console service-account key is required for this build.
It runs the Node checks and Android JVM unit tests before bundling. This workflow
does not install Chromium: browser-only Node tests report skips when it is
unavailable and need their separate browser run. It does not exercise a real
Android phone or a Play-delivered installation.

## Connect the app and run Closed Testing

The Android API-origin/auth-transport changes also need their reviewed server
deployment before real Android sign-in and account requests can work. A
successful local or cloud compilation does not deploy those server changes or
prove production login. Existing server entitlement checks remain authoritative.

Start with **Testing → Internal testing** and upload the signed `.aab`. Follow
the Console's Play App Signing setup, add your test account and install from its
opt-in link on an Android phone. Once the phone checks below pass, promote the
same bundle to **Testing → Closed testing** and configure your tester group.
Internal testing does not count towards the new-personal-account rule, which
currently requires at least **12
testers opted in continuously for 14 days** before you can apply for production
access; meeting that threshold is not automatic production approval. Confirm
the requirement shown for your account and [Google's personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
before scheduling the closed test.

For **App content → App access**, provide a dedicated, working **email/password**
reviewer account if any features require sign-in. Give it legitimately authorised
access to the features you ask Google to review. Supply credentials privately in
Play Console, with concise sign-in instructions; an Apple-only account is not
usable for this Android fallback. This repository does not create accounts or
grant reviewer Premium access.

Before promoting the closed test, check on an Android phone:

1. Header, keyboard, bottom tabs and expanded sheets clear the camera cutout,
   gesture area and three-button navigation bar.
2. Email/password sign-in, sign-out and account recovery work against the
   deployed server; unrelated browser origins cannot use the Android transport.
3. Plan, Pantry and Shop work normally, including 500 g needed with 250 g at
   home leaving a 250 g gap. Use test data for purchase/cooking checks.
4. Existing eligible membership is recognised; Free users get the honest
   Android purchase-unavailable explanation, with no Paddle checkout.


## Google Play subscriptions: setup and staged activation

The Android bridge uses Google's pinned Billing library 9.1.0. It has no npm
billing dependency and does not modify the iOS StoreKit implementation. The new
server provider verifies purchase tokens against Google's Developer API, binds
purchases to an opaque ID for the authenticated BasketBoss account, persists the
verified result in D1, and acknowledges purchases server-side. Native purchase
callbacks, browser flags and localStorage never grant Premium.

Start with **licence testing**. Production checkout is a separate, default-off
activation after the release checks pass. Purchase preparation uses a durable
account-scoped reservation across Apple, Google Play and Paddle when the shared
purchase-intent feature is enabled. The server must authorise starting that
reservation before the native sheet opens. Pending or uncertain attempts remain
held for reconciliation; a timeout, app closure or empty purchase query cannot
release them. Existing nonterminal Google purchases must also be resolved before
another subscription. This coordinates updated BasketBoss clients; it cannot
prevent a subscription started externally or by an older client outside this
protocol. No live product, price, offer, database migration or customer record
is changed by building the app. See [the parity audit](IOS_ANDROID_BILLING_PARITY.md)
for the compatibility and rollout limits.

1. Complete the Google Play payments profile directly in Play Console.
2. Upload/publish the billing-enabled build to the Internal testing track. The
   original code-1 build lacked Billing; Google may keep product configuration
   unavailable until a billing-enabled version is in a track.
3. Agree the catalogue and prices before creating or activating products. The
   release catalogue below is one Premium product, `basketboss_premium`, with
   `monthly` and `annual` auto-renewing base plans. If offering the same eligible
   seven-day trial as iOS, create an offer named `seven-day` under each plan.
   These are exact identifiers to create/configure, not evidence of existing
   Console objects. Prices, countries and trial activation remain owner decisions.
   Android displays Play-returned localized prices and eligible pricing phases;
   it never substitutes a made-up price or trial. The UI prefers an eligible trial for each billing period; a regular paid base
   plan appears when Play does not return an eligible introductory offer.
4. Add the Google account used by the Android device to both Internal testers
   and the developer account's **License testing** list. Use Google's test
   payment instruments. Internal testing alone does not prevent real charges.
   Sign into a separate verified Free BasketBoss account for purchase tests;
   an existing Premium/owner account should be told no further purchase is
   needed. Add that BasketBoss user ID to the server test allowlist.
5. Create/link a Google Cloud service account, enable the Google Play Android
   Developer API and grant only the BasketBoss app's required purchase-read and
   subscription-management permissions in Play Console. Put its private key
   directly into the server's secret settings; never paste keys into chat or
   commit them. Reading and acknowledging subscriptions require API access;
   no refund/revoke action is automated by this integration.
6. Configure real-time developer notifications: a Pub/Sub topic allowed to
   receive Google Play notifications, an authenticated push subscription, and
   the exact push service-account identity and audience. The endpoint verifies
   Google's OIDC signature and claims, then fetches current purchase state;
   notification fields alone never grant access.
7. Review and apply `sql/basketboss_google_play_subscriptions_20261121.sql` to
   the existing **Cloudflare D1 BILLING_DB**. Also review/apply
   `sql/basketboss_purchase_intents_20261121.sql` before enabling shared purchase
   coordination or live checkout. Then deploy the reviewed server changes.
   These are not Supabase migrations; they do not alter existing Apple/Paddle
   provider rows. No migration is applied by these instructions or a native build.

Required server settings (keep all purchase flags disabled until setup passes):

| Setting | Meaning |
| --- | --- |
| `GOOGLE_PLAY_BILLING_ENABLED` | Explicit feature gate; default off |
| `GOOGLE_PLAY_BILLING_MODE` | Start with `test`; change to `live` only after the production checklist |
| `GOOGLE_PLAY_TEST_USER_IDS` | Comma-separated verified BasketBoss test-user UUIDs |
| `GOOGLE_PLAY_PRODUCT_ID` | `basketboss_premium` |
| `GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID` | `monthly` |
| `GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID` | `annual` |
| `GOOGLE_PLAY_MONTHLY_OFFER_IDS` / `GOOGLE_PLAY_ANNUAL_OFFER_IDS` | Set each to `seven-day` only if that plan’s trial offer is created and active; leave empty for base-plan-only sales |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL` | Developer API service-account identity |
| `GOOGLE_PLAY_PRIVATE_KEY` | Secret PKCS#8 RSA private key; never a client value |
| `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` | Exact authenticated push identity |
| `GOOGLE_PLAY_PUBSUB_AUDIENCE` | Exact configured HTTPS push audience |
| `GOOGLE_PLAY_PUBSUB_SUBSCRIPTION` | Exact `projects/.../subscriptions/...` resource |
| `GOOGLE_PLAY_LIVE_BILLING_ENABLED` | Additional production-token reader/verification gate; not permission to sell on its own |
| `GOOGLE_PLAY_LIVE_CHECKOUT_ENABLED` | Additional explicit gate for starting new live Google payments |
| `BB_PURCHASE_INTENTS_ENABLED` | Enable the reviewed durable shared coordinator after applying its D1 schema |
| `BB_PURCHASE_INTENTS_STRICT` | Require the updated coordination protocol for new checkout; required together with the previous flag for live Google sales |

The package is fixed to `uk.co.basketboss.app`. Test mode accepts only Google's
verified test purchases from allowlisted BasketBoss accounts. Test access never
enables production Partner Sharing. Apple, Paddle and existing owner/founder
access retain their separate authoritative checks.

Device acceptance checks must include: displayed price and eligible trial;
Google purchase sheet; cancelled and pending payment; eventual pending
completion with the app closed; failed verification and retry; duplicate
callbacks; restore after reinstall; wrong BasketBoss-account restore;
foreground recovery; expiry/hold/refund; account deletion races; and existing
Premium users not being offered another charge. Use licence-test instruments
and test accounts throughout. Mocked tests and a successful AAB compile do not
establish real-device or live-provider readiness.

The Android deletion sheet also explains that deleting BasketBoss does not
cancel Google Play billing and provides the store's subscription settings.
Cancellation is not required before account deletion. Its actionless deletion
form retains the original handler even on the native pricing page; explicit
payment-form actions remain blocked. Shared web/iOS deletion handlers are not
modified.


## Exact Console catalogue

| Console object | Identifier | Configuration |
| --- | --- | --- |
| Application | `uk.co.basketboss.app` | Existing BasketBoss Play app; package is immutable |
| Subscription product | `basketboss_premium` | Premium entitlement |
| Monthly base plan | `monthly` | Auto-renewing, one month; set countries and real local prices |
| Annual base plan | `annual` | Auto-renewing, one year; set countries and real local prices |
| Monthly trial offer, optional | `seven-day` under `monthly` | Free phase of seven days, then monthly base-plan renewal |
| Annual trial offer, optional | `seven-day` under `annual` | Free phase of seven days, then annual base-plan renewal |

In **Monetise with Play → Products → Subscriptions**, create the product, then its
base plans and offers. Activate the intended countries, base plans and offers.
Names in the table must match the server values exactly, including case. Offer
IDs are scoped to a base plan, so the same `seven-day` ID can be used under each.
Do not enter an offer token: Play supplies that opaque token for the eligible
customer at runtime. The app validates and passes the returned token.

For trial eligibility, use Play's new-customer acquisition restrictions that
match the intended household Premium policy (normally a customer who has never
had a subscription in this app). Apple's introductory offer eligibility is
managed per Apple subscription group. The two stores cannot share a customer's
store purchase history, so a trial in one store cannot prove ineligibility in
the other. Existing verified BasketBoss Premium suppresses another checkout.
Do not advertise a seven-day trial unless the configured store offer is active
and returned as eligible. Check App Store Connect's current offer and prices
before choosing the Android values; the repository's StoreKit fixture is not
that evidence.

Keep historical offer IDs in the server verification allowlists after customers
have purchased them. Stop new eligibility by deactivating an offer in Play
Console; removing its ID from verification configuration would prevent existing
purchases using that offer from being verified. Do not repurpose product or base
plan IDs for different periods.

## Production release checklist

1. Review the billing code and both D1 migrations. Configure credentials directly
   as server secrets. In Play Console grant the Developer API service account
   access to **this app**, including **View financial data, orders, and
   cancellation survey responses** and **Manage orders and subscriptions** as
   needed to read and acknowledge subscriptions. Check the current Console
   permission labels and keep other app access disabled. Enable the Android
   Developer API in the service account's Google Cloud project.
2. Give `google-play-developer-notifications@system.gserviceaccount.com` Pub/Sub
   Publisher access to the configured topic and select that topic in Play's
   real-time developer notification settings. Configure authenticated push to
   the HTTPS `/api/google-play/notifications` endpoint, with the exact push
   service-account email, OIDC audience and subscription resource in the server
   settings. Test notification delivery; a Console test message is not a
   subscription proof.
3. Apply the reviewed schemas and deploy the reviewed endpoints with sales off.
   Check readiness, membership, Restore and Manage with existing accounts.
   Test mode requires both the BasketBoss UUID allowlist and Google's verified
   test-purchase marker. Test purchases never grant production household sharing.
4. Release updated iOS and Android clients capable of shared purchase-intent
   start/result reporting before enabling strict new checkout. With strict mode
   enabled, legacy clients may be asked to update before a **new** purchase;
   existing entitlement checks, verification, Restore and Manage must continue.
   Validate this explicitly with the current App Store build before activation.
5. Complete the licence-device acceptance matrix in the parity audit, including
   cancellation, deferred payment, app restart, notification recovery and
   cross-provider simultaneous checkout. Resolve uncertain attempts from actual
   provider evidence; do not clear database locks to make a test pass.
6. Build with the original upload key, require the signed-bundle verifier to pass,
   and confirm **package `uk.co.basketboss.app`, version `1.0.4`, code `4`** and
   `com.android.vending.BILLING` in the packaged base manifest. If code 4 was
   already uploaded, increment every version-code check and produce a new bundle.
   Confirm the upload certificate matches the Console's registered upload key.
7. Install through Play Internal testing, confirm all image-pack assets and the
   full application work, then submit the intended track. Uploading an AAB does
   not activate server billing, publish a subscription, apply a database
   migration or enable live purchases.
8. Only after release/setup approval, use `GOOGLE_PLAY_BILLING_MODE=live`, the
   production verification gate, the explicit live-checkout gate and both shared
   purchase-intent flags. Keep a way to disable **new sales alone** while keeping
   production readers, verification, RTDN, Restore and existing paid access on.
   Monitor verification/acknowledgement retries and notifications without logging
   purchase tokens or credentials.

A signed AAB cannot be manufactured from an unsigned CI artifact by renaming it.
The signing key is held on the owner's Mac unless its existing key has separately
been configured in private Actions secrets. The Mac command above produces the
signed file; this documentation does not claim a signed artifact or successful
real purchase until those checks have actually run.
