# BasketBoss 1.0 (10) — clearer At home controls

Build 10 carries the latest Build 9 kitchen workflow and the production PWA
release, plus the At home layout fixes. Its fixed source tag is
`testflight-build10-home-ui`. Earlier TestFlight and PWA tags remain unchanged.

## Included in this build

- Clear, evenly sized Choose food / Weekly essentials tabs with a visible
  selected state. Food and household controls keep their existing quantities,
  saved stock and handlers when switching sections.
- Readable manual food entry on phones: enough room for item name, quantity,
  unit and Add, with expanded quantity controls beside the selected food.
- A compact At home branding row with the original region, membership and
  Settings actions. The existing compact Plan header remains available.
- The running pantry balance, live Shop shortfall, UK/US unit conversions,
  manual top-ups, cupboard-staple reminders, saved weeks and pantry-aware
  Auto-fill from Build 9.
- Conversational Cook Mentor with progressive sentence playback and native
  speech endpoint detection, plus the existing Premium photo-to-meal tools.

Normal Premium verification and paywalls remain in place. Eligible TestFlight
beta access still uses the signed-in account and Apple-signed app proof.
The web app keeps its separate, normal web subscription flow.

## Validation and remaining device checks

Full regression suite: 2,026 passed, zero failures, one Swift-only fixture
skipped on Linux, and two existing TODO cases. Phone/tablet/desktop checks cover
readable 44 px controls, quantity edits, stock conversion and live Shop updates
in UK and US displays. Plan header/popover/navigation checks also pass.
Native packaging and portable iOS verification pass with 914 assets, 100 Free
recipes and no private Premium recipe bundle. Source build numbers are 10 in
both Debug and Release; CI checks the unsigned archive build and bundle ID.

Packaging and portable checks do not verify Apple signing or upload a build.
Actual Xcode compilation, device keyboard/layout behavior and microphone/audio
performance must be checked on macOS or in the native CI run. No signed Apple
upload is performed by these terminal commands.

## Fresh Mac checkout and Xcode upload

Use Xcode 26+, Node 22+ and CocoaPods. A new folder preserves local changes and
signing edits in previous checkouts:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build10-XXXXXX")" &&
git clone --depth 1 --branch testflight-build10-home-ui \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

In Xcode confirm Version **1.0**, Build **10**, team **Jason Batiste
(J25UTUATD2)** and bundle ID **uk.co.basketboss.app**. If Build 10 has already
been uploaded to Apple, change the Build field to the next unused number
before archiving this source.

Select **Any iOS Device (arm64)**, then choose **Product → Archive**. In
Organizer, use **Distribute App → App Store Connect → Upload**. After Apple
processing, assign the uploaded build to your TestFlight group and paste
[the Build 10 tester notes](../release-assets/build10-what-to-test.txt).

Do not press Run with Any iOS Device selected; Run needs a connected iPhone
or an available simulator. The generic device destination is for archiving.

## Production service compatibility

The PWA and iOS use the same verified backend membership and quantity rules.
The production receipt auto-stock and fractional-balance upgrades were applied
and verified during the PWA rollout; enabled service flags and verified Premium
remain required. See [the PWA release record](PWA_RELEASE_20261104.md).
Building or installing this client does not rerun database migrations or change
the user's membership, saved plan or pantry balance.
