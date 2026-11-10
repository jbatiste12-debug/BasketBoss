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
BB40_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.2-build40.XXXXXX")"
BB40_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native40.XXXXXX")"
git clone --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB40_DIR"
cd "$BB40_DIR"
git checkout --detach 51b98814830a780fb4ca4ab8280156bc257dd4f6
npm ci --no-audit --no-fund
node tools/catalogue700/sync-ios.mjs --source-root "$BB40_DIR" --public-release "$BB40_DIR/catalogues/700/release" --output-dir "$BB40_STAGE"
open "$BB40_DIR/ios/App/App.xcworkspace"
printf '\nReady in Xcode: version 1.0.2, build 40.\nTest on your iPhone, then choose Product > Archive > Distribute App > App Store Connect > Upload.\nDo not run ordinary ios:sync after this launcher; it replaces the 700-recipe assets with the legacy catalogue.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB40_DIR"
