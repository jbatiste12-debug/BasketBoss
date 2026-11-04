// Main-only operational repair. Never prints application credentials,
// receipt data, or account state; only runtime compatibility may be changed.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const REPOSITORY='jbatiste12-debug/BasketBoss',PROJECT='basketboss-site',FLOOR='2024-09-23';
const API='https://api.cloudflare.com/client/v4/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,SHA=/^[a-f0-9]{40}$/;
const CODES=new Set(['REPAIR_ENVIRONMENT','REPAIR_CREDENTIALS','REPAIR_API','REPAIR_PROJECT','REPAIR_DEPLOYMENT','REPAIR_CONFIGURATION','REPAIR_CONFLICT','REPAIR_VERIFICATION','REPAIR_RETRY']);
const OPERATIONS=new Set(['read','update','verify','retry']);
class RepairError extends Error{constructor(code,operation,status){super(code);this.code=code;this.operation=operation;this.status=status;}}
const check=(value,code)=>{if(!value)throw new RepairError(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function stable(value){return JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
function unchangedConfig(config){const {compatibility_flags,compatibility_date,...rest}=config;return stable(rest);}
export function appleRuntimeRepairFailure(error){
 const known=error instanceof RepairError,result={kind:'failure',code:known&&CODES.has(error.code)?error.code:'REPAIR_API'};
 if(known&&OPERATIONS.has(error.operation)){result.operation=error.operation;result.status=Number.isInteger(error.status)&&error.status>=100&&error.status<=599?error.status:null;}
 return result;
}
export function requireAppleRuntimeRepairEnvironment(env){
 check(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/main'&&SHA.test(env.GITHUB_SHA||'')&&env.BB_APPLE_RUNTIME_REPAIR==='true','REPAIR_ENVIRONMENT');
 check(typeof env.CLOUDFLARE_API_TOKEN==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(env.CLOUDFLARE_API_TOKEN)&&/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''),'REPAIR_CREDENTIALS');
}
async function boundedJSON(response){
 const reader=response?.body?.getReader?.();if(!reader)return null;const chunks=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024*1024)return null;chunks.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{return null;}finally{try{await reader.cancel();}catch{}}
}
async function api(env,route,method,perform,operation,body){
 let response;try{response=await perform(API+route,{method,headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new RepairError('REPAIR_API',operation);}
 const value=await boundedJSON(response);if(!response.ok||value?.success!==true)throw new RepairError('REPAIR_API',operation,response.status);
 return value.result;
}
function deployment(value){
 check(object(value)&&UUID.test(value.id||'')&&value.environment==='production'&&SHA.test(value.deployment_trigger?.metadata?.commit_hash||'')&&(value.deployment_trigger.metadata.branch===undefined||value.deployment_trigger.metadata.branch==='main'),'REPAIR_DEPLOYMENT');
 return {id:value.id,sha:value.deployment_trigger.metadata.commit_hash};
}
function project(value){
 check(object(value)&&value.name===PROJECT&&value.production_branch==='main'&&Array.isArray(value.domains)&&value.domains.some(domain=>domain==='basketboss.co.uk'||domain==='www.basketboss.co.uk'),'REPAIR_PROJECT');
 const deployed=deployment(value.canonical_deployment);check(value.canonical_deployment.latest_stage?.name==='deploy'&&value.canonical_deployment.latest_stage.status==='success','REPAIR_DEPLOYMENT');
 check(object(value.deployment_configs?.production),'REPAIR_CONFIGURATION');return {deployed,config:value.deployment_configs.production,preview:value.deployment_configs.preview};
}
function settings(config){
 const flags=config.compatibility_flags??[];check(Array.isArray(flags)&&flags.length<=128&&flags.every(flag=>typeof flag==='string'&&/^[a-z][a-z0-9_]{0,127}$/.test(flag)),'REPAIR_CONFIGURATION');
 check(!flags.includes('no_nodejs_compat_v2')&&!flags.includes('no_nodejs_compat'),'REPAIR_CONFLICT');
 const date=config.compatibility_date;if(date!==undefined&&date!==null)check(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date,'REPAIR_CONFIGURATION');
 return {flags:[...flags],date:date||FLOOR};
}
export async function repairAppleRuntime(env=process.env,{perform=fetch,emit=value=>console.log(JSON.stringify(value))}={}){
 requireAppleRuntimeRepairEnvironment(env);const route='accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/pages/projects/'+PROJECT;
 const before=project(await api(env,route,'GET',perform,'read')),current=settings(before.config);
 const nextFlags=current.flags.includes('nodejs_compat')?current.flags:[...current.flags,'nodejs_compat'],nextDate=current.date>=FLOOR?current.date:FLOOR;
 const changed=!current.flags.includes('nodejs_compat')||before.config.compatibility_date!==nextDate;
 if(!changed){const result={kind:'runtime_repair',changed:false,configurationVerified:true,nodeCompatibilityEnabled:true,nodeCryptoCompatible:true,rebuildRequested:false,deploymentId:before.deployed.id,productionCommit:before.deployed.sha};emit(result);return result;}
 // A partial project PATCH deliberately omits all bindings, variables, secrets,
 // build settings and preview configuration. Confirm they survive unchanged.
 await api(env,route,'PATCH',perform,'update',{deployment_configs:{production:{compatibility_flags:nextFlags,compatibility_date:nextDate}}});
 const after=project(await api(env,route,'GET',perform,'verify')),updated=settings(after.config);
 check(stable(updated.flags)===stable(nextFlags)&&updated.date===nextDate&&unchangedConfig(after.config)===unchangedConfig(before.config)&&stable(after.preview)===stable(before.preview),'REPAIR_VERIFICATION');
 const requested=deployment(await api(env,route+'/deployments/'+after.deployed.id+'/retry','POST',perform,'retry'));
 check(requested.sha===after.deployed.sha,'REPAIR_RETRY');
 const result={kind:'runtime_repair',changed:true,configurationVerified:true,nodeCompatibilityEnabled:true,nodeCryptoCompatible:true,rebuildRequested:true,deploymentId:requested.id,sourceDeploymentId:after.deployed.id,productionCommit:requested.sha};emit(result);return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await repairAppleRuntime();}catch(error){console.log(JSON.stringify(appleRuntimeRepairFailure(error)));process.exitCode=1;}
}
