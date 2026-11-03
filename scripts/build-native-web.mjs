#!/usr/bin/env node
// Prepare the native WKWebView assets without changing the Cloudflare web root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const DEFAULT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

// Explicit client assets: a new server script or JSON export cannot be copied by
// accidentally placing it next to the web app. Native dependencies are bundled
// separately; node_modules itself is never part of the web directory.
export const CLIENT_FILES=Object.freeze([
 'basketboss-aisles-v20.js','basketboss-pricing-v19.js','bb-beta-five-nav.js',
 'bb-beta-launch-polish.js','bb-beta-six-fixes.js','bb-cloudflare-qa.js',
 'bb-cold-preview.js','bb-consolidated-qa.js','bb-culinary-enhancements.js',
 'bb-account-deletion.js','bb-account-deletion.css','bb-food-visuals.js','bb-food-visuals.css',
 'bb-ingredient-preferences.js','bb-ingredient-picker.js','bb-ingredient-picker.css',
 'bb-evening-pivot.js','bb-evening-pivot-app.js','bb-evening-pivot-ui.js','bb-evening-pivot-ui.css',
 'bb-cook-voice.js','bb-cook-voice.css','bb-cook-speech-text.js','bb-cook-tts.js','bb-cook-assistant.js',
 'bb-saved-weeks.js','bb-saved-weeks.css',
 'bb-kitchen-essentials.js','bb-kitchen-essentials.css','bb-keyboard-layout.js','bb-keyboard-layout.css',
 'bb-cook-studio.js','bb-cook-studio.css','bb-cook-result.js','bb-cook-result.css',
 'bb-meal-image.js','bb-meal-image.css','bb-navigation-polish.js','bb-navigation-polish.css',
 'bb-account-polish.js','bb-account-polish.css','bb-membership-compare.js','bb-membership-compare.css',
 'bb-premium-feature-badges.js','bb-premium-feature-badges.css',
 'bb-pantry-camera.js','bb-pantry-camera.css','bb-cook-experience.css','bb-featured-framing.js','bb-duration.js','bb-recipe-measures.js','bb-cook-step-layout.js','bb-cook-pantry.js','bb-cook-clarity.css','bb-receipt-quantity.js','bb-pantry-deduction.js','bb-how-it-works.js','bb-how-it-works.css',
 'bb-home.js','bb-kitchen-choice-rules.mjs','bb-shared-shopping.js','bb-shared-shopping.css',
 'bb-weekly-shop.js','bb-weekly-shop.css','bb-simple-layout.js','bb-simple-layout.css',
 'bb-funnel.js','bb-household-sharing.js','bb-install.js','bb-intro-trial.js',
 'bb-membership-settings.js','bb-mobile-beta-polish.js','bb-onboarding-v2.js',
 'bb-partner-signup-prompt.js','bb-plan-premium-polish.js','bb-premium-features.js',
 'bb-premium-preview-config.js','bb-price-scan.js','bb-real-app-tour-v82.js',
 'bb-real-app-tour.js','bb-receipt-host.js','bb-receipt-inventory.js',
 'bb-receipt-scanner.js','bb-recipe-planning.js','bb-recipe-editorial.js','bb-plan-move.js','bb-plan-drag.js','bb-plan-drag.css','bb-serving-scale.js',
 'bb-supermarkets.js','bb-us-market.js','bb-ux-cleanup.js','bb-verified-premium-ui.js',
 'bb-weekly-essentials.js','bb-welcome-splash.js','bb174-trial-ux.js',
 'cloud-config.js','bb-session.js','feedback-config.js','make-a-meal.js','premium-upgrade.js',
 'shopping-inventory.js','bb-receipt-inventory-core.mjs',
 'bb-beta-five.css','bb-beta-launch-polish.css','bb-beta-six-fixes.css',
 'bb-cold-preview.css','bb-consolidated-qa.css','bb-cook-plan-hotfix.css',
 'bb-culinary.css','bb-funnel.css','bb-household-sharing.css','bb-install.css',
 'bb-intro-trial.css','bb-light-meal.css','bb-membership-legal.css',
 'bb-membership-settings.css','bb-mobile-beta-polish.css','bb-mobile-three-20261027.css',
 'bb-onboarding-v2.css','bb-partner-signup-prompt.css','bb-plan-premium-polish.css',
 'bb-premium-features.css','bb-purchase-choice.css','bb-real-app-tour.css',
 'bb-receipt-host.css','bb-receipt-scanner.css','bb-recipe-ingredient-layout.css',
 'bb-servings-mobile-polish.css','bb-settings-premium-polish.css',
 'bb-shop-cook-clarity.css','bb-us-market.css','bb-ux-cleanup.css',
 'bb-welcome-splash.css','bb173-final-polish.css','bb174-trial-ux.css',
 'make-a-meal.css','premium-upgrade.css'
]);
export const DATA_FILES=Object.freeze([
 'recipes.json','normalized-ingredient-database.json','dessert_recipes.json',
 'ingredient-aisle-map.json','ingredient-pack-catalog.json','supermarket-price-observations.json'
]);
export const HTML_FILES=Object.freeze([
 'index.html','app.html','make-a-meal.html','privacy.html','terms.html',
 'tutorial.html','basketboss-latest-guide.html'
]);
const MEMBERSHIP_ALIASES=['pricing-sandbox.html','compare.html','subscriptions.html'];
const ASSET_DIRECTORIES=['icons','food-thumbs','photos','release-assets'];
const ASSET_EXTENSION=/\.(?:png|jpe?g|webp|svg|gif|avif)$/i;
const FORBIDDEN_PATH=/(?:^|\/)(?:\.git|\.github|\.wrangler|node_modules|functions|bb-server-lib|sql|scripts|tests|docs)(?:\/|$)|(?:^|\/)\.[^/]+|\.(?:sql|sealed\.json|private\.json|backup)$/i;
const NATIVE_MARKER='<meta name="basketboss-native-build" content="ios">';

function regularFile(root,relative){
 const absolute=path.resolve(root,relative);
 requireThat(absolute.startsWith(root+path.sep),'Native source escapes the checkout');
 const stat=fs.lstatSync(absolute);
 requireThat(stat.isFile()&&!stat.isSymbolicLink(),'Native source must be a regular file: '+relative);
 return absolute;
}
function readSource(root,relative){return fs.readFileSync(regularFile(root,relative));}
function assetFiles(root,directory){
 const absolute=path.join(root,directory),files=[];
 requireThat(fs.lstatSync(absolute).isDirectory()&&!fs.lstatSync(absolute).isSymbolicLink(),'Native asset directory must not be a symlink: '+directory);
 for(const entry of fs.readdirSync(absolute,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const relative=directory+'/'+entry.name;
  requireThat(!entry.isSymbolicLink(),'Native assets must not contain symlinks: '+relative);
  if(entry.isDirectory())files.push(...assetFiles(root,relative));
  else if(entry.isFile()&&ASSET_EXTENSION.test(entry.name)&&!FORBIDDEN_PATH.test(relative))files.push(relative);
 }
 return files;
}

export function validatePublicCatalogue(recipes,normalized,desserts){
 requireThat(Array.isArray(recipes)&&recipes.length===100,'Native app must contain exactly the public 100 Free recipes');
 const ids=new Set(recipes.map(recipe=>recipe?.id));
 requireThat(ids.size===100&&[...ids].every(id=>typeof id==='string'&&/^[a-z0-9-]+$/.test(id)),'Native Free recipe IDs are invalid');
 requireThat(Array.isArray(normalized?.recipes)&&normalized.recipes.length===100,'Native normalized data must contain exactly 100 Free recipes');
 const normalizedIds=normalized.recipes.map(recipe=>recipe?.id);
 requireThat(new Set(normalizedIds).size===100&&normalizedIds.every(id=>ids.has(id)),'Native normalized recipes do not match the Free catalogue');
 requireThat(Array.isArray(desserts)&&desserts.every(recipe=>ids.has(recipe?.id)),'Native desserts must come from the public Free catalogue');
 return ids;
}

export function transformNativeHtml(source){
 requireThat(typeof source==='string'&&/<head\b[^>]*>/i.test(source),'Native HTML requires a head element');
 let html=source.replace(/<script\b[^>]*\bid=["'](?:bb-owner-qa-restore-script|bb17513-private-qa-toggle-script)["'][^>]*>[\s\S]*?<\/script>/gi,'')
  .replace(/<style\b[^>]*\bid=["']bb17513-private-qa-toggle-css["'][^>]*>[\s\S]*?<\/style>/gi,'').replace(/<base\b[^>]*>/gi,'')
  .replace(/<meta\b[^>]*(?:\bcharset\s*=|\bhttp-equiv\s*=\s*["']content-type["'])[^>]*>/gi,'')
  .replace(/<link\b(?=[^>]*\brel\s*=\s*["']manifest["'])[^>]*>/gi,'')
  // The bundled app uses the installed iOS icon. Keep normal local icons, but
  // avoid parsing the obsolete 85 KB data-URL favicon before the app body.
  .replace(/<link\b(?=[^>]*\brel\s*=\s*["'](?:shortcut\s+)?icon["'])(?=[^>]*\bhref\s*=\s*["']data:image\/)[^>]*>/gi,'')
  .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:paddle-sandbox\.js|service-worker\.js|bb-intro-trial\.js|bb174-trial-ux\.js|bb-membership-settings\.js|bb-install\.js|https?:\/\/[^"']*(?:paddle|stripe)[^"']*)[^"']*["'][^>]*>\s*<\/script>/gi,'');
 if(/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i.test(html)){
  html=html.replace(/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/gi,'<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
 }else html=html.replace(/<head\b[^>]*>/i,match=>match+'\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
 const injection='\n<meta charset="utf-8">\n<base href="./">\n'+NATIVE_MARKER+'\n<script src="bb-native-runtime.js"></script>\n<link rel="stylesheet" href="bb-native.css">\n';
 html=html.replace(/<head\b[^>]*>/i,match=>match+injection);
 // These are app routes, not navigation to the public marketing root. API and
 // cross-origin requests are handled by the native runtime before app scripts.
 // StoreKit subscribers use the same confirmed-email account flow as the PWA.
 // This transform changes only the generated native copy, preserving web billing.
 html=html.replace("document.getElementById('cloud-signup').hidden=recovering||window.BBNative?.isNative===true;","document.getElementById('cloud-signup').hidden=recovering;");
 html=html.replace("if(window.BasketBossVerifiedPremium?.isActive?.()===true)return true;","if(window.BasketBossVerifiedPremium?.isActive?.()===true)return true; if(window.BBNative?.isNative===true)return false;");
 html=html.replace(/(\bhref\s*=\s*["'])\/(?:app(?:\.html)?|index\.html)?(?=[?#"'])/gi,'$1index.html');
 return html;
}

async function defaultBundleRuntime({entry,outfile,root}){
 const {build}=await import('esbuild');
 await build({entryPoints:[entry],outfile,bundle:true,format:'iife',platform:'browser',target:'es2020',charset:'utf8',legalComments:'none',sourcemap:false,minify:true,logLevel:'silent',absWorkingDir:root});
}

export function verifyNativeWeb({directory}){
 const files=[];
 function visit(folder,relative=''){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   const name=relative?relative+'/'+entry.name:entry.name;
   requireThat(!entry.isSymbolicLink()&&!FORBIDDEN_PATH.test(name),'Forbidden path in native web bundle: '+name);
   if(entry.isDirectory())visit(path.join(folder,entry.name),name);
   else{requireThat(entry.isFile(),'Unsupported native bundle entry: '+name);files.push(name);}
  }
 }
 visit(directory);
 const json=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
 validatePublicCatalogue(json('recipes.json'),json('normalized-ingredient-database.json'),json('dessert_recipes.json'));
 requireThat(!files.some(file=>/paddle-sandbox|service-worker/.test(file)),'Native bundle must not include web checkout or service worker scripts');
 for(const name of [...HTML_FILES,...MEMBERSHIP_ALIASES]){
  const html=fs.readFileSync(path.join(directory,name),'utf8');
  requireThat(html.includes(NATIVE_MARKER)&&html.includes('<base href="./">')&&html.includes('viewport-fit=cover'),'Native HTML setup is incomplete: '+name);
  const scripts=[...html.matchAll(/<script\b[^>]*>/gi)];
  requireThat(scripts.length>0&&/\bsrc="bb-native-runtime\.js(?:\?[^"<>]*)?"/.test(scripts[0][0]),'Native runtime must precede every app script: '+name);
  requireThat(!/<script\b[^>]*src=["'][^"']*(?:paddle|stripe)/i.test(html),'Native HTML contains a checkout script: '+name);
 }
 const entry=fs.readFileSync(path.join(directory,'index.html'),'utf8');
 requireThat(entry===fs.readFileSync(path.join(directory,'app.html'),'utf8'),'Native app entrypoints must remain identical');
 requireThat(fs.statSync(path.join(directory,'bb-native-runtime.js')).size>0&&fs.statSync(path.join(directory,'bb-native.css')).size>0,'Native runtime or safe-area styles are missing');
 const manifest=json('native-web-manifest.json');
 requireThat(manifest.version===1&&manifest.appId==='uk.co.basketboss.app'&&manifest.freeRecipes===100,'Native build manifest is invalid');
 const listed=new Set(manifest.files.map(file=>file.path));
 requireThat(files.length===listed.size+1&&files.every(file=>file==='native-web-manifest.json'||listed.has(file)),'Native bundle files differ from the build manifest');
 for(const file of manifest.files){
  requireThat(typeof file.path==='string'&&!path.isAbsolute(file.path)&&!file.path.split('/').includes('..')&&listed.has(file.path),'Native manifest path is invalid');
  const bytes=fs.readFileSync(path.join(directory,file.path));
  requireThat(bytes.length===file.bytes&&sha256(bytes)===file.sha256,'Native bundle hash mismatch: '+file.path);
 }
 return {files:files.length,freeRecipes:100,privateRecipeBundle:false};
}

export function versionNativeHtml(source,readAsset,documents=new Map()){
 return source.replace(/(<(script|link|a)\b[^>]*?\b(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi,(all,prefix,tag,value,quote)=>{
  if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value))return all;
  let address,name;
  try{address=new URL(value.replace(/&amp;/g,'&'),'https://native.invalid/');name=decodeURIComponent(address.pathname).replace(/^\//,'');}catch{return all;}
  if(name.split('/').some(part=>part==='..'||part==='.'))return all;
  let stamp;
  if(tag.toLowerCase()==='a')stamp=documents.get(name);
  else if(/\.(?:js|css)$/.test(name)){const bytes=readAsset(name);if(bytes)stamp=sha256(bytes).slice(0,16);}
  if(!stamp)return all;
  address.searchParams.set(tag.toLowerCase()==='a'?'bb_native_doc':'bb_native_asset',stamp);
  return prefix+value.split(/[?#]/)[0]+'?'+address.searchParams.toString().replace(/&/g,'&amp;')+address.hash+quote;
 });
}

export async function buildNativeWeb({root=DEFAULT_ROOT,bundleRuntime=defaultBundleRuntime}={}){
 root=fs.realpathSync(root);
 const dist=path.join(root,'dist'),output=path.join(dist,'native');
 // Refuse any destination alias before removing or replacing the prior build.
 for(const destination of [dist,output]){
  if(fs.existsSync(destination))requireThat(fs.lstatSync(destination).isDirectory()&&!fs.lstatSync(destination).isSymbolicLink(),'Native output must not be a symlink: '+path.relative(root,destination));
 }
 const recipes=JSON.parse(readSource(root,'recipes.json'));
 validatePublicCatalogue(recipes,JSON.parse(readSource(root,'normalized-ingredient-database.json')),JSON.parse(readSource(root,'dessert_recipes.json')));
 requireThat(readSource(root,'index.html').equals(readSource(root,'app.html')),'Web app entrypoints must match before native build');
 for(const name of [...CLIENT_FILES,...DATA_FILES,...HTML_FILES,'native/runtime.mjs','native/bb-native.css','native/membership.html'])regularFile(root,name);
 const assets=ASSET_DIRECTORIES.flatMap(directory=>assetFiles(root,directory));
 const assetSet=new Set(assets);
 for(const recipe of recipes)requireThat(typeof recipe.image==='string'&&assetSet.has(recipe.image.replace(/^\//,'')),'Public recipe image missing from native bundle: '+recipe.id);
 fs.mkdirSync(dist,{recursive:true});
 const staging=fs.mkdtempSync(path.join(dist,'.native-build-'));
 try{
  const write=(relative,bytes)=>{const destination=path.join(staging,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);};
  for(const name of [...CLIENT_FILES,...DATA_FILES,...assets]){
   let bytes=readSource(root,name);
   if(name==='bb-premium-features.js')bytes=Buffer.from(bytes.toString().replace("if(window.BasketBossVerifiedPremium?.isActive?.()===true)return true;","if(window.BasketBossVerifiedPremium?.isActive?.()===true)return true; if(window.BBNative?.isNative===true)return false;"));
   if(name==='bb-welcome-splash.js')bytes=Buffer.from(bytes.toString().replace('if(shouldShow()&&!window.BBOnboard2026?.willShow())show();',"if(window.BBNative?.isNative!==true&&shouldShow()&&!window.BBOnboard2026?.willShow())show();"));
   if(name==='bb-receipt-scanner.js')bytes=Buffer.from(bytes.toString().replace('function finished(result) {',"function finished(result) { document.dispatchEvent(new Event('basketboss:receipt-confirmed'));"));
   if(name==='bb-partner-signup-prompt.js')bytes=Buffer.from(bytes.toString().replace("if(!['basketboss.co.uk'","if(window.BBNative?.isNative!==true&&!['basketboss.co.uk'"));
   if(name==='bb-onboarding-v2.js')bytes=Buffer.from(bytes.toString()
    .replace('Create a free account or sign in using the existing secure email form. No card needed.','Sign in to your existing account, or continue with Free recipes without signing in.')
    .replace('If you create an account, you may need to confirm your email before signing in.','Use your existing confirmed email and password. This iOS build does not create new accounts.'));
   write(name,bytes);
  }
  for(const name of HTML_FILES)write(name,transformNativeHtml(readSource(root,name).toString('utf8')));
  const membership=transformNativeHtml(readSource(root,'native/membership.html').toString('utf8'));
  for(const name of MEMBERSHIP_ALIASES)write(name,membership);
  write('bb-native.css',readSource(root,'native/bb-native.css'));
  await bundleRuntime({entry:path.join(root,'native/runtime.mjs'),outfile:path.join(staging,'bb-native-runtime.js'),root});
  // WKWebView may retain resources across a sideloaded update. Stamp local
  // assets and page links from content, so a new native build cannot reuse an
  // older Cook script or document under the same URL. APIs stay untouched.
  const documents=new Map(),pages=[...HTML_FILES,...MEMBERSHIP_ALIASES];
  const readAsset=name=>{const file=path.join(staging,name);return fs.existsSync(file)&&fs.statSync(file).isFile()?fs.readFileSync(file):null;};
  for(const name of pages){const html=versionNativeHtml(fs.readFileSync(path.join(staging,name),'utf8'),readAsset);write(name,html);documents.set(name,sha256(Buffer.from(html)).slice(0,16));}
  for(const name of pages)write(name,versionNativeHtml(fs.readFileSync(path.join(staging,name),'utf8'),readAsset,documents));
  const files=[];
  function inventory(directory,relative=''){
   for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())inventory(path.join(directory,entry.name),name);
    else{const bytes=fs.readFileSync(path.join(directory,entry.name));files.push({path:name,bytes:bytes.length,sha256:sha256(bytes)});}
   }
  }
  inventory(staging);
  write('native-web-manifest.json',JSON.stringify({version:1,appId:'uk.co.basketboss.app',appName:'BasketBoss',webOrigin:'capacitor://localhost',apiOrigin:'https://basketboss.co.uk',freeRecipes:100,privateRecipeBundle:false,files},null,2)+'\n');
  const verification=verifyNativeWeb({directory:staging});
  fs.rmSync(output,{recursive:true,force:true});
  fs.renameSync(staging,output);
  return {directory:output,...verification};
 }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const result=await buildNativeWeb();console.log('Native web bundle ready: '+path.relative(DEFAULT_ROOT,result.directory)+' ('+result.files+' files; 100 Free recipes; Premium remains authenticated).');}
 catch(error){console.error('Native web build failed: '+error.message);process.exitCode=1;}
}
