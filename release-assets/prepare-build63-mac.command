#!/bin/bash
set -euo pipefail
bb63Mode() {
  if [[ "$#" -eq 0 ]]; then
    printf 'prepare\n'
  elif [[ "$#" -eq 1 && "$1" == '--archive' ]]; then
    printf 'archive\n'
  else
    printf 'Usage: bash prepare-build63-mac.command [--archive]\n' >&2
    return 2
  fi
}

bb63ProjectBuild() {
  node --input-type=module - "$1" "${2:-verify}" <<'BB63_PROJECT'
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
const teams=[...original.matchAll(/DEVELOPMENT_TEAM\s*=\s*([^;]+);/g)];
const bundles=[...original.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)];
assert.equal(teams.length,2,'Expected both App signing team settings.');
assert.equal(bundles.length,2,'Expected both App bundle identifier settings.');
assert.ok(teams.every(row=>row[1].trim()==='J25UTUATD2'),'Keep the existing BasketBoss Apple development team.');
assert.ok(bundles.every(row=>row[1].trim()==='uk.co.basketboss.app'),'Keep the existing BasketBoss bundle identifier.');
const baseline=builds.every(row=>row[1]==='43')&&versions.every(row=>row[1].trim()==='1.0.2');
const prepared=builds.every(row=>row[1]==='63')&&versions.every(row=>row[1].trim()==='1.0.6');
if(mode==='prepare') {
  assert.ok(baseline||prepared,'Refusing unexpected or mixed app version/build settings. Expected source 1.0.2 (43) or prepared 1.0.6 (63).');
  const updated=prepared?original:original
    .replace(/(CURRENT_PROJECT_VERSION\s*=\s*)43(\s*;)/g,(_,before,after)=>before+'63'+after)
    .replace(/(MARKETING_VERSION\s*=\s*)1\.0\.2(\s*;)/g,(_,before,after)=>before+'1.0.6'+after);
  if(updated!==original)fs.writeFileSync(file,updated);
} else assert.ok(prepared,'The prepared project must remain version 1.0.6, Build 63 after syncing.');
console.log('Verified Xcode version 1.0.6, build 63.');
BB63_PROJECT
}

bb63ArchiveProject() {
  local bb63_project="$1" bb63_archive_base="$2" bb63_archive_path
  mkdir -p "$bb63_archive_base"
  bb63_archive_path="$bb63_archive_base/BasketBoss-1.0.6-build63-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  while [[ -e "$bb63_archive_path" ]]; do
    bb63_archive_path="$bb63_archive_base/BasketBoss-1.0.6-build63-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  done
  xcodebuild -workspace "$bb63_project/ios/App/App.xcworkspace" -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath "$bb63_archive_path" -allowProvisioningUpdates archive || return "$?"
  if [[ ! -d "$bb63_archive_path" ]]; then
    printf 'Xcode did not create the archive. Check the build output above.\n' >&2
    return 1
  fi
  local bb63_plist="$bb63_archive_path/Products/Applications/App.app/Info.plist"
  if [[ ! -f "$bb63_plist" ]]; then
    printf 'The archive is missing its app Info.plist.\n' >&2
    return 1
  fi
  local bb63_build bb63_version bb63_bundle
  bb63_build="$(plutil -extract CFBundleVersion raw -o - "$bb63_plist")" || return "$?"
  bb63_version="$(plutil -extract CFBundleShortVersionString raw -o - "$bb63_plist")" || return "$?"
  bb63_bundle="$(plutil -extract CFBundleIdentifier raw -o - "$bb63_plist")" || return "$?"
  if [[ "$bb63_build" != '63' || "$bb63_version" != '1.0.6' || "$bb63_bundle" != 'uk.co.basketboss.app' ]]; then
    printf 'Archive version, build or bundle ID does not match BasketBoss 1.0.6 (63).\n' >&2
    return 1
  fi
  open "$bb63_archive_path" || return "$?"
  printf '\nArchive ready: %s\nIn Xcode Organizer choose Distribute App > App Store Connect > Upload.\nThe archive has not been uploaded and your App Store submission has not changed.\n' "$bb63_archive_path"
}

bb63Source() {
  if [[ "$#" -ne 1 || ! "$1" =~ ^[a-f0-9]{40}$ ]]; then
    printf 'Pin Build 63 to the reviewed application source commit before running this launcher.\n' >&2
    return 2
  fi
}

BB63_MODE="$(bb63Mode "$@")"
# Pin to the reviewed application source, independently of this launcher commit.
BB63_SOURCE='5cc8dff12093aa6c0b9821306ec19c1edc6778c4'
bb63Source "$BB63_SOURCE"
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
BB63_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.6-build63.XXXXXX")"
BB63_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native63.XXXXXX")"
git clone --depth 1 --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB63_DIR"
cd "$BB63_DIR"
git fetch --depth 1 origin "$BB63_SOURCE"
git checkout --detach "$BB63_SOURCE"
npm ci --no-audit --no-fund
# Only native Xcode version settings change; the catalogue client protocol
# remains 1.0.2 because its verified recipe-release contract is independent.
bb63ProjectBuild "$BB63_DIR" prepare
node tools/catalogue700/sync-ios.mjs --source-root "$BB63_DIR" --public-release "$BB63_DIR/catalogues/700/release" --output-dir "$BB63_STAGE"
bb63ProjectBuild "$BB63_DIR" verify
if [[ "$BB63_MODE" == 'archive' ]]; then
  bb63ArchiveProject "$BB63_DIR" "$HOME/Library/Developer/Xcode/Archives/$(date '+%Y-%m-%d')"
else
  open "$BB63_DIR/ios/App/App.xcworkspace"
  printf '\nReady in Xcode: version 1.0.6, build 63.\nTo test: connect your iPhone, select it at the top of Xcode, then press the play button (Product > Run).\nWhen ready for TestFlight: select Any iOS Device, then Product > Archive > Distribute App > App Store Connect > Upload.\nSetup and syncing are already complete. You do not need any more Terminal commands.\n'
fi
printf '\nKeep this prepared project as it is; ordinary ios:sync would replace its recipe assets.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB63_DIR"
