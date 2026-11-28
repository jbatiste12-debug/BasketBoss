import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {householdPlanCaptureSource} from './helpers/household-plan-capture.mjs';

// Execute the shipped sharing/outbox and original plan persistence, replacement,
// and memory refresh functions. Only the DOM, network, and delayed pantry host
// are fixtures. No external account or backend is contacted.
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const html = read('../app.html');
const section = (start, end, offset = 0) => {
  const first = html.indexOf(start, offset), last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return html.slice(first, last);
};
const originalSharing = read('../bb-household-sharing.js');
const sharingSource = originalSharing.replace('function boot(){',
  'window.__applyRace={refreshStatus,ensureAuto,engine:()=>autoEngine};function boot(){');
assert.notEqual(sharingSource, originalSharing);
const appSource = section('function bbSharedHouseholdScreenReady(', 'window.BBHomeHost=Object.freeze(') + '\n' +
  'window.BBHomeHost={canRefreshSharedHousehold:bbCanRefreshSharedHousehold,refreshSharedHousehold:bbRefreshSharedHousehold,prepareSharedHouseholdRecipes:bbPrepareSharedHouseholdRecipes,prepareEmptySharedHousehold:bbPrepareEmptySharedHousehold};\n' +
  section('function persist(){', '/* Shared household intent') + '\n' + householdPlanCaptureSource(html);
const replaceSource = section('  function commit(newId) {', '  function redraw() {', html.indexOf('id="bb172ReplaceTitle"'));
const ACTOR = '11111111-1111-4111-8111-111111111111', HH = '33333333-3333-4333-8333-333333333333';
const STATE = 'basketboss_321_unified_state_v1', AUTH = 'basketboss_cloud_session_v1';
const STOCK = 'basketboss_321_v7_measured_pantry';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const row = (section, entry_key, value, revision = 1) => ({section, entry_key, value, revision});

async function fixture({afterApplyDinner=null}={}) {
  const initial = {version:2, planned:[{day:'Monday',recipeId:'old-monday'},{day:'Tuesday',recipeId:'old-tuesday'}],
    plannedBreakfasts:[{day:'Monday',recipeId:'private-breakfast'}],plannedDesserts:[],servings:4,feedingSet:true,
    pantry:{'private-checklist':true},dayServings:{},mealServings:{},customMarker:'keep-unrelated-data'};
  const values = new Map([[STATE, JSON.stringify(initial)], [AUTH, JSON.stringify({user:{id:ACTOR},access_token:'synthetic-token'})]]);
  const storage = {getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,String(value)), removeItem:key => values.delete(key)};
  const requests = [], renders = [], generatedIds = [], operations = new Map(), entries = new Map([
    ['planned_day:Monday', row('planned_day','Monday',{recipeId:'old-monday'})],
    ['planned_day:Tuesday', row('planned_day','Tuesday',{recipeId:'old-tuesday'})],
    ['household_servings:default', row('household_servings','default',{count:4})]
  ]);
  const pantryStarted = deferred(), releasePantry = deferred();
  let clock = 3, remoteChanged = false, pantryCalls = 0;
  const snapshot = () => ({ok:true,protocol:2,household_id:HH,clock,pruneFloor:0,
    state:{entries:clone([...entries.values()]),stock:{},locations:{},inventoryRevision:1,initialized:true,
      inventory:remoteChanged ? {ok:true,scope:{kind:'household',id:HH},initialized:true,inventoryRevision:1,stock:{}} : null}});
  const fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({url:String(url),body:clone(body),authorization:options.headers.Authorization});
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    if (!body) return Response.json(new URL(url, 'https://basketboss.co.uk').searchParams.get('mode') === 'auto_sync' ? snapshot() :
      {configured:true,premium:true,role:'partner',household_id:HH,invite_status:'accepted'});
    assert.equal(body.expectedHouseholdId, HH);
    if (body.action === 'sync_reserve') {
      let operation = operations.get(body.operationId);
      if (!operation) {
        operation = {id:body.operationId,order:++clock,status:'reserved',target:clone(body.target),value:clone(body.value)};
        operations.set(operation.id, operation);
      }
      return Response.json({ok:true,operation:{id:operation.id,order:operation.order,status:operation.status}});
    }
    assert.equal(body.action, 'sync_apply');
    const operation = operations.get(body.operationId);
    assert.ok(operation); assert.equal(body.order, operation.order);
    if (operation.target.kind === 'dinner') {
      entries.set('planned_day:' + operation.target.key, row('planned_day',operation.target.key,{recipeId:operation.value.recipeId},operation.order));
      entries.set('servings:' + operation.target.key, row('servings',operation.target.key,operation.value.servings === null ? {deleted:true} : {count:operation.value.servings},operation.order));
    } else assert.equal(operation.target.kind, 'pantry');
    operation.status = 'applied';
    if(afterApplyDinner?.day===operation.target.key){remoteChanged=true;entries.set('planned_day:'+afterApplyDinner.day,row('planned_day',afterApplyDinner.day,{recipeId:afterApplyDinner.recipeId},++clock));}
    return Response.json({ok:true,operation:{id:operation.id,order:operation.order,status:operation.status}});
  };
  const context = {
    window:null, document:{readyState:'loading',hidden:false,activeElement:null,addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,getElementById:()=>null},
    localStorage:storage,navigator:{onLine:true},console,JSON,Map,Set,Date,Response,URL,AbortController,setTimeout,clearTimeout,fetch,
    addEventListener(){},setInterval(){},location:{hash:'',href:'https://basketboss.co.uk/app'},
    crypto:{randomUUID(){const id=`00000000-0000-4000-8000-${String(generatedIds.length+1).padStart(12,'0')}`;generatedIds.push(id);return id;}},
    KEY:STATE,DAYS,BB_SNAPSHOT:'basketboss_test_plan_recovery',OLD_PLAN:'old-plan',OLD_PANTRY:'old-pantry',
    bbStorageSafe:true,bbRecovered:false,state:clone(initial),bb307Stock:{},bb307FeatureState:{},
    normalize:clone,bb307ReadStock:()=>JSON.parse(storage.getItem(STOCK)||'{}'),bb307ReadFeatures:()=>({}),
    bbVerifiedPaidRecipes:true,bbPremiumUser:ACTOR,bbPremiumToken:'synthetic-token',
    bbPremiumReload:async () => {throw Error('No recipe reload should be needed in this fixture');},
    render:() => renders.push(clone(context.state)),notify(){},close(){},getRecipe:id => ({id}),bbIsDessert:()=>false,bbAfIngredientAllowed:()=>true,
    BBReceiptHost:{handlesInventorySync:()=>true,async receiveSharedAutoSnapshot() {
      pantryCalls++;
      if (pantryCalls === 1) {pantryStarted.resolve(); return releasePantry.promise;}
      return {ok:true,localApplied:false};
    }}
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(appSource, context);
  vm.runInContext(read('../bb-household-auto-sync.js'), context);
  vm.runInContext(sharingSource, context);
  await context.__applyRace.refreshStatus();
  await context.__applyRace.ensureAuto();
  assert.equal(context.BBHouseholdSharingAuto.isReady(), true);
  return {context,storage,requests,renders,generatedIds,pantryStarted,releasePantry,
    engine:context.__applyRace.engine(), saved:() => JSON.parse(storage.getItem(STATE)),
    receiveMonday() {remoteChanged=true; entries.set('planned_day:Monday',row('planned_day','Monday',{recipeId:'remote-monday'},++clock));},
    receiveDinner(day,recipeId) {remoteChanged=true;entries.set('planned_day:'+day,row('planned_day',day,{recipeId},++clock));},
    removeDinner(day) {remoteChanged=true;const revision=++clock;entries.set('planned_day:'+day,row('planned_day',day,{deleted:true},revision));entries.set('servings:'+day,row('servings',day,{deleted:true},revision));},
    staleDinner(day,recipeId) {entries.set('planned_day:'+day,row('planned_day',day,{recipeId},1));},
    replaceTuesday() {context.currentId='old-tuesday';context.selectedDay='Tuesday';vm.runInContext(replaceSource+"\ncommit('local-tuesday');",context);}
  };
}

test('remote Plan refresh reaches app memory before pantry awaits, so a Tuesday edit cannot revert Monday', {timeout:10000}, async () => {
  const f = await fixture();
  let refreshing;
  try {
    f.receiveMonday();
    refreshing = f.engine.refresh();
    await f.pantryStarted.promise;
    assert.equal(f.saved().planned.find(slot => slot.day === 'Monday')?.recipeId, 'remote-monday');
    assert.equal(f.context.state.planned.find(slot => slot.day === 'Monday')?.recipeId, 'remote-monday', 'app memory must match its saved remote Plan before yielding to pantry work');
    assert.equal(f.generatedIds.length, 0, 'receiving the remote Monday creates no local edit operation');

    // The real replacement handler persists the in-memory week and invokes the
    // shipped explicit-intent bridge while the pantry promise remains pending.
    f.replaceTuesday();
    assert.equal(f.saved().planned.find(slot => slot.day === 'Monday')?.recipeId, 'remote-monday');
    assert.equal(f.saved().planned.find(slot => slot.day === 'Tuesday')?.recipeId, 'local-tuesday');
    const pending = clone(f.engine.read().pending);
    assert.equal(pending.length, 1, 'only the deliberately edited Tuesday receives an operation ID');
    assert.deepEqual(pending[0].target, {kind:'dinner',key:'Tuesday'});
    assert.equal(f.generatedIds.length, 1);
    assert.equal(f.requests.filter(request => request.body).length, 0, 'the active remote apply serializes network work until pantry finishes');

    f.releasePantry.resolve({ok:true,localApplied:true});
    await refreshing;
    await f.engine.flush();
    const reserved = f.requests.filter(request => request.body?.action === 'sync_reserve');
    assert.equal(reserved.length, 1);
    assert.deepEqual(reserved[0].body.target, {kind:'dinner',key:'Tuesday'});
    assert.equal(f.saved().planned.find(slot => slot.day === 'Monday')?.recipeId, 'remote-monday');
    assert.equal(f.context.state.planned.find(slot => slot.day === 'Monday')?.recipeId, 'remote-monday');
    assert.equal(f.saved().customMarker, 'keep-unrelated-data');
    assert.deepEqual(f.saved().plannedBreakfasts, [{day:'Monday',recipeId:'private-breakfast'}]);
  } finally {
    f.releasePantry.resolve({ok:false,deferred:true});
    await refreshing;
    f.engine.destroy();
  }
});

test('the first explicit dinner save from a literal null plan records only that dinner', {timeout:10000}, async () => {
  const f = await fixture();
  try {
    f.storage.removeItem(STATE);
    f.context.state = {...clone(f.context.state), planned:[{day:'Monday',recipeId:'first-new-dinner'}]};
    assert.equal(f.storage.getItem(STATE), null);
    assert.equal(vm.runInContext('bbPersistSharedPlanEdit()', f.context), true);
    const pending = clone(f.engine.read().pending);
    assert.equal(pending.length, 1, 'a missing saved plan is an empty comparison baseline for this explicit edit');
    assert.deepEqual(pending[0].target, {kind:'dinner',key:'Monday'});
    assert.deepEqual(pending[0].value, {recipeId:'first-new-dinner',servings:null});
    assert.equal(f.generatedIds.length, 1);
    await f.engine.flush();
    const reserves = f.requests.filter(request => request.body?.action === 'sync_reserve');
    assert.equal(reserves.length, 1);
    assert.deepEqual(reserves[0].body.target, {kind:'dinner',key:'Monday'});
    assert.equal(reserves[0].body.operationId, pending[0].id);
    assert.equal(f.saved().planned.find(slot => slot.day === 'Monday')?.recipeId, 'first-new-dinner');
  } finally {f.engine.destroy();}
});

for (const [name, nextSession] of [
  ['token rotation', {user:{id:ACTOR},access_token:'rotated-token'}],
  ['account switch', {user:{id:'22222222-2222-4222-8222-222222222222'},access_token:'other-account-token'}]
]) test(`a stale status pin cannot authorize household capture or transport after ${name}`, {timeout:10000}, async () => {
  const f = await fixture();
  try {
    const before = f.storage.getItem(STATE), after = JSON.stringify({...f.saved(),planned:[{day:'Monday',recipeId:'local-after-session-change'}]});
    const requestCount = f.requests.length;
    const outboxKey = f.context.BBHouseholdAutoSync.PREFIX + encodeURIComponent(ACTOR) + ':' + encodeURIComponent(HH);
    const outboxBefore = f.storage.getItem(outboxKey);
    assert.notEqual(outboxBefore, null);
    // Deliberately omit the session-changed event: the authority check itself
    // must reject the old status even before lifecycle listeners can clear it.
    f.storage.setItem(AUTH, JSON.stringify(nextSession));
    f.storage.setItem(STATE, after);
    assert.equal(f.context.BBHouseholdSharingAuto.isReady(), false);
    assert.equal(f.context.BBHouseholdSharingAuto.canCapture(), false, 'this fixture has no cached actor-isolated ownership for staging');
    const captured = f.context.BBHouseholdSharingAuto.capturePlanEdit({before,after});
    assert.equal(captured.queued, false);
    await f.engine.flush();
    await f.engine.refresh();
    assert.equal(f.generatedIds.length, 0, 'the previous session status cannot create a new household operation');
    assert.equal(f.requests.length, requestCount, 'the prior status cannot authorize even a household read with the new token');
    assert.equal(f.storage.getItem(outboxKey), outboxBefore, 'the old account outbox is retained without mutation');
    assert.equal(f.saved().planned[0].recipeId, 'local-after-session-change', 'the local save remains untouched');
  } finally {f.engine.destroy();}
});

test('an explicit pantry location edit reserves the unchanged physical quantity with its new location', {timeout:10000}, async () => {
  const f = await fixture();
  try {
    const stock = {'pasta|g':500}, beforeInventory = {pasta:{name:'Pasta',bb173StockKey:'pasta|g',selected:true,loc:'fridge',qty:500,unit:'g'}};
    const inventory = {pasta:{...beforeInventory.pasta,loc:'freezer'}};
    const kitchenKey = 'basketboss_makeameal_v1_inventory';
    f.storage.setItem(STOCK, JSON.stringify(stock));
    f.storage.setItem(kitchenKey, JSON.stringify(beforeInventory));
    const prepared = f.context.BBHouseholdSharingAuto.preparePantryEdit({beforeStock:clone(stock),stock:clone(stock),beforeInventory,inventory});
    assert.equal(prepared.queued, true);
    assert.equal(prepared.operationIds.length, 1, 'one explicit move creates one item intent without an amount delta');
    assert.equal(f.engine.read().pending.length, 0, 'preparation alone cannot upload the move');
    for (const [key, expected] of Object.entries(prepared.expected)) assert.equal(f.storage.getItem(key), expected);
    // The real editor combines these exact prepared outbox values with its
    // physical stock and Kitchen writes in one synchronous local transaction.
    for (const [key, value] of Object.entries({...prepared.updates,[STOCK]:stock,[kitchenKey]:inventory})) f.storage.setItem(key, JSON.stringify(value));
    const pending = clone(f.engine.read().pending);
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0].target, {kind:'pantry',key:'pasta|g'});
    assert.deepEqual(pending[0].value, {quantity:500,location:'freezer'});
    await f.engine.flush();
    const reserved = f.requests.filter(request => request.body?.action === 'sync_reserve');
    assert.equal(reserved.length, 1);
    assert.deepEqual(reserved[0].body.target, {kind:'pantry',key:'pasta|g'});
    assert.deepEqual(reserved[0].body.value, {quantity:500,location:'freezer'});
    assert.equal(reserved[0].body.operationId, prepared.operationIds[0]);
    assert.equal(f.requests.filter(request => request.body?.action === 'sync_apply').length, 1);
    assert.deepEqual(JSON.parse(f.storage.getItem(STOCK)), stock);
    assert.equal(JSON.parse(f.storage.getItem(kitchenKey)).pasta.loc, 'freezer');
  } finally {f.engine.destroy();}
});


test('a saved older-client dinner survives repeated background reads while unrelated shared days update',async()=>{
 const f=await fixture();
 try{
  const saved=f.saved();saved.planned.find(slot=>slot.day==='Monday').recipeId='saved-on-this-phone';
  f.storage.setItem(STATE,JSON.stringify(saved));f.context.state=clone(saved);
  f.receiveDinner('Tuesday','new-shared-tuesday');f.releasePantry.resolve({ok:true,localApplied:false});
  await f.engine.refresh();await f.engine.refresh();
  assert.equal(f.saved().planned.find(slot=>slot.day==='Monday')?.recipeId,'saved-on-this-phone');
  assert.equal(f.context.state.planned.find(slot=>slot.day==='Monday')?.recipeId,'saved-on-this-phone');
  assert.equal(f.saved().planned.find(slot=>slot.day==='Tuesday')?.recipeId,'new-shared-tuesday');
  assert.equal(f.requests.filter(request=>request.body).length,0,'a saved snapshot does not become a new deliberate edit');
 }finally{f.releasePantry.resolve({ok:true});f.engine.destroy();}
});

test('a later partner dinner wins after a matching local acknowledgment despite the older cached day',async()=>{
 const f=await fixture({afterApplyDinner:{day:'Tuesday',recipeId:'latest-partner-tuesday'}});
 try{
  f.releasePantry.resolve({ok:true,localApplied:false});f.replaceTuesday();await f.engine.flush();
  assert.equal(f.saved().planned.find(slot=>slot.day==='Tuesday')?.recipeId,'latest-partner-tuesday');
  assert.equal(f.context.state.planned.find(slot=>slot.day==='Tuesday')?.recipeId,'latest-partner-tuesday');
  assert.equal(f.requests.filter(request=>request.body?.action==='sync_reserve').length,1);
  assert.equal(f.engine.read().acknowledged.length,0,'proof is consumed after Plan memory and storage receive the authoritative day');
 }finally{f.releasePantry.resolve({ok:true});f.engine.destroy();}
});

test('a shared recipe with default servings suppresses its legacy count and accepts a later peer deletion',async()=>{
 const f=await fixture();
 try{
  const saved=f.saved();saved.mealServings['remote-monday']=6;
  f.storage.setItem(STATE,JSON.stringify(saved));f.context.state=clone(saved);
  f.releasePantry.resolve({ok:true,localApplied:false});
  // The complete peer snapshot has a new Monday recipe and no explicit count.
  // Its default must remain recipe-bound even when the old day also defaulted.
  f.receiveMonday();await f.engine.refresh();
  assert.equal(f.saved().planned.find(slot=>slot.day==='Monday')?.recipeId,'remote-monday');
  assert.deepEqual(f.saved().dayServings.Monday,{recipeId:'remote-monday',count:null});
  assert.deepEqual(clone(f.context.state.dayServings.Monday),{recipeId:'remote-monday',count:null});
  assert.equal(f.saved().mealServings['remote-monday'],6,'the unrelated legacy recipe preference stays saved but cannot override this shared day');

  f.removeDinner('Monday');await f.engine.refresh();await f.engine.refresh();
  assert.equal(f.saved().planned.some(slot=>slot.day==='Monday'),false,'a real peer delete is not mistaken for a conflict with a revived legacy count');
  assert.equal(f.context.state.planned.some(slot=>slot.day==='Monday'),false);
  assert.equal(f.saved().planned.find(slot=>slot.day==='Tuesday')?.recipeId,'old-tuesday');
  assert.equal(f.saved().customMarker,'keep-unrelated-data');
  assert.deepEqual(f.saved().plannedBreakfasts,[{day:'Monday',recipeId:'private-breakfast'}]);
  assert.equal(f.requests.filter(request=>request.body).length,0,'receiving a recipe/default pair or deletion creates no local intent');
  assert.equal(f.generatedIds.length,0);
 }finally{f.releasePantry.resolve({ok:true});f.engine.destroy();}
});


test('an older per-day revision cannot roll back a saved shared dinner even at a current household clock',async()=>{
 const f=await fixture();try{
  f.releasePantry.resolve({ok:true,localApplied:false});f.receiveMonday();await f.engine.refresh();
  assert.equal(f.saved().planned.find(slot=>slot.day==='Monday')?.recipeId,'remote-monday');
  f.staleDinner('Monday','old-cached-monday');await f.engine.refresh();
  assert.equal(f.saved().planned.find(slot=>slot.day==='Monday')?.recipeId,'remote-monday');
  assert.equal(f.context.state.planned.find(slot=>slot.day==='Monday')?.recipeId,'remote-monday');
  assert.equal(f.requests.filter(request=>request.body).length,0);
  f.removeDinner('Monday');await f.engine.refresh();
  assert.equal(f.saved().planned.some(slot=>slot.day==='Monday'),false,'a newer explicit deletion still replaces the saved dinner');
 }finally{f.releasePantry.resolve({ok:true});f.engine.destroy();}
});
