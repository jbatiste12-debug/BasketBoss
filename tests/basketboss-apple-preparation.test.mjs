import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {requireApplePreparationEnvironment,validateAppleMigration,validateAppleProductionProject,inspectAppleObjects,legacyBillingSnapshot,requireUnchangedLegacy,verifyDisabledAppleDeployment,prepareAppleBilling} from '../scripts/prepare-apple-billing.mjs';

const migration=fs.readFileSync('sql/basketboss_apple_subscriptions_20261101.sql','utf8');
const SHA='a'.repeat(40),connection={accountId:'a'.repeat(32),databaseId:'11111111-1111-4111-8111-111111111111',project:'basketboss-site',branch:'main'};
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'jbatiste12-debug/BasketBoss',GITHUB_REF:'refs/heads/main',GITHUB_SHA:SHA,BB_APPLE_PREPARE_MODE:'prepare',CLOUDFLARE_API_TOKEN:'synthetic-token-'+'t'.repeat(40)};
const plain=value=>({type:'plain_text',value});
function project(){return {name:'basketboss-site',production_branch:'main',domains:['basketboss.co.uk'],canonical_deployment:{deployment_trigger:{metadata:{commit_hash:SHA}}},deployment_configs:{production:{compatibility_date:'2026-10-01',compatibility_flags:['nodejs_compat'],d1_databases:{BILLING_DB:{id:connection.databaseId}},env_vars:{APPLE_BILLING_ENABLED:plain('false'),APPLE_ENVIRONMENT:plain('Production'),APPLE_APP_ID:plain('6829160611'),APPLE_SUBSCRIPTION_GROUP_ID:plain('22534568'),APPLE_KEY_ID:plain('ABCDEFGHIJ'),APPLE_ISSUER_ID:plain('11111111-1111-4111-8111-111111111111'),APPLE_PRIVATE_KEY:{type:'secret_text',get value(){throw Error('private secret must not be read');}}}}}};}
function harness(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE bb_paid_entitlements(id INTEGER PRIMARY KEY,status TEXT);INSERT INTO bb_paid_entitlements VALUES(1,'active');CREATE TABLE bb_founder_slots(slot_no INTEGER PRIMARY KEY,state TEXT);INSERT INTO bb_founder_slots VALUES(1,'active'),(2,'reserved'),(3,'available');");
 const current=project(),calls={import:0,inspect:0,main:0,public:0,queries:[]};
 const query=async sql=>db.prepare(sql).all();
 const dependencies={migration,inspect:async()=>{calls.inspect++;return connection;},requireCurrentMain:()=>{calls.main++;},pause:async()=>{},perform:async(address,options={})=>{
  const url=new URL(address);
  if(url.hostname==='api.cloudflare.com'){
   if(url.pathname.endsWith('/pages/projects/basketboss-site'))return {ok:true,json:async()=>({success:true,result:current})};
   if(url.pathname.endsWith('/query')){const {sql}=JSON.parse(options.body);calls.queries.push(sql);return {ok:true,json:async()=>({success:true,result:[{success:true,results:await query(sql)}]})};}
   throw Error('Unexpected scoped API request');
  }
  calls.public++;
  const headers={'Access-Control-Allow-Origin':'capacitor://localhost','Cache-Control':'no-store'};
  return options.method==='OPTIONS'?new Response(null,{status:204,headers}):Response.json({available:false,productIds:[],reason:'apple_not_enabled'},{headers});
 },importMigration:async(_env,_connection,sql)=>{
  calls.import++;db.exec('BEGIN');try{db.exec(sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 }};
 return {db,current,calls,query,dependencies};
}

test('preparation requires the exact main Actions scope and an existing Cloudflare secret',()=>{
 assert.doesNotThrow(()=>requireApplePreparationEnvironment(env));
 for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'another/repo'},{GITHUB_REF:'refs/heads/preview'},{GITHUB_SHA:'not-a-commit'},{BB_APPLE_PREPARE_MODE:'enable'},{CLOUDFLARE_API_TOKEN:''}])assert.throws(()=>requireApplePreparationEnvironment({...env,...change}));
});
test('production configuration validates encrypted key presence without reading its value',()=>{
 assert.equal(validateAppleProductionProject(project(),connection),true);
 for(const change of [
  p=>{p.production_branch='preview';},p=>{p.domains=['other.example'];},
  p=>{p.deployment_configs.production.d1_databases.BILLING_DB.id='22222222-2222-4222-8222-222222222222';},
  p=>{p.deployment_configs.production.env_vars.APPLE_BILLING_ENABLED=plain('true');},
  p=>{p.deployment_configs.production.env_vars.APPLE_APP_ID=plain('6829460963');},
  p=>{p.deployment_configs.production.env_vars.APPLE_SUBSCRIPTION_GROUP_ID=plain('123');},
  p=>{p.deployment_configs.production.env_vars.APPLE_PRIVATE_KEY={type:'plain_text',value:'not-secret'};},
  p=>{p.deployment_configs.production.compatibility_flags=['no_nodejs_compat'];},
  p=>{p.deployment_configs.production.compatibility_flags=['no_nodejs_compat_v2'];},
  p=>{p.deployment_configs.production.compatibility_date='2024-01-01';},
  p=>{p.deployment_configs.production.env_vars.APPLE_MONTHLY_PRODUCT_ID=plain('uk.co.basketboss.premium.founder.monthly');}
 ]){const p=project();change(p);assert.throws(()=>validateAppleProductionProject(p,connection));}
});
test('tested current dates accept default Node compatibility without a positive flag',()=>{
 for(const flags of [undefined,[],['nodejs_compat'],['nodejs_compat_v2']]){
  const p=project();p.deployment_configs.production.compatibility_flags=flags;
  assert.equal(validateAppleProductionProject(p,connection),true);
 }
 const older=project();delete older.deployment_configs.production.compatibility_flags;
 older.deployment_configs.production.compatibility_date='2026-08-04';
 assert.throws(()=>validateAppleProductionProject(older,connection),/2026-10-01/);
});
test('default Node compatibility prepares the real additive schema with purchases still disabled',async()=>{
 for(const flags of [undefined,[]]){
  const h=harness(),before=await legacyBillingSnapshot(h.query);
  h.current.deployment_configs.production.compatibility_flags=flags;
  const result=await prepareAppleBilling(env,h.dependencies);
  assert.equal(result.schemaReady,true);assert.equal(result.billingEnabled,false);assert.equal(h.calls.import,1);
  assert.deepEqual(await legacyBillingSnapshot(h.query),before);
  assert.equal(h.current.deployment_configs.production.env_vars.APPLE_BILLING_ENABLED.value,'false');
 }
});
test('explicit Node opt-outs stop preparation before any migration even beside positive flags',async()=>{
 for(const flag of ['no_nodejs_compat','no_nodejs_compat_v2']){
  const h=harness();h.current.deployment_configs.production.compatibility_flags=['nodejs_compat',flag];
  await assert.rejects(()=>prepareAppleBilling(env,h.dependencies),/explicitly disable Node/);
  assert.equal(h.calls.import,0);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='bb_apple_schema'").get().count,0);
 }
});
test('atomic preparation adds Apple tables while preserving existing billing rows and never enabling billing',async()=>{
 const h=harness(),before=await legacyBillingSnapshot(h.query);
 const result=await prepareAppleBilling(env,h.dependencies);
 assert.equal(result.schemaReady,true);assert.equal(result.applied,true);assert.equal(result.billingEnabled,false);assert.equal(result.productionDeploymentReady,true);
 assert.equal(h.calls.import,1);assert.equal(h.calls.main,1);assert.equal(h.calls.public,2);
 assert.deepEqual(await legacyBillingSnapshot(h.query),before);
 assert.equal(h.db.prepare('SELECT version FROM bb_apple_schema WHERE id=1').get().version,1);
 assert.ok(h.calls.queries.every(sql=>/^SELECT\s/.test(sql)));
 assert.equal(h.current.deployment_configs.production.env_vars.APPLE_BILLING_ENABLED.value,'false');
});
test('inspection writes nothing and an already prepared schema reruns without changing Apple or web records',async()=>{
 const h=harness();let result=await prepareAppleBilling({...env,BB_APPLE_PREPARE_MODE:'inspect'},h.dependencies);
 assert.equal(result.schemaReady,false);assert.equal(h.calls.import,0);assert.equal(h.calls.public,0);
 await prepareAppleBilling(env,h.dependencies);
 h.db.prepare('INSERT INTO bb_apple_account_tokens VALUES(?,?,?)').run('synthetic-user','synthetic-token',1);
 result=await prepareAppleBilling(env,h.dependencies);
 assert.equal(result.applied,false);assert.equal(h.calls.import,1);
 assert.equal(h.db.prepare('SELECT count(*) AS count FROM bb_apple_account_tokens').get().count,1);
 result=await prepareAppleBilling({...env,BB_APPLE_PREPARE_MODE:'inspect'},h.dependencies);
 assert.equal(result.schemaReady,true);assert.equal(h.calls.import,1);
});
test('an altered migration is refused before account discovery or any write',async()=>{
 const h=harness();h.dependencies.migration=migration+'\nDELETE FROM bb_founder_slots;';
 await assert.rejects(()=>prepareAppleBilling(env,h.dependencies),/reviewed additive migration/);
 assert.equal(h.calls.inspect,0);assert.equal(h.calls.import,0);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM bb_founder_slots').get().count,3);
});
test('existing incompatible Apple ownership constraints are refused before import',async()=>{
 const h=harness();h.db.exec('CREATE TABLE bb_apple_account_tokens(user_id TEXT,app_account_token TEXT,created_at_ms INTEGER)');
 await assert.rejects(()=>prepareAppleBilling(env,h.dependencies),/existing Apple table/);
 assert.equal(h.calls.import,0);
 const tables=h.db.prepare("SELECT name FROM sqlite_master WHERE name='bb_apple_subscriptions'").all();assert.equal(tables.length,0);
});
test('already enabled billing or a mismatched production binding cannot start migration',async()=>{
 for(const change of [h=>{h.current.deployment_configs.production.env_vars.APPLE_BILLING_ENABLED=plain('true');},h=>{h.current.deployment_configs.production.d1_databases.BILLING_DB.id='bad-binding';}]){
  const h=harness();change(h);await assert.rejects(()=>prepareAppleBilling(env,h.dependencies));assert.equal(h.calls.import,0);
 }
});
test('unreviewed triggers on an otherwise matching Apple schema cannot be marked ready',async()=>{
 const h=harness();h.db.exec(migration);
 h.db.exec('CREATE TRIGGER unexpected_apple_write AFTER INSERT ON bb_apple_account_tokens BEGIN DELETE FROM bb_founder_slots; END');
 await assert.rejects(()=>prepareAppleBilling(env,h.dependencies),/unexpected Apple schema object/);
 assert.equal(h.calls.import,0);assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM bb_founder_slots').get().count,3);
});
test('legacy schema or count drift fails readiness instead of silently claiming preservation',async()=>{
 const h=harness(),before=await legacyBillingSnapshot(h.query);
 h.db.exec("INSERT INTO bb_paid_entitlements VALUES(2,'active')");
 assert.throws(()=>requireUnchangedLegacy(before,{...before,counts:{...before.counts,bb_paid_entitlements:2}}),/changed during preparation/);
 assert.throws(()=>requireUnchangedLegacy(before,{...before,schemaHash:'different'}),/changed during preparation/);
});
test('deployed disabled config still requires strict native CORS, no-store and purchase preflight',async()=>{
 const h=harness();assert.deepEqual(await verifyDisabledAppleDeployment(h.dependencies.perform),{disabled:true,nativeCors:true,noStore:true});
 await assert.rejects(()=>verifyDisabledAppleDeployment(async()=>Response.json({available:true,productIds:['premium']})),/required disabled state/);
 await assert.rejects(()=>verifyDisabledAppleDeployment(async()=>Response.json({available:false,productIds:[],reason:'apple_not_enabled'},{headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}})),/native CORS/);
});
