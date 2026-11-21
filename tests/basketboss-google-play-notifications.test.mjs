import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {ensureDeletionSchema,digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';
import {getVerifiedGooglePlayConfig,googlePlayAccountId,googlePlayTokenHash,reconcileGooglePlayPurchase,googlePlayEntitlementFromRow} from '../bb-server-lib/bb-google-play-subscriptions.js';
import {onRequestPost as notifications} from '../functions/api/google-play/notifications.js';
import {onRequestPost as verifyPurchase} from '../functions/api/google-play/verify.js';
const USER='11111111-1111-4111-8111-111111111111',TOKEN='fixture-notification-token-aaaaaaaaaaaaaaaa',NEW='fixture-notification-token-bbbbbbbbbbbbbbbb',PRODUCT='basketboss_premium';
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),pem=keys.privateKey.export({type:'pkcs8',format:'pem'});
const jwk={...keys.publicKey.export({format:'jwk'}),kid:'notification-fixture',use:'sig',alg:'RS256'};
const audience='https://basketboss.co.uk/api/google-play/notifications',email='push@fixture-project.iam.gserviceaccount.com',subscription='projects/fixture-project/subscriptions/play-events';
async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../sql/basketboss_google_play_subscriptions_20261121.sql',import.meta.url),'utf8'));
 const db={sql,prepare(query){let args=[];return {bind(...v){args=v;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}};},async batch(list){sql.exec('BEGIN');try{const results=[];for(const statement of list)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={BILLING_DB:db,GOOGLE_PLAY_BILLING_ENABLED:'true',GOOGLE_PLAY_BILLING_MODE:'test',GOOGLE_PLAY_TEST_USER_IDS:USER,GOOGLE_PLAY_PRODUCT_ID:PRODUCT,GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID:'monthly',GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID:'annual',
  GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL:'billing@fixture-project.iam.gserviceaccount.com',GOOGLE_PLAY_PRIVATE_KEY:pem,GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL:email,GOOGLE_PLAY_PUBSUB_AUDIENCE:audience,GOOGLE_PLAY_PUBSUB_SUBSCRIPTION:subscription,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key'};
 await ensureDeletionSchema(env);const config=getVerifiedGooglePlayConfig(env),accountId=await googlePlayAccountId(env,USER,{create:true});return {sql,env,config,accountId};
}
function purchase(f,extra={}){return {startTime:new Date(Date.now()-1000).toISOString(),subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',acknowledgementState:'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',testPurchase:{},
 externalAccountIdentifiers:{obfuscatedExternalAccountId:f.accountId},lineItems:[{productId:PRODUCT,expiryTime:new Date(Date.now()+3600000).toISOString(),autoRenewingPlan:{autoRenewEnabled:true},offerDetails:{basePlanId:'monthly'}}],...extra};}
async function seed(f,extra={}){return reconcileGooglePlayPurchase(f.env,f.config,USER,TOKEN,{api:{get:async()=>purchase(f,extra),acknowledge:async()=>{}}});}
function jwt(extra={}){const now=Math.floor(Date.now()/1000),head=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid,typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:audience,email,email_verified:true,iat:now,exp:now+3600,...extra})).toString('base64url');const unsigned=head+'.'+body;return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),keys.privateKey).toString('base64url');}
function push(messageId='fixture-1',notice={},envelope={},bearer=jwt()){
 const data={version:'1.0',packageName:'uk.co.basketboss.app',eventTimeMillis:String(Date.now()),subscriptionNotification:{version:'1.0',notificationType:2,purchaseToken:TOKEN},...notice};
 return new Request(audience,{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify({subscription,message:{messageId,data:Buffer.from(JSON.stringify(data)).toString('base64')},...envelope})});
}
function mockGoogle(t,f,get,{ack=()=>{},failGet=false}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  calls.push({url:String(url),init});
  if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
  if(url==='https://fixture.supabase.co/auth/v1/user')return Response.json({id:USER,email:'fixture@example.invalid',email_confirmed_at:new Date().toISOString()});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-publisher-access-token',token_type:'Bearer',expires_in:3600});
  if(String(url).startsWith('https://androidpublisher.googleapis.com/')){
   if(init.method==='POST'){await ack();return new Response(null,{status:204});}
   if(failGet)return Response.json({error:'synthetic provider failure'},{status:503});
   return Response.json(await get(String(url)));
  }
  throw Error('Unexpected mocked request');
 });return calls;
}

test('verify API uses real OAuth transport and persists purchase ownership before acknowledgment and Premium response',async t=>{
 const f=await fixture();let ack=0;
 const calls=mockGoogle(t,f,()=>purchase(f,{acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING'}),{ack:()=>{ack++;assert.equal(f.sql.prepare('SELECT acknowledged FROM bb_google_play_subscriptions').get().acknowledged,0);}});
 const response=await verifyPurchase({env:f.env,request:new Request('https://basketboss.co.uk/api/google-play/verify',{method:'POST',headers:{Origin:'https://localhost',Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({productId:PRODUCT,purchaseToken:TOKEN})})});
 const body=await response.json();assert.equal(response.status,200);assert.equal(body.acknowledged,true);assert.equal(body.premiumAccess,true);assert.equal(body.subscription.environment,'test');assert.equal(ack,1);
 assert.equal(f.sql.prepare('SELECT acknowledged FROM bb_google_play_subscriptions').get().acknowledged,1);assert.ok(calls.some(c=>c.url.includes('/subscriptionsv2/')));
 assert.equal(JSON.stringify(body).includes(TOKEN),false);assert.equal(JSON.stringify(body).includes('PRIVATE KEY'),false);
});

test('signed RTDN refetches current state, persists revocation and deduplicates only completed reconciliation',async t=>{
 const f=await fixture();await seed(f);let gets=0;
 mockGoogle(t,f,()=>{gets++;return purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_EXPIRED'});});
 let response=await notifications({env:f.env,request:push()});assert.equal(response.status,200);
 const saved=f.sql.prepare('SELECT * FROM bb_google_play_subscriptions').get();assert.equal(saved.status,'expired');assert.equal(googlePlayEntitlementFromRow(f.config,saved).premiumAccess,false);assert.equal(gets,1);
 response=await notifications({env:f.env,request:push()});assert.equal((await response.json()).duplicate,true);assert.equal(gets,1);
 response=await notifications({env:f.env,request:push('old-event',{eventTimeMillis:String(Date.now()-86400000),subscriptionNotification:{version:'1.0',notificationType:2,purchaseToken:TOKEN}})});
 assert.equal(response.status,200);assert.equal(gets,2);assert.equal(f.sql.prepare('SELECT status FROM bb_google_play_subscriptions').get().status,'expired');
});

test('voided-purchase RTDN reconciles the Developer API and an unbound token cannot establish a user',async t=>{
 const f=await fixture();await seed(f);mockGoogle(t,f,url=>purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_EXPIRED',...(url.includes(NEW)?{externalAccountIdentifiers:undefined}:{})}));
 const response=await notifications({env:f.env,request:push('voided',{subscriptionNotification:undefined,voidedPurchaseNotification:{purchaseToken:TOKEN,productType:1,refundType:1}})});
 assert.equal(response.status,200);assert.equal(f.sql.prepare('SELECT status FROM bb_google_play_subscriptions').get().status,'expired');
 const unknown=await notifications({env:f.env,request:push('unknown',{subscriptionNotification:{version:'1.0',notificationType:4,purchaseToken:NEW}})});
 assert.equal((await unknown.json()).ignored,true);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_google_play_subscriptions').get().n,1);
});

test('pending and initial purchases completing with the app closed recover only through verified opaque account binding',async t=>{
 const f=await fixture();let complete=false,acks=0;
 mockGoogle(t,f,()=>purchase(f,{subscriptionState:complete?'SUBSCRIPTION_STATE_ACTIVE':'SUBSCRIPTION_STATE_PENDING',acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING'}),{ack:()=>{acks++;}});
 let response=await notifications({env:f.env,request:push('pending')});assert.equal(response.status,200);
 let row=f.sql.prepare('SELECT * FROM bb_google_play_subscriptions').get();assert.equal(row.status,'pending');assert.equal(row.acknowledged,0);assert.equal(googlePlayEntitlementFromRow(f.config,row).premiumAccess,false);assert.equal(acks,0);
 complete=true;response=await notifications({env:f.env,request:push('completed')});assert.equal(response.status,200);
 row=f.sql.prepare('SELECT * FROM bb_google_play_subscriptions').get();assert.equal(row.acknowledged,1);assert.equal(googlePlayEntitlementFromRow(f.config,row).premiumAccess,true);assert.equal(acks,1);
});

test('a verified Play-center replacement reconciles a known owner and preserves its account context before ack',async t=>{
 const f=await fixture();await seed(f,{subscriptionState:'SUBSCRIPTION_STATE_EXPIRED'});let ack=0;
 mockGoogle(t,f,()=>purchase(f,{externalAccountIdentifiers:undefined,acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING',outOfAppPurchaseContext:{expiredPurchaseToken:TOKEN,expiredExternalAccountIdentifiers:{obfuscatedExternalAccountId:f.accountId}}}),{ack:()=>{ack++;}});
 const response=await notifications({env:f.env,request:push('replacement',{subscriptionNotification:{version:'1.0',notificationType:4,purchaseToken:NEW}})});
 assert.equal(response.status,200);assert.equal(ack,1);
 const head=f.sql.prepare('SELECT head_token_hash FROM bb_google_play_lineages').get();assert.equal(head.head_token_hash,await googlePlayTokenHash(NEW));
 assert.equal(f.sql.prepare('SELECT acknowledged FROM bb_google_play_subscriptions WHERE token_hash=?').get(head.head_token_hash).acknowledged,1);
});

test('transient verification failures stay retryable and never mark the notification processed',async t=>{
 const f=await fixture();await seed(f);let failing=true;
 mockGoogle(t,f,()=>{if(failing)throw Error('synthetic outage');return purchase(f,{subscriptionState:'SUBSCRIPTION_STATE_CANCELED'});});
 const failed=await notifications({env:f.env,request:push('retry')});assert.equal(failed.status,503);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_google_play_notifications').get().n,0);
 failing=false;const retry=await notifications({env:f.env,request:push('retry')});assert.equal(retry.status,200);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_google_play_notifications').get().n,1);
});

test('JWT identity, subscription and package checks reject forged delivery before purchase lookup',async t=>{
 const f=await fixture();let gets=0;mockGoogle(t,f,()=>{gets++;return purchase(f);});
 for(const request of [push('wrong-aud',{}, {},jwt({aud:'https://evil.invalid'})),push('wrong-email',{}, {},jwt({email:'other@fixture-project.iam.gserviceaccount.com'})),push('wrong-verified',{}, {},jwt({email_verified:false}))])assert.equal((await notifications({env:f.env,request})).status,401);
 assert.equal((await notifications({env:f.env,request:push('wrong-sub',{}, {subscription:'projects/other/subscriptions/wrong'})})).status,400);
 assert.equal((await notifications({env:f.env,request:push('wrong-package',{packageName:'evil.app'})})).status,400);assert.equal(gets,0);
});

test('a deleted account notification is acknowledged without recreating a record or requesting store state',async t=>{
 const f=await fixture();await seed(f);f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(USER),'fixture',Date.now());
 let gets=0;mockGoogle(t,f,()=>{gets++;return purchase(f);});
 const response=await notifications({env:f.env,request:push('deleted')});assert.equal((await response.json()).ignored,true);assert.equal(gets,0);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_google_play_notifications').get().n,0);
});
