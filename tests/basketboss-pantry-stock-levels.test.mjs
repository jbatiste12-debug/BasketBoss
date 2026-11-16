import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),levels=require('../bb-pantry-stock-levels.js'),policy=require('../bb-pantry-policy.js');
const homeModule=require('../bb-home.js'),deduction=require('../bb-pantry-deduction.js');
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
const HOME='basketboss_at_home_requirements_v1',SESSION='basketboss_cloud_session_v1',PLAN='basketboss_321_unified_state_v1';
const ACTOR='11111111-1111-4111-8111-111111111111';
const source=read('shopping-inventory.js'),html=read('index.html'),pantrySource=html.match(/const BB307Pantry=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/)[0];
const hostSource=read('bb-receipt-host.js'),adapterSource=read('bb-receipt-inventory.js');
// Reuse existing isolated fixtures, keeping their real editor, Cook, receipt
// adapter and guarded sync implementation instead of duplicating their math.
function fixtureDefinition(file,startMarker,endMarker,scope,expose){
 const text=fs.readFileSync(new URL(file,import.meta.url),'utf8'),start=text.indexOf(startMarker),end=text.indexOf(endMarker,start);
 assert.ok(start>=0&&end>start,'existing fixture boundary: '+file);
 vm.runInNewContext(text.slice(start,end).replace('export async function fixture','async function fixture').replaceAll('import.meta.url','fixtureURL')+'\nthis.fixtureExports='+expose+';',scope);
 return scope.fixtureExports;
}
const fixtureURL=new URL('./basketboss-pantry-policy-ui.test.mjs',import.meta.url).href;
const common={assert,fs,vm,URL,read,copy,source,pantrySource,policy,homeModule,receiptCore,STOCK,INVENTORY,console,setTimeout,clearTimeout,queueMicrotask,
 decode:value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x])),dataKey:name=>name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())};
const editorFixture=fixtureDefinition('./basketboss-pantry-policy-ui.test.mjs','export async function fixture(','\n\ntest(',{...common,fixtureURL},'fixture');
const cookFixture=fixtureDefinition('./basketboss-pantry-conversion-cook-flow.test.mjs','function actualFunction(','\n\nfor(const entry',{...common,HOME,SESSION,PLAN,ACTOR,install:homeModule.install,deduction},'({fixture,linked,ingredient})');
const manualFixture=fixtureDefinition('./basketboss-manual-pantry-sync.test.mjs','const INITIAL=','\ntest(',{...common,hostSource,adapterSource,harnessScope:{makeFixture:editorFixture},ACTOR:'manual_pantry_user',OUTBOX:'basketboss_purchase_pantry_sync_v1:manual_pantry_user'},'({fixture,server})');
const row={name:'Rice',loc:'cupboard',qty:250,unit:'g'},options={policy,market:'UK'};
const choice=(patch={})=>({portion:'low',capacity:1000,unit:'g',spares:0,confirmed:true,source:'label',capacityEstimated:false,...patch});
const selected=(value=row,patch={})=>{const result=levels.select(value,choice(patch),options);assert.equal(result.ok,true,result.message);return result.patch;};

test('stock levels expose the same pure helpers in a browser and CommonJS without storage access',()=>{
 const win={};vm.runInNewContext(read('bb-pantry-stock-levels.js'),{window:win});
 assert.deepEqual(Object.keys(win.BBPantryStockLevels),['validate','select','describe']);
 assert.deepEqual(copy(win.BBPantryStockLevels.select(row,choice(),{policy})),copy(levels.select(row,choice(),options)));
});

test('validated metadata is canonical, consistent and stripped of unrelated fields',()=>{
 const original={...selected(row,{portion:'half',capacity:1,unit:'kg'}).stockLevel,capacity:1,unit:'kg',confirmedQuantity:.5,confirmedUnit:'kg',scope:{kind:'household',id:ACTOR,extra:'ignored'},confirmedAt:'2026-11-16T12:00:00.000Z',unrelated:'ignored'},before=copy(original);
 const clean=levels.validate(original);
 assert.equal(clean.capacity,1000);assert.equal(clean.unit,'g');assert.equal(clean.confirmedQuantity,500);assert.equal(clean.confirmedUnit,'g');
 assert.deepEqual(clean.scope,{kind:'household',id:ACTOR});assert.equal(clean.confirmedAt,original.confirmedAt);assert.equal(Object.hasOwn(clean,'unrelated'),false);assert.deepEqual(original,before);
 assert.equal(levels.validate({...clean,estimated:false}),null);
 assert.equal(levels.validate({...clean,portion:'full',capacityEstimated:true,estimated:false}),null);
 for(const patch of [{version:2},{capacity:0},{capacity:Infinity},{unit:'mystery'},{spares:.5},{spares:101},{confirmedQuantity:501},{confirmedUnit:'ml'},{scope:'household'},{scope:{kind:'household',id:'not-a-uuid'}},{confirmedAt:'2026-02-30T12:00:00.000Z'}])assert.equal(levels.validate({...clean,...patch}),null,JSON.stringify(patch));
});

test('explicit portions use the selected physical capacity and add unopened spares once',()=>{
 const input={...row,buyMultiple:5000,buyMultipleQuantity:5000,packQuantity:800,packUnit:'g',packReviewed:true},before=copy(input);
 for(const [portion,spares,expected]of [['full',0,1000],['half',0,500],['low',0,250],['out',0,0],['full',2,3000],['half',2,2500],['low',2,2250],['out',2,2000]]){
  const patch=selected(input,{portion,spares});assert.equal(patch.qty,expected);assert.equal(patch.unit,'g');assert.equal(patch.packQuantity,1000);assert.equal(patch.packUnit,'g');
  assert.equal(patch.stockLevel.confirmedQuantity,expected);assert.equal(patch.stockLevel.estimated,['half','low'].includes(portion));
 }
 assert.equal(selected(input,{capacity:300}).qty,75,'buying preference and old capacity do not supply the selected pack size');
 assert.equal(selected({name:'Milk',unit:'ml',qty:200},{capacity:1,unit:'l',portion:'half'}).qty,500);
 assert.equal(selected({name:'Eggs',unit:'each',qty:1},{capacity:6,unit:'each',portion:'full',spares:1}).qty,12);
 assert.equal(selected(row,{portion:'full',capacityEstimated:true}).stockLevel.estimated,true);
 assert.deepEqual(input,before);
});

test('unconfirmed, absent, incompatible and overflowing capacity cannot credit stock',()=>{
 for(const patch of [{confirmed:false},{capacity:undefined},{capacity:null},{capacity:''},{capacity:0},{capacity:-1},{capacity:'1000'},{capacity:NaN},{capacity:1000000,spares:1},{capacity:.000001},{unit:'ml'},{source:'guess'},{capacityEstimated:undefined},{spares:-1},{spares:.5}]){
  const input=copy(row),before=copy(input),result=levels.select(input,choice(patch),options);assert.equal(result.ok,false,JSON.stringify(patch));assert.deepEqual(input,before);
 }
 const unknown={name:'Mystery rice',unit:'bag',qty:null,buyMultiple:1000,packQuantity:500,packUnit:'g',packReviewed:true};
 assert.equal(levels.select(unknown,choice({capacity:undefined}),options).ok,false,'existing metadata cannot supply missing confirmation');
 assert.deepEqual(levels.select(unknown,choice({capacity:undefined,portion:'out'}),options),{ok:true,patch:{qty:0,unit:'bag',stockLevel:null}});
 assert.equal(levels.select(unknown,choice({capacity:undefined,portion:'out',spares:1}),options).ok,false);
 assert.equal(levels.select({...row,unit:'ml'},choice(),options).ok,false);
 assert.equal(levels.select({...row,unit:'pack',packReviewed:true,packQuantity:500,packUnit:'ml'},choice(),options).ok,false);
});

test('spices and culinary oils keep their existing qualitative stock semantics',()=>{
 for(const value of [{name:'Cooking oil',unit:'each',qty:.5,stapleStatus:'low'},{name:'Paprika',unit:'each',qty:1,stapleStatus:'in'},{name:'Honey',unit:'g',qty:250,trackingMode:'measured',measurementReviewed:true},{...row,staple:true}]){
  const before=copy(value);assert.equal(levels.select(value,choice(),options).ok,false);assert.equal(levels.describe({...value,stockLevel:selected().stockLevel},options),null);assert.deepEqual(value,before);
 }
});

test('describing current exact stock is read-only and retains uncertainty after the balance changes',()=>{
 const value={...row,...selected()},before=copy(value);assert.deepEqual(levels.describe(value,options),{label:'Running low',estimated:true,matched:true,needsCheck:false});
 assert.deepEqual(levels.describe({...value,qty:150},options),{label:'Estimated amount remaining',estimated:true,matched:false,needsCheck:true});
 assert.equal(levels.describe({...row,...selected(row,{portion:'out'}),qty:100},options).label,'Check pack level');
 assert.deepEqual(levels.describe({...value,conflict:true},options),{label:'Estimated amount remaining',estimated:true,matched:true,needsCheck:true});
 for(const qty of [null,undefined,'',NaN])assert.equal(levels.describe({...value,qty},options).needsCheck,true);
 assert.equal(levels.describe({...value,unit:'ml'},options).needsCheck,true);assert.equal(levels.describe({...value,qty:250.000001},options).needsCheck,true);
 assert.equal(levels.describe(row,options),null);assert.deepEqual(value,before);
});

async function apply(h,patch){
 const editor=h.win.BBPantryEditor,key=editor.list().find(value=>value.name==='Rice').key,result=editor.update(key,patch);assert.equal(result.ok,true,result.message);await editor.flush();return editor.list().find(value=>value.name==='Rice');
}
test('the real editor retains 500g demand minus a 250g level estimate as a 250g shopping deficit',async()=>{
 const h=await editorFixture({requirements:[{key:'Rice',unit:'g',required:500}],stock:{'rice|g':250},inventory:{'cupboard|rice':{...row,selected:true,bb173StockKey:'rice|g',bb173StockValue:250}},live:true,configureWindow:win=>win.BBPantryStockLevels=levels});
 const before=[...h.values],existing=h.win.BBPantryEditor.list().find(value=>value.name==='Rice');assert.equal(existing.unroundedShortfall,250);assert.deepEqual([...h.values],before);
 const updated=await apply(h,selected(existing));assert.equal(updated.qty,250);assert.equal(updated.totalNeeded,500);assert.equal(updated.unroundedShortfall,250);assert.deepEqual(copy(h.stock()),{'rice|g':250});
 assert.deepEqual(copy(h.inventory()['cupboard|rice'].stockLevel),selected(existing).stockLevel);
});

test('a half 1kg container and spare containers pass through the real canonical target calculation',async()=>{
 const h=await editorFixture({requirements:[{key:'Rice',unit:'g',required:750}],inventory:{'cupboard|rice':{...row,selected:true,bb173StockKey:'rice|g',bb173StockValue:250}},stock:{'rice|g':250},live:true,configureWindow:win=>win.BBPantryStockLevels=levels});
 let updated=await apply(h,selected(row,{portion:'half',capacity:1,unit:'kg'}));assert.equal(updated.qty,500);assert.equal(updated.unroundedShortfall,250);
 updated=await apply(h,selected(updated,{portion:'low',capacity:500,spares:1}));assert.equal(updated.qty,625);assert.equal(updated.unroundedShortfall,125);
 updated=await apply(h,selected(updated,{portion:'out',capacity:500,spares:1}));assert.equal(updated.qty,500);assert.equal(updated.unroundedShortfall,250);
});

test('unknown capacity stays visible and cannot cancel the real 500g shopping need',async()=>{
 const h=await editorFixture({requirements:[{key:'Rice',unit:'g',required:500}],inventory:{'cupboard|rice':{...row,qty:null,selected:true}},stock:{}}),before=[...h.values];
 const existing=h.win.BBPantryEditor.list().find(value=>value.name==='Rice'),result=levels.select(existing,choice({capacity:undefined,confirmed:false}),options);
 assert.equal(result.ok,false);assert.equal(existing.qty,null);assert.equal(existing.unroundedShortfall,500);assert.deepEqual([...h.values],before);
 assert.equal(deduction.proposal({stock:h.stock(),ingredients:[cookFixture.ingredient('rice',500)]}).rows[0].deduct,0);
});

test('repeated level taps replace the same absolute amount without adding another container',async()=>{
 const h=await editorFixture({requirements:[{key:'Rice',unit:'g',required:500}],inventory:{'cupboard|rice':{...row,selected:true,bb173StockKey:'rice|g',bb173StockValue:250}},stock:{'rice|g':250},live:true,configureWindow:win=>win.BBPantryStockLevels=levels});
 const patch=selected();await apply(h,patch);await apply(h,patch);assert.equal(h.stock()['rice|g'],250);
 await apply(h,selected(row,{portion:'out'}));await apply(h,selected(row,{portion:'out'}));assert.equal(h.stock()['rice|g'],0);
});

test('cooking deducts the estimate once and the changed remainder is never reset by its saved level',async()=>{
 const patch=selected(),h=cookFixture.fixture('app.html',{stock:{'rice|g':patch.qty},inventory:{rice:cookFixture.linked('rice|g',patch.qty,'g',patch)},ingredients:[cookFixture.ingredient('rice',100)]});
 const event=h.event(),preview=h.home.previewCook(event),results=await Promise.all([h.home.cooked({...event,expected:preview.fingerprint}),h.home.cooked({...event,expected:preview.fingerprint})]);
 assert.equal(results.every(result=>result.ok),true);assert.equal(results.filter(result=>result.already).length,1);assert.equal(h.stock()['rice|g'],150);assert.equal(h.syncs.length,1);
 const before=[...h.values],description=levels.describe(h.inventory().rice,options);assert.equal(description.estimated,true);assert.equal(description.matched,false);assert.equal(description.needsCheck,true);assert.deepEqual([...h.values],before);
 assert.equal(homeModule.purchaseAmounts({needed:500,owned:h.stock()['rice|g'],multiple:0,unit:'g'}).shortfall,350);
});

test('a receipt respects an existing checkbox credit even when that balance has stock-level metadata',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},win={localStorage:storage,addEventListener(){}};
 vm.runInNewContext(adapterSource,{window:win,URL,console,Date});
 const adapter=win.BBReceiptInventoryFactory({core:receiptCore,storage,getSession:()=>({user:{id:ACTOR},access_token:'synthetic-level-token',expires_at:4_000_000_000}),getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'shop-level'}),getCatalog:()=>({'rice|g':{}}),fetch:async()=>{throw Error('Local receipt fixture must not contact a service.');}});
 const patch=selected(row,{portion:'full',capacity:500});storage.setItem(adapter.keys.stock,JSON.stringify({'rice|g':patch.qty}));storage.setItem(INVENTORY,JSON.stringify({rice:{...row,...patch,selected:true}}));
 storage.setItem(adapter.keys.finishShop,JSON.stringify({'shop-level|rice|g':{name:'rice',unit:'g',credited:500,week:'shop-level'}}));
 const packet={receiptId:'stock-level-receipt',market:'UK',retailer:'Tesco',shopSessionId:'shop-level',stockPantry:true,items:[{key:'rice',name:'Rice',classification:'food',quantity:500,unit:'g',price:2}]};
 assert.equal((await adapter.commitLocalReceipt(packet)).ok,true);assert.equal((await adapter.commitLocalReceipt(packet)).duplicate,true);assert.equal(JSON.parse(storage.getItem(adapter.keys.stock))['rice|g'],500);
});

async function saveLevelRice(h){
 const editor=h.win.BBPantryEditor;for(const value of editor.list())assert.equal(editor.remove(value.key).ok,true);
 assert.equal(editor.add({...row}).ok,true);await apply(h,selected());
}
test('offline level edits retain one absolute target across restart and safe retry',async()=>{
 const h=await manualFixture.fixture();h.win.BBPantryStockLevels=levels;await saveLevelRice(h);assert.equal(h.outbox().stock['rice|g'],250);assert.equal(h.remote.posts.length,0);
 const reloaded=await manualFixture.fixture({remote:h.remote,saved:new Map(h.values)});h.remote.available=true;
 assert.equal((await reloaded.host.retryPurchasedPantry()).queued,false);assert.deepEqual(copy(reloaded.stock()),{'rice|g':250});assert.deepEqual(copy(h.remote.stock),{'rice|g':250});assert.equal(reloaded.outbox(),null);
});
test('a household revision conflict preserves both the local level amount and the partner balance',async()=>{
 const remote=manualFixture.server();remote.scope={kind:'household',id:ACTOR};const h=await manualFixture.fixture({remote});h.win.BBPantryStockLevels=levels;
 remote.stock={'rice|g':900};remote.revision++;remote.available=true;await saveLevelRice(h);
 assert.deepEqual(copy(h.stock()),{'rice|g':250});assert.deepEqual(copy(remote.stock),{'rice|g':900});assert.equal(h.outbox().remoteConflict,true);assert.equal(h.outbox().stock['rice|g'],250);assert.match(h.status(),/Account & cloud sync/);
});

test('a failed metadata-intent write rolls back the real pantry balance and metadata together',async()=>{
 const packSync=require('../bb-pantry-pack-sync.js'),intent='basketboss_pantry_pack_sync_v1:'+ACTOR+':'+ACTOR;
 const h=await editorFixture({requirements:[{key:'Rice',unit:'g',required:500}],inventory:{'cupboard|rice':{...row,selected:true,bb173StockKey:'rice|g',bb173StockValue:250}},stock:{'rice|g':250},live:true,configureWindow(win){
  win.BBPantryStockLevels=levels;win.navigator={onLine:false};
  win.localStorage.setItem(SESSION,JSON.stringify({user:{id:ACTOR},access_token:'synthetic-metadata-token',expires_at:4_000_000_000}));
  win.BBReceiptHost={...win.BBReceiptHost,getProjection:()=>({actorId:ACTOR,scope:{kind:'household',id:ACTOR},inventoryRevision:3})};
  win.BBPantryPackSync=packSync.install(win);
 }}),before=new Map(h.values),write=h.storage.setItem;let failed=false;
 h.storage.setItem=(key,value)=>{if(key===intent&&!failed){failed=true;throw Error('synthetic metadata storage failure');}return write(key,value);};
 await apply(h,selected(row,{capacity:500,scope:{kind:'household',id:ACTOR}}));
 assert.equal(failed,true,'failure exercises the actual pack adapter intent');assert.deepEqual(new Map(h.values),before);assert.equal(h.stock()['rice|g'],250);assert.equal(h.storage.getItem(intent),null);assert.match(h.status(),/Could not save safely/);
});
