import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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
function fixture({name='Pork sausages',unit='each',required=6,pantryUsed=5,toBuy=1,quote={packQty:6,packUnit:'each',packCount:1},pantryName=name,buyMultiple,buyMultipleUnit=unit,essential=false}={}){
 const values=new Map(),read=key=>JSON.parse(values.get(key)||'{}'),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const id=essential?'ess:cleaner':name.toLowerCase()+'|'+unit,stockKey=pantryName.toLowerCase()+'|'+unit;
 const basket={key:name,name,unit,required,pantryUsed,toBuy,qty:toBuy,priceQuote:quote,...(buyMultiple===undefined?{}:{buyMultiple,buyMultipleUnit})},item={id,name,unit,aisle:'Meat & Fish',checked:false,basketItem:basket};
 const inventory=pantryUsed?{['fridge|'+pantryName.toLowerCase()]:{name:pantryName,loc:'fridge',selected:true,qty:pantryUsed,unit,bb173StockKey:stockKey,bb173StockValue:pantryUsed}}:{};
 for(const [key,value]of Object.entries({session:{version:7,id:'shop-net-test',checkboxUndo:{}},stock:!essential&&pantryUsed?{[stockKey]:pantryUsed}:{},inventory:essential?{}:inventory,receipts:{},ticks:{},purchases:{},choices:{},partials:{},features:{version:1,essentials:essential?[{id:'cleaner',name,unit,targetQty:required,ownedQty:pantryUsed,qty:toBuy,selected:true}]:[]},basketboss_cloud_session_v1:{user:{id:'tester'}}}))storage.setItem(key,JSON.stringify(value));
 const win={BBShopOwnership:ownership,BBReceiptQuantity:quantity,BBReducedPurchases:require('../bb-reduced-purchases.js'),BBReducedFoodHost:{isPremium:()=>false},BBHome:{actor:()=> 'tester',shoppingBuys:()=>[],completionChanges:()=>({}),purchaseAmounts:home.purchaseAmounts},BBHomeHost:{reload(){}},localStorage:storage};
 const ctx=vm.createContext({...keys,window:win,localStorage:storage,console:{error(){},warn(){}},BBPriceV19:{canonical:value=>value.toLowerCase(),formatQuantity:(quantity,unit)=>quantity+' '+unit},BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,pantryName:name=>name.toLowerCase(),normaliseStock:copy},bb307Market:'UK',bb307Stock:read('stock'),bb307FeatureState:read('features'),
  bb83ReadObject:read,bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),bbBetaPurchaseChoices:()=>read('choices'),bbPartialAll:()=>read('partials'),bbShopV7Session:()=>read('session'),bbBetaShopWeek:()=>read('session').id,bbBetaReceiptRead:()=>read('receipts'),bbBetaReceiptId:id=>read('session').id+'|'+id,
  bb172Aisle:()=>essential?'Household & Other':'Meat & Fish',bbBetaDryVolumeUnit:()=>false,bbBetaPackSpec:()=>({size:500,review:false}),bbBetaAutomaticPack:()=>null,bb321TinSpec:()=>null,bb307ReadStock:()=>read('stock'),bb307ReadFeatures:()=>read('features'),bb83StockLoc:()=> 'fridge',bb83KitchenName:name=>name.toLowerCase(),bbHomePhysicalStock:()=>read('stock'),
  bb321WeeklySummary:()=>({items:[basket],essentials:[]}),bb83BoughtCandidates:()=>Object.entries(read('purchases')).filter(([id])=>read('ticks')[id]).map(([id,row])=>({id,...row})),bb307Plan:()=>({items:[]}),render(){},bb172StorefrontRefresh(){},notify(){}});
 for(const name of ['bbShopOwnedExpected','bbShopOwnedChanges','bbShopOwnedSaved','bbShopExactQuantity','bbShopPurchasePack','bbShopNeedPresentation','bbReducedContext','bbReducedPremium','bbReducedProgress','bbShopV7Write','bb84DetailFor','bb84DisplayedPurchase','bb84SavedPurchased','bb84SetPrimaryPurchase','bbBetaReceiptCandidate','bbBetaChoiceInfo','bbBetaChoiceSurplus','bbBetaPendingPartials','bbBetaPendingBought','bbBetaIsPerishable','bbPartialRound','bbPartialKey','bbPartialDetails','bbPartialSet','bbHomePendingHouseholdPurchases','bb83TransferBought'])vm.runInContext(actual(name),ctx);
 return {values,read,storage,ctx,basket,item,id,check:on=>ctx.bb84SetPrimaryPurchase(id,on,basket,essential,{inventoryNow:true}),amount:total=>ctx.bbPartialSet({...item,checked:!!read('ticks')[id]},total,undefined,{inventoryNow:true}),finish:()=>copy(ctx.bb83TransferBought())};
}

test('the immediate release credits the physical pack once and keeps an anchor through reload',()=>{
 const h=fixture();assert.equal(h.check(true),true);assert.equal(h.read('stock')['pork sausages|each'],11);
 assert.equal(h.read('purchases')[h.id].qty,1);assert.equal(h.read('purchases')[h.id].actualQty,6);
 assert.equal(h.finish().count,0);assert.equal(h.check(true),true);assert.equal(h.read('stock')['pork sausages|each'],11);
 const session=h.read('session'),rows=ownership.anchor([{...h.basket,toBuy:0,pantryUsed:6}],session,{idFor:row=>row.key.toLowerCase()+'|'+row.unit});
 assert.equal(rows.length,1);assert.equal(rows[0].toBuy,1);assert.equal(rows[0].pantryUsed,5);assert.equal(rows[0].shopOwnedAnchor,true);
 const presentation=h.ctx.bbShopNeedPresentation(rows[0],{bought:6,checked:true});assert.equal(presentation.needed,0);assert.equal(presentation.targetQuantity,1);
});
test('untick and re-tick reverse only this trip contribution without adding it twice',()=>{
 const h=fixture();assert.equal(h.check(true),true);assert.equal(h.check(false),true);assert.equal(h.read('stock')['pork sausages|each'],5);
 assert.equal(h.read('receipts')['shop-net-test|'+h.id],undefined);assert.equal(h.check(true),true);assert.equal(h.read('stock')['pork sausages|each'],11);assert.equal(h.finish().count,0);
});
test('a bought amount edit replaces its previous deposit and zero restores the original pantry',()=>{
 const h=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:500,packUnit:'g'}});
 assert.equal(h.check(true),true);assert.equal(h.read('stock')['rice|g'],850);
 assert.equal(h.amount(150),true);assert.equal(h.read('stock')['rice|g'],500);assert.equal(h.read('purchases')[h.id].actualQty,150);
 assert.equal(h.amount(50),true);assert.equal(h.read('stock')['rice|g'],400);assert.equal(h.read('partials')['shop-net-test|'+h.id].bought,50);
 assert.equal(h.amount(0),true);assert.equal(h.read('stock')['rice|g'],350);assert.equal(h.read('receipts')['shop-net-test|'+h.id],undefined);
});
test('the exact partial is owned immediately and restored after undoing a pack completion',()=>{
 const h=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:500,packUnit:'g'}});
 assert.equal(h.amount(50),true);assert.equal(h.read('stock')['rice|g'],400);assert.equal(h.finish().count,0);
 assert.equal(h.check(true),true);assert.equal(h.read('stock')['rice|g'],900);assert.equal(h.read('purchases')[h.id].actualQty,550);
 assert.equal(h.check(false),true);assert.equal(h.read('stock')['rice|g'],400);assert.equal(h.read('partials')['shop-net-test|'+h.id].bought,50);
});
test('a later stock consumption or edited receipt prevents replay and correction',()=>{
 const h=fixture();assert.equal(h.check(true),true);h.storage.setItem('stock',JSON.stringify({'pork sausages|each':10}));const before=new Map(h.values);
 assert.equal(h.check(false),false);assert.deepEqual(h.values,before);assert.equal(h.amount(1),false);assert.deepEqual(h.values,before);
});
test('unrelated pantry entries survive correction while a failed owned write rolls everything back',()=>{
 const h=fixture();assert.equal(h.check(true),true);h.storage.setItem('stock',JSON.stringify({...h.read('stock'),'milk|ml':750}));h.storage.setItem('inventory',JSON.stringify({...h.read('inventory'),milk:{name:'Milk',qty:750,unit:'ml'}}));
 assert.equal(h.check(false),true);assert.equal(h.read('stock')['milk|ml'],750);assert.equal(h.read('inventory').milk.qty,750);
 const before=new Map(h.values),write=h.storage.setItem;let fail=true;h.storage.setItem=(key,value)=>{if(key==='inventory'&&fail){fail=false;throw Error('quota');}write(key,value);};assert.equal(h.check(true),false);assert.deepEqual(h.values,before);
});
test('a linked receipt nets against the immediate purchase credit',async()=>{
 const h=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:500,packUnit:'g'}});assert.equal(h.check(true),true);
 const {computeReceiptCredit}=await import('../bb-receipt-inventory-core.mjs');const credit=computeReceiptCredit({canonicalKey:'rice',quantity:500,unit:'g'},h.read('receipts'),{shopSessionId:'shop-net-test',receiptId:'receipt-test'});
 assert.equal(credit.addedQuantity,0);assert.equal(credit.priorCreditedQuantity,500);assert.equal(h.finish().count,0);
});
test('the pending online stock update is committed atomically with the purchase',()=>{
 const h=fixture();let retried=0;
 h.ctx.window.BBReceiptHost={preparePurchasedPantry:({stock,beforeStock,shopSessionId})=>({updates:{outbox:{stock,beforeStock,shopSessionId}},expected:{outbox:null}}),retryPurchasedPantry(){retried++;return Promise.resolve({ok:true});}};
 assert.equal(h.check(true),true);assert.equal(h.read('outbox').stock['pork sausages|each'],11);assert.equal(h.read('outbox').beforeStock['pork sausages|each'],5);assert.equal(retried,1);
});

test('household targets and exact corrections credit the existing balance once',()=>{
 const h=fixture({name:'Kitchen cleaner',unit:'ml',required:1000,pantryUsed:625,toBuy:375,quote:{packQty:500,packUnit:'ml'},essential:true});
 assert.equal(h.check(true),true);assert.equal(h.read('features').essentials[0].ownedQty,1125);assert.deepEqual(h.read('stock'),{});assert.equal(h.finish().count,0);
 assert.equal(h.amount(125),true);assert.equal(h.read('features').essentials[0].ownedQty,750);assert.equal(h.read('partials')['shop-net-test|'+h.id].bought,125);
 assert.equal(h.amount(375),true);assert.equal(h.read('features').essentials[0].ownedQty,1000);assert.equal(h.amount(0),true);assert.equal(h.read('features').essentials[0].ownedQty,625);
});
test('an untouched household target remains visible as a checked row until the trip closes',()=>{
 const h=fixture({name:'Kitchen cleaner',unit:'ml',required:1000,pantryUsed:625,toBuy:375,quote:{packQty:500,packUnit:'ml'},essential:true});assert.equal(h.check(true),true);
 const rows=ownership.anchor([],h.read('session'),{essential:true,idFor:row=>'ess:'+row.id});assert.equal(rows.length,1);assert.equal(rows[0].qty,375);
 const view=h.ctx.bbShopNeedPresentation(rows[0],{bought:500,checked:true});assert.equal(view.needed,0);assert.equal(view.targetQuantity,375);
});
test('linked receipt coverage makes a later amount correction fail without undoing that receipt',()=>{
 const h=fixture();assert.equal(h.check(true),true);const receiptId='shop-net-test|'+h.id,receipts=h.read('receipts');receipts[receiptId].receiptInventoryReceiptId='reviewed-receipt';h.storage.setItem('receipts',JSON.stringify(receipts));const before=new Map(h.values);
 assert.equal(h.amount(1),false);assert.deepEqual(h.values,before);assert.equal(h.check(false),false);assert.deepEqual(h.values,before);
});

test('direct manual top-ups are fulfilled by the owned deposit and restored by its undo',()=>{
 const h=fixture({name:'Rice',unit:'g',required:16,pantryUsed:10,toBuy:6,quote:null}),win=h.ctx.window;
 win.location={search:''};win.document={getElementById(){return null;}};
 win.BBHomeHost={id:(name,unit)=>name.toLowerCase()+'|'+unit,keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>h.read('stock'),household:()=>[],shoppingKind:()=> 'food',shoppingPurchaseContext:()=>({shopSessionId:'shop-net-test',quantity:0}),refresh(){},reload(){}};
 win.BBHome=home.install(win);
 h.ctx.bb321UnifiedShop=()=>[{key:'Rice',unit:'g',required:12,pantryUsed:Math.min(12,h.read('stock')['rice|g']),toBuy:Math.max(0,12-h.read('stock')['rice|g'])}];
 assert.equal(win.BBHome.addShoppingBuy({name:'Rice',quantityText:'4 g',requestId:'manual-four',actorId:'tester'}).ok,true);
 assert.equal(win.BBHome.shoppingBuys()[0].quantity,4);assert.equal(h.check(true),true);assert.equal(h.read('stock')['rice|g'],16);assert.equal(win.BBHome.shoppingBuys().length,0);
 assert.equal(h.check(false),true);assert.equal(h.read('stock')['rice|g'],10);assert.equal(win.BBHome.shoppingBuys()[0].quantity,4);
 assert.equal(h.amount(3),true);assert.equal(h.read('stock')['rice|g'],13);assert.equal(win.BBHome.shoppingBuys()[0].quantity,3);
 assert.equal(h.amount(5),true);assert.equal(h.read('stock')['rice|g'],15);assert.equal(win.BBHome.shoppingBuys()[0].quantity,1);
});

test('different display units keep their exact existing transfer behavior',()=>{
 const h=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:.5,packUnit:'kg'}});
 const inventory=h.read('inventory'),row=Object.values(inventory)[0];row.unit='kg';row.qty=.35;h.storage.setItem('inventory',JSON.stringify(inventory));
 assert.equal(h.check(true),true);assert.equal(h.read('stock')['rice|g'],850);assert.equal(Object.values(h.read('inventory'))[0].unit,'kg');assert.equal(Object.values(h.read('inventory'))[0].qty,.85);
 assert.equal(h.amount(150),true);assert.equal(h.read('stock')['rice|g'],500);assert.equal(Object.values(h.read('inventory'))[0].unit,'kg');assert.equal(Object.values(h.read('inventory'))[0].qty,.5);
});

function settledChickenPurchase(){
 const h=fixture({name:'Chicken breast',unit:'g',required:666.666667,pantryUsed:0,toBuy:666.666667,quote:null});
 assert.equal(h.amount(1200),true);assert.equal(h.read('stock')['chicken breast|g'],1200);
 const priorSession=h.read('session'),originalReceipt=h.read('receipts')['shop-net-test|'+h.id],originalMarker=copy(priorSession.shelfEdits[h.id]);
 // This is the boundary after confirmed cooking: current purchase progress
 // has been settled, while its retained receipt/marker proves the old deposit.
 for(const key of ['ticks','purchases','partials','choices'])h.storage.setItem(key,'{}');
 h.storage.setItem('session',JSON.stringify({...priorSession,bought:{},purchases:{},partials:{},choices:{},checkboxUndo:{}}));
 h.storage.setItem('stock',JSON.stringify({'chicken breast|g':533.333333}));
 h.storage.setItem('inventory',JSON.stringify({'fridge|chicken breast':{name:'Chicken breast',loc:'fridge',selected:true,qty:533.333333,unit:'g',bb173StockKey:'chicken breast|g',bb173StockValue:533.333333}}));
 h.ctx.bbBetaReceiptId=id=>'shop-net-test|'+id+'|home:1';
 h.ctx.bbShopV7Snapshot=session=>({...session,bought:h.read('ticks'),purchases:h.read('purchases'),partials:h.read('partials'),choices:h.read('choices')});
 Object.assign(h.basket,{required:600,pantryUsed:533.333333,toBuy:66.666667,qty:66.666667});
 return {...h,originalReceipt,originalMarker};
}

test('a settled earlier-generation marker permits one new purchase without replaying its consumed deposit',()=>{
 const h=settledChickenPurchase(),oldReceiptId='shop-net-test|'+h.id,newReceiptId=oldReceiptId+'|home:1';
 assert.equal(ownership.active(h.originalMarker,h.id,h.ctx.bbShopV7Snapshot(h.read('session'))),false);
 assert.equal(h.amount(67),true);assert.equal(h.read('stock')['chicken breast|g'],600.333333);
 assert.equal(h.read('session').shelfEdits[h.id].receiptId,newReceiptId);assert.equal(h.read('purchases')[h.id].actualQty,67);
 assert.ok(h.read('receipts')[newReceiptId]);assert.ok(h.read('receipts')[oldReceiptId],'the previous receipt remains a durable replay proof');
 // Repeat the selected physical amount. The bare legacy checkbox fixture has
 // no Buying adapter and intentionally re-infers the exact recipe shortfall.
 assert.equal(h.amount(67),true);assert.equal(h.finish().count,0);assert.equal(h.read('stock')['chicken breast|g'],600.333333,'repeated completion cannot add another 67 g');
 assert.equal(h.check(false),true);assert.equal(h.read('stock')['chicken breast|g'],533.333333);
 assert.deepEqual(h.read('receipts')[oldReceiptId],h.originalReceipt);assert.equal(h.read('receipts')[newReceiptId],undefined);
 assert.equal(h.amount(67),true);assert.equal(h.read('stock')['chicken breast|g'],600.333333);
});

for(const mode of ['active','other actor','missing activity API','throwing activity API','unknown activity','missing snapshot'])test('a '+mode+' earlier-generation marker is rejected before any purchase writes',()=>{
 const h=settledChickenPurchase();
 if(mode==='active')h.storage.setItem('purchases',JSON.stringify({[h.id]:{qty:1200,name:'Chicken breast',unit:'g'}}));
 if(mode==='other actor'){const session=h.read('session');session.shelfEdits[h.id].actor='another-person';h.storage.setItem('session',JSON.stringify(session));}
 if(mode==='missing activity API'){const {active,...api}=ownership;h.ctx.window.BBShopOwnership=api;}
 if(mode==='throwing activity API')h.ctx.window.BBShopOwnership={...ownership,active(){throw Error('Purchase activity unavailable');}};
 if(mode==='unknown activity')h.ctx.window.BBShopOwnership={...ownership,active(){return undefined;}};
 if(mode==='missing snapshot')delete h.ctx.bbShopV7Snapshot;
 const before=new Map(h.values),session=h.read('session'),purchase={qty:67,actualQty:67,name:'Chicken breast',unit:'g'};
 const updates={session:{...session,bought:{[h.id]:true},purchases:{[h.id]:purchase}},ticks:{[h.id]:true},purchases:{[h.id]:purchase},partials:{},choices:{}};
 assert.throws(()=>h.ctx.bbShopOwnedChanges(h.id,updates,h.basket,false),/purchase|activity/i);
 assert.deepEqual(h.values,before,'neither stock, progress nor replay history may change');
});
