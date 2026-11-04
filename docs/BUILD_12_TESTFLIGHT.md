# BasketBoss 1.0 (12) — accounts and swipe navigation

Build 12 includes Build 11's Weekly essentials fix plus:

- Immediate loading locks for sign-in and account creation, clear Check your email state and a resend cooldown.
- Forgot password, verified recovery callbacks and a dedicated new-password screen with a fresh-link action if recovery expires.
- Verified email callbacks establish the shared session, show a welcome message and open Plan. Callback credentials are scrubbed from URLs and excluded from the PWA cache.
- Warm/cold iOS email links use the shared handler. Native account creation is enabled.
- Left/right swipes between Plan, Discover, At home, Shop and Cook. Recipe swipes, horizontal scrollers, controls, dialogs and screen-edge back gestures retain their own behavior.

The PWA and Capacitor bundle use the same client source. Existing Build 11 installs need a newly uploaded Build 12 to receive these client changes. Supabase redirect configuration and SMTP remain dashboard settings: see [email setup](AUTH_EMAIL_SETUP.md).

## Open in Xcode

Use Node 22+, CocoaPods and Xcode 26+ on your Mac:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build12-XXXXXX")" &&
git clone --depth 1 --branch testflight-build12-account-swipe-v2 \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0, Build 12, team Jason Batiste (J25UTUATD2), bundle uk.co.basketboss.app. Choose Any iOS Device (arm64) → Product → Archive, then Distribute App → App Store Connect → Upload. Use the next unused build number if 12 was already uploaded.

Portable packaging does not sign an Apple binary or upload to TestFlight. Browser checks render the actual shared/native web UI with synthetic API responses and no real email sends.

## Validation

- Full Node suite: 2,077 cases, 2,070 passed, zero failures, five skipped and two TODOs.
- Native packaging and portable iOS verification passed: 919 assets, 100 free recipes, no private catalogue bundled.
- Browser checks use the bundled Supabase SDK with mocked Auth HTTP responses. They cover double taps, onboarding confirmation, resend cooldown, PKCE return through the landing page, URL scrubbing, the new-password screen and saving the password.
- The native web bundle was exercised with a mocked Capacitor bridge for warm and cold email callbacks. The cold-start check verifies the confirmation code is not replayed on reload. This does not replace a physical-device email-link check.
- Trusted browser touch gestures cover tab ordering, existing recipe swipes, dialogs, no wrapping at the ends, Shop/Cook page navigation and returning to the top.

Tester notes: [build12-what-to-test.txt](../release-assets/build12-what-to-test.txt).
