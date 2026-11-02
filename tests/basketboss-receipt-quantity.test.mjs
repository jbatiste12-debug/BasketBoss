import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const quantity=createRequire(import.meta.url)('../bb-receipt-quantity.js');
const uk={market:'UK'};
test('explicit receipt amounts win over standard packs and normalize metric units',()=>{
 for(const [amount,unit,total,base]of[[1,'kg',1000,'g'],[.5,'l',500,'ml'],[6,'each',6,'each']]){
  const result=quantity.infer({canonicalKey:'milk',quantity:amount,unit},uk);assert.equal(result.quantity,total);assert.equal(result.unit,base);assert.equal(result.source,'receipt');assert.equal(result.estimated,false);
 }
});
test('multipack receipt text produces one measured total and retains exact pricing pack dimensions',()=>{
 const result=quantity.infer({canonicalKey:'pasta',description:'Pasta 2 x 500g'},uk);
 assert.equal(result.quantity,1000);assert.equal(result.unit,'g');assert.equal(result.packCount,2);assert.equal(result.packQuantity,500);assert.equal(result.packUnit,'g');assert.equal(result.estimated,false);
});
test('an explicit pack count multiplies the contents once',()=>{
 const result=quantity.infer({canonicalKey:'pasta',quantity:2,unit:'pack',packQuantity:500,packUnit:'g',packCount:2},uk);
 assert.equal(result.quantity,1000);assert.equal(result.packQuantity,500);assert.equal(result.packCount,2);
});
test('conflicting explicit totals and packs remain unresolved for user correction',()=>{
 assert.equal(quantity.infer({canonicalKey:'pasta',quantity:500,unit:'g',packQuantity:500,packUnit:'g',packCount:2},uk),null);
 assert.equal(quantity.infer({canonicalKey:'pasta',packQuantity:500,packUnit:'g',packCount:-2},uk),null);
});
test('receipt labels infer measured single packs and counted eggs',()=>{
 assert.equal(quantity.infer({canonicalKey:'pasta',description:'Penne pasta 500g'},uk).quantity,500);
 const eggs=quantity.infer({canonicalKey:'egg',description:'6 eggs free range'},uk);assert.equal(eggs.quantity,6);assert.equal(eggs.unit,'each');
});
test('UK catalogue standard packs are visibly estimated and override generic defaults',()=>{
 const result=quantity.infer({canonicalKey:'pasta',description:'Penne'}, {...uk,catalog:{ingredients:{'pasta|g':{ingredient:'pasta',standard_pack_size:1000,standard_pack_unit:'g',needs_review:true}}}});
 assert.equal(result.quantity,1000);assert.equal(result.estimated,true);assert.equal(result.source,'uk-default');assert.match(result.note,/Estimated UK pack/);
 const milk=quantity.infer({canonicalKey:'milk'},uk);assert.equal(milk.quantity,1000);assert.equal(milk.unit,'ml');
});
test('unknown foods do not receive an arbitrary guessed pack and other markets do not inherit UK defaults',()=>{
 assert.equal(quantity.infer({canonicalKey:'unknown dinner spice'},uk),null);
 assert.equal(quantity.infer({canonicalKey:'pasta'},{market:'US'}),null);
});
test('shopping list fallback uses the matched bought quantity and preserves separate dimensions',()=>{
 const result=quantity.infer({canonicalKey:'berries'}, {...uk,shoppingItems:[{key:'berries',quantity:.75,unit:'kg'}]});assert.equal(result.quantity,750);assert.equal(result.unit,'g');assert.equal(result.source,'shopping-list');
 assert.equal(quantity.infer({canonicalKey:'garlic',quantity:1,unit:'bulb'}, {...uk,shoppingItems:[{key:'garlic',quantity:6,unit:'clove'}]}).unit,'bulb');
 assert.equal(quantity.infer({canonicalKey:'berries'}, {...uk,shoppingItems:[{key:'berries',quantity:500,unit:'g'},{key:'berries',quantity:2,unit:'each'}]}),null);
});
test('non-food gets an editable counted estimate without being classified as food',()=>{
 const result=quantity.infer({classification:'essential',description:'Toilet tissue'},uk);assert.equal(result.quantity,1);assert.equal(result.unit,'each');assert.equal(result.source,'essential-count');assert.equal(result.estimated,true);
 const liquid=quantity.infer({classification:'essential',description:'Washing up liquid 500ml'},uk);assert.equal(liquid.quantity,500);assert.equal(liquid.unit,'ml');
});
test('adjustments, excluded lines and dangerous or invalid values cannot become stock suggestions',()=>{
 for(const kind of ['discount','refund','tax','total','ignore'])assert.equal(quantity.infer({kind,description:'milk 1l'},uk),null);
 assert.equal(quantity.infer({canonicalKey:'milk',selected:false},uk),null);
 assert.equal(quantity.infer({canonicalKey:'__proto__'},uk),null);
 assert.equal(quantity.measured(1.5,'each'),null);assert.equal(quantity.measured(1001,'kg'),null);assert.equal(quantity.measured(true,'g'),null);
});
