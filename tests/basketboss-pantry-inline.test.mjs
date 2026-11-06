import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),ui=require('../bb-pantry-inline.js'),policy=require('../bb-pantry-policy.js');
test('food recognition resolves cupboard aliases without guessing partial names or merging fresh stock',()=>{
 const tinned=Object.freeze({name:'Tinned tuna',loc:'cupboard',aliases:Object.freeze(['Tuna'])}),fresh=Object.freeze({name:'Fresh tuna steak',loc:'fridge',aliases:Object.freeze([])}),frozen=Object.freeze({name:'Frozen tuna',loc:'freezer',aliases:Object.freeze([])}),courgette=Object.freeze({name:'Courgette',loc:'fridge',aliases:Object.freeze([])}),foods=Object.freeze([tinned,fresh,frozen,courgette]),before=JSON.stringify(foods);
 assert.equal(ui.matchedFood(' TUNA ',foods,'cupboard'),tinned);
 assert.equal(ui.matchedFood('Fresh tuna steak',foods,'cupboard'),fresh);
 assert.equal(ui.matchedFood('Frozen tuna',foods,'cupboard'),frozen);
 assert.equal(ui.matchedFood('Zucchini',foods,'fridge',policy.canonicalName),courgette);
 assert.equal(ui.matchedFood('Tu',foods,'cupboard'),null,'partial typing remains a draft, not an assumed ingredient');
 assert.equal(ui.matchedFood('My own fish cakes',foods,'freezer'),null,'a custom name is not replaced with an unrelated known food');
 assert.equal(ui.matchedFood('',foods,'cupboard'),null);
 assert.equal(JSON.stringify(foods),before);
});
test('search discovers known food beyond saved inventory and keeps an existing saved identity first',()=>{
 const saved={name:'Tuna',loc:'cupboard',aliases:[]},tinned={name:'Tinned tuna',loc:'cupboard',aliases:['Tuna']},fresh={name:'Fresh tuna steak',loc:'fridge',aliases:[]},frozen={name:'Frozen tuna',loc:'freezer',aliases:[]},milk={name:'Milk',loc:'fridge',aliases:[]},foods=[saved,tinned,fresh,frozen,milk],before=JSON.stringify(foods);
 assert.equal(ui.matchedFood('Tuna',foods,'cupboard'),saved,'a legacy saved name keeps its existing stock key');
 assert.deepEqual(ui.matchingFoods('milk',foods,'cupboard'),[milk]);
 assert.deepEqual(ui.matchingFoods('tuna',foods,'cupboard',2),[tinned,saved].sort((a,b)=>a.name.localeCompare(b.name)));
 assert.deepEqual(ui.matchingFoods('   ',foods,'cupboard'),[]);
 assert.deepEqual(ui.matchingFoods('Unknown custom food',foods,'cupboard'),[]);
 assert.equal(JSON.stringify(foods),before,'recognition never changes stock records or the catalogue');
});
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

test('inventory search and status filters are read-only views across storage areas',()=>{
 const rows=Object.freeze([
  Object.freeze({name:'Crème fraîche',loc:'fridge',qty:200,unit:'g'}),
  Object.freeze({name:'Rice',loc:'cupboard',qty:0,unit:'g'}),
  Object.freeze({name:'Salt',loc:'cupboard',qty:1,unit:'each',stapleStatus:'low'}),
  Object.freeze({name:'Frozen peas',loc:'freezer',qty:null,unit:'g'})
 ]),before=JSON.stringify(rows);
 assert.deepEqual(rows.filter(row=>ui.matchesInventory(row,{query:' CREME '})),[rows[0]]);
 assert.deepEqual(rows.filter(row=>ui.matchesInventory(row,{filter:'low'})),[rows[1],rows[2]]);
 assert.deepEqual(rows.filter(row=>ui.matchesInventory(row,{filter:'use-soon',useSoon:row===rows[0]})),[rows[0]]);
 assert.equal(ui.matchesInventory(rows[0],{query:'rice',filter:'use-soon',useSoon:true}),false);
 assert.equal(JSON.stringify(rows),before,'search and filtering never change stock or location');
});
test('unknown balances are never presented as Out merely because the quantity is blank',()=>{
 for(const qty of [null,undefined,'','unknown'])assert.equal(ui.matchesInventory({name:'Rice',qty},{filter:'low'}),false);
 assert.equal(ui.matchesInventory({name:'Honey',qty:null,stapleStatus:'out'},{filter:'low'}),true);
 assert.equal(ui.matchesInventory({name:'Chicken',qty:500},{filter:'use-soon',useSoon:false}),false);
});
test('optional purchase presets offer supermarket quantities in each physical dimension',()=>{
 assert.deepEqual(ui.purchasePresets({name:'Milk',unit:'ml'},policy,'UK'),[{quantity:500,unit:'ml'},{quantity:1,unit:'l'},{quantity:2,unit:'l'}]);
 assert.deepEqual(ui.purchasePresets({name:'Pasta',unit:'g'},policy,'UK'),[{quantity:250,unit:'g'},{quantity:500,unit:'g'},{quantity:1,unit:'kg'}]);
 assert.deepEqual(ui.purchasePresets({name:'Eggs',unit:'each'},policy,'UK'),[{quantity:1,unit:'each'},{quantity:6,unit:'each'},{quantity:12,unit:'each'}]);
 assert.deepEqual(ui.purchasePresets({name:'Rice',unit:'g'},policy,'US'),[{quantity:8,unit:'oz'},{quantity:1,unit:'lb'},{quantity:2,unit:'lb'}]);
 assert.deepEqual(ui.purchasePresets({name:'Milk',unit:'ml'},policy,'US'),[{quantity:16,unit:'fl oz'},{quantity:32,unit:'fl oz'},{quantity:64,unit:'fl oz'}]);
});
test('purchase unit choices reject unsupported cross-dimension and unidentified container conversions',()=>{
 const milk=ui.purchaseUnits({name:'Milk',unit:'ml'},policy),unknown=ui.purchaseUnits({name:'Mystery food',unit:'g'},policy);
 assert.ok(milk.includes('l'));assert.ok(milk.includes('fl oz'));assert.equal(milk.includes('g'),false);
 assert.ok(unknown.includes('kg'));assert.equal(unknown.includes('ml'),false);
 assert.deepEqual(ui.purchasePresets({name:'Mystery food',unit:'bag'},policy),[]);
 assert.deepEqual(ui.purchaseUnits({name:'Mystery food',unit:'bag'},policy),['bag']);
});
test('staple purchase helpers remain whole containers and never invent measured volume',()=>{
 const staple=Object.freeze({name:'Olive oil',unit:'each',staple:true,qty:1}),before=JSON.stringify(staple);
 assert.deepEqual(ui.purchaseUnits(staple,policy),['each']);assert.deepEqual(ui.purchasePresets(staple,policy),[{quantity:1,unit:'each'},{quantity:2,unit:'each'},{quantity:3,unit:'each'}]);assert.equal(JSON.stringify(staple),before);
});
test('a recognized ingredient can suggest its existing pack without changing the default exact-amount choice',()=>{
 const row=Object.freeze({name:'Tinned tuna',unit:'g'}),before=JSON.stringify(row);
 assert.deepEqual(ui.purchasePresets(row,policy,'UK',{quantity:145,unit:'g'}),[{quantity:145,unit:'g'},{quantity:250,unit:'g'},{quantity:500,unit:'g'},{quantity:1,unit:'kg'}]);
 assert.deepEqual(ui.purchasePresets({name:'Milk',unit:'ml'},policy,'UK',{quantity:1000,unit:'ml'}),[{quantity:500,unit:'ml'},{quantity:1,unit:'l'},{quantity:2,unit:'l'}],'equivalent litre and millilitre packs are not duplicated');
 assert.deepEqual(ui.purchasePresets(row,policy,'UK',{quantity:145,unit:'ml'}),ui.purchasePresets(row,policy,'UK'),'incompatible dimensions never produce a pack suggestion');
 assert.deepEqual(ui.purchasePresets({name:'Olive oil',unit:'each',staple:true},policy,'UK',{quantity:500,unit:'ml'}),[{quantity:1,unit:'each'},{quantity:2,unit:'each'},{quantity:3,unit:'each'}]);
 assert.equal(JSON.stringify(row),before);
});
