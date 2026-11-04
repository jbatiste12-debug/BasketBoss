import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),homeModule=require('../bb-home.js'),amount=require('../bb-household-amount.js'),quantity=require('../bb-receipt-quantity.js'),groupsModule=require('../bb-pantry-groups.js');
const readFile=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),html=readFile('index.html');
const ACTOR='household_amount_test_user',SESSION='basketboss_cloud_session_v1',FEATURE='basketboss_321_features_v1',HOME='basketboss_at_home_requirements_v1',STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
const keys={BB307_FEATURE_KEY:FEATURE,BB321_SHOP_TICKS_KEY:'basketboss_amount_ticks',BB84_PURCHASED_KEY:'basketboss_amount_purchases',BB_PARTIAL_PURCHASE_KEY:'basketboss_amount_partials',BB_BETA_CHOICE_KEY:'basketboss_amount_choices',BB_SHOP_SESSION_V7_KEY:'basketboss_amount_shop_session',BB_BETA_RECEIPT_KEY:'basketboss_purchase_receipts_v1'};
const copy=value=>JSON.parse(JSON.stringify(value));
function section(start,end){const from=html.indexOf(start),to=html.indexOf(end,from);assert.ok(from>=0&&to>from,start);return html.slice(from,to);}

function fixture(item={}){
 const original={id:'cleaner',name:'Kitchen cleaner',unit:'each',qty:2,selected:true,owned:false,targetQty:2,ownedQty:1,manualPending:true,...item};
 const values=new Map(),writes=[],read=key=>JSON.parse(values.get(key)||'{}');
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push(key);},removeItem:key=>values.delete(key)};
 for(const [key,value]of Object.entries({[FEATURE]:{version:1,essentials:[original]},[STOCK]:{'rice|g':200},[INVENTORY]:{'cupboard|rice':{name:'Rice',loc:'cupboard',unit:'g',qty:200,selected:true,bb173StockKey:'rice|g',bb173StockValue:200}},[SESSION]:{user:{id:ACTOR},access_token:'local-amount-test-token'},[keys.BB_SHOP_SESSION_V7_KEY]:{version:7,id:'amount-trip',checkboxUndo:{}},[keys.BB321_SHOP_TICKS_KEY]:{},[keys.BB84_PURCHASED_KEY]:{},[keys.BB_PARTIAL_PURCHASE_KEY]:{},[keys.BB_BETA_CHOICE_KEY]:{},[keys.BB_BETA_RECEIPT_KEY]:{}}))storage.setItem(key,JSON.stringify(value));
 const win={localStorage:storage,document:{},location:{search:''},BBReceiptQuantity:quantity,BBAccountDeletion:{isDeleting:()=>false}},context=vm.createContext({window:win,localStorage:storage,console,...keys});
 vm.runInContext(readFile('bb-weekly-essentials.js'),context);context.BBWeeklyEssentials=win.BBWeeklyEssentials;
 vm.runInContext(section('const BB307Features=(()=>{','/* BasketBoss 321: optional family features')+'\nthis.features=BB307Features;',context);
 context.bb307FeatureState=context.features.normaliseFeatures(read(FEATURE),[]);
 const pantry={pantryId:(name,unit)=>String(name).toLowerCase()+'|'+unit,pantryName:name=>String(name).toLowerCase()};
 Object.assign(context,{BB307Pantry:pantry,BBPriceV19:{canonical:name=>String(name).toLowerCase()},bb83ReadObject:read,
  bbShopV7Session:()=>read(keys.BB_SHOP_SESSION_V7_KEY),bb321ReadShopTicks:()=>read(keys.BB321_SHOP_TICKS_KEY),bb84ReadPurchased:()=>read(keys.BB84_PURCHASED_KEY),bbPartialAll:()=>read(keys.BB_PARTIAL_PURCHASE_KEY),bbBetaPurchaseChoices:()=>read(keys.BB_BETA_CHOICE_KEY),bbBetaReceiptId:id=>'amount-trip|'+id,
  bbReceiptShoppingRows:()=>[],bb84DetailFor:row=>({name:row.key||row.name,unit:row.unit})});
 vm.runInContext(section('function bbHomeSettlePurchases(','function bbHomeNeedsLegacyReview('),context);
 const prepareLine=html.split('\n').find(line=>line.startsWith(' prepareHousehold:entries=>'));assert.ok(prepareLine);
 vm.runInContext('this.prepareHousehold='+prepareLine.trim().slice('prepareHousehold:'.length).replace(/,$/,''),context);
 vm.runInContext(section('function bbReceiptPrepareSave(packet){','function bbReceiptConfigureHost('),context);
 let refreshes=0;
 const host={id:pantry.pantryId,household:()=>context.bb307FeatureState.essentials,prepareHousehold:context.prepareHousehold,settlePurchases:context.bbHomeSettlePurchases,
  reload(){context.bb307FeatureState=context.features.normaliseFeatures(read(FEATURE),[]);},refresh(){refreshes++;},requirements:()=>[],stock:()=>read(STOCK)};
 win.BBHomeHost=host;const home=homeModule.install(win);win.BBHome=home;
 const groups=groupsModule.install(win),group=groups.create('essentials','Family cleaning');groups.assign('essentials','cleaner',group);
 const unchanged=new Map([STOCK,INVENTORY,groups.KEY].map(key=>[key,storage.getItem(key)]));
 const pin=()=>({actor:home.actor(),session:storage.getItem(SESSION),features:storage.getItem(FEATURE)});
 vm.runInNewContext(readFile('bb-receipt-inventory.js'),{window:win,console});
 const adapter=win.BBReceiptInventoryFactory({storage,core:receiptCore,canonicalize:name=>String(name).toLowerCase(),getSession:()=>read(SESSION),getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'amount-trip'}),getCatalog:()=>({}),receiptSaveKeys:[FEATURE,...Object.values(keys),HOME],prepareReceiptSave:packet=>copy(context.bbReceiptPrepareSave(packet))});
 const receipt=(receiptId,capacity=750,unit='ml')=>({receiptId,market:'UK',retailer:'Tesco',shopSessionId:'amount-trip',stockPantry:true,items:[{name:'Kitchen cleaner',classification:'essential',sourceKind:'purchase',quantity:capacity,unit,price:2,guidePackQuantity:capacity,guidePackUnit:unit}]});
 return {values,writes,storage,context,win,home,host,groups,adapter,pin,receipt,read,row:()=>read(FEATURE).essentials.find(row=>row.id==='cleaner'),refreshes:()=>refreshes,
  save:input=>home.setHouseholdAmount('cleaner',amount.prepare(input),pin()),shortfall:()=>win.BBWeeklyEssentials.reconcile(read(FEATURE).essentials.find(row=>row.id==='cleaner')).toBuy,
  assertUnchangedOtherStock(){for(const [key,value]of unchanged)assert.equal(storage.getItem(key),value,key+' must remain independent of household ownership');}};
}

test('a half 750 ml cleaner bottle saves 375 ml, a receipt adds 750 ml once, and Shopping needs the remaining 375 ml',async()=>{
 const h=fixture();assert.equal(h.save({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2}).ok,true);
 assert.equal(h.row().ownedQty,375);assert.equal(h.row().targetQty,1500);assert.equal(h.row().unit,'ml');assert.equal(h.shortfall(),1125);assert.equal(h.row().packReviewed,true);h.assertUnchangedOtherStock();
 const packet=h.receipt('household-750-receipt');assert.equal((await h.adapter.commitLocalReceipt(packet)).ok,true);
 assert.equal(h.row().ownedQty,1125);assert.equal(h.row().targetQty,1500);assert.equal(h.shortfall(),375);assert.equal(h.read(FEATURE).essentials.length,1);h.assertUnchangedOtherStock();
 assert.equal((await h.adapter.commitLocalReceipt(packet)).duplicate,true);assert.equal(h.row().ownedQty,1125);assert.equal(h.shortfall(),375);
});

test('half of an older 500 ml bottle plus a new 750 ml purchase keeps the real 1000 ml balance',async()=>{
 const h=fixture();h.save({remaining:.5,capacity:500,capacityUnit:'ml',neededContainers:2});assert.equal(h.row().ownedQty,250);assert.equal(h.row().targetQty,1000);
 assert.equal((await h.adapter.commitLocalReceipt(h.receipt('mixed-bottle-receipt',750))).ok,true);
 assert.equal(h.row().ownedQty,1000);assert.equal(h.row().targetQty,1000);assert.equal(h.row().packQuantity,750,'receipt records the new container capacity without rescaling old measured ownership');assert.equal(h.shortfall(),0);h.assertUnchangedOtherStock();
});

test('missing or incompatible container capacity leaves household amounts and all other data untouched',()=>{
 for(const patch of [{capacity:''},{capacity:null},{capacity:0},{capacityUnit:'bottle'},{remaining:''},{neededContainers:''}]){
  const h=fixture(),before=[...h.values];assert.throws(()=>h.save({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2,...patch}));assert.deepEqual([...h.values],before);assert.equal(h.refreshes(),0);
 }
 const h=fixture(),before=[...h.values];assert.throws(()=>h.home.setHouseholdAmount('cleaner',{unit:'ml',ownedQty:375,targetQty:1500,packQuantity:0,packUnit:'ml'},h.pin()),/container size/);assert.deepEqual([...h.values],before);
});

test('a stale actor, session or feature revision cannot replace the latest household balance',()=>{
 for(const mode of ['actor','token','features']){
  const h=fixture(),pin=h.pin(),patch=amount.prepare({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2});
  if(mode==='actor')h.storage.setItem(SESSION,JSON.stringify({user:{id:'another_household_user'},access_token:'other-token'}));
  else if(mode==='token')h.storage.setItem(SESSION,JSON.stringify({user:{id:ACTOR},access_token:'refreshed-token'}));
  else{const next=h.read(FEATURE);next.essentials[0].ownedQty=9;h.storage.setItem(FEATURE,JSON.stringify(next));h.host.reload();}
  const before=[...h.values];assert.throws(()=>h.home.setHouseholdAmount('cleaner',patch,pin),/account changed|amounts changed/);assert.deepEqual([...h.values],before);assert.equal(h.refreshes(),0);
 }
});

test('storage failure rolls back the household amount, Home state and settled shopping controls for a safe retry',()=>{
 for(const failedKey of [FEATURE,keys.BB84_PURCHASED_KEY]){
  const h=fixture();h.storage.setItem(keys.BB321_SHOP_TICKS_KEY,JSON.stringify({'ess:cleaner':true}));h.storage.setItem(keys.BB84_PURCHASED_KEY,JSON.stringify({'ess:cleaner':{name:'Kitchen cleaner',unit:'each',qty:1}}));
  const before=[...h.values],put=h.storage.setItem;let fail=true;h.storage.setItem=(key,value)=>{if(key===failedKey&&fail){fail=false;throw Error('storage quota');}put(key,value);};
  assert.throws(()=>h.save({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2}),/storage quota/);assert.deepEqual([...h.values],before);assert.equal(h.refreshes(),0);
  assert.equal(h.save({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2}).ok,true);assert.equal(h.row().ownedQty,375);assert.equal(h.row().targetQty,1500);assert.deepEqual(h.read(keys.BB321_SHOP_TICKS_KEY),{});assert.deepEqual(h.read(keys.BB84_PURCHASED_KEY),{});h.assertUnchangedOtherStock();
 }
});

test('pending receipt recovery and account deletion block household balance conversion before any write',()=>{
 for(const mode of ['receipt','deleting']){
  const h=fixture();if(mode==='receipt')h.win.BBReceiptHost={hasPendingConfirmation:()=>true};else h.win.BBAccountDeletion.isDeleting=()=>true;
  const before=[...h.values];assert.throws(()=>h.save({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2}),/pending account or receipt/);assert.deepEqual([...h.values],before);
 }
});

test('an account switch during the household write rolls every balance back without undoing the new session',()=>{
 const h=fixture(),before=new Map(h.values),put=h.storage.setItem;let switched=false;
 h.storage.setItem=(key,value)=>{put(key,value);if(key===FEATURE&&!switched){switched=true;put(SESSION,JSON.stringify({user:{id:'new_household_account'},access_token:'new-token'}));}};
 assert.throws(()=>h.save({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2}),/account or At home changed/);
 for(const [key,value]of before)if(key!==SESSION)assert.equal(h.storage.getItem(key),value,key);
 assert.equal(h.read(SESSION).user.id,'new_household_account');assert.equal(h.storage.getItem(HOME),null);
});

test('a receipt for a conflicting cleaner brand preserves separate measured household balances',async()=>{
 const h=fixture({brand:'Brand A'});h.save({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2});
 const packet=h.receipt('different-brand-cleaner');packet.items[0].brand='Brand B';
 assert.equal((await h.adapter.commitLocalReceipt(packet)).ok,true);
 const rows=h.read(FEATURE).essentials;assert.equal(rows.length,2);assert.equal(h.row().ownedQty,375);
 const other=rows.find(row=>row.id!=='cleaner');assert.equal(other.ownedQty,750);assert.equal(other.unit,'ml');assert.equal(other.brand,'Brand B');h.assertUnchangedOtherStock();
});
