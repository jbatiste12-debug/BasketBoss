# BasketBoss Build 31 submission handoff

[Download the handoff ZIP](https://github.com/jbatiste12-debug/BasketBoss/raw/refs/heads/build31-submission-download/app-store/build31-submission/BasketBoss-Build31-Submission.zip) · [Download tagged source](https://github.com/jbatiste12-debug/BasketBoss/archive/refs/tags/appstore-build31-restore-flow.zip)

Build 31 includes verified-current Apple Restore and safe shopping/pantry reconciliation by food identity, compatible measurements and reviewed pack sizes. Unknown conversions require review. The ZIP contains Mac upload instructions, matching examples and verification reports.

The verified tag is `appstore-build31-restore-flow`, release commit `b33d0aa42df21d60bbb93b4247d184298f53108c`. Its source tree matches tested head `946e80d83f74c71da57647508373a4cca3ca2413` exactly; [PR #87](https://github.com/jbatiste12-debug/BasketBoss/pull/87) is merged.

The full hosted suite passed 2,789 checks with zero failures/skips and two existing TODOs. Native builds, hosted StoreKit, Cook, both four-case keyboard runs and the unsigned Build 31 iPhone archive passed. [Apple checks](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/42287540325) · [iOS archive and UI checks](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/42287540515).

Use the tagged source on your Mac: `npm ci`, `npm run ios:sync`, then open `ios/App/App.xcworkspace`. Confirm Version 1.0 / Build 31 and archive/upload. Signing, TestFlight installation and successful real-device Restore remain to be completed before App Review sign-off.

ZIP SHA-256: `d9b6c8e421d7d407d44865438b4a84d18181d04e3bd71612b952aced4f596477` (23,426 bytes).

The source release stays on main. This separate delivery branch contains the download files.
