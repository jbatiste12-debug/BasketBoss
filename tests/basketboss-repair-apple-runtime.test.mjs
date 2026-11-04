import test from 'node:test';import assert from 'node:assert/strict';
import {repairAppleRuntime,appleRuntimeRepairFailure}from'../scripts/repair-apple-runtime.mjs';
const TOKEN='privateCloudflareToken_12345678901234567890',SECRET='never-print-provider-secret',ID='11111111-1111-4111-8111-111111111111',NEXT='22222222-2222-4222-8222-222222222222',SHA='a'.repeat(40);
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'jbatiste12-debug/BasketBoss',GITHUB_REF:'refs/heads/main',GITHUB_SHA:SHA,BB_APPLE_RUNTIME_REPAIR:'true',CLOUDFLARE_API_TOKEN:TOKEN,CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32)});
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture({date='2023-01-01',flags=['streams_enable_constructors'],mutate,fail}={}){
 let value={name:'basketboss-site',production_branch:'main',domains:['basketboss.co.uk'],canonical_deployment:{id:ID,environment:'production',latest_stage:{name:'deploy',status:'success'},deployment_trigger:{metadata:{branch:'main',commit_hash:SHA}}},deployment_configs:{production:{compatibility_date:date,compatibility_flags:flags,env_vars:{SECRET:{type:'secret_text',value:SECRET}},d1_databases:{BILLING_DB:{id:ID}},r2_buckets:{BB_TTS_AUDIO:{name:'private-audio'}},kv_namespaces:{CACHE:{namespace_id:'hidden'}},build_config:{build_command:'preserve me'}},preview:{env_vars:{PRIVATE:{type:'secret_text',value:SECRET}},compatibility_flags:[]}}};
 const calls=[],emitted=[];let reads=0;
 const perform=async(url,options)=>{calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer '+TOKEN);if(fail===options.method)return Response.json({success:false,errors:[{message:SECRET+' '+TOKEN}]},{status:403});
  if(options.method==='GET'){reads++;if(reads===2&&mutate)mutate(value);return Response.json({success:true,result:value});}
  if(options.method==='PATCH'){const body=JSON.parse(options.body);value.deployment_configs.production={...value.deployment_configs.production,...body.deployment_configs.production};return Response.json({success:true,result:value});}
  assert.equal(options.method,'POST');assert.ok(url.endsWith('/deployments/'+ID+'/retry'));assert.equal(options.body,undefined);return Response.json({success:true,result:{...value.canonical_deployment,id:NEXT}});
 };
 return {calls,emitted,perform,emit:v=>emitted.push(v),get value(){return value;}};
}
test('main-only explicitly armed environment guard rejects before any API request',async()=>{
 for(const patch of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_SHA:'invalid'},{BB_APPLE_RUNTIME_REPAIR:'false'},{CLOUDFLARE_API_TOKEN:''}]){
  const f=fixture();await assert.rejects(repairAppleRuntime({...env(),...patch},f));assert.equal(f.calls.length,0);
 }
});
test('repair changes only production compatibility, preserves bindings and retries verified canonical source',async()=>{
 const f=fixture(),before=copy(f.value);const result=await repairAppleRuntime(env(),f);
 assert.deepEqual(f.calls.map(c=>c.options.method),['GET','PATCH','GET','POST']);
 assert.deepEqual(JSON.parse(f.calls[1].options.body),{deployment_configs:{production:{compatibility_flags:['streams_enable_constructors','nodejs_compat'],compatibility_date:'2024-09-23'}}});
 const expected=copy(before);expected.deployment_configs.production.compatibility_flags.push('nodejs_compat');expected.deployment_configs.production.compatibility_date='2024-09-23';assert.deepEqual(f.value,expected);
 assert.equal(result.rebuildRequested,true);assert.equal(result.configurationVerified,true);assert.equal(result.deploymentId,NEXT);assert.equal(result.productionCommit,SHA);
 for(const secret of[TOKEN,SECRET,'private-audio','hidden'])assert.equal(JSON.stringify(f.emitted).includes(secret),false);
});
test('newer compatibility date and existing flags are retained',async()=>{
 const f=fixture({date:'2026-10-01',flags:['other_runtime_feature']});await repairAppleRuntime(env(),f);assert.equal(f.value.deployment_configs.production.compatibility_date,'2026-10-01');assert.deepEqual(f.value.deployment_configs.production.compatibility_flags,['other_runtime_feature','nodejs_compat']);
});
test('already compatible config is idempotent and makes no PATCH or deployment retry',async()=>{
 const f=fixture({date:'2026-10-01',flags:['nodejs_compat','streams_enable_constructors']});const result=await repairAppleRuntime(env(),f);assert.deepEqual(f.calls.map(c=>c.options.method),['GET']);assert.equal(result.changed,false);assert.equal(result.rebuildRequested,false);
});
test('explicit conflicting flag refuses automatic repair',async()=>{
 const f=fixture({flags:['no_nodejs_compat_v2']});await assert.rejects(repairAppleRuntime(env(),f),{code:'REPAIR_CONFLICT'});assert.deepEqual(f.calls.map(c=>c.options.method),['GET']);
});
test('changed production or preview bindings fail verification before any retry',async()=>{
 for(const mutate of[value=>delete value.deployment_configs.production.env_vars.SECRET,value=>value.deployment_configs.production.d1_databases.BILLING_DB.id=NEXT,value=>value.deployment_configs.preview.env_vars.PRIVATE.value='changed',value=>value.deployment_configs.production.compatibility_flags.push('unexpected')]){
  const f=fixture({mutate});await assert.rejects(repairAppleRuntime(env(),f),{code:'REPAIR_VERIFICATION'});assert.deepEqual(f.calls.map(c=>c.options.method),['GET','PATCH','GET']);
 }
});
test('wrong project, production branch, deployment or domain refuses before mutation',async()=>{
 for(const mutate of[value=>value.name='other',value=>value.production_branch='feature',value=>value.domains=['unrelated.example'],value=>value.canonical_deployment.environment='preview',value=>value.canonical_deployment.deployment_trigger.metadata.branch='feature',value=>value.canonical_deployment.latest_stage.status='failure']){
  const f=fixture();mutate(f.value);await assert.rejects(repairAppleRuntime(env(),f));assert.deepEqual(f.calls.map(c=>c.options.method),['GET']);
 }
});
test('API permission failures print only fixed safe failure fields and never retry',async()=>{
 const f=fixture({fail:'PATCH'});let failure;try{await repairAppleRuntime(env(),f);}catch(error){failure=appleRuntimeRepairFailure(error);}assert.deepEqual(failure,{kind:'failure',code:'REPAIR_API',operation:'update',status:403});assert.equal(JSON.stringify(failure).includes(TOKEN),false);assert.equal(JSON.stringify(failure).includes(SECRET),false);assert.equal(f.calls.some(c=>c.options.method==='POST'),false);
 assert.deepEqual(appleRuntimeRepairFailure(Object.assign(Error(SECRET),{code:SECRET})),{kind:'failure',code:'REPAIR_API'});
});
