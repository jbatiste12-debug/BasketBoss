import test from 'node:test';
import assert from 'node:assert/strict';
import {IOS_ORIGIN,isNativeApiRequest,requestOriginAllowed,nativeCorsResponse,nativePreflightResponse} from '../bb-server-lib/bb-request-origin.js';
import {requireSameOrigin} from '../bb-server-lib/bb-billing.js';
import {onRequest as middleware} from '../functions/api/_middleware.js';
import {onRequest as ai} from '../functions/api/bb173/[action].js';

const api='https://basketboss.co.uk/api/receipt-inventory';
const request=(url=api,origin=IOS_ORIGIN,extra={})=>new Request(url,{headers:{Origin:origin,...extra}});
const preflight=(headers={},url=api)=>new Request(url,{method:'OPTIONS',headers:{Origin:IOS_ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type',...headers}});

test('only the exact native origin is trusted on official production HTTPS API routes',()=>{
 for(const url of [api,'https://www.basketboss.co.uk/api/household'])assert.equal(isNativeApiRequest(request(url)),true);
 for(const origin of ['capacitor://localhost.evil','capacitor://localhost:8080','capacitor://localhost/','http://localhost','https://localhost','null','https://evil.example'])assert.equal(isNativeApiRequest(request(api,origin)),false,origin);
 for(const url of ['http://basketboss.co.uk/api/receipt-inventory','https://basketboss.co.uk:8443/api/receipt-inventory','https://preview.basketboss-site.pages.dev/api/receipt-inventory','https://basketboss-site.pages.dev/api/receipt-inventory','https://evil.example/api/receipt-inventory','https://basketboss.co.uk/pricing-sandbox.html'])assert.equal(isNativeApiRequest(request(url)),false,url);
});

test('native cross-site fetch works while existing web Origin and Fetch-Site protections remain',()=>{
 assert.equal(requireSameOrigin(request(api,IOS_ORIGIN,{'Sec-Fetch-Site':'cross-site'}),true),true);
 assert.equal(requestOriginAllowed(request(api,'https://basketboss.co.uk')),true);
 assert.equal(requireSameOrigin(request(api,'https://basketboss.co.uk',{'Sec-Fetch-Site':'cross-site'}),true),false);
 assert.equal(requireSameOrigin(request(api,'https://evil.example')),false);
 assert.equal(requireSameOrigin(new Request(api)),false);
 assert.equal(requireSameOrigin(request('https://preview.example/api/household','https://preview.example')),true);
 assert.equal(requireSameOrigin(request('https://preview.example/api/household')),false);
});

test('preflight allows the JSON/Bearer API transport without authenticating or enabling cookies',async()=>{
 let next=0;
 const result=await middleware({request:preflight(),env:{BB_PREMIUM_SINGLE_SESSION_ENABLED:'true'},next:()=>{next++;throw Error('preflight reached auth route');}});
 assert.equal(result.status,204);assert.equal(next,0);
 assert.equal(result.headers.get('Access-Control-Allow-Origin'),IOS_ORIGIN);
 assert.equal(result.headers.get('Access-Control-Allow-Credentials'),null);
 assert.equal(result.headers.get('Access-Control-Allow-Methods'),'GET, POST');
 assert.match(result.headers.get('Access-Control-Allow-Headers'),/Authorization/);
 assert.match(result.headers.get('Vary'),/Origin/);
});

test('preflight rejects unsupported methods, arbitrary headers and spoofed native sites',()=>{
 for(const patch of [{'Access-Control-Request-Method':'DELETE'},{'Access-Control-Request-Method':'PUT'},{'Access-Control-Request-Method':''},{'Access-Control-Request-Headers':'Authorization, X-Admin-Key'}])assert.equal(nativePreflightResponse(preflight(patch)).status,403);
 assert.equal(nativePreflightResponse(preflight({Origin:'capacitor://localhost.evil'})),null);
 assert.equal(nativePreflightResponse(preflight({},'https://preview.example/api/receipt-inventory')),null);
 assert.equal(nativePreflightResponse(request()),null);
});

test('CORS wraps error responses, preserves authorization Vary and does not expose other origins',async()=>{
 const original=new Response('Unauthorized',{status:401,headers:{Vary:'Authorization','Cache-Control':'no-store'}});
 const wrapped=nativeCorsResponse(request(),original);
 assert.equal(wrapped.status,401);assert.equal(await wrapped.text(),'Unauthorized');
 assert.equal(wrapped.headers.get('Vary'),'Authorization, Origin');
 assert.equal(wrapped.headers.get('Cache-Control'),'no-store');
 assert.equal(wrapped.headers.get('Access-Control-Allow-Origin'),IOS_ORIGIN);
 const web=new Response('web');assert.equal(nativeCorsResponse(request(api,'https://basketboss.co.uk'),web),web);
 const evil=new Response('evil');assert.equal(nativeCorsResponse(request(api,'https://evil.example'),evil),evil);
});

const user='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222';
const bearer='header.'+Buffer.from(JSON.stringify({sub:user,session_id:session,exp:Date.now()/1000+3600})).toString('base64url')+'.signature';
const live={BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',CF_PAGES_BRANCH:'main',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_native_test_key',SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40)};

test('native CORS never bypasses confirmed login or the newest paid-device session',async()=>{
 const original=globalThis.fetch;
 try{
  let next=0;const invoke=req=>middleware({request:req,env:live,next:()=>{next++;return new Response('route');}});
  const anonymous=await invoke(request('https://basketboss.co.uk/api/recipes/premium'));
  assert.equal(anonymous.status,401);assert.equal(next,0);assert.equal(anonymous.headers.get('Access-Control-Allow-Origin'),IOS_ORIGIN);
  let current=false;
  globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')?Response.json({id:user,email:'native@example.test',email_confirmed_at:'2026-10-31T00:00:00Z'}):Response.json(current);
  const authenticated=request('https://basketboss.co.uk/api/recipes/premium',IOS_ORIGIN,{Authorization:'Bearer '+bearer});
  const stale=await invoke(authenticated);assert.equal(stale.status,403);assert.equal(next,0);assert.equal(stale.headers.get('Access-Control-Allow-Origin'),IOS_ORIGIN);
  current=true;const allowed=await invoke(authenticated);assert.equal(allowed.status,200);assert.equal(next,1);
 }finally{globalThis.fetch=original;}
});

test('AI native POST gets through origin checks but still requires verified Premium membership',async()=>{
 const env={BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',BB_PREMIUM_AI_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_test',PADDLE_LIVE_API_KEY:'test',PADDLE_LIVE_STANDARD_PRICE_ID:'pri_'+'p'.repeat(26),GEMINI_API_KEY:'dummy',BB_AI_GLOBAL_DAILY_CAP:'20',TURNSTILE_SECRET_KEY:'dummy',TURNSTILE_SITE_KEY:'dummy',BILLING_DB:{prepare(){throw Error('Unauthenticated request reached D1');}}};
 const response=await ai({request:new Request('https://basketboss.co.uk/api/bb173/scan',{method:'POST',headers:{Origin:IOS_ORIGIN,'Sec-Fetch-Site':'cross-site','Content-Type':'application/json'},body:'{}'}),env,params:{action:'scan'}});
 assert.equal(response.status,403);assert.match((await response.json()).error,/Verified Premium membership required/);
});
