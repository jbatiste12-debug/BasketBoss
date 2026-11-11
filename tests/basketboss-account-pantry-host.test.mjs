import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-receipt-host.js',import.meta.url),'utf8');
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const keys={stock:'basketboss_321_v7_measured_pantry',kitchen:'basketboss_makeameal_v1_inventory',owner:'basketboss_receipt_projection_owner_v1',actor:'basketboss_receipt_host_actor_v1',confirmed:'basketboss_ui_next_confirmed_pantry_v1'};
const queueKey='basketboss_purchase_pantry_sync_v1:'+ACTOR,clone=value=>JSON.parse(JSON.stringify(value));
function fixture({local={'rice|g':533.333333},remote=local,enabled=true,scope={kind:'user',id:ACTOR},initialized=true,owned=true,online=true}={}){
 const values=new Map(),calls=[],events={},changes=[],projections=[];let pending={},available=online,opened=0;
 let session={user:{id:ACTOR},access_token:'local-test-token'},cached=owned?{scope:clone(scope),initialized,inventoryRevision:3,serverStock:clone(remote),pantryReview:{required:true}}:null;
 const server={stock:clone(remote),scope:clone(scope),inventoryRevision:3,initialized};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const write=(key,value)=>storage.setItem(key,JSON.stringify(value)),read=key=>JSON.parse(storage.getItem(key)||'{}');
 write(keys.stock,local);write(keys.kitchen,{});write(keys.confirmed,{});write(keys.actor,{actorId:ACTOR});
 if(owned)write(keys.owner,{version:1,actorId:ACTOR,scope:clone(scope),inventoryRevision:3,initialized,serverStock:clone(remote)});
 const inventory={configure(options){this.options=options;},getCachedProjection:()=>cached,getPendingConfirmation:()=>pending,recoverLocalTransaction(){},
  async synchronize(){calls.push({type:'synchronize'});return {ok:true,localApplied:true,projection:clone(server)};},
  async confirmPantry(value){if(value.precondition&&value.precondition(value)!==true)throw Error('receipt_local_data_changed');calls.push({type:'post',...clone(value)});if(value.expectedRevision!==server.inventoryRevision){const error=Error('revision_conflict');error.status=409;throw error;}
   server.stock=clone(value.stock);server.inventoryRevision++;server.initialized=true;
   if(value.precondition&&value.precondition(value)!==true)throw Error('receipt_local_data_changed');
   const prepared=this.options.prepareReceiptSave?.({source:'cloud',stockAfter:clone(value.stock)})||{};
   if(value.precondition){write(keys.stock,value.stock);write(keys.kitchen,{});}
   cached={scope:clone(server.scope),initialized:true,inventoryRevision:server.inventoryRevision,serverStock:clone(server.stock),pantryReview:{required:false}};
   write(keys.owner,{version:1,actorId:ACTOR,scope:clone(server.scope),inventoryRevision:server.inventoryRevision,initialized:true,serverStock:clone(server.stock)});
   for(const [key,item]of Object.entries(prepared.changes||{}))item===null?storage.removeItem(key):write(key,item);
   return {ok:true,committed:true,localApplied:true,projection:clone(server)};
  }};
 const root={localStorage:storage,Intl,Date,console,queueMicrotask,setTimeout,clearTimeout,AbortController,addEventListener:(name,fn)=>{events[name]=fn;}};
 vm.runInNewContext(source,root);
 const options={storage,inventory,accountPantrySync:enabled,getSession:()=>session,getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'week-one'}),getStock:()=>read(keys.stock),getEssentials:()=>[],onProjection:value=>projections.push(value),onAccountPantryChange:value=>changes.push(value),openAccountPantry:()=>{opened++;return 'account';},
  fetch:async address=>{calls.push({type:address.includes('mode=status')?'status':'fetch'});return {ok:true,json:async()=>address.includes('mode=status')?{ok:true,available,premium:true}:{ok:true,...clone(server)}};}};
 const host=root.BBReceiptHostFactory(options);host.configure();
 const enqueue=(target)=>{const prepared=host.preparePurchasedPantry({stock:target,beforeStock:read(keys.stock)});for(const [key,value]of Object.entries(prepared.updates))write(key,value);write(keys.stock,target);return prepared;};
 return {host,root,storage,read,write,calls,changes,projections,server,inventory,enqueue,opened:()=>opened,backupKeys:()=>[...values.keys()].filter(key=>key.startsWith('basketboss_pantry_scope_backup_v1:')),setOnline:value=>{available=value;},setPending:value=>{pending=value;},setSession:value=>{session=value;},setCached:value=>{cached=value;}};
}

test('opt-in keeps one trusted physical pantry usable despite routine review and remote conflict',async()=>{
 const h=fixture();await h.host.refreshAvailability({synchronize:false});
 assert.equal(h.host.accountPantrySyncEnabled(),true);assert.equal(h.host.requiresPantryReview(),true);assert.equal(h.host.canConsumePantry(),true);
 h.enqueue({'rice|g':400.333333});const queued=h.read(queueKey);h.write(queueKey,{...queued,remoteConflict:true,needsReview:true});
 assert.equal(h.host.getConsumptionStatus().ready,true);assert.equal(h.host.allowPurchaseTransfer(),true);assert.equal(h.host.allowLegacyTransfer(),true);
 assert.equal(h.host.getAccountPantryStatus().status,'conflict');assert.equal(h.host.getAccountPantryStatus().requiresReview,true);
 const before=clone(h.read(keys.stock)),posts=h.calls.filter(row=>row.type==='post').length;
 const result=await h.host.syncAccountPantry();assert.equal(result.needsReview,true);assert.equal(h.calls.filter(row=>row.type==='post').length,posts);assert.deepEqual(h.read(keys.stock),before);
});

test('legacy mode and ordinary review remain available unless the Account option is enabled',async()=>{
 const legacy=fixture({enabled:false});await legacy.host.refreshAvailability({synchronize:false});
 assert.equal(legacy.host.accountPantrySyncEnabled(),false);assert.equal(legacy.host.requiresPantryReview(),true);assert.equal(legacy.host.getAccountPantryStatus().enabled,false);
 const h=fixture();assert.equal(await h.host.reviewPantry(),'account');assert.equal(h.opened(),1);assert.equal(h.calls.length,0);
});

for(const reason of ['receipt','journal','wrong-actor','invalid-scope','corrupt-stock','corrupt-kitchen','account-deletion'])test('one-pantry mode retains the '+reason+' mutation barrier',()=>{
 const h=fixture();
 if(reason==='receipt')h.setPending({receiptId:'unresolved'});
 if(reason==='journal')h.storage.setItem('basketboss_receipt_inventory_journal_v1:'+ACTOR,'{}');
 if(reason==='wrong-actor')h.write(keys.owner,{...h.read(keys.owner),actorId:OTHER});
 if(reason==='invalid-scope')h.write(keys.owner,{...h.read(keys.owner),scope:{kind:'user',id:OTHER}});
 if(reason==='corrupt-stock')h.storage.setItem(keys.stock,'{broken');
 if(reason==='corrupt-kitchen')h.storage.setItem(keys.kitchen,'{broken');
 if(reason==='account-deletion')h.root.BBAccountDeletion={isDeleting:()=>true};
 assert.equal(h.host.canConsumePantry(),false);assert.equal(h.host.allowPurchaseTransfer(),false);assert.equal(h.host.allowLegacyTransfer(),false);assert.equal(h.host.getAccountPantryStatus().status,'blocked');
});

test('offline absolute deletion remains queued and local stock never reverts to the saved balance',async()=>{
 const h=fixture({online:false});h.enqueue({});const before=clone(h.read(queueKey));
 const result=await h.host.syncAccountPantry();assert.equal(result.localOnly,true);assert.equal(result.queued,true);
 assert.deepEqual(h.read(keys.stock),{});assert.deepEqual(h.read(queueKey),before);assert.equal(h.host.canConsumePantry(),true);
 h.setOnline(true);const retried=await h.host.syncAccountPantry();assert.equal(retried.ok,true);assert.equal(retried.queued,false);assert.deepEqual(h.server.stock,{});assert.deepEqual(h.read(keys.stock),{});
});

test('explicit Account conflict action posts current exact local amounts against the fetched revision',async()=>{
 const h=fixture();h.enqueue({'rice|g':400.333333});h.write(queueKey,{...h.read(queueKey),needsReview:true,remoteConflict:true});
 h.server.stock={'rice|g':900};h.server.inventoryRevision=8;
 const result=await h.host.syncAccountPantry({resolveConflict:true});assert.equal(result.ok,true);assert.equal(result.queued,false);
 const posted=h.calls.find(row=>row.type==='post');assert.deepEqual(posted.stock,{'rice|g':400.333333});assert.equal(posted.expectedRevision,8);
 assert.deepEqual(h.server.stock,{'rice|g':400.333333});assert.deepEqual(h.read(keys.stock),{'rice|g':400.333333});assert.equal(h.calls.some(row=>row.type==='synchronize'),false);
});

test('an explicit Account action never moves an existing personal pantry into another household scope',async()=>{
 const h=fixture();h.enqueue({});h.server.scope={kind:'household',id:'a-different-household'};
 const result=await h.host.syncAccountPantry({resolveConflict:true});assert.equal(result.ok,false);assert.equal(result.code,'receipt_household_scope_changed');
 assert.equal(h.calls.some(row=>row.type==='post'),false);assert.deepEqual(h.read(keys.stock),{});assert.equal(h.read(queueKey).scope.kind,'user');
});

test('subsequent edits coalesce while conflicted without clearing the server-overwrite barrier',()=>{
 const h=fixture();h.enqueue({'rice|g':400});h.write(queueKey,{...h.read(queueKey),needsReview:true,remoteConflict:true});h.enqueue({'rice|g':300.666667});
 assert.deepEqual(h.read(queueKey).stock,{'rice|g':300.666667});assert.equal(h.read(queueKey).remoteConflict,true);assert.equal(h.read(queueKey).needsReview,true);assert.deepEqual(h.read(queueKey).baselineStock,{'rice|g':533.333333});
});

test('foreground refresh drains pending local intent before a clean verified GET',async()=>{
 const h=fixture();h.enqueue({});const result=await h.host.refreshAccountPantry();assert.equal(result.ok,true);assert.equal(result.unchanged,true);
 assert.ok(h.calls.findIndex(row=>row.type==='post')<h.calls.findIndex(row=>row.type==='fetch'));assert.equal(h.calls.some(row=>row.type==='synchronize'),false);assert.deepEqual(h.server.stock,{});
});

test('foreground refresh cannot apply saved stock while a divergent target is conflicted',async()=>{
 const h=fixture();h.enqueue({});h.write(queueKey,{...h.read(queueKey),remoteConflict:true,needsReview:true});
 const result=await h.host.refreshAccountPantry();assert.equal(result.refreshed,false);assert.equal(result.needsReview,true);assert.equal(h.calls.some(row=>row.type==='synchronize'),false);assert.deepEqual(h.read(keys.stock),{});
});

test('rapid Account sync taps share one promise and one physical pantry CAS',async()=>{
 const h=fixture();h.enqueue({'rice|g':200.333333});
 const first=h.host.syncAccountPantry(),second=h.host.syncAccountPantry();assert.equal(first,second);await first;
 assert.equal(h.calls.filter(row=>row.type==='post').length,1);assert.ok(h.changes.length>=1);
});

test('the first explicitly authorized Account sync initializes a verified scope without importing saved amounts',async()=>{
 const h=fixture({owned:false,local:{'rice|g':8.666667},remote:{'rice|g':900}});
 const result=await h.host.syncAccountPantry({resolveConflict:true});assert.equal(result.ok,true);assert.equal(result.queued,false);
 assert.deepEqual(h.server.stock,{'rice|g':8.666667});assert.deepEqual(h.read(keys.stock),{'rice|g':8.666667});assert.equal(h.host.getAccountPantryStatus().status,'synced');
});

test('a cold signed-in account with an empty local pantry can hydrate instead of being stuck in initialization conflict',async()=>{
 const h=fixture({owned:false,local:{},remote:{'rice|g':900}});await h.host.refreshAvailability({synchronize:false});
 assert.equal(h.host.getAccountPantryStatus().status,'pending');assert.equal(h.host.getAccountPantryStatus().requiresReview,false);
 const result=await h.host.refreshAccountPantry();assert.equal(result.refreshed,true);assert.equal(h.calls.filter(row=>row.type==='synchronize').length,1);
});

test('a stalled Account status request expires and its late result cannot make sync available',async()=>{
 const h=fixture();let release;
 h.host.configure({accountPantryTimeoutMs:1,fetch:()=>new Promise(resolve=>{release=resolve;})});
 await h.host.refreshAvailability({force:true,synchronize:false});assert.equal(h.host.getAvailability().available,false);assert.equal(h.host.getAccountPantryStatus().status,'unavailable');
 release({ok:true,json:async()=>({ok:true,available:true,premium:true})});await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(h.host.getAvailability().available,false);assert.equal(h.host.canConsumePantry(),true);
});

test('a stalled conflict metadata fetch releases the Account sync lock and never posts a late stock choice',async()=>{
 const h=fixture();let release;
 h.host.configure({accountPantryTimeoutMs:1,fetch:async address=>address.includes('mode=status')?{ok:true,json:async()=>({ok:true,available:true,premium:true})}:new Promise(resolve=>{release=resolve;})});
 const result=await h.host.syncAccountPantry({resolveConflict:true});assert.equal(result.ok,false);assert.equal(result.code,'account_pantry_timeout');
 release({ok:true,json:async()=>({ok:true,...clone(h.server)})});await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(h.calls.filter(row=>row.type==='post').length,0);assert.deepEqual(h.read(keys.stock),{'rice|g':533.333333});assert.equal(h.host.getAccountPantryStatus().canSync,true);
});

test('no-op account projection polls suppress app renders while real quantity/revision changes still notify',()=>{
 const h=fixture();h.inventory.options.onProjection({poll:true});h.inventory.options.onProjection({poll:true});assert.equal(h.projections.length,0);
 h.setCached({...h.server,serverStock:clone(h.server.stock),pantryReview:{required:true},syncedAt:123});
 h.inventory.options.onProjection({poll:true});const initial=h.projections.length;
 h.setCached({...h.server,serverStock:clone(h.server.stock),pantryReview:{required:true},syncedAt:456});h.inventory.options.onProjection({poll:true});assert.equal(h.projections.length,initial);
 h.write(keys.stock,{'rice|g':200.333333});h.inventory.options.onProjection({local:true});assert.equal(h.projections.length,initial+1);
 h.setCached({...h.server,inventoryRevision:4,serverStock:{'rice|g':150.666667},pantryReview:{required:true}});h.inventory.options.onProjection({partner:true});assert.equal(h.projections.length,initial+2);
});

test('explicit personal-to-household adoption posts only shared stock and keeps the old pantry and intent as a backup',async()=>{
 const h=fixture();h.enqueue({'rice|g':400.333333});h.server.scope={kind:'household',id:'shared-pantry'};h.server.stock={'egg|each':8.666667};h.server.inventoryRevision=8;
 const rejected=await h.host.syncAccountPantry({resolveConflict:true});assert.equal(rejected.code,'receipt_household_scope_changed');assert.equal(h.host.getAccountPantryStatus().adoptScope,true);
 const result=await h.host.syncAccountPantry({adoptScope:true});assert.equal(result.ok,true);assert.equal(result.adoptedScope.kind,'household');
 const posted=h.calls.find(row=>row.type==='post');assert.deepEqual(posted.stock,{'egg|each':8.666667});assert.deepEqual(h.read(keys.stock),{'egg|each':8.666667});assert.equal(h.storage.getItem(queueKey),null);
 const backup=h.read(result.backupKey);assert.deepEqual(backup.pantry.values[keys.stock],{'rice|g':400.333333});assert.deepEqual(backup.outbox.stock,{'rice|g':400.333333});assert.equal(backup.scope.kind,'user');assert.equal(JSON.stringify(backup).includes('local-test-token'),false);
});

test('explicit household-to-personal adoption selects the authenticated personal pantry without exporting shared food',async()=>{
 const h=fixture({scope:{kind:'household',id:'old-household'},local:{'shared rice|g':300}});h.server.scope={kind:'user',id:ACTOR};h.server.stock={'egg|each':2};h.server.inventoryRevision=9;
 const result=await h.host.adoptAccountPantryScope();assert.equal(result.ok,true);assert.deepEqual(h.calls.find(row=>row.type==='post').stock,{'egg|each':2});assert.deepEqual(h.read(keys.stock),{'egg|each':2});assert.equal(h.read(result.backupKey).scope.kind,'household');
});

test('a local write while scope metadata is fetched aborts adoption and retains the concurrent stock',async()=>{
 const h=fixture();h.server.scope={kind:'household',id:'new-household'};
 h.host.configure({fetch:async address=>{if(!address.includes('mode=status'))h.write(keys.stock,{'rice|g':12.333333});return {ok:true,json:async()=>({ok:true,...clone(h.server)})};}});
 const result=await h.host.adoptAccountPantryScope();assert.equal(result.ok,false);assert.equal(h.calls.some(row=>row.type==='post'),false);assert.deepEqual(h.read(keys.stock),{'rice|g':12.333333});assert.equal(h.read(result.backupKey).pantry.values[keys.stock]['rice|g'],533.333333);
});

test('a shared revision change between fetch and CAS cannot overwrite the new shared stock',async()=>{
 const h=fixture();h.server.scope={kind:'household',id:'new-household'};h.server.stock={'egg|each':2};const post=h.inventory.confirmPantry;
 h.inventory.confirmPantry=async function(value){h.server.inventoryRevision++;h.server.stock={'egg|each':5};return post.call(this,value);};
 const result=await h.host.adoptAccountPantryScope();assert.equal(result.ok,false);assert.equal(result.conflict,true);assert.deepEqual(h.server.stock,{'egg|each':5});assert.deepEqual(h.read(keys.stock),{'rice|g':533.333333});assert.equal(h.read(keys.owner).scope.kind,'user');assert.ok(result.backupKey);
});

test('a changed actor during adoption cannot post or project the previous account pantry',async()=>{
 const h=fixture();h.server.scope={kind:'household',id:'new-household'};
 h.host.configure({fetch:async()=>{h.setSession({user:{id:OTHER},access_token:'different-token'});return {ok:true,json:async()=>({ok:true,...clone(h.server)})};}});
 const result=await h.host.adoptAccountPantryScope();assert.equal(result.ok,false);assert.equal(h.calls.some(row=>row.type==='post'),false);assert.deepEqual(h.read(keys.stock),{'rice|g':533.333333});assert.ok(result.backupKey);
});

test('scope adoption blocks ordinary local mutations and refuses an unreadable actual receipt journal',async()=>{
 const h=fixture();h.server.scope={kind:'household',id:'new-household'};let release,started;
 const requested=new Promise(resolve=>{started=resolve;});
 h.host.configure({fetch:()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({ok:true,...clone(h.server)})});started();})});
 const pending=h.host.adoptAccountPantryScope();assert.equal(h.host.allowPurchaseTransfer(),false);assert.equal(h.host.canConsumePantry(),false);
 await requested;release();await pending;
 const paused=fixture();paused.storage.setItem('basketboss_receipt_inventory_journal_v1:'+ACTOR,'{}');const result=await paused.host.adoptAccountPantryScope();assert.equal(result.ok,false);assert.equal(paused.calls.some(row=>row.type==='post'),false);
});

test('unchanged verified polling performs no projection or local writes and preserves physical purchase markers',async()=>{
 const h=fixture();h.write(keys.kitchen,{wraps:{name:'Wraps',qty:8,loc:'cupboard',bb173StockKey:'wrap|each',bb173StockValue:8,ownershipMarker:'exact-original-marker'}});
 const raw=Object.fromEntries(Object.values(keys).map(key=>[key,h.storage.getItem(key)]));
 const result=await h.host.refreshAccountPantry();assert.equal(result.ok,true);assert.equal(result.unchanged,true);assert.equal(result.refreshed,false);
 assert.equal(h.calls.filter(row=>row.type==='fetch').length,1);assert.equal(h.calls.some(row=>row.type==='synchronize'),false);assert.equal(h.projections.length,0);
 assert.deepEqual(Object.fromEntries(Object.values(keys).map(key=>[key,h.storage.getItem(key)])),raw);assert.equal(h.read(keys.kitchen).wraps.ownershipMarker,'exact-original-marker');
});

test('a genuinely newer shared revision still reaches the existing verified projection adapter',async()=>{
 const h=fixture({scope:{kind:'household',id:'shared-pantry'}});h.server.inventoryRevision=4;h.server.stock={'rice|g':200.333333};
 const result=await h.host.refreshAccountPantry();assert.equal(result.refreshed,true);assert.equal(h.calls.filter(row=>row.type==='synchronize').length,1);
});

function householdConnection(h,role,{householdId='new-household',proofId=householdId,initialized=false,premium=true}={}){
 h.server.scope={kind:'household',id:householdId};h.server.stock={};h.server.inventoryRevision=0;h.server.initialized=initialized;
 h.host.configure({fetch:async address=>{
  const household=address.startsWith('/api/household');h.calls.push({type:household?'household-status':address.includes('mode=status')?'status':'fetch'});
  return {ok:true,json:async()=>household?{configured:true,premium,role,household_id:proofId}:address.includes('mode=status')?{ok:true,available:true,premium:true}:{ok:true,...clone(h.server)}};
 }});
}

test('a verified Premium household owner seeds the untouched revision-zero pantry from exact current At home amounts',async()=>{
 const h=fixture();householdConnection(h,'owner');const result=await h.host.connectHouseholdPantry();
 assert.equal(result.ok,true);assert.equal(result.householdSeeded,true);const post=h.calls.find(row=>row.type==='post');
 assert.equal(post.expectedRevision,0);assert.equal(post.expectedScope.id,'new-household');assert.deepEqual(post.stock,{'rice|g':533.333333});assert.deepEqual(h.read(keys.stock),{'rice|g':533.333333});
 assert.equal(h.calls.filter(row=>row.type==='household-status').length,1);assert.equal(h.read(result.backupKey).scope.kind,'user');
});

for(const [label,role,options]of [['invitee','member',{}],['unknown role',undefined,{}],['wrong household','owner',{proofId:'another-household'}],['unverified premium','owner',{premium:false}]])test('an uninitialized '+label+' connection waits without posting or replacing the personal pantry',async()=>{
 const h=fixture();householdConnection(h,role,options);const result=await h.host.connectHouseholdPantry();
 assert.equal(result.ok,false);assert.equal(result.needsInitialization,true);assert.equal(result.code,'household_lead_initialization_pending');assert.equal(h.calls.some(row=>row.type==='post'),false);
 assert.deepEqual(h.read(keys.stock),{'rice|g':533.333333});assert.equal(h.host.getAccountPantryStatus().status,'pending');assert.equal(h.host.getAccountPantryStatus().waitingForOwner,true);
 const backups=h.backupKeys().length;await h.host.refreshAccountPantry();await h.host.refreshAccountPantry();assert.equal(h.backupKeys().length,backups);assert.equal(h.calls.some(row=>row.type==='post'),false);
});

test('an invitee waiting for initialization adopts the lead pantry through normal refresh once the lead has seeded it',async()=>{
 const h=fixture();householdConnection(h,'member');await h.host.connectHouseholdPantry();
 h.server.stock={'sausage|each':4};h.server.inventoryRevision=1;h.server.initialized=true;
 const result=await h.host.refreshAccountPantry();assert.equal(result.ok,true);assert.equal(result.householdSeeded,false);assert.deepEqual(h.read(keys.stock),{'sausage|each':4});assert.deepEqual(h.calls.find(row=>row.type==='post').stock,{'sausage|each':4});assert.equal(h.host.getAccountPantryStatus().waitingForOwner,undefined);
});

test('an initialized but intentionally empty household is adopted without seeding personal amounts',async()=>{
 const h=fixture();householdConnection(h,'owner',{initialized:true});const result=await h.host.connectHouseholdPantry();
 assert.equal(result.ok,true);assert.equal(result.householdSeeded,false);assert.deepEqual(h.calls.find(row=>row.type==='post').stock,{});assert.deepEqual(h.read(keys.stock),{});assert.equal(h.calls.some(row=>row.type==='household-status'),false);
});

test('another initializer winning the household revision-zero race preserves the lead personal pantry and backup',async()=>{
 const h=fixture();householdConnection(h,'owner');const post=h.inventory.confirmPantry;
 h.inventory.confirmPantry=async function(value){h.server.inventoryRevision=1;h.server.initialized=true;h.server.stock={'egg|each':4};return post.call(this,value);};
 const result=await h.host.connectHouseholdPantry();assert.equal(result.ok,false);assert.equal(result.conflict,true);assert.deepEqual(h.server.stock,{'egg|each':4});assert.deepEqual(h.read(keys.stock),{'rice|g':533.333333});assert.ok(result.backupKey);
});

test('startup and Shop availability refresh preserve unchanged purchase metadata without adapter projection',async()=>{
 const h=fixture();h.write(keys.kitchen,{wraps:{name:'Wraps',qty:8,loc:'cupboard',bb173StockKey:'wrap|each',bb173StockValue:8,ownershipMarker:'reload-original-marker'}});
 const raw=Object.fromEntries(Object.values(keys).map(key=>[key,h.storage.getItem(key)]));
 const result=await h.host.refreshAvailability({force:true,synchronize:true});assert.equal(result.available,true);
 assert.equal(h.calls.filter(row=>row.type==='fetch').length,1);assert.equal(h.calls.some(row=>row.type==='synchronize'),false);
 assert.deepEqual(Object.fromEntries(Object.values(keys).map(key=>[key,h.storage.getItem(key)])),raw);assert.equal(h.projections.length,0);
});

test('startup availability never projects over queued, dirty or mismatched unowned nonempty local intent',async()=>{
 for(const kind of ['queued','dirty','unowned']){
  const h=fixture({owned:kind!=='unowned',...(kind==='unowned'?{remote:{'rice|g':900}}:{})});
  if(kind==='queued')h.enqueue({});if(kind==='dirty')h.write(keys.stock,{'rice|g':1.333333});
  const before=h.storage.getItem(keys.stock);await h.host.refreshAvailability({force:true,synchronize:true});
  assert.equal(h.calls.some(row=>row.type==='synchronize'),false,kind);assert.equal(h.storage.getItem(keys.stock),before,kind);
 }
});

test('startup availability still applies genuinely newer shared revisions through the verified adapter',async()=>{
 const h=fixture({scope:{kind:'household',id:'shared-pantry'}});h.server.inventoryRevision=4;h.server.stock={'rice|g':100.333333};
 await h.host.refreshAvailability({force:true,synchronize:true});assert.equal(h.calls.filter(row=>row.type==='synchronize').length,1);
});

test('startup availability delegates an initialized exact unowned stock acknowledgement to the existing adapter',async()=>{
 const exact={'rice|g':533.333333,'egg|each':2.666667},h=fixture({owned:false,local:exact,remote:exact,initialized:true});
 const before=h.storage.getItem(keys.stock),result=await h.host.refreshAvailability({force:true,synchronize:true});
 assert.equal(result.available,true);assert.equal(h.calls.filter(row=>row.type==='fetch').length,1);assert.equal(h.calls.filter(row=>row.type==='synchronize').length,1);assert.equal(h.storage.getItem(keys.stock),before);
});

for(const [label,remote,initialized]of [['different initialized stock',{'rice|g':900},true],['equal uninitialized stock',{'rice|g':533.333333},false]])test('startup availability with unowned '+label+' retains local stock without projection',async()=>{
 const h=fixture({owned:false,remote,initialized}),before=h.storage.getItem(keys.stock);
 await h.host.refreshAvailability({force:true,synchronize:true});assert.equal(h.calls.filter(row=>row.type==='fetch').length,1);assert.equal(h.calls.some(row=>row.type==='synchronize'),false);assert.equal(h.storage.getItem(keys.stock),before);
});
