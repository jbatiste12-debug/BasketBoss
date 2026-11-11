import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizePantryState} from '../bb-receipt-inventory-core.mjs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),quantity=require('../bb-receipt-quantity.js'),home=require('../bb-home.js');
const ownership=require('../bb-shop-ownership.js'),purchaseUI=require('../bb-shop-purchase-ui.js');
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
 const win={BBShopPurchaseUI:purchaseUI,BBPantryPolicy:require('../bb-pantry-policy.js'),BBPantryNormalize:normalizePantryState,BBShopOwnership:{...ownership,enabled:()=>true},BBReceiptQuantity:quantity,BBReducedPurchases:require('../bb-reduced-purchases.js'),BBReducedFoodHost:{isPremium:()=>false},BBHome:{actor:()=> 'tester',shoppingBuys:()=>[],completionChanges:()=>({}),purchaseAmounts:home.purchaseAmounts},BBHomeHost:{reload(){}},localStorage:storage};
 const ctx=vm.createContext({...keys,window:win,localStorage:storage,console:{error(){},warn(){}},BBPriceV19:{canonical:value=>value.toLowerCase(),formatQuantity:(quantity,unit)=>quantity+' '+unit},BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,pantryName:name=>name.toLowerCase(),normaliseStock:copy},bb307Market:'UK',bb307Stock:read('stock'),bb307FeatureState:read('features'),
  bb83ReadObject:read,bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),bbBetaPurchaseChoices:()=>read('choices'),bbPartialAll:()=>read('partials'),bbShopV7Session:()=>read('session'),bbBetaShopWeek:()=>read('session').id,bbBetaReceiptRead:()=>read('receipts'),bbBetaReceiptId:id=>read('session').id+'|'+id,
  bb172Aisle:()=>essential?'Household & Other':'Meat & Fish',bbBetaDryVolumeUnit:()=>false,bbBetaPackSpec:()=>({size:500,review:false}),bbBetaAutomaticPack:()=>null,bb321TinSpec:()=>null,bb307ReadStock:()=>read('stock'),bb307ReadFeatures:()=>read('features'),bb83StockLoc:()=> 'fridge',bb83KitchenName:name=>name.toLowerCase(),bbHomePhysicalStock:()=>read('stock'),
  bb321WeeklySummary:()=>({items:[basket],essentials:[]}),bb83BoughtCandidates:()=>Object.entries(read('purchases')).filter(([id])=>read('ticks')[id]).map(([id,row])=>({id,...row})),bb307Plan:()=>({items:[]}),render(){},bb172StorefrontRefresh(){},notify(){}});
 for(const name of ['bbShopOwnedExpected','bbShopOwnedChanges','bbShopOwnedSaved','bbShopExactQuantity','bbShopPurchasePack','bbShopNeedPresentation','bbReducedContext','bbReducedPremium','bbReducedProgress','bbShopV7Write','bb84DetailFor','bb84DisplayedPurchase','bb84SavedPurchased','bb84SetPrimaryPurchase','bbBetaReceiptCandidate','bbBetaChoiceInfo','bbBetaChoiceSurplus','bbBetaPendingPartials','bbBetaPendingBought','bbBetaIsPerishable','bbPartialRound','bbPartialKey','bbPartialDetails','bbPartialSet','bbHomePendingHouseholdPurchases','bb83TransferBought'])vm.runInContext(actual(name),ctx);
 for(const name of ['bbShopPurchaseBase','bbShopPurchaseViewContext','bbShopPurchaseViewPin','bbShopPurchaseViewCurrent','bbShopPurchaseRecommended','bbShopPurchaseViewItem','bbShopPurchaseListItem','bbShopPurchaseCopyHint','bbShopPurchaseQuote','bbShopPurchaseEstimate','bbShopPurchaseDisplay','bbShopPurchaseNeedView','bbShopPurchaseNativeTotal','bbShopPurchaseSaveView','bbShopPurchasePicker','bbShopPurchaseAttachRows','bb172StorefrontToggle'])vm.runInContext(actual(name),ctx);
 ctx.bb172StorefrontKeepItem=()=>{};ctx.Event=class{constructor(type){this.type=type;}};
 return {values,read,storage,ctx,basket,item,id,check:on=>ctx.bb84SetPrimaryPurchase(id,on,basket,essential,{inventoryNow:true}),amount:total=>ctx.bbPartialSet({...item,checked:!!read('ticks')[id]},total,undefined,{inventoryNow:true}),finish:()=>copy(ctx.bb83TransferBought())};
}


const PLAN='basketboss_shop_pack_ui_v1';
const choice=(quantity,unit='g',extra={})=>({kind:'pack',packQuantity:quantity,packCount:1,quantity,unit,label:'pack',boughtQtyOverride:quantity,...extra});
const rice=(patch={})=>fixture({name:'Rice',unit:'g',required:600,pantryUsed:0,toBuy:600,quote:{amount:10,packQty:1000,packUnit:'g',packAmount:10,portionAmount:6},...patch});
const save=(h,selection,item=h.item,pin=h.ctx.bbShopPurchaseViewPin(item))=>h.ctx.bbShopPurchaseSaveView(item,selection,pin);
function toggle(h,checked=false){
 const item={...h.item,checked},box={isConnected:true,checked,dispatchEvent(event){assert.equal(event.type,'change');h.check(this.checked);}};
 item.box=box;h.ctx.bb172StorefrontToggle(h.ctx.bbShopPurchaseViewItem(item));return item;
}
const balances=h=>Object.fromEntries([...h.values].filter(([key])=>key!==PLAN));

test('saving an unticked buying choice changes only the UI sidecar, not stock, demand, prices or purchase history',()=>{
 const h=rice(),before=balances(h),basket=copy(h.basket);
 assert.equal(save(h,choice(500)).ok,true);
 assert.deepEqual(balances(h),before);assert.deepEqual(h.basket,basket);
 const view=h.ctx.bbShopPurchaseViewItem(h.item);assert.equal(view.boughtQtyOverride,500);assert.equal(view.defaultPackQty,1000);assert.equal(view.baseEstimatedPrice,10);assert.equal(view.priceOverride,5);
 assert.equal(h.ctx.bbShopPurchaseViewContext(h.item).unit,'g');assert.equal(h.read(PLAN).plans[0].selection.quantity,500);
});

test('the optional price view prorates selected physical totals and manual totals without changing the source quote or summary',()=>{
 const h=rice(),summary={items:[h.basket],essentials:[],remainingTotal:10,remainingPending:0,total:99,pending:0},original=copy(summary);
 assert.equal(h.ctx.bbShopPurchaseEstimate(summary),summary,'no plan preserves the original price result exactly');
 assert.equal(save(h,choice(500)).ok,true);
 let display=h.ctx.bbShopPurchaseEstimate(summary);assert.equal(display.remainingTotal,5);assert.equal(display.total,99);assert.equal(display.items,summary.items);assert.deepEqual(summary,original);
 assert.equal(save(h,choice(500,'g',{priceOverride:7.5})).ok,true);display=h.ctx.bbShopPurchaseEstimate(summary);assert.equal(display.remainingTotal,7.5);
 assert.equal(h.ctx.bbShopPurchaseQuote(h.basket).packAmount,7.5);assert.equal(h.basket.priceQuote.packAmount,10);assert.equal(h.basket.priceQuote.amount,10);
});

test('a chosen pack ticks through the existing purchase transaction once and Finish/reload cannot add it twice',()=>{
 const h=rice({required:400,toBuy:400});assert.equal(save(h,choice(500)).ok,true);
 toggle(h);assert.equal(h.read('stock')['rice|g'],500);assert.equal(h.read('purchases')[h.id].actualQty,500);assert.equal(h.read('ticks')[h.id],true);
 toggle(h);assert.equal(h.read('stock')['rice|g'],500);assert.equal(h.finish().count,0);
 const snapshot=JSON.stringify(h.read('session'));h.storage.setItem('session',snapshot);assert.equal(h.ctx.bbShopPurchaseViewItem(h.item).boughtQtyOverride,500);assert.equal(h.read('stock')['rice|g'],500);
 toggle(h,true);assert.equal(h.read('stock')['rice|g'],undefined);assert.equal(h.read('ticks')[h.id],undefined);
});

test('a selected amount below the shortfall records real partial stock and does not falsely complete the item',()=>{
 const h=rice();assert.equal(save(h,choice(500)).ok,true);toggle(h);
 assert.equal(h.read('stock')['rice|g'],500);assert.equal(h.read('ticks')[h.id],undefined);assert.equal(h.read('partials')['shop-net-test|'+h.id].bought,500);assert.equal(h.finish().count,0);
 assert.equal(save(h,choice(1000)).ok,true);assert.equal(h.read('stock')['rice|g'],1000);assert.equal(h.read('purchases')[h.id].actualQty,1000);
 assert.equal(h.amount(0),true);assert.equal(h.read('stock')['rice|g'],undefined);
});

test('without an explicit plan the original default pack checkbox and undo path remain unchanged',()=>{
 const h=rice();toggle(h);assert.equal(h.read('stock')['rice|g'],1000);assert.equal(h.read('purchases')[h.id].actualQty,1000);assert.equal(h.storage.getItem(PLAN),null);
 toggle(h,true);assert.equal(h.read('stock')['rice|g'],undefined);
});

test('kilogram and litre views store canonical physical totals and convert only the handler input back to its native unit',()=>{
 for(const [name,unit,base]of [['Rice','kg','g'],['Milk','l','ml']]){
  const h=rice({name,unit,required:.6,toBuy:.6,quote:{amount:10,packQty:1,packUnit:unit,packAmount:10}}),chosen=choice(500,base);
  assert.equal(save(h,chosen).ok,true);const view=h.ctx.bbShopPurchaseViewItem(h.item);assert.equal(view.boughtQtyOverride,500);assert.equal(h.ctx.bbShopPurchaseNativeTotal(h.item,chosen),.5);
  toggle(h);assert.equal(h.read('stock')[name.toLowerCase()+'|'+base],500);assert.equal(h.read('partials')['shop-net-test|'+h.id].bought,.5);
 }
});

test('garlic cloves keep ten canonical cloves per chosen bulb without changing the pack or unit contracts',()=>{
 const h=rice({name:'Garlic',unit:'clove',required:2,toBuy:2,quote:{amount:.6,packQty:10,packUnit:'clove',packAmount:.6}});
 const recommended=h.ctx.bbShopPurchaseRecommended(h.item,2);assert.equal(recommended.unit,'each');assert.equal(recommended.quantity,10);assert.equal(recommended.label,'bulb');
 assert.equal(save(h,{...recommended,packCount:2,quantity:20,boughtQtyOverride:20}).ok,true);toggle(h);assert.equal(h.read('stock')['garlic|each'],20);
});

test('the Coleslaw tub default is UI-only, preserves its base price, and credits the shown 300g through the normal handler',()=>{
 const h=rice({name:'Prepared coleslaw',required:100,toBuy:100});const original=copy(h.basket),summary={items:[h.basket],essentials:[],remainingTotal:10,remainingPending:0};
 const view=h.ctx.bbShopPurchaseViewItem(h.item);assert.equal(view.defaultPackQty,300);assert.equal(view.boughtQtyOverride,undefined);assert.equal(view.uiDefaultPurchase.quantity,300);assert.equal(view.baseEstimatedPrice,10);
 assert.equal(h.ctx.bbShopPurchaseEstimate(summary),summary);assert.equal(h.ctx.bb84DisplayedPurchase(h.basket,100),1000);assert.deepEqual(h.basket,original);
 toggle(h);assert.equal(h.read('stock')['prepared coleslaw|g'],300);assert.equal(h.read('purchases')[h.id].actualQty,300);assert.equal(h.storage.getItem(PLAN),null);
});

for(const mode of ['actor','account','trip','unit'])test('a '+mode+' change rejects a stale picker save without touching its purchase or UI state',()=>{
 const h=rice(),pin=h.ctx.bbShopPurchaseViewPin(h.item);
 if(mode==='actor')h.ctx.window.BBHome.actor=()=> 'other';
 if(mode==='account')h.storage.setItem('basketboss_cloud_session_v1',JSON.stringify({user:{id:'tester'},access_token:'new-session'}));
 if(mode==='trip')h.storage.setItem('session',JSON.stringify({...h.read('session'),id:'shop-new'}));
 if(mode==='unit')h.item.basketItem.unit='unknown-unit';
 const before=new Map(h.values);assert.equal(save(h,choice(500),h.item,pin).ok,false);assert.deepEqual(h.values,before);
});

test('UI sidecar quota failure cannot mark a purchase bought or credit pantry stock',()=>{
 const h=rice(),before=new Map(h.values),put=h.storage.setItem;
 h.storage.setItem=(key,value)=>{if(key===PLAN)throw Error('synthetic quota');put(key,value);};
 assert.equal(save(h,choice(500)).ok,false);assert.deepEqual(h.values,before);
});

test('failure correcting an already-bought quantity restores the prior UI plan and all transactional balances',()=>{
 const h=rice();assert.equal(h.check(true),true);const before=new Map(h.values),put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key==='inventory'&&fail){fail=false;throw Error('synthetic quota');}put(key,value);};
 const item={...h.item,checked:true};assert.equal(save(h,choice(500),item).ok,false);assert.deepEqual(h.values,before);
});

test('a price-only edit is view-only even after the bought stock has been used, while quantity correction remains guarded',()=>{
 const h=rice();assert.equal(h.check(true),true);h.storage.setItem('stock',JSON.stringify({'rice|g':900}));const item={...h.item,checked:true},before=balances(h);
 assert.equal(save(h,choice(1000,'g',{priceOverride:7.5}),item).ok,true);assert.deepEqual(balances(h),before);
 const saved=new Map(h.values);assert.equal(save(h,choice(500,'g',{priceOverride:4}),item).ok,false);assert.deepEqual(h.values,saved);
});

test('unknown, cross-dimension and unsupported fractional purchase units cannot be persisted as a buying override',()=>{
 const h=rice(),before=new Map(h.values);
 for(const selected of [choice(500,'ml'),choice(.000001),choice(1.5,'each'),choice(NaN)]){assert.equal(save(h,selected).ok,false);assert.deepEqual(h.values,before);}
 const count=rice({name:'Eggs',unit:'each',required:6,toBuy:6});assert.equal(save(count,choice(1.5,'each')).ok,false);assert.equal(count.storage.getItem(PLAN),null);
 const produce=rice({name:'Potato',unit:'each',required:3,toBuy:3});assert.equal(produce.ctx.bbShopPurchaseViewContext(produce.item).unit,'each');assert.equal(save(produce,choice(500,'g')).ok,false);
});

test('readable view labels leave all exact reconciliation fields and source objects untouched',()=>{
 const h=rice(),item={key:'Chicken breast',unit:'g',required:666.666667,pantryUsed:200,toBuy:466.666667,priceQuote:{packQty:1000,packUnit:'g'}},before=copy(item);
 const exact=h.ctx.bbShopNeedPresentation(item),display=h.ctx.bbShopPurchaseNeedView(item);assert.equal(display.primary,'467 g needed');assert.deepEqual(item,before);
 for(const key of ['required','atHome','bought','targetQuantity','needed','purchaseQuantity','packCount','packQty','packUnit','checked'])assert.equal(display[key],exact[key],key);
 assert.equal(h.ctx.bbShopNeedPresentation({key:'Carrot',unit:'each',required:.5,pantryUsed:0,toBuy:.5}).primary,'0.5 needed');
 assert.match(h.ctx.bbShopPurchaseNeedView({key:'Eggs',unit:'each',required:.666667,pantryUsed:0,toBuy:.666667}).primary,/^1(?: egg)? needed$/);
 assert.equal(h.ctx.bbShopPurchaseNeedView({key:'Garlic',unit:'each',required:1.333333,pantryUsed:0,toBuy:1.333333}).primary,'2 cloves needed');
 assert.equal(h.ctx.bbShopPurchaseNeedView({key:'Rice',unit:'g',required:.000001,pantryUsed:0,toBuy:.000001}).primary,'<1 g needed');
 assert.doesNotMatch(display.secondary,/Buy \d.*pack/);
});


test('ordinary Shop rows mount the same Buying picker without replacing checkboxes, names, quantities or their handlers',()=>{
 const h=rice(),created=[],mounted=[],stockBefore=balances(h),box={dataset:{bb321Tick:h.id},checked:false,id:'original-check',onchange(){return 'original-handler';}},amount={textContent:'600 g needed',before(node){mounted.push(node);}},quantity={after(node){mounted.push(node);}};
 const make=tag=>({tagName:tag,children:[],append(...nodes){this.children.push(...nodes);}}),button=make('button'),editor=make('section');
 const row={dataset:{bb321Row:'0'},classList:{add(value){this.value=value;}},querySelector(selector){return selector==='[data-bb321-tick]'?box:selector==='.bb321-shop-quantity strong'?amount:selector==='.bb321-shop-quantity'?quantity:null;}};
 const app={ownerDocument:{createElement:make},querySelectorAll(selector){assert.equal(selector,'.bb321-buy-row');return [row];}};
 h.ctx.window.BBShopPurchaseUI={...purchaseUI,createPicker(options){created.push(options);return {button,editor,open(){},close(){}};}};
 const map=new Map([[h.id,{item:h.basket,essential:false}]]),handler=box.onchange;
 h.ctx.bbShopPurchaseAttachRows(app,map);assert.equal(created.length,1);assert.equal(created[0].needed,600);assert.equal(created[0].recommended.quantity,1000);assert.equal(created[0].unit,'g');
 assert.equal(mounted[0].children[0],amount);assert.equal(mounted[0].children[1],button);assert.equal(mounted[1],editor);assert.equal(box.id,'original-check');assert.equal(box.onchange,handler);assert.equal(amount.textContent,'600 g needed');assert.equal(row.dataset.bb321Row,'0');assert.deepEqual(balances(h),stockBefore);
 h.ctx.bbShopPurchaseAttachRows(app,map);assert.equal(created.length,1,'repeated enhancement cannot create duplicate Buying controls');
 assert.equal(created[0].onSave(choice(500)).ok,true);assert.equal(h.ctx.bbShopPurchaseViewItem(h.item).boughtQtyOverride,500);assert.deepEqual(balances(h),stockBefore,'the desktop picker still saves a plan rather than buying stock');
});
