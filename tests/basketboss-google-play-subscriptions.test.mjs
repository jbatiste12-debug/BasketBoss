import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync} from 'node:crypto';
import {ensureDeletionSchema,digestDeletionActor,digestDeletionRef} from '../bb-server-lib/bb-account-deletion.js';
import {googlePlayBillingEnabled,liveGooglePlayBillingEnabled,getVerifiedGooglePlayConfig,googlePlayAccountId,googlePlayTokenHash,evaluateGooglePlaySubscription,googlePlayEntitlementFromRow,reconcileGooglePlayPurchase,readGooglePlayEntitlement} from '../bb-server-lib/bb-google-play-subscriptions.js';
import {onRequestGet as configEndpoint} from '../functions/api/google-play/config.js';
import {onRequestPost as contextEndpoint} from '../functions/api/google-play/purchase-context.js';
import {onRequestPost as verifyEndpoint} from '../functions/api/google-play/verify.js';
import {purchaseIntentActor,reservePurchaseIntent,startPurchaseIntent,readPurchaseIntent} from '../bb-server-lib/bb-purchase-intents.js';
import {googlePlayRequestJSON} from '../bb-server-lib/bb-google-play-http.js';
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const TOKEN='fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NEW='fixture-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PRODUCT='basketboss_premium';
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../sql/basketboss_google_play_subscriptions_20261121.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER); CREATE TABLE bb_billing_claims(user_id TEXT,claim_state TEXT)');
 const db={sql,before:null,prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){db.before?.(query,args);return sql.prepare(query).get(...args)||null;},async all(){db.before?.(query,args);return {results:sql.prepare(query).all(...args)};},async run(){db.before?.(query,args);const r=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}};},async batch(list){sql.exec('BEGIN');try{const result=[];for(const statement of list)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};return db;
}
async function fixture(){
 const db=database(),env={BILLING_DB:db,GOOGLE_PLAY_BILLING_ENABLED:'true',GOOGLE_PLAY_BILLING_MODE:'test',GOOGLE_PLAY_TEST_USER_IDS:USER,GOOGLE_PLAY_PRODUCT_ID:PRODUCT,
  GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID:'monthly',GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID:'annual',GOOGLE_PLAY_MONTHLY_OFFER_IDS:'seven-day',
  GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL:'billing@fixture-project.iam.gserviceaccount.com',GOOGLE_PLAY_PRIVATE_KEY:privateKey,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key'};
 Object.assign(env,{GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL:'push@fixture-project.iam.gserviceaccount.com',GOOGLE_PLAY_PUBSUB_AUDIENCE:'https://basketboss.co.uk/api/google-play/notifications',GOOGLE_PLAY_PUBSUB_SUBSCRIPTION:'projects/fixture-project/subscriptions/play-events'});
 await ensureDeletionSchema(env);const config=getVerifiedGooglePlayConfig(env),accountId=await googlePlayAccountId(env,USER,{create:true});
 return {db,env,config,accountId};
}
function purchase(f,extra={}){return {startTime:new Date(Date.now()-1000).toISOString(),subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',acknowledgementState:'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
 testPurchase:{},externalAccountIdentifiers:{obfuscatedExternalAccountId:f.accountId},lineItems:[{productId:PRODUCT,expiryTime:new Date(Date.now()+3600000).toISOString(),autoRenewingPlan:{autoRenewEnabled:true},offerDetails:{basePlanId:'monthly'}}],...extra};}
const apiFor=value=>({get:async()=>value,acknowledge:async()=>{}});
const rejects=code=>error=>error?.code===code;
function request(path,body){return new Request('https://basketboss.co.uk/api/google-play/'+path,{method:'POST',headers:{Origin:'https://localhost',Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)});}

test('Play is default-off and live needs an independent explicit gate; invalid credentials/allowlists fail closed',async()=>{
 assert.equal(googlePlayBillingEnabled({}),false);assert.equal(getVerifiedGooglePlayConfig({}),null);
 const f=await fixture();assert.equal(liveGooglePlayBillingEnabled(f.env),false);
 assert.equal(getVerifiedGooglePlayConfig({...f.env,GOOGLE_PLAY_BILLING_MODE:'live'}),null);
 assert.equal(getVerifiedGooglePlayConfig({...f.env,GOOGLE_PLAY_BILLING_MODE:'live',GOOGLE_PLAY_LIVE_BILLING_ENABLED:'true'}).mode,'live');
 for(const change of [{GOOGLE_PLAY_PRIVATE_KEY:'bad'},{GOOGLE_PLAY_TEST_USER_IDS:''},{GOOGLE_PLAY_TEST_USER_IDS:'not-a-user'},{GOOGLE_PLAY_PACKAGE_NAME:'evil.app'},{GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID:'monthly'},{GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL:''},{GOOGLE_PLAY_PUBSUB_AUDIENCE:'http://evil.invalid'},{GOOGLE_PLAY_PUBSUB_SUBSCRIPTION:'other'}])assert.throws(()=>getVerifiedGooglePlayConfig({...f.env,...change}),rejects('google_play_not_configured'));
 const response=await configEndpoint({env:{},request:new Request('https://basketboss.co.uk/api/google-play/config')});
 const body=await response.json();assert.equal(body.available,false);assert.deepEqual(body.productIds,[]);assert.equal(JSON.stringify(body).includes('price'),false);
});

test('live sales remain fenced while configured authenticated accounts can restore existing purchases',async t=>{
 const f=await fixture(),live={...f.env,GOOGLE_PLAY_BILLING_MODE:'live',GOOGLE_PLAY_LIVE_BILLING_ENABLED:'true'};
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:USER,email:'fixture@example.invalid',email_confirmed_at:'2026-11-01T00:00:00Z'}));
 const response=await configEndpoint({env:live,request:new Request('https://basketboss.co.uk/api/google-play/config',{headers:{Authorization:'Bearer fixture'}})});
 const body=await response.json();assert.equal(body.available,false);assert.equal(body.restoreAvailable,true);assert.equal(body.reason,'google_play_live_checkout_not_ready');assert.deepEqual(body.productIds,[PRODUCT]);assert.equal(body.packageName,'uk.co.basketboss.app');assert.equal(body.mode,'live');assert.equal(body.plans.length,2);
 const context=await contextEndpoint({env:live,request:request('purchase-context',{productId:PRODUCT,basePlanId:'monthly',offerId:null})});
 assert.equal(context.status,503);assert.equal((await context.json()).code,'google_play_live_checkout_not_ready');
 assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM bb_google_play_subscriptions').get().n,0);
});

test('restore configuration remains closed for disabled services, invalid identities and account state',async t=>{
 for(const mode of ['disabled','live_gate','missing_auth','unconfirmed','wrong_account','deleting','schema','credentials']){
  const f=await fixture();let user={id:USER,email:'fixture@example.invalid',email_confirmed_at:'2026-11-01T00:00:00Z'};
  if(mode==='disabled')f.env.GOOGLE_PLAY_BILLING_ENABLED='false';
  if(mode==='live_gate')f.env.GOOGLE_PLAY_BILLING_MODE='live';
  if(mode==='unconfirmed')delete user.email_confirmed_at;
  if(mode==='wrong_account')user.id=OTHER;
  if(mode==='deleting')f.db.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(USER),'fixture',Date.now());
  if(mode==='schema')f.db.sql.exec('DROP TABLE bb_google_play_schema');
  if(mode==='credentials')f.env.GOOGLE_PLAY_PRIVATE_KEY='not-a-private-key';
  t.mock.method(globalThis,'fetch',async()=>Response.json(user));
  const request=new Request('https://basketboss.co.uk/api/google-play/config',{headers:mode==='missing_auth'?{}:{Authorization:'Bearer fixture'}});
  const body=await (await configEndpoint({env:f.env,request})).json();
  assert.equal(body.available,false,mode);assert.equal(body.restoreAvailable,false,mode);assert.deepEqual(body.productIds,[],mode);assert.deepEqual(body.plans,[],mode);assert.equal(body.packageName,undefined,mode);
  t.mock.restoreAll();f.db.sql.close();
 }
});

test('Google account/product/base plan/offer/test proof restrictions cannot be replaced with client claims',async()=>{
 const f=await fixture(),valid=purchase(f);assert.equal(evaluateGooglePlaySubscription(f.config,valid,f.accountId,USER).plan,'monthly');
 for(const invalid of [{...valid,externalAccountIdentifiers:{}},{...valid,externalAccountIdentifiers:{obfuscatedExternalAccountId:'x'.repeat(64)}},{...valid,testPurchase:undefined},
  {...valid,lineItems:[{...valid.lineItems[0],productId:'fake'}]},{...valid,lineItems:[{...valid.lineItems[0],offerDetails:{basePlanId:'unknown'}}]},
  {...valid,lineItems:[{...valid.lineItems[0],offerDetails:{basePlanId:'monthly',offerId:'unapproved'}}]},
  {...valid,lineItems:[valid.lineItems[0],valid.lineItems[0]]},{...valid,acknowledgementState:'client_says_paid'}])assert.throws(()=>evaluateGooglePlaySubscription(f.config,invalid,f.accountId,USER));
 assert.throws(()=>evaluateGooglePlaySubscription({...f.config,mode:'live'},valid,f.accountId,OTHER),rejects('google_play_environment_mismatch'));
});

test('each verified Play lifecycle state and the local expiry clock control access, not auto renewal alone',async()=>{
 const f=await fixture();
 for(const [suffix,allowed] of [['ACTIVE',true],['CANCELED',true],['IN_GRACE_PERIOD',true],['ON_HOLD',false],['PAUSED',false],['PENDING',false],['PENDING_PURCHASE_CANCELED',false],['EXPIRED',false]]){
  const saved=await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_'+suffix}))});
  const access=googlePlayEntitlementFromRow(f.config,saved);assert.equal(access.premiumAccess,allowed,suffix);
  assert.equal(googlePlayEntitlementFromRow(f.config,saved,saved.expires_at_ms+1).premiumAccess,false);
 }
 const canceled=await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_CANCELED'}))});
 assert.equal(googlePlayEntitlementFromRow(f.config,canceled).cancelAtPeriodEnd,true);
});

test('acknowledgment follows durable ownership, failures grant no Premium, and same-owner retries are idempotent',async()=>{
 const f=await fixture(),pending=purchase(f,{acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING'});let acknowledgments=0;
 const api={get:async()=>pending,acknowledge:async()=>{acknowledgments++;const row=f.db.sql.prepare('SELECT * FROM bb_google_play_subscriptions').get();assert.equal(row.user_id,USER);assert.equal(row.acknowledged,0);throw Error('synthetic transport failure');}};
 await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api}));
 assert.equal(googlePlayEntitlementFromRow(f.config,f.db.sql.prepare('SELECT * FROM bb_google_play_subscriptions').get()).premiumAccess,false);
 api.acknowledge=async()=>{acknowledgments++;};
 const saved=await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api});assert.equal(saved.acknowledged,1);assert.equal(googlePlayEntitlementFromRow(f.config,saved).premiumAccess,true);
 await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))});
 assert.equal(acknowledgments,2);assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM bb_google_play_subscriptions').get().n,1);
});

test('same-token claims never transfer ownership and linked replacements retire the old lineage head',async()=>{
 const f=await fixture();await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))});
 const otherEnv={...f.env,GOOGLE_PLAY_TEST_USER_IDS:USER+','+OTHER},otherId=await googlePlayAccountId(otherEnv,OTHER,{create:true});
 await assert.rejects(()=>reconcileGooglePlayPurchase(otherEnv,getVerifiedGooglePlayConfig(otherEnv),OTHER,TOKEN,{api:apiFor(purchase(f,{externalAccountIdentifiers:{obfuscatedExternalAccountId:otherId}}))}),rejects('google_play_account_mismatch'));
 const replacement=await reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(purchase(f,{linkedPurchaseToken:TOKEN}))});
 assert.equal(googlePlayEntitlementFromRow(f.config,replacement).premiumAccess,true);
 const old=f.db.sql.prepare('SELECT * FROM bb_google_play_subscriptions WHERE token_hash=?').get(await googlePlayTokenHash(TOKEN));
 assert.equal(old.replaced_by_hash,await googlePlayTokenHash(NEW));assert.equal(googlePlayEntitlementFromRow(f.config,old).premiumAccess,false);
 await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))}),rejects('google_play_purchase_replaced'));
});

test('Play-center resubscription captures verified expired account context before acknowledgment removes it',async()=>{
 const f=await fixture();await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_EXPIRED'}))});
 const restored=purchase(f,{externalAccountIdentifiers:undefined,acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING',outOfAppPurchaseContext:{expiredPurchaseToken:TOKEN,expiredExternalAccountIdentifiers:{obfuscatedExternalAccountId:f.accountId}}});
 const saved=await reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(restored)});assert.equal(saved.acknowledged,1);
 const subsequent=await reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(purchase(f,{externalAccountIdentifiers:undefined}))});
 assert.equal(googlePlayEntitlementFromRow(f.config,subsequent).premiumAccess,true);
 await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,f.config,USER,NEW+'x',{api:apiFor({...restored,outOfAppPurchaseContext:{...restored.outOfAppPurchaseContext,expiredExternalAccountIdentifiers:{obfuscatedExternalAccountId:'x'.repeat(64)}}})}),rejects('google_play_account_mismatch'));
});

test('lease generations reject concurrent claims and expired stale API snapshots cannot revive a later expiry',async()=>{
 const f=await fixture();let continueFirst,entered;const gate=new Promise(resolve=>{continueFirst=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const first=reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:{get:async()=>{entered();await gate;return purchase(f);},acknowledge:async()=>{}}});
 await started;await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))}),rejects('google_play_verification_pending'));
 f.db.sql.prepare('UPDATE bb_google_play_leases SET locked_until_ms=0').run();
 const revoked=await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_EXPIRED'}))});
 assert.equal(revoked.status,'expired');continueFirst();await assert.rejects(()=>first,rejects('google_play_purchase_replaced'));
 assert.equal(f.db.sql.prepare('SELECT status FROM bb_google_play_subscriptions').get().status,'expired');
});

test('a current replacement head also rejects an older token response already in flight',async()=>{
 const f=await fixture();await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))});
 let resume,entered;const gate=new Promise(resolve=>{resume=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const old=reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:{get:async()=>{entered();await gate;return purchase(f);},acknowledge:async()=>{}}});
 await started;await reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(purchase(f,{linkedPurchaseToken:TOKEN}))});
 resume();await assert.rejects(()=>old,rejects('google_play_purchase_replaced'));
 assert.equal((await readGooglePlayEntitlement(f.env,USER)).premiumAccess,true);
});

test('a replacement cannot create a second lineage while its unknown predecessor verification is in flight',async()=>{
 const f=await fixture();let resume,entered;const gate=new Promise(resolve=>{resume=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const original=reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:{get:async()=>{entered();await gate;return purchase(f);},acknowledge:async()=>{}}});
 await started;
 await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(purchase(f,{linkedPurchaseToken:TOKEN}))}),rejects('google_play_previous_purchase_unverified'));
 assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM bb_google_play_lineages').get().n,0);
 resume();await original;
 await reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(purchase(f,{linkedPurchaseToken:TOKEN}))});
 const rows=f.db.sql.prepare('SELECT * FROM bb_google_play_subscriptions').all();assert.equal(rows.length,2);assert.equal(rows.filter(row=>googlePlayEntitlementFromRow(f.config,row).premiumAccess).length,1);
 assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM bb_google_play_lineages').get().n,1);
});

test('a pending linked replacement preserves the original subscription until its payment completes',async()=>{
 const f=await fixture();await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))});
 await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(purchase(f,{linkedPurchaseToken:TOKEN,subscriptionState:'SUBSCRIPTION_STATE_PENDING',acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING'}))}),rejects('google_play_verification_pending'));
 const original=f.db.sql.prepare('SELECT * FROM bb_google_play_subscriptions').get();assert.equal(original.replaced_by_hash,null);assert.equal(googlePlayEntitlementFromRow(f.config,original).premiumAccess,true);
});

test('historical test rows cannot hide valid production access after removing a tester from the allowlist',async()=>{
 const f=await fixture();await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))});
 const live={...f.env,GOOGLE_PLAY_BILLING_MODE:'live',GOOGLE_PLAY_LIVE_BILLING_ENABLED:'true',GOOGLE_PLAY_TEST_USER_IDS:''},config=getVerifiedGooglePlayConfig(live);
 await reconcileGooglePlayPurchase(live,config,USER,NEW,{api:apiFor(purchase(f,{testPurchase:undefined}))});
 f.db.sql.prepare('UPDATE bb_google_play_subscriptions SET last_verified_at_ms=? WHERE token_hash=?').run(Date.now()-120000,await googlePlayTokenHash(TOKEN));
 const access=await readGooglePlayEntitlement(live,USER);assert.equal(access.premiumAccess,true);assert.equal(access.environment,'production');
 // With testing still enabled and its row newest, production still wins.
 f.db.sql.prepare('UPDATE bb_google_play_subscriptions SET last_verified_at_ms=? WHERE token_hash=?').run(Date.now()+1,await googlePlayTokenHash(TOKEN));
 assert.equal((await readGooglePlayEntitlement({...live,GOOGLE_PLAY_TEST_USER_IDS:USER},USER)).environment,'production');
});

test('a failed historical-token refresh preserves an independent fresh grant and fails closed when none verifies',async t=>{
 const f=await fixture();await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))});
 await reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_EXPIRED'}))});
 f.db.sql.prepare('UPDATE bb_google_play_subscriptions SET last_verified_at_ms=? WHERE token_hash=?').run(Date.now()-120000,await googlePlayTokenHash(NEW));
 t.mock.method(globalThis,'fetch',async()=>{throw Error('synthetic provider unavailable');});
 assert.equal((await readGooglePlayEntitlement(f.env,USER)).premiumAccess,true);
 f.db.sql.prepare('UPDATE bb_google_play_subscriptions SET last_verified_at_ms=?').run(Date.now()-120000);
 await assert.rejects(()=>readGooglePlayEntitlement(f.env,USER),rejects('google_play_unavailable'));
});

test('a newer expired record cannot hide an older resumable subscription from purchase guards',async()=>{
 const f=await fixture();await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_ON_HOLD'}))});
 await reconcileGooglePlayPurchase(f.env,f.config,USER,NEW,{api:apiFor(purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_EXPIRED'}))});
 f.db.sql.prepare('UPDATE bb_google_play_subscriptions SET last_verified_at_ms=? WHERE token_hash=?').run(Date.now()+1,await googlePlayTokenHash(NEW));
 const state=await readGooglePlayEntitlement(f.env,USER);assert.equal(state.premiumAccess,false);assert.equal(state.status,'on_hold');
});

test('deletion barriers block late persistence, acknowledgment completion, account creation and token tombstone replay',async()=>{
 const f=await fixture(),actor=await digestDeletionActor(USER);
 await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:{get:async()=>{f.db.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(actor,'fixture',Date.now());return purchase(f);},acknowledge:async()=>{throw Error('must not acknowledge');}}}));
 assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM bb_google_play_subscriptions').get().n,0);
 f.db.sql.exec('DELETE FROM bb_google_play_account_tokens');await assert.rejects(()=>googlePlayAccountId(f.env,USER,{create:true}),rejects('google_play_account_unavailable'));
 const g=await fixture();const tokenHash=await googlePlayTokenHash(TOKEN);
 g.db.sql.prepare('INSERT INTO bb_account_deletion_refs(ref_hash) VALUES(?)').run(await digestDeletionRef('google_play_token',tokenHash));
 await assert.rejects(()=>reconcileGooglePlayPurchase(g.env,g.config,USER,TOKEN,{api:apiFor(purchase(g))}),rejects('google_play_account_mismatch'));
 const h=await fixture();await assert.rejects(()=>reconcileGooglePlayPurchase(h.env,h.config,USER,TOKEN,{api:{get:async()=>purchase(h,{acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING'}),acknowledge:async()=>{h.db.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(USER),'fixture',Date.now());}}}),rejects('google_play_verification_pending'));
 assert.equal(h.db.sql.prepare('SELECT acknowledged FROM bb_google_play_subscriptions').get().acknowledged,0);
});

test('purchase context binds only an authenticated allowed account and refuses pending web checkout',async()=>{
 const f=await fixture(),original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{assert.equal(String(url),'https://fixture.supabase.co/auth/v1/user');return Response.json({id:USER,email:'fixture@example.invalid',email_confirmed_at:new Date().toISOString()});};
  const response=await contextEndpoint({env:f.env,request:request('purchase-context',{productId:PRODUCT,basePlanId:'monthly',offerId:null})});
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.obfuscatedAccountId,f.accountId);assert.equal(body.canPurchase,true);assert.equal(body.mode,'test');
  const config=await (await configEndpoint({env:f.env,request:new Request('https://basketboss.co.uk/api/google-play/config',{headers:{Authorization:'Bearer fixture'}})})).json();assert.equal(config.available,true);assert.equal(config.plans.length,2);assert.equal(JSON.stringify(config).includes('PRIVATE KEY'),false);
  f.db.sql.prepare('INSERT INTO bb_billing_claims VALUES(?,?)').run(USER,'checkout_created');
  assert.equal((await contextEndpoint({env:f.env,request:request('purchase-context',{productId:PRODUCT,basePlanId:'annual'})})).status,409);
  f.db.sql.exec('DELETE FROM bb_billing_claims');
  for(const state of ['PENDING','ON_HOLD','PAUSED']){
   await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_'+state}))});
   const blocked=await contextEndpoint({env:f.env,request:request('purchase-context',{productId:PRODUCT,basePlanId:'annual'})});
   assert.equal(blocked.status,409);assert.equal((await blocked.json()).reason,'google_play_subscription_pending');
  }
  const rejected=await verifyEndpoint({env:f.env,request:request('verify',{productId:'forged',purchaseToken:TOKEN})});assert.equal(rejected.status,400);
 }finally{globalThis.fetch=original;}
});

test('bounded request readers reject oversized and malformed JSON without processing a token',async()=>{
 await assert.rejects(()=>googlePlayRequestJSON(request('verify',{value:'x'.repeat(20000)})),rejects('request_too_large'));
 await assert.rejects(()=>googlePlayRequestJSON(new Request('https://basketboss.co.uk',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'})),rejects('invalid_request'));
});

const coordinationJWT=()=>[Buffer.from('{"alg":"ES256"}').toString('base64url'),Buffer.from(JSON.stringify({iss:'https://fixture.supabase.co/auth/v1',sub:USER,session_id:'33333333-3333-4333-8333-333333333333',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'syntheticSignature'].join('.');
function intentRequest(body){return new Request('https://basketboss.co.uk/api/google-play/purchase-context',{method:'POST',headers:{Origin:'https://localhost',Authorization:'Bearer '+coordinationJWT(),'Content-Type':'application/json'},body:JSON.stringify(body)});}
function enableIntents(f){f.db.sql.exec(readFileSync(new URL('../sql/basketboss_purchase_intents_20261121.sql',import.meta.url),'utf8'));Object.assign(f.env,{BB_PURCHASE_INTENTS_ENABLED:'true',BB_PURCHASE_INTENTS_STRICT:'true'});}

test('live checkout requires every explicit gate plus ready schema and the exact start protocol',async t=>{
 const f=await fixture();Object.assign(f.env,{GOOGLE_PLAY_BILLING_MODE:'live',GOOGLE_PLAY_LIVE_BILLING_ENABLED:'true',GOOGLE_PLAY_LIVE_CHECKOUT_ENABLED:'true'});
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:USER,email:'fixture@example.invalid',email_confirmed_at:'2026-11-01'}));
 const selection={productId:PRODUCT,basePlanId:'monthly',offerId:null,reservationProtocol:1};
 assert.equal((await contextEndpoint({env:f.env,request:intentRequest(selection)})).status,503);
 enableIntents(f);
 const config=await (await configEndpoint({env:f.env,request:intentRequest(selection)})).json();assert.equal(config.available,true);assert.equal(config.restoreAvailable,true);
 const legacy=await contextEndpoint({env:f.env,request:intentRequest({...selection,reservationProtocol:undefined})});assert.equal(legacy.status,426);assert.equal((await legacy.json()).code,'purchase_intent_upgrade_required');
 const response=await contextEndpoint({env:f.env,request:intentRequest(selection)}),body=await response.json();assert.equal(response.status,200);assert.equal(body.reservation.phase,'prepared');assert.equal(body.reservation.provider,'google_play');
 const actor=await purchaseIntentActor(intentRequest(selection),f.env);await startPurchaseIntent(f.env,actor,body.reservation);
 const blocked=await contextEndpoint({env:f.env,request:intentRequest({...selection,basePlanId:'annual'})});assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'purchase_intent_busy');
 f.db.sql.exec('DROP TABLE bb_purchase_intent_events');
 const unavailable=await (await configEndpoint({env:f.env,request:intentRequest(selection)})).json();assert.equal(unavailable.available,false);assert.equal(unavailable.restoreAvailable,true,'checkout schema failure must not remove restore');
});

test('verified store intent binding persists pending until acknowledgment succeeds; restored proof never needs a reservation',async()=>{
 const f=await fixture();enableIntents(f);const actor={userId:USER,sessionHash:'a'.repeat(64)};
 const prepared=await reservePurchaseIntent(f.env,actor,{provider:'google_play',mode:'test',productId:PRODUCT,basePlanId:'monthly',protocol:1});
 await startPurchaseIntent(f.env,actor,prepared);
 const value=purchase(f,{acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING',externalAccountIdentifiers:{obfuscatedExternalAccountId:f.accountId,obfuscatedExternalProfileId:prepared.id}});
 await assert.rejects(()=>reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:{get:async()=>value,acknowledge:async()=>{throw Error('synthetic offline');}}}));
 const held=await readPurchaseIntent(f.env,actor,{mode:'test'});assert.equal(held.id,prepared.id);assert.equal(held.phase,'unknown');assert.equal(f.db.sql.prepare('SELECT acknowledged FROM bb_google_play_subscriptions').get().acknowledged,0);
 const saved=await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(value)});assert.equal(saved.acknowledged,1);assert.equal(await readPurchaseIntent(f.env,actor,{mode:'test'}),null);assert.equal(f.db.sql.prepare('SELECT phase FROM bb_purchase_intents WHERE id=?').get(prepared.id).phase,'completed');
 const restored=await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))});assert.equal(googlePlayEntitlementFromRow(f.config,restored).premiumAccess,true);
});

test('unattributed historical Play proof cannot release a newer prepared checkout and prevents its start',async()=>{
 const f=await fixture();enableIntents(f);const actor={userId:USER,sessionHash:'a'.repeat(64)};
 const pending=await reservePurchaseIntent(f.env,actor,{provider:'apple',mode:'test',productId:'uk.co.basketboss.premium.monthly',protocol:1});
 await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:apiFor(purchase(f))});
 assert.equal((await readPurchaseIntent(f.env,actor,{mode:'test'})).id,pending.id);
 await assert.rejects(()=>startPurchaseIntent(f.env,actor,pending),error=>error.code==='purchase_intent_changed');
});

test('an authoritative expired unacknowledged Play purchase closes its attempt without acknowledgment or Premium',async()=>{
 const f=await fixture();enableIntents(f);const actor={userId:USER,sessionHash:'a'.repeat(64)};
 const prepared=await reservePurchaseIntent(f.env,actor,{provider:'google_play',mode:'test',productId:PRODUCT,basePlanId:'monthly',protocol:1});await startPurchaseIntent(f.env,actor,prepared);
 let acknowledgments=0;const value=purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_EXPIRED',acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING',externalAccountIdentifiers:{obfuscatedExternalAccountId:f.accountId,obfuscatedExternalProfileId:prepared.id}});
 const saved=await reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:{get:async()=>value,acknowledge:async()=>{acknowledgments++;}}});
 assert.equal(acknowledgments,0);assert.equal(googlePlayEntitlementFromRow(f.config,saved).premiumAccess,false);assert.equal(await readPurchaseIntent(f.env,actor,{mode:'test'}),null);assert.equal(f.db.sql.prepare('SELECT phase FROM bb_purchase_intents WHERE id=?').get(prepared.id).phase,'canceled');
});
