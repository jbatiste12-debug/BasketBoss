import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=vm.createContext({console});
for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js','bb-meal-estimate.js']){
 vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),root);
}
const quote=(name,qty,unit,base,servings,market='UK')=>root.BBMealEstimate.quote({
 recipe:{servings:base},normalized:{servings:base,ingredients:[{key:name,quantity:qty,unit}]},servings,market
});
test('pesto uses one jar when increasing from two to six',()=>assert.equal(quote('pesto',40,'g',2,6).details[0].packCount,1));
test('potatoes use one kilo bag, not three',()=>assert.equal(quote('potato',300,'g',2,6).details[0].packCount,1));
test('oil is a fractional pantry cost',()=>assert.ok(quote('cooking oil',15,'ml',2,6).amount<1));
test('beef mince for six costs more than 5.49',()=>assert.ok(quote('beef mince',200,'g',2,6).amount>5.49));
test('region controls currency and US potato pack format',()=>{
 for(const region of ['UK','Jersey','Guernsey','US'])
  assert.equal(quote('pesto',40,'g',2,6,region).currency,region==='US'?'$':'£');
 assert.equal(quote('potato',700,'g',2,6,'US').details[0].packCount,1);
});
test('missing normalized ingredient data does not return a low price',()=>assert.equal(root.BBMealEstimate.quote({recipe:{servings:4},market:'UK'}),null));
test('optional herbs without numerical quantity do not invalidate the whole meal',()=>{
 const q=root.BBMealEstimate.quote({recipe:{servings:4},normalized:{servings:4,ingredients:[
  {key:'potato',quantity:600,unit:'g'},
  {key:'fresh herbs',quantity:'small handful (optional)',unit:null}
 ]},servings:6,market:'UK'});
 assert.ok(q&&q.amount>0);
 assert.equal(q.lines[1],0);
});
