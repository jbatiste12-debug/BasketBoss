import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
function fixture(market='UK'){
 const context=vm.createContext({window:{},bb307Market:market,bb307ActiveRetailer:()=>null});
 for(const name of ['basketboss-aisles-v20.js','bb-pantry-policy.js','basketboss-pricing-v19.js'])vm.runInContext(read(name),context);
 context.BBPriceV19=context.window.BBPriceV19;
 const html=read('index.html'),start=html.indexOf('function bb15StapleContainerQuote('),end=html.indexOf('\n}',start)+2;vm.runInContext(html.slice(start,end),context);
 return context;
}
test('active staples use one whole regional container price per requested container',()=>{
 for(const market of ['UK','US']){const h=fixture(market);
  for(const [name,container,unit]of [['olive oil','bottle','ml'],['soy sauce','bottle','ml'],['honey','jar','g'],['paprika','jar','g']]){
   const item={key:name,unit:'each',staple:true,stapleContainer:container},baseline=h.BBPriceV19.price({name,quantity:1,unit,market});
   assert.equal(h.bb15StapleContainerQuote(item,1).amount,Math.round(baseline.amount*100)/100);
   assert.equal(h.bb15StapleContainerQuote(item,2).amount,Math.round(baseline.amount*2*100)/100);
   assert.equal(h.bb15StapleContainerQuote(item,0).amount,0);assert.equal(h.bb15StapleContainerQuote(item,1).packQty,1);
  }
 }
});
test('culinary Pepper price uses the spice jar guide and whole produce bypasses container pricing',()=>{
 const h=fixture(),spice=h.bb15StapleContainerQuote({key:'pepper',unit:'each',staple:true,stapleContainer:'jar'},1);
 assert.equal(spice.amount,h.BBPriceV19.price({name:'ground black pepper',quantity:1,unit:'g',market:'UK'}).amount);
 assert.equal(h.bb15StapleContainerQuote({key:'pepper',unit:'each'},1),null);
});
test('a saved user container price takes precedence over a generic physical pack guide',()=>{
 const h=fixture(),calls=[];h.BBPriceV19={price(input){calls.push(input);return {amount:7.5,userOverride:true};}};
 const result=h.bb15StapleContainerQuote({key:'olive oil',unit:'each',staple:true},1);assert.equal(result.amount,7.5);assert.equal(calls.length,1);
});
