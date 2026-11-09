import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {transform700PlanExtrasPicker} from '../tools/catalogue700/plan-extras-picker.mjs';

const require=createRequire(import.meta.url),serving=require('../bb-serving-scale.js');
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const recipes=JSON.parse(read('recipes.json'));
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const dessert='dessert-chocolate-brownies',dinner='fajitas';
function sourceFunction(source,name){
 const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name+' exists');
 const lineEnd=source.indexOf('\n',start),line=source.slice(start,lineEnd);
 if(line.endsWith('}'))return line;
 const end=source.indexOf('\n}',start);assert.ok(end>start);return source.slice(start,end+2);
}
function fixture(entry){
 const source=read(entry),generated=transform700PlanExtrasPicker(source),button={dataset:{dessertAddDay:'Thursday'}};
 const state={servings:4,feedingSet:true,pantryPlanGeneration:'week-a',planned:[{recipeId:dinner,day:'Thursday',servings:3}],plannedBreakfasts:[],plannedDesserts:[],mealServings:{[dessert]:2},dayServings:{Thursday:{recipeId:dinner,count:3}}};
 const context=vm.createContext({state,RECIPES:plain(recipes),DAYS,BBServing:serving,tab:'plan',bbDessertTargetDay:null,actor:'alice',session:'session-a',allowed:true,deleting:false,saveOK:true,renders:0,upgrades:0,notices:[],history:[],bbVerifiedPaidRecipes:false,
  localStorage:{getItem:()=>context.session},
  app:{querySelectorAll:()=>[button]},
  notify:message=>context.notices.push(message),persist:()=>context.saveOK,render:()=>context.renders++,bbRecordPlannedRecipes:ids=>context.history.push(...ids),
  bb176IsPremiumPreview:()=>false,bb176OpenPremiumUpgrade:()=>context.upgrades++,bb81ActiveBatch:()=>null,bbBatchPairFor:()=>null,bbHomeOccurrence:()=>null});
 context.window=context;
 context.BB173_FREE_RECIPE_IDS=recipes.filter(recipe=>!recipe.premium).map(recipe=>recipe.id);
 context.BBHome={actor:()=>context.actor,isCooked:()=>false};
 context.BBAccountDeletion={isDeleting:()=>context.deleting};
 context.BBPlanExtras={openDessertPicker:options=>(context.options=options)};
 const setStart=source.indexOf('const BB_DESSERT_IDS='),setEnd=source.indexOf(';',setStart);
 vm.runInContext(source.slice(setStart,setEnd+1),context);
 for(const name of ['bbIsDessert','getRecipe','bb176AllowedRecipe','bbPlanDessert','bbGetDesserts','bb307Selections','bbFeedingForRecipe'])vm.runInContext(sourceFunction(source,name),context);
 const start=generated.indexOf("app.querySelectorAll('[data-dessert-add-day]')"),end=generated.indexOf('\n});',start);
 assert.ok(start>=0&&end>start);vm.runInContext(generated.slice(start,end+4),context);
 button.onclick();return {context,state,source,generated,button};
}

test('the generated adapter fails closed for missing, repeated, or already transformed anchors',()=>{
 const source=read('app.html'),out=transform700PlanExtrasPicker(source);
 assert.throws(()=>transform700PlanExtrasPicker(''),/picker_anchor/);
 assert.throws(()=>transform700PlanExtrasPicker(source+source),/picker_anchor/);
 assert.throws(()=>transform700PlanExtrasPicker(out),/picker_anchor/);
 assert.equal(source.includes('openDessertPicker'),false,'The raw legacy client retains its existing routing');
 assert.equal(out.includes('openDessertPicker'),true);
});

for(const entry of ['app.html','index.html']){
 test(entry+': generated dessert button stays in Plan and delegates exact host category/access predicates',()=>{
  const h=fixture(entry),c=h.context;
  assert.equal(c.tab,'plan');assert.equal(c.options.day,'Thursday');assert.equal(c.renders,0);assert.deepEqual(c.notices,[]);
  assert.equal(c.options.eligible,c.bbIsDessert);
  assert.ok(c.options.recipes().every(recipe=>c.bbIsDessert(recipe)&&c.bb176AllowedRecipe(recipe.id)));
  assert.ok(c.options.recipes().some(recipe=>recipe.id===dessert));
  assert.equal(c.options.recipes().some(recipe=>recipe.id===dinner),false);
  c.BB173_FREE_RECIPE_IDS=[];assert.deepEqual(plain(c.options.recipes()),[],'Access is evaluated again rather than cached');
  c.bbVerifiedPaidRecipes=true;assert.ok(c.options.recipes().length>0);
 });

 test(entry+': actual dessert transaction saves only the selected day with existing servings and shopping/Cook scale',()=>{
  const h=fixture(entry),c=h.context,before=plain(h.state.planned),dayServings=plain(h.state.dayServings);
  c.bbVerifiedPaidRecipes=true;
  assert.equal(c.options.select(dessert,'Thursday'),true);
  assert.deepEqual(plain(h.state.plannedDesserts),[{recipeId:dessert,day:'Thursday',servings:2}]);
  assert.deepEqual(h.state.planned,before);assert.deepEqual(h.state.dayServings,dayServings);assert.deepEqual(h.state.plannedBreakfasts,[]);
  assert.deepEqual(plain(c.bb307Selections()),[{id:dinner,servings:3},{id:dessert,servings:2}]);
  assert.equal(c.bbFeedingForRecipe(recipes.find(recipe=>recipe.id===dessert),'Thursday','dessert'),2);
  assert.equal(c.renders,1);assert.deepEqual(plain(c.history),[dessert]);
  assert.equal(c.options.recipes().some(recipe=>recipe.id===dessert),false,'Previously planned recipe IDs are excluded');
 });

 test(entry+': failed persist and revoked access cannot appear as a successful selection',()=>{
  const h=fixture(entry),c=h.context;c.bbVerifiedPaidRecipes=true;c.saveOK=false;
  assert.equal(c.options.select(dessert,'Thursday'),false);assert.deepEqual(plain(h.state.plannedDesserts),[]);assert.equal(c.renders,0);assert.deepEqual(c.history,[]);
  c.saveOK=true;c.bbVerifiedPaidRecipes=false;c.BB173_FREE_RECIPE_IDS=[];
  assert.equal(c.options.select(dessert,'Thursday'),false);assert.deepEqual(plain(h.state.plannedDesserts),[]);assert.equal(c.upgrades,1);
 });

 test(entry+': an occupied target day or pending deletion never falls through to a different day',()=>{
  const h=fixture(entry),c=h.context;c.bbVerifiedPaidRecipes=true;
  h.state.plannedDesserts=[{recipeId:'other-dessert',day:'Thursday',servings:4}];const before=plain(h.state);
  assert.equal(c.options.select(dessert,'Thursday'),false);assert.deepEqual(h.state,before);assert.equal(c.renders,0);
  h.state.plannedDesserts=[];c.deleting=true;
  assert.equal(c.options.select(dessert,'Thursday'),false);assert.deepEqual(plain(h.state.plannedDesserts),[]);
 });

 test(entry+': shared picker context changes for session, actor, week, target slots, navigation and deletion',()=>{
  const h=fixture(entry),c=h.context,pin=c.options.context();
  for(const [field,value]of [['session','session-b'],['actor','bob'],['tab','discover'],['deleting',true]]){
   const before=c[field];c[field]=value;assert.notEqual(c.options.context(),pin,field);c[field]=before;
  }
  h.state.pantryPlanGeneration='week-b';assert.notEqual(c.options.context(),pin);h.state.pantryPlanGeneration='week-a';
  h.state.plannedDesserts=[{recipeId:'other',day:'Thursday'}];assert.notEqual(c.options.context(),pin);
 });
}
