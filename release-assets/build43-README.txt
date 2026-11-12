BasketBoss 1.0.2 — Build 43

On your Mac, open prepare-build43-mac.command. It downloads the pinned source, installs dependencies, prepares the 700-recipe client and opens Xcode. Requires Xcode and Node.js 22 or newer.

For signing: open Xcode > Settings > Accounts and sign in with your Apple Developer account. In the App target > Signing & Capabilities, choose your paid development team and keep automatic signing enabled. Keep bundle ID uk.co.basketboss.app.

To test: connect your iPhone, select it in Xcode and choose Product > Run.
To submit: select Any iOS Device, then Product > Archive. In Organizer choose Distribute App > App Store Connect > Upload.

Once signing is configured, the optional Terminal archive mode is:
  bash prepare-build43-mac.command --archive

The launcher does not upload or alter your App Store submission. Native signing, physical iPhone testing and upload happen on your Mac.

What changed:
- Confirmed purchases remain in Bought until Finish shop. Eligible unticks reverse only that purchase, and later recipe shortfalls remain visible.
- Common household ingredient names reconcile into the same stock. Sausages plus Pork Sausages combine while distinct cuts, proteins and varieties stay separate.
- Review & restock is above At home. Scrolling, storage tabs and navigation clearance remain intact.
- My Week's four control rows are centered with scoped CSS only.
- The yellow Shop reminder keeps Reviewed inside its card, with wrapping text and its original dismissal behavior.

Local verification: 4,305 passed, zero failures, zero cancellations; 1 existing platform skip and 2 existing TODOs are recorded separately. Source hashes were frozen throughout the clean sequential run. PWA/native assets match, and all 22 numerical-isolation checks pass (19 byte-identical; three approved name-identity adapters). The full 700-recipe alias audit and composed cut protections pass. See docs/qa/2026-11-12-bought-aliases-and-restock.md.

No additional ios:sync is needed. Ordinary ios:sync after this launcher would replace the prepared 700-recipe assets.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/402e0c23f149bc3252f33cc5ea010b5e53d9f95d

Complete source ZIP:
https://github.com/jbatiste12-debug/BasketBoss/archive/402e0c23f149bc3252f33cc5ea010b5e53d9f95d.zip

Live publication evidence and local verification reports are included separately in the current release packet.
