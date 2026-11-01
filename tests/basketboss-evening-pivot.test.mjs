import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url),pivot=require('../bb-evening-pivot.js'),servings=require('../bb-serving-scale.js');
const MONDAY=new Date(2026,10,2,18,30);
const makeRecipe=(id,mins,names=['Chicken breast','Fresh ginger','Dry rice'])=>({id,name:id,mins,servings:4,ingredients:names.map(name=>[name,'100 g'])});
function setup(overrides={}){
 const recipes=[makeRecipe('slow',55),makeRecipe('quick',20,['Tinned tuna','Pasta']),makeRecipe('medium',35),makeRecipe('same',55),makeRecipe('tiny',52),makeRecipe('fast',15,['Kidney beans','Rice'])];
 const planned=[{day:'Monday',recipeId:'slow'},{day:'Tuesday',recipeId:'same'},{day:'Wednesday',recipeId:'quick'},{day:'Thursday',recipeId:'medium'},{day:'Friday',recipeId:'tiny'},{day:'Sunday',recipeId:'fast'}];
 return {planned,recipes,date:MONDAY,today:'Monday',allowed:()=>true,recipeAllowed:()=>true,servingsForDay:()=>4,isLinked:()=>false,isReady:()=>true,...overrides};
}
test('offers only faster scheduled dinners later this week using declared cooking minutes',()=>{
 const options=setup(),snapshot=JSON.stringify(options);
 const suggestions=pivot.getSuggestions(options);
 assert.deepEqual(suggestions.map(x=>x.day),['Sunday','Wednesday','Thursday']);
 assert.equal(suggestions[0].minsSaved,40);assert.equal(suggestions[0].candidateRecipe.mins,15);
 assert.equal(suggestions[1].movedDateISO,'2026-11-04');
 assert.equal(suggestions[1].currentRecipe.id,'slow');
 assert.equal(JSON.stringify(options),snapshot,'preview mutates neither recipes nor schedule');
 const unknown=setup({recipes:setup().recipes.map(x=>x.id==='fast'?{...x,mins:'10'}:x)});
 assert.ok(pivot.getSuggestions(unknown).every(x=>x.candidateRecipe.id!=='fast'),'text or unknown duration cannot become a promised quicker dinner');
});
test('local weekday/date blocks past dinners, rollover, mismatches and invalid dates',()=>{
 assert.equal(pivot.getSuggestions(setup({today:'Tuesday'})).length,0);
 assert.equal(pivot.getSuggestions(setup({date:'2026-02-31'})).length,0);
 const friday=setup({date:new Date(2026,10,6,23,59),today:'Friday'});
 assert.deepEqual(pivot.getSuggestions(friday).map(x=>x.day),['Sunday']);
 const sunday=setup({date:new Date(2026,10,8,0,1),today:'Sunday'});
 assert.equal(pivot.getSuggestions(sunday).length,0,'never wraps back to next Monday in the same planner');
 const year=setup({date:new Date(2026,11,28,18,0),today:'Monday'});
 assert.equal(pivot.getSuggestions(year)[0].movedDateISO,'2027-01-03','local calendar arithmetic crosses the year without ISO UTC date shifts');
});
test('membership, ingredient choices, existing batch links and confirmed Pantry readiness all constrain suggestions',()=>{
 const blockedCurrent=setup({allowed:r=>r.id!=='slow'});assert.equal(pivot.getSuggestions(blockedCurrent).length,0);
 const blocked=setup({allowed:r=>r.id!=='fast',recipeAllowed:r=>r.id!=='quick'});
 assert.deepEqual(pivot.getSuggestions(blocked).map(x=>x.candidateRecipe.id),['medium']);
 assert.equal(pivot.getSuggestions(setup({isLinked:day=>day==='Monday'})).length,0);
 assert.deepEqual(pivot.getSuggestions(setup({isLinked:day=>day==='Sunday'})).map(x=>x.day),['Wednesday','Thursday']);
 assert.equal(pivot.getSuggestions(setup({isReady:undefined})).length,0,'unknown Pantry readiness never passes');
 assert.equal(pivot.getSuggestions(setup({isLinked:undefined})).length,0,'a missing linked-night resolver cannot silently move a batch');
 assert.equal(pivot.getSuggestions(setup({isReady:()=>{throw Error('unknown unit');}})).length,0);
 const seen=[];const ready=setup({servingsForDay:day=>day==='Wednesday'?2:6,isReady:(r,context)=>{seen.push([r.id,context]);return r.id==='quick';}});
 const suggestions=pivot.getSuggestions(ready);assert.equal(suggestions.length,1);assert.equal(suggestions[0].candidateServings,2);
 assert.deepEqual(seen.find(x=>x[0]==='quick')[1],{day:'Wednesday',fromDay:'Wednesday',toDay:'Monday',servings:2});
});
test('freshness review distinguishes declared fresh/chilled from frozen, tinned, dried and stock ingredients',()=>{
 const recipe=makeRecipe('check',45,['Chicken breast','Fresh ginger','Onion, finely chopped','Canned tomatoes','Frozen peas','Dried basil','Chicken stock','Dry rice','Egg noodles','Butter beans','Coconut milk','Black pepper','Special meal component']);
 const fresh=pivot.freshIngredients(recipe);
 assert.deepEqual(fresh.filter(x=>x.kind==='fresh').map(x=>x.key),['chicken breast','ginger','onion']);
 assert.ok(fresh.some(x=>x.name==='Special meal component'&&x.kind==='check'));
 assert.equal(fresh.some(x=>/frozen|canned|stock|dried|rice|noodles|butter beans|coconut milk|black pepper/.test(x.key)),false);
 const structured=pivot.freshIngredients({ingredients:[{name:'Spinach',key:'spinach',state:'frozen'},{name:'Milk',key:'milk',state:'chilled'},{name:'Unknown preparation',key:'unknown'}]});
 assert.deepEqual(structured.map(x=>[x.key,x.kind]),[['milk','fresh'],['unknown','check']]);
 assert.equal(pivot.freshIngredients({name:'Unknown ingredients'}).at(0).kind,'check');
});
test('meat remains perishable when its declared ingredient also names oil, honey or spices',()=>{
 const inputs=['Raw chicken in olive oil','Honey glazed chicken breast','Paprika chicken thighs','Chicken breast marinated in oil','Chicken with garlic powder'];
 for(const name of inputs){
  const fresh=pivot.freshIngredients(makeRecipe('compound',45,[name]));
  assert.equal(fresh.length,1,name);assert.equal(fresh[0].kind,'fresh',name);
 }
 const structured=pivot.freshIngredients({ingredients:[{name:'Chicken in honey glaze',state:'chilled'},{name:'Fresh chicken broth',state:'refrigerated'}]});
 assert.equal(structured.length,2);
 const preserved=pivot.freshIngredients(makeRecipe('preserved',45,['Chicken stock','Chicken broth','Chicken stock cubes','Tinned fish in olive oil','Frozen chicken breast','Dried herbs','Fish sauce','Tomato paste']));
 assert.deepEqual(preserved,[]);
 assert.equal(pivot.freshIngredients(makeRecipe('thawed',45,['Frozen chicken, defrosted']))[0].kind,'fresh');
});
test('known use-by dates block moving current fresh ingredients beyond their date without inventing missing dates',()=>{
 const options=setup({useBy:{'chicken breast':'2026-11-04'}});
 const suggestions=pivot.getSuggestions(options);
 assert.deepEqual(suggestions.map(x=>x.day),['Wednesday']);
 const chicken=suggestions[0].requiresFreshness.find(x=>x.key==='chicken breast');assert.equal(chicken.useByISO,'2026-11-04');
 const ginger=suggestions[0].requiresFreshness.find(x=>x.key==='ginger');assert.equal('useByISO' in ginger,false,'unknown date stays unknown');
 assert.equal(pivot.getSuggestions(setup({useBy:{'chicken breast':'2026-11-01'}})).length,0);
 assert.equal(pivot.getSuggestions(setup({useBy:{'chicken breast':'2026-02-31'}})).length,3,'malformed date is left for user review');
 assert.equal(pivot.getSuggestions(setup({useBy:key=>key==='chicken breast'?'2026-11-04':null})).length,1);
});
test('pure swap preview carries actual serving counts with both recipes and preserves unrelated overrides',()=>{
 const options=setup(),state={planned:options.planned,servings:4,mealServings:{quick:3},dayServings:{Monday:{recipeId:'slow',count:6},Thursday:{recipeId:'medium',count:5}}};
 const before=JSON.stringify(state);
 const result=pivot.previewSwap({...options,day:'Wednesday',dayServings:state.dayServings,servingsForDay:(day,recipe)=>servings.forMeal(state,{day,recipeId:recipe.id},recipe)});
 assert.equal(result.planned.find(x=>x.day==='Monday').recipeId,'quick');
 assert.equal(result.planned.find(x=>x.day==='Wednesday').recipeId,'slow');
 assert.deepEqual(result.dayServings.Monday,{recipeId:'quick',count:3});
 assert.deepEqual(result.dayServings.Wednesday,{recipeId:'slow',count:6});
 assert.deepEqual(result.dayServings.Thursday,state.dayServings.Thursday);
 assert.equal(JSON.stringify(state),before,'pure preview never saves or edits the input');
 const amounts=plan=>plan.reduce((sum,p)=>{const r=options.recipes.find(x=>x.id===p.recipeId);return sum+servings.forMeal(plan===state.planned?state:{...state,...result},p,r)/r.servings;},0);
 assert.equal(amounts(state.planned),amounts(result.planned),'identical recipe multipliers preserve shopping ingredients through a swap');
 assert.equal(pivot.previewSwap({...options,day:'Monday'}),null);
 assert.equal(pivot.previewSwap({...options,day:'Saturday'}),null);
 assert.equal(pivot.previewSwap({...options,day:'Wednesday',servingsForDay:()=>null}),null);
});
test('actual public recipes use existing planned meal IDs, ingredient declarations and cooking durations',()=>{
 const recipes=JSON.parse(fs.readFileSync(new URL('../recipes.json',import.meta.url),'utf8'));
 const slow=recipes.find(x=>x.mins>=45),quick=recipes.find(x=>x.mins<=25);
 const suggestions=pivot.getSuggestions(setup({recipes,planned:[{day:'Monday',recipeId:slow.id},{day:'Friday',recipeId:quick.id}]}));
 assert.equal(suggestions.length,1);assert.equal(suggestions[0].candidateRecipe,quick);assert.equal(suggestions[0].currentRecipe,slow);
 assert.equal(suggestions[0].minsSaved,slow.mins-quick.mins);
 assert.ok(suggestions[0].requiresFreshness.length>0);
});
