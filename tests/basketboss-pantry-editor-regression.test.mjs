import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js');
const homeModule=require('../bb-home.js'),deduction=require('../bb-pantry-deduction.js');
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
const HOME='basketboss_at_home_requirements_v1',SESSION='basketboss_cloud_session_v1',PLAN='basketboss_321_unified_state_v1';
const ACTOR='11111111-1111-4111-8111-111111111111';
const source=read('shopping-inventory.js'),html=read('index.html');
const pantrySource=html.match(/const BB307Pantry=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/)[0];
const hostSource=read('bb-receipt-host.js'),adapterSource=read('bb-receipt-inventory.js');

// Reuse the existing isolated fixture definitions without importing their
// registered tests. Calculations, writes, conversion and sync all run through
// the real production modules; no replacement reconciliation is defined here.
function fixtureDefinition(file,startMarker,endMarker,scope,expose){
 const text=fs.readFileSync(new URL(file,import.meta.url),'utf8');
 const start=text.indexOf(startMarker),end=text.indexOf(endMarker,start);
 assert.ok(start>=0&&end>start,'existing fixture boundary: '+file);
 vm.runInNewContext(text.slice(start,end).replace('export async function fixture','async function fixture').replaceAll('import.meta.url','fixtureURL')+'\nthis.fixtureExports='+expose+';',scope);
 return scope.fixtureExports;
}
const fixtureURL=new URL('./basketboss-pantry-policy-ui.test.mjs',import.meta.url).href;
const common={assert,fs,vm,URL,read,copy,source,pantrySource,policy,homeModule,receiptCore,STOCK,INVENTORY,console,setTimeout,clearTimeout,queueMicrotask,
 decode:value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x])),
 dataKey:name=>name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())};
const editorFixture=fixtureDefinition('./basketboss-pantry-policy-ui.test.mjs','export async function fixture(','\n\ntest(',{...common,fixtureURL},'fixture');
const cookFixture=fixtureDefinition('./basketboss-pantry-conversion-cook-flow.test.mjs','function actualFunction(','\n\nfor(const entry',{
 ...common,HOME,SESSION,PLAN,ACTOR,install:homeModule.install,deduction
},'({fixture,linked,ingredient})');
const manualFixture=fixtureDefinition('./basketboss-manual-pantry-sync.test.mjs','const INITIAL=','\ntest(',{
 ...common,hostSource,adapterSource,harnessScope:{makeFixture:editorFixture},ACTOR:'manual_pantry_user',OUTBOX:'basketboss_purchase_pantry_sync_v1:manual_pantry_user'
},'({fixture,server})');
const linked=cookFixture.linked,ingredient=cookFixture.ingredient;

test('editor keeps the 500g requirement and 250g pantry balance as a 250g shopping deficit',async()=>{
 const h=await editorFixture({requirements:[{key:'Rice',unit:'g',required:500}],stock:{'rice|g':250},inventory:{
  'cupboard|rice':{name:'Rice',loc:'cupboard',qty:250,unit:'g',selected:true,bb173StockKey:'rice|g',bb173StockValue:250}
 }});
 const before=[...h.values],row=h.win.BBPantryEditor.list().find(row=>row.name==='Rice');
 assert.equal(row.qty,250);assert.equal(row.totalNeeded,500);assert.equal(row.unroundedShortfall,250);
 assert.deepEqual([...h.values],before,'opening and reading the editor does not reconcile by writing');
});

test('a reviewed half of a 1kg pack supplies 500g without introducing a qualitative level',()=>{
 const h=cookFixture.fixture('app.html',{stock:{'rice|pack':.5},inventory:{rice:linked('rice|pack',.5,'pack',{packReviewed:true,packQuantity:1000,packUnit:'g'})},ingredients:[ingredient('rice',750)]});
 const before=[...h.values],preview=h.home.previewCook(h.event());
 assert.equal(preview.ok,true);assert.equal(preview.rows[0].owned,500);assert.equal(preview.rows[0].deduct,500);
 assert.equal(homeModule.purchaseAmounts({needed:750,owned:preview.rows[0].owned,multiple:0,unit:'g'}).shortfall,250);
 assert.deepEqual([...h.values],before,'the reviewed pack is read without changing its balance');
});

test('an unknown pantry amount provides no measured recipe credit',async()=>{
 const h=await editorFixture({requirements:[{key:'Rice',unit:'g',required:500}],stock:{},inventory:{
  'cupboard|rice':{name:'Rice',loc:'cupboard',qty:null,unit:'g',selected:true}
 }});
 const row=h.win.BBPantryEditor.list().find(row=>row.name==='Rice');
 assert.equal(row.qty,null);assert.equal(row.unroundedShortfall,500);assert.deepEqual(copy(h.stock()),{});
 const preview=deduction.proposal({stock:h.stock(),ingredients:[ingredient('rice',500)]});
 assert.equal(preview.rows[0].owned,0);assert.equal(preview.rows[0].deduct,0);
});

test('multiple reviewed equal packs supply their full combined capacity',()=>{
 const h=cookFixture.fixture('app.html',{stock:{'rice|pack':2},inventory:{rice:linked('rice|pack',2,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'})},ingredients:[ingredient('rice',1200)]});
 const preview=h.home.previewCook(h.event());
 assert.equal(preview.rows[0].owned,1000);assert.equal(preview.rows[0].deduct,1000);
 assert.equal(homeModule.purchaseAmounts({needed:1200,owned:preview.rows[0].owned,multiple:0,unit:'g'}).shortfall,200);
 assert.equal(h.inventory().rice.packQuantity,500);assert.equal(h.inventory().rice.qty,2);
});

test('different pack capacities cannot silently borrow the last entered container size',()=>{
 const h=cookFixture.fixture('app.html',{stock:{'rice|pack':2},inventory:{
  first:linked('rice|pack',1,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'}),
  second:linked('rice|pack',1,'pack',{packReviewed:true,packQuantity:250,packUnit:'g'})
 },ingredients:[ingredient('rice',500)]});
 const before=[...h.values],preview=h.home.previewCook(h.event());
 assert.equal(preview.rows[0].deduct,0);assert.equal(preview.issues.length,1);
 assert.deepEqual([...h.values],before,'ambiguous capacity stays available for review instead of being guessed');
});

test('an unreviewed bag is retained while compatible grams alone cover a recipe',async()=>{
 const bag=linked('rice|bag',1,'bag',{packReviewed:false});
 const h=cookFixture.fixture('app.html',{stock:{'rice|bag':1,'rice|g':250},inventory:{bag,measured:linked('rice|g',250,'g')},ingredients:[ingredient('rice',500)]});
 const preview=h.home.previewCook(h.event());assert.equal(preview.rows[0].deduct,250);assert.equal(preview.issues.length,1);
 const result=await h.cook();assert.equal(result.ok,true);assert.deepEqual(copy(h.stock()),{'rice|bag':1});assert.deepEqual(copy(h.inventory().bag),copy(bag));
});

test('cooking leaves the exact remainder available to the next meal',async()=>{
 const h=cookFixture.fixture('app.html',{stock:{'rice|g':1000},inventory:{rice:linked('rice|g',1000,'g')},ingredients:[ingredient('rice',250)]});
 assert.equal((await h.cook()).ok,true);assert.equal(h.stock()['rice|g'],750);
 h.state.ingredients=[ingredient('rice',500)];assert.equal((await h.cook('second','Tuesday')).ok,true);
 assert.equal(h.stock()['rice|g'],250);assert.equal(h.inventory().rice.qty,250);
 assert.equal(homeModule.purchaseAmounts({needed:500,owned:h.stock()['rice|g'],multiple:0,unit:'g'}).shortfall,250);
});

test('duplicate confirmation taps deduct the same meal only once',async()=>{
 const h=cookFixture.fixture('app.html',{stock:{'rice|g':1000},inventory:{rice:linked('rice|g',1000,'g')},ingredients:[ingredient('rice',250)]});
 const event=h.event(),preview=h.home.previewCook(event),results=await Promise.all([
  h.home.cooked({...event,expected:preview.fingerprint}),h.home.cooked({...event,expected:preview.fingerprint})
 ]);
 assert.equal(results.every(result=>result.ok),true);assert.equal(results.filter(result=>result.already).length,1);
 assert.equal(h.stock()['rice|g'],750);assert.equal(h.syncs.length,1);
});

test('receipt confirmation recognises an existing shopping checkbox credit and cannot add it twice',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const win={localStorage:storage,addEventListener(){}};vm.runInNewContext(adapterSource,{window:win,URL,console,Date});
 const adapter=win.BBReceiptInventoryFactory({core:receiptCore,storage,getSession:()=>({user:{id:ACTOR},access_token:'synthetic-test-token',expires_at:4_000_000_000}),getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'shop-1'}),getCatalog:()=>({'rice|g':{}}),fetch:async()=>{throw Error('This local receipt path must not call a service.');}});
 storage.setItem(adapter.keys.stock,JSON.stringify({'rice|g':500}));
 storage.setItem(adapter.keys.finishShop,JSON.stringify({'shop-1|rice|g':{name:'rice',unit:'g',credited:500,week:'shop-1'}}));
 const packet={receiptId:'editor-regression-receipt',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',stockPantry:true,items:[{key:'rice',name:'Rice',classification:'food',quantity:500,unit:'g',price:2}]};
 assert.equal((await adapter.commitLocalReceipt(packet)).ok,true);assert.equal(JSON.parse(storage.getItem(adapter.keys.stock))['rice|g'],500);
 assert.equal((await adapter.commitLocalReceipt(packet)).duplicate,true);assert.equal(JSON.parse(storage.getItem(adapter.keys.stock))['rice|g'],500);
});

async function saveRice(h){
 const editor=h.win.BBPantryEditor;
 for(const row of editor.list())assert.equal(editor.remove(row.key).ok,true);
 assert.equal(editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'}).ok,true);
 await editor.flush();
}

test('an offline manual amount survives restart and synchronises as the same absolute balance',async()=>{
 const h=await manualFixture.fixture();await saveRice(h);
 assert.equal(h.remote.posts.length,0);assert.equal(h.outbox().stock['rice|g'],250);assert.equal(h.stock()['rice|g'],250);
 const reloaded=await manualFixture.fixture({remote:h.remote,saved:new Map(h.values)});h.remote.available=true;
 assert.equal((await reloaded.host.retryPurchasedPantry()).queued,false);
 assert.deepEqual(copy(reloaded.stock()),{'rice|g':250});assert.deepEqual(copy(h.remote.stock),{'rice|g':250});assert.equal(reloaded.outbox(),null);
});

test('a household revision conflict retains the entered balance without overwriting the partner balance',async()=>{
 const remote=manualFixture.server();remote.scope={kind:'household',id:'shared-editor-household'};
 const h=await manualFixture.fixture({remote});remote.stock={'rice|g':900};remote.revision++;remote.available=true;
 await saveRice(h);
 assert.deepEqual(copy(h.stock()),{'rice|g':250});assert.deepEqual(copy(remote.stock),{'rice|g':900});assert.equal(h.outbox().remoteConflict,true);
 assert.deepEqual(copy(h.outbox().stock),{'rice|g':250});assert.match(h.status(),/Account & cloud sync/);
});
