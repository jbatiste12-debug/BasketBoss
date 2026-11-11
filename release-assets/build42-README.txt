BasketBoss 1.0.2 — build 42

On your Mac:
1. Open prepare-build42-mac.command. It downloads the pinned source, installs dependencies, stages the 700-recipe client, and opens Xcode.
2. In Xcode, choose your Apple signing team if requested. Confirm Version 1.0.2 and Build 42.
3. Select Any iOS Device (arm64), then Product > Archive.
4. In Organizer choose Distribute App > App Store Connect > Upload.
5. Wait for processing, then select build 42 in TestFlight.

Requires Xcode and Node.js 22 or newer. This is source preparation; it is not a signed Apple upload. Your existing App Store review submission is not changed by the launcher or a TestFlight upload.

Do not run ordinary npm run ios:sync after preparing this release; that selects the legacy catalogue instead of the 700-recipe release.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/55887a0399358235b0600feb19951622cdca744a

Complete source ZIP:
https://github.com/jbatiste12-debug/BasketBoss/archive/55887a0399358235b0600feb19951622cdca744a.zip

See build42-whats-new.txt for Apple Connect notes and build42-what-to-test.txt for the key checks.
