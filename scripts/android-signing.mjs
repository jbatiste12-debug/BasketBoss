#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function propertyValue(value){
 return String(value).split('').map(character=>{
  const n=character.charCodeAt(0);
  if(character==='\\')return '\\\\';
  if(' :=#!'.includes(character))return '\\'+character;
  if(n<32||n>126)return '\\u'+n.toString(16).padStart(4,'0');
  return character;
 }).join('');
}
export function signingProperties({keystore,storePassword,keyPassword,keyAlias}){
 for(const [name,value]of Object.entries({keystore,storePassword,keyPassword,keyAlias}))assert.ok(typeof value==='string'&&value.length>0,'Missing Android signing field: '+name);
 return Object.entries({storeFile:keystore,storePassword,keyAlias,keyPassword}).map(([key,value])=>key+'='+propertyValue(value)).join('\n')+'\n';
}
async function prompt(label,{secret=false}={}){
 assert.ok(process.stdin.isTTY,'Interactive signing needs a terminal. CI must use --from-env.');
 const output=secret?new Writable({write(_chunk,_encoding,callback){callback();}}):process.stdout;
 const input=createInterface({input:process.stdin,output,terminal:true});
 try{if(secret)process.stdout.write(label);return await input.question(secret?'':label);}
 finally{input.close();if(secret)process.stdout.write('\n');}
}
export async function configureSigning({root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),keystore,mode,env=process.env,ask=prompt}={}){
 assert.ok(['interactive','from-env'].includes(mode),'Choose --interactive or --from-env');assert.ok(typeof keystore==='string'&&path.isAbsolute(keystore),'Use an absolute private keystore path');
 const actualRoot=fs.realpathSync(root),keyPath=path.resolve(keystore);
 assert.ok(keyPath!==actualRoot&&!keyPath.startsWith(actualRoot+path.sep),'Keep the upload keystore outside the repository');
 let created=false,storePassword,keyPassword,keyAlias;
 try{
  if(mode==='from-env'){
   for(const name of ['BB_ANDROID_KEYSTORE_BASE64','BB_ANDROID_STORE_PASSWORD','BB_ANDROID_KEY_PASSWORD','BB_ANDROID_KEY_ALIAS'])assert.ok(typeof env[name]==='string'&&env[name].length>0,'Missing signing secret: '+name);
   const encoded=env.BB_ANDROID_KEYSTORE_BASE64.replace(/\s/g,'');assert.match(encoded,/^[A-Za-z0-9+/]+={0,2}$/,'Invalid upload keystore encoding');
   const bytes=Buffer.from(encoded,'base64');assert.ok(bytes.length>0&&bytes.length<1024*1024,'Invalid upload keystore size');
   assert.equal(bytes.toString('base64'),encoded,'Invalid upload keystore encoding');
   fs.mkdirSync(path.dirname(keyPath),{recursive:true,mode:0o700});fs.writeFileSync(keyPath,bytes,{flag:'wx',mode:0o600});created=true;
   storePassword=env.BB_ANDROID_STORE_PASSWORD;keyPassword=env.BB_ANDROID_KEY_PASSWORD;keyAlias=env.BB_ANDROID_KEY_ALIAS;
  }else{
   assert.ok(fs.statSync(keyPath).isFile(),'Upload keystore not found');
   storePassword=await ask('Keystore password (hidden): ',{secret:true});
   keyPassword=await ask('Key password (hidden; Enter uses keystore password): ',{secret:true})||storePassword;
   keyAlias=await ask('Key alias [basketboss-upload]: ')||'basketboss-upload';
  }
  const realKey=fs.realpathSync(keyPath);assert.ok(!realKey.startsWith(actualRoot+path.sep),'Keep the upload keystore outside the repository');
  const file=path.join(actualRoot,'android/keystore.properties');
  if(fs.existsSync(file))assert.ok(!fs.lstatSync(file).isSymbolicLink(),'Signing properties must not be a symlink');
  if(fs.existsSync(file))fs.chmodSync(file,0o600);
  const content=signingProperties({keystore:realKey,storePassword,keyPassword,keyAlias});
  fs.writeFileSync(file,content,{mode:0o600});fs.chmodSync(file,0o600);
  return {ok:true,configured:true,credentialsPrinted:false};
 }catch(error){if(created)fs.rmSync(keyPath,{force:true});throw error;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=process.argv.slice(2),at=args.indexOf('--keystore-file');assert.ok(at>=0&&args[at+1],'Pass --keystore-file with your private upload key');
  const modes=args.filter(value=>['--interactive','--from-env'].includes(value));assert.equal(modes.length,1,'Choose exactly one signing mode');
  const result=await configureSigning({keystore:args[at+1],mode:modes[0].slice(2)});console.log(JSON.stringify(result));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
