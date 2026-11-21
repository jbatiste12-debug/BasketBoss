import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {propertyValue,signingProperties,configureSigning} from '../scripts/android-signing.mjs';
const fixture=()=>{const parent=fs.mkdtempSync(path.join(os.tmpdir(),'bb-android-signing-')),root=path.join(parent,'repo');fs.mkdirSync(path.join(root,'android'),{recursive:true});return {parent,root,key:path.join(parent,'upload.jks')};};
test('Java properties preserve password whitespace, punctuation, backslashes and Unicode without extra entries',()=>{
 assert.equal(propertyValue(' a:b=c#d!\\é\n'),'\\ a\\:b\\=c\\#d\\!\\\\\\u00e9\\u000a');
 const text=signingProperties({keystore:'/private/test.jks',storePassword:'a\nkeyAlias=evil',keyPassword:'x:y',keyAlias:'basketboss-upload'});
 assert.equal(text.split('\n').filter(Boolean).length,4);assert.ok(text.includes('storePassword=a\\u000akeyAlias\\=evil'));
});
test('CI signing writes private files without printing credentials or replacing an existing upload key',async()=>{
 const h=fixture(),env={BB_ANDROID_KEYSTORE_BASE64:Buffer.from('synthetic-test-key').toString('base64'),BB_ANDROID_STORE_PASSWORD:'synthetic-password',BB_ANDROID_KEY_PASSWORD:'synthetic-key-password',BB_ANDROID_KEY_ALIAS:'basketboss-upload'};
 try{
  const result=await configureSigning({root:h.root,keystore:h.key,mode:'from-env',env});assert.equal(result.credentialsPrinted,false);assert.equal(fs.statSync(h.key).mode&0o777,0o600);
  const file=path.join(h.root,'android/keystore.properties');assert.equal(fs.statSync(file).mode&0o777,0o600);assert.ok(fs.readFileSync(file,'utf8').includes('keyAlias=basketboss-upload'));
  await assert.rejects(()=>configureSigning({root:h.root,keystore:h.key,mode:'from-env',env}),/EEXIST/);assert.equal(fs.readFileSync(h.key,'utf8'),'synthetic-test-key');
 }finally{fs.rmSync(h.parent,{recursive:true,force:true});}
});
test('missing CI secrets and invalid encoding cannot leave a key or signing properties behind',async()=>{
 for(const env of [{},{BB_ANDROID_KEYSTORE_BASE64:'!!!',BB_ANDROID_STORE_PASSWORD:'x',BB_ANDROID_KEY_PASSWORD:'x',BB_ANDROID_KEY_ALIAS:'x'}]){
  const h=fixture();try{await assert.rejects(()=>configureSigning({root:h.root,keystore:h.key,mode:'from-env',env}));assert.equal(fs.existsSync(h.key),false);assert.equal(fs.existsSync(path.join(h.root,'android/keystore.properties')),false);}finally{fs.rmSync(h.parent,{recursive:true,force:true});}
 }
});
test('interactive setup uses an existing external key, masked password prompts and default alias',async()=>{
 const h=fixture(),prompts=[],answers=['test-store-password','',''];fs.writeFileSync(h.key,'existing-private-key');
 try{await configureSigning({root:h.root,keystore:h.key,mode:'interactive',ask:async(label,options)=>{prompts.push(options);return answers.shift();}});assert.equal(prompts[0].secret,true);assert.equal(prompts[1].secret,true);assert.ok(fs.readFileSync(path.join(h.root,'android/keystore.properties'),'utf8').includes('keyAlias=basketboss-upload'));assert.equal(fs.readFileSync(h.key,'utf8'),'existing-private-key');}
 finally{fs.rmSync(h.parent,{recursive:true,force:true});}
});
test('an upload key inside the checkout is rejected before use',async()=>{
 const h=fixture();try{await assert.rejects(()=>configureSigning({root:h.root,keystore:path.join(h.root,'key.jks'),mode:'interactive'}),/outside the repository/);}finally{fs.rmSync(h.parent,{recursive:true,force:true});}
});
test('signing properties reject existing and dangling symlinks without writing credentials outside the checkout',async()=>{
 for(const targetExists of [false,true]){
  const h=fixture(),target=path.join(h.parent,'outside.properties');
  try{
   fs.writeFileSync(h.key,'existing-private-key');if(targetExists)fs.writeFileSync(target,'keep existing contents');
   fs.symlinkSync(target,path.join(h.root,'android/keystore.properties'));
   await assert.rejects(()=>configureSigning({root:h.root,keystore:h.key,mode:'interactive',ask:async()=> 'synthetic-answer'}),/must not be a symlink/);
   assert.equal(fs.existsSync(target),targetExists);if(targetExists)assert.equal(fs.readFileSync(target,'utf8'),'keep existing contents');
  }finally{fs.rmSync(h.parent,{recursive:true,force:true});}
 }
});
