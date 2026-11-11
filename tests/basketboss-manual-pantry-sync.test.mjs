import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),homeModule=require('../bb-home.js');
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('shopping-inventory.js'),html=read('index.html'),hostSource=read('bb-receipt-host.js'),adapterSource=read('bb-receipt-inventory.js');
const pantrySource=html.match(/const BB307Pantry=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/)[0];
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory',ACTOR='manual_pantry_user',OUTBOX='basketboss_purchase_pantry_sync_v1:'+ACTOR;
const copy=value=>JSON.parse(JSON.stringify(value));
// Reuse only the existing small DOM fixture, never its registered tests. All
// pantry handlers, host queue operations and receipt projections remain real.
const fixtureURL=new URL('./basketboss-pantry-policy-ui.test.mjs',import.meta.url).href;
const helper=fs.readFileSync(new URL(fixtureURL),'utf8'),start=helper.indexOf('export async function fixture('),end=helper.indexOf('\n\ntest(',start);
assert.ok(start>=0&&end>start);
const harnessScope={assert,fs,vm,URL,fixtureURL,source,pantrySource,policy,homeModule,receiptCore,STOCK,INVENTORY,console,setTimeout,clearTimeout,queueMicrotask,
 decode:value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x])),dataKey:name=>name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())};
vm.runInNewContext(helper.slice(start,end).replace('export async function fixture','async function fixture').replaceAll('import.meta.url','fixtureURL')+'\nthis.makeFixture=fixture;',harnessScope);
const INITIAL={'chicken breast|g':533.333333,'lime|g':93.333333,'mixed peppers|g':80};
function server(){return {
 stock:copy(INITIAL),revision:3,available:false,posts:[],failure:false,scope:{kind:'user',id:ACTOR},
 snapshot(){return {ok:true,initialized:true,scope:copy(this.scope),inventoryRevision:this.revision,stock:copy(this.stock),pantryReview:{required:false},inventory:[],essentials:[],receipts:[],priceObservations:[]};},
 async fetch(url,options={}){
  const response=(value,status=200)=>({ok:status<400,status,json:async()=>copy(value)});
  if(url.includes('mode=status'))return response({ok:true,configured:true,available:this.available,premium:true});
  if(options.method!=='POST')return response(this.snapshot());
  const body=JSON.parse(options.body);this.posts.push(body);if(this.failure)throw Error('network unavailable');
  if(body.expectedRevision!==this.revision||JSON.stringify(body.expectedScope)!==JSON.stringify(this.scope))return response({error:'inventory_revision_conflict'},409);
  this.stock=copy(body.stock);this.revision++;const result=this.snapshot();await this.afterPost?.(body);return response(result);
 }
};}
async function fixture({remote=server(),saved}={}){
 const stock=saved?JSON.parse(saved.get(STOCK)||'{}'):copy(INITIAL),inventory=saved?JSON.parse(saved.get(INVENTORY)||'{}'):Object.fromEntries(Object.entries(stock).map(([key,qty])=>{
  const at=key.lastIndexOf('|'),name=key.slice(0,at),unit=key.slice(at+1);return ['fridge|'+name,{name,loc:'fridge',selected:true,qty,unit,bb173StockKey:key,bb173StockValue:qty}];
 }));
 let host,adapter,reviewCalls=0;
 const h=await harnessScope.makeFixture({stock,inventory,requirements:[],live:true,configureWindow(win){
  if(saved)for(const [key,value]of saved)win.localStorage.setItem(key,value);
  const session={user:{id:ACTOR},access_token:'manual-sync-private-token',expires_at:9999999999};
  win.localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify(session));
  if(!saved){
   const cacheKey='basketboss_receipt_inventory_v1:'+ACTOR+':user:'+ACTOR,scope=remote.scope;
   win.localStorage.setItem(cacheKey,JSON.stringify({version:1,actorId:ACTOR,scope,initialized:true,inventoryRevision:remote.revision,serverStock:copy(remote.stock),pantryReview:{required:false},inventory:[],essentials:[],receipts:[],priceObservations:[]}));
   win.localStorage.setItem('basketboss_receipt_projection_owner_v1',JSON.stringify({version:1,actorId:ACTOR,scope,cacheKey,initialized:true,inventoryRevision:remote.revision,serverStock:copy(remote.stock)}));
  }
  vm.runInNewContext(adapterSource,{window:win,console,queueMicrotask});vm.runInNewContext(hostSource,{window:win,console,queueMicrotask,Intl,Date});
  const getSession=()=>JSON.parse(win.localStorage.getItem('basketboss_cloud_session_v1')||'null'),getContext=()=>({market:'UK',retailer:'Tesco',shopSessionId:'manual-trip'});
  adapter=win.BBReceiptInventoryFactory({core:receiptCore,storage:win.localStorage,fetch:remote.fetch.bind(remote),getSession,getContext,pantryPolicy:true});
  host=win.BBReceiptHostFactory({document:{getElementById:()=>null,querySelector:()=>null},storage:win.localStorage,inventory:adapter,fetch:remote.fetch.bind(remote),getSession,getContext,getStock:()=>JSON.parse(win.localStorage.getItem(STOCK)||'{}'),getTab:()=> 'account-test',pantryPolicy:true,accountPantrySync:true});
  host.configure();win.BBReceiptHost={...host,reviewPantry(){reviewCalls++;throw Error('A separate pantry form must not open');}};
 }});
 return {...h,host,adapter,remote,stock:()=>JSON.parse(h.storage.getItem(STOCK)||'{}'),outbox:()=>JSON.parse(h.storage.getItem(OUTBOX)||'null'),reviewCalls:()=>reviewCalls};
}
async function replaceFood(h,add=true){
 const editor=h.win.BBPantryEditor;assert.ok(editor);
 for(const row of editor.list())assert.equal(editor.remove(row.key).ok,true);
 if(add)assert.equal(editor.add({name:'Sausages',loc:'fridge',qty:4,unit:'each'}).ok,true);
 assert.equal(h.outbox(),null,'draft changes must not enqueue an uncommitted pantry');
 await editor.flush();
}

test('manual removal and addition queue one exact pantry target offline and survive restart',async()=>{
 const h=await fixture();await replaceFood(h);
 assert.deepEqual(h.stock(),{'sausages|each':4});assert.deepEqual(h.outbox().stock,{'sausages|each':4});assert.deepEqual(h.outbox().baselineStock,INITIAL);assert.equal(h.outbox().expectedRevision,3);
 assert.equal(h.remote.posts.length,0);assert.equal(h.reviewCalls(),0);assert.match(h.status(),/saved in At home/);
 const reloaded=await fixture({remote:h.remote,saved:new Map(h.values)});h.remote.available=true;
 assert.equal((await reloaded.host.retryPurchasedPantry()).queued,false);assert.deepEqual(reloaded.stock(),{'sausages|each':4});assert.deepEqual(h.remote.stock,{'sausages|each':4});assert.equal(reloaded.outbox(),null);
 assert.equal((await reloaded.adapter.synchronize()).localApplied,true);assert.deepEqual(reloaded.stock(),{'sausages|each':4});assert.equal(reloaded.reviewCalls(),0);
 assert.ok(!reloaded.storage.getItem(OUTBOX)?.includes('manual-sync-private-token'));
});

test('an explicitly empty pantry remains a durable deletion target across restart',async()=>{
 const h=await fixture();await replaceFood(h,false);
 assert.deepEqual(h.stock(),{});assert.deepEqual(h.outbox().stock,{});
 const reloaded=await fixture({remote:h.remote,saved:new Map(h.values)});h.remote.available=true;
 assert.equal((await reloaded.host.retryPurchasedPantry()).queued,false);assert.deepEqual(h.remote.stock,{});assert.deepEqual(reloaded.stock(),{});assert.equal(reloaded.outbox(),null);assert.equal(reloaded.reviewCalls(),0);
});

test('failed online synchronization retains the saved local target for a later safe retry',async()=>{
 const remote=server();remote.available=true;remote.failure=true;
 const h=await fixture({remote});await replaceFood(h);
 assert.deepEqual(h.stock(),{'sausages|each':4});assert.deepEqual(h.outbox().stock,{'sausages|each':4});assert.deepEqual(h.remote.stock,INITIAL);assert.equal(h.reviewCalls(),0);
 remote.failure=false;const reloaded=await fixture({remote,saved:new Map(h.values)});
 assert.equal((await reloaded.host.retryPurchasedPantry()).queued,false);assert.deepEqual(remote.stock,{'sausages|each':4});assert.deepEqual(reloaded.stock(),{'sausages|each':4});
});

test('a real remote conflict never restores deleted foods or changes unrelated shopping progress',async()=>{
 const h=await fixture();h.remote.stock={'milk|ml':250};h.remote.revision++;h.remote.available=true;
 const ticks='{"unrelated|each":true}';h.storage.setItem('basketboss_321_v11_shop_ticks',ticks);
 await replaceFood(h);
 assert.deepEqual(h.stock(),{'sausages|each':4});assert.deepEqual(h.outbox().stock,{'sausages|each':4});assert.equal(h.outbox().remoteConflict,true);assert.deepEqual(h.remote.stock,{'milk|ml':250});
 assert.equal(h.storage.getItem('basketboss_321_v11_shop_ticks'),ticks);assert.equal(h.reviewCalls(),0);assert.match(h.status(),/Account & cloud sync/);
});

for(const failedKey of [OUTBOX,STOCK,INVENTORY])test('failure writing '+failedKey+' rolls back stock and pending sync together',async()=>{
 const h=await fixture(),before=new Map(h.values),original=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key===failedKey&&fail){fail=false;throw Error('quota');}return original(key,value);};
 await replaceFood(h);
 assert.deepEqual(new Map(h.values),before);assert.equal(h.outbox(),null);assert.equal(h.remote.posts.length,0);assert.equal(h.reviewCalls(),0);assert.match(h.status(),/Could not save safely/);
});

test('an account-owner change after preparation cannot commit the draft or its queued target',async()=>{
 const h=await fixture(),beforeStock=h.storage.getItem(STOCK),beforeInventory=h.storage.getItem(INVENTORY),ownerKey='basketboss_receipt_projection_owner_v1',newOwner=JSON.stringify({actorId:'another_pantry_user'});
 h.win.BBReceiptHost={...h.win.BBReceiptHost,preparePurchasedPantry(value){const prepared=h.host.preparePurchasedPantry(value);h.storage.setItem(ownerKey,newOwner);return prepared;}};
 await replaceFood(h);
 assert.equal(h.storage.getItem(STOCK),beforeStock);assert.equal(h.storage.getItem(INVENTORY),beforeInventory);assert.equal(h.storage.getItem(ownerKey),newOwner);assert.equal(h.outbox(),null);assert.equal(h.remote.posts.length,0);
});

async function changedScope(){
 const h=await fixture();await replaceFood(h);
 h.remote.scope={kind:'household',id:'shared_pantry_01'};h.remote.stock={'milk|ml':250.333333};h.remote.revision=10;h.remote.available=true;
 return h;
}
test('explicit Account adoption uses only household stock and archives the old personal pantry and pending queue',async()=>{
 const h=await changedScope(),ownerKey='basketboss_receipt_projection_owner_v1',oldOwner=JSON.parse(h.storage.getItem(ownerKey)),oldKitchen=JSON.parse(h.storage.getItem(INVENTORY)),oldQueue=h.outbox();
 const result=await h.host.syncAccountPantry({adoptScope:true});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.localApplied,true);
 assert.deepEqual(h.stock(),{'milk|ml':250.333333});assert.deepEqual(h.remote.stock,{'milk|ml':250.333333});assert.equal(h.outbox(),null);assert.equal(h.reviewCalls(),0);
 assert.deepEqual(JSON.parse(h.storage.getItem(ownerKey)).scope,{kind:'household',id:'shared_pantry_01'});
 const backup=JSON.parse(h.storage.getItem(result.backupKey));assert.deepEqual(backup.pantry.values[STOCK],{'sausages|each':4});assert.deepEqual(backup.owner,oldOwner);assert.deepEqual(backup.kitchen,oldKitchen);assert.deepEqual(backup.outbox,oldQueue);
 assert.doesNotMatch(h.storage.getItem(result.backupKey),/manual-sync-private-token|access_token|cloud_session/);
 assert.equal(h.remote.posts.at(-1).expectedRevision,10);assert.deepEqual(h.remote.posts.at(-1).expectedScope,h.remote.scope);
});
test('a local change during Account adoption prevents the real adapter from applying its response',async()=>{
 const h=await changedScope(),ownerKey='basketboss_receipt_projection_owner_v1',oldOwner=h.storage.getItem(ownerKey),oldQueue=h.storage.getItem(OUTBOX);
 h.remote.afterPost=()=>{h.remote.afterPost=null;h.storage.setItem(STOCK,JSON.stringify({'sausages|each':9}));};
 const result=await h.host.adoptAccountPantryScope();assert.equal(result.ok,false);assert.equal(result.localApplied,false);assert.equal(result.localError,'receipt_local_data_changed');
 assert.deepEqual(h.stock(),{'sausages|each':9});assert.equal(h.storage.getItem(ownerKey),oldOwner);assert.equal(h.storage.getItem(OUTBOX),oldQueue);assert.deepEqual(h.remote.stock,{'milk|ml':250.333333});
 const backup=JSON.parse(h.storage.getItem(result.backupKey));assert.deepEqual(backup.pantry.values[STOCK],{'sausages|each':4});assert.deepEqual(backup.outbox,JSON.parse(oldQueue));
});
test('failed queue retirement rolls back the adoption journal and retains the personal pantry and queue',async()=>{
 const h=await changedScope(),ownerKey='basketboss_receipt_projection_owner_v1',oldStock=h.storage.getItem(STOCK),oldKitchen=h.storage.getItem(INVENTORY),oldOwner=h.storage.getItem(ownerKey),oldQueue=h.storage.getItem(OUTBOX),remove=h.storage.removeItem;let fail=true;
 h.storage.removeItem=key=>{if(key===OUTBOX&&fail){fail=false;throw Error('queue retirement failed');}return remove(key);};
 const result=await h.host.syncAccountPantry({adoptScope:true});assert.equal(result.ok,false);assert.equal(result.localApplied,false);assert.equal(fail,false,'the failure occurs inside the real combined projection journal');
 assert.equal(h.storage.getItem(STOCK),oldStock);assert.equal(h.storage.getItem(INVENTORY),oldKitchen);assert.equal(h.storage.getItem(ownerKey),oldOwner);assert.equal(h.storage.getItem(OUTBOX),oldQueue);
 assert.equal(h.storage.getItem('basketboss_receipt_inventory_journal_v1:'+ACTOR),null);assert.ok(h.storage.getItem(result.backupKey),'the safe pre-adoption backup remains available');
});
