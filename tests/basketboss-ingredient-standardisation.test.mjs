import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),serving=require('../bb-serving-scale.js'),speech=require('../bb-cook-speech-text.js');
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(entry){
 const html=read(entry),context=vm.createContext({Intl});
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(read(file),context);
 for(const name of ['RECIPES','BB307_NORMALIZED'])vm.runInContext(html.match(new RegExp('^const '+name+'=.*;$','m'))[0],context);
 const start=html.indexOf('const bb307EstimateBasket=(()=>{'),end=html.indexOf('\nconst BB307Pantry=',start);
 vm.runInContext(html.slice(start,end),context);
 vm.runInContext('this.recipes=RECIPES;this.normalized=BB307_NORMALIZED;this.basket=bb307EstimateBasket;',context);
 const pantryEnd=html.indexOf('// BasketBoss 321 v7 original-design',end);
 vm.runInContext(html.slice(end,pantryEnd)+';this.pantry=BB307Pantry;',context);
 Object.assign(context,{BBServing:serving});
 vm.runInContext('const BB_WHOLE_PRODUCE_GRAMS=BBPriceV19.wholeProduceGrams;',context);
 const displayStart=html.indexOf('function bbRecipeIngredientQuantity('),displayEnd=html.indexOf('const BB307_SOURCE_RECIPES=',displayStart);
 vm.runInContext(html.slice(displayStart,displayEnd),context);
 const run=(selections,options={})=>context.basket({selections,recipes:context.recipes,normalized:context.normalized,market:'UK',...options});
 return {html,context,p:context.BBPriceV19,run};
}
for(const entry of ['index.html','app.html']){
 test(entry+': real carrot count/gram recipe lines merge before purchasing and retain exact source needs',()=>{
  const h=harness(entry),before=JSON.stringify(h.context.normalized);
  for(const market of ['UK','Guernsey','Jersey','US']){
   const result=h.run([{id:'lentil-bolognese',servings:4},{id:'traybake-sausage',servings:4}],{market});
   const carrots=result.items.filter(item=>h.p.canonical(item.key)==='carrot');
   assert.equal(carrots.length,1);const row=carrots[0];assert.equal(row.unit,'g');assert.equal(row.required,510);assert.equal(row.sharedAcrossRecipes,2);assert.equal(row.quantityEstimated,true);assert.match(row.quantityAssumptions.join(' '),/80 g/);
   assert.equal(row.spend,h.p.price({name:'carrot',quantity:510,unit:'g',market}).amount);assert.equal(row.sourcePackCount,1);
   assert(!result.unresolved.some(item=>item.ingredient==='carrot'&&item.status.startsWith('MIXED_UNITS')));
  }
  assert.equal(JSON.stringify(h.context.normalized),before);
 });
 test(entry+': metric aliases combine exactly and unreviewed food forms stay separate',()=>{
  const h=harness(entry);
  const ingredients=[['Carrot',2,'each'],['Carrots',.25,'kilograms'],['Frozen carrots',100,'g'],['Carrot',50,'ml']];
  const recipes=[{id:'fixture',servings:4,ingredients:ingredients.map(([name,q,u])=>[name,q+' '+u,1])}];
  const normalized=[{id:'fixture',ingredients:ingredients.map(([key,quantity,unit])=>({key,name:key,quantity,unit,status:'PARSED'}))}];
  const result=h.run([{id:'fixture',servings:4}],{recipes,normalized});
  const fresh=result.items.filter(row=>h.p.canonical(row.key)==='carrot');assert.equal(fresh.length,2);
  assert.equal(fresh.find(row=>row.unit==='g').required,410);assert.equal(fresh.find(row=>row.unit==='ml').required,50);
  assert.equal(result.items.find(row=>row.key==='frozen carrots').required,100);
 });
 test(entry+': compatible pantry stock is credited once without changing saved source units',()=>{
  const h=harness(entry),stock={'carrots|each':2,'carrot|g':100},before=JSON.stringify(stock),selections=[{id:'lentil-bolognese',servings:4},{id:'traybake-sausage',servings:4}];
  const result=h.run(selections,{pantry:stock}),row=result.items.find(row=>row.key==='carrot');
  assert.equal(row.required,510);assert.equal(row.pantryUsed,260);assert.equal(row.toBuy,250);assert.equal(JSON.stringify(stock),before);
  const projected=h.context.pantry.reconcileStock(stock,[row]);assert.equal(projected.pantry['carrot|g'],260);assert.equal(JSON.stringify(stock),before);
 });
 test(entry+': day sources and displayed recipe amounts use the same shared planning conversion',()=>{
  const h=harness(entry),ctx=h.context,planned=[{day:'Tuesday',recipeId:'lentil-bolognese',servings:4},{day:'Wednesday',recipeId:'traybake-sausage',servings:4}];
  Object.assign(ctx,{state:{planned},getRecipe:id=>ctx.recipes.find(row=>row.id===id),bb176AllowedRecipe:()=>true,bbBatchPairs:()=>[],bbBatchPairFor:()=>null,BBServing:{...serving,forMeal:(_state,slot)=>slot.servings}});
  const start=h.html.indexOf('function bb321ShoppingSources(){'),end=h.html.indexOf('\nfunction bb321UsedInLine(',start);vm.runInContext(h.html.slice(start,end),ctx);
  const rows=ctx.bb321ShoppingSources().get('carrot|g');assert.equal(rows.length,2);assert.equal(rows.reduce((sum,row)=>sum+row.qty,0),510);assert.equal(rows[0].sourceQuantity,2);assert.equal(rows[0].sourceUnit,'each');assert.equal(rows[0].estimated,true);
  const recipe=ctx.getRecipe('lentil-bolognese'),line=recipe.ingredients.find(line=>line[0]==='Carrots');
  assert.equal(ctx.bbRecipeIngredientQuantity(recipe,line,1),'≈ 160 g (2)');assert.equal(ctx.bbRecipeIngredientQuantity(recipe,line,.5),'≈ 80 g (1)');
 });
 test(entry+': native mentor wording keeps the standardised pepper weight and original count together',()=>{
  const h=harness(entry),recipe=h.context.recipes.find(row=>row.id==='fajitas'),line=recipe.ingredients.find(line=>line[0]==='Mixed peppers');
  const quantity=h.context.bbRecipeIngredientQuantity(recipe,line,4/recipe.servings);
  assert.equal(quantity,'≈ 320 g (2 peppers)');assert.equal(speech.phrase({name:line[0],quantity}),'approximately 320 grams (2 peppers) of mixed peppers');assert.equal(line[1],'3 peppers');
 });
 test(entry+': Tuscan salmon source tomatoes no longer become a second Asparagus row',()=>{
  const h=harness(entry),r=h.context.recipes.find(row=>row.id==='tuscan-salmon'),result=h.run([{id:r.id,servings:r.servings}]);
  assert.equal(result.items.filter(item=>item.key==='asparagus').length,1);assert.equal(result.items.find(item=>item.key==='asparagus').required,250);assert.equal(result.items.find(item=>item.key==='sun-dried tomatoes').required,60);
  const database=JSON.parse(read('normalized-ingredient-database.json')).recipes.find(row=>row.id===r.id);
  assert.deepEqual(plain(h.context.normalized.find(row=>row.id===r.id).ingredients),database.ingredients);
 });
}
