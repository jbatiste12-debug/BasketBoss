import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),canonical=require('../bb-recipe-canonical.js'),policy=require('../bb-pantry-policy.js');
const rice=quantity=>({name:'Rice',key:'rice',unit:'g',quantity});
for(const quantity of [null,undefined,'',' ',false,true,[],{},NaN,Infinity,-1])test('unknown or invalid recipe amount stays reviewable: '+String(quantity),()=>{
 const projected=canonical.project(rice(quantity)),[group]=canonical.aggregate([projected]);
 assert.equal(projected.required,null);assert.equal(projected.needsReview,true);assert.equal(group.needsReview,true);assert.equal(group.pendingSources.length,1);assert.equal(group.required,0);assert.ok(Number.isFinite(group.required));
});
test('explicit zero remains zero while valid numeric recipe quantities remain supported',()=>{
 assert.equal(canonical.project(rice(0)).required,0);assert.equal(canonical.project(rice('300')).required,300);
 assert.equal(canonical.aggregate([canonical.project(rice(0))])[0].needsReview,undefined);
});
for(const factor of [0,-1,NaN,Infinity])test('invalid portion factor does not manufacture a known zero requirement: '+String(factor),()=>{
 assert.equal(canonical.project(rice(300),{factor}).needsReview,true);
});
test('same-ingredient totals and servings scale before pantry subtraction without binary-float tails',()=>{
 const [group]=canonical.aggregate([canonical.project(rice(.1)),canonical.project(rice(.2))]);assert.equal(group.required,.3);
 const [chicken]=canonical.aggregate([canonical.project({name:'Chicken Breast',quantity:200,unit:'g'}),canonical.project({name:'chicken breast',quantity:.35,unit:'kg'})]);assert.equal(chicken.required,550);assert.equal(chicken.sources.length,2);
 assert.equal(canonical.project(rice(400),{factor:6/4}).required,600);
 const [fractions]=canonical.aggregate([canonical.project(rice(1),{factor:1/3}),canonical.project(rice(1),{factor:2/3})]);assert.equal(fractions.required,1);
});
for(const quantity of [undefined,NaN,Infinity,1e308,-1,'200',false])test('invalid preprojected quantity cannot poison a valid aggregate: '+String(quantity),()=>{
 const [group]=canonical.aggregate([canonical.project(rice(300)),{key:'rice',name:'Rice',sourceUnit:'g',unit:'g',quantity}]);
 assert.equal(group.required,300);assert.equal(group.quantity,300);assert.equal(group.needsReview,true);assert.equal(group.pendingSources.length,1);
});
test('approved tomato aliases merge while fresh tomatoes retain a separate physical identity',()=>{
 const names=['Chopped Tomatoes','chopped tomatoes','Tinned Chopped Tomatoes'];const grouped=canonical.aggregate(names.map(name=>canonical.project({name,quantity:200,unit:'g'})));
 assert.equal(grouped.length,1);assert.equal(grouped[0].key,'chopped tomatoes');assert.equal(grouped[0].required,600);
 assert.notEqual(policy.canonicalName('Fresh tomatoes'),grouped[0].key);
});
test('incompatible measured dimensions stay pending and cannot erase the valid side of the total',()=>{
 const [row]=canonical.aggregate([canonical.project(rice(300)),{key:'rice',name:'Rice',sourceUnit:'ml',unit:'ml',quantity:200}]);
 assert.equal(row.unit,'g');assert.equal(row.required,300);assert.equal(row.needsReview,true);assert.equal(row.pendingSources.length,1);
});

import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('function mergeLunchShopping('),end=html.indexOf('\nreturn {LUNCH_DAYS',start);
assert.ok(start>=0&&end>start);const scope=vm.createContext({});vm.runInContext(html.slice(start,end),scope);
const pantryId=(name,unit)=>policy.canonicalName(name)+'|'+unit;
test('real merged Shop math retains sub-centigram quantities and consistent six-decimal reconciliation',()=>{
 for(const [required,owned,toBuy]of [[.004,0,.004],[.333333,.111111,.222222],[600,450,150],[300,1000,0]]){
  const stock={'rice|g':owned},before=JSON.stringify(stock),[row]=scope.mergeLunchShopping([{key:'Rice',unit:'g',required}],[],stock,pantryId,{});
  assert.equal(row.required,required);assert.equal(row.pantryUsed,Math.min(required,owned));assert.equal(row.toBuy,toBuy);assert.equal(JSON.stringify(stock),before,'planning never deducts physical stock');
 }
});
test('real lunch merge adds fractional requirements before subtracting the pantry balance',()=>{
 const [row]=scope.mergeLunchShopping([{key:'Rice',unit:'g',required:.1}],[{name:'Rice',unit:'g',qty:.2,days:['Monday']}],{'rice|g':.1},pantryId,{});
 assert.equal(row.required,.3);assert.equal(row.pantryUsed,.1);assert.equal(row.toBuy,.2);
});

test('real selection projection counts a duplicate occurrence once and repeated meals on different days twice',()=>{
 const recipe={id:'rice-A',servings:4},state={servings:4,planned:[{recipeId:recipe.id,day:'Monday'},{recipeId:recipe.id,day:'Monday'},{recipeId:recipe.id,day:'Tuesday'}]};
 const scope=vm.createContext({state,RECIPES:[recipe],BBServing:require('../bb-serving-scale.js'),window:{BBHome:{isCooked:()=>false}},bb176AllowedRecipe:()=>true,bbBatchPairFor:()=>false,bbHomeOccurrence:(id,day,kind='dinner')=>kind+'|'+day+'|'+id});
 const a=html.indexOf('function bb307Selections(){'),b=html.indexOf('\nfunction bbPantryReconcileStock(',a);vm.runInContext(html.slice(a,b),scope);
 const before=JSON.stringify(state),selections=JSON.parse(JSON.stringify(scope.bb307Selections()));
 assert.deepEqual(selections,[{id:'rice-A',servings:8}]);assert.equal(JSON.stringify(state),before,'planning projections never mutate saved slots');
});
