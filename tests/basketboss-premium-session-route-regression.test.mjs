import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const ROOT=process.env.BB_RC_TEST_ROOT||process.cwd();
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const middlewareCode=read('functions/api/_middleware.js');
const input=middlewareCode
 .replace("import {authenticatedUser,json,isLive} from '../../bb-server-lib/bb-billing.js';",
   'const {authenticatedUser,json,isLive}=globalThis.__bbBoundaryBilling;')
 .replace("import {seatGateEnabled,isNewestVerifiedSession} from '../../bb-server-lib/bb-premium-seat.js';",
   'const {seatGateEnabled,isNewestVerifiedSession}=globalThis.__bbBoundarySeat;');
assert.ok(!input.includes("from '../../bb-server-lib/"),'middleware imports did not resolve');
let authCalls=0,seatCalls=0,accepted=true,sessionOk=false,throwSession=false;
globalThis.__bbBoundaryBilling={
 authenticatedUser:async(req)=>{authCalls++;return accepted?{id:'11111111-1111-4111-8111-111111111111',email:'member@example.com'}:null},
 json:(obj,status=200)=>new Response(JSON.stringify(obj),{status}),
 isLive:env=>env.BB_BILLING_MODE==='live'&&env.BB_BILLING_ENABLED==='true'
};
globalThis.__bbBoundarySeat={
 seatGateEnabled:env=>env.BB_PREMIUM_SINGLE_SESSION_ENABLED==='true',
 isNewestVerifiedSession:async()=>{seatCalls++;if(throwSession)throw Error('session rpc down');return sessionOk;}
};
const moduleFrom=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const mw=await import(moduleFrom(input));
const base={BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',CF_PAGES_BRANCH:'main',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co'};
const request=(path,host='https://basketboss.co.uk')=>new Request(host+path,{headers:{Authorization:'Bearer test-only'}});
const invoke=async(path,override={},host)=>{
 let nextCalls=0;
 const response=await mw.onRequest({request:request(path,host),env:{...base,...override},next:()=>{nextCalls++;return new Response('NEXT',{status:200})}});
 return {response,nextCalls};
};
const reset=()=>{authCalls=0;seatCalls=0;accepted=true;sessionOk=false;throwSession=false;};

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
 reset();for(const p of ['/api/recipes/premium','/api/bb173/generate','/api/bb173/scan','/api/household']){
  const r=await invoke(p);assert.equal(r.response.status,403,p);assert.equal(r.nextCalls,0,p);
 }
 assert.equal(seatCalls,4);assert.equal(authCalls,4);
});
test('Paid API requests fail closed on a session RPC outage',async()=>{
 reset();throwSession=true;
 const r=await invoke('/api/recipes/premium');
 assert.equal(r.response.status,503);assert.equal(r.nextCalls,0);
});
test('Paid routes allow only newest verified session',async()=>{
 reset();sessionOk=true;
 for(const p of ['/api/recipes/premium','/api/bb173/scan','/api/household']){
  const r=await invoke(p);assert.equal(r.response.status,200);assert.equal(r.nextCalls,1);
 }
 assert.equal(seatCalls,3);
});
test('Paid endpoints deny missing authenticated identity',async()=>{
 reset();accepted=false;
 const r=await invoke('/api/household');assert.equal(r.response.status,401);assert.equal(r.nextCalls,0);
 assert.equal(seatCalls,0);
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
