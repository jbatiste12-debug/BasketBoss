import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ui=require('../bb-loose-produce-ui.js'),policy=require('../bb-pantry-policy.js');
const context={actor:'produce-owner',stockKey:'lime|g',name:'Lime'};
const row=qty=>({name:'Lime',qty,unit:'g',loc:'fridge',selected:true,bb173StockKey:'lime|g',bb173StockValue:qty});
function storage(){
 const values=new Map([['basketboss_321_v7_measured_pantry','{"lime|g":1000}']]);
 return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
const record=(store,beforeQuantity,afterQuantity,count=1)=>ui.writeStockProof(store,context,{beforeQuantity,afterQuantity,selection:ui.selection('Lime',count,policy)},policy);
const proof=store=>ui.readStockProof(store,context,policy);

test('whole citrus profiles use only the existing policy weights',()=>{
 const before=JSON.stringify(policy.countGrams),normalize=policy.normalize.toString();
 for(const [name,food,grams]of[['Limes','lime',70],['Whole lemons','lemon',100],['Fresh whole oranges','orange',180]]){
  const p=ui.profile(name,policy);assert.equal(p.food,food);assert.equal(p.gramsPerEach,grams);assert.equal(p.unitLabel,food);assert.equal(p.estimated,true);assert.match(p.assumption,/Existing planning estimate/);
 }
 assert.equal(JSON.stringify(policy.countGrams),before);assert.equal(policy.normalize.toString(),normalize);
});

test('processed citrus, mixed foods and missing policy weights have no count recommendation',()=>{
 for(const name of ['Lime juice','Lime zest','Dried lime','Tinned oranges','Canned orange segments','Lemon curd','Lime cordial','Lemon and lime','Lime leaves','Lime-flavoured water','Orange peel','Chicken with lime','Potato'])assert.equal(ui.profile(name,policy),null,name);
 assert.equal(ui.profile('Lime',{}),null);assert.equal(ui.profile('Lime',{countGrams:{lime:0}}),null);
});

test('the actual 46.666667 g fajita lime demand recommends one whole lime in canonical grams',()=>{
 const chosen=ui.recommend('Lime',46.666667,policy);
 assert.deepEqual(chosen,{kind:'pack',packQuantity:70,packCount:1,quantity:70,unit:'g',label:'pack',boughtQtyOverride:70,retailCount:{food:'lime',count:1,gramsPerEach:70,unitLabel:'lime'}});
 assert.equal(ui.describeSelection(chosen,'Limes',policy).buyingLabel,'Buying: 1 lime');
 assert.equal(ui.recommend('Lemon',120,policy).quantity,200);assert.equal(ui.recommend('Orange',180,policy).quantity,180);
 assert.equal(ui.recommend('Lime',0,policy),null);assert.equal(ui.recommend('Lime',NaN,policy),null);assert.equal(ui.recommend('Lime','70',policy),null);
});

test('retail counts require matching canonical grams and existing table values',()=>{
 const chosen=ui.selection('Lime',2,policy);assert.equal(chosen.quantity,140);assert.equal(ui.describeSelection(chosen,'Lime',policy).label,'2 limes');
 for(const candidate of [
  {...chosen,quantity:2},
  {...chosen,unit:'each'},
  {...chosen,boughtQtyOverride:1},
  {...chosen,retailCount:{...chosen.retailCount,gramsPerEach:100}},
  {...chosen,retailCount:{...chosen.retailCount,count:1}},
  {...chosen,retailCount:{...chosen.retailCount,food:'lemon'}},
  {...chosen,retailCount:{...chosen.retailCount,unitLabel:'pack'}}
 ])assert.equal(ui.describeSelection(candidate,'Lime',policy),null);
 for(const count of [0,-1,.5,NaN,Infinity,1000000])assert.equal(ui.selection('Lime',count,policy),null);
 assert.equal(ui.describeSelection(chosen,'Lime juice',policy),null);
});

test('old 1000 g stock never becomes one lime without a confirmed UI proof',()=>{
 const old=row(1000),before=JSON.stringify(old),display=ui.describeStock(old,policy);
 assert.equal(display.needsReview,true);assert.equal(display.quantity,null);assert.match(display.message,/Check the number/);assert.equal(JSON.stringify(old),before);
 assert.equal(ui.describeStock({name:'Lime juice',qty:1000,unit:'ml'},policy),null);
 assert.equal(ui.describeStock({name:'Lime',qty:1,unit:'each'},policy),null,'an explicit count keeps its existing native display');
});

test('a successful count purchase from zero records only separate UI proof',()=>{
 const store=storage(),stockBefore=store.getItem('basketboss_321_v7_measured_pantry');
 const saved=record(store,0,70);assert.equal(saved.ok,true);assert.equal(saved.recorded,true);
 const savedProof=proof(store),display=ui.describeStock(row(70),policy,savedProof);
 assert.equal(display.quantity,1);assert.equal(display.unit,'each');assert.equal(display.estimated,true);assert.equal(display.needsReview,false);
 assert.equal(store.getItem('basketboss_321_v7_measured_pantry'),stockBefore,'the module never writes canonical stock');
 assert.deepEqual([...store.values.keys()].sort(),['basketboss_321_v7_measured_pantry',ui.key].sort());
});

test('proof scope follows actor and canonical stock key rather than shopping trip',()=>{
 const store=storage();record(store,0,70);
 assert.ok(ui.readStockProof(store,{...context,trip:'another-trip'},policy));
 assert.equal(ui.readStockProof(store,{...context,actor:'another-owner'},policy),null);
 assert.equal(ui.readStockProof(store,{actor:context.actor,stockKey:'lemon|g'},policy),null);
 assert.equal(ui.describeStock({...row(70),bb173StockKey:'lemon|g'},policy,proof(store)).needsReview,true);
});

test('consumption may reduce proven count stock without rounding or rewriting its balance',()=>{
 const store=storage();record(store,0,70);const remaining=70-46.666667,current=row(remaining),before=JSON.stringify(current);
 const display=ui.describeStock(current,policy,proof(store));assert.equal(display.needsReview,false);assert.equal(display.quantity,remaining/70);assert.equal(display.canonicalQuantity,remaining);
 assert.equal(JSON.stringify(current),before);assert.equal(proof(store).maxCanonicalQuantity,70);
});

test('a foreign increase cannot use the old proof and a non-count transaction clears it permanently',()=>{
 const store=storage();record(store,0,70);
 assert.equal(ui.readStockProof(store,{...context,canonicalQuantity:1000},policy),null);
 assert.equal(ui.describeStock(row(1000),policy,proof(store)).needsReview,true);
 const cleared=ui.writeStockProof(store,context,{beforeQuantity:70,afterQuantity:1000,selection:{quantity:930,unit:'g'}},policy);
 assert.equal(cleared.ok,true);assert.equal(cleared.recorded,false);assert.equal(proof(store),null);
 assert.equal(ui.describeStock(row(70),policy,proof(store)).needsReview,true,'later consumption cannot revive the deleted proof');
});

test('a count purchase cannot relabel a pre-existing unproved kilogram',()=>{
 const store=storage(),result=record(store,1000,1070);
 assert.equal(result.ok,true);assert.equal(result.recorded,false);assert.equal(proof(store),null);
 assert.equal(ui.describeStock(row(1070),policy,proof(store)).quantity,null);
});

test('subsequent count purchases and bought-amount corrections retain proven count basis',()=>{
 const store=storage();record(store,0,70);assert.equal(record(store,70,140).recorded,true);
 assert.equal(ui.describeStock(row(140),policy,proof(store)).quantity,2);
 assert.equal(record(store,140,210,3).recorded,true);assert.equal(ui.describeStock(row(210),policy,proof(store)).quantity,3);
 assert.equal(record(store,210,0,3).recorded,false);assert.equal(proof(store),null);
});

test('inconsistent after-balances and changed policy assumptions fall back to weight',()=>{
 const store=storage();assert.equal(record(store,0,1000).recorded,false);assert.equal(proof(store),null);
 record(store,0,70);const changed={...policy,countGrams:{...policy.countGrams,lime:80}};
 assert.equal(ui.readStockProof(store,context,changed),null);assert.equal(ui.describeStock(row(70),changed,proof(store)).needsReview,true);
 assert.equal(ui.describeStock({...row(70),bb173StockValue:1000},policy,proof(store)).needsReview,true);
});

test('UI proof writes use CAS and rollback without overwriting newer UI choices',()=>{
 const store=storage(),first=record(store,0,70);assert.equal(first.ok,true);const raw=store.getItem(ui.key);
 assert.equal(first.rollback(),true);assert.equal(store.getItem(ui.key),null);assert.equal(first.rollback(),false);
 const next=record(store,0,70);assert.equal(record(store,70,140).ok,true);assert.equal(next.rollback(),false);assert.notEqual(store.getItem(ui.key),raw);
 const get=store.getItem;let reads=0;store.getItem=key=>key===ui.key&&++reads===2?'changed-elsewhere':get(key);
 const old=get(ui.key);assert.equal(record(store,140,210).ok,false);assert.equal(get(ui.key),old);
});

test('malformed proof storage and quota failures cannot affect the actual purchase or stock',()=>{
 const store=storage(),before=store.getItem('basketboss_321_v7_measured_pantry');store.setItem(ui.key,'{broken');
 assert.equal(record(store,0,70).ok,false);assert.equal(proof(store),null);assert.equal(store.getItem(ui.key),'{broken');
 store.removeItem(ui.key);const put=store.setItem;store.setItem=(key,value)=>{if(key===ui.key)throw Error('quota');put(key,value);};
 assert.equal(record(store,0,70).ok,false);assert.equal(store.getItem('basketboss_321_v7_measured_pantry'),before);
});

test('the optional browser UMD uses the supplied existing policy without importing or replacing it',()=>{
 const window={BBPantryPolicy:policy};vm.runInNewContext(fs.readFileSync(new URL('../bb-loose-produce-ui.js',import.meta.url),'utf8'),{window});
 assert.ok(window.BBLooseProduceUI);assert.equal(window.BBLooseProduceUI.recommend('Lime',46.666667).quantity,70);assert.equal(window.BBPantryPolicy,policy);
});
