#!/usr/bin/env node
// Dedicated main-only v700 release. The original 221/400 importer is untouched.
// Every provider response, private row, SQL statement and child log stays private.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectCloudflare} from '../../scripts/check-cloudflare-catalogue.mjs';
import {openPayload,sealPayload,recipientForToken} from '../../scripts/private-catalogue-envelope.mjs';
import {validatePublic700Release} from './build-client.mjs';
import {prepareCatalogue700Import} from './prepare-import.mjs';
import {canonicalHash,TABLE700,RELEASE_TABLE700} from './release.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const REPOSITORY='jbatiste12-debug/BasketBoss',PROJECT='basketboss-site';
const API='https://api.cloudflare.com/client/v4/',HOST='https://basketboss.co.uk',ORIGIN='capacitor://localhost';
const SHA=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LEGACY='bb_private_premium_recipes',PROTECTED='bb_private_premium_recipes_500_v1';
const ENV_KEYS=['BB_CATALOGUE700_ENABLED','BB_CATALOGUE700_RELEASE_ID','BB_CATALOGUE700_ROWS_SHA256','BB_CATALOGUE700_FREE_SHA256','BB_CATALOGUE700_NORMALIZED_SHA256'];
export const APPROVED700=Object.freeze({
 releaseId:'catalogue700-20261108-build33',
 sourceBaseCommit:'9087b2476fde0a92134663b12ace378cf09a2b6f',
 reviewedDataCommit:'050d77f6862245052c88127cdff8caeed127e13f',
 plaintextSha256:'35733d23fe954318dba2c66bdcf566ce6f3f29d5f038166e3c83e41ef9356e7b',
 plaintextBytes:4484709,
 recipientFingerprint:'62df600a0710ed523668111e40339a72ec502300fc248a8a67862008a1ae74ac',
 sqlSha256:'51d9bd2d46ce3461cb7fc6090606de6aa1189069fcfe95190565efa214a8318f',
 premiumRowsSha256:'6b7c4a00bc2047667ef7108302ac5fa3a2fe8b4d875f0a4566da9b65f55cdfd5',
 protectedRowsSha256:'f89eaecc9b2ca71fbd8018c7f733e51c630f6992e5ad5def902f609a71fcbc2e',
 freeRecipesSha256:'ac52369dc2f1d470546c749153197bc2f9d7e81508d9aed443ef35ad5f58f49e',
 freeNormalizedSha256:'8ebdd985602f1f739c7cd35e8a308f4aec613a41f8e2388fb1af88326da65f04'
});
const CODES=new Set(['ENVIRONMENT','CREDENTIALS','APPROVAL','RELEASE','DECRYPTION_KEY','API','PROJECT','DEPLOYMENT_PENDING','MAIN_CHANGED','LEGACY','ROWS','METADATA','GATE_CONFLICT','CONFIGURATION','SNAPSHOT','IMPORT','DEPLOYMENT','PROBE','ROLLBACK_PENDING','UNAVAILABLE']);
export class ReleaseError extends Error{constructor(code){super('CAT700_'+code);this.code=code;}}
const assert=(condition,code)=>{if(!condition)throw new ReleaseError(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const activation700Failure=error=>({ok:false,error:'CAT700_'+(error instanceof ReleaseError&&CODES.has(error.code)?error.code:'UNAVAILABLE')});

export function requireActivation700Environment(env){
 assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/main'&&SHA.test(env.GITHUB_SHA||''),'ENVIRONMENT');
 assert(['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)&&['inspect','activate'].includes(env.BB_CATALOGUE700_MODE),'ENVIRONMENT');
 assert(env.BB_CATALOGUE700_MODE!=='activate'||env.GITHUB_EVENT_NAME==='workflow_dispatch','ENVIRONMENT');
 assert(typeof env.CLOUDFLARE_API_TOKEN==='string'&&/^[\x21-\x7e]{32,4096}$/.test(env.CLOUDFLARE_API_TOKEN),'CREDENTIALS');
 assert(path.isAbsolute(env.RUNNER_TEMP||'')&&/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''),'ENVIRONMENT');
}

export function validateApproval700(envelope,manifest){
 const a=APPROVED700;
 assert(manifest?.schemaVersion===1&&manifest.clientVersion==='1.0.2'&&manifest.nativeBuild===33&&manifest.catalogue_version===700&&manifest.activationEligible===false&&manifest.free_count===200&&manifest.premium_count===500,'APPROVAL');
 for(const [key,wanted]of Object.entries({release_id:a.releaseId,sourceBaseCommit:a.sourceBaseCommit,premium_rows_sha256:a.premiumRowsSha256,protected_rows_sha256:a.protectedRowsSha256,free_recipes_sha256:a.freeRecipesSha256,free_normalized_sha256:a.freeNormalizedSha256}))assert(manifest[key]===wanted,'APPROVAL');
 assert(manifest.encryptedPayload?.file==='.github/private-catalogue/catalogue700-release.sealed.json'&&manifest.encryptedPayload.plaintextSha256===a.plaintextSha256&&manifest.encryptedPayload.plaintextBytes===a.plaintextBytes&&manifest.encryptedPayload.recipientFingerprint===a.recipientFingerprint,'APPROVAL');
 assert(envelope?.metadata?.releaseId===a.releaseId&&envelope.metadata.sourceCommit===a.sourceBaseCommit&&envelope.metadata.plaintextSha256===a.plaintextSha256&&envelope.metadata.plaintextBytes===a.plaintextBytes&&envelope.recipientFingerprint===a.recipientFingerprint,'APPROVAL');
 return true;
}
function loadApprovedRelease(env){
 const directory=path.join(ROOT,'catalogues/700/release'),envelope=JSON.parse(fs.readFileSync(path.join(ROOT,'.github/private-catalogue/catalogue700-release.sealed.json'),'utf8'));
 const release=validatePublic700Release({directory,sourceDirectory:ROOT});validateApproval700(envelope,release.manifest);
 let plaintext;
 try{
  try{plaintext=openPayload(envelope,env.BB_CATALOGUE_DECRYPT_TOKEN||env.CLOUDFLARE_API_TOKEN);}catch{throw new ReleaseError('DECRYPTION_KEY');}
  assert(plaintext.length===APPROVED700.plaintextBytes&&digest(plaintext)===APPROVED700.plaintextSha256,'APPROVAL');
  const prepared=prepareCatalogue700Import(JSON.parse(plaintext.toString('utf8')),release);
  assert(digest(prepared.sql)===APPROVED700.sqlSha256,'APPROVAL');return prepared;
 }catch(error){if(error instanceof ReleaseError)throw error;throw new ReleaseError('RELEASE');}
 finally{plaintext?.fill(0);}
}

function git(args){
 const result=spawnSync('git',args,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,killSignal:'SIGKILL',maxBuffer:1024*1024});
 assert(result.status===0&&!result.error,'MAIN_CHANGED');return result.stdout.trim();
}
function currentMain(env,runGit){
 assert(runGit(['rev-parse','HEAD'])===env.GITHUB_SHA,'MAIN_CHANGED');
 runGit(['merge-base','--is-ancestor',APPROVED700.reviewedDataCommit,'HEAD']);
 assert(runGit(['ls-remote','origin','refs/heads/main']).split(/\s+/)[0]===env.GITHUB_SHA,'MAIN_CHANGED');
}
async function boundedJSON(response,limit){
 const reader=response.body?.getReader();assert(reader,'API');const chunks=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;assert(size<=limit,'API');chunks.push(part.value);}const bytes=new Uint8Array(size);let at=0;for(const value of chunks){bytes.set(value,at);at+=value.byteLength;}return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}
 catch{throw new ReleaseError('API');}finally{try{await reader.cancel();}catch{}}
}
async function api(env,route,method,perform,body,limit=1024*1024){
 let response;try{response=await perform(API+route,{method,headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new ReleaseError('API');}
 if(!response.ok){try{await response.body?.cancel();}catch{}throw new ReleaseError([401,403].includes(response.status)?'CREDENTIALS':'API');}
 const parsed=await boundedJSON(response,limit);assert(parsed?.success===true,'API');return parsed.result;
}
function projectState(value,connection){
 assert(value?.name===PROJECT&&value.name===connection.project&&value.production_branch==='main'&&Array.isArray(value.domains)&&value.domains.some(v=>[HOST.slice(8),'www.basketboss.co.uk'].includes(v)),'PROJECT');
 const config=value.deployment_configs?.production;
 assert(object(config)&&config.d1_databases?.BILLING_DB?.id===connection.databaseId,'PROJECT');
 const deployment=value.canonical_deployment;
 assert(UUID.test(deployment?.id||'')&&deployment.environment==='production'&&SHA.test(deployment.deployment_trigger?.metadata?.commit_hash||'')&&deployment.latest_stage?.name==='deploy'&&deployment.latest_stage.status==='success','PROJECT');
 assert(deployment.deployment_trigger.metadata.branch===undefined||deployment.deployment_trigger.metadata.branch==='main','PROJECT');
 const vars=config.env_vars??{};assert(object(vars),'CONFIGURATION');
 for(const key of ENV_KEYS)assert(vars[key]===undefined||vars[key]?.type==='plain_text'&&typeof vars[key].value==='string','GATE_CONFLICT');
 return {raw:value,config,vars,deployment,sha:deployment.deployment_trigger.metadata.commit_hash};
}
function safeConfig(value){
 if(Array.isArray(value))return value.map(safeConfig);
 if(!object(value))return value;
 if(value.type==='secret_text')return {type:'secret_text'}; // Do not read masked secret values.
 return Object.fromEntries(Object.keys(value).sort().map(key=>[key,safeConfig(value[key])]));
}
function configFingerprint(state){
 const value={production:{...state.config,env_vars:Object.fromEntries(Object.entries(state.vars).filter(([key])=>!ENV_KEYS.includes(key)))},preview:state.raw.deployment_configs.preview,build:state.raw.build_config,source:state.raw.source,domains:state.raw.domains,branch:state.raw.production_branch};
 return JSON.stringify(safeConfig(value));
}
export function catalogue700Pins(metadata){
 return {BB_CATALOGUE700_ENABLED:'true',BB_CATALOGUE700_RELEASE_ID:metadata.release_id,BB_CATALOGUE700_ROWS_SHA256:metadata.premium_rows_sha256,BB_CATALOGUE700_FREE_SHA256:metadata.free_recipes_sha256,BB_CATALOGUE700_NORMALIZED_SHA256:metadata.free_normalized_sha256};
}
const pinsMatch=(vars,pins)=>Object.entries(pins).every(([key,value])=>vars[key]?.type==='plain_text'&&vars[key].value===value);
function accessConfiguration(state){
 const plain=key=>state.vars[key]?.type==='plain_text'?state.vars[key].value:undefined,key=state.vars.SUPABASE_PUBLISHABLE_KEY;
 const authenticationConfigured=plain('SUPABASE_URL')==='https://kbhyosxuvlcazyzzinqv.supabase.co'&&(key?.type==='secret_text'||key?.type==='plain_text'&&typeof key.value==='string'&&key.value.length>0);
 const livePaidGateEnabled=plain('BB_BILLING_ENABLED')==='true'&&plain('BB_BILLING_MODE')==='live'||plain('APPLE_BILLING_ENABLED')==='true'&&plain('APPLE_ENVIRONMENT')==='Production';
 return {authenticationConfigured,livePaidGateEnabled};
}
function exactRows(rows,expected){return Array.isArray(rows)&&rows.length===500&&same(rows,expected);}
function legacyDigest(rows,expectedIds){
 assert(Array.isArray(rows)&&rows.length===221,'LEGACY');const seen=new Set();
 for(const [index,row]of rows.entries()){
  let recipe,norm;try{recipe=JSON.parse(row.recipe_json);norm=JSON.parse(row.normalized_json);}catch{throw new ReleaseError('LEGACY');}
  assert(row.sort_index===index&&recipe?.id===expectedIds[index]&&norm?.id===recipe.id&&!seen.has(recipe.id),'LEGACY');seen.add(recipe.id);
 }
 return canonicalHash(rows.map(row=>[row.sort_index,row.recipe_json,row.normalized_json]));
}
function normalizeRows(rows){return Array.isArray(rows)?rows.map(row=>({recipe_id:row.recipe_id,sort_index:row.sort_index,recipe_json:row.recipe_json,normalized_json:row.normalized_json})):rows;}
async function databaseState(query,prepared){
 const legacy=await query('SELECT sort_index,recipe_json,normalized_json FROM '+LEGACY+' ORDER BY sort_index');
 const protectedRows=normalizeRows(await query('SELECT recipe_id,sort_index,recipe_json,normalized_json FROM '+PROTECTED+' ORDER BY sort_index'));
 assert(same(protectedRows,prepared.bundle.premiumRows.slice(0,400))&&canonicalHash(protectedRows)===prepared.metadata.protected_rows_sha256,'LEGACY');
 const legacyHash=legacyDigest(legacy,protectedRows.slice(0,221).map(row=>row.recipe_id));
 const tables=await query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('"+TABLE700+"','"+RELEASE_TABLE700+"')");assert(Array.isArray(tables),'ROWS');
 const hasRows=tables.some(row=>row.name===TABLE700),hasMetadata=tables.some(row=>row.name===RELEASE_TABLE700);
 const rows=hasRows?normalizeRows(await query('SELECT recipe_id,sort_index,recipe_json,normalized_json FROM '+TABLE700+' ORDER BY sort_index')):[];
 const metadataRows=hasMetadata?await query('SELECT catalogue_version,release_id,free_count,premium_count,premium_rows_sha256,protected_rows_sha256,free_recipes_sha256,free_normalized_sha256 FROM '+RELEASE_TABLE700+' WHERE catalogue_version=700'):[];
 assert(Array.isArray(rows)&&Array.isArray(metadataRows)&&metadataRows.length<=1,'ROWS');
 const metadata=metadataRows[0]??null,metadataMatches=!!metadata&&Object.entries(prepared.metadata).every(([key,value])=>metadata[key]===value)&&Object.keys(metadata).length===Object.keys(prepared.metadata).length;
 return {legacy,protectedRows,legacyHash,protectedHash:canonicalHash(protectedRows),hasRows,hasMetadata,rows,metadata,metadataMatches,rowsMatch:exactRows(rows,prepared.bundle.premiumRows)&&canonicalHash(rows)===prepared.metadata.premium_rows_sha256};
}
function privateTemp(env){
 const directory=fs.realpathSync(env.RUNNER_TEMP);assert(directory!==ROOT&&!directory.startsWith(ROOT+path.sep),'ENVIRONMENT');return directory;
}
function sealedRollback(env,snapshot){
 const dedicated=path.join(ROOT,'.github/private-catalogue/catalogue700-recipient.json');
 const recipient=JSON.parse(fs.readFileSync(fs.existsSync(dedicated)?dedicated:path.join(ROOT,'.github/private-catalogue/catalogue-recipient.json'),'utf8'));
 assert(recipient.fingerprint===APPROVED700.recipientFingerprint,'APPROVAL');const bytes=Buffer.from(JSON.stringify(snapshot));
 try{const sealed=sealPayload(bytes,recipient,{releaseId:APPROVED700.releaseId+'-rollback',sourceCommit:env.GITHUB_SHA});fs.writeFileSync(path.join(privateTemp(env),'basketboss-catalogue700-rollback.sealed.json'),JSON.stringify(sealed),{mode:0o600,flag:'wx'});}
 catch(error){if(error instanceof ReleaseError)throw error;throw new ReleaseError('SNAPSHOT');}finally{bytes.fill(0);}
}
function atomicImport(env,connection,sql){
 const binary=env.WRANGLER_BIN;assert(path.isAbsolute(binary||'')&&fs.existsSync(binary),'IMPORT');
 const childEnv={...env,CLOUDFLARE_ACCOUNT_ID:connection.accountId,WRANGLER_SEND_METRICS:'false',CI:'true'};
 const version=spawnSync(binary,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,killSignal:'SIGKILL',env:childEnv});assert(version.status===0&&/\b4\.156\.0\b/.test(version.stdout||''),'IMPORT');
 const work=fs.mkdtempSync(path.join(privateTemp(env),'basketboss700-import-'));fs.chmodSync(work,0o700);
 try{
  const file=path.join(work,'catalogue700.private.sql'),config=path.join(work,'wrangler.json');fs.writeFileSync(file,sql,{mode:0o600});
  fs.writeFileSync(config,JSON.stringify({name:'basketboss-catalogue700-import',account_id:connection.accountId,compatibility_date:'2026-11-08',d1_databases:[{binding:'BB_CATALOGUE700_DB',database_name:'basketboss-billing',database_id:connection.databaseId}]}),{mode:0o600});
  const result=spawnSync(binary,['d1','execute','BB_CATALOGUE700_DB','--remote','--file',file,'--config',config,'--yes'],{cwd:work,env:childEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:240000,killSignal:'SIGKILL',maxBuffer:8*1024*1024});assert(result.status===0&&!result.error,'IMPORT');
 }finally{fs.rmSync(work,{recursive:true,force:true});}
}
async function publicProbe(perform){
 const url=HOST+'/api/recipes/v700/premium?catalogue=700',options={redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)};
 try{
  const pre=await perform(url,{...options,method:'OPTIONS',headers:{Origin:ORIGIN,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});
  const status=await perform(url,{...options,headers:{Origin:ORIGIN}});
  const foreign=await perform(url,{...options,method:'OPTIONS',headers:{Origin:ORIGIN+'.evil','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});
  try{assert(pre.status===204&&pre.headers.get('Access-Control-Allow-Origin')===ORIGIN&&pre.headers.get('Access-Control-Allow-Credentials')===null,'PROBE');assert(status.status===401&&/^application\/json(?:;|$)/i.test(status.headers.get('Content-Type')||'')&&/no-store/i.test(status.headers.get('Cache-Control')||'')&&status.headers.get('Access-Control-Allow-Origin')===ORIGIN&&!foreign.headers.get('Access-Control-Allow-Origin'),'PROBE');}
  finally{for(const response of [pre,status,foreign])try{await response.body?.cancel();}catch{}}
 }catch(error){if(error instanceof ReleaseError)throw error;throw new ReleaseError('PROBE');}
 return {nativeCors:true,unauthenticatedDenied:true,authenticatedCatalogueVerified:false,onDevicePremiumTestRequired:true};
}

export async function activateCatalogue700(env=process.env,dependencies={}){
 requireActivation700Environment(env);
 // Test seams are explicit function arguments, never caller-controlled env/CLI
 // pin overrides. The executable always uses the fixed approved loader above.
 const perform=dependencies.perform||fetch,runGit=dependencies.git||git,load=dependencies.load||loadApprovedRelease,inspect=dependencies.inspect||inspectCloudflare,importSql=dependencies.importSql||atomicImport,snapshot=dependencies.snapshot||sealedRollback,clock=dependencies.clock||Date.now,pause=dependencies.pause||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 currentMain(env,runGit);let connection;
 try{connection=await inspect(env,perform);}catch(error){throw new ReleaseError(/HTTP (?:401|403)\b/.test(String(error?.message||''))?'CREDENTIALS':'API');}
 assert(connection.project===PROJECT&&connection.branch==='main'&&/^[a-f0-9]{32}$/i.test(connection.accountId||'')&&UUID.test(connection.databaseId||'')&&connection.accountId===env.CLOUDFLARE_ACCOUNT_ID,'PROJECT');
 const route='accounts/'+connection.accountId+'/pages/projects/'+PROJECT;
 const readProject=async()=>projectState(await api(env,route,'GET',perform),connection);
 const readRuntime=async state=>{
  // Project settings are staged configuration; a middleware 401 can occur
  // before the route examines its release flag. Prove the deployed snapshot.
  const deployment=await api(env,route+'/deployments/'+state.deployment.id,'GET',perform);
  assert(deployment?.id===state.deployment.id&&deployment.environment==='production'&&deployment.deployment_trigger?.metadata?.commit_hash===state.sha&&deployment.latest_stage?.name==='deploy'&&deployment.latest_stage.status==='success','DEPLOYMENT');
  return deployment;
 };
 const query=async sql=>{assert(/^SELECT\s/.test(sql),'ROWS');const response=await api(env,'accounts/'+connection.accountId+'/d1/database/'+connection.databaseId+'/query','POST',perform,{sql},16*1024*1024);assert(Array.isArray(response)&&response.length===1&&response[0].success!==false&&Array.isArray(response[0].results),'ROWS');return response[0].results;};
 const beforeProject=await readProject(),codeDeployed=beforeProject.sha===env.GITHUB_SHA,access=accessConfiguration(beforeProject);let prepared;
 try{prepared=await load(env);}catch(error){
  if(env.BB_CATALOGUE700_MODE==='inspect'&&error instanceof ReleaseError&&error.code==='DECRYPTION_KEY')return {ok:true,mode:'inspect',releaseId:APPROVED700.releaseId,codeDeployed,readyForActivation:false,releaseDecryptionAvailable:false,requiredAction:'Restore the original decryption token or reseal the identical reviewed payload to a reviewed new recipient.',approvedEncryptedRecipientFingerprint:APPROVED700.recipientFingerprint,managementApiVerified:true,managementTokenPublicRecipient:recipientForToken(env.CLOUDFLARE_API_TOKEN),activated:false};
  throw error;
 }
 const pins=catalogue700Pins(prepared.metadata),before=await databaseState(query,prepared),beforeRuntime=await readRuntime(beforeProject),runtimePinsVerified=pinsMatch(beforeRuntime.env_vars||{},pins);
 const enabled=beforeProject.vars.BB_CATALOGUE700_ENABLED?.value==='true',gateMatches=pinsMatch(beforeProject.vars,pins),dataReady=before.rowsMatch&&before.metadataMatches;
 assert(!enabled||gateMatches&&dataReady,'GATE_CONFLICT');
 const result={ok:true,mode:env.BB_CATALOGUE700_MODE,releaseId:prepared.metadata.release_id,sourceCommit:env.GITHUB_SHA,codeDeployed,...access,existingPrivateRows:before.rows.length,protected500Rows:400,legacyRows:221,rowsVerified:dataReady,productionPinsVerified:gateMatches,runtimePinsVerified,imported:false,pinsChanged:false,rebuildRequested:false,authenticatedCatalogueVerified:false,onDevicePremiumTestRequired:true};
 if(env.BB_CATALOGUE700_MODE==='inspect')return {...result,readyForActivation:codeDeployed&&access.authenticationConfigured&&access.livePaidGateEnabled,gateEnabled:enabled,activated:false};
 assert(codeDeployed,'DEPLOYMENT_PENDING');
 assert(access.authenticationConfigured&&access.livePaidGateEnabled,'CONFIGURATION');
 currentMain(env,runGit);
 snapshot(env,{schemaVersion:1,releaseId:prepared.metadata.release_id,createdAt:new Date(clock()).toISOString(),project:connection.project,databaseId:connection.databaseId,legacyRows:before.legacy,protectedRows:before.protectedRows,versionedTableExisted:before.hasRows,versionedRows:before.rows,metadataTableExisted:before.hasMetadata,metadata:before.metadata,productionPins:Object.fromEntries(ENV_KEYS.map(key=>[key,beforeProject.vars[key]?.value??null]))});
 if(!dataReady){await importSql(env,connection,prepared.sql);result.imported=true;}
 const after=await databaseState(query,prepared);assert(after.legacyHash===before.legacyHash&&after.protectedHash===before.protectedHash,'LEGACY');assert(after.rowsMatch,'ROWS');assert(after.metadataMatches,'METADATA');result.rowsVerified=true;
 const current=await readProject();assert(current.sha===env.GITHUB_SHA&&current.deployment.id===beforeProject.deployment.id&&configFingerprint(current)===configFingerprint(beforeProject),'MAIN_CHANGED');currentMain(env,runGit);
 const patchPins=async(values,state=current)=>api(env,route,'PATCH',perform,{deployment_configs:{production:{env_vars:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{type:'plain_text',value}])),...(state.config.wrangler_config_hash===undefined?{}:{wrangler_config_hash:state.config.wrangler_config_hash})}}});
 const ownedDeploymentIds=new Set([current.deployment.id]);
 const rebuild=async source=>{
  currentMain(env,runGit);
  const requested=await api(env,route+'/deployments/'+source.id+'/retry','POST',perform);assert(UUID.test(requested?.id||'')&&requested.environment==='production'&&requested.deployment_trigger?.metadata?.commit_hash===env.GITHUB_SHA,'DEPLOYMENT');
  ownedDeploymentIds.add(requested.id);
  const deadline=clock()+8*60*1000;let deployment=requested;
  for(let attempts=0;;attempts++){
   assert(clock()<deadline&&attempts<100,'DEPLOYMENT');
   assert(deployment.deployment_trigger?.metadata?.commit_hash===env.GITHUB_SHA&&deployment.environment==='production','DEPLOYMENT');
   if(deployment.latest_stage?.status==='failure'||deployment.latest_stage?.status==='canceled')throw new ReleaseError('DEPLOYMENT');
   if(deployment.latest_stage?.name==='deploy'&&deployment.latest_stage.status==='success')return deployment;
   await pause(5000);deployment=await api(env,route+'/deployments/'+requested.id,'GET',perform);
  }
 };
 let gateOwned=false;
 try{
  if(!pinsMatch(current.vars,pins)){
   gateOwned=true;await patchPins(pins);result.pinsChanged=true;
   const checked=await readProject();assert(pinsMatch(checked.vars,pins)&&configFingerprint(checked)===configFingerprint(current)&&checked.sha===env.GITHUB_SHA,'CONFIGURATION');
  }
  let transport=null;
  if(!result.pinsChanged&&runtimePinsVerified)try{transport=await publicProbe(perform);}catch{}
  if(!transport){const deployed=await rebuild(current.deployment);result.rebuildRequested=true;const live=await readProject();assert(live.deployment.id===deployed.id&&live.sha===env.GITHUB_SHA&&pinsMatch(live.vars,pins)&&configFingerprint(live)===configFingerprint(current),'CONFIGURATION');const runtime=await readRuntime(live);assert(pinsMatch(runtime.env_vars||{},pins),'CONFIGURATION');transport=await publicProbe(perform);}
  const final=await databaseState(query,prepared);assert(final.legacyHash===before.legacyHash&&final.protectedHash===before.protectedHash,'LEGACY');assert(final.rowsMatch&&final.metadataMatches,'ROWS');currentMain(env,runGit);
  return {...result,...transport,activated:true,productionPinsVerified:true,runtimePinsVerified:true,legacyUnchanged:true,privateRows:500,totalRecipes:700};
 }catch(error){
  if(gateOwned){
   try{
    const latest=await readProject();assert(latest.sha===env.GITHUB_SHA&&ownedDeploymentIds.has(latest.deployment.id)&&configFingerprint(latest)===configFingerprint(current),'GATE_CONFLICT');
    if(latest.vars.BB_CATALOGUE700_ENABLED?.value==='true'){
     assert(pinsMatch(latest.vars,pins),'GATE_CONFLICT');await patchPins({BB_CATALOGUE700_ENABLED:'false'},latest);
     const disabled=await readProject();assert(disabled.vars.BB_CATALOGUE700_ENABLED?.value==='false'&&configFingerprint(disabled)===configFingerprint(current),'CONFIGURATION');
     const rollbackDeployment=await rebuild(disabled.deployment),live=await readProject();assert(live.deployment.id===rollbackDeployment.id&&live.sha===env.GITHUB_SHA&&configFingerprint(live)===configFingerprint(current),'CONFIGURATION');
     const runtime=await readRuntime(live);assert(runtime.env_vars?.BB_CATALOGUE700_ENABLED?.type==='plain_text'&&runtime.env_vars.BB_CATALOGUE700_ENABLED.value==='false','CONFIGURATION');
    }
   }
   catch{throw new ReleaseError('ROLLBACK_PENDING');}
  }
  throw error;
 }
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 let result;try{result=await activateCatalogue700();}catch(error){result=activation700Failure(error);process.exitCode=1;}
 const summary=JSON.stringify(result);console.log(summary);
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'Catalogue 700 release\n\n```json\n'+summary+'\n```\n');
}
