import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const sql=fs.readFileSync(new URL('../sql/basketboss_account_deletion_20261031.sql',import.meta.url),'utf8');
test('account deletion migration keeps destructive RPCs service-only and installs legacy cloud protection',()=>{
 for(const signature of ['bb_account_delete_data(uuid,text)','bb_account_deletion_ready()','bb_hh_service_patch(uuid,uuid,text,text,jsonb,bigint)']){
  const escaped=signature.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(sql,new RegExp('REVOKE ALL ON FUNCTION public\\.'+escaped+' FROM PUBLIC,anon,authenticated;'));
  assert.match(sql,new RegExp('GRANT EXECUTE ON FUNCTION public\\.'+escaped+' TO service_role;'));
 }
 assert.match(sql,/FOREIGN KEY\(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE NOT VALID/);
 assert.match(sql,/SECURITY DEFINER SET search_path=''/);
 assert.match(sql,/NOTIFY pgrst, 'reload schema'/);
 assert.match(sql,/bb-receipt:household:/);
 assert.match(sql,/bb-receipt:user:/);
 assert.match(sql,/ORDER BY id FOR UPDATE/);
 assert.match(sql,/DELETE FROM auth\.refresh_tokens WHERE user_id=\$1/);
 assert.match(sql,/DELETE FROM auth\.flow_state WHERE user_id=\$1/);
 assert.doesNotMatch(sql,/DELETE FROM auth\.audit_log_entries/);
});

// Optional isolated PostgreSQL integration check. No production connection:
// npm install --prefix /tmp/bb-deletion-pg @electric-sql/pglite@0.3.14
// BB_PGLITE_MODULE=/tmp/bb-deletion-pg/node_modules/@electric-sql/pglite node --test tests/basketboss-account-deletion-sql.test.mjs
test('real PostgreSQL deletion preserves other accounts, scrubs invitations, rolls back failures and prevents JWT resurrection',
 {skip:!process.env.BB_PGLITE_MODULE},async()=>{
 const require=createRequire(import.meta.url);
 const {PGlite}=require(process.env.BB_PGLITE_MODULE);
 const db=new PGlite();
 const owner='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222';
 const other='33333333-3333-4333-8333-333333333333',replacement='44444444-4444-4444-8444-444444444444';
 const home='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherHome='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const one=async(query,params=[]) => (await db.query(query,params)).rows[0];
 const count=async(table,where='',params=[]) => (await one('SELECT count(*)::int AS n FROM '+table+' '+where,params)).n;
 const remove=async(id,email) => (await one('SELECT public.bb_account_delete_data($1::uuid,$2::text) AS value',[id,email])).value;
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
   CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,created_at timestamptz,not_after timestamptz);
   CREATE TABLE auth.refresh_tokens(id bigserial PRIMARY KEY,token text,user_id varchar(255),session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE);
   CREATE TABLE auth.flow_state(id uuid PRIMARY KEY,user_id uuid,linking_target_id uuid,provider_access_token text,provider_refresh_token text);
   CREATE TABLE auth.identities(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,identity_data jsonb);
   CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload jsonb,ip_address text);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
   CREATE TABLE public.basketboss_data(user_id uuid PRIMARY KEY,data jsonb,updated_at timestamptz);`);
  const household=fs.readFileSync(new URL('../sql/basketboss_household_production_20261029.sql',import.meta.url),'utf8');
  await db.exec(household.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
  await db.exec(fs.readFileSync(new URL('../sql/basketboss_receipt_inventory_20261031.sql',import.meta.url),'utf8'));
  for(const [id,email] of [[owner,'owner@example.invalid'],[partner,'partner@example.invalid'],[other,'other@example.invalid']]){
   await db.query("INSERT INTO auth.users VALUES($1::uuid,$2,'2026-10-31Z')",[id,email]);
   await db.query('INSERT INTO auth.sessions VALUES(gen_random_uuid(),$1::uuid,now(),NULL)',[id]);
   await db.query('INSERT INTO auth.refresh_tokens(token,user_id,session_id) SELECT $1,$2::uuid::text,id FROM auth.sessions WHERE user_id=$2::uuid',[id+':session',id]);
   await db.query('INSERT INTO auth.refresh_tokens(token,user_id,session_id) VALUES($1,$2,NULL)',[id+':legacy',id]);
   await db.query('INSERT INTO auth.flow_state VALUES(gen_random_uuid(),$1::uuid,NULL,$2,$3)',[id,id+':access',id+':refresh']);
   await db.query('INSERT INTO auth.identities VALUES(gen_random_uuid(),$1::uuid,$2::jsonb)',[id,JSON.stringify({email})]);
   await db.query("INSERT INTO public.basketboss_data VALUES($1::uuid,'{\"planned\":[\"Monday\"]}',now())",[id]);
   await db.query("INSERT INTO public.bb_receipt_inventory_scopes(scope_kind,scope_id,user_id) VALUES('user',$1::uuid,$1::uuid)",[id]);
  }
  await db.query("INSERT INTO auth.audit_log_entries VALUES(gen_random_uuid(),$1::jsonb,'192.0.2.1')",[JSON.stringify({actor_id:partner,actor_username:'partner@example.invalid'})]);
  await db.query("INSERT INTO auth.flow_state VALUES(gen_random_uuid(),$1::uuid,$2::uuid,'linking-access','linking-refresh'),(gen_random_uuid(),NULL,$1::uuid,'unrelated-access','unrelated-refresh')",[other,partner]);
  await db.query("INSERT INTO public.bb_households(id,owner_user_id,partner_user_id,partner_email,invite_status) VALUES($1::uuid,$2::uuid,$3::uuid,'partner@example.invalid','accepted')",[home,owner,partner]);
  await db.query("INSERT INTO public.bb_households(id,owner_user_id,partner_email,invite_status) VALUES($1::uuid,$2::uuid,'partner@example.invalid','pending')",[otherHome,other]);
  await db.query("INSERT INTO public.bb_household_invites(household_id,partner_email,status,accepted_by,expires_at) VALUES($1::uuid,'partner@example.invalid','accepted',$2::uuid,now()+interval '7 days'),($3::uuid,'partner@example.invalid','revoked',NULL,now()+interval '7 days')",[home,partner,otherHome]);
  await db.query("INSERT INTO public.bb_household_entries(household_id,section,entry_key,value,updated_by) VALUES($1::uuid,'planned_day','Monday','{\"recipeId\":\"pasta\"}',$2::uuid)",[home,partner]);
  await db.query("INSERT INTO public.bb_receipt_inventory_scopes(scope_kind,scope_id,household_id) VALUES('household',$1::uuid,$1::uuid)",[home]);
  for(const [kind,id] of [['user',partner],['household',home]]){
   await db.query("INSERT INTO public.bb_receipt_inventory_receipts(scope_kind,scope_id,receipt_id,request_id,payload_hash,semantic_payload,payload,spending,receipt_revision,created_by) VALUES($1,$2::uuid,'receipt-1','request-1',$3,'{}','{}','{}',1,$4::uuid)",[kind,id,'a'.repeat(64),partner]);
   await db.query("INSERT INTO public.bb_receipt_inventory_requests(scope_kind,scope_id,receipt_id,request_id,payload_hash) VALUES($1,$2::uuid,'receipt-1','request-1',$3)",[kind,id,'a'.repeat(64)]);
   await db.query("INSERT INTO public.bb_receipt_inventory_legacy_claims(scope_kind,scope_id,receipt_id,legacy_id,canonical_key,unit,credited_quantity) VALUES($1,$2::uuid,'receipt-1','legacy-1','pasta','g',1)",[kind,id]);
  }
  await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await one('SELECT public.bb_account_deletion_ready() AS value')).value,{ready:true,version:1});
  await assert.rejects(remove(partner,'someone-else@example.invalid'),/account_delete_identity_mismatch/);
  assert.equal(await count('auth.users'),3);
  assert.deepEqual(await remove(partner,'partner@example.invalid'),{deleted:true,version:1});
  assert.equal(await count('auth.users'),2);assert.equal(await count('public.basketboss_data'),2);
  assert.equal(await count('auth.sessions'),2);
  assert.equal(await count('auth.refresh_tokens'),4);
  assert.equal(await count('auth.refresh_tokens','WHERE user_id=$1',[partner]),0);
  assert.equal(await count('auth.refresh_tokens','WHERE session_id IS NULL'),2);
  assert.equal(await count('auth.flow_state'),3);assert.equal(await count('auth.identities'),2);
  assert.equal(await count('auth.flow_state','WHERE user_id=$1::uuid OR linking_target_id=$1::uuid',[partner]),0);
  assert.equal(await count('auth.audit_log_entries'),1);
  assert.equal(await count('public.bb_household_invites'),0);
  assert.deepEqual(await one('SELECT partner_user_id,partner_email,invite_status FROM public.bb_households WHERE id=$1::uuid',[home]),{partner_user_id:null,partner_email:null,invite_status:'none'});
  assert.equal(await count('public.bb_households'),2);assert.equal(await count('public.bb_household_entries'),1);
  assert.equal((await one('SELECT updated_by FROM public.bb_household_entries')).updated_by,null);
  assert.equal(await count('public.bb_receipt_inventory_scopes'),3);
  for(const table of ['bb_receipt_inventory_receipts','bb_receipt_inventory_requests','bb_receipt_inventory_legacy_claims'])assert.equal(await count('public.'+table),1);
  assert.equal((await one('SELECT created_by FROM public.bb_receipt_inventory_receipts')).created_by,null);
  await assert.rejects(db.query("INSERT INTO public.basketboss_data VALUES($1::uuid,'{}',now())",[partner]),/foreign key constraint/);
  await assert.rejects(db.query("SELECT public.bb_hh_service_patch($1::uuid,$2::uuid,'planned_day','Tuesday','{\"recipeId\":\"rice\"}',0)",[partner,home]),/membership_required/);

  // Retrying an already removed UUID must preserve a new account/invitation
  // that legitimately reuses the old email address.
  await db.query("INSERT INTO auth.users VALUES($1::uuid,'partner@example.invalid','2026-10-31Z')",[replacement]);
  await db.query("UPDATE public.bb_households SET partner_user_id=$1::uuid,partner_email='partner@example.invalid',invite_status='accepted' WHERE id=$2::uuid",[replacement,otherHome]);
  await db.query("INSERT INTO public.bb_household_invites(household_id,partner_email,status,accepted_by,expires_at) VALUES($1::uuid,'partner@example.invalid','accepted',$2::uuid,now()+interval '7 days')",[otherHome,replacement]);
  assert.deepEqual(await remove(partner,'partner@example.invalid'),{deleted:true,version:1});
  assert.equal((await one('SELECT partner_user_id FROM public.bb_households WHERE id=$1::uuid',[otherHome])).partner_user_id,replacement);
  assert.equal(await count('public.bb_household_invites'),1);
  assert.deepEqual(await remove(owner,'owner@example.invalid'),{deleted:true,version:1});
  assert.equal(await count('public.bb_households'),1);assert.equal(await count('public.bb_household_entries'),0);
  assert.equal(await count('public.bb_receipt_inventory_scopes'),1);
  for(const table of ['bb_receipt_inventory_receipts','bb_receipt_inventory_requests','bb_receipt_inventory_legacy_claims'])assert.equal(await count('public.'+table),0);
  assert.equal(await count('public.basketboss_data'),1);
  assert.equal(await count('auth.refresh_tokens'),2);assert.equal(await count('auth.flow_state'),2);
  assert.equal(await count('auth.identities'),1);assert.equal(await count('auth.audit_log_entries'),1);

  // An unexpected restrictive FK must roll back personal and shared cleanup.
  await db.exec('CREATE TABLE public.test_delete_restriction(user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT)');
  await db.query('INSERT INTO public.test_delete_restriction VALUES($1::uuid)',[other]);
  await assert.rejects(remove(other,'other@example.invalid'),/foreign key constraint/);
  assert.equal(await count('public.basketboss_data'),1);assert.equal(await count('public.bb_households'),1);
  assert.equal(await count('public.bb_household_invites'),1);assert.equal(await count('public.bb_receipt_inventory_scopes'),1);
  assert.equal(await count('auth.refresh_tokens'),2);assert.equal(await count('auth.flow_state'),2);
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role);
   await assert.rejects(db.query('SELECT public.bb_account_deletion_ready()'),/permission denied/);
   await assert.rejects(remove(other,'other@example.invalid'),/permission denied/);
   await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  assert.equal((await one('SELECT public.bb_account_deletion_ready() AS value')).value.ready,true);
  assert.deepEqual(await remove(partner,'partner@example.invalid'),{deleted:true,version:1});
  await db.exec('RESET ROLE');
  await db.exec('DROP TABLE public.basketboss_data');
  await db.exec(sql);
  assert.equal((await one('SELECT public.bb_account_deletion_ready() AS value')).value.ready,true);
  await db.exec('CREATE ROLE deletion_test_definer BYPASSRLS; GRANT USAGE ON SCHEMA auth TO deletion_test_definer; ALTER FUNCTION public.bb_account_deletion_ready() OWNER TO deletion_test_definer');
  assert.equal((await one('SELECT public.bb_account_deletion_ready() AS value')).value.ready,false);
  await db.exec('ALTER FUNCTION public.bb_account_deletion_ready() OWNER TO postgres; DROP TABLE auth.refresh_tokens; DROP TABLE auth.flow_state');
  await db.exec(sql);
  assert.equal((await one('SELECT public.bb_account_deletion_ready() AS value')).value.ready,true);
  assert.deepEqual(await remove(partner,'partner@example.invalid'),{deleted:true,version:1});
 }finally{await db.close();}
});
