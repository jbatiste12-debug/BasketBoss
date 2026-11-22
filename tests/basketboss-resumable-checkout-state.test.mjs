import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ensureDeletionSchema} from '../bb-server-lib/bb-account-deletion.js';
import {getAppleServices,getVerifiedAppleConfig,persistAppleSubscription,readAppleEntitlement} from '../bb-server-lib/bb-apple-subscriptions.js';
import {readResumableCheckoutBlock} from '../bb-server-lib/bb-checkout-state.js';
import {purchaseIntentActor,startPurchaseIntent} from '../bb-server-lib/bb-purchase-intents.js';
import {onRequestPost as appleContext} from '../functions/api/apple/purchase-context.js';
import {onRequestPost as playContext} from '../functions/api/google-play/purchase-context.js';
import {onRequestPost as paddleContext} from '../functions/api/subscription/checkout.js';
const USER='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222',ACCOUNT='33333333-3333-4333-8333-333333333333';
const id=(prefix,c)=>prefix+'_'+c.repeat(26),PRICE=id('pri','p'),SUB=id('sub','s'),CUSTOMER=id('ctm','c');
const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const rsa=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const jwt=[Buffer.from('{"alg":"ES256"}').toString('base64url'),Buffer.from(JSON.stringify({iss:'https://fixture.supabase.co/auth/v1',sub:USER,session_id:SESSION,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'syntheticSignature'].join('.');
const signed=payload=>[Buffer.from(JSON.stringify({alg:'ES256',x5c:['YQ==','Yg==','Yw==']})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'syntheticSignature'].join('.');
function request(provider){const path=provider==='apple'?'/api/apple/purchase-context':provider==='google_play'?'/api/google-play/purchase-context':'/api/subscription/checkout';return new Request('https://basketboss.co.uk'+path,{method:'POST',headers:{Origin:provider==='apple'?'capacitor://localhost':provider==='google_play'?'https://localhost':'https://basketboss.co.uk',Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify(provider==='apple'?{productId:'uk.co.basketboss.premium.monthly',reservationProtocol:1}:provider==='google_play'?{productId:'basketboss_premium',basePlanId:'monthly',reservationProtocol:1}:{plan:'standard'})});}
async function fixture(t,{strict=true}={}){
 const sql=new DatabaseSync(':memory:');
 for(const path of ['basketboss_apple_subscriptions_20261101.sql','basketboss_google_play_subscriptions_20261121.sql','basketboss_purchase_intents_20261121.sql'])sql.exec(readFileSync(new URL('../sql/'+path,import.meta.url),'utf8'));
 sql.exec(`CREATE TABLE bb_paid_entitlements(paddle_subscription_id TEXT PRIMARY KEY,user_id TEXT,paddle_customer_id TEXT,claim_id TEXT,price_id TEXT,plan TEXT,status TEXT,trial_ends_at TEXT,current_period_ends_at TEXT,cancellation_effective_at TEXT,cancel_at_period_end INTEGER,last_occurred_at TEXT,updated_at_ms INTEGER);
 CREATE TABLE bb_billing_claims(claim_id TEXT PRIMARY KEY,user_id TEXT,plan TEXT,price_id TEXT,slot_no INTEGER,claim_state TEXT DEFAULT 'pending',transaction_id TEXT,created_at_ms INTEGER);
 CREATE TABLE bb_founder_slots(slot_no INTEGER PRIMARY KEY,state TEXT,user_id TEXT,reservation_token_hash TEXT,paddle_subscription_id TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER);`);
 let queue=Promise.resolve();const db={sql,prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const statement=sql.prepare(query);if(statement.columns().length)return {success:true,results:statement.all(...args)};const result=statement.run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};},batch(list){const work=queue.then(async()=>{sql.exec('BEGIN');try{const out=[];for(const item of list)out.push(await item.run());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}});queue=work.catch(()=>{});return work;}};
 const env={BILLING_DB:db,BB_PURCHASE_INTENTS_ENABLED:'true',BB_PURCHASE_INTENTS_STRICT:String(strict),SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-public',
 APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_SUBSCRIPTION_GROUP_ID:'12345678',APPLE_ISSUER_ID:'44444444-4444-4444-8444-444444444444',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:ec,
 GOOGLE_PLAY_BILLING_ENABLED:'true',GOOGLE_PLAY_BILLING_MODE:'live',GOOGLE_PLAY_LIVE_BILLING_ENABLED:'true',GOOGLE_PLAY_LIVE_CHECKOUT_ENABLED:'true',GOOGLE_PLAY_PRODUCT_ID:'basketboss_premium',GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID:'monthly',GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID:'annual',GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL:'billing@fixture-project.iam.gserviceaccount.com',GOOGLE_PLAY_PRIVATE_KEY:rsa,GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL:'push@fixture-project.iam.gserviceaccount.com',GOOGLE_PLAY_PUBSUB_AUDIENCE:'https://basketboss.co.uk/api/google-play/notifications',GOOGLE_PLAY_PUBSUB_SUBSCRIPTION:'projects/fixture-project/subscriptions/play-events',
 BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',BB_LIVE_CHECKOUT_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',PADDLE_LIVE_WEBHOOK_SECRET:'synthetic',PADDLE_LIVE_API_KEY:'synthetic',PADDLE_LIVE_STANDARD_PRICE_ID:PRICE};
 await ensureDeletionSchema(env);sql.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run(USER,ACCOUNT,Date.now());
 const calls=[],appleStates=new Map();let paddleStatus='past_due',patch={},appleReads=0;
 t.mock.method(globalThis,'fetch',async(url,options={})=>{if(String(url).endsWith('/auth/v1/user'))return Response.json({id:USER,email:'fixture@example.invalid',email_confirmed_at:'2026-01-01'});calls.push({url:String(url),method:options.method||'GET'});if(String(url)==='https://api.paddle.com/subscriptions/'+SUB)return Response.json({data:{id:SUB,customer_id:CUSTOMER,status:paddleStatus,items:[{quantity:1,price:{id:PRICE}}],...patch}});if(String(url)==='https://api.paddle.com/transactions'&&options.method==='POST')return Response.json({data:{id:id('txn','t')}});throw Error('Unexpected provider request');});
 const config=getVerifiedAppleConfig(env),service=await getAppleServices(env,config);
 // Existing cryptographic verifier suites validate signatures. These explicit
 // service mocks isolate fresh checkout-state interpretation and request routing.
 t.mock.method(service.verifier,'verifyAndDecodeTransaction',async value=>JSON.parse(Buffer.from(value.split('.')[1],'base64url')));
 t.mock.method(service.verifier,'verifyAndDecodeRenewalInfo',async value=>JSON.parse(Buffer.from(value.split('.')[1],'base64url')));
 t.mock.method(service.client,'getAllSubscriptionStatuses',async original=>{appleReads++;const state=appleStates.get(original);if(!state)throw Error('Missing synthetic Apple state');const tx={transactionId:state.transactionId,originalTransactionId:original,bundleId:config.bundleId,productId:config.products.monthly,subscriptionGroupIdentifier:config.groupId,type:'Auto-Renewable Subscription',quantity:1,inAppOwnershipType:'PURCHASED',appAccountToken:ACCOUNT,environment:'Production',purchaseDate:Date.now()-3600000,expiresDate:Date.now()-1000,signedDate:Date.now()};return {environment:'Production',bundleId:config.bundleId,appAppleId:config.appId,data:[{subscriptionGroupIdentifier:config.groupId,lastTransactions:[{originalTransactionId:original,status:state.status==='billing_retry'?3:2,signedTransactionInfo:signed(tx),signedRenewalInfo:signed({environment:'Production',originalTransactionId:original,productId:tx.productId,autoRenewStatus:1,signedDate:Date.now()})}]}]};});
 async function apple(status,original='20000000000000',updated=Date.now()){
  const transactionId=original.slice(0,-1)+'1';appleStates.set(original,{status,transactionId});
  await persistAppleSubscription(env,USER,{environment:'Production',originalTransactionId:original,appAccountToken:ACCOUNT,transactionId,productId:config.products.monthly,plan:'monthly',status,expiresAtMs:Date.now()-1000,graceExpiresAtMs:null,revokedAtMs:null,cancelAtPeriodEnd:false,appleSignedAtMs:updated,lastVerifiedAtMs:updated});
 }
 function paddle(status='past_due',subscriptionId=SUB,updated=1){sql.prepare('INSERT INTO bb_paid_entitlements(paddle_subscription_id,user_id,paddle_customer_id,price_id,plan,status,updated_at_ms) VALUES(?,?,?,?,?,?,?)').run(subscriptionId,USER,CUSTOMER,PRICE,'standard',status,updated);}
 t.after(()=>sql.close());
 return {env,sql,calls,apple,paddle,appleReads:()=>appleReads,setPaddle:(status,overrides={})=>{paddleStatus=status;patch=overrides;},context:provider=>(provider==='apple'?appleContext:provider==='google_play'?playContext:paddleContext)({request:request(provider),env})};
}

test('strict guard defaults off without querying providers or optional account state',async()=>{
 const env={BB_PURCHASE_INTENTS_ENABLED:'true',BB_PURCHASE_INTENTS_STRICT:'false',BILLING_DB:{prepare(){throw Error('Must not query');}}};
 assert.equal(await readResumableCheckoutBlock(env,USER),null);
});
test('all new checkout contexts reject fresh verified Apple billing retry without granting Premium',async t=>{
 for(const target of ['apple','google_play','paddle']){
  const f=await fixture(t);await f.apple('billing_retry');const response=await f.context(target),body=await response.json();
  assert.equal(response.status,409,target);assert.equal(body.provider,'apple');assert.equal(body.reason,'existing_subscription');assert.equal(body.canPurchase,false);assert.ok(f.appleReads()>0,'checkout forces current signed Apple state');assert.equal(f.calls.some(call=>call.method==='POST'),false);
  assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents ORDER BY created_at_ms DESC LIMIT 1').get().phase,'canceled');
 }
});
test('older Apple billing retry cannot hide behind newer inactive metadata, and normal status selection stays unchanged',async t=>{
 const f=await fixture(t);await f.apple('billing_retry');await f.apple('expired','20000000000010',Date.now()+1);
 assert.equal((await readAppleEntitlement(f.env,USER)).status,'expired');
 const blocked=await readResumableCheckoutBlock(f.env,USER);assert.equal(blocked.provider,'apple');assert.equal(blocked.reason,'existing_subscription');
});
test('all new checkout contexts reject authoritatively paused/past-due Paddle, including an older subscription',async t=>{
 for(const target of ['apple','google_play','paddle']){
  const f=await fixture(t);f.paddle('paused');f.paddle('canceled',id('sub','x'),2);f.setPaddle(target==='google_play'?'past_due':'paused');
  const response=await f.context(target),body=await response.json();assert.equal(response.status,409,target);assert.equal(body.provider,'paddle');assert.equal(body.reason,'existing_subscription');assert.equal(body.canPurchase,false);
  assert.equal(f.calls.filter(call=>call.url==='https://api.paddle.com/subscriptions/'+SUB).length,1);assert.equal(f.calls.some(call=>call.method==='POST'),false);
 }
});
test('fresh inactive Apple history permits a new coordinated start without changing status or its own billing revision',async t=>{
 const f=await fixture(t);await f.apple('expired');const before=f.sql.prepare('SELECT billing_revision FROM bb_purchase_intent_slots WHERE user_id=? AND mode=?').get(USER,'live').billing_revision;
 const response=await f.context('apple'),body=await response.json();assert.equal(response.status,200);assert.ok(f.appleReads()>0);
 const actor=await purchaseIntentActor(request('apple'),f.env);assert.equal((await startPurchaseIntent(f.env,actor,body.reservation)).phase,'started');
 assert.equal(f.sql.prepare('SELECT billing_revision FROM bb_purchase_intent_slots WHERE user_id=? AND mode=?').get(USER,'live').billing_revision,before);
});
test('Paddle current cancellation permits checkout while binding mismatch or unsupported state fails closed',async t=>{
 const f=await fixture(t);f.paddle('past_due');f.setPaddle('canceled');assert.equal(await readResumableCheckoutBlock(f.env,USER),null);
 for(const overrides of [{customer_id:id('ctm','x')},{items:[{quantity:1,price:{id:id('pri','x')}}]},{status:'unrecognised'}]){
  f.setPaddle('paused',overrides);await assert.rejects(()=>readResumableCheckoutBlock(f.env,USER),error=>error.code==='purchase_state_unavailable'&&error.status===503);
 }
 f.env.PADDLE_LIVE_API_KEY='';await assert.rejects(()=>readResumableCheckoutBlock(f.env,USER),error=>error.code==='purchase_state_unavailable');
});
test('default-off new checkout retains prior behavior for past-due Paddle instead of invoking the new guard',async t=>{
 const f=await fixture(t,{strict:false});f.paddle('past_due');const response=await f.context('apple');assert.equal(response.status,200);assert.equal(f.calls.length,0);
});
