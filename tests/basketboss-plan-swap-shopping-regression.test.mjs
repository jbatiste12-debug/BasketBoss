import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import canonical from '../bb-recipe-canonical.js';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html=read('pwa700/app.html');
const keys={KEY:'basketboss_321_unified_state_v1',BB_SNAPSHOT:'plan-backup',BB307_STOCK_KEY:'basketboss_321_v7_measured_pantry',BB321_SHOP_TICKS_KEY:'basketboss_321_v11_shop_ticks',BB84_PURCHASED_KEY:'basketboss_ui_next_bought_quantity_v1',BB_SHOP_SESSION_V7_KEY:'basketboss_active_shop_session_v7',BB321_LUNCH_KEY:'basketboss_321_v8_school_lunchboxes_v1',BB307_FEATURE_KEY:'basketboss_321_features_v1',BB172_QUICK_DINNER_KEY:'quick',BB_BETA_RECEIPT_KEY:'basketboss_purchase_receipts_v1'};
const plain=value=>JSON.parse(JSON.stringify(value));
function section(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function named(name,next){return section('function '+name+'(','\nfunction '+next+'(');}
function recipe(id,protein,ingredients){return {id,name:id+' dinner',category:'Family dinner',tag:'STYLE-'+id,editorialCollection:'Everyday Favourites',servings:4,mins:25,primaryProtein:protein,cheeseHeavy:false,ingredients:ingredients.map(([name,qty])=>[name,qty+' g',1]),normalized:ingredients.map(([name,quantity])=>({name,key:name.toLowerCase(),quantity,unit:'g',status:'PARSED'}))};}
// Evaluate the generated700 planner and its private adapter with in-memory browser boundaries.
// Quantities, selections, persistence, rotation and pantry allocation are the shipped functions.
function fixture({random=.99999,purchased=0,servings=4}={}){
 const recipes=[recipe('old','chicken',[['Rice',300],['Broccoli',50]]),recipe('other','beef',[['Rice',400]]),recipe('new','fish',[['Pasta',250],['Rice',100]]),recipe('locked','pork',[['Rice',1000]])];
 const state={servings:4,planned:[{day:'Monday',recipeId:'old',servings,custom:'keep'},{day:'Tuesday',recipeId:'other',servings:4}],dayServings:{Monday:{recipeId:'old',count:servings}},plannedBreakfasts:[],plannedDesserts:[],pantry:{}};
 const ticks=purchased?{'rice|g':true}:{},purchases=purchased?{'rice|g':{name:'Rice',qty:500,actualQty:purchased,unit:'g',bbBetaSelectedWeek:'shop-a'}}:{};
 const values=new Map([[keys.KEY,JSON.stringify(state)],[keys.BB307_STOCK_KEY,JSON.stringify({'rice|g':200})],[keys.BB321_SHOP_TICKS_KEY,JSON.stringify(ticks)],[keys.BB84_PURCHASED_KEY,JSON.stringify(purchases)],[keys.BB_SHOP_SESSION_V7_KEY,JSON.stringify({version:7,id:'shop-a',bought:ticks,purchases,choices:{},partials:{},checkboxUndo:{'rice|g':{keep:'undo'}}})]]),writes=[],notices=[],cooked=new Set();
 let actor='guest',renders=0;
 const storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push(key);},removeItem:key=>values.delete(key)};
 const ctx={...keys,console,Intl,Math:Object.assign(Object.create(Math),{random:()=>random}),localStorage:storage,state,RECIPES:recipes,BB307_SOURCE_RECIPES:recipes,BB307_NORMALIZED:recipes.map(r=>({id:r.id,ingredients:r.normalized})),BB321_RESEARCH_QUOTES:[],BBRecipeCanonical:canonical,DAYS:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],tab:'week',bbStorageSafe:true,bb307Market:'UK',bb307Stock:{},bbAfBusy:false,bb81ProFilters:{quick:false,kids:false},bb307FeatureState:{essentials:[]},bb321LunchState:{children:1,days:{}},
  document:{getElementById:()=>null,querySelectorAll:()=>[]},requestAnimationFrame:fn=>fn(),
  BBHome:{actor:()=>actor,blocked:()=>false,isCooked:id=>cooked.has(id),previewUndoDay:()=>({ok:true,already:false}),augment:items=>items,targets:()=>({})},BBIngredientPreferences:{recipeAllowed:()=>true,scope:()=>actor,getSelected:()=>[]},
  BasketBossCloud:{scheduleSave(){}},getRecipe:id=>recipes.find(r=>r.id===id),bb176AllowedRecipe:id=>id!=='locked',bb307ActiveRetailer:()=> 'Aldi',bb172BudgetValue:()=>0,bb81Under30:()=>true,bb81KidOK:()=>true,bb81BatchOK:()=>true,bb81ProteinScore:()=>0,bbBatchPairs:()=>[],bbBatchPairFor:()=>null,bb172QuickDinners:()=>({}),bbReceiptPantryReviewRequired:()=>false,bbReceiptHasAuthoritativePantry:()=>true,bbBetaStockForCurrentWeek:stock=>stock,bb321LunchboxRequirements:()=>[],notify:msg=>notices.push(msg),render:()=>{renders++;}};
 ctx.window=ctx;vm.createContext(ctx);
 for(const name of ['bb-recipe-planning.js','bb-recipe-editorial.js','bb-serving-scale.js','basketboss-aisles-v20.js','basketboss-pricing-v19.js','bb-pantry-deduction.js','bb-pantry-autofill.js'])vm.runInContext(read(name),ctx);
 ctx.BB_WHOLE_PRODUCE_GRAMS=ctx.BBPriceV19.wholeProduceGrams;
 vm.runInContext(section('const bb307EstimateBasket=(()=>{','// BasketBoss 321 v7 original-design'),ctx);
 vm.runInContext(section('const BB321Lunch=(()=>{','/* BasketBoss 321 v8 —'),ctx);
 const functions=[named('bbHomeWeekToken','bbHomeMeasuredTracking'),named('bbHomePhysicalStock','bb307ReadStock'),named('bb307ReadStock','bbReceiptPantryReviewRequired').split('let bb307Stock=')[0],named('bbHomeLegacyPantry','bb307Selections'),named('bb307Selections','bbPantryReconcileStock'),named('bbPantryReconcileStock','bb307Plan'),named('bb307Plan','bb307SetPantry'),named('bb321UnifiedShop','bb321LunchboxHTML'),named('bbHomeRecipeIngredients','bbHomeDayMeals'),named('bbHomeDayMeals','bbHomeLunchForShopping'),named('bbHomeExcludedStockKeys','bbHomePlanningStock'),named('persist','notify'),section('function bbRotationSession(','/* BASKETBOSS_EVENING_PIVOT_ADAPTER'),named('bbPlanVarietyValid','bbRotationMessage'),section('function bbAfSetBusy(','\nasync function bb81AutoFillPro('),named('bb321ReadShopTicks','bb321WriteShopTicks').split("const BB321_SHOP_TICKS_KEY=")[0],named('bb84ReadPurchased','bb84WritePurchased'),named('bb84ExtraNeeded','bb84RecordExtra'),section("const BB_AF_DAYS=['Monday'",'/* END_BASKETBOSS_AUTOFILL_VARIETY_ROTATION_V1 */')];
 vm.runInContext(functions.join('\n'),ctx);
 for(const name of ['bb-plan-swap-core.js','bb-plan-swap-host.js'])vm.runInContext(read('pwa700/'+name),ctx);
 const app=ctx.BBPlanSwapHostFactory.currentPlanner(),host=ctx.BBPlanSwapHostFactory.createHost(app),controller=ctx.BBPlanSwapCore.createController(host);
 return {ctx,values,writes,cooked,app,host,controller,notices,recipes,storage,state:()=>ctx.state,actor:value=>{actor=value;},renders:()=>renders,shop:()=>plain(ctx.bb321UnifiedShop(ctx.bb307Plan().items))};
}
const rice=rows=>rows.find(row=>row.key.toLowerCase()==='rice');

test('actual one-day Auto-fill reconciles the whole week against unchanged pantry and preserves Shopping purchases/session',async()=>{
 for(const purchased of [0,200,900]){
  const h=fixture({purchased}),before=plain(h.state()),stock=h.storage.getItem(keys.BB307_STOCK_KEY),session=h.storage.getItem(keys.BB_SHOP_SESSION_V7_KEY),ticks=h.storage.getItem(keys.BB321_SHOP_TICKS_KEY),purchases=h.storage.getItem(keys.BB84_PURCHASED_KEY);
  assert.equal(rice(h.shop()).required,700);assert.equal(rice(h.shop()).toBuy,500);
  const result=await h.controller.swap('Monday');assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(plain(h.state().planned),[{...before.planned[0],recipeId:'new'},before.planned[1]]);
  assert.deepEqual(plain(h.state().dayServings.Monday),{recipeId:'new',count:4});
  assert.equal(h.storage.getItem(keys.KEY),JSON.stringify(h.state()));assert.equal(h.renders(),1);
  const rows=h.shop(),row=rice(rows);assert.equal(rows.filter(r=>r.key.toLowerCase()==='rice').length,1,'shared rice merges once');
  assert.equal(row.required,500);assert.equal(row.pantryUsed,200);assert.equal(row.toBuy,300);
  assert.equal(rows.find(r=>/pasta/i.test(r.key)).toBuy,250);assert.equal(rows.some(r=>/broccoli/i.test(r.key)),false,'old-only ingredient disappears');
  for(const [key,bytes]of [[keys.BB307_STOCK_KEY,stock],[keys.BB_SHOP_SESSION_V7_KEY,session],[keys.BB321_SHOP_TICKS_KEY,ticks],[keys.BB84_PURCHASED_KEY,purchases]])assert.equal(h.storage.getItem(key),bytes,key+' remains unchanged');
  assert.equal(h.ctx.bb84SavedPurchased('rice|g'),purchased);assert.equal(h.ctx.bb84ExtraNeeded('rice|g',row.toBuy,h.ctx.bb321ReadShopTicks()),purchased?Math.max(0,300-purchased):0);
 }
});

test('actual single-day draw excludes the existing recipe and finds the available replacement',async()=>{
 const h=fixture({random:0}),before=[...h.values];
 const proposal=h.host.propose(h.host.read('Monday'));
 assert.ok(proposal,'an eligible different dinner exists even when the random draw favors the old dinner');assert.equal(proposal.recipeId,'new');
 assert.deepEqual([...h.values],before,'candidate review is read only');
 assert.equal((await h.controller.swap('Monday')).ok,true);
});

test('actual currentPlanner protects cooked/access-locked/duplicate slots and planner lock',async()=>{
 for(const kind of ['cooked','access','duplicate','batch','busy']){
  const h=fixture();if(kind==='cooked')h.cooked.add(h.ctx.bbHomeOccurrence('old','Monday'));if(kind==='access')h.state().planned[0].recipeId='locked';if(kind==='duplicate')h.state().planned.push({...h.state().planned[0]});if(kind==='batch')h.app.batchPairs=()=>[{sourceDay:'Monday',leftoverDay:'Wednesday'}];if(kind==='busy')h.ctx.bbAfBusy=true;
  const before=[...h.values],result=await h.controller.swap('Monday');assert.equal(result.ok,false,kind);assert.deepEqual([...h.values],before);assert.equal(h.writes.length,0,kind);
 }
});

test('actual currentPlanner rejects pending proposals after stock, shopping session, servings, recipe or actor changes',async()=>{
 for(const kind of ['stock','session','servings','recipe','actor']){
  const h=fixture(),controller=h.ctx.BBPlanSwapCore.createController({...h.host,propose:snapshot=>{
   const proposal=h.host.propose(snapshot);
   if(kind==='stock')h.values.set(keys.BB307_STOCK_KEY,JSON.stringify({'rice|g':300}));
   if(kind==='session')h.values.set(keys.BB_SHOP_SESSION_V7_KEY,JSON.stringify({version:7,id:'shop-b'}));
   if(kind==='servings')h.state().planned[0].servings=6;
   if(kind==='recipe')h.state().planned[0].recipeId='new';
   if(kind==='actor')h.actor('other-account');return proposal;
  }}),result=await controller.swap('Monday');
  assert.equal(result.reason,'stale',kind);assert.equal(h.writes.length,0,kind);assert.equal(h.renders(),0,kind);
 }
});

test('same-recipe replacement is refused and inaccessible Premium candidates cannot enter actual single-day selection',()=>{
 const h=fixture(),snapshot=h.host.read('Monday');assert.equal(h.ctx.BBPlanSwapCore.replacement(snapshot,'old'),null);
 const proposal=h.host.propose(snapshot);assert.equal(proposal.recipeId,'new');assert.equal(h.app.allowed('locked'),false);
});


test('actual saved per-day portions survive replacement and rescale only the replaced dinner',async()=>{
 const h=fixture({servings:6}),other=plain(h.state().planned[1]);
 assert.equal(rice(h.shop()).required,850);assert.equal((await h.controller.swap('Monday')).ok,true);
 assert.equal(h.state().planned[0].servings,6);assert.equal(h.state().dayServings.Monday.count,6);assert.equal(h.state().dayServings.Monday.recipeId,'new');
 assert.deepEqual(plain(h.state().planned[1]),other);
 const rows=h.shop();assert.equal(rice(rows).required,550);assert.equal(rice(rows).pantryUsed,200);assert.equal(rice(rows).toBuy,350);assert.equal(rows.find(row=>/pasta/i.test(row.key)).required,375);
});

test('an actual pending single-day proposal holds the planner lock until one durable replacement',async()=>{
 const h=fixture();let release,entered;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
 const controller=h.ctx.BBPlanSwapCore.createController({...h.host,propose:async snapshot=>{entered();await gate;return h.host.propose(snapshot);}});
 const pending=controller.swap('Monday');await ready;assert.equal(h.ctx.bbAfBusy,true);assert.equal(h.writes.length,0);
 assert.equal((await controller.swap('Monday')).reason,'busy');assert.equal((await h.controller.swap('Tuesday')).reason,'busy');
 release();assert.equal((await pending).ok,true);assert.equal(h.ctx.bbAfBusy,false);assert.equal(h.renders(),1);assert.equal(h.state().planned[0].recipeId,'new');
});
