#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ANDROID_ROOT,buildAndroidWeb,verifyAndroidWeb,treeDigest} from './build-android-web.mjs';

export async function syncAndroid({root=ANDROID_ROOT}={}){
 const original=fs.readFileSync(path.join(root,'capacitor.config.json')),ios=treeDigest(path.join(root,'ios'));
 const require=createRequire(path.join(root,'package.json')),cliRoot=path.dirname(require.resolve('@capacitor/cli/package.json'));
 assert.equal(require('@capacitor/cli/package.json').version,'8.6.0','Review the Android sync adapter before changing Capacitor CLI');
 const {loadConfig}=require(path.join(cliRoot,'dist/config.js')),{copy}=require(path.join(cliRoot,'dist/tasks/copy.js')),{update}=require(path.join(cliRoot,'dist/tasks/update.js'));
 const built=await buildAndroidWeb({root}),previous=process.cwd();
 try{
  process.chdir(root);const config=await loadConfig();
  config.app.webDir='dist/android';config.app.webDirAbs=path.join(root,'dist/android');
  config.app.extConfig={...config.app.extConfig,webDir:'dist/android',server:{...config.app.extConfig.server,androidScheme:'https'},plugins:{...config.app.extConfig.plugins,StatusBar:{...config.app.extConfig.plugins?.StatusBar,overlaysWebView:true},SystemBars:{insetsHandling:'css',initialViewportFitValueHint:'cover',style:'LIGHT'}}};
  // Equivalent to cap sync android, using an in-memory Android configuration.
  // Separate copy/update calls retain failure propagation; shared JSON stays untouched.
  await copy(config,'android');await update(config,'android',false);
  const destination=path.join(root,'android/app/src/main/assets/public');
  verifyAndroidWeb({root,directory:destination,platformFiles:true});
  const imageDirectory=path.join(root,'android/recipeImages/src/main/assets/public');
  if(fs.existsSync(imageDirectory))assert.ok(!fs.lstatSync(imageDirectory).isSymbolicLink(),'Image-pack output must not be a symlink');
  fs.rmSync(imageDirectory,{recursive:true,force:true});fs.mkdirSync(imageDirectory,{recursive:true});
  for(const folder of ['photos','release-assets','food-thumbs'])fs.renameSync(path.join(destination,folder),path.join(imageDirectory,folder));
  const verified=verifyAndroidWeb({root,directory:destination,platformFiles:true,imageDirectory});
  const nativeConfig=JSON.parse(fs.readFileSync(path.join(root,'android/app/src/main/assets/capacitor.config.json')));
  assert.equal(nativeConfig.appId,'uk.co.basketboss.app');assert.equal(nativeConfig.server.androidScheme,'https');assert.equal(nativeConfig.plugins.SystemBars.initialViewportFitValueHint,'cover');
  assert.ok(original.equals(fs.readFileSync(path.join(root,'capacitor.config.json'))),'Android sync changed shared configuration');
  assert.equal(ios,treeDigest(path.join(root,'ios')),'Android sync modified iOS files');
  return {...built,...verified,iosUnchanged:true,sharedConfigurationUnchanged:true};
 }finally{process.chdir(previous);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(await syncAndroid()));}catch(error){console.error(error.message);process.exitCode=1;}}
