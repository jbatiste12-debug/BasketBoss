#!/usr/bin/env node
// Verify the actual Gradle output, including install-time image assets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {ANDROID_ROOT,verifyAndroidWeb} from './build-android-web.mjs';

export const BUNDLETOOL_VERSION='1.18.3';
export const BUNDLETOOL_SHA256='a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const imagePath=name=>/^(photos|release-assets|food-thumbs)\//.test(name);
const validPath=name=>typeof name==='string'&&name.length>0&&!/[\\\r\n\0*?\[\]]/.test(name)&&!name.startsWith('/')&&!name.split('/').some(p=>p==='.'||p==='..'||p==='');
function command(program,args,label){
 try{return execFileSync(program,args,{encoding:'utf8',maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});}
 catch(error){throw Error(label+' failed'+(error.stderr?': '+String(error.stderr).trim().split('\n').at(-1).slice(0,350):''));}
}

// Use the JDK's namespace-aware XML parser and cryptographic JAR verifier.
// A valid self-signed upload certificate does not need public-CA trust.
const JAVA_CHECK=String.raw`
import java.io.*;
import java.util.*;
import java.util.jar.*;
import java.security.CodeSigner;
import java.security.cert.X509Certificate;
import javax.xml.XMLConstants;
import javax.xml.parsers.*;
import org.w3c.dom.*;
class BBAabCheck {
 static final String A="http://schemas.android.com/apk/res/android", D="http://schemas.android.com/apk/distribution";
 static void check(boolean yes,String label){if(!yes)throw new IllegalStateException(label);}
 static Element xml(String file)throws Exception{
  var f=DocumentBuilderFactory.newInstance();f.setNamespaceAware(true);
  f.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
  f.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,"");f.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
  return f.newDocumentBuilder().parse(new File(file)).getDocumentElement();
 }
 static Element child(Element parent,String ns,String name){
  Element found=null;for(Node n=parent.getFirstChild();n!=null;n=n.getNextSibling())if(n instanceof Element){
   var e=(Element)n;if(Objects.equals(ns,e.getNamespaceURI())&&name.equals(e.getLocalName())){check(found==null,"duplicate "+name);found=e;}
  }check(found!=null,"missing "+name);return found;
 }
 static int integer(String value){return Integer.decode(value);}
 static boolean signatureMetadata(String name){return name.toUpperCase(Locale.ROOT).matches("META-INF/(MANIFEST\\.MF|[^/]+\\.(SF|RSA|DSA|EC)|SIG-[^/]+)");}
 static int signature(String file)throws Exception{
  int checked=0;byte[] buffer=new byte[65536];try(var jar=new JarFile(file,true)){
   var entries=jar.entries();while(entries.hasMoreElements()){
    var entry=entries.nextElement();if(entry.isDirectory())continue;
    try(var input=jar.getInputStream(entry)){while(input.read(buffer)!=-1){}}
    if(signatureMetadata(entry.getName()))continue;
    CodeSigner[] signers=entry.getCodeSigners();check(signers!=null&&signers.length>0,"unsigned payload entry");
    for(var signer:signers)((X509Certificate)signer.getSignerCertPath().getCertificates().get(0)).checkValidity();
    checked++;
   }
  }check(checked>0,"no signed payload entries");return checked;
 }
 public static void main(String[] args){try{
  Element base=xml(args[0]),pack=xml(args[1]);
  check("manifest".equals(base.getTagName()),"base manifest");
  check("uk.co.basketboss.app".equals(base.getAttribute("package")),"package");
  check(integer(base.getAttributeNS(A,"versionCode"))==11,"versionCode");
  check("1.0.11".equals(base.getAttributeNS(A,"versionName")),"versionName");
  Element sdk=child(base,null,"uses-sdk");
  check(integer(sdk.getAttributeNS(A,"minSdkVersion"))==24,"minSdkVersion");
  check(integer(sdk.getAttributeNS(A,"targetSdkVersion"))==36,"targetSdkVersion");
  boolean billing=false;for(Node n=base.getFirstChild();n!=null;n=n.getNextSibling())if(n instanceof Element){var e=(Element)n;if("uses-permission".equals(e.getTagName())&&"com.android.vending.BILLING".equals(e.getAttributeNS(A,"name")))billing=true;}
  check(billing,"Google Play Billing permission");
  check("manifest".equals(pack.getTagName())&&"uk.co.basketboss.app".equals(pack.getAttribute("package")),"asset pack package");
  check("recipe_images".equals(pack.getAttribute("split")),"asset pack name");
  Element module=child(pack,D,"module");check("asset-pack".equals(module.getAttributeNS(D,"type")),"asset pack type");
  Element delivery=child(module,D,"delivery");child(delivery,D,"install-time");
  int modes=0;for(Node n=delivery.getFirstChild();n!=null;n=n.getNextSibling())if(n instanceof Element)modes++;
  check(modes==1,"asset pack delivery must only be install-time");
  check("true".equals(child(module,D,"fusing").getAttributeNS(D,"include")),"asset pack fusing");
  int signed=args[2].equals("-")?0:signature(args[2]);
  System.out.println("{\"package\":\"uk.co.basketboss.app\",\"versionName\":\"1.0.11\",\"versionCode\":11,\"minSdk\":24,\"targetSdk\":36,\"assetPack\":\"recipe_images\",\"delivery\":\"install-time\",\"fusing\":true,\"signatureChecked\":"+(!args[2].equals("-"))+",\"signedPayloadEntries\":"+signed+"}");
 }catch(Exception e){System.err.println("Android AAB verification: "+e.getMessage());System.exit(1);}}
}
`;

export function inspectAabManifests({baseXml,packXml,bundle=null,requireSigned=false}){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bb-aab-metadata-'));
 try{
  const source=path.join(temporary,'BBAabCheck.java'),base=path.join(temporary,'base.xml'),pack=path.join(temporary,'pack.xml');
  fs.writeFileSync(source,JAVA_CHECK);fs.writeFileSync(base,baseXml);fs.writeFileSync(pack,packXml);
  assert.ok(!requireSigned||bundle,'Signed verification requires a bundle');
  return JSON.parse(command('java',[source,base,pack,requireSigned?path.resolve(bundle):'-'],'AAB manifest/signature verification'));
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

export function aabEntries(bundle){
 const entries=command('unzip',['-Z1',path.resolve(bundle)],'AAB ZIP listing').trimEnd().split('\n');
 const seen=new Set();for(const name of entries){
  assert.ok(validPath(name.endsWith('/')?name.slice(0,-1):name),'Unsafe AAB entry');
  assert.ok(!seen.has(name),'Duplicate AAB ZIP entry: '+name);seen.add(name);
 }
 return entries.filter(name=>!name.endsWith('/'));
}
async function entryHash(bundle,entry,expectedBytes){
 const child=spawn('unzip',['-p',path.resolve(bundle),entry],{stdio:['ignore','pipe','pipe']});
 const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Unable to read AAB asset')));});
 void finished.catch(()=>{});child.stderr.resume();const hash=createHash('sha256');let bytes=0;
 try{for await(const chunk of child.stdout){bytes+=chunk.length;assert.ok(bytes<=expectedBytes,'AAB asset size changed: '+entry);hash.update(chunk);}await finished;}
 catch(error){child.kill();await finished.catch(()=>{});throw error;}
 assert.equal(bytes,expectedBytes,'AAB asset size changed: '+entry);return hash.digest('hex');
}

export async function verifyAabAssets({bundle,files,entries=aabEntries(bundle)}){
 const modules=entries.filter(name=>/^[^/]+\/manifest\/AndroidManifest\.xml$/.test(name)).map(name=>name.split('/')[0]).sort();
 assert.deepEqual(modules,['base','recipe_images'],'Unexpected AAB modules');
 const expected=new Map();for(const row of files){assert.ok(validPath(row.path)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&/^[a-f0-9]{64}$/.test(row.sha256),'Invalid verified asset inventory');assert.ok(!expected.has(row.path),'Duplicate verified asset');expected.set(row.path,row);}
 const assets=[],seen=new Set();let baseBytes=0,imagePackBytes=0;
 for(const entry of entries){
  const match=entry.match(/^([^/]+)\/assets\/public\/(.+)$/);if(!match)continue;
  const [,module,name]=match;assert.ok(!seen.has(name),'Duplicate base/pack AAB asset: '+name);seen.add(name);
  const row=expected.get(name);assert.ok(row,'Unexpected AAB web asset: '+name);
  assert.equal(module,imagePath(name)?'recipe_images':'base','AAB asset in wrong module: '+name);
  assets.push({entry,row});expected.delete(name);if(module==='base')baseBytes+=row.bytes;else imagePackBytes+=row.bytes;
 }
 assert.equal(expected.size,0,'AAB web assets are missing');
 let next=0;await Promise.all(Array.from({length:Math.min(4,assets.length)},async()=>{while(next<assets.length){const {entry,row}=assets[next++];assert.equal(await entryHash(bundle,entry,row.bytes),row.sha256,'AAB asset bytes changed: '+row.path);}}));
 return {webAssets:assets.length,baseWebBytes:baseBytes,imagePackBytes};
}

export async function verifyAndroidAab({root=ANDROID_ROOT,bundle=path.join(root,'android/app/build/outputs/bundle/release/app-release.aab'),bundletool=null,requireSigned=false}={}){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bb-bundletool-'));
 try{
  const jar=bundletool?path.resolve(bundletool):path.join(temporary,'bundletool.jar');
  if(!bundletool)command('curl',['--fail','--location','--silent','--show-error','--retry','3','--max-time','120','https://github.com/google/bundletool/releases/download/'+BUNDLETOOL_VERSION+'/bundletool-all-'+BUNDLETOOL_VERSION+'.jar','-o',jar],'Official bundletool download');
  assert.equal(sha(fs.readFileSync(jar)),BUNDLETOOL_SHA256,'Untrusted bundletool JAR');
  verifyAndroidWeb({root,directory:path.join(root,'dist/android')});
  const tool=args=>command('java',['-jar',jar,...args,'--bundle='+path.resolve(bundle)],'Bundletool '+args[0]);
  tool(['validate']);
  const metadata=inspectAabManifests({baseXml:tool(['dump','manifest','--module=base']),packXml:tool(['dump','manifest','--module=recipe_images']),bundle,requireSigned});
  const reference=path.join(root,'dist/android'),files=JSON.parse(fs.readFileSync(path.join(reference,'native-web-manifest.json'))).files.slice();
  const inventory=fs.readFileSync(path.join(reference,'native-web-manifest.json'));files.push({path:'native-web-manifest.json',bytes:inventory.length,sha256:sha(inventory)});
  for(const name of ['cordova.js','cordova_plugins.js']){
   const file=path.join(root,'android/app/src/main/assets/public',name);if(fs.existsSync(file)&&!files.some(row=>row.path===name)){const bytes=fs.readFileSync(file);files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}
  }
  return {ok:true,...metadata,...await verifyAabAssets({bundle,files}),bundleBytes:fs.statSync(bundle).size,bundletool:BUNDLETOOL_VERSION};
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{
  const options={},args=process.argv.slice(2),seen=new Set();
  while(args.length){const flag=args.shift();assert.ok(!seen.has(flag),'Duplicate option');seen.add(flag);
   if(flag==='--require-signed')options.requireSigned=true;
   else{assert.ok(['--bundle','--bundletool'].includes(flag)&&args[0]&&!args[0].startsWith('--'),'Use --bundle, optional --bundletool and --require-signed');options[flag.slice(2)]=args.shift();}
  }
  console.log(JSON.stringify(await verifyAndroidAab(options)));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
