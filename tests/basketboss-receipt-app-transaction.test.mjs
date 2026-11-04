import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),quantities=require('../bb-receipt-quantity.js');
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html=read('app.html'),start=html.indexOf('function bbReceiptPrepareSave(packet){'),end=html.indexOf('function bbReceiptConfigureHost(){',start),source=html.slice(start,end);
const keys={BB307_FEATURE_KEY:'basketboss_321_features_v1',BB321_SHOP_TICKS_KEY:'basketboss_321_v11_shop_ticks',BB84_PURCHASED_KEY:'basketboss_ui_next_bought_quantity_v1',BB_PARTIAL_PURCHASE_KEY:'basketboss_partial_purchases_v1',BB_BETA_CHOICE_KEY:'basketboss_purchase_choices_v1',BB_SHOP_SESSION_V7_KEY:'basketboss_active_shop_session_v7'};
function fixture({trip='shop-current',essentials=[{id:'soap',name:'soap',qty:6,unit:'each',selected:true,targetQty:6,ownedQty:2,manualPending:true}],requirements=[{key:'rice',unit:'g',required:500,classification:'food'}]}={}){
 const values=new Map([[keys.BB_SHOP_SESSION_V7_KEY,JSON.stringify({version:7,id:trip,checkboxUndo:{'rice|g':null}})],[keys.BB307_FEATURE_KEY,JSON.stringify({version:1,essentials})],['basketboss_at_home_requirements_v1',JSON.stringify({version:1,byActor:{alice:{targets:{'rice|g':{name:'rice',unit:'g',targetQty:500,pending:true}}}}})]]);
 const context=vm.createContext({...keys,window:{BBReceiptQuantity:quantities,BBHome:{actor:()=> 'alice'}},localStorage:{getItem:key=>values.get(key)??null,setItem(){throw Error('Transaction preparation wrote storage');}},BBPriceV19:{canonical:name=>name.toLowerCase()},BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit},bbReceiptShoppingRows:()=>requirements,bb84DetailFor:(item,essential)=>({name:item.key||item.name,unit:item.unit,essential})});
 vm.runInContext(source,context);return {values,prepare:packet=>JSON.parse(JSON.stringify(context.bbReceiptPrepareSave(packet)))};
}
const packet={source:'cloud',receiptId:'receipt-1',shopSessionId:'shop-current',addToPantry:true,stockAfter:{'rice|g':1200},items:[{key:'rice',classification:'food',quantity:1000,unit:'g'}],essentials:[{name:'Soap',quantity:6,unit:'each'}]};
test('receipt app projection atomically prepares essential balances and matching bought markers without writes',()=>{
 const {prepare,values}=fixture(),before=new Map(values),result=prepare(packet);
 assert.deepEqual(values,before);assert.equal(result.changes[keys.BB307_FEATURE_KEY].essentials[0].ownedQty,8);assert.equal(result.changes[keys.BB307_FEATURE_KEY].essentials[0].manualPending,false);
 assert.equal(result.changes[keys.BB321_SHOP_TICKS_KEY]['rice|g'],true);assert.equal(result.changes[keys.BB321_SHOP_TICKS_KEY]['ess:soap'],true);
 assert.equal(result.changes[keys.BB84_PURCHASED_KEY]['rice|g'].qty,1000);assert.equal(result.changes['basketboss_at_home_requirements_v1'].byActor.alice.targets['rice|g'].pending,false);
 for(const key of Object.keys(result.changes))assert.equal(result.expected[key],before.get(key)??null);
});
test('partial receipt stock keeps the shopping shortfall outstanding',()=>{
 const {prepare}=fixture(),result=prepare({...packet,essentials:[],stockAfter:{'rice|g':300},items:[{key:'rice',classification:'food',quantity:100,unit:'g'}]});
 assert.equal(result.changes[keys.BB321_SHOP_TICKS_KEY],undefined);assert.equal(result.changes['basketboss_at_home_requirements_v1'],undefined);
});
test('price-only policy changes no pantry, essentials, or bought markers',()=>{
 assert.deepEqual(fixture().prepare({...packet,addToPantry:false}).changes,{});
 assert.deepEqual(fixture().prepare({...packet,stockPantry:false}).changes,{});
});
test('receipt from an older trip restocks essentials without checking off the new trip',()=>{
 const result=fixture().prepare({...packet,shopSessionId:'shop-old'});
 assert.equal(result.changes[keys.BB307_FEATURE_KEY].essentials[0].ownedQty,8);assert.equal(result.changes[keys.BB321_SHOP_TICKS_KEY],undefined);
});
test('compatible household metric amounts normalize and mismatched count units stay separate',()=>{
 const {prepare}=fixture({essentials:[{id:'detergent',name:'detergent',unit:'ml',qty:1000,selected:true,targetQty:1000,ownedQty:250,manualPending:true},{id:'soap',name:'soap',unit:'pack',qty:1,selected:true,targetQty:1,ownedQty:0,manualPending:true}]}),result=prepare({...packet,items:[],essentials:[{name:'detergent',quantity:1,unit:'l'},{name:'soap',quantity:6,unit:'each'}]});
 const rows=result.changes[keys.BB307_FEATURE_KEY].essentials;assert.equal(rows[0].ownedQty,1250);assert.equal(rows[1].ownedQty,0);assert.equal(rows[2].unit,'each');assert.equal(rows[2].ownedQty,6);assert.equal(result.changes[keys.BB321_SHOP_TICKS_KEY]['ess:soap'],undefined);
});
test('new household receipt entries retain stock with no invented shopping request',()=>{
 const result=fixture({essentials:[]}).prepare(packet),row=result.changes[keys.BB307_FEATURE_KEY].essentials[0];
 assert.equal(row.ownedQty,6);assert.equal(row.targetQty,0);assert.equal(row.selected,false);assert.equal(row.manualPending,false);
});
test('legacy price-only review learns household pack prices without increasing ownership',()=>{
 const result=fixture().prepare({...packet,source:'legacy',stockPantry:false,essentials:[],priceUpdates:[{name:'soap',unit:'each',market:'UK',retailer:'Tesco',price:3.2}],items:[{key:'soap',name:'soap',classification:'essential',quantity:6,unit:'each',guidePackQuantity:6,guidePackUnit:'each',price:3.2,brand:'Usual'}],market:'UK',retailer:'Tesco'});
 const row=result.changes[keys.BB307_FEATURE_KEY].essentials[0];assert.equal(row.ownedQty,2);assert.equal(row.manualPending,true);assert.equal(row.estimatedPackPrice,3.2);assert.equal(row.packQuantity,6);assert.equal(row.priceRetailer,'Tesco');assert.equal(result.changes[keys.BB321_SHOP_TICKS_KEY],undefined);
});
test('invalid saved essentials fail preparation before any stock transaction',()=>{
 const fixtureValue=fixture();fixtureValue.values.set(keys.BB307_FEATURE_KEY,'{"essentials":{}}');assert.throws(()=>fixtureValue.prepare(packet),/saved essentials/);
});
test('prepared legacy shelf prices never write until their surrounding receipt commits',()=>{
 const saved=new Map(),context=vm.createContext({localStorage:{getItem:key=>saved.get(key)??null,setItem(){throw Error('Unexpected write');}}});vm.runInContext(read('basketboss-aisles-v20.js'),context);vm.runInContext(read('basketboss-pricing-v19.js'),context);const api=context.BBPriceV19,pack=api.getPack('potato','g','UK','Tesco');
 const prepared=api.preparePriceOverrides([{name:'potato',unit:'g',market:'UK',retailer:'Tesco',price:2.75,brand:'Usual',packQuantity:pack.standard_pack_size,packUnit:pack.standard_pack_unit}]);assert.equal(saved.size,0);assert.equal(prepared.expected,null);assert.equal(Object.values(prepared.value)[0].price,2.75);
 assert.throws(()=>api.preparePriceOverrides([{name:'potato',unit:'g',market:'UK',retailer:'Tesco',price:2.75,packQuantity:500,packUnit:'g'}]),/matching pack/);assert.equal(saved.size,0);
 saved.set(prepared.key,'broken-json');assert.throws(()=>api.preparePriceOverrides([]),/need review/);
});
