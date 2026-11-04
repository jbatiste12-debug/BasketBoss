import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)('../bb-home.js');
const id=(name,unit)=>name.toLowerCase()+'|'+unit;
test('manual total is a maximum over recipe plus lunch need, never a duplicate addition',()=>{
 const recipe=[{key:'Rice',unit:'g',required:600}],lunch=[{name:'Rice',unit:'g',qty:100}];
 assert.equal(api.augment(recipe,lunch,{'rice|g':{name:'Rice',unit:'g',targetQty:1000,pending:true}},id)[0].required,900);
 assert.equal(api.augment(recipe,lunch,{'rice|g':{name:'Rice',unit:'g',targetQty:500,pending:true}},id)[0].required,600);
 assert.equal(recipe[0].required,600);
 assert.equal(api.difference(600,200),400);assert.equal(api.difference(200,600),0);
});
test('manual requests survive new weeks, then cease adding demand only when fulfilled',()=>{
 const target={name:'Milk',unit:'ml',targetQty:1000,pending:true};
 for(let day=0;day<14;day++)assert.equal(api.augment([],[],{milk:target},id)[0].required,1000);
 assert.deepEqual(api.augment([],[],{milk:{...target,pending:false}},id),[]);
});
test('invalid and negative amounts cannot create stock or purchases',()=>{
 for(const value of[-1,NaN,Infinity,'200',null])assert.throws(()=>api.difference(600,value));
 assert.equal(api.augment([],[],{rice:{name:'Rice',unit:'g',targetQty:-200,pending:true}},id).length,0);
});
test('multi-record confirmation rolls every value back on storage verification failure',()=>{
 const data=new Map([['stock','old-stock'],['target','old-target']]);let failed=false;
 const storage={getItem:k=>data.get(k)??null,setItem(k,v){if(k==='target'&&!failed){failed=true;throw Error('quota');}data.set(k,v);},removeItem:k=>data.delete(k)};
 assert.throws(()=>api.atomic(storage,{stock:{rice:200},target:{needed:600}}));assert.equal(data.get('stock'),'old-stock');assert.equal(data.get('target'),'old-target');
 assert.throws(()=>api.atomic(storage,{stock:{}},{stock:'stale'}));assert.equal(data.get('stock'),'old-stock');
});

import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const pantryText=html.slice(html.indexOf('const BB307Pantry=(()=>{'),html.indexOf('// BasketBoss 321 v7 original-design PREVIEW'));
const pantryContext=vm.createContext({BB_WHOLE_PRODUCE_GRAMS:{}});vm.runInContext(fs.readFileSync('basketboss-pricing-v19.js','utf8'),pantryContext);vm.runInContext(pantryText,pantryContext);
const pantry=vm.runInContext('BB307Pantry',pantryContext);
test('real pantry consumption preserves units, never goes negative and does not guess incompatible stock',()=>{
 const result=pantry.reconcileStock({'rice|g':1000,'milk|ml':2000,'onion|each':2},[{key:'Rice',unit:'g',required:600},{key:'Milk',unit:'ml',required:500},{key:'Onion',unit:'each',required:.5}]);
 assert.equal(result.remainingStock['rice|g'],400);assert.equal(result.remainingStock['milk|ml'],1500);assert.equal(result.remainingStock['onion|each'],1.5);
 const mismatch=pantry.reconcileStock({'rice|each':1},[{key:'Rice',unit:'g',required:600}]);assert.equal(mismatch.remainingStock['rice|each'],1);
});
test('cooking commits once, supports another real cook, rejects another actor, and rolls failed commits back',async()=>{
 const map=new Map([['stock',JSON.stringify({'rice|g':1000})],['inventory',JSON.stringify({cupboard:{bb173StockKey:'rice|g',bb173StockValue:600,qty:600,unit:'g'},freezer:{bb173StockKey:'rice|g',bb173StockValue:400,qty:.4,unit:'kg'}})]]);let fail=false;
 const storage={getItem:k=>map.get(k)??null,setItem(k,v){if(fail&&k==='inventory'){fail=false;throw Error('disk full');}map.set(k,v);},removeItem:k=>map.delete(k)};
 const win={localStorage:storage,location:{search:''},document:{},BBHomeHost:{id:pantry.pantryId,keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>JSON.parse(storage.getItem('stock')),recipeIngredients:(_,factor)=>[{key:'rice',unit:'g',required:300*factor}],consume:pantry.reconcileStock,refresh(){},occurrence:()=>null}};
 const home=api.install(win);
 const event={sessionId:'first-cook',recipeId:'rice-dinner',factor:1,actorId:'guest'};
 assert.equal((await home.cooked(event)).ok,true);assert.equal(JSON.parse(storage.getItem('stock'))['rice|g'],700);
 const inventory=JSON.parse(storage.getItem('inventory'));assert.equal(inventory.cupboard.bb173StockValue+inventory.freezer.bb173StockValue,700,'the same food in two areas is allocated once');assert.equal(inventory.freezer.qty,.1);
 await home.cooked(event);assert.equal(JSON.parse(storage.getItem('stock'))['rice|g'],700,'repeated completion does not consume again');
 assert.equal((await home.cooked({...event,sessionId:'other',actorId:'other-account'})).ok,false);
 fail=true;await assert.rejects(()=>home.cooked({...event,sessionId:'second-cook',factor:2}));assert.equal(JSON.parse(storage.getItem('stock'))['rice|g'],700);
 await home.cooked({...event,sessionId:'second-cook',factor:2});assert.equal(JSON.parse(storage.getItem('stock'))['rice|g'],100,'retry uses the uncommitted cooking session exactly once');
});


function settlementFixture(){
 const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const session={id:'shop-session',checkboxUndo:{'rice|g':null}},stock={'rice|g':200};
 const keys={BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_CHOICE_KEY:'choices',BB_SHOP_SESSION_V7_KEY:'session',BB_BETA_RECEIPT_KEY:'receipts'};
 const read=key=>JSON.parse(storage.getItem(key)||'{}');
 for(const [key,value]of Object.entries({ticks:{'rice|g':true},purchases:{'rice|g':{qty:400,name:'Rice',unit:'g'}},partials:{},choices:{},session,receipts:{}}))storage.setItem(key,JSON.stringify(value));
 const win={localStorage:storage,location:{search:''},document:{}};
 const ctx=vm.createContext({localStorage:storage,window:win,console,BB307Pantry:pantry,...keys,
  bbShopV7Session:()=>read('session'),bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),bbPartialAll:()=>read('partials'),bbBetaPurchaseChoices:()=>read('choices'),bb83ReadObject:read,bbBetaShopWeek:()=>session.id});
 const receipt=html.slice(html.indexOf('function bbBetaReceiptId('),html.indexOf('function bbBetaReceiptRead('));
 const settle=html.slice(html.indexOf('function bbHomeSettlePurchases('),html.indexOf('window.BBHomeHost=Object.freeze('));vm.runInContext(receipt+settle,ctx);
 const host={id:pantry.pantryId,requirements:()=>[],household:()=>[],stock:()=>stock,settlePurchases:vm.runInContext('bbHomeSettlePurchases',ctx)};
 win.BBHomeHost=host;win.BBHome=api.install(win);
 return {values,storage,read,win,host,ctx};
}
test('absolute At home confirmation settles old shopping credit while keeping purchase history',()=>{
 const h=settlementFixture(),change=h.win.BBHome.prepare([{name:'Rice',unit:'g',qty:200,totalNeeded:600}]);
 assert.equal(h.read('ticks')['rice|g'],true,'review alone does not mutate the list');
 api.atomic(h.storage,{[change.key]:change.value,...change.shoppingChange.updates},change.shoppingChange.expected);
 assert.deepEqual(h.read('ticks'),{});assert.deepEqual(h.read('purchases'),{});
 const owned=h.read(change.key).byActor.guest;assert.equal(Object.values(owned.settledPurchases)[0].purchase.qty,400);
 assert.equal(h.win.BBHome.targets()['rice|g'].pending,true,'remaining 400 g stays needed until a new purchase');
});
test('settled receipt credits cannot subtract twice, and a subsequent purchase has a fresh receipt identity',()=>{
 const h=settlementFixture(),base='shop-session|rice|g';h.storage.setItem('receipts',JSON.stringify({[base]:{name:'Rice',unit:'g',credited:200}}));
 const change=h.win.BBHome.prepare([{name:'Rice',unit:'g',qty:200,totalNeeded:600}]);api.atomic(h.storage,{[change.key]:change.value,...change.shoppingChange.updates});
 assert.equal(h.win.BBHome.supersedesReceipt(base),true);assert.equal(h.win.BBHome.receiptGeneration(base),1);
 assert.equal(vm.runInContext("bbBetaReceiptId('rice|g')",h.ctx),base+'|home:1');assert.equal(h.read('receipts')[base].credited,200,'historic receipt is retained');
 Object.assign(h.ctx,{bbReceiptPantryReviewRequired:()=>false,bbReceiptHasAuthoritativePantry:()=>false,bbBetaReceiptConstantsReady:true,bbReceiptHostReady:false});
 vm.runInContext(html.slice(html.indexOf('function bbBetaStockForCurrentWeek('),html.indexOf('function bbBetaReceiptCandidate(')),h.ctx);
 assert.equal(vm.runInContext("bbBetaStockForCurrentWeek({'rice|g':200})['rice|g']",h.ctx),200,'confirmed stock is not reduced again by the old receipt credit');
});
test('cooking leaves a new unconfirmed purchase available for normal receipt reconciliation',()=>{
 const h=settlementFixture();const change=h.host.settlePurchases(['rice|g'],{cooking:true});assert.deepEqual(Object.keys(change.updates),[]);assert.equal(h.read('purchases')['rice|g'].qty,400);
});
test('settling shopping credit and stock rolls back together if storage fails',()=>{
 const h=settlementFixture(),change=h.win.BBHome.prepare([{name:'Rice',unit:'g',qty:200,totalNeeded:600}]);let fail=true;
 const storage={...h.storage,setItem(key,value){if(key==='purchases'&&fail){fail=false;throw Error('storage full');}h.storage.setItem(key,value);}};
 assert.throws(()=>api.atomic(storage,{[change.key]:change.value,...change.shoppingChange.updates}));assert.equal(h.read('ticks')['rice|g'],true);assert.equal(h.read('purchases')['rice|g'].qty,400);assert.equal(h.storage.getItem(change.key),null);
});


function finishFixture(choice={mode:'pack',unit:'g',qty:400,size:500,count:1,keep:true},item={id:'rice|g',name:'Rice',qty:400,unit:'g',aisle:'Cupboard / Pantry'}){
 const h=settlementFixture();h.storage.setItem('stock',JSON.stringify({'rice|g':200}));h.storage.setItem('inventory',JSON.stringify({rice:{name:'Rice',selected:true,loc:'cupboard',qty:200,unit:'g',bb173StockKey:'rice|g',bb173StockValue:200}}));
 Object.assign(h.ctx,{BB83_KITCHEN_INVENTORY:'inventory',BB83_SHOP_STOCK_LEDGER:'legacy-ledger',BB307_STOCK_KEY:'stock',bb307Stock:h.read('stock'),bbBetaReceiptRead:()=>h.read('receipts'),bbBetaPendingBought:()=>h.read('receipts')['shop-session|'+item.id]?[]:[item],bbBetaChoiceInfo:()=>choice,bbBetaIsPerishable:aisle=>/Dairy/.test(aisle),bbBetaPackSpec:()=>({size:500,review:false}),bbBetaDryVolumeUnit:()=>false,bb83StockLoc:()=> 'cupboard',bb83KitchenName:name=>name.toLowerCase(),bb307SaveStock:stock=>{h.storage.setItem('stock',JSON.stringify(stock));h.ctx.bb307Stock=stock;return true;}});
 const surplus=html.slice(html.indexOf('function bbBetaChoiceSurplus('),html.indexOf('function bbBetaPendingBought('));
 const transfer=html.slice(html.indexOf('function bb83TransferBought('),html.indexOf('/* An item bought again after explicitly unchecking'));
 vm.runInContext(surplus+transfer,h.ctx);
 Object.assign(h.host,{keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>h.read('stock'),recipeIngredients:()=>[{key:'Rice',unit:'g',required:600}],consume:pantry.reconcileStock,refresh(){},occurrence:()=>null,needsLegacyReview:vm.runInContext('bbHomeNeedsLegacyReview',h.ctx)});
 return {...h,finish:(defer=false)=>vm.runInContext('bb83TransferBought({defer:'+Boolean(defer)+'})',h.ctx)};
}
test('Finish adds the full confirmed pack, then Cook subtracts ingredients once and preserves the actual surplus',async()=>{
 const h=finishFixture();assert.equal(h.finish().count,1);assert.equal(h.read('stock')['rice|g'],700,'200 owned + actual 500 g purchase');
 assert.equal(h.finish().count,0);assert.equal(h.read('stock')['rice|g'],700,'repeated Finish cannot credit twice');
 assert.equal(h.read('receipts')['shop-session|rice|g'].stockBasis,'full-purchase');
 assert.equal((await h.win.BBHome.cooked({sessionId:'pack-cook',recipeId:'rice',factor:1,actorId:'guest'})).ok,true);assert.equal(h.read('stock')['rice|g'],100,'700 owned minus 600 used leaves 100, without deducting the surplus twice');
});
test('an unconfirmed automatic pack guide never invents extra stock',()=>{
 const h=finishFixture({mode:'pack',unit:'g',qty:400,size:1000,count:1,implicit:true});h.finish();assert.equal(h.read('stock')['rice|g'],600,'only the listed 400 g is confirmed until an actual pack is chosen');
});
test('an exact purchase is recorded at home too, with no invented extra pack quantity',()=>{
 const h=finishFixture({mode:'exact',unit:'g',qty:400});h.finish();assert.equal(h.read('stock')['rice|g'],600);
});
test('Finish preserves one physical total when the same ingredient is stored in two areas',()=>{
 const h=finishFixture();h.storage.setItem('stock',JSON.stringify({'rice|g':300}));h.ctx.bb307Stock=h.read('stock');const inv=h.read('inventory');inv.second={name:'Rice',selected:true,loc:'freezer',qty:100,unit:'g',bb173StockKey:'rice|g',bb173StockValue:100};h.storage.setItem('inventory',JSON.stringify(inv));
 h.finish();assert.equal(h.read('stock')['rice|g'],800);assert.equal(Object.values(h.read('inventory')).reduce((sum,row)=>sum+row.bb173StockValue,0),800);
});
test('fresh extras still require explicit safe-storage confirmation before purchase transfer',()=>{
 const item={id:'milk|ml',name:'Milk',qty:400,unit:'ml',aisle:'Dairy'},h=finishFixture({mode:'pack',unit:'ml',qty:400,size:500,count:1,keep:false},item);h.storage.setItem('stock',JSON.stringify({'milk|ml':100}));h.ctx.bb307Stock=h.read('stock');assert.equal(h.finish().skipped,1);assert.equal(h.read('stock')['milk|ml'],100);assert.deepEqual(h.read('receipts'),{});
});
test('older surplus-only receipts require an absolute At home review before cooking, without guessing missing purchased stock',async()=>{
 const h=finishFixture();h.storage.setItem('receipts',JSON.stringify({'old-shop|rice|g':{name:'Rice',unit:'g',qty:400,credited:100}}));
 assert.equal(h.win.BBHome.needsLegacyReview('rice'),true);const event={sessionId:'legacy-cook',recipeId:'rice',factor:1,actorId:'guest'};assert.equal((await h.win.BBHome.cooked(event)).ok,false);assert.equal(h.read('stock')['rice|g'],200);
 const change=h.win.BBHome.prepare([{name:'Rice',unit:'g',qty:200}]);api.atomic(h.storage,{[change.key]:change.value,...change.shoppingChange.updates});assert.equal(h.win.BBHome.needsLegacyReview('rice'),false);
});

test('Finish commits stock and the archived shopping session together, or preserves both for retry',()=>{
 const h=finishFixture();let ended=0;h.win.BBWeeklyShop={end:()=>ended++};Object.assign(h.ctx,{BB_SHOP_ARCHIVE_V7_KEY:'archives',bbReceiptHostReady:false,bbShopV7Read:h.read,bbShopV7Snapshot:session=>({...session,purchases:h.read('purchases')}),bbShopV7New:()=> 'next-shop',bb307ReadStock:()=>h.read('stock')});
 const write=html.slice(html.indexOf('function bbShopV7Write('),html.indexOf('function bbShopV7New('));
 const close=html.slice(html.indexOf('function bbShopV7Close('),html.indexOf('function bbShopV7Reconcile('));vm.runInContext(write+close,h.ctx);
 const transfer=h.finish(true);assert.equal(h.read('stock')['rice|g'],200,'preparing Finish does not change stock');
 const put=h.storage.setItem;let fail=true;h.storage.setItem=(key,value)=>{if(fail&&key==='session'&&JSON.parse(value).id==='next-shop'){fail=false;throw Error('disk full');}put(key,value);};h.ctx.pendingTransfer=transfer;
 assert.equal(vm.runInContext('bbShopV7Close(pendingTransfer)',h.ctx),false);assert.equal(h.read('stock')['rice|g'],200);assert.deepEqual(h.read('receipts'),{});assert.equal(h.read('session').id,'shop-session');assert.equal(ended,0);
 assert.equal(vm.runInContext('bbShopV7Close(pendingTransfer)',h.ctx),true);assert.equal(h.read('stock')['rice|g'],700);assert.equal(h.read('session').id,'next-shop');assert.equal(h.read('archives')['shop-session'].purchases['rice|g'].qty,400);assert.equal(ended,1);
});

test('shared purchase origins retain replay proof and expose canonical receipt credit without adding food twice',async()=>{
 const item={id:'shared:household:request',name:'Rice',qty:400,unit:'g',aisle:'Cupboard / Pantry'},h=finishFixture({mode:'exact',unit:'g',qty:400},item);
 h.finish();assert.equal(h.read('stock')['rice|g'],600);const receipts=h.read('receipts');assert.equal(receipts['shop-session|shared:household:request'].canonicalCreditId,'shop-session|rice|g');assert.equal(receipts['shop-session|rice|g'].credited,400);
 const {computeReceiptCredit}=await import('../bb-receipt-inventory-core.mjs');const credit=computeReceiptCredit({name:'Rice',canonicalKey:'rice',quantity:400,unit:'g'},receipts,{shopSessionId:'shop-session'});assert.equal(credit.addedQuantity,0);assert.equal(credit.priorCreditedQuantity,400);assert.equal(h.finish().count,0);
});
test('shared local purchase acknowledgements are actor-pinned and remain idempotent after shopping-session rotation',()=>{
 const h=settlementFixture(),actor='11111111-1111-4111-8111-111111111111';h.storage.setItem('basketboss_cloud_session_v1',JSON.stringify({user:{id:actor}}));
 const item={id:'request',household_id:'household',revision:2,completed:true,completed_by:actor,name:'Rice',unit:'g',completed_at:'2026-11-02T10:00:00Z'},pin={actor,household_id:'household'};
 const change=h.win.BBHome.prepareSharedPurchase(item,true,pin);api.atomic(h.storage,change.updates,change.expected);h.storage.setItem('session',JSON.stringify({id:'another-shop'}));assert.equal(h.win.BBHome.prepareSharedPurchase(item,true,pin).already,true);
 assert.throws(()=>h.win.BBHome.prepareSharedPurchase(item,true,{...pin,actor:'another-user'}));
 const other={...item,id:'another-request'};h.storage.setItem('basketboss_ui_next_confirmed_pantry_v1',JSON.stringify({confirmedAt:'2030-11-02T10:10:00Z',items:[{name:'Rice',unit:'g',qty:200}]}));assert.ok(h.win.BBHome.prepareSharedPurchase(other,true,pin).updates,'device timestamps never suppress a new purchase');h.win.BBSharedShopping={knownCompletedItems:()=>[other]};const count=h.win.BBHome.prepare([{name:'Rice',unit:'g',qty:200}]);api.atomic(h.storage,{[count.key]:count.value,...count.shoppingChange.updates});assert.equal(h.win.BBHome.prepareSharedPurchase(other,true,pin).already,true,'an explicit count records known completed request revisions without comparing clocks');
});

test('a new shared purchase cannot make an older surplus-only stock basis look fully reviewed',()=>{
 const h=finishFixture({mode:'exact',unit:'g',qty:100},{id:'shared:new-request',name:'Rice',qty:100,unit:'g',aisle:'Cupboard / Pantry'});h.storage.setItem('receipts',JSON.stringify({'shop-session|rice|g':{name:'Rice',unit:'g',qty:400,credited:100,week:'shop-session'}}));h.finish();assert.equal(h.read('receipts')['shop-session|rice|g'].stockBasis,'mixed-review-required');assert.equal(h.win.BBHome.needsLegacyReview('rice'),true);
});
