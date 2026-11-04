import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync} from 'node:crypto';
import {ensureDeletionSchema,digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';
import {persistAppleSubscription} from '../bb-server-lib/bb-apple-subscriptions.js';
import {readPersonalPaidAccess,readMemberPaidAccess} from '../bb-server-lib/bb-paid-access.js';
import {sharedHouseholdPremiumOwner} from '../bb-server-lib/bb-household-premium.js';
import {onRequestGet as status} from '../functions/api/subscription/status.js';
import {onRequestGet as recipes} from '../functions/api/recipes/premium.js';
import {onRequest as ai} from '../functions/api/bb173/[action].js';
import {onRequestGet as inventory} from '../functions/api/receipt-inventory.js';
import {onRequestGet as household} from '../functions/api/household/index.js';
const USER='11111111-1111-4111-8111-111111111111',OWNER='22222222-2222-4222-8222-222222222222',TOKEN='33333333-3333-4333-8333-333333333333',SID='44444444-4444-4444-8444-444444444444',HH='55555555-5555-4555-8555-555555555555';
const LIVE='https://kbhyosxuvlcazyzzinqv.supabase.co',ORIGIN='https://basketboss.co.uk',PRICE='pri_'+'p'.repeat(26);
const apiKey=generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../sql/basketboss_apple_subscriptions_20261101.sql',import.meta.url),'utf8'));
 sql.exec(`CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER,paddle_subscription_id TEXT,paddle_customer_id TEXT,trial_ends_at TEXT,current_period_ends_at TEXT,cancellation_effective_at TEXT,cancel_at_period_end INTEGER);
 CREATE TABLE bb_private_premium_recipes(sort_index INTEGER,recipe_json TEXT,normalized_json TEXT);`);
 for(let i=0;i<221;i++)sql.prepare('INSERT INTO bb_private_premium_recipes VALUES(?,?,?)').run(i,JSON.stringify({id:'r'+i}),JSON.stringify({id:'r'+i}));
 const db={sql,prepare(query){let values=[];const statement={bind(...args){values=args;return statement;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};return statement;},async batch(list){sql.exec('BEGIN');try{const out=[];for(const item of list)out.push(await item.run());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}}};return db;
}
async function fixture(options={}){
 const realFetch=globalThis.fetch,db=database(),calls=[];
 const env={BILLING_DB:db,APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_ISSUER_ID:'66666666-6666-4666-8666-666666666666',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:apiKey,APPLE_SUBSCRIPTION_GROUP_ID:'12345678',SUPABASE_URL:LIVE,SUPABASE_PUBLISHABLE_KEY:'public_'+'p'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40),BB_BILLING_ENABLED:'false',BB_BILLING_MODE:'live',BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_RECEIPT_INVENTORY_ENABLED:'true',CF_PAGES_BRANCH:'main',BB_PREMIUM_AI_ENABLED:'true',GEMINI_API_KEY:'local-test',TURNSTILE_SITE_KEY:'local-test',TURNSTILE_SECRET_KEY:'local-test',BB_AI_GLOBAL_DAILY_CAP:'20',...options.env};
 await ensureDeletionSchema(env);
 const h=options.household?{id:HH,owner_user_id:options.householdOwner?USER:OWNER,partner_user_id:options.householdOwner?OWNER:USER,partner_email:'member@example.test',invite_status:options.accepted===false?'pending':'accepted'}:null;
 globalThis.fetch=async (url,init={})=>{
  const u=new URL(String(url));calls.push({url:String(url),init});
  if(u.pathname==='/auth/v1/user')return Response.json({id:USER,email:'member@example.test',email_confirmed_at:'2026-10-31T00:00:00Z'});
  if(u.pathname.endsWith('/rpc/bb_hh_service_session_ok'))return Response.json(options.currentSession!==false);
  if(u.pathname.endsWith('/bb_households')){
   if(!h)return Response.json([]);
   const owner=u.searchParams.get('owner_user_id'),partner=u.searchParams.get('partner_user_id');
   if(owner&&owner!==('eq.'+h.owner_user_id))return Response.json([]);
   if(partner&&partner!==('eq.'+h.partner_user_id))return Response.json([]);
   if(u.searchParams.get('invite_status')==='eq.accepted'&&h.invite_status!=='accepted')return Response.json([]);
   return Response.json([h]);
  }
  if(u.pathname.endsWith('/bb_household_invites'))return Response.json([]);
  if(u.pathname.endsWith('/rpc/bb_receipt_inventory_service'))return Response.json({ok:true,autoStockReady:true});
  throw Error('Unexpected outbound request '+u.origin+u.pathname);
 };
 return {env,db,calls,restore(){globalThis.fetch=realFetch;db.sql.close();}};
}
function request(pathname){const bearer='header.'+Buffer.from(JSON.stringify({sub:USER,session_id:SID,exp:Date.now()/1000+3600})).toString('base64url')+'.signature';return new Request(ORIGIN+pathname,{headers:{Authorization:'Bearer '+bearer}});}
async function paidApple(f,id=USER,extra={}){
 const now=Date.now();f.db.sql.prepare('INSERT OR IGNORE INTO bb_apple_account_tokens VALUES(?,?,?)').run(id,TOKEN,now);
 await persistAppleSubscription(f.env,id,{environment:'Production',originalTransactionId:'20000000000000',transactionId:'20000000000001',appAccountToken:TOKEN,productId:'uk.co.basketboss.premium.monthly',plan:'monthly',status:'active',expiresAtMs:now+3600000,graceExpiresAtMs:null,revokedAtMs:null,cancelAtPeriodEnd:false,appleSignedAtMs:now,lastVerifiedAtMs:now,...extra});
}
function paidWeb(f,id=USER){Object.assign(f.env,{BB_BILLING_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',PADDLE_LIVE_STANDARD_PRICE_ID:PRICE,PADDLE_LIVE_FOUNDER_PRICE_ID:'pri_'+'f'.repeat(26)});f.db.sql.prepare('INSERT INTO bb_paid_entitlements(user_id,status,price_id,plan,updated_at_ms) VALUES(?,?,?,?,?)').run(id,'active',PRICE,'standard',Date.now());}
test('Apple alone unlocks status, private recipes, AI and receipt review with independent billing disabled',async()=>{
 const f=await fixture();try{
  await paidApple(f);
  const state=await (await status({request:request('/api/subscription/status'),env:f.env})).json();
  assert.equal(state.premiumAccess,true);assert.equal(state.provider,'apple');assert.equal(state.subscription.provider,'apple');assert.equal(state.subscription.plan,'monthly');assert.equal(state.subscription.id,undefined);
  const catalogue=await recipes({request:request('/api/recipes/premium'),env:f.env});assert.equal(catalogue.status,200);assert.equal((await catalogue.json()).count,221);
  assert.equal((await (await ai({request:request('/api/bb173/status'),env:f.env,params:{action:'status'}})).json()).premium_ai,true);
  assert.equal((await (await inventory({request:request('/api/receipt-inventory?mode=status'),env:f.env})).json()).available,true);
  assert.ok(!f.calls.some(call=>call.url.includes('api.storekit')),'fresh server cache requires no unnecessary Apple request');
 }finally{f.restore();}
});
test('cancellation retains paid access until expiry; expired and refunded Apple rows deny private content',async()=>{
 for(const extra of [{cancelAtPeriodEnd:true},{expiresAtMs:Date.now()-1000},{status:'revoked',revokedAtMs:Date.now()-1000},{status:'billing_retry'}]){
  const f=await fixture();try{
   await paidApple(f,USER,extra);const expected=extra.cancelAtPeriodEnd===true;
   const state=await (await status({request:request('/api/subscription/status'),env:f.env})).json();
   assert.equal(state.premiumAccess,expected);assert.equal(state.provider,'apple');assert.equal(state.subscription.cancelAtPeriodEnd,expected);
   assert.equal((await recipes({request:request('/api/recipes/premium'),env:f.env})).status,expected?200:403);
  }finally{f.restore();}
 }
});
test('direct and household web members retain Premium when Apple configuration is unavailable',async()=>{
 for(const linked of [false,true]){
  const f=await fixture({household:linked});try{
   paidWeb(f,linked?OWNER:USER);delete f.env.APPLE_PRIVATE_KEY;
   const access=await readMemberPaidAccess(request('/api/subscription/status'),f.env,{id:USER,email:'member@example.test'});
   assert.equal(access.premiumAccess,true);assert.equal(access.provider,linked?'household':'paddle');
   const state=await (await status({request:request('/api/subscription/status'),env:f.env})).json();assert.equal(state.premiumAccess,true);
   assert.equal((await recipes({request:request('/api/recipes/premium'),env:f.env})).status,200);
  }finally{f.restore();}
 }
});
test('accepted partner inherits Production Apple with the owner quota and no owner billing details',async()=>{
 const f=await fixture({household:true});try{
  await paidApple(f,OWNER);
  const access=await readMemberPaidAccess(request('/api/subscription/status'),f.env,{id:USER,email:'member@example.test'});
  assert.equal(access.householdOwnerId,OWNER);assert.equal(access.provider,'household');
  const state=await (await status({request:request('/api/subscription/status'),env:f.env})).json();assert.equal(state.householdRole,'partner');assert.equal(state.subscription,null);
  assert.equal((await (await household({request:request('/api/household'),env:f.env})).json()).premium,true);
  const aiState=await (await ai({request:request('/api/bb173/status'),env:f.env,params:{action:'status'}})).json();assert.equal(aiState.premium_ai,true);
  const receipt=await (await inventory({request:request('/api/receipt-inventory?mode=status'),env:f.env})).json();assert.equal(receipt.available,true);
  const body=JSON.parse(f.calls.find(call=>call.url.endsWith('/rpc/bb_receipt_inventory_service')).init.body);assert.equal(body.p_scope_kind,'household');assert.equal(body.p_scope_id,HH);
 }finally{f.restore();}
});
test('Sandbox purchase remains personal and cannot enable household, partner recipes or shared receipt scope',async()=>{
 const f=await fixture({household:true,env:{APPLE_ALLOW_SANDBOX:'true',APPLE_SANDBOX_USER_IDS:OWNER}});try{
  await paidApple(f,OWNER,{environment:'Sandbox'});
  assert.equal((await readPersonalPaidAccess(f.env,OWNER)).premiumAccess,true);
  assert.equal(await sharedHouseholdPremiumOwner(request('/api/subscription/status'),f.env,{id:USER,email:'member@example.test'}),null);
  assert.equal((await recipes({request:request('/api/recipes/premium'),env:f.env})).status,403);
  assert.equal((await (await household({request:request('/api/household'),env:f.env})).json()).premium,false);
 }finally{f.restore();}
});
test('pending invitations, identity mismatch, deletion and invalid SKU cannot grant Apple Premium',async()=>{
 const f=await fixture({household:true,accepted:false});try{
  await paidApple(f,OWNER);
  assert.equal(await sharedHouseholdPremiumOwner(request('/api/subscription/status'),f.env,{id:USER,email:'member@example.test'}),null);
  f.db.sql.exec("UPDATE bb_apple_subscriptions SET product_id='forged'");assert.equal((await readPersonalPaidAccess(f.env,OWNER)).premiumAccess,false);
  const hash=await digestDeletionActor(OWNER);f.db.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(hash,'test',Date.now());
  await assert.rejects(()=>readPersonalPaidAccess(f.env,OWNER),/deletion/);
 }finally{f.restore();}
});
test('stale session cannot reach receipt or household service even with valid Apple payment',async()=>{
 const f=await fixture({currentSession:false});try{
  await paidApple(f);
  assert.equal((await (await inventory({request:request('/api/receipt-inventory?mode=status'),env:f.env})).json()).available,false);
  assert.equal((await household({request:request('/api/household'),env:f.env})).status,403);
  assert.ok(!f.calls.some(call=>call.url.endsWith('/rpc/bb_receipt_inventory_service')));
 }finally{f.restore();}
});

test('Sandbox tester who owns a household can review personal receipts without writing household inventory',async()=>{
 const f=await fixture({household:true,householdOwner:true,env:{APPLE_ALLOW_SANDBOX:'true',APPLE_SANDBOX_USER_IDS:USER}});try{
  await paidApple(f,USER,{environment:'Sandbox'});
  const receipt=await (await inventory({request:request('/api/receipt-inventory?mode=status'),env:f.env})).json();assert.equal(receipt.available,true);
  const body=JSON.parse(f.calls.find(call=>call.url.endsWith('/rpc/bb_receipt_inventory_service')).init.body);
  assert.equal(body.p_scope_kind,'user');assert.equal(body.p_scope_id,USER);
  assert.equal((await (await household({request:request('/api/household'),env:f.env})).json()).premium,false);
 }finally{f.restore();}
});
test('unavailable Apple refresh fails closed instead of trusting stale paid cache',async()=>{
 const f=await fixture();try{
  await paidApple(f,USER,{lastVerifiedAtMs:Date.now()-61000});
  const state=await status({request:request('/api/subscription/status'),env:f.env});assert.equal(state.status,503);assert.equal((await state.json()).premium,false);
  assert.equal((await recipes({request:request('/api/recipes/premium'),env:f.env})).status,503);
 }finally{f.restore();}
});

test('newer inactive Paddle rows cannot hide an older verified direct or household web membership',async()=>{
 for(const linked of [false,true]){
  const f=await fixture({household:linked});try{
   const id=linked?OWNER:USER;paidWeb(f,id);delete f.env.APPLE_PRIVATE_KEY;
   const now=Date.now();f.db.sql.prepare('UPDATE bb_paid_entitlements SET updated_at_ms=?,paddle_subscription_id=? WHERE user_id=?').run(now-1000,'sub_active',id);
   f.db.sql.prepare('INSERT INTO bb_paid_entitlements(user_id,status,price_id,plan,updated_at_ms,paddle_subscription_id) VALUES(?,?,?,?,?,?)').run(id,'canceled',PRICE,'standard',now,'sub_canceled');
   const access=await readMemberPaidAccess(request('/api/subscription/status'),f.env,{id:USER,email:'member@example.test'});
   assert.equal(access.premiumAccess,true);assert.equal(access.provider,linked?'household':'paddle');
   const response=await status({request:request('/api/subscription/status'),env:f.env});assert.equal(response.status,200);
   const state=await response.json();assert.equal(state.premiumAccess,true);
   if(linked){assert.equal(state.householdRole,'partner');assert.equal(state.subscription,null);}
   else {assert.equal(state.subscription.status,'active');assert.equal(state.subscription.id,'sub_active');}
   assert.equal((await recipes({request:request('/api/recipes/premium'),env:f.env})).status,200);
  }finally{f.restore();}
 }
});
test('older active rows with an unconfigured Paddle SKU never substitute for a valid membership',async()=>{
 const f=await fixture();try{
  paidWeb(f);f.env.APPLE_BILLING_ENABLED='false';
  f.db.sql.prepare('UPDATE bb_paid_entitlements SET price_id=?').run('pri_'+'x'.repeat(26));
  f.db.sql.prepare('INSERT INTO bb_paid_entitlements(user_id,status,price_id,plan,updated_at_ms) VALUES(?,?,?,?,?)').run(USER,'canceled',PRICE,'standard',Date.now()+1000);
  assert.equal((await readPersonalPaidAccess(f.env,USER)).premiumAccess,false);
  const state=await (await status({request:request('/api/subscription/status'),env:f.env})).json();assert.equal(state.premiumAccess,false);assert.equal(state.subscription.status,'canceled');
 }finally{f.restore();}
});
