#!/usr/bin/env node
// Read-only ingredient/preset/classification audit. Never changes catalogue,
// inventory or generated assets. Private inputs are explicit local paths; only
// aggregate counts are printed, never a private recipe or ingredient payload.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {inlineArray} from '../tools/catalogue700/build-client.mjs';
import {FOOD_PREVIEWS,HOUSEHOLD_PREVIEWS,isHousehold} from '../bb-kitchen-choice-rules.mjs';
import {classifyReceiptLine} from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),aliases=require('../bb-household-aliases.js');
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2),privatePaths=[];
let output='/tmp/bb-household-alias-catalogue-audit.json';
for(let index=0;index<args.length;index++){
 if(args[index]==='--catalogue'&&args[index+1])privatePaths.push(path.resolve(args[++index]));
 else if(args[index]==='--output'&&args[index+1])output=path.resolve(args[++index]);
 else throw Error('Usage: node scripts/audit-household-aliases.mjs [--catalogue PRIVATE_JSON] [--output REPORT_JSON]');
}
if(privatePaths.length&&(output===root||output.startsWith(root+path.sep)))throw Error('A report including private inputs must stay outside the public repository.');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const observations=[],sources=[],recipeIds=new Set(),privateIds=new Set();
function collect(value,file,{privateInput=false,kind='json'}={}){
 const rows=[],ids=new Set();
 const add=name=>{if(typeof name==='string'&&name.trim())rows.push(name);};
 function visit(item){
  if(Array.isArray(item)){for(const row of item)visit(row);return;}
  if(!item||typeof item!=='object')return;
  if(typeof item.recipe_json==='string'){visit(JSON.parse(item.recipe_json));if(typeof item.normalized_json==='string')visit(JSON.parse(item.normalized_json));return;}
  if(Array.isArray(item.ingredients)){
   if(typeof item.id==='string'){ids.add(item.id);recipeIds.add(item.id);if(privateInput)privateIds.add(item.id);}
   for(const ingredient of item.ingredients){if(Array.isArray(ingredient))add(ingredient[0]);else if(ingredient&&typeof ingredient==='object'){add(ingredient.name||ingredient.key);if(ingredient.key&&ingredient.key!==ingredient.name)add(ingredient.key);}}
   return;
  }
  if(item.ingredients&&typeof item.ingredients==='object'){
   for(const [key,row]of Object.entries(item.ingredients))add(row?.ingredient||key.slice(0,key.lastIndexOf('|')));
  }
  for(const key of ['recipes','catalogue','normalized','free','freeNormalized','rows','premiumRows'])if(item[key])visit(item[key]);
 }
 visit(value);observations.push(...rows);
 const audit=aliases.audit(rows);
 sources.push({file,kind,privateInput,recipes:ids.size,names:rows.length,uniqueNames:new Set(rows.map(name=>name.toLowerCase())).size,recognized:audit.recognized,renamed:audit.renamed});
}
const knownNames=new Set(['recipes.json','dessert_recipes.json','normalized-ingredient-database.json','ingredient-pack-catalog.json','free.recipes.json','free.normalized.json','pack-additions.json']);
const skipped=new Set(['node_modules','.git','.wrangler','dist','ios','release-assets','docs','tests','functions','bb-server-lib','tools','scripts']);
function walk(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isSymbolicLink()?[]:entry.isDirectory()?skipped.has(entry.name)||entry.name.startsWith('.')?[]:walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const files=walk(root);
for(const file of files.filter(file=>knownNames.has(path.basename(file))).sort())collect(JSON.parse(fs.readFileSync(file,'utf8')),path.relative(root,file));
for(const file of [...new Set(privatePaths)].sort())collect(JSON.parse(fs.readFileSync(file,'utf8')),file,{privateInput:true,kind:'explicit-private-catalogue'});
const app=fs.readFileSync(path.join(root,'app.html'),'utf8');
for(const name of ['RECIPES','BB307_NORMALIZED'])collect(inlineArray(app,name).value,'app.html#'+name,{kind:'inline-public-catalogue'});
function literalArray(source,name){const start=source.indexOf('const '+name+'=');if(start<0)return [];const at=source.indexOf('[',start),end=source.indexOf('\n];',at);if(end<0)throw Error('Preset literal closing marker missing: '+name);return vm.runInNewContext('('+source.slice(at,end+2)+')',Object.create(null),{timeout:100});}
function presets(names,file){const valid=names.filter(name=>typeof name==='string'&&name.trim());observations.push(...valid);const audit=aliases.audit(valid);sources.push({file,kind:'inventory-presets',privateInput:false,recipes:0,names:valid.length,uniqueNames:new Set(valid).size,recognized:audit.recognized,renamed:audit.renamed});}
presets(Object.values(FOOD_PREVIEWS).flat(),'bb-kitchen-choice-rules.mjs#FOOD_PREVIEWS');
presets(HOUSEHOLD_PREVIEWS.map(row=>row.name),'bb-kitchen-choice-rules.mjs#HOUSEHOLD_PREVIEWS');
presets(literalArray(app,'BB172_FRIDGE_PRESETS').flatMap(row=>[row[1],row[2]]),'app.html#BB172_FRIDGE_PRESETS');
presets(literalArray(app,'BB172_STAPLES').map(row=>String(row[1]||'').replace(/^[^\p{L}]+/u,'')),'app.html#BB172_STAPLES');
const inventory=fs.readFileSync(path.join(root,'shopping-inventory.js'),'utf8'),items=inventory.match(/\bconst ITEMS=(\[[^\n]*\]);/);
if(!items)throw Error('Shopping inventory preset literal missing.');
presets(vm.runInNewContext('('+items[1]+')',Object.create(null),{timeout:100}).map(row=>row[1]),'shopping-inventory.js#ITEMS');
const unique=[...new Set(observations.map(name=>name.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()))].sort(),report=aliases.audit(unique),classificationChanges=[],classificationCollisions=[];
for(const name of unique){
 const target=aliases.canonicalName(name),before=classifyReceiptLine({description:name}),after=classifyReceiptLine({description:target});
 const priorHousehold=isHousehold(name),nextHousehold=isHousehold(target);
 if(before.classification!==after.classification)classificationChanges.push({name,target,before:before.classification,after:after.classification});
 if(priorHousehold!==nextHousehold||before.classification==='essential'&&after.classification!=='essential'||before.classification!=='essential'&&after.classification==='essential')classificationCollisions.push({name,target,before:before.classification,after:after.classification});
}
const protectedPairs=[['sausages','beef sausages'],['sausages','chicken sausages'],['sausages','vegan sausages'],['sausages','vegetarian sausages'],['sausages','cooked sausages'],['sausages','frozen sausages'],['mince','pork mince'],['mince','chicken mince'],['mince','lamb mince'],['mince','turkey mince'],['bacon','streaky bacon'],['bacon','chorizo'],['peppers','ground black pepper'],['peppers','pepper'],['onions','red onions'],['onions','spring onions'],['potatoes','sweet potatoes'],['tomatoes','cherry tomatoes'],['tomatoes','tinned tomatoes'],['milk','whole milk'],['milk','skimmed milk'],['milk','oat milk'],['milk','coconut milk'],['butter','unsalted butter'],['butter','peanut butter'],['cheddar','mozzarella'],['rice','basmati rice'],['rice','brown rice'],['rice','cooked rice'],['garlic','minced garlic'],['garlic','garlic powder'],['garlic','garlic bulb'],['vegetable oil','olive oil']];
const protectedCollisions=protectedPairs.filter(([left,right])=>aliases.canonicalName(left)===aliases.canonicalName(right)).map(([left,right])=>({left,right,target:aliases.canonicalName(left)}));
const integrationFiles=files.filter(file=>/\.(?:m?js|html)$/.test(file)&&!file.includes(path.sep+'pwa700'+path.sep));
const integration=integrationFiles.map(file=>{const text=fs.readFileSync(file,'utf8');return {file:path.relative(root,file),aliasAware:text.includes('BBPantryAliasCanonical')||text.includes('BBHouseholdAliases'),legacyCanonicalReferences:(text.match(/BBPriceV19\??\.canonical\b/g)||[]).length};}).filter(row=>row.aliasAware||row.legacyCanonicalReferences);
const roles=JSON.parse(fs.readFileSync(path.join(root,'catalogues/700/release/planning-roles.json'),'utf8'));
const expectedIds=new Set([...roles.legacyRecipeIds,...roles.recipes.map(row=>row.id)]),missingIds=[...expectedIds].filter(id=>!recipeIds.has(id)),unexpectedIds=[...recipeIds].filter(id=>!expectedIds.has(id));
const result={schemaVersion:1,generatedAt:new Date().toISOString(),moduleSha256:sha(fs.readFileSync(path.join(root,'bb-household-aliases.js'))),readOnly:true,productionFetched:false,
 coverage:{sourceFiles:sources.length,jsonCatalogues:sources.filter(row=>row.kind.includes('json')||row.privateInput).length,privateInputFiles:privatePaths.length,uniqueRecipeIds:recipeIds.size,privateRecipeIds:privateIds.size,expectedRecipeIds:expectedIds.size,missingRecipeIds:missingIds.length,unexpectedRecipeIds:unexpectedIds.length,completeCatalogue:missingIds.length===0&&unexpectedIds.length===0,nameObservations:observations.length,uniqueNames:unique.length,groups:aliases.groups.length},
 sources,aliases:report,classification:{checked:unique.length,changes:classificationChanges,householdCollisions:classificationCollisions},protection:{checkedPairs:protectedPairs.length,collisions:protectedCollisions},integration,
 limitations:['No catalogue, classifier, preset, stored inventory or existing matcher was changed by this audit.','Aliases apply only to explicitly declared complete names; unmapped culinary descriptors remain available for separate review.','Private recipe objects are counted but are never emitted.','Legacy bare pepper stock IDs need original whole-food record evidence; the ambiguous name stays separate from Mixed Peppers.'],
 ok:report.invalid.length===0&&classificationCollisions.length===0&&protectedCollisions.length===0&&(!privatePaths.length||missingIds.length===0&&unexpectedIds.length===0)};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ok:result.ok,output,coverage:result.coverage,recognizedUniqueNames:report.recognized,renamedUniqueNames:report.renamed,unmappedUniqueNames:report.unmapped.length,classificationHouseholdCollisions:classificationCollisions.length,protectedCollisions:protectedCollisions.length},null,2));
if(!result.ok)process.exitCode=1;
