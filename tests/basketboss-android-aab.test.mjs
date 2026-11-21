import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {deflateRawSync} from 'node:zlib';
import {aabEntries,inspectAabManifests,verifyAabAssets,verifyAndroidAab} from '../scripts/verify-android-aab.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const A='http://schemas.android.com/apk/res/android',D='http://schemas.android.com/apk/distribution';
const baseXml=`<manifest xmlns:android="${A}" package="uk.co.basketboss.app" android:versionCode="3" android:versionName="1.0.3"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><uses-permission android:name="com.android.vending.BILLING"/></manifest>`;
const packXml=`<manifest xmlns:dist="${D}" package="uk.co.basketboss.app" split="recipe_images"><dist:module dist:type="asset-pack"><dist:delivery><dist:install-time/></dist:delivery><dist:fusing dist:include="true"/></dist:module></manifest>`;
const payload=[['index.html','<html>Android fixture</html>'],['photos/old.jpg','original legacy image bytes'],['release-assets/meal.webp','approved canonical image bytes'],['food-thumbs/tile.webp','pantry thumbnail bytes']].map(([name,body])=>({name,body:Buffer.from(body)}));
const row=({name,body})=>({path:name,bytes:body.length,sha256:sha(body)});
const zipName=name=>(name==='index.html'?'base':'recipe_images')+'/assets/public/'+name;
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
// Small real ZIP fixtures (stored and DEFLATE), with no extra dependency.
function zip(entries){
 const bodies=[],directory=[];let offset=0;
 for(const [name,input,method=0] of entries){
  const raw=Buffer.from(input),filename=Buffer.from(name),body=method===8?deflateRawSync(raw):raw,crc=crc32(raw);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(method,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(body.length,18);header.writeUInt32LE(raw.length,22);header.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
  bodies.push(header,filename,body);directory.push(central,filename);offset+=header.length+filename.length+body.length;
 }
 const table=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(table.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...bodies,table,end]);
}
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bb-aab-test-')),bundle=path.join(directory,'fixture.aab');
 const zipEntries=[['base/manifest/AndroidManifest.xml','synthetic binary manifest'],['recipe_images/manifest/AndroidManifest.xml','synthetic binary pack manifest'],...payload.map((r,index)=>[zipName(r.name),r.body,index%2?8:0])];
 fs.writeFileSync(bundle,zip(zipEntries));return {directory,bundle,zipEntries,files:payload.map(row),write:value=>fs.writeFileSync(bundle,zip(value)),close:()=>fs.rmSync(directory,{recursive:true,force:true})};
}

test('actual ZIP assets preserve unchanged paths and bytes across base and install-time pack',async()=>{
 const h=fixture();try{const result=await verifyAabAssets(h);assert.equal(result.webAssets,4);assert.equal(result.baseWebBytes,payload[0].body.length);assert.equal(result.imagePackBytes,payload.slice(1).reduce((sum,r)=>sum+r.body.length,0));}finally{h.close();}
});
test('actual ZIP verification rejects missing, added, changed, relocated and duplicate assets',async()=>{
 const mutations=[
  entries=>entries.filter((_,i)=>i!==3),
  entries=>[...entries,['recipe_images/assets/public/photos/unexpected.jpg','extra']],
  entries=>entries.map((r,i)=>i===3?[r[0],Buffer.alloc(Buffer.from(r[1]).length,120)]:r),
  entries=>entries.map((r,i)=>i===3?[r[0],'short']:r),
  entries=>entries.map((r,i)=>i===3?[r[0].replace('recipe_images/','base/'),r[1]]:r),
  entries=>[...entries,['base/assets/public/photos/old.jpg',payload[1].body]],
  entries=>[...entries,entries[3]],
  entries=>[...entries,['unexpected/manifest/AndroidManifest.xml','extra module']],
  entries=>[...entries,['../unsafe','bad path']]
 ];
 for(const mutate of mutations){const h=fixture();try{h.write(mutate(h.zipEntries));await assert.rejects(()=>verifyAabAssets(h),/missing|Unexpected|changed|wrong module|Duplicate|Unsafe/);}finally{h.close();}}
});
test('the verified reference inventory cannot contain duplicated or unsafe paths',async()=>{
 const h=fixture();try{
  await assert.rejects(()=>verifyAabAssets({...h,files:[...h.files,h.files[0]]}),/Duplicate verified/);
  await assert.rejects(()=>verifyAabAssets({...h,files:[{...h.files[0],path:'../escape'}]}),/Invalid verified/);
  assert.equal(aabEntries(h.bundle).length,6);
 }finally{h.close();}
});
test('actual manifest inspection checks package, version, SDK, install-time delivery and fusing',()=>{
 const result=inspectAabManifests({baseXml,packXml});assert.equal(result.package,'uk.co.basketboss.app');assert.equal(result.targetSdk,36);assert.equal(result.delivery,'install-time');assert.equal(result.fusing,true);assert.equal(result.signatureChecked,false);
 for(const patch of [
  {baseXml:baseXml.replace('uk.co.basketboss.app','another.app')},
  {baseXml:baseXml.replace('versionCode="3"','versionCode="1"')},
  {baseXml:baseXml.replace('versionName="1.0.3"','versionName="1.0.1"')},
  {baseXml:baseXml.replace('minSdkVersion="24"','minSdkVersion="23"')},
  {baseXml:baseXml.replace('targetSdkVersion="36"','targetSdkVersion="35"')},
  {baseXml:baseXml.replace('com.android.vending.BILLING','another.permission')},
  {packXml:packXml.replace('install-time','fast-follow')},
  {packXml:packXml.replace('include="true"','include="false"')},
  {packXml:packXml.replace(D,'https://untrusted.example/distribution')},
  {packXml:packXml.replace('split="recipe_images"','split="another_pack"')},
  {packXml:packXml.replace('<dist:install-time/>','<dist:install-time/><dist:on-demand/>')}
 ])assert.throws(()=>inspectAabManifests({baseXml,packXml,...patch}),/verification/);
});
test('required signing rejects an unsigned ZIP, while an unsigned CI check is explicit',()=>{
 const h=fixture();try{
  assert.equal(inspectAabManifests({baseXml,packXml,bundle:h.bundle}).signatureChecked,false);
  assert.throws(()=>inspectAabManifests({baseXml,packXml,bundle:h.bundle,requireSigned:true}),/unsigned payload/);
 }finally{h.close();}
});
test('a valid self-signed upload certificate passes, while added unsigned and tampered payloads fail',()=>{
 const h=fixture();try{
  const keystore=path.join(h.directory,'synthetic-fixture.jks'),signed=path.join(h.directory,'signed.aab'),source=path.join(h.directory,'SignFixture.java');
  const password='synthetic-test-only-password';
  execFileSync('keytool',['-genkeypair','-noprompt','-keystore',keystore,'-storetype','JKS','-storepass',password,'-keypass',password,'-alias','fixture','-keyalg','RSA','-keysize','2048','-validity','365','-dname','CN=Synthetic Test Only'],{stdio:'pipe'});
  fs.writeFileSync(source,`import java.io.*;import java.util.zip.*;import java.security.*;import jdk.security.jarsigner.JarSigner;class SignFixture{public static void main(String[] a)throws Exception{var k=KeyStore.getInstance("JKS");try(var in=new FileInputStream(a[0])){k.load(in,a[3].toCharArray());}var e=(KeyStore.PrivateKeyEntry)k.getEntry("fixture",new KeyStore.PasswordProtection(a[3].toCharArray()));try(var zip=new ZipFile(a[1]);var out=new FileOutputStream(a[2])){new JarSigner.Builder(e).build().sign(zip,out);}}}`);
  execFileSync('java',[source,keystore,h.bundle,signed,password],{stdio:'pipe'});fs.renameSync(signed,h.bundle);
  const inspect=()=>inspectAabManifests({baseXml,packXml,bundle:h.bundle,requireSigned:true});
  const valid=inspect();assert.equal(valid.signatureChecked,true);assert.equal(valid.signedPayloadEntries,h.zipEntries.length);
  const signedEntries=aabEntries(h.bundle).map(name=>[name,execFileSync('unzip',['-p',h.bundle,name])]);
  h.write([...signedEntries,['META-INF/services/synthetic.service','unsigned payload is not signature metadata']]);
  assert.throws(inspect,/unsigned payload/);
  h.write(signedEntries.map(([name,body])=>[name,name===zipName('index.html')?Buffer.from('tampered signed payload'):body]));
  assert.throws(inspect,/digest|signature/i);
 }finally{h.close();}
});
test('a supplied bundletool binary must match the pinned official release before execution',async()=>{
 const h=fixture();try{const jar=path.join(h.directory,'untrusted.jar');fs.writeFileSync(jar,'not the pinned official tool');await assert.rejects(()=>verifyAndroidAab({bundle:h.bundle,bundletool:jar}),/Untrusted bundletool/);}finally{h.close();}
});
