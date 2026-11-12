#!/bin/bash
set -euo pipefail
bb44Mode() {
  if [[ "$#" -eq 0 ]]; then
    printf 'prepare\n'
  elif [[ "$#" -eq 1 && "$1" == '--archive' ]]; then
    printf 'archive\n'
  else
    printf 'Usage: bash prepare-build44-mac.command [--archive]\n' >&2
    return 2
  fi
}

bb44ProjectBuild() {
  node --input-type=module - "$1" "${2:-verify}" <<'BB44_PROJECT'
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
assert.ok(versions.every(row=>row[1].trim()==='1.0.2'),'The submitted app version must remain 1.0.2.');
if(mode==='prepare') {
  assert.ok(builds.every(row=>row[1]==='43')||builds.every(row=>row[1]==='44'),'Refusing to replace an unexpected build number.');
  const updated=original.replace(/(CURRENT_PROJECT_VERSION\s*=\s*)\d+(\s*;)/g,(_,before,after)=>before+'44'+after);
  if(updated!==original)fs.writeFileSync(file,updated);
} else assert.ok(builds.every(row=>row[1]==='44'),'The prepared project must remain Build 44 after syncing.');
console.log('Verified Xcode version 1.0.2, build 44.');
BB44_PROJECT
}

bb44ArchiveProject() {
  local bb44_project="$1" bb44_archive_base="$2" bb44_archive_path
  mkdir -p "$bb44_archive_base"
  bb44_archive_path="$bb44_archive_base/BasketBoss-1.0.2-build44-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  while [[ -e "$bb44_archive_path" ]]; do
    bb44_archive_path="$bb44_archive_base/BasketBoss-1.0.2-build44-$(date '+%H%M%S')-$$-$RANDOM.xcarchive"
  done
  xcodebuild -workspace "$bb44_project/ios/App/App.xcworkspace" -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath "$bb44_archive_path" -allowProvisioningUpdates archive || return "$?"
  if [[ ! -d "$bb44_archive_path" ]]; then
    printf 'Xcode did not create the archive. Check the build output above.\n' >&2
    return 1
  fi
  local bb44_plist="$bb44_archive_path/Products/Applications/App.app/Info.plist"
  if [[ ! -f "$bb44_plist" ]]; then
    printf 'The archive is missing its app Info.plist.\n' >&2
    return 1
  fi
  local bb44_build bb44_version bb44_bundle
  bb44_build="$(plutil -extract CFBundleVersion raw -o - "$bb44_plist")" || return "$?"
  bb44_version="$(plutil -extract CFBundleShortVersionString raw -o - "$bb44_plist")" || return "$?"
  bb44_bundle="$(plutil -extract CFBundleIdentifier raw -o - "$bb44_plist")" || return "$?"
  if [[ "$bb44_build" != '44' || "$bb44_version" != '1.0.2' || "$bb44_bundle" != 'uk.co.basketboss.app' ]]; then
    printf 'Archive version, build or bundle ID does not match BasketBoss 1.0.2 (44).\n' >&2
    return 1
  fi
  open "$bb44_archive_path" || return "$?"
  printf '\nArchive ready: %s\nIn Xcode Organizer choose Distribute App > App Store Connect > Upload.\nThe archive has not been uploaded and your App Store submission has not changed.\n' "$bb44_archive_path"
}

BB44_MODE="$(bb44Mode "$@")"
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
BB44_DIR="$(mktemp -d "$HOME/BasketBoss-1.0.2-build44.XXXXXX")"
BB44_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/BasketBoss-native44.XXXXXX")"
git clone --depth 1 --branch main --single-branch https://github.com/jbatiste12-debug/BasketBoss.git "$BB44_DIR"
cd "$BB44_DIR"
git fetch --depth 1 origin 8104e4ea616fcf7b2aa5f4ddd7f13450b6b9cf5d
git checkout --detach 8104e4ea616fcf7b2aa5f4ddd7f13450b6b9cf5d
npm ci --no-audit --no-fund
bb44ProjectBuild "$BB44_DIR" prepare
node tools/catalogue700/sync-ios.mjs --source-root "$BB44_DIR" --public-release "$BB44_DIR/catalogues/700/release" --output-dir "$BB44_STAGE"
bb44ProjectBuild "$BB44_DIR" verify
if [[ "$BB44_MODE" == 'archive' ]]; then
  bb44ArchiveProject "$BB44_DIR" "$HOME/Library/Developer/Xcode/Archives/$(date '+%Y-%m-%d')"
else
  open "$BB44_DIR/ios/App/App.xcworkspace"
  printf '\nReady in Xcode: version 1.0.2, build 44.\nTo test: connect your iPhone, select it at the top of Xcode, then press the play button (Product > Run).\nWhen ready for TestFlight: select Any iOS Device, then Product > Archive > Distribute App > App Store Connect > Upload.\nSetup and syncing are already complete. You do not need any more Terminal commands.\n'
fi
printf '\nKeep this prepared project as it is; ordinary ios:sync would replace its recipe assets.\nYour current App Store submission has not been changed.\nSource folder: %s\n' "$BB44_DIR"
