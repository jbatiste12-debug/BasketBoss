BasketBoss 1.0.3 — Build 45

Version 1.0.2 is already live on the App Store. This launcher creates a separate
fresh project for the next release, 1.0.3 (45), from pinned source. It does not
upload, replace, withdraw or change any App Store submission.

On your Mac, install Xcode 26+, Node.js 22+ and CocoaPods. Run:
  bash prepare-build45-mac.command

The launcher downloads the pinned source, installs dependencies, sets both App
Debug and Release to version 1.0.3/build 45, prepares the verified 700-recipe
assets and opens the Xcode workspace. The signing team and bundle ID remain
unchanged. The internal catalogue/client protocol remains 1.0.2; that value is
separate from the App Store marketing version and must not be changed by hand.

In Xcode > Settings > Accounts, sign in with the Apple Developer account that
belongs to your paid team. In App > Signing & Capabilities, check your team and
automatic signing. Connect your iPhone, select it at the top, and press the play
button (Product > Run) to test the prepared app.

Before archiving:
- Enable Sign in with Apple for the exact App ID uk.co.basketboss.app and refresh
  provisioning. The project includes the capability; Apple Developer and
  Supabase provider configuration must also be correct. Complete the server
  Apple credential-revocation configuration before offering Apple-only accounts.
  See docs/apple-sign-in-release.md in the source folder.
- Verify a real Sign in with Apple and existing email account, including logout,
  restore, shared household access and account deletion, on a signed device.
- Confirm the one-week Free introductory offer exists for BOTH monthly and
  annual subscriptions in App Store Connect, in the intended countries. The app
  advertises 7 days free only when StoreKit returns the offer and confirms
  eligibility. One introductory offer is allowed per Apple subscription group.
- Confirm the eligible customer's Apple sheet states the correct trial and
  renewal price before purchase. Starting the trial requires Apple confirmation;
  it renews automatically to the selected paid plan unless cancelled in time.
- Check UK subscription pricing and use a UK purchasing/Sandbox account when
  testing pounds. Native prices come from the Apple Account storefront, not the
  shopping region selected inside BasketBoss. Never relabel a dollar charge as
  pounds. See docs/apple-seven-day-trial.md for setup and verification steps.

Device signing, Apple authentication and live trial eligibility are manual
release checks. This launcher does not claim those checks have already passed.

When ready, select Any iOS Device and Product > Archive. In Organizer choose
Distribute App > App Store Connect > Upload. Create/select App Store version
1.0.3 and attach the uploaded Build 45 when preparing the next submission.

Optional Terminal archive mode:
  bash prepare-build45-mac.command --archive

Archive mode verifies the actual archived app is version 1.0.3, build 45, with
bundle ID uk.co.basketboss.app before opening it in Organizer. It never uploads
automatically. If Apple reports that build 45 was already uploaded, use a fresh
unused build number rather than attempting to replace that upload.

Do not run ordinary ios:sync after this launcher: it would replace the verified
700-recipe assets. Setup and syncing are complete when the workspace opens.
The earlier Build 43 and Build 44 launchers are preserved unchanged.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/c52cc0e0583b1da7f0b345f6655c6293b4766a34
Complete application source:
https://github.com/jbatiste12-debug/BasketBoss/archive/c52cc0e0583b1da7f0b345f6655c6293b4766a34.zip
