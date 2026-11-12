BasketBoss 1.0.2 — Build 44

Build 43 has been submitted to Apple. This launcher prepares a separate fresh
project for Build 44; it does not replace, withdraw or upload any submission.

Run prepare-build44-mac.command on your Mac with Xcode 26+, Node.js 22+ and
CocoaPods. It downloads the pinned application, installs dependencies, sets both
Debug and Release to Build 44, prepares the verified 700-recipe assets and opens
Xcode. The signing team, bundle ID and version 1.0.2 remain intact.

In Xcode choose your paid Apple Developer team if prompted. Connect your iPhone,
select it and press Run to test. When you choose to submit Build 44, select Any
iOS Device and Product > Archive, then Distribute App > App Store Connect > Upload.

The optional Terminal archive mode is:
  bash prepare-build44-mac.command --archive

Archive mode verifies the resulting app's version, build and bundle ID before
opening Organizer. It never uploads automatically.

Changes included:
- Weekly kitchen check hides old empty food records when stock, planned need and
  shopping need are all zero. Active stock, unknown amounts, essentials and real
  restock requests stay visible; no pantry records or calculations are changed.
- Plan, Cook preparation and voice ingredient descriptions use the existing
  display formatter for individual food counts: six sausages display as 6 each.
  Actual package sizes, recipe quantities, scaling and pantry deductions remain
  owned by the unchanged calculations.

Do not run ordinary ios:sync after this launcher; it would replace the prepared
700-recipe assets. Device testing, Apple signing and App Store upload happen on
your Mac. Local and live validation evidence is included in the release packet.

Pinned application source:
https://github.com/jbatiste12-debug/BasketBoss/commit/8104e4ea616fcf7b2aa5f4ddd7f13450b6b9cf5d
Complete application source:
https://github.com/jbatiste12-debug/BasketBoss/archive/8104e4ea616fcf7b2aa5f4ddd7f13450b6b9cf5d.zip

Local verification: 115 application/display checks and 13 launcher/archive-version
checks passed, with zero failures, cancellations or skips. The original 51
kitchen-review checks also passed before the recipe-label correction.
See docs/qa/2026-11-12-build44-display-fixes.md.
