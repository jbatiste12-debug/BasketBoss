import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizePantryState} from '../bb-receipt-inventory-core.mjs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),quantity=require('../bb-receipt-quantity.js'),home=require('../bb-home.js');
const ownership=require('../bb-shop-ownership.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
function actual(name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);
 const lineEnd=html.indexOf('\n',start);if(html.slice(start,lineEnd).endsWith('}'))return html.slice(start,lineEnd);
 const end=html.indexOf('\n}',start);assert.ok(end>start,name);return html.slice(start,end+2);
}
const copy=value=>JSON.parse(JSON.stringify(value));
const keys={BB83_KITCHEN_INVENTORY:'inventory',BB307_STOCK_KEY:'stock',BB83_SHOP_STOCK_LEDGER:'legacy',BB_BETA_RECEIPT_KEY:'receipts',BB_BETA_CHOICE_KEY:'choices',BB_PARTIAL_PURCHASE_KEY:'partials',BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_SHOP_SESSION_V7_KEY:'session',BB307_FEATURE_KEY:'features'};
function fixture({name='Pork sausages',unit='each',required=6,pantryUsed=5,toBuy=1,quote={packQty:6,packUnit:'each',packCount:1},pantryName=name,buyMultiple,buyMultipleUnit=unit,essential=false,immediate=true}={}){
 const values=new Map(),read=key=>JSON.parse(values.get(key)||'{}'),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const id=essential?'ess:cleaner':name.toLowerCase()+'|'+unit,stockKey=pantryName.toLowerCase()+'|'+unit;
 const basket={key:name,name,unit,required,pantryUsed,toBuy,qty:toBuy,priceQuote:quote,...(buyMultiple===undefined?{}:{buyMultiple,buyMultipleUnit})},item={id,name,unit,aisle:'Meat & Fish',checked:false,basketItem:basket};
 const inventory=pantryUsed?{['fridge|'+pantryName.toLowerCase()]:{name:pantryName,loc:'fridge',selected:true,qty:pantryUsed,unit,bb173StockKey:stockKey,bb173StockValue:pantryUsed}}:{};
 for(const [key,value]of Object.entries({session:{version:7,id:'shop-net-test',checkboxUndo:{}},stock:!essential&&pantryUsed?{[stockKey]:pantryUsed}:{},inventory:essential?{}:inventory,receipts:{},ticks:{},purchases:{},choices:{},partials:{},features:{version:1,essentials:essential?[{id:'cleaner',name,unit,targetQty:required,ownedQty:pantryUsed,qty:toBuy,selected:true}]:[]},basketboss_cloud_session_v1:{user:{id:'tester'}}}))storage.setItem(key,JSON.stringify(value));
 const win={BBPantryNormalize:normalizePantryState,BBPantryPolicy:require('../bb-pantry-policy.js'),BBShopOwnership:ownership,BBReceiptQuantity:quantity,BBReducedPurchases:require('../bb-reduced-purchases.js'),BBReducedFoodHost:{isPremium:()=>false},BBHome:{actor:()=> 'tester',shoppingBuys:()=>[],completionChanges:()=>({}),purchaseAmounts:home.purchaseAmounts},BBHomeHost:{reload(){}},localStorage:storage};
 const ctx=vm.createContext({...keys,window:win,localStorage:storage,console:{error(){},warn(){}},BBPriceV19:{canonical:value=>value.toLowerCase(),formatQuantity:(quantity,unit)=>quantity+' '+unit},BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,pantryName:name=>name.toLowerCase(),normaliseStock:copy},bb307Market:'UK',bb307Stock:read('stock'),bb307FeatureState:read('features'),
  bb83ReadObject:read,bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),bbBetaPurchaseChoices:()=>read('choices'),bbPartialAll:()=>read('partials'),bbShopV7Session:()=>read('session'),bbBetaShopWeek:()=>read('session').id,bbBetaReceiptRead:()=>read('receipts'),bbBetaReceiptId:id=>read('session').id+'|'+id,
  bb172Aisle:()=>essential?'Household & Other':'Meat & Fish',bbBetaDryVolumeUnit:()=>false,bbBetaPackSpec:()=>({size:500,review:false}),bbBetaAutomaticPack:()=>null,bb321TinSpec:()=>null,bb307ReadStock:()=>read('stock'),bb307ReadFeatures:()=>read('features'),bb83StockLoc:()=> 'fridge',bb83KitchenName:name=>name.toLowerCase(),bbHomePhysicalStock:()=>read('stock'),
  bb321WeeklySummary:()=>({items:[basket],essentials:[]}),bb83BoughtCandidates:()=>Object.entries(read('purchases')).filter(([id])=>read('ticks')[id]).map(([id,row])=>({id,...row})),bb307Plan:()=>({items:[]}),render(){},bb172StorefrontRefresh(){},notify(){}});
 for(const name of ['bbShopOwnedExpected','bbShopOwnedChanges','bbShopOwnedSaved','bbShopExactQuantity','bbShopPurchasePack','bbShopNeedPresentation','bbReducedContext','bbReducedPremium','bbReducedProgress','bbShopV7Write','bb84DetailFor','bb84DisplayedPurchase','bb84SavedPurchased','bb84SetPrimaryPurchase','bbBetaReceiptCandidate','bbBetaChoiceInfo','bbBetaChoiceSurplus','bbBetaPendingPartials','bbBetaPendingBought','bbBetaIsPerishable','bbPartialRound','bbPartialKey','bbPartialDetails','bbPartialSet','bbHomePendingHouseholdPurchases','bb83TransferBought'])vm.runInContext(actual(name),ctx);
 return {values,read,storage,ctx,basket,item,id,check:on=>ctx.bb84SetPrimaryPurchase(id,on,basket,essential,{inventoryNow:immediate}),amount:total=>ctx.bbPartialSet({...item,checked:!!read('ticks')[id]},total,undefined,{inventoryNow:immediate}),finish:()=>copy(ctx.bb83TransferBought())};
}


// These are the real purchase handlers and transaction/transfer functions. The
// entered unit needs six decimals to retain the supported three canonical
// purchase decimals. Existing derived pantry precision is not changed.
const cases=[
 ['g',.001,.001,'g'],['kg',.333333,333.333,'g'],['kg',.000001,.001,'g'],
 ['ml',.001,.001,'ml'],['l',.500001,500.001,'ml'],['l',.000001,.001,'ml']
];
for(const immediate of [false,true])for(const [unit,total,canonical,base]of cases)test((immediate?'immediate':'Finish')+' partial '+total+' '+unit+' credits exactly '+canonical+' '+base,()=>{
 const name=base==='g'?'Rice':'Milk',h=fixture({name,unit,required:1,pantryUsed:0,toBuy:1,quote:null,immediate}),stockKey=name.toLowerCase()+'|'+base;
 assert.equal(h.amount(total),true);
 const saved=h.read('partials')['shop-net-test|'+h.id];assert.equal(saved.bought,total);assert.equal(saved.unit,unit);
 const status=h.ctx.bbPartialDetails(h.item);assert.equal(status.bought,total);assert.equal(status.remaining,h.ctx.bbPartialRound(1-total,unit));
 if(immediate){assert.equal(h.read('stock')[stockKey],canonical);assert.equal(h.finish().count,0);}
 else{assert.deepEqual(h.read('stock'),{});assert.equal(h.finish().count,1);}
 assert.equal(h.read('stock')[stockKey],canonical);assert.equal(h.finish().count,0);assert.equal(h.read('stock')[stockKey],canonical);
 const row=Object.values(h.read('inventory')).find(row=>row.bb173StockKey===stockKey);assert.ok(row);assert.equal(row.qty,canonical);
});

test('repeated exact partial corrections replace the deposit, remain exact after serialization and undo to the original stock',()=>{
 const h=fixture({name:'Rice',unit:'kg',required:1,pantryUsed:0,toBuy:1,quote:null});
 for(const total of [.333333,.333333,.333334,.000001,.333334]){
  assert.equal(h.amount(total),true);assert.equal(h.read('stock')['rice|g'],Math.round(total*1000000)/1000);
  assert.equal(h.read('partials')['shop-net-test|'+h.id].bought,total);
  const session=h.read('session');h.storage.setItem('session',JSON.stringify(session));
  assert.equal(h.read('session').shelfEdits[h.id].amount,total);assert.equal(h.finish().count,0);
 }
 assert.equal(h.amount(0),true);assert.deepEqual(h.read('stock'),{});assert.deepEqual(h.read('partials'),{});assert.deepEqual(h.read('receipts'),{});
});

for(const unit of ['ml','l'])test('household '+unit+' partial purchases preserve the canonical purchase precision and allow an exact zero undo',()=>{
 const amount=unit==='l'?.000001:.001,h=fixture({name:'Kitchen cleaner',unit,required:1,pantryUsed:0,toBuy:1,quote:null,essential:true});
 assert.equal(h.amount(amount),true);assert.equal(h.read('features').essentials[0].ownedQty,amount);assert.deepEqual(h.read('stock'),{});
 assert.equal(h.amount(amount),true);assert.equal(h.read('features').essentials[0].ownedQty,amount);assert.equal(h.finish().count,0);
 assert.equal(h.amount(0),true);assert.equal(h.read('features').essentials[0].ownedQty,0);assert.deepEqual(h.read('stock'),{});
});

for(const unit of ['bag','tin','bunch','loaf'])test('the existing supported household '+unit+' unit accepts a whole partial purchase and rejects fractional corrections',()=>{
 const h=fixture({name:'Kitchen supplies',unit,required:3,pantryUsed:0,toBuy:3,quote:null,essential:true});
 assert.equal(h.amount(1),true);assert.equal(h.read('features').essentials[0].ownedQty,1);assert.equal(h.read('partials')['shop-net-test|'+h.id].bought,1);assert.deepEqual(h.read('stock'),{});
 const before=new Map(h.values);assert.equal(h.amount(1.5),false);assert.deepEqual(h.values,before);
 assert.equal(h.check(true),true);assert.equal(h.read('features').essentials[0].ownedQty,3);assert.equal(h.finish().count,0);
 assert.equal(h.amount(0),true);assert.equal(h.read('features').essentials[0].ownedQty,0);
});

test('invalid and below-canonical-precision amounts cannot silently overwrite a saved purchase with zero',()=>{
 const h=fixture({name:'Rice',unit:'g',required:1,pantryUsed:0,toBuy:1,quote:null});assert.equal(h.amount(.001),true);
 const before=new Map(h.values);
 for(const value of [-1,NaN,Infinity,1000001,.000001,.123456]){assert.equal(h.amount(value),false);assert.deepEqual(h.values,before);}
});

test('a complete exact kilogram purchase uses the same supported precision and rejects extra digits before changing its ledger',()=>{
 const h=fixture({name:'Rice',unit:'kg',required:.2,pantryUsed:0,toBuy:.2,quote:null});
 assert.equal(h.amount(.333333),true);assert.equal(h.read('purchases')[h.id].actualQty,.333333);assert.equal(h.read('stock')['rice|g'],333.333);
 const before=new Map(h.values);assert.equal(h.amount(.333333001),false);assert.deepEqual(h.values,before);
 assert.equal(h.amount(0),true);assert.deepEqual(h.read('stock'),{});
});

test('purchase amount validation preserves the deployed receipt precision and derived pantry balances',()=>{
 for(const [unit,total,canonical,base]of cases)assert.deepEqual(quantity.measured(total,unit),{quantity:canonical,unit:base});
 for(const unit of ['g','ml','kg','l']){
  const h=fixture({name:unit==='g'||unit==='kg'?'Rice':'Milk',unit,required:1,pantryUsed:0,toBuy:1,quote:null});const before=new Map(h.values);
  for(const value of unit==='kg'||unit==='l'?[.000000001,.333333001]:[.000001,.333333]){assert.equal(h.amount(value),false);assert.deepEqual(h.values,before);}
 }
 const h=fixture({name:'Rice',unit:'g',required:1,pantryUsed:0,toBuy:1,quote:null});h.storage.setItem('stock',JSON.stringify({'spinach|g':.000001}));
 assert.equal(h.amount(.001),true);assert.equal(h.read('stock')['spinach|g'],.000001);assert.equal(h.read('stock')['rice|g'],.001);
 assert.equal(h.amount(0),true);assert.equal(h.read('stock')['spinach|g'],.000001);
});
