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


test('UK and US default view units use regional weight and volume preferences while produce stays counted',()=>{
 for(const [row,expected]of[[{name:'Rice',qty:500,unit:'g'},'lb'],[{name:'Rice',qty:400,unit:'g'},'oz'],[{name:'Rice',qty:.5,unit:'kg'},'lb'],[{name:'Milk',qty:240,unit:'ml'},'cup'],[{name:'Milk',qty:30,unit:'ml'},'fl oz'],[{name:'Milk',qty:60,unit:'ml'},'cup'],[{name:'Carrots',qty:160,unit:'g'},'each'],[{name:'Rice',qty:1,unit:'bag'},'bag']])assert.equal(ui.displayUnit(row,'US',policy),expected);
 assert.equal(ui.displayUnit({name:'Rice',qty:500,unit:'g'},'UK',policy),'g');assert.equal(ui.displayUnit({name:'Milk',qty:240,unit:'ml'},'UK',policy),'ml');assert.equal(ui.displayUnit({name:'Rice',qty:1,unit:'lb'},'UK',policy),'g');
});
test('measured summaries use the shared two-decimal formatter without changing quantities',()=>{
 const display=require('../bb-pantry-display.js'),row=Object.freeze({name:'Rice',qty:500,unit:'g'}),before=JSON.stringify(row);
 assert.equal(ui.summaryAmount(row,'US',policy,display),'1.1 lb');assert.equal(ui.summaryAmount(row,'UK',policy,display),'500 g');assert.equal(ui.summaryAmount({name:'Milk',qty:240,unit:'ml'},'US',policy,display),'1 US cups');assert.equal(ui.summaryAmount({name:'Carrots',qty:160,unit:'g'},'US',policy,display),'2 each');assert.equal(JSON.stringify(row),before);
});
test('US steppers add physical base-unit deltas exactly without display-rounding drift',()=>{
 const rice=Object.freeze({name:'Rice',qty:500,unit:'g'}),before=JSON.stringify(rice);assert.deepEqual(ui.stepPatch(rice,'lb',1,policy,'US'),{qty:613.4,unit:'g'});assert.deepEqual(ui.stepPatch(rice,'lb',-1,policy,'US'),{qty:386.6,unit:'g'});assert.deepEqual(ui.stepPatch({name:'Milk',qty:240,unit:'ml'},'cup',1,policy,'US'),{qty:300,unit:'ml'});assert.deepEqual(ui.stepPatch({name:'Carrots',qty:160,unit:'g'},'each',1,policy,'US'),{qty:240,unit:'g'});assert.deepEqual(ui.stepPatch({name:'Rice',qty:1,unit:'bag'},'bag',1,policy,'US'),{qty:2,unit:'bag'});assert.equal(JSON.stringify(rice),before);
});


test('source-region containers keep their physical quantity while target units use the active region',()=>{
 const uk={name:'Milk',qty:1,unit:'pint',inputMarket:'UK'},us={name:'Milk',qty:1,unit:'pint',inputMarket:'US'},display=require('../bb-pantry-display.js');
 assert.equal(ui.displayUnit(uk,'US',policy),'cup');assert.equal(ui.converted(uk,'ml',policy,'US'),568);assert.equal(ui.converted(uk,'pint',policy,'US'),1.200846,'the source UK pint remains568ml while a targetUSpint is473ml');
 assert.equal(ui.converted({name:'Milk',qty:568,unit:'ml',inputMarket:'UK'},'pint',policy,'US'),1.200846);
 assert.deepEqual(ui.stepPatch({name:'Milk',qty:568,unit:'ml',inputMarket:'UK'},'pint',1,policy,'US'),{qty:686.25,unit:'ml'});
 assert.deepEqual(ui.stepPatch(uk,'pint',1,policy,'US'),{qty:686.25,unit:'ml'});
 assert.equal(ui.displayUnit(us,'UK',policy),'ml');assert.equal(ui.converted(us,'ml',policy,'UK'),473);assert.equal(ui.summaryAmount(us,'UK',policy,display),'473 ml');assert.equal(ui.summaryAmount(uk,'US',policy,display),'2.37 US cups');
 assert.equal(ui.displayUnit({name:'Ground beef',qty:1,unit:'pack',inputMarket:'UK'},'US',policy),'lb');assert.equal(ui.summaryAmount({name:'Ground beef',qty:1,unit:'pack',inputMarket:'UK'},'US',policy,display),'1.1 lb');
});


test('regional pint display and steps ignore container capacity while preserving its saved source quantity',()=>{
 const row={name:'Milk',qty:568,unit:'ml',inputMarket:'UK',packReviewed:true,packQuantity:568,packUnit:'ml'};const before=JSON.stringify(row);assert.equal(ui.converted(row,'pint',policy,'US'),1.200846);assert.deepEqual(ui.stepPatch(row,'pint',1,policy,'US'),{qty:686.25,unit:'ml'});assert.equal(JSON.stringify(row),before);
 const tomato={name:'Chopped tomatoes',qty:800,unit:'g',inputMarket:'UK',packReviewed:true,packQuantity:400,packUnit:'g'};assert.equal(ui.converted(tomato,'tin',policy,'US'),2,'reviewed contents retain actual container size');
});
