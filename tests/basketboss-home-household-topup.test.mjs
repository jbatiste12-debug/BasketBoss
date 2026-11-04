import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const homeAPI=createRequire(import.meta.url)('../bb-home.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const essentialsSource=fs.readFileSync(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8');
const featureKey='basketboss_321_features_v1';

function fixture(item){
 const values=new Map([[featureKey,JSON.stringify({version:1,essentials:[item]})]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const read=key=>JSON.parse(storage.getItem(key)||'{}');
 const win={localStorage:storage,location:{search:''},document:{}};
 const ctx=vm.createContext({window:win,localStorage:storage,BB307_FEATURE_KEY:featureKey,bb307FeatureState:read(featureKey),
  bb307Plan:()=>({items:[]}),bbReceiptPantryReviewRequired:()=>false,bbReceiptHasAuthoritativePantry:()=>false,
  bb321UnifiedShop:items=>items,bbShopV7Reconcile:()=>true,bb321ReadShopTicks:()=>({}),bb84SeedPreviouslyBought(){},bb84ExtraNeeded:()=>0,
  bb321Number:value=>Math.round(value*100)/100,BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit},notify(){}});
 vm.runInContext(essentialsSource,ctx);ctx.BBWeeklyEssentials=win.BBWeeklyEssentials;
 const prepareLine=html.split('\n').find(line=>line.trimStart().startsWith('prepareHousehold:'));
 assert.ok(prepareLine,'use the real app household persistence adapter');
 vm.runInContext('prepareHousehold='+prepareLine.trim().slice('prepareHousehold:'.length,-1),ctx);
 const start=html.indexOf('function bb321WeeklySummary('),end=html.indexOf('\nfunction bb321TinSpec(',start);
 assert.ok(start>=0&&end>start,'use the real Shop summary pipeline');
 vm.runInContext(html.slice(start,end),ctx);
 ctx.bb15Quote=(row,essential)=>essential?ctx.BBWeeklyEssentials.quote(row,{market:'UK'}):{amount:0};
 win.BBHomeHost={household:()=>ctx.bb307FeatureState.essentials,prepareHousehold:ctx.prepareHousehold,
  reload:()=>{ctx.bb307FeatureState=read(featureKey);},refresh(){},id:(name,unit)=>name.toLowerCase()+'|'+unit};
 win.BBHome=homeAPI.install(win);
 return {home:win.BBHome,host:win.BBHomeHost,storage,read,summary:()=>ctx.bb321WeeklySummary()};
}

for(const [label,item,expected] of [
 ['skipped',{id:'shampoo',name:'Shampoo',unit:'each',qty:3,targetQty:3,ownedQty:1,manualPending:true,selected:false,owned:false},3],
 ['previously owned',{id:'rolls',name:'Toilet rolls',unit:'pack',qty:1,targetQty:1,ownedQty:1,manualPending:false,selected:false,owned:true},1],
 ['receipt-created',{id:'toothpaste',name:'Toothpaste',unit:'each',qty:1,targetQty:0,ownedQty:1,manualPending:false,selected:false,owned:false},1]
])test('tapping a '+label+' essential immediately restores its reconciled Shop shortfall',()=>{
 const h=fixture(item);
 assert.equal(h.summary().essentials.length,0);
 assert.equal(h.home.addHousehold(item.id),true);
 const stored=h.read(featureKey).essentials[0],summary=h.summary();
 assert.equal(stored.selected,true);
 assert.equal(stored.owned,false);
 assert.equal(stored.manualPending,true);
 assert.equal(summary.essentials.length,1,'essential-only weeks must still produce a shopping row');
 assert.equal(summary.essentials[0].id,item.id);
 assert.equal(summary.essentials[0].qty,expected,'Shop uses target minus stock, rather than the old qty field');
 assert.equal(summary.essentials[0].displaySpend,null,'unknown pricing must not hide an item');
 assert.equal(summary.pending,1);
});

test('repeated essential taps update one request without creating duplicate rows',()=>{
 const h=fixture({id:'soap',name:'Soap',unit:'each',qty:1,targetQty:0,ownedQty:2,manualPending:false,selected:false,owned:true});
 h.home.addHousehold('soap');h.home.addHousehold('soap');
 const summary=h.summary();
 assert.equal(summary.essentials.length,1);
 assert.equal(summary.essentials[0].qty,2);
 assert.equal(h.read(featureKey).essentials[0].ownedQty,2,'adding a purchase request does not change stock');
});

test('explicit household quantity edits restore a hidden item and only expose its remaining shortfall',()=>{
 const h=fixture({id:'detergent',name:'Laundry detergent',unit:'ml',qty:1,targetQty:500,ownedQty:500,manualPending:false,selected:false,owned:true});
 const change=h.host.prepareHousehold([['detergent',{targetQty:1000,ownedQty:250}]]);
 homeAPI.atomic(h.storage,{[change.key]:change.value},{[change.key]:change.expected});h.host.reload();
 const summary=h.summary();
 assert.equal(summary.essentials.length,1);
 assert.equal(summary.essentials[0].qty,750);
 assert.equal(h.read(featureKey).essentials[0].owned,false);
 const covered=h.host.prepareHousehold([['detergent',{targetQty:1000,ownedQty:1000}]]);
 homeAPI.atomic(h.storage,{[covered.key]:covered.value},{[covered.key]:covered.expected});h.host.reload();
 assert.equal(h.summary().essentials.length,0,'covered household targets stay off the list');
});

test('a failed household top-up leaves the previous intent and stock intact for retry',()=>{
 const h=fixture({id:'soap',name:'Soap',unit:'each',qty:1,targetQty:0,ownedQty:2,manualPending:false,selected:false,owned:true});
 const before=h.storage.getItem(featureKey),put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key===featureKey&&fail){fail=false;throw Error('storage full');}put(key,value);};
 assert.throws(()=>h.home.addHousehold('soap'),/storage full/);
 assert.equal(h.storage.getItem(featureKey),before);
 assert.equal(h.summary().essentials.length,0);
 assert.equal(h.home.addHousehold('soap'),true);
 assert.equal(h.summary().essentials[0].qty,1);
});
