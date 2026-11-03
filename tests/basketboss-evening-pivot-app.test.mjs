import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),core=require('../bb-evening-pivot.js'),appFactory=require('../bb-evening-pivot-app.js'),serving=require('../bb-serving-scale.js');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pantryStart=html.indexOf('const BB307Pantry=(()=>{'),pantryEnd=html.indexOf('\n})();',pantryStart)+6;
assert.ok(pantryStart>=0&&pantryEnd>pantryStart,'actual Pantry quantity reconciler is present');
const realm=vm.createContext({window:{},console});
vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),realm);
realm.BBPriceV19=realm.window.BBPriceV19;
vm.runInContext(html.match(/const BB_WHOLE_PRODUCE_GRAMS=[^\n]+/)[0]+'\n'+html.slice(pantryStart,pantryEnd)+'\nglobalThis.testPantry=BB307Pantry;',realm);
const pantry=realm.testPantry;
const copy=x=>JSON.parse(JSON.stringify(x));

function fixture(){
 const state={planned:[{day:'Monday',recipeId:'slow'},{day:'Wednesday',recipeId:'quick'}],dayServings:{Monday:{recipeId:'slow',count:6},Wednesday:{recipeId:'quick',count:2}},servings:4,plannedDesserts:[{day:'Monday',recipeId:'pudding'}],pantry:{rice:true}};
 const recipes=[{id:'slow',name:'Roast chicken',mins:55,servings:4,ingredients:[['Chicken breast','400 g'],['Ginger','20 g']]},{id:'quick',name:'Tuna pasta',mins:20,servings:4,ingredients:[['Tinned tuna','200 g'],['Pasta','400 g']]}];
 const normalized=recipes.map(r=>({id:r.id,servings:r.servings,ingredients:r.ingredients.map(([name,quantity])=>({name,key:name,quantity:Number(quantity.split(' ')[0]),unit:'g',status:'PARSED'}))}));
 const stock={'tinned tuna|g':100,'pasta|g':200};
 const control={actor:'account-a',premium:true,date:new Date(2026,10,2,18,30),reviewRequired:false,linked:new Set(),locked:new Set(),avoided:new Set(),extra:'preferences-v1',canSave:true,commits:0};
 let app;
 const context=()=>({planned:state.planned,dayServings:state.dayServings,recipes,normalized,stock,actor:control.actor,premium:control.premium,date:control.date,reviewRequired:control.reviewRequired,
  fingerprint:control.extra,isLinked:day=>control.linked.has(day),allowed:r=>!control.locked.has(r.id),recipeAllowed:r=>!control.avoided.has(r.id),
  servingsForDay:(day,r)=>serving.forMeal(state,{day,recipeId:r?.id},r),reconcileStock:pantry.reconcileStock,pantryId:pantry.pantryId,recipeIngredientUnit:realm.BBPriceV19.recipeIngredientUnit});
 app=appFactory.create({core,context,commit:(stamp,next)=>{if(!control.canSave||stamp!==app.fingerprint())return false;control.commits++;state.planned=next.planned;state.dayServings=next.dayServings;return true;}});
 const preview=()=>app.preview({day:'Monday',recipeId:'slow'});
 const checks=s=>({confirmed:true,readyToCook:true,useBy:Object.fromEntries(s.requiresFreshness.map(x=>[x.key,s.movedDateISO]))});
 return {app,state,recipes,normalized,stock,control,context,preview,checks};
}

test('only confirmed measured stock at the candidate serving count makes a planned dinner ready',()=>{
 const h=fixture(),before=JSON.stringify({state:h.state,stock:h.stock,recipes:h.recipes});
 const result=h.preview();assert.equal(result.suggestions.length,1);assert.equal(result.suggestions[0].candidateServings,2);
 assert.equal(result.suggestions[0].currentServings,6);assert.equal(h.control.commits,0);
 assert.equal(JSON.stringify({state:h.state,stock:h.stock,recipes:h.recipes}),before,'preview consumes no Pantry, recipe or planner data');
 h.stock['pasta|g']=199;assert.equal(h.preview().suggestions.length,0);
});

test('the actual Pantry canonical aliases and mass-unit bridge are used without mass-to-volume guesses',()=>{
 const h=fixture();h.recipes[1].ingredients=[['Onions','2 each']];h.normalized[1].ingredients=[{name:'Onions',key:'onions',quantity:2,unit:'each',status:'PARSED'}];
 Object.keys(h.stock).forEach(key=>delete h.stock[key]);h.stock['onion|each']=1;
 assert.equal(h.preview().suggestions.length,1,'plural canonical ingredient uses the same measured record');
 h.recipes[1].ingredients=[['Pasta','400 g']];h.normalized[1].ingredients=[{name:'Pasta',key:'pasta',quantity:400,unit:'g',status:'PARSED'}];
 Object.keys(h.stock).forEach(key=>delete h.stock[key]);h.stock['pasta|kg']=0.2;
 assert.equal(h.preview().suggestions.length,1,'kg converts to matching g');
 delete h.stock['pasta|kg'];h.stock['pasta|ml']=200;
 assert.equal(h.preview().suggestions.length,0,'dry pasta volume never becomes grams');
});

test('source-proven Garlic units match measured Pantry amounts without treating ambiguous each as bulbs',()=>{
 const h=fixture();h.recipes[1].ingredients=[['Garlic','3 cloves']];
 h.normalized[1].ingredients=[{name:'Garlic',key:'garlic',quantity:3,unit:'each',status:'PARSED'}];
 Object.keys(h.stock).forEach(key=>delete h.stock[key]);h.stock['garlic|clove']=1.5;
 const before=JSON.stringify({recipes:h.recipes,normalized:h.normalized,stock:h.stock});
 assert.equal(h.preview().suggestions.length,1,'three source cloves at half servings require 1.5 cloves');
 assert.equal(JSON.stringify({recipes:h.recipes,normalized:h.normalized,stock:h.stock}),before,'readiness does not rewrite recipe or stock records');
 h.stock['garlic|clove']=1;assert.equal(h.preview().suggestions.length,0,'insufficient clove stock cannot cover the scaled requirement');
 delete h.stock['garlic|clove'];h.stock['garlic|each']=1;
 h.recipes[1].ingredients=[['Garlic','1 bulb']];h.normalized[1].ingredients[0].quantity=1;
 assert.equal(h.preview().suggestions.length,0,'historical each stock does not silently become a bulb');
 delete h.stock['garlic|each'];h.stock['garlic|bulb']=.5;
 assert.equal(h.preview().suggestions.length,1,'an explicitly measured half bulb covers half the source bulb');
});

test('duplicate ingredient rows aggregate requirements and cannot reuse the same quantity twice',()=>{
 const h=fixture();h.recipes[1].ingredients=[['Pasta','200 g'],['Pasta','200 g']];h.normalized[1].ingredients=[{name:'Pasta',key:'pasta',quantity:200,unit:'g',status:'PARSED'},{name:'Pasta',key:'pasta',quantity:200,unit:'g',status:'PARSED'}];
 h.stock['pasta|g']=150;assert.equal(h.preview().suggestions.length,0);
 h.stock['pasta|g']=200;assert.equal(h.preview().suggestions.length,1);
 h.normalized[1].ingredients[1]={name:'Pasta',key:'pasta',quantity:0.2,unit:'kg',status:'PARSED'};
 h.stock['pasta|g']=150;assert.equal(h.preview().suggestions.length,0,'one source cannot satisfy both g and kg rows independently');
});

test('malformed, unverified and unknown-unit recipe amounts never claim Pantry readiness',()=>{
 for(const patch of [{quantity:null},{quantity:0},{quantity:-1},{quantity:NaN},{quantity:'200'},{unit:''},{key:''},{status:'EDITORIAL_ASSUMPTION_UNVERIFIED'},{unit:'mystery'}]){
  const h=fixture();Object.assign(h.normalized[1].ingredients[0],patch);if(patch.key==='')h.normalized[1].ingredients[0].name='';
  h.stock['tinned tuna|mystery']=100;
  assert.equal(h.preview().suggestions.length,0,JSON.stringify(patch));
 }
 const h=fixture();h.normalized[1].ingredients.pop();assert.equal(h.preview().suggestions.length,0,'missing declared ingredient amount blocks the whole dinner');
});

test('normalized amounts must describe the actual declared ingredient rather than a different stocked food',()=>{
 for(const change of [ingredient=>ingredient.name='Chicken breast',ingredient=>{ingredient.name='Chicken breast';ingredient.key='chicken breast';}]){
  const h=fixture();change(h.normalized[1].ingredients[0]);h.stock['chicken breast|g']=100;
  assert.equal(h.preview().suggestions.length,0,'same number of lines is insufficient when a declared food differs');
 }
 const h=fixture();h.normalized[1].ingredients[0].name=' TINNED TUNA ';
 assert.equal(h.preview().suggestions.length,1,'case and surrounding whitespace do not change food identity');
});

test('pending Pantry review and batch-linked nights block suggestions before any plan changes',()=>{
 for(const value of [true,null,undefined]){const h=fixture();h.control.reviewRequired=value;assert.equal(h.preview().suggestions.length,0);assert.equal(h.control.commits,0);}
 for(const day of ['Monday','Wednesday']){const h=fixture();h.control.linked.add(day);assert.equal(h.preview().suggestions.length,0);}
});

test('Evening Pivot requires an explicit verified Premium entitlement before preview or apply',()=>{
 for(const premium of [false,undefined,null,'true',1]){
  const h=fixture(),before=copy(h.state);h.control.premium=premium;
  const result=h.preview();assert.deepEqual(result.suggestions,[]);assert.match(result.reason,/Premium/);
  assert.equal(h.app.apply({day:'Wednesday'},{confirmed:true,readyToCook:true,useBy:{}}).ok,false);
  assert.equal(h.control.commits,0);assert.deepEqual(h.state,before);
 }
});

test('losing verified Premium while reviewing a suggestion prevents saving the swap',()=>{
 const h=fixture(),suggestion=h.preview().suggestions[0],before=copy(h.state),fingerprint=h.app.fingerprint();
 assert.ok(suggestion);h.control.premium=false;
 assert.notEqual(h.app.fingerprint(),fingerprint,'entitlement is part of the review snapshot');
 const result=h.app.apply(suggestion,h.checks(suggestion));
 assert.equal(result.ok,false);assert.match(result.error,/verified Premium/);
 assert.equal(h.control.commits,0);assert.deepEqual(h.state,before);
 assert.deepEqual(h.preview().suggestions,[]);
});

test('applying the exact preview preserves serving counts, desserts, preferences and every Pantry quantity',()=>{
 const h=fixture(),before=copy(h.state),stock=copy(h.stock),suggestion=h.preview().suggestions[0];
 assert.equal(h.app.apply(suggestion,h.checks(suggestion)).ok,true);assert.equal(h.control.commits,1);
 assert.deepEqual(h.state.planned,[{day:'Monday',recipeId:'quick'},{day:'Wednesday',recipeId:'slow'}]);
 assert.deepEqual(h.state.dayServings,{Monday:{recipeId:'quick',count:2},Wednesday:{recipeId:'slow',count:6}});
 assert.deepEqual(h.state.plannedDesserts,before.plannedDesserts);assert.deepEqual(h.state.pantry,before.pantry);assert.deepEqual(h.stock,stock);assert.equal(h.control.extra,'preferences-v1');
 assert.equal(h.app.apply(suggestion,h.checks(suggestion)).ok,false,'an accepted preview cannot save twice');
});

test('use-by dates must be real calendar dates through the new cooking day and both explicit confirmations are required',()=>{
 for(const raw of ['2026-11-03','2026-02-31','not-a-date','2026-11-04T00:00:00Z','']){
  const h=fixture(),s=h.preview().suggestions[0],checks=h.checks(s);checks.useBy[s.requiresFreshness[0].key]=raw;
  assert.equal(h.app.apply(s,checks).ok,false,raw);assert.equal(h.control.commits,0);
 }
 for(const flag of ['confirmed','readyToCook']){const h=fixture(),s=h.preview().suggestions[0],checks=h.checks(s);checks[flag]=false;assert.equal(h.app.apply(s,checks).ok,false);assert.equal(h.control.commits,0);}
 const h=fixture(),s=h.preview().suggestions[0];assert.equal(h.app.apply(s,h.checks(s)).ok,true,'a use-by date on the moved day is allowed');
});

test('new actor, local date, plan, serving count, Pantry or preferences invalidates a pending preview',()=>{
 const edits=[h=>h.control.actor='account-b',h=>h.control.date=new Date(2026,10,3,18),h=>h.state.planned[0].recipeId='other',h=>h.state.dayServings.Wednesday.count=4,h=>h.stock['pasta|g']++,h=>h.control.extra='preferences-v2'];
 for(const edit of edits){const h=fixture(),s=h.preview().suggestions[0];edit(h);const before=copy(h.state);assert.equal(h.app.apply(s,h.checks(s)).ok,false);assert.equal(h.control.commits,0);assert.deepEqual(h.state,before);}
});

test('membership and ingredient access are freshly checked even when the saved data fingerprint is unchanged',()=>{
 for(const edit of [h=>h.control.locked.add('slow'),h=>h.control.locked.add('quick'),h=>h.control.avoided.add('quick'),h=>h.control.linked.add('Wednesday'),h=>h.control.reviewRequired=true]){
  const h=fixture(),s=h.preview().suggestions[0],before=copy(h.state);edit(h);
  assert.equal(h.app.apply(s,h.checks(s)).ok,false);assert.equal(h.control.commits,0);assert.deepEqual(h.state,before);
 }
});

test('only immutable suggestions issued by this adapter can be applied, with failed persistence kept unchanged',()=>{
 const h=fixture(),s=h.preview().suggestions[0],before=copy(h.state);
 assert.equal(Object.isFrozen(s),true);assert.equal(Object.isFrozen(s.requiresFreshness),true);assert.equal(Object.isFrozen(s.candidateRecipe),true);
 assert.throws(()=>{s.requiresFreshness.length=0;},TypeError);
 assert.equal(h.app.apply(copy(s),h.checks(s)).ok,false,'a copied or forged preview has no authority');
 h.control.canSave=false;assert.equal(h.app.apply(s,h.checks(s)).ok,false);assert.equal(h.control.commits,0);assert.deepEqual(h.state,before);
});
