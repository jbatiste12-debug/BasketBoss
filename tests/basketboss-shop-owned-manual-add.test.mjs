import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{install}=require('../bb-home.js'),quantity=require('../bb-receipt-quantity.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const HOME='basketboss_at_home_requirements_v1',STOCK='stock',FEATURE='features';
const keys={BB307_FEATURE_KEY:FEATURE,BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_CHOICE_KEY:'choices',BB_SHOP_SESSION_V7_KEY:'session',BB_SHOP_ARCHIVE_V7_KEY:'archives',BB_BETA_RECEIPT_KEY:'receipts',BB83_KITCHEN_INVENTORY:'inventory',BB83_SHOP_STOCK_LEDGER:'legacy-ledger',BB307_STOCK_KEY:STOCK};
const copy=value=>JSON.parse(JSON.stringify(value));
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
function fixture({owned=10,required=0,essentials=[],premium=true}={}){
 const values=new Map(),read=key=>JSON.parse(values.get(key)||'{}');
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 for(const [key,value]of Object.entries({stock:{'rice|g':owned},features:{version:1,essentials},inventory:{rice:{name:'Rice',unit:'g',qty:owned,selected:true,loc:'cupboard',bb173StockKey:'rice|g',bb173StockValue:owned}},session:{version:7,id:'trip-one',checkboxUndo:{}},ticks:{},purchases:{},partials:{},choices:{},receipts:{},basketboss_cloud_session_v1:{user:{id:'alice'}}}))storage.setItem(key,JSON.stringify(value));
 const pantry={pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,pantryName:name=>name.toLowerCase(),normaliseStock:copy};
 const win={localStorage:storage,location:{search:''},document:{},BBReceiptQuantity:quantity,BBReducedPurchases:require('../bb-reduced-purchases.js'),BBReducedFoodHost:{isPremium:()=>premium},BBShopOwnership:{...require('../bb-shop-ownership.js'),enabled:()=>true}};
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

// These exercise the immediate release through the actual Add and transfer
// functions; the legacy manual-purchase tests keep their original contract.
test('immediate reduced Add keeps unrelated manual requests while accumulating the exact physical quantity',()=>{
 const h=fixture({owned:10,required:12});
 const first=h.buyReduced('Rice','4 g',1,'rice-first');assert.equal(first.ok,true,first.message);
 assert.equal(h.read(STOCK)['rice|g'],14);assert.equal(h.finish(true).count,0);
 h.add('Milk','500 ml');
 const second=h.buyReduced('Rice','3 g',.75,'rice-second');assert.equal(second.ok,true,second.message);
 assert.equal(h.read(STOCK)['rice|g'],17);
 assert.equal(h.read('purchases')['rice|g'].actualQty,7);
 assert.equal(h.read('receipts')['trip-one|rice|g'].credited,7);
 assert.equal(Object.values(h.read(HOME).byActor.alice.manualBuys).find(row=>row.name==='Milk').quantity,500);
 assert.equal(h.finish(true).count,0,'Finish cannot repeat either immediate deposit');
 const before=new Map(h.values),replay=h.buyReduced('Rice','3 g',.75,'rice-second');
 assert.equal(replay.already,true);assert.deepEqual(h.values,before,'the request replay performs no writes');
});

test('an off-plan reduced household Add retains its exact checkbox identity through correction',()=>{
 const h=fixture(),added=h.buyReduced('Soap','2',1,'soap-first');assert.equal(added.ok,true,added.message);
 const id='ess:manual-household:bought:soap|each';
 const [anchor]=h.win.BBShopOwnership.anchor([],h.read('session'),{essential:true,idFor:row=>'ess:'+row.id});
 assert.equal('ess:'+anchor.id,id);assert.equal(anchor.qty,2);
 assert.equal(h.read(FEATURE).essentials[0].ownedQty,2);assert.equal(h.read(STOCK)['rice|g'],10);
 const session=h.read('session'),ticks={...h.read('ticks')},purchases={...h.read('purchases')},choices={...h.read('choices')};
 delete ticks[id];delete purchases[id];delete choices[id];
 const partials={...h.read('partials'),['trip-one|'+id]:{bought:1,unit:'each',required:2,week:'trip-one',name:'Soap',essential:true}};
 const updates={ticks,purchases,choices,partials,session:{...session,bought:ticks,purchases,choices,partials}};
 const prepared=h.context.bbShopOwnedChanges(id,updates,anchor,true);
 assert.equal(h.context.bbShopV7Write(prepared.updates,prepared.expected),true);h.context.bbShopOwnedSaved();
 assert.equal(h.read(FEATURE).essentials[0].ownedQty,1);
 assert.equal(h.read('receipts')['trip-one|'+id].credited,1);
 const [corrected]=h.win.BBShopOwnership.anchor([],h.read('session'),{essential:true,idFor:row=>'ess:'+row.id});
 assert.equal('ess:'+corrected.id,id);assert.equal(h.read('partials')['trip-one|'+id].bought,1);
});

test('a failed immediate Add outbox write rolls back physical stock, purchase history and request identity together',()=>{
 const h=fixture({owned:10,required:12}),outbox='purchase-outbox';let retries=0;
 h.win.BBReceiptHost={preparePurchasedPantry:({stock,beforeStock,shopSessionId})=>({updates:{[outbox]:{stock,beforeStock,shopSessionId}},expected:{[outbox]:h.storage.getItem(outbox)}}),retryPurchasedPantry(){retries++;return Promise.resolve({ok:true});}};
 const before=new Map(h.values),write=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key===outbox&&fail){fail=false;throw Error('quota');}write(key,value);};
 const failed=h.buyReduced('Rice','4 g',1,'retryable-rice');assert.equal(failed.ok,false);assert.deepEqual(h.values,before);assert.equal(retries,0);
 const retried=h.buyReduced('Rice','4 g',1,'retryable-rice');assert.equal(retried.ok,true,retried.message);
 assert.equal(h.read(STOCK)['rice|g'],14);assert.equal(h.read(outbox).stock['rice|g'],14);assert.equal(h.read(outbox).beforeStock['rice|g'],10);assert.equal(retries,1);
 const saved=new Map(h.values),replay=h.buyReduced('Rice','4 g',1,'retryable-rice');assert.equal(replay.already,true);assert.deepEqual(h.values,saved);
});
