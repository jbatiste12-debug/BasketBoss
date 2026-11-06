# BasketBoss 1.0 (29) — Restore diagnostics

Download **[BasketBoss-Build29-Restore-Diagnostics.zip](BasketBoss-Build29-Restore-Diagnostics.zip)** using GitHub’s Download raw file button, then unzip it. Open `Mac-upload-commands.txt` on your Mac, build the verified source tag and upload Build 29 to TestFlight. Signing and upload use your Apple account.

Verified tag: [`appstore-build29-restore-diagnostics`](https://github.com/jbatiste12-debug/BasketBoss/tree/appstore-build29-restore-diagnostics). Release commit: `6669a98cfc3eb27540b4e3f111c7b0ff6155c2ee`.

Hosted validation: 2,693 tests passed, zero failures or skips, two existing TODOs; 12 StoreKit tests; Cook navigation; four strict keyboard cases; Debug/Release compilation and the unsigned Build 29 iPhone archive. The package records the earlier simulator-install timeout and its successful Apple Silicon verification.

Build 28’s real Sandbox purchase, Premium retained after reopening and unlocked recipes were user-confirmed. Its Restore operation still failed after Apple Account verification. Build 29 adds safe error details and cancellation handling; it does not claim that the original native Apple failure is fixed. After installing 29, use the same accounts, tap Restore Purchases once, and record the final message or support code. Successful real-device Restore and final App Store Connect metadata remain required before submission sign-off.

No password or signed app binary is included. The ZIP contains guides and verification reports. See [the browser-readable upload guide](https://github.com/jbatiste12-debug/BasketBoss/blob/appstore-build29-restore-diagnostics/docs/BUILD_29_APP_STORE.md) if downloading is inconvenient.

[Download the ten iPad screenshots](https://github.com/jbatiste12-debug/BasketBoss/raw/refs/heads/build28-ipad-screenshots/app-store/ipad-build28/BasketBoss-iPad-13-inch-10-Screenshots.zip). Unzip and upload the ten PNGs under 13-inch iPad.
