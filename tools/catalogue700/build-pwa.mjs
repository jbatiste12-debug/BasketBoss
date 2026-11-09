#!/usr/bin/env node
// Generated web-only catalogue. Legacy public files and native builds stay
// byte-for-byte separate; private recipes still require the versioned API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {CLIENT_FILES} from '../../scripts/build-native-web.mjs';
import {inlineArray,transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from './build-client.mjs';
import {transform700Presentation} from './presentation.mjs';
import {transform700PantrySelection} from './pantry-selection.mjs';
import {pwa700Contract,transform700MakeAMeal} from './make-a-meal.mjs';
export {pwa700Contract,transform700MakeAMeal} from './make-a-meal.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const assert=(value,label)=>{if(!value)throw Error('catalogue700_pwa_'+label);};
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const literal=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const read=(root,name)=>{const file=path.join(root,name),stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'source_regular');return fs.readFileSync(file,'utf8');};
const documents=Object.freeze(['app.html','make-a-meal.html','tutorial.html','basketboss-latest-guide.html','pricing-sandbox.html','compare.html','subscriptions.html']);
const staticExtension=/\.(?:js|mjs|css|json|webmanifest|png|webp|jpe?g|svg|gif|avif|ico|woff2?)(?:\?|$)/i;
function once(source,from,to,label){const at=source.indexOf(from);assert(at>=0&&source.indexOf(from,at+from.length)<0,'anchor_'+label);return source.slice(0,at)+to+source.slice(at+from.length);}


function webDocument(source){
 assert(!/bb-native-runtime|basketboss-native-build|@capacitor\//.test(source),'native_source');
 source=source.replace(/<base\b[^>]*>/gi,'');
 return once(source,'<head>','<head>\n<base href="/">\n<meta name="basketboss-web-catalogue" content="700">','web_head');
}

function assetReferences(source,files,sourceRoot,precache){
 return source.replace(/\b(src|href)\s*=\s*(["'])([^"']+)\2/gi,(full,attribute,quote,value)=>{
  if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value))return full;
  const url=new URL(value,'https://basketboss.co.uk/'),name=url.pathname.replace(/^\//,'');
  if(!staticExtension.test(url.pathname))return full;
  const generated=files.get(name),file=path.join(sourceRoot,name);
  let bytes=generated;
  if(bytes===undefined&&fs.existsSync(file)&&fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink())bytes=fs.readFileSync(file);
  if(bytes===undefined)return full;
  url.pathname='/'+(generated===undefined?'':'pwa700/')+name;url.search='?v='+digest(bytes).slice(0,16);
  const target=url.pathname+url.search+url.hash;
  // Access-protected manifests must remain network-only; their redirect can
  // otherwise reject Cache.addAll and prevent the offline worker installing.
  if(!/\.webmanifest$/i.test(url.pathname))precache.add(url.pathname+url.search);
  return attribute+'='+quote+target+quote;
 });
}

export function verify700Pwa({directory,release,sourceRoot=ROOT}){
 const html=read(directory,'app.html');
 assert(same(inlineArray(html,'RECIPES').value,release.free)&&same(inlineArray(html,'BB307_NORMALIZED').value,release.normal),'embedded_free');
 assert(same(JSON.parse(read(directory,'recipes.json')),release.free)&&same(JSON.parse(read(directory,'normalized-ingredient-database.json')).recipes,release.normal),'public_json');
 assert(html.includes("fetch('/api/recipes/v700/premium?catalogue=700'")&&html.includes('BB_CATALOGUE700_FREE_PROOF')&&html.includes('data.count!==500'),'main_guard');
 const make=read(directory,'make-a-meal.js');assert(make.includes("'/api/recipes/v700/premium?catalogue=700'")&&make.includes('bbPwa700Identity()!==identity')&&make.includes('data.count!==500')&&!make.includes("'/api/recipes/premium?catalogue=500'"),'make_guard');
 const context=vm.createContext({window:{}});vm.runInContext(read(directory,'bb-premium-preview-config.js'),context);
 assert(same(context.window.BB173_FREE_RECIPE_IDS,release.free.map(recipe=>recipe.id))&&context.window.BB173_PREMIUM_PREVIEW.freeRecipes===200&&context.window.BB173_PREMIUM_PREVIEW.subscriptionVerified===false,'free_gate');
 const inventory=JSON.parse(read(directory,'manifest.json'));assert(inventory.catalogueVersion===700&&inventory.freeRecipes===200&&inventory.premiumRecipes===500&&inventory.privateRecipeBundle===false,'manifest');
 assert(!fs.existsSync(path.join(directory,'bb-native-runtime.js')),'native_file');
 for(const name of documents){const text=read(directory,name);assert(text.includes('<base href="/">')&&!/bb-native-runtime|basketboss-native-build|@capacitor\//.test(text),'web_only');}
 for(const row of inventory.files){const bytes=fs.readFileSync(path.join(directory,row.path));assert(bytes.length===row.bytes&&digest(bytes)===row.sha256,'file_hash');}
 return {catalogueVersion:700,freeRecipes:200,premiumRecipes:500,files:inventory.files.length,privateRecipeBundle:false};
}

export function build700Pwa({sourceRoot=ROOT,publicRelease=path.join(ROOT,'catalogues/700/release'),outputDirectory=path.join(ROOT,'pwa700'),writeImageRedirects=true}={}){
 sourceRoot=fs.realpathSync(sourceRoot);outputDirectory=path.resolve(outputDirectory);
 assert(outputDirectory!==sourceRoot&&!sourceRoot.startsWith(outputDirectory+path.sep),'output_source');
 assert(!outputDirectory.startsWith(sourceRoot+path.sep)||outputDirectory===path.join(sourceRoot,'pwa700'),'output_protected');
 const release=validatePublic700Release({directory:publicRelease,sourceDirectory:sourceRoot}),files=new Map(),precache=new Set();
 for(const name of CLIENT_FILES){if(!name.endsWith('.js'))continue;const original=read(sourceRoot,name),updated=transform700Presentation(original);if(updated!==original)files.set(name,updated);}
 files.set('bb-recipe-planning.js',transform700Planning(read(sourceRoot,'bb-recipe-planning.js'),release.roles));
 files.set('bb-premium-preview-config.js',transform700PreviewConfig(read(sourceRoot,'bb-premium-preview-config.js'),release));
 files.set('make-a-meal.js',transform700MakeAMeal(read(sourceRoot,'make-a-meal.js'),release));
 // The generated script lives in a subdirectory; its dynamic module remains
 // the shared root module, just as in the existing browser pantry.
 files.set('shopping-inventory.js',transform700PantrySelection(read(sourceRoot,'shopping-inventory.js')).replaceAll("'./bb-receipt-inventory-core.mjs?v=20261105-business1'","'/bb-receipt-inventory-core.mjs?v=20261105-business1'"));
 files.set('basketboss-pricing-v19.js',read(sourceRoot,'basketboss-pricing-v19.js')+'\n/* Isolated web700 exact-pair pack guides. */\nObject.assign(window.BBPriceV19.catalog,'+literal(release.packs)+');\n');
 const packs=JSON.parse(read(sourceRoot,'ingredient-pack-catalog.json'));packs.ingredients={...packs.ingredients,...release.packs};files.set('ingredient-pack-catalog.json',json(packs));
 files.set('recipes.json',json(release.free));files.set('normalized-ingredient-database.json',json({recipes:release.normal}));
 for(const name of ['bb-plan-swap-core.js','bb-plan-swap-host.js','bb-plan-swap.js','bb-plan-swap.css','bb-ui-continuity.js','bb-pantry-selection.js','bb-pantry-selection.css'])files.set(name,read(sourceRoot,name));
 const htmls=new Map();
 for(const name of documents){let source=name==='app.html'?transform700Html(read(sourceRoot,name),release):read(sourceRoot,name);source=webDocument(transform700Presentation(source));if(name==='make-a-meal.html')source=once(source,'</head>','<script src="bb-recipe-planning.js"></script>\n</head>','make_planning');htmls.set(name,source);}
 for(const [name,source]of htmls){files.set(name,assetReferences(source,files,sourceRoot,precache));precache.add('/pwa700/'+name.replace(/\.html$/,''));}
 for(const name of files.keys())if(staticExtension.test(name))precache.add('/pwa700/'+name);
 // These are transitive module imports rather than HTML src attributes.
 precache.add('/bb-receipt-inventory-core.mjs?v=20261105-business1');
 precache.add('/bb-pantry-policy.js');
 const urls=[...precache].sort();
 const assetProof=urls.map(url=>{
  const pathname=new URL(url,'https://basketboss.co.uk').pathname;
  let bytes;
  if(pathname.startsWith('/pwa700/')){const name=pathname.slice('/pwa700/'.length);bytes=files.get(name)??files.get(name+'.html');}
  else bytes=fs.readFileSync(path.join(sourceRoot,pathname.slice(1)));
  assert(bytes!==undefined,'precache_asset');return {url,sha256:digest(bytes)};
 });
 const cacheVersion=digest(JSON.stringify(assetProof));
 files.set('precache.js','/* Public web700 cache contract. Never include private/API/auth responses. */\nself.BB700_PWA_CACHE_VERSION='+JSON.stringify(cacheVersion)+';\nself.BB700_PWA_PRECACHE=Object.freeze('+JSON.stringify(urls,null,2)+');\n');
 const manifest={schemaVersion:1,...pwa700Contract(release),freeRecipes:200,premiumRecipes:500,privateRecipeBundle:false,files:[...files.entries()].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,bytes])=>({path:name,bytes:Buffer.byteLength(bytes),sha256:digest(bytes)}))};files.set('manifest.json',json(manifest));
 const staging=fs.mkdtempSync(path.join(path.dirname(outputDirectory),'.pwa700-build-'));
 try{for(const [name,bytes]of files){const file=path.join(staging,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}verify700Pwa({directory:staging,release,sourceRoot});
  const redirects=release.imageRows.map(row=>'/'+row.image+' /catalogues/700/release/assets/'+row.image+' 200').join('\n')+'\n';
  if(writeImageRedirects){const target=path.join(sourceRoot,'_redirects');if(fs.existsSync(target))assert(fs.readFileSync(target,'utf8')===redirects,'existing_redirects');else fs.writeFileSync(target,redirects);}
  fs.rmSync(outputDirectory,{recursive:true,force:true});fs.renameSync(staging,outputDirectory);
 }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
 return {directory:outputDirectory,catalogueVersion:700,freeRecipes:200,premiumRecipes:500,generatedFiles:files.size,precacheUrls:urls.length,cacheVersion,newImageRedirects:release.imageRows.length,privateRecipeBundle:false};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(build700Pwa()));}catch(error){console.error(error.message);process.exitCode=1;}}
