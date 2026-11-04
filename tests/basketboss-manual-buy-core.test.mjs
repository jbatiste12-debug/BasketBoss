import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {install}=createRequire(import.meta.url)('../bb-home.js');
const HOME='basketboss_at_home_requirements_v1',STOCK='stock',SESSION='basketboss_cloud_session_v1';
function fixture(){
 const values=new Map([[STOCK,JSON.stringify({'eggs|each':10})],['inventory','{}'],[SESSION,JSON.stringify({user:{id:'person'}})]]),state={trip:'trip-one',bought:0,pending:false,household:[{id:'soap',name:'Soap',unit:'each',qty:1,ownedQty:10,owned:true}],refresh:0};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const id=(name,unit)=>name.toLowerCase()+'|'+unit;
 const host={id,keys:()=>({stock:STOCK,inventory:'inventory'}),stock:()=>JSON.parse(values.get(STOCK)),household:()=>state.household,refresh:()=>state.refresh++,shoppingKind:name=>/soap|bin bags/i.test(name)?'household':'food',shoppingPurchaseContext:()=>({shopSessionId:state.trip,quantity:state.bought})};
 const win={localStorage:storage,BBHomeHost:host,BBReceiptHost:{hasPendingConfirmation:()=>state.pending,canConsumePantry:()=>!state.pending},document:{},location:{search:''}};
 const home=install(win);win.BBHome=home;
 const request=(name='Eggs',quantityText='4',requestId='request-one')=>({name,quantityText,requestId,actorId:'person'});
 return {home,host,state,values,storage,request,stock:()=>values.get(STOCK),data:()=>JSON.parse(values.get(HOME)||'{}')};
}
test('direct buy four remains four even with ten already at home; stock and Kitchen never change',()=>{
 const h=fixture(),before=new Map(h.values);assert.equal(h.home.addShoppingBuy(h.request()).ok,true);
 const rows=h.home.manualBuyItems([]);assert.equal(rows[0].toBuy,4);assert.equal(rows[0].pantryUsed,0);
 for(const key of [STOCK,'inventory',SESSION])assert.equal(h.values.get(key),before.get(key));
 assert.equal(h.home.targets()['eggs|each'],undefined,'manual buys are not target-minus-stock requirements');
});
test('automatic meal shortfall and direct manual top-up add without applying pantry twice',()=>{
 const h=fixture();h.home.addShoppingBuy(h.request());
 const [row]=h.home.manualBuyItems([{key:'Eggs',unit:'each',required:12,pantryUsed:10,toBuy:2}]);
 assert.equal(row.toBuy,6);assert.equal(row.pantryUsed,10);assert.equal(row.required,16);
});
test('same-intent retries are idempotent, edited intents replace their manual quantity, and zero removes only the top-up',()=>{
 const h=fixture();assert.equal(h.home.addShoppingBuy(h.request()).ok,true);
 assert.equal(h.home.addShoppingBuy(h.request()).already,true);assert.equal(h.home.manualBuyItems([])[0].toBuy,4);
 assert.equal(h.home.addShoppingBuy(h.request('Eggs','5')).ok,false,'same request identity cannot change its meaning');
 assert.equal(h.home.addShoppingBuy(h.request('Eggs','2','request-two')).ok,true);assert.equal(h.home.manualBuyItems([])[0].toBuy,2);
 assert.equal(h.home.addShoppingBuy(h.request('Eggs','0','remove')).ok,true);
 assert.equal(h.home.shoppingBuys().length,0);assert.equal(h.home.manualBuyItems([{key:'Eggs',unit:'each',toBuy:2,required:12,pantryUsed:10}])[0].toBuy,2);
});
test('simple quantity text supports explicit metric amounts and packs without inventing pack contents',()=>{
 for(const [text,amount,unit]of [['2 packs',2,'pack'],['500 g',500,'g'],['0.5 kg',500,'g'],['750 ml',750,'ml'],['1 bag (500 g)',500,'g'],['2x400g',800,'g']]){
  const h=fixture();assert.equal(h.home.addShoppingBuy(h.request('Pasta',text)).ok,true);
  const [row]=h.home.shoppingBuys();assert.equal(row.quantity,amount);assert.equal(row.unit,unit);
 }
 for(const text of ['-1','Infinity','0x20','1e3','1 pack (unknown)','0.5 packs']){
  const h=fixture(),before=[...h.values];assert.equal(h.home.addShoppingBuy(h.request('Pasta',text)).ok,false);assert.deepEqual([...h.values],before);
 }
});
test('a new top-up after already buying the same item keeps its additional quantity visible in this trip',()=>{
 const h=fixture();h.state.bought=4;h.home.addShoppingBuy(h.request('Eggs','2'));
 assert.equal(h.home.manualBuyItems([])[0].toBuy,6,'four already bought plus two more');
 h.state.trip='next-trip';assert.equal(h.home.manualBuyItems([])[0].toBuy,2,'prior trip purchase does not become another request');
});
test('household manual buys stay separate from food stock and combine with automatic essentials needs',()=>{
 const h=fixture(),stock=h.stock();h.home.addShoppingBuy(h.request('Soap','2'));
 assert.equal(h.home.shoppingBuys()[0].kind,'household');assert.equal(h.home.manualBuyItems([]).length,0);
 assert.equal(h.home.manualBuyEssentials([])[0].qty,2,'owned ten does not cancel an explicit request to buy two');
 assert.equal(h.home.manualBuyEssentials([{id:'soap',name:'Soap',unit:'each',qty:1}])[0].qty,3);
 assert.equal(h.stock(),stock);assert.equal(h.state.household[0].ownedQty,10);
});
test('receipt/Finish-shop deposits fulfill automatic shortfalls first, leaving only the unpurchased manual amount',()=>{
 const h=fixture();h.home.addShoppingBuy(h.request());const home=h.data();
 assert.equal(h.home.applyManualPurchases(home,{shopSessionId:'trip-one',additions:[{id:'eggs|each',quantity:3,automaticQuantity:2}]}),true);
 const row=Object.values(home.byActor.person.manualBuys)[0];assert.equal(row.quantity,3);assert.equal(row.pending,true);
 assert.equal(h.home.applyManualPurchases(home,{shopSessionId:'trip-one',additions:[{id:'eggs|each',quantity:3,automaticQuantity:0}]}),true);
 assert.equal(row.quantity,0);assert.equal(row.pending,false);
});
test('a different receipt trip does not fulfill the current manual buying intent',()=>{
 const h=fixture();h.home.addShoppingBuy(h.request());const home=h.data();
 assert.equal(h.home.applyManualPurchases(home,{shopSessionId:'another-trip',additions:[{id:'eggs|each',quantity:10,automaticQuantity:0}]}),false);
 assert.equal(Object.values(home.byActor.person.manualBuys)[0].quantity,4);
});
test('account changes and unresolved receipt confirmation block additions without writes',()=>{
 for(const mode of ['account','pending']){const h=fixture();if(mode==='account')h.values.set(SESSION,JSON.stringify({user:{id:'other-person'}}));else h.state.pending=true;
  const before=[...h.values];assert.equal(h.home.addShoppingBuy(h.request()).ok,false);assert.deepEqual([...h.values],before);
 }
});
test('failed storage can retry safely and a repaint error after commit cannot report a false failed save',()=>{
 const h=fixture(),put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key===HOME&&fail){fail=false;throw Error('quota');}put(key,value);};
 assert.equal(h.home.addShoppingBuy(h.request()).ok,false);assert.equal(h.values.get(HOME),undefined);
 h.host.refresh=()=>{throw Error('render');};assert.equal(h.home.addShoppingBuy(h.request()).ok,true);
 assert.equal(h.home.addShoppingBuy(h.request()).already,true);assert.equal(h.home.shoppingBuys()[0].quantity,4);
});
