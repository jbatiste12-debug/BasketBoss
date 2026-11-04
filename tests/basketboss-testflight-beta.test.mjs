import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureDeletionSchema,digestDeletionActor,eraseAccountD1} from '../bb-server-lib/bb-account-deletion.js';
import {persistTestFlightBetaGrant,readTestFlightBetaGrant,validateTestFlightAppClaims,verifyTestFlightAppTransaction,TESTFLIGHT_BETA_END_MS} from '../bb-server-lib/bb-testflight-beta.js';
import {readPersonalPaidAccess} from '../bb-server-lib/bb-paid-access.js';
import {createTestFlightBetaHandler} from '../functions/api/apple/testflight-beta.js';
import {onRequestGet as subscriptionStatus} from '../functions/api/subscription/status.js';
import {AppleBillingError} from '../bb-server-lib/bb-apple-subscriptions.js';

const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const NOW=Date.parse('2026-11-03T12:00:00Z');
const claims=(overrides={})=>({receiptType:'Sandbox',bundleId:'uk.co.basketboss.app',appAppleId:1234567890,appTransactionId:'12345678901',applicationVersion:'6',receiptCreationDate:NOW-86400000,...overrides});
function fixture(){
 const sql=new DatabaseSync(':memory:');
 const db={prepare(query){let values=[];const statement={bind(...args){values=args;return statement;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const row=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(row.changes)}};}};return statement;},async batch(list){sql.exec('BEGIN');try{const result=[];for(const item of list)result.push(await item.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 return {sql,env:{BILLING_DB:db,APPLE_APP_ID:'1234567890',APPLE_BILLING_ENABLED:'false',BB_BILLING_ENABLED:'false',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_test'},close(){sql.close();}};
}
const post=(body={signedAppTransaction:'proof'},origin='capacitor://localhost')=>new Request('https://basketboss.co.uk/api/apple/testflight-beta',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer verified-test'},body:JSON.stringify(body)});

test('claims reject non-Sandbox, wrong app, missing identity and future receipts',()=>{
 for(const patch of [{receiptType:'Production'},{receiptType:'Xcode'},{receiptType:'LocalTesting'},{bundleId:'other.app'},{appAppleId:987654321},{appTransactionId:undefined},{appTransactionId:'fake'},{applicationVersion:''},{receiptCreationDate:NOW+300001}]){
  assert.throws(()=>validateTestFlightAppClaims({APPLE_APP_ID:'1234567890'},claims(patch),NOW),{code:'testflight_beta_invalid_proof'});
 }
 assert.equal(validateTestFlightAppClaims({},claims({receiptCreationDate:NOW-365*86400000}),NOW).receiptType,'Sandbox','cached genuine Apple receipts need not be freshly issued');
});

test('malformed and unsigned requests never reach entitlement persistence',async()=>{
 await assert.rejects(verifyTestFlightAppTransaction({},'not-a-signed-transaction'),{code:'invalid_apple_transaction'});
 const f=fixture();try{
  let verified=0;const handler=createTestFlightBetaHandler({authenticate:async()=>({id:USER}),newestSession:async()=>true,verify:async()=>{verified++;throw Error('invalid proof');},clock:()=>NOW});
  const response=await handler({request:post(),env:f.env});assert.equal(response.status,503);assert.equal(verified,1);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='bb_testflight_beta_grants'").get().n,0);
 }finally{f.close();}
});

test('D1 binds one proof and one account, makes retry idempotent, and never extends expiry',async()=>{
 const f=fixture();try{
  const first=await persistTestFlightBetaGrant(f.env,USER,claims(),{now:NOW});
  const retry=await persistTestFlightBetaGrant(f.env,USER,claims(),{now:NOW+86400000});
  assert.equal(retry.expiresAtMs,first.expiresAtMs);assert.ok(first.expiresAtMs<=TESTFLIGHT_BETA_END_MS);
  await assert.rejects(persistTestFlightBetaGrant(f.env,OTHER,claims(),{now:NOW}),{code:'testflight_beta_account_mismatch'});
  await assert.rejects(persistTestFlightBetaGrant(f.env,USER,claims({appTransactionId:'987654321'}),{now:NOW}),{code:'testflight_beta_account_mismatch'});
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bb_testflight_beta_grants').get().n,1);
  assert.equal(await readTestFlightBetaGrant(f.env,OTHER,{now:NOW}),null);
  const stored=JSON.stringify(f.sql.prepare('SELECT * FROM bb_testflight_beta_grants').get());
  assert.equal(stored.includes('12345678901'),false,'raw Apple account transaction identifier is not stored');
 }finally{f.close();}
});

test('expiry, revocation, campaign end and kill switch remove access without renewing it',async()=>{
 const f=fixture();try{
  const grant=await persistTestFlightBetaGrant(f.env,USER,claims(),{now:NOW});
  assert.equal(await readTestFlightBetaGrant(f.env,USER,{now:grant.expiresAtMs}),null);
  assert.equal(await readTestFlightBetaGrant({...f.env,BB_TESTFLIGHT_BETA_ENABLED:'false'},USER,{now:NOW}),null);
  await assert.rejects(persistTestFlightBetaGrant(f.env,USER,claims(),{now:TESTFLIGHT_BETA_END_MS}),{code:'testflight_beta_ended'});
  f.sql.prepare('UPDATE bb_testflight_beta_grants SET revoked_at_ms=?').run(NOW);
  assert.equal(await readTestFlightBetaGrant(f.env,USER,{now:NOW}),null);
  await assert.rejects(persistTestFlightBetaGrant(f.env,USER,claims(),{now:NOW}),{code:'testflight_beta_account_mismatch'});
 }finally{f.close();}
});

test('account deletion erases identity, leaves revoked proof tombstone and blocks reactivation',async()=>{
 const f=fixture();try{
  await persistTestFlightBetaGrant(f.env,USER,claims(),{now:NOW});
  f.sql.exec('CREATE TABLE bb_founder_slots(user_id TEXT,state TEXT,paddle_subscription_id TEXT,reservation_token_hash TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER); CREATE TABLE bb_paid_entitlements(user_id TEXT); CREATE TABLE bb_billing_claims(user_id TEXT)');
  f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(USER),'retry',NOW);
  await eraseAccountD1(f.env,USER,{claims:[],subscriptions:[]});
  const row=f.sql.prepare('SELECT * FROM bb_testflight_beta_grants').get();assert.equal(row.user_id,null);assert.ok(row.revoked_at_ms);assert.equal(row.application_version,'');
  assert.equal(await readTestFlightBetaGrant(f.env,USER,{now:NOW}),null);
  await assert.rejects(persistTestFlightBetaGrant(f.env,USER,claims(),{now:NOW}),{code:'account_deletion_pending'});
  await assert.rejects(persistTestFlightBetaGrant(f.env,OTHER,claims(),{now:NOW}),{code:'testflight_beta_account_mismatch'});
 }finally{f.close();}
});

test('claim endpoint enforces sign-in, origin, newest session, deletion and exact request shape',async()=>{
 for(const mode of ['signedout','origin','stale','deleting','shape']){
  const f=fixture();try{
   let verified=0;await ensureDeletionSchema(f.env);
   if(mode==='deleting')f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(USER),'retry',NOW);
   const handler=createTestFlightBetaHandler({authenticate:async()=>mode==='signedout'?null:{id:USER},newestSession:async()=>mode!=='stale',verify:async()=>{verified++;return claims();},clock:()=>NOW});
   const response=await handler({request:post(mode==='shape'?{signedAppTransaction:'proof',premium:true}:undefined,mode==='origin'?'https://evil.example':'capacitor://localhost'),env:f.env});
   assert.equal(response.status,{signedout:401,origin:403,stale:403,deleting:409,shape:400}[mode],mode);assert.equal(verified,0,mode);
  }finally{f.close();}
 }
});

test('session or deletion changes during Apple verification cannot create a grant',async()=>{
 for(const mode of ['session','deletion']){
  const f=fixture();try{
   let checked=0;const handler=createTestFlightBetaHandler({authenticate:async()=>({id:USER}),newestSession:async()=>++checked===1||mode!=='session',verify:async()=>{if(mode==='deletion')f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(USER),'retry',NOW);return claims();},clock:()=>NOW});
   const response=await handler({request:post(),env:f.env});assert.equal(response.status,mode==='session'?403:409);
   assert.equal(f.sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='bb_testflight_beta_grants'").get().n,0);
  }finally{f.close();}
 }
});

test('successful claim survives a fresh reader and status identifies Premium without IAP configuration',async()=>{
 const f=fixture(),originalFetch=globalThis.fetch,originalNow=Date.now;Date.now=()=>NOW;
 try{
  const handler=createTestFlightBetaHandler({authenticate:async()=>({id:USER}),newestSession:async()=>true,verify:async()=>claims(),clock:()=>NOW});
  assert.equal((await handler({request:post(),env:f.env})).status,200);
  const access=await readPersonalPaidAccess({...f.env},USER);assert.equal(access.provider,'testflight_beta');assert.equal(access.premiumAccess,true);
  globalThis.fetch=async()=>Response.json({id:USER,email:'tester@example.test',email_confirmed_at:'2026-11-01T00:00:00Z'});
  const response=await subscriptionStatus({request:post(),env:f.env});assert.equal(response.status,200);const state=await response.json();
  assert.equal(state.authenticated,true);assert.equal(state.premiumAccess,true);assert.equal(state.tier,'premium');assert.equal(state.mode,'sandbox');assert.equal(state.provider,'testflight_beta');assert.equal(state.subscription,null);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;f.close();}
});

test('unexpected session and Apple verification failures return safe beta references without leaking secrets',async()=>{
 for(const stage of ['session','apple_verification']){
  const f=fixture(),originalWarn=console.warn,logs=[];
  const secret='Bearer private-token; signedAppleProof.private.signature; '+USER;
  try{
   console.warn=(...args)=>logs.push(args.join(' '));
   const handler=createTestFlightBetaHandler({authenticate:async()=>({id:USER}),newestSession:async()=>{if(stage==='session')throw Object.assign(Error(secret),{code:secret,status:401});return true;},verify:async()=>{throw Error(secret);},clock:()=>NOW});
   const response=await handler({request:post({signedAppTransaction:secret}),env:f.env}),body=await response.json();
   assert.equal(response.status,503);assert.equal(body.ok,false);assert.equal(body.code,'testflight_beta_unavailable');
   assert.equal(body.reference,'BB_BETA_'+stage.toUpperCase());assert.match(body.error,/TestFlight Beta Premium/);assert.ok(body.error.includes(body.reference),'installed clients display the reference in the existing error field');
   assert.equal(logs.length,1);assert.deepEqual(JSON.parse(logs[0].slice('BB_BETA_DIAGNOSTIC '.length)),{stage,code:'testflight_beta_unavailable',status:503,reference:body.reference});
   for(const sensitive of [secret,USER,'private-token','signedAppleProof'])assert.equal((logs.join('\n')+JSON.stringify(body)).includes(sensitive),false);
   assert.equal(f.sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='bb_testflight_beta_grants'").get().n,0,'unexpected readiness/proof failure never persists a grant');
  }finally{console.warn=originalWarn;f.close();}
 }
});

test('known Apple errors retain their status and code while diagnostics use only safe fields',async()=>{
 const f=fixture(),originalWarn=console.warn,logs=[];
 try{
  console.warn=(...args)=>logs.push(args.join(' '));
  const handler=createTestFlightBetaHandler({authenticate:async()=>({id:USER}),newestSession:async()=>true,verify:async()=>{throw new AppleBillingError('testflight_beta_unverified','Apple could not verify this beta installation.',403);},clock:()=>NOW});
  const response=await handler({request:post(),env:f.env});assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{ok:false,code:'testflight_beta_unverified',error:'Apple could not verify this beta installation.'});
  assert.deepEqual(JSON.parse(logs[0].slice('BB_BETA_DIAGNOSTIC '.length)),{stage:'apple_verification',code:'testflight_beta_unverified',status:403,reference:'BB_BETA_APPLE_VERIFICATION'});
 }finally{console.warn=originalWarn;f.close();}
});
