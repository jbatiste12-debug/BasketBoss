# BasketBoss 1.0.2 — Build 36

Build 36 includes the forest-green app finish, a tidy two-row phone header and
faster Auto-fill calculations. It retains the versioned 700-recipe catalogue:
200 public Free recipes, 500 authenticated Premium recipes and optional breakfast
and dessert planning. Existing recipe data and positional ingredient arrays are
unchanged. See [the validation record](PREMIUM_UX_VALIDATION_20261110.md).

The PWA deploys separately. Installed iOS copies receive these client changes
after a signed new build is uploaded and distributed through TestFlight.

## Prepare a fresh Xcode workspace

Use Node 22 or later, CocoaPods and Xcode 26 or later on your Mac. Close any older
BasketBoss Xcode workspace before running the following block. This creates a
fresh folder and preserves your earlier project and signing edits. Run it after
the Build 36 changes are merged to `main`.

```sh
(
set -e
BB36_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.2-build36.XXXXXX")"
git clone --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB36_DIR"
cd "$BB36_DIR"
npm ci --no-audit --no-fund
BB36_OUTPUT="$(mktemp -d /tmp/basketboss-catalogue700-build36.XXXXXX)"
node tools/catalogue700/sync-ios.mjs \
  --source-root "$PWD" \
  --public-release "$PWD/catalogues/700/release" \
  --output-dir "$BB36_OUTPUT"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {validatePublic700Release,verify700Client} from './tools/catalogue700/build-client.mjs';
const root=process.cwd();
const project=fs.readFileSync('ios/App/App.xcodeproj/project.pbxproj','utf8');
assert.equal((project.match(/CURRENT_PROJECT_VERSION = 36;/g)||[]).length,2);
assert.equal((project.match(/MARKETING_VERSION = 1\.0\.2;/g)||[]).length,2);
const release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
const checked=verify700Client({directory:path.join(root,'ios/App/App/public'),release});
assert.equal(checked.freeRecipes,200);
assert.equal(checked.expectedPremium,500);
assert.equal(checked.privateRecipeBundle,false);
console.log('Verified Build 36: 200 Free recipes, 500 Premium fetched securely, no private recipe bundle.');
JS
open ios/App/App.xcworkspace
)
```

The block intentionally uses the explicit catalogue-700 sync. Do not run ordinary
`npm run ios:sync` afterward: it replaces the staged client with the legacy
catalogue package. Open `App.xcworkspace`, which includes the CocoaPods workspace.

## Archive and upload

In the **App** target, confirm **Version 1.0.2**, **Build 36**, team **Jason
Batiste (J25UTUATD2)** and bundle **uk.co.basketboss.app**. Keep automatic signing
enabled for the correct team. Build 36 follows the last known upload, Build 35;
if 36 has already been uploaded separately, select the next unused build number.

Select **Any iOS Device (arm64)**, then **Product → Archive**. In Organizer choose
**Distribute App → App Store Connect → Upload**. After Apple finishes processing,
select **1.0.2 (36)** in App Store Connect → BasketBoss → TestFlight and add it to
the intended internal group. External testing may require Apple's beta review.
Uploading to TestFlight does not submit a new public App Store release.

Test on a physical iPhone: the full region/Premium labels, all five tabs, dinner
Auto-fill and confirmation, one-day replacement, optional breakfast/dessert
selection, pantry multi-selection, shopping quantities and Cook instructions.
Verify sign-in and Restore Purchases with the appropriate Apple testing account.

## Signing boundary

The repository's macOS workflows compile the simulator app, run native checks and
create an **unsigned** iPhone archive with an asserted Build 36. They do not hold
distribution signing credentials or perform a TestFlight upload. The final signed
archive and upload use your Mac's existing Xcode Apple account and provisioning.

The separate owner-household switch remains default OFF unless explicitly
configured on the server; preparing or uploading Build 36 does not enable it.
