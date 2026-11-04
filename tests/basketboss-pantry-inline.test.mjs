import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),ui=require('../bb-pantry-inline.js'),policy=require('../bb-pantry-policy.js');
test('unit-aware steppers support measured and counted stock without negative balances',()=>{
 assert.equal(ui.stepped(150,'g',1),200);assert.equal(ui.stepped(100,'ml',-1),50);assert.equal(ui.stepped(2,'each',1),3);assert.equal(ui.stepped(.5,'kg',1),.75);assert.equal(ui.stepped(.25,'cup',-1),0);assert.equal(ui.stepped(0,'each',-1),0);assert.equal(ui.stepped('','each',1),1);assert.equal(ui.stepped('invalid','g',1),null);assert.equal(ui.stepped(Infinity,'g',1),null);
});
test('count preference uses known produce piece weights and never invents a count for measured foods',()=>{
 assert.equal(ui.preferredUnit('Carrots',policy,'g'),'each');assert.equal(ui.preferredUnit('Courgettes',policy,'g'),'each');assert.equal(ui.preferredUnit('Milk',policy,'ml'),'ml');assert.equal(ui.preferredUnit('Rice',policy,'g'),'g');assert.equal(ui.preferredUnit('Mystery food',policy,'pack'),'pack');assert.equal(ui.preferredUnit('Carrots',null,'g'),'g');
});
test('inline counted and package display shares physical canonical conversion values',()=>{
 assert.equal(ui.converted({name:'Carrots',qty:160,unit:'g'},'each',policy),2);assert.equal(ui.converted({name:'Courgette',qty:400,unit:'g'},'each',policy),2);assert.equal(ui.converted({name:'Milk',qty:1000,unit:'ml'},'l',policy),1);assert.equal(ui.converted({name:'Chopped tomatoes',qty:800,unit:'g'},'tin',policy,'UK'),2);assert.equal(ui.converted({name:'Minced beef',qty:750,unit:'g',packReviewed:true,packQuantity:375,packUnit:'g'},'pack',policy),2);
});
test('unknown or invalid amounts stay unknown instead of fabricating a conversion',()=>{
 for(const qty of[null,undefined,'','invalid',Infinity,-1])assert.equal(ui.converted({name:'Rice',qty,unit:'g'},'g',policy),null);
 assert.equal(ui.converted({name:'Rice',qty:1,unit:'bag'},'g',policy),null);assert.equal(ui.converted({name:'Milk',qty:1,unit:'ml'},'g',policy),null);assert.equal(ui.converted({name:'Rice',qty:0,unit:'g'},'g',policy),0);
});
test('a missing document leaves the existing pantry unmodified and safely disables enhancement',()=>{
 const fallback=ui.install({});assert.equal(typeof fallback.refresh,'function');assert.equal(typeof fallback.destroy,'function');fallback.refresh();fallback.destroy();
});
