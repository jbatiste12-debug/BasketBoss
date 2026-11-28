import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {householdPlanCaptureSource} from './helpers/household-plan-capture.mjs';

const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const KEY='plan';
const section=(start,end)=>{
 const first=html.indexOf(start),last=html.indexOf(end,first);
 assert.ok(first>=0&&last>first,start);
 return html.slice(first,last);
};
const persistSource=section('function persist(){','/* Shared household intent');
const hooks=householdPlanCaptureSource(html);
const clone=value=>JSON.parse(JSON.stringify(value));
function initialState(){return {version:2,planned:DAYS.map((day,index)=>({day,recipeId:'meal'+index})),plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,mealServings:{meal0:6},dayServings:{Monday:{recipeId:'meal0',count:null},Sunday:{recipeId:'meal6',count:3}},pantry:{},leftoverSources:{},leftoverConfirmed:{},bbManualBatch:null,bb81Batch:null};}
function harness(extra={}){
 const state=initialState(),values=new Map([[KEY,JSON.stringify(state)]]),captures=[],settings=[],pantry=[];
 let blocked=false;
 const ctx={state,KEY,DAYS,BB_SNAPSHOT:'recovery',bbStorageSafe:true,console:{warn(){},error(){}},
  localStorage:{getItem:key=>values.get(key)??null,setItem(key,value){if(blocked)throw Error('storage failed');values.set(key,String(value));},removeItem:key=>values.delete(key)},
  document:{getElementById:()=>null,querySelector:()=>null},notify(){},render(){},
  window:{BBHouseholdSharingAuto:{capturePlanEdit:edit=>captures.push(clone(edit)),captureSettingEdit:edit=>settings.push(clone(edit)),capturePantryEdit:edit=>pantry.push(clone(edit))}},
  ...extra};
 vm.createContext(ctx);vm.runInContext(persistSource+hooks,ctx);
 return {ctx,values,captures,settings,pantry,run:code=>vm.runInContext(code,ctx),block:()=>{blocked=true;}};
}

test('ordinary persistence and a received household refresh create no edit intent',()=>{
 const h=harness();h.ctx.state.planned=[];
 assert.equal(h.run('persist()'),true);assert.equal(h.captures.length,0);
 Object.assign(h.ctx,{bb307Stock:{},bb307FeatureState:{},bbCanRefreshSharedHousehold:()=>true,normalize:clone,bb307ReadStock:()=>({'rice|g':200}),bb307ReadFeatures:()=>({version:1})});
 vm.runInContext(section('function bbRefreshSharedHousehold(pin){','async function bbPrepareSharedHouseholdRecipes'),h.ctx);
 h.ctx.received=JSON.stringify(initialState());
 assert.equal(h.run('bbRefreshSharedHousehold({expected:received})'),true);
 assert.equal(h.ctx.state.planned.length,7);assert.equal(h.captures.length,0);
});

test('explicit edits capture exact saved bytes, preserving every cleared day and recipe-bound null defaults',()=>{
 const h=harness(),before=h.values.get(KEY);
 h.ctx.state.planned=[];
 assert.equal(h.run('bbPersistSharedPlanEdit()'),true);
 assert.deepEqual(h.captures,[{before,after:h.values.get(KEY)}]);
 const capturedBefore=JSON.parse(h.captures[0].before),capturedAfter=JSON.parse(h.captures[0].after);
 assert.deepEqual(capturedBefore.planned.map(row=>row.day),DAYS);
 assert.deepEqual(capturedAfter.planned,[]);
 assert.deepEqual(capturedAfter.dayServings.Monday,{recipeId:'meal0',count:null});
 assert.deepEqual(capturedAfter.dayServings.Sunday,{recipeId:'meal6',count:3});
});

test('failed local saves and unreadable before snapshots do not create edit intent',()=>{
 for(const deletion of [false,true]){
  const h=harness(),before=h.values.get(KEY);h.ctx.state.planned=[];
  if(deletion)h.ctx.window.BBAccountDeletion={isDeleting:()=>true};else h.block();
  assert.equal(h.run('bbPersistSharedPlanEdit()'),false);
  assert.equal(h.values.get(KEY),before);assert.equal(h.captures.length,0);
 }
 const h=harness();h.ctx.persist=()=>true;h.ctx.localStorage.getItem=()=>{throw Error('unavailable');};
 assert.equal(h.run('bbPersistSharedPlanEdit()'),true);assert.equal(h.captures.length,0);
});

test('optional sharing failures leave successful device saves successful',()=>{
 const h=harness();h.ctx.window.BBHouseholdSharingAuto.capturePlanEdit=()=>{throw Error('offline queue unavailable');};
 h.ctx.state.servings=7;
 assert.equal(h.run('bbPersistSharedPlanEdit()'),true);
 assert.equal(JSON.parse(h.values.get(KEY)).servings,7);
});

test('autofill emits intent only after its rotation transaction succeeds',()=>{
 for(const rotationOK of [false,true]){
  const h=harness(),before=h.values.get(KEY),previous=h.ctx.state.planned;
  Object.assign(h.ctx,{bb172QuickDinners:()=>({}),bb176AllowedRecipe:()=>true,bbAfIngredientAllowed:()=>true,getRecipe:id=>({id}),bbAfWorldCount:()=>0,bbPlanVarietyValid:()=>true,bbRecordPlannedRecipes(){}});
  vm.runInContext(section('function bbAfCommit(','/* END_BASKETBOSS_AUTOFILL_VARIETY_ROTATION_V1 */'),h.ctx);
  h.ctx.previous=previous;h.ctx.selection={additions:[{day:'Monday',recipeId:'replacement'}],rotation:{commit:()=>rotationOK}};
  // Keep only an empty old plan so the selection is valid without duplicating days.
  h.ctx.state.planned=[];h.ctx.previous=h.ctx.state.planned;h.run('persist()');const old=h.values.get(KEY);
  assert.equal(h.run("bbAfCommit(previous,'[]','{}',null,selection)"),rotationOK);
  assert.equal(h.captures.length,rotationOK?1:0);
  if(rotationOK){assert.equal(h.captures[0].before,old);assert.equal(JSON.parse(h.captures[0].after).planned[0].recipeId,'replacement');}
  else assert.equal(h.values.get(KEY),old);
  assert.ok(before);
 }
});

test('the earlier budget autofill also waits for rotation success before recording intent',()=>{
 for(const rotationOK of [false,true]){
  const h=harness();Object.assign(h.ctx,{bb176AllowedRecipe:()=>true,bbAfIngredientAllowed:()=>true,getRecipe:id=>({id}),bb172Msg(){},bbRecordPlannedRecipes(){},bbRotationMessage:()=>''});
  vm.runInContext(section('function bbCommitRotation(','function getRecipe(')+section('function bb172ApplyPlan(','function bb172AutoFill('),h.ctx);
  h.ctx.old=h.ctx.state.planned;h.ctx.next=[];h.ctx.rotation={commit:()=>rotationOK};
  assert.equal(h.run("bb172ApplyPlan(next,old,'updated',rotation)"),rotationOK);
  assert.equal(h.captures.length,rotationOK?1:0);
 }
});

test('clearing the week emits no intent if the shopping-session close rolls back the plan',async()=>{
 for(const closeOK of [false,true]){
  const h=harness({clear:{},crypto:{randomUUID:()=> 'next'},bbQaConfirm:async()=>true,bbShopV7Close:()=>closeOK,bb80OpenPlanDays:new Set(),bb80RememberPlanDays(){},bbNextExpandedPlanDay:null});
  const before=h.values.get(KEY);
  vm.runInContext(section('      clear.onclick=async()=>{','      oldIntro.append(clear);'),h.ctx);
  await h.run('clear.onclick()');
  assert.equal(h.captures.length,closeOK?1:0);
  if(closeOK){assert.equal(h.captures[0].before,before);assert.deepEqual(JSON.parse(h.captures[0].after).planned,[]);}
  else assert.equal(h.values.get(KEY),before);
 }
});

function savedWeekHarness(commitOK){
 const h=harness(),before=h.values.get(KEY),week=initialState();week.planned=[];week.customDinners={};week.lunch={children:1,days:{},menus:{}};
 const initial={ready:true,actor:'person',fingerprint:'same',raw:{[KEY]:before},plan:h.ctx.state,lunch:week.lunch,notes:{}};
 Object.assign(h.ctx,{crypto:{randomUUID:()=> 'new-generation'},BB321_LUNCH_KEY:'lunch',BB172_QUICK_DINNER_KEY:'notes',
  bbSavedWeekSnapshot:()=>initial,bb176AllowedRecipe:()=>true,getRecipe:id=>({id}),BB321Lunch:{normaliseLunchbox:clone},bb321LunchState:week.lunch,
  bbShopV7Close:({updates})=>{if(!commitOK)return false;for(const [key,value]of Object.entries(updates))h.values.set(key,JSON.stringify(value));return true;},
  bbRecordPlannedRecipes(){},bb80OpenPlanDays:new Set(),bb80RememberPlanDays(){},bbNextExpandedPlanDay:null,
  window:{...h.ctx.window,BBSavedWeeks:{validateWeek:()=>week}}});
 vm.runInContext(section('function bbRestoreSavedWeek(','window.BBSavedWeeksHost='),h.ctx);
 return {...h,before};
}
test('deliberately loading a saved week captures its committed dinner changes; failed restore does not',()=>{
 for(const commitOK of [false,true]){
  const h=savedWeekHarness(commitOK);
  assert.equal(h.run("bbRestoreSavedWeek({week:{},actor:'person',expected:'same'})").ok,commitOK);
  assert.equal(h.captures.length,commitOK?1:0);
  if(commitOK){assert.equal(h.captures[0].before,h.before);assert.deepEqual(JSON.parse(h.captures[0].after).planned,[]);}
  else assert.equal(h.values.get(KEY),h.before);
 }
});

test('starting an empty new week captures all seven cleared dinners only after its guarded transfer succeeds',async()=>{
 for(const closeOK of [false,true]){
  const h=harness(),before=h.values.get(KEY),week={...initialState(),customDinners:{},lunch:{children:1,days:{},menus:{}}};
  const initial={ready:true,actor:'person',fingerprint:'same',raw:{[KEY]:before},plan:h.ctx.state,lunch:week.lunch,notes:{}};
  Object.assign(h.ctx,{BB307_STOCK_KEY:'stock',BB321_LUNCH_KEY:'lunch',BB172_QUICK_DINNER_KEY:'notes',bb321LunchState:week.lunch,
   crypto:{randomUUID:()=> 'next'},bbNextWeekReady:()=>true,bbSavedWeekContext:()=>({actor:'person',ready:true}),bbSavedWeekSnapshot:()=>initial,bbNextWeekUnfinishedDays:()=>[],bb176IsPremiumPreview:()=>false,bbQaConfirm:async()=>true,
   bbShopV7Close:({updates})=>{if(!closeOK)return false;for(const [key,value]of Object.entries(updates))h.values.set(key,JSON.stringify(value));return true;},
   BB321Lunch:{normaliseLunchbox:clone},bb80OpenPlanDays:new Set(),bb80RememberPlanDays(){},bbNextExpandedPlanDay:null,
   window:{...h.ctx.window,BBSavedWeeks:{capture:()=>week,createStore:()=>({read:()=>({ok:true,weeks:[]}),save:()=>({ok:true})})}}});
  vm.runInContext(section('function bbNextWeekStorageStage(){','function bbNextWeekReady(){')+section('async function bbStartNextWeekRun(','window.BBPantryFirstHost='),h.ctx);
  const result=await h.run('bbStartNextWeekRun({empty:true})');
  assert.equal(result.ok,closeOK);
  assert.equal(h.captures.length,closeOK?1:0);
  if(closeOK){assert.equal(h.captures[0].before,before);assert.equal(JSON.parse(h.captures[0].before).planned.length,7);assert.deepEqual(JSON.parse(h.captures[0].after).planned,[]);}
  else assert.equal(h.values.get(KEY),before);
 }
});

test('manual measured pantry entry captures only its successful user edit, leaving the generic stock writer alone',()=>{
 for(const commitOK of [false,true]){
  const h=harness({bb307Stock:{'rice|g':150},bb307NormaliseName:name=>name.toLowerCase(),BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,stockToBase:Number}});
  h.ctx.bb307SaveStock=stock=>{if(commitOK)h.ctx.bb307Stock=stock;return commitOK;};
  vm.runInContext(section('function bb307SetPantry(','// Meal cards use'),h.ctx);
  assert.equal(h.run("bb307SetPantry('Rice','g',225,'g')"),commitOK);
  assert.deepEqual(h.pantry,commitOK?[{beforeStock:{'rice|g':150},stock:{'rice|g':225}}]:[]);
 }
 assert.doesNotMatch(section('function bb307SaveStock(','function bb307Selections('),/capturePantryEdit|sharedUserEdit/);
});

test('explicit pantry remove and reset callbacks record deletions only after their saves succeed',()=>{
 for(const saved of [false,true])for(const kind of ['need','remove','reset']){
  const target={dataset:{bb172Need:'rice|g',bb321StockRemove:'rice|g'}};
  const h=harness({bb307Stock:{'rice|g':150,'milk|ml':200},app:{querySelector:()=>target,querySelectorAll:()=>[target]}});
  h.ctx.window.confirm=()=>true;
  h.ctx.bb307SaveStock=stock=>{if(saved)h.ctx.bb307Stock=stock;return saved;};
  const snippet=kind==='reset'?section(" app.querySelector('#bb307Reset').onclick=()=>{"," app.querySelectorAll('[data-bb321-tick]')"):
   kind==='need'?section(" app.querySelectorAll('[data-bb172-need]')"," app.querySelectorAll('[data-bb172-uncheck-staple]')"):
   section(" app.querySelectorAll('[data-bb321-stock-remove]').forEach(el=>el.onclick=()=>{"," app.querySelector('#bb321ManualStock')");
  vm.runInContext(snippet,h.ctx);target.onclick();
  assert.deepEqual(h.pantry,saved?[{beforeStock:{'rice|g':150,'milk|ml':200},stock:kind==='reset'?{}:{'milk|ml':200}}]:[]);
 }
 const h=harness({bb307Stock:{'rice|g':150},app:{querySelector:()=>({})}});h.ctx.window.confirm=()=>true;h.ctx.bb307SaveStock=()=>true;h.ctx.persist=()=>false;
 const target={};h.ctx.app.querySelector=()=>target;
 vm.runInContext(section(" app.querySelector('#bb307Reset').onclick=()=>{"," app.querySelectorAll('[data-bb321-tick]')"),h.ctx);target.onclick();
 assert.equal(h.pantry.length,0);
});

test('explicit budget saves capture one setting; invalid or failed writes and render migration capture none',()=>{
 for(const shouldSave of [false,true]){
  const h=harness({BB172_BUDGET_KEY:'budget',bb172BudgetTarget:60});if(!shouldSave)h.block();
  vm.runInContext(section('function bb172SaveBudget(','bb172Tiles=bb172GetTiles()'),h.ctx);
  assert.equal(h.run('bb172SaveBudget(75)'),shouldSave);
  assert.deepEqual(h.settings,shouldSave?[{section:'budget_target',key:'weekly',value:{amount:75}}]:[]);
  assert.equal(h.run('bb172SaveBudget(0)'),false);
  assert.equal(h.settings.length,shouldSave?1:0);
 }
 const silent=harness({BB172_BUDGET_KEY:'budget',bb172BudgetTarget:60});silent.ctx.localStorage.setItem=()=>{};
 vm.runInContext(section('function bb172SaveBudget(','bb172Tiles=bb172GetTiles()'),silent.ctx);
 assert.equal(silent.run('bb172SaveBudget(75)'),true);assert.equal(silent.settings.length,0,'an unverified setting is never queued');
 assert.doesNotMatch(section('function bb1748SyncBudget(','function bb1748PlannerBudget('),/captureSettingEdit/);
});

test('a deliberate legacy budget clear passes the explicit deletion shape after both saved keys are removed',()=>{
 const h=harness({button:{},input:{value:''},BB172_BUDGET_KEY:'legacy-budget',bb172Msg(){}});
 h.values.set('legacy-budget','75');h.values.set('basketboss_v172_weekly_budget_target_v1','75');
 const budget=section('function bb172BudgetBar(app){','\nfunction '),first=budget.indexOf(' button.onclick=()=>{'),last=budget.indexOf('\n };',first);
 assert.ok(first>0&&last>first);
 vm.runInContext(budget.slice(first,last+4),h.ctx);h.ctx.button.onclick();
 assert.equal(h.values.get('legacy-budget'),undefined);assert.equal(h.values.get('basketboss_v172_weekly_budget_target_v1'),undefined);
 assert.deepEqual(h.settings,[{section:'budget_target',key:'weekly',value:null}]);
});

test('a deliberate purchase checkbox records only its own checked setting after successful persistence',()=>{
 for(const saved of [false,true])for(const checked of [false,true]){
  const h=harness({BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_CHOICE_KEY:'choices',BB_SHOP_SESSION_V7_KEY:'trip',
   bbShopV7Session:()=>({id:'trip',checkboxUndo:{},shelfEdits:{}}),bb321ReadShopTicks:()=>({}),bb84ReadPurchased:()=>({}),bbPartialAll:()=>({}),bbBetaPurchaseChoices:()=>({}),bbPartialKey:()=> 'trip|rice',bb84DisplayedPurchase:()=>100,bb84DetailFor:()=>({}),bb172Aisle:()=> 'Grains',bbShopV7Write:()=>saved});
  vm.runInContext(section('function bb84SetPrimaryPurchase(','function bb84ExtraNeeded('),h.ctx);
  assert.equal(h.run(`bb84SetPrimaryPurchase('rice|g',${checked},{key:'rice',unit:'g',toBuy:100})`),saved);
  assert.deepEqual(h.settings,saved?[{section:'shopping_checked',key:'rice|g',value:checked}]:[]);
 }
 assert.doesNotMatch(section('function bb321WriteShopTicks(','function bb321Number('),/captureSettingEdit/);
 assert.doesNotMatch(section('function bbShopV7Reconcile(','\nfunction '),/captureSettingEdit/);
});
