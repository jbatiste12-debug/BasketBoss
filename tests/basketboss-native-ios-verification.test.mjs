import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyXcodeSettings} from '../scripts/verify-ios.mjs';

const project=fs.readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj',import.meta.url),'utf8');

test('iOS verification accepts equivalent quoted and spaced Xcode settings',()=>{
 assert.doesNotThrow(()=>verifyXcodeSettings(project));
 const rewritten=project.replace(/(IPHONEOS_DEPLOYMENT_TARGET|DEVELOPMENT_TEAM|PRODUCT_BUNDLE_IDENTIFIER) = ([\w.]+);/g,(_,key,value)=>'"'+key+'"\t=\t"'+value+'" ;');
 assert.notEqual(rewritten,project);assert.doesNotThrow(()=>verifyXcodeSettings(rewritten.replace(/\n/g,'\r\n')));
});

test('iOS verification names wrong or missing settings and keeps App Store identity checks',()=>{
 assert.throws(()=>verifyXcodeSettings(project.replaceAll('J25UTUATD2','OTHERTEAM1')),/DEVELOPMENT_TEAM must be J25UTUATD2/);
 assert.throws(()=>verifyXcodeSettings(project.replaceAll('uk.co.basketboss.app','example.other.app')),/PRODUCT_BUNDLE_IDENTIFIER must be uk\.co\.basketboss\.app/);
 assert.throws(()=>verifyXcodeSettings(project.replaceAll('DEVELOPMENT_TEAM = J25UTUATD2;','')),/DEVELOPMENT_TEAM must be defined.*found 0/);
 assert.throws(()=>verifyXcodeSettings(project.replaceAll('IPHONEOS_DEPLOYMENT_TARGET = 16.0;','IPHONEOS_DEPLOYMENT_TARGET = "15.0";')),/IPHONEOS_DEPLOYMENT_TARGET must be 16\.0/);
});
