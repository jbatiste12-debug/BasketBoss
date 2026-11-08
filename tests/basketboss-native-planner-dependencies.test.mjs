import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyNativeWeb} from '../scripts/build-native-web.mjs';

const source=new URL('../dist/native/',import.meta.url);
test('the actual native planner includes its breakfast, backup and presentation dependencies',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('native-web-manifest.json',source),'utf8'));
 for(const name of ['bb-plan-extras.js','bb-plan-extras-sync.js','bb-plan-extras.css']){
  assert.ok(manifest.files.some(row=>row.path===name),name+' must ship inside the app');
  assert.ok(fs.statSync(new URL(name,source)).size>0);
  assert.match(fs.readFileSync(new URL('app.html',source),'utf8'),new RegExp(name.replaceAll('.','\\.')+'\\?[^"<>]*bb_native_asset='));
 }
 assert.equal(verifyNativeWeb({directory:source.pathname}).privateRecipeBundle,false);
});

test('a hash-valid native manifest cannot hide a missing page dependency',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bb-native-planner-dependencies-'));
 try{
  fs.cpSync(source,directory,{recursive:true});
  const manifestPath=path.join(directory,'native-web-manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  for(const name of ['app.html','index.html']){
   const file=path.join(directory,name),html=fs.readFileSync(file,'utf8').replace('</head>','<script src="missing-planner-dependency.js"></script></head>');
   fs.writeFileSync(file,html);const row=manifest.files.find(row=>row.path===name);
   row.bytes=Buffer.byteLength(html);row.sha256=createHash('sha256').update(html).digest('hex');
  }
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  assert.throws(()=>verifyNativeWeb({directory}),/Native HTML dependency is missing: .*missing-planner-dependency\.js/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
