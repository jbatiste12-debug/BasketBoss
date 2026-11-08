import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),serving=require('../bb-serving-scale.js'),planning=require('../bb-recipe-planning.js'),extras=require('../bb-plan-extras.js');
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const recipes=JSON.parse(read('recipes.json')),normalized=JSON.parse(read('normalized-ingredient-database.json')).recipes;
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const breakfast='banana-oat-pancakes',dinner='fajitas',plain=value=>JSON.parse(JSON.stringify(value));

function sourceFunction(source,name){
 const start=source.indexOf('function '+name+'(');assert.ok(start>=0,'The actual '+name+' adapter exists');
 const lineEnd=source.indexOf('\n',start),line=source.slice(start,lineEnd);
 if(line.endsWith('}'))return line;
 const end=source.indexOf('\n}',start);assert.ok(end>start,'The actual '+name+' adapter is complete');
 return source.slice(start,end+2);
}
function fixture(entry,{cooked=[],allowed=()=>true}={}){
 const source=read(entry),state={version:2,pantryPlanGeneration:'breakfast-test-cycle',servings:4,feedingSet:true,
  planned:[{recipeId:dinner,day:'Monday'}],plannedBreakfasts:[{recipeId:breakfast,day:'Monday',servings:1},{recipeId:breakfast,day:'Tuesday',servings:3}],plannedDesserts:[],
  mealServings:{[breakfast]:6},dayServings:{Monday:{recipeId:dinner,count:4}},pantry:{},leftoverSources:{},leftoverConfirmed:{}};
 const context=vm.createContext({state,DAYS,BBServing:serving,BBRecipePlanning:planning,BBPlanExtras:extras,RECIPES:plain(recipes),BB307_NORMALIZED:plain(normalized),bb307Market:'UK',
  getRecipe:id=>recipes.find(row=>row.id===id),bb176AllowedRecipe:allowed,
  bb81ActiveBatch:()=>null,bbBatchPairFor:()=>null,bbBatchPairs:()=>[],bbHomeWeekToken:()=> '2026-11-02|breakfast-test-cycle',
  bb321LunchState:{children:1,days:{}},BB321Lunch:{LUNCH_DAYS:DAYS.slice(0,5)},bb172QuickDinners:()=>({})});
 context.window=context;context.BBHome={isCooked:occurrence=>cooked.includes(occurrence)};
 vm.runInContext(read('basketboss-pricing-v19.js'),context);
 context.BB307Pantry={pantryName:context.BBPriceV19.canonical,pantryId:(name,unit)=>context.BBPriceV19.canonical(name)+'|'+unit};
 for(const name of ['bbIsBreakfast','bbGetBreakfasts','bbGetDesserts'])if(source.includes('function '+name+'('))vm.runInContext(sourceFunction(source,name),context);
 for(const name of ['normalize','bbFeedingForRecipe','bbHomeOccurrence','bbHomeRecipeIngredients','bb307Selections','bb321ShoppingSources','bbHomeDayMeals'])vm.runInContext(sourceFunction(source,name),context);
 return {context,state,source};
}

test('an explicit meal-slot headcount takes priority without changing the dinner or household',()=>{
 const state={servings:4,mealServings:{shared:6},dayServings:{Monday:{recipeId:'shared',count:5}}};
 const original=plain(state),recipe={id:'shared',servings:2};
 assert.equal(serving.forMeal(state,{recipeId:'shared',day:'Monday',servings:1},recipe),1);
 assert.equal(serving.forMeal(state,{recipeId:'shared',day:'Tuesday',servings:3},recipe),3);
 assert.equal(serving.forMeal(state,{recipeId:'shared',day:'Monday'},recipe),5);
 assert.equal(serving.forMeal(state,{recipeId:'shared',day:'Tuesday'},recipe),6);
 assert.deepEqual(state,original);
});

test('invalid explicit slot headcounts retain existing safe serving fallback',()=>{
 const state={servings:4,dayServings:{Monday:{recipeId:'shared',count:5}}},recipe={id:'shared',servings:2};
 for(const amount of [null,undefined,0,-1,.5,13,Infinity,NaN,{},[]])assert.equal(serving.forMeal(state,{recipeId:'shared',day:'Monday',servings:amount},recipe),5);
});

test('the existing breakfast/brunch bank remains excluded from dinner Auto-Fill',()=>{
 const breakfasts=recipes.filter(recipe=>/\b(?:breakfast|brunch)\b/i.test([recipe.category,recipe.tag,recipe.mealType].join(' ')));
 assert.ok(breakfasts.some(recipe=>recipe.id===breakfast));
 assert.ok(breakfasts.some(recipe=>recipe.id==='breakfast-shakshuka'));
 for(const recipe of breakfasts)assert.equal(planning.isDinner({...recipe,dinnerEligible:true}),false,recipe.id);
 assert.equal(planning.isDinner(recipes.find(recipe=>recipe.id===dinner)),true);
});

test('the optional picker uses breakfast metadata rather than dinner names or tier claims',()=>{
 for(const field of ['category','tag','mealType'])assert.equal(extras.isBreakfast({id:'future-breakfast',[field]:'Breakfast & Brunch'}),true);
 assert.equal(extras.isBreakfast({id:'dinner',name:'Breakfast-style beef burger',category:'Family dinners',tier:'Free'}),false);
 assert.equal(extras.isBreakfast({id:'dinner',name:'Eggs on toast',category:'Family dinners',dinnerEligible:false}),false);
 assert.equal(extras.isBreakfast(null),false);
});

test('normalizing optional slots preserves unknown IDs without duplicate days or malformed portions',()=>{
 const input=[{recipeId:'premium-breakfast-not-yet-hydrated',day:'Monday',servings:2},{recipeId:'duplicate-day',day:'Monday',servings:4},
  {recipeId:'second',day:'Tuesday',servings:99},{recipeId:'bad-day',day:'Yesterday',servings:2},{recipeId:'',day:'Wednesday'},null];
 const before=plain(input);
 assert.deepEqual(extras.normalizeSlots(input),[{recipeId:'premium-breakfast-not-yet-hydrated',day:'Monday',servings:2},{recipeId:'second',day:'Tuesday'}]);
 assert.deepEqual(input,before);assert.deepEqual(extras.normalizeSlots(undefined),[]);
});

for(const entry of ['app.html','index.html']){
 test(entry+': breakfast slots and independent portions survive normalization before Premium hydration',()=>{
  const h=fixture(entry),input=plain(h.state);
  input.plannedBreakfasts.push({recipeId:'premium-breakfast-not-hydrated-yet',day:'Wednesday',servings:2});
  input.plannedBreakfasts.push({recipeId:'invalid-day',day:'Yesterday',servings:2});
  const before=plain(input),result=h.context.normalize(input);
  assert.deepEqual(plain(result.plannedBreakfasts),input.plannedBreakfasts.slice(0,3));
  assert.deepEqual(plain(result.planned),input.planned);assert.deepEqual(plain(result.dayServings),input.dayServings);
  assert.deepEqual(input,before,'Reading a saved plan does not rewrite it');
  assert.deepEqual(plain(h.context.normalize({servings:4,planned:[]}).plannedBreakfasts),[],'Old saved plans remain valid');
 });

 test(entry+': a breakfast-only local plan cannot be treated as empty during automatic cloud restore',()=>{
  const h=fixture(entry),saved={version:2,planned:[],plannedDesserts:[],plannedBreakfasts:[{recipeId:breakfast,day:'Monday',servings:2}],pantry:{}};
  h.context.stateKey='saved-state';h.context.localStorage={getItem:key=>key==='saved-state'?JSON.stringify(saved):null};
  h.context.BBReceiptHost={hasLocalData:()=>false};
  vm.runInContext(sourceFunction(h.source,'localCloudEmpty'),h.context);
  assert.equal(h.context.localCloudEmpty(),false,'A remote empty/different week requires the existing explicit conflict choice');
  saved.plannedBreakfasts=[];assert.equal(h.context.localCloudEmpty(),true,'The previous genuinely empty-device path is retained');
 });

 test(entry+': two breakfast days aggregate their own portions into the real shopping selection',()=>{
  const h=fixture(entry),before=plain(h.state),selected=plain(h.context.bb307Selections());
  assert.deepEqual(selected.find(row=>row.id===breakfast),{id:breakfast,servings:4});
  assert.deepEqual(selected.find(row=>row.id===dinner),{id:dinner,servings:4});
  assert.deepEqual(h.state,before,'Shopping reads leave the meal plan unchanged');
 });

 test(entry+': Cook serving lookup uses the selected breakfast day rather than the recipe-wide override',()=>{
  const h=fixture(entry),recipe=recipes.find(row=>row.id===breakfast),before=plain(h.state);
  assert.equal(h.context.bbFeedingForRecipe(recipe,'Monday','breakfast'),1);
  assert.equal(h.context.bbFeedingForRecipe(recipe,'Tuesday','breakfast'),3);
  assert.equal(h.context.bbFeedingForRecipe(recipes.find(row=>row.id===dinner),'Monday','dinner'),4);
  assert.deepEqual(h.state,before);
 });

 test(entry+': a legacy breakfast recipe saved as dinner keeps distinct meal portions and completion identities',()=>{
  const h=fixture(entry),recipe=recipes.find(row=>row.id===breakfast);
  h.state.planned=[{recipeId:breakfast,day:'Monday'}];h.state.dayServings.Monday={recipeId:breakfast,count:4};
  assert.equal(h.context.bbFeedingForRecipe(recipe,'Monday','dinner'),4);
  assert.equal(h.context.bbFeedingForRecipe(recipe,'Monday','breakfast'),1);
  const meals=plain(h.context.bbHomeDayMeals('Monday'));
  assert.deepEqual(meals.map(row=>[row.kind,row.factor]),[['dinner',2],['breakfast',.5]]);
  assert.notEqual(meals[0].occurrence,meals[1].occurrence);
  assert.deepEqual(plain(h.context.bb307Selections()),[{id:breakfast,servings:8}]);
 });

 test(entry+': cooked breakfast is excluded only for its own day and kind',()=>{
  const key='2026-11-02|breakfast-test-cycle|breakfast|Monday|'+breakfast;
  const h=fixture(entry,{cooked:[key]}),selected=plain(h.context.bb307Selections());
  assert.deepEqual(selected.find(row=>row.id===breakfast),{id:breakfast,servings:3});
  assert.equal(selected.find(row=>row.id===dinner).servings,4);
  assert.equal(h.context.bbHomeOccurrence(breakfast,'Monday','breakfast'),key);
  assert.equal(h.context.bbHomeOccurrence(breakfast,'Friday','breakfast'),null,'Unplanned breakfasts cannot receive a completion receipt');
  assert.notEqual(h.context.bbHomeOccurrence(dinner,'Monday','dinner'),key);
 });

 test(entry+': inaccessible breakfasts never contribute billable shopping or Day Done ingredients',()=>{
  const h=fixture(entry,{allowed:id=>id!==breakfast}),selected=plain(h.context.bb307Selections());
  assert.equal(selected.some(row=>row.id===breakfast),false);
  assert.throws(()=>h.context.bbHomeDayMeals('Monday'),/Reconnect access|unavailable|account/i);
 });

 test(entry+': source attribution keeps separate breakfast days and the precise serving scale',()=>{
  const h=fixture(entry),sources=h.context.bb321ShoppingSources(),oats=plain(sources.get('oats|g'));
  assert.deepEqual(oats.map(row=>({day:row.day,qty:row.qty})),[{day:'Monday',qty:75},{day:'Tuesday',qty:225}]);
  assert.ok(oats.every(row=>row.recipeName==='Banana oat pancakes'&&row.batchLeftoverDay===null));
 });

 test(entry+': Day Done includes breakfast once with the same physical amount as shopping',()=>{
  const h=fixture(entry),items=plain(h.context.bbHomeDayMeals('Monday')),meal=items.find(row=>row.kind==='breakfast');
  assert.ok(meal);assert.equal(meal.recipeId,breakfast);assert.equal(meal.factor,.5);
  assert.equal(meal.occurrence,h.context.bbHomeOccurrence(breakfast,'Monday','breakfast'));
  assert.equal(meal.ingredients.find(row=>row.key==='oats').required,75);
  assert.equal(items.filter(row=>row.kind==='breakfast').length,1);
  const dinnerRecipe=recipes.find(row=>row.id===dinner);
  assert.equal(items.find(row=>row.kind==='dinner').factor,4/(dinnerRecipe.baseServings||dinnerRecipe.servings));
 });
}
