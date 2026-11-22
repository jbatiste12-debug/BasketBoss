import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('release-assets/prepare-build63-mac.command');
const functions=source.slice(source.indexOf('bb63Mode() {'),source.indexOf('\nBB63_MODE='));
assert.ok(functions.includes('bb63ProjectBuild() {')&&functions.includes('bb63ArchiveProject() {'));
const run=(script,args=[])=>spawnSync('bash',['-c',functions+'\n'+script,'build63-launcher-test',...args],{encoding:'utf8'});
const temporary=(t,name)=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),name));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return folder;};
const writeProject=(directory,project)=>{const file=path.join(directory,'ios/App/App.xcodeproj/project.pbxproj');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,project);return file;};
const originalProject=()=>read('ios/App/App.xcodeproj/project.pbxproj');

test('build 63 defaults to preparation and archives only with the explicit archive flag',()=>{
 for(const [args,expected]of [[[],'prepare\n'],[['--archive'],'archive\n']]){
  const result=run('bb63Mode "$@"',args);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,expected);
 }
 for(const args of [['--upload'],['--archive','--upload'],['archive'],['--build-number','63']]){
  const result=run('bb63Mode "$@"',args);assert.equal(result.status,2);assert.match(result.stderr,/Usage:.*prepare-build63.*\[--archive\]/);
 }
});

test('build 63 rejects an unpinned, malformed or ambiguous application source before preparation',()=>{
 for(const args of [[],['SOURCE_COMMIT_PENDING'],['__BB63_APPROVED_VISUAL_SOURCE_COMMIT__'],['main'],['abc123'],['a'.repeat(39)],['a'.repeat(41)],['a'.repeat(40),'extra']]){
  const result=run('set -euo pipefail\nbb63Source "$@"',args);assert.equal(result.status,2);assert.match(result.stderr,/Pin Build 63 to the reviewed application source commit/);
 }
 const result=run('set -euo pipefail\nbb63Source "$@"',['a'.repeat(40)]);assert.equal(result.status,0,result.stderr);
});

test('build 63 archives preserve spaced paths, verify actual app metadata, and open only unique validated archives',t=>{
 const folder=temporary(t,'bb63-archive-'),project=path.join(folder,'Prepared project with spaces'),archives=path.join(folder,'Archive folder','2026-11-22'),capture=path.join(folder,'calls');
 const script=String.raw`
set -euo pipefail
bb63_test_capture="$3"
xcodebuild() {
  printf 'xcodebuild\0' >> "$bb63_test_capture"
  printf '%s\0' "$@" >> "$bb63_test_capture"
  printf '\n' >> "$bb63_test_capture"
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
  printf 'plutil\0' >> "$bb63_test_capture"
  printf '%s\0' "$@" >> "$bb63_test_capture"
  printf '\n' >> "$bb63_test_capture"
  case "$2" in
    CFBundleVersion) printf '63\n' ;;
    CFBundleShortVersionString) printf '1.0.6\n' ;;
    CFBundleIdentifier) printf 'uk.co.basketboss.app\n' ;;
    *) return 4 ;;
  esac
}
open() { printf 'open\0%s\0\n' "$1" >> "$bb63_test_capture"; }
bb63ArchiveProject "$1" "$2"
bb63ArchiveProject "$1" "$2"
`;
 const result=run(script,[project,archives,capture]);assert.equal(result.status,0,result.stderr);
 const calls=fs.readFileSync(capture,'utf8').trimEnd().split('\n').map(line=>line.split('\0').filter(Boolean));assert.equal(calls.length,10);
 const paths=[];
 for(let index=0;index<calls.length;index+=5){
  const [command,...args]=calls[index];assert.equal(command,'xcodebuild');
  assert.deepEqual(args.slice(0,8),['-workspace',project+'/ios/App/App.xcworkspace','-scheme','App','-configuration','Release','-destination','generic/platform=iOS']);
  assert.equal(args[8],'-archivePath');const archive=args[9];paths.push(archive);assert.equal(path.dirname(archive),archives);
  assert.match(path.basename(archive),/^BasketBoss-1\.0\.6-build63-\d{6}-\d+-\d+\.xcarchive$/);
  assert.deepEqual(args.slice(10),['-allowProvisioningUpdates','archive']);
  for(const [offset,field]of [[1,'CFBundleVersion'],[2,'CFBundleShortVersionString'],[3,'CFBundleIdentifier']]){
   assert.deepEqual(calls[index+offset],['plutil','-extract',field,'raw','-o','-',archive+'/Products/Applications/App.app/Info.plist']);
  }
  assert.deepEqual(calls[index+4],['open',archive]);assert.ok(fs.statSync(archive).isDirectory());
 }
 assert.notEqual(paths[0],paths[1]);assert.match(result.stdout,/Distribute App > App Store Connect > Upload/);assert.match(result.stdout,/has not been uploaded/);
});

test('a failed build 63 archive cannot open Organizer or report a ready archive',t=>{
 const folder=temporary(t,'bb63-archive-failure-');
 for(const [name,exit,expected]of [['build fails',65,65],['archive missing',0,1]]){
  const result=run('set -euo pipefail\nxcodebuild() { return '+exit+'; }\nopen() { printf "unexpected-open\\n"; }\nbb63ArchiveProject "$1" "$2"',[path.join(folder,'project'),path.join(folder,name)]);
  assert.equal(result.status,expected,name);assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/);
  if(exit===0)assert.match(result.stderr,/Xcode did not create the archive/);
 }
});

test('an incorrect build 63 archive or unreadable app metadata cannot be opened',t=>{
 const folder=temporary(t,'bb63-metadata-failure-');
 const script=String.raw`
set -euo pipefail
bb63_test_fault="$3"
xcodebuild() {
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == '-archivePath' ]]; then
      mkdir -p "$2/Products/Applications/App.app"
      if [[ "$bb63_test_fault" != 'missing' ]]; then printf '<plist/>' > "$2/Products/Applications/App.app/Info.plist"; fi
      return 0
    fi
    shift
  done
  return 3
}
plutil() {
  if [[ "$bb63_test_fault" == 'unreadable' ]]; then return 71; fi
  case "$2" in
    CFBundleVersion) if [[ "$bb63_test_fault" == 'closed' ]]; then printf '49\n'; elif [[ "$bb63_test_fault" == 'previous' ]]; then printf '61\n'; elif [[ "$bb63_test_fault" == 'build' ]]; then printf '50\n'; else printf '63\n'; fi ;;
    CFBundleShortVersionString) if [[ "$bb63_test_fault" == 'version' || "$bb63_test_fault" == 'closed' ]]; then printf '1.0.3\n'; else printf '1.0.6\n'; fi ;;
    CFBundleIdentifier) if [[ "$bb63_test_fault" == 'bundle' ]]; then printf 'com.other.app\n'; else printf 'uk.co.basketboss.app\n'; fi ;;
    *) return 4 ;;
  esac
}
open() { printf 'unexpected-open\n'; }
bb63ArchiveProject "$1" "$2"
`;
 for(const fault of ['build','version','previous','closed','bundle','missing','unreadable']){
  const result=run(script,[path.join(folder,'project with spaces'),path.join(folder,'archives',fault),fault]);
  assert.equal(result.status,fault==='unreadable'?71:1,fault+': '+result.stderr);
  assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/,fault);
  if(fault==='missing')assert.match(result.stderr,/missing its app Info\.plist/);
  else if(fault!=='unreadable'){
   assert.match(result.stderr,/version, build or bundle ID does not match/);
   assert.match(result.stderr,/BasketBoss 1\.0\.6 \(63\)/,'archive failure identifies the correct release');
  }
 }
});

test('build 63 preparation changes only both native app version/build pairs and is idempotent',t=>{
 const folder=temporary(t,'bb63-project-'),project=path.join(folder,'Prepared project with spaces'),original=originalProject();
 assert.equal((original.match(/CURRENT_PROJECT_VERSION = 43;/g)||[]).length,2);
 assert.equal((original.match(/MARKETING_VERSION = 1\.0\.2;/g)||[]).length,2);
 const file=writeProject(project,original);
 const manifest=path.join(project,'catalogues/700/release/manifest.json');fs.mkdirSync(path.dirname(manifest),{recursive:true});
 const protocol='{"clientVersion":"1.0.2","catalogue_version":700}\n';fs.writeFileSync(manifest,protocol);
 const result=run('set -euo pipefail\nbb63ProjectBuild "$1" prepare\nbb63ProjectBuild "$1" verify\nbb63ProjectBuild "$1" prepare',[project]);
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.readFileSync(file,'utf8'),original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 63;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'));
 assert.equal(fs.readFileSync(manifest,'utf8'),protocol,'the internal catalogue/client contract is untouched');
 assert.match(result.stdout,/Verified Xcode version 1\.0\.6, build 63/);
});

test('build 63 project guards reject old, mixed, unexpected and malformed settings without changing them',t=>{
 const folder=temporary(t,'bb63-project-guards-'),original=originalProject();
 const cases=[
  ['verify old build',original,'verify'],
  ['unexpected build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 42;'),'prepare'],
  ['older prepared build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 44;'),'prepare'],
  ['closed release build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 49;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.3;'),'prepare'],
  ['previous release build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 55;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.5;'),'prepare'],
  ['previous Build 57',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 57;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['previous Build 58',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 58;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['previous Build 59',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 59;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['previous Build 60',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 60;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['previous Build 61',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 61;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['previous Build 62',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 62;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['higher Build 64',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 64;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['wrong Apple team',original.replaceAll('DEVELOPMENT_TEAM = J25UTUATD2;','DEVELOPMENT_TEAM = OTHERTEAM;'),'prepare'],
  ['mixed Apple teams',original.replace('DEVELOPMENT_TEAM = J25UTUATD2;','DEVELOPMENT_TEAM = OTHERTEAM;'),'prepare'],
  ['missing Apple team',original.replace('DEVELOPMENT_TEAM = J25UTUATD2;',''),'prepare'],
  ['wrong bundle identifier',original.replaceAll('PRODUCT_BUNDLE_IDENTIFIER = uk.co.basketboss.app;','PRODUCT_BUNDLE_IDENTIFIER = com.other.app;'),'prepare'],
  ['missing bundle identifier',original.replace('PRODUCT_BUNDLE_IDENTIFIER = uk.co.basketboss.app;',''),'prepare'],
  ['mixed builds',original.replace('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 63;'),'prepare'],
  ['wrong marketing version',original.replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.7;'),'prepare'],
  ['mixed marketing versions',original.replace('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'verify'],
  ['partial marketing upgrade',original.replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.6;'),'prepare'],
  ['partial build upgrade',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 63;'),'prepare'],
  ['missing build setting',original.replace('CURRENT_PROJECT_VERSION = 43;',''),'prepare'],
  ['missing version setting',original.replace('MARKETING_VERSION = 1.0.2;',''),'prepare'],
  ['invalid mode',original,'upload'],
 ];
 for(const [name,value,mode]of cases){
  const project=path.join(folder,name),file=writeProject(project,value),result=run('set -euo pipefail\nbb63ProjectBuild "$1" "$2"',[project,mode]);
  assert.notEqual(result.status,0,name);assert.equal(fs.readFileSync(file,'utf8'),value,name+' must not alter the project');
 }
});

test('build 63 prepares and verifies the project around catalogue-700 sync before opening or archiving',()=>{
 const prepare=source.indexOf('bb63ProjectBuild "$BB63_DIR" prepare'),sync=source.indexOf('node tools/catalogue700/sync-ios.mjs'),verify=source.indexOf('bb63ProjectBuild "$BB63_DIR" verify'),handoff=source.indexOf('if [[ "$BB63_MODE" ==');
 assert.ok(prepare>=0&&sync>prepare&&verify>sync&&handoff>verify);
 assert.match(source,/bb63ArchiveProject "\$BB63_DIR" "\$HOME\/Library\/Developer\/Xcode\/Archives\/\$\(date '\+%Y-%m-%d'\)"/);
 assert.match(source,/open "\$BB63_DIR\/ios\/App\/App\.xcworkspace"/);
 const pinned=source.match(/^BB63_SOURCE='([a-f0-9]{40})'$/m);
 assert.ok(pinned,'Build 63 uses one explicit reviewed source pin, independent of the launcher commit');
 assert.equal(pinned[1],'5cc8dff12093aa6c0b9821306ec19c1edc6778c4','Build 63 pins the reviewed native first paint, account and budget presentation source commit');
 assert.match(source,/^git fetch --depth 1 origin "\$BB63_SOURCE"$/m);
 assert.match(source,/^git checkout --detach "\$BB63_SOURCE"$/m);
 assert.ok(source.indexOf('bb63Source "$BB63_SOURCE"')<source.indexOf('git clone'),'an unpinned launcher fails before cloning or preparing a project');
 assert.match(source,/BB63_DIR="\$\(mktemp -d \"\$HOME\/BasketBoss-1\.0\.6-build63\.XXXXXX\"\)"/,'each run creates a fresh Build 63 project');
 assert.match(source,/BB63_STAGE="\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/BasketBoss-native63\.XXXXXX"\)"/,'catalogue staging uses a fresh Build 63 temporary directory');
 assert.match(source,/^git clone --depth 1 --branch main --single-branch https:\/\/github\.com\/jbatiste12-debug\/BasketBoss\.git \"\$BB63_DIR\"$/m);
 assert.doesNotMatch(source,/BasketBoss-1\.0\.3-build49|BasketBoss-1\.0\.4-build5[01234]|BasketBoss-1\.0\.5-build55|BB49_DIR|BB50_DIR|BB51_DIR|BB52_DIR|BB53_DIR|BB54_DIR|BB55_DIR|BB57_DIR|BB58_DIR|BB59_DIR|BasketBoss-1\.0\.6-build5[789]/,'the new launcher cannot reuse an older prepared project');
 assert.doesNotMatch(source,/npm (?:run )?ios:sync|npx (?:cap|capacitor) sync/,'ordinary native syncing must not overwrite the verified 700-recipe assets');
 assert.doesNotMatch(source,/altool|notarytool|iTMSTransporter|-exportArchive|-upload-app|appstoreconnect/);
});

test('Build 63 preserves previous launchers, signing identity and catalogue protocol',()=>{
 const expected=[["release-assets/prepare-build62-mac.command", "76a817a01b1ce8ddbd079fcb60cf09b8009b7aea1a0a8379dfee78ab88878ef2"], ["release-assets/prepare-build61-mac.command", "1df9091f1a0d61fd0dee4ff25806c2ce61ff774e12103b1195596a9a2eeb3e4b"], ["release-assets/prepare-build56-mac.command", "886eb730072d0ccd2f715f4103b9d76050e3418f6d3931b2666b6806985416a2"], ["release-assets/prepare-build57-mac.command", "2dcf850ec1813ebbbb52d1c75e56798469a863239e3b902396c0daea10cc2180"], ["release-assets/prepare-build58-mac.command", "ba37a65621e9382c4149da5ee7d0b0866c3fda6c0652cea1e7a8cbac98e5d54b"], ["release-assets/prepare-build59-mac.command", "ca71a67cdd1d2ce30f98424cd5f3dbebda8024dfd6180c9399d1460ab6a154f1"], ["release-assets/prepare-build60-mac.command", "35d03b0f93cf0c223d98d74a5500195cc167177f86bf433fbf811eed745b9c59"], ["catalogues/700/release/manifest.json", "251f655df6364d7daba1bfb214b3dfe0f92829a35da9cfd2bcb09412af37058b"], ["ios/App/App.xcodeproj/project.pbxproj", "29365a13c9827b6745bbf98fd6d61347cb887a8a4dc964d198bf1c1cbfd321ec"]];
 for(const [file,hash]of expected)assert.equal(createHash('sha256').update(read(file)).digest('hex'),hash,file);
 const project=originalProject();
 assert.equal((project.match(/DEVELOPMENT_TEAM = J25UTUATD2;/g)||[]).length,2);
 assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = uk\.co\.basketboss\.app;/g)||[]).length,2);
 assert.equal(JSON.parse(read('catalogues/700/release/manifest.json')).clientVersion,'1.0.2');
});
