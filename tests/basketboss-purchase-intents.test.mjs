import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {digestDeletionActor,digestDeletionRef} from '../bb-server-lib/bb-account-deletion.js';
import {PurchaseIntentError,purchaseIntentsEnabled,purchaseIntentsStrict,purchaseIntentSchemaReady,assertPurchaseIntentReady,purchaseIntentActor,reservePurchaseIntent,startPurchaseIntent,reportPurchaseIntent,readPurchaseIntent,proofStatements,associatePurchaseIntentReference,cancelUncreatedPurchaseIntent} from '../bb-server-lib/bb-purchase-intents.js';

const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const SESSION='33333333-3333-4333-8333-333333333333',SECOND_SESSION='44444444-4444-4444-8444-444444444444';
const actor={userId:USER,sessionHash:'a'.repeat(64)},otherActor={userId:OTHER,sessionHash:'b'.repeat(64)};
const select=(provider='google_play',extra={})=>({provider,mode:'live',productId:'premium',protocol:1,...extra});
const rejects=code=>error=>error instanceof PurchaseIntentError&&error.code===code;
function fixture({schema=true,enabled=true,strict=true}={}){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY); CREATE TABLE bb_account_deletion_refs(ref_hash TEXT PRIMARY KEY); CREATE TABLE verified_provider(reference TEXT PRIMARY KEY,user_id TEXT);');
 if(schema)sql.exec(readFileSync(new URL('../sql/basketboss_purchase_intents_20261121.sql',import.meta.url),'utf8'));
 let queue=Promise.resolve();
 const db={sql,queries:[],before:null,prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){db.queries.push(query);db.before?.(query,args);return sql.prepare(query).get(...args)||null;},async all(){db.queries.push(query);db.before?.(query,args);return {results:sql.prepare(query).all(...args)};},async run(){db.queries.push(query);db.before?.(query,args);const result=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};},batch(list){const work=queue.then(async()=>{sql.exec('BEGIN');try{const results=[];for(const statement of list)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}});queue=work.catch(()=>{});return work;}};
 const env={BILLING_DB:db,BB_PURCHASE_INTENTS_ENABLED:String(enabled),BB_PURCHASE_INTENTS_STRICT:String(strict),SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable-key'};
 return {db,env,sql,row:id=>sql.prepare('SELECT * FROM bb_purchase_intents WHERE id=?').get(id),slot:(user=USER,mode='live')=>sql.prepare('SELECT * FROM bb_purchase_intent_slots WHERE user_id=? AND mode=?').get(user,mode)};
}
async function started(f,provider='google_play',who=actor){return startPurchaseIntent(f.env,who,await reservePurchaseIntent(f.env,who,select(provider)));}
async function proof(f,{reference='synthetic-store-proof',...options}={}){
 const statements=await proofStatements(f.env,{userId:USER,provider:'google_play',mode:'live',productId:'premium',reference,...options});
 await f.db.batch([f.db.prepare('INSERT OR IGNORE INTO verified_provider VALUES(?,?)').bind(reference,options.userId||USER),...statements]);
}
const jwt=(claims={})=>[Buffer.from(JSON.stringify({alg:'ES256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({iss:'https://fixture.supabase.co/auth/v1',sub:USER,session_id:SESSION,exp:Math.floor(Date.now()/1000)+3600,...claims})).toString('base64url'),'syntheticSignature'].join('.');
const request=token=>new Request('https://basketboss.co.uk/api/subscription/purchase-intent',{method:'POST',headers:{Origin:'https://localhost',Authorization:'Bearer '+token}});

test('coordination defaults off; strict protocol is opt-in and runtime never creates schema',async()=>{
 assert.equal(purchaseIntentsEnabled({}),false);assert.equal(purchaseIntentsStrict({BB_PURCHASE_INTENTS_STRICT:'true'}),false);
 assert.equal(await reservePurchaseIntent({},null,{}),null);assert.equal(await assertPurchaseIntentReady({}),false);
 const absent=fixture({schema:false});assert.equal(await purchaseIntentSchemaReady(absent.env),false);
 await assert.rejects(()=>reservePurchaseIntent(absent.env,actor,select()),rejects('purchase_intent_unavailable'));
 assert.equal(absent.db.queries.some(query=>/CREATE|ALTER/i.test(query)),false);
 const f=fixture();await assert.rejects(()=>reservePurchaseIntent(f.env,actor,select('apple',{protocol:undefined})),rejects('purchase_intent_upgrade_required'));
 const compat=fixture({strict:false});assert.equal(await reservePurchaseIntent(compat.env,actor,select('apple',{protocol:undefined})),null);
 await reservePurchaseIntent(compat.env,actor,select());
 await assert.rejects(()=>reservePurchaseIntent(compat.env,actor,select('apple',{protocol:undefined})),rejects('purchase_intent_busy'));
 compat.sql.prepare("UPDATE bb_purchase_intents SET prepared_expires_at_ms=1 WHERE phase='prepared'").run();
 assert.equal(await reservePurchaseIntent(compat.env,actor,select('apple',{protocol:undefined})),null);assert.equal(compat.slot().active_intent_id,null);
});

test('schema fallback distinguishes definitive absence from partial schema and transient errors',async()=>{
 const absent=fixture({schema:false});assert.deepEqual(await proofStatements(absent.env,{}),[]);
 const partial=fixture({schema:false});partial.sql.exec('CREATE TABLE bb_purchase_intents(id TEXT)');
 await assert.rejects(()=>purchaseIntentSchemaReady(partial.env),rejects('purchase_intent_unavailable'));
 absent.sql.exec('CREATE TABLE bb_purchase_intent_schema(id INTEGER PRIMARY KEY,version INTEGER); INSERT INTO bb_purchase_intent_schema VALUES(1,1)');
 await assert.rejects(()=>purchaseIntentSchemaReady(absent.env),rejects('purchase_intent_unavailable'));
 const f=fixture();f.db.before=query=>{if(query.includes('sqlite_master'))throw Error('synthetic transport failure');};
 await assert.rejects(()=>proofStatements(f.env,{}),rejects('purchase_intent_unavailable'));
});

test('disabled proof coordination leaves existing provider contracts untouched without querying optional schema',async()=>{
 const f=fixture({enabled:false});f.db.before=()=>{throw Error('Must not touch optional schema');};
 assert.deepEqual(await proofStatements(f.env,{}),[]);assert.equal(f.db.queries.length,0);
});

test('session binding reads claims only after authenticated bearer validation and survives token refresh',async()=>{
 const f=fixture(),original=globalThis.fetch;let authentications=0;
 globalThis.fetch=async(url,options)=>{authentications++;assert.equal(url,'https://fixture.supabase.co/auth/v1/user');assert.ok(options.headers.Authorization.startsWith('Bearer '));return Response.json({id:USER,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01'});};
 try{
  const first=await purchaseIntentActor(request(jwt()),f.env,{id:USER});
  const refreshed=await purchaseIntentActor(request(jwt({iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200})),f.env,{id:USER});
  assert.equal(first.sessionHash,refreshed.sessionHash);assert.equal(first.userId,USER);
  assert.notEqual(first.sessionHash,(await purchaseIntentActor(request(jwt({session_id:SECOND_SESSION})),f.env)).sessionHash);
  for(const claims of [{session_id:undefined},{sub:OTHER},{iss:'https://evil.invalid/auth/v1'},{exp:1}])await assert.rejects(()=>purchaseIntentActor(request(jwt(claims)),f.env),rejects('purchase_intent_session_unavailable'));
  await assert.rejects(()=>purchaseIntentActor(request(jwt()),f.env,{id:OTHER}),rejects('authentication_required'));
  const count=authentications;globalThis.fetch=async()=>{authentications++;return new Response('{}',{status:401});};
  await assert.rejects(()=>purchaseIntentActor(request('not-a-jwt'),f.env),rejects('authentication_required'));assert.equal(authentications,count+1);
 }finally{globalThis.fetch=original;}
});

test('simultaneous providers acquire one D1 account slot; modes and accounts remain separate',async()=>{
 const f=fixture();
 const results=await Promise.allSettled([reservePurchaseIntent(f.env,actor,select('apple')),reservePurchaseIntent(f.env,actor,select('google_play')),reservePurchaseIntent(f.env,actor,select('paddle'))]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 for(const result of results.filter(result=>result.status==='rejected'))assert.equal(result.reason.code,'purchase_intent_busy');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_purchase_intents').get().n,1);
 assert.equal(f.slot().generation,1);
 await reservePurchaseIntent(f.env,actor,select('paddle',{mode:'test'}));await reservePurchaseIntent(f.env,otherActor,select('apple'));
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_purchase_intents').get().n,3);
});

test('safe status omits capabilities, sessions and reference material; database holds only capability hashes',async()=>{
 const f=fixture(),intent=await reservePurchaseIntent(f.env,actor,select('google_play',{basePlanId:'monthly',offerId:'trial'}));
 assert.equal(intent.capability.length,64);assert.equal(intent.phase,'prepared');
 const status=await readPurchaseIntent(f.env,actor,{mode:'live'});
 assert.equal(status.id,intent.id);assert.equal(status.capability,undefined);
 assert.equal(Object.keys(status).some(key=>/session|reference|hash|token/i.test(key)),false);
 assert.notEqual(f.row(intent.id).capability_hash,intent.capability);
 assert.equal(JSON.stringify(f.row(intent.id)).includes(intent.capability),false);
});

test('only unstarted prepared reservations expire; old starts cannot acquire a newer generation',async()=>{
 const f=fixture(),old=await reservePurchaseIntent(f.env,actor,select('apple'));
 f.sql.prepare('UPDATE bb_purchase_intents SET prepared_expires_at_ms=? WHERE id=?').run(Date.now()-1,old.id);
 await assert.rejects(()=>startPurchaseIntent(f.env,actor,old),rejects('purchase_intent_expired'));
 const next=await reservePurchaseIntent(f.env,actor,select());assert.equal(next.generation,2);assert.equal(f.row(old.id).phase,'canceled');
 await assert.rejects(()=>startPurchaseIntent(f.env,actor,old),rejects('purchase_intent_changed'));assert.equal(f.slot().active_intent_id,next.id);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_purchase_intent_events WHERE intent_id=?').get(old.id).n,2);
 for(const phase of ['started','pending','unknown']){
  const g=fixture();let active=await started(g);
  if(phase!=='started')active=await reportPurchaseIntent(g.env,actor,{...active,outcome:phase});
  g.sql.prepare('UPDATE bb_purchase_intents SET prepared_expires_at_ms=1,updated_at_ms=1 WHERE id=?').run(active.id);
  await assert.rejects(()=>reservePurchaseIntent(g.env,actor,select('apple')),rejects('purchase_intent_busy'));assert.equal(g.row(active.id).phase,phase);
 }
});

test('start and cancellation retries are idempotent; stale capabilities or sessions cannot mutate a newer slot',async()=>{
 const f=fixture(),prepared=await reservePurchaseIntent(f.env,actor,select()),active=await startPurchaseIntent(f.env,actor,prepared);
 assert.deepEqual(await startPurchaseIntent(f.env,actor,prepared),active);
 for(const [who,change] of [[actor,{capability:'0'.repeat(64)}],[{...actor,sessionHash:'c'.repeat(64)},{}],[otherActor,{}],[actor,{generation:active.generation+1}]])await assert.rejects(()=>reportPurchaseIntent(f.env,who,{...active,...change,outcome:'canceled',cause:'native_user_cancelled'}),rejects('purchase_intent_mismatch'));
 const cancel={...active,outcome:'canceled',cause:'native_user_cancelled'},canceled=await reportPurchaseIntent(f.env,actor,cancel);
 assert.deepEqual(await reportPurchaseIntent(f.env,actor,cancel),canceled);
 const next=await reservePurchaseIntent(f.env,actor,select('apple'));
 assert.deepEqual(await reportPurchaseIntent(f.env,actor,cancel),canceled);assert.equal(f.slot().active_intent_id,next.id);
 await assert.rejects(()=>startPurchaseIntent(f.env,actor,prepared),rejects('purchase_intent_changed'));
});

test('precise pre-launch and original late cancellation can release; pending, proof and generic unknown cannot',async()=>{
 const f=fixture();let intent=await reservePurchaseIntent(f.env,actor,select());
 await reportPurchaseIntent(f.env,actor,{...intent,outcome:'canceled',cause:'not_launched'});assert.equal(f.slot().active_intent_id,null);
 intent=await started(f);intent=await reportPurchaseIntent(f.env,actor,{...intent,outcome:'unknown'});
 await assert.rejects(()=>reportPurchaseIntent(f.env,actor,{...intent,outcome:'canceled',cause:'not_launched'}),rejects('purchase_intent_unresolved'));
 await assert.rejects(()=>reportPurchaseIntent(f.env,actor,{...intent,outcome:'canceled',cause:'timeout'}),rejects('invalid_purchase_intent_outcome'));
 await reportPurchaseIntent(f.env,actor,{...intent,outcome:'canceled',cause:'native_user_cancelled'});assert.equal(f.slot().active_intent_id,null);
 intent=await started(f);intent=await reportPurchaseIntent(f.env,actor,{...intent,outcome:'pending'});
 for(const outcome of ['canceled','unknown'])await assert.rejects(()=>reportPurchaseIntent(f.env,actor,{...intent,outcome,cause:'native_user_cancelled'}),rejects('purchase_intent_unresolved'));
 await assert.rejects(()=>reportPurchaseIntent(f.env,actor,{...intent,outcome:'completed'}),rejects('invalid_purchase_intent_outcome'));
 assert.equal(f.row(intent.id).pending_seen,1);assert.equal(f.slot().active_intent_id,intent.id);
});

test('deletion and deleted-reference checks are inside reserve/start mutation SQL',async()=>{
 for(const operation of ['reserve','start','ref']){
  const f=fixture(),prepared=operation==='reserve'?null:await reservePurchaseIntent(f.env,actor,select());
  const deletionHash=await digestDeletionActor(USER),deletedRef=prepared?await digestDeletionRef('purchase_intent',prepared.id):null;let injected=false;
  f.db.before=query=>{if(!injected&&(operation==='reserve'?query.startsWith('INSERT INTO bb_purchase_intents('):query.startsWith('UPDATE bb_purchase_intents SET phase=\'started\''))){injected=true;if(operation==='ref')f.sql.prepare('INSERT INTO bb_account_deletion_refs VALUES(?)').run(deletedRef);else f.sql.prepare('INSERT INTO bb_account_deletions VALUES(?)').run(deletionHash);}};
  await assert.rejects(()=>operation==='reserve'?reservePurchaseIntent(f.env,actor,select()):startPurchaseIntent(f.env,actor,prepared));
  assert.equal(injected,true);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM bb_purchase_intents WHERE phase='started'").get().n,0);
  if(operation==='reserve')assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_purchase_intents').get().n,0);
 }
});

test('verified trusted-store correlation completes its exact attempt and records billing revision atomically',async()=>{
 const f=fixture(),intent=await started(f);await proof(f,{trustedIntentId:intent.id});
 assert.equal(f.row(intent.id).phase,'completed');assert.equal(f.row(intent.id).proof_seen,1);assert.equal(f.slot().active_intent_id,null);assert.equal(f.slot().billing_revision,1);
 const record=f.sql.prepare('SELECT * FROM bb_purchase_intent_proofs').get();assert.equal(record.intent_id,intent.id);assert.equal(record.reference_hash.length,64);assert.equal(JSON.stringify(record).includes('synthetic-store-proof'),false);
 await assert.rejects(()=>reportPurchaseIntent(f.env,actor,{...intent,outcome:'canceled',cause:'native_user_cancelled'}),rejects('purchase_intent_changed'));
});

test('unattributed or invalid client correlation preserves paid proof and never clears the current attempt',async()=>{
 for(const invalid of [{intentId:'raw-client-id'},intent=>({intentId:intent.id}),intent=>({reservation:{...intent,capability:'0'.repeat(64)},actor}),intent=>({reservation:intent,actor:{...actor,sessionHash:'f'.repeat(64)}}),intent=>({reservation:{...intent,version:intent.version+1},actor})]){
  const f=fixture(),intent=await started(f),options=typeof invalid==='function'?invalid(intent):invalid;
  await proof(f,options);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM verified_provider').get().n,1);assert.equal(f.row(intent.id).phase,'started');assert.equal(f.row(intent.id).proof_seen,0);assert.equal(f.slot().active_intent_id,intent.id);assert.equal(f.slot().billing_revision,1);
 }
 const f=fixture();await proof(f);assert.equal(f.slot().billing_revision,1);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_purchase_intents').get().n,0);
});

test('Apple reservation correlation requires exact actor capability/version/generation without changing proof authorization',async()=>{
 const f=fixture(),intent=await started(f,'apple');
 await proof(f,{provider:'apple',reference:'synthetic-apple-original',reservation:intent,actor});
 assert.equal(f.row(intent.id).phase,'completed');assert.equal(f.slot().active_intent_id,null);
});

test('late proof updates history but cannot clear or downgrade a newer started, pending, unknown or prepared attempt',async()=>{
 for(const phase of ['prepared','started','pending','unknown']){
  const f=fixture(),old=await started(f);await reportPurchaseIntent(f.env,actor,{...old,outcome:'canceled',cause:'native_user_cancelled'});
  let next=await reservePurchaseIntent(f.env,actor,select('apple'));if(phase!=='prepared')next=await startPurchaseIntent(f.env,actor,next);if(['pending','unknown'].includes(phase))next=await reportPurchaseIntent(f.env,actor,{...next,outcome:phase});
  await proof(f,{trustedIntentId:old.id});assert.equal(f.row(old.id).phase,'completed');assert.equal(f.row(next.id).phase,phase);assert.equal(f.slot().active_intent_id,next.id);
  if(phase==='prepared')await assert.rejects(()=>startPurchaseIntent(f.env,actor,next),rejects('purchase_intent_changed'));
 }
});

test('an unrelated proof prevents launch retries but does not strand the original native cancellation or reference report',async()=>{
 const f=fixture(),prepared=await reservePurchaseIntent(f.env,actor,select()),intent=await startPurchaseIntent(f.env,actor,prepared);
 await proof(f,{reference:'unattributed-historical-receipt'});
 await assert.rejects(()=>startPurchaseIntent(f.env,actor,prepared),rejects('purchase_intent_changed'));
 const canceled=await reportPurchaseIntent(f.env,actor,{...intent,outcome:'canceled',cause:'native_user_cancelled'});assert.equal(canceled.phase,'canceled');assert.equal(f.slot().active_intent_id,null);
 const g=fixture(),paddle=await started(g,'paddle');await proof(g,{reference:'other-historical-receipt'});
 const bound=await associatePurchaseIntentReference(g.env,actor,{...paddle,reference:'txn_known_after_revision'});assert.equal(bound.version,paddle.version+1);assert.equal(g.slot().active_intent_id,paddle.id);
});

test('known Paddle references bind immutably and reconcile without requiring a current client reservation',async()=>{
 const f=fixture();let intent=await started(f,'paddle');const binding={...intent,reference:'txn_synthetic_known_reference'};intent=await associatePurchaseIntentReference(f.env,actor,binding);
 assert.deepEqual(await associatePurchaseIntentReference(f.env,actor,binding),intent);
 assert.equal(f.row(intent.id).phase,'started');assert.equal(f.row(intent.id).proof_seen,0);assert.equal(f.slot().active_intent_id,intent.id);
 assert.equal(f.row(intent.id).reference_hash.length,64);assert.equal(JSON.stringify(f.row(intent.id)).includes('txn_synthetic_known_reference'),false);
 await proof(f,{provider:'paddle',reference:'txn_synthetic_known_reference'});assert.equal(f.row(intent.id).phase,'completed');assert.equal(f.slot().active_intent_id,null);
});

test('Paddle client cancellation cannot release a checkout; only definite server rejection or verified cancellation can',async()=>{
 const f=fixture();let intent=await started(f,'paddle');
 await assert.rejects(()=>reportPurchaseIntent(f.env,actor,{...intent,outcome:'canceled',cause:'native_user_cancelled'}),rejects('purchase_intent_store_confirmation_required'));
 assert.equal((await cancelUncreatedPurchaseIntent(f.env,actor,intent)).phase,'canceled');
 intent=await started(f,'paddle');intent=await associatePurchaseIntentReference(f.env,actor,{...intent,reference:'txn_known_payable'});
 for(const release of [()=>reportPurchaseIntent(f.env,actor,{...intent,outcome:'canceled',cause:'not_launched'}),()=>cancelUncreatedPurchaseIntent(f.env,actor,intent)])await assert.rejects(release,rejects('purchase_intent_store_confirmation_required'));
 assert.equal(f.slot().active_intent_id,intent.id);
 await proof(f,{provider:'paddle',reference:'txn_known_payable',phase:'canceled'});assert.equal(f.slot().active_intent_id,null);
 intent=await started(f,'paddle');intent=await reportPurchaseIntent(f.env,actor,{...intent,outcome:'unknown'});
 await assert.rejects(()=>cancelUncreatedPurchaseIntent(f.env,actor,intent),rejects('purchase_intent_store_confirmation_required'));
});

test('pending proof locks its current intent and late pending proof cannot reactivate historical canceled attempts',async()=>{
 const f=fixture(),intent=await started(f);await proof(f,{trustedIntentId:intent.id,phase:'pending'});
 const current=await readPurchaseIntent(f.env,actor,{mode:'live'});assert.equal(current.phase,'pending');assert.equal(f.row(intent.id).pending_seen,1);
 await assert.rejects(()=>reportPurchaseIntent(f.env,actor,{...intent,version:current.version,outcome:'canceled',cause:'native_user_cancelled'}),rejects('purchase_intent_unresolved'));
 const g=fixture(),old=await started(g);await reportPurchaseIntent(g.env,actor,{...old,outcome:'canceled',cause:'native_user_cancelled'});const next=await started(g,'apple');
 await proof(g,{trustedIntentId:old.id,phase:'pending'});assert.equal(g.row(old.id).phase,'canceled');assert.equal(g.slot().active_intent_id,next.id);assert.equal(g.row(next.id).phase,'started');
});

test('provider guards and deletion barriers prevent correlation writes and proof ownership never transfers',async()=>{
 const f=fixture(),intent=await started(f);await proof(f,{trustedIntentId:intent.id,guardSQL:'0'});assert.equal(f.slot().billing_revision,0);assert.equal(f.row(intent.id).proof_seen,0);
 await proof(f,{trustedIntentId:intent.id});
 await proof(f,{userId:OTHER,trustedIntentId:intent.id});assert.equal(f.slot(OTHER),undefined);assert.equal(f.sql.prepare('SELECT user_id FROM bb_purchase_intent_proofs').get().user_id,USER);
 const g=fixture(),pending=await started(g);g.sql.prepare('INSERT INTO bb_account_deletions VALUES(?)').run(await digestDeletionActor(USER));await proof(g,{trustedIntentId:pending.id});assert.equal(g.slot().billing_revision,0);assert.equal(g.row(pending.id).proof_seen,0);
 const h=fixture(),deleted=await started(h);h.sql.prepare('INSERT INTO bb_account_deletion_refs VALUES(?)').run(await digestDeletionRef('purchase_intent',deleted.id));await proof(h,{trustedIntentId:deleted.id});assert.equal(h.row(deleted.id).proof_seen,0);assert.equal(h.slot().active_intent_id,deleted.id);
});

test('provider persistence and proof revision roll back together on a failed atomic D1 batch',async()=>{
 const f=fixture(),intent=await started(f),statements=await proofStatements(f.env,{userId:USER,provider:'google_play',mode:'live',productId:'premium',reference:'rollback-proof',trustedIntentId:intent.id});
 f.db.before=query=>{if(query.startsWith('UPDATE bb_purchase_intent_proofs SET'))throw Error('synthetic batch failure');};
 await assert.rejects(()=>f.db.batch([f.db.prepare('INSERT INTO verified_provider VALUES(?,?)').bind('rollback-proof',USER),...statements]));
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM verified_provider').get().n,0);assert.equal(f.slot().billing_revision,0);assert.equal(f.row(intent.id).phase,'started');
});
