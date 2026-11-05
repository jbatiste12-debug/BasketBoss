import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8'),context);
const api=context.BBWeeklyEssentials;
const options={market:'UK',retailer:'Aldi'};
const scope={priceMarket:'UK',priceRetailer:'Aldi',priceCurrency:'GBP'};
const shampoo={name:'Shampoo',qty:1,unit:'pack'};

test('generic essentials have no invented pack prices and make totals incomplete',()=>{
 for(const name of ['Shampoo','Toilet rolls','Milk','Soap']){
  const quote=api.quote({...shampoo,name},options);assert.equal(quote.amount,null);assert.equal(quote.priceNeeded,true);assert.equal(quote.source,'price_needed');
 }
 const summary=api.summarize([{...shampoo,...scope,estimatedPackPrice:3.49,qty:2},{name:'Toilet rolls',qty:1,unit:'pack'}],options);
 assert.equal(summary.amount,null);assert.equal(summary.knownAmount,6.98);assert.equal(summary.pending,1);assert.equal(summary.complete,false);
});
test('explicit scoped prices count purchases, while unknown grams never multiply a bottle price',()=>{
 assert.equal(api.quote({...shampoo,...scope,qty:3,estimatedPackPrice:4.5},options).amount,13.5);
 assert.equal(api.quote({...shampoo,...scope,qty:500,unit:'ml',estimatedPackPrice:4.5},options).amount,null);
 const quote=api.quote({...shampoo,...scope,qty:501,unit:'ml',packQuantity:250,packUnit:'ml',estimatedPackPrice:4.5},options);
 assert.equal(quote.amount,13.5);assert.equal(quote.packCount,3);assert.equal(quote.portionAmount,quote.packAmount);
 assert.equal(api.quote({...shampoo,...scope,qty:0,estimatedPackPrice:4.5},options).amount,0);
});
test('saved essential prices cannot leak across regions, stores or currencies',()=>{
 const item={...shampoo,...scope,estimatedPackPrice:4.5};
 for(const settings of [{market:'Guernsey',retailer:'Aldi'},{market:'US',retailer:'Aldi'},{market:'UK',retailer:'Tesco'},{market:'constructor',retailer:'Aldi'}])assert.equal(api.quote(item,settings).amount,null);
 assert.equal(api.quote({...item,priceCurrency:'USD'},options).amount,null);
 assert.equal(api.quote({...shampoo,estimatedPackPrice:4.5},options).amount,null,'Unscoped legacy prices need confirmation');
 assert.equal(api.quote({...item,priceScope:'region'}, {market:'UK',retailer:'Tesco'}).amount,4.5);
});
test('actual paid counts apply only to the exact identified product and scope',()=>{
 const paidRecord={name:'Shampoo',brand:'',quantity:2,unit:'pack',pricePaid:7.5,market:'UK',retailer:'Aldi',currency:'GBP'};
 assert.equal(api.quote({...shampoo,qty:3},{...options,paidRecord}).amount,11.25);
 assert.equal(api.quote(shampoo,{...options,paidRecord:{...paidRecord,name:'Different shampoo'}}).amount,null);
 assert.equal(api.quote(shampoo,{...options,paidRecord:{...paidRecord,retailer:'Tesco'}}).amount,null);
  assert.equal(api.quote(shampoo,{...options,paidRecord:{...paidRecord,priceType:'promotion'}}).amount,null);
 const measured={...paidRecord,quantity:250,unit:'ml'};
 assert.equal(api.quote({...shampoo,qty:250,unit:'ml'},{...options,paidRecord:measured}).amount,7.5);
 assert.equal(api.quote({...shampoo,qty:500,unit:'ml'},{...options,paidRecord:measured}).amount,null);
});
test('regular receipts require exact product, brand and pack; promotions never become usual prices',()=>{
 const identified={...shampoo,productName:'Family Shampoo 250ml',brand:'Family',packQuantity:250,packUnit:'ml',qty:2};
 const row={kind:'essential',name:'Family Shampoo 250ml',brand:'Family',packQuantity:250,packUnit:'ml',packCount:2,pricePaid:7.98,priceType:'regular',market:'UK',retailer:'Aldi',currency:'GBP'};
 const quote=api.quote(identified,{...options,receiptObservations:[row]});assert.equal(quote.amount,7.98);assert.equal(quote.receiptLearned,true);assert.equal(quote.receiptSamples,1);
 assert.equal(api.quote(shampoo,{...options,receiptObservations:[row]}).amount,null);
 for(const patch of [{brand:'Other'},{packQuantity:500},{packUnit:'g'},{currency:'USD'},{market:'US'},{retailer:'Tesco'},{priceType:'promotion'},{priceType:'unknown'},{kind:'food'}])assert.equal(api.quote(identified,{...options,receiptObservations:[{...row,...patch}]}).amount,null,JSON.stringify(patch));
});
test('selected and owned filters preserve an honest known subtotal',()=>{
 const items=[{...shampoo,...scope,estimatedPackPrice:4},{...shampoo,owned:true},{...shampoo,selected:false}];
 const result=api.summarize(items,options);assert.equal(result.amount,4);assert.equal(result.pending,0);assert.equal(result.lines.length,1);assert.equal(result.complete,true);
});
test('future household estimates use the newest 21 regular receipt packs and retain exact matching',()=>{
 const item={...shampoo,productName:'Family Shampoo 250ml',brand:'Family',packQuantity:250,packUnit:'ml'};
 const observations=Array.from({length:46},(_,index)=>({kind:'essential',name:item.productName,brand:'Family',packQuantity:250,packUnit:'ml',packCount:1,pricePaid:index>=25?5:1,priceType:'regular',market:'UK',retailer:'Aldi',currency:'GBP',purchasedAt:new Date(Date.UTC(2026,8,1)+index*86400000).toISOString()})).reverse();
 const actual=api.quote(item,{...options,receiptObservations:observations});assert.equal(actual.amount,5);assert.equal(actual.receiptSamples,21);
 assert.equal(api.quote(item,{...options,receiptObservations:[...observations].reverse()}).amount,5,'purchase date takes priority over caller array order');
 assert.equal(api.quote(item,{...options,receiptObservations:observations.map(row=>({...row,priceType:'promotion'}))}).amount,null);
});
