#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyNativeWeb} from './build-native-web.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function verifyIOS(directory=root){
 const read=file=>fs.readFileSync(path.join(directory,file),'utf8');
 const config=JSON.parse(read('capacitor.config.json'));
 assert.equal(config.appId,'uk.co.basketboss.app');assert.equal(config.appName,'BasketBoss');assert.equal(config.webDir,'dist/native');
 assert.equal(config.server.iosScheme,'capacitor');assert.equal(config.server.hostname,'localhost');assert.equal(config.server.url,undefined);assert.equal(config.plugins.CapacitorHttp.enabled,false);
 const project=read('ios/App/App.xcodeproj/project.pbxproj');
 const minimums=[...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map(m=>m[1]);assert.ok(minimums.length>=4);assert.ok(minimums.every(value=>value==='16.0'));
 assert.equal((project.match(/DEVELOPMENT_TEAM = J25UTUATD2;/g)||[]).length,2);assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = uk.co.basketboss.app;/g)||[]).length,2);
 assert.match(project,/PrivacyInfo\.xcprivacy in Resources/);assert.match(read('ios/App/Podfile'),/platform :ios, '16\.0'/);
 const plist=read('ios/App/App/Info.plist');
 for(const value of ['NSCameraUsageDescription','NSPhotoLibraryUsageDescription','UIViewControllerBasedStatusBarAppearance','basketboss','ITSAppUsesNonExemptEncryption'])assert.ok(plist.includes(value));
 assert.doesNotMatch(plist,/NSAllowsArbitraryLoads/);
 assert.match(read('ios/App/App.xcworkspace/contents.xcworkspacedata'),/group:App\.xcodeproj/);
 const icon=fs.readFileSync(path.join(directory,'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));
 assert.equal(icon.readUInt32BE(16),1024);assert.equal(icon.readUInt32BE(20),1024);assert.ok([0,2].includes(icon[25]),'App Store icon must be opaque');
 const bundle=verifyNativeWeb({directory:path.join(directory,'dist/native')});
 return {bundleId:config.appId,team:'J25UTUATD2',minimumIOS:'16.0',...bundle,xcodeBuildVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(verifyIOS(),null,2));console.log('Portable checks passed. Signing, CocoaPods installation and device builds must be verified on your Mac.');}
 catch(error){console.error('iOS verification failed: '+error.message);process.exitCode=1;}
}
