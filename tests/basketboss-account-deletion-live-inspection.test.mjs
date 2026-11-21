import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAccountDeletionLive,requireAccountDeletionInspectEnvironment,sanitizeAccountDeletionTailEvent,
 validateAccountDeletionTailURL,accountDeletionInspectionFailure,ACCOUNT_DELETE_PRODUCTION_SHA,ACCOUNT_DELETE_INSPECT_LIMITS,
 ACCOUNT_DELETE_SCHEMA_SQL} from '../scripts/inspect-account-deletion-live.mjs';

const PRIVATE='PRIVATE_FIXTURE_MUST_NEVER_APPEAR',DEPLOYMENT='11111111-1111-4111-8111-111111111111';
const ENV={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'jbatiste12-debug/BasketBoss',GITHUB_REF:'refs/heads/diagnostics/account-delete-public-20261121',GITHUB_SHA:'a'.repeat(40),
 CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),CLOUDFLARE_API_TOKEN:'TOKEN_'+PRIVATE.repeat(2)};
const COLUMNS={bb_account_deletions:['actor_hash','retry_hash','user_id','email','started_at_ms','completed_at_ms','locked_until_ms'],
 bb_account_deletion_refs:['ref_hash'],bb_paid_entitlements:['paddle_subscription_id','paddle_customer_id','user_id','status','price_id','plan','trial_ends_at','current_period_ends_at','cancellation_effective_at','cancel_at_period_end','updated_at_ms'],
 bb_billing_claims:['claim_id','user_id','transaction_id','claim_state','slot_no'],bb_founder_slots:['slot_no','state','user_id','paddle_subscription_id']};
const trace=(patch={})=>({event:{request:{url:'https://basketboss.co.uk/api/account/delete?actor='+PRIVATE,method:'POST',headers:{Origin:'capacitor://localhost',Authorization:PRIVATE,Cookie:PRIVATE},body:PRIVATE},response:{status:403,headers:{secret:PRIVATE},body:PRIVATE}},
 outcome:'ok',logs:[{level:'warn',message:['BB_ACCOUNT_DELETE: deletion_auth_unavailable']},{level:'error',message:[PRIVATE]}],exceptions:[{message:PRIVATE,stack:PRIVATE}],...patch});

function fixture({projectPatch={},tailId='tail:'+PRIVATE+'+opaque=',tailURL='wss://tail.developers.workers.dev/private?token='+PRIVATE,columns=COLUMNS,
 schemaFailure=false,onSocket,autoClose=true,socketFailure=false,deleteFailure=false,apiResponse}={}){
 const calls=[],emitted=[],sockets=[],timers=[];
 const project={name:'basketboss-site',production_branch:'main',domains:['basketboss.co.uk','www.basketboss.co.uk'],
  canonical_deployment:{id:DEPLOYMENT,environment:'production',latest_stage:{name:'deploy',status:'success'},deployment_trigger:{metadata:{commit_hash:ACCOUNT_DELETE_PRODUCTION_SHA}}},
  deployment_configs:{production:{compatibility_flags:['nodejs_compat'],compatibility_date:'2026-10-01',env_vars:{SUPABASE_URL:{type:'plain_text',value:'https://kbhyosxuvlcazyzzinqv.supabase.co'},SUPABASE_PUBLISHABLE_KEY:{type:'secret_text',value:PRIVATE},SUPABASE_SECRET_KEY:{type:'secret_text',value:PRIVATE},BB_BILLING_ENABLED:{type:'plain_text',value:'true'},BB_BILLING_MODE:{type:'plain_text',value:'live'},PADDLE_LIVE_API_KEY:{type:'secret_text',value:PRIVATE}},d1_databases:{BILLING_DB:{id:'33333333-3333-4333-8333-333333333333'}}}},...projectPatch};
 const perform=async(address,options)=>{
  const url=new URL(address);calls.push({url,options});
  assert.equal(url.origin,'https://api.cloudflare.com');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
  const custom=apiResponse?.(url,options);if(custom!==undefined)return custom;
  if(url.pathname.includes('/d1/database/')){
   assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{sql:ACCOUNT_DELETE_SCHEMA_SQL});
   return Response.json({success:!schemaFailure,result:[{success:true,results:Object.entries(columns).flatMap(([table_name,names])=>names.map(column_name=>({table_name,column_name})))}]},{status:schemaFailure?403:200});
  }
  if(options.method==='GET')return Response.json({success:true,result:project});
  if(options.method==='POST')return Response.json({success:true,result:{id:tailId,url:tailURL,private:PRIVATE}});
  if(options.method==='DELETE')return Response.json({success:!deleteFailure,result:null,errors:[{message:PRIVATE}]},{status:deleteFailure?403:200});
  throw Error(PRIVATE);
 };
 class Socket extends EventTarget{
  constructor(url,protocol){super();if(socketFailure)throw Error(PRIVATE);this.url=url;this.protocol=protocol;this.sent=[];this.closed=false;sockets.push(this);
   queueMicrotask(()=>{this.dispatchEvent(new Event('open'));onSocket?.(this,timers);if(autoClose)setImmediate(()=>this.close());});}
  send(value){this.sent.push(value);}
  message(value){this.dispatchEvent(new MessageEvent('message',{data:value}));}
  close(){if(this.closed)return;this.closed=true;this.dispatchEvent(new Event('close'));}
 }
 const options={perform,WebSocket:Socket,emit:value=>emitted.push(value),setTimeout:(callback,milliseconds)=>{const timer={callback,milliseconds,cleared:false};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cleared=true;}};
 return {calls,emitted,sockets,timers,project,options,run:(mode='tail')=>inspectAccountDeletionLive(ENV,{...options,mode})};
}

test('only the exact diagnostic branch in this repository Actions environment can use protected credentials',async()=>{
 for(const patch of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repository'},{GITHUB_REF:'refs/heads/main'},{GITHUB_REF:'refs/heads/diagnostics/account-delete-public-20261121-extra'},
  {GITHUB_SHA:'not-a-sha'},{CLOUDFLARE_API_TOKEN:''},{CLOUDFLARE_API_TOKEN:{value:PRIVATE}},{CLOUDFLARE_ACCOUNT_ID:'../account'}]){
  let calls=0;
  await assert.rejects(()=>inspectAccountDeletionLive({...ENV,...patch},{perform:async()=>{calls++;throw Error(PRIVATE);}}),error=>['INSPECT_ENVIRONMENT','INSPECT_CREDENTIALS'].includes(error.code));
  assert.equal(calls,0);
 }
 assert.throws(()=>requireAccountDeletionInspectEnvironment(ENV,'write'),{code:'INSPECT_MODE'});
});

test('configuration reads reveal only binding flags and schema readiness, never secrets or customer records',async()=>{
 const h=fixture();assert.deepEqual(await h.run('config'),{mode:'config',expectedProductionCommit:true});
 assert.deepEqual(h.calls.map(call=>call.options.method),['GET','POST']);assert.equal(h.sockets.length,0);
 assert.equal(h.calls[0].options.headers.Authorization,'Bearer '+ENV.CLOUDFLARE_API_TOKEN);
 assert.deepEqual(h.emitted[0],{kind:'configuration',expectedProductionCommit:true,billingDatabaseBound:true,hasApexDomain:true,hasWwwDomain:true,environmentProduction:true,supabaseProductionUrlBound:true,publishableKeyBound:true,privilegedKeyBound:true,liveBillingEnabled:true,livePaddleKeyBound:true,founderPriceConfigured:false,standardPriceConfigured:false,appleBillingEnabled:false,compatibilityDate:'2026-10-01',nodeCompatibilityExplicit:true,nodeCompatibilityEnabled:true,nodeCryptoCompatible:true});
 assert.deepEqual(h.emitted[1],{kind:'schema',schemaInspectionAvailable:true,tables:Object.fromEntries(Object.keys(COLUMNS).map(table=>[table,true]))});
 assert.equal((ACCOUNT_DELETE_SCHEMA_SQL.match(/pragma_table_info\(/g)||[]).length,5);
 assert.doesNotMatch(ACCOUNT_DELETE_SCHEMA_SQL,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|ATTACH)\b/i);
 assert.equal(ACCOUNT_DELETE_SCHEMA_SQL.includes(' FROM bb_'),false);
 assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
});

test('wrong project, deployment or production commit aborts before schema queries and tail creation',async()=>{
 for(const projectPatch of [{name:'other'},{production_branch:'diagnostic'},{domains:['other.invalid']},{canonical_deployment:null},
  {canonical_deployment:{id:DEPLOYMENT,environment:'preview',latest_stage:{name:'deploy',status:'success'},deployment_trigger:{metadata:{commit_hash:ACCOUNT_DELETE_PRODUCTION_SHA}}}},
  {canonical_deployment:{id:DEPLOYMENT,environment:'production',latest_stage:{name:'deploy',status:'success'},deployment_trigger:{metadata:{commit_hash:'c'.repeat(40)}}}}]){
  const h=fixture({projectPatch});await assert.rejects(()=>h.run(),error=>['INSPECT_PROJECT','INSPECT_DEPLOYMENT'].includes(error.code));
  assert.equal(h.calls.length,1);assert.equal(h.emitted.length,0);assert.equal(h.sockets.length,0);
 }
});

test('missing schema columns and denied schema access are honest flags without querying records or suppressing tail',async()=>{
 for(const options of [{columns:{...COLUMNS,bb_account_deletions:['actor_hash',PRIVATE]}},{schemaFailure:true}]){
  const h=fixture(options);await h.run();const schema=h.emitted.find(value=>value.kind==='schema');
  assert.equal(schema.tables.bb_account_deletions,false);assert.equal(schema.schemaInspectionAvailable,!options.schemaFailure);
  assert.equal(h.sockets.length,1);assert.equal(h.calls.at(-1).options.method,'DELETE');
  assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
 }
});

test('exact deletion-path sanitizer strips account query, headers, bodies, raw errors and unknown diagnostics',()=>{
 const event=trace();event.logs.push({level:'warn',message:['BB_ACCOUNT_DELETE: '+PRIVATE,'BB_ACCOUNT_DELETE: deletion_auth_unavailable '+PRIVATE]},
  {level:'debug',message:['BB_ACCOUNT_DELETE: deletion_database_pending']});
 assert.deepEqual(sanitizeAccountDeletionTailEvent(event),{route:'/api/account/delete',method:'POST',status:403,outcome:'ok',originKind:'native',hasAuth:true,diagnostics:['deletion_auth_unavailable']});
 assert.doesNotMatch(JSON.stringify(sanitizeAccountDeletionTailEvent(event)),new RegExp(PRIVATE));
 for(const url of ['https://basketboss.co.uk/api/household','https://basketboss.co.uk/api/account/delete/','https://basketboss.co.uk/api/account/delete/extra',PRIVATE]){
  const other=trace();other.event.request.url=url;assert.equal(sanitizeAccountDeletionTailEvent(other),null);
 }
 assert.equal(sanitizeAccountDeletionTailEvent(null),null);
});

test('Origin and Authorization produce only enums and presence booleans, including GET status checks',()=>{
 for(const [headers,originKind,hasAuth]of [[{oRiGiN:'capacitor://localhost',authorization:PRIVATE},'native',true],
  [{Origin:'https://basketboss.co.uk'},'web_apex',false],[{Origin:'https://www.basketboss.co.uk',Cookie:PRIVATE},'web_www',false],
  [{Origin:'null',Authorization:''},'null',false],[{},'missing',false],[undefined,'missing',false],
  [{Origin:PRIVATE,AUTHORIZATION:PRIVATE},'other',true],[{Origin:'capacitor://localhost',origin:PRIVATE},'other',false]]){
  const value=trace();value.event.request.headers=headers;value.event.request.method='GET';value.event.request.url='https://basketboss.co.uk/api/account/delete?mode=status&actor='+PRIVATE;
  const safe=sanitizeAccountDeletionTailEvent(value);assert.equal(safe.originKind,originKind);assert.equal(safe.hasAuth,hasAuth);assert.equal(safe.method,'GET');
  assert.doesNotMatch(JSON.stringify(safe),new RegExp(PRIVATE));
 }
 const value=trace({outcome:PRIVATE});value.event.request.method=PRIVATE;value.event.response.status=600;
 const safe=sanitizeAccountDeletionTailEvent(value);assert.equal(safe.method,'other');assert.equal(safe.status,null);assert.equal(safe.outcome,'unknown');
});

test('tail reads only production capability, sanitizes frames and always deletes the temporary tail',async()=>{
 const h=fixture({onSocket:socket=>socket.message(JSON.stringify(trace()))}),result=await h.run();
 assert.deepEqual(result,{mode:'tail',expectedProductionCommit:true,received:1,emitted:1,stopReason:'closed'});
 assert.deepEqual(h.calls.map(call=>call.options.method),['GET','POST','POST','DELETE']);
 assert.equal(h.calls[2].options.body,'{"filters":[]}');assert.ok(h.calls[2].url.pathname.endsWith('/deployments/'+DEPLOYMENT+'/tails'));
 assert.ok(h.calls[3].url.pathname.endsWith('/tails/'+encodeURIComponent('tail:'+PRIVATE+'+opaque=')));
 assert.equal(h.sockets[0].protocol,'trace-v1');assert.deepEqual(h.sockets[0].sent,['{"debug":false}']);
 assert.equal(h.timers[0].milliseconds,90000);assert.equal(h.timers[0].cleared,true);
 assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
});

test('unsafe tail capabilities cannot redirect credentials or leak raw API response fields',async()=>{
 for(const tailURL of [PRIVATE,'https://tail.developers.workers.dev/'+PRIVATE,'wss://tail.developers.workers.dev.evil.invalid/'+PRIVATE,
  'wss://user:password@tail.developers.workers.dev/'+PRIVATE,'wss://tail.developers.workers.dev:8443/'+PRIVATE,'wss://tail.developers.workers.dev/path#'+PRIVATE]){
  assert.throws(()=>validateAccountDeletionTailURL(tailURL),{code:'INSPECT_TAIL_URL'});
  const h=fixture({tailURL});await assert.rejects(()=>h.run(),{code:'INSPECT_TAIL_URL'});
  assert.equal(h.sockets.length,0);assert.equal(h.calls.at(-1).options.method,'DELETE');assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
 }
 for(const tailId of ['../'+PRIVATE,'.','..','%2f'+PRIVATE,'x'.repeat(257),null]){
  const h=fixture({tailId});await assert.rejects(()=>h.run(),{code:'INSPECT_TAIL_RESPONSE'});
  assert.equal(h.sockets.length,0);assert.equal(h.calls.some(call=>call.options.method==='DELETE'),false);
 }
});

test('permission and network errors expose fixed operations and HTTP statuses, never provider content',async()=>{
 const h=fixture({apiResponse:(url,options)=>options.method==='POST'&&url.pathname.endsWith('/tails')?
  Response.json({success:false,errors:[{code:10000,message:PRIVATE}],result:{url:PRIVATE}},{status:403}):undefined});
 await assert.rejects(()=>h.run(),error=>{assert.deepEqual(accountDeletionInspectionFailure(error),{kind:'failure',code:'INSPECT_API',operation:'tail_create',status:403});return true;});
 assert.equal(h.sockets.length,0);assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
 assert.deepEqual(accountDeletionInspectionFailure(Error(PRIVATE)),{kind:'failure',code:'INSPECT_API'});
 assert.deepEqual(accountDeletionInspectionFailure({code:'INSPECT_API',operation:PRIVATE,status:403,message:PRIVATE}),{kind:'failure',code:'INSPECT_API'});
});

test('connection errors and cleanup failures never retain a temporary tail silently',async()=>{
 const socket=fixture({socketFailure:true});await assert.rejects(()=>socket.run(),{code:'INSPECT_TAIL_SOCKET'});
 assert.equal(socket.calls.at(-1).options.method,'DELETE');assert.equal(socket.timers[0].cleared,true);
 const cleanup=fixture({deleteFailure:true});await assert.rejects(()=>cleanup.run(),error=>{
  assert.deepEqual(accountDeletionInspectionFailure(error),{kind:'failure',code:'INSPECT_TAIL_CLEANUP',operation:'tail_delete',status:403});return true;
 });
});

test('ninety-second, hundred-frame and one-MiB limits cannot be overridden, and unrelated traffic is never emitted',async()=>{
 const timed=fixture({autoClose:false,onSocket:(_socket,timers)=>queueMicrotask(()=>timers[0].callback())});
 assert.equal((await timed.run()).stopReason,'duration');assert.equal(timed.sockets[0].closed,true);
 const capped=fixture({autoClose:false,onSocket:socket=>{for(let index=0;index<120;index++)socket.message(JSON.stringify(trace()));}});
 const result=await capped.run();assert.equal(result.received,100);assert.equal(result.emitted,100);assert.equal(result.stopReason,'events');
 const unrelated=fixture({onSocket:socket=>{const value=trace();value.event.request.url='https://basketboss.co.uk/api/household?private='+PRIVATE;socket.message(JSON.stringify(value));}});
 assert.equal((await unrelated.run()).emitted,0);
 const oversize=fixture({autoClose:false,onSocket:socket=>socket.message('x'.repeat(1048577))});assert.equal((await oversize.run()).stopReason,'oversize');
 assert.equal(oversize.calls.at(-1).options.method,'DELETE');
 assert.deepEqual(ACCOUNT_DELETE_INSPECT_LIMITS,{durationMs:90000,eventBytes:1048576,events:100});assert.equal(Object.isFrozen(ACCOUNT_DELETE_INSPECT_LIMITS),true);
});
