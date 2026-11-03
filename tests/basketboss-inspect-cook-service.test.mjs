import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCookService,requireCookInspectEnvironment,sanitizeCookTailEvent,validateCookTailURL,cookInspectionFailure,COOK_INSPECT_LIMITS} from '../scripts/inspect-cook-service.mjs';

const COMMIT='a'.repeat(40),DEPLOYMENT='11111111-1111-4111-8111-111111111111',TAIL='22222222-2222-4222-8222-222222222222';
const PRIVATE='PRIVATE_FIXTURE_MUST_NEVER_APPEAR';
const ENV={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'jbatiste12-debug/BasketBoss',GITHUB_REF:'refs/heads/main',GITHUB_SHA:COMMIT,CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),CLOUDFLARE_API_TOKEN:'TOKEN_'+PRIVATE.repeat(2)};
const diagnostic=(patch={})=>'BB_COOK_DIAGNOSTIC '+JSON.stringify({stage:'provider_request',code:'BB_COOK_PROVIDER_ACCESS',status:502,...patch});
const trace=(patch={})=>({event:{request:{url:'https://old-canonical.pages.dev/api/tts?private='+PRIVATE,headers:{Origin:'capacitor://localhost',Authorization:PRIVATE,Cookie:PRIVATE},body:PRIVATE},response:{status:502,headers:{secret:PRIVATE}}},outcome:'exception',logs:[{level:'warn',message:[diagnostic()]},{level:'error',message:[PRIVATE]}],exceptions:[{name:PRIVATE,message:PRIVATE,stack:PRIVATE}],...patch});

function fixture({projectPatch={},tailURL='wss://tail.developers.workers.dev/capability?token='+PRIVATE,publicResponse,apiResponse,onSocket,autoClose=true,socketFailure=false,deleteFailure=false,schemaColumns=['day_utc','actor','action','used'],schemaFailure=false}={}){
 const calls=[],emitted=[],sockets=[],timers=[];
 const project={name:'basketboss-site',production_branch:'main',domains:['basketboss.co.uk','www.basketboss.co.uk'],
  canonical_deployment:{id:DEPLOYMENT,environment:'production',latest_stage:{name:'deploy',status:'success'},deployment_trigger:{metadata:{commit_hash:COMMIT}}},
  deployment_configs:{production:{env_vars:{BB_PREMIUM_AI_ENABLED:{type:'plain_text',value:'true'},BB_TTS_ENABLED:{type:'plain_text',value:'true'},OPENAI_API_KEY:{type:'secret_text',value:PRIVATE},BB_TTS_DAILY_MISS_CAP:{type:'plain_text',value:'50'},BB_TTS_GLOBAL_DAILY_MISS_CAP:{type:'plain_text',value:'500'}},d1_databases:{BILLING_DB:{id:'33333333-3333-4333-8333-333333333333'}},r2_buckets:{BB_TTS_AUDIO:{name:PRIVATE}}}},...projectPatch};
 const perform=async(address,options)=>{
  const url=new URL(address);calls.push({url,options,emissions:emitted.length});
  if(url.hostname==='api.cloudflare.com'){
   const custom=apiResponse?.(url,options);if(custom!==undefined)return custom;
   if(url.pathname.includes('/d1/database/')){
    assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{sql:"SELECT name FROM pragma_table_info('bb_ai_daily_usage')"});
    return Response.json({success:!schemaFailure,result:[{success:true,results:schemaColumns.map(name=>({name}))}]},{status:schemaFailure?403:200});
   }
   if(options.method==='GET')return Response.json({success:true,result:project});
   if(options.method==='POST')return Response.json({success:true,result:{id:TAIL,url:tailURL,expires_at:PRIVATE}});
   if(options.method==='DELETE')return Response.json({success:!deleteFailure,result:null,errors:deleteFailure?[{message:PRIVATE}]:[]},{status:deleteFailure?500:200});
   throw Error(PRIVATE);
  }
  if(publicResponse)return publicResponse(url,options);
  const headers={'Access-Control-Allow-Origin':'capacitor://localhost','Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  return options.method==='OPTIONS'?new Response(null,{status:204,headers}):Response.json({error:PRIVATE,code:'BB_COOK_AUTH_REQUIRED'},{status:401,headers});
 };
 class Socket extends EventTarget{
  constructor(url,protocol){
   super();if(socketFailure)throw Error(PRIVATE);this.url=url;this.protocol=protocol;this.sent=[];this.closed=false;sockets.push(this);
   queueMicrotask(()=>{this.dispatchEvent(new Event('open'));onSocket?.(this,timers);if(autoClose)setImmediate(()=>this.close());});
  }
  send(value){this.sent.push(value);}
  message(value){this.dispatchEvent(new MessageEvent('message',{data:value}));}
  close(){if(this.closed)return;this.closed=true;this.dispatchEvent(new Event('close'));}
 }
 const options={perform,WebSocket:Socket,emit:value=>emitted.push(value),setTimeout:(callback,milliseconds)=>{const timer={callback,milliseconds,cleared:false};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cleared=true;}};
 return {calls,emitted,sockets,timers,project,options,run:mode=>inspectCookService(ENV,{...options,mode})};
}

test('only this repository main Actions environment and bounded token/account types can inspect',async()=>{
 for(const patch of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repository'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_SHA:'bad'},{CLOUDFLARE_ACCOUNT_ID:'../other'},{CLOUDFLARE_API_TOKEN:''},{CLOUDFLARE_API_TOKEN:{value:PRIVATE}},{CLOUDFLARE_API_TOKEN:'x'.repeat(300)}]){
  let requests=0;
  await assert.rejects(()=>inspectCookService({...ENV,...patch},{mode:'probe',perform:async()=>{requests++;throw Error(PRIVATE);}}),error=>['INSPECT_ENVIRONMENT','INSPECT_CREDENTIALS'].includes(error.code));
  assert.equal(requests,0);
 }
 assert.throws(()=>requireCookInspectEnvironment(ENV,'write'),{code:'INSPECT_MODE'});
});

test('public probes run and emit before Cloudflare metadata, never authenticate or request AI',async()=>{
 const h=fixture(),result=await h.run('probe');
 assert.deepEqual(result,{mode:'probe',matchingSha:true,probes:8});
 const publicCalls=h.calls.filter(call=>call.url.hostname!=='api.cloudflare.com');
 assert.equal(publicCalls.length,8);
 assert.deepEqual(new Set(publicCalls.map(call=>call.url.origin)),new Set(['https://basketboss.co.uk','https://www.basketboss.co.uk']));
 for(const {url,options}of publicCalls){
  assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.headers.Origin,'capacitor://localhost');
  assert.equal(Object.keys(options.headers).some(key=>key.toLowerCase()==='authorization'),false);
  assert.equal(url.search,'');assert.ok(['/api/tts','/api/cook-assistant'].includes(url.pathname));
  if(options.method==='POST'){assert.equal(url.pathname,'/api/cook-assistant');assert.equal(options.body,'{}');}
  else assert.ok(['GET','OPTIONS'].includes(options.method));
 }
 const apiCalls=h.calls.filter(call=>call.url.hostname==='api.cloudflare.com');
 assert.equal(apiCalls.length,2);assert.equal(apiCalls[0].options.method,'GET');assert.equal(apiCalls[0].emissions,8);
 assert.equal(apiCalls[0].options.headers.Authorization,'Bearer '+ENV.CLOUDFLARE_API_TOKEN);
 assert.equal(h.sockets.length,0);assert.equal(h.emitted.filter(value=>value.kind==='probe').length,8);
 assert.deepEqual(h.emitted.find(value=>value.kind==='configuration'),{kind:'configuration',matchingSha:true,canonicalProductionReady:true,configuration:{aiEnabled:true,ttsEnabled:true,providerSecretBound:true,billingDatabaseBound:true,ttsStorageBound:true,ttsCapsReady:true}});
 assert.deepEqual(h.emitted.at(-1),{kind:'schema',schemaInspectionAvailable:true,quotaSchemaReady:true});
 assert.equal(h.emitted.filter(value=>value.kind==='probe').every(value=>value.nativeCors),true);
 assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
});

test('redirects, non-JSON responses and untrusted public codes are reported without following or exposing them',async()=>{
 const h=fixture({publicResponse:(url,options)=>{
  if(url.hostname.startsWith('www.'))return new Response(PRIVATE,{status:301,headers:{Location:'https://attacker.invalid/'+PRIVATE,'Content-Type':'text/html; private='+PRIVATE}});
  return Response.json({code:PRIVATE,error:PRIVATE},{status:503,headers:{'Access-Control-Allow-Origin':'null','Access-Control-Allow-Credentials':'true'}});
 }});
 await h.run('probe');
 const probes=h.emitted.filter(value=>value.kind==='probe');
 assert.equal(probes.filter(value=>value.status===301&&value.contentType==='text/html').length,4);
 assert.equal(probes.every(value=>value.nativeCors===false&&value.code===null),true);
 assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
 assert.equal(h.calls.filter(call=>call.url.hostname==='attacker.invalid').length,0);
});

test('preflight requires the actual native request method and authorization header allowance',async()=>{
 const h=fixture({publicResponse:(_url,options)=>new Response(null,{status:options.method==='OPTIONS'?204:401,headers:{'Access-Control-Allow-Origin':'capacitor://localhost','Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'content-type'}})});
 await h.run('probe');
 const probes=h.emitted.filter(value=>value.kind==='probe');
 assert.equal(probes.filter(value=>value.method==='OPTIONS').every(value=>!value.nativeCors),true);
 assert.equal(probes.filter(value=>value.method!=='OPTIONS').every(value=>value.nativeCors),true);
});

test('fixed quota schema metadata reports only compatibility booleans and cannot block a tail',async()=>{
 for(const options of [{schemaColumns:['actor','action',PRIVATE]},{schemaFailure:true}]){
  const h=fixture(options);await h.run('tail');
  const schema=h.emitted.find(value=>value.kind==='schema');
  assert.equal(schema.quotaSchemaReady,false);assert.equal(schema.schemaInspectionAvailable,!options.schemaFailure);
  assert.equal(h.sockets.length,1);assert.equal(h.calls.at(-1).options.method,'DELETE');
  assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
 }
});

test('project identity and successful canonical production deployment are required, while older SHA is honestly reported',async()=>{
 for(const projectPatch of [{name:'other'},{production_branch:'feature'},{domains:['attacker.invalid']},{canonical_deployment:null},{canonical_deployment:{id:DEPLOYMENT,environment:'preview',latest_stage:{name:'deploy',status:'success'}}}]){
  const h=fixture({projectPatch});await assert.rejects(()=>h.run('tail'),error=>['INSPECT_PROJECT','INSPECT_DEPLOYMENT'].includes(error.code));
  assert.equal(h.calls.some(call=>call.options.method==='POST'&&call.url.hostname==='api.cloudflare.com'),false);
  assert.equal(h.emitted.filter(value=>value.kind==='probe').length,8,'even a metadata failure preserves HTTP evidence');
 }
 const h=fixture();h.project.canonical_deployment.deployment_trigger.metadata.commit_hash='c'.repeat(40);
 assert.equal((await h.run('probe')).matchingSha,false);assert.equal(h.emitted.find(value=>value.kind==='configuration').matchingSha,false);
});

test('tail sanitizer retains route/status/outcome and exact diagnostic categories, never raw request or errors',()=>{
 const event=trace();event.logs.push(
  {level:'warn',message:[diagnostic({private:PRIVATE}),diagnostic({stage:PRIVATE}),diagnostic({code:PRIVATE}),diagnostic({status:399}),PRIVATE]},
  {level:'debug',message:[diagnostic()]},{level:'warn',message:['BB_COOK_DIAGNOSTIC invalid '+PRIVATE]});
 assert.deepEqual(sanitizeCookTailEvent(event),{route:'/api/tts',status:502,outcome:'exception',originKind:'native',diagnostics:[{stage:'provider_request',code:'BB_COOK_PROVIDER_ACCESS',status:502}]});
 assert.doesNotMatch(JSON.stringify(sanitizeCookTailEvent(event)),new RegExp(PRIVATE));
 assert.equal(sanitizeCookTailEvent(trace({event:{request:{url:'https://basketboss.co.uk/api/receipt?'+PRIVATE}}})),null);
 assert.equal(sanitizeCookTailEvent(trace({event:{request:{url:PRIVATE}}})),null);
 assert.equal(sanitizeCookTailEvent(null),null);
 const unknown=trace({outcome:PRIVATE,event:{request:{url:'https://pages-alias.pages.dev/api/cook-assistant'},response:{status:600}}});
 assert.deepEqual(sanitizeCookTailEvent(unknown),{route:'/api/cook-assistant',status:null,outcome:'unknown',originKind:'missing',diagnostics:[{stage:'provider_request',code:'BB_COOK_PROVIDER_ACCESS',status:502}]});
});

test('originKind derives only fixed safe enums from actual case-insensitive request Origin',()=>{
 for(const [headers,expected]of [[{oRiGiN:'capacitor://localhost'},'native'],[{origin:'https://basketboss.co.uk'},'web'],[{Origin:'https://www.basketboss.co.uk'},'web'],[{Origin:'null'},'null'],[{},'missing'],[undefined,'missing'],[{Origin:PRIVATE},'other'],[{Origin:'capacitor://localhost',origin:PRIVATE},'other']]){
  const value=trace();value.event.request.headers=headers;assert.equal(sanitizeCookTailEvent(value).originKind,expected);
 }
});

test('tail uses trace-v1 and debug:false, emits bounded sanitized records, and always deletes its capability',async()=>{
 const h=fixture({onSocket:socket=>socket.message(JSON.stringify(trace()))});
 const result=await h.run('tail');
 assert.deepEqual(result,{mode:'tail',matchingSha:true,received:1,emitted:1,stopReason:'closed'});
 assert.equal(h.sockets[0].protocol,'trace-v1');assert.equal(h.sockets[0].binaryType,'arraybuffer');assert.deepEqual(h.sockets[0].sent,['{"debug":false}']);
 const apiCalls=h.calls.filter(call=>call.url.hostname==='api.cloudflare.com');
 assert.deepEqual(apiCalls.map(call=>call.options.method),['GET','POST','POST','DELETE']);
 assert.equal(apiCalls[2].options.body,'{"filters":[]}');assert.ok(apiCalls[2].url.pathname.endsWith('/deployments/'+DEPLOYMENT+'/tails'));
 assert.ok(apiCalls[3].url.pathname.endsWith('/tails/'+TAIL));assert.equal(apiCalls.every(call=>call.options.redirect==='manual'),true);
 assert.equal(h.timers[0].milliseconds,90000);assert.equal(h.timers[0].cleared,true);
 assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
 assert.equal(h.emitted.findIndex(value=>value.route==='/api/tts'&&value.originKind==='native')>h.emitted.findIndex(value=>value.kind==='tail'),true);
});

test('unsafe tail destinations are rejected without connecting and still deleted',async()=>{
 for(const url of ['https://tail.developers.workers.dev/'+PRIVATE,'wss://tail.developers.workers.dev.attacker.invalid/'+PRIVATE,'wss://attacker.workers.dev/'+PRIVATE,'wss://user:pass@tail.developers.workers.dev/'+PRIVATE,'wss://tail.developers.workers.dev:8443/'+PRIVATE,'wss://tail.developers.workers.dev/path#'+PRIVATE]){
  assert.throws(()=>validateCookTailURL(url),{code:'INSPECT_TAIL_URL'});
  const h=fixture({tailURL:url});await assert.rejects(()=>h.run('tail'),{code:'INSPECT_TAIL_URL'});
  assert.equal(h.sockets.length,0);assert.equal(h.calls.at(-1).options.method,'DELETE');assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
 }
});

test('connection failure still deletes tail and never propagates raw socket exceptions',async()=>{
 const h=fixture({socketFailure:true});await assert.rejects(()=>h.run('tail'),{code:'INSPECT_TAIL_SOCKET'});
 assert.equal(h.calls.at(-1).options.method,'DELETE');assert.equal(h.timers[0].cleared,true);
 const failedDelete=fixture({deleteFailure:true});await assert.rejects(()=>failedDelete.run('tail'),{code:'INSPECT_TAIL_CLEANUP'});
});

test('Cloudflare rejection preserves fixed operation, HTTP status and numeric codes without messages or credentials',async()=>{
 const h=fixture({apiResponse:(url,options)=>{
  if(options.method==='POST'&&url.pathname.endsWith('/tails'))return Response.json({success:false,errors:[
   {code:10000,message:PRIVATE,documentation_url:'https://private.invalid/'+PRIVATE,source:{pointer:PRIVATE}},
   {code:10013,message:PRIVATE},{code:10000,message:PRIVATE},{code:PRIVATE,message:PRIVATE},{code:'10001',message:PRIVATE},
   {code:-1,message:PRIVATE},{code:999999999,message:PRIVATE}
  ],messages:[{code:1234,message:PRIVATE}],result:{url:'wss://private.invalid/'+PRIVATE}},{status:403});
 }});
 let failure;
 try{await h.run('tail');assert.fail('tail creation must fail');}catch(error){failure=cookInspectionFailure(error);}
 assert.deepEqual(failure,{kind:'failure',code:'INSPECT_API',operation:'tail_create',status:403,cloudflareCodes:[10000,10013]});
 assert.doesNotMatch(JSON.stringify(failure),new RegExp(PRIVATE));
 assert.equal(h.sockets.length,0);assert.equal(h.calls.at(-1).options.method,'POST');
 assert.equal(h.emitted.filter(value=>value.kind==='probe').length,8,'HTTP evidence survives a tail permission failure');
});

test('non-JSON and network API failures retain only response metadata, and tail cleanup retains its own operation',async()=>{
 for(const [response,expectedStatus]of [[()=>new Response(PRIVATE,{status:502}),502],[()=>{throw Error(PRIVATE);},null]]){
  const h=fixture({apiResponse:(url,options)=>options.method==='POST'&&url.pathname.endsWith('/tails')?response():undefined});
  await assert.rejects(()=>h.run('tail'),error=>{
   assert.deepEqual(cookInspectionFailure(error),{kind:'failure',code:'INSPECT_API',operation:'tail_create',status:expectedStatus,cloudflareCodes:[]});
   assert.doesNotMatch(error.message,new RegExp(PRIVATE));return true;
  });
 }
 const h=fixture({apiResponse:(_url,options)=>options.method==='DELETE'?Response.json({success:false,errors:[{code:10000,message:PRIVATE}]},{status:403}):undefined});
 await assert.rejects(()=>h.run('tail'),error=>{
  assert.deepEqual(cookInspectionFailure(error),{kind:'failure',code:'INSPECT_TAIL_CLEANUP',operation:'tail_delete',status:403,cloudflareCodes:[10000]});return true;
 });
});

test('failure renderer rejects arbitrary operation/exception fields and caps numeric Cloudflare codes',()=>{
 const error={code:'INSPECT_API',operation:'tail_create',status:403,cloudflareCodes:Array.from({length:20},(_,index)=>1000+index),message:PRIVATE,stack:PRIVATE,url:PRIVATE};
 assert.deepEqual(cookInspectionFailure(error),{kind:'failure',code:'INSPECT_API',operation:'tail_create',status:403,cloudflareCodes:[1000,1001,1002,1003,1004,1005,1006,1007]});
 assert.deepEqual(cookInspectionFailure({...error,operation:PRIVATE}),{kind:'failure',code:'INSPECT_API'});
 assert.deepEqual(cookInspectionFailure(Error(PRIVATE)),{kind:'failure',code:'INSPECT_API'});
 assert.doesNotMatch(JSON.stringify(cookInspectionFailure(error)),new RegExp(PRIVATE));
});

test('ninety-second deadline and fifty-frame cap cannot be overridden by caller options',async()=>{
 const timed=fixture({autoClose:false,onSocket:(_socket,timers)=>queueMicrotask(()=>timers[0].callback())});
 assert.equal((await timed.run('tail')).stopReason,'duration');assert.equal(timed.sockets[0].closed,true);
 const capped=fixture({autoClose:false,onSocket:socket=>{for(let index=0;index<70;index++)socket.message(JSON.stringify(trace()));}});
 const result=await capped.run('tail');assert.equal(result.stopReason,'events');assert.equal(result.received,50);assert.equal(result.emitted,50);assert.equal(capped.calls.at(-1).options.method,'DELETE');
 assert.deepEqual(COOK_INSPECT_LIMITS,{durationMs:90000,eventBytes:1048576,events:50});assert.equal(Object.isFrozen(COOK_INSPECT_LIMITS),true);
});

test('oversized UTF-8 and binary frames close immediately, while malformed bounded events expose nothing',async()=>{
 for(const data of ['é'.repeat(524289),new ArrayBuffer(COOK_INSPECT_LIMITS.eventBytes+1)]){
  const h=fixture({autoClose:false,onSocket:socket=>socket.message(data)});
  const result=await h.run('tail');assert.equal(result.stopReason,'oversize');assert.equal(result.emitted,0);assert.equal(h.calls.at(-1).options.method,'DELETE');
 }
 const h=fixture({onSocket:socket=>{socket.message(PRIVATE);socket.message(new TextEncoder().encode(JSON.stringify(trace())).buffer);}});
 const result=await h.run('tail');assert.equal(result.received,2);assert.equal(result.emitted,1);assert.doesNotMatch(JSON.stringify(h.emitted),new RegExp(PRIVATE));
});
