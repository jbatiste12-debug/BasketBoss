import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ANDROID_ROOT,androidDocument,treeDigest,verifyAndroidWeb} from '../scripts/build-android-web.mjs';
import {verifyAndroid} from '../scripts/verify-android.mjs';

test('Android generated documents remove Apple purchase copy before first paint without changing source HTML',()=>{
 const source='<head><meta name="basketboss-native-build" content="ios"></head><body><p>Use 200 recipes free, or choose Apple Premium.</p><div id="bbNativePlanComparison" data-bb-membership-comparison></div></body>',copy=androidDocument(source);
 assert.match(copy,/content="android"/);assert.match(copy,/sign in to view your Premium options/);assert.doesNotMatch(copy,/choose Apple Premium|data-bb-membership-comparison/);assert.match(source,/choose Apple Premium/);assert.throws(()=>androidDocument('<head></head>'));
});
test('Android source locks package/version/target and protects the shared iOS configuration',()=>{
 const result=verifyAndroid({assets:false});assert.equal(result.appId,'uk.co.basketboss.app');assert.equal(result.versionName,'1.0.2');assert.equal(result.versionCode,2);assert.equal(result.targetSdk,36);
 const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/android-ios-baseline.json',import.meta.url)));
 const current=JSON.parse(fs.readFileSync(path.join(ANDROID_ROOT,'capacitor.config.json')));assert.deepEqual(current.ios,baseline.ios);assert.deepEqual(current.plugins,baseline.plugins);assert.equal(current.server.iosScheme,baseline.iosScheme);
 for(const [name,hash]of Object.entries(baseline.files))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ANDROID_ROOT,name))).digest('hex'),hash,'Protected iOS/core source changed: '+name);
});
test('iOS directory guard detects changes without following symbolic links',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-android-ios-guard-'));
 try{fs.writeFileSync(path.join(dir,'source'),'before');const before=treeDigest(dir);fs.writeFileSync(path.join(dir,'source'),'after');assert.notEqual(treeDigest(dir),before);fs.symlinkSync('/does-not-exist',path.join(dir,'link'));assert.doesNotThrow(()=>treeDigest(dir));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('upload keys, credentials and generated platform outputs are excluded from Git',()=>{
 for(const name of ['android/keystore.properties','android/upload.jks','secret.jks','android/local.properties','android/app/build/outputs/bundle/release/app-release.aab'])assert.equal(execFileSync('git',['check-ignore','--no-index',name],{cwd:ANDROID_ROOT,encoding:'utf8'}).trim(),name);
});
const generated=path.join(ANDROID_ROOT,'android/app/src/main/assets/public');
test('actual synced Android bundle has matching catalogue proofs and isolated runtime',{skip:!fs.existsSync(generated)},()=>{
 assert.equal(verifyAndroidWeb({directory:generated,platformFiles:true,imageDirectory:path.join(ANDROID_ROOT,'android/recipeImages/src/main/assets/public')}).ok,true);
});
test('install-time verification rejects a duplicate base document inside the image pack',{skip:!fs.existsSync(generated)},()=>{
 const images=path.join(ANDROID_ROOT,'android/recipeImages/src/main/assets/public'),extra=path.join(images,'index.html');
 try{fs.copyFileSync(path.join(generated,'index.html'),extra);assert.throws(()=>verifyAndroidWeb({directory:generated,platformFiles:true,imageDirectory:images}),/Duplicate base\/pack asset/);}
 finally{fs.rmSync(extra,{force:true});}
});
test('install-time verification rejects changed or missing image bytes',{skip:!fs.existsSync(generated)},()=>{
 const images=path.join(ANDROID_ROOT,'android/recipeImages/src/main/assets/public'),manifest=JSON.parse(fs.readFileSync(path.join(generated,'native-web-manifest.json'))),row=manifest.files.find(value=>value.path.startsWith('food-thumbs/')&&value.path.endsWith('.webp')),file=path.join(images,row.path),before=fs.readFileSync(file);
 try{
  fs.writeFileSync(file,'changed-test-image');assert.throws(()=>verifyAndroidWeb({directory:generated,platformFiles:true,imageDirectory:images}),/Asset size changed/);
  fs.unlinkSync(file);assert.throws(()=>verifyAndroidWeb({directory:generated,platformFiles:true,imageDirectory:images}),/assets are missing/);
 }finally{fs.writeFileSync(file,before);}
});
test('install-time verification rejects an edited platform inventory',{skip:!fs.existsSync(generated)},()=>{
 const images=path.join(ANDROID_ROOT,'android/recipeImages/src/main/assets/public'),file=path.join(generated,'native-web-manifest.json'),before=fs.readFileSync(file);
 try{const changed=JSON.parse(before);changed.files[0].sha256='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(changed));assert.throws(()=>verifyAndroidWeb({directory:generated,platformFiles:true,imageDirectory:images}),/inventory differs/);}
 finally{fs.writeFileSync(file,before);}
});
