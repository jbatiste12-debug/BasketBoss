#!/bin/bash
set -euo pipefail
bb54Mode() {
  if [[ "$#" -eq 0 ]]; then
    printf 'prepare\n'
  elif [[ "$#" -eq 1 && "$1" == '--archive' ]]; then
    printf 'archive\n'
  else
    printf 'Usage: bash prepare-build54-mac.command [--archive]\n' >&2
    return 2
  fi
}

bb54ProjectBuild() {
  node --input-type=module - "$1" "${2:-verify}" <<'BB54_PROJECT'
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const file=path.join(process.argv[2],'ios/App/App.xcodeproj/project.pbxproj');
const mode=process.argv[3],original=fs.readFileSync(file,'utf8');
assert.ok(['prepare','verify'].includes(mode),'Invalid build preparation mode.');
const builds=[...original.matchAll(/CURRENT_PROJECT_VERSION\s*=\s*(\d+)\s*;/g)];
const versions=[...original.matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)];
assert.equal(builds.length,2,'Expected both App Debug and Release build settings.');
assert.equal(versions.length,2,'Expected both App Debug and Release version settings.');
const baseline=builds.every(row=>row[1]==='43')&&versions.every(row=>row[1].trim()==='1.0.2');
const prepared=builds.every(row=>row[1]==='54')&&versions.every(row=>row[1].trim()==='1.0.4');
if(mode==='prepare') {
  assert.ok(baseline||prepared,'Refusing unexpected or mixed app version/build settings. Expected source 1.0.2 (43) or prepared 1.0.4 (54).');
  const updated=prepared?original:original
    .replace(/(CURRENT_PROJECT_VERSION\s*=\s*)43(\s*;)/g,(_,before,after)=>before+'54'+after)
    .replace(/(MARKETING_VERSION\s*=\s*)1\.0\.2(\s*;)/g,(_,before,after)=>before+'1.0.4'+after);
  if(updated!==original)fs.writeFileSync(file,updated);
} else assert.ok(prepared,'The prepared project must remain version 1.0.4, Build 54 after syncing.');
console.log('Verified Xcode version 1.0.4, build 54.');
BB54_PROJECT
}

bb54ArchiveProject() {
  local bb54_project="$1" bb54_archive_base="$2" bb54_archive_path
  mkdir -p "$bb54_archive_base"
  bb54_archive_path="$bb54_archive_base/BasketBoss-1.0.4-build54-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  while [[ -e "$bb54_archive_path" ]]; do
    bb54_archive_path="$bb54_archive_base/BasketBoss-1.0.4-build54-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  done
  xcodebuild -workspace "$bb54_project/ios/App/App.xcworkspace" -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath "$bb54_archive_path" -allowProvisioningUpdates archive || return "$?"
  if [[ ! -d "$bb54_archive_path" ]]; then
    printf 'Xcode did not create the archive. Check the build output above.\n' >&2
    return 1
  fi
  local bb54_plist="$bb54_archive_path/Products/Applications/App.app/Info.plist"
  if [[ ! -f "$bb54_plist" ]]; then
    printf 'The archive is missing its app Info.plist.\n' >&2
    return 1
  fi
  local bb54_build bb54_version bb54_bundle
  bb54_build="$(plutil -extract CFBundleVersion raw -o - "$bb54_plist")" || return "$?"
  bb54_version="$(plutil -extract CFBundleShortVersionString raw -o - "$bb54_plist")" || return "$?"
  bb54_bundle="$(plutil -extract CFBundleIdentifier raw -o - "$bb54_plist")" || return "$?"
  if [[ "$bb54_build" != '54' || "$bb54_version" != '1.0.4' || "$bb54_bundle" != 'uk.co.basketboss.app' ]]; then
    printf 'Archive version, build or bundle ID does not match BasketBoss 1.0.4 (54).\n' >&2
    return 1
  fi
  open "$bb54_archive_path" || return "$?"
  printf '\nArchive ready: %s\nIn Xcode Organizer choose Distribute App > App Store Connect > Upload.\nThe archive has not been uploaded and your App Store submission has not changed.\n' "$bb54_archive_path"
}

BB54_MODE="$(bb54Mode "$@")"
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
BB54_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.4-build54.XXXXXX")"
BB54_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native54.XXXXXX")"
git clone --depth 1 --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB54_DIR"
cd "$BB54_DIR"
git fetch --depth 1 origin 0c19df9f20adacac86d774d9909c17b0db222a0b
git checkout --detach 0c19df9f20adacac86d774d9909c17b0db222a0b
npm ci --no-audit --no-fund
# Only native Xcode version settings change; the catalogue client protocol
# remains 1.0.2 because its verified recipe-release contract is independent.
bb54ProjectBuild "$BB54_DIR" prepare
node tools/catalogue700/sync-ios.mjs --source-root "$BB54_DIR" --public-release "$BB54_DIR/catalogues/700/release" --output-dir "$BB54_STAGE"
bb54ProjectBuild "$BB54_DIR" verify
if [[ "$BB54_MODE" == 'archive' ]]; then
  bb54ArchiveProject "$BB54_DIR" "$HOME/Library/Developer/Xcode/Archives/$(date '+%Y-%m-%d')"
else
  open "$BB54_DIR/ios/App/App.xcworkspace"
  printf '\nReady in Xcode: version 1.0.4, build 54.\nTo test: connect your iPhone, select it at the top of Xcode, then press the play button (Product > Run).\nWhen ready for TestFlight: select Any iOS Device, then Product > Archive > Distribute App > App Store Connect > Upload.\nSetup and syncing are already complete. You do not need any more Terminal commands.\n'
fi
printf '\nKeep this prepared project as it is; ordinary ios:sync would replace its recipe assets.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB54_DIR"
