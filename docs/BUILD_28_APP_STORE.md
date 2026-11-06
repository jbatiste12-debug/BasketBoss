# BasketBoss 1.0 (28) — App Store submission candidate

Build 28 fixes the At home search/add handoff and removes the TestFlight beta activation control from the shipping iOS membership screens. The real monthly and annual StoreKit options remain available, with existing server verification and Sandbox review authorization. Existing verified complimentary access remains valid. The website retains its web Free/Premium plans and Paddle checkout.

Pantry search should find recognised foods even before they are saved in stock. Adding from search carries the food name into the separate editor and uses existing catalogue metadata and meal requirements. Custom foods still allow manual names and quantities. Inputs remain local drafts until confirmation; inventory allocation, buffer and pack-rounding math are unchanged. The PWA cache and pantry asset versions are advanced with this fix.

A separate Build 27 Intel keyboard test failed while waiting for cold-start readiness before any keyboard assertions. The equivalent four-case keyboard suite passed in its Apple workflow. Build 28 gives startup a bounded condition-based allowance with safe diagnostics; it keeps all four tests and their interaction/geometry checks. New native results are required for this candidate.

The cloud-backup table was created and verified in the configured Supabase project on 6 November 2026. Its migration history matches `20261106120712_basketboss_data_cloud_backup.sql`. This database setup does not require another client build.

## Upload on the Mac

Use the verified `appstore-build28-submission` tag once the release handoff confirms it exists:

~~~bash
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build28-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --branch appstore-build28-submission https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
~~~

Use Node 22+, CocoaPods and Xcode 26+. Confirm Version 1.0 / Build 28, bundle `uk.co.basketboss.app`, team `J25UTUATD2`. Choose Any iOS Device (arm64), Product → Archive, then Distribute App → App Store Connect → Upload. Use the next unused build number if 28 was already uploaded. Signing/upload require the Mac and developer's Apple account.

After processing, select Build 28 on the App Store version 1.0 page, include monthly and annual subscriptions, complete required metadata and review-account fields, then Add for Review and Submit for Review. See [submission steps and review notes](APP_STORE_SUBMISSION.md) and [suggested store copy](APP_STORE_METADATA.txt).

Local simulation and StoreKitTest do not establish live Apple Sandbox verification or App Store Connect readiness. The final handoff records exact test/deployment results. A real Sandbox purchase and restore with the confirmed, server-authorized review account remain external checks.
