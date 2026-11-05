import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {YELLOW_STICKER_STORES} from '../functions/api/yellow-stickers.js';
const modulePath=process.env.BB_RECEIPT_PGLITE_PATH;
test('PostgreSQL community sightings enforce scope, 90-minute expiry, cooldown, replay bounds and account deletion',{skip:!modulePath},async()=>{
 const {PGlite}=await import(pathToFileURL(modulePath).href),db=new PGlite(),user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${user}'),('${other}');`);
  const sql=await readFile(new URL('../supabase/migrations/20261105091222_yellow_sticker_reports.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql);
  for(const [region,stores]of Object.entries(YELLOW_STICKER_STORES))for(const store of stores)assert.equal((await db.query('SELECT public.bb_yellow_sticker_store_valid($1,$2) AS valid',[region,store])).rows[0].valid,true,region+' '+store);
  const report=async(actor=user,status='spotted',id='request-0001',region='Guernsey',store='waitrose')=>(await db.query('SELECT public.bb_yellow_sticker_report($1,$2,$3,$4,$5) AS value',[actor,region,store,status,id])).rows[0].value;
  const snapshot=async(region='Guernsey',store='waitrose')=>(await db.query('SELECT public.bb_yellow_sticker_snapshot($1,$2) AS value',[region,store])).rows[0].value;
  let state=await snapshot();assert.equal(state.lastSpottedAt,null);assert.equal(state.spottedReports,0);
  state=await report();assert.equal(state.duplicate,false);assert.equal(state.spottedReports,1);assert.ok(Date.parse(state.lastSpottedAt)<=Date.parse(state.serverNow));assert.equal(Date.parse(state.expiresAt)-Date.parse(state.lastSpottedAt),90*60000);const first=state.lastSpottedAt;
  const replay=await report();assert.equal(replay.duplicate,true);assert.equal(replay.lastSpottedAt,first);
  assert.equal((await report(user,'not_yet','request-0001')).error,'yellow_sticker_request_conflict');
  assert.equal((await report(user,'spotted','request-0002')).error,'yellow_sticker_cooldown');
  const notYet=await report(other,'not_yet','request-other');assert.equal(notYet.lastSpottedAt,first);assert.notEqual(notYet.latestNotYetAt,null);assert.equal(notYet.spottedReports,1);
  assert.equal((await snapshot('Jersey','waitrose')).lastSpottedAt,null);assert.equal((await snapshot('Guernsey','alliance')).lastSpottedAt,null);
  assert.equal((await report(user,'spotted','request-wrong','UK','alliance')).error,'yellow_sticker_invalid_request');
  await db.exec(`UPDATE public.bb_yellow_sticker_reports SET last_reported_at=clock_timestamp()-interval '6 minutes' WHERE user_id='${user}'`);
  state=await report(user,'not_yet','request-0002');assert.equal(state.lastSpottedAt,first,'Not yet never erases an existing positive report');
  for(let i=3;i<39;i++){await db.exec(`UPDATE public.bb_yellow_sticker_reports SET last_reported_at=clock_timestamp()-interval '6 minutes' WHERE user_id='${user}'`);await report(user,'spotted','request-'+String(i).padStart(4,'0'));}
  const counts=(await db.query('SELECT count(*)::int AS rows,max(jsonb_array_length(recent_requests))::int AS requests FROM public.bb_yellow_sticker_reports')).rows[0];assert.deepEqual(counts,{rows:2,requests:32});
  await db.exec(`UPDATE public.bb_yellow_sticker_reports SET last_spotted_at=clock_timestamp()-interval '91 minutes',last_not_yet_at=clock_timestamp()-interval '91 minutes'`);state=await snapshot();assert.equal(state.lastSpottedAt,null);assert.equal(state.latestNotYetAt,null);assert.equal(state.expiresAt,null);assert.equal(state.spottedReports,0);
  await db.exec(`DELETE FROM auth.users WHERE id='${user}'`);assert.equal((await db.query('SELECT count(*)::int AS total FROM public.bb_yellow_sticker_reports WHERE user_id=$1',[user])).rows[0].total,0);assert.equal((await report()).error,'yellow_sticker_sign_in_required');
  const privileges=(await db.query(`SELECT has_table_privilege('anon','public.bb_yellow_sticker_reports','SELECT') AS anon_read,has_table_privilege('authenticated','public.bb_yellow_sticker_reports','INSERT') AS browser_write,has_function_privilege('authenticated','public.bb_yellow_sticker_report(uuid,text,text,text,text)','EXECUTE') AS browser_rpc,has_function_privilege('anon','public.bb_yellow_sticker_snapshot(text,text)','EXECUTE') AS public_rpc,has_function_privilege('service_role','public.bb_yellow_sticker_report(uuid,text,text,text,text)','EXECUTE') AS service_rpc`)).rows[0];assert.deepEqual(privileges,{anon_read:false,browser_write:false,browser_rpc:false,public_rpc:false,service_rpc:true});
  const flags=(await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.bb_yellow_sticker_reports'::regclass`)).rows[0];assert.equal(flags.relrowsecurity,true);
  await db.exec('SET ROLE service_role');assert.equal((await snapshot()).ok,true);assert.equal((await report(other,'spotted','request-service','Jersey','alliance')).ok,true);await db.exec('RESET ROLE');
 }finally{await db.close();}
});
