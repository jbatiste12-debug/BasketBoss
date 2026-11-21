# BasketBoss on Google Play

The Android package is **`uk.co.basketboss.app`**, named **BasketBoss**, with
`versionName "1.0.4"` and `versionCode 4`. It uses Capacitor Android **8.6.0**,
minimum Android API 24, and compile/target API 36. The package name must match
your Play Console app. Increase `versionCode` for every later uploaded bundle.

Build 4 includes the merged automatic shared-plan refresh and account-deletion fixes, alongside an Android-only Google Play Billing bridge and membership flow.
An already linked household now loads its saved dinners on a fresh device even
before that device has a local plan record. Dinner and serving changes then
refresh both ways while the apps are open, without pressing Sync.
Licence-test purchases remain unavailable until the server, catalogue and test
account are configured. Live checkout is deliberately blocked in this revision,
including when live environment flags are supplied. Prices and eligible trial offers come from Google Play; they are not
hardcoded in the app. Existing eligible Premium accounts should use their current
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
root Capacitor configuration and existing iOS packaging path stay intact. The
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


## Google Play subscriptions: licence-test setup

The Android bridge uses Google's pinned Billing library 9.1.0. It has no npm
billing dependency and does not modify the iOS StoreKit implementation. The new
server provider verifies purchase tokens against Google's Developer API, binds
purchases to an opaque ID for the authenticated BasketBoss account, persists the
verified result in D1, and acknowledges purchases server-side. Native purchase
callbacks, browser flags and localStorage never grant Premium.

This revision is for **licence testing**, not live subscription sales. The
config and purchase-context endpoints deliberately reject live checkout. A
shared cross-provider purchase reservation and cancellation design must be
reviewed before that fence is removed: checking already-active memberships
alone cannot prevent simultaneous checkout sheets on two platforms. Existing
nonterminal Google purchases also need resolving before another subscription.
No live product, price, offer, database migration or customer record is changed
by building the app.

1. Complete the Google Play payments profile directly in Play Console.
2. Upload/publish the billing-enabled build to the Internal testing track. The
   original code-1 build lacked Billing; Google may keep product configuration
   unavailable until a billing-enabled version is in a track.
3. Agree the catalogue and prices before creating or activating products. The
   proposed model is one Premium product, `basketboss_premium`, with `monthly`
   and `annual` auto-renewing base plans. These are proposed identifiers, not
   existing Console objects. Prices, countries and eligible free-trial offers
   remain owner decisions. Android displays Play-returned localized prices and
   eligible pricing phases; it never substitutes a made-up price or trial.
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
   the existing **Cloudflare D1 BILLING_DB**, then deploy the reviewed server
   changes. This is not a Supabase migration. No existing Apple/Paddle rows are
   modified by the new migration. Applying it is a separate approved action.

Required server settings (keep all purchase flags disabled until setup passes):

| Setting | Meaning |
| --- | --- |
| `GOOGLE_PLAY_BILLING_ENABLED` | Explicit feature gate; default off |
| `GOOGLE_PLAY_BILLING_MODE` | Use `test` for this delivery |
| `GOOGLE_PLAY_TEST_USER_IDS` | Comma-separated verified BasketBoss test-user UUIDs |
| `GOOGLE_PLAY_PRODUCT_ID` | Exact owner-approved Play subscription ID |
| `GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID` | Exact monthly auto-renewing base-plan ID |
| `GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID` | Exact annual auto-renewing base-plan ID |
| `GOOGLE_PLAY_MONTHLY_OFFER_IDS` / `GOOGLE_PLAY_ANNUAL_OFFER_IDS` | Optional approved offer IDs; empty means no introductory offer |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL` | Developer API service-account identity |
| `GOOGLE_PLAY_PRIVATE_KEY` | Secret PKCS#8 RSA private key; never a client value |
| `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` | Exact authenticated push identity |
| `GOOGLE_PLAY_PUBSUB_AUDIENCE` | Exact configured HTTPS push audience |
| `GOOGLE_PLAY_PUBSUB_SUBSCRIPTION` | Exact `projects/.../subscriptions/...` resource |

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
