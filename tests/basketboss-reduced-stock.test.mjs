import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),api=require('../bb-reduced-stock.js'),policy=require('../bb-pantry-policy.js'),autofill=require('../bb-pantry-autofill.js');
const actor='tester-account',at='2026-11-05T12:00:00Z',opts={actor,at,policy};
const row=(qty,loc='fridge',extra={})=>({name:'Carrots',qty,unit:'g',loc,selected:true,...extra});
const bought=(before,after,extra={})=>api.prepareInventory({before,after,credits:[{name:'Carrots',quantity:300,unit:'g'}],sourceId:'shop:one',...opts,...extra});

test('only a confirmed reduced stock credit annotates the existing pantry row without changing balances',()=>{
 const before={carrots:row(200)},after={carrots:row(500)},original=JSON.stringify([before,after]);
 const result=bought(before,after);
 assert.equal(result.carrots.qty,500);assert.equal(result.carrots.loc,'fridge');assert.equal(api.isUrgent(result.carrots,{actor}),true);
 assert.equal(JSON.stringify([before,after]),original,'the caller commits the prepared copy atomically');
 const ordinary=api.prepareInventory({before,after,credits:[],sourceId:'shop:ordinary',...opts});assert.equal(ordinary.carrots.bbReduced,undefined);
 const intention=bought(before,before);assert.equal(intention.carrots.bbReduced,undefined,'a shopping intent or tick without stock credit is insufficient');
});
test('receipt credit netting can mark a reviewed previously credited purchase, without crediting stock again',()=>{
 const current={carrots:row(500)},credit={name:'Carrots',unit:'g',quantity:300,previouslyCreditedQuantity:300,legacyCreditId:'shop-one-carrots'};
 const result=api.prepareInventory({before:current,after:current,credits:[credit],sourceId:'receipt:one',...opts});
 assert.equal(result.carrots.qty,500);assert.equal(api.isUrgent(result.carrots,{actor}),true);
 for(const patch of [{sourceId:'shop:one'},{credits:[{...credit,legacyCreditId:''}]},{credits:[{...credit,previouslyCreditedQuantity:301}]}]){
  const rejected=api.prepareInventory({before:current,after:current,credits:[credit],sourceId:'receipt:one',...opts,...patch});assert.equal(rejected.carrots.bbReduced,undefined);
 }
});
test('freezing conserves the full saved amount and replay cannot reactivate its urgency',()=>{
 const marked=bought({carrots:row(200)},{carrots:row(500)}),frozen=api.freeze(marked.carrots,opts);
 assert.equal(frozen.qty,500);assert.equal(frozen.unit,'g');assert.equal(frozen.loc,'freezer');assert.equal(api.isUrgent(frozen,{actor}),false);
 assert.deepEqual(frozen.bbReduced.sources,marked.carrots.bbReduced.sources);
 const replay=bought({carrots:frozen},{carrots:{...frozen,qty:800,loc:'fridge'}});
 assert.equal(replay.carrots.qty,800);assert.equal(api.isUrgent(replay.carrots,{actor}),false);
 assert.throws(()=>api.freeze(frozen,opts),/changed/);
});
test('projecting a cloud balance keeps frozen buckets while fresh purchases remain outside the freezer',()=>{
 const source=bought({}, {carrots:row(200)}),frozen=api.freeze(source.carrots,opts);
 const inventory={frozen,fridge:{...row(100),bb173StockKey:'carrot|g',bb173StockValue:100}};
 const project=(value,currentQuantity,nextQuantity)=>api.projectFrozenBuckets({inventory:value,stockKey:'carrot|g',currentQuantity,nextQuantity,location:'fridge',...opts});
 const same=project(inventory,300,300);assert.equal(same.frozen.loc,'freezer');assert.equal(same.frozen.qty,200);assert.equal(same.fridge.qty,100);
 const increased=project(same,300,500);assert.equal(increased.frozen.qty,200);assert.equal(increased.fridge.qty,300);assert.equal(increased.frozen.bbReduced.urgent,false);
 const decreased=project(increased,500,150);assert.equal(decreased.fridge.selected,false);assert.equal(decreased.frozen.qty,150);assert.equal(decreased.frozen.loc,'freezer');
 assert.equal(project(inventory,999,1000),null,'unreconciled quantities retain the existing safe projection path');
 assert.equal(api.projectFrozenBuckets({inventory,stockKey:'carrot|g',currentQuantity:300,nextQuantity:500,actor:'other-account'}),null);
});
test('ordinary freezer stock keeps its location when a receipt adds the same unfrozen food',()=>{
 const inventory={frozen:row(200,'freezer'),fresh:row(100,'cupboard')};
 const increased=api.projectFrozenBuckets({inventory,stockKey:'carrot|g',currentQuantity:300,nextQuantity:600,location:'cupboard',...opts});
 assert.equal(increased.frozen.qty,200);assert.equal(increased.frozen.loc,'freezer');assert.equal(increased.fresh.qty,400);
 const decreased=api.projectFrozenBuckets({inventory:increased,stockKey:'carrot|g',currentQuantity:600,nextQuantity:150,location:'cupboard',...opts});
 assert.equal(decreased.fresh.selected,false);assert.equal(decreased.frozen.qty,150);assert.equal(decreased.frozen.loc,'freezer');
});
test('new freezer purchases merge into the existing freezer row without an extra bucket',()=>{
 const inventory={frozen:row(200,'freezer'),fresh:row(100,'fridge')};
 const result=api.projectFrozenBuckets({inventory,stockKey:'carrot|g',currentQuantity:300,nextQuantity:500,location:'freezer',...opts});
 assert.deepEqual(Object.keys(result),Object.keys(inventory));assert.equal(result.frozen.qty,400);assert.equal(result.fresh.qty,100);
});
test('zero stock clears urgency so an ordinary refill or manual edit cannot resurrect the old reduced tag',()=>{
 const first=bought({}, {carrots:row(300)});
 const used=api.settleInventory({before:first,after:{carrots:{...first.carrots,qty:0}},...opts});assert.equal(used.carrots.bbReduced.urgent,false);
 const refilled=api.prepareInventory({before:used,after:{carrots:{...used.carrots,qty:200}},credits:[],sourceId:'shop:regular',...opts});assert.equal(api.isUrgent(refilled.carrots,{actor}),false);
 const legacyZero={carrots:{...first.carrots,qty:0}},again=api.settleInventory({before:legacyZero,after:{carrots:{...first.carrots,qty:200}},...opts});assert.equal(api.isUrgent(again.carrots,{actor}),false);
});
test('regular additions preserve a still-present reduced warning and account changes never inherit it',()=>{
 const marked=bought({}, {carrots:row(300)}),more=api.prepareInventory({before:marked,after:{carrots:{...marked.carrots,qty:500}},credits:[],sourceId:'shop:ordinary',...opts});
 assert.equal(api.isUrgent(more.carrots,{actor}),true);assert.equal(api.isUrgent(more.carrots,{actor:'other-account'}),false);
 assert.throws(()=>api.freeze(more.carrots,{actor:'other-account'}),/changed/);
 const other=api.prepareInventory({before:marked,after:{carrots:{...marked.carrots,qty:500}},credits:[{name:'Carrots',quantity:200,unit:'g'}],sourceId:'shop:other',...opts,actor:'other-account'});
 assert.equal(api.isUrgent(other.carrots,{actor:'other-account'}),true);assert.equal(api.isUrgent(other.carrots,{actor}),false);
});
test('source identities, units and locations do not mark unrelated stock or invent a conversion',()=>{
 const before={carrots:row(200),milk:{name:'Milk',qty:500,unit:'ml',loc:'fridge',selected:true}},after={...before,carrots:row(500)};
 const bad=bought(before,after,{credits:[{name:'Milk',quantity:300,unit:'ml'}]});assert.equal(bad.carrots.bbReduced,undefined);
 const frozen=bought(before,{...after,carrots:row(500,'freezer')});assert.equal(frozen.carrots.bbReduced,undefined);
 const alreadyFridge={carrots:row(200)},newFrozen=bought(alreadyFridge,{...alreadyFridge,frozen:row(300,'freezer')});assert.equal(newFrozen.carrots.bbReduced,undefined,'a freezer purchase must not relabel unchanged fridge stock');
 const correct=bought(before,after);assert.equal(correct.milk.bbReduced,undefined);
 const unknown={mystery:{name:'Mystery',qty:1,unit:'crate',loc:'cupboard',selected:true}};assert.deepEqual(api.prepareInventory({before:{},after:unknown,credits:[{name:'Mystery',quantity:1,unit:'crate'}],sourceId:'shop:unknown',...opts}),unknown);
});
test('priority sorting is stable and uses only positive selected stock belonging to the current actor',()=>{
 const marked=bought({}, {carrots:row(300)}).carrots,ordinary={...row(20),name:'Apples'},zero={...marked,qty:0},frozen={...marked,loc:'freezer'};
 assert.deepEqual(api.sort([ordinary,zero,marked,frozen],opts),[marked,ordinary,zero,frozen]);
 const inventory={marked,ordinary,zero,frozen},stock={'carrot|g':300,'apple|each':2};
 assert.deepEqual(api.priority(stock,{...opts,inventory,allowed:true}),['carrot|g']);
 assert.deepEqual(api.priority(stock,{...opts,inventory,allowed:false}),[]);assert.deepEqual(api.priority(stock,{...opts,inventory,actor:'other-account',allowed:true}),[]);
 assert.deepEqual(api.priority({'carrot|g':0},{...opts,inventory,allowed:true}),[]);
});

function canonicalMeasure(name,quantity,unit){const result=policy.normalize(name,quantity,unit);return result?{key:policy.canonicalName(name),...result}:null;}
test('Use soon matching receives the strongest pantry weight without becoming a candidate filter',()=>{
 const pantry=autofill.create({stock:{'carrot|g':300,'rice|g':1000},canonicalMeasure,priorityStockKeys:['carrot|g'],now:Date.parse(at),lastPlannedAt:{reduced:Date.parse(at)-86400000}});
 const ranked=pantry.rank([{id:'ordinary',ingredients:[{name:'Rice',quantity:300,unit:'g'}]},{id:'reduced',ingredients:[{name:'Carrot',quantity:100,unit:'g'}]},{id:'no-stock',ingredients:[{name:'Pasta',quantity:300,unit:'g'}]}]);
 assert.equal(ranked[0].candidate.id,'reduced');assert.equal(ranked[0].useSoonBonus,40);assert.equal(ranked.length,3);assert.ok(ranked.some(row=>row.candidate.id==='no-stock'));
 assert.deepEqual(pantry.snapshot(),{'carrot|g':300,'rice|g':1000},'a proposal does not consume real stock');
});
test('priority reservations stop rewarding an exhausted source and pantry staples do not skew the bonus',()=>{
 const pantry=autofill.create({stock:{'carrot|g':100,'salt|g':20},canonicalMeasure,priorityStockKeys:['carrot|g','salt|g']});
 assert.equal(pantry.reserve([{name:'Carrot',quantity:100,unit:'g'}]).useSoonBonus,40);
 assert.equal(pantry.assess([{name:'Carrot',quantity:100,unit:'g'}]).useSoonBonus,0);
 assert.equal(pantry.assess([{name:'Salt',quantity:1,unit:'g'}]).useSoonBonus,0);
 const eligible=[{id:'already-eligible',ingredients:[{name:'Rice',quantity:100,unit:'g'}]}];assert.deepEqual(pantry.rank(eligible).map(row=>row.candidate.id),['already-eligible'],'dietary eligibility remains owned by the caller');
});
test('the physical pantry proposal awards urgency only to an actual allocated priority source',()=>{
 const proposal=({stock,ingredients})=>{
  const remainingStock={...stock},rows=ingredients.map(row=>{const key=row.name.toLowerCase()+'|g',owned=stock[key]||0,deduct=Math.min(owned,row.required),allocations=deduct?[{stockKey:key,sourceQuantity:deduct,quantity:deduct,sourceUnit:'g'}]:[];remainingStock[key]=owned-deduct;return {id:key,canonicalKey:row.name.toLowerCase(),name:row.name,unit:'g',required:row.required,owned,deduct,allocations};});
  return {remainingStock,rows};
 };
 const pantry=autofill.create({stock:{'carrot|g':100,'rice|g':500},proposal,priorityStockKeys:['carrot|g']});
 assert.equal(pantry.assess([{name:'Rice',required:100,unit:'g'}]).useSoonBonus,0);
 assert.equal(pantry.reserve([{name:'Carrot',required:100,unit:'g'}]).useSoonBonus,40);
 assert.equal(pantry.assess([{name:'Carrot',required:100,unit:'g'}]).useSoonBonus,0);
 assert.deepEqual(pantry.snapshot(),{'carrot|g':0,'rice|g':500});
});
