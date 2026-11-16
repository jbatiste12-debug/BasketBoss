import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sync=require('../bb-pantry-pack-sync.js'),core=require('../bb-pantry-stock-levels.js');
const ACTOR='11111111-1111-4111-8111-111111111111',PARTNER='22222222-2222-4222-8222-222222222222',HOUSE='33333333-3333-4333-8333-333333333333',OTHER='44444444-4444-4444-8444-444444444444';
const SESSION='basketboss_cloud_session_v1',OWNER='basketboss_receipt_projection_owner_v1',STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
const clone=value=>JSON.parse(JSON.stringify(value));
const level=(patch={})=>({version:1,capacity:1000,unit:'g',spares:0,portion:'low',source:'label',estimated:true,capacityEstimated:false,confirmedQuantity:250,confirmedUnit:'g',...patch});
const row=(stockLevel=level(),patch={})=>({name:'Rice',loc:'cupboard',qty:250,unit:'g',selected:true,stockLevel,...patch});
const metadata=(stockLevel=level())=>({version:1,name:'rice',loc:'cupboard',stockLevel:stockLevel===null?null:{...stockLevel,scope:{kind:'household',id:HOUSE}},...(stockLevel===null?{}:{pack:{quantity:stockLevel.capacity,unit:stockLevel.unit,estimated:stockLevel.capacityEstimated,source:stockLevel.source}})});
function fixture({server,actor=ACTOR,scope=HOUSE}={}){
 const values=new Map([[SESSION,JSON.stringify({user:{id:actor},access_token:'fixture-token'})],[OWNER,JSON.stringify({actorId:actor,scope:{kind:'household',id:scope},inventoryRevision:1})],[STOCK,'{"rice|g":250}'],[INVENTORY,'{}']]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 let projection={actorId:actor,scope:{kind:'household',id:scope},inventoryRevision:1},status={status:'synced',queued:false},changes=0,clock=100000;
 const events=new Map(),timers=[],network=server||{entries:new Map(),calls:[],failAfterCommit:false,beforePost:null};
 const win={localStorage:storage,navigator:{onLine:true},document:{hidden:false,visibilityState:'visible',readyState:'complete',addEventListener(){}},BBPantryStockLevels:core,addEventListener:(type,fn)=>{const handlers=events.get(type)||[];handlers.push(fn);events.set(type,handlers);},setTimeout:fn=>(timers.push(fn),timers.length)};
 const fetch=async(address,init)=>{
  const body=init.body?JSON.parse(init.body):null;network.calls.push({address,body});
  if(!body)return Response.json({household_id:projection.scope.id,entries:[...network.entries].map(([entry_key,entry])=>({section:'kitchen_item',entry_key,...clone(entry)}))});
  if(network.beforePost){const fn=network.beforePost;network.beforePost=null;await fn(body);}
  if(body.expectedHouseholdId!==projection.scope.id)return Response.json({conflict:true,household_id:projection.scope.id},{status:409});
  const entry=network.entries.get(body.key);if((entry?.revision||0)!==body.expected)return Response.json({conflict:true,household_id:projection.scope.id},{status:409});
  network.entries.set(body.key,{revision:body.expected+1,value:clone(body.value)});
  if(network.failAfterCommit){network.failAfterCommit=false;throw Error('fixture connection interrupted');}
  return Response.json({ok:true,revision:body.expected+1,household_id:projection.scope.id});
 };
 const api=sync.install(win,{storage,fetch,getHost:()=>({getProjection:()=>projection,getAccountPantryStatus:()=>status}),onChange:()=>{changes++;},now:()=>clock});
 function commit(change){assert.ok(change);for(const [key,value]of Object.entries(change.expected))assert.equal(storage.getItem(key),value);for(const [key,value]of Object.entries(change.updates))storage.setItem(key,JSON.stringify(value));}
 return {api,win,values,storage,network,commit,get projection(){return projection;},set projection(value){projection=value;},get status(){return status;},set status(value){status=value;},get changes(){return changes;},advance:milliseconds=>{clock+=milliseconds;},emit:type=>events.get(type)?.forEach(fn=>fn()),async timers(){while(timers.length){timers.shift()();await Promise.resolve();}await api.retry();}};
}

test('metadata identities are bounded and exact even for long food names',()=>{
 const value={...metadata(),name:'a'.repeat(160)};assert.ok(sync.entryKey(value).length<180);assert.deepEqual(sync.validateValue(value,sync.entryKey(value)),value);
 assert.notEqual(sync.entryKey(value),sync.entryKey({...value,name:'a'.repeat(159)+'b'}));
 assert.throws(()=>sync.validateValue({...value,name:'Rice'},sync.entryKey(value)));
 assert.throws(()=>sync.validateValue({...value,qty:250}));
 for(const patch of [{spares:101},{confirmedQuantity:251},{estimated:false},{confirmedUnit:'ml'},{confirmedAt:'2026-11-16'},{capacityEstimated:true,estimated:false}])assert.throws(()=>sync.validateLevel(level(patch)));
});

test('prepare returns only durable metadata updates with the existing transaction pins',()=>{
 const f=fixture(),before=new Map(f.values),change=f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row()}});
 assert.deepEqual(f.values,before,'preparation writes nothing');assert.equal(Object.keys(change.updates).length,1);
 assert.ok(Object.keys(change.updates)[0].startsWith(sync.LOCAL));assert.equal(change.expected[SESSION],f.storage.getItem(SESSION));assert.equal(change.expected[OWNER],f.storage.getItem(OWNER));
 const document=Object.values(change.updates)[0],pending=Object.values(document.outbox)[0];assert.deepEqual(pending.value,metadata());assert.equal(Object.hasOwn(pending.value,'qty'),false);
 f.commit(change);assert.equal(f.api.state().queued,true);assert.deepEqual(f.api.scope(),{kind:'household',id:HOUSE});
 assert.equal(f.api.prepare({beforeInventory:{rice:row()},afterInventory:{rice:row()}}),null);
 assert.equal(f.storage.getItem(STOCK),before.get(STOCK));assert.equal(f.storage.getItem(INVENTORY),before.get(INVENTORY));
});

test('offline local intent survives restart and reaches the linked partner without any stock write',async()=>{
 const f=fixture(),stock=f.storage.getItem(STOCK);f.win.navigator.onLine=false;
 f.commit(f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row()}}));assert.equal((await f.api.retry()).queued,true);assert.equal(f.network.calls.length,0);
 const restarted=sync.install(f.win,{storage:f.storage,fetch:async(address,init)=>{const body=init.body?JSON.parse(init.body):null;if(body){f.network.entries.set(body.key,{revision:1,value:body.value});return Response.json({ok:true,revision:1,household_id:HOUSE});}return Response.json({household_id:HOUSE,entries:[]});},getHost:()=>({getProjection:()=>f.projection,getAccountPantryStatus:()=>f.status}),now:()=>100000,onChange(){}});
 f.win.navigator.onLine=true;assert.equal((await restarted.retry()).queued,false);assert.equal(f.storage.getItem(STOCK),stock);
 const partner=fixture({server:f.network,actor:PARTNER});assert.equal(partner.api.read(row(null)),null);assert.equal((await partner.api.retry()).ok,true);
 const shared=partner.api.read(row(null));assert.equal(shared.packQuantity,1000);assert.equal(shared.stockLevel.estimated,true);assert.equal(shared.matched,true);
 assert.equal(partner.storage.getItem(STOCK),stock);assert.equal(partner.storage.getItem(INVENTORY),'{}');
});

test('cooked quantities keep their exact balance and the original estimate remains marked for checking',async()=>{
 const f=fixture();f.network.entries.set(sync.entryKey(metadata()),{revision:1,value:metadata()});await f.api.retry();
 const shared=f.api.read(row(null,{qty:125}));assert.equal(shared.packQuantity,1000);assert.equal(shared.stockLevel.confirmedQuantity,250);assert.equal(shared.stockLevel.estimated,true);assert.equal(shared.matched,false);assert.equal(shared.needsCheck,true);assert.equal(Object.hasOwn(shared,'qty'),false);
});

test('two conflicting household edits remain queued without overwriting the remote pack size',async()=>{
 const f=fixture();f.commit(f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row()}}));
 const remote=metadata(level({capacity:2000,confirmedQuantity:500}));f.network.entries.set(sync.entryKey(remote),{revision:1,value:remote});
 const result=await f.api.retry();assert.equal(result.needsReview,true);assert.equal(f.network.calls.filter(call=>call.body).length,0);
 assert.deepEqual(f.network.entries.get(sync.entryKey(remote)).value,remote);assert.equal(f.api.read(row()).conflict,true);assert.equal(f.api.read(row()).matched,false);
});

test('an interrupted committed patch is acknowledged on retry and is never credited a second time',async()=>{
 const f=fixture();f.commit(f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row()}}));f.network.failAfterCommit=true;
 assert.equal((await f.api.retry()).queued,true);assert.equal(f.network.entries.size,1);assert.equal((await f.api.retry()).queued,false);
 assert.equal(f.network.calls.filter(call=>call.body).length,1);assert.equal(f.storage.getItem(STOCK),'{"rice|g":250}');
});

test('a newer local selection made while a patch is pending rebases only after its exact earlier acknowledgement',async()=>{
 const f=fixture(),next=level({portion:'half',confirmedQuantity:500});f.commit(f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row()}}));
 f.network.beforePost=()=>{f.commit(f.api.prepare({beforeInventory:{rice:row()},afterInventory:{rice:row(next)}}));};
 assert.equal((await f.api.retry()).queued,true);assert.equal((await f.api.retry()).queued,false);
 assert.equal(f.network.entries.get(sync.entryKey(metadata())).revision,2);assert.equal(f.network.entries.get(sync.entryKey(metadata())).value.stockLevel.confirmedQuantity,500);
});

test('explicit clears synchronize as metadata tombstones',async()=>{
 const f=fixture();f.network.entries.set(sync.entryKey(metadata()),{revision:1,value:metadata()});await f.api.retry();
 f.commit(f.api.prepare({beforeInventory:{rice:row()},afterInventory:{rice:row(null)}}));assert.equal((await f.api.retry()).queued,false);
 assert.equal(f.network.entries.get(sync.entryKey(metadata())).value.stockLevel,null);assert.equal(f.api.read(row()).stockLevel,null);assert.equal(f.api.read(row()).packReviewed,false);assert.equal(f.api.read(row()).packQuantity,null);
});

test('a reviewed capacity edit after Running low clears the old level and shares the new independent size',async()=>{
 const f=fixture(),before=row(level(),{packQuantity:1000,packUnit:'g',packReviewed:true,packEstimated:false});f.network.entries.set(sync.entryKey(metadata()),{revision:1,value:metadata()});await f.api.retry();
 const after=row(null,{packQuantity:500,packUnit:'g',packReviewed:true,packEstimated:false});const originalStock=f.storage.getItem(STOCK),originalInventory=f.storage.getItem(INVENTORY);
 f.commit(f.api.prepare({beforeInventory:{rice:before},afterInventory:{rice:after}}));assert.equal((await f.api.retry()).queued,false);
 const saved=f.network.entries.get(sync.entryKey(metadata())).value;assert.equal(saved.stockLevel,null);assert.deepEqual(saved.pack,{quantity:500,unit:'g',estimated:false,source:'label'});
 const partner=fixture({actor:PARTNER,server:f.network});await partner.api.retry();const remembered=partner.api.read(row());assert.equal(remembered.stockLevel,null);assert.equal(remembered.packQuantity,500);assert.equal(remembered.packReviewed,true);assert.equal(remembered.packEstimated,false);
 assert.equal(f.storage.getItem(STOCK),originalStock);assert.equal(f.storage.getItem(INVENTORY),originalInventory);
});

test('an exact amount edit remembers its reviewed capacity without transporting the exact balance',async()=>{
 const f=fixture(),pack={packQuantity:1000,packUnit:'g',packReviewed:true,packEstimated:true},before=row(level({capacityEstimated:true}),pack),after=row(null,{...pack,qty:600});
 f.commit(f.api.prepare({beforeInventory:{rice:before},afterInventory:{rice:after}}));await f.api.retry();const remembered=f.api.read(after);
 assert.equal(remembered.stockLevel,null);assert.equal(remembered.packQuantity,1000);assert.equal(remembered.packEstimated,true);assert.equal(remembered.needsCheck,false);assert.equal(Object.hasOwn(remembered,'qty'),false);
 assert.equal(f.storage.getItem(STOCK),'{"rice|g":250}');
});

test('only explicitly changed reviewed pack fields can create capacity-only metadata',async()=>{
 const f=fixture(),plain=row(null),unreviewed=row(null,{packQuantity:500,packUnit:'g',packEstimated:true,packReviewed:false});
 assert.equal(f.api.prepare({beforeInventory:{rice:plain},afterInventory:{rice:unreviewed}}),null,'unreviewed defaults remain local');
 const reviewed={...unreviewed,packReviewed:true};f.commit(f.api.prepare({beforeInventory:{rice:unreviewed},afterInventory:{rice:reviewed}}));await f.api.retry();assert.equal(f.api.read(plain).packQuantity,500);
 assert.equal(f.api.prepare({beforeInventory:{rice:reviewed},afterInventory:{rice:clone(reviewed)}}),null,'unchanged reviewed metadata is not seeded');
 const canonical=row(null,{packQuantity:1,packUnit:'kg',packEstimated:false,packReviewed:true});f.commit(f.api.prepare({beforeInventory:{rice:reviewed},afterInventory:{rice:canonical}}));await f.api.retry();assert.equal(f.api.read(plain).packQuantity,1000);assert.equal(f.api.read(plain).packUnit,'g');
});

test('inconsistent level and capacity metadata and mixed physical pack rows fail before any writes',()=>{
 const f=fixture(),inconsistent=row(level(),{packQuantity:500,packUnit:'g',packReviewed:true});const original=new Map(f.values);
 assert.throws(()=>f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:inconsistent}}));
 assert.throws(()=>sync.validateValue({...metadata(),pack:{quantity:500,unit:'g',estimated:false,source:'label'}}));
 const first=row(null,{packQuantity:1000,packUnit:'g',packReviewed:true}),second=row(null,{packQuantity:500,packUnit:'g',packReviewed:true});
 assert.throws(()=>f.api.prepare({beforeInventory:{first,second},afterInventory:{first:{...first,packQuantity:750},second}}));assert.deepEqual(f.values,original);
});

test('household transitions never seed unchanged metadata or send a previous household queue',async()=>{
 const f=fixture();f.commit(f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row()}}));
 f.projection={...f.projection,scope:{kind:'household',id:OTHER}};f.storage.setItem(OWNER,JSON.stringify({scope:f.projection.scope}));
 assert.equal(f.api.read(row()),null);assert.equal(f.api.prepare({beforeInventory:{rice:row()},afterInventory:{rice:row()}}),null);await f.api.retry();assert.equal(f.network.calls.filter(call=>call.body).length,0);
 assert.throws(()=>f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row({...level(),scope:{kind:'household',id:HOUSE}})}}));
});

test('account, deletion and outstanding stock changes pause this independent metadata channel',async()=>{
 const f=fixture();f.commit(f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row()}}));f.status={status:'pending',queued:true};await f.api.retry();assert.equal(f.network.calls.length,0);
 f.status={status:'conflict',queued:false};await f.api.retry();assert.equal(f.network.calls.length,0);
 f.status={status:'synced',queued:false};f.storage.setItem(SESSION,JSON.stringify({user:{id:PARTNER},access_token:'other-fixture-token'}));assert.equal(f.api.scope(),null);await f.api.retry();assert.equal(f.network.calls.length,0);
 f.storage.setItem(SESSION,JSON.stringify({user:{id:ACTOR},access_token:'fixture-token'}));f.api.start();f.emit('basketboss:account-deletion-started');assert.equal(f.api.scope(),null);await f.api.retry();assert.equal(f.network.calls.length,0);
});

test('changing account during a server commit leaves the original actor queue recoverable and the new actor untouched',async()=>{
 const f=fixture();f.commit(f.api.prepare({beforeInventory:{rice:row(null)},afterInventory:{rice:row()}}));const cacheKey=[...f.values.keys()].find(key=>key.startsWith(sync.LOCAL));
 f.network.beforePost=()=>{f.storage.setItem(SESSION,JSON.stringify({user:{id:PARTNER},access_token:'partner-fixture-token'}));f.projection={...f.projection,actorId:PARTNER};f.storage.setItem(OWNER,JSON.stringify({actorId:PARTNER,scope:f.projection.scope}));};
 assert.equal((await f.api.retry()).ok,false);assert.equal(f.network.entries.size,1);assert.equal(f.api.read(row()),null);assert.equal(Object.keys(JSON.parse(f.storage.getItem(cacheKey)).outbox).length,1);assert.equal(f.storage.getItem(STOCK),'{"rice|g":250}');
});

test('a scope-mismatched response invalidates cached metadata until the verified receipt context changes',async()=>{
 const f=fixture();f.network.entries.set(sync.entryKey(metadata()),{revision:1,value:metadata()});await f.api.retry();assert.ok(f.api.read(row()));
 const other=sync.install(f.win,{storage:f.storage,fetch:async()=>Response.json({household_id:OTHER,entries:[]}),getHost:()=>({getProjection:()=>f.projection,getAccountPantryStatus:()=>f.status}),now:()=>100000});
 assert.equal((await other.retry()).ok,false);assert.equal(other.scope(),null);assert.equal(other.read(row()),null);
});

test('incoming metadata refreshes presentation without remounting the app or dropping an open draft',async()=>{
 const f=fixture();let inlineRefreshes=0;const events=[];f.win.BBPantryInline={refresh(){inlineRefreshes++;}};f.win.BBHomeHost={refresh(){assert.fail('metadata must not remount the stock editor');}};f.win.CustomEvent=class{constructor(type){this.type=type;}};f.win.dispatchEvent=event=>events.push(event.type);
 const metadataValue=metadata(),api=sync.install(f.win,{storage:f.storage,fetch:async()=>Response.json({household_id:HOUSE,entries:[{section:'kitchen_item',entry_key:sync.entryKey(metadataValue),value:metadataValue,revision:1}]}),getHost:()=>({getProjection:()=>f.projection,getAccountPantryStatus:()=>f.status}),now:()=>100000});
 assert.equal((await api.retry()).ok,true);assert.equal(inlineRefreshes,1);assert.deepEqual(events,['bb:pantry-pack-metadata']);assert.equal(f.storage.getItem(STOCK),'{"rice|g":250}');
});

test('reading an already cached pack refreshes changed partner metadata after the thirty-second throttle',async()=>{
 const f=fixture();f.network.entries.set(sync.entryKey(metadata()),{revision:1,value:metadata()});f.api.start();await f.timers();const count=f.network.calls.length;
 f.api.read(row());f.emit('focus');await Promise.resolve();assert.equal(f.network.calls.length,count);
 f.advance(30001);const updated=metadata(level({capacity:2000,confirmedQuantity:500}));f.network.entries.set(sync.entryKey(updated),{revision:2,value:updated});f.api.read(row());await f.timers();
 assert.equal(f.api.read(row()).packQuantity,2000);assert.ok(f.changes>=2);
});
