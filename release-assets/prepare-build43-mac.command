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
git fetch --depth 1 origin 364b24379ab55a304a4e7e69283a655fe46c760f
git checkout --detach 364b24379ab55a304a4e7e69283a655fe46c760f
npm ci --no-audit --no-fund
node tools/catalogue700/sync-ios.mjs --source-root "$BB43_DIR" --public-release "$BB43_DIR/catalogues/700/release" --output-dir "$BB43_STAGE"
open "$BB43_DIR/ios/App/App.xcworkspace"
printf '\nReady in Xcode: version 1.0.2, build 43.\nTest on your iPhone, then choose Product > Archive > Distribute App > App Store Connect > Upload.\nDo not run ordinary ios:sync after this launcher; it replaces the 700-recipe assets with the legacy catalogue.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB43_DIR"
