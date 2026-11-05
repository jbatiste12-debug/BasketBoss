# BasketBoss 1.0 (18) — Cook content and presentation

Build 18 includes Build 17 and cleans up Cook instructions, prep guidance and AI method parsing. It also refines the Cook card, typography, progress indicator, Kitchen tip and timer surfaces without changing the screen structure or controls.

## Included

- All 100 public recipes reviewed: 90 methods corrected and 254 misleading ingredient prep notes replaced. Method/steps and the four dessert copies stay synchronized. Ingredient amounts, units, prices, allergens and total recipe times are preserved.
- A shared method parser handles numbered/bulleted markdown, wrapped instructions and structured recipe objects. Invalid imported cards are rejected rather than silently shifting the current step. Explicit prep comes before its cooking action; equivalent prawn doneness instructions no longer repeat.
- Cook display, speech and Chef Boss context use the same normalized method. Timers use the matching source card, so moving prep text ahead of cooking cannot accidentally change the suggested timer. Prep/Back/Next navigation retains its existing state and completion behaviour.
- Cook uses a subtle layered cream card, clearer action typography, refined progress track and coordinated tip/timer tools. The 375px browser check covers closed/open tools, running timer, Next, Back and focus states, with zero horizontal overflow and unchanged control dimensions.
- Protected recipe content remains server-side. Current Premium source is retrieved through a SELECT-only audit and encrypted review transport; no private catalogue is shipped in the app bundle. See the full content audit record for the protected review outcome and any author-review findings.

## Verification and scope

The full regression suite uses isolated PostgreSQL and mocked provider/auth responses. Strict pantry TypeScript contracts, native packaging and portable iOS verification pass with 935 client files and 100 free recipes. Native simulator/archive checks are tracked in GitHub Actions. Remaining author-supplied recipe gaps are flagged rather than filled with invented quantities, temperatures or durations.

## Open in Xcode

Use Node 22+, CocoaPods and Xcode 26+ on your Mac:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build18-XXXXXX")" &&
git clone --depth 1 --branch testflight-build18-cook-audit \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Check Version 1.0, Build 18, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Choose **Any iOS Device (arm64)** → **Product → Archive** → **Distribute App → App Store Connect → Upload**. Use the next unused build number if 18 has already been uploaded.

The merged PWA deploys independently. Existing TestFlight binaries receive client parsing and styling changes after the new signed upload from your Mac.

Tester notes: [build18-what-to-test.txt](../release-assets/build18-what-to-test.txt).
