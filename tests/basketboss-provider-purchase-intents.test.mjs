import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ensureDeletionSchema} from '../bb-server-lib/bb-account-deletion.js';
import {purchaseIntentActor,reservePurchaseIntent,startPurchaseIntent,reportPurchaseIntent,readPurchaseIntent} from '../bb-server-lib/bb-purchase-intents.js';
import {persistAppleSubscription,appleEntitlementFromRow,getVerifiedAppleConfig} from '../bb-server-lib/bb-apple-subscriptions.js';
import {onRequestPost as appleContext} from '../functions/api/apple/purchase-context.js';
import {onRequestPost as intentPost,onRequestGet as intentGet} from '../functions/api/subscription/purchase-intent.js';

const USER='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222',ACCOUNT='33333333-3333-4333-8333-333333333333';
const PRODUCT='uk.co.basketboss.premium.monthly';
const privateKey=generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const jwt=(extra={})=>[Buffer.from(JSON.stringify({alg:'ES256'})).toString('base64url'),Buffer.from(JSON.stringify({iss:'https://fixture.supabase.co/auth/v1',sub:USER,session_id:SESSION,exp:Math.floor(Date.now()/1000)+3600,...extra})).toString('base64url'),'fixtureSignature'].join('.');
function request(path,body,extra={}){return new Request('https://basketboss.co.uk'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'capacitor://localhost',Authorization:'Bearer '+jwt(),'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function fixture({schema=true,enabled=true,strict=true}={}){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../sql/basketboss_apple_subscriptions_20261101.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER)');
 let queue=Promise.resolve();
 const db={sql,before:null,prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){db.before?.(query,args);return sql.prepare(query).get(...args)||null;},async all(){db.before?.(query,args);return {results:sql.prepare(query).all(...args)};},async run(){db.before?.(query,args);const result=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};},batch(list){const work=queue.then(async()=>{sql.exec('BEGIN');try{const results=[];for(const item of list)results.push(await item.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}});queue=work.catch(()=>{});return work;}};
 const env={BILLING_DB:db,BB_PURCHASE_INTENTS_ENABLED:String(enabled),BB_PURCHASE_INTENTS_STRICT:String(strict),SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production',APPLE_APP_ID:'1234567890',APPLE_ISSUER_ID:'44444444-4444-4444-8444-444444444444',APPLE_KEY_ID:'ABCDEFGHIJ',APPLE_PRIVATE_KEY:privateKey,APPLE_SUBSCRIPTION_GROUP_ID:'12345678'};
 await ensureDeletionSchema(env);if(schema)sql.exec(readFileSync(new URL('../sql/basketboss_purchase_intents_20261121.sql',import.meta.url),'utf8'));
 sql.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run(USER,ACCOUNT,Date.now());
 const actor=await purchaseIntentActor(request('/api/subscription/purchase-intent'),env,{id:USER});
 return {env,sql,db,actor};
}
async function withAuth(work){const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://fixture.supabase.co/auth/v1/user');assert.match(options.headers.Authorization,/^Bearer /);return Response.json({id:USER,email:'fixture@example.invalid',email_confirmed_at:'2026-01-01'});};try{return await work();}finally{globalThis.fetch=original;}}
const selection={provider:'apple',mode:'live',productId:PRODUCT,protocol:1};
const state=(extra={})=>({environment:'Production',originalTransactionId:'20000000000000',appAccountToken:ACCOUNT,transactionId:'20000000000001',productId:PRODUCT,plan:'monthly',status:'active',expiresAtMs:Date.now()+3600000,graceExpiresAtMs:null,revokedAtMs:null,cancelAtPeriodEnd:false,appleSignedAtMs:Date.now(),lastVerifiedAtMs:Date.now(),...extra});

test('intent endpoint keeps exact origin, feature, bearer/session and bounded-body guards',()=>withAuth(async()=>{
 const f=await fixture();
 assert.equal((await intentPost({env:f.env,request:request('/api/subscription/purchase-intent',{action:'start',reservation:{}},{Origin:'https://localhost.evil'})})).status,403);
 assert.equal((await intentPost({env:{...f.env,BB_PURCHASE_INTENTS_ENABLED:'false'},request:request('/api/subscription/purchase-intent',{})})).status,503);
 assert.equal((await intentPost({env:f.env,request:request('/api/subscription/purchase-intent',{action:'cancel',reservation:{}})})).status,400);
 assert.equal((await intentPost({env:f.env,request:request('/api/subscription/purchase-intent',{action:'start',reservation:{}},{'Content-Type':'text/plain'})})).status,415);
 assert.equal((await intentPost({env:f.env,request:request('/api/subscription/purchase-intent',{action:'start',padding:'x'.repeat(5000),reservation:{}})})).status,413);
 const cookies=await intentGet({env:f.env,request:request('/api/subscription/purchase-intent?mode=live',undefined,{Authorization:'',Cookie:'access_token=untrusted-client-cookie'})});
 assert.equal(cookies.status,401,'cross-origin/native cookies never replace the verified bearer');
 const denied=await intentGet({env:f.env,request:request('/api/subscription/purchase-intent?mode=live',undefined,{Authorization:'Bearer '+jwt({session_id:undefined})})});
 assert.equal(denied.status,401);assert.equal((await denied.json()).code,'purchase_intent_session_unavailable');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_purchase_intents').get().n,0);
}));

test('intent endpoint starts only its authorization, status hides capability, pending cannot be client-cleared',()=>withAuth(async()=>{
 const f=await fixture(),prepared=await reservePurchaseIntent(f.env,f.actor,selection);
 let response=await intentGet({env:f.env,request:request('/api/subscription/purchase-intent?mode=live')});
 const status=(await response.json()).reservation;assert.equal(status.id,prepared.id);assert.equal(status.capability,undefined);
 response=await intentPost({env:f.env,request:request('/api/subscription/purchase-intent',{action:'start',reservation:prepared,provider:'google_play'})});
 assert.equal(response.status,200);const started=(await response.json()).reservation;assert.equal(started.phase,'started');assert.equal(started.provider,'apple');
 const forged=await intentPost({env:f.env,request:request('/api/subscription/purchase-intent',{action:'report',reservation:started,outcome:'completed',premiumAccess:true})});
 assert.equal(forged.status,400,'only provider verification can complete a purchase');
 response=await intentPost({env:f.env,request:request('/api/subscription/purchase-intent',{action:'report',reservation:started,outcome:'pending'})});
 assert.equal(response.status,200);const pending=(await response.json()).reservation;
 response=await intentPost({env:f.env,request:request('/api/subscription/purchase-intent',{action:'report',reservation:pending,outcome:'canceled',cause:'native_user_cancelled'})});
 assert.equal(response.status,409);assert.equal((await response.json()).code,'purchase_intent_unresolved');
 assert.equal((await readPurchaseIntent(f.env,f.actor,{mode:'live'})).phase,'pending');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0,'coordination is never Premium');
}));

test('Apple context protocol is optional by default, strict requires new protocol and blocked attempts release only prepared slot',()=>withAuth(async()=>{
 const legacy=await fixture({enabled:false});let response=await appleContext({env:legacy.env,request:request('/api/apple/purchase-context',{productId:PRODUCT})});
 assert.equal(response.status,200);assert.equal((await response.json()).reservation,undefined);
 const f=await fixture();response=await appleContext({env:f.env,request:request('/api/apple/purchase-context',{productId:PRODUCT})});
 assert.equal(response.status,426);assert.equal((await response.json()).code,'purchase_intent_upgrade_required');
 response=await appleContext({env:{...f.env,BB_OWNER_USER_ID:USER},request:request('/api/apple/purchase-context',{productId:PRODUCT,reservationProtocol:1})});
 assert.equal(response.status,409);assert.equal((await response.json()).provider,'owner');
 assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents').get().phase,'canceled');
 response=await appleContext({env:f.env,request:request('/api/apple/purchase-context',{productId:PRODUCT,reservationProtocol:1})});
 assert.equal(response.status,200);const context=await response.json();assert.equal(context.reservation.phase,'prepared');assert.equal(context.appAccountToken,ACCOUNT);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);
}));

test('Apple captures billing revision before fresh provider reads and refuses a later stale start',()=>withAuth(async()=>{
 const f=await fixture();let observed=false;
 f.db.before=query=>{if(!observed&&query.includes('SELECT status,price_id,plan FROM bb_paid_entitlements')){observed=true;assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents').get().phase,'prepared');f.sql.exec('UPDATE bb_purchase_intent_slots SET billing_revision=billing_revision+1');}};
 const response=await appleContext({env:f.env,request:request('/api/apple/purchase-context',{productId:PRODUCT,reservationProtocol:1})});
 assert.equal(response.status,200);const context=await response.json();
 await assert.rejects(()=>startPurchaseIntent(f.env,f.actor,context.reservation),error=>error.code==='purchase_intent_changed');
}));

test('verified Apple persistence and exact intent proof commit atomically, preserving paid restore without an intent',()=>withAuth(async()=>{
 const f=await fixture();let intent=await startPurchaseIntent(f.env,f.actor,await reservePurchaseIntent(f.env,f.actor,selection));
 const current=state();const saved=await persistAppleSubscription(f.env,USER,current,{reservation:intent,actor:f.actor});
 assert.equal(appleEntitlementFromRow(getVerifiedAppleConfig(f.env),saved).premiumAccess,true);
 assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents WHERE id=?').get(intent.id).phase,'completed');assert.equal(await readPurchaseIntent(f.env,f.actor,{mode:'live'}),null);
 intent=await startPurchaseIntent(f.env,f.actor,await reservePurchaseIntent(f.env,f.actor,{...selection,provider:'google_play',productId:'basketboss_premium'}));
 await persistAppleSubscription(f.env,USER,{...current,lastVerifiedAtMs:current.lastVerifiedAtMs+1});
 assert.equal((await readPurchaseIntent(f.env,f.actor,{mode:'live'})).id,intent.id,'a restore/notification of an older Apple subscription must not clear newer started checkout');
 assert.equal((await readPurchaseIntent(f.env,f.actor,{mode:'live'})).phase,'started');
}));

test('Apple proof transaction rolls back together on failure and invalid correlation cannot reject a paid restore',()=>withAuth(async()=>{
 const f=await fixture(),current=state();
 f.db.before=query=>{if(query.startsWith('INSERT INTO bb_purchase_intent_proofs'))throw Error('synthetic transient D1 failure');};
 await assert.rejects(()=>persistAppleSubscription(f.env,USER,current),/synthetic transient/);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_apple_subscriptions').get().n,0);
 f.db.before=null;
 const saved=await persistAppleSubscription(f.env,USER,current,{reservation:{id:'invalid',capability:'invalid',version:1,generation:1},actor:f.actor});
 assert.equal(saved.status,'active');assert.equal(f.sql.prepare('SELECT intent_id FROM bb_purchase_intent_proofs').get().intent_id,null);
 const old=await fixture({schema:false});assert.equal((await persistAppleSubscription(old.env,USER,state())).status,'active','missing optional schema cannot strand existing verified Apple transactions');
}));

test('Apple per-purchase identity allows a later checkout in the same lineage and late direct correlation after notification',()=>withAuth(async()=>{
 const f=await fixture(),first=state();let intent=await startPurchaseIntent(f.env,f.actor,await reservePurchaseIntent(f.env,f.actor,selection));
 await persistAppleSubscription(f.env,USER,first,{reservation:intent,actor:f.actor});
 intent=await startPurchaseIntent(f.env,f.actor,await reservePurchaseIntent(f.env,f.actor,selection));
 const later={...first,transactionId:'20000000000002',appleSignedAtMs:first.appleSignedAtMs+1,lastVerifiedAtMs:first.lastVerifiedAtMs+1};
 // A signed notification can arrive before the direct purchase response. Its
 // genuine proof survives, then the exact authenticated callback correlates it.
 await persistAppleSubscription(f.env,USER,later);
 assert.equal((await readPurchaseIntent(f.env,f.actor,{mode:'live'})).id,intent.id);
 await persistAppleSubscription(f.env,USER,{...later,lastVerifiedAtMs:later.lastVerifiedAtMs+1},{reservation:intent,actor:f.actor});
 assert.equal(f.sql.prepare('SELECT phase FROM bb_purchase_intents WHERE id=?').get(intent.id).phase,'completed');
 assert.equal(await readPurchaseIntent(f.env,f.actor,{mode:'live'}),null);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_purchase_intent_proofs').get().n,2);
}));
