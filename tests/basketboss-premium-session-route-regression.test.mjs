import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as requestOrigin from '../bb-server-lib/bb-request-origin.js';
import * as cookServiceError from '../bb-server-lib/bb-cook-service-error.js';
import {testFlightBetaEnabled} from '../bb-server-lib/bb-testflight-beta.js';
const ROOT=process.env.BB_RC_TEST_ROOT||process.cwd();
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const middlewareCode=read('functions/api/_middleware.js');
const input=middlewareCode
 .replace("import {authenticatedUser,json,isLive} from '../../bb-server-lib/bb-billing.js';",
   'const {authenticatedUser,json,isLive}=globalThis.__bbBoundaryBilling;')
 .replace("import {livePaidBillingEnabled,testFlightBetaEnabled} from '../../bb-server-lib/bb-paid-access.js';",
   "const testFlightBetaEnabled=globalThis.__bbBoundaryBeta;const livePaidBillingEnabled=env=>globalThis.__bbBoundaryBilling.isLive(env)||(env.APPLE_BILLING_ENABLED==='true'&&env.APPLE_ENVIRONMENT==='Production');")
 .replace("import {seatGateEnabled,isNewestVerifiedSession} from '../../bb-server-lib/bb-premium-seat.js';",
   'const {seatGateEnabled,isNewestVerifiedSession}=globalThis.__bbBoundarySeat;')
 .replace("import {nativeCorsResponse,nativePreflightResponse} from '../../bb-server-lib/bb-request-origin.js';",
   'const {nativeCorsResponse,nativePreflightResponse}=globalThis.__bbBoundaryOrigin;')
 .replace("import {ensureDeletionSchema,isAccountDeleting} from '../../bb-server-lib/bb-account-deletion.js';",
   'const {ensureDeletionSchema,isAccountDeleting}=globalThis.__bbBoundaryDeletion;')
 .replace("import {logCookDiagnostic} from '../../bb-server-lib/bb-cook-service-error.js';",
   'const {logCookDiagnostic}=globalThis.__bbBoundaryCookDiagnostic;');
assert.ok(!input.includes("from '../../bb-server-lib/"),'middleware imports did not resolve');
let authCalls=0,seatCalls=0,accepted=true,sessionOk=false,throwSession=false,throwAccount=false,accountPending=false;
globalThis.__bbBoundaryOrigin=requestOrigin;
globalThis.__bbBoundaryBeta=testFlightBetaEnabled;
globalThis.__bbBoundaryCookDiagnostic=cookServiceError;
globalThis.__bbBoundaryDeletion={
 ensureDeletionSchema:async()=>{if(throwAccount)throw Error('private-database-detail member@example.com 11111111-1111-4111-8111-111111111111');},
 isAccountDeleting:async()=>accountPending
};
globalThis.__bbBoundaryBilling={
 authenticatedUser:async(req)=>{authCalls++;return accepted?{id:'11111111-1111-4111-8111-111111111111',email:'member@example.com'}:null},
 json:(obj,status=200)=>new Response(JSON.stringify(obj),{status}),
 isLive:env=>env.BB_BILLING_MODE==='live'&&env.BB_BILLING_ENABLED==='true'
};
globalThis.__bbBoundarySeat={
 seatGateEnabled:env=>env.BB_PREMIUM_SINGLE_SESSION_ENABLED==='true',
 isNewestVerifiedSession:async()=>{seatCalls++;if(throwSession)throw Error('private-rpc-detail Bearer private-token member@example.com');return sessionOk;}
};
const moduleFrom=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const mw=await import(moduleFrom(input));
const base={BB_TESTFLIGHT_BETA_ENABLED:'false',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',CF_PAGES_BRANCH:'main',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co'};
const request=(path,host='https://basketboss.co.uk',headers={Authorization:'Bearer test-only'})=>new Request(host+path,{headers});
const invoke=async(path,override={},host,headers)=>{
 let nextCalls=0;
 const response=await mw.onRequest({request:request(path,host,headers),env:{...base,...override},next:()=>{nextCalls++;return new Response('NEXT',{status:200})}});
 return {response,nextCalls};
};
const reset=()=>{authCalls=0;seatCalls=0;accepted=true;sessionOk=false;throwSession=false;throwAccount=false;accountPending=false;};

test('Free accounts keep subscription status access on an older login',async()=>{
 reset();const {response,nextCalls}=await invoke('/api/subscription/status');
 assert.equal(response.status,200);assert.equal(nextCalls,1);
 assert.equal(authCalls,0);assert.equal(seatCalls,0);
 // Authentication is checked by the existing status route itself.
 const status=read('functions/api/subscription/status.js');
 assert.match(status,/authenticatedUser\(request,env\)/);
});
test('Paddle cancellation/portal remains accessible even with an older device',async()=>{
 reset();const {response,nextCalls}=await invoke('/api/subscription/portal');
 assert.equal(response.status,200);assert.equal(nextCalls,1);
 assert.equal(authCalls,0);assert.equal(seatCalls,0);
 const portal=read('functions/api/subscription/portal.js');
 assert.match(portal,/authenticatedUser\(request,env\)/);
 assert.match(portal,/WHERE user_id=\?/);
 assert.match(portal,/view_subscription/);
});
test('Subscription routes survive session RPC downtime but still authenticate',async()=>{
 reset();throwSession=true;
 for(const path of ['/api/subscription/status','/api/subscription/portal']){
  const r=await invoke(path);assert.equal(r.response.status,200);assert.equal(r.nextCalls,1);
 }
 assert.equal(authCalls,0);assert.equal(seatCalls,0);
});
test('Paid recipes, AI, and household reject an older session',async()=>{
 reset();for(const p of ['/api/recipes/premium','/api/bb173/generate','/api/bb173/scan','/api/bb173/meal-image','/api/household']){
  const r=await invoke(p);assert.equal(r.response.status,403,p);assert.equal(r.nextCalls,0,p);
 }
 assert.equal(seatCalls,5);assert.equal(authCalls,5);
});
test('Paid API requests fail closed on a session RPC outage',async()=>{
 reset();throwSession=true;
 const r=await invoke('/api/recipes/premium');
 assert.equal(r.response.status,503);assert.equal(r.nextCalls,0);
});
test('Beta activation retains the current-session boundary independently of paid billing configuration',async()=>{
 reset();const beta={BB_TESTFLIGHT_BETA_ENABLED:'true',BB_BILLING_ENABLED:'false',APPLE_BILLING_ENABLED:'false'};
 let result=await invoke('/api/apple/testflight-beta',beta);assert.equal(result.response.status,403);assert.equal(result.nextCalls,0);
 sessionOk=true;result=await invoke('/api/apple/testflight-beta',beta);assert.equal(result.response.status,200);assert.equal(result.nextCalls,1);
});
test('Paid routes allow only newest verified session',async()=>{
 reset();sessionOk=true;
 for(const p of ['/api/recipes/premium','/api/bb173/scan','/api/bb173/meal-image','/api/household']){
  const r=await invoke(p);assert.equal(r.response.status,200);assert.equal(r.nextCalls,1);
 }
 assert.equal(seatCalls,4);
});
test('Paid endpoints deny missing authenticated identity',async()=>{
 reset();accepted=false;
 const r=await invoke('/api/household');assert.equal(r.response.status,401);assert.equal(r.nextCalls,0);
 assert.equal(seatCalls,0);
});
test('Apple-only production billing retains the newest-session boundary and Sandbox cannot enable it',async()=>{
 reset();const apple={BB_BILLING_ENABLED:'false',APPLE_BILLING_ENABLED:'true',APPLE_ENVIRONMENT:'Production'};
 let result=await invoke('/api/recipes/premium',apple);
 assert.equal(result.response.status,403);assert.equal(result.nextCalls,0);
 sessionOk=true;result=await invoke('/api/recipes/premium',apple);
 assert.equal(result.response.status,200);assert.equal(result.nextCalls,1);
 result=await invoke('/api/recipes/premium',{...apple,APPLE_ENVIRONMENT:'Sandbox'});
 assert.equal(result.response.status,503);assert.equal(result.nextCalls,0);
});
test('Wrong Supabase tenant and QA preview cannot use paid session middleware',async()=>{
 reset();let r=await invoke('/api/recipes/premium',{SUPABASE_URL:'https://cbucbdvwgmkgmsajtbfe.supabase.co'});
 assert.equal(r.response.status,503);assert.equal(r.nextCalls,0);
 r=await invoke('/api/recipes/premium',{},'https://basketboss-partner-qa.pages.dev');
 assert.equal(r.response.status,503);assert.equal(r.nextCalls,0);
 assert.equal(seatCalls,0);
});
test('Explicit OFF brake bypasses session middleware for all existing routes',async()=>{
 reset();for(const p of ['/api/recipes/premium','/api/bb173/generate','/api/subscription/status','/api/subscription/portal','/api/household']){
  const r=await invoke(p,{BB_PREMIUM_SINGLE_SESSION_ENABLED:'false'});
  assert.equal(r.response.status,200);assert.equal(r.nextCalls,1);
 }
 assert.equal(seatCalls,0);
});
test('Webhooks and checkout remain untouched',async()=>{
 reset();for(const p of ['/api/paddle/webhook','/api/subscription/checkout']){
  const r=await invoke(p);assert.equal(r.response.status,200);assert.equal(r.nextCalls,1);
 }
 assert.equal(seatCalls,0);
});

async function captureDiagnostics(run){
 const calls=[],methods=['warn','error','log'],saved=Object.fromEntries(methods.map(method=>[method,console[method]]));
 for(const method of methods)console[method]=(...args)=>calls.push({method,args});
 try{return {result:await run(),calls};}
 finally{for(const method of methods)console[method]=saved[method];}
}
const boundaryCases=[
 {code:'BB_COOK_SESSION_MISCONFIGURED',stage:'session_config',status:503,
  error:'Premium session verification misconfigured',override:{SUPABASE_URL:'https://wrong-tenant.example'}},
 {code:'BB_COOK_SESSION_REPLACED',stage:'session_verification',status:403,
  error:'This Premium account has a newer sign-in on another device. Sign in here again to continue.'},
 {code:'BB_COOK_SESSION_UNAVAILABLE',stage:'session_verification',status:503,
  error:'Premium device verification temporarily unavailable',set:()=>{throwSession=true;}},
 {code:'BB_COOK_ACCOUNT_UNAVAILABLE',stage:'authorization',status:503,
  error:'Account state verification temporarily unavailable',set:()=>{throwAccount=true;}},
 {code:'BB_COOK_ACCOUNT_PENDING',stage:'authorization',status:409,
  error:'Account deletion is in progress. Retry Delete Account & Data to finish.',set:()=>{accountPending=true;},extra:{ok:false,pending:true}},
 {code:'BB_COOK_AUTH_REQUIRED',stage:'authorization',status:401,
  error:'Sign in with a confirmed email',set:()=>{accepted=false;}}
];
for(const scenario of boundaryCases){
 test(`Chef Boss middleware reports only fixed ${scenario.code} diagnostics`,async()=>{
  for(const route of ['/api/tts','/api/cook-assistant/']){
   reset();scenario.set?.();
   const {result:{response,nextCalls},calls}=await captureDiagnostics(()=>invoke(route,{BILLING_DB:{},...scenario.override},undefined,{Authorization:'Bearer private-token'}));
   assert.equal(response.status,scenario.status);assert.equal(nextCalls,0);
   assert.deepEqual(await response.json(),{...scenario.extra,error:scenario.error,code:scenario.code});
   assert.equal(calls.length,1);assert.equal(calls[0].method,'warn');assert.equal(calls[0].args.length,1);
   assert.equal(typeof calls[0].args[0],'string');assert.ok(calls[0].args[0].startsWith('BB_COOK_DIAGNOSTIC '));
   assert.deepEqual(JSON.parse(calls[0].args[0].slice('BB_COOK_DIAGNOSTIC '.length)),{stage:scenario.stage,code:scenario.code,status:scenario.status});
   assert.doesNotMatch(calls[0].args[0],/private-token|private-rpc-detail|private-database-detail|member@example\.com|11111111-1111-4111-8111-111111111111/);
  }
 });
}
test('Chef Boss unauthenticated and malformed Bearer probes return the fixed code without logging',async()=>{
 for(const route of ['/api/tts','/api/cook-assistant']){
  for(const headers of [{},{Authorization:'Basic private-token'},{Authorization:'Bearer malformed token'}]){
   reset();accepted=false;
   const {result:{response,nextCalls},calls}=await captureDiagnostics(()=>invoke(route,{},undefined,headers));
   assert.equal(response.status,401);assert.equal(nextCalls,0);
   assert.deepEqual(await response.json(),{error:'Sign in with a confirmed email',code:'BB_COOK_AUTH_REQUIRED'});
   assert.deepEqual(calls,[]);
  }
 }
});
test('Other middleware routes retain their existing failure payloads without Chef Boss logs',async()=>{
 for(const scenario of boundaryCases){
  reset();scenario.set?.();
  const {result:{response,nextCalls},calls}=await captureDiagnostics(()=>invoke('/api/recipes/premium',{BILLING_DB:{},...scenario.override}));
  assert.equal(response.status,scenario.status);assert.equal(nextCalls,0);
  assert.deepEqual(await response.json(),{...scenario.extra,error:scenario.error});assert.deepEqual(calls,[]);
 }
});
test('Successful Chef Boss middleware requests preserve the response and emit no diagnostics',async()=>{
 reset();sessionOk=true;
 for(const route of ['/api/tts','/api/cook-assistant']){
  const {result:{response,nextCalls},calls}=await captureDiagnostics(()=>invoke(route,{BILLING_DB:{}}));
  assert.equal(response.status,200);assert.equal(nextCalls,1);assert.equal(await response.text(),'NEXT');assert.deepEqual(calls,[]);
 }
});
