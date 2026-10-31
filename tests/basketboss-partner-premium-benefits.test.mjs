import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const ROOT=process.env.BB_RC_TEST_ROOT||path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const moduleFrom=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const OWNER='22222222-2222-4222-8222-222222222222',PARTNER='11111111-1111-4111-8111-111111111111';
const URL='https://basketboss.co.uk';
const LIVE='https://kbhyosxuvlcazyzzinqv.supabase.co',price=p=>'pri_'+p.repeat(26);
const lib=await import(moduleFrom(read('bb-server-lib/bb-billing.js')));
globalThis.__partnerTestBilling=lib;
let seatActive=true;
globalThis.__partnerTestSeat={seatGateEnabled:()=>seatActive};
const rawHelper=read('bb-server-lib/bb-household-premium.js');
const brake=/const PARTNER_PREMIUM_ARMED=(?:true|false);/;
assert.match(rawHelper,brake);
function helperLoaded(armed){
 let code=rawHelper.replace(
  "import {isLive,expectedPrice,entitlementForStatus} from './bb-billing.js';",
  "const {isLive,expectedPrice,entitlementForStatus}=globalThis.__partnerTestBilling;"
 ).replace("import {seatGateEnabled} from './bb-premium-seat.js';",
           "const {seatGateEnabled}=globalThis.__partnerTestSeat;");
 if(typeof armed==='boolean')code=code.replace(brake,'const PARTNER_PREMIUM_ARMED='+String(armed)+';');
 assert.ok(!code.includes("from './bb-billing.js'"));
 return import(moduleFrom(code));
}
const closed=await helperLoaded(false);
// Exercise the shipped production helper without rewriting its activation state.
const active=await helperLoaded();
globalThis.__partnerTestHelper=active;
function route(pathname,billingNames,handlerName){
 const names=billingNames.split(',');
 let source=read(pathname);
 const original=source.match(/^import \{[^\n]+\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/bb-billing\.js';/m);
 assert.ok(original,'billing import missing in '+pathname);
 source=source.replace(original[0],"const {"+names.join(',')+"}=globalThis.__partnerTestBilling;");
 const secure=/^import \{sharedHouseholdPremiumOwner\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/bb-household-premium\.js';/m;
 assert.match(source,secure);
 source=source.replace(secure,"const {sharedHouseholdPremiumOwner}=globalThis.__partnerTestHelper;");
 assert.ok(!source.includes("from '../../../bb-server-lib/"));
 return import(moduleFrom(source));
}
const rec=await route('functions/api/recipes/premium.js',
 'json,authenticatedUser,isBillingEnabled,isConfigured,expectedPrice,entitlementForStatus');
const status=await route('functions/api/subscription/status.js',
 'json,authenticatedUser,entitlementForStatus,isBillingEnabled,billingMode,expectedPrice,isConfigured');
const ai=await route('functions/api/bb173/[action].js',
 'authenticatedUser,isBillingEnabled,isConfigured,isLive,expectedPrice,paddleApi,digestHex');
let household=[],accounts=new Map(),lookups=[],fetchCalls=[],failMembership=false;
const goodRow={status:'active',plan:'founder',price_id:price('f')};
const env=(extra={})=>({
 BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',CF_PAGES_BRANCH:'main',
 BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',
 BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',
 BB_PREMIUM_AI_ENABLED:'true',BB_AI_GLOBAL_DAILY_CAP:'20',
 GEMINI_API_KEY:'local-test',TURNSTILE_SITE_KEY:'local-test',TURNSTILE_SECRET_KEY:'local-test',
 SUPABASE_URL:LIVE,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_abcdefghijklmnopqrstuvwxyz',
 SUPABASE_SECRET_KEY:'sb_secret_abcdefghijklmnopqrstuvwxyz123456789',
 PADDLE_LIVE_FOUNDER_PRICE_ID:price('f'),PADDLE_LIVE_STANDARD_PRICE_ID:price('s'),
 BILLING_DB:{
   prepare(sql){
     if(sql.includes('bb_private_premium_recipes'))return {
       all:async()=>({results:Array.from({length:221},(_,i)=>({
         recipe_json:JSON.stringify({id:'r'+i}),
         normalized_json:JSON.stringify({id:'r'+i})
       }))})};
     if(sql.includes('bb_paid_entitlements'))return {
       bind(id){lookups.push(id);return {first:async()=>accounts.get(id)||null};}
     };
     throw Error('Unexpected D1 query '+sql.slice(0,100));
   }
 },
 ...extra
});
const request=(who=PARTNER,p='/api/subscription/status',host=URL)=>new Request(host+p,{headers:{
  Authorization:'Bearer synthetic', 'X-Test-User':who
}});
const member=(id=PARTNER,email='partner@example.com')=>({id,email,email_confirmed_at:'2026-10-30T00:00:00Z'});
const accepted=(email='partner@example.com')=>({owner_user_id:OWNER,partner_user_id:PARTNER,partner_email:email,invite_status:'accepted'});
function reset(){
 household=[accepted()];accounts=new Map([[OWNER,goodRow]]);lookups=[];fetchCalls=[];failMembership=false;seatActive=true;
 globalThis.fetch=async (url,opts={})=>{
  const address=String(url);fetchCalls.push({address,opts});
  if(address.endsWith('/auth/v1/user'))return new Response(JSON.stringify(member(opts.headers?.['X-Test-User']||PARTNER)),{status:200});
  if(address.includes('/rest/v1/bb_households?')){
   if(failMembership)return new Response('{}',{status:503});
   assert.match(address,/partner_user_id=eq\.11111111/);
   assert.equal(opts.headers?.apikey,'sb_secret_abcdefghijklmnopqrstuvwxyz123456789');
   assert.equal(opts.headers?.Authorization,undefined,'secret key must not be sent as bearer');
   return new Response(JSON.stringify(household),{status:200});
  }
  throw Error('Unexpected outbound request: '+address);
 };
}
test('hard OFF brake prevents Premium inheritance even with all live env flags',async()=>{
 reset();const owner=await closed.sharedHouseholdPremiumOwner(request(),env(),member());
 assert.equal(owner,null);assert.equal(fetchCalls.length,0);
});
test('disabled production paid-device guard also prevents partner inheritance',async()=>{
 reset();seatActive=false;
 assert.equal(await active.sharedHouseholdPremiumOwner(request(),env(),member()),null);
 assert.equal(fetchCalls.length,0);
});
test('accepted, confirmed-email partner inherits only verified D1 owner',async()=>{
 reset();assert.equal(await active.sharedHouseholdPremiumOwner(request(),env(),member()),OWNER);
 assert.deepEqual(lookups,[OWNER]);
});
test('free/canceled/past_due/forged-price owner cannot share Premium',async()=>{
 for(const bad of [null,{...goodRow,status:'canceled'},{...goodRow,status:'past_due'},
                   {...goodRow,price_id:price('x')}]){
   reset();accounts=new Map(bad?[[OWNER,bad]]:[]);
   assert.equal(await active.sharedHouseholdPremiumOwner(request(),env(),member()),null);
 }
});
test('unlinked, pending, mismatched email/id and ambiguous partners denied',async()=>{
 for(const changed of [[],[{...accepted(),invite_status:'pending'}],
    [{...accepted(),partner_email:'other@example.com'}],
    [{...accepted(),partner_user_id:OWNER}],[accepted(),accepted()]]){
   reset();household=changed;
   assert.equal(await active.sharedHouseholdPremiumOwner(request(),env(),member()),null);
 }
});
test('QA tenants, preview branches, disabled flags and non-live hosts fail closed',async()=>{
 for(const overrides of [
  {SUPABASE_URL:'https://cbucbdvwgmkgmsajtbfe.supabase.co'},
  {CF_PAGES_BRANCH:'qa/partner-two-phone-test-20261029'},
  {BB_PARTNER_SHARING_ENABLED:'false'},
  {BB_PARTNER_PRODUCTION_READY:'false'},
  {BB_PREMIUM_SINGLE_SESSION_ENABLED:'false'},
  {BB_BILLING_MODE:'sandbox'},
  {BB_LIVE_WEBHOOK_ENABLED:'false'}
 ]){
   reset();assert.equal(await active.sharedHouseholdPremiumOwner(request(),env(overrides),member()),null);
   assert.equal(fetchCalls.length,0);
 }
 reset();const qa=new Request('https://basketboss-partner-qa.pages.dev/api/recipes/premium');
 assert.equal(await active.sharedHouseholdPremiumOwner(qa,env(),member()),null);
 assert.equal(fetchCalls.length,0);
});
test('lookup error is never interpreted as granting Premium',async()=>{
 reset();failMembership=true;
 await assert.rejects(active.sharedHouseholdPremiumOwner(request(),env(),member()));
});
test('partner with no personal subscription sees Premium status but no Paddle subscription details',async()=>{
 reset();const r=await status.onRequestGet({request:request(),env:env()});const data=await r.json();
 assert.equal(r.status,200);assert.equal(data.premiumAccess,true);
 assert.equal(data.tier,'premium');assert.equal(data.householdRole,'partner');
 assert.equal(data.subscription,null);assert.equal(data.portalUrl,null);
 assert.ok(!('paddle_subscription_id' in data));
});
test('partner canceled owner status reverts to Free immediately',async()=>{
 reset();accounts.clear();const r=await status.onRequestGet({request:request(),env:env()});
 const data=await r.json();assert.equal(data.premiumAccess,false);
});
test('partner cancelled personal subscription may use live owner-paid sharing, but cannot see owner billing',async()=>{
 reset();accounts.set(PARTNER,{...goodRow,status:'canceled'});
 const data=await (await status.onRequestGet({request:request(),env:env()})).json();
 assert.equal(data.premiumAccess,true);assert.equal(data.subscription,null);
});
test('verified partner can retrieve premium recipes; unlink and cancellation deny access',async()=>{
 reset();
 let response=await rec.onRequestGet({request:request(PARTNER,'/api/recipes/premium'),env:env()});
 assert.equal(response.status,200);assert.equal((await response.json()).count,221);
 reset();household=[];
 response=await rec.onRequestGet({request:request(PARTNER,'/api/recipes/premium'),env:env()});
 assert.equal(response.status,403);
 reset();accounts.clear();
 response=await rec.onRequestGet({request:request(PARTNER,'/api/recipes/premium'),env:env()});
 assert.equal(response.status,403);
});
test('AI status recognises verified partner and denies canceled owner; quotas use paid owner ID',async()=>{
 reset();
 let res=await ai.onRequest({request:request(PARTNER,'/api/bb173/status'),env:env(),params:{action:'status'}});
 assert.equal((await res.json()).premium_ai,true);
 reset();accounts.clear();
 res=await ai.onRequest({request:request(PARTNER,'/api/bb173/status'),env:env(),params:{action:'status'}});
 assert.equal((await res.json()).premium_ai,false);
 assert.match(read('functions/api/bb173/[action].js'),/member\.bbQuotaOwnerId\|\|member\.id/);
});
test('released partner access still uses verified server sharing and omits owner billing',()=>{
 reset();assert.equal(active.partnerBenefitsEnabled(request(),env()),true);
 assert.match(read('functions/api/recipes/premium.js'),/sharedHouseholdPremiumOwner/);
 assert.match(read('functions/api/subscription/status.js'),/subscription:null,portalUrl:null/);
});
