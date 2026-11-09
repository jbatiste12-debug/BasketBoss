// Read-only public deployment proof. No account token, AI call or database access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST='https://basketboss.co.uk';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const check=(condition,code)=>{if(!condition)throw Error('WEB700_'+code);};
const publicTypes=name=>name.endsWith('.html')?/text\/html/i:name.endsWith('.css')?/text\/css/i:name.endsWith('.json')?/application\/json/i:name.endsWith('.png')?/image\/png/i:/javascript/i;
const rootAssets=['bb-ui-continuity.js','bb-pantry-selection.js','bb-pantry-selection.css','basketboss-social-preview-20261109.png'];

export async function verifyWeb700Deployment({perform=fetch,root=ROOT}={}){
 const directory=path.join(root,'pwa700'),inventoryBytes=fs.readFileSync(path.join(directory,'manifest.json'));
 const inventory=JSON.parse(inventoryBytes),release=JSON.parse(fs.readFileSync(path.join(root,'catalogues/700/release/manifest.json')));
 check(inventory.catalogueVersion===700&&inventory.freeRecipes===200&&inventory.premiumRecipes===500&&inventory.privateRecipeBundle===false,'LOCAL_CONTRACT');
 check(Array.isArray(inventory.files)&&inventory.files.length>20&&inventory.files.length<=64,'LOCAL_FILES');
 check(inventory.files.every(row=>/^[a-zA-Z0-9_-]+\.(?:html|js|mjs|css|json)$/.test(row.path)&&!/(?:private|sealed|server)/i.test(row.path)&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<8*1024*1024&&/^[a-f0-9]{64}$/.test(row.sha256)),'LOCAL_FILES');
 async function response(relative,method='GET'){
  try{return await perform(HOST+relative,{method,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{throw Error('WEB700_NETWORK');}
 }
 async function bytes(relative,name,maximum){
  const result=await response(relative);
  if(result.status!==200||!publicTypes(name).test(result.headers.get('content-type')||'')){await result.body?.cancel().catch(()=>{});throw Error('WEB700_PUBLIC_ASSET');}
  const reader=result.body?.getReader();check(reader,'PUBLIC_BODY');let size=0;const parts=[];
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;check(size<=maximum,'PUBLIC_SIZE');parts.push(Buffer.from(next.value));}}
  catch(error){if(/^WEB700_/.test(error?.message||''))throw error;throw Error('WEB700_PUBLIC_BODY');}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(parts);
 }
 const deployedInventory=await bytes('/pwa700/manifest.json','manifest.json',inventoryBytes.length+1024);
 check(hash(deployedInventory)===hash(inventoryBytes),'MANIFEST_STALE');
 // Bounded parallel reads prove the generated public pack reached Pages.
 let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<inventory.files.length){const row=inventory.files[cursor++],relative='/pwa700/'+row.path.replace(/\.html$/,'');const deployed=await bytes(relative,row.path,row.bytes+1024);check(deployed.length===row.bytes&&hash(deployed)===row.sha256,'ASSET_BYTES');}}));
 const app=fs.readFileSync(path.join(directory,'app.html')),appResponse=await bytes('/app','app.html',app.length+1024);
 check(hash(appResponse)===hash(app),'ROUTE');
 const free=JSON.parse(fs.readFileSync(path.join(directory,'recipes.json')));check(Array.isArray(free)&&free.length===200,'PUBLIC_COUNT');
 const legacy=fs.readFileSync(path.join(root,'recipes.json')),legacyResponse=await bytes('/recipes.json','recipes.json',legacy.length+1024);
 check(hash(legacyResponse)===hash(legacy)&&JSON.parse(legacyResponse).length===100,'LEGACY_PUBLIC');
 for(const name of rootAssets){const expected=fs.readFileSync(path.join(root,name)),deployed=await bytes('/'+name,name,expected.length+1024);check(hash(deployed)===hash(expected),'ROOT_ASSET');}
 const photo=release.recipes?.[0]?.image;check(typeof photo==='string'&&/^release-assets\/basketboss-v17\/images\/new\/[a-z0-9-]+\.webp$/.test(photo),'LOCAL_IMAGE');
 const image=await response('/'+photo,'HEAD');check(image.status===200&&/^image\/webp(?:;|$)/i.test(image.headers.get('content-type')||''),'IMAGE_REWRITE');await image.body?.cancel().catch(()=>{});
 for(const endpoint of ['/api/recipes/premium?catalogue=500','/api/recipes/v700/premium?catalogue=700']){const denied=await response(endpoint);await denied.body?.cancel().catch(()=>{});check([401,403].includes(denied.status),'PAID_BOUNDARY');}
 return {ok:true,catalogueVersion:700,publicRecipes:200,generatedFiles:inventory.files.length,generatedBytesVerified:true,routedAppVerified:true,rootAssets:rootAssets.length,newImageRewrite:true,legacyPublicRecipes:100,legacyPublicUnchanged:true,unauthenticatedPremiumDenied:true};
}

export async function waitForWeb700Deployment({attempts=12,pause=()=>new Promise(resolve=>setTimeout(resolve,10000)),...options}={}){
 check(Number.isInteger(attempts)&&attempts>0&&attempts<=12,'ATTEMPTS');let failure;
 for(let attempt=0;attempt<attempts;attempt++){
  try{return await verifyWeb700Deployment(options);}catch(error){failure=/^WEB700_[A-Z_]+$/.test(error?.message||'')?error:Error('WEB700_UNAVAILABLE');}
  if(attempt+1<attempts)await pause();
 }
 throw failure;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(await waitForWeb700Deployment()));}
 catch(error){console.error(/^WEB700_[A-Z_]+$/.test(error?.message||'')?error.message:'WEB700_UNAVAILABLE');process.exitCode=1;}
}
