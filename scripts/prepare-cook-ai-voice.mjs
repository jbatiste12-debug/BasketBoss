// Focused production TTS readiness and additive schema preparation. Never
// prints credentials, binding objects, database records or provider responses.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST='https://basketboss.co.uk',ORIGIN='capacitor://localhost';
const PROJECT='basketboss-site',REPOSITORY='jbatiste12-debug/BasketBoss';
const TABLES=['bb_tts_cache_leases','bb_ai_daily_usage'];
export const TTS_MIGRATION_SHA256='6767b13024427f5f483cf05c79ed7de19dc9562224005e4beb7c7a666c3c4218';
class PreparationError extends Error {}
const assert=(value,message)=>{if(!value)throw new PreparationError(message);};
const canonical=value=>String(value).replace(/\bIF NOT EXISTS\s+/g,'').replace(/\s+/g,' ').replace(/\s*([(),=])\s*/g,'$1').replace(/;$/,'').trim();

export function requireTTSEnvironment(env){
 assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/main','TTS preparation requires this repository main-branch Actions environment.');
 assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''),'The Actions commit ID is invalid.');
 assert(['inspect','prepare'].includes(env.BB_TTS_PREPARE_MODE),'Choose inspect or prepare mode.');
 assert(typeof env.CLOUDFLARE_API_TOKEN==='string'&&env.CLOUDFLARE_API_TOKEN.length>=32,'The existing Cloudflare environment secret is unavailable.');
 assert(/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''),'Set the Cloudflare account ID in the github-pages environment.');
}
export function validateTTSMigration(sql){
 assert(typeof sql==='string'&&createHash('sha256').update(sql).digest('hex')===TTS_MIGRATION_SHA256,'TTS migration differs from the reviewed additive SQL.');
 const definitions=new Map([...sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)[\s\S]*?;/g)].map(match=>[match[1],canonical(match[0])]));
 assert(definitions.size===TABLES.length&&TABLES.every(name=>definitions.has(name)),'TTS migration object list is invalid.');
 return definitions;
}
export function validateTTSProject(project){
 assert(project?.name===PROJECT&&project.production_branch==='main'&&Array.isArray(project.domains)&&project.domains.some(value=>['basketboss.co.uk','www.basketboss.co.uk'].includes(value)),'The Pages project does not match BasketBoss production.');
 const config=project.deployment_configs?.production,vars=config?.env_vars||{};
 const plain=name=>vars[name]?.type==='plain_text'?vars[name].value:undefined;
 const databaseId=config?.d1_databases?.BILLING_DB?.id;
 assert(/^[0-9a-f-]{36}$/i.test(databaseId||''),'The production BILLING_DB binding is missing or invalid.');
 assert(typeof config?.r2_buckets?.BB_TTS_AUDIO?.name==='string'&&config.r2_buckets.BB_TTS_AUDIO.name.trim().length>0,'Bind BB_TTS_AUDIO to the existing private R2 bucket in production.');
 // Inspect only the secret binding type, never its value.
 assert(vars.OPENAI_API_KEY?.type==='secret_text','Store OPENAI_API_KEY as an encrypted production secret.');
 assert(plain('BB_TTS_ENABLED')==='true','Production BB_TTS_ENABLED must be the text value true.');
 const personal=Number(plain('BB_TTS_DAILY_MISS_CAP')),global=Number(plain('BB_TTS_GLOBAL_DAILY_MISS_CAP'));
 assert(Number.isInteger(personal)&&personal>=1&&personal<=500&&Number.isInteger(global)&&global>=1&&global<=10000,'Production TTS generation caps are missing or invalid.');
 assert(plain('SUPABASE_URL')==='https://kbhyosxuvlcazyzzinqv.supabase.co','The production authentication tenant does not match BasketBoss.');
 const authKey=vars.SUPABASE_PUBLISHABLE_KEY;
 assert(authKey?.type==='secret_text'||authKey?.type==='plain_text'&&typeof authKey.value==='string'&&authKey.value.trim().length>0,'The production authentication key binding is missing.');
 const web=plain('BB_BILLING_ENABLED')==='true'&&plain('BB_BILLING_MODE')==='live'&&['PADDLE_LIVE_STANDARD_PRICE_ID','PADDLE_LIVE_FOUNDER_PRICE_ID'].some(name=>/^pri_[a-z0-9]{26}$/.test(plain(name)||''));
 const apple=plain('APPLE_BILLING_ENABLED')==='true'&&plain('APPLE_ENVIRONMENT')==='Production';
 assert(web||apple,'Production paid-membership verification is not enabled.');
 return {databaseId};
}
async function api(env,route,body,perform,timeoutMs=15000){
 const response=await perform('https://api.cloudflare.com/client/v4/'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(Math.max(1,timeoutMs))});
 const parsed=await response.json().catch(()=>null);
 assert(response.ok&&parsed?.success===true,'A scoped Cloudflare TTS request failed. Check token permissions and account scope.');
 return parsed.result;
}
export async function inspectTTSSchema(query,definitions){
 const names=TABLES.map(name=>"'"+name+"'").join(',');
 const rows=await query('SELECT type,name,sql FROM sqlite_master WHERE name IN ('+names+') OR tbl_name IN ('+names+')');
 assert(Array.isArray(rows),'TTS schema metadata is unavailable.');
 for(const row of rows){
  if(definitions.has(row.name))assert(row.type==='table'&&canonical(row.sql)===definitions.get(row.name),'An existing TTS or AI usage table conflicts with the reviewed schema.');
  else assert(row.type==='index'&&row.sql===null&&row.name.startsWith('sqlite_autoindex_'),'An unexpected TTS schema object requires manual review.');
 }
 return TABLES.every(name=>rows.some(row=>row.type==='table'&&row.name===name));
}
function requireCurrentMain(env){
 const result=spawnSync('git',['ls-remote','origin','refs/heads/main'],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,killSignal:'SIGKILL'});
 assert(result.status===0&&!result.error&&(result.stdout||'').trim().split(/\s+/)[0]===env.GITHUB_SHA,'Main changed during TTS preparation; rerun on current main.');
}
function importMigration(env,connection,sql){
 assert(env.RUNNER_TEMP&&path.isAbsolute(env.RUNNER_TEMP),'A private runner temporary directory is required.');
 const binary=env.WRANGLER_BIN;
 assert(binary&&path.isAbsolute(binary)&&fs.existsSync(binary),'The pinned Wrangler importer is unavailable.');
 const childEnv={...env,CLOUDFLARE_ACCOUNT_ID:connection.accountId,WRANGLER_SEND_METRICS:'false',CI:'true'};
 const version=spawnSync(binary,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,killSignal:'SIGKILL',env:childEnv});
 assert(version.status===0&&/\b4\.156\.0\b/.test(version.stdout||''),'Wrangler does not match the reviewed atomic importer.');
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(env.RUNNER_TEMP),'basketboss-tts-schema-'));fs.chmodSync(directory,0o700);
 try{
  const file=path.join(directory,'tts-schema.sql'),config=path.join(directory,'wrangler.json');
  fs.writeFileSync(file,sql,{mode:0o600});
  fs.writeFileSync(config,JSON.stringify({name:'basketboss-tts-schema-prepare',account_id:connection.accountId,compatibility_date:'2026-10-01',d1_databases:[{binding:'BB_TTS_SCHEMA_DB',database_name:'basketboss-billing',database_id:connection.databaseId}]}),{mode:0o600});
  const result=spawnSync(binary,['d1','execute','BB_TTS_SCHEMA_DB','--remote','--file',file,'--config',config,'--yes'],{cwd:directory,env:childEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:240000,killSignal:'SIGKILL',maxBuffer:8*1024*1024});
  assert(result.status===0&&!result.error,'The additive TTS schema import did not complete. Captured SQL output remains private.');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
export async function verifyTTSDeployment(perform=fetch){
 const options=()=>({redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 const preflight=await perform(HOST+'/api/tts',{...options(),method:'OPTIONS',headers:{Origin:ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'}});
 assert(preflight.status===204&&preflight.headers.get('Access-Control-Allow-Origin')===ORIGIN&&preflight.headers.get('Access-Control-Allow-Credentials')===null,'The production TTS native preflight is unavailable.');
 const response=await perform(HOST+'/api/tts',{...options(),headers:{Origin:ORIGIN}});
 const json=/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')||'')?await response.json().catch(()=>null):null;
 assert(response.status===401&&typeof json?.error==='string'&&response.headers.get('Access-Control-Allow-Origin')===ORIGIN&&response.headers.get('Access-Control-Allow-Credentials')===null&&/no-store/i.test(response.headers.get('Cache-Control')||''),'The production TTS route has not reached its protected JSON sign-in boundary.');
 return {nativeCorsReady:true,authBoundaryReady:true};
}
export async function prepareCookAIVoice(env=process.env,dependencies={}){
 requireTTSEnvironment(env);
 const perform=dependencies.perform||fetch,clock=dependencies.clock||Date.now,pause=dependencies.pause||(milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
 const sql=dependencies.migration===undefined?fs.readFileSync(path.join(ROOT,'sql/basketboss_cook_tts_20261102.sql'),'utf8'):dependencies.migration;
 const definitions=validateTTSMigration(sql),prefix='accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
 const projectRoute=prefix+'/pages/projects/'+PROJECT;
 const project=()=>api(env,projectRoute,undefined,perform);
 const selected=validateTTSProject(await project());
 const connection={accountId:env.CLOUDFLARE_ACCOUNT_ID,databaseId:selected.databaseId};
 const query=async statement=>{
  assert(/^SELECT\s/.test(statement),'Only schema read queries are permitted through the verification API.');
  const result=await api(env,prefix+'/d1/database/'+connection.databaseId+'/query',{sql:statement},perform);
  assert(Array.isArray(result)&&result.length===1&&result[0].success!==false&&Array.isArray(result[0].results),'TTS schema verification returned an invalid result.');
  return result[0].results;
 };
 const ready=await inspectTTSSchema(query,definitions);
 const summary={configurationReady:true,schemaReady:ready,migrationApplied:false,productionDeploymentReady:false,nativeCorsReady:false,authBoundaryReady:false,aiAudioListeningVerified:false};
 if(env.BB_TTS_PREPARE_MODE==='inspect')return summary;
 const current=dependencies.requireCurrentMain||requireCurrentMain;
 current(env);
 if(!ready){
  assert(validateTTSProject(await project()).databaseId===connection.databaseId,'The production database binding changed during preparation.');
  await (dependencies.importMigration||importMigration)(env,connection,sql);summary.migrationApplied=true;
 }
 assert(await inspectTTSSchema(query,definitions),'The TTS schema was not completely prepared.');summary.schemaReady=true;
 const deadline=clock()+120000;
 let deployed=false;
 for(let attempt=0;attempt<25&&clock()<deadline;attempt++){
  const value=await api(env,projectRoute,undefined,perform,Math.min(15000,deadline-clock()));
  assert(validateTTSProject(value).databaseId===connection.databaseId,'The production database binding changed during preparation.');
  const canonicalDeployment=value.canonical_deployment;
  const matchingCanonical=canonicalDeployment?.deployment_trigger?.metadata?.commit_hash===env.GITHUB_SHA;
  assert(!(matchingCanonical&&canonicalDeployment.latest_stage?.status==='failure'),'The matching production Pages deployment failed.');
  if(matchingCanonical&&canonicalDeployment.environment==='production'&&canonicalDeployment.latest_stage?.name==='deploy'&&canonicalDeployment.latest_stage?.status==='success'){deployed=true;break;}
  assert(!(value.latest_deployment?.deployment_trigger?.metadata?.commit_hash===env.GITHUB_SHA&&value.latest_deployment?.latest_stage?.status==='failure'),'The matching production Pages deployment failed.');
  if(attempt<24&&clock()<deadline)await pause(Math.min(5000,deadline-clock()));
 }
 assert(deployed,'Production did not reach this main commit within the bounded TTS readiness check.');
 current(env);summary.productionDeploymentReady=true;
 Object.assign(summary,await verifyTTSDeployment(perform));
 return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let summary;
 try{
  const result=await prepareCookAIVoice();
  summary='Cook AI voice service readiness\n\n```json\n'+JSON.stringify(result,null,2)+'\n```\n\nActual Premium AI audio still requires a physical-iPhone listening check. No flags, secrets, caps or R2 settings were changed.\n';
  console.log('::notice title=Cook AI voice readiness::'+JSON.stringify(result));
 }catch(error){
  const detail=error instanceof PreparationError?error.message:'The existing Cloudflare connection, importer or deployment check is unavailable.';
  summary='Cook AI voice preparation did not complete. '+detail+' No flags, secrets, caps or R2 settings were changed.\n';
  console.error('::error title=Cook AI voice readiness::'+summary.trim());process.exitCode=1;
 }
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
}
