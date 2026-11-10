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
BB39_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.2-build39.XXXXXX")"
BB39_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native39.XXXXXX")"
git clone --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB39_DIR"
cd "$BB39_DIR"
git checkout --detach c2d2bec0a124b985768da186546cfc2639ca3370
npm ci --no-audit --no-fund
node tools/catalogue700/sync-ios.mjs --source-root "$BB39_DIR" --public-release "$BB39_DIR/catalogues/700/release" --output-dir "$BB39_STAGE"
open "$BB39_DIR/ios/App/App.xcworkspace"
printf '\nReady in Xcode: version 1.0.2, build 39.\nTest on your iPhone, then choose Product > Archive > Distribute App > App Store Connect > Upload.\nDo not run ordinary ios:sync after this launcher; it replaces the 700-recipe assets with the legacy catalogue.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB39_DIR"
