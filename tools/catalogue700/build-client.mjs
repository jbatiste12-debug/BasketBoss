#!/usr/bin/env node
// Build an explicit 700-catalogue native web variant. The source client and
// its 100-Free/221-or-400-Premium verifier remain unchanged.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildNativeWeb,verifyNativeWeb,versionNativeHtml,CLIENT_FILES} from '../../scripts/build-native-web.mjs';
import {canonicalHash,private700OutputDirectory,PROTECTED500} from './release.mjs';
import {sha256Utf8} from './client-integrity.mjs';
import {transform700MakeAMeal} from './make-a-meal.mjs';
import {transform700Presentation} from './presentation.mjs';
import {transform700Performance} from './performance.mjs';
import {transform700PlanExtrasPicker} from './plan-extras-picker.mjs';
import swapHost from '../../bb-plan-swap-host.js';
import {transform700PantrySelection} from './pantry-selection.mjs';
import {webpDimensions} from '../../scripts/verify-recipe-expansion.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX=/^[a-f0-9]{64}$/;
const RELEASE_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const IMAGE=id=>`release-assets/basketboss-v17/images/new/${id}.webp`;
const FORBIDDEN=/(?:^|\/)(?:\.git|\.github|\.wrangler|node_modules|functions|bb-server-lib|sql|scripts|tests|docs|catalogues|tools)(?:\/|$)|(?:^|\/)\.[^/]+|\.(?:sql|sealed\.json|private\.json|backup)$/i;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const assert=(condition,message)=>{if(!condition)throw Error('catalogue700_client_'+message);};
const rows=value=>Array.isArray(value)?value:value?.recipes;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const regular=file=>{const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'nonregular_file');return file;};
const safeJson=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

export function inlineArray(source,variable){
 const marker='const '+variable+'=',offset=source.indexOf(marker);
 assert(offset>=0&&source.indexOf(marker,offset+marker.length)<0,'ambiguous_'+variable);
 const start=offset+marker.length;assert(source[start]==='[','nonarray_'+variable);
 let depth=0,string=false,escaped=false,end=-1;
 for(let index=start;index<source.length;index++){
  const char=source[index];
  if(string){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')string=false;continue;}
  if(char==='"'){string=true;continue;}
  if(char==='[')depth++;else if(char===']'){depth--;if(depth===0){end=index+1;break;}}
 }
 assert(end>start&&source[end]===';','unterminated_'+variable);
 const value=JSON.parse(source.slice(start,end));assert(Array.isArray(value),'nonarray_'+variable);
 return {value,start,end};
}

function replaceOnce(source,from,to,label){
 const at=source.indexOf(from);assert(at>=0&&source.indexOf(from,at+from.length)<0,'anchor_'+label);
 return source.slice(0,at)+to+source.slice(at+from.length);
}

function normalizedPairs(recipes,normal){
 assert(Array.isArray(recipes)&&Array.isArray(normal)&&recipes.length===normal.length,'pair_counts');
 const ids=new Set();
 for(const [index,recipe]of recipes.entries()){
  const n=normal[index];
  assert(recipe&&typeof recipe.id==='string'&&ID.test(recipe.id)&&!ids.has(recipe.id)&&n?.id===recipe.id,'pair_identity');ids.add(recipe.id);
  assert(Array.isArray(recipe.ingredients)&&Array.isArray(n.ingredients)&&recipe.ingredients.length===n.ingredients.length,'pair_ingredients');
  for(const [slot,source]of recipe.ingredients.entries()){
   assert(Array.isArray(source)&&source.length===4&&typeof source[0]==='string'&&typeof source[1]==='string'&&Number.isFinite(source[2])&&typeof source[3]==='string','ingredient_shape');
   assert(n.ingredients[slot]?.name===source[0]&&n.ingredients[slot]?.ingredient_index===slot&&n.ingredients[slot]?.recipe_id===recipe.id,'pair_position');
  }
 }
 return ids;
}

export function validatePublic700Release({directory,sourceDirectory,verifyImages=true}){
 directory=fs.realpathSync(directory);sourceDirectory=fs.realpathSync(sourceDirectory);
 const manifest=json(regular(path.join(directory,'manifest.json'))),free=json(regular(path.join(directory,'free.recipes.json'))),normal=rows(json(regular(path.join(directory,'free.normalized.json')))),roles=json(regular(path.join(directory,'planning-roles.json'))),packFile=json(regular(path.join(directory,'pack-additions.json'))),packs=packFile.ingredients;
 assert(manifest.schemaVersion===1&&manifest.clientVersion==='1.0.2'&&manifest.catalogue_version===700&&manifest.free_count===200&&manifest.premium_count===500,'manifest_version_counts');
 assert(RELEASE_ID.test(manifest.release_id||'')&&['premium_rows_sha256','protected_rows_sha256','free_recipes_sha256','free_normalized_sha256'].every(key=>HEX.test(manifest[key]||'')),'manifest_pins');
 assert(manifest.protected_rows_sha256===PROTECTED500.privateRows,'protected_private_pin');
 assert(Array.isArray(free)&&free.length===200&&Array.isArray(normal)&&normal.length===200,'free_counts');
 const freeIds=normalizedPairs(free,normal);
 assert(canonicalHash(free)===manifest.free_recipes_sha256&&canonicalHash(normal)===manifest.free_normalized_sha256,'free_hashes');
 const sourceHtml=fs.readFileSync(regular(path.join(sourceDirectory,'app.html')),'utf8'),oldFree=inlineArray(sourceHtml,'RECIPES').value,oldNormal=inlineArray(sourceHtml,'BB307_NORMALIZED').value;
 assert(oldFree.length===100&&oldNormal.length===100&&canonicalHash(oldFree)===PROTECTED500.freeRecipes&&canonicalHash(oldNormal)===PROTECTED500.freeNormalized,'source_legacy_pin');
 assert(equal(free.slice(0,100),oldFree)&&equal(normal.slice(0,100),oldNormal),'legacy_free_changed');
 assert(roles.schemaVersion===1&&roles.catalogueVersion===700&&roles.legacyCatalogueVersion===500&&Array.isArray(roles.legacyRecipeIds)&&roles.legacyRecipeIds.length===500&&new Set(roles.legacyRecipeIds).size===500&&roles.legacyRecipeIds.every(id=>typeof id==='string'&&ID.test(id)),'legacy_roles');
 assert(equal(roles.legacyRecipeIds.slice(0,100),oldFree.map(r=>r.id)),'legacy_free_roles');
 assert(Array.isArray(roles.recipes)&&roles.recipes.length===200&&new Set(roles.recipes.map(r=>r?.id)).size===200&&new Set(roles.recipes.map(r=>r?.catalogueNumber)).size===200,'new_roles_count');
 const legacy=new Set(roles.legacyRecipeIds);
 for(const role of roles.recipes)assert(role&&typeof role.id==='string'&&ID.test(role.id)&&!/^bb172-own-/.test(role.id)&&!legacy.has(role.id)&&Number.isInteger(role.catalogueNumber)&&role.catalogueNumber>=501&&role.catalogueNumber<=700&&['dinner','breakfast','dessert','starter','side'].includes(role.kind),'new_role');
 assert(roles.recipes.filter(r=>r.kind==='breakfast').length===39,'breakfast_count');
 const allIds=[...roles.legacyRecipeIds,...roles.recipes.map(r=>r.id)],allSet=new Set(allIds);
 assert(allIds.length===700&&allSet.size===700&&[...freeIds].every(id=>allSet.has(id)),'catalogue_ids');
 assert(free.slice(100).every(r=>r.accessTier==='free'&&r.premium===false&&!legacy.has(r.id)),'free_tiers');
 for(const recipe of free.slice(100)){const role=roles.recipes.find(r=>r.id===recipe.id);assert(role&&recipe.catalogueNumber===role.catalogueNumber&&recipe.dinnerEligible===(role.kind==='dinner'),'free_role_binding');}
 const premiumIds=[...roles.legacyRecipeIds.filter(id=>!freeIds.has(id)),...roles.recipes.filter(r=>!freeIds.has(r.id)).sort((a,b)=>a.catalogueNumber-b.catalogueNumber).map(r=>r.id)];
 assert(premiumIds.length===500&&new Set(premiumIds).size===500,'premium_ids');
 assert(packs&&typeof packs==='object'&&!Array.isArray(packs),'pack_overlay');
 const priceContext=vm.createContext({});priceContext.window=priceContext;vm.runInContext(fs.readFileSync(regular(path.join(sourceDirectory,'basketboss-pricing-v19.js')),'utf8'),priceContext);
 for(const [key,pack]of Object.entries(packs)){
  assert(pack&&key===pack.ingredient+'|'+pack.unit&&!Object.hasOwn(priceContext.BBPriceV19.catalog,key)&&priceContext.BBPriceV19.canonical(pack.ingredient)===pack.ingredient,'pack_identity');
  assert(['g','ml','each','clove'].includes(pack.unit)&&pack.standard_pack_unit===pack.unit&&Number.isFinite(pack.standard_pack_size)&&pack.standard_pack_size>0&&Number.isFinite(pack.uk_pack_price)&&pack.uk_pack_price>0&&pack.needs_review===true,'pack_values');
 }
 assert(Array.isArray(manifest.recipes)&&manifest.recipes.length===200&&new Set(manifest.recipes.map(r=>r?.id)).size===200,'image_manifest');
 const imageRows=new Map(manifest.recipes.map(r=>[r.id,r])),imageHashes=new Set();
 for(const role of roles.recipes){
  const image=imageRows.get(role.id);
  assert(image&&image.catalogueNumber===role.catalogueNumber&&image.image===IMAGE(role.id)&&HEX.test(image.sha256||''),'image_identity');
  if(verifyImages){
   const file=path.join(directory,'assets',image.image),bytes=fs.readFileSync(regular(file)),dims=webpDimensions(bytes),digest=hash(bytes);
   assert(dims.width===1448&&dims.height===1086&&digest===image.sha256&&!imageHashes.has(digest),'image_bytes');imageHashes.add(digest);
  }
 }
 return {manifest,free,normal,roles,packs,premiumIds,imageRows:[...imageRows.values()],sourceHtml};
}

function browserContract(release){
 return {catalogueVersion:700,clientVersion:'1.0.2',releaseId:release.manifest.release_id,freeRecipesSha256:release.manifest.free_recipes_sha256,freeNormalizedSha256:release.manifest.free_normalized_sha256,premiumRowsSha256:release.manifest.premium_rows_sha256,premiumIds:release.premiumIds,allIds:[...release.roles.legacyRecipeIds,...release.roles.recipes.map(r=>r.id)],newRecipeIds:release.roles.recipes.map(r=>r.id)};
}

function previewConfiguration(source){
 const context=vm.createContext({window:{}});
 vm.runInContext(source,context,{timeout:1000});
 return {ids:context.window.BB173_FREE_RECIPE_IDS,config:context.window.BB173_PREMIUM_PREVIEW};
}

function verify700PreviewConfig(source,release){
 const {ids,config}=previewConfiguration(source),expected=release.free.map(recipe=>recipe.id);
 assert(Array.isArray(ids)&&equal(ids,expected)&&ids.length===200&&new Set(ids).size===200&&ids.every(id=>!release.premiumIds.includes(id)),'preview_free_ids');
 assert(config?.freeRecipes===200&&config.totalRecipes===700&&config.targetRecipes===700&&config.targetPremiumRecipes===500&&equal(config.acceptedPremiumRecipeCounts,[500])&&config.subscriptionVerified===false,'preview_counts');
 assert(Object.isFrozen(ids)&&Object.isFrozen(config)&&Object.isFrozen(config.acceptedPremiumRecipeCounts),'preview_immutable');
 return {ids,config};
}

// The Free allowlist is used by the real planner gate as well as presentation.
// Only generated catalogue-700 clients receive this public-data override;
// Premium still requires the existing authenticated server response.
export function transform700PreviewConfig(source,release){
 assert(typeof source==='string'&&Array.isArray(release?.free)&&release.free.length===200&&Array.isArray(release.premiumIds)&&release.premiumIds.length===500,'preview_release');
 const {ids,config}=previewConfiguration(source);
 assert(Array.isArray(ids)&&ids.length===100&&new Set(ids).size===100&&equal([...ids].sort(),release.free.slice(0,100).map(recipe=>recipe.id).sort())&&config?.freeRecipes===100&&config.totalRecipes===500&&config.targetRecipes===500&&config.targetPremiumRecipes===400&&equal(config.acceptedPremiumRecipeCounts,[221,400])&&config.subscriptionVerified===false,'preview_legacy_source');
 source=replaceOnce(source,'window.BB173_FREE_RECIPE_IDS=Object.freeze('+JSON.stringify(ids)+');','window.BB173_FREE_RECIPE_IDS=Object.freeze('+safeJson(release.free.map(recipe=>recipe.id))+');','preview_free_ids');
 source=replaceOnce(source,'freeRecipes:100,totalRecipes:500,targetRecipes:500,targetPremiumRecipes:400','freeRecipes:200,totalRecipes:700,targetRecipes:700,targetPremiumRecipes:500','preview_counts');
 source=replaceOnce(source,'acceptedPremiumRecipeCounts:Object.freeze([221,400])','acceptedPremiumRecipeCounts:Object.freeze([500])','preview_accepted_counts');
 source=source.replace('Public static files include 100 Free recipes; complete 221/400-record Premium catalogues','Public static files include 200 Free recipes; the complete 500-record Premium catalogue');
 verify700PreviewConfig(source,release);
 return source;
}

function proofScript(contract){
 const portable=sha256Utf8.toString().replace('function sha256Utf8(','function bbCatalogue700Sha256(');
 return `\n// Versioned data proof is captured before recipe metadata or regional prices mutate runtime objects.\n${portable}\nconst BB_CATALOGUE700_RELEASE=Object.freeze(${safeJson(contract)});\nconst BB_CATALOGUE700_NEW_IDS=new Set(BB_CATALOGUE700_RELEASE.newRecipeIds);\nconst BB_CATALOGUE700_PUBLIC_BYTES=[JSON.stringify(RECIPES),JSON.stringify(BB307_NORMALIZED)];\nconst BB_CATALOGUE700_FREE_PROOF=Promise.resolve().then(()=>Promise.all(BB_CATALOGUE700_PUBLIC_BYTES.map(async value=>{if(globalThis.crypto?.subtle){try{const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');}catch{}}return bbCatalogue700Sha256(value);}))).then(([recipes,normalized])=>recipes===BB_CATALOGUE700_RELEASE.freeRecipesSha256&&normalized===BB_CATALOGUE700_RELEASE.freeNormalizedSha256).catch(()=>false);\n`;
}

export function transform700Html(source,release){
 assert(typeof source==='string','source_html');
 source=transform700Performance(source);
 source=transform700PlanExtrasPicker(source);
 for(const [name,value]of [['RECIPES',release.free],['BB307_NORMALIZED',release.normal]]){
  const span=inlineArray(source,name);source=source.slice(0,span.start)+safeJson(value)+source.slice(span.end);
 }
 const norm=inlineArray(source,'BB307_NORMALIZED');source=source.slice(0,norm.end+1)+proofScript(browserContract(release))+source.slice(norm.end+1);
 source=replaceOnce(source,"fetch('/api/recipes/premium?catalogue=500'","fetch('/api/recipes/v700/premium?catalogue=700'",'premium_route');
 const old="if(![221,400].includes(data?.count)||!Array.isArray(data.recipes)||data.recipes.length!==data.count||!Array.isArray(data.normalized)||data.normalized.length!==data.count)throw Error('Premium recipe data incomplete');";
 const replacement=`if(data?.catalogueVersion!==700||data.releaseId!==BB_CATALOGUE700_RELEASE.releaseId||data.count!==500||data.total!==700||data.targetTotal!==700||data.freeRecipesSha256!==BB_CATALOGUE700_RELEASE.freeRecipesSha256||data.freeNormalizedSha256!==BB_CATALOGUE700_RELEASE.freeNormalizedSha256||!Array.isArray(data.recipes)||data.recipes.length!==500||!Array.isArray(data.normalized)||data.normalized.length!==500)throw Error('Premium recipe data incomplete');\n    if(!await BB_CATALOGUE700_FREE_PROOF)throw Error('Public recipe release mismatch');\n    if(stamp!==bbPremiumRequest)return;\n    if(!bbPremiumMatches(pin)){bbPremiumClear();return;}\n    for(let index=0;index<500;index++){const recipe=data.recipes[index],norm=data.normalized[index];if(recipe?.id!==BB_CATALOGUE700_RELEASE.premiumIds[index]||norm?.id!==recipe.id||!Array.isArray(recipe.ingredients)||!Array.isArray(norm.ingredients)||norm.ingredients.length!==recipe.ingredients.length||norm.ingredients.some((row,slot)=>row?.recipe_id!==recipe.id||row.ingredient_index!==slot||row.name!==recipe.ingredients[slot]?.[0]))throw Error('Premium recipe identity mismatch');}`;
 source=replaceOnce(source,old,replacement,'premium_count');
 const initialMetadata='for(const recipe of RECIPES)Object.assign(recipe,BBRecipePlanning.metadata(recipe));';
 source=replaceOnce(source,initialMetadata,"for(const recipe of RECIPES)if(/^bb172-own-/.test(recipe.id)&&bb172ReadOwnRecipes().some(own=>own.id===recipe.id))BBRecipePlanning.registerPersonalRecipe(recipe);\n"+initialMetadata,'personal_recipe_registration');
 source=replaceOnce(source,'function bb172IsDessertOrNonDinner(recipe){\n const category=',"function bb172IsDessertOrNonDinner(recipe){\n if(BB_CATALOGUE700_NEW_IDS.has(recipe?.id))return !BBRecipePlanning.isDinner(recipe);\n const category=",'additional_dinner_paths');
 // The ordinary Auto-Fill path is unchanged. The one-day control supplies
 // these optional hooks only while proposing an unsaved replacement.
 source=replaceOnce(source,
  'const all=RECIPES.filter(r=>bb176AllowedRecipe(r.id)&&bbAfIngredientAllowed(r)&&bbAfDinner(r)&&',
  'const all=RECIPES.filter(r=>!(filters.bbPlanSwapExcluded||[]).includes(r.id)&&bb176AllowedRecipe(r.id)&&bbAfIngredientAllowed(r)&&bbAfDinner(r)&&',
  'swap_exclusion');
 // The current release records ownership when an item is bought. Keep the
 // separately supported legacy catalogue's record-then-Finish contract intact.
 source=replaceOnce(source,'</head>','<meta name="basketboss-onboarding" content="quick-v1">\n<meta name="basketboss-shop-ownership" content="immediate-v1">\n<link rel="stylesheet" href="bb-shop-continuation.css">\n<script src="bb-shop-ownership.js"></script>\n<script src="bb-shop-continuation.js"></script>\n<link rel="stylesheet" href="bb-plan-swap.css">\n<link rel="stylesheet" href="bb-pantry-selection.css">\n<script src="bb-plan-swap-core.js"></script>\n<script src="bb-plan-swap-host.js"></script>\n<script src="bb-pantry-selection.js"></script>\n<script defer src="bb-ui-continuity.js"></script>\n</head>','swap_style');
 // Bind the adapter inside the existing private planner closure, after its
 // state is initialized. External scripts cannot access that lexical state.
 source=replaceOnce(source,'window.BBHomeHost=Object.freeze({',`(function(win){const bindPlanner=${swapHost.currentPlanner.toString()};win.BBPlanSwapHost=win.BBPlanSwapHostFactory.createHost(bindPlanner());})(window);\nwindow.BBHomeHost=Object.freeze({`,'swap_private_binding');
 source=replaceOnce(source,'</body>','<script src="bb-plan-swap.js"></script>\n</body>','swap_scripts');
 source=source.replaceAll('Use 100 recipes free','Use 200 recipes free').replaceAll('100 Free recipes','200 Free recipes');
 return source;
}

export function transform700Planning(source,roles,{policySource=fs.readFileSync(new URL('./planning.mjs',import.meta.url),'utf8')}={}){
 assert(typeof source==='string'&&Array.isArray(roles?.legacyRecipeIds),'planning_source');
 source=replaceOnce(source,'  function isDinner(recipe){','  function isLegacyDinner(recipe){','legacy_predicate');
 const policy=policySource.replace(/^export /gm,'');
 const wrapper=`  // This generated build alone opts into the reviewed version-700 roles.\n  const catalogue700Policy=(function(){${policy}\nreturn compileCatalogueDinner;})();\n  const catalogue700Roles=${safeJson(roles)};\n  const catalogue700Dinner=catalogue700Policy({catalogueVersion:700,roles:catalogue700Roles,legacyIsDinner:isLegacyDinner});\n  const catalogue700PersonalRecipes=new WeakSet();\n  function registerPersonalRecipe(recipe){if(recipe&&typeof recipe==='object'&&/^bb172-own-[0-9a-z-]{8,52}$/.test(recipe.id)&&recipe.tag==='MY RECIPE'&&Array.isArray(recipe.ingredients)&&recipe.ingredients.length>0){catalogue700PersonalRecipes.add(recipe);return true;}return false;}\n  function isDinner(recipe){if(catalogue700PersonalRecipes.has(recipe))return isLegacyDinner(recipe);return catalogue700Dinner(recipe);}\n`;
 source=replaceOnce(source,'  function metadata(recipe){',wrapper+'  function metadata(recipe){','metadata_hook');
 return replaceOnce(source,'proteinAlias,createRotation});','proteinAlias,createRotation,registerPersonalRecipe});','personal_recipe_export');
}

function walk(directory,callback,relative=''){
 for(const entry of fs.readdirSync(path.join(directory,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const name=relative?relative+'/'+entry.name:entry.name;
  assert(!entry.isSymbolicLink()&&!FORBIDDEN.test(name),'forbidden_output_path');
  if(entry.isDirectory())walk(directory,callback,name);else{assert(entry.isFile(),'nonregular_output');callback(name,path.join(directory,name));}
 }
}

export function verify700Client({directory,release,requireInventory=true}){
 const html=fs.readFileSync(regular(path.join(directory,'app.html')),'utf8');
 assert(html===fs.readFileSync(regular(path.join(directory,'index.html')),'utf8'),'entrypoints_differ');
 assert(equal(inlineArray(html,'RECIPES').value,release.free)&&equal(inlineArray(html,'BB307_NORMALIZED').value,release.normal),'embedded_public_data');
 assert(equal(json(path.join(directory,'recipes.json')),release.free)&&equal(rows(json(path.join(directory,'normalized-ingredient-database.json'))),release.normal),'public_files');
 assert(html.includes("fetch('/api/recipes/v700/premium?catalogue=700'")&&!html.includes("fetch('/api/recipes/premium?catalogue=500'"),'versioned_route');
 assert(html.includes('data.count!==500')&&html.includes('data?.catalogueVersion!==700')&&html.includes('BB_CATALOGUE700_FREE_PROOF'),'response_validation');
 assert(html.includes("if(stamp!==bbPremiumRequest)return;")&&html.includes("if(!bbPremiumMatches(pin)){bbPremiumClear();return;}"),'session_guards');
 verify700PreviewConfig(fs.readFileSync(regular(path.join(directory,'bb-premium-preview-config.js')),'utf8'),release);
 const mealSource=fs.readFileSync(regular(path.join(directory,'make-a-meal.js')),'utf8'),mealHtml=fs.readFileSync(regular(path.join(directory,'make-a-meal.html')),'utf8');
 assert(mealSource.includes("bbMealJSON('recipes.json',{cache:'no-store'})")&&mealSource.includes("bbMealJSON('/api/recipes/v700/premium?catalogue=700'")&&!mealSource.includes("/api/recipes/premium?catalogue=500")&&mealSource.includes('data.length!==200||bbSecureFreeIds.size!==200||'),'make_catalogue');
 assert(/<script\b[^>]*\bsrc="bb-recipe-planning\.js(?:\?[^"<>]*)?"/.test(mealHtml),'make_planning');
 const privateIds=new Set(release.premiumIds),fileHashes=[];
 walk(directory,(name,file)=>{
  const bytes=fs.readFileSync(file);fileHashes.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
  if(/\.json$/i.test(name)&&!['native-web-manifest.json','catalogue700-client-manifest.json'].includes(name)){
   let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{throw Error('catalogue700_client_invalid_json');}
   const candidate=rows(data);if(Array.isArray(candidate)&&candidate.some(r=>r&&typeof r.id==='string'&&Array.isArray(r.ingredients)))assert(candidate.every(r=>!privateIds.has(r.id)),'private_recipe_payload');
  }
 });
 for(const row of release.imageRows){const bytes=fs.readFileSync(regular(path.join(directory,row.image)));assert(hash(bytes)===row.sha256,'materialized_image');}
 const planningContext=vm.createContext({});planningContext.window=planningContext;
 vm.runInContext(fs.readFileSync(regular(path.join(directory,'bb-recipe-planning.js')),'utf8'),planningContext);
 for(const free of release.free){const planned=release.roles.recipes.find(r=>r.id===free.id);if(planned)assert(planningContext.BBRecipePlanning.isDinner(free)===(planned.kind==='dinner'),'free_role');}
 if(requireInventory){
  const inventory=json(regular(path.join(directory,'native-web-manifest.json'))),client=json(regular(path.join(directory,'catalogue700-client-manifest.json')));
  assert(inventory.catalogueVersion===700&&inventory.clientVersion==='1.0.2'&&inventory.freeRecipes===200&&inventory.privateRecipeBundle===false&&inventory.releaseId===release.manifest.release_id,'inventory_version');
  assert(equal(inventory.files,fileHashes.filter(row=>row.path!=='native-web-manifest.json')),'inventory_hashes');
  const expected={...browserContract(release),schemaVersion:1,activationEligible:false,newImageCount:200,privateRecipeBundle:false};
  assert(equal(client,expected),'client_manifest');
 }
 return {files:fileHashes.length,freeRecipes:200,expectedPremium:500,catalogueVersion:700,privateRecipeBundle:false,fileHashes};
}

export async function build700Client({sourceRoot=ROOT,publicRelease,outputDirectory,prepareNative=true,clientAssetsRoot=ROOT}={}){
 assert(typeof publicRelease==='string'&&typeof outputDirectory==='string','paths_required');
 sourceRoot=fs.realpathSync(sourceRoot);
 // Validate all release data and image bytes before touching build output.
 let release=validatePublic700Release({directory:publicRelease,sourceDirectory:sourceRoot});
 let sourceDirectory=sourceRoot;
 if(prepareNative&&fs.existsSync(path.join(sourceRoot,'native/runtime.mjs'))){const built=await buildNativeWeb({root:sourceRoot});sourceDirectory=built.directory;}
 verifyNativeWeb({directory:sourceDirectory});
 release=validatePublic700Release({directory:publicRelease,sourceDirectory});
 const destination=private700OutputDirectory(outputDirectory,ROOT);
 assert(destination!==sourceDirectory&&!destination.startsWith(sourceDirectory+path.sep),'output_source_overlap');
 assert(fs.readdirSync(destination).length===0,'output_not_empty');
 const staging=fs.mkdtempSync(path.join(path.dirname(destination),'.catalogue700-build-'));
 try{
  walk(sourceDirectory,(name,file)=>{if(name==='native-web-manifest.json')return;const target=path.join(staging,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);});
  const write=(name,value)=>{const target=path.join(staging,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);};
  for(const name of CLIENT_FILES){if(!name.endsWith('.js'))continue;const original=fs.readFileSync(path.join(staging,name),'utf8'),updated=transform700Presentation(original);if(updated!==original)write(name,updated);}
  const html=transform700Html(fs.readFileSync(path.join(sourceDirectory,'app.html'),'utf8'),release);
  write('app.html',html);write('index.html',html);
  write('recipes.json',JSON.stringify(release.free,null,2)+'\n');write('normalized-ingredient-database.json',JSON.stringify({recipes:release.normal},null,2)+'\n');
  write('bb-recipe-planning.js',transform700Planning(fs.readFileSync(path.join(sourceDirectory,'bb-recipe-planning.js'),'utf8'),release.roles));
  write('bb-premium-preview-config.js',transform700PreviewConfig(fs.readFileSync(path.join(sourceDirectory,'bb-premium-preview-config.js'),'utf8'),release));
  write('make-a-meal.js',transform700MakeAMeal(fs.readFileSync(path.join(sourceDirectory,'make-a-meal.js'),'utf8'),release,{publicRecipesUrl:'recipes.json'}));
  write('make-a-meal.html',replaceOnce(fs.readFileSync(path.join(staging,'make-a-meal.html'),'utf8'),'</head>','<script src="bb-recipe-planning.js"></script>\n</head>','make_planning'));
  for(const file of ['bb-plan-swap-core.js','bb-plan-swap-host.js','bb-plan-swap.js','bb-plan-swap.css','bb-ui-continuity.js','bb-pantry-selection.js','bb-pantry-selection.css'])write(file,fs.readFileSync(regular(path.join(clientAssetsRoot,file))));
  write('shopping-inventory.js',transform700PantrySelection(fs.readFileSync(path.join(sourceDirectory,'shopping-inventory.js'),'utf8')));
  const overlay='\n/* Isolated catalogue-700 exact-pair guide additions; no aliases or conversion rules change. */\nObject.assign(window.BBPriceV19.catalog,'+safeJson(release.packs)+');\n';
  write('basketboss-pricing-v19.js',fs.readFileSync(path.join(sourceDirectory,'basketboss-pricing-v19.js'),'utf8')+overlay);
  const packData=json(path.join(sourceDirectory,'ingredient-pack-catalog.json'));packData.ingredients={...packData.ingredients,...release.packs};write('ingredient-pack-catalog.json',JSON.stringify(packData,null,2)+'\n');
  for(const row of release.imageRows)write(row.image,fs.readFileSync(path.join(publicRelease,'assets',row.image)));
  // Keep count disclosures consistent in this generated native runtime only.
  const nativeRuntime=path.join(staging,'bb-native-runtime.js');if(fs.existsSync(nativeRuntime))write('bb-native-runtime.js',transform700Presentation(fs.readFileSync(nativeRuntime,'utf8')));
  const htmlFiles=[];walk(staging,name=>{if(/\.html$/i.test(name))htmlFiles.push(name);});
  const readAsset=name=>{const file=path.join(staging,name);return fs.existsSync(file)&&fs.statSync(file).isFile()?fs.readFileSync(file):null;},documents=new Map();
  for(const file of htmlFiles){const next=versionNativeHtml(transform700Presentation(fs.readFileSync(path.join(staging,file),'utf8')),readAsset);write(file,next);documents.set(file,hash(Buffer.from(next)).slice(0,16));}
  for(const file of htmlFiles)write(file,versionNativeHtml(fs.readFileSync(path.join(staging,file),'utf8'),readAsset,documents));
  write('catalogue700-client-manifest.json',JSON.stringify({...browserContract(release),schemaVersion:1,activationEligible:false,newImageCount:200,privateRecipeBundle:false},null,2)+'\n');
  const verification=verify700Client({directory:staging,release,requireInventory:false});
  const inventory={version:1,appId:'uk.co.basketboss.app',appName:'BasketBoss',clientVersion:'1.0.2',catalogueVersion:700,webOrigin:'capacitor://localhost',apiOrigin:'https://basketboss.co.uk',freeRecipes:200,privateRecipeBundle:false,releaseId:release.manifest.release_id,files:verification.fileHashes};
  write('native-web-manifest.json',JSON.stringify(inventory,null,2)+'\n');
  verify700Client({directory:staging,release});
  fs.rmSync(destination,{recursive:true});fs.renameSync(staging,destination);
  return {directory:destination,files:verification.files+1,freeRecipes:200,expectedPremium:500,catalogueVersion:700,privateRecipeBundle:false,activationEligible:false};
 }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),opt=name=>{const at=args.indexOf(name);assert(at>=0&&args[at+1],'missing_'+name.slice(2));return args[at+1];};
 try{const result=await build700Client({sourceRoot:opt('--source-root'),publicRelease:opt('--public-release'),outputDirectory:opt('--output-dir')});console.log(JSON.stringify(result));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
