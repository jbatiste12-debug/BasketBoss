#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildNativeWeb} from './build-native-web.mjs';
import {verifyXcodeSettings} from './verify-ios.mjs';
import fs from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(command,args,capture=false){
 const result=spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit'});
 if(result.error||result.status!==0)throw Error(command+' '+args.join(' ')+' failed. '+(result.error?.message||result.stderr||''));
 return result.stdout||'';
}
try{
 if(process.platform!=='darwin')throw Error('The full iOS sync needs macOS, Xcode26+ and CocoaPods. On this machine use npm run build:native and npm run ios:verify for portable checks.');
 const version=run('xcodebuild',['-version'],true);
 if(Number(version.match(/Xcode\s+(\d+)/)?.[1]||0)<26)throw Error('Capacitor8 requires Xcode26 or newer. Install full Xcode and select it with sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer.');
 run('pod',['--version'],true);
 const result=await buildNativeWeb();console.log('Built '+result.files+' native web assets. PWA source files are unchanged.');
 run(process.execPath,[path.join(root,'node_modules/@capacitor/cli/bin/capacitor'),'sync','ios']);
 run(process.execPath,[path.join(root,'scripts/verify-ios.mjs')]);
 const {team}=verifyXcodeSettings(fs.readFileSync(path.join(root,'ios/App/App.xcodeproj/project.pbxproj'),'utf8'));
 console.log('\nReady for Xcode. Signing team: '+team+'.\nOpen: open ios/App/App.xcworkspace\nFor TestFlight, select Any iOS Device (arm64), then Product > Archive. In Organizer choose Distribute App > App Store Connect > Upload. To test directly, select your connected iPhone and press Run.');
}catch(error){console.error('iOS sync: '+error.message);process.exitCode=1;}
