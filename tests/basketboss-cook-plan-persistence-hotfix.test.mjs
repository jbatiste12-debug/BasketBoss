import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const index=fs.readFileSync('index.html','utf8');
const cook=fs.readFileSync('make-a-meal.html','utf8');
const css=fs.readFileSync('bb-cook-plan-hotfix.css','utf8');
const s=index.indexOf('function loadState(){');
const n=index.indexOf('function normalize(s){return',s);
const e=index.indexOf('\nfunction norm(s)',n);
assert.ok(s>0&&n>s&&e>n,'original load/normalize source must be present');
const actualSource=index.slice(s,e);
function loadAsFreshPage(storage,catalogue){
 const ctx={
   KEY:'basketboss_321_unified_state_v1',
   BB_SNAPSHOT:'basketboss_321_unified_recovery_v1',
   OLD_PLAN:'basketboss_321_unified_oldplan_v1',
   OLD_PANTRY:'basketboss_321_unified_oldpantry_v1',
   bbStorageSafe:true,bbRecovered:false,
   DAYS:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
   RECIPES:catalogue,
   localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
   norm:s=>String(s).toLowerCase(),
   console:{warn:()=>{}}
 };
 return vm.runInNewContext(actualSource+'\nJSON.parse(JSON.stringify(loadState()))',ctx);
}
test('Cook opens an independent page; return path is the original Plan app',()=>{
 assert.match(index,/<a class="tab bb173-make-meal-link" href="make-a-meal\.html"[^>]*>/);
 assert.match(cook,/class="back bb17513-meal-back" href="index\.html"/);
});
test('Plan -> Cook -> Plan restores identical Free and deferred Premium meal references and budget storage',()=>{
 const budgetKey='basketboss_v172_weekly_budget_target_v1';
 const key='basketboss_321_unified_state_v1';
 const original={version:2,servings:4,
   planned:[{day:'Wednesday',recipeId:'fajitas'},{day:'Friday',recipeId:'premium-example-loaded-after-auth'}],
   plannedDesserts:[{day:'Sunday',recipeId:'premium-dessert-loaded-after-auth'}],
   pantry:{},customPantry:[],dismissed:[]};
 const storage=new Map([[key,JSON.stringify(original)],[budgetKey,'150']]);
 const initial=loadAsFreshPage(storage,[{id:'fajitas',cost:22.6}]);
 assert.equal(JSON.stringify(initial.planned.map(p=>[p.day,p.recipeId])),JSON.stringify(original.planned.map(p=>[p.day,p.recipeId])));
 // Navigation to Make a Meal performs no writes to the canonical plan storage.
 const before=JSON.stringify([...storage]);
 const returned=loadAsFreshPage(storage,[{id:'fajitas',cost:22.6}]);
 assert.equal(JSON.stringify(returned.planned.map(p=>[p.day,p.recipeId])),JSON.stringify(initial.planned.map(p=>[p.day,p.recipeId])));
 assert.equal(JSON.stringify(returned.plannedDesserts.map(p=>[p.day,p.recipeId])),JSON.stringify(original.plannedDesserts.map(p=>[p.day,p.recipeId])));
 assert.equal(JSON.stringify([...storage]),before);
 assert.equal(storage.get(budgetKey),'150');
 const freeCost=(plan,recipes)=>plan.reduce((v,p)=>v+(recipes.find(r=>r.id===p.recipeId)?.cost||0),0);
 assert.equal(freeCost(initial.planned,[{id:'fajitas',cost:22.6}]),freeCost(returned.planned,[{id:'fajitas',cost:22.6}]));
 const hydrated=loadAsFreshPage(storage,[{id:'fajitas',cost:22.6},{id:'premium-example-loaded-after-auth',cost:12.42},{id:'premium-dessert-loaded-after-auth',cost:5}]);
 assert.equal(JSON.stringify(hydrated.planned.map(p=>[p.day,p.recipeId])),JSON.stringify(original.planned.map(p=>[p.day,p.recipeId])));
 assert.equal(freeCost(hydrated.planned,[{id:'fajitas',cost:22.6},{id:'premium-example-loaded-after-auth',cost:12.42}]),35.02);
});
test('unavailable saved dinner remains visibly reserved, not No meal planned',()=>{
 assert.match(index,/pendingUnloaded=state\.planned\.some\(/);
 assert.match(index,/Saved dinner · waiting for recipe access/);
 assert.match(index,/Reconnect Premium to load its details and estimate/);
});
test('text overflow is scoped to real onboarding, Plan, and header',()=>{
 assert.match(index,/bb-cook-plan-hotfix\.css\?v=20261028-cook-plan-v1/);
 assert.match(css,/#bbNewOnboarding \.bbob-real-shop \.bbob-shop-item/);
 assert.match(css,/grid-template-columns:22px minmax\(0,1fr\) minmax\(0,104px\)/);
 assert.match(css,/overflow-wrap:break-word/);
 assert.match(css,/#app\.bbnext-plan/);
 assert.match(css,/\.shell > header\.top/);
});
test('existing Cook handlers, budget saving, and checkout surface remain intact',()=>{
 assert.match(index,/function openCook\(id\)/);
 assert.match(index,/function bb77CommitTypedBudget\(/);
 assert.match(index,/data-tab="week"/);
 assert.match(index,/bb-onboarding-v2\.js\?v=/);
 assert.match(index,/paddle/i);
});
