import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('release-assets/prepare-build53-mac.command');
const functions=source.slice(source.indexOf('bb53Mode() {'),source.indexOf('\nBB53_MODE='));
assert.ok(functions.includes('bb53ProjectBuild() {')&&functions.includes('bb53ArchiveProject() {'));
const run=(script,args=[])=>spawnSync('bash',['-c',functions+'\n'+script,'build53-launcher-test',...args],{encoding:'utf8'});
const temporary=(t,name)=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),name));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return folder;};
const writeProject=(directory,project)=>{const file=path.join(directory,'ios/App/App.xcodeproj/project.pbxproj');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,project);return file;};
const originalProject=()=>read('ios/App/App.xcodeproj/project.pbxproj');

test('build 53 defaults to preparation and archives only with the explicit archive flag',()=>{
 for(const [args,expected]of [[[],'prepare\n'],[['--archive'],'archive\n']]){
  const result=run('bb53Mode "$@"',args);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,expected);
 }
 for(const args of [['--upload'],['--archive','--upload'],['archive'],['--build-number','53']]){
  const result=run('bb53Mode "$@"',args);assert.equal(result.status,2);assert.match(result.stderr,/Usage:.*prepare-build53.*\[--archive\]/);
 }
});

test('build 53 archives preserve spaced paths, verify actual app metadata, and open only unique validated archives',t=>{
 const folder=temporary(t,'bb53-archive-'),project=path.join(folder,'Prepared project with spaces'),archives=path.join(folder,'Archive folder','2026-11-12'),capture=path.join(folder,'calls');
 const script=String.raw`
set -euo pipefail
bb53_test_capture="$3"
xcodebuild() {
  printf 'xcodebuild\0' >> "$bb53_test_capture"
  printf '%s\0' "$@" >> "$bb53_test_capture"
  printf '\n' >> "$bb53_test_capture"
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
  printf 'plutil\0' >> "$bb53_test_capture"
  printf '%s\0' "$@" >> "$bb53_test_capture"
  printf '\n' >> "$bb53_test_capture"
  case "$2" in
    CFBundleVersion) printf '53\n' ;;
    CFBundleShortVersionString) printf '1.0.4\n' ;;
    CFBundleIdentifier) printf 'uk.co.basketboss.app\n' ;;
    *) return 4 ;;
  esac
}
open() { printf 'open\0%s\0\n' "$1" >> "$bb53_test_capture"; }
bb53ArchiveProject "$1" "$2"
bb53ArchiveProject "$1" "$2"
`;
 const result=run(script,[project,archives,capture]);assert.equal(result.status,0,result.stderr);
 const calls=fs.readFileSync(capture,'utf8').trimEnd().split('\n').map(line=>line.split('\0').filter(Boolean));assert.equal(calls.length,10);
 const paths=[];
 for(let index=0;index<calls.length;index+=5){
  const [command,...args]=calls[index];assert.equal(command,'xcodebuild');
  assert.deepEqual(args.slice(0,8),['-workspace',project+'/ios/App/App.xcworkspace','-scheme','App','-configuration','Release','-destination','generic/platform=iOS']);
  assert.equal(args[8],'-archivePath');const archive=args[9];paths.push(archive);assert.equal(path.dirname(archive),archives);
  assert.match(path.basename(archive),/^BasketBoss-1\.0\.4-build53-\d{6}-\d+-\d+\.xcarchive$/);
  assert.deepEqual(args.slice(10),['-allowProvisioningUpdates','archive']);
  for(const [offset,field]of [[1,'CFBundleVersion'],[2,'CFBundleShortVersionString'],[3,'CFBundleIdentifier']]){
   assert.deepEqual(calls[index+offset],['plutil','-extract',field,'raw','-o','-',archive+'/Products/Applications/App.app/Info.plist']);
  }
  assert.deepEqual(calls[index+4],['open',archive]);assert.ok(fs.statSync(archive).isDirectory());
 }
 assert.notEqual(paths[0],paths[1]);assert.match(result.stdout,/Distribute App > App Store Connect > Upload/);assert.match(result.stdout,/has not been uploaded/);
});

test('a failed build 53 archive cannot open Organizer or report a ready archive',t=>{
 const folder=temporary(t,'bb53-archive-failure-');
 for(const [name,exit,expected]of [['build fails',65,65],['archive missing',0,1]]){
  const result=run('set -euo pipefail\nxcodebuild() { return '+exit+'; }\nopen() { printf "unexpected-open\\n"; }\nbb53ArchiveProject "$1" "$2"',[path.join(folder,'project'),path.join(folder,name)]);
  assert.equal(result.status,expected,name);assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/);
  if(exit===0)assert.match(result.stderr,/Xcode did not create the archive/);
 }
});

test('an incorrect build 53 archive or unreadable app metadata cannot be opened',t=>{
 const folder=temporary(t,'bb53-metadata-failure-');
 const script=String.raw`
set -euo pipefail
bb53_test_fault="$3"
xcodebuild() {
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == '-archivePath' ]]; then
      mkdir -p "$2/Products/Applications/App.app"
      if [[ "$bb53_test_fault" != 'missing' ]]; then printf '<plist/>' > "$2/Products/Applications/App.app/Info.plist"; fi
      return 0
    fi
    shift
  done
  return 3
}
plutil() {
  if [[ "$bb53_test_fault" == 'unreadable' ]]; then return 71; fi
  case "$2" in
    CFBundleVersion) if [[ "$bb53_test_fault" == 'closed' ]]; then printf '49\n'; elif [[ "$bb53_test_fault" == 'build' || "$bb53_test_fault" == 'previous' ]]; then printf '50\n'; else printf '53\n'; fi ;;
    CFBundleShortVersionString) if [[ "$bb53_test_fault" == 'version' || "$bb53_test_fault" == 'closed' ]]; then printf '1.0.3\n'; else printf '1.0.4\n'; fi ;;
    CFBundleIdentifier) if [[ "$bb53_test_fault" == 'bundle' ]]; then printf 'com.other.app\n'; else printf 'uk.co.basketboss.app\n'; fi ;;
    *) return 4 ;;
  esac
}
open() { printf 'unexpected-open\n'; }
bb53ArchiveProject "$1" "$2"
`;
 for(const fault of ['build','version','previous','closed','bundle','missing','unreadable']){
  const result=run(script,[path.join(folder,'project with spaces'),path.join(folder,'archives',fault),fault]);
  assert.equal(result.status,fault==='unreadable'?71:1,fault+': '+result.stderr);
  assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/,fault);
  if(fault==='missing')assert.match(result.stderr,/missing its app Info\.plist/);
  else if(fault!=='unreadable'){
   assert.match(result.stderr,/version, build or bundle ID does not match/);
   assert.match(result.stderr,/BasketBoss 1\.0\.4 \(53\)/,'archive failure identifies the correct release');
  }
 }
});

test('build 53 preparation changes only both native app version/build pairs and is idempotent',t=>{
 const folder=temporary(t,'bb53-project-'),project=path.join(folder,'Prepared project with spaces'),original=originalProject();
 assert.equal((original.match(/CURRENT_PROJECT_VERSION = 43;/g)||[]).length,2);
 assert.equal((original.match(/MARKETING_VERSION = 1\.0\.2;/g)||[]).length,2);
 const file=writeProject(project,original);
 const manifest=path.join(project,'catalogues/700/release/manifest.json');fs.mkdirSync(path.dirname(manifest),{recursive:true});
 const protocol='{"clientVersion":"1.0.2","catalogue_version":700}\n';fs.writeFileSync(manifest,protocol);
 const result=run('set -euo pipefail\nbb53ProjectBuild "$1" prepare\nbb53ProjectBuild "$1" verify\nbb53ProjectBuild "$1" prepare',[project]);
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.readFileSync(file,'utf8'),original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 53;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.4;'));
 assert.equal(fs.readFileSync(manifest,'utf8'),protocol,'the internal catalogue/client contract is untouched');
 assert.match(result.stdout,/Verified Xcode version 1\.0\.4, build 53/);
});

test('build 53 project guards reject old, mixed, unexpected and malformed settings without changing them',t=>{
 const folder=temporary(t,'bb53-project-guards-'),original=originalProject();
 const cases=[
  ['verify old build',original,'verify'],
  ['unexpected build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 42;'),'prepare'],
  ['older prepared build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 44;'),'prepare'],
  ['closed release build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 49;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.3;'),'prepare'],
  ['previous release build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 51;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.4;'),'prepare'],
  ['mixed builds',original.replace('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 53;'),'prepare'],
  ['wrong marketing version',original.replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.5;'),'prepare'],
  ['mixed marketing versions',original.replace('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.4;'),'verify'],
  ['partial marketing upgrade',original.replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.4;'),'prepare'],
  ['partial build upgrade',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 53;'),'prepare'],
  ['missing build setting',original.replace('CURRENT_PROJECT_VERSION = 43;',''),'prepare'],
  ['missing version setting',original.replace('MARKETING_VERSION = 1.0.2;',''),'prepare'],
  ['invalid mode',original,'upload'],
 ];
 for(const [name,value,mode]of cases){
  const project=path.join(folder,name),file=writeProject(project,value),result=run('set -euo pipefail\nbb53ProjectBuild "$1" "$2"',[project,mode]);
  assert.notEqual(result.status,0,name);assert.equal(fs.readFileSync(file,'utf8'),value,name+' must not alter the project');
 }
});

test('build 53 prepares and verifies the project around catalogue-700 sync before opening or archiving',()=>{
 const prepare=source.indexOf('bb53ProjectBuild "$BB53_DIR" prepare'),sync=source.indexOf('node tools/catalogue700/sync-ios.mjs'),verify=source.indexOf('bb53ProjectBuild "$BB53_DIR" verify'),handoff=source.indexOf('if [[ "$BB53_MODE" ==');
 assert.ok(prepare>=0&&sync>prepare&&verify>sync&&handoff>verify);
 assert.match(source,/bb53ArchiveProject "\$BB53_DIR" "\$HOME\/Library\/Developer\/Xcode\/Archives\/\$\(date '\+%Y-%m-%d'\)"/);
 assert.match(source,/open "\$BB53_DIR\/ios\/App\/App\.xcworkspace"/);
 const fetch=source.match(/^git fetch --depth 1 origin ([a-f0-9]{40})$/m),checkout=source.match(/^git checkout --detach ([a-f0-9]{40})$/m);
 assert.ok(fetch&&checkout);assert.equal(fetch[1],checkout[1]);
 assert.equal(fetch[1],'bde71537e216d5280d62f6f5760e5e322ee13323','Build 53 fetches the reviewed application source even if the launcher is committed later');
 assert.match(source,/BB53_DIR="\$\(mktemp -d \"\$HOME\/BasketBoss-1\.0\.4-build53\.XXXXXX\"\)"/,'each run creates a fresh Build 53 project');
 assert.match(source,/BB53_STAGE="\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/BasketBoss-native53\.XXXXXX"\)"/,'catalogue staging uses a fresh Build 53 temporary directory');
 assert.match(source,/^git clone --depth 1 --branch main --single-branch https:\/\/github\.com\/jbatiste12-debug\/BasketBoss\.git \"\$BB53_DIR\"$/m);
 assert.doesNotMatch(source,/BasketBoss-1\.0\.3-build49|BasketBoss-1\.0\.4-build5[012]|BB49_DIR|BB50_DIR|BB51_DIR|BB52_DIR/,'the new launcher cannot reuse an older prepared project');
 assert.doesNotMatch(source,/npm (?:run )?ios:sync|npx (?:cap|capacitor) sync/,'ordinary native syncing must not overwrite the verified 700-recipe assets');
 assert.doesNotMatch(source,/altool|notarytool|iTMSTransporter|-exportArchive|-upload-app|appstoreconnect/);
});

test('Build 53 leaves Build 52, the project baseline and catalogue protocol unchanged',()=>{
 for(const [file,expected]of [
  ['release-assets/prepare-build52-mac.command','0ef524948c2980d8d7ca7ca412f4559306eab8683ca1d734a4f78d4a53d21a80'],
  ['release-assets/build52-README.txt','7138d7cc2043dd1dba45ac07164b5ac45f3684dda55fdb5f60d6cf7ce4d073ea'],
  ['release-assets/build52-phone-checklist.txt','7534271046a5060d104c435a99f883dfe01e347e151d1216edc6edf0f6b82493'],
  ['tests/basketboss-build52-launcher-archive.test.mjs','a51f4a49804d42b0f190b0dcd3039cfa4e643c6daee1633a6383a479e80fd3a3'],
  ['catalogues/700/release/manifest.json','251f655df6364d7daba1bfb214b3dfe0f92829a35da9cfd2bcb09412af37058b'],
 ])assert.equal(createHash('sha256').update(read(file)).digest('hex'),expected,file);
 const project=originalProject();assert.equal((project.match(/CURRENT_PROJECT_VERSION = 43;/g)||[]).length,2);assert.equal((project.match(/MARKETING_VERSION = 1\.0\.2;/g)||[]).length,2);
 assert.equal(JSON.parse(read('catalogues/700/release/manifest.json')).clientVersion,'1.0.2');
});
