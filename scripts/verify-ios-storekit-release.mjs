#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// Inspect the actual Release app. A missing inspection tool is a failure,
// never evidence that the test-only StoreKit framework was not linked.
export function verifyStoreKitRelease({appDirectory,inspect=execFileSync}={}){
 if(typeof appDirectory!=='string'||!appDirectory.trim())throw Error('STOREKIT_RELEASE_APP_REQUIRED');
 const app=path.resolve(appDirectory);
 if(!fs.statSync(app).isDirectory())throw Error('STOREKIT_RELEASE_APP_INVALID');
 try{fs.lstatSync(path.join(app,'BasketBossPremium.storekit'));throw Error('STOREKIT_RELEASE_FIXTURE_PRESENT');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const binary=path.join(app,'App');fs.accessSync(binary,fs.constants.R_OK);
 const linked=inspect('otool',['-L',binary],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 if(typeof linked!=='string'||!linked.trim())throw Error('STOREKIT_RELEASE_INSPECTION_INVALID');
 if(linked.includes('StoreKitTest'))throw Error('STOREKIT_RELEASE_TEST_FRAMEWORK_LINKED');
 return {fixtureExcluded:true,testFrameworkExcluded:true,binaryInspected:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--app')throw Error('STOREKIT_RELEASE_APP_REQUIRED');
  console.log(JSON.stringify(verifyStoreKitRelease({appDirectory:args[1]})));
 }catch(error){
  const reason=/^STOREKIT_RELEASE_[A-Z_]+$/.test(error.message)?error.message:'STOREKIT_RELEASE_INSPECTION_FAILED';
  console.error('Release StoreKit verification failed: '+reason);process.exitCode=1;
 }
}
