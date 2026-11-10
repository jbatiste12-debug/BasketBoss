import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('both unsigned archive workflows label and verify the actual Xcode version and build',()=>{
 const project=read('ios/App/App.xcodeproj/project.pbxproj');
 const builds=[...project.matchAll(/CURRENT_PROJECT_VERSION\s*=\s*(\d+)\s*;/g)].map(m=>m[1]);
 const versions=[...project.matchAll(/MARKETING_VERSION\s*=\s*([\d.]+)\s*;/g)].map(m=>m[1]);
 assert.equal(builds.length,2);assert.equal(new Set(builds).size,1);assert.equal(versions.length,2);assert.equal(new Set(versions).size,1);
 for(const file of ['ios-catalogue700-build.yml','ios-native-build.yml']){
  const workflow=read('.github/workflows/'+file),checks=workflow.split('\n').filter(line=>line.includes("Print CFBundleVersion"));
  assert.equal(checks.length,1,file+' must verify its built archive');
  assert.equal(checks[0].match(/=\s*'(\d+)'/)?.[1],builds[0],file+' archive assertion must match the project build');
  const archives=[...workflow.matchAll(/BasketBoss-(?:legacy500-)?([\d.]+)-build(\d+)/g)];
  assert.ok(archives.length>=4,file+' must retain its built archive');
  for(const match of archives){assert.equal(match[1],versions[0],file+' archive version');assert.equal(match[2],builds[0],file+' archive build');}
 }
});
