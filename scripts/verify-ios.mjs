#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyNativeWeb} from './build-native-web.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Xcode may quote OpenStep string values when saving project settings. Compare
// their values, rather than one spelling of an otherwise identical assignment.
function buildSetting(project,name){
 const pattern=new RegExp('^[\\t ]*(?:"'+name+'"|'+name+')[\\t ]*=[\\t ]*("(?:\\\\.|[^"\\\\])*"|[^;\\r\\n]*?)[\\t ]*;','gm');
 return [...project.matchAll(pattern)].map(match=>{
  const token=match[1].trim();
  if(!token.startsWith('"'))return token.replace(/\s*\/\*.*?\*\/\s*$/,'').trim();
  try{return JSON.parse(token);}catch{throw Error('Invalid quoted Xcode setting: '+name);}
 });
}
export function verifyXcodeSettings(project){
 const minimums=buildSetting(project,'IPHONEOS_DEPLOYMENT_TARGET');
 assert.ok(minimums.length>=4,'Xcode project must define IPHONEOS_DEPLOYMENT_TARGET for project and app configurations.');
 assert.ok(minimums.every(value=>value==='16.0'),'IPHONEOS_DEPLOYMENT_TARGET must be 16.0 in every configuration.');
 for(const [name,expected] of [['DEVELOPMENT_TEAM','J25UTUATD2'],['PRODUCT_BUNDLE_IDENTIFIER','uk.co.basketboss.app']]){
  const values=buildSetting(project,name);
  assert.equal(values.length,2,name+' must be defined for both App Debug and Release; found '+values.length+'. Check App → Signing & Capabilities.');
  assert.ok(values.every(value=>value===expected),name+' must be '+expected+' for both App Debug and Release; found '+[...new Set(values)].join(', ')+'. Check App → Signing & Capabilities.');
 }
}
export function verifyIOS(directory=root){
 const read=file=>fs.readFileSync(path.join(directory,file),'utf8');
 const config=JSON.parse(read('capacitor.config.json'));
 assert.equal(config.appId,'uk.co.basketboss.app');assert.equal(config.appName,'BasketBoss');assert.equal(config.webDir,'dist/native');
 assert.equal(config.server.iosScheme,'capacitor');assert.equal(config.server.hostname,'localhost');assert.equal(config.server.url,undefined);assert.equal(config.plugins.CapacitorHttp.enabled,false);
 const project=read('ios/App/App.xcodeproj/project.pbxproj');
 verifyXcodeSettings(project);
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
