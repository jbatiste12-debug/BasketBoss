import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const HOUSE=fs.readFileSync('functions/api/household/index.js','utf8');
const MIDDLE=fs.readFileSync('functions/api/_middleware.js','utf8');
const SEAT=fs.readFileSync('bb-server-lib/bb-premium-seat.js','utf8');
const SQL=fs.readFileSync('sql/basketboss_household_production_20261029.sql','utf8');
const ORIGIN='https://basketboss.co.uk';
const LIVE='https://kbhyosxuvlcazyzzinqv.supabase.co';
const USER='11111111-1111-4111-8111-111111111111';
const OWNER='22222222-2222-4222-8222-222222222222';
const SID='33333333-3333-4333-8333-333333333333';
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json'}});
const lib={json,authenticatedUser:async()=>({id:USER,email:'partner@example.com'}),isLive:e=>e.BB_BILLING_MODE==='live'&&e.BB_BILLING_ENABLED==='true',expectedPrice:(e,p)=>p==='founder'?'pri_test_founder':p==='standard'?'pri_test_standard':null,entitlementForStatus:s=>s==='active'||s==='trialing',requireSameOrigin:req=>req.headers.get('Origin')===new URL(req.url).origin};
const env=(extra={})=>({CF_PAGES_BRANCH:'main',BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',SUPABASE_URL:LIVE,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_abcdefghijklmnopqrstuvwxyz',SUPABASE_SECRET_KEY:'sb_secret_abcdefghijklmnopqrstuvwxyz123456789',BILLING_DB:{prepare:()=>({bind:()=>({first:async()=>({status:'active',price_id:'pri_test_founder',plan:'founder'})})})},...extra});
const jwt=({sub=USER,session_id=SID,exp=Math.floor(Date.now()/1000)+1800}={})=>'header.'+Buffer.from(JSON.stringify({sub,session_id,exp})).toString('base64url')+'.signature';
const req=(path='/api/household?mode=status',method='GET',body,origin=ORIGIN)=>new Request(ORIGIN+path,{method,headers:{Authorization:'Bearer '+jwt(),...(method==='POST'?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
const moduleFrom=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
// Tests call the exact production module logic but replace only its imports.
const brake=/const RELEASE_ARMED=(?:true|false);/;
assert.match(SEAT,brake);assert.match(HOUSE,brake);
// Test the shipped release unchanged; create a separate hard-OFF fixture solely
// to verify that rolling the code brake back cannot be bypassed by env flags.
const seat=await import(moduleFrom(SEAT));
const seatUnarmed=await import(moduleFrom(SEAT.replace(brake,'const RELEASE_ARMED=false;')));
globalThis.__bbTestLib=lib;
globalThis.__bbTestSeat=seat;
const houseCode=HOUSE.replace(/import \{[^\n]+\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/bb-billing\.js';/,"const {json,authenticatedUser,isLive,expectedPrice,entitlementForStatus,requireSameOrigin}=globalThis.__bbTestLib;").replace(/import \{[^\n]+\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/bb-premium-seat\.js';/,"const {isNewestVerifiedSession}=globalThis.__bbTestSeat;");
const middleCode=MIDDLE.replace(/import \{[^\n]+\} from '\.\.\/\.\.\/bb-server-lib\/bb-billing\.js';/,"const {authenticatedUser,json,isLive}=globalThis.__bbTestLib;").replace(/import \{[^\n]+\} from '\.\.\/\.\.\/bb-server-lib\/bb-premium-seat\.js';/,"const {seatGateEnabled,isNewestVerifiedSession}=globalThis.__bbTestSeat;");
assert.ok(!houseCode.includes(" from '../../../bb-server-lib/"),'backend import fixture did not resolve');
assert.ok(!middleCode.includes(" from '../../bb-server-lib/"),'middleware import fixture did not resolve');
const unarmedCode=houseCode.replace(brake,'const RELEASE_ARMED=false;');
const unarmedHouse=await import(moduleFrom(unarmedCode));
const house=await import(moduleFrom(houseCode));
const middleware=await import(moduleFrom(middleCode));
let fetchCalls=[];
function mockFetch({current=true,household=null,invite=null,rows=[],sessionStatus=200}={}){
 fetchCalls=[];
 globalThis.fetch=async(url,opts={})=>{
  fetchCalls.push({url:String(url),method:opts.method||'GET',body:opts.body||null});
  const u=String(url);
  if(u.includes('rpc/bb_hh_service_session_ok'))return json(current,sessionStatus);
  if(u.includes('bb_households?')){
   if(u.includes('owner_user_id'))return json([]);
   if(u.includes('partner_user_id'))return json(household?[household]:[]);
  }
  if(u.includes('bb_household_invites?'))return json(invite?[invite]:[]);
  if(u.includes('bb_household_entries?'))return json(rows);
  if(u.includes('rpc/bb_hh_service_invite'))return json({household_id:'hh',status:'pending'});
  if(u.includes('rpc/bb_hh_service_accept'))return json({household_id:'hh',status:'accepted'});
  return json([]);
 };
}

test('released paid-device gate requires an explicit runtime flag',()=>{
 assert.equal(seat.seatGateEnabled(env()),true);
 for(const value of [undefined,'false',false,'TRUE','1'])
  assert.equal(seat.seatGateEnabled(env({BB_PREMIUM_SINGLE_SESSION_ENABLED:value})),false);
});
test('hard-OFF rollback blocks household reads even with every live flag enabled',async()=>{
 assert.equal(seatUnarmed.seatGateEnabled(env()),false);
 mockFetch();const r=await unarmedHouse.onRequestGet({request:req(),env:env()});
 assert.equal((await r.json()).configured,false);
 assert.equal(fetchCalls.length,0);
});
test('production flag OFF is fail-closed, no fetch and no local sync',async()=>{
 for(const flag of ['BB_PARTNER_SHARING_ENABLED','BB_PARTNER_PRODUCTION_READY','BB_PREMIUM_SINGLE_SESSION_ENABLED']){
  for(const value of ['false',undefined]){
   mockFetch();const r=await house.onRequestGet({request:req(),env:env({[flag]:value})});
   assert.equal(r.status,200);assert.equal((await r.json()).configured,false);assert.equal(fetchCalls.length,0);
  }
 }
});
test('QA tenant never enables production sharing',async()=>{
 mockFetch();const r=await house.onRequestGet({request:req(),env:env({SUPABASE_URL:'https://cbucbdvwgmkgmsajtbfe.supabase.co'})});
 assert.equal((await r.json()).configured,false);assert.equal(fetchCalls.length,0);
});
test('sandbox billing and missing live webhook cannot turn on sharing',async()=>{
 for(const overrides of [{BB_BILLING_MODE:'sandbox'},{BB_LIVE_WEBHOOK_ENABLED:'false'},{BB_PARTNER_PRODUCTION_READY:'false'}]){
  mockFetch();const r=await house.onRequestGet({request:req(),env:env(overrides)});
  assert.equal((await r.json()).configured,false);assert.equal(fetchCalls.length,0);
 }
});
test('missing service credentials, database or trusted production host cannot enable sharing',async()=>{
 for(const overrides of [{SUPABASE_SECRET_KEY:''},{SUPABASE_PUBLISHABLE_KEY:''},{BILLING_DB:null},{CF_PAGES_BRANCH:'preview'}]){
  mockFetch();const r=await house.onRequestGet({request:req(),env:env(overrides)});
  assert.equal((await r.json()).configured,false);assert.equal(fetchCalls.length,0);
 }
 for(const url of ['https://untrusted.example/api/household','http://basketboss.co.uk/api/household']){
  mockFetch();const r=await house.onRequestGet({request:new Request(url),env:env()});
  assert.equal((await r.json()).configured,false);assert.equal(fetchCalls.length,0);
 }
});
test('server-side current-session check validates user and expiry claims',()=>{
 assert.equal(seat.sessionFromVerifiedBearer(req(),{id:USER}),SID);
 assert.equal(seat.sessionFromVerifiedBearer(new Request(ORIGIN,{headers:{Authorization:'Bearer '+jwt({sub:OWNER})}}),{id:USER}),null);
 assert.equal(seat.sessionFromVerifiedBearer(new Request(ORIGIN,{headers:{Authorization:'Bearer '+jwt({exp:1})}}),{id:USER}),null);
});
test('second or revoked device denied by service-only session RPC',async()=>{
 mockFetch({current:false});const r=await house.onRequestGet({request:req(),env:env()});
 assert.equal(r.status,403);assert.match((await r.json()).error,/newer session/i);
 assert.ok(fetchCalls.some(x=>x.url.includes('rpc/bb_hh_service_session_ok')));
});
test('session database outage denies, never grants access',async()=>{
 mockFetch({sessionStatus:503});const r=await house.onRequestGet({request:req(),env:env()});
 assert.equal(r.status,503);
});
test('Premium status derives exclusively from server D1 record and valid price',async()=>{
 mockFetch();let r=await house.onRequestGet({request:req(),env:env()});
 assert.equal((await r.json()).premium,true);
 for(const row of [null,{status:'canceled',price_id:'pri_test_founder',plan:'founder'},{status:'active',price_id:'forged',plan:'founder'}]){
  mockFetch();r=await house.onRequestGet({request:req(),env:env({BILLING_DB:{prepare:()=>({bind:()=>({first:async()=>row})})}})});
  assert.equal((await r.json()).premium,false);
 }
});
test('Free user may not invite an arbitrary partner email',async()=>{
 mockFetch();const e=env({BILLING_DB:{prepare:()=>({bind:()=>({first:async()=>null})})}});
 const r=await house.onRequestPost({request:req('/api/household','POST',{action:'invite',email:'test@example.com'}),env:e});
 assert.equal(r.status,403);assert.ok(!fetchCalls.some(x=>x.url.includes('rpc/bb_hh_service_invite')));
});
test('Paid user can invite only through same-origin and server-side RPC',async()=>{
 mockFetch();let r=await house.onRequestPost({request:req('/api/household','POST',{action:'invite',email:'wife@example.com'}),env:env()});
 assert.equal(r.status,200);assert.equal((await r.json()).email_sent,false);
 assert.equal(fetchCalls.filter(x=>x.url.includes('rpc/bb_hh_service_invite')).length,1);
 mockFetch();r=await house.onRequestPost({request:req('/api/household','POST',{action:'invite',email:'wife@example.com'},'https://evil.example'),env:env()});
 assert.equal(r.status,403);assert.equal(fetchCalls.filter(x=>x.url.includes('rpc/bb_hh_service_invite')).length,0);
});
test('Partner receives shared entitlement only if owner has current Premium',async()=>{
 mockFetch({household:{id:'hh',owner_user_id:OWNER,partner_user_id:USER,invite_status:'accepted'}});
 let r=await house.onRequestGet({request:req(),env:env()});
 let result=await r.json();assert.equal(result.role,'partner');assert.equal(result.premium,true);
 mockFetch({household:{id:'hh',owner_user_id:OWNER,partner_user_id:USER,invite_status:'accepted'}});
 const cancelEnv=env({BILLING_DB:{prepare:()=>({bind:()=>({first:async()=>({status:'canceled',price_id:'pri_test_founder',plan:'founder'})})})}});
 r=await house.onRequestGet({request:req(),env:cancelEnv});result=await r.json();assert.equal(result.premium,false);
});
test('Invalid sections and unsafely large patches are rejected before writes',async()=>{
 for(const patch of [{action:'patch',section:'billing',key:'abc',value:{x:1},expected:0},{action:'patch',section:'planned_day',key:'Mon',value:{recipeId:'abc'},expected:-1}]){
  mockFetch({household:{id:'hh',owner_user_id:OWNER,partner_user_id:USER,invite_status:'accepted'}});
  const r=await house.onRequestPost({request:req('/api/household','POST',patch),env:env()});
  assert.equal(r.status,400);assert.equal(fetchCalls.filter(x=>x.url.includes('rpc/bb_hh_service_patch')).length,0);
 }
});
test('Paid middleware is opt-in and ignores public routes and webhooks',async()=>{
 mockFetch();let hit=0;
 for(const path of ['/api/paddle/webhook','/api/subscription/checkout','/','/api/recipes/premium']){
  const r=await middleware.onRequest({request:req(path),env:env({BB_PREMIUM_SINGLE_SESSION_ENABLED:'false'}),next:()=>{hit++;return json({ok:true})}});
  assert.equal(r.status,200);
 }
 assert.equal(hit,4);assert.equal(fetchCalls.length,0);
});
test('Premium middleware rejects an old session for paid recipes and AI',async()=>{
 mockFetch({current:false});let hit=0;
 for(const path of ['/api/recipes/premium','/api/bb173/scan','/api/bb173/generate','/api/household']){
  const r=await middleware.onRequest({request:req(path),env:env(),next:()=>{hit++;return json({ok:true})}});
  assert.equal(r.status,403);
 }
 assert.equal(hit,0);
});
test('Premium middleware allows the latest valid session and does not touch Paddle webhook',async()=>{
 mockFetch({current:true});let hit=0;
 for(const path of ['/api/recipes/premium','/api/bb173/generate','/api/subscription/status','/api/subscription/portal','/api/paddle/webhook']){
  const r=await middleware.onRequest({request:req(path),env:env(),next:()=>{hit++;return json({ok:true})}});
  assert.equal(r.status,200);
 }
 assert.equal(hit,5);
 assert.equal(fetchCalls.filter(x=>x.url.includes('rpc/bb_hh_service_session_ok')).length,2);
});
test('Free account status and subscription portal remain reachable from older valid login',async()=>{
 mockFetch({current:false});let hit=0;
 for(const path of ['/api/subscription/status','/api/subscription/portal']){
  const r=await middleware.onRequest({request:req(path),env:env(),next:()=>{hit++;return json({ok:true})}});
  assert.equal(r.status,200);
 }
 assert.equal(hit,2);assert.equal(fetchCalls.length,0);
 mockFetch({sessionStatus:503});
 for(const path of ['/api/subscription/status','/api/subscription/portal']){
  const r=await middleware.onRequest({request:req(path),env:env(),next:()=>json({ok:true})});
  assert.equal(r.status,200);
 }
 assert.equal(fetchCalls.length,0);
});
test('Production database migration is least-privilege and leaves original plans alone',()=>{
 for(const fragment of ['BEGIN;','COMMIT;','CREATE TABLE IF NOT EXISTS public.bb_households','CREATE TABLE IF NOT EXISTS public.bb_household_entries','UNIQUE REFERENCES auth.users','ENABLE ROW LEVEL SECURITY','REVOKE ALL ON public.bb_households','REVOKE ALL ON FUNCTION public.bb_hh_service_session_ok','TO service_role','SELECT 1 FROM auth.sessions','account_already_owns_household'])assert.ok(SQL.includes(fragment),`missing ${fragment}`);
 assert.doesNotMatch(SQL,/\b(?:TRUNCATE|DELETE\s+FROM|DROP\s+TABLE|UPDATE\s+(?:auth\.users|public\.basketboss_data))\b/i);
 assert.doesNotMatch(HOUSE,/BB_OWNER_USER_ID|BB_PARTNER_QA_MODE|cbucbdvwgmkgmsajtbfe|localStorage\.setItem/);
 assert.doesNotMatch(MIDDLE,/BB_OWNER_USER_ID|BB_PARTNER_QA_MODE|cbucbdvwgmkgmsajtbfe/);
});
