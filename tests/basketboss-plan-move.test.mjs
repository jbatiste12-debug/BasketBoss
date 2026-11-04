import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {move}=require('../bb-plan-move.js');
const servings=require('../bb-serving-scale.js');
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
const state=()=>({
  planned:[{day:'Monday',recipeId:'fish',note:'Keep entry metadata'},{day:'Wednesday',recipeId:'pasta'},{day:'Friday',recipeId:'curry'}],
  dayServings:{Monday:{recipeId:'fish',count:5,source:'manual'},Wednesday:{recipeId:'pasta',count:2},Friday:{recipeId:'curry',count:4}},
  servings:4,mealServings:{fish:3,pasta:6},plannedDesserts:[{day:'Monday',recipeId:'brownies'}],
  bbManualBatch:null,pantry:{rice:200}
});

test('moving into an empty day preserves the meal, its portions and unrelated plan data',()=>{
  const input=freeze(state()),before=JSON.stringify(input),result=move(input,'Monday','Tuesday',{expectedRecipeId:'fish'});
  assert.equal(result.ok,true);assert.equal(result.swapped,false);
  assert.deepEqual(result.planned,[{day:'Tuesday',recipeId:'fish',note:'Keep entry metadata'},{day:'Wednesday',recipeId:'pasta'},{day:'Friday',recipeId:'curry'}]);
  assert.deepEqual(result.dayServings,{Tuesday:{recipeId:'fish',count:5,source:'manual'},Wednesday:{recipeId:'pasta',count:2},Friday:{recipeId:'curry',count:4}});
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(Object.keys(result).sort(),['dayServings','ok','planned','swapped']);
  assert.notEqual(result.planned[0],input.planned[0]);assert.notEqual(result.dayServings.Tuesday,input.dayServings.Monday);
});

test('dropping onto an occupied day swaps both dinners and their independent serving overrides',()=>{
  const input=freeze(state()),result=move(input,'Monday','Wednesday');
  assert.equal(result.ok,true);assert.equal(result.swapped,true);
  assert.deepEqual(result.planned.map(row=>[row.day,row.recipeId]),[['Wednesday','fish'],['Monday','pasta'],['Friday','curry']]);
  assert.deepEqual(result.dayServings.Wednesday,{recipeId:'fish',count:5,source:'manual'});
  assert.deepEqual(result.dayServings.Monday,{recipeId:'pasta',count:2});
  assert.equal(servings.forMeal({...input,...result},{day:'Wednesday',recipeId:'fish'},{servings:4}),5);
  assert.equal(servings.forMeal({...input,...result},{day:'Monday',recipeId:'pasta'},{servings:4}),2);
});

test('a null portion marker follows its meal and continues overriding legacy recipe portions',()=>{
  const input=state();input.dayServings.Monday={recipeId:'fish',count:null};input.servings=4;input.mealServings.fish=10;
  const result=move(freeze(input),'Monday','Wednesday');
  assert.equal(result.ok,true);assert.deepEqual(result.dayServings.Wednesday,{recipeId:'fish',count:null});
  assert.equal(servings.forMeal({...input,...result},{day:'Wednesday',recipeId:'fish'},{servings:2}),4);
});

test('stale overrides on either affected day cannot attach to a different meal',()=>{
  const input=state();input.dayServings.Monday={recipeId:'old-chicken',count:9};input.dayServings.Wednesday={recipeId:'old-beef',count:8};
  const result=move(freeze(input),'Monday','Wednesday');
  assert.equal(result.ok,true);assert.deepEqual(result.dayServings,{Friday:{recipeId:'curry',count:4}});
  const empty=state();empty.dayServings.Tuesday={recipeId:'old-dinner',count:8};
  const next=move(freeze(empty),'Monday','Tuesday');
  assert.equal(next.ok,true);assert.deepEqual(next.dayServings.Tuesday,{recipeId:'fish',count:5,source:'manual'});
  assert.equal(Object.hasOwn(next.dayServings,'Monday'),false);
});

test('the same recipe on two days keeps per-occurrence portions when the days swap',()=>{
  const input={planned:[{day:'Monday',recipeId:'fish'},{day:'Wednesday',recipeId:'fish'}],dayServings:{Monday:{recipeId:'fish',count:2},Wednesday:{recipeId:'fish',count:7}}};
  const result=move(freeze(input),'Monday','Wednesday');
  assert.equal(result.ok,true);assert.equal(result.swapped,true);
  assert.equal(result.planned.length,2);assert.equal(result.dayServings.Monday.count,7);assert.equal(result.dayServings.Wednesday.count,2);
});

test('protected source and target days reject moves without mutating the plan',()=>{
  for(const blockedDays of [['Monday'],['Tuesday'],['Monday','Tuesday']]){
    const input=freeze(state()),before=JSON.stringify(input),result=move(input,'Monday','Tuesday',{blockedDays});
    assert.equal(result.ok,false);assert.match(result.message,/unavailable/i);assert.equal(JSON.stringify(input),before);
  }
});

test('a changed source, missing dinner or invalid target cannot produce a replacement plan',()=>{
  for(const [from,to,context]of [['Monday','Wednesday',{expectedRecipeId:'changed'}],['Tuesday','Wednesday',{}],['Monday','Tuesday',{expectedRecipeId:''}],['Monday','Monday',{}],['Monday','Holiday',{}],['Holiday','Monday',{}]]){
    const result=move(freeze(state()),from,to,context);
    assert.equal(result.ok,false);assert.equal(typeof result.message,'string');assert.equal(Object.hasOwn(result,'planned'),false);
  }
});

test('ambiguous or malformed saved plans and serving counts fail instead of silently changing data',()=>{
  for(const changed of [null,{},[],{planned:null},{planned:[{day:'Monday',recipeId:'fish'},{day:'Monday',recipeId:'pasta'}]},{planned:[{day:'Unknown',recipeId:'fish'}]},{planned:[{day:'Monday',recipeId:''}]},{planned:[null]},{planned:[{day:'Monday',recipeId:'fish'}],dayServings:[]}]){
    assert.equal(move(changed,'Monday','Tuesday').ok,false);
  }
  for(const count of [0,13,-1,2.5,NaN,Infinity,undefined,'5',true]){
    const input=state();input.dayServings.Monday={recipeId:'fish',count};const before=JSON.stringify(input);
    assert.equal(move(freeze(input),'Monday','Tuesday').ok,false,String(count));assert.equal(JSON.stringify(input),before);
  }
  const input=state();assert.equal(move(input,'Monday','Tuesday',{blockedDays:'Monday'}).ok,false);
});

test('a missing day-servings map is accepted without inventing per-day or child portions',()=>{
  const input=freeze({planned:[{day:'Monday',recipeId:'fish'}],servings:5,mealServings:{fish:3}}),result=move(input,'Monday','Tuesday');
  assert.equal(result.ok,true);assert.deepEqual(result.dayServings,{});
  assert.equal(servings.forMeal({...input,...result},{day:'Tuesday',recipeId:'fish'},{servings:4}),3);
});

test('the browser export is pure and does not require DOM, storage or network APIs',()=>{
  const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(new URL('../bb-plan-move.js',import.meta.url),'utf8'),context);
  const result=context.window.BBPlanMove.move({planned:[{day:'Monday',recipeId:'fish'}]},'Monday','Tuesday');
  assert.equal(result.ok,true);assert.equal(result.planned[0].day,'Tuesday');assert.equal(Object.isFrozen(context.window.BBPlanMove),true);
});
