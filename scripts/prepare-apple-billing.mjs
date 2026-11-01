// Main-only, billing-disabled preparation. Cloudflare credentials and secret
// values never leave the runner; this script never enables purchases.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {inspectCloudflare} from './check-cloudflare-catalogue.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIGRATION=path.join(ROOT,'sql/basketboss_apple_subscriptions_20261101.sql');
export const APPLE_MIGRATION_SHA256='24d9069d37dac31c1be83b3cf9bdab6eafc025a6af5d8bd0172194a05b913a56';
const REPOSITORY='jbatiste12-debug/BasketBoss';
const HOST='https://basketboss.co.uk';
const APPLE_NAMES=['bb_apple_account_tokens','bb_apple_subscriptions','bb_apple_subscriptions_user','bb_apple_notifications','bb_apple_schema'];
const APPLE_TABLES=['bb_apple_account_tokens','bb_apple_subscriptions','bb_apple_notifications','bb_apple_schema'];
const LEGACY_TABLES=['bb_paid_entitlements','bb_founder_slots'];
class PreparationError extends Error {}
const assert=(condition,message)=>{if(!condition)throw new PreparationError(message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=sql=>String(sql).replace(/\bIF NOT EXISTS\s+/g,'').replace(/\s+/g,' ').replace(/\s*([(),=])\s*/g,'$1').replace(/;$/,'').trim();

export function requireApplePreparationEnvironment(env){
 assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/main','Apple preparation is restricted to this repository main-branch Actions environment.');
 assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''),'The Actions commit ID is invalid.');
 assert(['inspect','prepare'].includes(env.BB_APPLE_PREPARE_MODE),'Choose inspect or prepare mode.');
 assert(typeof env.CLOUDFLARE_API_TOKEN==='string'&&env.CLOUDFLARE_API_TOKEN.length>=32,'The existing Cloudflare environment secret is unavailable.');
}
export function validateAppleMigration(sql){
 assert(typeof sql==='string'&&hash(sql)===APPLE_MIGRATION_SHA256,'Apple migration differs from the reviewed additive migration.');
 const definitions=new Map([...sql.matchAll(/CREATE (?:TABLE|INDEX) IF NOT EXISTS ([a-z_]+)[\s\S]*?;/g)].map(match=>[match[1],canonical(match[0])]));
 assert(definitions.size===APPLE_NAMES.length&&APPLE_NAMES.every(name=>definitions.has(name)),'Apple migration object list is invalid.');
 return definitions;
}
// Read only the private key's binding type. Its value is deliberately never
// accessed, compared, serialized or included in a diagnostic.
export function validateAppleProductionProject(project,connection){
 assert(project?.name===connection.project&&project.production_branch==='main','The verified production Pages project does not match.');
 assert(Array.isArray(project.domains)&&project.domains.some(domain=>['basketboss.co.uk','www.basketboss.co.uk'].includes(domain)),'The project does not serve the BasketBoss production domain.');
 const production=project.deployment_configs?.production;
 assert(production?.d1_databases?.BILLING_DB?.id===connection.databaseId,'The verified production BILLING_DB binding changed.');
 const vars=production.env_vars||{};
 const plain=name=>vars[name]?.type==='plain_text'?vars[name].value:undefined;
 assert(plain('APPLE_BILLING_ENABLED')==='false','Set production APPLE_BILLING_ENABLED to the text value false before preparation.');
 assert(plain('APPLE_ENVIRONMENT')==='Production','Set production APPLE_ENVIRONMENT to Production before preparation.');
 assert(plain('APPLE_APP_ID')==='6829160611'&&plain('APPLE_SUBSCRIPTION_GROUP_ID')==='22534568','The configured Apple app or Premium group ID does not match BasketBoss.');
 assert(/^[A-Z0-9]{10}$/.test(plain('APPLE_KEY_ID')||'')&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plain('APPLE_ISSUER_ID')||''),'The Apple key or issuer identifier is missing or malformed.');
 assert(vars.APPLE_PRIVATE_KEY?.type==='secret_text','Store APPLE_PRIVATE_KEY as an encrypted Cloudflare production secret.');
 const date=production.compatibility_date;
 assert(/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&date>='2026-10-01'&&date<=new Date().toISOString().slice(0,10),'The production compatibility date must be 2026-10-01 or a later current date.');
 // Cloudflare enables Node.js compatibility by default for dates from
 // 2026-08-04. At our tested date, absent/empty positive flags are valid;
 // explicit opt-outs still make Apple's Node crypto dependency unavailable.
 // https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/
 const flags=production.compatibility_flags??[];
 assert(Array.isArray(flags)&&flags.every(flag=>typeof flag==='string'),'The production compatibility flags are invalid.');
 assert(!flags.includes('no_nodejs_compat')&&!flags.includes('no_nodejs_compat_v2'),'The production Functions runtime must not explicitly disable Node.js compatibility.');
 for(const [name,value] of [['APPLE_MONTHLY_PRODUCT_ID','uk.co.basketboss.premium.monthly'],['APPLE_ANNUAL_PRODUCT_ID','uk.co.basketboss.premium.annual']])
  assert(!vars[name]||plain(name)===value,'An optional Apple Product ID does not match the two launch plans.');
 return true;
}
async function api(env,route,body,perform){
 const response=await perform('https://api.cloudflare.com/client/v4/'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
 const parsed=await response.json().catch(()=>null);
 assert(response.ok&&parsed?.success===true,'A scoped Cloudflare preparation request failed. Check the existing token permissions and account scope.');
 return parsed.result;
}
export async function inspectAppleObjects(query,definitions){
 const names=list=>list.map(name=>"'"+name+"'").join(',');
 const rows=await query('SELECT type,name,sql FROM sqlite_master WHERE name IN ('+names(APPLE_NAMES)+') OR tbl_name IN ('+names(APPLE_TABLES)+')');
 assert(Array.isArray(rows),'Apple schema metadata is unavailable.');
 for(const row of rows){
  if(definitions.has(row.name))assert(definitions.get(row.name)===canonical(row.sql),'An existing Apple table or index differs from the reviewed schema; manual review is required.');
  else assert(row.type==='index'&&row.sql===null&&row.name.startsWith('sqlite_autoindex_'),'An unexpected Apple schema object exists; manual review is required.');
 }
 const ready=rows.filter(row=>definitions.has(row.name)).length===APPLE_NAMES.length;
 if(rows.some(row=>row.name==='bb_apple_schema')){
  const marker=await query('SELECT version FROM bb_apple_schema WHERE id=1');
  assert(marker.length===0||(marker.length===1&&marker[0].version===1),'The Apple schema version is unsupported.');
  return ready&&marker.length===1;
 }
 return false;
}
export async function legacyBillingSnapshot(query){
 const schema=await query("SELECT type,name,sql FROM sqlite_master WHERE tbl_name IN ('bb_paid_entitlements','bb_founder_slots') ORDER BY type,name");
 assert(LEGACY_TABLES.every(name=>schema.some(row=>row.type==='table'&&row.name===name)),'The existing web billing and Founder tables must be present.');
 const counts={};
 for(const table of LEGACY_TABLES){
  const rows=await query('SELECT COUNT(*) AS count FROM '+table);
  assert(rows.length===1&&Number.isSafeInteger(rows[0].count)&&rows[0].count>=0,'Existing billing table counts are invalid.');
  counts[table]=rows[0].count;
 }
 return {schemaHash:hash(JSON.stringify(schema)),counts};
}
export function requireUnchangedLegacy(before,after){
 assert(before.schemaHash===after.schemaHash&&JSON.stringify(before.counts)===JSON.stringify(after.counts),'Existing web billing schema or counts changed during preparation. The Apple migration only adds isolated tables; review concurrent billing activity before proceeding.');
 return true;
}
function currentMain(env){
 const result=spawnSync('git',['ls-remote','origin','refs/heads/main'],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,killSignal:'SIGKILL'});
 assert(result.status===0&&!result.error&&(result.stdout||'').trim().split(/\s+/)[0]===env.GITHUB_SHA,'Main changed while Apple preparation was running; rerun on current main.');
}
function atomicImport(env,connection,sql){
 assert(env.RUNNER_TEMP&&path.isAbsolute(env.RUNNER_TEMP),'A private runner temporary directory is required.');
 const binary=env.WRANGLER_BIN;
 assert(binary&&path.isAbsolute(binary)&&fs.existsSync(binary),'The pinned Wrangler importer is unavailable.');
 const childEnv={...env,CLOUDFLARE_ACCOUNT_ID:connection.accountId,WRANGLER_SEND_METRICS:'false',CI:'true'};
 const version=spawnSync(binary,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,killSignal:'SIGKILL',env:childEnv});
 assert(version.status===0&&/\b4\.156\.0\b/.test(version.stdout||''),'Wrangler does not match the reviewed atomic importer.');
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(env.RUNNER_TEMP),'basketboss-apple-schema-'));
 fs.chmodSync(directory,0o700);
 try{
  const file=path.join(directory,'apple-schema.sql'),config=path.join(directory,'wrangler.json');
  fs.writeFileSync(file,sql,{mode:0o600});
  fs.writeFileSync(config,JSON.stringify({name:'basketboss-apple-schema-prepare',account_id:connection.accountId,compatibility_date:'2026-10-01',d1_databases:[{binding:'BB_APPLE_SCHEMA_DB',database_name:'basketboss-billing',database_id:connection.databaseId}]}),{mode:0o600});
  const result=spawnSync(binary,['d1','execute','BB_APPLE_SCHEMA_DB','--remote','--file',file,'--config',config,'--yes'],{cwd:directory,env:childEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:240000,killSignal:'SIGKILL',maxBuffer:8*1024*1024});
  assert(result.status===0&&!result.error,'The atomic Apple schema import did not complete. No provider or SQL output has been published.');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
export async function verifyDisabledAppleDeployment(perform=fetch){
 const origin='capacitor://localhost';
 const response=await perform(HOST+'/api/apple/config',{headers:{Origin:origin},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 const body=await response.json().catch(()=>null);
 assert(response.status===200&&body?.available===false&&Array.isArray(body.productIds)&&body.productIds.length===0&&body.reason==='apple_not_enabled','The deployed Apple configuration is not in the required disabled state.');
 assert(response.headers.get('Access-Control-Allow-Origin')===origin&&response.headers.get('Access-Control-Allow-Credentials')===null&&/no-store/i.test(response.headers.get('Cache-Control')||''),'The deployed Apple response does not preserve native CORS and no-store controls.');
 const preflight=await perform(HOST+'/api/apple/purchase-context',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'},redirect:'error',signal:AbortSignal.timeout(15000)});
 assert(preflight.status===204&&preflight.headers.get('Access-Control-Allow-Origin')===origin&&preflight.headers.get('Access-Control-Allow-Credentials')===null,'The deployed Apple native preflight is unavailable.');
 return {disabled:true,nativeCors:true,noStore:true};
}
export async function prepareAppleBilling(env=process.env,dependencies={}){
 requireApplePreparationEnvironment(env);
 const perform=dependencies.perform||fetch,inspect=dependencies.inspect||inspectCloudflare;
 const migration=dependencies.migration===undefined?fs.readFileSync(MIGRATION,'utf8'):dependencies.migration;
 const definitions=validateAppleMigration(migration);
 const connection=await inspect(env,perform);
 assert(/^[a-f0-9]{32}$/i.test(connection.accountId||'')&&/^[0-9a-f-]{36}$/i.test(connection.databaseId||'')&&connection.branch==='main','The verified production connection is invalid.');
 const prefix='accounts/'+connection.accountId;
 const projectRoute=prefix+'/pages/projects/'+encodeURIComponent(connection.project);
 const project=()=>api(env,projectRoute,undefined,perform);
 const query=async sql=>{
  assert(/^SELECT\s/.test(sql),'Only read queries are permitted through the schema verification API.');
  const result=await api(env,prefix+'/d1/database/'+connection.databaseId+'/query',{sql},perform);
  assert(Array.isArray(result)&&result.length===1&&result[0].success!==false&&Array.isArray(result[0].results),'Apple schema verification returned an invalid result.');
  return result[0].results;
 };
 validateAppleProductionProject(await project(),connection);
 const before=await legacyBillingSnapshot(query);
 const alreadyPrepared=await inspectAppleObjects(query,definitions);
 if(env.BB_APPLE_PREPARE_MODE==='inspect')return {configurationReady:true,schemaReady:alreadyPrepared,billingEnabled:false,mode:'inspect'};
 (dependencies.requireCurrentMain||currentMain)(env);
 let applied=false;
 if(!alreadyPrepared){
  validateAppleProductionProject(await project(),connection);
  await (dependencies.importMigration||atomicImport)(env,connection,migration);
  applied=true;
 }
 assert(await inspectAppleObjects(query,definitions),'The Apple schema was not completely prepared.');
 requireUnchangedLegacy(before,await legacyBillingSnapshot(query));
 let deployed;
 const pause=dependencies.pause||((milliseconds)=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
 for(let attempt=0;attempt<36;attempt++){
  deployed=await project();validateAppleProductionProject(deployed,connection);
  if(deployed.canonical_deployment?.deployment_trigger?.metadata?.commit_hash===env.GITHUB_SHA)break;
  assert(!(deployed.latest_deployment?.deployment_trigger?.metadata?.commit_hash===env.GITHUB_SHA&&deployed.latest_deployment?.latest_stage?.status==='failure'),'The production Pages deployment failed; the prepared database remains isolated with billing disabled.');
  if(attempt<35)await pause(5000);
 }
 assert(deployed?.canonical_deployment?.deployment_trigger?.metadata?.commit_hash===env.GITHUB_SHA,'Production has not reached the prepared main commit yet. Billing remains disabled.');
 const publicRoutes=await (dependencies.verifyDeployment||verifyDisabledAppleDeployment)(perform);
 return {configurationReady:true,schemaReady:true,applied,legacyBillingUnchanged:true,productionDeploymentReady:true,billingEnabled:false,mode:'prepare',publicRoutes};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let summary;
 try{
  const result=await prepareAppleBilling();
  summary='Apple billing preparation verified.\n\n```json\n'+JSON.stringify(result,null,2)+'\n```\n\nPurchases remain disabled. Real Apple sandbox verification and notification setup are still required.\n';
  console.log('::notice title=Apple billing preparation::'+JSON.stringify(result));
 }catch(error){
  // Do not echo provider bodies, headers, bindings, captured child output or
  // user records. Specific setup failures are retained only as fixed categories.
  const detail=error instanceof PreparationError?error.message:'The existing Cloudflare connection or importer is unavailable; check its account scope and permissions.';
  summary='Apple billing preparation did not complete. '+detail+' This workflow did not enable purchases.\n';
  console.error('::error title=Apple billing preparation::'+summary.trim());
  process.exitCode=1;
 }
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
}
