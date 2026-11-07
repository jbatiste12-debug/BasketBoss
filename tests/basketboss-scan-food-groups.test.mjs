import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizePantryState,pantryLotMetadata} from '../bb-receipt-inventory-core.mjs';
const require=createRequire(import.meta.url),camera=require('../bb-pantry-camera.js'),identity=require('../bb-scan-food-identity.js');
const uid=(name,loc)=>loc+'|'+name.toLowerCase();
const tuna=(name,qty,extra={})=>({name,qty,loc:'cupboard',unit:'g',variant:'brine',quantityBasis:'drained',...extra});
const save=(foods,state={stock:{},inventory:{}})=>camera.prepare({...state,foods,uid});
const active=state=>Object.values(state.inventory).filter(row=>row.selected!==false);

test('approved branded products resolve to food identities without generic brand stripping',()=>{
 for(const name of ['John West Tuna Chunks','Waitrose Tuna Chunks'])assert.equal(identity.resolve(name).canonicalName,'Tinned tuna');
 assert.equal(identity.resolve('Essential Waitrose Chopped Tomatoes').canonicalName,'Chopped tomatoes');
 assert.equal(identity.resolve('Heinz Beanz').canonicalName,'Baked beans');
 for(const name of ['Fresh tuna','Frozen tuna','Tuna chunks','Heinz Beanz with Sausages','Waitrose Tuna Steak','Unknown Brand Tuna Chunks','Fresh Waitrose Chopped Tomatoes']){
  assert.equal(identity.resolve(name).approved,false,name);assert.equal(identity.resolve(name).canonicalName,name);
 }
});

test('two brands with compatible confirmed weights form one stocktake total and preserve product provenance',()=>{
 const foods=[tuna('John West Tuna Chunks',120),tuna('Waitrose Tuna Chunks',.145,{unit:'kg'})];
 const result=save(foods),row=active(result)[0];
 assert.deepEqual(result.stock,{'drained tinned tuna in brine|g':265});assert.equal(active(result).length,1);assert.equal(row.qty,265);
 assert.deepEqual(row.scanProductLots.map(lot=>lot.brand),['John West','Waitrose']);
 assert.equal(row.scanProductLots[1].checkedQuantity,.145);assert.equal(row.scanProductLots[1].unit,'kg');
 assert.equal(row.trackingMode,'measured');assert.equal(row.measurementReviewed,true);
 const again=save(foods,result);assert.deepEqual(again.stock,result.stock,'repeating a stocktake replaces rather than adds');assert.equal(active(again).length,1);
});

test('unmeasured branded scan names consolidate to one pending food heading without inventing stock',()=>{
 const inventory=Object.fromEntries(['John West Tuna Chunks','Waitrose Tuna Chunks'].map(name=>[uid(name,'cupboard'),{name,loc:'cupboard',selected:true,qty:null,unit:'g',source:'scan'}]));
 const result=save([tuna('John West Tuna Chunks',null,{variant:''}),tuna('Waitrose Tuna Chunks',null,{variant:''})],{stock:{'rice|g':200},inventory});
 assert.deepEqual(result.stock,{'rice|g':200});assert.equal(active(result).length,1);assert.equal(active(result)[0].name,'Drained tinned tuna');
 assert.equal(active(result)[0].qty,null);assert.equal(active(result)[0].scanNeedsReview,true);assert.equal(active(result)[0].scanProductLots.length,2);
 assert.equal(active(result)[0].trackingMode,undefined);assert.match(result.groups[0].reviewMessage,/Confirm the amount/);
});

test('unknown product amounts retain confirmed stock and its weight basis for later review',()=>{
 const initial=save([tuna('John West Tuna Chunks',120)]);
 const pending=save([tuna('John West Tuna Chunks',120),tuna('Waitrose Tuna Chunks',null)],initial);
 assert.deepEqual(pending.stock,initial.stock);assert.equal(active(pending)[0].qty,120);assert.equal(active(pending)[0].scanQuantityBasis,'drained');
 assert.equal(active(pending)[0].scanPreviousProductLots.length,1);assert.equal(active(pending)[0].scanNeedsReview,true);
});

test('packing liquids and fresh or frozen tuna remain distinct physical food groups',()=>{
 const result=save([tuna('John West Tuna Chunks in brine',100),tuna('Waitrose Tuna Chunks in sunflower oil',150,{variant:'sunflower'}),{name:'Fresh tuna',loc:'fridge',qty:200,unit:'g'},{name:'Frozen tuna',loc:'freezer',qty:300,unit:'g'}]);
 assert.deepEqual(result.stock,{'drained tinned tuna in brine|g':100,'drained tinned tuna in sunflower oil|g':150,'fresh tuna|g':200,'frozen tuna|g':300});
 assert.equal(active(result).length,4);
 assert.throws(()=>save([tuna('John West Tuna Chunks in brine',100,{variant:'sunflower'})]),/disagrees/);
});

test('unspecified packing liquid and mixed net or drained basis never silently combine',()=>{
 for(const foods of [
  [tuna('John West Tuna Chunks',120,{variant:''}),tuna('Waitrose Tuna Chunks',145,{variant:''})],
  [tuna('John West Tuna Chunks',120,{quantityBasis:''})]
 ]){const result=save(foods);assert.deepEqual(result.stock,{});assert.ok(result.groups.every(group=>group.pending));}
 const prior=save([tuna('John West Tuna Chunks',200,{quantityBasis:'net'})]);
 const changed=save([tuna('John West Tuna Chunks',140)],prior);assert.deepEqual(changed.stock,prior.stock);assert.equal(active(changed).find(row=>row.bb173StockValue>0).scanQuantityBasis,'net');assert.equal(changed.groups[0].pending,true);
});
test('different net and drained product weights retain distinct physical identities',()=>{
 const result=save([tuna('John West Tuna Chunks',200,{quantityBasis:'net'}),tuna('Waitrose Tuna Chunks',145)]);
 assert.deepEqual(result.stock,{'tinned tuna in brine|g':200,'drained tinned tuna in brine|g':145});assert.equal(active(result).length,2);
});
test('generic drained tuna cannot credit a generic NET meal requirement through the actual pantry allocator',()=>{
 const drained=save([tuna('Tinned tuna',200,{variant:''})]);
 assert.deepEqual(drained.stock,{'drained tinned tuna|g':200});
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),source=html.match(/const BB307Pantry=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/)[0];
 const context=vm.createContext({BB_WHOLE_PRODUCE_GRAMS:{},BBPantryPolicy:require('../bb-pantry-policy.js')});
 vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),context);vm.runInContext(source+'\nthis.pantry=BB307Pantry;',context);
 const requirements=[{key:'Tinned tuna',unit:'g',required:290}],result=context.pantry.reconcileStock(drained.stock,requirements);
 assert.equal(result.pantry['tinned tuna|g'],undefined);assert.equal(result.remainingStock['drained tinned tuna|g'],200,'drained grams never turn into net label grams');
 const again=save([tuna('Tinned tuna',200,{variant:''})],drained);assert.deepEqual(again.stock,drained.stock);
 const net=save([tuna('Tinned tuna',290,{variant:'',quantityBasis:'net'})]),covered=context.pantry.reconcileStock(net.stock,requirements);
 assert.equal(covered.pantry['tinned tuna|g'],290,'an explicitly reviewed net amount still covers the compatible net requirement');
});

test('different reviewed tin sizes sum by contents and never use a generic canned-food default',()=>{
 const foods=[tuna('John West Tuna Chunks',2,{unit:'tin',packReviewed:true,packQuantity:120,packUnit:'g'}),tuna('Waitrose Tuna Chunks',3,{unit:'tin',packReviewed:true,packQuantity:145,packUnit:'g'})];
 const result=save(foods);assert.equal(result.stock['drained tinned tuna in brine|g'],675);assert.equal(active(result)[0].scanProductLots[1].packQuantity,145);
 const unknown=save([tuna('John West Tuna Chunks',2,{unit:'tin'}),tuna('Waitrose Tuna Chunks',3,{unit:'tin'})]);
 assert.deepEqual(unknown.stock,{});assert.equal(unknown.groups[0].pending,true);assert.match(unknown.groups[0].reviewMessage,/container/);
});
test('a user-reviewed spice jar uses its explicit contents even without a branded alias',()=>{
 const food={name:'Black Peppercorns',loc:'cupboard',qty:1,unit:'jar',packReviewed:true,packQuantity:20,packUnit:'g'};
 const result=save([food]),row=active(result)[0];
 assert.equal(identity.resolve(food.name).approved,false);assert.deepEqual(result.stock,{'black peppercorns|g':20});
 assert.equal(row.qty,20);assert.equal(row.unit,'g');assert.equal(row.trackingMode,'measured');assert.equal(row.measurementReviewed,true);
 assert.equal(row.scanProductLots[0].checkedQuantity,1);assert.equal(row.scanProductLots[0].unit,'jar');assert.equal(row.scanProductLots[0].packQuantity,20);
 const again=save([food],result);assert.deepEqual(again.stock,result.stock,'reviewing the same one-jar stocktake cannot credit it twice');
 const before=JSON.stringify(result);
 assert.throws(()=>save([{...food,packReviewed:false,packQuantity:undefined,packUnit:undefined}],result),/matching unit/);
 assert.equal(JSON.stringify(result),before,'an unreviewed jar never guesses grams or changes prior stock');
 const incomplete=save([{...food,packQuantity:null}],result);assert.equal(incomplete.groups[0].pending,true);assert.deepEqual(incomplete.stock,result.stock);
});

test('brand aliases sum approved tomatoes and baked beans while keeping different foods separate',()=>{
 const result=save([{name:'Essential Waitrose Chopped Tomatoes',loc:'cupboard',qty:400,unit:'g'},{name:'Chopped tomatoes',loc:'cupboard',qty:200,unit:'g'},{name:'Heinz Beanz',loc:'cupboard',qty:800,unit:'g'},{name:'Tomatoes',loc:'fridge',qty:120,unit:'g'}]);
 assert.deepEqual(result.stock,{'chopped tomatoes|g':600,'baked beans|g':800,'tomato|g':120});assert.equal(active(result).length,3);
});

test('one location stocktake keeps other confirmed locations and zero removes only that group',()=>{
 const initial=save([tuna('John West Tuna Chunks',120),tuna('Waitrose Tuna Chunks',200,{loc:'freezer'})]);
 const replaced=save([tuna('John West Tuna Chunks',90)],initial);assert.equal(replaced.stock['drained tinned tuna in brine|g'],290);
 const removed=save([tuna('John West Tuna Chunks',0)],replaced);assert.equal(removed.stock['drained tinned tuna in brine|g'],200);assert.equal(active(removed).length,1);
});

test('previously measured branded stock is retained for explicit migration rather than counted twice',()=>{
 const name='John West Tuna Chunks',key=uid(name,'cupboard'),inventory={[key]:{name,loc:'cupboard',selected:true,qty:120,unit:'g',bb173StockKey:'john west tuna chunks|g',bb173StockValue:120}};
 const result=save([tuna(name,120)],{stock:{'john west tuna chunks|g':120},inventory});assert.deepEqual(result.stock,{'john west tuna chunks|g':120});assert.equal(result.groups[0].pending,true);
});
test('pantry normalization keeps scanner product provenance, basis and reviewed measurement mode',()=>{
 const initial=save([tuna('John West Tuna Chunks',120),tuna('Waitrose Tuna Chunks',145)]),first=active(initial)[0];
 const normalized=normalizePantryState(initial.stock,initial.inventory,{exactConversionsOnly:true}),row=Object.values(normalized.inventory).find(row=>row.selected!==false);
 assert.deepEqual(normalized.stock,initial.stock);assert.deepEqual(row.scanProductLots,first.scanProductLots);
 const metadata=pantryLotMetadata(row);assert.equal(metadata.scanQuantityBasis,'drained');assert.equal(metadata.trackingMode,'measured');assert.equal(metadata.measurementReviewed,true);
 assert.deepEqual(metadata.scanProductLots.map(lot=>lot.brand),['John West','Waitrose']);
});
