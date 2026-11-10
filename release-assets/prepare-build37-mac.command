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
BB37_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.2-build37.XXXXXX")"
BB37_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native37.XXXXXX")"
git clone --branch fix/inventory-math-regression --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB37_DIR"
cd "$BB37_DIR"
git checkout --detach 50067bb4608f5c7b805a6aafdab16d4915ed3c8c
npm ci --no-audit --no-fund
node tools/catalogue700/sync-ios.mjs --source-root "$BB37_DIR" --public-release "$BB37_DIR/catalogues/700/release" --output-dir "$BB37_STAGE"
open "$BB37_DIR/ios/App/App.xcworkspace"
printf '\nReady in Xcode: version 1.0.2, build 37.\nTest on your iPhone, then choose Product > Archive > Distribute App > App Store Connect > Upload.\nDo not run ordinary ios:sync after this launcher; it replaces the 700-recipe assets with the legacy catalogue.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB37_DIR"
