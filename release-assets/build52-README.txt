BasketBoss 1.0.4 — Build 52

Shop your kitchen first.

Reviewed application source:
8c76547da15fd0873619e7d9ac5f2e84a66f8b1d

What this build contains

- A cream Add food sheet with a clearer stock selector, optional amount section and Done button.
- More stable typing, autocomplete and keyboard focus when adding pantry food.
- Clear pending feedback and stable controls when switching stock levels; an unresolved choice cannot save the previous amount.
- A fix for the meal-card arrow showing a green backdrop with the day sheet off screen.
- A desktop budget label that sits beside the amount without overlapping it.
- Cleaner tab changes without the retired pantry screen flashing first.
- Clearer AI failure messages and safe server references for diagnosis.

The AI changes improve error handling. They do not establish or fix the unknown
cause of the reported meal-generation failure. One controlled phone test is still
needed; do not describe generation as verified until it succeeds on the device.

Existing pantry quantities, reconciliation rules, billing, sign-in rules and
Premium entitlements have not been changed by these presentation fixes.

Prepare on your Mac

Download prepare-build52-mac.command from this release, then run:

bash "$HOME/Downloads/BasketBoss-Build52.command"

If you kept the original download filename, use:

bash "$HOME/Downloads/prepare-build52-mac.command"

The launcher requires Xcode and Node.js 22 or newer. It creates a fresh project
folder in your home directory, checks out the exact source above, installs the
locked dependencies, sets both App Debug and Release to 1.0.4 (52), stages the
verified catalogue-700 assets and opens the Xcode workspace.

Connect your iPhone, select it in Xcode and choose Product > Run. Complete the
accompanying phone checklist before preparing an App Store archive.

To prepare an archive after testing, rerun the downloaded launcher with --archive.
It creates a fresh checkout and a uniquely named archive, checks the archive's
actual version, build and bundle ID, then opens it in Xcode Organizer.

No archive is uploaded automatically. In Organizer choose Distribute App >
App Store Connect > Upload when you are ready.

Keep the prepared project as it is. Do not run ordinary ios:sync afterwards;
that would replace the verified catalogue-700 recipe assets. The internal
catalogue/client protocol remains 1.0.2, independently of the App Store version.

Launcher syntax, version guards and mocked archive behaviour were checked on
Linux. A real Xcode build, signing, device run and archive cannot be verified here.
Your current App Store submission is not changed by downloading this release.
