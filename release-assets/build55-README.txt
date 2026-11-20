BasketBoss 1.0.5 — Build 55

Shop your kitchen first.

Reviewed application source:
ceae711283ea74770279deb15c1163edf69200eb

What this build adds

- Settings > Household Partner Sharing uses verified server access. Eligible
  Premium owners open the invitation screen without being offered another plan.
- Pending invited partners can accept without buying their own subscription.
  Recognised Premium with unavailable sharing gets an accurate explanation,
  sign-in or retry action; disabled server features are not automatically enabled.
- Invitations can send an email and appear in the invited account in the app.
  Email delivery needs the configured server email provider. A saved invitation
  is not described as emailed when email delivery is unavailable or fails.
- Household status and shared changes refresh automatically while the app is
  in the foreground. This is periodic refresh, not an instant push guarantee.
- Navigation between Plan, Discover, At home, Shop and Cook hides the previous
  screen immediately while the selected screen loads, avoiding the old-screen
  flash. Test both fast tab changes and slower device/network conditions.

Existing pantry quantities, shopping-gap maths, billing verification and prices,
account security checks and household isolation remain protected. The native iOS
project baseline, Android setup, logos and landing pages are unchanged in Git.
No live customer records or production feature settings are modified by this
launcher. Email provider setup and server deployment are separate from Xcode.
Optional invitation email requires BB_HOUSEHOLD_INVITE_EMAIL_ENABLED=true,
RESEND_API_KEY and BB_HOUSEHOLD_INVITE_EMAIL_FROM on the server, with a sender
verified by the email provider. Keep the API key in server secrets. The launcher
does not set these values or automatically enable email or sharing.

Prepare on your Mac

curl -fL --retry 3 'https://raw.githubusercontent.com/jbatiste12-debug/BasketBoss/main/release-assets/prepare-build55-mac.command' -o "$HOME/Downloads/BasketBoss-Build55.command" && bash "$HOME/Downloads/BasketBoss-Build55.command"

The launcher requires Xcode and Node.js 22 or newer. It creates a fresh project,
checks out the exact reviewed source above, installs locked dependencies, sets
both App Debug and Release to 1.0.5 (55), stages catalogue-700 assets and opens
the workspace. Connect your iPhone and choose Product > Run.

Complete build55-phone-checklist.txt before uploading. Confirm that 1.0.5 is the
App Store Connect version you intend to submit and build 55 is unused there.
Then choose Product > Archive, or rerun the launcher with --archive to create a
fresh validated archive. In Organizer choose Distribute App > App Store Connect
> Upload when ready. No archive uploads automatically. Earlier projects and
archives remain intact; preparing this project does not change your submission.

Do not run ordinary ios:sync afterwards; it replaces the prepared catalogue-700
assets. The internal catalogue/client protocol remains 1.0.2 independently of
the App Store version. The repository's native project baseline is unchanged.

Launcher syntax, version guards and mocked archive behaviour can be verified
on Linux. Real Xcode signing, Apple purchase restoration, camera, keyboard and
device testing still require your Mac and iPhone. Tests with local fixtures do
not verify live email provider configuration or App Store Connect availability.

Plan options: Budget & household and Meal preferences expand inline without clipping. Clear week stays in More options with its existing confirmation.
