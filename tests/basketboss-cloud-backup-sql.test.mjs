import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),modulePath=process.env.BB_PGLITE_MODULE;
const sql=fs.readFileSync(new URL('../supabase/migrations/20261106120712_basketboss_data_cloud_backup.sql',import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
async function fixture(){
 const {PGlite}=require(modulePath),db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
   'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
  GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
  INSERT INTO auth.users VALUES('${A}'),('${B}'),('${C}');`);
 const as=async(role,actor,work)=>{
  assert.ok(['anon','authenticated','service_role'].includes(role));await db.exec('SET ROLE '+role);
  try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor||'']);return await work();}
  finally{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub','',false)");}
 };
 return {db,as};
}

test('actual PostgreSQL cloud backup supports owner upsert, enforces account isolation and cascades deleted users',
 {skip:!modulePath},async()=>{
 const {db,as}=await fixture();
 const saved={version:2,planned:[{recipeId:'rice',day:'Monday'}],pantry:{rice:true}},updated={...saved,planned:[{recipeId:'pasta',day:'Tuesday'}]};
 const insert=(id,data)=>db.query('INSERT INTO public.basketboss_data(user_id,data) VALUES($1,$2::jsonb)',[id,JSON.stringify(data)]);
 const upsert=(id,data)=>db.query('INSERT INTO public.basketboss_data(user_id,data) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=now() RETURNING data',[id,JSON.stringify(data)]);
 const all=()=>db.query('SELECT user_id,data,updated_at FROM public.basketboss_data ORDER BY user_id');
 try{
  await db.exec(sql);
  await as('authenticated',A,async()=>{await insert(A,saved);assert.deepEqual((await all()).rows.map(r=>r.user_id),[A]);});
  await as('authenticated',B,async()=>{assert.deepEqual((await all()).rows,[]);await insert(B,{version:2,planned:[]});});
  await as('authenticated',A,async()=>{
   assert.deepEqual((await upsert(A,updated)).rows[0].data,updated);
   assert.deepEqual((await all()).rows.map(r=>r.user_id),[A]);
   assert.equal((await db.query('SELECT * FROM public.basketboss_data WHERE user_id=$1',[B])).rows.length,0);
   assert.equal((await db.query("UPDATE public.basketboss_data SET data='{}' WHERE user_id=$1 RETURNING user_id",[B])).rows.length,0);
   await assert.rejects(insert(C,{attempt:'another-account'}),/row-level security/i);
   await assert.rejects(upsert(B,{attempt:'another-account'}),/row-level security/i);
   await assert.rejects(db.query('UPDATE public.basketboss_data SET user_id=$1 WHERE user_id=$2',[C,A]),/row-level security/i);
   await assert.rejects(db.query('DELETE FROM public.basketboss_data WHERE user_id=$1',[A]),/permission denied/i);
   for(const data of[[],null,'not an object',1,true])await assert.rejects(db.query('UPDATE public.basketboss_data SET data=$1::jsonb WHERE user_id=$2',[JSON.stringify(data),A]),/check constraint/i);
   await assert.rejects(db.query('UPDATE public.basketboss_data SET data=NULL WHERE user_id=$1',[A]),/not-null constraint/i);
  });
  await as('anon','',async()=>{await assert.rejects(all(),/permission denied/i);await assert.rejects(insert(C,{}),/permission denied/i);});
  await as('authenticated','',async()=>{assert.deepEqual((await all()).rows,[]);await assert.rejects(insert(C,{}),/row-level security/i);});
  await as('service_role','',async()=>{assert.equal((await all()).rows.length,2);await insert(C,{service:true});assert.equal((await db.query('DELETE FROM public.basketboss_data WHERE user_id=$1 RETURNING user_id',[C])).rows.length,1);});
  const before=(await all()).rows;await db.exec(sql);assert.deepEqual((await all()).rows,before,'rerunning reviewed SQL preserves all backups and timestamps');
  const flags=(await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.basketboss_data'::regclass")).rows[0];assert.equal(flags.relrowsecurity,true);
  const grants=(await db.query("SELECT has_table_privilege('anon','public.basketboss_data','SELECT') AS anon_read,has_table_privilege('authenticated','public.basketboss_data','SELECT,INSERT,UPDATE') AS own_crud,has_table_privilege('authenticated','public.basketboss_data','DELETE') AS browser_delete,has_table_privilege('service_role','public.basketboss_data','SELECT,INSERT,UPDATE,DELETE') AS service_crud")).rows[0];assert.deepEqual(grants,{anon_read:false,own_crud:true,browser_delete:false,service_crud:true});
  await db.query('DELETE FROM auth.users WHERE id=$1',[A]);assert.deepEqual((await all()).rows.map(r=>r.user_id),[B]);
  await as('authenticated',A,async()=>{assert.deepEqual((await all()).rows,[]);await assert.rejects(insert(A,saved),/foreign key constraint/i);});
  assert.deepEqual((await all()).rows[0].data,{version:2,planned:[]},'the other account remains intact');
 }finally{await db.close();}
});

test('cloud backup SQL stops on unexpected existing objects or policies instead of weakening them',
 {skip:!modulePath},async()=>{
 for(const kind of['shape','policy']){
  const {db}=await fixture();
  try{
   if(kind==='shape')await db.exec('CREATE TABLE public.basketboss_data(user_id text,data jsonb,updated_at timestamptz);');
   else{await db.exec(sql);await db.exec('CREATE POLICY unreviewed_public_read ON public.basketboss_data FOR SELECT TO authenticated USING(true);');}
   const before=(await db.query("SELECT polname,pg_get_expr(polqual,polrelid) AS expr FROM pg_policy WHERE polrelid='public.basketboss_data'::regclass ORDER BY polname")).rows;
   await assert.rejects(db.exec(sql),new RegExp('basketboss_data_preflight_'+kind));await db.exec('ROLLBACK');
   assert.deepEqual((await db.query("SELECT polname,pg_get_expr(polqual,polrelid) AS expr FROM pg_policy WHERE polrelid='public.basketboss_data'::regclass ORDER BY polname")).rows,before);
   if(kind==='shape')assert.equal((await db.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='basketboss_data' AND column_name='user_id'")).rows[0].data_type,'text');
  }finally{await db.close();}
 }
});
