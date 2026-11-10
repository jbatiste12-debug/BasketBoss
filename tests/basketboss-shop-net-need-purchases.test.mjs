import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),quantity=require('../bb-receipt-quantity.js'),home=require('../bb-home.js');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function actual(name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);
 const lineEnd=html.indexOf('\n',start);if(html.slice(start,lineEnd).endsWith('}'))return html.slice(start,lineEnd);
 const end=html.indexOf('\n}',start);assert.ok(end>start,name);return html.slice(start,end+2);
}
const copy=value=>JSON.parse(JSON.stringify(value));
const keys={BB83_KITCHEN_INVENTORY:'inventory',BB307_STOCK_KEY:'stock',BB83_SHOP_STOCK_LEDGER:'legacy',BB_BETA_RECEIPT_KEY:'receipts',BB_BETA_CHOICE_KEY:'choices',BB_PARTIAL_PURCHASE_KEY:'partials',BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_SHOP_SESSION_V7_KEY:'session',BB307_FEATURE_KEY:'features'};
function fixture({name='Pork sausages',unit='each',required=6,pantryUsed=5,toBuy=1,quote={packQty:6,packUnit:'each',packCount:1},pantryName=name,buyMultiple,buyMultipleUnit=unit}={}){
 const values=new Map(),read=key=>JSON.parse(values.get(key)||'{}'),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const id=name.toLowerCase()+'|'+unit,stockKey=pantryName.toLowerCase()+'|'+unit;
 const basket={key:name,name,unit,required,pantryUsed,toBuy,priceQuote:quote,...(buyMultiple===undefined?{}:{buyMultiple,buyMultipleUnit})},item={id,name,unit,aisle:'Meat & Fish',checked:false,basketItem:basket};
 const inventory=pantryUsed?{['fridge|'+pantryName.toLowerCase()]:{name:pantryName,loc:'fridge',selected:true,qty:pantryUsed,unit,bb173StockKey:stockKey,bb173StockValue:pantryUsed}}:{};
 for(const [key,value]of Object.entries({session:{version:7,id:'shop-net-test',checkboxUndo:{}},stock:pantryUsed?{[stockKey]:pantryUsed}:{},inventory,receipts:{},ticks:{},purchases:{},choices:{},partials:{},features:{version:1,essentials:[]},basketboss_cloud_session_v1:{user:{id:'tester'}}}))storage.setItem(key,JSON.stringify(value));
 const win={BBReceiptQuantity:quantity,BBReducedPurchases:require('../bb-reduced-purchases.js'),BBReducedFoodHost:{isPremium:()=>false},BBHome:{actor:()=> 'tester',shoppingBuys:()=>[],completionChanges:()=>({}),purchaseAmounts:home.purchaseAmounts},BBHomeHost:{reload(){}},localStorage:storage};
 const ctx=vm.createContext({...keys,window:win,localStorage:storage,console:{error(){},warn(){}},BBPriceV19:{canonical:value=>value.toLowerCase(),formatQuantity:(quantity,unit)=>quantity+' '+unit},BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,pantryName:name=>name.toLowerCase(),normaliseStock:copy},bb307Market:'UK',bb307Stock:read('stock'),bb307FeatureState:read('features'),
  bb83ReadObject:read,bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),bbBetaPurchaseChoices:()=>read('choices'),bbPartialAll:()=>read('partials'),bbShopV7Session:()=>read('session'),bbBetaShopWeek:()=>read('session').id,bbBetaReceiptRead:()=>read('receipts'),bbBetaReceiptId:id=>read('session').id+'|'+id,
  bb172Aisle:()=> 'Meat & Fish',bbBetaDryVolumeUnit:()=>false,bbBetaPackSpec:()=>({size:500,review:false}),bbBetaAutomaticPack:()=>null,bb321TinSpec:()=>null,bb307ReadStock:()=>read('stock'),bb307ReadFeatures:()=>read('features'),bb83StockLoc:()=> 'fridge',bb83KitchenName:name=>name.toLowerCase(),bbHomePhysicalStock:()=>read('stock'),
  bb321WeeklySummary:()=>({items:[basket],essentials:[]}),bb83BoughtCandidates:()=>Object.entries(read('purchases')).filter(([id])=>read('ticks')[id]).map(([id,row])=>({id,...row})),bb307Plan:()=>({items:[]}),render(){},bb172StorefrontRefresh(){},notify(){}});
 for(const name of ['bbShopExactQuantity','bbShopPurchasePack','bbShopNeedPresentation','bbReducedContext','bbReducedPremium','bbReducedProgress','bbShopV7Write','bb84DetailFor','bb84DisplayedPurchase','bb84SavedPurchased','bb84SetPrimaryPurchase','bbBetaReceiptCandidate','bbBetaChoiceInfo','bbBetaChoiceSurplus','bbBetaPendingPartials','bbBetaPendingBought','bbBetaIsPerishable','bbPartialRound','bbPartialKey','bbPartialDetails','bbPartialSet','bbHomePendingHouseholdPurchases','bb83TransferBought'])vm.runInContext(actual(name),ctx);
 return {values,read,storage,ctx,basket,item,id,check:on=>ctx.bb84SetPrimaryPurchase(id,on,basket,false),amount:total=>ctx.bbPartialSet({...item,checked:!!read('ticks')[id]},total),finish:()=>copy(ctx.bb83TransferBought())};
}

test('the one-sausage shortfall buys the shown six-pack while Finish deposits all six exactly once',()=>{
 const h=fixture({pantryName:'Sausages'}),before=copy(h.read('stock'));
 const original=copy(h.basket),presentation=h.ctx.bbShopNeedPresentation(h.basket);
 assert.equal(presentation.required,6);assert.equal(presentation.atHome,5);assert.equal(presentation.needed,1);assert.equal(presentation.primary,'1 needed');assert.equal(presentation.secondary,'Have 5 at home (of 6) • Buy 1 pack (6 pk)');assert.equal(presentation.purchaseQuantity,6);assert.deepEqual(h.basket,original,'presentation does not rewrite the purchase target');
 assert.equal(h.basket.required-h.basket.pantryUsed,1);assert.equal(h.check(true),true);
 const purchase=h.read('purchases')[h.id];assert.equal(purchase.qty,1);assert.equal(purchase.actualQty,6);assert.equal(h.read('choices')[h.id].actualQty,6);assert.deepEqual(h.read('stock'),before,'checking a purchase does not pre-credit stock');
 assert.equal(h.finish().count,1);assert.deepEqual(h.read('stock'),{'sausages|each':5,'pork sausages|each':6});
 assert.equal(h.finish().count,0);assert.deepEqual(h.read('stock'),{'sausages|each':5,'pork sausages|each':6});assert.equal(h.basket.toBuy,1);assert.equal(h.basket.required,6);
});

test('a weight shortfall keeps its 150g target while buying the shown 500g pack',()=>{
 const h=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:500,packUnit:'g',packCount:1}});
 const presentation=h.ctx.bbShopNeedPresentation(h.basket);assert.equal(presentation.needed,150);assert.equal(presentation.primary,'150 g needed');assert.match(presentation.secondary,/Have 350 g at home \(of 500 g\)/);assert.match(presentation.secondary,/Buy 1 pack \(500 g\)/);
 assert.equal(h.check(true),true);assert.equal(h.read('purchases')[h.id].qty,150);assert.equal(h.read('purchases')[h.id].actualQty,500);
 assert.equal(h.finish().count,1);assert.equal(h.read('stock')['rice|g'],850);assert.equal(h.finish().count,0);assert.equal(h.read('stock')['rice|g'],850);assert.equal(h.basket.toBuy,150);
});

test('unticking a default pack restores the exact prior partial instead of its rounded purchase total',()=>{
 const h=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:500,packUnit:'g',packCount:1}});
 assert.equal(h.amount(50),true);const presentation=h.ctx.bbShopNeedPresentation(h.basket,{bought:50});assert.equal(presentation.needed,100);assert.equal(presentation.primary,'100 g more needed');assert.equal(presentation.purchaseQuantity,500);
 assert.equal(h.check(true),true);assert.equal(h.read('purchases')[h.id].qty,150);assert.equal(h.read('purchases')[h.id].actualQty,550,'the existing 50g purchase is retained before one further 500g pack');
 assert.equal(h.check(false),true);assert.equal(h.read('purchases')[h.id],undefined);assert.equal(h.read('ticks')[h.id],undefined);assert.equal(h.read('partials')['shop-net-test|'+h.id].bought,50);
 assert.equal(h.finish().count,1);assert.equal(h.read('stock')['rice|g'],400,'only the still-recorded 50g partial is deposited');assert.equal(h.finish().count,0);
});

test('entering an exact bought amount stays exact even when the default suggestion is a larger pack',()=>{
 const h=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:500,packUnit:'g',packCount:1}});
 assert.equal(h.amount(150),true);assert.equal(h.read('purchases')[h.id].qty,150);assert.equal(h.read('purchases')[h.id].actualQty,150);assert.equal(h.finish().count,1);assert.equal(h.read('stock')['rice|g'],500);assert.equal(h.finish().count,0);
});

test('a saved purchase multiple overrides the catalogue pack and no cross-dimension pack conversion is invented',()=>{
 const chosen=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,buyMultiple:250,quote:{packQty:500,packUnit:'g',packCount:1}});
 assert.equal(chosen.check(true),true);assert.equal(chosen.read('purchases')[chosen.id].actualQty,250);
 const mismatched=fixture({quote:{packQty:400,packUnit:'g',packCount:1}});assert.equal(mismatched.check(true),true);assert.equal(mismatched.read('purchases')[mismatched.id].actualQty,1,'grams are not assumed to describe a number of sausages');
});

test('an exact metric pack conversion is permitted and a stale quote pack count is recalculated for the current shortfall',()=>{
 const metric=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:.5,packUnit:'kg',packCount:99}});assert.equal(metric.check(true),true);assert.equal(metric.read('purchases')[metric.id].actualQty,500);
 const counted=fixture({quote:{packQty:6,packUnit:'each',packCount:2}});assert.equal(counted.check(true),true);assert.equal(counted.read('purchases')[counted.id].actualQty,6,'the old quoted pack count cannot cause a second pack to be bought');
});

test('presentation subtracts actual bought quantities once and retains deliberate manual top-up demand',()=>{
 const h=fixture(),manual={...h.basket,required:9,toBuy:4,manualBuyQty:3};
 const extra=h.ctx.bbShopNeedPresentation(manual);assert.equal(extra.needed,4,'manual top-up is already included in required');assert.equal(extra.primary,'4 needed');
 const rounded={key:'Rice',unit:'g',required:300,pantryUsed:0,toBuy:700,recordedPurchaseFloor:200,rawAutomaticPurchaseDemand:300,buyMultiple:500,buyMultipleUnit:'g'};
 for(const bought of [0,200]){const view=h.ctx.bbShopNeedPresentation(rounded,{bought});assert.equal(view.needed,100,'the recorded floor and actual partial describe the same 200g');assert.equal(view.primary,'100 g more needed');assert.equal(view.purchaseQuantity,500);}
 const checked=h.ctx.bbShopNeedPresentation(h.basket,{bought:6,checked:true});assert.equal(checked.needed,0);assert.equal(checked.bought,6);assert.match(checked.secondary,/Bought 6/);
 assert.deepEqual(rounded,{key:'Rice',unit:'g',required:300,pantryUsed:0,toBuy:700,recordedPurchaseFloor:200,rawAutomaticPurchaseDemand:300,buyMultiple:500,buyMultipleUnit:'g'});
});

test('fallback tin, loaf and whole-item hints agree with the quantity Bought records',()=>{
 for(const [name,unit,needed,actualBought,hint] of [['Chopped tomatoes','g',150,400,'Buy 1 tin (400 g)'],['Bread','each',3,18,'Buy 1 loaf (18 slices)'],['Carrot','each',0.5,1,'Buy 1']]){
  const h=fixture({name,unit,required:needed,pantryUsed:0,toBuy:needed,quote:null});vm.runInContext(actual('bb321TinSpec'),h.ctx);
  const view=h.ctx.bbShopNeedPresentation(h.basket);assert.equal(view.primary,needed+(unit==='g'?' g':'')+' needed');assert.ok(view.secondary.endsWith(hint),view.secondary);assert.equal(view.purchaseQuantity,actualBought);
  const before=[...h.values];h.ctx.bbShopNeedPresentation(h.basket);assert.deepEqual([...h.values],before,'rendering the hint cannot write purchase or stock state');
  assert.equal(h.check(true),true);assert.equal(h.read('purchases')[h.id].qty,needed);assert.equal(h.read('purchases')[h.id].actualQty,actualBought);
 }
});

test('missing requirements use known net demand and an unknown amount is never presented as zero',()=>{
 const h=fixture({required:null});const view=h.ctx.bbShopNeedPresentation(h.basket);
 assert.equal(view.needed,1);assert.equal(view.required,6);assert.equal(view.primary,'1 needed');
 for(const required of [null,undefined,'',NaN]){const unknown=h.ctx.bbShopNeedPresentation({key:'Rice',unit:'g',required});assert.equal(unknown.needed,null);assert.equal(unknown.primary,'Check quantity');assert.doesNotMatch(unknown.secondary,/0.*needed/);}
});

test('weekly essential targets and manual top-ups retain quantities in their shared entered unit',()=>{
 const h=fixture(),essential={name:'Kitchen cleaner',unit:'ml',targetQty:1000,ownedQty:625,qty:375,priceQuote:{packQty:500,packUnit:'ml'}};
 const initial=h.ctx.bbShopNeedPresentation(essential);assert.equal(initial.targetQuantity,375);assert.equal(initial.primary,'375 ml needed');assert.equal(initial.secondary,'Have 625 ml at home (of 1 L) • Buy 1 pack (500 ml)');
 const partial=h.ctx.bbShopNeedPresentation(essential,{bought:125});assert.equal(partial.needed,250);assert.equal(partial.primary,'250 ml more needed');
 const topup=h.ctx.bbShopNeedPresentation({name:'Kitchen cleaner',unit:'ml',qty:750,manualBuyQty:375});assert.equal(topup.needed,750,'the manual top-up has already been added to qty');assert.equal(topup.primary,'750 ml needed');
});

test('rounded shopping totals cannot replace the exact target on a checkbox or exact drawer correction',()=>{
 const h=fixture({toBuy:6}),before=copy(h.basket);assert.equal(h.ctx.bbShopNeedPresentation(h.basket).primary,'1 needed');assert.equal(h.check(true),true);
 assert.equal(h.read('purchases')[h.id].qty,1);assert.equal(h.read('purchases')[h.id].actualQty,6);assert.deepEqual(h.basket,before,'the upstream pack calculation remains unchanged');
 assert.equal(h.check(false),true);assert.equal(h.amount(1),true);assert.equal(h.read('purchases')[h.id].qty,1);assert.equal(h.read('purchases')[h.id].actualQty,1,'an explicitly entered exact amount overrides the default pack');
 h.ctx.bbShopV7Read=h.read;vm.runInContext(actual('bbShopV7Reconcile'),h.ctx);assert.equal(h.ctx.bbShopV7Reconcile([h.basket],[]),true);assert.equal(h.read('ticks')[h.id],true,'reopening the rounded row cannot undo a complete exact purchase');
 assert.equal(h.finish().count,1);assert.equal(h.read('stock')['pork sausages|each'],6);assert.equal(h.finish().count,0);
 const measured=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:500,quote:{packQty:500,packUnit:'g'}});assert.equal(measured.amount(150),true);assert.equal(measured.read('purchases')[measured.id].qty,150);assert.equal(measured.read('purchases')[measured.id].actualQty,150);
});

test('an exact completed purchase creates no phantom extra row or summary demand from a rounded shopping total',()=>{
 const h=fixture({toBuy:6});assert.equal(h.amount(1),true);
 h.ctx.bbShopV7Read=h.read;h.ctx.bb321UnifiedShop=()=>[h.basket];h.ctx.bbReceiptPantryReviewRequired=()=>false;h.ctx.bbReceiptHasAuthoritativePantry=()=>false;h.ctx.bb172AssumesOnHand=()=>false;h.ctx.bb15Quote=item=>item.priceQuote;h.ctx.bb84SeedPreviouslyBought=()=>{};h.ctx.bb321Number=value=>value;delete h.ctx.window.BBReducedPurchases;
 for(const name of ['bb84ExtraNeeded','bb84ExtraRows','bbShopV7Reconcile','bb321WeeklySummary'])vm.runInContext(actual(name),h.ctx);
 const summary=h.ctx.bb321WeeklySummary({items:[h.basket]});assert.equal(summary.extraNeed.length,0);assert.equal(summary.remainingTotal,0);
 let inserted=0;const original={insertAdjacentElement(){inserted++;}},list={querySelectorAll:()=>[{dataset:{bb321Tick:h.id},closest:()=>original}]};
 h.ctx.document={createElement:()=>({})};h.ctx.bb15PriceLabel=()=>'';h.ctx.esc=value=>value;h.ctx.bb80ShoppingQuantity=(_name,value)=>String(value);h.ctx.bb172Title=value=>value;
 h.ctx.bb84ExtraRows({querySelector:()=>list},[h.basket],[],h.read('ticks'),'UK');assert.equal(inserted,0);
 assert.equal(h.finish().count,1);assert.equal(h.read('stock')['pork sausages|each'],6,'an explicit one-item purchase adds only one to the existing five');assert.equal(h.finish().count,0);
});
