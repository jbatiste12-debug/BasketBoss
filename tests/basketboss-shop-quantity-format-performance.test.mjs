import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const current=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const baseline=execFileSync('git',['show','c05180b1d28b4c30d2ae7b272faeab0f0565e546:app.html'],{encoding:'utf8',maxBuffer:8*1024*1024});
const extract=source=>source.slice(source.indexOf('function bbShopExactQuantity('),source.indexOf('function bbShopPurchasePack('));
function fixture(source){
 let constructions=0;
 const NumberFormat=function(...args){constructions++;return new Intl.NumberFormat(...args);};
 const context=vm.createContext({Intl:{NumberFormat},bb307Market:'UK'});
 vm.runInContext(extract(source),context);
 return {context,format:(...args)=>context.bbShopExactQuantity(...args),get constructions(){return constructions;}};
}
test('display formatter reuse preserves all original quantity and market output',()=>{
 const before=fixture(baseline),after=fixture(current);
 const values=[0,-0,1,2,0.125,1/3,0.000001,0.00000001,0.000000000001,999.9999999,1000,1500,1000000,Number.MAX_VALUE,'0.125','',null,undefined,NaN,Infinity,-Infinity,-1,'invalid'];
 const units=['each','g','kg','ml','l','pack','G',undefined,null];
 const markets=['UK','US','GB','CA','AU','IE',undefined,null];
 for(const market of markets)for(const unit of units)for(const value of values){
  assert.equal(after.format(value,unit,market),before.format(value,unit,market),`${value}/${unit}/${market}`);
 }
 assert.ok(after.constructions<=2,'only two immutable locale formatters are retained');
});
test('repeated quantity labels construct two formatters instead of one per label',()=>{
 const before=fixture(baseline),after=fixture(current);
 for(let i=0;i<14000;i++){
  const market=i%2?'US':'UK',value=i/13;
  assert.equal(after.format(value,'g',market),before.format(value,'g',market));
 }
 assert.equal(before.constructions,14000);assert.equal(after.constructions,2);
});
test('new quantities and live default market never reuse stale formatted values',()=>{
 const before=fixture(baseline),after=fixture(current);
 for(const market of ['UK','US','UK','US']){
  before.context.bb307Market=market;after.context.bb307Market=market;
  for(const n of [0,0.25,0.5,1.75,125,1001,0.00000001])assert.equal(after.format(n,'g'),before.format(n,'g'));
 }
 assert.equal(after.format(-1,'g'),'Check quantity');assert.equal(after.format('bad','ml'),'Check quantity');
 assert.equal(after.constructions,2);
});
test('formatter instances are immutable display objects and do not retain quantities',()=>{
 const {context,format}=fixture(current);format(10,'g','UK');format(20,'g','US');
 const cache=context.bbShopExactQuantity.displayFormatters;
 assert.deepEqual(Object.keys(cache).sort(),['en-GB','en-US']);
 assert.ok(Object.values(cache).every(formatter=>Object.isFrozen(formatter)));
 assert.equal(format(30,'g','UK'),'30 g');
});
