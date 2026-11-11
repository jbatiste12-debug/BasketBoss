import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import * as core from '../bb-receipt-inventory-core.mjs';

const [hostSource,adapterSource,appSource]=await Promise.all(['../bb-receipt-host.js','../bb-receipt-inventory.js','../app.html'].map(file=>readFile(new URL(file,import.meta.url),'utf8')));
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const copy=value=>JSON.parse(JSON.stringify(value));
function memoryStorage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function server(){return {
 stock:{'rice|g':100},revision:3,available:true,posts:[],scope:{kind:'user',id:ACTOR},afterPost:null,
 snapshot(){return {ok:true,initialized:true,inventoryRevision:this.revision,stock:copy(this.stock),scope:copy(this.scope),pantryReview:{required:false},inventory:[],essentials:[],receipts:[],priceObservations:[]};},
 async fetch(url,options={}){
  const response=(value,status=200)=>({ok:status<400,status,json:async()=>copy(value)});
  if(url.includes('mode=status'))return response({available:this.available,premium:true,configured:true});
  if(options.method!=='POST')return response(this.snapshot());
  const body=JSON.parse(options.body);this.posts.push(body);
  if(body.expectedRevision!==this.revision||JSON.stringify(body.expectedScope)!==JSON.stringify(this.scope))return response({error:'inventory_revision_conflict'},409);
  this.stock=copy(body.stock);this.revision++;const result=this.snapshot();await this.afterPost?.(body);return response(result);
 }
};}
async function fixture({store=memoryStorage(),remote=server(),initialize=true,guest=false}={}){
 const events=new Map(),root={localStorage:store,Intl,Date,console,queueMicrotask,addEventListener(name,handler){events.set(name,[...(events.get(name)||[]),handler]);}};
 vm.runInNewContext(adapterSource,root);vm.runInNewContext(hostSource,root);
 const session={value:guest?null:{user:{id:ACTOR},access_token:'private-offline-cook-token',expires_at:9999999999}},context={value:{market:'UK',retailer:'Tesco',shopSessionId:'cook-trip'}};
 const inventory=root.BBReceiptInventoryFactory({core,storage:store,fetch:remote.fetch.bind(remote),getSession:()=>session.value,getContext:()=>context.value,pantryPolicy:true});
 if(initialize&&!guest)await inventory.synchronize();
 const stock=()=>JSON.parse(store.getItem(inventory.keys.stock)||'{}'),outboxKey='basketboss_purchase_pantry_sync_v1:'+ACTOR;
 const host=root.BBReceiptHostFactory({storage:store,inventory,fetch:remote.fetch.bind(remote),getSession:()=>session.value,getContext:()=>context.value,getStock:stock,pantryPolicy:true,now:()=>1700000000000});host.configure();
 const setStock=amount=>store.setItem(inventory.keys.stock,JSON.stringify(amount));
 const cook=async amount=>{setStock(amount);return host.confirmCookedPantry({stock:amount});};
 return {root,store,remote,session,context,inventory,host,stock,setStock,cook,outboxKey,outbox:()=>JSON.parse(store.getItem(outboxKey)||'null'),event(name){for(const fn of events.get(name)||[])fn();}};
}

test('offline cooking from synchronized stock queues its exact remaining balance and syncs after reload',async()=>{
 const f=await fixture();f.remote.available=false;
 assert.equal((await f.cook({'rice|g':70})).localOnly,true);
 assert.deepEqual(f.outbox().baselineStock,{'rice|g':100});assert.deepEqual(f.outbox().stock,{'rice|g':70});assert.equal(f.outbox().expectedRevision,3);
 assert.equal(f.host.canConsumePantry(),true);assert.deepEqual(f.remote.stock,{'rice|g':100});
 f.remote.available=true;const reloaded=await fixture({store:f.store,remote:f.remote,initialize:false});
 assert.equal((await reloaded.host.retryPurchasedPantry()).queued,false);assert.deepEqual(reloaded.stock(),{'rice|g':70});assert.deepEqual(f.remote.stock,{'rice|g':70});assert.equal(reloaded.outbox(),null);
});

test('offline cooking preserves a tiny measured remainder rather than rounding it away',async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({'rice|g':.000001});assert.deepEqual(f.outbox().stock,{'rice|g':.000001});
 f.remote.available=true;const reloaded=await fixture({store:f.store,remote:f.remote,initialize:false});await reloaded.host.retryPurchasedPantry();
 assert.deepEqual(reloaded.stock(),{'rice|g':.000001});assert.deepEqual(f.remote.stock,{'rice|g':.000001});
});

test('using the last food while offline queues an empty pantry instead of restoring its old balance',async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({});assert.deepEqual(f.outbox().stock,{});
 f.remote.available=true;await f.host.retryPurchasedPantry();assert.deepEqual(f.stock(),{});assert.deepEqual(f.remote.stock,{});assert.equal(f.outbox(),null);
});

test('undoing an offline meal back to its untouched server balance cancels the pending replacement',async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({'rice|g':70});
 assert.equal((await f.cook({'rice|g':100})).queued,false);assert.equal(f.outbox(),null);assert.deepEqual(f.stock(),{'rice|g':100});
 f.remote.available=true;await f.host.retryPurchasedPantry();assert.equal(f.remote.posts.length,0);assert.deepEqual(f.remote.stock,{'rice|g':100});
});

test('undo after a synchronized meal uses the acknowledged revision and restores stock once',async()=>{
 const f=await fixture();await f.cook({'rice|g':70});assert.equal(f.remote.revision,4);
 f.remote.available=false;await f.host.refreshAvailability({force:true,synchronize:false});await f.cook({'rice|g':100});assert.equal(f.outbox().expectedRevision,4);
 f.remote.available=true;await f.host.retryPurchasedPantry();assert.deepEqual(f.stock(),{'rice|g':100});assert.deepEqual(f.remote.stock,{'rice|g':100});
});

test('offline cooking advances an existing purchase outbox without reviving the bought pack',async()=>{
 const f=await fixture();f.remote.available=false;
 const before=f.stock(),purchase={'rice|g':2000},prepared=f.host.preparePurchasedPantry({stock:purchase,beforeStock:before});
 for(const [key,value]of Object.entries(prepared.updates))f.store.setItem(key,JSON.stringify(value));f.setStock(purchase);
 await f.host.retryPurchasedPantry();await f.cook({'rice|g':800});await f.cook({});
 assert.deepEqual(f.outbox().stock,{});f.remote.available=true;await f.host.retryPurchasedPantry();assert.deepEqual(f.remote.stock,{});assert.deepEqual(f.stock(),{});
});

test('lost response after an online cooking commit retains a retry intent and cannot double-deduct',async()=>{
 const f=await fixture();f.remote.afterPost=()=>{f.remote.afterPost=null;throw Error('network lost after commit');};
 const interrupted=await f.cook({'rice|g':70});assert.equal(interrupted.retryable,true);assert.deepEqual(f.remote.stock,{'rice|g':70});assert.deepEqual(f.outbox().attempt.stock,{'rice|g':70});
 const reloaded=await fixture({store:f.store,remote:f.remote,initialize:false});await reloaded.host.retryPurchasedPantry();
 assert.deepEqual(reloaded.stock(),{'rice|g':70});assert.deepEqual(f.remote.stock,{'rice|g':70});assert.equal(reloaded.outbox(),null);
 assert.ok([...f.store.values.values()].every(value=>!value.includes('private-offline-cook-token')));
});

test('duplicate retries of the same offline meal share one cloud replacement',async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({'rice|g':70});f.remote.available=true;
 const responses=await Promise.all([f.host.retryPurchasedPantry(),f.host.retryPurchasedPantry(),f.host.retryPurchasedPantry()]);
 assert.ok(responses.every(result=>result.queued===false));assert.equal(f.remote.posts.length,1);assert.deepEqual(f.remote.stock,{'rice|g':70});
});

test('one production online event retries inside the unavailable cache window and coalesces repeated retries',{timeout:10000},async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({'rice|g':70});f.remote.available=true;
 let began,release;const started=new Promise(resolve=>began=resolve),waiting=new Promise(resolve=>release=resolve);
 f.remote.afterPost=async()=>{began();await waiting;};f.root.BBShopOwnership={enabled:()=>true};
 const listener=appSource.split('\n').find(line=>line.includes("window.addEventListener('online'")&&line.includes('retryPurchasedPantry'));
 assert.ok(listener,'the app has a real reconnect retry handler');vm.runInNewContext(listener,{window:f.root,host:f.host});
 f.event('online');await started;const a=f.host.retryPurchasedPantry(),b=f.host.retryPurchasedPantry();release();await Promise.all([a,b]);
 assert.equal(f.remote.posts.length,1);assert.equal(f.outbox(),null);assert.deepEqual(f.remote.stock,{'rice|g':70});assert.deepEqual(f.stock(),{'rice|g':70});
});

test('a genuine remote edit requires review and never replaces either device balance silently',async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({'rice|g':70});f.remote.stock={'rice|g':90};f.remote.revision++;f.remote.available=true;
 const result=await f.host.retryPurchasedPantry();assert.equal(result.conflict,true);assert.equal(result.needsReview,true);assert.deepEqual(f.stock(),{'rice|g':70});assert.deepEqual(f.remote.stock,{'rice|g':90});assert.equal(f.host.canConsumePantry(),false);
});

test('changed household ownership cannot inherit an offline cooking replacement',async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({'rice|g':70});f.remote.scope={kind:'household',id:'different-household'};f.remote.available=true;
 const result=await f.host.retryPurchasedPantry();assert.equal(result.conflict,true);assert.deepEqual(f.remote.stock,{'rice|g':100});assert.deepEqual(f.stock(),{'rice|g':70});
});

test('switching accounts during a cooking retry keeps the original queue away from the new pantry',async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({'rice|g':70});f.remote.available=true;
 let began,release;const started=new Promise(resolve=>began=resolve),waiting=new Promise(resolve=>release=resolve);
 f.remote.afterPost=async()=>{began();await waiting;};const pending=f.host.retryPurchasedPantry();await started;
 f.session.value={user:{id:OTHER},access_token:'other-token',expires_at:9999999999};f.event('basketboss:session-changed');f.setStock({'milk|ml':200});release();await pending;
 assert.deepEqual(f.stock(),{'milk|ml':200});assert.deepEqual(f.outbox().stock,{'rice|g':70});assert.equal(f.store.getItem('basketboss_purchase_pantry_sync_v1:'+OTHER),null);
});

test('logging out retains the account cooking queue and cannot upload it from the guest pantry',async()=>{
 const f=await fixture();f.remote.available=false;await f.cook({'rice|g':70});f.session.value=null;f.event('basketboss:session-changed');
 f.setStock({'milk|ml':200});assert.equal((await f.host.retryPurchasedPantry()).queued,false);assert.equal(f.remote.posts.length,0);assert.deepEqual(f.outbox().stock,{'rice|g':70});assert.deepEqual(f.stock(),{'milk|ml':200});
});

test('failure to persist a cooking queue leaves the measured local deduction intact and retryable',async()=>{
 const f=await fixture();f.remote.available=false;const original=f.store.setItem;let fail=true;
 f.store.setItem=(key,value)=>{if(key===f.outboxKey&&fail){fail=false;throw Error('quota');}return original(key,value);};
 const failed=await f.cook({'rice|g':70});assert.equal(failed.ok,false);assert.deepEqual(f.stock(),{'rice|g':70});assert.equal(f.remote.posts.length,0);
 assert.equal((await f.host.confirmCookedPantry({stock:f.stock()})).queued,true);assert.deepEqual(f.outbox().stock,{'rice|g':70});
});

test('guest and unowned local cooking do not claim a server baseline or create an account queue',async()=>{
 for(const guest of [true,false]){const f=await fixture({initialize:false,guest});f.remote.available=false;const result=await f.cook({'rice|g':70});assert.equal(result.localOnly,true);assert.equal(f.outbox(),null);assert.equal(f.remote.posts.length,0);assert.deepEqual(f.stock(),{'rice|g':70});}
});

test('an actual PostgreSQL CAS preserves the offline cooking remainder and rejects a later cross-device edit',{skip:!process.env.BB_RECEIPT_PGLITE_PATH},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.BB_RECEIPT_PGLITE_PATH).href),db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   CREATE TABLE public.bb_households(id uuid primary key,owner_user_id uuid,partner_user_id uuid,partner_email text,invite_status text);
   INSERT INTO auth.users VALUES('${ACTOR}','offline-cook@example.test',now());`);
  for(const file of ['../sql/basketboss_receipt_inventory_20261031.sql','../supabase/migrations/20261104174441_receipt_auto_stock_policy.sql','../supabase/migrations/20261104174450_pantry_fractional_stock_balances.sql'])await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  const rpc=async(action,body={})=>(await db.query('SELECT public.bb_receipt_inventory_service($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS result',[ACTOR,'user',ACTOR,action,null,null,null,JSON.stringify(body)])).rows[0].result;
  await rpc('confirm_pantry',{action:'confirm_pantry',expectedScope:{kind:'user',id:ACTOR},expectedRevision:0,stock:{'rice|g':100},shopSessionId:'cook-trip'});
  const remote={available:true,posts:[],async fetch(url,options={}){
   const response=(value,status=200)=>({ok:status<400,status,json:async()=>copy(value)});
   if(url.includes('mode=status'))return response({available:this.available,premium:true,configured:true});
   const body=options.method==='POST'?JSON.parse(options.body):null;if(body)this.posts.push(body);
   const result=await rpc(body?'confirm_pantry':'get',body||{});return response(result,result.ok===false?result.conflict?409:400:200);
  }};
  const f=await fixture({remote});remote.available=false;await f.cook({'rice|g':.000001});assert.deepEqual(f.outbox().stock,{'rice|g':.000001});
  remote.available=true;const reloaded=await fixture({store:f.store,remote,initialize:false});await reloaded.host.retryPurchasedPantry();assert.deepEqual((await rpc('get')).stock,{'rice|g':.000001});assert.deepEqual(reloaded.stock(),{'rice|g':.000001});
  remote.available=false;await reloaded.host.refreshAvailability({force:true,synchronize:false});await reloaded.cook({});
  const latest=await rpc('get');await rpc('confirm_pantry',{action:'confirm_pantry',expectedScope:{kind:'user',id:ACTOR},expectedRevision:latest.inventoryRevision,stock:{'rice|g':25},shopSessionId:'another-device'});
  remote.available=true;assert.equal((await reloaded.host.retryPurchasedPantry()).conflict,true);assert.deepEqual((await rpc('get')).stock,{'rice|g':25});assert.deepEqual(reloaded.stock(),{});
 }finally{await db.close();}
});
