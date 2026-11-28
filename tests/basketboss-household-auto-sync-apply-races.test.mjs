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

async function fixture() {
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
    assert.equal(operation.target.kind, 'dinner');
    entries.set('planned_day:' + operation.target.key, row('planned_day',operation.target.key,{recipeId:operation.value.recipeId},operation.order));
    entries.set('servings:' + operation.target.key, row('servings',operation.target.key,operation.value.servings === null ? {deleted:true} : {count:operation.value.servings},operation.order));
    operation.status = 'applied';
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
