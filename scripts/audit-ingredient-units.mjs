#!/usr/bin/env node
// Read-only catalogue audit. Never edits recipes, normalized data, stock or D1.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readPrivateRecipeExport} from './load-private-recipe-audit.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LEGACY='9458903c4ba06fc54a558fbe05886bfa5326ab98';
const plural=Object.freeze({carrots:'carrot',potatoes:'potato',onions:'onion',peppers:'pepper',tomatoes:'tomato',courgettes:'courgette',aubergines:'aubergine',cucumbers:'cucumber',avocados:'avocado',leeks:'leek',lemons:'lemon',limes:'lime',eggs:'egg',apples:'apple',bananas:'banana',mushrooms:'mushroom',chillies:'chilli'});
const plain=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function auditPricing(root=ROOT){
 const context=vm.createContext({Intl});
 for(const name of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{timeout:2000});
 return context.BBPriceV19;
}
// Conservative audit grouping: only exact plural spelling is unified. Raw,
// cooked, frozen, dried, canned, colour and variety words remain part of the key.
function identity(name,canonical){
 const words=canonical(name).normalize('NFKC').split(' ');const last=words.at(-1);words[words.length-1]=plural[last]||last;return words.join(' ');
}
export function auditCatalogue(name,recipes,normalized,p,{privateData=false}={}){
 const normalizedRows=Array.isArray(normalized)?normalized:normalized.recipes;
 const byId=new Map(normalizedRows.map(recipe=>[recipe.id,recipe]));
 const groups=new Map(),units=new Map(),statuses=new Map(),invalid=[],sourceUnitMismatches=[],withinRecipeDuplicates=[],sourceIdentityMismatches=[],identityMismatchGroups=new Map();
 let lines=0;
 for(const recipe of recipes){
  const normalizedRecipe=byId.get(recipe.id);if(!normalizedRecipe||recipe.ingredients.length!==normalizedRecipe.ingredients.length)throw Error('ingredient_audit_alignment');
  const selected=new Map();
  for(const [index,row]of normalizedRecipe.ingredients.entries()){
   lines++;const source=recipe.ingredients[index],sourceName=source[0],sourceAmount=source[1];
   const key=identity(row.key||row.name||sourceName,p.canonical),sourceKey=identity(sourceName,p.canonical),unit=String(row.unit??'unknown').trim().toLowerCase();
   const entry={recipeId:recipe.id,name:sourceName,amount:sourceAmount,quantity:row.quantity,unit,status:row.status||null};
   if(sourceKey!==key){sourceIdentityMismatches.push({...entry,sourceKey,normalizedKey:key});const pair=sourceKey+'|'+key,previous=identityMismatchGroups.get(pair);if(previous)previous.occurrences++;else identityMismatchGroups.set(pair,{sourceKey,normalizedKey:key,occurrences:1});}
   units.set(unit,(units.get(unit)||0)+1);statuses.set(row.status||'unspecified',(statuses.get(row.status||'unspecified')||0)+1);
   if(!Number.isFinite(row.quantity)||row.quantity<=0||!unit)invalid.push(entry);
   if(!groups.has(key))groups.set(key,{key,names:new Set(),units:new Set(),occurrences:0,examples:[],produce:p.category(key)==='Produce'});
   const group=groups.get(key);group.names.add(sourceName);group.units.add(unit);group.occurrences++;if(group.examples.length<8)group.examples.push(entry);
   if(!selected.has(key))selected.set(key,[]);selected.get(key).push(entry);
   const explicit=String(sourceAmount).match(/\b(cloves?|bulbs?|heads?|bunches|bunch|packs?|tins?|cans?|bags?|slices?|sprigs?)\b/gi)||[];
   const sourceUnits=new Set(explicit.map(value=>({cloves:'clove',bulbs:'bulb',heads:'head',bunches:'bunch',packs:'pack',tins:'tin',cans:'can',bags:'bag',slices:'slice',sprigs:'sprig'})[value.toLowerCase()]||value.toLowerCase()));
   if(unit==='each'&&sourceUnits.size===1)sourceUnitMismatches.push({...entry,explicitSourceUnit:[...sourceUnits][0]});
  }
  for(const [key,entries]of selected)if(entries.length>1)withinRecipeDuplicates.push({recipeId:recipe.id,key,entries});
 }
 const compact=group=>({key:group.key,names:[...group.names].sort(),units:[...group.units].sort(),occurrences:group.occurrences,produce:group.produce,...(!privateData?{examples:group.examples}:{})});
 const mixedUnits=[...groups.values()].filter(group=>group.units.size>1).sort((a,b)=>b.occurrences-a.occurrences).map(compact);
 const namingVariants=[...groups.values()].filter(group=>group.names.size>1).sort((a,b)=>b.occurrences-a.occurrences).map(compact);
 return {name,recipes:recipes.length,ingredientLines:lines,unitCounts:Object.fromEntries([...units].sort()),statusCounts:Object.fromEntries([...statuses].sort()),canonicalGroups:groups.size,mixedUnitGroups:mixedUnits.length,mixedProduceGroups:mixedUnits.filter(group=>group.produce).length,namingVariantGroups:namingVariants.length,invalidQuantityLines:invalid.length,explicitSourceEachMismatches:sourceUnitMismatches.length,duplicateRecipeGroups:withinRecipeDuplicates.length,sourceIdentityMismatchLines:sourceIdentityMismatches.length,identityMismatchGroups:[...identityMismatchGroups.values()],mixedUnits,namingVariants,...(!privateData?{invalid,sourceUnitMismatches,withinRecipeDuplicates,sourceIdentityMismatches}:{})};
}
export function auditIngredientUnits({root=ROOT,privateSnapshot}={}){
 const p=auditPricing(root),free=json(path.join(root,'recipes.json')),normalized=json(path.join(root,'normalized-ingredient-database.json'));
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),context=vm.createContext({});
 for(const name of ['RECIPES','BB307_NORMALIZED']){
  const declaration=html.match(new RegExp('^const '+name+'=.*;$','m'));if(!declaration)throw Error('ingredient_audit_inline_missing');
  vm.runInContext(declaration[0],context,{timeout:2000});
 }
 const inlineRecipes=plain(vm.runInContext('RECIPES',context)),inlineNormalized=plain(vm.runInContext('BB307_NORMALIZED',context));
 const fromGit=name=>JSON.parse(execFileSync('git',['show',LEGACY+':'+name],{cwd:root,maxBuffer:12*1024*1024,encoding:'utf8'}));
 const reports=[auditCatalogue('public-free-100',free,normalized,p),auditCatalogue('inline-free-100',inlineRecipes,inlineNormalized,p),auditCatalogue('historical-legacy-321',fromGit('recipes.json'),fromGit('normalized-ingredient-database.json'),p)];
 let privateStatus='not_available';
 if(privateSnapshot){const data=readPrivateRecipeExport(privateSnapshot,{publicRoot:root});reports.push(auditCatalogue('current-private-premium-400',data.recipes,data.normalized,p,{privateData:true}));privateStatus='validated_snapshot';}
 return {schemaVersion:1,readOnly:true,grouping:'pricing canonical identity plus conservative final-word plural aliases; no count/weight conversions',pricingSourceSha256:hash(fs.readFileSync(path.join(root,'basketboss-pricing-v19.js'))),legacySourceCommit:LEGACY,privateStatus,current500FullyAudited:privateStatus==='validated_snapshot',cataloguesOverlap:true,reports};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const at=process.argv.indexOf('--private-snapshot');
 try{const result=auditIngredientUnits({privateSnapshot:at>=0?process.argv[at+1]:undefined});console.log(JSON.stringify(result,null,2));}
 catch(error){console.error(/^ingredient_audit_/.test(error?.message||'')?error.message:'ingredient_audit_unavailable');process.exitCode=1;}
}
