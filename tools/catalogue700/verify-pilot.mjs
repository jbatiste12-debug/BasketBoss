#!/usr/bin/env node
// Non-activating authoring validation. Never changes recipes, APIs, prices or D1.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {isCatalogueDinner} from './planning.mjs';

const DEFAULT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const DEFAULT_STAGE=process.env.BB_RECIPE700_STAGING_DIR||path.join(DEFAULT_ROOT,'.local-private','recipe700-pilot');
const BASE='b3ee36c3e115844684b24482c7de7026d9064f27';
const PRIVATE=process.env.BB_RECIPE700_BASELINE_FILE||path.join(DEFAULT_ROOT,'.local-private','catalogue500-baseline.json');
const PRIVATE_HASH='f89eaecc9b2ca71fbd8018c7f733e51c630f6992e5ad5def902f609a71fcbc2e';
const MARKETS=['UK','Guernsey','Jersey','US'];
export const PILOT=Object.freeze([
 {number:501,id:'crispy-aromatic-duck-pancakes',tier:'premium',dinner:true},
 {number:514,id:'salmon-en-croute-with-spinach',tier:'premium',dinner:true},
 {number:527,id:'spaghetti-carbonara',tier:'free',dinner:true},
 {number:528,id:'belgian-breakfast-waffles-with-berries',tier:'premium',dinner:false},
 {number:545,id:'sticky-bbq-pork-spare-ribs-with-slaw',tier:'free',dinner:true}
]);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const rows=value=>Array.isArray(value)?value:value?.recipes;
const fold=value=>String(value??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const issue=(failures,condition,message)=>{if(!condition)failures.push(message);return Boolean(condition);};
const REQUIRED=['id','slug','catalogueNumber','name','category','tag','mins','prep_mins','cook_mins','servings','baseServings','cost','cost_basis','image','tip','ingredients','method','steps','ingredient_display_lines','allergy_advice','allergen_screen_possible_unverified','culinary_prep_notes','culinary_data_version','culinary_profile','primaryProtein','cheeseHeavy','dinnerEligible','expansionGroup','fingerprint','coreIngredientKeys','flavorTokens','accessTier','reviewStatus','portion_status','cook_test_status','imageProvenance','ci_estimates','premium'];
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const strings=value=>Array.isArray(value)&&value.every(nonempty);
const NORMALIZED_UNITS=new Set(['g','ml','each','clove']);
const FRACTIONS={'¼':'1/4','½':'1/2','¾':'3/4','⅓':'1/3','⅔':'2/3','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8'};
const NUMBER='(?:\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?|\\d+\\/\\d+)';
function sourceNumber(value){
 let result=0;
 for(const part of value.trim().split(/\s+/)){const pair=part.split('/'),n=pair.length===2?Number(pair[0])/Number(pair[1]):Number(part);if(!positive(n))return null;result+=n;}
 return positive(result)?result:null;
}

/** Read an explicitly stated amount only. No density, pack-size or food-weight guesses. */
export function parseSourceQuantity(text,normalizedUnit){
 if(!nonempty(text)||!NORMALIZED_UNITS.has(normalizedUnit))return null;
 const source=text.replaceAll(',','').replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g,part=>' '+FRACTIONS[part]).replace(/[×]/g,'x').replace(/\s+/g,' ').trim();
 if(/(?:^|[\s,(])[-−]\s*\d|\d\s*(?:–|—|-|to)\s*\d/i.test(source))return null;
 const metric=new RegExp('('+NUMBER+')\\s*(kg|g|ml|l)\\b','gi');
 const matches=[...source.matchAll(metric)].map(match=>{
  const unit=match[2].toLowerCase(),multiplier=unit==='kg'||unit==='l'?1000:1;
  return {quantity:sourceNumber(match[1])*multiplier,unit:unit==='kg'?'g':unit==='l'?'ml':unit,index:match.index,end:match.index+match[0].length};
 });
 if(normalizedUnit==='g'||normalizedUnit==='ml'){
  const sameUnit=matches.filter(match=>match.unit===normalizedUnit&&positive(match.quantity));if(!sameUnit.length)return null;
  const perItem=sameUnit.filter(match=>/^\s*(?:(?:net\s+)?drained(?:\s+weight)?\s+)?(?:per\s+(?:tin|pack|piece|item)|each)\b/i.test(source.slice(match.end)));
  if(perItem.length){
   if(perItem.length!==1)return null;
   const count=new RegExp('^(?:about\\s+|approximately\\s+)?('+NUMBER+')\\s+(?!g\\b|kg\\b|ml\\b|l\\b)','i').exec(source);if(!count)return null;
   return {quantity:sourceNumber(count[1])*perItem[0].quantity,unit:normalizedUnit,basis:'EXPLICIT_COUNT_AND_SIZE'};
  }
  // An explicit drained or combined total takes precedence over the printed
  // size of a tin/pack. Ambiguous multiple weights must be clarified by author.
  const totals=sameUnit.filter(match=>/^(?:\s|[,():-])*(?:(?:in\s+)?total|combined|drained(?:\s+weight)?|net\s+drained)\b/i.test(source.slice(match.end))||/\b(?:drained\s+(?:weight|total)|total(?:\s+weight)?|combined(?:\s+weight)?)\s*[:=(]?\s*$/i.test(source.slice(0,match.index)));
  if(totals.length){if(new Set(totals.map(match=>match.quantity)).size!==1)return null;return {quantity:totals[0].quantity,unit:normalizedUnit,basis:'EXPLICIT_TOTAL'};}
  const multipack=new RegExp('('+NUMBER+')\\s*x\\s*('+NUMBER+')\\s*(kg|g|ml|l)\\b','i').exec(source);
  if(multipack){
   const unit=multipack[3].toLowerCase(),dimension=unit==='kg'?'g':unit==='l'?'ml':unit,multiplier=unit==='kg'||unit==='l'?1000:1;
   if(dimension!==normalizedUnit)return null;
   const quantity=sourceNumber(multipack[1])*sourceNumber(multipack[2])*multiplier;
   if(sameUnit.length!==1||!positive(quantity))return null;
   return {quantity,unit:normalizedUnit,basis:'EXPLICIT_MULTIPACK'};
  }
  if(sameUnit.length!==1)return null;
  return {quantity:sameUnit[0].quantity,unit:normalizedUnit,basis:'EXPLICIT_METRIC'};
 }
 const count=new RegExp('^(?:about\\s+|approximately\\s+)?('+NUMBER+')\\s+(.+)$','i').exec(source);if(!count)return null;
 const suffix=count[2].trim();
 if(/^(?:g|kg|ml|l|grams?|kilograms?|millilitres?|litres?|oz|lb|tsp|tbsp|cups?|tablespoons?|teaspoons?)\b/i.test(suffix))return null;
 if(normalizedUnit==='clove'&&!/\bcloves?\b/i.test(suffix))return null;
 if(/^x\b/i.test(suffix)){
  const packed=new RegExp('^x\\s*('+NUMBER+')\\s+(?!g\\b|kg\\b|ml\\b|l\\b)(.+)$','i').exec(suffix);if(!packed)return null;
  return {quantity:sourceNumber(count[1])*sourceNumber(packed[1]),unit:normalizedUnit,basis:'EXPLICIT_COUNT_MULTIPACK'};
 }
 return {quantity:sourceNumber(count[1]),unit:normalizedUnit,basis:'EXPLICIT_COUNT'};
}

export function noCookSafetyFailures(recipe){
 if(recipe?.cook_mins!==0)return [];
 const failures=[];
 for(const [index,row]of (Array.isArray(recipe.ingredients)?recipe.ingredients:[]).entries()){
  const name=String(row?.[0]||''),category=String(row?.[3]||'');
  const animal=/\b(?:chicken|poultry|turkey|duck|goose|beef|pork|lamb|veal|venison|mince|bacon|pancetta|gammon|ham|sausage|chorizo|salmon|cod|haddock|tuna|trout|prawns?|shrimp|mussels?|clams?|scallops?|squid|calamari|sea bass|fish|crab|lobster|oysters?|eggs?)\b/i.test(name)||/^(?:meat|fish|seafood)$/i.test(category);
  if(!animal)continue;
  const namedForm=name+' '+String(row?.[1]||'');
  const prep=typeof recipe.culinary_prep_notes?.[index]==='string'?recipe.culinary_prep_notes[index]:'';
  const form=namedForm+' '+prep;
  const explicitlyUnsafe=/\b(?:raw|uncooked|partly[- ]cooked|partially[- ]cooked)\b|\bnot\s+(?:fully[- ]cooked|cooked|ready[- ]to[- ]eat)/i.test(namedForm)||/\bnot\s+(?:fully[- ]cooked|cooked|ready[- ]to[- ]eat)/i.test(prep);
  const ready=/\b(?:fully[- ]cooked|cooked|hard[- ]boiled|ready[- ]to[- ]eat|tinned|canned)\b/i.test(form)||/\bsmoked\s+(?:salmon|trout|mackerel)\b/i.test(name);
  if(explicitlyUnsafe||!ready)failures.push(`${recipe.id}: no-cook animal ingredient needs an explicit safe ready-to-eat form: ${name}`);
 }
 return failures;
}

export function recipeChecks(recipe,normal,expected,{allowedFields,allowedCategories,allowNoCook=false,strictSourceBinding=false}={}){
 const failures=[],r=recipe||{},nr=normal||{},id=r.id||'unknown';
 for(const field of REQUIRED)issue(failures,Object.hasOwn(r,field),`${id}: missing ${field}`);
 if(allowedFields)for(const field of Object.keys(r))issue(failures,allowedFields.has(field),`${id}: field outside the existing recipe schema: ${field}`);
 issue(failures,r.id===expected.id&&r.slug===r.id&&r.catalogueNumber===expected.number,`${id}: approved pilot identity changed`);
 issue(failures,r.accessTier===expected.tier&&r.premium===(expected.tier==='premium'),`${id}: access tier mismatch`);
 issue(failures,r.dinnerEligible===expected.dinner,`${id}: dinner eligibility mismatch`);
 issue(failures,r.image===`release-assets/basketboss-v17/images/new/${r.id}.webp`,`${id}: image path does not follow the exact existing schema`);
 issue(failures,typeof r.name==='string'&&r.name.trim()&&typeof r.category==='string'&&r.category.trim()&&typeof r.tag==='string'&&r.tag.trim()&&positive(r.cost),`${id}: name, category, tag or cost is invalid`);
 issue(failures,Number.isInteger(r.servings)&&r.servings>=1&&r.servings<=12&&r.baseServings===r.servings,`${id}: invalid or mismatched portions`);
 issue(failures,positive(r.mins)&&positive(r.prep_mins)&&(positive(r.cook_mins)||(allowNoCook&&r.cook_mins===0))&&r.mins>=r.prep_mins+r.cook_mins,`${id}: elapsed time is below prep plus cook`);
 if(r.total_elapsed_mins!==undefined)issue(failures,r.total_elapsed_mins===r.mins,`${id}: total elapsed time drift`);
 issue(failures,Array.isArray(r.ingredients)&&r.ingredients.length>=3,`${id}: ingredient list is absent/too short`);
 issue(failures,Array.isArray(r.method)&&r.method.length>=3&&r.method.every(step=>typeof step==='string'&&step.trim().length>=15),`${id}: incomplete method`);
 issue(failures,same(r.method,r.steps),`${id}: Cook steps differ from authoritative method`);
 issue(failures,strings(r.culinary_prep_notes)&&r.culinary_prep_notes.length===r.ingredients?.length,`${id}: ingredient prep notes are not positional/nonempty`);
 issue(failures,Array.isArray(r.ingredient_display_lines)&&r.ingredient_display_lines.length===r.ingredients?.length,`${id}: display lines are not positional`);
 issue(failures,nr.id===r.id&&nr.name===r.name&&nr.servings===r.servings&&Array.isArray(nr.ingredients)&&nr.ingredients.length===r.ingredients?.length,`${id}: recipe/normalization pairing mismatch`);
 for(const [index,source]of (Array.isArray(r.ingredients)?r.ingredients:[]).entries()){
  issue(failures,Array.isArray(source)&&source.length===4&&typeof source[0]==='string'&&source[0].trim()&&typeof source[1]==='string'&&source[1].trim()&&typeof source[2]==='number'&&Number.isFinite(source[2])&&source[2]>=0&&typeof source[3]==='string',`${id}/${index}: source must be [name, quantity text, price, category]`);
  if(allowedCategories)issue(failures,allowedCategories.has(source?.[3]),`${id}/${index}: unknown ingredient category`);
  issue(failures,r.ingredient_display_lines?.[index]===`${source?.[0]} — ${source?.[1]}`,`${id}/${index}: display copy is stale`);
  const n=nr.ingredients?.[index];
  issue(failures,n&&n.name===source?.[0]&&n.recipe_id===r.id&&n.ingredient_index===index&&nonempty(n.key)&&positive(n.quantity)&&NORMALIZED_UNITS.has(n.unit)&&typeof n.price_hint==='number'&&Number.isFinite(n.price_hint)&&n.price_hint>=0,`${id}/${index}: invalid or misaligned normalized ingredient`);
  issue(failures,n?.price_hint===source?.[2],`${id}/${index}: normalized price hint differs from source ingredient`);
  if(strictSourceBinding){const stated=parseSourceQuantity(source?.[1],n?.unit);issue(failures,stated&&positive(stated.quantity)&&Math.abs(stated.quantity-n?.quantity)<=1e-7,`${id}/${index}: source amount and normalized amount differ or need explicit clarification`);}
 }
 issue(failures,typeof r.allergy_advice==='string'&&r.allergy_advice.length>=80&&strings(r.allergen_screen_possible_unverified),`${id}: allergy guidance missing`);
 issue(failures,r.cook_test_status==='Not kitchen-tested',`${id}: do not claim an unperformed kitchen test`);
 issue(failures,typeof r.cheeseHeavy==='boolean'&&nonempty(r.primaryProtein),`${id}: planning metadata incomplete`);
 issue(failures,r.fingerprint&&['primaryProtein','base','flavorProfile','cookingMethod','vessel'].every(key=>nonempty(r.fingerprint[key])),`${id}: culinary fingerprint incomplete`);
 issue(failures,strings(r.coreIngredientKeys)&&r.coreIngredientKeys.length>0&&strings(r.flavorTokens),`${id}: canonical/flavor metadata must contain nonempty strings`);
 for(const key of ['cost_basis','tip','culinary_data_version','culinary_profile','expansionGroup','reviewStatus','portion_status'])issue(failures,nonempty(r[key]),`${id}: missing/blank culinary metadata: ${key}`);
 if(strictSourceBinding&&allowNoCook)failures.push(...noCookSafetyFailures(r));
 issue(failures,r.imageProvenance?.type==='generated'&&r.imageProvenance.exportWidth===1448&&r.imageProvenance.exportHeight===1086&&r.imageProvenance.exportFormat==='webp',`${id}: image provenance/export mismatch`);
 if(!expected.dinner){
  // The original five-record pilot keeps its exact waffle check. A full
  // catalogue may explicitly identify other non-dinner meal roles.
  if(expected.kind===undefined)issue(failures,/\bbreakfast|\bbrunch/i.test([r.category,r.tag].join(' '))&&/waffle\s*iron/i.test((Array.isArray(r.method)?r.method:[]).join(' ')),`${id}: breakfast and waffle equipment must be explicit`);
  else {
   issue(failures,['breakfast','dessert','starter','side'].includes(expected.kind),`${id}: non-dinner role is invalid`);
   if(expected.kind==='breakfast')issue(failures,/\bbreakfast|\bbrunch/i.test([r.category,r.tag].join(' ')),`${id}: breakfast category must be explicit`);
   if(/waffle/i.test(r.name))issue(failures,/waffle\s*iron/i.test((Array.isArray(r.method)?r.method:[]).join(' ')),`${id}: waffle equipment must be explicit`);
  }
 }
 return failures;
}

export function briefChecks(recipe,brief,{strictLedger=false}={}){
 const failures=[],r=recipe,b=brief||{},id=r.id;
 issue(failures,b.id===id&&b.catalogueNumber===r.catalogueNumber&&b.image===r.image,`${id}: image brief identity mismatch`);
 issue(failures,b.width===1448&&b.height===1086&&b.format==='webp',`${id}: image brief export format mismatch`);
 issue(failures,typeof b.vessel==='string'&&b.vessel,`${id}: image vessel absent`);
 const prompt=String(b.prompt||[b.houseComposition,b.cameraPrompt].filter(Boolean).join(' ')),negatives=prompt+' '+(b.negativeConstraints||[]).join(' ');
 issue(failures,prompt.length>=200&&/natural daylight/i.test(prompt)&&/50mm/i.test(prompt),`${id}: house photography brief is incomplete`);
 issue(failures,/no hands/i.test(negatives)&&/no (?:text|watermark)/i.test(negatives)&&/CGI/i.test(negatives),`${id}: image negative constraints incomplete`);
 const ledger=b.exactIngredientLedger||b.ingredientSpecification||'';
 issue(failures,typeof ledger==='string'&&r.ingredients.every(([name])=>fold(ledger).includes(fold(name))),`${id}: image ledger must cover every source ingredient`);
 if(strictLedger)issue(failures,ledger===r.ingredients.map(row=>row[0]+' — '+row[1]).join('; '),`${id}: image ledger quantities differ from the exact source`);
 issue(failures,same(b.recipeMethod,r.method),`${id}: image brief method is stale`);
 return failures;
}

function sourceFunction(html,name){
 const from=html.indexOf('function '+name+'(');if(from<0)throw Error('Actual app helper missing: '+name);
 const firstEnd=html.indexOf('\n',from);if(html.slice(from,firstEnd).endsWith('}'))return html.slice(from,firstEnd);
 const end=html.indexOf('\n}',from);if(end<0)throw Error('Cannot locate real app helper end: '+name);return html.slice(from,end+2);
}
export function runtime(root,normalized,recipes,packs,market){
 const contents=file=>fs.readFileSync(path.join(root,file),'utf8');let writes=0;
 const context=vm.createContext({bb307Market:market,bb307ActiveRetailer:()=>null,BB307_NORMALIZED:structuredClone(normalized),bbFeedingForRecipe:r=>r.baseServings||r.servings||4,localStorage:{getItem:()=>null,setItem:()=>{writes++;throw Error('Validation attempted a storage mutation');}}});
 context.window=context;context.getRecipe=id=>recipes.find(recipe=>recipe.id===id);
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js','bb-serving-scale.js','bb-pantry-policy.js','bb-recipe-canonical.js','bb-pantry-deduction.js','bb-recipe-planning.js'])vm.runInContext(contents(file),context,{filename:file});
 for(const [key,value]of Object.entries(packs))context.BBPriceV19.catalog[key]=structuredClone(value);
 context.BB307Pantry={pantryName:name=>context.BBPantryPolicy.canonicalName(name,context.BBPriceV19.canonical),pantryId:(name,unit)=>context.BBPantryPolicy.canonicalName(name,context.BBPriceV19.canonical)+'|'+unit};
 context.bbHomeMeasuredTracking=name=>({name,trackingMode:'measured',measurementReviewed:true,unit:'g'});
 const html=contents('app.html');
 for(const [start,end]of [['function bb307MealEstimate(','function bb307SwitchIsland('],['function bbRecipeMealEstimate(','window.BasketBossMealEstimate=']]){
  const from=html.indexOf(start),to=html.indexOf(end,from);if(from<0||to<from)throw Error('Actual app pricing adapter missing');vm.runInContext(html.slice(from,to),context);
 }
 vm.runInContext(sourceFunction(html,'bbHomeRecipeIngredients'),context);
 return {context,writes:()=>writes};
}

export async function validatePilot({root=DEFAULT_ROOT,recipesFile=path.join(DEFAULT_STAGE,'pilot.recipes.json'),normalizedFile=path.join(DEFAULT_STAGE,'pilot.normalized.json'),briefsFile=path.join(DEFAULT_STAGE,'pilot.image-briefs.json'),packAdditionsFile=null,imageRoot=root,reviewFile=null,planningRolesFile=null,contentOnly=false}={}){
 const legacySource=json(PRIVATE),privateRows=legacySource.rows,baseRecipes=[...json(path.join(root,'recipes.json')),...privateRows.map(row=>JSON.parse(row.recipe_json))];
 const sourceBytes={recipes:fs.readFileSync(recipesFile),normalized:fs.readFileSync(normalizedFile),imageBriefs:fs.readFileSync(briefsFile)};
 if(planningRolesFile)sourceBytes.planningRoles=fs.readFileSync(planningRolesFile);
 const sourceHashes=Object.fromEntries(Object.entries(sourceBytes).map(([key,value])=>[key,hash(value)]));
 const recipes=rows(JSON.parse(sourceBytes.recipes)),normalized=rows(JSON.parse(sourceBytes.normalized)),briefs=rows(JSON.parse(sourceBytes.imageBriefs)),packFile=packAdditionsFile?json(packAdditionsFile):{},packs=packFile.ingredients||packFile;
 const inputDigest=hash(JSON.stringify({recipes,normalized,briefs})),failures=[],warnings=[],check=(condition,message)=>issue(failures,condition,message);
 const planningRoles=planningRolesFile?JSON.parse(sourceBytes.planningRoles):null,planning={policy:planningRoles?'staged-catalogue-700':'legacy-catalogue-500',wiredIntoClient:false,activationEligible:false,legacyComparisons:0,pilotComparisons:0,legacyIncompatibilities:[]};
 if(planningRoles){
  check(planningRoles.schemaVersion===1&&planningRoles.catalogueVersion===700&&planningRoles.legacyCatalogueVersion===500&&planningRoles.activationEligible===false&&planningRoles.mode==='five-recipe-pilot','Planning role manifest is not explicitly non-activating catalogue-700 pilot data');
  check(same(planningRoles.legacyRecipeIds,baseRecipes.map(row=>row.id)),'Planning role manifest must bind the exact existing 500 IDs');
  check(Array.isArray(planningRoles.recipes)&&planningRoles.recipes.length===PILOT.length&&PILOT.every(expected=>planningRoles.recipes.filter(role=>role.id===expected.id&&role.catalogueNumber===expected.number&&role.kind===(expected.dinner?'dinner':'breakfast')).length===1),'Planning role manifest differs from the five approved recipe roles');
  warnings.push('The catalogue-700 dinner policy is staged only. A future versioned client must wire it deliberately before release; catalogue-500 planning remains unchanged.');
 }
 check(hash(JSON.stringify(privateRows))===PRIVATE_HASH,'Protected private 400-row snapshot hash changed');
 check(baseRecipes.length===500&&new Set(baseRecipes.map(r=>r.id)).size===500,'Protected baseline must contain exactly 500 unique recipes');
 check(Array.isArray(recipes)&&recipes.length===5&&Array.isArray(normalized)&&normalized.length===5&&Array.isArray(briefs)&&briefs.length===5,'This pilot is exactly five paired recipes, not a partial release');
 const allowedFields=new Set(baseRecipes.flatMap(Object.keys)),allowedCategories=new Set(baseRecipes.flatMap(recipe=>recipe.ingredients.map(row=>row[3]))),normalMap=new Map(normalized.map(row=>[row.id,row])),briefMap=new Map(briefs.map(row=>[row.id,row]));
 check(normalMap.size===5&&briefMap.size===5,'Duplicate normalized/brief ID');
 const baselineIds=new Set(baseRecipes.map(r=>r.id)),baselineTitles=new Set(baseRecipes.map(r=>fold(r.name))),ids=new Set(),titles=new Set();
 for(const r of recipes){
  const expected=PILOT.find(value=>value.id===r.id);if(!check(Boolean(expected),'Unapproved pilot ID: '+r.id))continue;
  failures.push(...recipeChecks(r,normalMap.get(r.id),expected,{allowedFields,allowedCategories}),...briefChecks(r,briefMap.get(r.id)));
  check(!baselineIds.has(r.id)&&!ids.has(r.id),'Duplicate recipe ID: '+r.id);ids.add(r.id);
  check(!baselineTitles.has(fold(r.name))&&!titles.has(fold(r.name)),'Duplicate recipe title/concept title: '+r.name);titles.add(fold(r.name));
 }
 for(const expected of PILOT)check(ids.has(expected.id),'Missing approved pilot recipe: '+expected.id);
 const {compareRecipes,webpDimensions}=await import(pathToFileURL(path.join(root,'scripts/verify-recipe-expansion.mjs')).href);
 const similarityCandidates=compareRecipes(recipes,baseRecipes);
 // The legacy heuristic treats different batter techniques as the same food.
 // Report its candidates for explicit culinary review; never silently discard.
 if(similarityCandidates.length)warnings.push('Legacy similarity candidates require culinary review; shared ingredients alone are not proof of a repeat.');
 const protectedFiles={};for(const file of ['recipes.json','normalized-ingredient-database.json','ingredient-pack-catalog.json','dessert_recipes.json']){
  const old=execFileSync('git',['show',BASE+':'+file],{cwd:root,maxBuffer:8*1024*1024}),current=fs.readFileSync(path.join(root,file));protectedFiles[file]={unchanged:old.equals(current),sha256:hash(current)};check(old.equals(current),'Protected baseline data changed: '+file);
 }
 for(const [key,value]of Object.entries(packs))check(value&&typeof value.ingredient==='string'&&key===value.ingredient+'|'+value.unit&&positive(value.standard_pack_size)&&value.standard_pack_unit===value.unit&&positive(value.uk_pack_price)&&value.needs_review===true&&/unverified|illustrative|indicative/i.test(JSON.stringify(value)),'New staged pack requires exact units and honest unverified evidence: '+key);
 const prices=[],pantry=[],coverage=[],imageChecks=[],canonicalBefore=runtime(root,normalized,recipes,{},'UK').context.BBPriceV19;
 const normalizedBefore=hash(JSON.stringify(normalized));
 const baselineBefore=hash(JSON.stringify(baseRecipes));
 const legacyIsDinner=runtime(root,normalized,recipes,{},'UK').context.BBRecipePlanning.isDinner;
 for(const recipe of baseRecipes)for(const catalogueVersion of [500,700]){
  check(isCatalogueDinner(recipe,{catalogueVersion,roles:planningRoles,legacyIsDinner})===legacyIsDinner(recipe),'Protected legacy dinner eligibility changed: '+recipe.id+'/'+catalogueVersion);planning.legacyComparisons++;
 }
 check(hash(JSON.stringify(baseRecipes))===baselineBefore,'Planning policy mutated protected recipe inputs');
 for(const recipe of recipes){const expected=PILOT.find(value=>value.id===recipe.id);if(expected&&legacyIsDinner(recipe)!==expected.dinner)planning.legacyIncompatibilities.push({id:recipe.id,legacyDinnerEligible:legacyIsDinner(recipe),approvedDinnerEligible:expected.dinner});}
 if(planningRoles&&planning.legacyIncompatibilities.length)warnings.push('The legacy client excludes savoury duck pancakes by title. Its behavior is preserved; the staged catalogue-700 policy handles the explicitly reviewed new dinner role only after future client integration.');
 for(const recipe of recipes){
  const norm=normalMap.get(recipe.id);if(!norm?.ingredients)continue;
  for(const ingredient of norm.ingredients){const amount=canonicalBefore.normalizeUnit(ingredient.key,ingredient.quantity,ingredient.unit),key=canonicalBefore.canonical(ingredient.key)+'|'+amount?.unit;check(ingredient.key===canonicalBefore.canonical(ingredient.key)&&ingredient.key===canonicalBefore.canonical(ingredient.name),'Noncanonical normalized pantry key: '+recipe.id+'/'+ingredient.key);coverage.push({recipeId:recipe.id,key,productionExactPack:!!canonicalBefore.catalog[key],stagedExactPack:!!packs[key]});check(!!canonicalBefore.catalog[key]||!!packs[key],'No exact production or staged pack: '+recipe.id+'/'+key);}
 }
 for(const market of MARKETS){
  const h=runtime(root,normalized,recipes,packs,market),api=h.context.BBPriceV19;
  for(const recipe of recipes){
   const norm=normalMap.get(recipe.id);if(!norm)continue;
   const expected=PILOT.find(value=>value.id===recipe.id);if(expected){check((planningRoles?isCatalogueDinner(recipe,{catalogueVersion:700,roles:planningRoles,legacyIsDinner:h.context.BBRecipePlanning.isDinner}):h.context.BBRecipePlanning.isDinner(recipe))===expected.dinner,'Actual or explicitly staged dinner Auto-Fill eligibility mismatch: '+recipe.id);planning.pilotComparisons++;}
   for(const factor of [.5,1,2])for(const adapter of ['bb307MealEstimate','bbRecipeMealEstimate']){
    const estimate=h.context[adapter](recipe,recipe.servings*factor);prices.push({id:recipe.id,market,factor,adapter,amount:estimate.amount,pending:estimate.pending});check(estimate.pending===0&&positive(estimate.amount),`Unresolved actual app estimate ${recipe.id}/${market}/${factor}/${adapter}`);
    if(factor===1){const stored=recipe.ci_estimates?.[market];check(stored&&stored.currency===(market==='US'?'USD':'GBP')&&stored.confidence==='INDICATIVE_UNVERIFIED'&&Math.abs(stored.estimate-estimate.amount)<.005,`Stored regional estimate drift: ${recipe.id}/${market}`);if(market==='UK')check(Math.abs(recipe.cost-estimate.amount)<.005,'Stored UK cost differs from actual app quote: '+recipe.id);}
   }
   if(market==='UK')for(const factor of [.5,1,2]){
    const reqs=h.context.bbHomeRecipeIngredients(recipe.id,factor),id=h.context.BB307Pantry.pantryId,stock={};
    for(const row of reqs){check(positive(row.required)&&typeof row.unit==='string',`Unknown actual pantry quantity: ${recipe.id}/${row.name}`);if(positive(row.required)){const key=id(row.key,row.unit);stock[key]=(stock[key]||0)+2*row.required;}}
    const original=JSON.stringify(stock),result=h.context.BBPantryDeduction.proposal({stock,ingredients:reqs,id,conversion:{pantryMode:true,market:'UK',measuredFoods:reqs.map(row=>row.name),measuredStockKeys:Object.keys(stock),foods:{},stock:{},basis:{wholeProduce:false,spoons:false}}});
    check(JSON.stringify(stock)===original,'Pantry validation mutated source stock: '+recipe.id);
    check(result.issues.length===0,'Actual measured pantry match requires review: '+recipe.id+'/'+factor);
    for(const row of result.rows)check(Math.abs(row.deduct-row.required)<.000001,'Actual pantry deduction shortfall: '+recipe.id+'/'+row.name);
    pantry.push({id:recipe.id,factor,rows:result.rows.length,issues:result.issues.length,readOnly:JSON.stringify(stock)===original});
   }
  }
  check(h.writes()===0,'Runtime audit wrote client storage');
 }
 const review=reviewFile&&fs.existsSync(reviewFile)?json(reviewFile):null,reviewMap=new Map((review?.images||[]).map(row=>[row.id,row])),seenHashes=new Map();
 const baselineImageHashes=new Set(baseRecipes.map(recipe=>{const file=path.resolve(root,recipe.image);return fs.existsSync(file)?hash(fs.readFileSync(file)):null;}).filter(Boolean));
 if(contentOnly)warnings.push('Images are not validated in content-only mode. This is never release approval.');
 else for(const recipe of recipes){
  const file=path.resolve(imageRoot,recipe.image),safe=file.startsWith(path.resolve(imageRoot)+path.sep);if(!check(safe&&fs.existsSync(file),'Image absent or escaping asset root: '+recipe.id))continue;
  try{const bytes=fs.readFileSync(file),dims=webpDimensions(bytes),sha256=hash(bytes),natural=reviewMap.get(recipe.id);check(dims.width===1448&&dims.height===1086,'Image dimensions wrong: '+recipe.id);check(!seenHashes.has(sha256)&&!baselineImageHashes.has(sha256),'Image hash duplicates another recipe: '+recipe.id);seenHashes.set(sha256,recipe.id);const approved=review?.schemaVersion===1&&natural?.image===recipe.image&&natural?.sha256===sha256&&natural?.naturalnessReview==='passed'&&Number.isFinite(Date.parse(natural?.reviewedAt));check(approved,'Image naturalness review missing/pending/stale: '+recipe.id);imageChecks.push({id:recipe.id,...dims,sha256,naturalnessReview:approved?'passed':'pending'});}catch(error){failures.push('Invalid WebP '+recipe.id+': '+error.message);}
 }
 check(inputDigest===hash(JSON.stringify({recipes,normalized,briefs}))&&normalizedBefore===hash(JSON.stringify(normalized)),'Validation mutated recipe/normalized inputs');
 for(const [key,file]of Object.entries({recipes:recipesFile,normalized:normalizedFile,imageBriefs:briefsFile,...(planningRolesFile?{planningRoles:planningRolesFile}:{})}))check(hash(fs.readFileSync(file))===sourceHashes[key],'Staging source changed during validation: '+key);
 return {schemaVersion:1,catalogueVersion:700,mode:'five-recipe-pilot',status:failures.length?'failed':contentOnly?'pilot-content-checks-passed':'pilot-automated-checks-passed',activationEligible:false,counts:{protectedProduction:500,stagedPilot:recipes.length,previewCombined:500+recipes.length,releaseTarget:700,missingReleaseRecipes:200-recipes.length},tierCounts:{free:recipes.filter(r=>r.accessTier==='free').length,premium:recipes.filter(r=>r.accessTier==='premium').length},protectedFiles,protectedPrivateRowsSha256:hash(JSON.stringify(privateRows)),sourceHashes,productionPackGaps:coverage.filter(row=>!row.productionExactPack),stagedPackOverlay:!!Object.keys(packs).length,coverage,prices,pantry,similarityCandidates,images:imageChecks,planning,warnings,failures};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),option=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
 const stage=option('--staging-dir',DEFAULT_STAGE),report=await validatePilot({root:option('--root',DEFAULT_ROOT),recipesFile:option('--recipes',path.join(stage,'pilot.recipes.json')),normalizedFile:option('--normalized',path.join(stage,'pilot.normalized.json')),briefsFile:option('--image-briefs',path.join(stage,'pilot.image-briefs.json')),packAdditionsFile:option('--pack-additions',null),imageRoot:option('--image-root',DEFAULT_ROOT),reviewFile:option('--naturalness-review',null),planningRolesFile:option('--planning-roles',null),contentOnly:args.includes('--content-only')});
 const out=option('--out',path.join(DEFAULT_STAGE,'validation.json'));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({out,status:report.status,activationEligible:report.activationEligible,counts:report.counts,prices:report.prices.length,pantry:report.pantry.length,images:report.images.length,packGaps:report.productionPackGaps,similarityCandidates:report.similarityCandidates,failures:report.failures},null,2));if(report.failures.length)process.exitCode=1;
}
