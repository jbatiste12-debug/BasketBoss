import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),{install}=require('../bb-home.js'),reduced=require('../bb-reduced-stock.js'),policy=require('../bb-pantry-policy.js');
const ACTOR='cooking-audit-account',STOCK='audit-stock',INVENTORY='audit-inventory',HOME='basketboss_at_home_requirements_v1';
const row=(qty,loc,extra={})=>({name:'Carrots',unit:'g',qty,loc,selected:true,bb173StockKey:'carrot|g',bb173StockValue:qty,...extra});
const urgent={version:1,actor:ACTOR,urgent:true,at:1,sources:['shop:reduced-carrots']};
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture({inventory,stock=500,converted=true}={}){
 const values=new Map([[STOCK,JSON.stringify({'carrot|g':stock})],[INVENTORY,JSON.stringify(inventory)],['basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR}})]]);let fail=false;
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){if(fail&&key===INVENTORY){fail=false;throw Error('storage failed');}values.set(key,String(value));},removeItem:key=>values.delete(key)};
 const ingredients=[{key:'Carrots',name:'Carrots',unit:'g',required:300}],occurrence='week-one|dinner|Monday|carrot-meal';
 const win={localStorage:storage,document:{},location:{search:''},BBReducedStock:reduced,BBPantryPolicy:policy,BBHomeHost:{
  keys:()=>({stock:STOCK,inventory:INVENTORY}),id:(name,unit)=>policy.canonicalName(name)+'|'+unit,
  stock:()=>JSON.parse(storage.getItem(STOCK)),recipeIngredients:(_id,factor)=>ingredients.map(value=>({...value,required:value.required*factor})),
  occurrence:()=>occurrence,refresh(){},...(converted?{conversionContext:()=>({pantryMode:true,market:'UK'})}:{}),
  dayMeals:()=>[{kind:'dinner',recipeId:'carrot-meal',name:'Dinner',day:'Monday',factor:1,occurrence,ingredients}]
 }};
 const home=install(win),event={recipeId:'carrot-meal',sessionId:'cook-once',day:'Monday',factor:1,actorId:ACTOR,occurrence};
 return {home,event,values,storage,win,failNext:()=>{fail=true;},inventory:()=>JSON.parse(storage.getItem(INVENTORY)),stock:()=>JSON.parse(storage.getItem(STOCK)),completed:()=>JSON.parse(storage.getItem(HOME)||'null')};
}

for(const converted of [true,false]){
 test(`an unselected Kitchen record cannot capture remaining active stock (${converted?'converted':'metric'})`,async()=>{
  const inactive={...row(900,'cupboard'),selected:false},h=fixture({converted,inventory:{inactive,active:row(500,'fridge')}});
  assert.equal((await h.home.cooked(h.event)).ok,true);assert.deepEqual(h.stock(),{'carrot|g':200});
  assert.deepEqual(h.inventory().inactive,inactive);assert.equal(h.inventory().active.qty,200);assert.equal(h.inventory().active.bb173StockValue,200);
 });
 test(`Cook consumes reduced fresh stock before frozen stock and clears its pin atomically (${converted?'converted':'metric'})`,async()=>{
  const h=fixture({converted,inventory:{reduced:row(300,'fridge',{bbReduced:urgent}),frozen:row(200,'freezer')}}),preview=h.home.previewCook(h.event);
  assert.equal(preview.ok,true);assert.equal((await h.home.cooked({...h.event,expected:preview.fingerprint})).ok,true);
  assert.deepEqual(h.stock(),{'carrot|g':200});assert.equal(h.inventory().reduced.qty,0);assert.equal(h.inventory().reduced.bbReduced.urgent,false);
  assert.equal(h.inventory().frozen.qty,200);assert.equal(h.inventory().frozen.loc,'freezer');
  const before=clone([...h.values]);assert.equal((await h.home.cooked({...h.event,sessionId:'reopened'})).already,true);assert.deepEqual([...h.values],before);
 });
 test(`Cook uses unfrozen stock before ordinary freezer stock (${converted?'converted':'metric'})`,async()=>{
  const h=fixture({converted,inventory:{fresh:row(300,'fridge'),frozen:row(200,'freezer')}});
  assert.equal((await h.home.cooked(h.event)).ok,true);assert.equal(h.inventory().fresh.qty,0);assert.equal(h.inventory().frozen.qty,200);
 });
}

test('Day done shares the same reduced-first stock allocation and rollback is safe',async()=>{
 const h=fixture({inventory:{reduced:row(300,'fridge',{bbReduced:urgent}),frozen:row(200,'freezer')}}),before=clone([...h.values]);
 const preview=h.home.previewDay({day:'Monday',actorId:ACTOR});assert.equal(preview.ok,true);h.failNext();
 await assert.rejects(h.home.finishDay({day:'Monday',actorId:ACTOR,expected:preview.fingerprint}),/storage failed/);assert.deepEqual([...h.values],before);assert.equal(h.completed(),null);
 const retry=h.home.previewDay({day:'Monday',actorId:ACTOR}),result=await h.home.finishDay({day:'Monday',actorId:ACTOR,expected:retry.fingerprint});
 assert.equal(result.ok,true);assert.equal(h.inventory().reduced.bbReduced.urgent,false);assert.equal(h.inventory().frozen.qty,200);
 assert.equal((await h.home.finishDay({day:'Monday',actorId:ACTOR})).already,true);assert.deepEqual(h.stock(),{'carrot|g':200});
});

test('cooking more than available floors stock and reduced metadata at zero without resurrecting a pin',async()=>{
 const h=fixture({stock:100,inventory:{reduced:row(100,'fridge',{bbReduced:urgent})}});
 assert.equal((await h.home.cooked(h.event)).ok,true);assert.deepEqual(h.stock(),{});assert.equal(h.inventory().reduced.qty,0);assert.equal(h.inventory().reduced.bbReduced.urgent,false);
 const used=h.inventory(),refilled=reduced.prepareInventory({before:used,after:{reduced:{...used.reduced,qty:200,bb173StockValue:200}},credits:[],sourceId:'shop:normal-refill',actor:ACTOR,policy});
 assert.equal(reduced.isUrgent(refilled.reduced,{actor:ACTOR}),false);
});
