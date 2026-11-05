import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),context);
const api=context.BBPriceV19;
test('overflowing metric and count quantities become unpriced instead of nonfinite basket amounts',()=>{
 for(const unit of ['kg','l','g','ml','each'])assert.equal(api.price({name:unit==='ml'||unit==='l'?'milk':'carrot',quantity:Number.MAX_VALUE,unit,market:'UK'}),null,unit);
 assert.equal(api.canonicalMeasure('Carrots',Number.MAX_VALUE,'each'),null);
 assert.equal(api.canonicalMeasure('Rice',Number.MAX_VALUE,'kg'),null);
});
test('normal metric-prefix and currency quantities retain accurate finite prices',()=>{
 const grams=api.price({name:'lean beef mince',quantity:500,unit:'g',market:'UK'}),kilograms=api.price({name:'lean beef mince',quantity:.5,unit:'kg',market:'UK'});
 assert.equal(kilograms.amount,grams.amount);assert.equal(kilograms.packCount,grams.packCount);
 for(const market of ['UK','Guernsey','Jersey','US'])for(const quantity of [0,.1,1,500,1000000]){const quote=api.price({name:'rice',quantity,unit:'g',market});assert.equal(Number.isFinite(quote.amount),true);assert.ok(quote.amount>=0);assert.equal(quote.amount,Math.round(quote.amount*100)/100);}
});
test('only committed baseline edits schedule cloud backup, and a cloud failure cannot undo a saved local price',()=>{
 let schedules=0,failStorage=false,failCloud=false;const saved=new Map(),context=vm.createContext({localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{if(failStorage)throw Error('quota');saved.set(key,value);}},BasketBossCloud:{scheduleSave(){schedules++;if(failCloud)throw Error('offline');}}});
 vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),context);const pricing=context.BBPriceV19,item={name:'rice',unit:'g',market:'UK',price:2.37};
 const prepared=pricing.preparePriceOverrides([item]);assert.equal(schedules,0);assert.equal(saved.size,0);assert.ok(prepared.value);
 pricing.setPriceOverride(item);assert.equal(schedules,1);assert.equal(pricing.price({...item,quantity:500}).shelfPrice,2.37);
 failCloud=true;assert.equal(pricing.setPriceOverride({...item,price:3.19}),3.19);assert.equal(pricing.price({...item,quantity:500}).shelfPrice,3.19);
 pricing.clearPriceOverride(item);assert.equal(schedules,3);
 failStorage=true;assert.throws(()=>pricing.setPriceOverride(item),/Could not save/);assert.equal(schedules,3,'a failed local write cannot advertise a cloud save');
});
