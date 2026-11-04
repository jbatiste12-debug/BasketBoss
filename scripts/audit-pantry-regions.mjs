import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),canonical=require('../bb-recipe-canonical.js'),deduction=require('../bb-pantry-deduction.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function auditRegions(directory=root){
 const recipes=JSON.parse(fs.readFileSync(path.join(directory,'recipes.json'))),normalized=JSON.parse(fs.readFileSync(path.join(directory,'normalized-ingredient-database.json'))).recipes;
 if(recipes.length!==100||normalized.length!==100)throw Error('Audit requires the authoritative 100 Free recipes.');
 const context=vm.createContext({});for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(fs.readFileSync(path.join(directory,file),'utf8'),context);
 const pricing=context.BBPriceV19,source=new Map(recipes.map(r=>[r.id,r])),rows=[];
 for(const recipe of normalized){const original=source.get(recipe.id);if(!original||original.ingredients.length!==recipe.ingredients.length)throw Error('Recipe source alignment changed: '+recipe.id);
  recipe.ingredients.forEach((row,index)=>rows.push(canonical.project(row,{sourceLine:original.ingredients[index],canonicalize:pricing.canonical,canonicalMeasure:pricing.canonicalMeasure,recipeIngredientUnit:pricing.recipeIngredientUnit})));
 }
 const groups=canonical.aggregate(rows),pending=groups.flatMap(row=>row.pendingSources).map(({name,key,recipeId,ingredientIndex,source,sourceQuantity,sourceUnit,reason})=>({name,key,recipeId,ingredientIndex,source,sourceQuantity,sourceUnit,reason}));
 const duplicates=groups.filter((row,index)=>groups.findIndex(other=>other.key===row.key)!==index).map(row=>row.key);
 const modes={};
 for(const market of ['UK','US']){
  const conversionFailures=[],cases=[['Milk',1,'pint',market==='US'?473:568,'ml'],['Chopped tomatoes',1,'tin',market==='US'?411:400,'g'],['Beef mince',1,'pack',market==='US'?454:500,'g'],['Rice',1,'cup',185,'g'],['Milk',1,'cup',240,'ml'],['Rice',1,'oz',28.35,'g'],['Rice',1,'lb',453.6,'g'],['Milk',1,'fl oz',30,'ml'],['Garlic',1,'clove',1,'each']];
  for(const [name,q,unit,expected,base]of cases){const actual=policy.normalize(name,q,unit,{market});if(!actual||actual.unit!==base||Math.abs(actual.quantity-expected)>1e-6)conversionFailures.push({name,unit,expected,actual});}
  let simulatedIngredients=0;
  for(const row of groups){
   if(row.staple||!(row.required>0))continue;simulatedIngredients++;
   const inputUnit=market==='US'?(row.unit==='g'?'oz':row.unit==='ml'?'fl oz':'each'):row.unit;
   const entered=row.required/(inputUnit==='oz'?28.35:inputUnit==='fl oz'?30:1),receipt=policy.normalize(row.key,entered,inputUnit,{market});
   if(!receipt||receipt.unit!==row.unit||Math.abs(receipt.quantity-row.required)>0.00001){conversionFailures.push({name:row.key,unit:inputUnit,expected:row.required,actual:receipt,stage:'receipt/manual-to-pantry'});continue;}
   const key=row.key+'|'+row.unit,stock={[key]:row.required*2};
   const result=deduction.proposal({stock,ingredients:[{key:row.key,name:row.name,unit:row.unit,required:row.required}],conversion:{pantryMode:true,market}});
   if(Math.abs((result.remainingStock[key]||0)-row.required)>0.00001)conversionFailures.push({name:row.key,unit:row.unit,expected:row.required,actual:result.remainingStock,stage:'cooked-to-remaining-balance',issues:result.issues});
  }
  // Canonical recipe source is UK. Switching the display/purchase region must
  // never reinterpret a saved recipe tin, cup, or a previously saved balance.
  modes[market]={recipes:recipes.length,ingredientLines:rows.length,aggregatedIngredients:groups.length,simulatedIngredients,duplicateRows:duplicates,nonCanonicalRows:groups.filter(r=>!['g','ml','each'].includes(r.unit)).map(r=>r.key),conversionFailures,needsRecipeReview:pending.length,canonicalTotals:groups.map(({key,unit,required})=>({key,unit,required}))};
 }
 const pickerSource=fs.readFileSync(path.join(directory,'shopping-inventory.js'),'utf8'),items=pickerSource.match(/const ITEMS=(\[[^\n]+\]);/)[1],foods=pickerSource.match(/const BB5_FOODS=(\{[\s\S]*?\n\});/)[1];
 const tiles=vm.runInNewContext('const ITEMS='+items+';('+foods+')'),quickAdd=[];
 for(const [location,choices]of Object.entries(tiles))for(const [,name]of choices){const key=policy.canonicalName(name,pricing.canonical),countFromGram=policy.normalize(name,1,'g'),weight=policy.countGrams[key]||(countFromGram?.unit==='each'?1/countFromGram.quantity:null),matched=groups.some(group=>group.key===key);quickAdd.push({location,name,key,recipeMatch:matched,mode:policy.isStaple(name)?'staple':weight?'piece-weight':'measured-or-container-size',gramsPerPiece:weight||null,review:!policy.isStaple(name)&&!weight?'Enter actual weight/volume or reviewed container contents; do not infer a package size from each.':null});}
 return {version:1,source:'recipes.json + normalized-ingredient-database.json (100 Free recipes)',recipeOrigin:'UK; preserved across regional display changes',cupDensityPolicy:'Approximate ingredient-specific 240 ml kitchen cup weights; preparation and packing require review.',modes,quickAdd,recipeReview:pending,rows,groups};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const report=auditRegions(),out=path.resolve(root,'docs/ingredient-region-audit.json');const {rows,groups,...artifact}=report;fs.writeFileSync(out,JSON.stringify({...artifact,ingredientLines:rows.length,aggregatedIngredients:groups.length},null,2)+'\n');
 const lines=['# Pantry and recipe regional audit','',`Audited **100 recipes / ${report.rows.length} ingredient lines** in both UK and US modes.`, '',`Aggregates contain **${report.groups.length} ingredients, zero duplicate keys**. Canonical storage uses g, ml and each (count); staples use container/status tracking.`, '',`**${report.recipeReview.length} source amounts need recipe review.** These are not silently assigned weights.`, '', '| Recipe | Ingredient | Original amount |', '|---|---|---|',...report.recipeReview.map(row=>`| ${row.recipeId} | ${row.name} | ${row.source.replaceAll('|','/')} |`),'','Regional conversions use the requested rounded kitchen factors. Cup weights are ingredient-specific estimates; reviewed package contents override regional defaults.','', 'Recipe source quantities remain UK quantities. Region changes affect purchase defaults and presentation; existing canonical balances are never rescaled.'];
 lines.push('', '## At home quick-add tiles', '', 'Every Cupboard, Fridge and Freezer tile is included below. Piece weights are approximate and shared with shopping presentation. Eggs and garlic use count as their canonical unit. Other measured foods need grams/ml or reviewed container contents; an unknown each/pack is preserved for review.', '', '| Area | Tile | Matches recipe catalogue | Tracking / g per piece |', '|---|---|---|---|', ...report.quickAdd.map(row=>`| ${row.location} | ${row.name} | ${row.recipeMatch?'Yes':'No'} | ${row.gramsPerPiece?row.gramsPerPiece+' g (estimate)':row.mode} |`));
 fs.writeFileSync(path.resolve(root,'docs/ingredient-region-audit.md'),lines.join('\n')+'\n');
 console.log(JSON.stringify({recipes:100,ingredientLines:report.rows.length,groups:report.groups.length,recipeReview:report.recipeReview.length,modes:Object.fromEntries(Object.entries(report.modes).map(([key,value])=>[key,{duplicateRows:value.duplicateRows.length,nonCanonicalRows:value.nonCanonicalRows.length,conversionFailures:value.conversionFailures.length}]))}));
 if(Object.values(report.modes).some(mode=>mode.duplicateRows.length||mode.nonCanonicalRows.length||mode.conversionFailures.length))process.exitCode=1;
}
