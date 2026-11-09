import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),planning=require('../bb-recipe-planning.js');
const coreSource=fs.readFileSync(new URL('../bb-ingredient-preferences.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const real=JSON.parse(fs.readFileSync(new URL('../recipes.json',import.meta.url),'utf8'));
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function core(){
 const map=new Map(),handlers=new Map();let writes=true;
 const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>{if(!writes)throw Error('Storage full');map.set(key,value)}};
 const root={localStorage:storage,addEventListener:(name,fn)=>handlers.set(name,fn)};
 const context=vm.createContext({window:root,console});vm.runInContext(coreSource,context);
 return {api:root.BBIngredientPreferences,root,map,storage,handlers,setWrites:value=>writes=value,
  account:id=>{if(id)map.set('basketboss_cloud_session_v1',JSON.stringify({user:{id}}));else map.delete('basketboss_cloud_session_v1');handlers.get('basketboss:session-changed')?.();}};
}
const recipe=(...names)=>({id:'test',ingredients:names.map(name=>[name,'100 g'])});
test('chicken avoidance includes declared cuts, cooked/frozen forms and stock without matching chickpeas',()=>{
 const {api}=core();
 for(const name of ['Chicken','Whole chicken','Chicken thighs','Chicken breast','Cooked chicken','Frozen chicken','Chicken stock','Chicken or vegetable stock'])assert.equal(api.recipeAllowed(recipe(name),['chicken']),false,name);
 for(const name of ['Chickpeas','Chickpea flour','Vegetable stock','Firm tofu','Eggplant'])assert.equal(api.recipeAllowed(recipe(name),['chicken']),true,name);
 assert.equal(api.recipeAllowed({name:'Chicken-style chickpea dinner',ingredients:[['Chickpeas','1 tin']]},['chicken']),true,'dish title is not declared ingredient evidence');
});
test('structured ingredient arrays, name/key objects and strings share the matching contract',()=>{
 const {api}=core();
 for(const ingredients of [[['Chicken thighs','400 g']],[{name:'Chicken thighs',quantity:400,unit:'g'}],[{key:'chicken_stock',name:'Stock',quantity:1}],['Chicken breast']])assert.equal(api.recipeAllowed({ingredients},['chicken']),false);
 assert.equal(api.recipeAllowed(null,['chicken']),false);
 assert.deepEqual(Array.from(api.matches(recipe('Chicken stock','Onions'),['onion','chicken','invalid','chicken'])),['chicken','onion']);
});
test('distinct similarly named foods do not create substring exclusions',()=>{
 const {api}=core();
 const pairs=[['milk','Coconut milk'],['milk','Oat milk'],['butter','Butter beans'],['butter','Peanut butter'],['cream','Coconut cream'],['eggs','Aubergine / eggplant'],['peas','Chickpeas'],['peppers','Black pepper'],['peppers','Peppercorn sauce'],['potatoes','Sweet potatoes'],['olives','Olive oil'],['pork','Graham crackers'],['beans','Vanilla beans']];
 for(const [id,name] of pairs)assert.equal(api.recipeAllowed(recipe(name),[id]),true,`${id}: ${name}`);
 for(const [id,name] of [['pork','Pork sausages'],['pork','Sausages'],['beef','Sirloin steaks'],['fish','Cooked salmon (from 2 fillets)'],['fish','Tinned tuna'],['lamb','Vegetable or lamb stock'],['onion','Spring onions'],['peppers','Mixed peppers'],['tomatoes','Passata'],['cheese','Parmesan'],['eggs','Egg noodles']])assert.equal(api.recipeAllowed(recipe(name),[id]),false,`${id}: ${name}`);
 assert.equal(api.recipeAllowed(recipe('Cauliflower steaks'),['beef']),true);
 assert.equal(api.recipeAllowed(recipe('Chicken sausages'),['pork']),true);
});
test('real public recipes containing chicken or its stock are all excluded while other dinners remain',()=>{
 const {api}=core();
 const declared=real.filter(r=>r.ingredients.some(i=>/\bchicken\b/i.test(i[0])));
 assert.ok(declared.length>=15,'real preparation forms and stock-bearing dishes');
 for(const r of declared)assert.equal(api.recipeAllowed(r,['chicken']),false,r.name);
 const remaining=real.filter(r=>planning.isDinner(r)&&api.recipeAllowed(r,['chicken']));
 assert.ok(remaining.length>=25);
 assert.ok(remaining.some(r=>r.ingredients.some(i=>/chickpeas/i.test(i[0]))),'chickpea dinners remain available');
});
test('choices persist independently per account, validate IDs, and notify only after a successful save',()=>{
 const h=core(),updates=[];h.api.subscribe(value=>updates.push(value));
 assert.equal(h.map.size,0,'loading is read-only');
 assert.equal(h.api.setSelected(['chicken','chicken','onion']).ok,true);
 assert.deepEqual(Array.from(h.api.getSelected()),['chicken','onion']);
 h.account('account-a');assert.equal(h.api.getSelected().length,0);
 assert.equal(h.api.setSelected(['fish']).ok,true);
 h.account('account-b');assert.equal(h.api.getSelected().length,0);
 h.account('account-a');assert.deepEqual(Array.from(h.api.getSelected()),['fish']);
 const count=updates.length;h.setWrites(false);
 assert.equal(h.api.setSelected(['beef']).ok,false);
 assert.deepEqual(Array.from(h.api.getSelected()),['fish']);assert.equal(updates.length,count);
 assert.equal(h.api.setSelected(['not-an-ingredient']).ok,false);
 h.account(null);assert.deepEqual(Array.from(h.api.getSelected()),['chicken','onion']);
});
test('unified planner adapter keeps cloud backup values scoped and rolls back failed persistence',()=>{
 const h=core();let saved=null,canWrite=true;
 h.api.configure({read:()=>saved,write:value=>{if(!canWrite)return false;saved=value;return true;}});
 assert.equal(h.api.setSelected(['chicken']).ok,true);
 assert.deepEqual(JSON.parse(JSON.stringify(saved)),{version:1,scope:'guest',excluded:['chicken']});
 const backedUp=JSON.parse(JSON.stringify(saved));
 h.account('signed-in');assert.equal(h.api.getSelected().length,0,'guest choices are not another account preferences');
 assert.equal(h.api.setSelected(['fish']).ok,true);assert.deepEqual(Array.from(h.api.getSelected()),['fish']);
 h.account(null);assert.equal(h.api.getSelected().length,0,'other account choices remain hidden until own cloud restore');saved=backedUp;assert.deepEqual(Array.from(h.api.getSelected()),['chicken']);
 h.account('signed-in');saved={version:1,scope:'signed-in',excluded:['fish']};assert.deepEqual(Array.from(h.api.getSelected()),['fish']);
 canWrite=false;assert.equal(h.api.setSelected(['chicken']).ok,false);assert.deepEqual(Array.from(h.api.getSelected()),['fish']);
 h.account(null);saved=backedUp;assert.deepEqual(Array.from(h.api.getSelected()),['chicken']);
 h.root.BBAccountDeletion={isDeleting:()=>true};canWrite=true;
 assert.equal(h.api.setSelected(['beef']).ok,false);assert.deepEqual(Array.from(h.api.getSelected()),['chicken']);
 assert.equal(h.api.normalize({version:99,scope:'guest',excluded:['chicken']}),null);
 assert.deepEqual(JSON.parse(JSON.stringify(h.api.normalize({version:1,scope:'guest',excluded:['chicken','bad','chicken']}))),{version:1,scope:'guest',excluded:['chicken']});
});

const blockStart=html.indexOf("const BB_AF_DAYS=['Monday'");
const blockEnd=html.indexOf('/* END_BASKETBOSS_AUTOFILL_VARIETY_ROTATION_V1 */',blockStart);
const drawSource=html.match(/function bbPlanVarietyValid\(plans(?:,softProteinAdjacency=false)?\)\{[\s\S]*?\n\}/)[0]+'\n'+html.slice(blockStart,blockEnd);
function planner(recipes=real){
 const h=core(),state={planned:[],bb81Batch:null},notices=[];let saves=0;
 const context={BBRecipeEditorial:require('../bb-recipe-editorial.js'),RECIPES:recipes,state,localStorage:h.storage,console,BBRecipePlanning:planning,BBIngredientPreferences:h.api,DAYS,
  getRecipe:id=>recipes.find(r=>r.id===id),bb176AllowedRecipe:()=>true,
  bb81Under30:()=>true,bb81KidOK:()=>true,bb81BatchOK:()=>true,bb81ProteinScore:()=>3,
  bb83FridgeStockKeys:()=>new Set(),bb172QuickDinners:()=>({}),persist:()=>{saves++;return true;},render:()=>{},notify:msg=>notices.push(msg)};
 context.bbRotationSession=()=>planning.createRotation({recipes,storage:h.storage,isAllowed:()=>true,isEligible:r=>h.api.recipeAllowed(r),scope:'guest'});
 vm.createContext(context);vm.runInContext(drawSource,context);
 const api=vm.runInContext('({draw:bbAfDraw,commit:bbAfCommit})',context);
 return {...h,api: h.api,draw:api.draw,commit:api.commit,state,notices,context,get saves(){return saves;}};
}
test('ordinary and Premium Auto-fill repeatedly honor chicken avoidance, preserving existing meals',()=>{
 const h=planner();h.api.setSelected(['chicken']);
 const original=real.find(r=>!h.api.recipeAllowed(r,['chicken']));
 h.state.planned=[{day:'Monday',recipeId:original.id}];
 for(const filters of [{},{quick:true,protein:true,kids:true}]){
  const old=h.state.planned,chosen=h.draw(DAYS.slice(1),old,filters);
  assert.ok(chosen?.additions.length);
  for(const meal of chosen.additions)assert.equal(h.api.recipeAllowed(real.find(r=>r.id===meal.recipeId)),true);
  assert.equal(h.commit(old,JSON.stringify(old),'{}',null,chosen),true);
  assert.equal(h.state.planned[0].recipeId,original.id,'earlier manually planned meal is preserved');
  h.state.planned=[old[0]];
 }
});
test('excluding the complete pool returns no suggestion and never silently falls back or writes a plan',()=>{
 const chicken=real.filter(r=>planning.isDinner(r)&&r.ingredients.some(i=>/\bchicken\b/i.test(i[0])));
 const h=planner(chicken);h.api.setSelected(['chicken']);
 const before=JSON.stringify(h.state),entries=h.map.size;
 assert.equal(h.draw(DAYS,[]),null);
 assert.equal(JSON.stringify(h.state),before);assert.equal(h.saves,0);assert.equal(h.map.size,entries);
});
test('a missing preference script blocks Auto-fill and keeps stored ingredient choices during unrelated saves',()=>{
 const h=planner();delete h.context.BBIngredientPreferences;
 assert.equal(h.draw(DAYS,[]),null);assert.equal(h.saves,0);
 const normalizeSource=html.match(/function normalize\(s\)\{[^\n]+\}/)[0];
 const context=vm.createContext({DAYS,BBPlanExtras:require('../bb-plan-extras.js'),BBServing:{validOverrides:()=>({}),validDayOverrides:()=>({})}});
 vm.runInContext(normalizeSource,context);
 context.saved={version:2,ingredientAvoidance:{version:1,scope:'guest',excluded:['chicken','future-food']}};
 const value=vm.runInContext('normalize(saved)',context);
 assert.deepEqual(JSON.parse(JSON.stringify(value.ingredientAvoidance)),context.saved.ingredientAvoidance);
});
test('changing ingredient choices during confirmation rejects stale selections and leaves the plan untouched',()=>{
 const h=planner(),old=h.state.planned,selection=h.draw(DAYS,old);assert.ok(selection?.additions.length);
 h.api.setSelected(h.api.CATALOG.map(x=>x.id));
 assert.equal(h.commit(old,JSON.stringify(old),'{}',null,selection),false);
 assert.equal(h.state.planned,old);assert.equal(h.saves,0);
});
test('the ingredient-filtered eligible rotation resets after every currently allowed dinner is consumed',()=>{
 const h=planner();h.api.setSelected(['chicken']);
 const eligible=real.filter(r=>planning.isDinner(r)&&h.api.recipeAllowed(r));
 for(const r of eligible){
  const rotation=h.context.bbRotationSession();assert.equal(rotation.take(r,{day:'Monday',planned:[]}),true,r.name);assert.equal(rotation.commit(),true);
 }
 const next=h.context.bbRotationSession();assert.equal(next.snapshot().eligibleCount,eligible.length);
 assert.ok(next.choose(eligible,{day:'Monday',planned:[]}),'avoided chicken never prevents the allowed rotation resetting');
 assert.equal(next.snapshot().cycle,1);
});

test('Pantry suggestions and the final Populate Planner recheck both respect ingredient choices',()=>{
 const h=core();h.api.setSelected(['chicken']);
 const recipes=[{id:'chicken',name:'Chicken dinner',category:'Family',ingredients:[['Chicken breast','100 g']]},{id:'beans',name:'Bean dinner',category:'Family',ingredients:[['Kidney beans','100 g']]}];
 const state={planned:[],servings:4};let saves=0;
 const names=recipes.map(r=>({...r,ingredients:r.ingredients.map(i=>({name:i[0],key:i[0],quantity:100,unit:'g'}))}));
 const context={RECIPES:recipes,BB307_NORMALIZED:names,BBIngredientPreferences:h.api,BBPriceV19:require('../basketboss-pricing-v19.js'),state,DAYS,
  bb307ReadStock:()=>({'chicken breast|g':100,'kidney beans|g':100}),
  bb176AllowedRecipe:()=>true,bb172IsDessertOrNonDinner:()=>false,
  getRecipe:id=>recipes.find(r=>r.id===id),bb172QuickDinners:()=>({}),bbBatchPairs:()=>[],bbPartialRound:n=>n,
  BB307Pantry:{pantryName:name=>name.toLowerCase(),pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,reconcileStock:(stock,items)=>({pantry:Object.fromEntries(items.map(i=>[i.key.toLowerCase()+'|'+i.unit,stock[i.key.toLowerCase()+'|'+i.unit]||0]))})},
  persist:()=>{saves++;return true;},render:()=>{}};
 const source=html.match(/function bbAfIngredientAllowed\(r\)\{[^\n]+\}/)[0]+'\n'+html.slice(html.indexOf('function bbPantryRecipeMatches(){'),html.indexOf('function bbPantryPlannerModal(){'));
 vm.createContext(context);vm.runInContext(source,context);
 const result=vm.runInContext('bbPantryRecipeMatches()',context);assert.deepEqual(Array.from(result.recipes,x=>x.id),['beans']);
 // A previously displayed recipe is rechecked, not blindly trusted by ID.
 const added=vm.runInContext("bbPantryPlannerPopulate([{id:'chicken'},{id:'beans'}])",context);
 assert.equal(added.ok,true);assert.deepEqual(Array.from(state.planned,x=>x.recipeId),['beans']);assert.equal(saves,1);
});
