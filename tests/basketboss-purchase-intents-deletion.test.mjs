import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {digestDeletionActor,digestDeletionRef,ensureDeletionSchema,eraseAccountD1} from '../bb-server-lib/bb-account-deletion.js';
import {reservePurchaseIntent,startPurchaseIntent,reportPurchaseIntent,associatePurchaseIntentReference,proofStatements} from '../bb-server-lib/bb-purchase-intents.js';

const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const actor={userId:USER,sessionHash:'a'.repeat(64)},otherActor={userId:OTHER,sessionHash:'b'.repeat(64)};
const billing={claims:[],subscriptions:[],confirmedSlots:[]};
const selection=(provider='google_play',mode='live')=>({provider,mode,productId:'premium',protocol:1});

async function fixture(t,{schema=true}={}){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(`CREATE TABLE bb_paid_entitlements(user_id TEXT);
  CREATE TABLE bb_billing_claims(user_id TEXT);
  CREATE TABLE bb_founder_slots(slot_no INTEGER,state TEXT,user_id TEXT,reservation_token_hash TEXT,paddle_subscription_id TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER);`);
 if(schema)sql.exec(readFileSync(new URL('../sql/basketboss_purchase_intents_20261121.sql',import.meta.url),'utf8'));
 const db={before:null,executed:[],prepare(query){let args=[];return {
  bind(...values){args=values;return this;},
  async first(){db.before?.(query,args);return sql.prepare(query).get(...args)||null;},
  async all(){db.before?.(query,args);return {results:sql.prepare(query).all(...args)};},
  async run(){db.before?.(query,args);db.executed.push(query);const result=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}
 };},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={BILLING_DB:db,BB_PURCHASE_INTENTS_ENABLED:'true',BB_PURCHASE_INTENTS_STRICT:'true'};
 await ensureDeletionSchema(env);db.executed.length=0;
 return {sql,db,env};
}
const barrier=async f=>f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(USER),'synthetic-retry',Date.now());
const count=(f,table,userId=USER)=>f.sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE user_id=?').get(userId).n;
async function proof(f,{userId=USER,provider='google_play',mode='live',reference='synthetic-proof',...input}={}){
 await f.db.batch(await proofStatements(f.env,{userId,provider,mode,productId:'premium',reference,...input}));
}

test('purchase-intent deletion skips only definitively absent optional tables',async t=>{
 const f=await fixture(t,{schema:false});
 f.sql.prepare('INSERT INTO bb_paid_entitlements VALUES(?)').run(USER);
 await eraseAccountD1(f.env,USER,billing);
 assert.equal(count(f,'bb_paid_entitlements'),0);
 assert.equal(f.sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'bb_purchase_intent%'").get().n,0);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_account_deletion_refs').get().n,0);
});

test('purchase-intent cleanup requires the existing account-deletion barrier',async t=>{
 const f=await fixture(t),intent=await reservePurchaseIntent(f.env,actor,selection());
 f.db.executed.length=0;
 await assert.rejects(()=>eraseAccountD1(f.env,USER,billing),/account_deletion_barrier_required/);
 assert.equal(count(f,'bb_purchase_intents'),1);
 assert.equal(count(f,'bb_purchase_intent_slots'),1);
 assert.equal(f.sql.prepare('SELECT intent_id FROM bb_purchase_intent_events').get().intent_id,intent.id);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_account_deletion_refs').get().n,0);
 assert.deepEqual(f.db.executed,[]);
});

test('deletion tombstones attempts and bound or standalone proofs before atomically erasing every account mode',async t=>{
 const f=await fixture(t);
 const history=await reservePurchaseIntent(f.env,actor,selection());
 await reportPurchaseIntent(f.env,actor,{...history,outcome:'canceled',cause:'not_launched'});
 let pending=await startPurchaseIntent(f.env,actor,await reservePurchaseIntent(f.env,actor,selection()));
 pending=await associatePurchaseIntentReference(f.env,actor,{...pending,reference:'synthetic-unproven-reference'});
 await reportPurchaseIntent(f.env,actor,{...pending,outcome:'pending'});
 const completed=await startPurchaseIntent(f.env,actor,await reservePurchaseIntent(f.env,actor,selection('apple','test')));
 await proof(f,{provider:'apple',mode:'test',reference:'synthetic-completed-proof',trustedIntentId:completed.id});
 await proof(f,{provider:'paddle',reference:'synthetic-standalone-proof'});
 const foreign=await reservePurchaseIntent(f.env,otherActor,selection('paddle'));
 const attempts=f.sql.prepare('SELECT deletion_ref_hash,reference_hash FROM bb_purchase_intents WHERE user_id=?').all(USER);
 const proofs=f.sql.prepare('SELECT reference_hash FROM bb_purchase_intent_proofs WHERE user_id=?').all(USER);
 const expected=new Set(attempts.map(row=>row.deletion_ref_hash));
 for(const ref of [...attempts,...proofs].map(row=>row.reference_hash).filter(Boolean))expected.add(await digestDeletionRef('purchase_intent_proof',ref));
 await barrier(f);f.db.executed.length=0;
 f.env.BB_PURCHASE_INTENTS_ENABLED='false';
 await eraseAccountD1(f.env,USER,billing);
 assert.deepEqual(f.sql.prepare('SELECT ref_hash FROM bb_account_deletion_refs').all().map(row=>row.ref_hash).sort(),[...expected].sort());
 for(const table of ['bb_purchase_intents','bb_purchase_intent_slots','bb_purchase_intent_proofs'])assert.equal(count(f,table),0,table);
 assert.equal(count(f,'bb_purchase_intents',OTHER),1);assert.equal(count(f,'bb_purchase_intent_slots',OTHER),1);
 assert.deepEqual(f.sql.prepare('SELECT intent_id FROM bb_purchase_intent_events').all().map(row=>row.intent_id),[foreign.id]);
 const firstCleanup=f.db.executed.findIndex(query=>query.startsWith('DELETE FROM bb_purchase_intent'));
 assert.ok(firstCleanup>0);assert.ok(f.db.executed.slice(0,firstCleanup).every(query=>query.startsWith('INSERT OR IGNORE INTO bb_account_deletion_refs')));
 await eraseAccountD1(f.env,USER,billing);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_account_deletion_refs').get().n,expected.size);
 // A deleted provider reference cannot become a fresh account's proof; neither
 // a delayed proof nor the old capability can recreate the deleted account.
 f.env.BB_PURCHASE_INTENTS_ENABLED='true';
 await proof(f,{userId:OTHER,provider:'apple',mode:'test',reference:'synthetic-completed-proof'});
 await proof(f,{reference:'synthetic-delayed-proof'});
 assert.equal(count(f,'bb_purchase_intent_proofs',OTHER),0);assert.equal(count(f,'bb_purchase_intent_proofs'),0);
 await assert.rejects(()=>startPurchaseIntent(f.env,actor,pending),error=>error.code==='purchase_intent_mismatch');
 await assert.rejects(()=>reservePurchaseIntent(f.env,actor,selection()),error=>error.code==='account_deletion_pending');
 assert.equal(count(f,'bb_purchase_intents'),0);assert.equal(count(f,'bb_purchase_intent_slots'),0);
});

test('purchase-intent deletion rolls back both tombstones and sensitive rows when any cleanup fails',async t=>{
 const f=await fixture(t),intent=await reservePurchaseIntent(f.env,actor,selection());
 await proof(f,{reference:'synthetic-proof'});await barrier(f);
 f.sql.exec("CREATE TRIGGER reject_intent_cleanup BEFORE DELETE ON bb_purchase_intent_slots BEGIN SELECT RAISE(ABORT,'synthetic intent cleanup failure'); END");
 await assert.rejects(()=>eraseAccountD1(f.env,USER,billing),/synthetic intent cleanup failure/);
 assert.equal(count(f,'bb_purchase_intents'),1);assert.equal(count(f,'bb_purchase_intent_slots'),1);assert.equal(count(f,'bb_purchase_intent_proofs'),1);
 assert.equal(f.sql.prepare('SELECT intent_id FROM bb_purchase_intent_events').get().intent_id,intent.id);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_account_deletion_refs').get().n,0);
 f.sql.exec('DROP TRIGGER reject_intent_cleanup');await eraseAccountD1(f.env,USER,billing);
 assert.equal(count(f,'bb_purchase_intents'),0);assert.equal(count(f,'bb_purchase_intent_proofs'),0);
});

test('partial purchase-intent schema and failed inspection remain retryable without erasing billing evidence',async t=>{
 for(const kind of ['partial','columns','read']){
  const f=await fixture(t,{schema:kind!=='partial'});await barrier(f);
  f.sql.prepare('INSERT INTO bb_paid_entitlements VALUES(?)').run(USER);
  if(kind==='partial')f.sql.exec('CREATE TABLE bb_purchase_intents(id TEXT)');
  if(kind==='columns')f.sql.exec('ALTER TABLE bb_purchase_intents RENAME COLUMN deletion_ref_hash TO missing_deletion_ref');
  if(kind==='read')f.db.before=(query,args)=>{if(query.includes('sqlite_master')&&args[0]==='bb_purchase_intent_proofs')throw Error('synthetic schema inspection failure');};
  await assert.rejects(()=>eraseAccountD1(f.env,USER,billing),kind==='partial'?/purchase_intent_cleanup_unavailable/:kind==='columns'?/deletion_ref_hash/:/synthetic schema inspection failure/);
  assert.equal(count(f,'bb_paid_entitlements'),1);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_account_deletion_refs').get().n,0);
 }
});
