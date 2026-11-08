import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),modulePath=process.env.BB_PGLITE_MODULE;
const sql=fs.readFileSync(new URL('../sql/basketboss-planner-extras-v1.sql',import.meta.url),'utf8');
const base=fs.readFileSync(new URL('../supabase/migrations/20261106120712_basketboss_data_cloud_backup.sql',import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const payload={version:1,plannedBreakfasts:[{day:'Monday',recipeId:'eggs'}],portionOverrides:[{kind:'breakfast',day:'Monday',recipeId:'eggs',servings:2}]};
async function fixture(){
 const {PGlite}=require(modulePath),db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
 INSERT INTO auth.users VALUES('${A}'),('${B}');`);
 const as=async(role,actor,work)=>{await db.exec('SET ROLE '+role);try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor||'']);return await work();}finally{await db.exec('RESET ROLE');}};
 return {db,as,save:(value=payload,revision=0,generation='week-one')=>db.query('SELECT public.bb_save_planner_extras_v1($1,$2::jsonb,$3::bigint) AS result',[generation,JSON.stringify(value),revision])};
}

test('isolated PostgreSQL enforces owner-only CAS backups, old-client separation and Auth deletion', {skip:!modulePath},async()=>{
 const {db,as,save}=await fixture();
 try{
  await db.exec(base);await db.exec(sql);
  await as('authenticated',A,async()=>{
   assert.equal((await save()).rows[0].result.revision,1);await assert.rejects(save(),/planner_extras_conflict/);
   assert.equal((await save({...payload,portionOverrides:[{...payload.portionOverrides[0],servings:3}]},1)).rows[0].result.revision,2);
   await assert.rejects(save(payload,1),/planner_extras_conflict/);assert.equal((await save(payload,0,'week-two')).rows[0].result.revision,1);
   await db.query('INSERT INTO public.basketboss_data(user_id,data) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',[A,JSON.stringify({version:2,planned:[],plannedBreakfasts:payload.plannedBreakfasts})]);
   await db.query('INSERT INTO public.basketboss_data(user_id,data) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',[A,JSON.stringify({version:2,planned:[],pantry:{}})]);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM public.basketboss_planner_extras_v1')).rows[0].n,2,'old whole-plan uploads cannot remove the isolated extras rows');
   await assert.rejects(db.query('INSERT INTO public.basketboss_planner_extras_v1(user_id,plan_generation,payload) VALUES($1,$2,$3::jsonb)',[B,'other',JSON.stringify(payload)]),/row-level security/i);
   await assert.rejects(db.query('UPDATE public.basketboss_planner_extras_v1 SET user_id=$1 WHERE user_id=$2',[B,A]),/row-level security/i);
   await assert.rejects(db.query('DELETE FROM public.basketboss_planner_extras_v1 WHERE user_id=$1',[A]),/permission denied/i);
  });
  await as('authenticated',B,async()=>{assert.equal((await db.query('SELECT * FROM public.basketboss_planner_extras_v1')).rows.length,0);assert.equal((await save()).rows[0].result.revision,1);});
  await as('anon','',async()=>{await assert.rejects(save(),/permission denied/i);await assert.rejects(db.query('SELECT * FROM public.basketboss_planner_extras_v1'),/permission denied/i);});
  await as('authenticated','',async()=>{await assert.rejects(save(),/planner_extras_sign_in_required/);});
  const before=(await db.query('SELECT * FROM public.basketboss_planner_extras_v1 ORDER BY user_id,plan_generation')).rows;await db.exec(sql);assert.deepEqual((await db.query('SELECT * FROM public.basketboss_planner_extras_v1 ORDER BY user_id,plan_generation')).rows,before,'reinstallation never resets revisions or data');
  const functions=(await db.query("SELECT proname,prosecdef,proconfig FROM pg_proc WHERE oid IN ('public.bb_save_planner_extras_v1(text,jsonb,bigint)'::regprocedure,'public.bb_planner_extras_payload_valid_v1(jsonb)'::regprocedure) ORDER BY proname")).rows;
  assert.equal(functions.length,2);assert(functions.every(row=>row.prosecdef===false&&row.proconfig.includes('search_path=""')));
  await db.query('DELETE FROM auth.users WHERE id=$1',[A]);assert.deepEqual((await db.query('SELECT user_id FROM public.basketboss_planner_extras_v1')).rows.map(row=>row.user_id),[B]);
  await as('authenticated',A,async()=>{await assert.rejects(save(),/foreign key constraint/i);});
 }finally{await db.close();}
});

test('actual SQL rejects malformed extras, duplicates, stale revisions and generation changes', {skip:!modulePath},async()=>{
 const {db,as,save}=await fixture();
 try{
  await db.exec(sql);await as('authenticated',A,async()=>{
   const invalid=[null,[],{}, {...payload,version:2},{...payload,private:'extra'}, {...payload,plannedBreakfasts:[...payload.plannedBreakfasts,...payload.plannedBreakfasts]}, {...payload,portionOverrides:[...payload.portionOverrides,...payload.portionOverrides]}, {...payload,portionOverrides:[{...payload.portionOverrides[0],servings:13}]},{...payload,portionOverrides:[{...payload.portionOverrides[0],recipeId:'missing'}]}];
   for(const value of invalid)await assert.rejects(save(value),/planner_extras_invalid/);
   for(const generation of ['', 'spaces not allowed','a'.repeat(81),'week-one\n'])await assert.rejects(save(payload,0,generation),/planner_extras_invalid/);
   for(const revision of [-1,null,9007199254740991])await assert.rejects(save(payload,revision),/planner_extras_invalid/);
   assert.equal((await db.query('SELECT * FROM public.basketboss_planner_extras_v1')).rows.length,0);
   assert.equal((await save()).rows[0].result.revision,1);
   const tombstone={version:1,plannedBreakfasts:[],portionOverrides:[]};assert.deepEqual((await save(tombstone,1)).rows[0].result.payload,tombstone);
   const distinctKinds={version:1,plannedBreakfasts:[{day:'Monday',recipeId:'dinner'}],portionOverrides:[{kind:'breakfast',day:'Monday',recipeId:'dinner',servings:2},{kind:'dinner',day:'Monday',recipeId:'breakfast',servings:4}]};
   assert.deepEqual((await save(distinctKinds,0,'identity-positions')).rows[0].result.payload,distinctKinds,'kind and recipe IDs keep their own positions in duplicate detection');
  });
 }finally{await db.close();}
});

test('installer stops on unexpected schema or extra permissive policies without changing existing objects', {skip:!modulePath},async()=>{
 for(const kind of ['shape','policy']){
  const {db}=await fixture();
  try{
   if(kind==='shape')await db.exec('CREATE TABLE public.basketboss_planner_extras_v1(user_id text,payload jsonb);');
   else{await db.exec(sql);await db.exec('CREATE POLICY unexpected_read ON public.basketboss_planner_extras_v1 FOR SELECT TO authenticated USING(true);');}
   const policies=(await db.query("SELECT polname FROM pg_policy WHERE polrelid='public.basketboss_planner_extras_v1'::regclass ORDER BY polname")).rows;
   await assert.rejects(db.exec(sql),new RegExp('planner_extras_preflight_'+kind));await db.exec('ROLLBACK');
   assert.deepEqual((await db.query("SELECT polname FROM pg_policy WHERE polrelid='public.basketboss_planner_extras_v1'::regclass ORDER BY polname")).rows,policies);
  }finally{await db.close();}
 }
});
