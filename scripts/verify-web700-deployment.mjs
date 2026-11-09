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
const rootAssets=['bb-ui-continuity.js','bb-pantry-selection.js','bb-pantry-selection.css','basketboss-social-preview-20261109.png','bb-membership-settings.js','bb-us-market.js','bb-plan-extras.js','bb-plan-extras.css'];
const CODES=new Set(['LOCAL_CONTRACT','LOCAL_FILES','NETWORK','PUBLIC_ASSET','PUBLIC_BODY','PUBLIC_SIZE','MANIFEST_STALE','LANDING_PRICE','ASSET_BYTES','ROUTE','PUBLIC_COUNT','LEGACY_PUBLIC','ROOT_ASSET','LOCAL_IMAGE','IMAGE_REWRITE','PAID_BOUNDARY','ATTEMPTS','UNAVAILABLE'].map(code=>'WEB700_'+code));
export function approvedEmailHintVariant(approved,expectedBytes,expectedSha256){
 check(Buffer.isBuffer(approved)&&approved.length===expectedBytes&&hash(approved)===expectedSha256,'LOCAL_FILES');
 const open=Buffer.from('<!--email_off-->'),close=Buffer.from('<!--/email_off-->'),start=approved.indexOf(open),end=approved.indexOf(close),text=approved.toString('utf8');
 check(start>=0&&end>start&&approved.lastIndexOf(open)===start&&approved.lastIndexOf(close)===end,'LOCAL_FILES');
 check([...text.matchAll(/<body\b[^>]*>/gi)].length===1&&[...text.matchAll(/<\/body\s*>/gi)].length===1&&/<body\b[^>]*><!--email_off-->/i.test(text)&&/<!--\/email_off--><\/body\s*>/i.test(text),'LOCAL_FILES');
 // The edge consumes these two nonexecuting provider directives. Construct
 // that exact approved representation; never strip or normalize a response.
 return Buffer.concat([approved.subarray(0,start),approved.subarray(start+open.length,end),approved.subarray(end+close.length)]);
}
function requireAssetBytes(relative,expectedBytes,expectedSha256,actual,code,approvedHtml){
 const directiveVariant=approvedHtml?approvedEmailHintVariant(approvedHtml,expectedBytes,expectedSha256):null;
 if(actual.length===expectedBytes&&hash(actual)===expectedSha256)return 'literal';
 if(directiveVariant&&actual.length===directiveVariant.length&&hash(actual)===hash(directiveVariant))return 'directive';
 const text=actual.toString('utf8'),error=Error('WEB700_'+code);
 error.details=Object.freeze({publicPath:relative,expectedBytes,receivedBytes:actual.length,expectedSha256,receivedSha256:hash(actual),cloudflareEmailProtection:/data-cfemail\s*=|\/cdn-cgi\/l\/email-protection|\/cdn-cgi\/scripts\/[^\s"'<>]*email-decode\.min\.js/i.test(text),cloudflareInsights:/static\.cloudflareinsights\.com\/(?:beacon(?:\.min)?\.js|)/i.test(text),rocketLoader:/\/cdn-cgi\/scripts\/[^\s"'<>]*rocket-loader\.min\.js|data-cf-settings\s*=/i.test(text)});
 throw error;
}

// Only known public file metadata and fixed booleans may leave the runner.
// Never forward an unexpected error body, provider message or arbitrary details.
export function web700DeploymentFailure(error,{root=ROOT}={}){
 const result={ok:false,error:CODES.has(error?.message)?error.message:'WEB700_UNAVAILABLE'};
 if(!['WEB700_ASSET_BYTES','WEB700_ROUTE','WEB700_LEGACY_PUBLIC','WEB700_ROOT_ASSET'].includes(result.error))return result;
 try{
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'pwa700/manifest.json'))),allowed=new Set(['/app','/recipes.json',...rootAssets.map(name=>'/'+name)]);
  for(const row of inventory.files||[])if(/^[a-zA-Z0-9_-]+\.(?:html|js|mjs|css|json)$/.test(row.path)&&!/(?:private|sealed|server)/i.test(row.path))allowed.add('/pwa700/'+row.path.replace(/\.html$/,''));
  const d=error.details,booleans=['cloudflareEmailProtection','cloudflareInsights','rocketLoader'];
  if(!d||!allowed.has(d.publicPath)||![d.expectedBytes,d.receivedBytes].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=8*1024*1024+1024)||![d.expectedSha256,d.receivedSha256].every(value=>/^[a-f0-9]{64}$/.test(value))||!booleans.every(name=>typeof d[name]==='boolean'))return result;
  result.details={publicPath:d.publicPath,expectedBytes:d.expectedBytes,receivedBytes:d.receivedBytes,expectedSha256:d.expectedSha256,receivedSha256:d.receivedSha256,...Object.fromEntries(booleans.map(name=>[name,d[name]]))};
 }catch{}
 return result;
}

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
 // A fresh anonymous landing read checks the advertised price without requiring
 // unrelated edge-managed HTML (such as email protection) to be byte-identical.
 const landingSource=fs.readFileSync(path.join(root,'welcome.html'));
 const advertised=landingSource.toString('utf8').match(/Standard web Premium: £\d{1,4}\.\d{2}\/month/g)||[];
 check(advertised.length===1,'LOCAL_FILES');
 const landing=await bytes('/','welcome.html',landingSource.length+8192);
 const deployedPrice=landing.toString('utf8').match(/Standard web Premium: £\d{1,4}\.\d{2}\/month/g)||[];
 check(deployedPrice.length===1&&deployedPrice[0]===advertised[0],'LANDING_PRICE');
 const advertisedMonthlyPrice=advertised[0].slice('Standard web Premium: '.length);
 // Bounded parallel reads prove the generated public pack reached Pages.
 let cursor=0,literalAssetBytesMatched=0,directiveVariantsVerified=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<inventory.files.length){const row=inventory.files[cursor++],relative='/pwa700/'+row.path.replace(/\.html$/,''),approved=row.path.endsWith('.html')?fs.readFileSync(path.join(directory,row.path)):undefined;const deployed=await bytes(relative,row.path,row.bytes+1024);const variant=requireAssetBytes(relative,row.bytes,row.sha256,deployed,'ASSET_BYTES',approved);if(variant==='literal')literalAssetBytesMatched++;else directiveVariantsVerified++;}}));
 const app=fs.readFileSync(path.join(directory,'app.html')),appRecords=inventory.files.filter(row=>row.path==='app.html');check(appRecords.length===1,'LOCAL_FILES');
 const appResponse=await bytes('/app','app.html',app.length+1024),appVariant=requireAssetBytes('/app',appRecords[0].bytes,appRecords[0].sha256,appResponse,'ROUTE',app);
 const free=JSON.parse(fs.readFileSync(path.join(directory,'recipes.json')));check(Array.isArray(free)&&free.length===200,'PUBLIC_COUNT');
 const legacy=fs.readFileSync(path.join(root,'recipes.json')),legacyResponse=await bytes('/recipes.json','recipes.json',legacy.length+1024);
 requireAssetBytes('/recipes.json',legacy.length,hash(legacy),legacyResponse,'LEGACY_PUBLIC');check(JSON.parse(legacyResponse).length===100,'LEGACY_PUBLIC');
 for(const name of rootAssets){const expected=fs.readFileSync(path.join(root,name)),deployed=await bytes('/'+name,name,expected.length+1024);requireAssetBytes('/'+name,expected.length,hash(expected),deployed,'ROOT_ASSET');}
 const photo=release.recipes?.[0]?.image;check(typeof photo==='string'&&/^release-assets\/basketboss-v17\/images\/new\/[a-z0-9-]+\.webp$/.test(photo),'LOCAL_IMAGE');
 const image=await response('/'+photo,'HEAD');check(image.status===200&&/^image\/webp(?:;|$)/i.test(image.headers.get('content-type')||''),'IMAGE_REWRITE');await image.body?.cancel().catch(()=>{});
 for(const endpoint of ['/api/recipes/premium?catalogue=500','/api/recipes/v700/premium?catalogue=700']){const denied=await response(endpoint);await denied.body?.cancel().catch(()=>{});check([401,403].includes(denied.status),'PAID_BOUNDARY');}
 return {ok:true,catalogueVersion:700,publicRecipes:200,generatedFiles:inventory.files.length,generatedApplicationBytesVerified:true,literalAssetBytesMatched,directiveVariantsVerified,routedAppVerified:true,routedAppDirectiveVariant:appVariant==='directive',landingMonthlyPriceVerified:true,advertisedMonthlyPrice,rootAssets:rootAssets.length,newImageRewrite:true,legacyPublicRecipes:100,legacyPublicUnchanged:true,unauthenticatedPremiumDenied:true};
}

export async function waitForWeb700Deployment({attempts=12,pause=()=>new Promise(resolve=>setTimeout(resolve,10000)),...options}={}){
 check(Number.isInteger(attempts)&&attempts>0&&attempts<=12,'ATTEMPTS');let failure;
 for(let attempt=0;attempt<attempts;attempt++){
  try{return await verifyWeb700Deployment(options);}catch(error){failure=CODES.has(error?.message)?error:Error('WEB700_UNAVAILABLE');}
  if(attempt+1<attempts)await pause();
 }
 throw failure;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(await waitForWeb700Deployment({attempts:process.argv.includes('--once')?1:12})));}
 catch(error){console.error(JSON.stringify(web700DeploymentFailure(error)));process.exitCode=1;}
}
