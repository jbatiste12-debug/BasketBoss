import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8'),context);
const api=context.BBWeeklyEssentials;
const plain=value=>JSON.parse(JSON.stringify(value));
const settings={market:'UK',retailer:'Aldi'};
const household={name:'Toilet rolls',qty:9,unit:'pack',selected:true,targetQty:2,ownedQty:1,manualPending:true};
const price={estimatedPackPrice:3.5,priceMarket:'UK',priceRetailer:'Aldi',priceCurrency:'GBP'};

test('household requirements buy only the difference between a target and the existing amount',()=>{
 assert.deepEqual(plain(api.reconcile(household)),{valid:true,manual:true,totalNeeded:2,alreadyGot:1,toBuy:1});
 assert.equal(api.reconcile({...household,ownedQty:2}).toBuy,0);
 assert.equal(api.reconcile({...household,ownedQty:5}).toBuy,0);
 assert.equal(api.reconcile({...household,targetQty:0,ownedQty:0}).toBuy,0);
 assert.equal(api.reconcile({...household,owned:true}).toBuy,1,'explicit quantities supersede the older all-or-nothing flag');
});

test('household count units reject fractions, missing quantities and invalid amounts instead of guessing',()=>{
 const invalid=[{targetQty:-1},{ownedQty:-1},{targetQty:Infinity},{ownedQty:NaN},{targetQty:1000001},{ownedQty:1000001},{targetQty:'2'},{ownedQty:''},{targetQty:null},{targetQty:1.5},{ownedQty:0.5},{unit:'bucket'}];
 for(const patch of invalid){
  const item={...household,...patch},result=api.reconcile(item);
  assert.equal(result.valid,false,JSON.stringify(patch));assert.equal(result.toBuy,null);
  assert.equal(api.quote({...item,...price},settings).amount,null,'an invalid requirement cannot receive a purchase estimate');
 }
 for(const field of ['targetQty','ownedQty']){
  const item={...household};delete item[field];assert.equal(api.reconcile(item).valid,false);
 }
});

test('same-unit measured household targets stay editable without converting ownership into another unit',()=>{
 const item={...household,unit:'ml',targetQty:750,ownedQty:250};
 assert.equal(api.reconcile(item).toBuy,500);
 const kg={...household,unit:'kg',targetQty:2,ownedQty:0.5};
 assert.equal(api.reconcile(kg).toBuy,1.5);
 assert.equal(api.reconcile({...item,unit:'g'}).toBuy,500,'the helper does not invent density conversions');
});

test('purchase estimates use the remaining quantity once instead of the old quantity or the whole target',()=>{
 const item={...household,...price};
 assert.equal(api.quote(item,settings).amount,3.5);
 assert.equal(api.quote({...item,ownedQty:0},settings).amount,7);
 assert.equal(api.quote({...item,ownedQty:2},settings).amount,0);
 const measured={...item,unit:'ml',targetQty:1000,ownedQty:500,packQuantity:250,packUnit:'ml'};
 const estimate=api.quote(measured,settings);assert.equal(estimate.amount,7);assert.equal(estimate.packCount,2);
});

test('fulfilled manual requests remain fulfilled after recomputation and do not acquire stock credit',()=>{
 const item=Object.freeze({...household,...price,manualPending:false});
 const before=JSON.stringify(item),foodStock=Object.freeze({'milk|ml':200});
 for(let count=0;count<3;count++){
  assert.equal(api.reconcile(item).toBuy,0);assert.equal(api.quote(item,settings).amount,0);
  assert.equal(api.summarize([item],settings).lines.length,0);
 }
 assert.equal(JSON.stringify(item),before);assert.deepEqual(foodStock,{'milk|ml':200});
});

test('summaries exclude covered household targets and flag invalid requests while preserving their original records',()=>{
 const input=[{...household,...price},{...household,ownedQty:3},{...household,targetQty:2.5,owned:true},{...household,selected:false}];
 const before=JSON.stringify(input),summary=api.summarize(input,settings);
 assert.equal(summary.lines.length,2);assert.equal(summary.pending,1);assert.equal(summary.knownAmount,3.5);assert.equal(summary.amount,null);
 assert.equal(summary.lines[0].item,input[0]);assert.equal(summary.lines[1].item,input[2]);assert.equal(JSON.stringify(input),before);
});

test('legacy essentials retain their quantity, ownership and direct-quote behavior without new target fields',()=>{
 const legacy={name:'Soap',qty:3,unit:'pack',...price};
 assert.deepEqual(plain(api.reconcile(legacy)),{valid:true,manual:false,totalNeeded:3,alreadyGot:0,toBuy:3});
 assert.equal(api.quote(legacy,settings).amount,10.5);
 const owned={...legacy,owned:true};assert.equal(api.reconcile(owned).toBuy,0);assert.equal(api.quote(owned,settings).amount,10.5);
 assert.equal(api.summarize([owned],settings).lines.length,0);
 assert.equal(api.summarize([{...legacy,manualPending:false}],settings).knownAmount,10.5,'a marker alone never changes a legacy item');
});
