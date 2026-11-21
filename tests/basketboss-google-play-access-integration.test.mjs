import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync} from 'node:crypto';
import {paidBillingEnabled,livePaidBillingEnabled,readPersonalPaidAccess,readMemberPaidAccess} from '../bb-server-lib/bb-paid-access.js';
import {digestDeletionActor,digestDeletionRef,ensureDeletionSchema,eraseAccountD1} from '../bb-server-lib/bb-account-deletion.js';
import {getVerifiedGooglePlayConfig,googlePlayTokenHash,googlePlayAccountId,reconcileGooglePlayPurchase} from '../bb-server-lib/bb-google-play-subscriptions.js';
import {sharedHouseholdPremiumOwner} from '../bb-server-lib/bb-household-premium.js';
import {persistTestFlightBetaGrant} from '../bb-server-lib/bb-testflight-beta.js';
import {onRequestGet as status} from '../functions/api/subscription/status.js';
import {onRequestPost as checkout} from '../functions/api/subscription/checkout.js';
import {onRequestPost as appleContext} from '../functions/api/apple/purchase-context.js';
import {onRequestGet as householdGet,onRequestPost as householdPost} from '../functions/api/household/index.js';

const USER='11111111-1111-4111-8111-111111111111',PARTNER='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
const HH='44444444-4444-4444-8444-444444444444',SID='55555555-5555-4555-8555-555555555555',APPLE_TOKEN='66666666-6666-4666-8666-666666666666';
const ORIGIN='https://basketboss.co.uk',LIVE='https://kbhyosxuvlcazyzzinqv.supabase.co',PRICE='pri_'+'p'.repeat(26);
const playPrivateKey=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const applePrivateKey=generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const email=id=>id===PARTNER?'partner@example.test':id===USER?'member@example.test':'other@example.test';
function request(path='/api/subscription/status',id=USER,body,origin=ORIGIN){
 const token='header.'+Buffer.from(JSON.stringify({sub:id,session_id:SID,exp:Date.now()/1000+3600})).toString('base64url')+'.signature';
 return new Request(ORIGIN+path,{method:body?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
async function fixture(t,{playSchema=true,mode='live'}={}){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER,
  paddle_subscription_id TEXT,paddle_customer_id TEXT,trial_ends_at TEXT,current_period_ends_at TEXT,cancellation_effective_at TEXT,cancel_at_period_end INTEGER);
  CREATE TABLE bb_billing_claims(claim_id TEXT PRIMARY KEY,user_id TEXT,plan TEXT,price_id TEXT,slot_no INTEGER,claim_state TEXT DEFAULT 'pending',transaction_id TEXT,created_at_ms INTEGER);
  CREATE TABLE bb_founder_slots(slot_no INTEGER PRIMARY KEY,state TEXT,user_id TEXT,reservation_token_hash TEXT,paddle_subscription_id TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER);`);
 sql.exec(read('sql/basketboss_apple_subscriptions_20261101.sql'));
 if(playSchema)sql.exec(read('sql/basketboss_google_play_subscriptions_20261121.sql'));
 const db={sql,fail:null,executed:[],prepare(query){
  const statement=(values=[])=>({query,bind:(...bound)=>statement(bound),async first(){db.fail?.(query,values);return sql.prepare(query).get(...values)||null;},
   async all(){db.fail?.(query,values);return {results:sql.prepare(query).all(...values)};},
   async run(){db.fail?.(query,values);const info=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(info.changes)}};}});
  return statement();
 },async batch(statements){sql.exec('BEGIN');try{const out=[];for(const statement of statements){db.executed.push(statement.query);out.push(await statement.run());}sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={BILLING_DB:db,BB_BILLING_ENABLED:'false',BB_BILLING_MODE:'live',BB_TESTFLIGHT_BETA_ENABLED:'false',
  GOOGLE_PLAY_BILLING_ENABLED:'true',GOOGLE_PLAY_BILLING_MODE:mode,GOOGLE_PLAY_LIVE_BILLING_ENABLED:'true',
  GOOGLE_PLAY_PRODUCT_ID:'basketboss_premium',GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID:'monthly',GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID:'annual',
  GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL:'local-fixture@basketboss-fixture.iam.gserviceaccount.com',GOOGLE_PLAY_PRIVATE_KEY:playPrivateKey,GOOGLE_PLAY_TEST_USER_IDS:USER+','+PARTNER,
  GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL:'push@fixture-project.iam.gserviceaccount.com',GOOGLE_PLAY_PUBSUB_AUDIENCE:'https://basketboss.co.uk/api/google-play/notifications',GOOGLE_PLAY_PUBSUB_SUBSCRIPTION:'projects/fixture-project/subscriptions/play-events',
  APPLE_BILLING_ENABLED:'false',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_ISSUER_ID:'77777777-7777-4777-8777-777777777777',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:applePrivateKey,APPLE_SUBSCRIPTION_GROUP_ID:'12345678',
  SUPABASE_URL:LIVE,SUPABASE_PUBLISHABLE_KEY:'public_'+'p'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40),
  BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',CF_PAGES_BRANCH:'main',
  PADDLE_LIVE_STANDARD_PRICE_ID:PRICE,PADDLE_LIVE_FOUNDER_PRICE_ID:'pri_'+'f'.repeat(26),PADDLE_SANDBOX_STANDARD_PRICE_ID:PRICE,PADDLE_SANDBOX_FOUNDER_PRICE_ID:'pri_'+'f'.repeat(26),PADDLE_SANDBOX_API_KEY:'synthetic'};
 const f={env,db,sql,household:null,currentSession:true,calls:[],remote:[]};
 t.after(()=>sql.close());
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const address=new URL(String(url));f.calls.push({address,init});
  if(address.pathname==='/auth/v1/user'){
   const actor=JSON.parse(Buffer.from(init.headers.Authorization.slice(7).split('.')[1],'base64url')).sub;
   return Response.json({id:actor,email:email(actor),email_confirmed_at:'2026-11-01T00:00:00Z'});
  }
  if(address.pathname.endsWith('/rpc/bb_hh_service_session_ok'))return Response.json(f.currentSession);
  if(address.pathname.endsWith('/bb_households')){
   const h=f.household;if(!h)return Response.json([]);
   for(const [field,value] of address.searchParams){if(['owner_user_id','partner_user_id','invite_status'].includes(field)&&value!=='eq.'+h[field])return Response.json([]);}
   return Response.json([h]);
  }
  if(address.pathname.endsWith('/bb_household_invites'))return Response.json([]);
  if(address.pathname.endsWith('/rpc/bb_hh_service_invite'))return Response.json({household_id:HH,status:'pending'});
  if(address.origin==='https://sandbox-api.paddle.com'&&address.pathname==='/transactions'){
   f.remote.push({address,init});return Response.json({data:{id:'txn_'+'t'.repeat(26)}});
  }
  throw Error('Unexpected outbound request '+address.origin+address.pathname);
 });
 await ensureDeletionSchema(env);
 return f;
}
async function playRow(f,{userId=USER,token='synthetic-purchase-token-'+userId,plan='monthly',status='active',environment='production',expiresAtMs=Date.now()+3600000,cancelAtPeriodEnd=status==='canceled',acknowledged=1,lastVerifiedAtMs=Date.now()}={}){
 const hash=await googlePlayTokenHash(token),account=(userId===USER?'a':userId===PARTNER?'b':'c').repeat(64);
 f.sql.prepare('INSERT OR IGNORE INTO bb_google_play_account_tokens VALUES(?,?,?)').run(userId,account,Date.now());
 f.sql.prepare('INSERT INTO bb_google_play_lineages VALUES(?,?,?,?)').run(hash,userId,account,hash);
 f.sql.prepare(`INSERT INTO bb_google_play_subscriptions(token_hash,purchase_token,user_id,obfuscated_account_id,lineage_id,
  product_id,base_plan_id,plan,status,environment,expires_at_ms,cancel_at_period_end,acknowledged,reconciliation_generation,last_verified_at_ms)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(hash,token,userId,account,hash,'basketboss_premium',plan,plan,status,environment,expiresAtMs,Number(cancelAtPeriodEnd),acknowledged,1,lastVerifiedAtMs);
 return {hash,token,account};
}
function appleRow(f,userId=USER){
 f.env.APPLE_BILLING_ENABLED='true';const now=Date.now();
 f.sql.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run(userId,APPLE_TOKEN,now);
 f.sql.prepare(`INSERT INTO bb_apple_subscriptions(environment,original_transaction_id,user_id,app_account_token,latest_transaction_id,product_id,plan,status,expires_at_ms,cancel_at_period_end,apple_signed_at_ms,last_verified_at_ms)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('Production','20000000000000',userId,APPLE_TOKEN,'20000000000001','uk.co.basketboss.premium.monthly','monthly','active',now+3600000,0,now,now);
}
function webRow(f,userId=USER){f.env.BB_BILLING_ENABLED='true';f.env.BB_LIVE_WEBHOOK_ENABLED='true';f.sql.prepare('INSERT INTO bb_paid_entitlements(user_id,status,price_id,plan,updated_at_ms) VALUES(?,?,?,?,?)').run(userId,'active',PRICE,'standard',Date.now());}
const link=f=>{f.household={id:HH,owner_user_id:USER,partner_user_id:PARTNER,partner_email:email(PARTNER),invite_status:'accepted'};};
const barrier=async(f,id=USER)=>f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(id),'synthetic-retry',Date.now());
const billing={claims:[],subscriptions:[],confirmedSlots:[]};

test('Google Play configuration gates retain free and owner behavior with optional legacy schema',async t=>{
 const f=await fixture(t,{playSchema:false});f.env.GOOGLE_PLAY_BILLING_ENABLED='false';
 assert.equal(paidBillingEnabled(f.env),false);assert.equal(livePaidBillingEnabled(f.env),false);
 assert.equal((await readPersonalPaidAccess(f.env,USER)).premiumAccess,false);
 assert.equal((await (await status({request:request(),env:f.env})).json()).premiumAccess,false);
 f.env.BB_OWNER_USER_ID=USER;
 assert.equal((await (await status({request:request(),env:f.env})).json()).tier,'owner');
 await eraseAccountD1(f.env,USER,billing);
 f.env.GOOGLE_PLAY_BILLING_ENABLED='true';f.env.GOOGLE_PLAY_BILLING_MODE='test';
 assert.equal(paidBillingEnabled(f.env),true);assert.equal(livePaidBillingEnabled(f.env),false);
 await assert.rejects(()=>readPersonalPaidAccess(f.env,PARTNER),/temporarily unavailable/);
 await assert.rejects(()=>eraseAccountD1(f.env,USER,billing),/google_play_cleanup_unavailable/);
 f.env.GOOGLE_PLAY_BILLING_MODE='live';f.env.GOOGLE_PLAY_LIVE_BILLING_ENABLED='false';
 assert.equal(paidBillingEnabled(f.env),false);assert.equal(livePaidBillingEnabled(f.env),false);
});

test('Play configuration cannot remove an existing beta grant or the explicit production owner sharing grant',async t=>{
 const f=await fixture(t);f.env.GOOGLE_PLAY_PRIVATE_KEY='invalid';f.env.BB_TESTFLIGHT_BETA_ENABLED='true';
 await persistTestFlightBetaGrant(f.env,USER,{receiptType:'Sandbox',bundleId:'uk.co.basketboss.app',appTransactionId:'1234567890',applicationVersion:'8',receiptCreationDate:Date.now()-1000});
 assert.equal((await readPersonalPaidAccess(f.env,USER)).provider,'testflight_beta');
 Object.assign(f.env,{BB_TESTFLIGHT_BETA_ENABLED:'false',BB_OWNER_USER_ID:USER,BB_OWNER_HOUSEHOLD_ENABLED:'true'});
 assert.equal((await readPersonalPaidAccess(f.env,USER,{productionOnly:true,includeOwnerHousehold:true})).provider,'owner_household');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_google_play_subscriptions').get().n,0);
});

test('verified Play status exposes management metadata without tokens, account IDs or provider payloads',async t=>{
 const f=await fixture(t),row=await playRow(f,{plan:'annual'});
 const response=await status({request:request(),env:f.env}),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.provider,'google_play');assert.equal(body.premiumAccess,true);assert.equal(body.mode,'live');
 assert.deepEqual(Object.keys(body.subscription).sort(),['provider','productId','plan','status','currentPeriodEndsAt','cancelAtPeriodEnd','environment'].sort());
 assert.equal(body.subscription.plan,'annual');assert.equal(body.subscription.environment,'production');assert.equal(body.portalUrl,null);
 for(const secret of [row.token,row.hash,row.account,'PRIVATE KEY','lineage_id'])assert.equal(JSON.stringify(body).includes(secret),false);
});

test('Play cancellation and grace retain paid access only through verified expiry',async t=>{
 const f=await fixture(t);await playRow(f);
 for(const [state,expires,expected] of [['active',Date.now()+3600000,true],['canceled',Date.now()+3600000,true],['grace_period',Date.now()+3600000,true],['expired',Date.now()-1,false],['on_hold',Date.now()+3600000,false],['paused',Date.now()+3600000,false],['pending',Date.now()+3600000,false],['active',Date.now()-1,false]]){
  f.sql.prepare('UPDATE bb_google_play_subscriptions SET status=?,expires_at_ms=?,cancel_at_period_end=?').run(state,expires,Number(state==='canceled'));
  const access=await readPersonalPaidAccess(f.env,USER);assert.equal(access.premiumAccess,expected,state);
  const body=await (await status({request:request(),env:f.env})).json();assert.equal(body.premiumAccess,expected,state);assert.equal(body.provider,'google_play');
 }
});

test('healthy Play, Apple and Paddle each survive unrelated provider outages, including status prefetch',async t=>{
 const f=await fixture(t);await playRow(f);
 f.env.BB_BILLING_ENABLED='true';f.env.APPLE_BILLING_ENABLED='true';f.env.APPLE_KEY_ID='';
 f.db.fail=query=>{if(query.includes('FROM bb_paid_entitlements'))throw Error('synthetic Paddle read outage');};
 assert.equal((await readPersonalPaidAccess(f.env,USER)).provider,'google_play');
 assert.equal((await (await status({request:request(),env:f.env})).json()).provider,'google_play');
 f.env.APPLE_KEY_ID='ABCDEFGHIJ';appleRow(f);f.env.GOOGLE_PLAY_PRIVATE_KEY='invalid';
 assert.equal((await readPersonalPaidAccess(f.env,USER)).provider,'apple');
 assert.equal((await (await status({request:request(),env:f.env})).json()).provider,'apple');
 f.db.fail=null;webRow(f);f.env.APPLE_KEY_ID='';
 assert.equal((await readPersonalPaidAccess(f.env,USER)).provider,'paddle');
 assert.equal((await (await status({request:request(),env:f.env})).json()).provider,'paddle');
});

test('provider outages fail closed when no independently verified membership remains',async t=>{
 const f=await fixture(t);await playRow(f,{status:'expired',expiresAtMs:Date.now()-1});
 f.env.APPLE_BILLING_ENABLED='true';f.env.APPLE_KEY_ID='';t.mock.method(console,'error',()=>{});
 await assert.rejects(()=>readPersonalPaidAccess(f.env,USER),/configured/);
 const response=await status({request:request(),env:f.env});assert.equal(response.status,503);assert.equal((await response.json()).premium,false);
});

test('Play prevents a duplicate Paddle charge even when Apple verification is unavailable',async t=>{
 const f=await fixture(t);await playRow(f);Object.assign(f.env,{BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'sandbox',APPLE_BILLING_ENABLED:'true',APPLE_KEY_ID:''});
 const response=await checkout({request:request('/api/subscription/checkout',USER,{plan:'standard'}),env:f.env});
 assert.equal(response.status,409);assert.equal((await response.json()).provider,'google_play');assert.equal(f.remote.length,0);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_billing_claims').get().n,0);
});

test('resumable Play states deny Paddle and Apple purchases without granting Premium or being hidden by expired history',async t=>{
 const f=await fixture(t),resumable=await playRow(f,{status:'pending',lastVerifiedAtMs:Date.now()-1000});
 await playRow(f,{token:'newer-expired-google-token',status:'expired',expiresAtMs:Date.now()-1});
 Object.assign(f.env,{BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'sandbox',APPLE_BILLING_ENABLED:'true'});
 for(const state of ['pending','on_hold','paused']){
  f.sql.prepare('UPDATE bb_google_play_subscriptions SET status=? WHERE token_hash=?').run(state,resumable.hash);
  assert.equal((await readPersonalPaidAccess(f.env,USER)).premiumAccess,false,state);
  const web=await checkout({request:request('/api/subscription/checkout',USER,{plan:'standard'}),env:f.env});
  assert.equal(web.status,409,state);assert.equal((await web.json()).provider,'google_play');
  const apple=await appleContext({request:request('/api/apple/purchase-context',USER,{productId:'uk.co.basketboss.premium.monthly'},'capacitor://localhost'),env:f.env});
  const body=await apple.json();assert.equal(apple.status,409,state);assert.equal(body.provider,'google_play');assert.equal(body.canPurchase,false);assert.equal(body.appAccountToken,undefined);
 }
 assert.equal(f.remote.length,0);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_billing_claims').get().n,0);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_account_tokens').get().n,0);
});

test('an expired Play subscription leaves a free account eligible for ordinary Apple and Paddle contexts',async t=>{
 const f=await fixture(t);await playRow(f,{status:'expired',expiresAtMs:Date.now()-1});
 Object.assign(f.env,{BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'sandbox',APPLE_BILLING_ENABLED:'true'});
 const apple=await appleContext({request:request('/api/apple/purchase-context',USER,{productId:'uk.co.basketboss.premium.monthly'},'capacitor://localhost'),env:f.env});
 assert.equal(apple.status,200);assert.equal((await apple.json()).canPurchase,true);assert.equal((await readPersonalPaidAccess(f.env,USER)).premiumAccess,false);
 const web=await checkout({request:request('/api/subscription/checkout',USER,{plan:'standard'}),env:f.env});assert.equal(web.status,200);assert.equal(f.remote.length,1);
});

test('Paddle checkout remains unchanged when Play is disabled and fails closed on unverified Play',async t=>{
 const f=await fixture(t);Object.assign(f.env,{BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'sandbox',GOOGLE_PLAY_PRIVATE_KEY:'invalid'});
 t.mock.method(console,'error',()=>{});
 let response=await checkout({request:request('/api/subscription/checkout',USER,{plan:'standard'}),env:f.env});assert.equal(response.status,503);assert.equal(f.remote.length,0);
 f.env.GOOGLE_PLAY_BILLING_ENABLED='false';
 response=await checkout({request:request('/api/subscription/checkout',USER,{plan:'standard'}),env:f.env});assert.equal(response.status,200);assert.equal(f.remote.length,1);
});

test('Apple purchase context blocks verified Play despite an unrelated Paddle lookup outage',async t=>{
 const f=await fixture(t);await playRow(f);f.env.APPLE_BILLING_ENABLED='true';
 f.db.fail=query=>{if(query.includes('FROM bb_paid_entitlements'))throw Error('synthetic Paddle read outage');};
 const response=await appleContext({request:request('/api/apple/purchase-context',USER,{productId:'uk.co.basketboss.premium.monthly'},'capacitor://localhost'),env:f.env});
 const body=await response.json();assert.equal(response.status,409);assert.equal(body.provider,'google_play');assert.equal(body.canPurchase,false);
 assert.equal(body.appAccountToken,undefined);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_account_tokens').get().n,0);
});

test('Apple purchase context fails closed on Play outage and preserves healthy Apple and web guards',async t=>{
 const f=await fixture(t);f.env.APPLE_BILLING_ENABLED='true';f.env.GOOGLE_PLAY_PRIVATE_KEY='invalid';
 const invoke=()=>appleContext({request:request('/api/apple/purchase-context',USER,{productId:'uk.co.basketboss.premium.monthly'},'capacitor://localhost'),env:f.env});
 assert.equal((await invoke()).status,503);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_account_tokens').get().n,0);
 appleRow(f);let response=await invoke();assert.equal(response.status,409);assert.equal((await response.json()).provider,'apple');
 webRow(f);response=await invoke();assert.equal(response.status,409);assert.equal((await response.json()).provider,'paddle');
});

test('production Play alone enables verified household sharing without exposing owner billing to the partner',async t=>{
 const f=await fixture(t);await playRow(f);link(f);
 assert.equal(livePaidBillingEnabled(f.env),true);
 assert.equal(await sharedHouseholdPremiumOwner(request('/api/household',PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),USER);
 const access=await readMemberPaidAccess(request('/api/subscription/status',PARTNER),f.env,{id:PARTNER,email:email(PARTNER)});assert.equal(access.provider,'household');assert.equal(access.householdOwnerId,USER);
 const body=await (await status({request:request('/api/subscription/status',PARTNER),env:f.env})).json();assert.equal(body.premiumAccess,true);assert.equal(body.householdRole,'partner');assert.equal(body.subscription,null);
 const household=await (await householdGet({request:request('/api/household',PARTNER),env:f.env})).json();assert.equal(household.configured,true);assert.equal(household.premium,true);assert.equal(household.role,'partner');
 const invite=await householdPost({request:request('/api/household',USER,{action:'invite',email:'invite@example.test'}),env:f.env});assert.equal(invite.status,200);
});

test('Play test purchases stay personal even alongside another production provider gate',async t=>{
 const f=await fixture(t,{mode:'test'});await playRow(f,{environment:'test'});link(f);
 assert.equal((await readPersonalPaidAccess(f.env,USER)).provider,'google_play');assert.equal((await readPersonalPaidAccess(f.env,USER,{productionOnly:true})).premiumAccess,false);
 assert.equal((await (await status({request:request(),env:f.env})).json()).mode,'sandbox');
 assert.equal((await (await householdGet({request:request('/api/household',PARTNER),env:f.env})).json()).configured,false);
 f.env.APPLE_BILLING_ENABLED='true';
 assert.equal(await sharedHouseholdPremiumOwner(request('/api/household',PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),null);
 assert.equal((await (await householdGet({request:request('/api/household',PARTNER),env:f.env})).json()).premium,false);
 assert.equal((await householdPost({request:request('/api/household',USER,{action:'invite',email:'invite@example.test'}),env:f.env})).status,403);
});

test('Play household grants retain partner identity, accepted invitation and newest-session guards',async t=>{
 const f=await fixture(t);await playRow(f);link(f);
 for(const mutation of [{invite_status:'pending'},{partner_email:'wrong@example.test'},{partner_user_id:OTHER}]){
  link(f);Object.assign(f.household,mutation);
  assert.equal(await sharedHouseholdPremiumOwner(request('/api/household',PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),null);
 }
 link(f);f.currentSession=false;
 assert.equal((await householdGet({request:request('/api/household',PARTNER),env:f.env})).status,403);
});

test('Play household access survives a Paddle outage and stops after the owner deletion barrier',async t=>{
 const f=await fixture(t);await playRow(f);link(f);f.env.BB_BILLING_ENABLED='true';
 f.db.fail=query=>{if(query.includes('FROM bb_paid_entitlements'))throw Error('synthetic Paddle read outage');};
 assert.equal(await sharedHouseholdPremiumOwner(request('/api/household',PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),USER);
 f.db.fail=null;f.env.BB_BILLING_ENABLED='false';await barrier(f);
 await assert.rejects(()=>readPersonalPaidAccess(f.env,USER),/deletion/);
 await assert.rejects(()=>sharedHouseholdPremiumOwner(request('/api/household',PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),/deletion/);
});

test('Play erasure requires the actor barrier and atomically tombstones every token before raw cleanup',async t=>{
 const f=await fixture(t),one=await playRow(f),two=await playRow(f,{token:'synthetic-second-token',plan:'annual'}),foreign=await playRow(f,{userId:OTHER});
 for(const row of [one,two,foreign]){f.sql.prepare('INSERT INTO bb_google_play_notifications VALUES(?,?,?)').run(row.hash,row.hash,Date.now());f.sql.prepare('INSERT INTO bb_google_play_leases VALUES(?,?,?)').run(row.hash,1,0);}
 await assert.rejects(()=>eraseAccountD1(f.env,USER,billing),/account_deletion_barrier_required/);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_google_play_subscriptions WHERE user_id=?').get(USER).n,2);
 await barrier(f);f.db.executed.length=0;await eraseAccountD1(f.env,USER,billing);
 const refs=f.sql.prepare('SELECT ref_hash FROM bb_account_deletion_refs').all().map(row=>row.ref_hash).sort();
 assert.deepEqual(refs,[await digestDeletionRef('google_play_token',one.hash),await digestDeletionRef('google_play_token',two.hash)].sort());
 for(const table of ['bb_google_play_subscriptions','bb_google_play_lineages','bb_google_play_account_tokens']){
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE user_id=?').get(USER).n,0);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE user_id=?').get(OTHER).n,1);
 }
 for(const table of ['bb_google_play_notifications','bb_google_play_leases'])assert.equal(f.sql.prepare('SELECT token_hash FROM '+table).get().token_hash,foreign.hash);
 const tombstone=f.db.executed.findIndex(query=>query.startsWith('INSERT OR IGNORE INTO bb_account_deletion_refs'));
 const cleanup=f.db.executed.findIndex(query=>query.startsWith('DELETE FROM bb_google_play_'));assert.ok(tombstone>=0&&tombstone<cleanup);
 await eraseAccountD1(f.env,USER,billing);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_account_deletion_refs').get().n,2);
});

test('Play cleanup failures roll back tombstones and raw rows, and deleted tokens cannot restore to another account',async t=>{
 const f=await fixture(t),row=await playRow(f);await barrier(f);
 f.sql.exec("CREATE TRIGGER fail_play_cleanup BEFORE DELETE ON bb_google_play_account_tokens BEGIN SELECT RAISE(ABORT,'synthetic Play cleanup failure'); END");
 await assert.rejects(()=>eraseAccountD1(f.env,USER,billing),/synthetic Play cleanup failure/);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_google_play_subscriptions').get().n,1);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_account_deletion_refs').get().n,0);
 f.sql.exec('DROP TRIGGER fail_play_cleanup');await eraseAccountD1(f.env,USER,billing);
 await googlePlayAccountId(f.env,PARTNER,{create:true});let calls=0;
 await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,getVerifiedGooglePlayConfig(f.env),PARTNER,row.token,{api:{get:async()=>{calls++;throw Error('must not call Play');},acknowledge:async()=>{calls++;}}}),error=>error.code==='google_play_account_mismatch');
 assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_google_play_subscriptions').get().n,0);
});
