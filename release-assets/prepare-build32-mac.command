#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Run this on your Mac with Xcode 26+, Node 22+ and CocoaPods installed."
  exit 1
fi
for bb_command in git node npm pod xcrun; do
  command -v "$bb_command" >/dev/null || { echo "Missing $bb_command. Install it before continuing."; exit 1; }
done

bb_release_ref='appstore-1.0.1-build32-pantry-final'
bb_release_dir="$(mktemp -d "${HOME}/BasketBoss-1.0.1-build32-XXXXXX")"
git -c http.version=HTTP/1.1 clone --depth 1 --branch "$bb_release_ref" https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir"
cd "$bb_release_dir"
npm ci --no-audit --no-fund

# Change only the fresh release checkout. Keep the existing signing team and
# bundle identifier, and set a new version/build for the App Store update.
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='ios/App/App.xcodeproj/project.pbxproj';
let project=fs.readFileSync(file,'utf8');
assert.equal([...project.matchAll(/CURRENT_PROJECT_VERSION\s*=\s*[^;]+;/g)].length,2,'Expected Debug and Release build settings');
assert.equal([...project.matchAll(/MARKETING_VERSION\s*=\s*[^;]+;/g)].length,2,'Expected Debug and Release version settings');
project=project.replace(/CURRENT_PROJECT_VERSION\s*=\s*[^;]+;/g,'CURRENT_PROJECT_VERSION = 32;').replace(/MARKETING_VERSION\s*=\s*[^;]+;/g,'MARKETING_VERSION = 1.0.1;');
fs.writeFileSync(file,project);
NODE

npm run ios:sync
open ios/App/App.xcworkspace
echo "BasketBoss 1.0.1 (Build 32) is ready in $bb_release_dir"
echo "In Xcode select Any iOS Device (arm64), then Product > Archive."
echo "Upload through Organizer, then select Build 32 for version 1.0.1 in App Store Connect."
