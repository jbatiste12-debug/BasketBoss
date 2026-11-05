import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function bbReducedBudgetQuote('),html.indexOf('\nfunction bbReducedPremium('));
test('the actual reduced-budget callback prices only the remaining household amount without changing the saved target or price',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8'),context);
 context.bb15Quote=(item,essential)=>{assert.equal(essential,true);return context.BBWeeklyEssentials.quote(item,{market:'UK',retailer:'Waitrose & Partners'});};
 vm.runInContext(source,context);
 const item=Object.freeze({name:'Laundry detergent',qty:1000,unit:'ml',targetQty:1000,ownedQty:0,manualPending:true,bbHomeTarget:1000,estimatedPackPrice:1.75,packQuantity:250,packUnit:'ml',priceMarket:'UK',priceRetailer:'Waitrose & Partners',priceCurrency:'GBP'});
 const before=JSON.stringify(item),quote=context.bbReducedBudgetQuote({item,essential:true},500);
 assert.equal(quote.amount,3.5);assert.equal(quote.packCount,2);assert.equal(JSON.stringify(item),before);
});
test('the actual food budget callback preserves metadata and passes the remaining quantity to the existing engine',()=>{
 let passed;const context=vm.createContext({bb15Quote:(item,essential)=>{passed={item,essential};return {amount:2};}});vm.runInContext(source,context);
 const item=Object.freeze({key:'Rice',toBuy:1000,unit:'g',packQuantity:500,brand:'Usual brand'});
 assert.equal(context.bbReducedBudgetQuote({item,essential:false},500).amount,2);
 assert.equal(passed.essential,false);assert.equal(passed.item.toBuy,500);assert.equal(passed.item.qty,500);assert.equal(passed.item.brand,item.brand);assert.equal(item.toBuy,1000);
});
