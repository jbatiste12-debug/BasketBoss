#!/usr/bin/env node
// Explicit future-700 archive staging. Standard ios:sync and its configuration
// stay on catalogue500; this wrapper performs an additional verified copy.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyNativeWeb} from '../../scripts/build-native-web.mjs';
import {validatePublic700Release,build700Client,verify700Client} from './build-client.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const assert=(value,message)=>{if(!value)throw Error('catalogue700_ios_'+message);};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(name,'utf8'));
const PLATFORM_EXTRA=/^(?:cordova(?:_plugins)?\.js|capacitor\.js(?:\.map)?|plugins\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.js)$/;
const FORBIDDEN=/(?:^|\/)\.[^/]+|(?:^|\/)(?:\.git|node_modules|sql|functions|bb-server-lib)(?:\/|$)|\.(?:sql|sealed\.json|private\.json|backup)$/i;

function files(directory,relative=''){
 const result=[];
 for(const entry of fs.readdirSync(path.join(directory,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const name=relative?relative+'/'+entry.name:entry.name;
  assert(!entry.isSymbolicLink()&&!FORBIDDEN.test(name),'unsafe_asset');
  if(entry.isDirectory())result.push(...files(directory,name));else{assert(entry.isFile(),'nonregular_asset');result.push(name);}
 }
 return result;
}
function copy(source,destination){
 for(const name of files(source)){const target=path.join(destination,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,name),target);}
}
function inventory(directory){return files(directory).filter(name=>name!=='native-web-manifest.json').map(name=>{const bytes=fs.readFileSync(path.join(directory,name));return {path:name,bytes:bytes.length,sha256:hash(bytes)};});}

export function stage700IOSAssets({bundleDirectory,baselineDirectory,iosPublicDirectory,release}){
 bundleDirectory=fs.realpathSync(bundleDirectory);baselineDirectory=fs.realpathSync(baselineDirectory);iosPublicDirectory=path.resolve(iosPublicDirectory);
 assert(![bundleDirectory,baselineDirectory].some(source=>iosPublicDirectory===source||iosPublicDirectory.startsWith(source+path.sep)||source.startsWith(iosPublicDirectory+path.sep)),'overlapping_paths');
 verifyNativeWeb({directory:baselineDirectory});verify700Client({directory:bundleDirectory,release});
 assert(fs.existsSync(iosPublicDirectory)&&fs.lstatSync(iosPublicDirectory).isDirectory()&&!fs.lstatSync(iosPublicDirectory).isSymbolicLink(),'missing_synced_public');
 const base=read(path.join(baselineDirectory,'native-web-manifest.json')),baseFiles=new Set([...base.files.map(row=>row.path),'native-web-manifest.json']);
 // Capacitor sync must have copied the clean legacy native directory first.
 for(const name of baseFiles)assert(fs.readFileSync(path.join(baselineDirectory,name)).equals(fs.readFileSync(path.join(iosPublicDirectory,name))),'baseline_copy_mismatch');
 const extras=files(iosPublicDirectory).filter(name=>!baseFiles.has(name));
 assert(extras.every(name=>PLATFORM_EXTRA.test(name)),'unexpected_platform_asset');
 const parent=path.dirname(iosPublicDirectory),staging=fs.mkdtempSync(path.join(parent,'.catalogue700-public-')),backup=staging+'-previous';
 let movedOld=false,movedNew=false;
 try{
  copy(bundleDirectory,staging);
  const extraHashes=[];
  for(const name of extras){assert(!fs.existsSync(path.join(staging,name)),'platform_asset_collision');const bytes=fs.readFileSync(path.join(iosPublicDirectory,name)),target=path.join(staging,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);extraHashes.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
  const manifest=read(path.join(staging,'native-web-manifest.json'));manifest.platformGeneratedFiles=extraHashes;manifest.files=inventory(staging);
  fs.writeFileSync(path.join(staging,'native-web-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const checked=verify700Client({directory:staging,release});
  fs.renameSync(iosPublicDirectory,backup);movedOld=true;fs.renameSync(staging,iosPublicDirectory);movedNew=true;
  verify700Client({directory:iosPublicDirectory,release});
  fs.rmSync(backup,{recursive:true});movedOld=false;
  return {directory:iosPublicDirectory,freeRecipes:200,expectedPremium:500,catalogueVersion:700,files:checked.files,preservedPlatformFiles:extraHashes.map(row=>row.path),xcodeBuildVerified:false};
 }catch(error){
  if(movedNew)fs.rmSync(iosPublicDirectory,{recursive:true,force:true});
  if(movedOld&&fs.existsSync(backup))fs.renameSync(backup,iosPublicDirectory);
  fs.rmSync(staging,{recursive:true,force:true});throw error;
 }
}

function standardSync(root){
 const result=spawnSync(process.execPath,[path.join(root,'scripts/ios-sync.mjs')],{cwd:root,stdio:'inherit'});
 if(result.error||result.status!==0)throw Error('catalogue700_ios_standard_sync_failed: '+(result.error?.message||result.status));
}

export async function sync700IOS({root=ROOT,publicRelease,outputDirectory,platform=process.platform,runStandardSync=standardSync}={}){
 assert(platform==='darwin','requires_macos_xcode');root=fs.realpathSync(root);
 const configFile=path.join(root,'capacitor.config.json'),configBytes=fs.readFileSync(configFile),config=JSON.parse(configBytes);
 assert(config.appId==='uk.co.basketboss.app'&&config.webDir==='dist/native'&&config.server?.url===undefined,'legacy_config_changed');
 // A missing image/partial release must fail before even standard sync runs.
 const release=validatePublic700Release({directory:publicRelease,sourceDirectory:root});
 const iosPublic=path.join(root,'ios/App/App/public'),holder=fs.mkdtempSync(path.join(os.tmpdir(),'basketboss700-ios-rollback-')),prior=path.join(holder,'public');
 const existed=fs.existsSync(iosPublic);
 if(existed){assert(fs.lstatSync(iosPublic).isDirectory()&&!fs.lstatSync(iosPublic).isSymbolicLink(),'unsafe_existing_public');fs.mkdirSync(prior);copy(iosPublic,prior);}
 try{
  await runStandardSync(root);
  assert(fs.readFileSync(configFile).equals(configBytes),'config_mutated_during_sync');
  const native=path.join(root,'dist/native');verifyNativeWeb({directory:native});
  const built=await build700Client({sourceRoot:native,publicRelease,outputDirectory,prepareNative:false,clientAssetsRoot:root});
  const staged=stage700IOSAssets({bundleDirectory:built.directory,baselineDirectory:native,iosPublicDirectory:iosPublic,release});
  assert(fs.readFileSync(configFile).equals(configBytes),'config_mutated_during_staging');
  fs.rmSync(holder,{recursive:true});
  return {...staged,clientVersion:'1.0.2',activationEligible:false,archiveUploaded:false,standardSyncStillCatalogue500:true};
 }catch(error){
  if(fs.existsSync(iosPublic))fs.rmSync(iosPublic,{recursive:true,force:true});
  if(existed){fs.mkdirSync(iosPublic,{recursive:true});copy(prior,iosPublic);}
  fs.rmSync(holder,{recursive:true,force:true});throw error;
 }
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),opt=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
 try{
  const result=await sync700IOS({root:opt('--source-root',ROOT),publicRelease:opt('--public-release',path.join(ROOT,'catalogues/700/release')),outputDirectory:opt('--output-dir',path.join(os.tmpdir(),'basketboss-catalogue700-native'))});
  console.log(JSON.stringify(result,null,2));
  console.log('Verified catalogue700 assets are now in the iOS project. Do not run ordinary ios:sync afterward: it stages the legacy catalogue. Open the Xcode workspace, confirm version1.0.2 and a higher unused build number, then test on device before archiving.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
