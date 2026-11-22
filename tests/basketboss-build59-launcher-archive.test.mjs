import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('release-assets/prepare-build59-mac.command');
const functions=source.slice(source.indexOf('bb59Mode() {'),source.indexOf('\nBB59_MODE='));
assert.ok(functions.includes('bb59ProjectBuild() {')&&functions.includes('bb59ArchiveProject() {'));
const run=(script,args=[])=>spawnSync('bash',['-c',functions+'\n'+script,'build59-launcher-test',...args],{encoding:'utf8'});
const temporary=(t,name)=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),name));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return folder;};
const writeProject=(directory,project)=>{const file=path.join(directory,'ios/App/App.xcodeproj/project.pbxproj');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,project);return file;};
const originalProject=()=>read('ios/App/App.xcodeproj/project.pbxproj');

test('build 59 defaults to preparation and archives only with the explicit archive flag',()=>{
 for(const [args,expected]of [[[],'prepare\n'],[['--archive'],'archive\n']]){
  const result=run('bb59Mode "$@"',args);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,expected);
 }
 for(const args of [['--upload'],['--archive','--upload'],['archive'],['--build-number','59']]){
  const result=run('bb59Mode "$@"',args);assert.equal(result.status,2);assert.match(result.stderr,/Usage:.*prepare-build59.*\[--archive\]/);
 }
});

test('build 59 rejects an unpinned, malformed or ambiguous application source before preparation',()=>{
 for(const args of [[],['__BB59_APPROVED_VISUAL_SOURCE_COMMIT__'],['main'],['abc123'],['a'.repeat(39)],['a'.repeat(41)],['a'.repeat(40),'extra']]){
  const result=run('set -euo pipefail\nbb59Source "$@"',args);assert.equal(result.status,2);assert.match(result.stderr,/Pin Build 59 to the approved visual source commit/);
 }
 const result=run('set -euo pipefail\nbb59Source "$@"',['a'.repeat(40)]);assert.equal(result.status,0,result.stderr);
});

test('build 59 archives preserve spaced paths, verify actual app metadata, and open only unique validated archives',t=>{
 const folder=temporary(t,'bb59-archive-'),project=path.join(folder,'Prepared project with spaces'),archives=path.join(folder,'Archive folder','2026-11-22'),capture=path.join(folder,'calls');
 const script=String.raw`
set -euo pipefail
bb59_test_capture="$3"
xcodebuild() {
  printf 'xcodebuild\0' >> "$bb59_test_capture"
  printf '%s\0' "$@" >> "$bb59_test_capture"
  printf '\n' >> "$bb59_test_capture"
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == '-archivePath' ]]; then
      mkdir -p "$2/Products/Applications/App.app"
      printf '<plist/>' > "$2/Products/Applications/App.app/Info.plist"
      return 0
    fi
    shift
  done
  return 3
}
plutil() {
  printf 'plutil\0' >> "$bb59_test_capture"
  printf '%s\0' "$@" >> "$bb59_test_capture"
  printf '\n' >> "$bb59_test_capture"
  case "$2" in
    CFBundleVersion) printf '59\n' ;;
    CFBundleShortVersionString) printf '1.0.6\n' ;;
    CFBundleIdentifier) printf 'uk.co.basketboss.app\n' ;;
    *) return 4 ;;
  esac
}
open() { printf 'open\0%s\0\n' "$1" >> "$bb59_test_capture"; }
bb59ArchiveProject "$1" "$2"
bb59ArchiveProject "$1" "$2"
`;
 const result=run(script,[project,archives,capture]);assert.equal(result.status,0,result.stderr);
 const calls=fs.readFileSync(capture,'utf8').trimEnd().split('\n').map(line=>line.split('\0').filter(Boolean));assert.equal(calls.length,10);
 const paths=[];
 for(let index=0;index<calls.length;index+=5){
  const [command,...args]=calls[index];assert.equal(command,'xcodebuild');
  assert.deepEqual(args.slice(0,8),['-workspace',project+'/ios/App/App.xcworkspace','-scheme','App','-configuration','Release','-destination','generic/platform=iOS']);
  assert.equal(args[8],'-archivePath');const archive=args[9];paths.push(archive);assert.equal(path.dirname(archive),archives);
  assert.match(path.basename(archive),/^BasketBoss-1\.0\.6-build59-\d{6}-\d+-\d+\.xcarchive$/);
  assert.deepEqual(args.slice(10),['-allowProvisioningUpdates','archive']);
  for(const [offset,field]of [[1,'CFBundleVersion'],[2,'CFBundleShortVersionString'],[3,'CFBundleIdentifier']]){
   assert.deepEqual(calls[index+offset],['plutil','-extract',field,'raw','-o','-',archive+'/Products/Applications/App.app/Info.plist']);
  }
  assert.deepEqual(calls[index+4],['open',archive]);assert.ok(fs.statSync(archive).isDirectory());
 }
 assert.notEqual(paths[0],paths[1]);assert.match(result.stdout,/Distribute App > App Store Connect > Upload/);assert.match(result.stdout,/has not been uploaded/);
});

test('a failed build 59 archive cannot open Organizer or report a ready archive',t=>{
 const folder=temporary(t,'bb59-archive-failure-');
 for(const [name,exit,expected]of [['build fails',65,65],['archive missing',0,1]]){
  const result=run('set -euo pipefail\nxcodebuild() { return '+exit+'; }\nopen() { printf "unexpected-open\\n"; }\nbb59ArchiveProject "$1" "$2"',[path.join(folder,'project'),path.join(folder,name)]);
  assert.equal(result.status,expected,name);assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/);
  if(exit===0)assert.match(result.stderr,/Xcode did not create the archive/);
 }
});

test('an incorrect build 59 archive or unreadable app metadata cannot be opened',t=>{
 const folder=temporary(t,'bb59-metadata-failure-');
 const script=String.raw`
set -euo pipefail
bb59_test_fault="$3"
xcodebuild() {
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == '-archivePath' ]]; then
      mkdir -p "$2/Products/Applications/App.app"
      if [[ "$bb59_test_fault" != 'missing' ]]; then printf '<plist/>' > "$2/Products/Applications/App.app/Info.plist"; fi
      return 0
    fi
    shift
  done
  return 3
}
plutil() {
  if [[ "$bb59_test_fault" == 'unreadable' ]]; then return 71; fi
  case "$2" in
    CFBundleVersion) if [[ "$bb59_test_fault" == 'closed' ]]; then printf '49\n'; elif [[ "$bb59_test_fault" == 'previous' ]]; then printf '58\n'; elif [[ "$bb59_test_fault" == 'build' ]]; then printf '50\n'; else printf '59\n'; fi ;;
    CFBundleShortVersionString) if [[ "$bb59_test_fault" == 'version' || "$bb59_test_fault" == 'closed' ]]; then printf '1.0.3\n'; else printf '1.0.6\n'; fi ;;
    CFBundleIdentifier) if [[ "$bb59_test_fault" == 'bundle' ]]; then printf 'com.other.app\n'; else printf 'uk.co.basketboss.app\n'; fi ;;
    *) return 4 ;;
  esac
}
open() { printf 'unexpected-open\n'; }
bb59ArchiveProject "$1" "$2"
`;
 for(const fault of ['build','version','previous','closed','bundle','missing','unreadable']){
  const result=run(script,[path.join(folder,'project with spaces'),path.join(folder,'archives',fault),fault]);
  assert.equal(result.status,fault==='unreadable'?71:1,fault+': '+result.stderr);
  assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/,fault);
  if(fault==='missing')assert.match(result.stderr,/missing its app Info\.plist/);
  else if(fault!=='unreadable'){
   assert.match(result.stderr,/version, build or bundle ID does not match/);
   assert.match(result.stderr,/BasketBoss 1\.0\.6 \(59\)/,'archive failure identifies the correct release');
  }
 }
});

test('build 59 preparation changes only both native app version/build pairs and is idempotent',t=>{
 const folder=temporary(t,'bb59-project-'),project=path.join(folder,'Prepared project with spaces'),original=originalProject();
 assert.equal((original.match(/CURRENT_PROJECT_VERSION = 43;/g)||[]).length,2);
 assert.equal((original.match(/MARKETING_VERSION = 1\.0\.2;/g)||[]).length,2);
 const file=writeProject(project,original);
 const manifest=path.join(project,'catalogues/700/release/manifest.json');fs.mkdirSync(path.dirname(manifest),{recursive:true});
 const protocol='{"clientVersion":"1.0.2","catalogue_version":700}\n';fs.writeFileSync(manifest,protocol);
 const result=run('set -euo pipefail\nbb59ProjectBuild "$1" prepare\nbb59ProjectBuild "$1" verify\nbb59ProjectBuild "$1" prepare',[project]);
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.readFileSync(file,'utf8'),original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 59;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'));
 assert.equal(fs.readFileSync(manifest,'utf8'),protocol,'the internal catalogue/client contract is untouched');
 assert.match(result.stdout,/Verified Xcode version 1\.0\.6, build 59/);
});

test('build 59 project guards reject old, mixed, unexpected and malformed settings without changing them',t=>{
 const folder=temporary(t,'bb59-project-guards-'),original=originalProject();
 const cases=[
  ['verify old build',original,'verify'],
  ['unexpected build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 42;'),'prepare'],
  ['older prepared build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 44;'),'prepare'],
  ['closed release build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 49;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.3;'),'prepare'],
  ['previous release build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 55;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.5;'),'prepare'],
  ['previous Build 57',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 57;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['previous Build 58',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 58;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['mixed builds',original.replace('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 59;'),'prepare'],
  ['wrong marketing version',original.replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.7;'),'prepare'],
  ['mixed marketing versions',original.replace('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'verify'],
  ['partial marketing upgrade',original.replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['partial build upgrade',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 59;'),'prepare'],
  ['missing build setting',original.replace('CURRENT_PROJECT_VERSION = 43;',''),'prepare'],
  ['missing version setting',original.replace('MARKETING_VERSION = 1.0.2;',''),'prepare'],
  ['invalid mode',original,'upload'],
 ];
 for(const [name,value,mode]of cases){
  const project=path.join(folder,name),file=writeProject(project,value),result=run('set -euo pipefail\nbb59ProjectBuild "$1" "$2"',[project,mode]);
  assert.notEqual(result.status,0,name);assert.equal(fs.readFileSync(file,'utf8'),value,name+' must not alter the project');
 }
});

test('build 59 prepares and verifies the project around catalogue-700 sync before opening or archiving',()=>{
 const prepare=source.indexOf('bb59ProjectBuild "$BB59_DIR" prepare'),sync=source.indexOf('node tools/catalogue700/sync-ios.mjs'),verify=source.indexOf('bb59ProjectBuild "$BB59_DIR" verify'),handoff=source.indexOf('if [[ "$BB59_MODE" ==');
 assert.ok(prepare>=0&&sync>prepare&&verify>sync&&handoff>verify);
 assert.match(source,/bb59ArchiveProject "\$BB59_DIR" "\$HOME\/Library\/Developer\/Xcode\/Archives\/\$\(date '\+%Y-%m-%d'\)"/);
 assert.match(source,/open "\$BB59_DIR\/ios\/App\/App\.xcworkspace"/);
 const pinned=source.match(/^BB59_SOURCE='([a-f0-9]{40})'$/m);
 assert.ok(pinned,'Build 59 uses one explicit reviewed source pin, independent of the launcher commit');
 assert.equal(pinned[1],'3604d55abc06d3ad10458d62b88a80a30c56dbf8','Build 59 includes the approved My Week tidy and existing sync fixes');
 assert.match(source,/^git fetch --depth 1 origin "\$BB59_SOURCE"$/m);
 assert.match(source,/^git checkout --detach "\$BB59_SOURCE"$/m);
 assert.ok(source.indexOf('bb59Source "$BB59_SOURCE"')<source.indexOf('git clone'),'an unpinned launcher fails before cloning or preparing a project');
 assert.match(source,/BB59_DIR="\$\(mktemp -d \"\$HOME\/BasketBoss-1\.0\.6-build59\.XXXXXX\"\)"/,'each run creates a fresh Build 59 project');
 assert.match(source,/BB59_STAGE="\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/BasketBoss-native59\.XXXXXX"\)"/,'catalogue staging uses a fresh Build 59 temporary directory');
 assert.match(source,/^git clone --depth 1 --branch main --single-branch https:\/\/github\.com\/jbatiste12-debug\/BasketBoss\.git \"\$BB59_DIR\"$/m);
 assert.doesNotMatch(source,/BasketBoss-1\.0\.3-build49|BasketBoss-1\.0\.4-build5[01234]|BasketBoss-1\.0\.5-build55|BB49_DIR|BB50_DIR|BB51_DIR|BB52_DIR|BB53_DIR|BB54_DIR|BB55_DIR|BB57_DIR|BB58_DIR|BasketBoss-1\.0\.6-build5[78]/,'the new launcher cannot reuse an older prepared project');
 assert.doesNotMatch(source,/npm (?:run )?ios:sync|npx (?:cap|capacitor) sync/,'ordinary native syncing must not overwrite the verified 700-recipe assets');
 assert.doesNotMatch(source,/altool|notarytool|iTMSTransporter|-exportArchive|-upload-app|appstoreconnect/);
});

test('Build 59 leaves all Build 57 and 58 files, the native project baseline and catalogue protocol unchanged',()=>{
 for(const [file,expected]of [
  [
    "release-assets/build57-README.txt",
    "aad9455693978fcea8da3cc4dc213a440f75ed27b8aaeba2ff0504085e9e6809"
  ],
  [
    "release-assets/build57-phone-checklist.txt",
    "d25c2f95bf4d3b88e7b9752bc6a80ec78779336fe1a7592a7e1edd984c40e824"
  ],
  [
    "release-assets/build57-whats-new.txt",
    "fb8feaa473bdc3b38bed744647ddbcb5bcbee5be1969d2f57cb373aa2adb4f4a"
  ],
  [
    "release-assets/prepare-build57-mac.command",
    "2dcf850ec1813ebbbb52d1c75e56798469a863239e3b902396c0daea10cc2180"
  ],
  [
    "release-assets/prepare-build58-mac.command",
    "ba37a65621e9382c4149da5ee7d0b0866c3fda6c0652cea1e7a8cbac98e5d54b"
  ],
  [
    "tests/basketboss-build57-launcher-archive.test.mjs",
    "dd8ab3caa78afca6bfda0aef445073722b226579dffb478054f73b6b32219a8b"
  ],
  [
    "tests/basketboss-build58-launcher-archive.test.mjs",
    "4c05063113ad51c501ad4d7928f6bad4d0b6d6470f8bc00867b37f0373c9f5b5"
  ],
  [
    "catalogues/700/release/manifest.json",
    "251f655df6364d7daba1bfb214b3dfe0f92829a35da9cfd2bcb09412af37058b"
  ],
  [
    "ios/App/App.xcodeproj/project.pbxproj",
    "29365a13c9827b6745bbf98fd6d61347cb887a8a4dc964d198bf1c1cbfd321ec"
  ]
])assert.equal(createHash('sha256').update(read(file)).digest('hex'),expected,file);
 const project=originalProject();assert.equal((project.match(/CURRENT_PROJECT_VERSION = 43;/g)||[]).length,2);assert.equal((project.match(/MARKETING_VERSION = 1\.0\.2;/g)||[]).length,2);
 assert.equal(JSON.parse(read('catalogues/700/release/manifest.json')).clientVersion,'1.0.2');
});
