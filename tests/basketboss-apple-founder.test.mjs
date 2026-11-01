import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {founderAvailability,reserveAppleFounder,confirmAppleFounder,prepareAppleFounderDeletion,appleFounderEnabled,appleFounderProductId} from '../bb-server-lib/bb-apple-founder.js';
import {ensureDeletionSchema,digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';
const user=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const token=n=>`${String(n).padStart(8,'0')}-2222-4222-8222-222222222222`;
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`PRAGMA foreign_keys=ON;CREATE TABLE bb_founder_slots(slot_no INTEGER PRIMARY KEY,state TEXT,user_id TEXT,reservation_token_hash TEXT,paddle_subscription_id TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER);`);
 const insert=sql.prepare("INSERT INTO bb_founder_slots(slot_no,state,updated_at_ms) VALUES(?,'available',0)");for(let n=1;n<=25;n++)insert.run(n);
 const migration=fs.readFileSync(new URL('../sql/basketboss_apple_founder_20261101.sql',import.meta.url),'utf8');sql.exec(migration);
 function statement(query,args=[]){
  const execute=()=>{if(/^\s*SELECT\b|\bRETURNING\b/i.test(query))return {results:sql.prepare(query).all(...args),success:true};const info=sql.prepare(query).run(...args);return {success:true,results:[],meta:{changes:Number(info.changes)}};};
  return {query,args,bind:(...bound)=>statement(query,bound),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>execute(),execute};
 }
 const db={sql,prepare:statement,beforeBatch:null,async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements){db.beforeBatch?.(s.query,s.args);results.push(s.execute());}sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};return db;
}
function env(db){return {BILLING_DB:db,APPLE_BILLING_ENABLED:'true',APPLE_FOUNDER_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_SANDBOX_USER_IDS:[user(1),user(2)].join(',')};}
function occupy(db,n){for(let i=1;i<=n;i++)db.sql.prepare("UPDATE bb_founder_slots SET state='active',user_id=?,paddle_subscription_id=? WHERE slot_no=?").run('paddle-'+i,'sub_'+String(i).padStart(26,'0'),i);}
async function deletion(env,id){await ensureDeletionSchema(env);env.BILLING_DB.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(id),'retry',Date.now());}

// The production and sandbox tables are real SQLite tables; SQL guards and
// uniqueness are exercised rather than emulated in string-matching mocks.
test('disabled Founder offer does not read absent migration tables',async()=>{
 const e={APPLE_BILLING_ENABLED:'true'};assert.equal(appleFounderEnabled(e),false);assert.equal(appleFounderProductId(e),'uk.co.basketboss.premium.founder.monthly');
 assert.deepEqual(await founderAvailability(e,null,'Production'),{enabled:false,available:false,remaining:0,claimed:false,claimState:null,slot:null});
 await assert.rejects(reserveAppleFounder(e,user(1),token(1),'Production'),{code:'FOUNDER_UNAVAILABLE',status:409});
});
test('migration is additive and idempotent and never refills production places',()=>{
 const db=database();try{occupy(db,25);db.sql.exec(fs.readFileSync(new URL('../sql/basketboss_apple_founder_20261101.sql',import.meta.url),'utf8'));assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='available'").get().n,0);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_apple_founder_sandbox_slots').get().n,25);}finally{db.sql.close();}
});
test('Apple Production consumes exactly one of the same25places used by Paddle',async()=>{
 const db=database(),e=env(db);try{occupy(db,24);const first=await reserveAppleFounder(e,user(1),token(1),'Production');assert.equal(first.slot,25);const again=await reserveAppleFounder(e,user(1),token(1),'Production');assert.equal(again.claimId,first.claimId);assert.equal(again.reused,true);await assert.rejects(reserveAppleFounder(e,user(2),token(2),'Production'),{code:'FOUNDER_SOLD_OUT'});assert.equal((await founderAvailability(e,user(1),'Production')).available,true);assert.equal((await founderAvailability(e,user(2),'Production')).remaining,0);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_apple_founder_claims').get().n,1);}finally{db.sql.close();}
});
test('simultaneous Apple reservations cannot claim a twenty-sixth production place',async()=>{
 const db=database(),e=env(db);try{occupy(db,24);const results=await Promise.allSettled([reserveAppleFounder(e,user(1),token(1),'Production'),reserveAppleFounder(e,user(2),token(2),'Production')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'FOUNDER_SOLD_OUT');assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state<>'available'").get().n,25);}finally{db.sql.close();}
});
test('concurrent same-account requests reuse one reservation without leaking a second slot',async()=>{
 const db=database(),e=env(db);try{const results=await Promise.all([reserveAppleFounder(e,user(1),token(1),'Production'),reserveAppleFounder(e,user(1),token(1),'Production')]);assert.equal(results[0].claimId,results[1].claimId);assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='reserved'").get().n,1);}finally{db.sql.close();}
});
test('Paddle winning the last shared slot prevents Apple allocation',async()=>{
 const db=database(),e=env(db);try{occupy(db,24);const apple=reserveAppleFounder(e,user(1),token(1),'Production');const paddle=await db.prepare("UPDATE bb_founder_slots SET state='reserved',user_id=?,reservation_token_hash=? WHERE slot_no=(SELECT slot_no FROM bb_founder_slots WHERE state='available' ORDER BY slot_no LIMIT 1) AND state='available' RETURNING slot_no").bind(user(2),'paddle-claim').first();assert.equal(paddle.slot_no,25);await assert.rejects(apple,{code:'FOUNDER_SOLD_OUT'});assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_apple_founder_claims').get().n,0);}finally{db.sql.close();}
});
test('Apple winning the last shared slot prevents a simultaneous Paddle allocation',async()=>{
 const db=database(),e=env(db);try{occupy(db,24);await reserveAppleFounder(e,user(1),token(1),'Production');const paddle=await db.prepare("UPDATE bb_founder_slots SET state='reserved',user_id=?,reservation_token_hash=? WHERE slot_no=(SELECT slot_no FROM bb_founder_slots WHERE state='available' ORDER BY slot_no LIMIT 1) AND state='available' RETURNING slot_no").bind(user(2),'paddle-claim').first();assert.equal(paddle,null);}finally{db.sql.close();}
});
test('Sandbox has a separate25-place pool and requires an allowlisted authenticated actor',async()=>{
 const db=database(),e=env(db);try{occupy(db,25);const hold=await reserveAppleFounder(e,user(1),token(1),'Sandbox');assert.equal(hold.slot,1);assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='active'").get().n,25);assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_apple_founder_sandbox_slots WHERE state='reserved'").get().n,1);await assert.rejects(reserveAppleFounder(e,user(3),token(3),'Sandbox'),{code:'FOUNDER_SANDBOX_ACCOUNT'});await assert.rejects(confirmAppleFounder(e,user(1),token(1),'10001','Production'),{code:'FOUNDER_RESERVATION_REQUIRED'});}finally{db.sql.close();}
});
test('a pending reservation survives age and offer shutdown, and verified late confirmation consumes it once',async()=>{
 const db=database(),e=env(db);try{const hold=await reserveAppleFounder(e,user(1),token(1),'Production');db.sql.prepare('UPDATE bb_apple_founder_claims SET created_at_ms=0').run();e.APPLE_FOUNDER_ENABLED='false';const result=await confirmAppleFounder(e,user(1),token(1),'10001','Production');assert.equal(result.slot,hold.slot);assert.equal(db.sql.prepare('SELECT state FROM bb_founder_slots WHERE slot_no=?').get(hold.slot).state,'active');assert.equal((await confirmAppleFounder(e,user(1),token(1),'10001','Production')).reused,true);}finally{db.sql.close();}
});
test('different accounts/tokens cannot steal a hold or original transaction',async()=>{
 const db=database(),e=env(db);try{await reserveAppleFounder(e,user(1),token(1),'Production');await reserveAppleFounder(e,user(2),token(2),'Production');await assert.rejects(reserveAppleFounder(e,user(1),token(2),'Production'),{code:'FOUNDER_ACCOUNT_MISMATCH'});await confirmAppleFounder(e,user(1),token(1),'10001','Production');await assert.rejects(confirmAppleFounder(e,user(2),token(2),'10001','Production'),{code:'FOUNDER_TRANSACTION_OWNED'});await assert.rejects(confirmAppleFounder(e,user(1),token(2),'10001','Production'),{code:'FOUNDER_ACCOUNT_MISMATCH'});assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='active'").get().n,1);}finally{db.sql.close();}
});
test('verified later original transactions for the same Founder use the same place, preserving all ownership links',async()=>{
 const db=database(),e=env(db);try{const hold=await reserveAppleFounder(e,user(1),token(1),'Production');await confirmAppleFounder(e,user(1),token(1),'10001','Production');const later=await confirmAppleFounder(e,user(1),token(1),'10002','Production');assert.equal(later.slot,hold.slot);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_apple_founder_transactions').get().n,2);assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='active'").get().n,1);await reserveAppleFounder(e,user(2),token(2),'Production');await assert.rejects(confirmAppleFounder(e,user(2),token(2),'10002','Production'),{code:'FOUNDER_TRANSACTION_OWNED'});}finally{db.sql.close();}
});
test('unreserved receipts never allocate a Founder place',async()=>{
 const db=database(),e=env(db);try{await assert.rejects(confirmAppleFounder(e,user(1),token(1),'10001','Production'),{code:'FOUNDER_RESERVATION_REQUIRED'});assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='available'").get().n,25);}finally{db.sql.close();}
});
test('a slot reservation rolls back atomically if a duplicate account-token insert fails',async()=>{
 const db=database(),e=env(db);try{await reserveAppleFounder(e,user(1),token(1),'Production');await assert.rejects(reserveAppleFounder(e,user(2),token(1),'Production'),{code:'FOUNDER_DATABASE'});assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='reserved'").get().n,1);}finally{db.sql.close();}
});
test('account deletion suppresses reservation, confirmation and later restoration',async()=>{
 const db=database(),e=env(db);try{await reserveAppleFounder(e,user(1),token(1),'Production');await deletion(e,user(1));await assert.rejects(reserveAppleFounder(e,user(1),token(1),'Production'),{code:'ACCOUNT_DELETING'});await assert.rejects(confirmAppleFounder(e,user(1),token(1),'10001','Production'),{code:'ACCOUNT_DELETING'});}finally{db.sql.close();}
});
test('Founder deletion retires ambiguous and confirmed places before ordinary cleanup can resell them',async()=>{
 const db=database(),e=env(db);try{const a=await reserveAppleFounder(e,user(1),token(1),'Production');const b=await reserveAppleFounder(e,user(2),token(2),'Production');await confirmAppleFounder(e,user(2),token(2),'10002','Production');for(const id of [user(1),user(2)]){await db.batch(await prepareAppleFounderDeletion(e,id));await db.prepare("UPDATE bb_founder_slots SET state=CASE WHEN state='reserved' AND paddle_subscription_id IS NULL THEN 'available' ELSE 'retired' END,user_id=NULL,reservation_token_hash=NULL WHERE user_id=?").bind(id).run();}assert.equal(db.sql.prepare('SELECT state FROM bb_founder_slots WHERE slot_no=?').get(a.slot).state,'retired');assert.equal(db.sql.prepare('SELECT state FROM bb_founder_slots WHERE slot_no=?').get(b.slot).state,'retired');assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_apple_founder_claims').get().n,0);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_apple_founder_transactions').get().n,0);assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='available'").get().n,23);}finally{db.sql.close();}
});
test('malformed environment, account, token, transaction and product input fail closed',async()=>{
 const db=database(),e=env(db);try{assert.throws(()=>appleFounderProductId({...e,APPLE_FOUNDER_PRODUCT_ID:'elsewhere.product'}),{code:'FOUNDER_CONFIGURATION'});await assert.rejects(reserveAppleFounder(e,user(1),token(1),'Xcode'),{code:'FOUNDER_ENVIRONMENT'});await assert.rejects(reserveAppleFounder(e,'user',token(1),'Production'),{code:'FOUNDER_ACCOUNT'});await assert.rejects(reserveAppleFounder(e,user(1),'token','Production'),{code:'FOUNDER_TOKEN'});await assert.rejects(confirmAppleFounder(e,user(1),token(1),'arbitrary-id','Production'),{code:'FOUNDER_TRANSACTION'});}finally{db.sql.close();}
});
