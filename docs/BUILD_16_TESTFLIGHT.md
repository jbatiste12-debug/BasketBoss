# BasketBoss 1.0 (16) — Mobile pre-flight fixes

Build 16 includes Build 15 and addresses the mobile scrolling, input and network audit. It retains the existing BasketBoss colours, typography, cards and navigation layout.

## What changed

- Main pages share the document scroller, with momentum scrolling, scroll containment and 110px plus safe-area clearance. The in-store screen keeps its own single scroller and reserves the measured Finish shop footer height. A legacy Cook food grid no longer traps vertical scrolling.
- Small actions, secondary-dialog links and quantity steppers have real 44px touch areas. Buttons, labels, tabs and disclosure controls use touch manipulation. Mobile editing fields use at least 16px type.
- Closing account sign-in releases the background lock, keyboard state and bottom navigation immediately. Native dialogs accept backdrop taps through their existing cancellation handlers; busy writes remain protected. Essential and manual-purchase dialogs keep the focused field inside their visible scrolling body.
- Cloud Upload and Restore lock immediately. Uploads serialize and keep newer edits pending until their own snapshot is saved. A slow Restore cannot overwrite edits made while it was loading.
- Auto-fill, Finish shop, Begin shop, receipt actions and crowd reports guard rapid taps. Finish and scan performs the same guarded shopping settlement before opening the scanner.
- Shopping, authentication, receipt and Cook requests have bounded waits. Receipt confirmation retains its pending journal after an uncertain network result and recovers using the same receipt ID. Reopening the same receipt review preserves the draft; intentionally selecting another trip changes context normally.
- Valid pantry quantities and shopping ticks remain local and survive navigation. Tab selection retains the established scroll-to-top behaviour; ordinary quantity edits and rerenders preserve their current scroll position.

These checks use synthetic accounts, mocked HTTP and isolated PostgreSQL. They send no authentication emails, charge no subscriptions, publish no crowd sightings and make no paid AI calls.

## Automated verification

The complete Node regression suite reports 2,333 cases: 2,330 passed, zero failed, one skipped and two existing TODOs. PostgreSQL receipt, report, sharing and deletion checks ran with isolated PGlite. Native web packaging and portable iOS verification passed with 934 client files and exactly 100 free recipes; the private Premium catalogue remains authenticated.

The 375px browser audit covers all five main screens, scroll ownership and containment, safe-area clearance, touch targets and input sizes. Separate modal checks verify backdrop dismissal, guarded busy states, draft retention after failed saves and account-close restoration. All 11 end-to-end mobile checks passed with zero browser errors, including immediate pantry-to-Shop reconciliation and shopping ticks surviving exit, rapid navigation and reload. At 375px the recipe Cook surface is fullscreen: content taps retain it and Exit dismisses it; the desktop backdrop dismisses normally. Simulator software-keyboard verification is tracked separately from browser emulation.

The UK/US pantry audit also passed across all 100 recipes and 730 ingredient lines: zero duplicate rows, non-canonical rows or conversion failures in either mode.

Additional 375px checks passed for Settings, Premium, Saved weeks, Custom dinner and My usual product: every measured field is at least 16px, targets are at least 44×44px, and no horizontal overflow was found.

Native verification passed for the application logic: iOS simulator compilation, unsigned Build 16 archive, Cook WebView smoke test, and all four real software-keyboard tests. See [native build and Cook verification](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/42022238015) and [keyboard verification](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/42021962510). The final r2 follow-up contains only Settings touch-area CSS, cache references and this validation record; its targeted browser and full regression checks passed.

## Open in Xcode

Use Node 22+, CocoaPods and Xcode 26+ on your Mac:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build16-XXXXXX")" &&
git clone --depth 1 --branch testflight-build16-mobile-preflight-r2 \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0, Build 16, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Select **Any iOS Device (arm64)** → **Product → Archive** → **Distribute App → App Store Connect → Upload**. Use the next unused build number if 16 has already been uploaded.

PWA deployment does not replace an installed TestFlight application. Signing and the final TestFlight upload require your Mac. Native keyboard behaviour must also pass the actual simulator check; desktop mobile emulation alone is insufficient evidence for the iOS software keyboard.

Tester notes: [build16-what-to-test.txt](../release-assets/build16-what-to-test.txt).
