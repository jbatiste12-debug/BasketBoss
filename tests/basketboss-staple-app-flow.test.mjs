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
 for(const name of ['bbHomePhysicalStock','bbHomeStapleState','bbHomeApplyStapleShopping','bbHomeCupboardStapleItems','bbHomePromoteCupboardStaple','bbHomeShoppingMeasure','bbHomeExcludedStockKeys','bbHomeConversionContext','bbPantryReconcileStock','bb321UnifiedShop'])vm.runInContext(actualFunction(html,name),ctx);
 const bridge=html.split('\n').find(line=>line.startsWith('window.BBPantryState='));if(bridge)vm.runInContext(bridge,ctx);
 ctx.BB172_STAPLES_KEY='basketboss_v172_assumed_staples_v1';
 for(const name of ['bb172StapleSaved','bb172StapleAssumesOnHand'])vm.runInContext(actualFunction(html,name),ctx);
 const occurrence=(id,day)=>'policy-week|dinner|'+day+'|'+id;
 const host={id:pantry.pantryId,keys:()=>({stock:STOCK,inventory:INVENTORY}),stock:ctx.bbHomePhysicalStock,conversionContext:ctx.bbHomeConversionContext,
  recipeIngredients:(_id,factor)=>state.ingredients.map(value=>({...value,required:value.required*factor})),occurrence,refresh(){},household:()=>[],requirements:()=>state.ingredients,
  shoppingKind:()=> 'food',shoppingMeasure:ctx.bbHomeShoppingMeasure,shoppingPurchaseContext:()=>({shopSessionId:'policy-trip',quantity:0})};
 ctx.bb307Plan=()=>({items:state.ingredients});ctx.bb321ShoppingSources=()=>new Map();
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
  bb321ReadShopTicks:()=>({}),bb84ReadPurchased:()=>({}),bbPartialAll:()=>({}),bbBetaPurchaseChoices:()=>({}),bb307Plan:()=>({items:h.state.ingredients}),bb321UnifiedShop:()=>h.shopping(),
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

test('planned cupboard staples stay out of active shopping until the user requests a container',()=>{
 const ingredients=[{key:'soy sauce',required:15,unit:'ml'},{key:'olive oil',required:2,unit:'tbsp'},{key:'salt',required:1,unit:'pinch'},{key:'pepper',required:1,unit:'each',staple:true},{key:'rice',required:200,unit:'g'}];
 const h=fixture({ingredients}),rows=h.shopping();assert.equal(rows.filter(row=>row.toBuy>0).length,1);assert.equal(rows.find(row=>row.key==='rice').toBuy,200);
 for(const key of ['soy sauce','olive oil','salt','pepper']){const row=rows.find(row=>row.key===key);assert.equal(row.toBuy,0,key);assert.equal(row.staple,true,key);assert.equal(row.cupboardRequired,true);assert.equal(row.cupboardCheck,true);assert.equal(row.stapleStatus,'unknown');}
 assert.deepEqual(h.stock(),{});assert.equal(h.home.shoppingBuys().length,0,'opening reminders is read-only');
});

test('weekly cupboard reminders retain meal days across culinary and container units',()=>{
 const h=fixture({ingredients:[{key:'soy sauce',required:15,unit:'ml'}]});h.ctx.bb321ShoppingSources=()=>new Map([['soy sauce|ml',[{day:'Thursday'},{day:'Monday',batchLeftoverDay:'Wednesday'}]],['rice|g',[{day:'Friday'}]]]);
 assert.deepEqual(copy(h.ctx.bbHomeCupboardStapleItems()),[{key:'soy sauce',name:'soy sauce',unit:'each',container:'bottle',status:'unknown',days:['Monday','Wednesday','Thursday'],active:false}]);
});

test('legacy zero balances do not manufacture a Low or Out declaration',()=>{
 const h=fixture({stock:{'honey|each':0},ingredients:[{key:'honey',required:15,unit:'g'}]});assert.equal(h.shopping()[0].toBuy,0);
 const unknown=fixture({inventory:{honey:entry('Honey',null,'each',{staple:true,stapleStatus:'unknown'})},ingredients:[{key:'honey',required:15,unit:'g'}]});assert.equal(unknown.shopping()[0].toBuy,0);
});

test('one-tap cupboard promotion is idempotent and a later Low choice still requests only one bottle',()=>{
 const h=fixture({ingredients:[{key:'soy sauce',required:15,unit:'ml'}]});assert.equal(h.ctx.bbHomePromoteCupboardStaple('soy sauce').ok,true);const writes=h.writes.length;
 assert.equal(h.shopping()[0].toBuy,1);assert.equal(h.home.shoppingBuys()[0].source,'cupboard');assert.equal(h.ctx.bbHomePromoteCupboardStaple('soy sauce').already,true);assert.equal(h.writes.length,writes);
 h.storage.setItem(STOCK,JSON.stringify({'soy sauce|each':1}));h.storage.setItem(INVENTORY,JSON.stringify({soy:entry('Soy sauce',1,'each',{staple:true,stapleStatus:'low'})}));assert.equal(h.shopping()[0].toBuy,1,'the explicit Low restock and promotion refer to one container');
 assert.equal(h.home.addShoppingBuy({name:'soy sauce',quantityText:'1 each',actorId:ACTOR,requestId:'deliberate-extra-bottle'}).ok,true);assert.equal(h.shopping()[0].toBuy,2,'ordinary manual Shop top-ups remain additional');
});

test('marking a promoted cupboard staple In stock clears its reminder without removing intentional Shop top-ups',()=>{
 const h=fixture({ingredients:[{key:'soy sauce',required:15,unit:'ml'}]});
 assert.equal(h.ctx.bbHomePromoteCupboardStaple('soy sauce').ok,true);assert.equal(h.shopping()[0].toBuy,1);
 h.storage.setItem(STOCK,JSON.stringify({'soy sauce|each':1}));
 h.storage.setItem(INVENTORY,JSON.stringify({soy:entry('Soy sauce',1,'each',{staple:true,stapleStatus:'in'})}));
 const before=[...h.values],covered=h.shopping()[0];
 assert.equal(covered.toBuy,0,'the cupboard reminder is covered by the updated pantry status');
 assert.equal(covered.pantryUsed,1);assert.deepEqual([...h.values],before,'planning must not mutate or delete the saved reminder');
 assert.equal(h.home.addShoppingBuy({name:'Soy sauce',quantityText:'1 bottle',actorId:ACTOR,requestId:'intentional-top-up'}).ok,true);
 assert.equal(h.shopping()[0].toBuy,1,'an explicit manual Shop top-up stays additional');
 h.storage.setItem(INVENTORY,JSON.stringify({soy:entry('Soy sauce',1,'each',{staple:true,stapleStatus:'low'})}));
 assert.equal(h.shopping()[0].toBuy,2,'one automatic low-stock restock plus one intentional top-up');
});

test('a cupboard promotion purchased alongside an automatic restock is fulfilled by that actual container',()=>{
 const h=fixture({ingredients:[{key:'soy sauce',required:15,unit:'ml'}]});assert.equal(h.ctx.bbHomePromoteCupboardStaple('soy sauce').ok,true);
 h.storage.setItem(STOCK,JSON.stringify({'soy sauce|each':1}));h.storage.setItem(INVENTORY,JSON.stringify({soy:entry('Soy sauce',1,'each',{staple:true,stapleStatus:'low'})}));assert.equal(h.shopping()[0].toBuy,1);
 const transfer=finish(h,{id:'soy sauce|each',name:'soy sauce',qty:1,unit:'each',aisle:'Cupboard / Pantry'});assert.equal(transfer().count,1);assert.equal(h.home.shoppingBuys().length,0);assert.equal(h.shopping()[0].toBuy,0);assert.equal(h.stock()['soy sauce|each'],2);
});

test('cupboard promotion cannot mutate an unrelated ingredient or bypass a pending pantry review',()=>{
 const h=fixture({ingredients:[{key:'soy sauce',required:15,unit:'ml'}]}),before=[...h.values];assert.equal(h.ctx.bbHomePromoteCupboardStaple('rice').ok,false);assert.deepEqual([...h.values],before);
 h.win.BBReceiptHost.canConsumePantry=()=>false;assert.equal(h.ctx.bbHomePromoteCupboardStaple('soy sauce').ok,false);assert.deepEqual([...h.values],before);
});

test('counted whole pepper remains food while projected culinary pepper is a cupboard staple',()=>{
 const whole=fixture({ingredients:[{key:'pepper',required:2,unit:'each'}]});assert.equal(whole.shopping()[0].toBuy,2);assert.equal(whole.shopping()[0].staple,undefined);
 const spice=fixture({ingredients:[{key:'pepper',required:1,unit:'each',staple:true}]});assert.equal(spice.shopping()[0].toBuy,0);assert.equal(spice.shopping()[0].staple,true);
});

test('manual-only condiment counts retain bottle or jar metadata while whole peppers stay produce',()=>{
 for(const [name,quantityText,container]of [['Honey','1 jar','jar'],['Olive oil','1 bottle','bottle'],['Black pepper','1 jar','jar'],['Ground Pepper','1 jar','jar']]){
  const h=fixture();assert.equal(h.home.addShoppingBuy({name,quantityText,actorId:ACTOR,requestId:'manual-'+name}).ok,true,name);const rows=h.shopping();assert.equal(rows.length,1,name);assert.equal(rows[0].toBuy,1,name);assert.equal(rows[0].staple,true,name);assert.equal(rows[0].stapleContainer,container,name);assert.equal(rows[0].cupboardRequired,undefined,'unplanned purchases do not become weekly reminders');
 }
 for(const name of ['Pepper','Peppers','Red peppers','Bell peppers']){
  const h=fixture();assert.equal(h.home.addShoppingBuy({name,quantityText:'2 each',actorId:ACTOR,requestId:'manual-'+name}).ok,true,name);const rows=h.shopping();assert.equal(rows.length,1,name);assert.notEqual(rows[0].staple,true,name+' is whole produce');assert.equal(rows[0].stapleContainer,undefined,name);
 }
});

function saveCountTarget(h,name,owned,needed){
 const change=h.home.prepare([{name,unit:'each',qty:owned,totalNeeded:needed,pantryTarget:true,targetChanged:true,staple:true}]);
 homeModule.atomic(h.storage,{[change.key]:change.value,...change.shoppingChange?.updates},{[change.key]:change.expected,...change.shoppingChange?.expected});
}

test('an explicit five-container target buys three even when two condiment containers are In Stock',()=>{
 const h=fixture({stock:{'ketchup|each':2},inventory:{ketchup:entry('Ketchup',2,'each',{staple:true,stapleStatus:'in'})},ingredients:[{key:'ketchup',required:15,unit:'ml'}]});
 saveCountTarget(h,'Ketchup',2,5);let rows=h.shopping().filter(row=>row.key==='ketchup');
 assert.equal(rows.length,1);assert.equal(rows[0].required,5);assert.equal(rows[0].pantryUsed,2);assert.equal(rows[0].toBuy,3);assert.equal(rows[0].cupboardCheck,false);assert.equal(rows[0].stapleStatus,'in');
 saveCountTarget(h,'Ketchup',2,5);rows=h.shopping().filter(row=>row.key==='ketchup');assert.equal(rows.length,1);assert.equal(rows[0].toBuy,3);assert.deepEqual(h.stock(),{'ketchup|each':2});
});

test('a target-only staple appears once without becoming a recipe cupboard reminder',()=>{
 const h=fixture({stock:{'soy sauce|each':2},inventory:{soy:entry('Soy sauce',2,'each',{staple:true,stapleStatus:'in'})}});
 saveCountTarget(h,'Soy sauce',2,5);const rows=h.shopping();assert.equal(rows.length,1);assert.equal(rows[0].key,'soy sauce');assert.equal(rows[0].toBuy,3);assert.equal(rows[0].cupboardRequired,false);
});

test('the plan-only requirements path ignores desired staple counts and keeps the meal minimum independent',()=>{
 const h=fixture({stock:{'ketchup|each':2},inventory:{ketchup:entry('Ketchup',2,'each',{staple:true,stapleStatus:'in'})},ingredients:[{key:'ketchup',required:15,unit:'ml'}]});
 saveCountTarget(h,'Ketchup',2,5);const before=[...h.values],plan=copy(h.ctx.bb321UnifiedShop(h.state.ingredients,true));
 assert.equal(plan.length,1);assert.equal(plan[0].required,1);assert.equal(plan[0].toBuy,0);assert.equal(h.home.foodTarget({name:'Ketchup',qty:2,unit:'each',staple:true}).mealNeeded,1);assert.equal(h.shopping()[0].toBuy,3);assert.deepEqual([...h.values],before);
 const alone=fixture({stock:{'soy sauce|each':2},inventory:{soy:entry('Soy sauce',2,'each',{staple:true,stapleStatus:'in'})}});saveCountTarget(alone,'Soy sauce',2,5);assert.deepEqual(copy(alone.ctx.bb321UnifiedShop([],true)),[]);
});

test('Low and Out retain one-container restocking until an explicit count target replaces that stock goal',()=>{
 for(const status of ['low','out']){
  const owned=status==='low'?1:0,h=fixture({stock:owned?{'ketchup|each':owned}:{},inventory:{ketchup:entry('Ketchup',owned,'each',{staple:true,stapleStatus:status})},ingredients:[{key:'ketchup',required:15,unit:'ml'}]});
  assert.equal(h.shopping()[0].toBuy,1);assert.deepEqual(h.home.targets(),{});saveCountTarget(h,'Ketchup',owned,5);assert.equal(h.shopping()[0].toBuy,5-owned);
 }
});

test('a zero target for an unplanned Out staple stays an explicit choice instead of manufacturing meal demand',()=>{
 const h=fixture({inventory:{ketchup:entry('Ketchup',0,'each',{staple:true,stapleStatus:'out'})}});h.win.BBHomeHost.requirements=()=>h.ctx.bb321UnifiedShop([],true);
 const initial=h.home.foodTarget({name:'Ketchup',qty:0,unit:'each',staple:true});assert.equal(initial.mealNeeded,0);assert.equal(initial.totalNeeded,1);assert.equal(initial.minimumNeeded,0);
 saveCountTarget(h,'Ketchup',0,0);assert.equal(h.shopping()[0].toBuy,0);assert.equal(h.home.foodTarget({name:'Ketchup',qty:0,unit:'each',staple:true}).totalNeeded,0);
});

test('an explicit target on measured reduced whole peppers stays food with its full measured demand',()=>{
 const inventory={pepper:entry('Bell peppers',150,'g',{staple:false,bbReduced:{actor:ACTOR,urgent:true,source:'reduced'}})},h=fixture({stock:{'bell peppers|g':150},inventory,ingredients:[{key:'bell peppers',unit:'g',required:100,staple:false}]});
 const change=h.home.prepare([{name:'Bell peppers',unit:'g',qty:150,totalNeeded:400,pantryTarget:true,targetChanged:true,staple:false}]);homeModule.atomic(h.storage,{[change.key]:change.value},{[change.key]:change.expected});
 const rows=h.shopping();assert.equal(rows.length,1,JSON.stringify({rows,targets:h.home.targets()}));assert.equal(rows[0].unit,'g');assert.equal(rows[0].required,400);assert.equal(rows[0].toBuy,250);assert.notEqual(rows[0].staple,true);assert.equal(h.home.targets()['bell peppers|each'],undefined);assert.deepEqual(h.stock(),{'bell peppers|g':150});assert.deepEqual(h.inventory(),inventory);
});

test('buffer and chosen purchase pack flow to Shop without changing recipe requirements or physical stock',()=>{
 const h=fixture({stock:{'milk|ml':200},inventory:{milk:entry('Milk',200,'ml')},ingredients:[{key:'milk',required:333.333333,unit:'ml'}]});
 const change=h.home.prepare([{name:'Milk',unit:'ml',qty:200,totalNeeded:333.333333,extraBuffer:200,buyMultiple:1000,buyMultipleUnit:'ml',pantryTarget:true,targetChanged:true}]);
 homeModule.atomic(h.storage,{[change.key]:change.value},{[change.key]:change.expected});
 const rows=h.shopping();assert.equal(rows.length,1);assert.equal(rows[0].toBuy,1000);assert.equal(rows[0].buyMultiple,1000);assert.ok(Math.abs(rows[0].required-533.333333)<.01);assert.deepEqual(h.stock(),{'milk|ml':200});
 const raw=copy(h.ctx.bb321UnifiedShop(h.state.ingredients,true));assert.ok(Math.abs(raw[0].required-333.333333)<.01);assert.ok(raw[0].toBuy<134,'the raw recipe path never includes buffer or pack rounding');
});

test('explicit staple buffer stays active while In stock and survives completion without reviving the old target',()=>{
 const h=fixture({stock:{'ketchup|each':2},inventory:{ketchup:entry('Ketchup',2,'each',{staple:true,stapleStatus:'in'})},ingredients:[{key:'ketchup',required:15,unit:'ml'}]});
 const change=h.home.prepare([{name:'Ketchup',unit:'each',qty:2,totalNeeded:1,extraBuffer:2,buyMultiple:2,buyMultipleUnit:'each',pantryTarget:true,targetChanged:true,staple:true}]);
 homeModule.atomic(h.storage,{[change.key]:change.value},{[change.key]:change.expected});
 let row=h.shopping()[0];assert.equal(row.required,3);assert.equal(row.toBuy,2);assert.equal(h.ctx.bb172StapleAssumesOnHand(row),false,'an intentional backup is not hidden by an In stock status');
 h.home.complete('ketchup|each');h.state.ingredients=[];row=h.shopping()[0];assert.equal(row.required,2);assert.equal(row.toBuy,0);assert.equal(h.home.targets()['ketchup|each'].extraBuffer,2);assert.equal(h.home.targets()['ketchup|each'].buyMultiple,2);
});

test('cooking consumes the recipe amount while retaining the extra buffer and chosen purchase pack',async()=>{
 const h=fixture({stock:{'milk|ml':1250},inventory:{milk:entry('Milk',1250,'ml')},ingredients:[{key:'milk',required:250,unit:'ml'}]});
 const change=h.home.prepare([{name:'Milk',unit:'ml',qty:1250,totalNeeded:250,extraBuffer:100,buyMultiple:1000,buyMultipleUnit:'ml',pantryTarget:true,targetChanged:true}]);
 homeModule.atomic(h.storage,{[change.key]:change.value},{[change.key]:change.expected});
 assert.equal(h.shopping()[0].toBuy,0);await h.cook();assert.equal(h.stock()['milk|ml'],1000,'the recipe consumes250ml, not the350ml buffered target or a1L shopping pack');
 assert.equal(h.home.targets()['milk|ml'].extraBuffer,100);assert.equal(h.home.targets()['milk|ml'].buyMultiple,1000);
});

test('a rounded full-pack purchase transfers once and a matching receipt cannot duplicate its stock',async()=>{
 const h=fixture({stock:{'milk|ml':200},inventory:{milk:entry('Milk',200,'ml')},ingredients:[{key:'milk',required:333.333333,unit:'ml'}]});
 const change=h.home.prepare([{name:'Milk',unit:'ml',qty:200,totalNeeded:333.333333,extraBuffer:200,buyMultiple:1000,buyMultipleUnit:'ml',pantryTarget:true,targetChanged:true}]);
 homeModule.atomic(h.storage,{[change.key]:change.value},{[change.key]:change.expected});
 const purchase=h.shopping()[0],apply=finish(h,{id:'milk|ml',name:'Milk',unit:'ml',qty:purchase.toBuy,aisle:'Dairy & Chilled'});
 assert.equal(purchase.toBuy,1000);assert.equal(h.stock()['milk|ml'],200);assert.equal(apply().count,1);assert.equal(h.stock()['milk|ml'],1200);assert.equal(apply().count,0);assert.equal(h.shopping()[0].toBuy,0);
 assert.equal((await h.receipt('rounded-milk-receipt','Milk',1000,'ml')).ok,true);assert.equal(h.stock()['milk|ml'],1200);assert.equal(Object.values(h.inventory()).filter(row=>row.selected).length,1);
 assert.equal(h.home.targets()['milk|ml'].extraBuffer,200);assert.equal(h.home.targets()['milk|ml'].buyMultiple,1000);
});
