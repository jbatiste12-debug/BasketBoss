import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequestGet,onRequestPost} from '../functions/api/account/delete.js';
import {digestDeletionActor,digestDeletionRef,digestDeletionRetry,ensureDeletionSchema} from '../bb-server-lib/bb-account-deletion.js';

const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const EMAIL='delete-me@example.invalid',TOKEN='Bearer synthetic-original-session',PASSWORD='synthetic current password';
const id=(prefix,char)=>prefix+'_'+char.repeat(26);
const SUB=id('sub','s'),OTHER_SUB=id('sub','o'),TX=id('txn','t'),CLAIM='33333333-3333-4333-8333-333333333333';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

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
  CREATE TABLE bb_ai_daily_usage(day_utc TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,
   used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),PRIMARY KEY(day_utc,actor,action));
  CREATE TABLE bb_private_premium_recipes_500_v1(recipe_id TEXT PRIMARY KEY,sort_index INTEGER,recipe_json TEXT,normalized_json TEXT);
 `);
 const db={sql,prepare(query){
  const statement=(args=[])=>({
   bind(...values){return statement(values);},
   async first(){return sql.prepare(query).get(...args)||null;},
   async all(){return {results:sql.prepare(query).all(...args)};},
   async run(){const info=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(info.changes)}};}
  });
  return statement();
 },async batch(statements){
  sql.exec('BEGIN');
  try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}
  catch(error){sql.exec('ROLLBACK');throw error;}
 }};
 sql.prepare('INSERT INTO bb_paid_entitlements(paddle_subscription_id,user_id,status) VALUES(?,?,?)').run(OTHER_SUB,OTHER,'active');
 sql.prepare('INSERT INTO bb_founder_slots VALUES(?,?,?,?,?,?,?)').run(1,'reserved',USER,'private-reservation',null,Date.now()+60000,Date.now());
 sql.prepare('INSERT INTO bb_founder_slots VALUES(?,?,?,?,?,?,?)').run(2,'consumed',OTHER,'other-reservation',OTHER_SUB,null,Date.now());
 for(const [actor,action] of [['user:'+USER,'receiptScan'],['user:'+USER,'mealIdea'],['user:'+OTHER,'receiptScan'],['global','all']]){
  sql.prepare('INSERT INTO bb_ai_daily_usage VALUES(?,?,?,?)').run('2026-10-31',actor,action,2);
 }
 sql.prepare('INSERT INTO bb_private_premium_recipes_500_v1 VALUES(?,?,?,?)').run('recipe-101',101,'{"name":"Preserved recipe"}','{}');
 return db;
}

function fixture(t){
 const db=database();
 const env={BILLING_DB:db,SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',
  SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(40),BB_BILLING_MODE:'sandbox',BB_BILLING_ENABLED:'true',PADDLE_SANDBOX_API_KEY:'synthetic-paddle-key'};
 const f={db,env,calls:[],ready:true,passwordAccepted:true,knownActor:true,authDeleted:false,loseRpcResponse:false,
  cancelFails:false,readyThrows:false,passwordUnavailable:false,cloudFails:false,deleteCalls:0,users:new Set([USER,OTHER]),plans:new Map([[USER,['my plan']],[OTHER,['their plan']]]),
  subscriptions:new Map([[SUB,'active'],[OTHER_SUB,'active']]),transactions:new Map()};
 t.after(()=>db.sql.close());
 t.mock.method(console,'warn',()=>{});
 t.mock.method(globalThis,'fetch',async(input,options={})=>{
  const url=new URL(String(input)),method=options.method||'GET';
  const body=options.body?JSON.parse(options.body):null;
  f.calls.push({url:url.href,path:url.pathname,method,body,headers:new Headers(options.headers)});
  if(url.origin===env.SUPABASE_URL){
   if(url.pathname==='/auth/v1/user')return f.knownActor&&!f.authDeleted?json({id:USER,email:EMAIL,email_confirmed_at:'2026-10-01T00:00:00Z'}):json({error:'Unknown session'},401);
   if(url.pathname==='/auth/v1/token'){
    assert.equal(url.search,'?grant_type=password');
    if(f.passwordUnavailable)return json({error:'synthetic-private-auth-provider-body'},503);
    assert.deepEqual(body,{email:EMAIL,password:PASSWORD});
    return f.passwordAccepted?json({user:{id:USER,email:EMAIL,email_confirmed_at:'2026-10-01T00:00:00Z'}}):json({error:'Invalid credentials'},400);
   }
   if(url.pathname==='/rest/v1/rpc/bb_account_deletion_ready'){if(f.readyThrows)throw Error('synthetic-private-readiness-body');return json({ready:f.ready,version:1});}
   if(url.pathname==='/rest/v1/rpc/bb_account_delete_data'){
    f.deleteCalls++;
    if(f.cloudFails)return json({error:'synthetic-private-cloud-body'},503);
    assert.deepEqual(body,{p_user:USER,p_email:EMAIL});
    f.users.delete(USER);f.plans.delete(USER);f.authDeleted=true;
    if(f.loseRpcResponse){f.loseRpcResponse=false;throw new TypeError('Synthetic response lost after database commit');}
    return json({deleted:true,version:1});
   }
  }
  if(url.origin==='https://sandbox-api.paddle.com'){
   const subscription=url.pathname.match(/^\/subscriptions\/(sub_[a-z0-9]{26})(\/cancel)?$/);
   if(subscription){
    const key=subscription[1];
    if(subscription[2]){
     assert.equal(method,'POST');assert.deepEqual(body,{effective_from:'immediately'});
     if(f.cancelFails)return json({error:'Synthetic provider outage'},503);
     f.subscriptions.set(key,'canceled');
    }
    return json({data:{id:key,status:f.subscriptions.get(key)}});
   }
   const transaction=url.pathname.match(/^\/transactions\/(txn_[a-z0-9]{26})$/);
   if(transaction&&f.transactions.has(transaction[1])){
    const row=f.transactions.get(transaction[1]);
    if(method==='PATCH'){assert.deepEqual(body,{status:'canceled'});row.status='canceled';}
    return json({data:{id:transaction[1],...row}});
   }
  }
  assert.fail('Unexpected synthetic fetch: '+method+' '+url.href);
 });
 return f;
}

function request({origin='https://basketboss.co.uk',token=TOKEN,body={confirmation:'DELETE',password:PASSWORD},headers={}}={}){
 return new Request('https://basketboss.co.uk/api/account/delete',{method:'POST',
  headers:{Origin:origin,Authorization:token,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
}
const remove=(f,options)=>onRequestPost({request:request(options),env:f.env});
const rows=(f,table)=>f.db.sql.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}));
const savedRows=f=>Object.fromEntries(['bb_paid_entitlements','bb_founder_slots','bb_billing_claims','bb_ai_daily_usage','bb_private_premium_recipes_500_v1'].map(table=>[table,rows(f,table)]));
function activeSubscription(f){
 f.db.sql.prepare('INSERT INTO bb_paid_entitlements(paddle_subscription_id,user_id,status,plan) VALUES(?,?,?,?)').run(SUB,USER,'active','founder');
 f.db.sql.prepare("UPDATE bb_founder_slots SET state='consumed',paddle_subscription_id=? WHERE user_id=?").run(SUB,USER);
}
function assertNoRemoteDeletion(f){
 assert.equal(f.deleteCalls,0);assert.equal(f.authDeleted,false);
 assert.equal(f.calls.filter(call=>call.url.startsWith('https://sandbox-api.paddle.com')).length,0);
 assert.deepEqual([...f.users],[USER,OTHER]);assert.ok(f.plans.has(USER));
}

for(const [name,options,configure,status] of [
 ['cross-origin request',{origin:'https://untrusted.example'},()=>{},403],
 ['cross-site request',{headers:{'Sec-Fetch-Site':'cross-site'}},()=>{},403],
 ['unknown actor',{},f=>{f.knownActor=false;},401],
 ['wrong current password',{},f=>{f.passwordAccepted=false;},403],
 ['caller-supplied account identifier',{body:{confirmation:'DELETE',password:PASSWORD,user_id:OTHER}},()=>{},400],
 ['missing explicit confirmation',{body:{confirmation:'YES',password:PASSWORD}},()=>{},400],
 ['missing bearer',{token:''},()=>{},401],
 ['migration not ready',{},f=>{f.ready=false;},503]
])test(name+' cannot delete or cancel any data',async t=>{
 const f=fixture(t),before=savedRows(f);configure(f);
 const response=await remove(f,options);
 assert.equal(response.status,status);assert.equal((await response.json()).ok,false);
 assert.deepEqual(savedRows(f),before);assertNoRemoteDeletion(f);
 const journals=f.db.sql.prepare("SELECT name FROM sqlite_master WHERE name='bb_account_deletions'").get();
 if(journals)assert.equal(rows(f,'bb_account_deletions').length,0);
});

test('readiness is public and does not mutate account data',async t=>{
 const f=fixture(t),before=savedRows(f);
 const response=await onRequestGet({env:f.env});
 assert.deepEqual(await response.json(),{ok:true,available:true,migrationReady:true});
 assert.deepEqual(savedRows(f),before);assertNoRemoteDeletion(f);
 assert.deepEqual(f.calls.map(call=>call.path),['/rest/v1/rpc/bb_account_deletion_ready']);
});

test('free account deletion removes own records, preserves others/catalogue and keeps only hashed retry state',async t=>{
 const f=fixture(t),before=savedRows(f);
 const response=await remove(f);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,deleted:true});
 assert.equal(f.deleteCalls,1);assert.equal(f.authDeleted,true);
 assert.deepEqual([...f.users],[OTHER]);assert.deepEqual([...f.plans],[[OTHER,['their plan']]]);
 assert.deepEqual(rows(f,'bb_paid_entitlements'),before.bb_paid_entitlements);
 assert.deepEqual(rows(f,'bb_private_premium_recipes_500_v1'),before.bb_private_premium_recipes_500_v1);
 assert.deepEqual(rows(f,'bb_ai_daily_usage'),before.bb_ai_daily_usage.filter(row=>row.actor!=='user:'+USER));
 const slots=rows(f,'bb_founder_slots');assert.deepEqual(slots[1],before.bb_founder_slots[1]);
 assert.equal(slots[0].state,'available');
 for(const key of ['user_id','reservation_token_hash','paddle_subscription_id','reservation_expires_at_ms'])assert.equal(slots[0][key],null);
 const journal=rows(f,'bb_account_deletions');assert.equal(journal.length,1);
 assert.equal(journal[0].actor_hash,await digestDeletionActor(USER));
 assert.equal(journal[0].retry_hash,await digestDeletionRetry(TOKEN));
 assert.equal(journal[0].user_id,null);assert.equal(journal[0].email,null);
 assert.ok(journal[0].completed_at_ms>0);assert.equal(journal[0].locked_until_ms,0);
 const serialized=JSON.stringify(journal);
 for(const privateValue of [USER,EMAIL,PASSWORD,TOKEN])assert.ok(!serialized.includes(privateValue));
 assert.equal(f.calls.filter(call=>call.url.startsWith('https://sandbox-api.paddle.com')).length,0);
});

test('active paid deletion immediately cancels billing, retires the consumed founder slot and hashes late-event references',async t=>{
 const f=fixture(t);activeSubscription(f);
 f.db.sql.prepare('INSERT INTO bb_billing_claims(claim_id,user_id,claim_state,transaction_id) VALUES(?,?,?,?)').run(CLAIM,USER,'subscription_linked',TX);
 f.transactions.set(TX,{status:'completed',subscription_id:SUB,custom_data:{bb_claim_id:CLAIM}});
 const response=await remove(f);
 assert.equal(response.status,200);assert.equal((await response.json()).deleted,true);
 assert.deepEqual(f.calls.filter(call=>call.url.startsWith('https://sandbox-api.paddle.com')).map(call=>[call.method,call.path]),[
  ['GET','/transactions/'+TX],['GET','/subscriptions/'+SUB],['POST','/subscriptions/'+SUB+'/cancel']
 ]);
 assert.equal(f.subscriptions.get(SUB),'canceled');assert.equal(f.subscriptions.get(OTHER_SUB),'active');
 assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM bb_paid_entitlements WHERE user_id=?').get(USER).n,0);
 assert.equal(rows(f,'bb_billing_claims').length,0);
 const slot=f.db.sql.prepare('SELECT * FROM bb_founder_slots WHERE slot_no=1').get();
 assert.equal(slot.state,'retired');
 for(const key of ['user_id','reservation_token_hash','paddle_subscription_id','reservation_expires_at_ms'])assert.equal(slot[key],null);
 const refs=rows(f,'bb_account_deletion_refs').map(row=>row.ref_hash).sort();
 assert.deepEqual(refs,[await digestDeletionRef('claim',CLAIM),await digestDeletionRef('subscription',SUB)].sort());
 assert.equal(f.deleteCalls,1);
});

test('failed cancellation retains account data and identifiers for a subsequent successful retry',async t=>{
 const f=fixture(t);activeSubscription(f);f.cancelFails=true;
 const before=savedRows(f),response=await remove(f);
 assert.equal(response.status,202);const result=await response.json();assert.equal(result.ok,false);assert.equal(result.pending,true);assert.equal(result.code,'deletion_billing_pending');assert.match(result.error,/subscription has been cancelled/);
 assert.deepEqual(savedRows(f),before);assert.equal(f.deleteCalls,0);assert.equal(f.authDeleted,false);
 let journal=rows(f,'bb_account_deletions')[0];
 assert.equal(journal.user_id,USER);assert.equal(journal.email,EMAIL);assert.equal(journal.completed_at_ms,null);assert.equal(journal.locked_until_ms,0);
 assert.ok(!JSON.stringify(journal).includes(PASSWORD));assert.ok(!JSON.stringify(journal).includes(TOKEN));
 f.cancelFails=false;
 const retried=await remove(f);assert.equal(retried.status,200);assert.equal((await retried.json()).deleted,true);
 journal=rows(f,'bb_account_deletions')[0];assert.equal(journal.user_id,null);assert.equal(journal.email,null);assert.ok(journal.completed_at_ms>0);
});

test('an unresolved checkout claim prevents erasure and remains recoverable',async t=>{
 const f=fixture(t);
 f.db.sql.prepare('INSERT INTO bb_billing_claims(claim_id,user_id,claim_state) VALUES(?,?,?)').run(CLAIM,USER,'pending');
 const before=savedRows(f),response=await remove(f);
 assert.equal(response.status,202);const result=await response.json();assert.equal(result.pending,true);assert.equal(result.code,'deletion_checkout_pending');
 assert.deepEqual(savedRows(f),before);assertNoRemoteDeletion(f);
 assert.equal(rows(f,'bb_account_deletions')[0].completed_at_ms,null);
});

test('lost RPC response can finish using the original bearer after Supabase auth identity is gone',async t=>{
 const f=fixture(t);f.loseRpcResponse=true;
 let response=await remove(f);
 assert.equal(response.status,202);const firstResult=await response.json();assert.equal(firstResult.pending,true);assert.equal(firstResult.code,'deletion_cloud_pending');
 assert.equal(f.authDeleted,true);assert.equal(f.deleteCalls,1);
 assert.equal(rows(f,'bb_account_deletions')[0].email,EMAIL);
 const initialAuthCalls=f.calls.filter(call=>call.path.startsWith('/auth/')).length;
 response=await remove(f);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,deleted:true});
 assert.equal(f.deleteCalls,2);
 assert.equal(f.calls.filter(call=>call.path.startsWith('/auth/')).length,initialAuthCalls);
 const journal=rows(f,'bb_account_deletions')[0];assert.equal(journal.user_id,null);assert.equal(journal.email,null);assert.ok(journal.completed_at_ms>0);
 const count=f.calls.length;
 response=await remove(f);assert.equal(response.status,200);assert.equal((await response.json()).deleted,true);
 assert.equal(f.calls.length,count);assert.equal(f.deleteCalls,2);
});

test('oversized chunked confirmation is rejected before reading the whole body or authenticating',async t=>{
 const f=fixture(t);let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2049));},cancel(){cancelled=true;}});
 const req=new Request('https://basketboss.co.uk/api/account/delete',{method:'POST',headers:{Origin:'https://basketboss.co.uk',Authorization:TOKEN,'Content-Type':'application/json'},body:stream,duplex:'half'});
 const response=await onRequestPost({request:req,env:f.env});
 assert.equal(response.status,400);assert.equal(cancelled,true);assert.equal(f.calls.length,0);assertNoRemoteDeletion(f);
});

test('a proven pre-intent migration failure does not report that deletion is pending',async t=>{
 const f=fixture(t);f.ready=false;
 const result=await(await remove(f)).json();
 assert.equal(result.pending,false);assert.equal(result.code,'deletion_not_ready');assert.match(result.error,/Nothing has been deleted/);
 assert.equal(rows(f,'bb_account_deletions').length,0);assertNoRemoteDeletion(f);
});

test('a wrong password before any intent explicitly leaves deletion inactive',async t=>{
 const f=fixture(t);f.passwordAccepted=false;
 const response=await remove(f),result=await response.json();
 assert.equal(response.status,403);assert.equal(result.pending,false);assert.equal(result.code,'deletion_password_required');
 assert.equal(rows(f,'bb_account_deletions').length,0);assertNoRemoteDeletion(f);
});

async function pendingActor(f,token='Bearer earlier-password-verified-session'){
 await ensureDeletionSchema(f.env);
 await f.db.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,user_id,email,started_at_ms) VALUES(?,?,?,?,?)')
  .bind(await digestDeletionActor(USER),await digestDeletionRetry(token),USER,EMAIL,Date.now()).run();
}

test('a new session cannot unpause an existing actor deletion when migration checks fail',async t=>{
 const f=fixture(t);await pendingActor(f);f.ready=false;
 const before=rows(f,'bb_account_deletions')[0],response=await remove(f),result=await response.json();
 assert.equal(response.status,503);assert.equal(result.pending,true);assert.equal(result.code,'deletion_not_ready');
 assert.deepEqual(rows(f,'bb_account_deletions')[0],before);assertNoRemoteDeletion(f);
});

test('a wrong password from a new session preserves an existing pending actor job',async t=>{
 const f=fixture(t);await pendingActor(f);f.passwordAccepted=false;
 const before=rows(f,'bb_account_deletions')[0],response=await remove(f),result=await response.json();
 assert.equal(response.status,403);assert.equal(result.pending,true);assert.equal(result.code,'deletion_password_required');
 assert.deepEqual(rows(f,'bb_account_deletions')[0],before);assertNoRemoteDeletion(f);
});

test('a password-verified new session can resume its own existing deletion',async t=>{
 const f=fixture(t);await pendingActor(f);
 const response=await remove(f);assert.equal(response.status,200);assert.equal((await response.json()).deleted,true);
 const journal=rows(f,'bb_account_deletions')[0];assert.equal(journal.retry_hash,await digestDeletionRetry(TOKEN));assert.equal(journal.user_id,null);
});

test('a cloud failure is identified without exposing provider diagnostics or claiming completion',async t=>{
 const f=fixture(t);f.cloudFails=true;
 const response=await remove(f),result=await response.json();
 assert.equal(response.status,202);assert.equal(result.pending,true);assert.equal(result.code,'deletion_cloud_pending');
 assert.ok(!JSON.stringify(result).includes('synthetic-private'));assert.equal(f.authDeleted,false);assert.equal(rows(f,'bb_account_deletions')[0].completed_at_ms,null);
 f.cloudFails=false;assert.equal((await remove(f)).status,200);
});

test('no AI usage table is a valid empty history and does not block account deletion',async t=>{
 const f=fixture(t);f.db.sql.exec('DROP TABLE bb_ai_daily_usage');
 const response=await remove(f);assert.equal(response.status,200);assert.equal((await response.json()).deleted,true);
 assert.equal(f.authDeleted,true);assert.equal(rows(f,'bb_private_premium_recipes_500_v1').length,1);
 assert.equal(f.db.sql.prepare("SELECT name FROM sqlite_master WHERE name='bb_ai_daily_usage'").get(),undefined);
});

test('an existing AI usage table with an unexpected schema fails closed and rolls back D1 cleanup',async t=>{
 const f=fixture(t);f.db.sql.exec('DROP TABLE bb_ai_daily_usage; CREATE TABLE bb_ai_daily_usage(unexpected TEXT)');
 const before=rows(f,'bb_founder_slots'),response=await remove(f),result=await response.json();
 assert.equal(response.status,202);assert.equal(result.pending,true);assert.equal(result.code,'deletion_database_pending');
 assert.deepEqual(rows(f,'bb_founder_slots'),before);assertNoRemoteDeletion(f);
 assert.ok(!JSON.stringify(result).includes('actor'));assert.ok(!JSON.stringify(result).includes('SQL'));
});

for(const existing of [false,true])test('readiness network failure '+(existing?'keeps an existing deletion paused':'does not create an intent'),async t=>{
 const f=fixture(t);if(existing)await pendingActor(f);f.readyThrows=true;
 const response=await remove(f),result=await response.json();
 assert.equal(result.pending,existing);assert.equal(result.code,'deletion_not_ready');
 assert.equal(rows(f,'bb_account_deletions').length,existing?1:0);assertNoRemoteDeletion(f);assert.ok(!JSON.stringify(result).includes('synthetic-private'));
});

for(const existing of [false,true])test('auth-provider outage '+(existing?'preserves a pending job':'does not imply an incorrect password or start deletion'),async t=>{
 const f=fixture(t);if(existing)await pendingActor(f);f.passwordUnavailable=true;
 const response=await remove(f),result=await response.json();
 assert.equal(response.status,existing?202:503);assert.equal(result.pending,existing);assert.equal(result.code,'deletion_auth_unavailable');
 assert.equal(rows(f,'bb_account_deletions').length,existing?1:0);assertNoRemoteDeletion(f);assert.ok(!JSON.stringify(result).includes('synthetic-private'));
});

test('a journal lookup outage cannot declare that no earlier deletion exists',async t=>{
 const f=fixture(t),prepare=f.db.prepare;
 f.db.prepare=function(query){if(query.startsWith('SELECT * FROM bb_account_deletions'))throw Error('synthetic-private-SQL');return prepare.call(this,query);};
 const response=await remove(f),result=await response.json();
 assert.equal(response.status,503);assert.equal(result.pending,true);assert.equal(result.code,'deletion_state_unknown');
 assert.ok(!JSON.stringify(result).includes('synthetic-private'));assertNoRemoteDeletion(f);
});

test('an unavailable AI usage schema check is not mistaken for an empty history',async t=>{
 const f=fixture(t),prepare=f.db.prepare,before=rows(f,'bb_founder_slots');
 f.db.prepare=function(query){if(query.includes("name='bb_ai_daily_usage'"))throw Error('synthetic-private-metadata-failure');return prepare.call(this,query);};
 const response=await remove(f),result=await response.json();
 assert.equal(response.status,202);assert.equal(result.pending,true);assert.equal(result.code,'deletion_database_pending');
 assert.deepEqual(rows(f,'bb_founder_slots'),before);assertNoRemoteDeletion(f);assert.ok(!JSON.stringify(result).includes('synthetic-private'));
});
