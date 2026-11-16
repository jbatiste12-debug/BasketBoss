import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('release-assets/prepare-build48-mac.command');
const functions=source.slice(source.indexOf('bb48Mode() {'),source.indexOf('\nBB48_MODE='));
assert.ok(functions.includes('bb48ProjectBuild() {')&&functions.includes('bb48ArchiveProject() {'));
const run=(script,args=[])=>spawnSync('bash',['-c',functions+'\n'+script,'build48-launcher-test',...args],{encoding:'utf8'});
const temporary=(t,name)=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),name));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return folder;};
const writeProject=(directory,project)=>{const file=path.join(directory,'ios/App/App.xcodeproj/project.pbxproj');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,project);return file;};
const originalProject=()=>read('ios/App/App.xcodeproj/project.pbxproj');

test('build 48 defaults to preparation and archives only with the explicit archive flag',()=>{
 for(const [args,expected]of [[[],'prepare\n'],[['--archive'],'archive\n']]){
  const result=run('bb48Mode "$@"',args);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,expected);
 }
 for(const args of [['--upload'],['--archive','--upload'],['archive'],['--build-number','48']]){
  const result=run('bb48Mode "$@"',args);assert.equal(result.status,2);assert.match(result.stderr,/Usage:.*prepare-build48.*\[--archive\]/);
 }
});

test('build 48 archives preserve spaced paths, verify actual app metadata, and open only unique validated archives',t=>{
 const folder=temporary(t,'bb48-archive-'),project=path.join(folder,'Prepared project with spaces'),archives=path.join(folder,'Archive folder','2026-11-12'),capture=path.join(folder,'calls');
 const script=String.raw`
set -euo pipefail
bb48_test_capture="$3"
xcodebuild() {
  printf 'xcodebuild\0' >> "$bb48_test_capture"
  printf '%s\0' "$@" >> "$bb48_test_capture"
  printf '\n' >> "$bb48_test_capture"
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
  printf 'plutil\0' >> "$bb48_test_capture"
  printf '%s\0' "$@" >> "$bb48_test_capture"
  printf '\n' >> "$bb48_test_capture"
  case "$2" in
    CFBundleVersion) printf '48\n' ;;
    CFBundleShortVersionString) printf '1.0.3\n' ;;
    CFBundleIdentifier) printf 'uk.co.basketboss.app\n' ;;
    *) return 4 ;;
  esac
}
open() { printf 'open\0%s\0\n' "$1" >> "$bb48_test_capture"; }
bb48ArchiveProject "$1" "$2"
bb48ArchiveProject "$1" "$2"
`;
 const result=run(script,[project,archives,capture]);assert.equal(result.status,0,result.stderr);
 const calls=fs.readFileSync(capture,'utf8').trimEnd().split('\n').map(line=>line.split('\0').filter(Boolean));assert.equal(calls.length,10);
 const paths=[];
 for(let index=0;index<calls.length;index+=5){
  const [command,...args]=calls[index];assert.equal(command,'xcodebuild');
  assert.deepEqual(args.slice(0,8),['-workspace',project+'/ios/App/App.xcworkspace','-scheme','App','-configuration','Release','-destination','generic/platform=iOS']);
  assert.equal(args[8],'-archivePath');const archive=args[9];paths.push(archive);assert.equal(path.dirname(archive),archives);
  assert.match(path.basename(archive),/^BasketBoss-1\.0\.3-build48-\d{6}-\d+-\d+\.xcarchive$/);
  assert.deepEqual(args.slice(10),['-allowProvisioningUpdates','archive']);
  for(const [offset,field]of [[1,'CFBundleVersion'],[2,'CFBundleShortVersionString'],[3,'CFBundleIdentifier']]){
   assert.deepEqual(calls[index+offset],['plutil','-extract',field,'raw','-o','-',archive+'/Products/Applications/App.app/Info.plist']);
  }
  assert.deepEqual(calls[index+4],['open',archive]);assert.ok(fs.statSync(archive).isDirectory());
 }
 assert.notEqual(paths[0],paths[1]);assert.match(result.stdout,/Distribute App > App Store Connect > Upload/);assert.match(result.stdout,/has not been uploaded/);
});

test('a failed build 48 archive cannot open Organizer or report a ready archive',t=>{
 const folder=temporary(t,'bb48-archive-failure-');
 const result=run('set -euo pipefail\nxcodebuild() { return 65; }\nopen() { printf "unexpected-open\\n"; }\nbb48ArchiveProject "$1" "$2"',[path.join(folder,'project'),path.join(folder,'archives')]);
 assert.equal(result.status,65);assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/);
});

test('an incorrect build 48 archive or unreadable app metadata cannot be opened',t=>{
 const folder=temporary(t,'bb48-metadata-failure-');
 const script=String.raw`
set -euo pipefail
bb48_test_fault="$3"
xcodebuild() {
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == '-archivePath' ]]; then
      mkdir -p "$2/Products/Applications/App.app"
      if [[ "$bb48_test_fault" != 'missing' ]]; then printf '<plist/>' > "$2/Products/Applications/App.app/Info.plist"; fi
      return 0
    fi
    shift
  done
  return 3
}
plutil() {
  if [[ "$bb48_test_fault" == 'unreadable' ]]; then return 71; fi
  case "$2" in
    CFBundleVersion) if [[ "$bb48_test_fault" == 'build' ]]; then printf '43\n'; else printf '48\n'; fi ;;
    CFBundleShortVersionString) if [[ "$bb48_test_fault" == 'version' ]]; then printf '1.0.2\n'; else printf '1.0.3\n'; fi ;;
    CFBundleIdentifier) if [[ "$bb48_test_fault" == 'bundle' ]]; then printf 'com.other.app\n'; else printf 'uk.co.basketboss.app\n'; fi ;;
    *) return 4 ;;
  esac
}
open() { printf 'unexpected-open\n'; }
bb48ArchiveProject "$1" "$2"
`;
 for(const fault of ['build','version','bundle','missing','unreadable']){
  const result=run(script,[path.join(folder,'project with spaces'),path.join(folder,'archives',fault),fault]);
  assert.equal(result.status,fault==='unreadable'?71:1,fault+': '+result.stderr);
  assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/,fault);
  if(fault==='missing')assert.match(result.stderr,/missing its app Info\.plist/);
  else if(fault!=='unreadable'){
   assert.match(result.stderr,/version, build or bundle ID does not match/);
   assert.match(result.stderr,/BasketBoss 1\.0\.3 \(48\)/,'archive failure identifies the correct release');
  }
 }
});

test('build 48 preparation changes only both native app version/build pairs and is idempotent',t=>{
 const folder=temporary(t,'bb48-project-'),project=path.join(folder,'Prepared project with spaces'),original=originalProject();
 assert.equal((original.match(/CURRENT_PROJECT_VERSION = 43;/g)||[]).length,2);
 assert.equal((original.match(/MARKETING_VERSION = 1\.0\.2;/g)||[]).length,2);
 const file=writeProject(project,original);
 const manifest=path.join(project,'catalogues/700/release/manifest.json');fs.mkdirSync(path.dirname(manifest),{recursive:true});
 const protocol='{"clientVersion":"1.0.2","catalogue_version":700}\n';fs.writeFileSync(manifest,protocol);
 const result=run('set -euo pipefail\nbb48ProjectBuild "$1" prepare\nbb48ProjectBuild "$1" verify\nbb48ProjectBuild "$1" prepare',[project]);
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.readFileSync(file,'utf8'),original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 48;').replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.3;'));
 assert.equal(fs.readFileSync(manifest,'utf8'),protocol,'the internal catalogue/client contract is untouched');
 assert.match(result.stdout,/Verified Xcode version 1\.0\.3, build 48/);
});

test('build 48 project guards reject old, mixed, unexpected and malformed settings without changing them',t=>{
 const folder=temporary(t,'bb48-project-guards-'),original=originalProject();
 const cases=[
  ['verify old build',original,'verify'],
  ['unexpected build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 42;'),'prepare'],
  ['older prepared build',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 44;'),'prepare'],
  ['mixed builds',original.replace('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 48;'),'prepare'],
  ['wrong marketing version',original.replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.4;'),'prepare'],
  ['mixed marketing versions',original.replace('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.3;'),'verify'],
  ['partial marketing upgrade',original.replaceAll('MARKETING_VERSION = 1.0.2;','MARKETING_VERSION = 1.0.3;'),'prepare'],
  ['partial build upgrade',original.replaceAll('CURRENT_PROJECT_VERSION = 43;','CURRENT_PROJECT_VERSION = 48;'),'prepare'],
  ['missing build setting',original.replace('CURRENT_PROJECT_VERSION = 43;',''),'prepare'],
  ['missing version setting',original.replace('MARKETING_VERSION = 1.0.2;',''),'prepare'],
  ['invalid mode',original,'upload'],
 ];
 for(const [name,value,mode]of cases){
  const project=path.join(folder,name),file=writeProject(project,value),result=run('set -euo pipefail\nbb48ProjectBuild "$1" "$2"',[project,mode]);
  assert.notEqual(result.status,0,name);assert.equal(fs.readFileSync(file,'utf8'),value,name+' must not alter the project');
 }
});

test('build 48 prepares and verifies the project around catalogue-700 sync before opening or archiving',()=>{
 const prepare=source.indexOf('bb48ProjectBuild "$BB48_DIR" prepare'),sync=source.indexOf('node tools/catalogue700/sync-ios.mjs'),verify=source.indexOf('bb48ProjectBuild "$BB48_DIR" verify'),handoff=source.indexOf('if [[ "$BB48_MODE" ==');
 assert.ok(prepare>=0&&sync>prepare&&verify>sync&&handoff>verify);
 assert.match(source,/bb48ArchiveProject "\$BB48_DIR" "\$HOME\/Library\/Developer\/Xcode\/Archives\/\$\(date '\+%Y-%m-%d'\)"/);
 assert.match(source,/open "\$BB48_DIR\/ios\/App\/App\.xcworkspace"/);
 const fetch=source.match(/^git fetch --depth 1 origin ([a-f0-9]{40})$/m),checkout=source.match(/^git checkout --detach ([a-f0-9]{40})$/m);
 assert.ok(fetch&&checkout);assert.equal(fetch[1],checkout[1]);
 assert.equal(fetch[1],'4c24972047af8543761fd970f0c1bb1031b3871b','Build 48 fetches the reviewed application source even if the launcher is committed later');
 assert.doesNotMatch(source,/altool|notarytool|iTMSTransporter|-exportArchive|-upload-app|appstoreconnect/);
});

test('adding Build 48 leaves historical Build 43 through Build 47 launchers and READMEs byte-identical',()=>{
 for(const [file,expected]of [
  ['release-assets/prepare-build43-mac.command','e9cd51ce314daa41741016e686d12abd4d960e3941f0cb9656f22eec1dd0e54c'],
  ['release-assets/build43-README.txt','542de3b4e22f368ea3748d37493c945f6c27aeb24718b98d91440537792b1053'],
  ['release-assets/prepare-build44-mac.command','64896a2662e001459107ce0edaba837c7073efba6c948e2a86e418ba8ec17d6e'],
  ['release-assets/build44-README.txt','ea4ea7a9f43947419a2dfd6bbb05acca739c09894c518553601298d3fe832242'],
  ['release-assets/prepare-build45-mac.command','842acf12d6ef1a0552556933cbe14364b70b7f05fc56a5799deb8541a4cc9045'],
  ['release-assets/build45-README.txt','7f10101440cbd650191a4b0e167bb79b914d306d63119ce3b2b8a18ff0ee0bb5'],
  ['release-assets/prepare-build46-mac.command','19c0ee31d93f3a2b630a3fccbe0a1c062e4f03a772b3e52254b7e19da9dbc7f4'],
  ['release-assets/build46-README.txt','b45894655187529cfe7e13417c6d8be4f6a6958d3477b8d7b438081274caba47'],
  ['release-assets/prepare-build47-mac.command','18d98efd434b4c825efcdc30de5a0303137a40e178caa6ef965e7f0669a76957'],
  ['release-assets/build47-README.txt','7acbf7087e56818060a2e28460d2d75a971082385e1e50a1004584545f2dce84'],
 ])assert.equal(createHash('sha256').update(read(file)).digest('hex'),expected,file);
});
