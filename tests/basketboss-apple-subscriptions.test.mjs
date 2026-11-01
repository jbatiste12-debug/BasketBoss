import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,sign,X509Certificate,createHash} from 'node:crypto';
import jsrsasign from 'jsrsasign';
import {SignedDataVerifier,Environment} from '@apple/app-store-server-library';
import {APPLE_ROOT_G3_SHA256,appleRootCertificates} from '../bb-server-lib/bb-apple-roots.js';
import {ensureDeletionSchema,digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';
import {APPLE_BUNDLE_ID,AppleBillingError,getVerifiedAppleConfig,appleConfigForUser,appleConfigForSignedData,appleAccountToken,assertAppleAccountReady,verifyAppleTransaction,evaluateAppleSubscription,fetchAppleCurrentSubscription,persistAppleSubscription,appleEntitlementFromRow,readAppleEntitlement,hasExistingWebPremium,assertNoPendingWebCheckout,appleAppIdentifierMatches} from '../bb-server-lib/bb-apple-subscriptions.js';
import {appleRequestJSON} from '../bb-server-lib/bb-apple-http.js';
import {onRequestGet as appleConfigEndpoint} from '../functions/api/apple/config.js';
import {onRequestPost as applePurchaseContextEndpoint} from '../functions/api/apple/purchase-context.js';
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',TOKEN='33333333-3333-4333-8333-333333333333',OTHER_TOKEN='44444444-4444-4444-8444-444444444444';
const keys=()=>generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});
const apiKey=keys().privateKey;
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../sql/basketboss_apple_subscriptions_20261101.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER)');
 const db={sql,before:null,prepare(query){const statement={bind(...args){const apply=()=>db.before?.(query,args);return {first:async()=>{apply();return sql.prepare(query).get(...args)||null;},all:async()=>{apply();return {results:sql.prepare(query).all(...args)};},run:async()=>{apply();const r=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}};},first:async()=>sql.prepare(query).get()||null,all:async()=>({results:sql.prepare(query).all()}),run:async()=>{sql.exec(query);return {success:true};}};return statement;},async batch(list){sql.exec('BEGIN');try{const out=[];for(const item of list)out.push(await item.run());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}}};return db;
}
const env=db=>({BILLING_DB:db,APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_ISSUER_ID:'55555555-5555-4555-8555-555555555555',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:apiKey,APPLE_SUBSCRIPTION_GROUP_ID:'12345678'});
const transaction=(config,extra={})=>({transactionId:'20000000000001',originalTransactionId:'20000000000000',bundleId:APPLE_BUNDLE_ID,productId:config.products.monthly,subscriptionGroupIdentifier:config.groupId,type:'Auto-Renewable Subscription',quantity:1,inAppOwnershipType:'PURCHASED',appAccountToken:TOKEN,environment:config.environment,purchaseDate:Date.now()-1000,signedDate:Date.now(),expiresDate:Date.now()+3600000,...extra});
const renewal=(config,tx,extra={})=>({environment:config.environment,originalTransactionId:tx.originalTransactionId,productId:tx.productId,autoRenewStatus:1,signedDate:tx.signedDate,...extra});
const rejectCode=(code,status)=>error=>error instanceof AppleBillingError&&error.code===code&&(!status||error.status===status);
async function prepared(){const e=env(database());await ensureDeletionSchema(e);const c=getVerifiedAppleConfig(e);e.BILLING_DB.sql.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run(USER,TOKEN,Date.now());return {e,c};}
function certificate(serial,subject,issuer,pub,issuerPrivate,ext){
 const time=n=>new Date(n).toISOString().replace(/[-:T]/g,'').replace(/\.\d{3}/,'');
 return new X509Certificate(new jsrsasign.KJUR.asn1.x509.Certificate({version:3,serial:{int:serial},issuer:{str:issuer},subject:{str:subject},notbefore:{type:'gen',str:time(Date.now()-86400000)},notafter:{type:'gen',str:time(Date.now()+86400000)},sbjpubkey:pub,ext,sigalg:'SHA256withECDSA',cakey:issuerPrivate}).getPEM());
}
function testPKI(){
 const rootKeys=keys(),intermediateKeys=keys(),leafKeys=keys();
 const root=certificate(1,'/CN=Test Root','/CN=Test Root',rootKeys.publicKey,rootKeys.privateKey,[{extname:'basicConstraints',cA:true,critical:true}]);
 const intermediate=certificate(2,'/CN=Test Intermediate','/CN=Test Root',intermediateKeys.publicKey,rootKeys.privateKey,[{extname:'basicConstraints',cA:true,critical:true},{extname:'1.2.840.113635.100.6.2.1',extn:'0500'}]);
 const leaf=certificate(3,'/CN=Test Leaf','/CN=Test Intermediate',leafKeys.publicKey,intermediateKeys.privateKey,[{extname:'basicConstraints',cA:false},{extname:'1.2.840.113635.100.6.11.1',extn:'0500'}]);
 const chain=[leaf,intermediate,root].map(cert=>cert.raw.toString('base64'));
 return {root,chain,privateKey:leafKeys.privateKey};
}
function jws(payload,pki,key=pki.privateKey){const value=[Buffer.from(JSON.stringify({alg:'ES256',x5c:pki.chain})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url')].join('.');return value+'.'+sign('sha256',Buffer.from(value),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');}
const pki=testPKI();
test('disabled/missing credentials fail closed and Sandbox requires explicit test accounts',()=>{
 assert.equal(getVerifiedAppleConfig({}),null);
 const e=env(database());delete e.APPLE_PRIVATE_KEY;assert.throws(()=>getVerifiedAppleConfig(e),rejectCode('apple_not_configured',503));
 const s={...env(database()),APPLE_ALLOW_SANDBOX:'true'};assert.throws(()=>getVerifiedAppleConfig(s),rejectCode('apple_sandbox_not_configured'));
 s.APPLE_SANDBOX_USER_IDS=USER;const c=getVerifiedAppleConfig(s);assert.equal(appleConfigForUser(c,USER).environment,'Sandbox');assert.equal(appleConfigForUser(c,OTHER).environment,'Production');
 assert.throws(()=>appleConfigForSignedData(c,jws({environment:'Sandbox'},pki),OTHER),rejectCode('apple_environment_mismatch',403));
 assert.equal(appleConfigForSignedData(c,jws({environment:'Sandbox'},pki),USER).environment,'Sandbox');
 assert.throws(()=>appleConfigForSignedData(c,jws({environment:'Xcode'},pki),USER),rejectCode('apple_environment_mismatch',403));
});
test('official verifier accepts a valid test chain only with explicit test root; production trust rejects it',async()=>{
 const c=getVerifiedAppleConfig(env(database())),tx=transaction(c),signed=jws(tx,pki);
 const service={config:c,verifier:new SignedDataVerifier([pki.root.raw],false,Environment.PRODUCTION,c.bundleId,c.appId)};
 assert.equal((await verifyAppleTransaction(service,signed)).transactionId,tx.transactionId);
 await assert.rejects(()=>verifyAppleTransaction({config:c,verifier:new SignedDataVerifier(appleRootCertificates(),true,Environment.PRODUCTION,c.bundleId,c.appId)},signed),rejectCode('apple_transaction_unverified',400));
 await assert.rejects(()=>verifyAppleTransaction(service,jws(tx,pki,keys().privateKey)),rejectCode('apple_transaction_unverified',400));
 const tampered=signed.split('.');tampered[1]=Buffer.from(JSON.stringify({...tx,productId:c.products.annual})).toString('base64url');await assert.rejects(()=>verifyAppleTransaction(service,tampered.join('.')),rejectCode('apple_transaction_unverified',400));
 assert.equal(createHash('sha256').update(appleRootCertificates()[0]).digest('hex'),APPLE_ROOT_G3_SHA256);
});
test('valid signatures cannot override bundle, environment, product, ownership, token or group restrictions',async()=>{
 const c=getVerifiedAppleConfig(env(database())),service={config:c,verifier:new SignedDataVerifier([pki.root.raw],false,Environment.PRODUCTION,c.bundleId,c.appId)};
 for(const extra of [{bundleId:'evil.app'},{environment:'Sandbox'},{productId:'uk.co.basketboss.premium.fake'},{subscriptionGroupIdentifier:'9999'},{appAccountToken:'not-a-uuid'},{inAppOwnershipType:'FAMILY_SHARED'},{quantity:2},{signedDate:Date.now()+600000}])await assert.rejects(()=>verifyAppleTransaction(service,jws(transaction(c,extra),pki)),error=>error.status===400);
});
test('only monthly and annual are advertised; a deleted Founder SKU cannot open a purchase or grant access',async()=>{
 const {e,c}=await prepared(),deletedProduct='uk.co.basketboss.premium.founder.monthly';
 // Obsolete variables cannot bring the deleted Apple product back into scope.
 e.APPLE_FOUNDER_ENABLED='true';e.APPLE_FOUNDER_PRODUCT_ID=deletedProduct;
 const configResponse=await appleConfigEndpoint({env:e,request:new Request('https://basketboss.co.uk/api/apple/config')});
 assert.deepEqual((await configResponse.json()).productIds,[c.products.monthly,c.products.annual]);
 const service={config:c,verifier:new SignedDataVerifier([pki.root.raw],false,Environment.PRODUCTION,c.bundleId,c.appId)};
 await assert.rejects(()=>verifyAppleTransaction(service,jws(transaction(c,{productId:deletedProduct}),pki)),rejectCode('apple_transaction_mismatch',400));
 const originalFetch=globalThis.fetch;
 try{
  Object.assign(e,{SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key'});
  globalThis.fetch=async input=>{assert.equal(input,'https://test.supabase.co/auth/v1/user');return Response.json({id:USER,email:'test@example.invalid',email_confirmed_at:new Date().toISOString()});};
  const response=await applePurchaseContextEndpoint({env:e,request:new Request('https://basketboss.co.uk/api/apple/purchase-context',{method:'POST',headers:{Origin:'capacitor://localhost',Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({productId:deletedProduct})})});
  assert.equal(response.status,400);assert.equal((await response.json()).code,'apple_product_unavailable');
 }finally{globalThis.fetch=originalFetch;}
 assert.equal(e.BILLING_DB.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);
});
test('cancel at period end retains paid access; expired, refunded and billing-retry subscriptions do not',()=>{
 const c=getVerifiedAppleConfig(env(database())),tx=transaction(c),r=renewal(c,tx,{autoRenewStatus:0});
 const convert=s=>appleEntitlementFromRow(c,{environment:s.environment,product_id:s.productId,plan:s.plan,status:s.status,expires_at_ms:s.expiresAtMs,grace_expires_at_ms:s.graceExpiresAtMs,revoked_at_ms:s.revokedAtMs,cancel_at_period_end:Number(s.cancelAtPeriodEnd),last_verified_at_ms:s.lastVerifiedAtMs});
 const cancel=convert(evaluateAppleSubscription(c,tx,r,1));assert.equal(cancel.premiumAccess,true);assert.equal(cancel.cancelAtPeriodEnd,true);
 for(const status of [2,3,5])assert.equal(convert(evaluateAppleSubscription(c,tx,r,status)).premiumAccess,false);
 assert.equal(convert(evaluateAppleSubscription(c,{...tx,revocationDate:Date.now()},r,1)).premiumAccess,false);
 assert.equal(convert(evaluateAppleSubscription(c,{...tx,expiresDate:Date.now()-1},r,1)).premiumAccess,false);
 assert.equal(convert(evaluateAppleSubscription(c,tx,{...r,gracePeriodExpiresDate:Date.now()+60000},4)).premiumAccess,true);
 assert.equal(convert(evaluateAppleSubscription(c,tx,{...r,gracePeriodExpiresDate:Date.now()-1},4)).premiumAccess,false);
 assert.equal(convert(evaluateAppleSubscription(c,tx,{...r,gracePeriodExpiresDate:undefined},4)).premiumAccess,false);
});
test('current Apple server status overrides a valid historic active transaction',async()=>{
 const c=getVerifiedAppleConfig(env(database())),old=transaction(c),revoked={...old,revocationDate:Date.now(),signedDate:Date.now()+1};
 const service={config:c,verifier:new SignedDataVerifier([pki.root.raw],false,Environment.PRODUCTION,c.bundleId,c.appId),client:{getAllSubscriptionStatuses:async()=>({environment:c.environment,bundleId:c.bundleId,appAppleId:c.appId,data:[{subscriptionGroupIdentifier:c.groupId,lastTransactions:[{originalTransactionId:old.originalTransactionId,status:5,signedTransactionInfo:jws(revoked,pki),signedRenewalInfo:jws(renewal(c,revoked),pki)}]}]})}};
 assert.equal((await verifyAppleTransaction(service,jws(old,pki))).revocationDate,undefined);
 assert.equal((await fetchAppleCurrentSubscription(service,old.originalTransactionId,TOKEN)).status,'revoked');
 await assert.rejects(()=>fetchAppleCurrentSubscription(service,old.originalTransactionId,OTHER_TOKEN),rejectCode('apple_account_mismatch',409));
 service.client.getAllSubscriptionStatuses=async()=>({environment:'Sandbox',bundleId:c.bundleId,appAppleId:c.appId,data:[]});await assert.rejects(()=>fetchAppleCurrentSubscription(service,old.originalTransactionId,TOKEN),rejectCode('apple_status_mismatch'));
});
test('immutable original ownership and monotonic current status prevent concurrent restore and replay takeover',async()=>{
 const {e,c}=await prepared(),tx=transaction(c),active=evaluateAppleSubscription(c,tx,renewal(c,tx),1);
 e.BILLING_DB.sql.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run(OTHER,OTHER_TOKEN,Date.now());
 const outcomes=await Promise.allSettled([persistAppleSubscription(e,USER,active),persistAppleSubscription(e,OTHER,{...active,appAccountToken:OTHER_TOKEN})]);
 // Async digest work can schedule either request first. Exactly one owner wins;
 // Promise argument order does not promise database insertion order.
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
 const rejected=outcomes.find(result=>result.status==='rejected');assert.equal(rejected.reason.code,'apple_account_mismatch');
 const winner=outcomes.find(result=>result.status==='fulfilled').value;
 const owned={...active,appAccountToken:winner.app_account_token};
 const refund={...owned,status:'revoked',revokedAtMs:Date.now(),appleSignedAtMs:owned.appleSignedAtMs+100,lastVerifiedAtMs:Date.now()+100};await persistAppleSubscription(e,winner.user_id,refund);
 const replay=await persistAppleSubscription(e,winner.user_id,{...owned,lastVerifiedAtMs:refund.lastVerifiedAtMs+100});assert.equal(replay.status,'revoked');assert.equal(replay.user_id,winner.user_id);
 const duplicate=await persistAppleSubscription(e,winner.user_id,refund);assert.equal(duplicate.status,'revoked');assert.equal(e.BILLING_DB.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,1);
});
test('Sandbox can omit appAppleId while Production requires it and neither accepts a conflicting identifier',async()=>{
 const production=getVerifiedAppleConfig(env(database())),c={...production,environment:Environment.SANDBOX};
 assert.equal(appleAppIdentifierMatches(production,undefined),false);assert.equal(appleAppIdentifierMatches(c,undefined),true);
 for(const config of [production,c]){assert.equal(appleAppIdentifierMatches(config,config.appId),true);assert.equal(appleAppIdentifierMatches(config,config.appId+1),false);}
 const tx=transaction(c),response={environment:c.environment,bundleId:c.bundleId,data:[{subscriptionGroupIdentifier:c.groupId,lastTransactions:[{originalTransactionId:tx.originalTransactionId,status:1,signedTransactionInfo:jws(tx,pki),signedRenewalInfo:jws(renewal(c,tx),pki)}]}]};
 const service={config:c,verifier:new SignedDataVerifier([pki.root.raw],false,Environment.SANDBOX,c.bundleId),client:{getAllSubscriptionStatuses:async()=>response}};
 assert.equal((await fetchAppleCurrentSubscription(service,tx.originalTransactionId,TOKEN)).status,'active');
 response.appAppleId=c.appId+1;await assert.rejects(()=>fetchAppleCurrentSubscription(service,tx.originalTransactionId,TOKEN),rejectCode('apple_status_mismatch'));
});
test('durable deletion marker blocks token creation and late subscription writes',async()=>{
 const {e,c}=await prepared(),tx=transaction(c),state=evaluateAppleSubscription(c,tx,renewal(c,tx),1);
 e.BILLING_DB.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(USER),'retry',Date.now());
 await assert.rejects(()=>assertAppleAccountReady(e,c,USER),rejectCode('account_deletion_pending',409));
 await assert.rejects(()=>persistAppleSubscription(e,USER,state),rejectCode('apple_account_mismatch',409));
 e.BILLING_DB.sql.exec('DELETE FROM bb_apple_account_tokens');await assert.rejects(()=>appleAccountToken(e,USER,{create:true}),rejectCode('apple_account_token_unavailable',409));
 assert.equal(e.BILLING_DB.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);
});
test('local expiry clock removes cached access and Sandbox cannot leak into production reads',async()=>{
 const {e,c}=await prepared(),tx=transaction(c),state=evaluateAppleSubscription(c,tx,renewal(c,tx),1),saved=await persistAppleSubscription(e,USER,state);
 assert.equal(appleEntitlementFromRow(c,saved,state.expiresAtMs+1).premiumAccess,false);
 e.BILLING_DB.sql.exec('DELETE FROM bb_apple_subscriptions');await persistAppleSubscription(e,USER,{...state,environment:'Sandbox'});
 assert.equal(await readAppleEntitlement(e,USER),null);
 e.APPLE_ALLOW_SANDBOX='true';e.APPLE_SANDBOX_USER_IDS=USER;assert.equal((await readAppleEntitlement(e,USER)).environment,'Sandbox');
});
test('existing verified web subscribers block purchase even when an unrelated newer inactive row exists',async()=>{
 const {e}=await prepared(),price='pri_'+'p'.repeat(26);Object.assign(e,{BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',PADDLE_LIVE_STANDARD_PRICE_ID:price});
 e.BILLING_DB.sql.prepare('INSERT INTO bb_paid_entitlements VALUES(?,?,?,?,?)').run(USER,'active',price,'standard',1);
 e.BILLING_DB.sql.prepare('INSERT INTO bb_paid_entitlements VALUES(?,?,?,?,?)').run(USER,'canceled',price,'standard',2);
 assert.equal(await hasExistingWebPremium(e,{id:USER,email:'test@example.invalid'}),'paddle');
 // The £1.99 web Founder membership remains valid after the Apple SKU is deleted.
 e.PADDLE_LIVE_FOUNDER_PRICE_ID='pri_'+'f'.repeat(26);e.BILLING_DB.sql.exec('DELETE FROM bb_paid_entitlements');
 e.BILLING_DB.sql.prepare('INSERT INTO bb_paid_entitlements VALUES(?,?,?,?,?)').run(USER,'active',e.PADDLE_LIVE_FOUNDER_PRICE_ID,'founder',3);
 assert.equal(await hasExistingWebPremium(e,{id:USER,email:'test@example.invalid'}),'paddle');
});
test('bounded JSON rejects forged oversize signed payloads before any verification',async()=>{
 await assert.rejects(()=>appleRequestJSON(new Request('https://basketboss.co.uk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signedPayload:'x'.repeat(81000)})})),rejectCode('request_too_large',413));
 await assert.rejects(()=>appleRequestJSON(new Request('https://basketboss.co.uk',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})),rejectCode('invalid_request',415));
});
test('an existing unfinished web checkout blocks Apple while completed or other-account claims do not',async()=>{
 const {e}=await prepared();await assertNoPendingWebCheckout(e,USER);
 const sql=e.BILLING_DB.sql;sql.exec('CREATE TABLE bb_billing_claims(user_id TEXT,claim_state TEXT)');
 const insert=sql.prepare('INSERT INTO bb_billing_claims VALUES(?,?)');
 insert.run(OTHER,'checkout_created');insert.run(USER,'completed');await assertNoPendingWebCheckout(e,USER);
 for(const state of ['pending','checkout_created']){
  sql.exec('DELETE FROM bb_billing_claims');insert.run(USER,state);
  await assert.rejects(()=>assertNoPendingWebCheckout(e,USER),rejectCode('web_checkout_pending',409));
 }
});
