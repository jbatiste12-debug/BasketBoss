// Operational diagnostics only: fixed production metadata, schema introspection
// and a temporary tail. No account requests, records, credentials or raw logs.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPOSITORY='jbatiste12-debug/BasketBoss';
const BRANCH='refs/heads/main';
const PROJECT='basketboss-site',API='https://api.cloudflare.com/client/v4/';
export const ACCOUNT_DELETE_PRODUCTION_SHA='02b5a8a0a84cef711e24614842dcde0d3f707a02';
export const ACCOUNT_DELETE_INSPECT_LIMITS=Object.freeze({durationMs:90000,eventBytes:1048576,events:100});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TAIL_ID=/^[A-Za-z0-9_.~:+=-]{1,256}$/;
const METHODS=new Set(['GET','HEAD','POST','OPTIONS','PUT','PATCH','DELETE']);
const OUTCOMES=new Set(['ok','exception','exceededCpu','exceededMemory','canceled','unknown']);
const DELETE_CODES=new Set(['deletion_checkout_pending','deletion_billing_pending','deletion_cloud_pending','deletion_not_ready','deletion_auth_unavailable','deletion_database_pending']);
const FAILURES=new Set(['INSPECT_ENVIRONMENT','INSPECT_MODE','INSPECT_CREDENTIALS','INSPECT_API','INSPECT_PROJECT','INSPECT_DEPLOYMENT','INSPECT_TAIL_RESPONSE','INSPECT_TAIL_URL','INSPECT_TAIL_SOCKET','INSPECT_TAIL_CLEANUP']);
const OPERATIONS=new Set(['project','schema','tail_create','tail_delete']);
const REQUIRED_COLUMNS=Object.freeze({
 bb_account_deletions:['actor_hash','retry_hash','user_id','email','started_at_ms','completed_at_ms','locked_until_ms'],
 bb_account_deletion_refs:['ref_hash'],
 bb_paid_entitlements:['paddle_subscription_id','paddle_customer_id','user_id','status','price_id','plan','trial_ends_at','current_period_ends_at','cancellation_effective_at','cancel_at_period_end','updated_at_ms'],
 bb_billing_claims:['claim_id','user_id','transaction_id','claim_state','slot_no'],
 bb_founder_slots:['slot_no','state','user_id','paddle_subscription_id']
});
// Only table metadata is selected. No user table is read, initialized or changed.
export const ACCOUNT_DELETE_SCHEMA_SQL=Object.keys(REQUIRED_COLUMNS).map(table=>
 `SELECT '${table}' AS table_name,name AS column_name FROM pragma_table_info('${table}')`).join(' UNION ALL ');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const status=value=>Number.isInteger(value)&&value>=100&&value<=599?value:null;
class InspectionError extends Error {
 constructor(code,operation,httpStatus){super(code);this.code=code;this.operation=operation;this.status=httpStatus;}
}
const requireThat=(condition,code)=>{if(!condition)throw new InspectionError(code);};

export function accountDeletionInspectionFailure(error){
 const failure={kind:'failure',code:FAILURES.has(error?.code)?error.code:'INSPECT_API'};
 return OPERATIONS.has(error?.operation)?{...failure,operation:error.operation,status:status(error.status)}:failure;
}

export function requireAccountDeletionInspectEnvironment(env,mode){
 requireThat(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF===BRANCH&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''),'INSPECT_ENVIRONMENT');
 requireThat(mode==='config'||mode==='tail','INSPECT_MODE');
 requireThat(typeof env.CLOUDFLARE_API_TOKEN==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(env.CLOUDFLARE_API_TOKEN)&&/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''),'INSPECT_CREDENTIALS');
}

async function boundedJSON(response,maximum=1048576){
 const reader=response?.body?.getReader?.();if(!reader)return null;
 const chunks=[];let size=0;
 try{
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum)return null;chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{return null;}finally{try{await reader.cancel();}catch{}}
}

async function cloudflare(env,route,method,perform,body,operation){
 let response;
 try{
  response=await perform(API+route,{method,headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
 }catch{throw new InspectionError('INSPECT_API',operation,null);}
 const value=await boundedJSON(response);
 if(!response.ok||value?.success!==true)throw new InspectionError('INSPECT_API',operation,status(response.status));
 return value.result;
}

function deploymentDetails(project){
 requireThat(project?.name===PROJECT&&project.production_branch==='main'&&Array.isArray(project.domains)&&
  project.domains.some(domain=>domain==='basketboss.co.uk'||domain==='www.basketboss.co.uk'),'INSPECT_PROJECT');
 const deployed=project.canonical_deployment;
 requireThat(UUID.test(deployed?.id||'')&&deployed.environment==='production'&&deployed.latest_stage?.name==='deploy'&&
  deployed.latest_stage.status==='success'&&deployed.deployment_trigger?.metadata?.commit_hash===ACCOUNT_DELETE_PRODUCTION_SHA,'INSPECT_DEPLOYMENT');
 const config=project.deployment_configs?.production,vars=config?.env_vars||{};
 const plain=name=>vars[name]?.type==='plain_text'?vars[name].value:undefined;
 const bound=name=>vars[name]?.type==='secret_text'||typeof plain(name)==='string'&&plain(name).length>0;
 const databaseId=UUID.test(config?.d1_databases?.BILLING_DB?.id||'')?config.d1_databases.BILLING_DB.id:null;
 const flags=Array.isArray(config?.compatibility_flags)?config.compatibility_flags:[],date=config?.compatibility_date;
 const validDate=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
 const nodeCompatibilityEnabled=!flags.includes('no_nodejs_compat')&&(flags.includes('nodejs_compat')||validDate&&date>='2026-08-04');
 return {deploymentId:deployed.id,databaseId,configuration:{
  expectedProductionCommit:true,billingDatabaseBound:databaseId!==null,
  hasApexDomain:project.domains.includes('basketboss.co.uk'),hasWwwDomain:project.domains.includes('www.basketboss.co.uk'),
  environmentProduction:deployed.environment==='production',
  supabaseProductionUrlBound:plain('SUPABASE_URL')==='https://kbhyosxuvlcazyzzinqv.supabase.co',
  publishableKeyBound:bound('SUPABASE_PUBLISHABLE_KEY'),
  privilegedKeyBound:bound('SUPABASE_SECRET_KEY')||bound('SUPABASE_SERVICE_ROLE_KEY'),
  liveBillingEnabled:plain('BB_BILLING_ENABLED')==='true'&&plain('BB_BILLING_MODE')==='live',
  livePaddleKeyBound:bound('PADDLE_LIVE_API_KEY'),
  founderPriceConfigured:/^pri_[a-z0-9]{26}$/.test(plain('PADDLE_LIVE_FOUNDER_PRICE_ID')||''),
  standardPriceConfigured:/^pri_[a-z0-9]{26}$/.test(plain('PADDLE_LIVE_STANDARD_PRICE_ID')||''),
  appleBillingEnabled:plain('APPLE_BILLING_ENABLED')==='true',
  compatibilityDate:validDate?date:null,nodeCompatibilityExplicit:flags.includes('nodejs_compat'),
  nodeCompatibilityEnabled,
  nodeCryptoCompatible:nodeCompatibilityEnabled&&!flags.includes('no_nodejs_compat_v2')&&validDate&&date>='2024-09-23'
 }};
}

async function inspectSchema(env,databaseId,perform){
 const tables=Object.fromEntries(Object.keys(REQUIRED_COLUMNS).map(table=>[table,false]));
 if(!databaseId)return {kind:'schema',schemaInspectionAvailable:false,tables};
 try{
  const result=await cloudflare(env,'accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/d1/database/'+databaseId+'/query','POST',perform,{sql:ACCOUNT_DELETE_SCHEMA_SQL},'schema');
  if(!Array.isArray(result)||result.length!==1||result[0]?.success===false||!Array.isArray(result[0]?.results))return {kind:'schema',schemaInspectionAvailable:false,tables};
  const columns=new Map(Object.keys(REQUIRED_COLUMNS).map(table=>[table,new Set()]));
  for(const row of result[0].results)if(object(row)&&columns.has(row.table_name)&&typeof row.column_name==='string')columns.get(row.table_name).add(row.column_name);
  for(const [table,required]of Object.entries(REQUIRED_COLUMNS))tables[table]=required.every(column=>columns.get(table).has(column));
  return {kind:'schema',schemaInspectionAvailable:true,tables};
 }catch(error){return {kind:'schema',schemaInspectionAvailable:false,tables,status:status(error?.status)};}
}

export function validateAccountDeletionTailURL(value){
 let address;try{address=new URL(value);}catch{throw new InspectionError('INSPECT_TAIL_URL');}
 requireThat(typeof value==='string'&&!/[\u0000-\u0020\u007f]/.test(value)&&address.protocol==='wss:'&&
  address.hostname==='tail.developers.workers.dev'&&!address.port&&!address.username&&!address.password&&!address.hash,'INSPECT_TAIL_URL');
 return address.href;
}

function requestMetadata(headers){
 if(!object(headers))return {originKind:'missing',hasAuth:false};
 const entries=Object.entries(headers),origins=entries.filter(([name])=>name.toLowerCase()==='origin');
 const hasAuth=entries.some(([name,value])=>name.toLowerCase()==='authorization'&&typeof value==='string'&&value.trim().length>0);
 if(!origins.length)return {originKind:'missing',hasAuth};
 if(origins.length!==1)return {originKind:'other',hasAuth};
 const value=origins[0][1],originKind=value==='capacitor://localhost'?'native':value==='https://basketboss.co.uk'?'web_apex':
  value==='https://www.basketboss.co.uk'?'web_www':value==='null'?'null':'other';
 return {originKind,hasAuth};
}

export function sanitizeAccountDeletionTailEvent(value){
 if(!object(value))return null;
 let route;try{const address=value.event?.request?.url;if(typeof address!=='string'||address.length>8192)return null;route=new URL(address).pathname;}catch{return null;}
 if(route!=='/api/account/delete')return null;
 const diagnostics=new Set();
 for(const log of Array.isArray(value.logs)?value.logs.slice(0,100):[]){
  if(log?.level!=='warn'||!Array.isArray(log.message))continue;
  for(const message of log.message.slice(0,100)){
   if(typeof message!=='string'||message.length>100||!message.startsWith('BB_ACCOUNT_DELETE: '))continue;
   const code=message.slice('BB_ACCOUNT_DELETE: '.length);if(DELETE_CODES.has(code))diagnostics.add(code);
  }
 }
 const method=value.event?.request?.method;
 return {route,method:METHODS.has(method)?method:'other',status:status(value.event?.response?.status),
  outcome:OUTCOMES.has(value.outcome)?value.outcome:'unknown',...requestMetadata(value.event?.request?.headers),diagnostics:[...diagnostics]};
}

async function listen(url,{WebSocket:Socket,emit,setTimeout:later,clearTimeout:clear}){
 requireThat(typeof Socket==='function','INSPECT_TAIL_SOCKET');
 let socket,timer,finished=false,received=0,emitted=0,processing=Promise.resolve();
 return await new Promise((resolve,reject)=>{
  const finish=(reason,error=false)=>{
   if(finished)return;finished=true;clear(timer);try{socket?.close();}catch{}
   if(error)reject(new InspectionError('INSPECT_TAIL_SOCKET'));else resolve({received,emitted,stopReason:reason});
  };
  timer=later(()=>finish('duration'),ACCOUNT_DELETE_INSPECT_LIMITS.durationMs);
  try{socket=new Socket(url,'trace-v1');socket.binaryType='arraybuffer';}catch{finish('socket',true);return;}
  socket.addEventListener('open',()=>{if(!finished)try{socket.send(JSON.stringify({debug:false}));}catch{finish('socket',true);}});
  socket.addEventListener('error',()=>finish('socket',true));
  socket.addEventListener('close',()=>{void processing.then(()=>finish('closed'));});
  socket.addEventListener('message',event=>{
   if(finished||received>=ACCOUNT_DELETE_INSPECT_LIMITS.events)return;received++;
   const data=event.data;
   processing=processing.then(()=>{
    if(finished)return;
    let bytes;
    if(typeof data==='string'){
     if(data.length>ACCOUNT_DELETE_INSPECT_LIMITS.eventBytes||Buffer.byteLength(data,'utf8')>ACCOUNT_DELETE_INSPECT_LIMITS.eventBytes){finish('oversize');return;}bytes=data;
    }else if(data instanceof ArrayBuffer||ArrayBuffer.isView(data)){
     if(data.byteLength>ACCOUNT_DELETE_INSPECT_LIMITS.eventBytes){finish('oversize');return;}
     const view=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
     try{bytes=new TextDecoder('utf-8',{fatal:true}).decode(view);}catch{return;}
    }else return;
    if(finished)return;let parsed;try{parsed=JSON.parse(bytes);}catch{return;}
    const safe=sanitizeAccountDeletionTailEvent(parsed);if(safe){emit(safe);emitted++;}
   }).catch(()=>finish('socket',true));
   if(received>=ACCOUNT_DELETE_INSPECT_LIMITS.events)void processing.then(()=>finish('events'));
  });
 });
}

export async function inspectAccountDeletionLive(env=process.env,options={}){
 const mode=options.mode||env.BB_ACCOUNT_DELETE_INSPECT_MODE||'tail';requireAccountDeletionInspectEnvironment(env,mode);
 const perform=options.perform||fetch,emit=options.emit||((value)=>console.log(JSON.stringify(value)));
 const prefix='accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/pages/projects/'+PROJECT;
 const details=deploymentDetails(await cloudflare(env,prefix,'GET',perform,undefined,'project'));
 emit({kind:'configuration',...details.configuration});
 emit(await inspectSchema(env,details.databaseId,perform));
 if(mode==='config')return {mode,expectedProductionCommit:true};
 const tailRoute=prefix+'/deployments/'+details.deploymentId+'/tails';
 const tail=await cloudflare(env,tailRoute,'POST',perform,{filters:[]},'tail_create');
 requireThat(typeof tail?.id==='string'&&TAIL_ID.test(tail.id)&&tail.id!=='.'&&tail.id!=='..','INSPECT_TAIL_RESPONSE');
 const tailId=encodeURIComponent(tail.id);
 try{
  const url=validateAccountDeletionTailURL(tail.url);
  emit({kind:'tail',listening:true,durationSeconds:90});
  const result=await listen(url,{WebSocket:options.WebSocket||globalThis.WebSocket,emit,
   setTimeout:options.setTimeout||setTimeout,clearTimeout:options.clearTimeout||clearTimeout});
  return {mode,expectedProductionCommit:true,...result};
 }finally{
  try{await cloudflare(env,tailRoute+'/'+tailId,'DELETE',perform,undefined,'tail_delete');}
  catch(error){throw new InspectionError('INSPECT_TAIL_CLEANUP','tail_delete',status(error?.status));}
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);requireThat(args.length===0||args.length===1&&['--config','--tail'].includes(args[0]),'INSPECT_MODE');
  const result=await inspectAccountDeletionLive(process.env,args.length?{mode:args[0].slice(2)}:{});
  console.log(JSON.stringify({kind:'complete',...result}));
 }catch(error){console.log(JSON.stringify(accountDeletionInspectionFailure(error)));process.exitCode=1;}
}
