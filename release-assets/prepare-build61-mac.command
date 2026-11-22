#!/bin/bash
set -euo pipefail
bb61Mode() {
  if [[ "$#" -eq 0 ]]; then
    printf 'prepare\n'
  elif [[ "$#" -eq 1 && "$1" == '--archive' ]]; then
    printf 'archive\n'
  else
    printf 'Usage: bash prepare-build61-mac.command [--archive]\n' >&2
    return 2
  fi
}

bb61ProjectBuild() {
  node --input-type=module - "$1" "${2:-verify}" <<'BB61_PROJECT'
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
const prepared=builds.every(row=>row[1]==='61')&&versions.every(row=>row[1].trim()==='1.0.6');
if(mode==='prepare') {
  assert.ok(baseline||prepared,'Refusing unexpected or mixed app version/build settings. Expected source 1.0.2 (43) or prepared 1.0.6 (61).');
  const updated=prepared?original:original
    .replace(/(CURRENT_PROJECT_VERSION\s*=\s*)43(\s*;)/g,(_,before,after)=>before+'61'+after)
    .replace(/(MARKETING_VERSION\s*=\s*)1\.0\.2(\s*;)/g,(_,before,after)=>before+'1.0.6'+after);
  if(updated!==original)fs.writeFileSync(file,updated);
} else assert.ok(prepared,'The prepared project must remain version 1.0.6, Build 61 after syncing.');
console.log('Verified Xcode version 1.0.6, build 61.');
BB61_PROJECT
}

bb61ArchiveProject() {
  local bb61_project="$1" bb61_archive_base="$2" bb61_archive_path
  mkdir -p "$bb61_archive_base"
  bb61_archive_path="$bb61_archive_base/BasketBoss-1.0.6-build61-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  while [[ -e "$bb61_archive_path" ]]; do
    bb61_archive_path="$bb61_archive_base/BasketBoss-1.0.6-build61-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  done
  xcodebuild -workspace "$bb61_project/ios/App/App.xcworkspace" -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath "$bb61_archive_path" -allowProvisioningUpdates archive || return "$?"
  if [[ ! -d "$bb61_archive_path" ]]; then
    printf 'Xcode did not create the archive. Check the build output above.\n' >&2
    return 1
  fi
  local bb61_plist="$bb61_archive_path/Products/Applications/App.app/Info.plist"
  if [[ ! -f "$bb61_plist" ]]; then
    printf 'The archive is missing its app Info.plist.\n' >&2
    return 1
  fi
  local bb61_build bb61_version bb61_bundle
  bb61_build="$(plutil -extract CFBundleVersion raw -o - "$bb61_plist")" || return "$?"
  bb61_version="$(plutil -extract CFBundleShortVersionString raw -o - "$bb61_plist")" || return "$?"
  bb61_bundle="$(plutil -extract CFBundleIdentifier raw -o - "$bb61_plist")" || return "$?"
  if [[ "$bb61_build" != '61' || "$bb61_version" != '1.0.6' || "$bb61_bundle" != 'uk.co.basketboss.app' ]]; then
    printf 'Archive version, build or bundle ID does not match BasketBoss 1.0.6 (61).\n' >&2
    return 1
  fi
  open "$bb61_archive_path" || return "$?"
  printf '\nArchive ready: %s\nIn Xcode Organizer choose Distribute App > App Store Connect > Upload.\nThe archive has not been uploaded and your App Store submission has not changed.\n' "$bb61_archive_path"
}

bb61Source() {
  if [[ "$#" -ne 1 || ! "$1" =~ ^[a-f0-9]{40}$ ]]; then
    printf 'Pin Build 61 to the reviewed application source commit before running this launcher.\n' >&2
    return 2
  fi
}

BB61_MODE="$(bb61Mode "$@")"
# Pin to the reviewed application source, independently of this launcher commit.
BB61_SOURCE='510f3c75a76e4558b26792fd06162eee8efde31d'
bb61Source "$BB61_SOURCE"
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
BB61_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.6-build61.XXXXXX")"
BB61_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native61.XXXXXX")"
git clone --depth 1 --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB61_DIR"
cd "$BB61_DIR"
git fetch --depth 1 origin "$BB61_SOURCE"
git checkout --detach "$BB61_SOURCE"
npm ci --no-audit --no-fund
# Only native Xcode version settings change; the catalogue client protocol
# remains 1.0.2 because its verified recipe-release contract is independent.
bb61ProjectBuild "$BB61_DIR" prepare
node tools/catalogue700/sync-ios.mjs --source-root "$BB61_DIR" --public-release "$BB61_DIR/catalogues/700/release" --output-dir "$BB61_STAGE"
bb61ProjectBuild "$BB61_DIR" verify
if [[ "$BB61_MODE" == 'archive' ]]; then
  bb61ArchiveProject "$BB61_DIR" "$HOME/Library/Developer/Xcode/Archives/$(date '+%Y-%m-%d')"
else
  open "$BB61_DIR/ios/App/App.xcworkspace"
  printf '\nReady in Xcode: version 1.0.6, build 61.\nTo test: connect your iPhone, select it at the top of Xcode, then press the play button (Product > Run).\nWhen ready for TestFlight: select Any iOS Device, then Product > Archive > Distribute App > App Store Connect > Upload.\nSetup and syncing are already complete. You do not need any more Terminal commands.\n'
fi
printf '\nKeep this prepared project as it is; ordinary ios:sync would replace its recipe assets.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB61_DIR"
