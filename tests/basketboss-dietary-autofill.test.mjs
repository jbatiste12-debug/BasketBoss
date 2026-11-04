import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), dietary=require('../bb-dietary-preferences.js');
const read=name=>fs.readFileSync(new URL('../'+name, import.meta.url),'utf8');
const html=read('index.html');
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const PLAN='basketboss_321_unified_state_v1', STOCK='basketboss_321_v7_measured_pantry';
const plain=value=>JSON.parse(JSON.stringify(value));
function extract(name,next){const a=html.indexOf('function '+name+'('),b=html.indexOf(next,a);assert.ok(a>0&&b>a,name);return html.slice(a,b);}
const a=html.indexOf("const BB_AF_DAYS=['Monday'"), b=html.indexOf('/* END_BASKETBOSS_AUTOFILL_VARIETY_ROTATION_V1 */',a);
assert.ok(a>0&&b>a);
const source=extract('bbRotationSession','/* BASKETBOSS_EVENING_PIVOT_ADAPTER')+'\n'+extract('bbPlanVarietyValid','\nfunction bbRotationMessage')+'\n'+html.slice(a,b);
function fixture(id,protein,ingredients){return {id,name:id+' dinner',category:'Family dinner',tag:'STYLE-'+id,editorialCollection:'Everyday Favourites',primaryProtein:protein,cheeseHeavy:false,servings:4,mins:25,cost:5,ingredients:ingredients.map(name=>[name,'100 g'])};}
const mixed=[
 fixture('chicken','chicken',['Chicken breast','Rice','Carrots']),
 fixture('fish','fish',['Salmon','Rice','Carrots']),
 fixture('beans','beans',['Mixed beans','Rice','Carrots']),
 fixture('lentils','lentils',['Lentils','Rice','Carrots']),
 fixture('chickpeas','chickpeas',['Chickpeas','Rice','Carrots']),
 fixture('tofu','tofu',['Tofu','Rice','Carrots'])
];
function harness(catalog,{diets=['Vegetarian'],weighted=false,stock={},planned=[],random=()=>0}={}){
 const values=new Map([[STOCK,JSON.stringify(stock)]]), assessments=[],notices=[];
 const allowed=new Set(catalog.map(r=>r.id)),excluded=new Set();
 const state={version:2,servings:4,planned:plain(planned),plannedDesserts:[],dayServings:{},mealPreferences:{version:1,scope:'guest',diets:diets.slice(),goals:[]}};
 const localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const ctx={console,Math:Object.assign(Object.create(Math),{random}),localStorage,state,RECIPES:catalog,DAYS,
  BBIngredientPreferences:{recipeAllowed:r=>!!r&&!excluded.has(r.id),scope:()=> 'guest'},
  BBHome:{actor:()=> 'guest',blocked:()=>false,isCooked:()=>false},
  getRecipe:id=>catalog.find(r=>r.id===id),bb176AllowedRecipe:id=>allowed.has(id),
  bb81Under30:()=>true,bb81KidOK:()=>true,bb81BatchOK:()=>true,bb81ProteinScore:()=>0,
  bb172QuickDinners:()=>({}),notify:message=>notices.push(message),render:()=>{},
  persist:()=>{localStorage.setItem(PLAN,JSON.stringify(state));return true;},
  bbHomePhysicalStock:()=>({...stock}),bbHomeConversionContext:()=>({}),bbHomeDayMeals:()=>[],
  bbRecipeMealEstimate:()=>({amount:5}),bbFeedingForRecipe:()=>4,
  bbHomeRecipeIngredients:id=>(catalog.find(r=>r.id===id)?.ingredients||[]).map(row=>({name:row[0],key:row[0].toLowerCase(),required:100,quantity:100,unit:'g'})),
  BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase().trim()+'|'+unit},
  BBPriceV19:{canonicalMeasure:(name,quantity,unit)=>({key:name.toLowerCase(),quantity,unit})}
 };
 ctx.window=ctx;vm.createContext(ctx);
 for(const name of ['bb-dietary-preferences.js','bb-meal-preferences.js','bb-recipe-planning.js','bb-recipe-editorial.js','bb-serving-scale.js'])vm.runInContext(read(name),ctx);
 ctx.BBMealPreferences.configure({read:()=>state.mealPreferences,write:value=>{state.mealPreferences=value;return true;}});
 if(weighted){
  vm.runInContext(read('bb-pantry-deduction.js'),ctx);vm.runInContext(read('bb-pantry-autofill.js'),ctx);
  const actual=ctx.BBPantryAutofill;
  ctx.BBPantryAutofill={...actual,create(options){const ledger=actual.create(options);return {...ledger,assess(rows,context){assessments.push(context?.recipeId);return ledger.assess(rows,context);}};}};
 }
 vm.runInContext(source,ctx);
 const api=vm.runInContext('({draw:bbAfDraw,commit:bbAfCommit,allowed:bbAfIngredientAllowed})',ctx);
 return {api,ctx,state,values,assessments,notices,allowed,excluded,stock,
  setDiets:diets=>ctx.BBMealPreferences.set({diets}),
  commit:selection=>api.commit(state.planned,JSON.stringify(state.planned),'{}',null,selection)};
}
for(const weighted of [false,true]){
 const mode=weighted?'pantry-weighted':'ordinary';
 test(mode+' Auto-fill filters dietary conflicts before selecting or scoring a meal',()=>{
  const stock={'chicken breast|g':100000,'salmon|g':100000,'rice|g':10000,'carrots|g':10000};
  const h=harness(mixed,{weighted,stock}), before=JSON.stringify(stock);
  const selection=h.api.draw(['Monday','Tuesday','Wednesday'],h.state.planned);
  assert.ok(selection);assert.equal(selection.additions.length,3);
  for(const row of selection.additions)assert.equal(dietary.recipeAllowed(mixed.find(r=>r.id===row.recipeId),['Vegetarian']),true,row.recipeId);
  assert.ok(!h.assessments.includes('chicken')&&!h.assessments.includes('fish'),'pantry abundance cannot bypass the diet gate');
  assert.equal(h.commit(selection),true);
  assert.equal(JSON.stringify(stock),before,'planning never consumes physical pantry stock');
 });
 test(mode+' Auto-fill refuses a stale proposal after dietary preferences change',()=>{
  const h=harness(mixed,{diets:[],weighted}), previous=h.state.planned;
  const selection=h.api.draw(['Monday'],previous);assert.equal(selection.additions[0].recipeId,'chicken');
  assert.equal(h.setDiets(['Vegetarian']).ok,true);
  assert.equal(h.commit(selection),false);
  assert.equal(h.state.planned,previous);assert.equal(h.values.has(PLAN),false);
 });
 test(mode+' Auto-fill returns only a partial compatible week when the pool is small',()=>{
  const h=harness(mixed.slice(0,4),{diets:['Vegan','Gluten-free'],weighted});
  const selection=h.api.draw(DAYS,h.state.planned);
  assert.ok(selection);assert.equal(selection.additions.length,2);
  assert.deepEqual(new Set(selection.additions.map(r=>r.recipeId)),new Set(['beans','lentils']));
  assert.equal(h.commit(selection),true);
  assert.equal(h.state.planned.length,2,'remaining days stay empty rather than admitting meat or fish');
 });
 test(mode+' Auto-fill keeps both membership and separate ingredient-avoidance gates',()=>{
  const h=harness(mixed,{weighted});h.allowed.delete('beans');h.excluded.add('lentils');
  const selection=h.api.draw(['Monday','Tuesday'],h.state.planned);
  assert.ok(selection);assert.deepEqual(new Set(selection.additions.map(r=>r.recipeId)),new Set(['chickpeas','tofu']));
 });
}
test('changing diet preserves already chosen meals while filtering every new addition',()=>{
 const previous=[{day:'Monday',recipeId:'chicken'}],h=harness(mixed,{planned:previous,weighted:true});
 const selection=h.api.draw(['Tuesday'],h.state.planned);assert.ok(selection);
 assert.equal(h.commit(selection),true);assert.deepEqual(plain(h.state.planned[0]),previous[0]);
 assert.equal(dietary.recipeAllowed(mixed.find(r=>r.id===h.state.planned[1].recipeId),['Vegetarian']),true);
});
test('a wholly incompatible pool cannot fill an empty day in either Auto-fill mode',()=>{
 for(const weighted of [false,true]){const h=harness(mixed.slice(0,2),{weighted});assert.equal(h.api.draw(['Monday'],h.state.planned),null);assert.deepEqual(plain(h.state.planned),[]);assert.equal(h.values.has(PLAN),false);}
});
test('the real Free catalogue can fill a vegetarian week through the shared preference model',()=>{
 let seed=143;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 const recipes=JSON.parse(read('recipes.json')),h=harness(recipes,{weighted:true,random});
 const selection=h.api.draw(DAYS,h.state.planned);assert.ok(selection);assert.equal(selection.additions.length,7);
 for(const row of selection.additions)assert.equal(dietary.recipeAllowed(recipes.find(r=>r.id===row.recipeId),['Vegetarian']),true,row.recipeId);
 assert.equal(h.commit(selection),true);
});
