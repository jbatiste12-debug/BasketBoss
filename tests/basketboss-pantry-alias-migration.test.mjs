import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {normalizePantryState} from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),migration=require('../bb-pantry-alias-migration.js'),ownership=require('../bb-shop-ownership.js');
const keys=migration.keys,ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const queueKey='basketboss_purchase_pantry_sync_v1:'+ACTOR;
const clone=value=>JSON.parse(JSON.stringify(value));
// This fixture uses the real unchanged normalizer with an exact application
// resolver, rather than replacing stock arithmetic or its lot grouping.
const aliases=new Map([['sausages','pork sausages'],['sausage','pork sausages'],['pork sausage','pork sausages'],['mince','beef mince'],['beef mince','beef mince']]);
const canonicalize=name=>aliases.get(String(name).trim().toLowerCase())||String(name).trim().toLowerCase();
const displayName=name=>canonicalize(name)==='pork sausages'?'Pork sausages':name;
const row=(name,quantity,unit='each',extra={})=>({name,qty:quantity,unit,selected:true,loc:'fridge',bb173StockKey:name.toLowerCase()+'|'+unit,bb173StockValue:quantity,...extra});

function fixture({stock={'sausages|each':3,'pork sausages|each':6},inventory,actor=ACTOR,guest=false}={}){
 const values=new Map(),calls=[],saved=[];let currentActor=guest?'guest':actor,schedules=0,ready=true;
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const write=(key,value)=>storage.setItem(key,JSON.stringify(value));
 const read=key=>JSON.parse(storage.getItem(key)||'{}');
 inventory??=Object.fromEntries(Object.entries(stock).map(([key,quantity])=>{const at=key.lastIndexOf('|'),name=key.slice(0,at),unit=key.slice(at+1);return ['fridge|'+name,row(name,quantity,unit)];}));
 write(keys.stock,stock);write(keys.inventory,inventory);write(keys.shop,{version:7,id:'shop-alias-test',shelfEdits:{}});
 if(!guest){write(keys.session,{user:{id:actor},access_token:'synthetic-secret-never-backup'});write(keys.actor,{actorId:actor});write(keys.owner,{actorId:actor,scope:{kind:'user',id:actor},inventoryRevision:4,serverStock:stock});}
 const options={storage,normalizeState:normalizePantryState,canonicalize,displayName,getActor:()=>currentActor,isReady:()=>ready,getMarket:()=> 'UK',now:()=>1794440000000,
  preparePurchasedPantry(value){calls.push(clone(value));return {queued:true,updates:{[queueKey]:{stock:clone(value.stock),baselineStock:clone(stock)}},expected:{[queueKey]:storage.getItem(queueKey),[keys.owner]:storage.getItem(keys.owner)}};},
  atomic(updates,expected){for(const [key,value]of Object.entries(expected))assert.equal(storage.getItem(key),value);for(const [key,value]of Object.entries(updates))write(key,value);saved.push(clone(updates));},
  scheduleSave(){schedules++;}
 };
 return {storage,values,write,read,calls,saved,options,controller:()=>migration.create(options),actor:value=>{currentActor=value;},ready:value=>{ready=value;},schedules:()=>schedules};
}

test('ordinary split sausage stock merges once with its exact original backup and queued absolute target',()=>{
 const h=fixture(),beforeStock=h.storage.getItem(keys.stock),beforeInventory=h.storage.getItem(keys.inventory),beforeOwner=h.storage.getItem(keys.owner),controller=h.controller();
 const result=controller.sync();assert.equal(result.status,'changed');assert.equal(result.queued,true);
 assert.deepEqual(h.read(keys.stock),{'pork sausages|each':9});
 const selected=Object.values(h.read(keys.inventory)).filter(row=>row.selected);assert.equal(selected.length,1);assert.equal(selected[0].qty,9);assert.equal(selected[0].name,'Pork sausages');
 assert.deepEqual(h.calls,[{stock:{'pork sausages|each':9},beforeStock:{'sausages|each':3,'pork sausages|each':6},shopSessionId:'shop-alias-test'}]);
 assert.equal(h.storage.getItem(keys.owner),beforeOwner,'the verified server baseline never changes before a server acknowledgement');
 const backup=h.read(result.backupKey);assert.equal(backup.stockRaw,beforeStock);assert.equal(backup.inventoryRaw,beforeInventory);assert.equal(backup.ownerRaw,beforeOwner);assert.equal(JSON.stringify(backup).includes('synthetic-secret'),false);
 assert.equal(controller.sync().status,'unchanged');assert.equal(h.saved.length,1);assert.equal(h.schedules(),1);
});

test('six-decimal measured balances are preserved through exact kg conversion and alias grouping',()=>{
 const h=fixture({stock:{'mince|kg':0.533333333,'beef mince|g':66.666667}}),result=h.controller().sync();
 assert.equal(result.status,'changed');assert.equal(h.read(keys.stock)['beef mince|g'],600);assert.equal(h.calls[0].beforeStock['mince|kg'],0.533333333);
});

test('distinct cuts, proteins and culinary varieties retain separate balances',()=>{
 const stock={'sausages|each':3,'pork sausages|each':6,'beef sausages|each':4,'vegetarian sausages|each':2,'chicken breast|g':533.333333,'chicken thighs|g':600,'turkey mince|g':200,'pork mince|g':250,'red onion|each':2,'spring onion|each':3,'sweet potato|g':400,'chorizo|g':100,'mozzarella|g':125};
 const h=fixture({stock});assert.equal(h.controller().sync().status,'changed');const next=h.read(keys.stock);
 for(const [key,quantity]of Object.entries(stock))if(key!=='sausages|each'&&key!=='pork sausages|each')assert.equal(next[key],quantity,key);
 assert.equal(next['pork sausages|each'],9);assert.equal(next['chicken breast|g'],533.333333);assert.equal(next['chicken thighs|g'],600);
});

test('different locations, dates and reduced batches keep their own inventory rows',()=>{
 const inventory={
  ordinary:row('Sausages',3),dated:row('Pork sausages',2,'each',{useBy:'2026-11-14'}),frozen:row('Pork sausages',4,'each',{loc:'freezer',frozenAt:'2026-11-10'}),
  reduced:row('Pork sausages',1,'each',{bbReduced:{version:1,actor:ACTOR,urgent:true,sources:['receipt-1'],at:1794440000000}})
 };
 const h=fixture({stock:{'sausages|each':3,'pork sausages|each':7},inventory});assert.equal(h.controller().sync().status,'changed');
 const next=h.read(keys.inventory),selected=Object.values(next).filter(row=>row.selected);
 assert.equal(selected.length,4);assert.equal(next.ordinary.qty,3);assert.equal(next.dated.qty,2);assert.equal(next.dated.useBy,'2026-11-14');assert.equal(next.frozen.loc,'freezer');assert.equal(next.frozen.qty,4);assert.deepEqual(next.reduced.bbReduced,inventory.reduced.bbReduced);assert.equal(h.read(keys.stock)['pork sausages|each'],10);
});

test('an active completed owned purchase defers consolidation so untick snapshots remain valid',()=>{
 const h=fixture(),id='pork sausages|each';h.write(keys.shop,{version:7,id:'shop-alias-test',shelfEdits:{[id]:{kind:'shop-owned-v1',amount:6,changes:{proof:'untouched'}}}});h.write(keys.purchases,{[id]:{qty:6}});
 const before=new Map(h.values);assert.equal(h.controller().sync().status,'deferred-active-shop');assert.deepEqual(h.values,before);assert.equal(h.calls.length,0);
});

test('an active partial owned purchase also defers migration until Finish shop',()=>{
 const h=fixture(),id='pork sausages|each';h.write(keys.shop,{version:7,id:'shop-alias-test',shelfEdits:{[id]:{kind:'shop-owned-v1',amount:2}}});h.write(keys.partials,{'shop-alias-test|pork sausages|each':{bought:2}});
 assert.equal(h.controller().sync().status,'deferred-active-shop');assert.equal(h.saved.length,0);
});

test('an inactive historical ownership marker does not block normalization',()=>{
 const h=fixture();h.write(keys.shop,{version:7,id:'shop-alias-test',shelfEdits:{'pork sausages|each':{kind:'shop-owned-v1',amount:6}}});assert.equal(h.controller().sync().status,'changed');
});

test('zero or absent physical stock cannot resurrect a selected historical inventory row',()=>{
 const h=fixture({stock:{},inventory:{historical:row('Chicken breast',533.333333,'g')}}),before=h.storage.getItem(keys.inventory);
 assert.equal(h.controller().sync().status,'unchanged');assert.deepEqual(h.read(keys.stock),{});assert.equal(h.storage.getItem(keys.inventory),before);
});

for(const target of ['stock','inventory','owner','actor','shop','purchases','partials','ticks'])test('malformed '+target+' storage is preserved without a permissive reset',()=>{
 const h=fixture();h.storage.setItem(keys[target],'{broken');const before=new Map(h.values),result=h.controller().sync();assert.equal(result.status,'error');assert.deepEqual(h.values,before);assert.equal(h.calls.length,0);
});

test('a sole unknown unit stays unchanged for review',()=>{
 const h=fixture({stock:{'sausages|unreviewed-container':3}}),before=new Map(h.values),result=h.controller().sync();
 assert.equal(result.status,'deferred-review');assert.ok(result.issues.length);assert.deepEqual(h.values,before);assert.equal(h.calls.length,0);
});

test('an unrelated unreviewed mozzarella pack stays byte-equivalent while proven sausage aliases merge',()=>{
 const mozzarella=row('Mozzarella',1,'pack',{notes:'One ball, size not entered'});
 const inventory={generic:row('Sausages',3),pork:row('Pork sausages',6),mozzarella};
 const h=fixture({stock:{'sausages|each':3,'pork sausages|each':6,'mozzarella|pack':1},inventory}),before=JSON.stringify(mozzarella);
 const result=h.controller().sync();assert.equal(result.status,'changed');assert.ok(result.preservedIssues.some(issue=>issue.stockKey==='mozzarella|pack'));
 assert.equal(h.read(keys.stock)['pork sausages|each'],9);assert.equal(h.read(keys.stock)['mozzarella|pack'],1);
 assert.equal(JSON.stringify(h.read(keys.inventory).mozzarella),before,'unknown contents and source metadata are never rewritten');
});

test('a food-name and physical stock identity conflict blocks the complete proposal',()=>{
 const h=fixture();const inventory=h.read(keys.inventory);inventory.conflicting=row('Chicken thighs',200,'g',{bb173StockKey:'chicken breast|g'});h.write(keys.inventory,inventory);h.write(keys.stock,{...h.read(keys.stock),'chicken breast|g':200});
 const before=new Map(h.values),result=h.controller().sync();assert.equal(result.status,'deferred-review');assert.ok(result.issues.some(issue=>issue.identityConflict));assert.deepEqual(h.values,before);assert.equal(h.calls.length,0);
});

test('wrong account and startup readiness prevent migration without writes',()=>{
 const h=fixture();h.actor(OTHER);assert.equal(h.controller().sync().status,'not-ready');assert.equal(h.saved.length,0);h.actor(ACTOR);h.ready(false);assert.equal(h.controller().sync().status,'not-ready');assert.equal(h.calls.length,0);
});

test('switching account while preparing the sync outbox rejects the captured proposal',()=>{
 const h=fixture(),prepare=h.options.preparePurchasedPantry;h.options.preparePurchasedPantry=value=>{const result=prepare(value);h.actor(OTHER);return result;};const before=new Map(h.values);
 assert.equal(h.controller().sync().status,'not-ready');assert.deepEqual(h.values,before);assert.equal(h.saved.length,0);
});

test('a concurrent stock write cannot be overwritten by an earlier normalization proposal',()=>{
 const h=fixture(),prepare=h.options.preparePurchasedPantry;h.options.preparePurchasedPantry=value=>{const result=prepare(value);h.write(keys.stock,{'pork sausages|each':12});return result;};
 const result=h.controller().sync();assert.equal(result.status,'error');assert.equal(result.code,'pantry_alias_context_changed');assert.deepEqual(h.read(keys.stock),{'pork sausages|each':12});assert.equal(h.saved.length,0);
});

test('outbox preparation failure preserves all originals and creates no backup',()=>{
 const h=fixture();h.options.preparePurchasedPantry=()=>{throw Error('sync-paused');};const before=new Map(h.values),result=h.controller().sync();assert.equal(result.status,'error');assert.equal(result.code,'sync-paused');assert.deepEqual(h.values,before);
});

test('guest consolidation stays local and a later changed alias snapshot gets a distinct backup',()=>{
 const h=fixture({guest:true});delete h.options.preparePurchasedPantry;const controller=h.controller(),first=controller.sync();assert.equal(first.status,'changed');assert.equal(first.queued,false);
 h.write(keys.stock,{'sausages|each':2,'pork sausages|each':9});h.write(keys.inventory,{first:row('Sausages',2),second:row('Pork sausages',9)});const second=controller.sync();assert.equal(second.status,'changed');assert.notEqual(first.backupKey,second.backupKey);assert.equal(h.read(keys.stock)['pork sausages|each'],11);
});

test('verified old purchase footprints rebase atomically and still undo exactly six sausages',()=>{
 const h=fixture(),id='pork sausages|each',after={
  [keys.stock]:h.read(keys.stock),[keys.inventory]:h.read(keys.inventory)
 },before={
  [keys.stock]:{'sausages|each':3},[keys.inventory]:{'fridge|sausages':row('sausages',3)}
 };
 const marker={kind:'shop-owned-v1',actor:ACTOR,receiptId:'shop-alias-test|'+id,amount:6,unit:'each',anchor:{key:'Pork sausages',unit:'each',toBuy:3},changes:ownership.capture(before,after)};
 h.write(keys.shop,{version:7,id:'shop-alias-test',shelfEdits:{[id]:marker}});h.write(keys.purchases,{[id]:{actualQty:6,unit:'each'}});h.options.ownership=ownership;
 const result=h.controller().sync();assert.equal(result.status,'changed');assert.deepEqual(h.read(keys.stock),{'pork sausages|each':9});
 const normalizedAfter={[keys.stock]:h.read(keys.stock),[keys.inventory]:h.read(keys.inventory)},rebased=h.read(keys.shop).shelfEdits[id];
 const restored={...normalizedAfter,...ownership.rewind(normalizedAfter,rebased.changes)};
 assert.deepEqual(restored[keys.stock],{'pork sausages|each':3});assert.equal(Object.values(restored[keys.inventory]).filter(row=>row.selected).reduce((sum,row)=>sum+row.qty,0),3);
 assert.equal(rebased.receiptId,marker.receiptId);assert.equal(h.saved.length,1);assert.ok(h.saved[0][keys.shop],'proof and stock share one atomic commit');
 const copies=h.saved.length;assert.equal(h.controller().sync().status,'unchanged');assert.equal(h.saved.length,copies);
});
test('a changed old physical footprint cannot be rebased or overwritten',()=>{
 const h=fixture(),id='pork sausages|each',physical={[keys.stock]:h.read(keys.stock),[keys.inventory]:h.read(keys.inventory)};
 const marker={kind:'shop-owned-v1',actor:ACTOR,amount:6,changes:ownership.capture({[keys.stock]:{'sausages|each':3},[keys.inventory]:{}},physical)};
 h.write(keys.shop,{version:7,id:'shop-alias-test',shelfEdits:{[id]:marker}});h.write(keys.purchases,{[id]:{actualQty:6}});h.options.ownership=ownership;h.write(keys.stock,{'sausages|each':3,'pork sausages|each':5});
 const saved=new Map(h.values);assert.equal(h.controller().sync().status,'deferred-active-shop');assert.deepEqual(h.values,saved);assert.equal(h.saved.length,0);
});
