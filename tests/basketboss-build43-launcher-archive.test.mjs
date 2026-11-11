import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const source=fs.readFileSync(new URL('../release-assets/prepare-build43-mac.command',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('bb43Mode() {'),source.indexOf('\nBB43_MODE='));
assert.ok(functions.includes('bb43ArchiveProject() {'));
const run=(script,args=[])=>spawnSync('bash',['-c',functions+'\n'+script,'launcher-test',...args],{encoding:'utf8'});

test('build 43 launcher defaults to prepare and only accepts an explicit archive flag',()=>{
 for(const [args,expected]of [[[],'prepare\n'],[['--archive'],'archive\n']]){const result=run('bb43Mode "$@"',args);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,expected);}
 for(const args of [['--upload'],['--archive','--upload'],['archive']]){const result=run('bb43Mode "$@"',args);assert.equal(result.status,2);assert.match(result.stderr,/Usage:.*\[--archive\]/);}
});

test('archive option builds the real Release App scheme with automatic signing and opens only the resulting archive',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bb43-archive-test-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const project=path.join(folder,'Prepared project with spaces'),archives=path.join(folder,'Archives','2026-11-11'),capture=path.join(folder,'arguments.jsonl');
 const script=String.raw`
set -euo pipefail
capture="$3"
xcodebuild() {
  printf 'xcodebuild\0' >> "$capture"
  printf '%s\0' "$@" >> "$capture"
  printf '\n' >> "$capture"
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == '-archivePath' ]]; then mkdir -p "$2"; break; fi
    shift
  done
}
open() { printf 'open\0%s\0\n' "$1" >> "$capture"; }
bb43ArchiveProject "$1" "$2"
bb43ArchiveProject "$1" "$2"
`;
 const result=run(script,[project,archives,capture]);assert.equal(result.status,0,result.stderr);
 const calls=fs.readFileSync(capture,'utf8').trimEnd().split('\n').map(line=>line.split('\0').filter(Boolean));assert.equal(calls.length,4);
 for(let i=0;i<calls.length;i+=2){
  const [command,...args]=calls[i];assert.equal(command,'xcodebuild');assert.deepEqual(args.slice(0,8),['-workspace',project+'/ios/App/App.xcworkspace','-scheme','App','-configuration','Release','-destination','generic/platform=iOS']);
  assert.equal(args[8],'-archivePath');const archive=args[9];assert.equal(path.dirname(archive),archives);assert.match(path.basename(archive),/^BasketBoss-1\.0\.2-build43-\d{6}-\d+-\d+\.xcarchive$/);
  assert.deepEqual(args.slice(10),['-allowProvisioningUpdates','archive']);assert.deepEqual(calls[i+1],['open',archive]);assert.ok(fs.statSync(archive).isDirectory());
 }
 assert.notEqual(calls[0][10],calls[2][10]);assert.match(result.stdout,/Distribute App > App Store Connect > Upload/);assert.match(result.stdout,/has not been uploaded/);
});

test('an archive build failure cannot open an archive or claim upload readiness',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bb43-archive-failure-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const result=run('set -euo pipefail\nxcodebuild() { return 65; }\nopen() { printf "unexpected-open\\n"; }\nbb43ArchiveProject "$1" "$2"',[path.join(folder,'project'),path.join(folder,'archives')]);
 assert.equal(result.status,65);assert.doesNotMatch(result.stdout,/unexpected-open|Archive ready|Distribute App/);
});

test('archive handoff stays after the verified 700 sync and contains no automatic upload command',()=>{
 const sync=source.indexOf('node tools/catalogue700/sync-ios.mjs'),handoff=source.indexOf('if [[ "$BB43_MODE" ==');assert.ok(sync>=0&&handoff>sync);
 assert.match(source,/bb43ArchiveProject "\$BB43_DIR" "\$HOME\/Library\/Developer\/Xcode\/Archives\/\$\(date '\+%Y-%m-%d'\)"/);
 assert.match(source,/open "\$BB43_DIR\/ios\/App\/App\.xcworkspace"/);assert.doesNotMatch(source,/altool|notarytool|iTMSTransporter|-exportArchive|-upload-app|appstoreconnect/);
 assert.match(fs.readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj',import.meta.url),'utf8'),/DEVELOPMENT_TEAM = J25UTUATD2/);
});
