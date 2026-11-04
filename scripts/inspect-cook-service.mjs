// Bounded operational inspection only. No authenticated app requests, AI calls,
// allowance consumption, configuration changes, or raw tail output.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPOSITORY='jbatiste12-debug/BasketBoss',PROJECT='basketboss-site';
const API='https://api.cloudflare.com/client/v4/',NATIVE='capacitor://localhost';
const HOSTS=Object.freeze([['apex','https://basketboss.co.uk'],['www','https://www.basketboss.co.uk']]);
const ROUTES=new Set(['/api/tts','/api/cook-assistant']);
const QUOTA_SCHEMA_SQL="SELECT name FROM pragma_table_info('bb_ai_daily_usage')";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const COOK_INSPECT_LIMITS=Object.freeze({durationMs:90000,eventBytes:1024*1024,events:50});
const DIAGNOSTIC_STAGES=new Set(['config','authorization','request','quota_database','quota','provider_request','provider_audio','account_state','session_config','session_verification']);
const DIAGNOSTIC_CODES=new Set([
 'BB_COOK_PROVIDER_ACCESS','BB_COOK_PROVIDER_LIMIT','BB_COOK_PROVIDER_UNAVAILABLE','BB_COOK_PROVIDER_RESPONSE',
 'BB_COOK_PROVIDER_REJECTED','BB_COOK_SERVICE_FAILURE','BB_COOK_SERVICE_UNAVAILABLE','BB_COOK_DAILY_LIMIT',
 'BB_COOK_AUTH_REQUIRED','BB_COOK_PREMIUM_REQUIRED','BB_COOK_ACCOUNT_PENDING','BB_COOK_ACCOUNT_UNAVAILABLE',
 'BB_COOK_MEMBERSHIP_UNAVAILABLE','BB_COOK_SESSION_MISCONFIGURED','BB_COOK_SESSION_REPLACED','BB_COOK_SESSION_UNAVAILABLE',
 'BB_COOK_CONFIG_AI_DISABLED','BB_COOK_CONFIG_TTS_DISABLED','BB_COOK_CONFIG_BINDINGS_UNAVAILABLE',
 'BB_COOK_CONFIG_LIMITS_UNAVAILABLE','BB_COOK_CONFIG_PROVIDER_UNAVAILABLE','BB_COOK_ORIGIN_REJECTED',
 'BB_COOK_REQUEST_INVALID','BB_COOK_REQUEST_CANCELLED','BB_COOK_METHOD_REJECTED'
]);
const OUTCOMES=new Set(['ok','exception','exceededCpu','exceededMemory','canceled','unknown']);
const FAILURES=new Set(['INSPECT_ENVIRONMENT','INSPECT_MODE','INSPECT_CREDENTIALS','INSPECT_API',
 'INSPECT_PROJECT','INSPECT_DEPLOYMENT','INSPECT_TAIL_RESPONSE','INSPECT_TAIL_URL','INSPECT_TAIL_SOCKET','INSPECT_TAIL_CLEANUP']);
const API_OPERATIONS=new Set(['project','quota_schema','tail_create','tail_delete']);
class InspectionError extends Error {constructor(code,metadata={}){super(code);this.code=code;Object.assign(this,metadata);}}
const requireThat=(value,code)=>{if(!value)throw new InspectionError(code);};
const safeFailure=error=>FAILURES.has(error?.code)?error.code:'INSPECT_API';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const status=value=>Number.isInteger(value)&&value>=100&&value<=599?value:null;
const output=value=>console.log(JSON.stringify(value));

function numericCodes(values){
 const result=[];
 for(const value of Array.isArray(values)?values.slice(0,32):[]){
  if(!Number.isInteger(value)||value<1000||value>99999999||result.includes(value))continue;
  result.push(value);if(result.length===8)break;
 }
 return result;
}
export function cookInspectionFailure(error){
 const result={kind:'failure',code:safeFailure(error)};
 // Only server-owned operation labels and bounded numeric API diagnostics can
 // cross this boundary. Never expose CF messages, source pointers or URLs.
 return API_OPERATIONS.has(error?.operation)?{...result,operation:error.operation,status:status(error.status),cloudflareCodes:numericCodes(error.cloudflareCodes)}:result;
}

export function requireCookInspectEnvironment(env,mode){
 requireThat(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/main'&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''),'INSPECT_ENVIRONMENT');
 requireThat(mode==='probe'||mode==='tail','INSPECT_MODE');
 requireThat(typeof env.CLOUDFLARE_API_TOKEN==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(env.CLOUDFLARE_API_TOKEN)&&/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''),'INSPECT_CREDENTIALS');
}

function contentType(headers){
 const value=String(headers?.get?.('Content-Type')||'').split(';')[0].trim().toLowerCase();
 return ['application/json','text/html','audio/mpeg'].includes(value)?value:value?'other':'missing';
}
async function boundedJSON(response,maximum){
 const reader=response?.body?.getReader?.();
 if(!reader)return null;
 const chunks=[];let size=0;
 try{
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum)return null;chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{return null;}finally{try{await reader.cancel();}catch{}}
}
async function publicProbe(perform,hostName,host,route,method){
 const headers={Origin:NATIVE,Accept:'application/json'};
 if(method==='OPTIONS'){headers['Access-Control-Request-Method']='POST';headers['Access-Control-Request-Headers']='authorization, content-type';}
 if(method==='POST')headers['Content-Type']='application/json';
 try{
  const response=await perform(host+route,{method,headers,...(method==='POST'?{body:'{}'}:{}),redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
  const type=contentType(response.headers),methods=String(response.headers.get('Access-Control-Allow-Methods')||'').split(',').map(value=>value.trim().toUpperCase()),allowedHeaders=String(response.headers.get('Access-Control-Allow-Headers')||'').split(',').map(value=>value.trim().toLowerCase());
  const cors=response.headers.get('Access-Control-Allow-Origin')===NATIVE&&!response.headers.has('Access-Control-Allow-Credentials')&&(method!=='OPTIONS'||methods.includes('POST')&&['authorization','content-type'].every(value=>allowedHeaders.includes(value)));
  let value=null;
  if(type==='application/json'&&Number(response.headers.get('Content-Length')||0)<=2048)value=await boundedJSON(response,2048);
  else try{await response.body?.cancel?.();}catch{}
  return {kind:'probe',host:hostName,route,method,status:status(response.status),contentType:type,nativeCors:cors,code:DIAGNOSTIC_CODES.has(value?.code)?value.code:null};
 }catch{return {kind:'probe',host:hostName,route,method,status:null,contentType:'missing',nativeCors:false,code:null};}
}
async function cloudflare(env,route,method,perform,body,operation){
 requireThat(API_OPERATIONS.has(operation),'INSPECT_API');
 let response;
 try{response=await perform(API+route,{method,headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:AbortSignal.timeout(15000)});}
 catch{throw new InspectionError('INSPECT_API',{operation,status:null,cloudflareCodes:[]});}
 const value=await boundedJSON(response,1024*1024);
 if(!response.ok||value?.success!==true)throw new InspectionError('INSPECT_API',{operation,status:status(response.status),cloudflareCodes:numericCodes(Array.isArray(value?.errors)?value.errors.map(error=>error?.code):[])});
 return value.result;
}

function projectDetails(project,sha){
 requireThat(project?.name===PROJECT&&project.production_branch==='main'&&Array.isArray(project.domains)&&project.domains.some(value=>value==='basketboss.co.uk'||value==='www.basketboss.co.uk'),'INSPECT_PROJECT');
 const deployed=project.canonical_deployment;
 requireThat(UUID.test(deployed?.id||'')&&deployed.environment==='production'&&deployed.latest_stage?.name==='deploy'&&deployed.latest_stage.status==='success'&&/^[a-f0-9]{40}$/.test(deployed.deployment_trigger?.metadata?.commit_hash||''),'INSPECT_DEPLOYMENT');
 const config=project.deployment_configs?.production,vars=config?.env_vars||{};
 const flags=Array.isArray(config?.compatibility_flags)?config.compatibility_flags:[],date=config?.compatibility_date;
 const nodeCryptoCompatible=flags.includes('nodejs_compat')&&!flags.includes('no_nodejs_compat_v2')&&typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>='2024-09-23';
 const plain=name=>vars[name]?.type==='plain_text'?vars[name].value:undefined;
 const cap=(name,maximum)=>{const value=Number(plain(name));return Number.isInteger(value)&&value>=1&&value<=maximum;};
 return {deploymentId:deployed.id,databaseId:UUID.test(config?.d1_databases?.BILLING_DB?.id||'')?config.d1_databases.BILLING_DB.id:null,matchingSha:deployed.deployment_trigger.metadata.commit_hash===sha,configuration:{
  aiEnabled:plain('BB_PREMIUM_AI_ENABLED')==='true',ttsEnabled:plain('BB_TTS_ENABLED')==='true',
  nodeCompatibilityEnabled:flags.includes('nodejs_compat'),nodeCryptoCompatible,
  providerSecretBound:vars.OPENAI_API_KEY?.type==='secret_text',
  billingDatabaseBound:UUID.test(config?.d1_databases?.BILLING_DB?.id||''),
  ttsStorageBound:typeof config?.r2_buckets?.BB_TTS_AUDIO?.name==='string'&&config.r2_buckets.BB_TTS_AUDIO.name.length>0,
  ttsCapsReady:cap('BB_TTS_DAILY_MISS_CAP',500)&&cap('BB_TTS_GLOBAL_DAILY_MISS_CAP',10000)
 }};
}
async function inspectQuotaSchema(env,databaseId,perform){
 if(!databaseId)return {kind:'schema',schemaInspectionAvailable:false,quotaSchemaReady:false};
 try{
  const result=await cloudflare(env,'accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/d1/database/'+databaseId+'/query','POST',perform,{sql:QUOTA_SCHEMA_SQL},'quota_schema');
  if(!Array.isArray(result)||result.length!==1||result[0]?.success===false||!Array.isArray(result[0]?.results))return {kind:'schema',schemaInspectionAvailable:false,quotaSchemaReady:false};
  const names=new Set(result[0].results.map(row=>row?.name));
  return {kind:'schema',schemaInspectionAvailable:true,quotaSchemaReady:['day_utc','actor','action','used'].every(name=>names.has(name))};
 }catch{return {kind:'schema',schemaInspectionAvailable:false,quotaSchemaReady:false};}
}
export function validateCookTailURL(value){
 let url;try{url=new URL(value);}catch{throw new InspectionError('INSPECT_TAIL_URL');}
 // The returned URL carries the temporary tail capability. Never print it,
 // append credentials, or accept arbitrary redirect/destination hosts.
 requireThat(typeof value==='string'&&!/[\u0000-\u0020\u007f]/.test(value)&&url.protocol==='wss:'&&url.hostname==='tail.developers.workers.dev'&&!url.port&&!url.username&&!url.password&&!url.hash,'INSPECT_TAIL_URL');
 return url.href;
}
function originKind(headers){
 if(!object(headers))return 'missing';
 const origins=Object.entries(headers).filter(([name])=>name.toLowerCase()==='origin');
 if(!origins.length)return 'missing';if(origins.length!==1)return 'other';
 const value=origins[0][1];
 return value===NATIVE?'native':HOSTS.some(([,host])=>value===host)?'web':value==='null'?'null':'other';
}
export function sanitizeCookTailEvent(value){
 if(!object(value))return null;
 let route;try{const address=value.event?.request?.url;if(typeof address!=='string'||address.length>8192)return null;route=new URL(address).pathname;}catch{return null;}
 if(!ROUTES.has(route))return null;
 const diagnostics=[];
 for(const entry of Array.isArray(value.logs)?value.logs:[]){
  if(entry?.level!=='warn'||!Array.isArray(entry.message))continue;
  for(const message of entry.message){
   if(typeof message!=='string'||message.length>512||!message.startsWith('BB_COOK_DIAGNOSTIC '))continue;
   let item;try{item=JSON.parse(message.slice('BB_COOK_DIAGNOSTIC '.length));}catch{continue;}
   if(!object(item)||Object.keys(item).length!==3||!['stage','code','status'].every(key=>Object.hasOwn(item,key))||!DIAGNOSTIC_STAGES.has(item.stage)||!DIAGNOSTIC_CODES.has(item.code)||!Number.isInteger(item.status)||item.status<400||item.status>599)continue;
   diagnostics.push({stage:item.stage,code:item.code,status:item.status});if(diagnostics.length===32)break;
  }
  if(diagnostics.length===32)break;
 }
 return {route,status:status(value.event?.response?.status),outcome:OUTCOMES.has(value.outcome)?value.outcome:'unknown',originKind:originKind(value.event?.request?.headers),diagnostics};
}

async function listen(url,{WebSocket:Socket,emit,setTimeout:later,clearTimeout:clear}){
 requireThat(typeof Socket==='function','INSPECT_TAIL_SOCKET');
 let socket,timer,finished=false,received=0,emitted=0,processing=Promise.resolve();
 return await new Promise((resolve,reject)=>{
  const finish=(reason,error=false)=>{
   if(finished)return;finished=true;clear(timer);
   try{socket?.close();}catch{}
   if(error)reject(new InspectionError('INSPECT_TAIL_SOCKET'));else resolve({received,emitted,stopReason:reason});
  };
  timer=later(()=>finish('duration'),COOK_INSPECT_LIMITS.durationMs);
  try{socket=new Socket(url,'trace-v1');socket.binaryType='arraybuffer';}catch{finish('socket',true);return;}
  socket.addEventListener('open',()=>{if(finished)return;try{socket.send(JSON.stringify({debug:false}));}catch{finish('socket',true);}});
  socket.addEventListener('error',()=>finish('socket',true));
  socket.addEventListener('close',()=>finish('closed'));
  socket.addEventListener('message',event=>{
   if(finished||received>=COOK_INSPECT_LIMITS.events)return;received++;
   const data=event.data;
   processing=processing.then(async()=>{
    if(finished)return;
    let bytes;
    if(typeof data==='string'){
     if(data.length>COOK_INSPECT_LIMITS.eventBytes||Buffer.byteLength(data,'utf8')>COOK_INSPECT_LIMITS.eventBytes){finish('oversize');return;}bytes=data;
    }else if(data instanceof ArrayBuffer||ArrayBuffer.isView(data)){
     if(data.byteLength>COOK_INSPECT_LIMITS.eventBytes){finish('oversize');return;}
     const view=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
     try{bytes=new TextDecoder('utf-8',{fatal:true}).decode(view);}catch{return;}
    }else return;
    if(finished)return;let eventValue;try{eventValue=JSON.parse(bytes);}catch{return;}
    const safe=sanitizeCookTailEvent(eventValue);if(safe){emit(safe);emitted++;}
   }).catch(()=>finish('socket',true));
   if(received>=COOK_INSPECT_LIMITS.events)processing.then(()=>finish('events'));
  });
 });
}

export async function inspectCookService(env=process.env,options={}){
 const mode=options.mode||env.BB_COOK_INSPECT_MODE;requireCookInspectEnvironment(env,mode);
 const perform=options.perform||fetch,emit=options.emit||output;
 const probes=await Promise.all(HOSTS.flatMap(([name,host])=>[
  ['/api/tts','OPTIONS'],['/api/cook-assistant','OPTIONS'],['/api/tts','GET'],['/api/cook-assistant','POST']
 ].map(async([route,method])=>{const result=await publicProbe(perform,name,host,route,method);emit(result);return result;})));
 const prefix='accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/pages/projects/'+PROJECT;
 const details=projectDetails(await cloudflare(env,prefix,'GET',perform,undefined,'project'),env.GITHUB_SHA);
 emit({kind:'configuration',matchingSha:details.matchingSha,canonicalProductionReady:true,configuration:details.configuration});
 emit(await inspectQuotaSchema(env,details.databaseId,perform));
 if(mode==='probe')return {mode,matchingSha:details.matchingSha,probes:probes.length};
 const tailRoute=prefix+'/deployments/'+details.deploymentId+'/tails';
 const tail=await cloudflare(env,tailRoute,'POST',perform,{filters:[]},'tail_create');
 requireThat(UUID.test(tail?.id||''),'INSPECT_TAIL_RESPONSE');
 try{
  const url=validateCookTailURL(tail.url);
  emit({kind:'tail',matchingSha:details.matchingSha,listening:true,durationSeconds:90});
  const result=await listen(url,{WebSocket:options.WebSocket||globalThis.WebSocket,emit,setTimeout:options.setTimeout||setTimeout,clearTimeout:options.clearTimeout||clearTimeout});
  return {mode,matchingSha:details.matchingSha,...result};
 }finally{
  try{await cloudflare(env,tailRoute+'/'+tail.id,'DELETE',perform,undefined,'tail_delete');}
  catch(error){const safe=cookInspectionFailure(error);throw new InspectionError('INSPECT_TAIL_CLEANUP',{operation:'tail_delete',status:safe.status??null,cloudflareCodes:safe.cloudflareCodes||[]});}
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);requireThat(args.length===0||args.length===1&&['--probe','--tail'].includes(args[0]),'INSPECT_MODE');
  const result=await inspectCookService(process.env,args.length?{mode:args[0].slice(2)}:{});output({kind:'complete',...result});
 }catch(error){output(cookInspectionFailure(error));process.exitCode=1;}
}
