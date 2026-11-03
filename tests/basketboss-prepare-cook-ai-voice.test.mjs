import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {requireTTSEnvironment,validateTTSMigration,validateTTSProject,inspectTTSSchema,verifyTTSDeployment,prepareCookAIVoice} from '../scripts/prepare-cook-ai-voice.mjs';

const migration=fs.readFileSync(new URL('../sql/basketboss_cook_tts_20261102.sql',import.meta.url),'utf8');
const sha='a'.repeat(40),account='b'.repeat(32),database='11111111-1111-4111-8111-111111111111';
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'jbatiste12-debug/BasketBoss',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,BB_TTS_PREPARE_MODE:'prepare',CLOUDFLARE_API_TOKEN:'synthetic-secret-'.repeat(3),CLOUDFLARE_ACCOUNT_ID:account});
function project(){
 const plain=value=>({type:'plain_text',value});
 return {name:'basketboss-site',production_branch:'main',domains:['basketboss.co.uk'],deployment_configs:{production:{d1_databases:{BILLING_DB:{id:database}},r2_buckets:{BB_TTS_AUDIO:{name:'private-test-bucket'}},env_vars:{OPENAI_API_KEY:{type:'secret_text'},SUPABASE_URL:plain('https://kbhyosxuvlcazyzzinqv.supabase.co'),SUPABASE_PUBLISHABLE_KEY:plain('synthetic-public-key'),BB_TTS_ENABLED:plain('true'),BB_TTS_DAILY_MISS_CAP:plain('80'),BB_TTS_GLOBAL_DAILY_MISS_CAP:plain('200'),BB_BILLING_ENABLED:plain('true'),BB_BILLING_MODE:plain('live'),PADDLE_LIVE_STANDARD_PRICE_ID:plain('pri_'+'c'.repeat(26))}}},canonical_deployment:{environment:'production',latest_stage:{name:'deploy',status:'success'},deployment_trigger:{metadata:{commit_hash:sha}}}};
}
const headers={'Access-Control-Allow-Origin':'capacitor://localhost','Cache-Control':'private, no-store'};
function harness({prepared=false,config=project(),projectAt,publicResponse}={}){
 const db=new DatabaseSync(':memory:');if(prepared)db.exec(migration);
 const calls=[],imports=[],guards=[];let projectCalls=0,time=0;
 const perform=async(url,options={})=>{
  calls.push({url,options});
  if(url==='https://basketboss.co.uk/api/tts'){
   if(publicResponse)return publicResponse(options);
   return options.method==='OPTIONS'?new Response(null,{status:204,headers}):Response.json({error:'Sign in required'},{status:401,headers});
  }
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/pages/projects/basketboss-site'))return Response.json({success:true,result:projectAt?projectAt(++projectCalls):config});
  assert(parsed.pathname.endsWith('/d1/database/'+database+'/query'));
  const body=JSON.parse(options.body);assert.match(body.sql,/^SELECT /);assert.deepEqual(Object.keys(body),['sql']);
  return Response.json({success:true,result:[{success:true,results:db.prepare(body.sql).all()}]});
 };
 const dependencies={perform,requireCurrentMain:value=>{guards.push(value.GITHUB_SHA);},importMigration:async(value,connection,sql)=>{imports.push({connection,sql});db.exec(sql);},clock:()=>time,pause:async ms=>{time+=ms;}};
 return {db,calls,imports,guards,dependencies,close:()=>db.close(),time:()=>time};
}

test('preparation is main-only and validates mode, SHA, scoped identity and pinned SQL before API calls',async()=>{
 for(const patch of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/review'},{GITHUB_SHA:'invalid'},{BB_TTS_PREPARE_MODE:'activate'},{CLOUDFLARE_API_TOKEN:''},{CLOUDFLARE_ACCOUNT_ID:''}])assert.throws(()=>requireTTSEnvironment({...env(),...patch}));
 const definitions=validateTTSMigration(migration);assert.equal(definitions.size,2);
 for(const sql of [migration+'\nDROP TABLE bb_paid_entitlements;',migration.replace('locked_until_ms','changed_column')])assert.throws(()=>validateTTSMigration(sql));
 let called=false;await assert.rejects(prepareCookAIVoice(env(),{migration:migration+' ',perform:async()=>{called=true;}}));assert.equal(called,false);
});
test('missing or unsafe production bindings fail before schema reads or imports and secret values are never accessed',async()=>{
 for(const mutate of [p=>{p.name='other';},p=>{p.production_branch='review';},p=>{p.domains=['other.example'];},p=>{p.deployment_configs.production.d1_databases={};},p=>{p.deployment_configs.production.r2_buckets={};},p=>{p.deployment_configs.production.env_vars.OPENAI_API_KEY={type:'plain_text',value:'untrusted'};},p=>{p.deployment_configs.production.env_vars.BB_TTS_ENABLED.value='false';},p=>{p.deployment_configs.production.env_vars.BB_TTS_GLOBAL_DAILY_MISS_CAP.value='0';},p=>{p.deployment_configs.production.env_vars.SUPABASE_URL.value='https://other.supabase.co';},p=>{delete p.deployment_configs.production.env_vars.SUPABASE_PUBLISHABLE_KEY;},p=>{p.deployment_configs.production.env_vars.BB_BILLING_ENABLED.value='false';}]){
  const config=project();mutate(config);const h=harness({config});try{await assert.rejects(prepareCookAIVoice(env(),h.dependencies));assert.equal(h.imports.length,0);assert.equal(h.calls.length,1);}finally{h.close();}
 }
 const config=project();Object.defineProperty(config.deployment_configs.production.env_vars.OPENAI_API_KEY,'value',{get(){throw Error('secret value accessed');}});assert.equal(validateTTSProject(config).databaseId,database);
});
test('inspect mode reports missing schema without mutation, deployment polling or public calls',async()=>{
 const h=harness();try{const result=await prepareCookAIVoice({...env(),BB_TTS_PREPARE_MODE:'inspect'},h.dependencies);assert.equal(result.configurationReady,true);assert.equal(result.schemaReady,false);assert.equal(result.migrationApplied,false);assert.equal(h.imports.length+h.guards.length,0);assert.equal(h.calls.length,2);assert(Object.values(result).every(value=>typeof value==='boolean'));}finally{h.close();}
});
test('prepare imports only the pinned additive SQL and verifies schema, current deployment and native sign-in boundary',async()=>{
 const h=harness();try{
  h.db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO unrelated VALUES (1,\'retain\');');
  const result=await prepareCookAIVoice(env(),h.dependencies);
  assert.equal(h.imports.length,1);assert.equal(h.imports[0].sql,migration);assert.deepEqual(h.imports[0].connection,{accountId:account,databaseId:database});
  for(const key of ['configurationReady','schemaReady','migrationApplied','productionDeploymentReady','nativeCorsReady','authBoundaryReady'])assert.equal(result[key],true);
  assert.equal(result.aiAudioListeningVerified,false);assert(Object.values(result).every(value=>typeof value==='boolean'));
  assert.equal(h.guards.length,2);assert.equal(h.db.prepare('SELECT value FROM unrelated WHERE id=1').get().value,'retain');
  const publicCalls=h.calls.filter(value=>value.url.startsWith('https://basketboss.co.uk/'));assert.equal(publicCalls.length,2);assert(publicCalls.every(value=>!value.options.headers.Authorization));
 }finally{h.close();}
});
test('an already matching schema is idempotent and retains existing usage',async()=>{
 const h=harness({prepared:true});try{h.db.prepare('INSERT INTO bb_ai_daily_usage VALUES (?,?,?,?)').run('2026-11-03','user:synthetic','scan',4);await prepareCookAIVoice(env(),h.dependencies);assert.equal(h.imports.length,0);assert.equal(h.db.prepare('SELECT used FROM bb_ai_daily_usage').get().used,4);}finally{h.close();}
});
test('conflicting existing schema fails before import rather than being repaired',async()=>{
 const h=harness();try{h.db.exec('CREATE TABLE bb_ai_daily_usage (unsafe TEXT)');await assert.rejects(prepareCookAIVoice(env(),h.dependencies),/conflicts/);assert.equal(h.imports.length,0);}finally{h.close();}
 const definitions=validateTTSMigration(migration);await assert.rejects(inspectTTSSchema(async()=>[{type:'index',name:'unexpected',sql:'CREATE INDEX unexpected ON bb_tts_cache_leases(clip_id)'}],definitions),/unexpected/);
});
test('changed main or database binding stops preparation before mutation',async()=>{
 const h=harness();try{await assert.rejects(prepareCookAIVoice(env(),{...h.dependencies,requireCurrentMain:()=>{throw Error('stale main');}}),/stale main/);assert.equal(h.imports.length,0);}finally{h.close();}
 const changed=project();changed.deployment_configs.production.d1_databases.BILLING_DB.id='22222222-2222-4222-8222-222222222222';
 const race=harness({projectAt:n=>n===1?project():changed});try{await assert.rejects(prepareCookAIVoice(env(),race.dependencies),/binding changed/);assert.equal(race.imports.length,0);}finally{race.close();}
});
test('known deployment failure and bounded pending deployment do not claim readiness',async()=>{
 const failed=project();delete failed.canonical_deployment;failed.latest_deployment={deployment_trigger:{metadata:{commit_hash:sha}},latest_stage:{status:'failure'}};
 const h=harness({prepared:true,config:failed});try{await assert.rejects(prepareCookAIVoice(env(),h.dependencies),/deployment failed/);assert.equal(h.imports.length,0);}finally{h.close();}
 const pending=project();delete pending.canonical_deployment;
 const waiting=harness({prepared:true,config:pending});try{await assert.rejects(prepareCookAIVoice(env(),waiting.dependencies),/bounded/);assert.equal(waiting.time(),120000);assert.equal(waiting.calls.some(value=>value.url.startsWith('https://basketboss.co.uk')),false);}finally{waiting.close();}
});
test('deployment HTML fallback, disabled JSON, incorrect CORS and credentials are failed checks',async()=>{
 for(const response of [new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}}),Response.json({error:'disabled'},{status:503,headers}),Response.json({error:'sign in'},{status:401,headers:{'Cache-Control':'no-store'}}),Response.json({error:'sign in'},{status:401,headers:{...headers,'Access-Control-Allow-Credentials':'true'}})]){
  let calls=0;await assert.rejects(verifyTTSDeployment(async()=>++calls===1?new Response(null,{status:204,headers}):response));
 }
});
test('a matching commit must be a successful final production deployment before probing the route',async()=>{
 for(const patch of [{environment:'preview'},{latest_stage:{name:'build',status:'success'}},{latest_stage:{name:'deploy',status:'active'}},{latest_stage:{name:'deploy',status:'failure'}}]){
  const config=project();Object.assign(config.canonical_deployment,patch);
  const h=harness({prepared:true,config});try{await assert.rejects(prepareCookAIVoice(env(),h.dependencies),/deployment failed|bounded/);assert.equal(h.calls.some(value=>value.url.startsWith('https://basketboss.co.uk')),false);}finally{h.close();}
 }
});
test('Cloudflare failures do not expose response bodies or the API token',async()=>{
 const h=harness();try{await assert.rejects(prepareCookAIVoice(env(),{...h.dependencies,perform:async()=>Response.json({success:false,errors:[{message:'sensitive-provider-body'}]},{status:403})}),error=>!error.message.includes('sensitive-provider-body')&&!error.message.includes(env().CLOUDFLARE_API_TOKEN));assert.equal(h.imports.length,0);}finally{h.close();}
});
