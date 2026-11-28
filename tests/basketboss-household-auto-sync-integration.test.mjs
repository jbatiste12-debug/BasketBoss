import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import * as core from '../bb-receipt-inventory-core.mjs';

// Run shipped sharing/outbox/receipt modules and original app entrypoints. Only
// the DOM shell, recipe catalogue and authenticated network server are fixtures.
// Real PostgreSQL transactional coverage lives in verify-household-auto-sync-postgres.
const require = createRequire(import.meta.url);
const html = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const engineSource = read('../bb-household-auto-sync.js');
const inventorySource = read('../bb-receipt-inventory.js');
const receiptSource = read('../bb-receipt-host.js');
const originalSharing = read('../bb-household-sharing.js');
const sharingSource = originalSharing.replace('function boot(){',
  'window.__integration={refreshStatus,ensureAuto,autoSynchronize,autoPublishCurrent,accountPin,foregroundCheck,engine:()=>autoEngine};function boot(){');
assert.notEqual(sharingSource, originalSharing);
const section = (start, end, offset = 0) => {
  const first = html.indexOf(start, offset), last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return html.slice(first, last);
};
const hostSource = section('function normalize(s){', '\nfunction norm(s)') + '\n' +
  section('function bbSharedHouseholdScreenReady(', 'window.BBHomeHost=Object.freeze(') + '\n' +
  'window.BBHomeHost={canRefreshSharedHousehold:bbCanRefreshSharedHousehold,refreshSharedHousehold:bbRefreshSharedHousehold,prepareSharedHouseholdRecipes:bbPrepareSharedHouseholdRecipes,prepareEmptySharedHousehold:bbPrepareEmptySharedHousehold};\n' +
  section('function persist(){', 'function notify(msg){') + '\n' +
  section('function bbFeedingSave(', '/* Each day stepper') + '\n' +
  section('function addRecipe(id,day){', '\nfunction renderWeek(') + '\n' +
  section('function bb307SetPantry(', '// Meal cards use');
const replaceSource = section('  function commit(newId) {', '  function redraw() {', html.indexOf('id="bb172ReplaceTitle"'));
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PARTNER = '22222222-2222-4222-8222-222222222222';
const HH = '33333333-3333-4333-8333-333333333333';
const AUTH = 'basketboss_cloud_session_v1';
const STATE = 'basketboss_321_unified_state_v1';
const STOCK = 'basketboss_321_v7_measured_pantry';
const KITCHEN = 'basketboss_makeameal_v1_inventory';
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve;const promise = new Promise(done => {resolve = done;});return {promise, resolve};};
const turn = () => new Promise(resolve => setImmediate(resolve));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function orderedServer() {
  const entries = new Map([['household_servings:default', {section:'household_servings',entry_key:'default',value:{count:4},revision:1}]]);
  const operations = new Map(), targets = new Map(), requests = [], gates = new Map(), readGates = new Map(), lostAcks = new Set();
  let clock = 0, inventoryRevision = 1, stock = {}, locations = {};
  const inventory = () => ({ok:true,schemaVersion:1,autoStockReady:true,scope:{kind:'household',id:HH},initialized:true,
    inventoryRevision,stock:clone(stock),inventory:Object.entries(stock).map(([stockKey,quantity]) => {
      const index = stockKey.lastIndexOf('|');return {stockKey,canonicalKey:stockKey.slice(0,index),unit:stockKey.slice(index+1),quantity,location:locations[stockKey] || 'cupboard',revision:inventoryRevision};
    }),essentials:[],receipts:[],priceObservations:[],pantryReview:{required:false,shopSessionId:null,confirmedAt:null}});
  const snapshot = operation => ({ok:true,protocol:2,household_id:HH,clock,pruneFloor:0,
    ...(operation ? {operation:{id:operation.id,order:operation.order,status:operation.status}} : {}),
    state:{entries:clone([...entries.values()]),stock:clone(stock),locations:clone(locations),inventoryRevision,initialized:true,inventory:inventory()}});
  function leaf(section, entry_key, value) {
    const key = section + ':' + entry_key, old = entries.get(key);
    entries.set(key,{section,entry_key,value:clone(value),revision:(old?.revision || 0)+1,updated_at:'2026-11-28T12:00:00Z'});
  }
  return {requests, operations, inventory, snapshot,
    reserveCount:() => requests.filter(row => row.body?.action === 'sync_reserve').length,
    appliedCount:() => [...operations.values()].filter(row => row.status === 'applied').length,
    stock:() => clone(stock),
    dinner:day => entries.get('planned_day:' + day)?.value,
    pauseApply(actor) {const gate={started:deferred(),release:deferred()};gates.set(actor,gate);return gate;},
    pauseRead(actor) {const gate={started:deferred(),release:deferred()};readGates.set(actor,gate);return gate;},
    loseApplyAck(actor) {lostAcks.add(actor);},
    async fetch(url, options = {}) {
      const headers = options.headers || {}, token = headers.Authorization || headers.authorization || '';
      const actor = token === 'Bearer token-owner' ? ACTOR : token === 'Bearer token-partner' ? PARTNER : null;
      assert.ok(actor, 'every endpoint receives the authenticated actor token');
      const body = options.body ? JSON.parse(options.body) : null, parsed = new URL(url, 'https://basketboss.co.uk');
      requests.push({actor,url:String(url),body:clone(body)});
      if (parsed.pathname === '/api/receipt-inventory') {
        assert.equal(body,null,'automatic household sync never writes the old whole-stock receipt endpoint');
        return Response.json(parsed.searchParams.get('mode') === 'status' ? {ok:true,available:true,premium:true,configured:true} : inventory());
      }
      assert.equal(parsed.pathname,'/api/household');
      if (!body) {
        if (parsed.searchParams.get('mode') === 'auto_sync') {const gate=readGates.get(actor);if(gate){readGates.delete(actor);gate.started.resolve();await gate.release.promise;}return Response.json(snapshot());}
        return Response.json({configured:true,premium:true,role:actor === ACTOR ? 'owner' : 'partner',household_id:HH,invite_status:'accepted'});
      }
      assert.ok(['sync_reserve','sync_apply'].includes(body.action),'receiving a snapshot never uploads a legacy patch, invite or restore');
      assert.equal(body.expectedHouseholdId,HH);
      if (body.action === 'sync_reserve') {
        let operation = operations.get(body.operationId);
        if (operation) assert.ok(same(operation.intent,{actor,baseClock:body.baseClock,target:body.target,value:body.value}),'retry identity remains immutable');
        else {
          operation = {id:body.operationId,order:++clock,status:'reserved',intent:clone({actor,baseClock:body.baseClock,target:body.target,value:body.value})};
          operations.set(operation.id,operation);targets.set(body.target.kind + ':' + body.target.key,operation.order);
        }
        return Response.json(snapshot(operation));
      }
      const operation = operations.get(body.operationId);
      assert.ok(operation);assert.equal(operation.intent.actor,actor);assert.equal(operation.order,body.order);
      const gate = gates.get(actor);if (gate) {gates.delete(actor);gate.started.resolve();await gate.release.promise;}
      if (operation.status === 'reserved') {
        const {target,value} = operation.intent;
        if (targets.get(target.kind + ':' + target.key) > operation.order) operation.status = 'superseded';
        else {
          if (target.kind === 'dinner') {
            leaf('planned_day',target.key,value.recipeId === null ? {deleted:true} : {recipeId:value.recipeId});
            leaf('servings',target.key,value.servings === null ? {deleted:true} : {count:value.servings});
          } else if (target.kind === 'pantry') {
            if (value.quantity === 0) {delete stock[target.key];delete locations[target.key];}
            else {stock[target.key]=value.quantity;locations[target.key]=value.location;}
            inventoryRevision++;
          } else {const split=target.key.indexOf(':');leaf(target.key.slice(0,split),target.key.slice(split+1),value);}
          operation.status = 'applied';
        }
      }
      if (lostAcks.delete(actor)) throw Error('Synthetic transport loss after the server committed');
      return Response.json(snapshot(operation));
    }
  };
}

function element(tag = 'div') {
  return {tagName:tag.toUpperCase(),nodes:[],dataset:{},hidden:false,classList:{contains:()=>false,add(){},remove(){}},style:{},
    append(...nodes){this.nodes.push(...nodes);},appendChild(node){this.append(node);return node;},replaceChildren(...nodes){this.nodes=nodes;},
    querySelector:() => null,querySelectorAll:() => [],setAttribute(){},getAttribute:() => null,addEventListener(){},remove(){},
    getClientRects:() => [{}],matches:() => false};
}

async function device(server, actor, {values = new Map(), initialPlan = [], initialize = true} = {}) {
  const token = actor === ACTOR ? 'token-owner' : 'token-partner';
  if (!values.has(AUTH)) values.set(AUTH,JSON.stringify({user:{id:actor},access_token:token,expires_at:9999999999}));
  if (!values.has(STATE)) values.set(STATE,JSON.stringify({version:2,planned:initialPlan,plannedBreakfasts:[{day:'Monday',recipeId:'private-breakfast'}],plannedDesserts:[],pantry:{'private-checklist':true},servings:4,feedingSet:true}));
  const storage={getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,String(value)),removeItem:key => values.delete(key)};
  const events = new EventTarget(), body=element('body'), app=element('main'), renders=[], notices=[];
  const document={readyState:'loading',hidden:false,activeElement:null,body,currentScript:null,
    createElement:element,getElementById:id => id === 'app' ? app : null,querySelector:() => null,querySelectorAll:() => [],addEventListener(){},removeEventListener(){}};
  const ctx={window:null,document,localStorage:storage,navigator:{onLine:true},console,JSON,Map,Set,Date,Intl,Event,URL,Response,
    crypto:{randomUUID},queueMicrotask,setTimeout,clearTimeout,AbortController,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),
    location:{href:'https://basketboss.co.uk/app',hash:''},MutationObserver:class{observe(){}disconnect(){}},setInterval(){},
    fetch:server.fetch.bind(server),confirm:() => true,KEY:STATE,DAYS,BB_SNAPSHOT:'basketboss_321_unified_recovery_v1',OLD_PLAN:'basketboss_321_unified_oldplan_v1',OLD_PANTRY:'basketboss_321_unified_oldpantry_v1',
    BBServing:require('../bb-serving-scale.js'),BBPlanExtras:require('../bb-plan-extras.js'),bbStorageSafe:true,bbRecovered:false,
    bbVerifiedPaidRecipes:true,bbPremiumUser:actor,bbPremiumToken:token,bbPremiumReload:async () => {},
    bb307ReadStock:() => JSON.parse(storage.getItem(STOCK) || '{}'),bb307ReadFeatures:() => ({version:1,essentials:[]}),
    bb307NormaliseName:value => value.toLowerCase(),BB307Pantry:{pantryId:(name,unit) => name.toLowerCase()+'|'+unit,stockToBase:Number},
    notify:message => notices.push(message),render:() => renders.push(clone(ctx.state)),getRecipe:id => ({id,name:id}),bbIsBreakfast:() => false,bbIsDessert:() => false,
    bb176AllowedRecipe:() => true,bb176OpenPremiumUpgrade(){throw Error('Synthetic catalogue is public');},bbBatchPairs:() => [],bbRecordPlannedRecipes(){},bbAfIngredientAllowed:() => true,close(){},
    bb307SaveStock(stock){storage.setItem(STOCK,JSON.stringify(stock));ctx.bb307Stock=clone(stock);return true;}};
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(hostSource,ctx);ctx.state=ctx.normalize(JSON.parse(storage.getItem(STATE)));ctx.bb307Stock=ctx.bb307ReadStock();ctx.bb307FeatureState=ctx.bb307ReadFeatures();
  vm.runInContext(inventorySource,ctx);vm.runInContext(receiptSource,ctx);
  const getSession=() => JSON.parse(storage.getItem(AUTH)),getContext=() => ({market:'UK',retailer:'Tesco',shopSessionId:'integration-trip'});
  const inventory=ctx.BBReceiptInventoryFactory({core,storage,fetch:ctx.fetch,getSession,getContext});
  await inventory.synchronize();
  ctx.BBReceiptHost=ctx.BBReceiptHostFactory({storage,inventory,fetch:ctx.fetch,getSession,getContext,accountPantrySync:true,getStock:ctx.bb307ReadStock,document:{getElementById:() => null,querySelector:() => null,querySelectorAll:() => []}});
  ctx.BBReceiptHost.configure();
  vm.runInContext(engineSource,ctx);vm.runInContext(sharingSource,ctx);
  const api=ctx.__integration;
  const fixture={actor,ctx,values,storage,api,inventory,renders,notices,
    state:() => clone(ctx.state),saved:() => JSON.parse(storage.getItem(STATE)),stock:() => JSON.parse(storage.getItem(STOCK) || '{}'),
    queued:() => clone(api.engine()?.read().pending || []),
    async initialize(){await api.refreshStatus();await api.ensureAuto();await turn();},
    async sync(){await api.foregroundCheck({force:true});await turn();},
    pick(day,recipeId){
      ctx.selectedDay=day;ctx.nextId=recipeId;ctx.currentId=ctx.state.planned.find(row => row.day===day)?.recipeId;
      if (ctx.currentId) vm.runInContext(replaceSource+'\ncommit(nextId);',ctx);
      else vm.runInContext('addRecipe(nextId,selectedDay);',ctx);
    },
    setPantry(name,unit,quantity){ctx.manualPantry={name,unit,quantity};return vm.runInContext('bb307SetPantry(manualPantry.name,manualPantry.unit,manualPantry.quantity,manualPantry.unit)',ctx);},
    feed(day,count){ctx.selectedDay=day;ctx.nextCount=count;ctx.currentId=ctx.state.planned.find(row => row.day===day)?.recipeId;return vm.runInContext('bbFeedingSave(nextCount,currentId,selectedDay)',ctx);},
    publish:() => api.autoPublishCurrent(api.accountPin(),HH),
    destroy(){api.engine()?.destroy();}
  };
  if (initialize) await fixture.initialize();
  return fixture;
}

test('manual owner Salmon and Pasta edits reach the partner Plan and pantry, then partner day and milk edits merge back', async () => {
  const server=orderedServer(),owner=await device(server,ACTOR),partner=await device(server,PARTNER);
  try {
    assert.equal(owner.ctx.BBHouseholdSharingAuto.isReady(),true,JSON.stringify({engine:owner.api.engine()?.read(),requests:server.requests}));
    owner.pick('Monday','salmon');assert.equal(owner.setPantry('Pasta','g',500),true);await turn();
    assert.deepEqual(server.dinner('Monday'),{recipeId:'salmon'},JSON.stringify({engine:owner.api.engine()?.read(),requests:server.requests}));assert.deepEqual(server.stock(),{'pasta|g':500});
    await partner.sync();
    assert.equal(partner.state().planned.find(row => row.day==='Monday')?.recipeId,'salmon');
    assert.deepEqual(partner.stock(),{'pasta|g':500});assert.equal(partner.renders.at(-1).planned.find(row => row.day==='Monday')?.recipeId,'salmon');
    partner.pick('Tuesday','chilli');assert.equal(partner.setPantry('Milk','ml',750),true);await partner.sync();await owner.sync();
    assert.deepEqual(owner.state().planned.map(row => [row.day,row.recipeId]).sort(),[['Monday','salmon'],['Tuesday','chilli']]);
    assert.deepEqual(owner.stock(),{'pasta|g':500,'milk|ml':750});
    const requests=server.reserveCount();await owner.sync();await partner.sync();assert.equal(server.reserveCount(),requests,'received snapshots never echo back as fresh deliberate edits');
    assert.deepEqual(owner.saved().plannedBreakfasts,[{day:'Monday',recipeId:'private-breakfast'}]);assert.equal(owner.saved().pantry['private-checklist'],true);
    assert.ok(Object.values(JSON.parse(partner.storage.getItem(KITCHEN))).some(row => row.bb173StockKey==='pasta|g'&&row.qty===500),'actual receipt adapter projects shared stock into Kitchen');
    assert.equal(server.requests.filter(row => row.body).every(row => ['sync_reserve','sync_apply'].includes(row.body.action)),true);
  } finally {owner.destroy();partner.destroy();}
});

test('different offline item/day edits retain both actors changes instead of replacing a whole week or stock map', async () => {
  const server=orderedServer(),owner=await device(server,ACTOR),partner=await device(server,PARTNER);
  try {
    owner.pick('Monday','salmon');owner.setPantry('Pasta','g',500);
    partner.pick('Wednesday','curry');partner.setPantry('Milk','ml',250);
    await Promise.all([owner.sync(),partner.sync()]);await owner.sync();await partner.sync();
    for (const device of [owner,partner]) {
      assert.deepEqual(device.state().planned.map(row => [row.day,row.recipeId]).sort(),[['Monday','salmon'],['Wednesday','curry']]);
      assert.deepEqual(device.stock(),{'pasta|g':500,'milk|ml':250});
    }
    assert.equal(server.reserveCount(),4);
  } finally {owner.destroy();partner.destroy();}
});

test('a later same-day reservation wins while the earlier apply is delayed, with no conflict-review path', {timeout:3000}, async () => {
  const server=orderedServer(),owner=await device(server,ACTOR),partner=await device(server,PARTNER),gate=server.pauseApply(ACTOR);
  try {
    owner.pick('Monday','salmon');const waiting=owner.sync();await gate.started.promise;
    partner.pick('Monday','chilli');await partner.sync();gate.release.resolve();await waiting;await partner.sync();
    assert.deepEqual(server.dinner('Monday'),{recipeId:'chilli'});
    for (const device of [owner,partner]) {assert.equal(device.state().planned.find(row => row.day==='Monday')?.recipeId,'chilli');assert.equal(device.queued().length,0);}
    assert.deepEqual([...server.operations.values()].map(row => row.status),['superseded','applied']);
    assert.equal(server.reserveCount(),2,'the older intention never receives a fresh reservation');
  } finally {gate.release.resolve();owner.destroy();partner.destroy();}
});

test('all seven deliberately chosen dinners and a bound headcount arrive together without touching private breakfasts', async () => {
  const server=orderedServer(),owner=await device(server,ACTOR),partner=await device(server,PARTNER);
  try {
    for (const [index,day] of DAYS.entries()) owner.pick(day,'dinner-'+index);
    assert.equal(owner.feed('Monday',6),true);await owner.sync();await partner.sync();
    assert.deepEqual(partner.state().planned.map(row => row.day).sort(),[...DAYS].sort());
    assert.deepEqual(partner.saved().dayServings.Monday,{recipeId:'dinner-0',count:6});
    assert.equal(partner.saved().servings,4);
    assert.deepEqual(partner.saved().plannedBreakfasts,[{day:'Monday',recipeId:'private-breakfast'}]);
    assert.equal(partner.queued().length,0);assert.equal(server.reserveCount(),8);
  } finally {owner.destroy();partner.destroy();}
});

test('receipt foreground refresh cannot send a legacy whole-stock overwrite while a manual item edit awaits protocol handshake', {timeout:3000}, async () => {
  const server=orderedServer(),owner=await device(server,ACTOR,{initialize:false}),gate=server.pauseRead(ACTOR);
  try {
    await owner.api.refreshStatus();await gate.started.promise;
    assert.equal(owner.ctx.BBHouseholdSharingAuto.canCapture(),true);assert.equal(owner.ctx.BBHouseholdSharingAuto.isReady(),false);
    assert.equal(owner.setPantry('Pasta','g',500),true);assert.equal(owner.queued().length,1);
    await owner.ctx.BBReceiptHost.refreshAccountPantry();
    assert.deepEqual(server.requests.filter(row => row.url.startsWith('/api/receipt-inventory')&&row.body),[],
      'staged item intent must never become an untagged whole-household stock write');
    assert.equal(owner.storage.getItem('basketboss_purchase_pantry_sync_v1:'+ACTOR),null,
      'the receipt refresh must retain the already staged item operation instead of creating a second legacy queue');
    gate.release.resolve();await owner.api.ensureAuto();await owner.sync();
    assert.deepEqual(server.stock(),{'pasta|g':500});assert.equal(owner.queued().length,0);
  } finally {gate.release.resolve();owner.destroy();}
});

test('a private local stock restore before household status is known is never inferred to be a shared deliberate edit', async () => {
  const server=orderedServer(),owner=await device(server,ACTOR,{initialize:false});
  try {
    owner.storage.setItem(STOCK,JSON.stringify({'pasta|g':900}));owner.ctx.bb307Stock=owner.stock();
    assert.equal(owner.ctx.BBHouseholdSharingAuto.canCapture(),false);
    await owner.ctx.BBReceiptHost.refreshAccountPantry();
    assert.equal(server.reserveCount(),0);
    assert.deepEqual(server.requests.filter(row => row.body),[],
      'startup stock mismatch is a local snapshot, never permission to replace all household items');
    assert.deepEqual(server.stock(),{});
  } finally {owner.destroy();}
});

test('a lost apply acknowledgment survives reload with its original identity and cannot replace a newer partner dinner', async () => {
  const server=orderedServer(),owner=await device(server,ACTOR);let partner,reloaded;
  try {
    server.loseApplyAck(ACTOR);owner.pick('Monday','salmon');await owner.sync();
    assert.equal(owner.queued().length,1);const old=owner.queued()[0];assert.ok(old.order>0);assert.deepEqual(server.dinner('Monday'),{recipeId:'salmon'});
    partner=await device(server,PARTNER);partner.pick('Monday','chilli');await partner.sync();
    owner.destroy();reloaded=await device(server,ACTOR,{values:owner.values});await reloaded.sync();
    assert.equal(reloaded.queued().length,0);assert.equal(reloaded.state().planned.find(row => row.day==='Monday')?.recipeId,'chilli');
    const reservations=server.requests.filter(row => row.body?.action==='sync_reserve'&&row.body.operationId===old.id);
    assert.equal(reservations.length,1);assert.equal(server.operations.get(old.id).order,old.order);
    assert.deepEqual(server.dinner('Monday'),{recipeId:'chilli'});
    const count=server.reserveCount();await reloaded.sync();assert.equal(server.reserveCount(),count);
  } finally {owner.destroy();partner?.destroy();reloaded?.destroy();}
});

test('a restored private owner week is held locally without uploading it until the explicit publish action completes', async () => {
  const server=orderedServer(),owner=await device(server,ACTOR,{initialPlan:[{day:'Monday',recipeId:'private-restored-salmon'}]});
  try {
    await owner.sync();assert.equal(server.reserveCount(),0);assert.equal(server.dinner('Monday'),undefined);
    assert.equal(owner.state().planned[0].recipeId,'private-restored-salmon');
    assert.equal((await owner.publish()).ok,true);assert.equal(owner.queued().length,0);
    assert.deepEqual(server.dinner('Monday'),{recipeId:'private-restored-salmon'});
    assert.equal(server.reserveCount(),7,'explicit initial share includes every dinner day, including empty-day tombstones');
    const count=server.reserveCount();await owner.sync();assert.equal(server.reserveCount(),count);
  } finally {owner.destroy();}
});
