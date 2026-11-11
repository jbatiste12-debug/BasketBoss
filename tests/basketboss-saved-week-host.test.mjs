import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const model=createRequire(import.meta.url)('../bb-saved-weeks.js');
const source=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
function block(startText,endText){const start=source.indexOf(startText),end=source.indexOf(endText,start);assert(start>=0&&end>start,startText+' remains available');return source.slice(start,end);}
const hostCode=block('function bbSavedWeekContext(){','/* Dinner day moves');
const shopCode=block('function bbShopV7Read(key){','function bbShopV7Reconcile(');
const persistCode=block('function persist(){','function notify(');
const lunchCode=block('const BB321Lunch=(()=>{','const BB321_LUNCH_KEY=');
const storeLunchCode=block('function bb321StoreLunch(next){','function bb321LunchboxRequirements(');
const recipeHistoryCode=block('function bbRecordPlannedRecipes(ids){','function bbAfExactProtein(');
const plain=value=>JSON.parse(JSON.stringify(value));
const keys={KEY:'plan',BB_SNAPSHOT:'backup',BB321_LUNCH_KEY:'lunch',BB172_QUICK_DINNER_KEY:'notes',BB_SHOP_SESSION_V7_KEY:'shop',BB_SHOP_ARCHIVE_V7_KEY:'archive',BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_BETA_CHOICE_KEY:'choices',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_RECEIPT_KEY:'receipts'};
const ACTOR='person-one';
function harness(){
 const values=new Map(),writes=[],notices=[],ended=[];let onWrite=null,onRead=null,renders=0,deleting=false,cookOpen=false,pending=false,pantryReview=false,cycles=0;
 const storage={getItem(key){onRead?.(key);return values.get(key)??null;},setItem(key,value){onWrite?.(key,String(value));values.set(key,String(value));writes.push(key);},removeItem(key){values.delete(key);writes.push(key);}};
 const state={version:2,pantryPlanGeneration:'cycle-before',planned:[{day:'Monday',recipeId:'old-dinner'}],plannedDesserts:[{day:'Sunday',recipeId:'old-dessert'}],servings:4,feedingSet:true,mealServings:{'old-dinner':3},dayServings:{Monday:{recipeId:'old-dinner',count:6}},leftoverSources:{},leftoverConfirmed:{},bbManualBatch:null,bb81Batch:null,
  pantry:{honey:true},recipePhotos:{'old-dinner':'existing-photo.webp'},ingredientAvoidance:{version:1,scope:ACTOR,excluded:['mushroom']},customPantry:['Rice'],dismissed:['old-skip']};
 const oldLunch={version:1,children:1,days:{Monday:[{name:'Pear',qty:1,unit:'each'}],Tuesday:[],Wednesday:[],Thursday:[],Friday:[]},menus:{Monday:'Pear',Tuesday:'',Wednesday:'',Thursday:'',Friday:''}};
 const allowed=new Set(['old-dinner','old-dessert','new-dinner','new-dessert','soup']);
 const ctx={...keys,state,bb321LunchState:oldLunch,tab:'week',bbStorageSafe:true,bbReceiptHostReady:true,BB307_STOCK_KEY:'stock',bb307Stock:{rice:600},bb80OpenPlanDays:new Set(['Monday']),bbNextExpandedPlanDay:'Monday',
  console:{warn(){},error(){}},crypto:{randomUUID:()=> 'restored-cycle-'+(++cycles)},localStorage:storage,document:{querySelector:selector=>selector==='.cook-overlay'&&cookOpen?{}:null,getElementById:()=>null},
  bb172QuickDinners:()=>JSON.parse(storage.getItem('notes')||'{}'),getRecipe:id=>allowed.has(id)?{id}:null,bb176AllowedRecipe:id=>allowed.has(id),
  bb80RememberPlanDays:()=>{},render:()=>{renders++;},notify:text=>notices.push(text),bbQaConfirm:async()=>true,
  window:{BBSavedWeeks:model,BBHome:{actor:()=>JSON.parse(storage.getItem('basketboss_cloud_session_v1')||'null')?.user?.id||'guest'},BBAccountDeletion:{isDeleting:()=>deleting},BBReceiptHost:{hasPendingConfirmation:()=>pending,requiresPantryReview:()=>pantryReview,allowLegacyTransfer:()=>true},BBWeeklyShop:{end:id=>ended.push(id)}}
 };
 values.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR},access_token:'kept-private-token'}));
 values.set('plan',JSON.stringify(state));values.set('backup',JSON.stringify({...state,planned:[{day:'Saturday',recipeId:'old-dinner'}]}));values.set('lunch',JSON.stringify(oldLunch));values.set('notes',JSON.stringify({Thursday:'Eating out'}));
 values.set('shop',JSON.stringify({version:7,id:'shop-before',createdAt:'2026-11-01T00:00:00Z',checkboxUndo:{'rice|g':{value:true}},shelfEdits:{}}));
 values.set('archive',JSON.stringify({'shop-history':{version:7,id:'shop-history'}}));values.set('ticks',JSON.stringify({'rice|g':true}));values.set('purchases',JSON.stringify({'rice|g':{qty:500,unit:'g'}}));values.set('choices',JSON.stringify({'rice|g':{qty:500,unit:'g'}}));values.set('partials',JSON.stringify({'shop-before|rice|g':{bought:500,unit:'g'}}));values.set('receipts',JSON.stringify({'shop-before|rice|g':{qty:500,unit:'g',stockBasis:'full-purchase'}}));
 values.set('stock',JSON.stringify({'rice|g':600}));values.set('basketboss_at_home_requirements_v1',JSON.stringify({version:1,byActor:{[ACTOR]:{planned:{'shop-before|old-dinner|Monday':true}}}}));values.set('unrelated-setting','keep me');
 vm.createContext(ctx);vm.runInContext(lunchCode+'\n'+storeLunchCode+'\n'+persistCode+'\n'+shopCode+'\n'+recipeHistoryCode+'\n'+hostCode,ctx);
 return {ctx,values,writes,notices,ended,storage,allowed,get renders(){return renders;},host:ctx.window.BBSavedWeeksHost,
  writeHook:fn=>{onWrite=fn;},readHook:fn=>{onRead=fn;},deleting:value=>{deleting=value;},cook:value=>{cookOpen=value;},pending:value=>{pending=value;},review:value=>{pantryReview=value;}};
}
function week(){return model.capture({plan:{planned:[{day:'Tuesday',recipeId:'new-dinner'},{day:'Friday',recipeId:'soup'}],plannedDesserts:[{day:'Saturday',recipeId:'new-dessert'}],servings:5,feedingSet:true,mealServings:{soup:2},dayServings:{Tuesday:{recipeId:'new-dinner',count:3},Friday:{recipeId:'soup',count:null}},bbManualBatch:null,bb81Batch:null,leftoverSources:{},leftoverConfirmed:{}},lunch:{version:1,children:2,days:{Wednesday:[{name:'Apple',qty:.5,unit:'each'}]},menus:{Wednesday:'Sandwich and apple'}},notes:{Sunday:'Freezer dinner'}});}
const request=h=>({week:week(),expected:h.host.snapshot().fingerprint,actor:ACTOR});

test('restoring an exact named week preserves days, portions, school lunches and stock using the actual shopping transition',()=>{
 const h=harness(),before=plain(h.ctx.state),stock=h.values.get('stock'),history=h.values.get('basketboss_at_home_requirements_v1'),auth=h.values.get('basketboss_cloud_session_v1'),receipts=h.values.get('receipts'),partials=h.values.get('partials'),originalShop=h.values.get('shop');
 const result=h.host.restore(request(h));assert.equal(result.ok,true);
 assert.equal(h.ctx.state.pantryPlanGeneration,'restored-cycle-1');assert.notEqual(h.ctx.state.pantryPlanGeneration,before.pantryPlanGeneration);assert.equal(JSON.parse(h.values.get('plan')).pantryPlanGeneration,'restored-cycle-1');
 assert.deepEqual(plain(h.ctx.state.planned),week().planned);assert.deepEqual(plain(h.ctx.state.plannedDesserts),week().plannedDesserts);assert.deepEqual(plain(h.ctx.state.dayServings),week().dayServings);assert.equal(h.ctx.state.servings,5);assert.deepEqual(plain(h.ctx.state.mealServings),{soup:2});
 assert.deepEqual(plain(h.ctx.bb321LunchState),week().lunch);assert.deepEqual(JSON.parse(h.values.get('notes')),{Sunday:'Freezer dinner'});
 for(const field of ['pantry','recipePhotos','ingredientAvoidance','customPantry','dismissed'])assert.deepEqual(plain(h.ctx.state[field]),before[field],field);
 assert.equal(h.values.get('stock'),stock);assert.equal(h.values.get('basketboss_at_home_requirements_v1'),history);assert.equal(h.values.get('basketboss_cloud_session_v1'),auth);assert.equal(h.values.get('receipts'),receipts);assert.equal(h.values.get('partials'),partials);assert.equal(h.values.get('unrelated-setting'),'keep me');
 assert.deepEqual(JSON.parse(h.values.get('ticks')),{});assert.deepEqual(JSON.parse(h.values.get('purchases')),{});assert.deepEqual(JSON.parse(h.values.get('choices')),{});
 const active=JSON.parse(h.values.get('shop')),archive=JSON.parse(h.values.get('archive'));assert.notEqual(active.id,'shop-before');assert.equal(active.version,7);assert.equal(archive['shop-before'].id,'shop-before');assert.deepEqual(archive['shop-before'].bought,{'rice|g':true});assert.equal(archive['shop-history'].id,'shop-history');
 assert.deepEqual(h.ended,['shop-before']);assert.equal(h.renders,1);assert.notEqual(h.values.get('shop'),originalShop);assert.deepEqual(JSON.parse(h.values.get('backup')),before);
});
test('loading the same saved week again starts a fresh cooking cycle without removing stock or completion history',()=>{
 const h=harness(),stock=h.values.get('stock'),history=h.values.get('basketboss_at_home_requirements_v1');
 assert.equal(h.host.restore(request(h)).ok,true);const first=h.ctx.state.pantryPlanGeneration;
 assert.equal(h.host.restore(request(h)).ok,true);assert.equal(first,'restored-cycle-1');assert.equal(h.ctx.state.pantryPlanGeneration,'restored-cycle-2');
 assert.equal(JSON.parse(h.values.get('plan')).pantryPlanGeneration,'restored-cycle-2');assert.equal(h.values.get('stock'),stock);assert.equal(h.values.get('basketboss_at_home_requirements_v1'),history);
 const plannedHistory=JSON.parse(h.values.get('basketboss_planned_recipe_dates_v1'));
 assert.deepEqual(Object.keys(plannedHistory.byActor),[ACTOR]);assert.deepEqual(Object.keys(plannedHistory.byActor[ACTOR]).sort(),['new-dessert','new-dinner','soup']);assert.ok(Object.values(plannedHistory.byActor[ACTOR]).every(Number.isFinite));
 assert.equal(Object.hasOwn(week(),'pantryPlanGeneration'),false,'saved meal choices do not carry a consumed cycle into the new plan');
});
test('pending receipts, pantry review, cooking, deletion and unavailable recipes reject before any write',()=>{
 for(const setup of [h=>h.pending(true),h=>h.review(true),h=>h.cook(true),h=>h.deleting(true),h=>{h.ctx.bbStorageSafe=false;},h=>h.allowed.delete('new-dinner'),h=>{h.ctx.tab='shop';}]){
  const h=harness(),proposal=request(h);setup(h);const before=[...h.values],oldState=JSON.stringify(h.ctx.state),oldLunch=JSON.stringify(h.ctx.bb321LunchState);
  assert.equal(h.host.restore(proposal).ok,false);assert.deepEqual([...h.values],before);assert.equal(JSON.stringify(h.ctx.state),oldState);assert.equal(JSON.stringify(h.ctx.bb321LunchState),oldLunch);assert.equal(h.writes.length,0);assert.equal(h.renders,0);
 }
});
test('stale account, in-memory servings, lunch, notes and external trip changes invalidate the original confirmation',()=>{
 for(const change of [h=>h.values.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:'another-account'}})),h=>{h.ctx.state.servings=2;},h=>{h.ctx.bb321LunchState.children=3;},h=>h.values.set('notes',JSON.stringify({Monday:'New note'})),h=>h.values.set('shop',JSON.stringify({version:7,id:'shop-newer'}))]){
  const h=harness(),proposal=request(h);change(h);const before=[...h.values];assert.equal(h.host.restore(proposal).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.writes.length,0);assert.equal(h.renders,0);
 }
});
test('malformed saved data and locked leftover or batch-linked recipes cannot partially restore a week',()=>{
 for(const mutate of [value=>{value.planned[0].day='not-a-day';},value=>{value.leftoverSources['unavailable-source']=true;},value=>{value.bbManualBatch={version:1,pairs:[{sourceDay:'Tuesday',leftoverDay:'Wednesday',recipeId:'unavailable-source'}]};}]){
  const h=harness(),proposal=request(h);mutate(proposal.week);const before=[...h.values];assert.equal(h.host.restore(proposal).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.writes.length,0);
 }
});
test('storage failures in notes, lunch, plan, backup or the actual close restore every previous value',()=>{
 for(const failureKey of ['notes','lunch','plan','backup','archive','shop','ticks','purchases','choices']){
  const h=harness(),before=[...h.values],oldState=JSON.stringify(h.ctx.state),oldLunch=JSON.stringify(h.ctx.bb321LunchState);let fail=true;
  h.writeHook(key=>{if(key===failureKey&&fail){fail=false;throw Error('quota');}});
  assert.equal(h.host.restore(request(h)).ok,false,failureKey);assert.deepEqual([...h.values],before,failureKey);assert.equal(JSON.stringify(h.ctx.state),oldState,failureKey);assert.equal(JSON.stringify(h.ctx.bb321LunchState),oldLunch,failureKey);assert.equal(h.renders,0,failureKey);assert.equal(h.ended.length,0,failureKey);
 }
});
test('failed shopping close retains external receipt data rather than attributing it to this restore',()=>{
 const h=harness(),oldState=JSON.stringify(h.ctx.state),oldLunch=JSON.stringify(h.ctx.bb321LunchState),external=JSON.stringify({newerReceipt:{qty:500,unit:'g'}});
 h.ctx.window.BBReceiptHost.allowLegacyTransfer=()=>{h.values.set('receipts',external);return false;};
 assert.equal(h.host.restore(request(h)).ok,false);assert.equal(h.values.get('receipts'),external);assert.equal(JSON.stringify(h.ctx.state),oldState);assert.equal(JSON.stringify(h.ctx.bb321LunchState),oldLunch);assert.equal(h.renders,0);
});
test('a failed actual shopping write cannot erase a purchase saved by another tab',()=>{
 const h=harness(),external=JSON.stringify({'new-purchase':{qty:2,unit:'each'}});let fail=true;
 h.writeHook(key=>{if(key==='ticks'&&fail){fail=false;h.values.set('purchases',external);throw Error('quota');}});
 assert.equal(h.host.restore(request(h)).ok,false);assert.equal(h.values.get('purchases'),external);assert.equal(h.renders,0);
});
test('rollback leaves a newer external note intact while restoring the plan and lunch',()=>{
 const h=harness(),oldPlan=h.values.get('plan'),oldLunch=h.values.get('lunch'),external=JSON.stringify({Monday:'Newer tab dinner'});let fail=true;
 h.writeHook(key=>{if(key==='lunch'&&fail){fail=false;h.values.set('notes',external);throw Error('quota');}});
 assert.equal(h.host.restore(request(h)).ok,false);assert.equal(h.values.get('notes'),external);assert.equal(h.values.get('plan'),oldPlan);assert.equal(h.values.get('lunch'),oldLunch);assert.equal(h.renders,0);
});
test('a legacy list without an active session loads atomically without migrating receipt or partial history',()=>{
 const h=harness();h.values.delete('shop');const receipts=h.values.get('receipts'),partials=h.values.get('partials');
 const result=h.host.restore(request(h));assert.equal(result.ok,true);assert.equal(h.values.get('receipts'),receipts);assert.equal(h.values.get('partials'),partials);
 const archive=JSON.parse(h.values.get('archive')),archived=Object.values(archive).find(row=>row.bought?.['rice|g']);
 assert(archived,'the previous checked legacy list remains in the shopping archive');assert.equal(JSON.parse(h.values.get('shop')).version,7);assert.deepEqual(JSON.parse(h.values.get('ticks')),{});
});
test('a failed legacy-list restore cannot leave a migration or new session behind',()=>{
 const h=harness();h.values.delete('shop');const before=[...h.values];let fail=true;
 h.writeHook(key=>{if(key==='notes'&&fail){fail=false;throw Error('quota');}});
 assert.equal(h.host.restore(request(h)).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.values.has('shop'),false);assert.equal(h.renders,0);
});
test('a changed plan between the writer expectation check and its old-value capture is not overwritten',()=>{
 const h=harness(),external=JSON.stringify({...plain(h.ctx.state),servings:2});let inside=false,planReads=0;
 const write=h.ctx.bbShopV7Write;
 h.ctx.bbShopV7Write=(...args)=>{inside=true;try{return write(...args);}finally{inside=false;}};
 h.readHook(key=>{if(inside&&key==='plan'&&++planReads===2)h.values.set('plan',external);});
 assert.equal(h.host.restore(request(h)).ok,false);assert.equal(h.values.get('plan'),external);assert.equal(h.renders,0);
});
test('an earlier plan write superseded before the final shopping write prevents a mixed successful restore',()=>{
 const h=harness(),external=JSON.stringify({...plain(h.ctx.state),servings:2}),oldLunch=h.values.get('lunch'),oldShop=h.values.get('shop');let changed=false;
 h.writeHook(key=>{if(key==='notes'&&!changed){changed=true;h.values.set('plan',external);}});
 assert.equal(h.host.restore(request(h)).ok,false);assert.equal(h.values.get('plan'),external);assert.equal(h.values.get('lunch'),oldLunch);assert.equal(h.values.get('shop'),oldShop);assert.equal(h.renders,0);
});
test('an account switch during a later write preserves new authentication and rolls back only this restore',()=>{
 const h=harness(),proposal=request(h),saved= model.createStore({storage:h.storage,context:h.host.context});
 assert.equal(saved.save('Week 1',proposal.week).ok,true);
 const savedKey=model.KEY+encodeURIComponent(ACTOR),savedJSON=h.values.get(savedKey);
 assert.doesNotMatch(savedJSON,/access_token|kept-private-token|basketboss_cloud_session_v1/);
 const before=new Map(h.values),oldState=JSON.stringify(h.ctx.state),oldLunch=JSON.stringify(h.ctx.bb321LunchState),newAuth=JSON.stringify({user:{id:'person-two'},access_token:'new-account-token'});let switched=false;
 h.writeHook(key=>{if(key==='notes'&&!switched){switched=true;h.values.set('basketboss_cloud_session_v1',newAuth);}});
 assert.equal(h.host.restore(proposal).ok,false);assert.equal(h.values.get('basketboss_cloud_session_v1'),newAuth);
 for(const [key,value]of before)if(key!=='basketboss_cloud_session_v1')assert.equal(h.values.get(key),value,key);
 assert.equal(JSON.stringify(h.ctx.state),oldState);assert.equal(JSON.stringify(h.ctx.bb321LunchState),oldLunch);assert.equal(h.renders,0);assert.equal(h.ended.length,0);
 assert.equal(h.values.get(savedKey),savedJSON);assert.doesNotMatch(h.values.get(savedKey),/access_token|new-account-token|kept-private-token/);
 assert.equal(h.writes.includes('basketboss_cloud_session_v1'),false,'authentication is an expected value, never a write payload');
});

// Exercise Start next week against the actual Saved Weeks store, lock, guarded
// shopping close and rollback writer. Recipe ranking has its own pure tests.
function nextWeekHarness(){
 const h=harness(),draws=[],archivedPlans=[],rotationKey='basketboss_autofill_rotation_v1:'+ACTOR;
 h.values.set(rotationKey,JSON.stringify({version:1,cycle:0,seen:['old-dinner'],last:['old-dinner']}));
 h.values.set('basketboss_makeameal_v1_inventory',JSON.stringify({'fridge|rice':{name:'rice',loc:'fridge',selected:true,qty:600,unit:'g',bb173StockKey:'rice|g',bb173StockValue:600}}));
 Object.assign(h.ctx,{BB_AF_DAYS:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],bbAfBusy:false,bb307Market:'UK',
  bb176IsPremiumPreview:()=>false,bb81ProFilters:{},bbAfDietNotice:()=>'',bbAfIngredientAllowed:recipe=>!!recipe&&h.allowed.has(recipe.id),
  bbPlanVarietyValid:()=>true,bbAfWorldCount:()=>0,bb321ReadShopTicks:()=>JSON.parse(h.storage.getItem('ticks')||'{}'),
  bb321WeeklySummary:()=>{archivedPlans.push(plain(h.ctx.state.planned));return {items:[],essentials:[]};},
  bbAfDraw(days,previous,filters,batch,mode,context){
   draws.push({days:plain(days),previous:plain(previous),filters:plain(filters),batch,mode,planningState:plain(context.planningState),reserve:context.reserveCurrentMeals});
   const before=context.storage.getItem(rotationKey);
   return {worldAllowed:false,additions:[{day:'Monday',recipeId:'new-dinner'},{day:'Tuesday',recipeId:'soup'}],rotation:{commit(){
    if(context.storage.getItem(rotationKey)!==before)return false;
    context.storage.setItem(rotationKey,JSON.stringify({version:1,cycle:0,seen:['old-dinner','new-dinner','soup'],last:['new-dinner','soup']}));return true;
   }}};
  }});
 h.ctx.document.querySelectorAll=()=>[];
 vm.runInContext(block('function bbReceiptPantryReviewRequired(){','function bbReceiptHasAuthoritativePantry('),h.ctx);
 h.ctx.window.BBShopOwnership={enabled:()=>true};
 h.ctx.window.BBShopContinuation={prepareContinuation:(session,remaining,context)=>({ok:true,snapshot:{status:'pending',actorId:context.actor,market:context.market,items:remaining}})};
 vm.runInContext(block('function bbAfSetBusy(','async function bb81AutoFillPro('),h.ctx);
 return Object.assign(h,{draws,archivedPlans,rotationKey,next:h.ctx.window.BBPantryFirstHost});
}
test('Start next week atomically saves the previous plan and replaces only planning choices while retaining pantry',async()=>{
 const h=nextWeekHarness(),old=plain(h.ctx.state),stock=h.values.get('stock'),inventory=h.values.get('basketboss_makeameal_v1_inventory'),home=h.values.get('basketboss_at_home_requirements_v1'),receipts=h.values.get('receipts'),partials=h.values.get('partials');
 h.ctx.bbQaConfirm=async(message,title,action)=>{assert.equal(h.writes.length,0,'a complete proposal and saved-week draft are read-only before confirmation');assert.equal(title,'Start next week?');assert.equal(action,'Start next week');assert.match(message,/Breakfasts, desserts, school lunches and dinner notes start empty/);return true;};
 const result=await h.next.startNextWeek({mode:'pantry-first'});assert.equal(result.ok,true);assert.equal(result.added,2);
 assert.deepEqual(plain(h.ctx.state.planned),[{day:'Monday',recipeId:'new-dinner'},{day:'Tuesday',recipeId:'soup'}]);assert.notEqual(h.ctx.state.pantryPlanGeneration,old.pantryPlanGeneration);
 assert.deepEqual(plain(h.ctx.state.plannedDesserts),[]);assert.deepEqual(plain(h.ctx.state.plannedBreakfasts),[]);assert.deepEqual(plain(h.ctx.state.dayServings),{});assert.deepEqual(plain(h.ctx.state.mealServings),{});
 assert.equal(h.ctx.state.servings,old.servings);assert.deepEqual(plain(h.ctx.state.pantry),old.pantry);assert.deepEqual(plain(h.ctx.state.ingredientAvoidance),old.ingredientAvoidance);
 assert.equal(h.values.get('stock'),stock);assert.equal(h.values.get('basketboss_makeameal_v1_inventory'),inventory);assert.equal(h.values.get('basketboss_at_home_requirements_v1'),home);assert.equal(h.values.get('receipts'),receipts);assert.equal(h.values.get('partials'),partials);
 const saved=model.createStore({storage:h.storage,context:h.host.context}).read();assert.equal(saved.weeks.length,1);assert.equal(saved.weeks[0].name,result.savedName);assert.deepEqual(saved.weeks[0].week.planned,old.planned);assert.equal(saved.weeks[0].week.lunch.days.Monday[0].name,'Pear');
 assert.doesNotMatch(h.values.get(saved.key),/kept-private-token|access_token|existing-photo/);assert.deepEqual(JSON.parse(h.values.get('backup')),old);
 assert.deepEqual(h.archivedPlans,[old.planned],'old unfinished shopping is archived before changing the in-memory plan');
 assert.deepEqual(JSON.parse(h.values.get('ticks')),{});assert.deepEqual(h.ended,['shop-before']);assert.notEqual(JSON.parse(h.values.get('shop')).id,'shop-before');
 assert.equal(h.draws[0].reserve,false);assert.deepEqual(h.draws[0].previous,[]);assert.deepEqual(h.draws[0].planningState.dayServings,{});assert.equal(h.draws[0].mode,'pantry-first');
 assert.deepEqual(JSON.parse(h.values.get(h.rotationKey)).last,['new-dinner','soup']);assert.equal(h.renders,1);
});
test('cancelled next-week previews and state changes during review never write plan, stock or history',async()=>{
 for(const change of [null,h=>h.values.set('stock',JSON.stringify({'rice|g':300})),h=>h.values.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:'other'}})),h=>{h.ctx.state.servings=2;},h=>h.allowed.delete('new-dinner'),h=>h.values.set(h.rotationKey,JSON.stringify({version:1,cycle:1,seen:[],last:[]})),h=>h.pending(true)]){
  const h=nextWeekHarness();let after;
  h.ctx.bbQaConfirm=async()=>{change?.(h);after=[...h.values];return !!change;};
  const result=await h.next.startNextWeek({mode:'fresh'});assert.equal(result.ok,false);assert.deepEqual([...h.values],after);assert.equal(h.writes.length,0);assert.equal(h.renders,0);assert.equal(h.ctx.state.planned[0].recipeId,'old-dinner');
 }
});
test('a next-week storage failure rolls back saved-week, rotation, plan and trip together',async()=>{
 for(const keyOf of [h=>model.KEY+ACTOR,h=>h.rotationKey,()=> 'basketboss_planned_recipe_dates_v1',()=> 'plan',()=> 'lunch',()=> 'notes',()=> 'backup',()=> 'archive',()=> 'shop',()=> 'ticks',()=> 'purchases',()=> 'choices']){
  const h=nextWeekHarness(),before=new Map(h.values),state=JSON.stringify(h.ctx.state),lunch=JSON.stringify(h.ctx.bb321LunchState),failureKey=keyOf(h);let fail=true;
  h.writeHook(key=>{if(key===failureKey&&fail){fail=false;throw Error('quota');}});
  assert.equal((await h.next.startNextWeek()).ok,false,failureKey);assert.deepEqual(new Map(h.values),before,failureKey);assert.equal(JSON.stringify(h.ctx.state),state,failureKey);assert.equal(JSON.stringify(h.ctx.bb321LunchState),lunch,failureKey);assert.equal(h.renders,0);assert.deepEqual(h.ended,[]);
 }
});
test('rapid Start next week taps share the existing lock and cannot archive or save twice',async()=>{
 const h=nextWeekHarness();let confirm,shown;
 const waiting=new Promise(resolve=>{shown=resolve;});h.ctx.bbQaConfirm=()=>{shown();return new Promise(resolve=>{confirm=resolve;});};
 const first=h.next.startNextWeek({mode:'fresh'});await waiting;
 assert.equal((await h.next.startNextWeek({mode:'pantry-first'})).ok,false);assert.equal(h.draws.length,1);assert.equal(h.writes.length,0);
 confirm(true);assert.equal((await first).ok,true);assert.equal(h.ended.length,1);assert.equal(model.createStore({storage:h.storage,context:h.host.context}).read().weeks.length,1);
});
test('next-week failure preserves a newer external purchase while rolling back this transition',async()=>{
 const h=nextWeekHarness(),external=JSON.stringify({'new-purchase':{qty:2,unit:'each'}}),old=JSON.stringify(h.ctx.state);let fail=true;
 h.writeHook(key=>{if(key==='ticks'&&fail){fail=false;h.values.set('purchases',external);throw Error('quota');}});
 assert.equal((await h.next.startNextWeek()).ok,false);assert.equal(h.values.get('purchases'),external);assert.equal(JSON.stringify(h.ctx.state),old);assert.equal(h.values.has(model.KEY+ACTOR),false);assert.equal(h.renders,0);
});
test('routine pantry reminders allow a new week while true stock conflicts remain blocked',async()=>{
 for(const ready of [true,false]){
  const h=nextWeekHarness(),stock=h.values.get('stock');h.review(true);h.ctx.window.BBReceiptHost.getConsumptionStatus=()=>({ready});
  const result=await h.next.startNextWeek();assert.equal(result.ok,ready);assert.equal(h.values.get('stock'),stock);
  if(!ready){assert.equal(h.writes.length,0);assert.equal(h.draws.length,0);assert.equal(h.ctx.state.planned[0].recipeId,'old-dinner');}
 }
});
