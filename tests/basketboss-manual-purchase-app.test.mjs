import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{install}=require('../bb-home.js'),quantity=require('../bb-receipt-quantity.js');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const HOME='basketboss_at_home_requirements_v1',STOCK='stock',FEATURE='features';
const keys={BB307_FEATURE_KEY:FEATURE,BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_CHOICE_KEY:'choices',BB_SHOP_SESSION_V7_KEY:'session',BB_SHOP_ARCHIVE_V7_KEY:'archives',BB_BETA_RECEIPT_KEY:'receipts',BB83_KITCHEN_INVENTORY:'inventory',BB83_SHOP_STOCK_LEDGER:'legacy-ledger',BB307_STOCK_KEY:STOCK};
const copy=value=>JSON.parse(JSON.stringify(value));
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
function fixture({owned=10,required=0,essentials=[],premium=false}={}){
 const values=new Map(),read=key=>JSON.parse(values.get(key)||'{}');
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 for(const [key,value]of Object.entries({stock:{'rice|g':owned},features:{version:1,essentials},inventory:{rice:{name:'Rice',unit:'g',qty:owned,selected:true,loc:'cupboard',bb173StockKey:'rice|g',bb173StockValue:owned}},session:{version:7,id:'trip-one',checkboxUndo:{}},ticks:{},purchases:{},partials:{},choices:{},receipts:{},basketboss_cloud_session_v1:{user:{id:'alice'}}}))storage.setItem(key,JSON.stringify(value));
 const pantry={pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,pantryName:name=>name.toLowerCase(),normaliseStock:copy};
 const win={localStorage:storage,location:{search:''},document:{},BBReceiptQuantity:quantity,BBReducedPurchases:require('../bb-reduced-purchases.js'),BBReducedFoodHost:{isPremium:()=>premium}};
 const context=vm.createContext({...keys,window:win,console,localStorage:storage,BB307Pantry:pantry,BBPriceV19:{canonical:name=>name.toLowerCase()},BB307_SOURCE_RECIPES:[],BB307_NORMALIZED:[],BB321_RESEARCH_QUOTES:{},bb307Market:'UK',bb307FeatureState:read(FEATURE),bb307Stock:read(STOCK),bbReceiptHostReady:false,
  bb307Selections:()=>[],bb307ActiveRetailer:()=> 'Tesco',bb307EstimateBasket:()=>({items:required?[{key:'rice',unit:'g',required}]:[]}),
  bb307ReadStock:()=>read(STOCK),bbHomePlanningStock:copy,bb307Plan:()=>({items:required?[{key:'rice',unit:'g',required}]:[]}),
  bb307ReadFeatures:()=>read(FEATURE),bb83ReadObject:read,bbBetaReceiptRead:()=>read('receipts'),bbBetaShopWeek:()=>read('session').id,bbBetaReceiptId:id=>read('session').id+'|'+id,
  bbPartialAll:()=>read('partials'),bbBetaPurchaseChoices:()=>read('choices'),bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),
  bb172Aisle:item=>/soap|detergent/i.test(item.key)?'Household & Other':'Cupboard / Pantry',bb83StockLoc:()=> 'cupboard',bb83KitchenName:name=>name.toLowerCase(),bbBetaDryVolumeUnit:()=>false,bbBetaIsPerishable:()=>false,
  bbBetaChoiceInfo:item=>({mode:'exact',unit:item.unit,qty:item.qty}),bb84DetailFor:item=>({name:item.key||item.name,unit:item.unit}),
  bbShopV7Session:()=>read('session'),bbShopV7Snapshot:copy,bbShopV7Read:read,bbShopV7New:()=> 'trip-next'});
 vm.runInContext(fs.readFileSync(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8'),context);
 const host={prepareManualPurchase:value=>context.bbReducedPrepareQuickPurchase(value),id:pantry.pantryId,keys:()=>({stock:STOCK,inventory:'inventory'}),stock:()=>read(STOCK),household:()=>context.bb307FeatureState.essentials,shoppingKind:name=>/soap|detergent/i.test(name)?'household':'food',shoppingPurchaseContext:id=>({shopSessionId:read('session').id,quantity:Number(read('purchases')[id]?.qty)||0}),refresh(){}};
 win.BBHomeHost=host;win.BBHome=install(win);
 context.bb321UnifiedShop=(items,ignoreManual=false)=>{
  const rows=items.map(row=>({...row,pantryUsed:Math.min(row.required,read(STOCK)[pantry.pantryId(row.key,row.unit)]||0),toBuy:Math.max(0,row.required-(read(STOCK)[pantry.pantryId(row.key,row.unit)]||0))}));
  return ignoreManual?rows:win.BBHome.manualBuyItems(rows);
 };
 context.bbBetaPendingBought=()=>[...Object.entries(read('purchases')).filter(([id,row])=>!id.startsWith('ess:')&&read('ticks')[id]&&!read('receipts')['trip-one|'+id]&&!row.receiptInventoryReceiptId).map(([id,row])=>({id,name:row.name,unit:row.unit,qty:row.qty,aisle:'Cupboard / Pantry'})),...Object.entries(read('partials')).filter(([key,row])=>key.startsWith(read('session').id+'|')&&!key.includes('|ess:')&&!read('ticks')[key.slice(read('session').id.length+1)]&&row.bought>0).map(([key,row])=>({id:key.slice(read('session').id.length+1),name:row.name,unit:row.unit,qty:row.bought,aisle:'Cupboard / Pantry',partialPurchase:true}))];
 const transfer=section('function bbHomePendingHouseholdPurchases(){','/* An item bought again after explicitly unchecking');
 const receiptRows=section('function bbReceiptShoppingRows(){','function bb307ReceiptPriceContext(');
 const prepare=section('function bbReceiptPrepareSave(packet){','function bbReceiptConfigureHost(');
 const write=section('function bbShopV7Write(','function bbShopV7New('),close=section('function bbShopV7Close(','function bbShopV7Reconcile(');
 vm.runInContext(section('function bbReducedContext(){','function bb84SetPrimaryPurchase(')+transfer+receiptRows+section('function bbReducedPrepareReceiptPrice(packet){','function bbReceiptPrepareSave(packet){')+prepare+write+close,context);
 const add=(name,quantityText)=>{const result=win.BBHome.addShoppingBuy({name,quantityText,requestId:'request-'+name,actorId:'alice'});assert.equal(result.ok,true,result.message);};
 const packet=(amount,extra={})=>({source:'cloud',receiptId:'receipt-'+amount,shopSessionId:'trip-one',addToPantry:true,stockAfter:{'rice|g':read(STOCK)['rice|g']+amount},items:amount?[{key:'rice',classification:'food',quantity:amount,unit:'g'}]:[],essentials:[],...extra});
 const preparePacket=packet=>copy(context.bbReceiptPrepareSave(packet));
 const commit=(result,stockAfter)=>{for(const [key,value]of Object.entries(result.changes))storage.setItem(key,JSON.stringify(value));if(stockAfter)storage.setItem(STOCK,JSON.stringify(stockAfter));context.bb307FeatureState=read(FEATURE);context.bb307Stock=read(STOCK);};
 const buy=(id,name,qty,unit='g')=>{storage.setItem('ticks',JSON.stringify({...read('ticks'),[id]:true}));storage.setItem('purchases',JSON.stringify({...read('purchases'),[id]:{name,qty,unit,bbBetaSelectedWeek:'trip-one'}}));};
 const manual=()=>Object.values(read(HOME).byActor?.alice?.manualBuys||{})[0];
 return {values,storage,read,win,context,add,buyReduced:(name,quantityText,pricePaid,requestId='reduced-request')=>win.BBHome.addShoppingBuy({name,quantityText,reduced:{pricePaid},requestId,actorId:'alice'}),packet,prepare:preparePacket,commit,buy,manual,rows:()=>copy(context.bbReceiptShoppingRows()),finish:defer=>copy(context.bb83TransferBought({defer})),close:transfer=>context.bbShopV7Close(transfer)};
}

test('real receipt context includes direct manual food quantities despite ample existing pantry',()=>{
 const h=fixture({owned:1000});h.add('Rice','400 g');
 const [row]=h.rows();assert.equal(row.manualBuyQty,400);assert.equal(row.toBuy,400);assert.equal(row.classification,'food');
 const before=new Map(h.values),packet=h.packet(100),result=h.prepare(packet);
 assert.deepEqual(h.values,before,'preparing a receipt never writes');assert.equal(result.changes.ticks,undefined,'old stock cannot mark an incomplete explicit buy complete');
 assert.equal(Object.values(result.changes[HOME].byActor.alice.manualBuys)[0].quantity,300);
});

test('receipt deposits fulfill automatic food shortage first and retain unpurchased manual extras',()=>{
 const h=fixture({owned:10,required:12});h.add('Rice','4 g');
 const first=h.packet(3),result=h.prepare(first);assert.equal(result.changes.ticks,undefined);
 h.commit(result,first.stockAfter);assert.equal(h.manual().quantity,3);assert.equal(h.manual().pending,true);assert.equal(h.rows()[0].toBuy,3);
 const second=h.packet(3),complete=h.prepare(second);assert.equal(complete.changes.ticks['rice|g'],true);
 h.commit(complete,second.stockAfter);assert.equal(h.manual().quantity,0);assert.equal(h.manual().pending,false);
});

test('a prior-trip or price-only receipt cannot discharge the current direct buying intent',()=>{
 for(const override of [{shopSessionId:'old-trip'},{addToPantry:false},{stockPantry:false}]){
  const h=fixture();h.add('Rice','4 g');const before=h.values.get(HOME),result=h.prepare(h.packet(4,override));
  assert.equal(result.changes[HOME],undefined);assert.equal(h.values.get(HOME),before);assert.equal(h.manual().quantity,4);
 }
});

test('manual household receipt purchases restock essentials and clear only the deposited part',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',unit:'each',qty:12,targetQty:12,ownedQty:10,manualPending:true,selected:true}]});h.add('Soap','4');
 const row=h.rows().find(row=>row.classification==='essential');assert.equal(row.quantity,6);assert.equal(row.manualBuyQty,4);
 const packet=h.packet(0,{essentials:[{name:'Soap',quantity:3,unit:'each'}]}),result=h.prepare(packet);assert.equal(result.changes.ticks,undefined,'an incomplete manual essential purchase stays outstanding');h.commit(result,packet.stockAfter);
 assert.equal(h.read(FEATURE).essentials[0].ownedQty,13);assert.equal(h.manual().quantity,3,'two complete automatic shortage, one completes manual extra');
 assert.equal(h.read(STOCK)['rice|g'],10,'household purchases never enter food stock');
});

test('Bought checkbox alone preserves manual intent; Finish prepares its stock deposit and fulfillment together',()=>{
 const h=fixture({owned:10,required:12});h.add('Rice','4 g');h.buy('rice|g','Rice',3);
 assert.equal(h.manual().quantity,4);const before=new Map(h.values),transfer=h.finish(true);assert.deepEqual(h.values,before);
 assert.equal(transfer.updates.stock['rice|g'],13);assert.equal(Object.values(transfer.updates[HOME].byActor.alice.manualBuys)[0].quantity,3);
 assert.equal(h.close(transfer),true);assert.equal(h.read(STOCK)['rice|g'],13);assert.equal(h.manual().quantity,3);assert.equal(h.read('session').id,'trip-next');
});

test('Finish of a household-only shop deposits the exact confirmed amount once',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',unit:'each',qty:1,targetQty:1,ownedQty:10,manualPending:false,selected:true}]});h.add('Soap','2');h.buy('ess:soap','Soap',2,'each');
 assert.equal(h.context.bbHomePendingHouseholdPurchases().length,1);assert.equal(h.manual().quantity,2);
 const transfer=h.finish(true);assert.equal(transfer.count,1);assert.equal(transfer.updates[FEATURE].essentials[0].ownedQty,12);
 assert.equal(h.close(transfer),true);assert.equal(h.read(FEATURE).essentials[0].ownedQty,12);assert.equal(h.manual().quantity,0);assert.equal(h.finish(true).count,0);
});

test('failed Finish rolls back stock, manual intent, essentials and trip for a safe retry',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',unit:'each',qty:1,targetQty:1,ownedQty:0,manualPending:true,selected:true}]});h.add('Soap','2');h.buy('ess:soap','Soap',3,'each');
 const transfer=h.finish(true),before=new Map(h.values),put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key==='session'&&fail){fail=false;throw Error('quota');}put(key,value);};
 assert.equal(h.close(transfer),false);assert.deepEqual(h.values,before);
 assert.equal(h.close(transfer),true);assert.equal(h.read(FEATURE).essentials[0].ownedQty,3);assert.equal(h.manual().quantity,0);
});


test('partial manual buying intent carries to the next trip, where a new deposit can fulfill it',()=>{
 const h=fixture({owned:10,required:12});h.add('Rice','4 g');h.buy('rice|g','Rice',3);
 assert.equal(h.close(h.finish(true)),true);assert.equal(h.manual().quantity,3);assert.equal(h.manual().shopSessionId,'trip-next');assert.equal(h.manual().boughtAtRequest,0);
 const old=h.prepare(h.packet(3));assert.equal(old.changes[HOME],undefined,'a receipt pinned to the archived trip cannot discharge the carried request');
 const next=h.packet(3,{shopSessionId:'trip-next'}),result=h.prepare(next);h.commit(result,next.stockAfter);
 assert.equal(h.manual().quantity,0);assert.equal(h.manual().pending,false);
});

test('an untouched manual intent carries across an explicitly finished trip without changing pantry',()=>{
 const h=fixture();h.add('Rice','4 g');const stock=h.values.get(STOCK);
 assert.equal(h.close(null),true);assert.equal(h.manual().shopSessionId,'trip-next');assert.equal(h.manual().quantity,4);assert.equal(h.values.get(STOCK),stock);
});

test('Finish keeps exact source keys and checked pack metadata when measured food is bought separately',()=>{
 const h=fixture(),source={'rice|kg':1/3,'herbs|handful':.00003};
 h.storage.setItem(STOCK,JSON.stringify(source));h.context.bb307Stock=copy(source);
 h.storage.setItem('inventory',JSON.stringify({'cupboard|rice':{name:'Rice',selected:true,loc:'cupboard',unit:'kg',qty:1/3,bb173StockKey:'rice|kg',bb173StockValue:1/3,packReviewed:true,packQuantity:1,packUnit:'kg'}}));
 h.buy('rice|g','Rice',3);const transfer=h.finish(true);
 assert.deepEqual(transfer.updates[STOCK],{...source,'rice|g':3});
 const rows=Object.values(transfer.updates.inventory),old=rows.find(row=>row.bb173StockKey==='rice|kg'),purchased=rows.find(row=>row.bb173StockKey==='rice|g');
 assert.equal(old.qty,1/3);assert.equal(old.packReviewed,true);assert.equal(old.packQuantity,1);assert.equal(purchased.qty,3);assert.equal(rows.length,2);
});

test('Finish does not round away small valid measured balances',()=>{
 const h=fixture({owned:1e-7});h.buy('rice|g','Rice',2e-7);
 assert.equal(h.finish(true).updates[STOCK]['rice|g'],1e-7+2e-7);
});

test('household purchases already deposited by a receipt are never credited again by Finish',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',unit:'each',qty:1,targetQty:1,ownedQty:5,selected:true}]});h.buy('ess:soap','Soap',2,'each');
 const purchases=h.read('purchases');purchases['ess:soap'].receiptInventoryReceiptId='receipt-deposited';h.storage.setItem('purchases',JSON.stringify(purchases));
 assert.equal(h.context.bbHomePendingHouseholdPurchases().length,0);assert.equal(h.finish(true).count,0);assert.equal(h.read(FEATURE).essentials[0].ownedQty,5);
});

test('a receipt after Finish does not deposit the same household purchase twice',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',unit:'each',qty:3,targetQty:3,ownedQty:1,manualPending:true,selected:true}]});
 h.buy('ess:soap','Soap',2,'each');assert.equal(h.close(h.finish(true)),true);
 assert.equal(h.read(FEATURE).essentials[0].ownedQty,3);
 const packet=h.packet(0,{receiptId:'household-after-finish',shopSessionId:'trip-one',essentials:[{name:'Soap',quantity:2,unit:'each',receiptId:'household-after-finish',shopSessionId:'trip-one'}]});
 const result=h.prepare(packet);h.commit(result,packet.stockAfter);
 assert.equal(h.read(FEATURE).essentials[0].ownedQty,3,'the receipt describes the two items already deposited by Finish');
});

test('the real household checkbox records a purchase without pre-crediting At home, including undo',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',unit:'each',qty:3,targetQty:3,ownedQty:1,manualPending:true,selected:true}]});let completionCalls=0;
 h.win.BBHomeHost.completeHousehold=id=>{completionCalls++;const features=h.read(FEATURE);const row=features.essentials.find(value=>value.id===id);row.ownedQty=row.targetQty;return {[FEATURE]:features};};
 h.context.bb321TinSpec=()=>null;
 vm.runInContext(section('function bb84DisplayedPurchase(','/* Reduced purchase costs')+section('function bbPartialKey(','function bbPartialAll(')+section('function bb84SetPrimaryPurchase(','function bb84ExtraNeeded('),h.context);
 const item={key:'Soap',name:'Soap',qty:2,unit:'each'};
 assert.equal(h.context.bb84SetPrimaryPurchase('ess:soap',true,item,true),true);assert.equal(h.read(FEATURE).essentials[0].ownedQty,1);assert.equal(completionCalls,0);
 assert.equal(h.context.bb84SetPrimaryPurchase('ess:soap',false,item,true),true);assert.equal(h.read(FEATURE).essentials[0].ownedQty,1);assert.equal(h.rows().find(row=>row.classification==='essential').required,2);
 assert.equal(h.context.bb84SetPrimaryPurchase('ess:soap',true,item,true),true);assert.equal(h.close(h.finish(true)),true);assert.equal(h.read(FEATURE).essentials[0].ownedQty,3);assert.equal(completionCalls,0);
});

test('split household receipt lines and replay consume their Finish credit only once',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',unit:'each',qty:3,targetQty:3,ownedQty:1,manualPending:true,selected:true}]});h.buy('ess:soap','Soap',2,'each');assert.equal(h.close(h.finish(true)),true);
 const packet=h.packet(0,{receiptId:'split-household-receipt',shopSessionId:'trip-one',essentials:[{name:'Soap',quantity:1,unit:'each'},{name:'Soap',quantity:1,unit:'each'}]});
 h.commit(h.prepare(packet),packet.stockAfter);assert.equal(h.read(FEATURE).essentials[0].ownedQty,3);
 h.commit(h.prepare(packet),packet.stockAfter);assert.equal(h.read(FEATURE).essentials[0].ownedQty,3,'the same reviewed receipt is not a second purchase');
 const additional=h.packet(0,{receiptId:'second-real-household-receipt',shopSessionId:'trip-one',essentials:[{name:'Soap',quantity:1,unit:'each'}]});h.commit(h.prepare(additional),additional.stockAfter);assert.equal(h.read(FEATURE).essentials[0].ownedQty,4,'a later real receipt adds its own purchase');
});

test('household receipt credit matches equivalent litres and millilitres after Finish',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',unit:'ml',qty:1000,targetQty:1000,ownedQty:500,manualPending:true,selected:true}]});h.buy('ess:soap','Soap',500,'ml');assert.equal(h.close(h.finish(true)),true);
 const packet=h.packet(0,{receiptId:'measured-household-receipt',shopSessionId:'trip-one',essentials:[{name:'Soap',quantity:.5,unit:'l'}]});h.commit(h.prepare(packet),packet.stockAfter);assert.equal(h.read(FEATURE).essentials[0].ownedQty,1000);
});

test('a household receipt using the saved product name replaces its original purchase cost instead of charging twice',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',productName:'Dove soap',brand:'Dove',unit:'each',qty:2,targetQty:2,ownedQty:0,manualPending:true,selected:true}]});h.buy('ess:soap','Soap',2,'each');
 const api=h.win.BBReducedPurchases,session=api.putCost(h.read('session'),{id:'cost:ess:soap',purchaseId:'ess:soap',actor:'alice',market:'UK',shopSessionId:'trip-one',name:'Soap',unit:'each',quantity:2,at:Date.now()},{amount:3,packQty:2,packUnit:'each',shelfPrice:3});h.storage.setItem('session',JSON.stringify(session));
 assert.equal(h.close(h.finish(true)),true);assert.equal(h.read(FEATURE).essentials[0].ownedQty,2);
 const packet=h.packet(0,{actorId:'alice',receiptId:'branded-household-cost',shopSessionId:'trip-one',market:'UK',retailer:'Tesco',purchasedAt:new Date().toISOString(),finishShopCredits:h.read('receipts'),purchaseCosts:[{lineId:'soap-line',classification:'essential',name:'Dove soap',key:'Dove soap',brand:'Dove',quantity:2,unit:'each',pricePaid:3,reduced:false}],essentials:[{name:'Dove soap',brand:'Dove',quantity:2,unit:'each'}]});
 h.commit(h.prepare(packet),packet.stockAfter);const archive=h.read('archives')['trip-one'],costs=Object.values(archive.reducedPurchases);
 assert.equal(costs.length,1,'receipt and Finish represent the same purchase');assert.equal(costs[0].purchaseId,'ess:soap');assert.equal(costs[0].pricePaid,3);assert.equal(h.read(FEATURE).essentials[0].ownedQty,2);
 assert.equal(api.budget({total:0,lines:[],session:h.read('session'),archives:h.read('archives'),context:{actor:'alice',market:'UK'},progress:{ticks:{},purchases:{},partials:{}},now:Date.now()}).total,3);
});

test('an expense-only receipt resolves a unique saved household product without changing its stock',()=>{
 const h=fixture({essentials:[{id:'soap',name:'Soap',productName:'Dove soap',brand:'Dove',unit:'each',qty:2,targetQty:2,ownedQty:0,manualPending:true,selected:true}]});h.buy('ess:soap','Soap',2,'each');
 const api=h.win.BBReducedPurchases,session=api.putCost(h.read('session'),{id:'cost:ess:soap',purchaseId:'ess:soap',actor:'alice',market:'UK',shopSessionId:'trip-one',name:'Soap',unit:'each',quantity:2,at:Date.now()},{amount:3,packQty:2,packUnit:'each',shelfPrice:3});h.storage.setItem('session',JSON.stringify(session));assert.equal(h.close(h.finish(true)),true);
 const beforeStock=h.values.get(STOCK),beforeFeatures=h.values.get(FEATURE),packet=h.packet(0,{actorId:'alice',receiptId:'branded-expense-only',shopSessionId:'trip-one',market:'UK',retailer:'Tesco',purchasedAt:new Date().toISOString(),addToPantry:false,stockPantry:false,purchaseCosts:[{lineId:'soap-line',classification:'essential',name:'Dove soap',key:'Dove soap',brand:'Dove',quantity:null,unit:null,pricePaid:3,reduced:false}],essentials:[]});h.commit(h.prepare(packet));
 assert.equal(h.values.get(STOCK),beforeStock);assert.equal(h.values.get(FEATURE),beforeFeatures);assert.equal(h.read(FEATURE).essentials[0].ownedQty,2);
 const result=api.budget({total:0,lines:[],session:h.read('session'),archives:h.read('archives'),context:{actor:'alice',market:'UK'},progress:{ticks:{},purchases:{},partials:{}},now:Date.now()});assert.equal(result.total,3);assert.ok(Object.values(h.read('archives')['trip-one'].reducedPurchases).some(row=>row.expenseOnly&&row.coveredPurchaseId==='ess:soap'));
});

test('a fresh purchase does not silently join an older freezer-only portion',()=>{
 const h=fixture({owned:400});h.storage.setItem('inventory',JSON.stringify({frozen:{name:'Rice',unit:'g',qty:400,selected:true,loc:'freezer',bb173StockKey:'rice|g',bb173StockValue:400}}));
 h.context.bb83StockLoc=()=> 'cupboard';h.buy('rice|g','Rice',500);
 const transfer=h.finish(true),rows=Object.values(transfer.updates.inventory).filter(row=>row.selected);
 assert.equal(transfer.updates[STOCK]['rice|g'],900);
 assert.equal(rows.filter(row=>row.loc==='freezer').reduce((sum,row)=>sum+row.qty,0),400,'existing frozen stock stays frozen');
 assert.equal(rows.filter(row=>row.loc==='cupboard').reduce((sum,row)=>sum+row.qty,0),500,'new groceries use their storage category');
});


test('Finish refuses an unreadable saved physical balance without replacing any pantry data',()=>{
 const h=fixture();h.add('Rice','4 g');h.buy('rice|g','Rice',4);h.context.bbHomePhysicalStock=()=>{throw Error('Review your saved pantry amounts.');};const before=[...h.values];
 const result=h.finish();assert.equal(result.error,true);assert.equal(result.needsPantryReview,true);assert.deepEqual([...h.values],before);
});

test('a reduced quick purchase overlaps planned demand and Finish settles its buying marker',()=>{
 const h=fixture({owned:0,required:1000,premium:true}),result=h.buyReduced('Rice','500 g',1);assert.equal(result.ok,true,result.message);
 assert.equal(h.rows()[0].toBuy,1000);assert.equal(h.read('partials')['trip-one|rice|g'].bought,500);assert.equal(h.rows()[0].toBuy-h.read('partials')['trip-one|rice|g'].bought,500,'Shop shows only500gstilltobuy');
 const transfer=h.finish(true);assert.equal(transfer.updates[STOCK]['rice|g'],500);assert.equal(h.close(transfer),true);assert.equal(h.manual().pending,false,'actualboughtintentdoesnotcarryasextrademand');
 const archive=h.read('archives')['trip-one'];assert.equal(archive.reducedPurchases['rice|g'].pricePaid,1);assert.equal(h.read('session').reducedPurchases,undefined,'newtripdoesnotreusetheoffer');
});
test('ordinary manual top-ups remain additive when a reduced purchase is logged',()=>{
 const h=fixture({owned:0,required:1000,premium:true});h.add('Rice','400 g');const result=h.buyReduced('Rice','500 g',1);assert.equal(result.ok,true,result.message);
 assert.equal(h.rows()[0].toBuy,1400);assert.equal(h.read('partials')['trip-one|rice|g'].bought,500);assert.equal(h.close(h.finish(true)),true);assert.equal(h.manual().quantity,400);assert.equal(h.rows()[0].toBuy,900,'500plannedremainingplus400manualextra');
});
test('a reduced off-plan quick purchase is bought once, idempotent and never added to pantry before Finish',()=>{
 const h=fixture({owned:0,premium:true});const before=h.values.get(STOCK),first=h.buyReduced('Rice','500 g',1),snapshot=[...h.values];assert.equal(first.ok,true,first.message);assert.equal(h.read('ticks')['rice|g'],true);assert.equal(h.values.get(STOCK),before);
 assert.equal(h.buyReduced('Rice','500 g',1).already,true);assert.deepEqual([...h.values],snapshot);
 assert.equal(h.close(h.finish(true)),true);assert.equal(h.read(STOCK)['rice|g'],500);assert.equal(h.manual().pending,false);
});
test('reduced quick purchase and direct buying intent roll back together on a failed write',()=>{
 const h=fixture({owned:0,required:1000,premium:true}),before=[...h.values],put=h.storage.setItem;let fail=true;h.storage.setItem=(key,value)=>{if(key==='session'&&fail){fail=false;throw Error('quota');}put(key,value);};
 assert.equal(h.buyReduced('Rice','500 g',1).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.buyReduced('Rice','500 g',1).ok,true);assert.equal(h.read('partials')['trip-one|rice|g'].bought,500);
});
test('reduced purchase logging needs current Premium while ordinary additions stay available',()=>{
 const h=fixture({owned:0,required:1000}),before=[...h.values];assert.equal(h.buyReduced('Rice','500 g',1).ok,false);assert.deepEqual([...h.values],before);h.add('Rice','500 g');assert.equal(h.rows()[0].toBuy,1500);
});

test('a reduced receipt only replaces the covered part of manual cost history and retries safely',()=>{
 const h=fixture({owned:0,required:1000,premium:true});assert.equal(h.buyReduced('Rice','1000 g',2).ok,true);
 const packet=h.packet(500,{actorId:'alice',market:'UK',purchasedAt:'2026-11-05',reducedItems:[{lineId:'rice-reduced',key:'rice',name:'Rice',unit:'g',quantity:500,pricePaid:.5,classification:'food'}]});
 const first=h.prepare(packet);h.commit(first,packet.stockAfter);assert.equal(h.read('session').reducedPurchases['rice|g'].pricePaid,2);assert.equal(h.read('session').reducedPurchases['rice|g'].depositedQuantity,500);
 const before=JSON.stringify(h.read('session')),retry=h.prepare(packet);h.commit(retry,packet.stockAfter);assert.equal(JSON.stringify(h.read('session')),before);
 const second=h.packet(500,{actorId:'alice',market:'UK',purchasedAt:'2026-11-05',receiptId:'receipt-rest',reducedItems:[{...packet.reducedItems[0],pricePaid:.7}]});h.commit(h.prepare(second),second.stockAfter);
 const state=h.read('session');assert.equal(state.reducedPurchases['rice|g'],undefined);assert.equal(Object.keys(state.reducedPurchases).length,2);assert.equal(state.reducedSuperseded['rice|g'].pricePaid,2);
});
test('a receipt for a completed known trip updates its archive without changing the active trip',()=>{
 const h=fixture({owned:0,premium:true});h.buyReduced('Rice','500 g',2);assert.equal(h.close(h.finish(true)),true);const active=h.values.get('session');
 const packet=h.packet(500,{actorId:'alice',market:'UK',purchasedAt:'2026-11-05',reducedItems:[{lineId:'reduced-rice',key:'rice',name:'Rice',unit:'g',quantity:500,pricePaid:1,legacyCreditQuantity:500}],addToPantry:false});const prepared=h.prepare(packet);
 assert.equal(prepared.changes.session,undefined);assert.ok(prepared.changes.archives);h.commit(prepared);assert.equal(h.values.get('session'),active);assert.equal(h.read('archives')['trip-one'].reducedPurchases['rice|g'],undefined);assert.equal(Object.values(h.read('archives')['trip-one'].reducedPurchases)[0].pricePaid,1);
});
test('missing receipt purchase dates and another actor cannot turn historical prices into current spending',()=>{
 for(const extra of [{actorId:'other',purchasedAt:'2026-11-05'},{actorId:'alice',purchasedAt:null,confirmedAt:'2026-11-05T12:00:00Z'}]){
  const h=fixture({owned:0,premium:true});h.buyReduced('Rice','500 g',2);const before=h.values.get('session'),packet=h.packet(500,{market:'UK',reducedItems:[{lineId:'reduced-rice',key:'rice',unit:'g',quantity:500,pricePaid:1}],addToPantry:false,...extra});h.commit(h.prepare(packet));assert.equal(h.values.get('session'),before);
 }
});
