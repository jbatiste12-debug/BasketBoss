import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequestPost as checkout} from '../functions/api/subscription/checkout.js';
import {onRequestPost as webhook} from '../functions/api/paddle/webhook.js';
import {ensureDeletionSchema,digestDeletionActor,digestDeletionRef} from '../bb-server-lib/bb-account-deletion.js';

const USER='11111111-1111-4111-8111-111111111111';
const CLAIM='22222222-2222-4222-8222-222222222222';
const id=(prefix,char)=>prefix+'_'+char.repeat(26);
const TX=id('txn','t'),SUB=id('sub','s'),CUSTOMER=id('ctm','c'),PRICE=id('pri','p');

function database(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE bb_paid_entitlements(paddle_subscription_id TEXT PRIMARY KEY,user_id TEXT,paddle_customer_id TEXT,
      claim_id TEXT,price_id TEXT,plan TEXT,status TEXT,trial_ends_at TEXT,current_period_ends_at TEXT,
      cancellation_effective_at TEXT,cancel_at_period_end INTEGER,last_occurred_at TEXT,updated_at_ms INTEGER);
    CREATE TABLE bb_billing_claims(claim_id TEXT PRIMARY KEY,user_id TEXT,plan TEXT,price_id TEXT,slot_no INTEGER,
      claim_state TEXT DEFAULT 'pending',transaction_id TEXT,created_at_ms INTEGER);
    CREATE TABLE bb_founder_slots(slot_no INTEGER PRIMARY KEY,state TEXT,user_id TEXT,reservation_token_hash TEXT,
      paddle_subscription_id TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER);
    CREATE TABLE bb_paddle_event_inbox(event_id TEXT PRIMARY KEY,processed INTEGER,received_at_ms INTEGER,locked_until_ms INTEGER DEFAULT 0);
  `);
  const db={sql,before:null,prepare(query){return {bind(...args){return {
    first:async()=>{db.before?.(query,args);return sql.prepare(query).get(...args)||null;},
    all:async()=>{db.before?.(query,args);return {results:sql.prepare(query).all(...args)};},
    run:async()=>{db.before?.(query,args);const info=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(info.changes)}};}
  };},
    run:async()=>{db.before?.(query,[]);sql.exec(query);return {success:true};}
  };},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return db;
}
const env=db=>({BILLING_DB:db,BB_BILLING_MODE:'sandbox',BB_BILLING_ENABLED:'true',
  PADDLE_SANDBOX_API_KEY:'fake',PADDLE_SANDBOX_WEBHOOK_SECRET:'fake-signature-secret',
  PADDLE_SANDBOX_STANDARD_PRICE_ID:PRICE,SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fake'});
const checkoutRequest=(plan='standard',origin='https://basketboss.co.uk')=>new Request('https://basketboss.co.uk/api/subscription/checkout',{
  method:'POST',headers:{Origin:origin,Authorization:'Bearer fake','Content-Type':'application/json'},body:JSON.stringify({plan})});
async function markDeleting(db){
  const hash=await digestDeletionActor(USER);
  db.sql.prepare('INSERT OR IGNORE INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(hash,'fake-retry',Date.now());
  return hash;
}
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const authResponse=()=>response({id:USER,email:'test@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'});
async function signedEvent(){
  const raw=JSON.stringify({event_id:id('evt','e'),event_type:'subscription.created',occurred_at:'2026-10-31T20:00:00Z',
    data:{id:SUB,customer_id:CUSTOMER,status:'active',transaction_id:TX,custom_data:{bb_claim_id:CLAIM},
      items:[{quantity:1,price:{id:PRICE}}]}});
  const ts=String(Math.floor(Date.now()/1000));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('fake-signature-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+':'+raw));
  const hex=[...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join('');
  return new Request('https://basketboss.co.uk/api/paddle/webhook',{method:'POST',headers:{'Paddle-Signature':`ts=${ts};h1=${hex}`},body:raw});
}

test('a deleting account cannot create a web checkout',async()=>{
  const db=database(),e=env(db),original=globalThis.fetch;let remote=0;
  try{
    await ensureDeletionSchema(e);await markDeleting(db);
    globalThis.fetch=async url=>{if(String(url).endsWith('/auth/v1/user'))return authResponse();remote++;throw Error('unexpected payment call');};
    assert.equal((await checkout({request:checkoutRequest(),env:e})).status,409);
    assert.equal(remote,0);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_billing_claims').get().n,0);
  }finally{globalThis.fetch=original;db.sql.close();}
});

test('native iOS checkout is rejected by the server before authentication or payment calls',async()=>{
  const db=database(),original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>{throw Error('native checkout must not contact providers');};
    const r=await checkout({request:checkoutRequest('standard','capacitor://localhost'),env:env(db)});
    assert.equal(r.status,403);assert.match((await r.json()).error,/iOS app/);
  }finally{globalThis.fetch=original;db.sql.close();}
});

test('checkout claim creation is gated in SQL when deletion races the earlier check',async()=>{
  const db=database(),e=env(db),original=globalThis.fetch;let remote=0;
  try{
    await ensureDeletionSchema(e);const hash=await digestDeletionActor(USER);
    db.before=query=>{if(query.includes('INSERT INTO bb_billing_claims')){
      db.before=null;db.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(hash,'fake-retry',Date.now());
    }};
    globalThis.fetch=async url=>{if(String(url).endsWith('/auth/v1/user'))return authResponse();remote++;throw Error('unexpected payment call');};
    assert.equal((await checkout({request:checkoutRequest(),env:e})).status,409);
    assert.equal(remote,0);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_billing_claims').get().n,0);
  }finally{globalThis.fetch=original;db.sql.close();}
});

test('Founder reservation cannot recreate a user link after deletion starts',async()=>{
  const db=database(),e={...env(db),PADDLE_SANDBOX_FOUNDER_PRICE_ID:id('pri','f')},original=globalThis.fetch;
  try{
    await ensureDeletionSchema(e);const hash=await digestDeletionActor(USER);
    db.sql.prepare("INSERT INTO bb_founder_slots(slot_no,state) VALUES(1,'available')").run();
    db.before=query=>{if(query.includes("SET state='reserved'")){
      db.before=null;db.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(hash,'fake-retry',Date.now());
    }};
    globalThis.fetch=async url=>{if(String(url).endsWith('/auth/v1/user'))return authResponse();throw Error('unexpected payment call');};
    assert.equal((await checkout({request:checkoutRequest('founder'),env:e})).status,409);
    const slot=db.sql.prepare('SELECT state,user_id FROM bb_founder_slots').get();
    assert.equal(slot.state,'available');assert.equal(slot.user_id,null);
    assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_billing_claims').get().n,0);
  }finally{globalThis.fetch=original;db.sql.close();}
});

test('in-flight checkout retains its remote transaction for deletion and never returns it to the browser',async()=>{
  const db=database(),e=env(db),original=globalThis.fetch;const calls=[];
  try{
    await ensureDeletionSchema(e);let claim;
    globalThis.fetch=async (url,options)=>{
      if(String(url).endsWith('/auth/v1/user'))return authResponse();
      calls.push(options.method);
      if(options.method==='POST'){claim=JSON.parse(options.body).custom_data.bb_claim_id;await markDeleting(db);return response({data:{id:TX}});}
      return response({data:{id:TX,status:options.method==='PATCH'?'canceled':'ready',custom_data:{bb_claim_id:claim}}});
    };
    const r=await checkout({request:checkoutRequest(),env:e}),body=await r.json();
    assert.equal(r.status,409);assert.equal(body.transactionId,undefined);assert.deepEqual(calls,['POST','GET','PATCH']);
    const linked=db.sql.prepare('SELECT transaction_id,claim_state FROM bb_billing_claims').get();
    assert.equal(linked.transaction_id,TX);assert.equal(linked.claim_state,'checkout_created');
  }finally{globalThis.fetch=original;db.sql.close();}
});

test('signed webhook replay for a deleted claim is acknowledged without recreating an entitlement',async()=>{
  const db=database(),e=env(db);
  try{
    await ensureDeletionSchema(e);
    db.sql.prepare('INSERT INTO bb_account_deletion_refs(ref_hash) VALUES(?)').run(await digestDeletionRef('claim',CLAIM));
    const r=await webhook({request:await signedEvent(),env:e});
    assert.equal(r.status,200);assert.equal((await r.json()).ignored,true);
    assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_paid_entitlements').get().n,0);
  }finally{db.sql.close();}
});

test('deletion between webhook linkage verification and insertion blocks the insert atomically',async()=>{
  const db=database(),e=env(db);
  try{
    await ensureDeletionSchema(e);const hash=await digestDeletionActor(USER);
    db.sql.prepare("INSERT INTO bb_billing_claims(claim_id,user_id,plan,price_id,claim_state,transaction_id,created_at_ms) VALUES(?,?,'standard',?,'checkout_created',?,?)").run(CLAIM,USER,PRICE,TX,Date.now());
    db.before=query=>{if(query.includes('INSERT INTO bb_paid_entitlements')){
      db.before=null;db.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(hash,'fake-retry',Date.now());
    }};
    assert.equal((await webhook({request:await signedEvent(),env:e})).status,200);
    assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_paid_entitlements').get().n,0);
    assert.equal(db.sql.prepare('SELECT claim_state FROM bb_billing_claims').get().claim_state,'checkout_created');
  }finally{db.sql.close();}
});
