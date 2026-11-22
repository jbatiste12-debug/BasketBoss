import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {onRequestPost as checkout} from '../functions/api/subscription/checkout.js';
import {onRequestPost as webhook} from '../functions/api/paddle/webhook.js';
import {ensureDeletionSchema} from '../bb-server-lib/bb-account-deletion.js';
import {purchaseIntentActor,reservePurchaseIntent,startPurchaseIntent} from '../bb-server-lib/bb-purchase-intents.js';
const USER='11111111-1111-4111-8111-111111111111',SESSION='33333333-3333-4333-8333-333333333333';
const id=(prefix,c)=>prefix+'_'+c.repeat(26),PRICE=id('pri','p'),TX=id('txn','t'),SUB=id('sub','s'),CUSTOMER=id('ctm','c');
const jwt=[Buffer.from('{"alg":"ES256"}').toString('base64url'),Buffer.from(JSON.stringify({iss:'https://fixture.supabase.co/auth/v1',sub:USER,session_id:SESSION,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'syntheticSignature'].join('.');
const request=()=>new Request('https://basketboss.co.uk/api/subscription/checkout',{method:'POST',headers:{Origin:'https://basketboss.co.uk',Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({plan:'standard'})});
async function fixture(t,{enabled=true,create='success'}={}){
 const sql=new DatabaseSync(':memory:');sql.exec(`
 CREATE TABLE bb_paid_entitlements(paddle_subscription_id TEXT PRIMARY KEY,user_id TEXT,paddle_customer_id TEXT,claim_id TEXT,price_id TEXT,plan TEXT,status TEXT,trial_ends_at TEXT,current_period_ends_at TEXT,cancellation_effective_at TEXT,cancel_at_period_end INTEGER,last_occurred_at TEXT,updated_at_ms INTEGER);
 CREATE TABLE bb_billing_claims(claim_id TEXT PRIMARY KEY,user_id TEXT,plan TEXT,price_id TEXT,slot_no INTEGER,claim_state TEXT DEFAULT 'pending',transaction_id TEXT,created_at_ms INTEGER);
 CREATE TABLE bb_founder_slots(slot_no INTEGER PRIMARY KEY,state TEXT,user_id TEXT,reservation_token_hash TEXT,paddle_subscription_id TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER);
 CREATE TABLE bb_paddle_event_inbox(event_id TEXT PRIMARY KEY,processed INTEGER,received_at_ms INTEGER,locked_until_ms INTEGER DEFAULT 0);`);
 let queue=Promise.resolve();const db={sql,before:null,prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){db.before?.(query,args);return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const stmt=sql.prepare(query);if(stmt.columns().length)return {success:true,results:stmt.all(...args)};const info=stmt.run(...args);return {success:true,meta:{changes:Number(info.changes)}};}};},batch(list){const work=queue.then(async()=>{sql.exec('BEGIN');try{const out=[];for(const statement of list)out.push(await statement.run());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}});queue=work.catch(()=>{});return work;}};
 const env={BILLING_DB:db,BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'sandbox',PADDLE_SANDBOX_API_KEY:'synthetic',PADDLE_SANDBOX_STANDARD_PRICE_ID:PRICE,PADDLE_SANDBOX_WEBHOOK_SECRET:'synthetic-signature',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic',BB_PURCHASE_INTENTS_ENABLED:String(enabled),BB_PURCHASE_INTENTS_STRICT:'true'};
 await ensureDeletionSchema(env);sql.exec(readFileSync(new URL('../sql/basketboss_purchase_intents_20261121.sql',import.meta.url),'utf8'));
 const calls=[];let metadata=null,transactionPatch={};
 const transaction=()=>({id:TX,status:'completed',collection_mode:'automatic',customer_id:CUSTOMER,subscription_id:SUB,custom_data:metadata,items:[{quantity:1,price:{id:PRICE}}],...transactionPatch});
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  if(String(url).endsWith('/auth/v1/user'))return Response.json({id:USER,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01'});
  calls.push({url:String(url),method:options.method});
  if(String(url)==='https://sandbox-api.paddle.com/transactions'&&options.method==='POST'){
   metadata=JSON.parse(options.body).custom_data;
   if(create==='timeout')throw Object.assign(Error('synthetic transport failure'),{name:'TimeoutError'});
   if(create==='reject')return Response.json({error:{code:'invalid_field',detail:'Synthetic rejected request'}},{status:400});
   return Response.json({data:{id:TX}});
  }
  if(String(url)==='https://sandbox-api.paddle.com/transactions/'+TX)return Response.json({data:transaction()});
  throw Error('Unexpected provider request');
 });t.mock.method(console,'error',()=>{});t.after(()=>sql.close());
 async function signed(){const raw=JSON.stringify({event_id:id('evt','e'),event_type:'subscription.created',occurred_at:'2026-11-21T18:00:00Z',data:{id:SUB,customer_id:CUSTOMER,status:'trialing',transaction_id:TX,custom_data:metadata,items:[{quantity:1,price:{id:PRICE}}],next_billed_at:'2026-11-28T18:00:00Z',current_billing_period:{ends_at:'2026-11-28T18:00:00Z'}}});
  const ts=String(Math.floor(Date.now()/1000)),key=await crypto.subtle.importKey('raw',new TextEncoder().encode('synthetic-signature'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+':'+raw))).toString('hex');
  return new Request('https://basketboss.co.uk/api/paddle/webhook',{method:'POST',headers:{'Paddle-Signature':`ts=${ts};h1=${sig}`},body:raw});}
 return {sql,db,env,calls,signed,patchTransaction:value=>{transactionPatch=value;},metadata:()=>metadata,attempt:()=>checkout({request:request(),env}),intent:()=>sql.prepare('SELECT * FROM bb_purchase_intents').get(),slot:()=>sql.prepare('SELECT * FROM bb_purchase_intent_slots WHERE user_id=?').get(USER)};
}
test('default-off preserves successful Paddle checkout contract and unknown claims never create a second transaction',async t=>{
 const f=await fixture(t,{enabled:false});assert.equal((await f.attempt()).status,200);assert.equal(f.metadata().bb_purchase_intent_id,undefined);assert.equal(f.intent(),undefined);
 f.sql.prepare("UPDATE bb_billing_claims SET claim_state='pending',transaction_id=NULL,created_at_ms=1").run();
 const response=await f.attempt();assert.equal(response.status,409);assert.equal((await response.json()).code,'paddle_checkout_unknown');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('server-started Paddle checkout binds known transaction; verified trial proof completes it atomically',async t=>{
 const f=await fixture(t);const response=await f.attempt();assert.equal(response.status,200);assert.equal((await response.json()).transactionId,TX);assert.equal(f.intent().phase,'started');assert.ok(f.intent().reference_hash);assert.equal(f.metadata().bb_purchase_intent_id,f.intent().id);
 const received=await webhook({request:await f.signed(),env:f.env});assert.equal(received.status,200);assert.equal(f.intent().phase,'completed');assert.equal(f.slot().active_intent_id,null);assert.equal(f.sql.prepare('SELECT status FROM bb_paid_entitlements').get().status,'trialing');
});
test('ambiguous creation stays unknown without rePOST and recovers only from signed plus authoritative transaction proof',async t=>{
 const f=await fixture(t,{create:'timeout'});assert.equal((await f.attempt()).status,502);assert.equal(f.intent().phase,'unknown');assert.equal(f.intent().reference_hash,null);
 f.sql.prepare('UPDATE bb_billing_claims SET created_at_ms=1').run();assert.equal((await f.attempt()).status,409);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 const received=await webhook({request:await f.signed(),env:f.env});assert.equal(received.status,200);assert.equal(f.calls.filter(c=>c.method==='GET').length,1);assert.equal(f.intent().phase,'completed');assert.equal(f.slot().active_intent_id,null);assert.equal(f.sql.prepare('SELECT transaction_id,claim_state FROM bb_billing_claims').get().transaction_id,TX);
});
test('definite Paddle creation rejection cancels only the uncreated intent and removes its pending claim',async t=>{
 const f=await fixture(t,{create:'reject'});assert.equal((await f.attempt()).status,502);assert.equal(f.intent().phase,'canceled');assert.equal(f.slot().active_intent_id,null);assert.equal(f.sql.prepare('SELECT count(*) n FROM bb_billing_claims').get().n,0);
});
test('another started provider stops Paddle before a new claim or provider request',async t=>{
 const f=await fixture(t),actor=await purchaseIntentActor(request(),f.env);await startPurchaseIntent(f.env,actor,await reservePurchaseIntent(f.env,actor,{provider:'apple',mode:'test',productId:'uk.co.basketboss.premium.monthly',protocol:1}));
 const response=await f.attempt();assert.equal(response.status,409);assert.equal((await response.json()).code,'purchase_intent_busy');assert.equal(f.calls.length,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM bb_billing_claims').get().n,0);
});
test('coordination persistence failure rolls back a verified entitlement and never unlocks another purchase',async t=>{
 const f=await fixture(t);assert.equal((await f.attempt()).status,200);f.sql.exec("CREATE TRIGGER refuse_proof BEFORE INSERT ON bb_purchase_intent_proofs BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 const response=await webhook({request:await f.signed(),env:f.env});assert.equal(response.status,503);assert.equal(f.sql.prepare('SELECT count(*) n FROM bb_paid_entitlements').get().n,0);assert.equal(f.intent().phase,'started');assert.equal(f.slot().active_intent_id,f.intent().id);
});

test('a signed recovery trigger cannot bypass authoritative transaction account, plan and subscription binding',async t=>{
 const f=await fixture(t,{create:'timeout'});assert.equal((await f.attempt()).status,502);f.patchTransaction({subscription_id:id('sub','x')});
 const received=await webhook({request:await f.signed(),env:f.env});assert.equal(received.status,422);assert.equal(f.intent().phase,'unknown');assert.equal(f.sql.prepare('SELECT transaction_id FROM bb_billing_claims').get().transaction_id,null);assert.equal(f.sql.prepare('SELECT count(*) n FROM bb_paid_entitlements').get().n,0);
});
test('unknown creation remains recoverable after atomic proof persistence fails and its claim was linked',async t=>{
 const f=await fixture(t,{create:'timeout'});assert.equal((await f.attempt()).status,502);f.sql.exec("CREATE TRIGGER refuse_proof BEFORE INSERT ON bb_purchase_intent_proofs BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.equal((await webhook({request:await f.signed(),env:f.env})).status,503);assert.equal(f.intent().phase,'unknown');assert.equal(f.sql.prepare('SELECT transaction_id FROM bb_billing_claims').get().transaction_id,TX);
 f.sql.exec('DROP TRIGGER refuse_proof; UPDATE bb_paddle_event_inbox SET locked_until_ms=0');
 assert.equal((await webhook({request:await f.signed(),env:f.env})).status,200);assert.equal(f.intent().phase,'completed');assert.equal(f.slot().active_intent_id,null);assert.equal(f.sql.prepare('SELECT status FROM bb_paid_entitlements').get().status,'trialing');
});

test('fresh entitlement checks occur inside the reserved revision and a concurrent proof stops the Paddle POST',async t=>{
 const f=await fixture(t);let checked=false;
 f.db.before=query=>{if(query.includes("SELECT 1 AS found FROM bb_paid_entitlements")){
  checked=true;assert.equal(f.intent().phase,'prepared');
  f.sql.prepare('UPDATE bb_purchase_intent_slots SET billing_revision=billing_revision+1 WHERE user_id=?').run(USER);f.db.before=null;
 }};
 const response=await f.attempt();assert.equal(response.status,409);assert.equal((await response.json()).code,'purchase_intent_changed');assert.equal(checked,true);assert.equal(f.calls.length,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM bb_billing_claims').get().n,0);assert.equal(f.intent().phase,'canceled');assert.equal(f.slot().active_intent_id,null);
});
test('an existing paid membership rejects checkout and releases only this unstarted reservation',async t=>{
 const f=await fixture(t);f.sql.prepare('INSERT INTO bb_paid_entitlements(paddle_subscription_id,user_id,price_id,plan,status) VALUES(?,?,?,?,?)').run(SUB,USER,PRICE,'standard','active');
 assert.equal((await f.attempt()).status,409);assert.equal(f.calls.length,0);assert.equal(f.intent().phase,'canceled');assert.equal(f.slot().active_intent_id,null);assert.equal(f.sql.prepare('SELECT count(*) n FROM bb_billing_claims').get().n,0);
});
test('Beta and provider rejection release their own prepared reservation without starting Paddle',async t=>{
 const f=await fixture(t);f.sql.exec('CREATE TABLE bb_testflight_beta_grants(proof_hash TEXT,user_id TEXT,started_at_ms INTEGER,expires_at_ms INTEGER,application_version TEXT,revoked_at_ms INTEGER)');
 f.sql.prepare('INSERT INTO bb_testflight_beta_grants VALUES(?,?,?,?,?,NULL)').run('synthetic',USER,Date.now()-1000,Date.now()+3600000,'1.0.6');
 const beta=await f.attempt();assert.equal(beta.status,409);assert.equal((await beta.json()).provider,'testflight_beta');assert.equal(f.intent().phase,'canceled');assert.equal(f.slot().active_intent_id,null);assert.equal(f.calls.length,0);
 f.sql.exec('DELETE FROM bb_testflight_beta_grants');f.env.APPLE_BILLING_ENABLED='true';
 assert.equal((await f.attempt()).status,503);assert.equal(f.sql.prepare("SELECT count(*) n FROM bb_purchase_intents WHERE phase='prepared'").get().n,0);assert.equal(f.slot().active_intent_id,null);assert.equal(f.calls.length,0);
});
