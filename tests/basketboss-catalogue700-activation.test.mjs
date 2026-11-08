import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {activateCatalogue700,requireActivation700Environment,validateApproval700,catalogue700Pins,activation700Failure,ReleaseError,APPROVED700} from '../tools/catalogue700/activate.mjs';
import {canonicalHash} from '../tools/catalogue700/release.mjs';
import {recipientForToken} from '../scripts/private-catalogue-envelope.mjs';

const SECRET='SYNTHETIC PRIVATE TOKEN AND RECIPE CONTENT DO NOT LOG';
const CF_TOKEN='SYNTHETIC-PRIVATE-CF-TOKEN-DO-NOT-LOG-12345678';
const clone=value=>JSON.parse(JSON.stringify(value));
const sha='a'.repeat(40),account='b'.repeat(32),database='12345678-1234-4234-8234-123456789012';
const envBase={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'jbatiste12-debug/BasketBoss',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,RUNNER_TEMP:'/tmp/synthetic-cat700',CLOUDFLARE_API_TOKEN:CF_TOKEN,CLOUDFLARE_ACCOUNT_ID:account,BB_CATALOGUE700_MODE:'activate'};
const safe=value=>assert.doesNotMatch(JSON.stringify(value),/SYNTHETIC(?: PRIVATE|-PRIVATE)|recipe_json|normalized_json|secret-provider-body/);
function fixture({mode='activate',ready=false,enabled=false,codeCurrent=true}={}){
 const rows=Array.from({length:500},(_,index)=>{const id='synthetic-'+index;return {recipe_id:id,sort_index:index,recipe_json:JSON.stringify({id,name:SECRET}),normalized_json:JSON.stringify({id})};});
 const metadata={catalogue_version:700,release_id:'synthetic-reviewed-release',free_count:200,premium_count:500,premium_rows_sha256:canonicalHash(rows),protected_rows_sha256:canonicalHash(rows.slice(0,400)),free_recipes_sha256:'c'.repeat(64),free_normalized_sha256:'d'.repeat(64)};
 const prepared={bundle:{premiumRows:rows},metadata,sql:'-- '+SECRET+' guarded whole-file SQL'};
 const originalConfig={d1_databases:{BILLING_DB:{id:database}},compatibility_date:'2026-11-08',compatibility_flags:['nodejs_compat'],wrangler_config_hash:'existing-wrangler-hash',env_vars:{SUPABASE_URL:{type:'plain_text',value:'https://kbhyosxuvlcazyzzinqv.supabase.co'},SUPABASE_PUBLISHABLE_KEY:{type:'secret_text'},APPLE_BILLING_ENABLED:{type:'plain_text',value:'true'},APPLE_ENVIRONMENT:{type:'plain_text',value:'Production'},OPENAI_API_KEY:{type:'secret_text'},OTHER_SETTING:{type:'plain_text',value:'preserve'}}};
 const deployment=(id,commit=sha)=>({id,environment:'production',deployment_trigger:{metadata:{commit_hash:commit,branch:'main'}},latest_stage:{name:'deploy',status:'success'}});
 const project={name:'basketboss-site',production_branch:'main',domains:['basketboss.co.uk'],source:{type:'github'},build_config:{build_command:'existing command'},deployment_configs:{production:clone(originalConfig),preview:{env_vars:{PREVIEW_ONLY:{type:'plain_text',value:'preserve'}}}},canonical_deployment:deployment('00000000-0000-4000-8000-000000000001',codeCurrent?sha:'e'.repeat(40))};
 if(enabled)Object.assign(project.deployment_configs.production.env_vars,Object.fromEntries(Object.entries(catalogue700Pins(metadata)).map(([key,value])=>[key,{type:'plain_text',value}])));
 const state={project,runtimeVars:clone(project.deployment_configs.production.env_vars),sourceRows:clone(rows.slice(0,400)),legacyRows:rows.slice(0,221).map(row=>({sort_index:row.sort_index,recipe_json:row.recipe_json,normalized_json:row.normalized_json})),newRows:ready?clone(rows):[],metadata:ready?clone(metadata):null,tables:ready,liveEnabled:enabled,events:[],queries:[],patches:[],retries:0,imports:0,snapshots:0,gets:0,main:sha,apiFailure:false,probeFailure:false,deploymentFailure:false,importFailure:false,corruptAfterImport:false,changeLegacy:false,dropSetting:false,secretInspectorFailure:false,middleware401:false,mainChangesAfterPatch:false,probeChangesConfig:false};
 const env={...envBase,BB_CATALOGUE700_MODE:mode};
 const response=(value,status=200)=>Response.json(value,{status});
 const perform=async(address,options={})=>{
  const url=new URL(address),method=options.method||'GET';
  if(url.hostname==='api.cloudflare.com'){
   assert.equal(options.headers.Authorization,'Bearer '+CF_TOKEN);
   if(state.apiFailure)return response({success:false,errors:[{message:SECRET+' secret-provider-body'}]},401);
   if(url.pathname.endsWith('/query')){
    const {sql}=JSON.parse(options.body);state.queries.push(sql);state.events.push('query');assert.match(sql,/^SELECT /);let result;
    if(sql.includes('FROM bb_private_premium_recipes_500_v1 '))result=state.sourceRows;
    else if(sql.includes('FROM bb_private_premium_recipes_700_v1 '))result=state.newRows;
    else if(sql.includes('FROM bb_private_premium_recipes '))result=state.legacyRows;
    else if(sql.includes('FROM sqlite_master '))result=state.tables?[{name:'bb_private_premium_recipes_700_v1'},{name:'bb_recipe_catalogue_releases_v1'}]:[];
    else if(sql.includes('FROM bb_recipe_catalogue_releases_v1 '))result=state.metadata?[state.metadata]:[];
    else throw Error('Unexpected fixture SQL');
    return response({success:true,result:[{success:true,results:clone(result)}]});
   }
   if(url.pathname.endsWith('/retry')){
    state.events.push('retry');state.retries++;const next=deployment('10000000-0000-4000-8000-'+String(state.retries).padStart(12,'0'));
    if(state.deploymentFailure){next.latest_stage={name:'deploy',status:'failure'};state.deploymentFailure=false;return response({success:true,result:next});}
    state.project.canonical_deployment=clone(next);state.runtimeVars=clone(state.project.deployment_configs.production.env_vars);state.liveEnabled=state.runtimeVars.BB_CATALOGUE700_ENABLED?.value==='true';return response({success:true,result:next});
   }
   if(method==='GET'&&/\/deployments\/[a-f0-9-]+$/.test(url.pathname))return response({success:true,result:{...clone(state.project.canonical_deployment),env_vars:clone(state.runtimeVars)}});
   assert.match(url.pathname,/\/pages\/projects\/basketboss-site$/);
   if(method==='PATCH'){
    state.events.push('patch');const body=JSON.parse(options.body);state.patches.push(body);
    assert.deepEqual(Object.keys(body),['deployment_configs']);assert.deepEqual(Object.keys(body.deployment_configs),['production']);
    const production=body.deployment_configs.production;assert.ok(Object.keys(production).every(key=>['env_vars','wrangler_config_hash'].includes(key)));assert.equal(production.wrangler_config_hash,'existing-wrangler-hash');
    assert.ok(Object.keys(production.env_vars).every(key=>key.startsWith('BB_CATALOGUE700_')));Object.assign(state.project.deployment_configs.production.env_vars,production.env_vars);
    if(state.dropSetting)delete state.project.deployment_configs.production.env_vars.OTHER_SETTING;
    if(state.mainChangesAfterPatch)state.main='f'.repeat(40);
   }else{assert.equal(method,'GET');state.gets++;}
   return response({success:true,result:clone(state.project)});
  }
  assert.equal(url.hostname,'basketboss.co.uk');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  if(options.headers?.Origin==='capacitor://localhost.evil')return new Response('',{status:403});
  if(method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'capacitor://localhost'}});
  if(state.probeChangesConfig){state.project.deployment_configs.production.wrangler_config_hash='new-owner-hash';state.probeChangesConfig=false;}
  return new Response(state.probeFailure?SECRET:JSON.stringify({error:'Sign in'}),{status:state.probeFailure?200:state.liveEnabled||state.middleware401?401:503,headers:{'Access-Control-Allow-Origin':'capacitor://localhost','Content-Type':'application/json','Cache-Control':'no-store'}});
 };
 const deps={perform,load:()=>prepared,git:args=>{
  if(args[0]==='rev-parse')return sha;if(args[0]==='ls-remote')return state.main+'\trefs/heads/main';if(args[0]==='merge-base'){assert.equal(args[2],APPROVED700.reviewedDataCommit);return '';}
  throw Error('Unexpected Git command');
 },inspect:()=>{if(state.secretInspectorFailure)throw Error('Pages project listing failed (HTTP 401) '+SECRET);return {accountId:account,project:'basketboss-site',branch:'main',databaseId:database};},snapshot:(_env,value)=>{state.snapshots++;state.events.push('snapshot');assert.equal(value.legacyRows.length,221);assert.equal(value.protectedRows.length,400);assert.equal(value.sourceCommit,undefined);},importSql:(_env,connection,sql)=>{
  state.events.push('import');state.imports++;assert.equal(connection.databaseId,database);assert.equal(sql,prepared.sql);
  if(state.importFailure)throw Error(SECRET+' provider error');state.newRows=clone(rows);state.metadata=clone(metadata);state.tables=true;
  if(state.corruptAfterImport)state.newRows.pop();if(state.changeLegacy)state.legacyRows[0].recipe_json+=' ';
 },clock:()=>1234000,pause:async()=>{}};
 return {state,env,deps,prepared,originalConfig,run:()=>activateCatalogue700(env,deps)};
}

test('only this repository main Actions context admits inspection and only manual dispatch admits activation',async()=>{
 for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/pull/1/merge'},{GITHUB_SHA:'bad'},{GITHUB_EVENT_NAME:'pull_request'},{BB_CATALOGUE700_MODE:'activate',GITHUB_EVENT_NAME:'push'},{BB_CATALOGUE700_MODE:'unknown'},{RUNNER_TEMP:'relative'}]){
  const h=fixture();Object.assign(h.env,change);await assert.rejects(h.run,/CAT700_ENVIRONMENT/);assert.equal(h.state.queries.length+h.state.patches.length+h.state.imports,0);
 }
 const h=fixture({mode:'inspect'});h.env.GITHUB_EVENT_NAME='push';assert.equal((await h.run()).activated,false);
});

test('actual public manifest and envelope match the frozen release, and changed transport/data pins are rejected',()=>{
 const read=file=>JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));
 const manifest=read('catalogues/700/release/manifest.json'),envelope=read('.github/private-catalogue/catalogue700-release.sealed.json');assert.equal(validateApproval700(envelope,manifest),true);
 for(const key of ['release_id','sourceBaseCommit','premium_rows_sha256','protected_rows_sha256','free_recipes_sha256','free_normalized_sha256']){const changed=clone(manifest);changed[key]='wrong';assert.throws(()=>validateApproval700(envelope,changed),/CAT700_APPROVAL/);}
 for(const key of ['plaintextSha256','plaintextBytes','sourceCommit','releaseId']){const changed=clone(envelope);changed.metadata[key]='wrong';assert.throws(()=>validateApproval700(changed,manifest),/CAT700_APPROVAL/);}
});

test('default inspection reads counts and readiness without importing, patching, rebuilding or snapshot writes',async()=>{
 const h=fixture({mode:'inspect'}),result=await h.run();assert.equal(result.mode,'inspect');assert.equal(result.readyForActivation,true);assert.equal(result.rowsVerified,false);assert.equal(result.existingPrivateRows,0);assert.equal(result.activated,false);
 assert.deepEqual([h.state.imports,h.state.snapshots,h.state.patches.length,h.state.retries],[0,0,0,0]);safe(result);
});

test('inspection can report production propagation pending but activation makes no write until deployed code is current',async()=>{
 const inspect=fixture({mode:'inspect',codeCurrent:false});assert.equal((await inspect.run()).readyForActivation,false);
 const h=fixture({codeCurrent:false});await assert.rejects(h.run,/CAT700_DEPLOYMENT_PENDING/);assert.deepEqual([h.state.imports,h.state.snapshots,h.state.patches.length],[0,0,0]);
});

test('activation imports the complete guarded file, verifies both legacy tables, then patches only five production pins',async()=>{
 const h=fixture(),before=clone({legacy:h.state.legacyRows,protected:h.state.sourceRows}),result=await h.run();assert.equal(result.activated,true);assert.equal(result.totalRecipes,700);assert.equal(result.privateRows,500);assert.equal(result.legacyUnchanged,true);assert.equal(result.authenticatedCatalogueVerified,false);assert.equal(result.onDevicePremiumTestRequired,true);
 assert.equal(h.state.imports,1);assert.equal(h.state.snapshots,1);assert.equal(h.state.retries,1);assert.ok(h.state.events.indexOf('import')<h.state.events.indexOf('patch'));assert.ok(h.state.events.lastIndexOf('query')>h.state.events.indexOf('patch'));
 assert.deepEqual({legacy:h.state.legacyRows,protected:h.state.sourceRows},before);assert.equal(h.state.project.deployment_configs.production.env_vars.OTHER_SETTING.value,'preserve');assert.deepEqual(h.state.project.deployment_configs.preview,{env_vars:{PREVIEW_ONLY:{type:'plain_text',value:'preserve'}}});assert.equal(h.state.patches[0].deployment_configs.production.env_vars.BB_CATALOGUE700_ENABLED.value,'true');assert.equal(Object.keys(h.state.patches[0].deployment_configs.production.env_vars).length,5);safe(result);
});

test('an already exact active release is idempotent and does not import, patch or rebuild',async()=>{
 const h=fixture({ready:true,enabled:true}),result=await h.run();assert.equal(result.activated,true);assert.equal(result.imported,false);assert.equal(result.pinsChanged,false);assert.equal(result.rebuildRequested,false);assert.equal(h.state.imports+h.state.patches.length+h.state.retries,0);
});

test('project pins and middleware401 cannot masquerade as enabled runtime pins: deployment is rebuilt and verified',async()=>{
 const h=fixture({ready:true,enabled:true});h.state.runtimeVars={};h.state.liveEnabled=false;h.state.middleware401=true;
 const result=await h.run();assert.equal(result.activated,true);assert.equal(result.runtimePinsVerified,true);assert.equal(result.rebuildRequested,true);assert.equal(h.state.retries,1);assert.equal(h.state.patches.length,0);assert.equal(h.state.liveEnabled,true);
});

test('main advancing after pin PATCH disables the owned gate but never retries stale code',async()=>{
 const h=fixture();h.state.mainChangesAfterPatch=true;await assert.rejects(h.run,/CAT700_ROLLBACK_PENDING/);assert.equal(h.state.retries,0);assert.equal(h.state.project.deployment_configs.production.env_vars.BB_CATALOGUE700_ENABLED.value,'false');
});

test('existing active mismatched releases fail closed before any production mutation',async()=>{
 for(const change of [h=>{h.state.newRows.pop();},h=>{h.state.metadata.release_id='different';},h=>{h.state.project.deployment_configs.production.env_vars.BB_CATALOGUE700_ROWS_SHA256.value='0'.repeat(64);}]){
  const h=fixture({ready:true,enabled:true});change(h);await assert.rejects(h.run,/CAT700_GATE_CONFLICT/);assert.equal(h.state.imports+h.state.snapshots+h.state.patches.length+h.state.retries,0);
 }
});

test('a changed protected 400-row source or legacy221 identity prevents import',async()=>{
 for(const change of [h=>{h.state.sourceRows[0].recipe_json+=' ';},h=>{h.state.legacyRows[0].recipe_json=JSON.stringify({id:'foreign'});},h=>{h.state.legacyRows.pop();}]){const h=fixture();change(h);await assert.rejects(h.run,/CAT700_LEGACY/);assert.equal(h.state.imports+h.state.patches.length,0);}
});

test('partial imports, metadata mismatch and legacy modifications never enable the gate',async()=>{
 for(const change of [h=>{h.state.corruptAfterImport=true;},h=>{h.state.changeLegacy=true;},h=>{const original=h.deps.importSql;h.deps.importSql=(...args)=>{original(...args);h.state.metadata.premium_count=499;};}]){const h=fixture();change(h);await assert.rejects(h.run,/CAT700_(?:ROWS|LEGACY|METADATA)/);assert.equal(h.state.patches.length,0);assert.equal(h.state.retries,0);}
});

test('live transport failure disables only this newly owned gate and rebuilds the safe disabled configuration',async()=>{
 const h=fixture();h.state.probeFailure=true;await assert.rejects(h.run,/CAT700_PROBE/);assert.equal(h.state.project.deployment_configs.production.env_vars.BB_CATALOGUE700_ENABLED.value,'false');assert.equal(h.state.liveEnabled,false);assert.equal(h.state.patches.length,2);assert.deepEqual(Object.keys(h.state.patches[1].deployment_configs.production.env_vars),['BB_CATALOGUE700_ENABLED']);assert.equal(h.state.retries,2);assert.equal(h.state.project.deployment_configs.production.env_vars.OTHER_SETTING.value,'preserve');
});

test('deployment failure after pinning rolls back the new gate without mutating legacy tables',async()=>{
 const h=fixture();h.state.deploymentFailure=true;await assert.rejects(h.run,/CAT700_DEPLOYMENT/);assert.equal(h.state.project.deployment_configs.production.env_vars.BB_CATALOGUE700_ENABLED.value,'false');assert.equal(h.state.liveEnabled,false);assert.equal(h.state.sourceRows.length,400);assert.equal(h.state.legacyRows.length,221);
});

test('unrelated settings loss is detected, with explicit rollback-pending failure rather than false success',async()=>{
 const h=fixture();h.state.dropSetting=true;await assert.rejects(h.run,/CAT700_ROLLBACK_PENDING/);assert.equal(h.state.patches.length,1);assert.equal(h.state.retries,0);
});

test('wrong authentication tenant or disabled live payment gates are reported in inspection and block activation before writes',async()=>{
 for(const mode of ['inspect','activate'])for(const field of ['SUPABASE_URL','APPLE_BILLING_ENABLED']){
  const h=fixture({mode});h.state.project.deployment_configs.production.env_vars[field].value='wrong';
  if(mode==='inspect')assert.equal((await h.run()).readyForActivation,false);else await assert.rejects(h.run,/CAT700_CONFIGURATION/);
  assert.equal(h.state.imports+h.state.patches.length,0);
 }
});

test('a concurrent configuration owner keeps its new wrangler hash; rollback cannot send a stale hash',async()=>{
 const h=fixture();h.state.probeFailure=true;h.state.probeChangesConfig=true;await assert.rejects(h.run,/CAT700_ROLLBACK_PENDING/);assert.equal(h.state.project.deployment_configs.production.wrangler_config_hash,'new-owner-hash');assert.equal(h.state.patches.length,1);assert.equal(h.state.retries,1);
});

test('a newer main commit prevents all mutation before snapshot/import',async()=>{
 const h=fixture();h.state.main='f'.repeat(40);await assert.rejects(h.run,/CAT700_MAIN_CHANGED/);assert.equal(h.state.imports+h.state.snapshots+h.state.patches.length,0);
});

test('management credential failures are fixed categories and do not leak provider errors or private payloads',async()=>{
 for(const change of [h=>{h.state.apiFailure=true;},h=>{h.state.secretInspectorFailure=true;},h=>{h.state.importFailure=true;}]){const h=fixture();change(h);let result;try{await h.run();assert.fail('expected failure');}catch(error){result=activation700Failure(error);}assert.equal(result.ok,false);safe(result);}
 assert.deepEqual(activation700Failure(Error(SECRET)),{ok:false,error:'CAT700_UNAVAILABLE'});
});

test('rotation recovery exposes only a public recipient after management access is verified, without decrypting or writes',async()=>{
 const h=fixture({mode:'inspect'});h.deps.load=()=>{throw new ReleaseError('DECRYPTION_KEY');};const result=await h.run();assert.equal(result.readyForActivation,false);assert.equal(result.releaseDecryptionAvailable,false);assert.equal(result.managementApiVerified,true);assert.deepEqual(result.managementTokenPublicRecipient,recipientForToken(CF_TOKEN));assert.equal(h.state.queries.length+h.state.imports+h.state.patches.length,0);safe(result);
 const active=fixture();active.deps.load=h.deps.load;await assert.rejects(active.run,/CAT700_DECRYPTION_KEY/);assert.equal(active.state.imports+active.state.patches.length,0);
});

test('workflow keeps production secrets main-only and defaults every push to inspection',()=>{
 const source=fs.readFileSync(new URL('../.github/workflows/activate-catalogue700.yml',import.meta.url),'utf8');assert.match(source,/branches: \[main\]/);assert.match(source,/default: inspect/);assert.match(source,/github\.ref == 'refs\/heads\/main'/);assert.match(source,/github\.event_name == 'workflow_dispatch' && inputs\.mode \|\| 'inspect'/);assert.match(source,/secrets\.BB_CATALOGUE_DECRYPT_TOKEN/);assert.match(source,/\.sealed\.json/);assert.doesNotMatch(source,/pull_request_target/);
});
