#!/usr/bin/env node
// Android is a generated variant. Never alter the iOS entry, assets or verifier.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildNativeWeb,versionNativeHtml} from './build-native-web.mjs';
import {build700Client,validatePublic700Release,verify700Client} from '../tools/catalogue700/build-client.mjs';

export const ANDROID_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=(dir,name)=>fs.readFileSync(path.join(dir,name));
const json=(dir,name)=>JSON.parse(read(dir,name));
export function androidDocument(source){
 assert.match(source,/<meta name="basketboss-native-build" content="ios">/);
 return source.replace('<meta name="basketboss-native-build" content="ios">','<meta name="basketboss-native-build" content="android">')
  .replace(/Use (?:100|200) recipes free, or choose Apple Premium\./g,'Use 200 recipes free, or sign in to your existing account. Purchases are not available in this Android test build.')
  .replace('<div id="bbNativePlanComparison" data-bb-membership-comparison></div>','<div id="bbNativePlanComparison" hidden></div>');
}
export function treeDigest(dir){
 const hash=createHash('sha256');
 const visit=(folder,prefix='')=>{if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const name=prefix+entry.name,file=path.join(folder,entry.name);hash.update(name+'\0');
  if(entry.isSymbolicLink())hash.update('link:'+fs.readlinkSync(file));
  else if(entry.isDirectory())visit(file,name+'/');else if(entry.isFile())hash.update(fs.readFileSync(file));
 }};visit(dir);return hash.digest('hex');
}
export function verifyAndroidWeb({root=ANDROID_ROOT,directory=path.join(root,'dist/android'),platformFiles=false,imageDirectory=null}={}){
 if(imageDirectory){
  // Install-time packs are APK asset splits. Validate their union against the
  // complete, already security-verified client; never relax the iOS verifier.
  const referenceDirectory=path.join(root,'dist/android');assert.notEqual(directory,referenceDirectory);
  const reference=verifyAndroidWeb({root,directory:referenceDirectory});
  assert.ok(read(directory,'native-web-manifest.json').equals(read(referenceDirectory,'native-web-manifest.json')),'Android asset inventory differs from the verified build');
  const expected=new Map(json(referenceDirectory,'native-web-manifest.json').files.map(row=>[row.path,row]));
  const seen=new Set();let packBytes=0,baseBytes=0;
  const walk=(folder,prefix='',pack=false)=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   const name=prefix+entry.name,file=path.join(folder,entry.name);assert.ok(!entry.isSymbolicLink(),'Asset symlinks are not supported');
   if(entry.isDirectory()){walk(file,name+'/',pack);continue;}
   assert.ok(entry.isFile());assert.ok(!seen.has(name),'Duplicate base/pack asset: '+name);seen.add(name);
   const bytes=fs.readFileSync(file);if(pack)packBytes+=bytes.length;else baseBytes+=bytes.length;
   if(name==='native-web-manifest.json'){assert.equal(pack,false);continue;}
   const declared=expected.get(name);
   if(!declared){assert.ok(!pack&&platformFiles&&['cordova.js','cordova_plugins.js'].includes(name),'Unexpected platform asset: '+name);continue;}
   assert.equal(bytes.length,declared.bytes,'Asset size changed: '+name);assert.equal(sha(bytes),declared.sha256,'Asset bytes changed: '+name);
   assert.equal(pack,/^(photos|release-assets|food-thumbs)\//.test(name),'Asset in wrong Android module: '+name);expected.delete(name);
  }};
  walk(directory);walk(imageDirectory,'',true);assert.equal(expected.size,0,'Install-time assets are missing');
  return {...reference,installTimeImagePack:true,baseWebBytes:baseBytes,imagePackBytes:packBytes};
 }
 const release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 const verified=verify700Client({directory,release,requireInventory:false});
 const manifest=json(directory,'native-web-manifest.json');
 assert.equal(manifest.platform,'android');assert.equal(manifest.appId,'uk.co.basketboss.app');assert.equal(manifest.appName,'BasketBoss');
 assert.equal(manifest.webOrigin,'https://localhost');assert.equal(manifest.catalogueVersion,700);assert.equal(manifest.freeRecipes,200);assert.equal(manifest.privateRecipeBundle,false);
 const expected=new Map(manifest.files.map(row=>[row.path,row]));
 for(const row of verified.fileHashes){
  if(row.path==='native-web-manifest.json')continue;
  const declared=expected.get(row.path);
  if(!declared){assert.ok(platformFiles&&['cordova.js','cordova_plugins.js'].includes(row.path),'Unexpected Android asset: '+row.path);continue;}
  assert.deepEqual(row,declared,'Android asset changed: '+row.path);expected.delete(row.path);
 }
 assert.equal(expected.size,0,'Android assets are missing');
 for(const row of verified.fileHashes.filter(row=>row.path.endsWith('.html'))){
  const html=read(directory,row.path).toString();assert.match(html,/<meta name="basketboss-native-build" content="android">/);
  assert.doesNotMatch(html,/<meta name="basketboss-native-build" content="ios">|choose Apple Premium/);
 }
 const runtime=read(directory,'bb-native-runtime.js').toString();
 assert.ok(runtime.includes('bb-native-android'));assert.doesNotMatch(runtime,/BasketBossAppleAuth|BasketBossPurchases|BasketBossCookVoice|uk\.co\.basketboss\.premium\.monthly/);
 assert.ok(read(directory,'bb-native.css').includes(Buffer.from('.bb-native-android')));
 return {ok:true,appId:manifest.appId,platform:'android',catalogueVersion:700,freeRecipes:200,premiumRecipes:500,privateRecipeBundle:false,files:verified.files};
}
export async function buildAndroidWeb({root=ANDROID_ROOT,output=path.join(root,'dist/android')}={}){
 const ios=treeDigest(path.join(root,'ios')),configuration=read(root,'capacitor.config.json');
 const config=JSON.parse(configuration);assert.equal(config.appId,'uk.co.basketboss.app');assert.equal(config.appName,'BasketBoss');
 const target=path.resolve(output);assert.equal(target,path.join(root,'dist/android'),'Only the ignored Android output may be replaced');
 if(fs.existsSync(target))assert.ok(!fs.lstatSync(target).isSymbolicLink(),'Android output must not be a symlink');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'basketboss-android-web-'));
 try{
  const baseline=await buildNativeWeb({root});
  const staged=path.join(temporary,'client');
  await build700Client({sourceRoot:baseline.directory,clientAssetsRoot:root,publicRelease:path.join(root,'catalogues/700/release'),outputDirectory:staged,prepareNative:false});
  const {build}=await import('esbuild');
  await build({entryPoints:[path.join(root,'native/android-runtime.mjs')],outfile:path.join(staged,'bb-native-runtime.js'),bundle:true,format:'iife',platform:'browser',target:'es2020',charset:'utf8',legalComments:'none',minify:true,logLevel:'silent',absWorkingDir:root});
  fs.copyFileSync(path.join(root,'native/android.css'),path.join(staged,'bb-native.css'));
  const htmlFiles=fs.readdirSync(staged).filter(name=>name.endsWith('.html'));
  for(const name of htmlFiles)fs.writeFileSync(path.join(staged,name),androidDocument(read(staged,name).toString()));
  const asset=name=>{const file=path.join(staged,name);return fs.existsSync(file)&&fs.statSync(file).isFile()?fs.readFileSync(file):null;},documents=new Map();
  for(const name of htmlFiles){const html=versionNativeHtml(read(staged,name).toString(),asset);fs.writeFileSync(path.join(staged,name),html);documents.set(name,sha(Buffer.from(html)).slice(0,16));}
  for(const name of htmlFiles)fs.writeFileSync(path.join(staged,name),versionNativeHtml(read(staged,name).toString(),asset,documents));
  const release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
  const proof=verify700Client({directory:staged,release,requireInventory:false}),manifest=json(staged,'native-web-manifest.json');
  Object.assign(manifest,{platform:'android',webOrigin:'https://localhost',files:proof.fileHashes.filter(row=>row.path!=='native-web-manifest.json')});
  fs.writeFileSync(path.join(staged,'native-web-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  verifyAndroidWeb({root,directory:staged});
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.rmSync(target,{recursive:true,force:true});fs.renameSync(staged,target);
  assert.equal(treeDigest(path.join(root,'ios')),ios,'Android build modified iOS files');assert.ok(configuration.equals(read(root,'capacitor.config.json')),'Android build modified shared configuration');
  return verifyAndroidWeb({root,directory:target});
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(await buildAndroidWeb()));}catch(error){console.error(error.message);process.exitCode=1;}}
