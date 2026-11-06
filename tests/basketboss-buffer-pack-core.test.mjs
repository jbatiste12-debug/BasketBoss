import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),module=require('../bb-home.js'),policy=require('../bb-pantry-policy.js');
const HOME='basketboss_at_home_requirements_v1',SESSION='basketboss_cloud_session_v1';
const id=(name,unit)=>policy.canonicalName(name)+'|'+unit;
function fixture({name='Milk',unit='ml',owned=200,needed=333.333333,market='UK'}={}){
 const values=new Map([['stock',JSON.stringify({[id(name,unit)]:owned})],['inventory',JSON.stringify({fridge:{name,unit,qty:owned}})]]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 let requirements=[{key:name,unit,required:needed}];
 const host={id,requirements:()=>requirements,household:()=>[],keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>JSON.parse(storage.getItem('stock')),reload(){},refresh(){},shoppingKind:()=> 'food',shoppingPurchaseContext:()=>({shopSessionId:'one',quantity:0})};
 const win={document:{},location:{search:''},localStorage:storage,BBPantryPolicy:policy,BBHomeHost:host,bb307ActiveMarket:()=>market};
 const home=module.install(win),row={name,unit,qty:owned};
 const read=key=>JSON.parse(storage.getItem(key)||'null');
 const save=patch=>{const change=home.prepare([{...row,...patch,pantryTarget:true,targetChanged:true}]);module.atomic(storage,{[change.key]:change.value},{[change.key]:change.expected});return home.targets()[id(name,unit)];};
 const shopping=()=>{const augmented=home.augment(requirements,[],home.targets(),id);return home.roundShoppingItems(home.manualBuyItems(augmented.map(item=>({...item,pantryUsed:Math.min(owned,item.required),toBuy:Math.max(0,item.required-owned)}))));};
 return {home,host,win,row,values,storage,read,save,shopping,requirements:value=>requirements=value};
}
test('fractional measured shortfall rounds to a real pack without changing physical stock',()=>{
 const h=fixture(),beforeStock=h.storage.getItem('stock'),beforeInventory=h.storage.getItem('inventory');
 h.save({totalNeeded:333.333333,extraBuffer:0,buyMultiple:1,buyMultipleUnit:'l'});
 const info=h.home.foodTarget(h.row);assert.equal(info.totalQuantity,333.333333);assert.equal(info.extraBufferQuantity,0);assert.equal(info.buyMultipleQuantity,1000);assert.equal(info.unroundedShortfall,133.333333);assert.equal(info.shortfall,1000);
 const shop=h.shopping()[0];assert.equal(shop.required,333.333333,'recipe/base requirement is not rounded');assert.equal(shop.toBuy,1000);assert.equal(shop.buyMultiple,1000);assert.equal(shop.purchasePackCount,1);assert.equal(shop.unroundedToBuy,133.333333);
 assert.equal(h.storage.getItem('stock'),beforeStock);assert.equal(h.storage.getItem('inventory'),beforeInventory);
});
test('extra stock buffer is added exactly once before pantry subtraction and pack rounding',()=>{
 const h=fixture({needed:800,owned:200});h.save({totalNeeded:800,extraBuffer:500,buyMultiple:1,buyMultipleUnit:'l'});
 const info=h.home.foodTarget(h.row);assert.equal(info.totalNeeded,800);assert.equal(info.requiredNeeded,1300);assert.equal(info.shortfall,2000);assert.equal(h.shopping()[0].required,1300);assert.equal(h.shopping()[0].toBuy,2000);
 h.save({totalNeeded:800,extraBuffer:500,buyMultiple:1000,buyMultipleUnit:'ml'});assert.equal(h.home.foodTarget(h.row).requiredNeeded,1300);assert.equal(h.shopping().length,1);assert.equal(h.shopping()[0].toBuy,2000);
});
test('buffer and buying preferences remain active after target fulfillment without reviving the old base',()=>{
 const h=fixture({needed:1000,owned:200});h.save({totalNeeded:1000,extraBuffer:100,buyMultiple:1000,buyMultipleUnit:'ml'});module.atomic(h.storage,h.home.completionChanges('milk|ml'));
 assert.equal(h.home.targets()['milk|ml'].pending,false);h.requirements([{key:'Milk',unit:'ml',required:300}]);
 const info=h.home.foodTarget(h.row);assert.equal(info.totalNeeded,300);assert.equal(info.requiredNeeded,400);assert.equal(info.shortfall,1000);assert.equal(h.shopping()[0].required,400);
 h.requirements([]);assert.equal(h.shopping()[0].required,100);assert.equal(h.shopping()[0].toBuy,0,'existing stock covers a buffer-only week');
});
test('clearing both optional preferences restores exact shortfalls and does not erase stock',()=>{
 const h=fixture({needed:600});h.save({totalNeeded:600,extraBuffer:100,buyMultiple:500,buyMultipleUnit:'ml'});const target=h.save({totalNeeded:600,extraBuffer:0,buyMultiple:0,buyMultipleUnit:'ml'});
 assert.equal(target.extraBuffer,undefined);assert.equal(target.buyMultiple,undefined);assert.equal(h.home.foodTarget(h.row).shortfall,400);assert.equal(h.shopping()[0].toBuy,400);assert.equal(h.read('stock')['milk|ml'],200);
});
test('quantity-only reviews preserve canonical preferences, and account changes never reuse them',()=>{
 const h=fixture();h.save({totalNeeded:333.333333,extraBuffer:250,buyMultiple:1,buyMultipleUnit:'l'});const target=JSON.stringify(h.home.targets());
 const change=h.home.prepare([{...h.row,qty:150}]);module.atomic(h.storage,{[change.key]:change.value});assert.equal(JSON.stringify(h.home.targets()),target);
 h.storage.setItem(SESSION,JSON.stringify({user:{id:'another'}}));const fresh=h.home.foodTarget(h.row);assert.equal(fresh.extraBuffer,0);assert.equal(fresh.buyMultiple,0);assert.deepEqual(h.home.targets(),{});
 h.storage.removeItem(SESSION);assert.equal(h.home.foodTarget(h.row).extraBufferQuantity,250);
});
test('compatible stock from another storage area is deducted before rounding',()=>{
 const h=fixture({needed:1500,owned:200});h.save({totalNeeded:1500,extraBuffer:0,buyMultiple:1000,buyMultipleUnit:'ml'});
 const info=h.home.foodTarget(h.row,{otherRows:[{name:'Milk',unit:'l',qty:.5,loc:'freezer'}]});assert.equal(info.otherOwned,500);assert.equal(info.unroundedShortfall,800);assert.equal(info.shortfall,1000);
});
test('direct manual top-ups remain additive once while one combined amount is rounded',()=>{
 const h=fixture({name:'Rice',unit:'g',owned:200,needed:600});h.save({totalNeeded:600,extraBuffer:100,buyMultiple:500,buyMultipleUnit:'g'});
 assert.equal(h.home.addShoppingBuy({name:'Rice',quantityText:'200 g',requestId:'extra',actorId:'guest'}).ok,true);
 const info=h.home.foodTarget(h.row);assert.equal(info.totalNeeded,800);assert.equal(info.requiredNeeded,900);assert.equal(info.shortfall,1000);assert.equal(h.shopping()[0].toBuy,1000);
 h.save({totalNeeded:800,extraBuffer:100,buyMultiple:500,buyMultipleUnit:'g'});assert.equal(h.home.foodTarget(h.row).requiredNeeded,900);assert.equal(h.shopping()[0].toBuy,1000);assert.equal(h.home.shoppingBuys()[0].quantity,200);
});
test('US cups and pounds normalize buffers and independent metric packs to the same canonical policy',()=>{
 const milk=fixture({unit:'cup',owned:1,needed:2,market:'US'});milk.save({totalNeeded:2,extraBuffer:.5,buyMultiple:1,buyMultipleUnit:'l'});
 const target=milk.home.targets()['milk|ml'];assert.equal(target.targetQty,480);assert.equal(target.extraBuffer,120);assert.equal(target.buyMultiple,1000);const info=milk.home.foodTarget(milk.row);assert.equal(info.extraBufferQuantity,120);assert.equal(info.buyMultipleQuantity,1000);assert.equal(info.requiredQuantity,600);assert.equal(info.shortfall,4.166667);
 const pasta=fixture({name:'Pasta',unit:'lb',owned:1,needed:2,market:'US'});pasta.save({totalNeeded:2,extraBuffer:.5,buyMultiple:500,buyMultipleUnit:'g'});assert.equal(pasta.home.targets()['pasta|g'].extraBuffer,226.8);assert.equal(pasta.home.targets()['pasta|g'].buyMultiple,500);
});
test('purchase pints use the active region independently from historical physical stock',()=>{
 const h=fixture({market:'US'}),info=h.home.foodTarget({...h.row,inputMarket:'UK',buyMultiple:1,buyMultipleUnit:'pint'});
 assert.equal(info.buyMultipleQuantity,473);assert.equal(info.shortfall,473);assert.equal(h.read('stock')['milk|ml'],200);
});
test('purchase pack size does not overwrite the reviewed contents of a physical container',()=>{
 const h=fixture({needed:1500}),row={name:'Milk',qty:1,unit:'bottle',packReviewed:true,packQuantity:750,packUnit:'ml'};
 const info=h.home.foodTarget({...row,extraBuffer:0,buyMultiple:1,buyMultipleUnit:'l'});
 assert.equal(info.quantityPerUnit,750);assert.equal(info.buyMultipleQuantity,1000);assert.equal(info.unroundedShortfall,1);assert.equal(info.shortfall,1.333333);assert.equal(row.packQuantity,750);assert.equal(row.packUnit,'ml');
});
test('countable eggs round to six while staple buffers use whole container counts',()=>{
 const eggs=fixture({name:'Eggs',unit:'each',owned:2,needed:7});eggs.save({totalNeeded:7,extraBuffer:1,buyMultiple:6,buyMultipleUnit:'each'});assert.equal(eggs.home.foodTarget(eggs.row).shortfall,6);assert.equal(eggs.shopping()[0].toBuy,6);
 const h=fixture({name:'Olive oil',unit:'each',owned:1,needed:1});const row={...h.row,staple:true};assert.equal(h.home.foodTarget({...row,extraBuffer:.5}).targetProblem,'Use whole container counts for this staple.');
});
test('invalid, negative and incompatible optional values fail before persistence',()=>{
 const h=fixture(),before=[...h.values];
 for(const patch of [{extraBuffer:-1},{extraBuffer:NaN},{extraBuffer:' '},{buyMultiple:''},{buyMultiple:-1},{buyMultiple:Infinity},{buyMultiple:500,buyMultipleUnit:'g'}]){
  assert.ok(h.home.foodTarget({...h.row,...patch}).targetProblem);assert.throws(()=>h.save({totalNeeded:333.333333,...patch}));assert.deepEqual([...h.values],before);
 }
});
test('covered-at-home reminders require the buffer to be covered and effective totals include it',()=>{
 const h=fixture({needed:600,owned:200});h.save({totalNeeded:600,extraBuffer:100,buyMultiple:1000,buyMultipleUnit:'ml'});
 const list={children:[],querySelector:()=>null,append(node){this.children.push(node);}};
 h.win.document.getElementById=()=>list;h.win.document.createElement=tag=>({tagName:tag,children:[],append(...nodes){this.children.push(...nodes);},addEventListener(){}});h.win.document.createTextNode=text=>({textContent:text});
 h.storage.setItem('stock',JSON.stringify({'milk|ml':650}));h.home.reminders();assert.equal(list.children.length,0,'stock above the meal requirement but below the buffer is not covered');assert.equal(h.home.total('Milk','ml'),700);assert.equal(h.home.total('Milk','l'),.7);
 h.storage.setItem('stock',JSON.stringify({'milk|ml':700}));h.home.reminders();assert.equal(list.children.length,1);assert.equal(list.children[0].children[0].children[1].textContent,'Milk · covered at home');
 module.atomic(h.storage,h.home.completionChanges('milk|ml'));h.requirements([{key:'Milk',unit:'ml',required:300}]);assert.equal(h.home.total('Milk','ml'),400,'a fulfilled old target cannot override a later plan');
});
test('already-recorded reduced purchases never manufacture demand from a saved pack preference',()=>{
 for(const needed of[0,133.333333]){
  const h=fixture({name:'Rice',unit:'g',owned:0,needed});h.save({totalNeeded:needed,extraBuffer:0,buyMultiple:500,buyMultipleUnit:'g'});
  const data=h.read(HOME);data.byActor.guest.manualBuys={'food:bought:rice|g':{name:'Rice',unit:'g',quantity:200,pending:true,kind:'food',purpose:'bought',shopSessionId:'one',boughtAtRequest:0}};h.storage.setItem(HOME,JSON.stringify(data));
  const row=h.shopping()[0];assert.equal(row.toBuy,200,'the already-bought floor is preserved without requesting an extra pack');assert.equal(row.recordedPurchaseFloor,200);assert.equal(row.rawAutomaticPurchaseDemand,needed);assert.equal(row.buyMultiple,500,'selected-pack metadata remains available to prevent generic container labels');assert.equal(row.purchasePackCount,0,'no rounded new purchase is implied');assert.equal(row.purchaseRounded,false);
 }
});
test('a genuine remaining requirement is rounded after an already-recorded actual purchase',()=>{
 const h=fixture({name:'Rice',unit:'g',owned:0,needed:300});h.save({totalNeeded:300,extraBuffer:0,buyMultiple:500,buyMultipleUnit:'g'});
 const data=h.read(HOME);data.byActor.guest.manualBuys={'food:bought:rice|g':{name:'Rice',unit:'g',quantity:200,pending:true,kind:'food',purpose:'bought',shopSessionId:'one',boughtAtRequest:0}};h.storage.setItem(HOME,JSON.stringify(data));
 const row=h.shopping()[0];assert.equal(row.required,300);assert.equal(row.toBuy,700);assert.equal(row.toBuy-row.recordedPurchaseFloor,500,'one whole pack remains to buy, in addition to the recorded actual 200g');assert.equal(row.purchasePackCount,1);
});
test('same-name spice and whole-produce preferences are selected by canonical unit',()=>{
 const h=fixture({name:'Pepper',unit:'g',owned:0,needed:40});
 h.storage.setItem(HOME,JSON.stringify({version:1,byActor:{guest:{targets:{'pepper|each':{name:'Pepper',unit:'each',targetQty:0,pending:false,buyMultiple:2},'pepper|g':{name:'Pepper',unit:'g',targetQty:0,pending:false,buyMultiple:100}},cooked:{},planned:{}}}}));
 const food={key:'Pepper',unit:'g',required:40,toBuy:40,staple:false},spice={key:'Pepper',unit:'each',required:1,toBuy:1,staple:true};
 const [produce,condiment]=h.home.roundShoppingItems([food,spice]);assert.equal(produce.toBuy,100,'the preceding spice policy cannot hide the compatible mass policy');assert.equal(produce.buyMultiple,100);assert.equal(condiment.toBuy,2);assert.equal(condiment.buyMultiple,2);
 const data=h.read(HOME);delete data.byActor.guest.targets['pepper|g'];h.storage.setItem(HOME,JSON.stringify(data));assert.deepEqual(h.home.roundShoppingItems([food])[0],food,'spice container counts never become produce grams');
});
test('pack rounding is stable on exact boundaries, decimal subtraction and empty shortfalls',()=>{
 assert.equal(module.purchaseQuantity(1250,0,250,1000),1000);assert.equal(module.purchaseQuantity(1000.0000004,0,0,1000),1000);assert.equal(module.purchaseQuantity(1000.000001,0,0,1000),2000);assert.equal(module.purchaseQuantity(.3,0,.1,.1),.2);assert.equal(module.purchaseQuantity(100,20,130,500),0);
 assert.deepEqual(module.purchaseAmounts({needed:333.333333,buffer:0,owned:200,multiple:1000,unit:'ml'}),{shortfall:133.333333,rawShortfall:133.333333,purchaseQuantity:1000,packCount:1,rounded:true,unit:'ml'});
 for(const multiple of[-1,NaN,Infinity,.0000001])assert.throws(()=>module.purchaseQuantity(1,0,0,multiple));
});
