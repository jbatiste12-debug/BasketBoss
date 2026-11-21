BasketBoss 1.0.6 — Build 56

Reviewed application source:
855026d713b57e630da9e92e3bbe117f8b5571c5

What this build adds

- Shared dinners refresh automatically while BasketBoss is open, including
  while the accepted household's Partner Sharing panel is open. Opening
  Sharing from Account or Settings closes the earlier panel so it cannot
  silently prevent the shared Plan from updating.
- Foreground refresh retains the existing protections for typing, cooking,
  account changes and conflicting edits. Receiving a shared dinner reloads
  the existing Plan in memory without a page reload or a partner-plan upload.
- Account deletion includes the current sign-in and Paddle cancellation
  feedback. An unfinished subscription check or cancellation keeps saved
  device data and pauses syncing until the server confirms completion.

Household updates use periodic foreground refresh, not instant background
push. Both accepted household devices need this client update to receive the
new interface behaviour. The website/PWA update is deployed separately.
Deletion verification, cancellation, sharing eligibility and permissions are
still checked by the server; this launcher does not configure those services.

Prepare on your Mac

curl -fL --retry 3 'https://raw.githubusercontent.com/jbatiste12-debug/BasketBoss/main/release-assets/prepare-build56-mac.command' -o "$HOME/Downloads/BasketBoss-Build56.command" && bash "$HOME/Downloads/BasketBoss-Build56.command"

Requires Xcode and Node.js 22 or newer. The launcher creates a fresh project,
checks out the exact reviewed source above, installs locked dependencies,
sets App Debug and Release to 1.0.6 (56) only in that prepared local checkout,
stages the verified catalogue-700 assets and opens the Xcode workspace.
Connect your iPhone and choose Product > Run. Keep bundle ID uk.co.basketboss.app
and your existing Apple development team with automatic signing.

Complete build56-phone-checklist.txt before upload. Confirm 1.0.6 is the new
App Store Connect version you intend to submit and build 56 is unused there.
Then choose Product > Archive, or run this optional archive command:

bash "$HOME/Downloads/BasketBoss-Build56.command" --archive

Archive mode prepares another fresh checkout and validates the archive's
version, build and bundle ID before opening it. In Organizer choose Distribute
App > App Store Connect > Upload when ready. Nothing uploads automatically;
existing projects, archives and the live App Store version remain unchanged.

Do not run ordinary ios:sync after preparation; it replaces the staged
catalogue-700 assets. The internal catalogue/client protocol remains 1.0.2,
independently of App Store version 1.0.6. Repository /ios files are unchanged.

Launcher syntax, local version guards and mocked archive handling can be
checked on Linux. Actual signing, camera, keyboard, purchase restoration and
device behaviour require your Mac and iPhone. Existing CI archives are
unsigned baseline 1.0.2 (43) verification artifacts, not this signed release.
