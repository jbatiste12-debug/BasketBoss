import test from 'node:test';
import assert from 'node:assert/strict';
import {householdAutoSync, validateHouseholdSyncInput} from '../bb-server-lib/bb-household-auto-sync.js';

const actor = '11111111-1111-4111-8111-111111111111';
const household = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reserve = (target = {kind:'dinner',key:'Monday'}, value = {recipeId:'pasta',servings:2}) =>
  ({action:'sync_reserve',expectedHouseholdId:household,operationId:id,baseClock:0,target,value});
const projection = (extra = {}) => ({ok:true,protocol:2,household_id:household,clock:1,pruneFloor:0,
  operation:{id,order:1,status:'reserved'},state:{entries:[]},...extra});
const call = (data, response, extra = {}) => householdAutoSync({data,actor:{id:actor},household:{id:household},
  supa:async () => response,...extra});

test('server actor, household and inventory gate are forwarded independently of request fields', async () => {
  const calls = [];
  const result = await call(reserve(), null, {supa:async (...args) => {calls.push(args);return projection();}});
  assert.equal(result.status,200);
  assert.deepEqual(calls[0],['rpc/bb_hh_service_sync_v2','POST',{
    p_actor:actor,p_household:household,p_action:'reserve',p_inventory_allowed:false,
    p_payload:{expectedHouseholdId:household,operationId:id,baseClock:0,target:{kind:'dinner',key:'Monday'},value:{recipeId:'pasta',servings:2}}
  }]);
  const injected = await call({...reserve(),inventoryAllowed:true,actorId:id}, projection());
  assert.equal(injected.status,400);
});

test('household mismatch, malformed UUID and extra payload fields never reach the database', async () => {
  let invoked = 0;
  for (const data of [{...reserve(),expectedHouseholdId:id},{...reserve(),operationId:'old-request'},
      {...reserve(),order:999},{...reserve(),baseClock:Number.MAX_SAFE_INTEGER+1}]) {
    const result = await call(data,null,{supa:async () => {invoked++;}});
    assert.equal(result.status,400);
  }
  assert.equal(invoked,0);
});

test('dinner defaults, paired deletion and all seven days are accepted without inventing counts', () => {
  for (const day of ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']) {
    assert.equal(validateHouseholdSyncInput(reserve({kind:'dinner',key:day},{recipeId:'dinner',servings:null}),household).payload.value.servings,null);
    assert.deepEqual(validateHouseholdSyncInput(reserve({kind:'dinner',key:day},{recipeId:null,servings:null}),household).payload.value,{recipeId:null,servings:null});
  }
  for (const value of [{recipeId:null,servings:2},{recipeId:'dinner',servings:0},{recipeId:'dinner',servings:13},{recipeId:'dinner',servings:1.5}])
    assert.throws(() => validateHouseholdSyncInput(reserve(undefined,value),household));
});

test('Pantry writes need the server inventory gate and canonical identities; partial counts retain precision', async () => {
  const data = reserve({kind:'pantry',key:'egg|each'},{quantity:1.125,location:'fridge'});
  assert.equal((await call(data,projection())).status,403);
  const state = {entries:[],initialized:true,inventoryRevision:4,stock:{'egg|each':1.125},locations:{'egg|each':'fridge'}};
  assert.equal((await call(data,projection({state}),{inventoryAllowed:true})).status,200);
  for (const key of ['eggs|each','pasta|kg','soap|each','__proto__|g','pasta|g|each'])
    assert.throws(() => validateHouseholdSyncInput(reserve({kind:'pantry',key},{quantity:0,location:'cupboard'}),household));
  assert.equal(validateHouseholdSyncInput(reserve({kind:'pantry',key:'egg|each'},{quantity:0,location:'fridge'}),household).payload.value.quantity,0);
});

test('settings preserve feeding/budget/shopping types and explicit tombstones', () => {
  for (const [key,value] of [['household_servings:default',{count:12}],['budget_target:weekly',{amount:1.25}],['shopping_checked:pasta',false],['shopping_checked:pasta',{deleted:true}]])
    assert.deepEqual(validateHouseholdSyncInput(reserve({kind:'setting',key},value),household).payload.value,value);
  for (const [key,value] of [['household_servings:default',{count:0}],['budget_target:weekly',{amount:10001}],['shopping_checked:pasta',null],['shopping_checked:__bb_sync_v2:clock',true]])
    assert.throws(() => validateHouseholdSyncInput(reserve({kind:'setting',key},value),household));
});

test('apply forwards the original reservation order; expired unknown operations are final acknowledgments', async () => {
  const data = {action:'sync_apply',expectedHouseholdId:household,operationId:id,order:7};
  let payload;
  const result = await call(data,null,{supa:async (_path,_method,args) => {payload=args.p_payload;return projection({clock:8,operation:{id,order:7,status:'superseded'}});}});
  assert.equal(result.status,200);assert.equal(payload.order,7);
  const expired = await call(data,projection({clock:2048,pruneFloor:1024,operation:{id,order:null,status:'expired'}}));
  assert.equal(expired.status,200);assert.equal(expired.body.operation.status,'expired');
  assert.equal((await call(data,projection({clock:8,operation:{id,order:8,status:'applied'}}))).status,503);
});

test('unexpected metadata, another household or unapproved stock never escape response validation', async () => {
  const privateEntry = {section:'kitchen_item',entry_key:'__bb_sync_v2:op:'+id,value:{actor},revision:1,updated_at:'2026-11-28T00:00:00Z'};
  const responses = [projection({household_id:id}),projection({state:{entries:[privateEntry]}}),
    projection({state:{entries:[],stock:{'egg|each':2},locations:{},inventoryRevision:1,initialized:true}}),
    projection({operation:{id,order:1,status:'reserved',intent:{actor}}})];
  for (const response of responses) assert.equal((await call(reserve(),response)).status,503);
});

test('retryable readiness failures retain machine-readable retry semantics and conceal transport errors', async () => {
  const pending = await call(reserve(),{ok:false,error:'household_sync_initialization_pending',retryable:true});
  assert.deepEqual(pending,{status:503,body:{ok:false,error:'household_sync_initialization_pending',retryable:true}});
  const failed = await call(reserve(),null,{supa:async () => {throw Error('private-service-credential');}});
  assert.equal(failed.status,503);assert.equal(JSON.stringify(failed).includes('private-service'),false);
});
