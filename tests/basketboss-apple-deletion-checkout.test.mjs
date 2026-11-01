import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync} from 'node:crypto';
import {eraseAccountD1,ensureDeletionSchema} from '../bb-server-lib/bb-account-deletion.js';
import {onRequestPost as checkout} from '../functions/api/subscription/checkout.js';

const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const TOKEN='33333333-3333-4333-8333-333333333333',PRICE='pri_'+'p'.repeat(26);
const applePrivateKey=generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE bb_founder_slots(slot_no INTEGER PRIMARY KEY,state TEXT,user_id TEXT,reservation_token_hash TEXT,paddle_subscription_id TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER);
  CREATE TABLE bb_paid_entitlements(paddle_subscription_id TEXT PRIMARY KEY,user_id TEXT,status TEXT,plan TEXT,price_id TEXT,updated_at_ms INTEGER);
  CREATE TABLE bb_billing_claims(claim_id TEXT PRIMARY KEY,user_id TEXT,plan TEXT,price_id TEXT,slot_no INTEGER,claim_state TEXT DEFAULT 'pending',transaction_id TEXT,created_at_ms INTEGER);`);
 sql.exec(read('sql/basketboss_apple_subscriptions_20261101.sql'));
 for(let n=1;n<=25;n++)sql.prepare("INSERT INTO bb_founder_slots(slot_no,state) VALUES(?,'available')").run(n);
 function statement(query,args=[]){return {query,bind:(...bound)=>statement(query,bound),first:async()=>sql.prepare(query).get(...args)||null,
  all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>{const info=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(info.changes)}};}};}
 const db={sql,prepare:statement,executed:[],async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements){db.executed.push(s.query);out.push(await s.run());}sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 return db;
}
function env(db){return {BILLING_DB:db,BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'sandbox',PADDLE_SANDBOX_API_KEY:'synthetic',PADDLE_SANDBOX_STANDARD_PRICE_ID:PRICE,PADDLE_SANDBOX_FOUNDER_PRICE_ID:PRICE,
 SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic',APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_ISSUER_ID:'55555555-5555-4555-8555-555555555555',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:applePrivateKey,APPLE_SUBSCRIPTION_GROUP_ID:'12345678'};}
function appleRow(db,user=USER,original='20000000000000',environment='Production',status='active',plan='monthly'){
 const now=Date.now();
 db.sql.prepare(`INSERT INTO bb_apple_subscriptions(environment,original_transaction_id,user_id,app_account_token,latest_transaction_id,product_id,plan,status,expires_at_ms,cancel_at_period_end,apple_signed_at_ms,last_verified_at_ms)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(environment,original,user,TOKEN,'20000000000001','uk.co.basketboss.premium.'+plan,plan,status,now+3600000,0,now,now);
}
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const request=(plan='standard')=>new Request('https://basketboss.co.uk/api/subscription/checkout',{method:'POST',headers:{Origin:'https://basketboss.co.uk',Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({plan})});
function mockCheckoutFetch(t){
 const remote=[];
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  if(String(url).endsWith('/auth/v1/user'))return response({id:USER,email:'person@example.invalid',email_confirmed_at:'2026-01-01Z'});
  remote.push({url:String(url),options});
  assert.equal(String(url),'https://sandbox-api.paddle.com/transactions');
  return response({data:{id:'txn_'+'t'.repeat(26)}});
 });
 return remote;
}

test('account erasure removes only owned Apple monthly and annual records across both environments',async()=>{
 const db=database(),e=env(db);try{
  await ensureDeletionSchema(e);
  appleRow(db);appleRow(db,USER,'20000000000003','Production','active','annual');appleRow(db,USER,'20000000000004','Sandbox');appleRow(db,OTHER,'20000000000002');
  db.sql.prepare("UPDATE bb_founder_slots SET state='active',user_id=?,paddle_subscription_id=? WHERE slot_no=2").run(OTHER,'sub_'+'o'.repeat(26));
  db.sql.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run(USER,TOKEN,Date.now());
  for(const [environment,original] of [['Production','20000000000000'],['Production','20000000000003'],['Sandbox','20000000000004'],['Production','20000000000002']])db.sql.prepare('INSERT INTO bb_apple_notifications VALUES(?,?,?,?,?)').run(environment,'notification-'+original,original,Date.now(),Date.now());
  await eraseAccountD1(e,USER,{claims:[],subscriptions:[],confirmedSlots:[]});
  for(const table of ['bb_apple_account_tokens','bb_apple_subscriptions'])assert.equal(db.sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE user_id=?').get(USER).n,0);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions WHERE user_id=?').get(OTHER).n,1);
  assert.equal(db.sql.prepare('SELECT original_transaction_id FROM bb_apple_notifications').get().original_transaction_id,'20000000000002');
  assert.ok(db.executed.findIndex(q=>q.startsWith('DELETE FROM bb_apple_notifications'))<db.executed.findIndex(q=>q.startsWith('DELETE FROM bb_apple_subscriptions')));
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM bb_founder_slots WHERE state='available'").get().n,24);
  assert.deepEqual({...db.sql.prepare('SELECT state,user_id,paddle_subscription_id FROM bb_founder_slots WHERE slot_no=2').get()},{state:'active',user_id:OTHER,paddle_subscription_id:'sub_'+'o'.repeat(26)});
 }finally{db.sql.close();}
});
test('an Apple cleanup failure rolls back all account erasure and preserves web Founder records',async()=>{
 const db=database(),e=env(db);try{
  await ensureDeletionSchema(e);appleRow(db);
  db.sql.prepare("UPDATE bb_founder_slots SET state='active',user_id=?,paddle_subscription_id=? WHERE slot_no=1").run(USER,'sub_'+'s'.repeat(26));
  db.sql.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run(USER,TOKEN,Date.now());
  db.sql.exec("CREATE TRIGGER refuse_token_delete BEFORE DELETE ON bb_apple_account_tokens BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  await assert.rejects(()=>eraseAccountD1(e,USER,{claims:[],subscriptions:[],confirmedSlots:[]}),/synthetic failure/);
  assert.deepEqual({...db.sql.prepare('SELECT state,user_id,paddle_subscription_id FROM bb_founder_slots WHERE slot_no=1').get()},{state:'active',user_id:USER,paddle_subscription_id:'sub_'+'s'.repeat(26)});
  for(const table of ['bb_apple_account_tokens','bb_apple_subscriptions'])assert.equal(db.sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE user_id=?').get(USER).n,1);
 }finally{db.sql.close();}
});
test('verified Apple Premium prevents a second web payment before any Paddle mutation',async t=>{
 const db=database(),remote=mockCheckoutFetch(t);try{
  appleRow(db);const result=await checkout({request:request(),env:env(db)});
  assert.equal(result.status,409);assert.equal((await result.json()).provider,'apple');assert.equal(remote.length,0);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM bb_billing_claims').get().n,0);
 }finally{db.sql.close();}
});
test('expired Apple access permits a normal web checkout while an Apple verification outage fails closed',async t=>{
 const db=database(),remote=mockCheckoutFetch(t);try{
  appleRow(db,USER,'20000000000000','Production','expired');
  const result=await checkout({request:request(),env:env(db)});assert.equal(result.status,200);assert.equal(remote.length,1);
  db.sql.exec('DELETE FROM bb_billing_claims');const broken={...env(db),APPLE_KEY_ID:''};
  t.mock.method(console,'error',()=>{});
  assert.equal((await checkout({request:request(),env:broken})).status,503);assert.equal(remote.length,1);
 }finally{db.sql.close();}
});
test('existing web subscribers are protected even when Apple configuration is incomplete',async t=>{
 const db=database(),remote=mockCheckoutFetch(t);try{
  db.sql.prepare('INSERT INTO bb_paid_entitlements VALUES(?,?,?,?,?,?)').run('sub_'+'s'.repeat(26),USER,'active','standard',PRICE,Date.now());
  assert.equal((await checkout({request:request(),env:{...env(db),APPLE_PRIVATE_KEY:''}})).status,409);assert.equal(remote.length,0);
 }finally{db.sql.close();}
});

class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.textContent='';this.hidden=false;this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(key,value){this[key]=value;}
 addEventListener(name,listener){this.listeners[name]=listener;}
 async click(){await this.listeners.click?.({preventDefault(){}});}
}
async function membershipFixture(raw){
 const parent=new Element('section');parent.id='bbuiLinksSection';
 const find=(element,id)=>element.id===id?element:element.children.map(child=>find(child,id)).find(Boolean);
 const document={readyState:'complete',hidden:false,body:parent,getElementById:id=>find(parent,id),createElement:tag=>new Element(tag),addEventListener(){}};
 const calls=[],destinations=[],window={addEventListener(){},location:{assign:dest=>destinations.push(dest)}};
 const context=vm.createContext({document,window,URL,localStorage:{getItem:()=>JSON.stringify({access_token:'synthetic',expires_at:9999999999})},fetch:async path=>{calls.push(path);return {ok:true,json:async()=>raw};}});
 vm.runInContext(read('bb-membership-settings.js'),context);await new Promise(setImmediate);
 return {get:id=>document.getElementById(id),calls,destinations};
}
test('Apple subscription management opens Apple and never calls the Paddle portal',async()=>{
 const h=await membershipFixture({authenticated:true,provider:'apple',premiumAccess:true,subscription:{provider:'apple',plan:'annual',status:'active',currentPeriodEndsAt:'2027-11-01T00:00:00Z',cancelAtPeriodEnd:false,environment:'Production'}});
 assert.match(h.get('bbMembershipState').textContent,/Premium Annual.*Active.*Apple/);
 assert.equal(h.get('bbMembershipManage').disabled,false);assert.equal(h.get('bbMembershipUpgrade').hidden,true);
 await h.get('bbMembershipManage').click();assert.deepEqual(h.destinations,['https://apps.apple.com/account/subscriptions']);assert.deepEqual(h.calls,['/api/subscription/status']);
});
test('expired Apple subscriptions retain management and accepted household members do not see an upgrade prompt',async()=>{
 const apple=await membershipFixture({authenticated:true,provider:'apple',premiumAccess:false,subscription:{plan:'monthly',status:'expired',environment:'Production'}});
 assert.equal(apple.get('bbMembershipManage').disabled,false);assert.match(apple.get('bbMembershipDetails').textContent,/access is currently unavailable/);
 const shared=await membershipFixture({authenticated:true,premiumAccess:true,householdRole:'partner',subscription:null});
 assert.match(shared.get('bbMembershipState').textContent,/shared by your household/);assert.equal(shared.get('bbMembershipUpgrade').hidden,true);assert.equal(shared.get('bbMembershipManage').disabled,true);
});
test('the account deletion dialog explains continuing Apple billing and links directly to Apple without adding a deletion requirement',()=>{
 const source=read('bb-account-deletion.js');
 assert.match(source,/Deleting your BasketBoss account does not cancel Apple billing/);
 assert.match(source,/You can still delete your account without cancelling first/);
 assert.match(source,/https:\/\/apps\.apple\.com\/account\/subscriptions/);
 assert.match(source,/host\.BBNative\.openExternal\(appleSubscriptions\.href\)/);
});
