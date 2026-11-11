import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const ui=createRequire(import.meta.url)('../bb-shop-purchase-ui.js');
const source=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function actual(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);assert.ok(start>=0&&end>start,name+' remains available');return source.slice(start,end+2);}
function between(startText,endText,from=0){const start=source.indexOf(startText,from),end=source.indexOf(endText,start);assert.ok(start>=0&&end>start,startText+' remains available');return source.slice(start,end);}
function fixture({ready=false,load=()=>Promise.resolve()}={}){
 const calls={loads:0,primary:[],partial:[],extra:[],dispatch:[],render:0,refresh:0,keep:0,prepare:0,tickWrites:[],notices:[]};
 const values=new Map([['basketboss_321_v7_measured_pantry','{"rice|g":450}'],['basketboss_shop_ticks','{"already":true}'],['basketboss_costs','{"paid":3}']]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const win={BBKitchenEssentials:{loadRules(){calls.loads++;return load(win);}},BBShopOwnership:{enabled:()=>true},BBShopPurchaseUI:ui};
 if(ready)win.BBKitchenChoiceRules={isHousehold:()=>false};
 const scope=vm.createContext({window:win,localStorage:storage,console,notify:message=>calls.notices.push(message),
  Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},
  bb172StorefrontKeepItem:()=>calls.keep++,bb172StorefrontRefresh:()=>calls.refresh++,render:()=>calls.render++,
  bbShopPurchaseReviewForTick:()=>false,bbShopPurchaseViewItem:item=>item,bbShopPurchaseViewCurrent:()=>true,
  bbShopPurchaseNativeTotal:(_item,selection)=>selection.quantity,bbPartialDetails:()=>null,
  bbPartialSet:(...args)=>{calls.partial.push(args);return true;},bb84SetPrimaryPurchase:(...args)=>{calls.primary.push(args);return true;},
  bb84RecordExtra:(...args)=>{calls.extra.push(args);return true;},bb321ReadShopTicks:()=>({already:true}),bb321WriteShopTicks:value=>{calls.tickWrites.push(value);return true;},bb84SavedPurchased:()=>1000,
  bbShopPurchaseListItem:(item,essential)=>({id:'rice|g',name:item.key,basketItem:item,essential}),
  BB307_NORMALIZED:[],BBPriceV19:{canonical:name=>name.toLowerCase(),recipeIngredientUnit:row=>row.unit},BB307Pantry:{pantryName:name=>name.toLowerCase()},getRecipe:()=>({ingredients:[]})});
 vm.runInContext(actual('bbShopPurchaseRulesReady'),scope);
 return {scope,win,calls,values,storage,ready:()=>scope.bbShopPurchaseRulesReady()};
}

test('readiness requests loading while absent, waits for a delayed module and never performs a purchase',async()=>{
 let release;const h=fixture({load:win=>new Promise(resolve=>{release=()=>{win.BBKitchenChoiceRules={isHousehold:()=>false};resolve();};})}),before=[...h.values];
 assert.equal(h.ready(),false);assert.equal(h.calls.loads,1);assert.deepEqual([...h.values],before);
 release();await Promise.resolve();assert.equal(h.ready(),true);assert.equal(h.calls.loads,1);
 assert.equal(h.calls.primary.length+h.calls.partial.length+h.calls.tickWrites.length,0);
 const absent=fixture();assert.equal(absent.ready(),false);assert.equal(absent.ready(),false);assert.equal(absent.calls.loads,2,'the loader owns request deduplication');
});

test('failed or throwing rule loaders stay closed without an unhandled rejection or storage write',async()=>{
 for(const load of [()=>Promise.reject(Error('fixture import rejected')),()=>{throw Error('fixture loader unavailable');}]){
  const h=fixture({load}),before=[...h.values];assert.equal(h.ready(),false);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual([...h.values],before);assert.equal(h.calls.primary.length+h.calls.partial.length+h.calls.tickWrites.length,0);
 }
 const h=fixture();delete h.win.BBKitchenEssentials;assert.equal(h.ready(),false);
});

test('storefront check and undo stop before changing the authoritative checkbox while rules are missing',()=>{
 for(const checked of [false,true]){
  const h=fixture(),before=[...h.values],box={isConnected:true,checked,dispatchEvent:event=>h.calls.dispatch.push(event)};
  vm.runInContext(actual('bb172StorefrontToggle'),h.scope);h.scope.bb172StorefrontToggle({id:'rice|g',checked,box});
  assert.equal(box.checked,checked);assert.equal(h.calls.dispatch.length,0);assert.equal(h.calls.keep,0);assert.equal(h.calls.primary.length+h.calls.partial.length,0);assert.equal(h.calls.loads,1);assert.equal(h.calls.refresh,1);assert.deepEqual([...h.values],before);
 }
});

test('a ready storefront keeps the original change dispatch or selected-quantity owner delegation',()=>{
 for(const checked of [false,true]){
  const h=fixture({ready:true}),box={isConnected:true,checked,dispatchEvent:event=>h.calls.dispatch.push(event)};
  vm.runInContext(actual('bb172StorefrontToggle'),h.scope);h.scope.bb172StorefrontToggle({id:'rice|g',checked,box});
  assert.equal(box.checked,!checked);assert.equal(h.calls.dispatch.length,1);assert.equal(h.calls.dispatch[0].type,'change');assert.equal(h.calls.dispatch[0].bubbles,true);assert.equal(h.calls.loads,0);
 }
 const h=fixture({ready:true}),box={isConnected:true,checked:false,dispatchEvent:event=>h.calls.dispatch.push(event)},selection={quantity:500};
 vm.runInContext(actual('bb172StorefrontToggle'),h.scope);h.scope.bb172StorefrontToggle({id:'rice|g',checked:false,box,boughtQtyOverride:500,purchaseSelection:selection});
 assert.equal(h.calls.dispatch.length,0);assert.equal(h.calls.partial.length,1);assert.equal(h.calls.partial[0][1],500);assert.deepEqual(plain(h.calls.partial[0][3]),{inventoryNow:true});assert.equal(box.checked,false);
});

function nativeHandler(h,boxes,purchaseMap=new Map()){
 h.scope.app={querySelectorAll:()=>boxes};h.scope.purchaseMap=purchaseMap;h.scope.purchaseViewPins=new Map();
 const block=between(" app.querySelectorAll('[data-bb321-tick]').forEach(el=>{",'\n bbShopPurchaseAttachRows(app,purchaseMap);');vm.runInContext(block,h.scope);
}
test('the real native checkbox handler restores checks and unchecks before reading item identity when unavailable',()=>{
 for(const previous of [false,true]){
  const h=fixture(),before=[...h.values];let identityReads=0,stopped=0;
  const box={checked:!previous,addEventListener(){},get dataset(){identityReads++;return {bb321Tick:'rice|g'};}};nativeHandler(h,[box]);
  box.onchange({stopPropagation(){stopped++;}});assert.equal(box.checked,previous);assert.equal(identityReads,0);assert.equal(stopped,1);assert.equal(h.calls.loads,1);assert.deepEqual([...h.values],before);assert.equal(h.calls.primary.length+h.calls.partial.length+h.calls.extra.length+h.calls.tickWrites.length,0);
 }
});

test('the ready native checkbox retains the existing purchase handler and its original arguments',()=>{
 const h=fixture({ready:true}),item={key:'Rice',unit:'g',toBuy:250},box={checked:true,dataset:{bb321Tick:'rice|g'},addEventListener(){}};
 nativeHandler(h,[box],new Map([['rice|g',{item,essential:false}]]));box.onchange({stopPropagation(){}});
 assert.equal(h.calls.primary.length,1);assert.equal(h.calls.primary[0][0],'rice|g');assert.equal(h.calls.primary[0][1],true);assert.equal(h.calls.primary[0][2],item);assert.equal(h.calls.primary[0][3],false);assert.deepEqual(plain(h.calls.primary[0][4]),{inventoryNow:true});assert.equal(h.calls.render,1);assert.equal(h.calls.loads,0);
});

test('changing a bought amount rolls back its UI plan when rules are absent while an unbought plan remains view-only',()=>{
 const context={actor:'alice',trip:'trip-one',id:'rice|g',unit:'g'},initial={kind:'pack',packQuantity:1000,packCount:1,quantity:1000,unit:'g',label:'pack',boughtQtyOverride:1000},chosen={...initial,packQuantity:500,quantity:500,boughtQtyOverride:500};
 for(const ready of [false,true]){
  const h=fixture({ready});ui.writePlan(h.storage,context,initial);const before=[...h.values];h.scope.bb321ReadShopTicks=()=>({'rice|g':true});vm.runInContext(actual('bbShopPurchaseSaveView'),h.scope);
  const result=h.scope.bbShopPurchaseSaveView({id:'rice|g'},chosen,{context});assert.equal(result.ok,ready);
  if(!ready){assert.deepEqual([...h.values],before);assert.equal(h.calls.partial.length,0);assert.equal(h.calls.render,0);assert.equal(h.calls.loads,1);}
  else{assert.equal(h.calls.partial.length,1);assert.equal(h.calls.partial[0][1],500);assert.equal(ui.readPlan(h.storage,context).quantity,500);}
 }
 const h=fixture(),beforeStock=h.storage.getItem('basketboss_321_v7_measured_pantry');h.scope.bb321ReadShopTicks=()=>({});vm.runInContext(actual('bbShopPurchaseSaveView'),h.scope);
 assert.equal(h.scope.bbShopPurchaseSaveView({id:'rice|g'},chosen,{context}).ok,true);assert.equal(ui.readPlan(h.storage,context).quantity,500);assert.equal(h.calls.partial.length,0);assert.equal(h.calls.loads,0);assert.equal(h.storage.getItem('basketboss_321_v7_measured_pantry'),beforeStock);
});

test('shared purchases cannot prepare a stock transaction until the rules are available',()=>{
 for(const ready of [false,true]){
  const h=fixture({ready}),before=[...h.values],pin={actor:'alice',household_id:'household-one'};
  h.win.BBHome={prepareSharedPurchase(_item,_checked,actualPin){h.calls.prepare++;assert.equal(actualPin,pin);return {updates:{},expected:{}};}};
  vm.runInContext(between('window.BBSharedShoppingHost=Object.freeze({','\nwindow.BBPantryState='),h.scope);
  const result=h.win.BBSharedShoppingHost.recordPurchase({id:'shared-item',household_id:'household-one',name:'Toilet rolls',quantity:4,unit:'each'},true,pin);
  assert.equal(result,ready);assert.equal(h.calls.prepare,ready?1:0);assert.equal(h.calls.primary.length,ready?1:0);assert.deepEqual([...h.values],before);
  if(ready){assert.equal(h.calls.primary[0][0],'shared:household-one:shared-item');assert.equal(h.calls.primary[0][1],true);assert.equal(h.calls.primary[0][2].qty,4);assert.equal(h.calls.primary[0][3],true);}
 }
});

test('legacy different-amount, reduced-price and already-have callbacks stop before their original owners',()=>{
 const choices=source.indexOf('function bbBetaShopChoiceRow(');
 const callbacks=[
  ["const save=bb172StorefrontButton('Save amount'",'\n  });details.append(save);','partial'],
  ["const saveReduced=bb172StorefrontButton('Save reduced purchase'",'\n  });reduced.append(amountLabel','partial'],
  ["buttons.append(bb172StorefrontButton('Already have enough'",'\n }));','enough']
 ];
 for(const [startText,endText,owner]of callbacks)for(const ready of [false,true]){
  const h=fixture({ready}),before=[...h.values],block=between(startText,endText,choices),body=block.slice(block.indexOf('()=>{')+5);
  h.scope.current=()=>true;h.scope.status={textContent:''};h.scope.input={value:'500'};h.scope.amount={value:'500'};h.scope.paid={value:'3.99'};h.scope.item={id:'rice|g'};h.scope.bbReducedPremium=()=>true;let enough=0;h.scope.bbBetaAlreadyHave=()=>enough++;
  vm.runInContext('this.action=()=>{'+body+'\n};',h.scope);h.scope.action();
  assert.equal(owner==='partial'?h.calls.partial.length:enough,ready?1:0);assert.deepEqual([...h.values],before);
  if(!ready){assert.match(h.scope.status.textContent,/still loading/);assert.equal(h.calls.loads,1);}
 }
});
