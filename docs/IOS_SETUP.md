# BasketBoss iOS wrapper

The native app is a **separate installation** from the Safari/PWA app. Its app ID is `uk.co.basketboss.app`, its display name is BasketBoss, and its minimum deployment target is iOS 16.0. Automatic signing selects **Jason Batiste — J25UTUATD2** for Debug and Release.

The PWA files, service worker, browser storage keys and Cloudflare deployment remain in place. The native builder reads public assets and writes only `dist/native/`; Capacitor copies that output to `ios/App/App/public/`. Those generated directories and CocoaPods dependencies are ignored by Git. There is no remote `server.url`: the app shell and public recipes ship inside the app, with updates delivered through Xcode/App Store builds.

## Mac prerequisites

- Node 22 or later (Node 24 LTS is suitable), npm, and Git.
- Full Xcode 26 or later, launched once to complete installation and accept its license. Capacitor 8 uses the iOS 26 SDK; deployment to iOS 16+ remains supported.
- CocoaPods installed, for example `brew install cocoapods`.
- In **Xcode → Settings → Accounts**, sign in to the Apple ID that can access team **J25UTUATD2**. The repository configures the team ID; it cannot include your signing certificate or Apple login.

If Xcode command-line tools point to a standalone tools installation, select full Xcode:

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

## First clone and run

```sh
git clone https://github.com/jbatiste12-debug/BasketBoss.git
cd BasketBoss
npm ci
npm run ios:sync
open ios/App/App.xcworkspace
```

For an existing clone:

```sh
cd BasketBoss
git pull --ff-only
npm ci
npm run ios:sync
open ios/App/App.xcworkspace
```

`ios:sync` verifies the Mac toolchain, builds the current native web bundle, runs Capacitor's `sync ios` (including CocoaPods installation), and checks the bundle ID, deployment target, signing team, permissions, icon and bundle contents. Use the **workspace**, not the `.xcodeproj`, so Capacitor and plugin pods are included.

In Xcode:

1. Select the **App** scheme and connect/unlock the iPhone. Trust the Mac and enable **Settings → Privacy & Security → Developer Mode** on the iPhone if requested.
2. Select the physical iPhone as the run destination.
3. Under **App → Signing & Capabilities**, leave **Automatically manage signing** enabled and select **Jason Batiste (J25UTUATD2)**. Confirm the bundle identifier is `uk.co.basketboss.app`.
4. Press **Run**. Xcode may need permission to register the phone and create a provisioning profile. This requires your developer account, network access and appropriate team permissions.

## Native behavior

- The native origin is `capacitor://localhost`. Only local/official `/api/` URLs are rewritten to `https://basketboss.co.uk/api/...`; local HTML, images, JavaScript and JSON remain bundled.
- Supabase's existing public HTTPS auth/cloud URLs remain unchanged. No service key, Cloudflare token, D1 binding or Premium recipe payload is placed in the native bundle.
- Native API fetch uses Bearer authentication and cookie-free CORS. The API permits the exact native origin on official production HTTPS hosts, including preflight and authenticated errors. Confirmed-email checks, newest Premium session, household scope and entitlement checks remain active.
- The app includes the public 100 recipes. The private Premium 400 load only through the existing authenticated API. An internet connection is needed for sign-in, cloud sync, receipt recognition and Premium retrieval.
- Sign in separately on iOS; Safari/PWA sessions and device-local plans do not automatically transfer. Use the existing explicit cloud restore/upload controls after sign-in. Shared cloud data belongs to the same account/household. The current one-current-Premium-session policy still applies.
- The receipt photo field uses Capacitor's camera/photo chooser on iOS. Permissions are requested when used; photos are not saved to the photo library. The existing Gemini consent, review, quota and confirmation steps still apply before upload or pantry changes.
- Status-bar setup, safe-area CSS, a brand launch screen, an opaque 1024px icon and haptic hooks are native-only. `window.BBNative.haptic('selection' | 'success' | 'light')` is available to native UI integrations.
- `basketboss://auth/callback` can reopen account sign-in. Incoming URL tokens are never trusted or saved. Existing email confirmation works in the browser; users return and sign in with their confirmed email/password. No OAuth or password-reset flow is added by this wrapper.

## App Store scope and release gates

This repository prepares a buildable native project; it does **not** certify App Store acceptance or perform an Apple signing/device build from Linux.

This initial native build is a **Free/existing-account companion**. It suppresses web checkout and trial purchase promotions, blocks checkout requests, replaces pricing pages with account information, and does not create accounts. The existing PWA keeps its account creation and Paddle checkout. Existing eligible subscribers can sign in; the app does not grant local Premium rights.

The app now includes **Delete Account & Data** in Profile and Settings, including password reauthentication, permanent confirmation, billing cancellation and server-confirmed cleanup. Deploy the account-deletion SQL migration below before submission. Native account creation remains disabled in this companion build. Before selling digital Premium access in iOS, implement the appropriate StoreKit/IAP products, restore-purchase handling and server entitlement verification, or establish an applicable Apple entitlement/program. Removing Paddle links alone does not establish subscription-policy eligibility; review Apple's current rules for this companion model.

Before submission, complete these checks on the Mac/iPhone:

- Sign in and confirm Free/Premium/partner access, cloud restore and the current session policy.
- Take and select a receipt photo, grant/deny camera and photo permissions, give Gemini consent, review the scan, confirm food/non-food, then check pantry quantities and remembered prices.
- Verify safe areas, keyboard, rotation, background/resume and account-status and privacy links on the actual iPhone.
- Build/Archive for **Any iOS Device**, validate in Xcode Organizer, and upload to your App Store Connect app with the same bundle ID/team. Increment build number for later uploads.
- Complete App Store privacy labels, age rating, screenshots, support/privacy URLs, export-compliance answers, content rights and review instructions/test account. The privacy manifest declares the app's local preference access and account/content categories conservatively; review actual Supabase/Gemini/Paddle processing and retention when answering App Store Connect questions.

## Verification without a Mac

```sh
npm ci
npm run build:native
npm run ios:verify
npm run test:native
```

These verify packaging, privacy exclusions, routing/CORS and project configuration. CocoaPods installation, Swift compilation, signing, iPhone execution and App Store upload require macOS/Xcode and have not been represented as passing Linux checks.


## Account deletion rollout (31 October 2026)

1. Run `sql/basketboss_account_deletion_20261031.sql` in the **production Supabase SQL editor**, after the existing household and receipt-inventory migrations. Installing it deletes no accounts. It creates two service-only RPCs, secures the legacy cloud-data foreign key, and serializes shared writes with account deletion. It has been tested against an isolated PostgreSQL engine; production application still requires database-owner access.
2. Open `https://basketboss.co.uk/api/account/delete`. Require `available:true` and `migrationReady:true`. The endpoint fails safely until the migration is installed; do not submit a build with a non-working deletion button.
3. Use a dedicated disposable account to verify the complete flow: cancel leaves data; incorrect password preserves data; confirmed deletion removes cloud identity/plans/receipt inventory and this installation’s local data. Owner deletion removes its shared household, while a partner’s separate account survives. Never use a customer account for testing.
4. Pull the release on the Mac, run `npm ci && npm run ios:sync`, then rebuild the physical iPhone app. The installed Capacitor shell needs a new build to receive these changes.

The deletion journal retains non-reversible actor/billing-reference hashes and timestamps to suppress delayed billing events. Raw user ID/email exist only during an unfinished retry, and are cleared on completion. No password or bearer token is stored. Payment providers may retain required financial records. Downloaded backups, other offline installations and original library photos cannot be erased remotely.

Public App Store privacy URL: `https://basketboss.co.uk/privacy`. Terms URL: `https://basketboss.co.uk/terms`. Both are also bundled offline and accessible in Profile/Settings and the native account-status page. Native web checkout, payment-provider portals and purchase promotions are disabled; the PWA retains web billing. Apple decides whether the existing-account companion model meets its rules. This change adds no StoreKit products or in-app purchases.


## Native launch and replay setup

The OS launch screen displays the crowned BasketBoss logo and name immediately. A matching native view adds a short spring animation and green/gold sparkles while the local WebView prepares the app; the requested native brand animation stays visible for about four seconds while the app prepares underneath, with no second automatic web welcome animation. Reduce Motion skips decorative movement. If startup cannot finish, Try again reloads the local app without clearing saved data. The cream background uses dark status-bar icons.

First-time users continue into the setup flow. Returning users can use Settings → Replay welcome & setup; cancelling the replay keeps the completed setup marker, preferences and meal plan. Setup is paused during account deletion so it cannot restore data being erased.

Deletion failures now distinguish an unfinished checkout, subscription cancellation, cloud confirmation, saved-data cleanup and temporary sign-in verification failures. A definitively rejected request before deletion starts resumes syncing; an unfinished or unknown result retains saved data and pauses writes. The optional AI quota table is skipped only if database metadata proves it has never been created. Production migration readiness and all required table columns were verified on 31 October 2026; an actual successful deletion must still be tested with a disposable account before submission.

## Shared food thumbnails

Pantry, School Lunches and Make a Meal use the same 78 food photographs in the PWA and native bundle. Exact food names preserve dry, cooked, canned and frozen states. Custom uploaded photos take priority; unknown custom foods keep their emoji fallback. Selection, stock quantities and lunch calculations use the existing data unchanged.

The 13 transparent WebP atlases preserve the source pixels losslessly and total about 9.6 MB. Images load as needed and enter the PWA cache when viewed, rather than all downloading during installation. The service-worker release updates the shared renderer; close and reopen the PWA after deployment. Rebuild the installed iPhone app with `npm run ios:sync` and Xcode Run to receive the bundled images and launch improvements.

## Cook, navigation and account polish (1 November 2026)

Cook promotes the existing ingredient scanner and meal creator in the approved green/gold layout. Selected-food thumbnails reflect the current ingredient draft; editing and finding recipes keep the original quantity and confirmation controls. The shared five-tab dock has distinct icons, equal touch targets and one active state. Settings, its gear-triggered banner and the existing sign-in form use the same cream/green styling. Email/password inputs, autofill, authentication handlers and saved data remain with the existing controllers.

A validated AI meal displays immediately, with its ingredients, method, allergens and safety notes available for review. A separate request then asks Gemini for an illustrative picture of that exact recipe. Pictures are optional: errors never discard the recipe or substitute an unrelated stock dish. They are held in a temporary object URL and cleared when the recipe, account or page changes. The creation consent and public policies explain this processing.

Meal pictures use the existing server-side `GEMINI_API_KEY`, a supported image model (default `gemini-2.5-flash-image`), current Premium/session/deletion checks, and an actor/household/origin-bound ten-minute single-use ticket issued after recipe validation. The image allowance is separate from the ten daily meal drafts: up to ten pictures per household per day, subject to availability. `BB_AI_IMAGE_MODEL` optionally selects an allowlisted model; `BB_AI_IMAGE_GLOBAL_DAILY_CAP` optionally sets a bounded global picture cap, otherwise the lower of 50 and the existing AI global cap applies. There is no new secret or database migration. Provider/model access must be smoke-tested with an eligible production account; local tests simulate provider responses and do not establish live image-provider availability.

Native startup now reveals real app controls after the parser, deletion safeguards and required onboarding module are ready, while optional deferred enhancements continue loading. A local Chromium test with one optional asset delayed four seconds reduced handoff from about 4.7 seconds to about 0.9 seconds for both fresh and returning users. These are simulated timings, not measurements from the physical iPhone. First-time setup, pending deletion and failed external requests were checked. The native builder also removes the obsolete inline favicon and private web QA comparison controller; native Free AI entry opens the bundled account-status view.


## Account recovery and installed-asset refresh (1 November 2026)

An unfinished local deletion marker now has a read-only, authenticated status check. Only the exact original actor or its original retry bearer can check that job. A server-confirmed not-started state releases the local pause without deleting saved data. A real pending job keeps writes paused; recovery sign-in for that same account is available without uploading or restoring a plan. Unknown responses, network failures and account changes retain the barrier. The public no-argument deletion-readiness URL is unchanged.

Native HTML now fingerprints bundled JavaScript, styles and page links by content. This prevents an updated index from opening an older cached Cook document or script after a sideloaded update. The native Cook navigation has a plain-link fallback, including when its enhancement script fails, and uses centering without a transformed fixed-position layer. Cook also loads deletion recovery directly.

The native opening animation lasts about four seconds when motion is enabled; Reduce Motion skips the decorative hold. App controls and setup prepare behind it. PWA onboarding keeps its action footer visible while only the step content scrolls, including when the visual viewport shrinks for a keyboard. Its BasketBoss wordmark and green/gold crown motion match the updated brand animation.
