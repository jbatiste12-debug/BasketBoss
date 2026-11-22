#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ANDROID_ROOT,verifyAndroidWeb} from './build-android-web.mjs';
export function verifyAndroid({root=ANDROID_ROOT,assets=true}={}){
 const read=name=>fs.readFileSync(path.join(root,name),'utf8');
 const config=JSON.parse(read('capacitor.config.json')),packageFile=JSON.parse(read('package.json'));
 assert.equal(config.appId,'uk.co.basketboss.app');assert.equal(config.appName,'BasketBoss');assert.equal(config.server.androidScheme,'https');
 assert.equal(config.server.iosScheme,'capacitor');assert.equal(config.webDir,'dist/native');
 for(const name of ['android','core','ios'])assert.equal(packageFile.dependencies['@capacitor/'+name],'8.6.0');
 const gradle=read('android/app/build.gradle'),variables=read('android/variables.gradle'),manifest=read('android/app/src/main/AndroidManifest.xml');
 assert.match(gradle,/namespace\s*=\s*"uk\.co\.basketboss\.app"/);assert.match(gradle,/applicationId "uk\.co\.basketboss\.app"/);
 assert.match(gradle,/versionCode 8\b/);assert.match(gradle,/versionName "1\.0\.8"/);assert.match(variables,/targetSdkVersion = 36/);assert.match(variables,/compileSdkVersion = 36/);
 assert.match(gradle,/rootProject\.file\('keystore.properties'\)/);assert.match(gradle,/signingConfig signingConfigs.upload/);assert.match(gradle,/Release signing is required/);
 assert.match(manifest,/android:scheme="basketboss" android:host="auth" android:path="\/callback"/);
 assert.match(manifest,/android:usesCleartextTraffic="false"/);assert.match(manifest,/android:allowBackup="false"/);assert.match(manifest,/android:windowSoftInputMode="adjustResize"/);
 const result={ok:true,appId:config.appId,appName:config.appName,versionName:'1.0.8',versionCode:8,targetSdk:36};
 assert.match(manifest,/com\.android\.vending\.BILLING/);
 assert.match(gradle,/com\.android\.billingclient:billing:9\.1\.0/);
 assert.match(gradle,/assetPacks = \[":recipeImages"\]/);
 assert.match(read('android/recipeImages/build.gradle'),/deliveryType = "install-time"/);
 return assets?{...result,...verifyAndroidWeb({root,directory:path.join(root,'android/app/src/main/assets/public'),platformFiles:true,imageDirectory:path.join(root,'android/recipeImages/src/main/assets/public')})}:result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(verifyAndroid()));}catch(error){console.error(error.message);process.exitCode=1;}}
