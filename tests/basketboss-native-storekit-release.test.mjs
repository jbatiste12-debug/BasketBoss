import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyStoreKitRelease} from '../scripts/verify-ios-storekit-release.mjs';

function app(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bb-storekit-release-'));
 const directory=path.join(folder,'App.app');fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'App'),'release executable');
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return directory;
}
const productionLinks='App:\n\t/System/Library/Frameworks/StoreKit.framework/StoreKit (compatibility version 1.0.0)\n';

test('Release verification inspects the actual binary and accepts ordinary production StoreKit',t=>{
 const directory=app(t),calls=[];
 const result=verifyStoreKitRelease({appDirectory:directory,inspect(...args){calls.push(args);return productionLinks;}});
 assert.deepEqual(result,{fixtureExcluded:true,testFrameworkExcluded:true,binaryInspected:true});
 assert.deepEqual(calls[0].slice(0,2),['otool',['-L',path.join(directory,'App')]]);
 assert.equal(calls[0][2].encoding,'utf8');assert.equal(calls[0][2].timeout,30000);
});
test('a packaged local product fixture fails before binary inspection',t=>{
 const directory=app(t);fs.writeFileSync(path.join(directory,'BasketBossPremium.storekit'),'{}');let inspected=false;
 assert.throws(()=>verifyStoreKitRelease({appDirectory:directory,inspect(){inspected=true;return productionLinks;}}),/STOREKIT_RELEASE_FIXTURE_PRESENT/);
 assert.equal(inspected,false);
});
test('a linked StoreKitTest framework fails Release verification',t=>{
 const directory=app(t);
 assert.throws(()=>verifyStoreKitRelease({appDirectory:directory,inspect:()=>productionLinks+'\t/System/Library/Frameworks/StoreKitTest.framework/StoreKitTest\n'}),/STOREKIT_RELEASE_TEST_FRAMEWORK_LINKED/);
});
test('missing inspection tools and unsuccessful otool exits fail closed',t=>{
 const directory=app(t);
 for(const failure of [Object.assign(Error('not found'),{code:'ENOENT'}),Object.assign(Error('inspection failed'),{status:1})]){
  assert.throws(()=>verifyStoreKitRelease({appDirectory:directory,inspect(){throw failure;}}),error=>error===failure);
 }
});
test('missing binaries and empty or nontext inspection output cannot pass',t=>{
 const directory=app(t);
 for(const linked of ['',null,Buffer.from(productionLinks)])assert.throws(()=>verifyStoreKitRelease({appDirectory:directory,inspect:()=>linked}),/STOREKIT_RELEASE_INSPECTION_INVALID/);
 fs.unlinkSync(path.join(directory,'App'));let inspected=false;
 assert.throws(()=>verifyStoreKitRelease({appDirectory:directory,inspect(){inspected=true;return productionLinks;}}),error=>error.code==='ENOENT');assert.equal(inspected,false);
});
test('both native pipelines use the same fail-closed verifier',()=>{
 for(const name of ['ios-catalogue700-build.yml','apple-subscriptions.yml']){
  const workflow=fs.readFileSync(new URL('../.github/workflows/'+name,import.meta.url),'utf8');
  assert.match(workflow,/node scripts\/verify-ios-storekit-release\.mjs --app \/tmp\/basketboss-ios-build\/Build\/Products\/Release-iphonesimulator\/App\.app/);
  assert.doesNotMatch(workflow,/if otool[^\n]+\| rg StoreKitTest/);
 }
});
