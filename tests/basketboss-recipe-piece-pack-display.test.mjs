import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),serving=require('../bb-serving-scale.js'),purchaseUI=require('../bb-shop-purchase-ui.js'),measures=require('../bb-recipe-measures.js');
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const records=file=>{const value=JSON.parse(read(file));return Array.isArray(value)?value:value.recipes;};
const recipes=records('catalogues/700/release/free.recipes.json'),normalized=records('catalogues/700/release/free.normalized.json');
const source=read('app.html'),start=source.indexOf('function bbRecipeIngredientQuantity('),end=source.indexOf('const BB307_SOURCE_RECIPES=',start);
assert.ok(start>=0&&end>start,'real recipe display boundary remains present');
function fixture(extra=[]){
 const context=vm.createContext({Intl,BBServing:serving,BBShopPurchaseUI:purchaseUI,BBRecipeMeasures:measures,bb307Market:'UK',BB307_NORMALIZED:JSON.parse(JSON.stringify([...normalized,...extra]))});
 context.window=context;vm.runInContext(read('basketboss-pricing-v19.js'),context);vm.runInContext(source.slice(start,end),context);return context;
}
for(const [id,name,count]of [['sausage-gnocchi','Pork sausages',6],['traybake-sausage','Sausages',8],['chicken-burgers','Brioche buns',6],['pulled-pork','Brioche buns',6]]){
 test(`${id}: recipe piece counts display as each while source, scaling and normalized quantities remain exact`,()=>{
  const context=fixture(),recipe=JSON.parse(JSON.stringify(recipes.find(row=>row.id===id))),line=recipe.ingredients.find(row=>row[0]===name),beforeRecipe=JSON.stringify(recipe),beforeNormalized=JSON.stringify(context.BB307_NORMALIZED);
  assert.equal(line[1],count+' pack');assert.equal(context.bbRecipeIngredientQuantity(recipe,line,1),count+' pack','the existing source/scaling function is untouched');
  for(const factor of [1,.5,2]){
   const shown=context.bbRecipeDisplayIngredientQuantity(recipe,line,factor);assert.equal(shown,count*factor+' each');
   assert.equal(context.bbRecipeVisibleQuantity(shown,line[0],'UK'),count*factor+' each');assert.equal(context.bbRecipeVisibleQuantity(shown,line[0],'US'),count*factor+' each');
  }
  assert.equal(JSON.stringify(recipe),beforeRecipe);assert.equal(JSON.stringify(context.BB307_NORMALIZED),beforeNormalized);
 });
}
test('actual broccoli packages and metric pack sizes keep their package meaning',()=>{
 const context=fixture(),recipe=recipes.find(row=>row.id==='miso-salmon-rice'),line=recipe.ingredients.find(row=>row[0]==='Tenderstem broccoli'),before=JSON.stringify(recipe);
 assert.equal(line[1],'2 packs');assert.equal(context.bbRecipeDisplayIngredientQuantity(recipe,line,1),'2 packs');assert.equal(context.bbRecipeDisplayIngredientQuantity(recipe,line,.5),'1 pack');
 const chicken=recipes.find(row=>row.id==='chicken-burgers'),weight=chicken.ingredients.find(row=>row[0]==='Chicken breast');
 assert.equal(context.bbRecipeDisplayIngredientQuantity(chicken,weight,1),'1 kg pack');assert.equal(JSON.stringify(recipe),before);
});
test('the display rule handles another food count without synonyms and rejects mismatched or package-based evidence',()=>{
 for(const [unit,quantity,expected]of [['each',6,'6 each'],['pack',6,'6 packs'],['each',12,'6 packs'],['g',600,'6 packs']]){
  const recipe={id:'egg-piece-fixture',servings:4,ingredients:[['Eggs','6 pack']]},context=fixture([{id:recipe.id,ingredients:[{name:'Eggs',key:'egg',quantity,unit}]}]);
  assert.equal(context.bbRecipeDisplayIngredientQuantity(recipe,recipe.ingredients[0]),expected);
 }
 assert.equal(purchaseUI.formatDisplayQuantityText('6 pack'),'6 packs','the global purchase-pack formatter is unchanged');
});
