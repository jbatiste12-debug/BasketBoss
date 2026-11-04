import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),deduction=require('../bb-pantry-deduction.js'),homeModule=require('../bb-home.js');
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory',SESSION='basketboss_cloud_session_v1',ACTOR='pantry_policy_flow_user';
function actualFunction(html,name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name+' exists in the app');
 const firstEnd=html.indexOf('\n',start),first=html.slice(start,firstEnd);if(first.endsWith('}'))return first;
 const end=html.indexOf('\n}',start);assert.ok(end>start,name+' has its complete body');return html.slice(start,end+2);
}
const entry=(name,quantity,unit,extra={})=>({name,loc:'cupboard',selected:true,qty:quantity,unit,bb173StockKey:name.toLowerCase()+'|'+unit,bb173StockValue:quantity,...extra});
function fixture({stock={},inventory={},ingredients=[],entrypoint='index.html'}={}){
 const html=read(entrypoint),values=new Map([[STOCK,JSON.stringify(stock)],[INVENTORY,JSON.stringify(inventory)],[SESSION,JSON.stringify({user:{id:ACTOR},access_token:'pantry-policy-test-token'})]]),writes=[],syncs=[],state={ingredients:copy(ingredients)};
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push(key);},removeItem:key=>{values.delete(key);writes.push(key);}};
 const win={localStorage:storage,location:{search:''},document:{},BBPantryPolicy:policy,BBPantryNormalize:receiptCore.normalizePantryState,BBPantryDeduction:deduction,BBReceiptHost:{hasPendingConfirmation:()=>false,canConsumePantry:()=>true,requiresPantryReview:()=>false,confirmCookedPantry:async value=>{syncs.push(copy(value));return {ok:true};}}};
 const ctx=vm.createContext({window:win,localStorage:storage,console,BB307_STOCK_KEY:STOCK,bb307Market:'UK',BB_WHOLE_PRODUCE_GRAMS:{}});
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(read(file),ctx);
 ctx.BBPriceV19=win.BBPriceV19||ctx.BBPriceV19;
 const pantryStart=html.indexOf('const BB307Pantry=(()=>{'),pantryEnd=html.indexOf('// BasketBoss 321 v7 original-design',pantryStart);
 vm.runInContext(html.slice(pantryStart,pantryEnd)+'\nthis.pantry=BB307Pantry;',ctx);const pantry=ctx.pantry;
 const lunchStart=html.indexOf('const BB321Lunch=(()=>{'),lunchEnd=html.indexOf('/* BasketBoss 321 v8 — School Lunchboxes',lunchStart);
 vm.runInContext(html.slice(lunchStart,lunchEnd),ctx);
 Object.assign(ctx,{bb307Stock:{...stock},bb307ReadStock:()=>JSON.parse(storage.getItem(STOCK)),bbReceiptPantryReviewRequired:()=>false,bbReceiptHasAuthoritativePantry:()=>true,bbBetaStockForCurrentWeek:value=>value,bbHomeLegacyPantry:()=>({}),bb321LunchboxRequirements:()=>[]});
 for(const name of ['bbHomePhysicalStock','bbHomeStapleState','bbHomeApplyStapleShopping','bbHomeShoppingMeasure','bbHomeConversionContext','bbPantryReconcileStock','bb321UnifiedShop'])vm.runInContext(actualFunction(html,name),ctx);
 const bridge=html.split('\n').find(line=>line.startsWith('window.BBPantryState='));if(bridge)vm.runInContext(bridge,ctx);
 ctx.BB172_STAPLES_KEY='basketboss_v172_assumed_staples_v1';
 for(const name of ['bb172StapleSaved','bb172StapleAssumesOnHand'])vm.runInContext(actualFunction(html,name),ctx);
 const occurrence=(id,day)=>'policy-week|dinner|'+day+'|'+id;
 const host={id:pantry.pantryId,keys:()=>({stock:STOCK,inventory:INVENTORY}),stock:ctx.bbHomePhysicalStock,conversionContext:ctx.bbHomeConversionContext,
  recipeIngredients:(_id,factor)=>state.ingredients.map(value=>({...value,required:value.required*factor})),occurrence,refresh(){},household:()=>[],requirements:()=>state.ingredients,
  shoppingKind:()=> 'food',shoppingMeasure:ctx.bbHomeShoppingMeasure,shoppingPurchaseContext:()=>({shopSessionId:'policy-trip',quantity:0})};
 win.BBHomeHost=host;win.BBHome=homeModule.install(win);
 vm.runInNewContext(read('bb-receipt-inventory.js'),{window:win,console});
 const catalog={'ketchup|ml':{},'soy sauce|ml':{},'olive oil|ml':{},'honey|g':{},'rice|g':{},'chopped tomatoes|g':{},'spinach|g':{},'beef mince|g':{},'milk|ml':{},'garlic|clove':{}};
 const adapter=win.BBReceiptInventoryFactory({storage,core:receiptCore,pantryPolicy:true,getSession:()=>JSON.parse(storage.getItem(SESSION)),getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'policy-trip'}),canonicalize:name=>pantry.pantryName(name),getCatalog:()=>catalog});
 const event=(sessionId='first',day='Monday')=>({sessionId,recipeId:'policy-meal',day,factor:1,actorId:ACTOR,occurrence:occurrence('policy-meal',day)});
 return {html,values,writes,storage,win,ctx,state,pantry,home:win.BBHome,adapter,event,syncs,stock:()=>JSON.parse(storage.getItem(STOCK)),inventory:()=>JSON.parse(storage.getItem(INVENTORY)),
  shopping:()=>copy(ctx.bb321UnifiedShop(state.ingredients.map(value=>({...value,toBuy:value.required,pantryUsed:0,spend:null,sharedAcrossRecipes:1})))),
  async cook(sessionId='first',day='Monday'){const value=event(sessionId,day),preview=win.BBHome.previewCook(value);assert.equal(preview.ok,true,preview.message);return win.BBHome.cooked({...value,expected:preview.fingerprint});},
  receipt(receiptId,name,quantity,unit,extra={}){return adapter.commitLocalReceipt({receiptId,market:'UK',retailer:'Tesco',shopSessionId:'policy-trip',stockPantry:true,items:[{key:name,name,classification:'food',sourceKind:'purchase',quantity,unit,lineTotal:2,reviewed:true,...extra}]});}};
}

function finish(h,item){
 const receiptKey='basketboss_purchase_receipts_v1',read=key=>JSON.parse(h.storage.getItem(key)||'{}'),ledger='basketboss_shop_stock_ledger_v1';
 const ctx=vm.createContext({window:h.win,console,localStorage:h.storage,BB307Pantry:h.pantry,BBPriceV19:h.ctx.BBPriceV19,bb307Market:'UK',BB83_KITCHEN_INVENTORY:INVENTORY,BB83_SHOP_STOCK_LEDGER:ledger,BB307_STOCK_KEY:STOCK,BB_BETA_RECEIPT_KEY:receiptKey,bb307FeatureState:{essentials:[]},bb307Stock:h.stock(),
  bbHomePhysicalStock:()=>h.stock(),bb83ReadObject:read,bbBetaReceiptRead:()=>read(receiptKey),bbBetaShopWeek:()=> 'policy-trip',bbBetaReceiptId:id=>'policy-trip|'+id,
  bb321ReadShopTicks:()=>({}),bb84ReadPurchased:()=>({}),bbBetaPurchaseChoices:()=>({}),bb307Plan:()=>({items:h.state.ingredients}),bb321UnifiedShop:()=>h.shopping(),
  bbBetaPendingBought:()=>read(receiptKey)['policy-trip|'+item.id]?[]:[item],bbBetaChoiceInfo:()=>({mode:'exact',unit:item.unit,qty:item.qty}),bbBetaDryVolumeUnit:()=>false,bbBetaIsPerishable:()=>false,bb83StockLoc:()=> 'cupboard',bb83KitchenName:name=>name.toLowerCase()});
 for(const name of ['bbHomePendingHouseholdPurchases','bb83TransferBought'])vm.runInContext(actualFunction(h.html,name),ctx);
 return ()=>ctx.bb83TransferBought();
}

for(const entrypoint of ['index.html','app.html']){
 test(entrypoint+': repeated meals check an in-stock condiment without spending its container or adding a shortfall',async()=>{
  const h=fixture({entrypoint,stock:{'ketchup|each':1,'rice|g':500},inventory:{ketchup:entry('Ketchup',1,'each',{staple:true,stapleStatus:'in'}),rice:entry('Rice',500,'g')},ingredients:[{key:'ketchup',required:15,unit:'ml'},{key:'rice',required:100,unit:'g'}]});
  assert.equal(h.win.BBHomeHost.conversionContext().pantryMode,true);
  const before=[...h.values],preview=h.home.previewCook(h.event());assert.equal(preview.ok,true);const staple=preview.rows.find(row=>row.staple);
  assert.equal(staple?.covered,true);assert.equal(staple.deduct,0);assert.deepEqual(staple.allocations,[]);assert.deepEqual([...h.values],before,'review is read-only');
  assert.equal(h.shopping().find(row=>row.key.toLowerCase()==='ketchup')?.toBuy||0,0);
  assert.equal((await h.cook()).ok,true);assert.deepEqual(h.stock(),{'ketchup|each':1,'rice|g':400});
  assert.equal((await h.cook('next','Tuesday')).ok,true);assert.deepEqual(h.stock(),{'ketchup|each':1,'rice|g':300});
  assert.equal(h.inventory().ketchup.stapleStatus,'in');assert.equal(h.inventory().ketchup.qty,1);
  assert.equal((await h.home.cooked(h.event('same-occurrence','Tuesday'))).already,true);assert.equal(h.stock()['ketchup|each'],1);
 });
}

test('explicit Low and Out request one condiment container while preserving food and not summing recipe millilitres',()=>{
 for(const status of ['low','out']){
  const count=status==='low'?1:0,h=fixture({stock:count?{'ketchup|each':count}:{},inventory:{ketchup:entry('Ketchup',count,'each',{staple:true,stapleStatus:status})},ingredients:[{key:'ketchup',required:15,unit:'ml'},{key:'ketchup',required:1,unit:'tbsp'}]});
  const before=[...h.values],rows=h.shopping().filter(row=>row.key.toLowerCase()==='ketchup'&&row.toBuy>0);
  assert.equal(rows.length,1,status+' produces one restock row');assert.equal(rows[0].unit,'each');assert.equal(rows[0].toBuy,1);assert.deepEqual([...h.values],before);
 }
});

test('a staple receipt adds a container to the existing row, clears Low and is idempotent',async()=>{
 const h=fixture({stock:{'ketchup|each':1},inventory:{ketchup:entry('Ketchup',1,'each',{staple:true,stapleStatus:'low'})},ingredients:[{key:'ketchup',required:15,unit:'ml'}]});
 assert.equal((await h.receipt('ketchup-800-ml-receipt','Ketchup',800,'ml')).ok,true);
 assert.deepEqual(h.stock(),{'ketchup|each':2});const rows=Object.values(h.inventory()).filter(row=>row.selected&&policy.isStaple(row.name));assert.equal(rows.length,1);assert.equal(rows[0].qty,2);assert.equal(rows[0].unit,'each');assert.equal(rows[0].stapleStatus,'in');
 assert.equal((await h.receipt('ketchup-800-ml-receipt','Ketchup',800,'ml')).duplicate,true);assert.equal(h.stock()['ketchup|each'],2);assert.equal(h.shopping().find(row=>row.key.toLowerCase()==='ketchup')?.toBuy||0,0);
});

test('one tomato tin plus a measured receipt becomes one 800 g physical record usable by the next recipe',async()=>{
 const h=fixture({stock:{'chopped tomatoes|tin':1},inventory:{tomatoes:entry('Chopped tomatoes',1,'tin')},ingredients:[{key:'chopped tomatoes',required:600,unit:'g'}]});
 assert.equal((await h.receipt('tomato-400-g-receipt','Chopped tomatoes',400,'g')).ok,true);assert.deepEqual(h.stock(),{'chopped tomatoes|g':800});
 const rows=Object.values(h.inventory()).filter(row=>row.selected&&policy.canonicalName(row.name)==='chopped tomatoes');assert.equal(rows.length,1);assert.equal(rows[0].qty,800);assert.equal(rows[0].unit,'g');assert.equal(h.shopping()[0].toBuy,0);
 assert.equal((await h.cook()).ok,true);assert.deepEqual(h.stock(),{'chopped tomatoes|g':200});assert.equal(h.shopping()[0].toBuy,400);
});

test('UK container rules cover and deduct actual measured ingredients without inventing an unknown bag size',async()=>{
 for(const [name,sourceUnit,sourceAmount,recipeAmount,recipeUnit]of [['Spinach','bag',1,100,'g'],['Beef mince','pack',1,250,'g'],['Milk','pint',1,284,'ml'],['Garlic','clove',2,1,'each']]){
  const key=name.toLowerCase()+'|'+sourceUnit,h=fixture({stock:{[key]:sourceAmount},inventory:{item:entry(name,sourceAmount,sourceUnit)},ingredients:[{key:name.toLowerCase(),required:recipeAmount,unit:recipeUnit}]});
  assert.equal(h.shopping()[0].toBuy,0,name);const preview=h.home.previewCook(h.event());assert.equal(preview.ok,true);assert.equal(preview.rows[0].deduct,recipeAmount,name);assert.equal((await h.cook()).ok,true);assert.ok(Object.values(h.stock()).every(qty=>qty>=0));
 }
 const h=fixture({stock:{'rice|bag':1},inventory:{rice:entry('Rice',1,'bag')},ingredients:[{key:'rice',required:100,unit:'g'}]}),before=h.stock();
 const preview=h.home.previewCook(h.event());assert.equal(preview.ok,true);assert.equal(preview.rows[0].deduct,0);assert.ok(preview.issues.length);assert.match(preview.rows[0].issueLabel,/review/i);
 const shopping=h.shopping();assert.equal(shopping[0].toBuy,100);assert.ok(shopping[0].pantryMismatch.length);assert.deepEqual(h.stock(),before);assert.equal((await h.cook()).ok,true);assert.deepEqual(h.stock(),before);
});

test('explicit manual condiment purchases stay additional buys and retain their actual container count',()=>{
 for(const [text,expected]of [['800 ml',1],['2 bottles (800 ml)',2],['3 bottles',3]]){
  const h=fixture({stock:{'ketchup|each':1},inventory:{ketchup:entry('Ketchup',1,'each',{staple:true,stapleStatus:'in'})},ingredients:[{key:'ketchup',required:15,unit:'ml'}]}),request={name:'Ketchup',quantityText:text,actorId:ACTOR,requestId:'manual-ketchup-'+expected};
  const result=h.home.addShoppingBuy(request);assert.equal(result.ok,true,result.message);
  const buys=h.home.shoppingBuys();assert.equal(buys.length,1);assert.equal(buys[0].unit,'each');assert.equal(buys[0].quantity,expected,text);
  const rows=h.shopping().filter(row=>row.toBuy>0);assert.equal(rows.length,1);assert.equal(rows[0].unit,'each');assert.equal(rows[0].toBuy,expected,'manual top-ups remain additional even when in stock');
  assert.equal(h.home.addShoppingBuy(request).already,true);assert.equal(h.home.shoppingBuys()[0].quantity,expected);assert.deepEqual(h.stock(),{'ketchup|each':1},'requesting a purchase is not a stock deposit');
 }
});

test('informal manual purchases resolve to the same UK base units as recipes and preserve unknown containers',()=>{
 for(const [name,text,quantity,unit]of [['Chopped tomatoes','1 tin',400,'g'],['Spinach','1 bag',200,'g'],['Beef mince','1 pack',500,'g'],['Milk','1 pint',568,'ml'],['Garlic','1 clove',1,'each']]){
  const h=fixture(),result=h.home.addShoppingBuy({name,quantityText:text,actorId:ACTOR,requestId:'manual-'+name});assert.equal(result.ok,true,name+': '+result.message);
  const buy=h.home.shoppingBuys()[0];assert.equal(buy.quantity,quantity,name);assert.equal(buy.unit,unit,name);assert.deepEqual(h.stock(),{});
 }
 const h=fixture(),result=h.home.addShoppingBuy({name:'Rice',quantityText:'1 bag',actorId:ACTOR,requestId:'unknown-rice-bag'});assert.equal(result.ok,true,result.message);assert.equal(h.home.shoppingBuys()[0].quantity,1);assert.equal(h.home.shoppingBuys()[0].unit,'bag');assert.deepEqual(h.stock(),{});
});

test('counted carrots and courgettes immediately cover the matching gram requirement with one shared piece weight',()=>{
 for(const [name,needed,expected]of [['Carrots',762.5,602.5],['Courgette',1000,600]]){
  const raw=name.toLowerCase()+'|each',h=fixture({stock:{[raw]:2},inventory:{food:entry(name,2,'each')},ingredients:[{key:name.toLowerCase(),required:needed,unit:'g'}]});
  const rows=h.shopping().filter(row=>!row.staple);assert.equal(rows.length,1);assert.equal(rows[0].unit,'g');assert.equal(rows[0].toBuy,expected);assert.deepEqual(rows[0].pantryMismatch,[]);
 }
});

test('US fractional weight and fluid-volume manual top-ups store canonical metric quantities',()=>{
 for(const [name,text,quantity,unit]of [['Rice','0.5 lb',226.8,'g'],['Rice','1.5 oz',42.525,'g'],['Milk','0.5 fl oz',15,'ml'],['Milk','1 pint',473,'ml'],['Rice','1 cup',185,'g']]){
  const h=fixture();h.ctx.bb307Market='US';const result=h.home.addShoppingBuy({name,quantityText:text,actorId:ACTOR,requestId:'US-'+name});assert.equal(result.ok,true,result.message);
  const buy=h.home.shoppingBuys()[0];assert.equal(buy.quantity,quantity);assert.equal(buy.unit,unit);
 }
});

test('an older on-hand shortcut never hides a newly Low or Out staple restock',()=>{
 for(const status of ['low','out']){
  const count=status==='low'?1:0,h=fixture({stock:count?{'ketchup|each':1}:{},inventory:{ketchup:entry('Ketchup',count,'each',{staple:true,stapleStatus:status})},ingredients:[{key:'ketchup',required:15,unit:'ml'}]});
  h.storage.setItem('basketboss_v172_assumed_staples_v1',JSON.stringify({ketchup:true}));assert.equal(h.ctx.bb172StapleSaved().ketchup,true);
  const row=h.shopping().find(row=>row.key==='ketchup');assert.equal(row.toBuy,1);assert.equal(h.ctx.bb172StapleAssumesOnHand(row),false);assert.equal(h.ctx.bb172StapleAssumesOnHand({key:'ketchup',unit:'ml'}),false,'the actual summary shortcut consults current pantry status even before row decoration');
 }
});

test('Finish shop credits one staple container, and its later measured receipt cannot credit it again',async()=>{
 const h=fixture({stock:{'ketchup|each':1},inventory:{ketchup:entry('Ketchup',1,'each',{staple:true,stapleStatus:'low'})},ingredients:[{key:'ketchup',required:15,unit:'ml'}]}),apply=finish(h,{id:'ketchup|each',name:'Ketchup',qty:1,unit:'each',aisle:'Cupboard / Pantry'});
 assert.equal(apply().count,1);assert.deepEqual(h.stock(),{'ketchup|each':2});assert.equal(Object.values(h.inventory()).find(row=>row.selected&&policy.isStaple(row.name)).stapleStatus,'in');assert.equal(apply().count,0);assert.equal(h.shopping()[0].toBuy,0);
 assert.equal((await h.receipt('finished-ketchup-receipt','Ketchup',800,'ml')).ok,true);assert.deepEqual(h.stock(),{'ketchup|each':2},'the measured receipt nets the already credited container');
});

test('Finish shop merges an old tomato tin with the measured purchase and receipt netting keeps 800 g',async()=>{
 const h=fixture({stock:{'chopped tomatoes|tin':1},inventory:{tomatoes:entry('Chopped tomatoes',1,'tin')},ingredients:[{key:'chopped tomatoes',required:600,unit:'g'}]}),apply=finish(h,{id:'chopped tomatoes|g',name:'Chopped tomatoes',qty:400,unit:'g',aisle:'Cupboard / Pantry'});
 assert.equal(apply().count,1);assert.deepEqual(h.stock(),{'chopped tomatoes|g':800});assert.equal(Object.values(h.inventory()).filter(row=>row.selected).length,1);assert.equal(apply().count,0);
 assert.equal((await h.receipt('finished-tomato-receipt','Chopped tomatoes',400,'g')).ok,true);assert.deepEqual(h.stock(),{'chopped tomatoes|g':800});
});

test('buying unrelated measured food never clears a manually Low condiment status',async()=>{
 for(const source of ['receipt','finish']){
  const h=fixture({stock:{'ketchup|each':1,'rice|g':200},inventory:{ketchup:entry('Ketchup',1,'each',{staple:true,stapleStatus:'low'}),rice:entry('Rice',200,'g')},ingredients:[{key:'ketchup',required:15,unit:'ml'},{key:'rice',required:100,unit:'g'}]});
  if(source==='receipt')assert.equal((await h.receipt('unrelated-rice-receipt','Rice',100,'g')).ok,true);
  else assert.equal(finish(h,{id:'rice|g',name:'Rice',qty:100,unit:'g',aisle:'Cupboard / Pantry'})().count,1);
  assert.equal(h.stock()['ketchup|each'],1);assert.equal(Object.values(h.inventory()).find(row=>row.name==='Ketchup'&&row.selected).stapleStatus,'low',source);
  const restock=h.shopping().filter(row=>row.key==='ketchup'&&row.toBuy>0);assert.equal(restock.length,1);assert.equal(restock[0].toBuy,1);assert.equal(h.stock()['rice|g'],300);
 }
});

test('a historical Finish tomato tin nets its first measured receipt once without reimporting the legacy credit',async()=>{
 const h=fixture({stock:{'chopped tomatoes|tin':1},inventory:{tomatoes:entry('Chopped tomatoes',1,'tin')},ingredients:[{key:'chopped tomatoes',required:600,unit:'g'}]}),ledgerKey='basketboss_purchase_receipts_v1',legacyId='policy-trip|chopped tomatoes|tin';
 h.storage.setItem(ledgerKey,JSON.stringify({[legacyId]:{name:'chopped tomatoes',unit:'tin',credited:1,qty:1,week:'policy-trip',stockBasis:'full-purchase'}}));
 assert.equal((await h.receipt('historical-tomato-receipt-1','Chopped tomatoes',400,'g')).ok,true);assert.deepEqual(h.stock(),{'chopped tomatoes|g':400},'the old deposited tin already represents this receipt purchase');
 assert.equal((await h.receipt('historical-tomato-receipt-1','Chopped tomatoes',400,'g')).duplicate,true);assert.deepEqual(h.stock(),{'chopped tomatoes|g':400});
 assert.equal((await h.receipt('historical-tomato-receipt-2','Chopped tomatoes',400,'g')).ok,true);assert.deepEqual(h.stock(),{'chopped tomatoes|g':800},'a later distinct purchase adds stock instead of resurrecting the old tin credit');
 assert.equal((await h.receipt('historical-tomato-receipt-3','Chopped tomatoes',400,'g')).ok,true);assert.deepEqual(h.stock(),{'chopped tomatoes|g':1200});
 const history=JSON.parse(h.storage.getItem(ledgerKey))[legacyId];assert.equal(history.credited,1);assert.equal(history.unit,'tin','the historical physical source is retained');
 assert.equal(Object.values(h.inventory()).filter(row=>row.selected).length,1);
});

test('a historical Finish measured ketchup purchase nets to one container and later receipts add new bottles only',async()=>{
 const h=fixture({stock:{'ketchup|ml':800},inventory:{ketchup:entry('Ketchup',800,'ml')},ingredients:[{key:'ketchup',required:15,unit:'ml'}]}),ledgerKey='basketboss_purchase_receipts_v1',legacyId='policy-trip|ketchup|ml';
 h.storage.setItem(ledgerKey,JSON.stringify({[legacyId]:{name:'ketchup',unit:'ml',credited:800,qty:800,week:'policy-trip',stockBasis:'full-purchase'}}));
 assert.equal((await h.receipt('historical-ketchup-receipt-1','Ketchup',800,'ml')).ok,true);assert.deepEqual(h.stock(),{'ketchup|each':1});
 assert.equal((await h.receipt('historical-ketchup-receipt-1','Ketchup',800,'ml')).duplicate,true);assert.deepEqual(h.stock(),{'ketchup|each':1});
 assert.equal((await h.receipt('historical-ketchup-receipt-2','Ketchup',800,'ml')).ok,true);assert.deepEqual(h.stock(),{'ketchup|each':2});
 assert.equal((await h.receipt('historical-ketchup-receipt-3','Ketchup',800,'ml')).ok,true);assert.deepEqual(h.stock(),{'ketchup|each':3});
 const history=JSON.parse(h.storage.getItem(ledgerKey))[legacyId];assert.equal(history.credited,800);assert.equal(history.unit,'ml');assert.equal(h.shopping()[0].toBuy,0);
});
