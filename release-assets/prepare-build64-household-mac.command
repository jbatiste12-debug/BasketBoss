#!/bin/bash
set -euo pipefail
bb64Mode() {
  if [[ "$#" -eq 0 ]]; then
    printf 'prepare\n'
  elif [[ "$#" -eq 1 && "$1" == '--archive' ]]; then
    printf 'archive\n'
  else
    printf 'Usage: bash prepare-build64-household-mac.command [--archive]\n' >&2
    return 2
  fi
}

bb64ProjectBuild() {
  node --input-type=module - "$1" "${2:-verify}" <<'BB64_PROJECT'
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
const prepared=builds.every(row=>row[1]==='64')&&versions.every(row=>row[1].trim()==='1.0.6');
if(mode==='prepare') {
  assert.ok(baseline||prepared,'Refusing unexpected or mixed app version/build settings. Expected source 1.0.2 (43) or prepared 1.0.6 (64).');
  const updated=prepared?original:original
    .replace(/(CURRENT_PROJECT_VERSION\s*=\s*)43(\s*;)/g,(_,before,after)=>before+'64'+after)
    .replace(/(MARKETING_VERSION\s*=\s*)1\.0\.2(\s*;)/g,(_,before,after)=>before+'1.0.6'+after);
  if(updated!==original)fs.writeFileSync(file,updated);
} else assert.ok(prepared,'The prepared project must remain version 1.0.6, Build 64 after syncing.');
console.log('Verified Xcode version 1.0.6, build 64.');
BB64_PROJECT
}

bb64ArchiveProject() {
  local bb64_project="$1" bb64_archive_base="$2" bb64_archive_path
  mkdir -p "$bb64_archive_base"
  bb64_archive_path="$bb64_archive_base/BasketBoss-1.0.6-build64-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  while [[ -e "$bb64_archive_path" ]]; do
    bb64_archive_path="$bb64_archive_base/BasketBoss-1.0.6-build64-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  done
  xcodebuild -workspace "$bb64_project/ios/App/App.xcworkspace" -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath "$bb64_archive_path" -allowProvisioningUpdates archive || return "$?"
  if [[ ! -d "$bb64_archive_path" ]]; then
    printf 'Xcode did not create the archive. Check the build output above.\n' >&2
    return 1
  fi
  local bb64_plist="$bb64_archive_path/Products/Applications/App.app/Info.plist"
  if [[ ! -f "$bb64_plist" ]]; then
    printf 'The archive is missing its app Info.plist.\n' >&2
    return 1
  fi
  local bb64_build bb64_version bb64_bundle
  bb64_build="$(plutil -extract CFBundleVersion raw -o - "$bb64_plist")" || return "$?"
  bb64_version="$(plutil -extract CFBundleShortVersionString raw -o - "$bb64_plist")" || return "$?"
  bb64_bundle="$(plutil -extract CFBundleIdentifier raw -o - "$bb64_plist")" || return "$?"
  if [[ "$bb64_build" != '64' || "$bb64_version" != '1.0.6' || "$bb64_bundle" != 'uk.co.basketboss.app' ]]; then
    printf 'Archive version, build or bundle ID does not match BasketBoss 1.0.6 (64).\n' >&2
    return 1
  fi
  open "$bb64_archive_path" || return "$?"
  printf '\nArchive ready: %s\nIn Xcode Organizer choose Distribute App > App Store Connect > Upload.\nThe archive has not been uploaded and your App Store submission has not changed.\n' "$bb64_archive_path"
}

BB64_MODE="$(bb64Mode "$@")"
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
BB64_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.6-build64.XXXXXX")"
BB64_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native64.XXXXXX")"
git clone --depth 1 --branch release/android12-household-sync-20261128 --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB64_DIR"
cd "$BB64_DIR"
git fetch --depth 1 origin 8ec8760669b017251a9fb09141275a4527cf72df
git checkout --detach 8ec8760669b017251a9fb09141275a4527cf72df
printf 'This candidate includes household sync. Deploy its matching backend before testing partner sync; phone testing is the default.\n'
npm ci --no-audit --no-fund
# Only native Xcode version settings change; the catalogue client protocol
# remains 1.0.2 because its verified recipe-release contract is independent.
bb64ProjectBuild "$BB64_DIR" prepare
node tools/catalogue700/sync-ios.mjs --source-root "$BB64_DIR" --public-release "$BB64_DIR/catalogues/700/release" --output-dir "$BB64_STAGE"
bb64ProjectBuild "$BB64_DIR" verify
if [[ "$BB64_MODE" == 'archive' ]]; then
  bb64ArchiveProject "$BB64_DIR" "$HOME/Library/Developer/Xcode/Archives/$(date '+%Y-%m-%d')"
else
  open "$BB64_DIR/ios/App/App.xcworkspace"
  printf '\nReady in Xcode: version 1.0.6, build 64.\nTo test: connect your iPhone, select it at the top of Xcode, then press the play button (Product > Run).\nWhen ready for TestFlight: select Any iOS Device, then Product > Archive > Distribute App > App Store Connect > Upload.\nSetup and syncing are already complete. You do not need any more Terminal commands.\n'
fi
printf '\nKeep this prepared project as it is; ordinary ios:sync would replace its recipe assets.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB64_DIR"
