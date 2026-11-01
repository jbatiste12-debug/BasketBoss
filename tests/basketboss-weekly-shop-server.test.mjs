import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequest} from '../functions/api/shopping/weekly-trip.js';
import {ensureWeeklyShopSchema,readWeeklyShop,startWeeklyShop,weeklyShopPeriod} from '../bb-server-lib/bb-weekly-shop.js';
import {digestDeletionActor,ensureDeletionSchema,eraseAccountD1} from '../bb-server-lib/bb-account-deletion.js';

const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const ONE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',TWO='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRICE='pri_'+'s'.repeat(26),ORIGIN='https://basketboss.co.uk',ENDPOINT=ORIGIN+'/api/shopping/weekly-trip';
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER);
  CREATE TABLE bb_founder_slots(slot_no INTEGER,state TEXT,user_id TEXT,reservation_token_hash TEXT,paddle_subscription_id TEXT,reservation_expires_at_ms INTEGER,updated_at_ms INTEGER);
  CREATE TABLE bb_billing_claims(user_id TEXT)`);
 const db={sql,before:null,prepare(query){
  const statement=(args=[])=>({bind(...values){return statement(values);},
   async first(){db.before?.(query,args);return sql.prepare(query).get(...args)||null;},
   async all(){db.before?.(query,args);return {results:sql.prepare(query).all(...args)};},
   async run(){db.before?.(query,args);const info=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(info.changes)}};}});
  return statement();
 },async batch(statements){
  // D1 serializes its atomic batches. The fixture serializes preparations,
  // while individual INSERT statements still interleave in race checks.
  const previous=db.pending||Promise.resolve();let release;db.pending=new Promise(resolve=>{release=resolve;});await previous;
  sql.exec('BEGIN');try{const values=[];for(const statement of statements)values.push(await statement.run());sql.exec('COMMIT');return values;}
  catch(error){sql.exec('ROLLBACK');throw error;}finally{release();}
 }};return db;
}
function fixture(t){
 const db=database(),env={BILLING_DB:db,SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',BB_BILLING_ENABLED:'false'};
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options={})=>{
  assert.equal(url,'https://synthetic.supabase.co/auth/v1/user');calls.push(options);
  const token=options.headers.Authorization;
  if(!['Bearer user','Bearer other'].includes(token))return new Response('{}',{status:401});
  return Response.json({id:token==='Bearer other'?OTHER:USER,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'});
 };t.after(()=>{globalThis.fetch=original;db.sql.close();});
 const request=(method='GET',body,extra={})=>new Request(ENDPOINT,{method,headers:{Origin:ORIGIN,Authorization:'Bearer user',...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const send=async(method='GET',body,headers)=>{const response=await onRequest({request:request(method,body,headers),env});return {response,value:await response.json()};};
 return {db,env,calls,request,send,count:()=>db.sql.prepare('SELECT COUNT(*) AS n FROM bb_weekly_shop_trips').get().n};
}

test('server week starts Monday at 00:00 UTC across year and daylight-saving boundaries',()=>{
 for(const [now,start,reset]of[
  ['2026-11-01T23:59:59.999Z','2026-10-26','2026-11-02T00:00:00.000Z'],
  ['2026-11-02T00:00:00.000Z','2026-11-02','2026-11-09T00:00:00.000Z'],
  ['2027-01-01T12:00:00Z','2026-12-28','2027-01-04T00:00:00.000Z'],
  ['2026-03-29T01:30:00Z','2026-03-23','2026-03-30T00:00:00.000Z']
 ])assert.deepEqual(weeklyShopPeriod(Date.parse(now)),{weekStart:start,nextResetAt:reset});
});
test('status never spends allowance; first start and same-session retries use a single hashed record',async t=>{
 const f=fixture(t);let result=await f.send();assert.equal(result.response.status,200);assert.equal(result.value.used,false);assert.equal(f.count(),0);
 result=await f.send('POST',{sessionId:ONE});assert.equal(result.value.allowed,true);assert.equal(result.value.resumed,false);assert.equal(f.count(),1);
 for(let i=0;i<3;i++){result=await f.send('POST',{sessionId:ONE});assert.equal(result.value.resumed,true);assert.equal(f.count(),1);}
 result=await f.send();assert.equal(result.value.sessionId,ONE);assert.equal(result.value.used,true);assert.equal(f.count(),1);
 const stored=f.db.sql.prepare('SELECT * FROM bb_weekly_shop_trips').get();assert.equal(stored.actor_hash,await digestDeletionActor(USER));
 assert.deepEqual(Object.keys(stored),['actor_hash','week_start','session_id','started_at_ms']);assert.ok(!JSON.stringify(stored).includes(USER));
 assert.match(result.response.headers.get('Cache-Control'),/no-store/);assert.match(result.response.headers.get('Vary'),/Authorization/);
});
test('a different session is limited, while another account has its own allowance',async t=>{
 const f=fixture(t);await f.send('POST',{sessionId:ONE});
 const limited=await f.send('POST',{sessionId:TWO});assert.equal(limited.response.status,429);assert.equal(limited.value.error,'weekly_shop_limit');assert.ok(limited.value.nextResetAt);
 const other=await f.send('POST',{sessionId:TWO},{Authorization:'Bearer other'});assert.equal(other.value.allowed,true);assert.equal(f.count(),2);
 assert.equal((await f.send('GET',undefined,{Authorization:'Bearer other'})).value.sessionId,TWO);
});
test('simultaneous different starts atomically accept one Free trip and same-session retries remain idempotent',async t=>{
 const f=fixture(t);await ensureDeletionSchema(f.env);await ensureWeeklyShopSchema(f.env);
 const starts=await Promise.all([f.send('POST',{sessionId:ONE}),f.send('POST',{sessionId:TWO})]);
 assert.deepEqual(starts.map(x=>x.response.status).sort(),[200,429]);assert.equal(f.count(),1);
 const winner=starts.find(x=>x.response.status===200).value.sessionId;
 const retries=await Promise.all([f.send('POST',{sessionId:winner}),f.send('POST',{sessionId:winner})]);
 assert.ok(retries.every(x=>x.value.allowed&&x.value.resumed));assert.equal(f.count(),1);
});
test('a prior-week or older unfinished trip resumes without consuming the current new trip',async t=>{
 const f=fixture(t),before=Date.parse('2026-08-02T23:59:59Z'),after=Date.parse('2026-11-02T00:00:00Z');
 await startWeeklyShop(f.env,USER,ONE,before);
 const resumed=await startWeeklyShop(f.env,USER,ONE,after);assert.equal(resumed.resumed,true);assert.equal(resumed.used,false);assert.equal(resumed.sessionWeekStart,'2026-07-27');
 assert.equal((await readWeeklyShop(f.env,USER,after)).used,false);
 await startWeeklyShop(f.env,USER,TWO,after);assert.equal(f.count(),2);
 assert.equal((await startWeeklyShop(f.env,USER,ONE,after)).allowed,true,'a different device may still be using its older trip');
 assert.equal(f.count(),2);
});
test('simultaneous retry across a week boundary consumes only the original approval',async t=>{
 const f=fixture(t);await ensureDeletionSchema(f.env);await ensureWeeklyShopSchema(f.env);
 const results=await Promise.all([startWeeklyShop(f.env,USER,ONE,Date.parse('2026-11-01T23:59:59.999Z')),startWeeklyShop(f.env,USER,ONE,Date.parse('2026-11-02T00:00:00Z'))]);
 assert.ok(results.every(x=>x.allowed));assert.equal(f.count(),1);
});
test('server-confirmed Premium is unlimited without spending or creating the Free usage table',async t=>{
 const f=fixture(t);Object.assign(f.env,{BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'sandbox',PADDLE_SANDBOX_STANDARD_PRICE_ID:PRICE});
 f.db.sql.prepare('INSERT INTO bb_paid_entitlements VALUES(?,?,?,?,?)').run(USER,'active',PRICE,'standard',Date.now());
 for(const sessionId of[ONE,TWO]){const result=await f.send('POST',{sessionId});assert.equal(result.value.allowed,true);assert.equal(result.value.premium,true);assert.equal(result.value.unlimited,true);}
 assert.equal(f.db.sql.prepare("SELECT name FROM sqlite_master WHERE name='bb_weekly_shop_trips'").get(),undefined);
});
test('a membership lookup failure fails closed without spending the paid member Free allowance',async t=>{
 const f=fixture(t);Object.assign(f.env,{BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'sandbox',PADDLE_SANDBOX_STANDARD_PRICE_ID:PRICE});
 f.db.before=query=>{if(query.includes('FROM bb_paid_entitlements'))throw Error('synthetic entitlement outage');};
 const result=await f.send('POST',{sessionId:ONE});assert.equal(result.response.status,503);assert.equal(result.value.error,'weekly_shop_unavailable');
 assert.equal(f.db.sql.prepare("SELECT name FROM sqlite_master WHERE name='bb_weekly_shop_trips'").get(),undefined);
});
test('an older Premium session is rejected before unlimited access or a Free allocation',async t=>{
 const f=fixture(t);Object.assign(f.env,{BB_OWNER_USER_ID:USER,BB_PREMIUM_SINGLE_SESSION_ENABLED:'true'});
 const result=await f.send('POST',{sessionId:ONE});assert.equal(result.response.status,403);assert.equal(result.value.error,'weekly_shop_newer_session_exists');
 assert.equal(f.db.sql.prepare("SELECT name FROM sqlite_master WHERE name='bb_weekly_shop_trips'").get(),undefined);
});
test('Origin, method, confirmed authentication and bounded JSON are required without quota writes',async t=>{
 const f=fixture(t);
 for(const [method,body,headers,status]of[
  ['GET',undefined,{Origin:'https://untrusted.invalid'},403],['DELETE',undefined,{},405],
  ['GET',undefined,{Authorization:''},401],['GET',undefined,{Authorization:'Bearer unknown'},401],
  ['POST',{sessionId:ONE,actor:OTHER},{},400],['POST',{sessionId:[ONE]},{},400],['POST',{sessionId:'bad'},{},400],
  ['POST',{sessionId:ONE},{'Content-Type':'text/plain'},415],['POST',{sessionId:'x'.repeat(600)},{},413]
 ])assert.equal((await f.send(method,body,headers)).response.status,status);
 assert.equal(f.db.sql.prepare("SELECT name FROM sqlite_master WHERE name='bb_weekly_shop_trips'").get(),undefined);
 const noOrigin=f.request();noOrigin.headers.delete('Origin');noOrigin.headers.set('Sec-Fetch-Site','same-origin');assert.equal((await onRequest({request:noOrigin,env:f.env})).status,200);
 const native=f.request('POST',{sessionId:ONE},{Origin:'capacitor://localhost'});assert.equal((await onRequest({request:native,env:f.env})).status,200);
});
test('unexpected existing allowance schema fails closed rather than accepting duplicate Free sessions',async t=>{
 const f=fixture(t);f.db.sql.exec('CREATE TABLE bb_weekly_shop_trips(actor_hash TEXT,week_start TEXT,session_id TEXT,started_at_ms INTEGER)');
 const result=await f.send('POST',{sessionId:ONE});assert.equal(result.response.status,503);assert.equal(f.count(),0);
});
test('a deletion beginning at the final INSERT blocks late quota resurrection',async t=>{
 const f=fixture(t);await ensureDeletionSchema(f.env);await ensureWeeklyShopSchema(f.env);const actor=await digestDeletionActor(USER);
 f.db.before=query=>{if(query.startsWith('INSERT OR IGNORE INTO bb_weekly_shop_trips')){f.db.before=null;f.db.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(actor,'synthetic',Date.now());}};
 const result=await f.send('POST',{sessionId:ONE});assert.equal(result.response.status,409);assert.equal(f.count(),0);
});
test('account deletion erases only that account allowance records and remains safe before optional schema exists',async t=>{
 const f=fixture(t);await startWeeklyShop(f.env,USER,ONE);await startWeeklyShop(f.env,OTHER,TWO);
 const billing={claims:[],subscriptions:[],confirmedSlots:[]};await eraseAccountD1(f.env,USER,billing);assert.equal(f.count(),1);
 assert.equal((await readWeeklyShop(f.env,OTHER)).sessionId,TWO);
 f.db.sql.exec('DROP TABLE bb_weekly_shop_trips');await eraseAccountD1(f.env,USER,billing);
});
test('reviewed D1 migration is idempotent and preserves existing billing rows',()=>{
 const db=database(),migration=readFileSync(new URL('../sql/basketboss_weekly_shop_20261101.sql',import.meta.url),'utf8');
 db.sql.prepare('INSERT INTO bb_paid_entitlements VALUES(?,?,?,?,?)').run(USER,'active',PRICE,'standard',123);
 const before=db.sql.prepare('SELECT * FROM bb_paid_entitlements').all();db.sql.exec(migration);db.sql.exec(migration);
 assert.deepEqual(db.sql.prepare('SELECT * FROM bb_paid_entitlements').all(),before);
 const row=[USER,'2026-11-02',ONE,1];db.sql.prepare('INSERT INTO bb_weekly_shop_trips VALUES(?,?,?,?)').run(...row);
 assert.throws(()=>db.sql.prepare('INSERT INTO bb_weekly_shop_trips VALUES(?,?,?,?)').run(USER,'2026-11-02',TWO,1),/UNIQUE/);
 assert.throws(()=>db.sql.prepare('INSERT INTO bb_weekly_shop_trips VALUES(?,?,?,?)').run(USER,'2026-11-09',ONE,1),/UNIQUE/);db.sql.close();
});
