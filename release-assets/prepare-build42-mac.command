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
BB42_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.2-build42.XXXXXX")"
BB42_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native42.XXXXXX")"
git clone --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB42_DIR"
cd "$BB42_DIR"
git fetch origin 1a36d99d4202afc411796885f4662719abf6c514
git checkout --detach 1a36d99d4202afc411796885f4662719abf6c514
npm ci --no-audit --no-fund
node tools/catalogue700/sync-ios.mjs --source-root "$BB42_DIR" --public-release "$BB42_DIR/catalogues/700/release" --output-dir "$BB42_STAGE"
open "$BB42_DIR/ios/App/App.xcworkspace"
printf '\nReady in Xcode: version 1.0.2, build 42.\nTest on your iPhone, then choose Product > Archive > Distribute App > App Store Connect > Upload.\nDo not run ordinary ios:sync after this launcher; it replaces the 700-recipe assets with the legacy catalogue.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB42_DIR"
