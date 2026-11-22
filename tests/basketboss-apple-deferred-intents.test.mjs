import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ensureDeletionSchema,digestDeletionActor,digestDeletionRef} from '../bb-server-lib/bb-account-deletion.js';
import {getVerifiedAppleConfig,getAppleServices,persistAppleSubscription,readAppleEntitlement,resolveVerifiedAppleAccount} from '../bb-server-lib/bb-apple-subscriptions.js';
import {purchaseIntentActor,reservePurchaseIntent,startPurchaseIntent,reportPurchaseIntent,readPurchaseIntent} from '../bb-server-lib/bb-purchase-intents.js';
import {onRequestPost as contextEndpoint} from '../functions/api/apple/purchase-context.js';
import {onRequestPost as verifyEndpoint} from '../functions/api/apple/verify.js';
import {onRequestPost as notificationEndpoint} from '../functions/api/apple/notifications.js';
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',SESSION='33333333-3333-4333-8333-333333333333',LEGACY='44444444-4444-4444-8444-444444444444';
const PRODUCT='uk.co.basketboss.premium.monthly',ORIGINAL='20000000000000';
const key=generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const jwt=user=>[Buffer.from('{"alg":"ES256"}').toString('base64url'),Buffer.from(JSON.stringify({iss:'https://fixture.supabase.co/auth/v1',sub:user,session_id:SESSION,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'syntheticSignature'].join('.');
const signed=payload=>[Buffer.from(JSON.stringify({alg:'ES256',x5c:['YQ==','Yg==','Yw==']})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'syntheticSignature'].join('.');
function request(path,body,user=USER){return new Request('https://basketboss.co.uk/api/apple/'+path,{method:'POST',headers:{Origin:'capacitor://localhost',Authorization:'Bearer '+jwt(user),'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function fixture(t,{enabled=true}={}){
 const sql=new DatabaseSync(':memory:');for(const file of ['basketboss_apple_subscriptions_20261101.sql','basketboss_purchase_intents_20261121.sql'])sql.exec(readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'));
 sql.exec('CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER)');
 let queue=Promise.resolve();const db={sql,before:null,prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){db.before?.(query,args);return sql.prepare(query).get(...args)||null;},async all(){db.before?.(query,args);return {results:sql.prepare(query).all(...args)};},async run(){db.before?.(query,args);const result=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};},batch(list){const work=queue.then(async()=>{sql.exec('BEGIN');try{const out=[];for(const statement of list)out.push(await statement.run());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}});queue=work.catch(()=>{});return work;}};
 const env={BILLING_DB:db,BB_PURCHASE_INTENTS_ENABLED:String(enabled),BB_PURCHASE_INTENTS_STRICT:'true',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-public',APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_SUBSCRIPTION_GROUP_ID:'12345678',APPLE_ISSUER_ID:'55555555-5555-4555-8555-555555555555',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:key};
 await ensureDeletionSchema(env);sql.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run(USER,LEGACY,Date.now());
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://fixture.supabase.co/auth/v1/user');const user=JSON.parse(Buffer.from(options.headers.Authorization.slice(7).split('.')[1],'base64url')).sub;return Response.json({id:user,email:'fixture@example.invalid',email_confirmed_at:'2026-01-01'});});
 const config=getVerifiedAppleConfig(env),service=await getAppleServices(env,config);let current=null,currentStatus=1,fetches=0;
 // Cryptographic verification is covered by the official-verifier suites. These
 // explicit SDK mocks exercise verified-claim binding and deferred lifecycle.
 for(const method of ['verifyAndDecodeTransaction','verifyAndDecodeRenewalInfo','verifyAndDecodeNotification'])t.mock.method(service.verifier,method,async value=>JSON.parse(Buffer.from(value.split('.')[1],'base64url')));
 t.mock.method(service.client,'getAllSubscriptionStatuses',async original=>{fetches++;if(!current||original!==current.originalTransactionId)throw Error('No synthetic current subscription');return {environment:config.environment,bundleId:config.bundleId,appAppleId:config.appId,data:[{subscriptionGroupIdentifier:config.groupId,lastTransactions:[{originalTransactionId:original,status:currentStatus,signedTransactionInfo:signed(current),signedRenewalInfo:signed({environment:config.environment,originalTransactionId:original,productId:current.productId,autoRenewStatus:1,signedDate:current.signedDate,appAccountToken:current.appAccountToken})}]}]};});
 const transaction=(token,extra={})=>({transactionId:'20000000000001',originalTransactionId:ORIGINAL,bundleId:config.bundleId,productId:PRODUCT,subscriptionGroupIdentifier:config.groupId,type:'Auto-Renewable Subscription',quantity:1,inAppOwnershipType:'PURCHASED',appAccountToken:token,environment:'Production',purchaseDate:Date.now()-1000,expiresDate:Date.now()+3600000,signedDate:Date.now(),...extra});
 const actor=enabled?await purchaseIntentActor(request('purchase-context',{}),env):null;
 async function prepare(){const response=await contextEndpoint({env,request:request('purchase-context',{productId:PRODUCT,reservationProtocol:1})});assert.equal(response.status,200);return response.json();}
 async function intent({provider='apple',productId=PRODUCT,mode='live',pending=false}={}){let value=await reservePurchaseIntent(env,actor,{provider,productId,mode,protocol:1});value=await startPurchaseIntent(env,actor,value);if(pending)value=await reportPurchaseIntent(env,actor,{...value,outcome:'pending'});return value;}
 async function verify(tx,user=USER){return verifyEndpoint({env,request:request('verify',{signedTransactionInfo:signed(tx),transactionId:tx.transactionId},user)});}
 async function notify(tx){const payload={version:'2.0',notificationUUID:crypto.randomUUID(),notificationType:'SUBSCRIBED',signedDate:Date.now(),data:{bundleId:config.bundleId,environment:'Production',appAppleId:config.appId,signedTransactionInfo:signed(tx)}};return notificationEndpoint({env,request:request('notifications',{signedPayload:signed(payload)})});}
 t.after(()=>sql.close());return {env,sql,db,config,actor,transaction,prepare,intent,verify,notify,setCurrent:(value,status=1)=>{current=value;currentStatus=status;},fetches:()=>fetches};
}

test('new contexts use per-attempt UUIDs while default-off contexts retain the stable account token',async t=>{
 const f=await fixture(t),context=await f.prepare();assert.equal(context.appAccountToken,context.reservation.id);assert.notEqual(context.appAccountToken,LEGACY);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);
 const old=await fixture(t,{enabled:false});assert.equal((await old.prepare()).appAccountToken,LEGACY);
});
test('Ask to Buy approval restores its exact original pending attempt after losing capability, including uppercase StoreKit UUID',async t=>{
 const f=await fixture(t),intent=await f.intent({pending:true}),tx=f.transaction(intent.id.toUpperCase());f.setCurrent(tx);
 const response=await f.verify(tx);assert.equal(response.status,200);assert.equal((await response.json()).premiumAccess,true);assert.equal(f.fetches(),1);
 assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents WHERE id=?').get(intent.id).phase,'completed');assert.equal(await readPurchaseIntent(f.env,f.actor,{mode:'live'}),null);
 assert.equal(f.sql.prepare('SELECT app_account_token FROM bb_apple_subscriptions').get().app_account_token,intent.id);
});
test('first signed notification completes deferred purchase without any previous subscription row or browser session',async t=>{
 const f=await fixture(t),intent=await f.intent({pending:true}),tx=f.transaction(intent.id);f.setCurrent(tx);
 const response=await f.notify(tx);assert.equal(response.status,200);assert.equal(f.fetches(),1);assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents WHERE id=?').get(intent.id).phase,'completed');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_notifications').get().n,1);assert.equal((await readAppleEntitlement(f.env,USER)).premiumAccess,true);
});
test('pending approval, renewal restore and known-lineage status remain valid after coordination is disabled',async t=>{
 const f=await fixture(t),intent=await f.intent({pending:true}),tx=f.transaction(intent.id);f.env.BB_PURCHASE_INTENTS_ENABLED='false';f.setCurrent(tx);
 assert.equal((await f.notify(tx)).status,200);assert.equal((await f.verify(tx)).status,200);
 const renewal={...tx,transactionId:'20000000000002',signedDate:tx.signedDate+100,expiresDate:tx.expiresDate+3600000};f.setCurrent(renewal);
 assert.equal((await f.verify(renewal)).status,200);f.sql.exec('UPDATE bb_apple_subscriptions SET last_verified_at_ms=1');
 assert.equal((await readAppleEntitlement(f.env,USER)).premiumAccess,true);assert.equal(f.sql.prepare('SELECT latest_transaction_id FROM bb_apple_subscriptions').get().latest_transaction_id,renewal.transactionId);
});
test('late old token proof cannot complete or clear a newer provider attempt',async t=>{
 const f=await fixture(t);let old=await f.intent();old=await reportPurchaseIntent(f.env,f.actor,{...old,outcome:'canceled',cause:'native_user_cancelled'});
 const newer=await f.intent({provider:'google_play',productId:'basketboss_premium'}),tx=f.transaction(old.id);f.setCurrent(tx);assert.equal((await f.notify(tx)).status,200);
 assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents WHERE id=?').get(old.id).phase,'completed');assert.equal((await readPurchaseIntent(f.env,f.actor,{mode:'live'})).id,newer.id);assert.equal((await readPurchaseIntent(f.env,f.actor,{mode:'live'})).phase,'started');
});
test('same-user re-subscription can rotate its token on the same original lineage, and older receipt restores current token',async t=>{
 const f=await fixture(t),first=await f.intent(),old=f.transaction(first.id);f.setCurrent(old);assert.equal((await f.verify(old)).status,200);
 const second=await f.intent(),next={...old,appAccountToken:second.id,transactionId:'20000000000002',signedDate:old.signedDate+100};f.setCurrent(next);
 assert.equal((await f.verify(next)).status,200);assert.equal(f.sql.prepare('SELECT app_account_token FROM bb_apple_subscriptions').get().app_account_token,second.id);
 assert.equal((await f.verify(old)).status,200,'old receipt re-queries current same-user binding');assert.equal(f.sql.prepare('SELECT app_account_token FROM bb_apple_subscriptions').get().app_account_token,second.id);
 const replay={environment:'Production',originalTransactionId:ORIGINAL,appAccountToken:first.id,transactionId:old.transactionId,productId:PRODUCT,plan:'monthly',status:'active',expiresAtMs:old.expiresDate,graceExpiresAtMs:null,revokedAtMs:null,cancelAtPeriodEnd:false,appleSignedAtMs:next.signedDate,lastVerifiedAtMs:Date.now()+1000};
 await assert.rejects(()=>persistAppleSubscription(f.env,USER,replay),error=>error.code==='apple_account_mismatch');assert.equal(f.sql.prepare('SELECT app_account_token FROM bb_apple_subscriptions').get().app_account_token,second.id,'equal signed time cannot rotate backward');
});
test('first proof rejects foreign actor, environment, product, provider, unknown and deleted intent mappings',async t=>{
 for(const invalid of ['actor','mode','product','provider','unknown','deleted']){
  const f=await fixture(t),intent=await f.intent({mode:invalid==='mode'?'test':'live',productId:invalid==='product'?'uk.co.basketboss.premium.annual':PRODUCT,provider:invalid==='provider'?'google_play':'apple'});
  if(invalid==='deleted')f.sql.prepare('INSERT INTO bb_account_deletion_refs VALUES(?)').run(await digestDeletionRef('purchase_intent',intent.id));
  const tx=f.transaction(invalid==='unknown'?crypto.randomUUID():intent.id);f.setCurrent(tx);
  const response=await f.verify(tx,invalid==='actor'?OTHER:USER);assert.equal(response.status,409,invalid);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);
 }
});
test('unlinked legacy notifications still cannot claim users, and deleting accounts cannot accept mapped late proof',async t=>{
 const f=await fixture(t),legacy=f.transaction(LEGACY);f.setCurrent(legacy);assert.equal((await f.notify(legacy)).status,200);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);
 const intent=await f.intent(),tx=f.transaction(intent.id);f.setCurrent(tx);f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,user_id,email,started_at_ms) VALUES(?,?,?,?,?)').run(await digestDeletionActor(USER),'synthetic',USER,'fixture@example.invalid',Date.now());
 assert.equal((await f.verify(tx)).status,409);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);
});
test('initial notification cannot bypass fresh Apple server verification and partial mapping schema fails closed',async t=>{
 const f=await fixture(t),intent=await f.intent({pending:true}),tx=f.transaction(intent.id);f.setCurrent({...tx,appAccountToken:crypto.randomUUID()});
 assert.equal((await f.notify(tx)).status,409);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents WHERE id=?').get(intent.id).phase,'pending');
 f.sql.exec('DROP TABLE bb_purchase_intent_events');await assert.rejects(()=>resolveVerifiedAppleAccount(f.env,f.config,tx,{userId:USER}),error=>error.code==='purchase_intent_unavailable');
});
