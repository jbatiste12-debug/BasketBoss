#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'Run this launcher on your Mac with Xcode installed.\n' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Install Node.js 22 or newer, then run this launcher again.\n' >&2
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Node.js 22 or newer is required.");process.exit(1)}'
xcode-select -p >/dev/null
BB43_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.2-build43.XXXXXX")"
BB43_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native43.XXXXXX")"
git clone --depth 1 --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB43_DIR"
cd "$BB43_DIR"
git fetch --depth 1 origin b6a8e2bcef58dfd73ede16d4ffbc064297ec47f5
git checkout --detach b6a8e2bcef58dfd73ede16d4ffbc064297ec47f5
npm ci --no-audit --no-fund
node tools/catalogue700/sync-ios.mjs --source-root "$BB43_DIR" --public-release "$BB43_DIR/catalogues/700/release" --output-dir "$BB43_STAGE"
open "$BB43_DIR/ios/App/App.xcworkspace"
printf '\nReady in Xcode: version 1.0.2, build 43.\nTo test: connect your iPhone, select it at the top of Xcode, then press the play button (Product > Run).\nWhen ready for TestFlight: select Any iOS Device, then Product > Archive > Distribute App > App Store Connect > Upload.\nSetup and syncing are already complete. You do not need any more Terminal commands.\nKeep this prepared project as it is; ordinary ios:sync would replace its recipe assets.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB43_DIR"
