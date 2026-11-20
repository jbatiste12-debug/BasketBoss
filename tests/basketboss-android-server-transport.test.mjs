import test from 'node:test';
import assert from 'node:assert/strict';
import {IOS_ORIGIN,ANDROID_ORIGIN,nativeCorsResponse,nativePreflightResponse} from '../bb-server-lib/bb-request-origin.js';
import {onRequest as middleware} from '../functions/api/_middleware.js';
import {onRequestGet as checkoutConfig} from '../functions/api/subscription/checkout-config.js';
import {onRequestPost as checkout} from '../functions/api/subscription/checkout.js';
import {onRequestGet as portal} from '../functions/api/subscription/portal.js';
import {onRequestGet as status} from '../functions/api/subscription/status.js';

const origin='https://basketboss.co.uk',user='11111111-1111-4111-8111-111111111111';
const request=(path,clientOrigin=ANDROID_ORIGIN,{method='GET',headers={},body}={})=>new Request(origin+path,{method,headers:{Origin:clientOrigin,...headers},...(body===undefined?{}:{body})});
const unavailableDB={prepare(){throw Error('Native billing fallback must not query billing data.');}};
const configured={BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',BB_LIVE_CHECKOUT_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',BILLING_DB:unavailableDB,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_test_key',PADDLE_LIVE_API_KEY:'synthetic_test_only',PADDLE_LIVE_WEBHOOK_SECRET:'synthetic_test_only',PADDLE_LIVE_FOUNDER_PRICE_ID:'pri_'+'f'.repeat(26),PADDLE_LIVE_STANDARD_PRICE_ID:'pri_'+'s'.repeat(26)};

test('both native origins receive only their own CORS permission, without cookie transport',async()=>{
 for(const clientOrigin of [IOS_ORIGIN,ANDROID_ORIGIN]){
  const req=request('/api/receipt-inventory',clientOrigin);
  const wrapped=nativeCorsResponse(req,new Response('private',{status:401,headers:{Vary:'Authorization','Cache-Control':'private, no-store','Access-Control-Allow-Credentials':'true'}}));
  assert.equal(wrapped.status,401);assert.equal(await wrapped.text(),'private');assert.equal(wrapped.headers.get('Access-Control-Allow-Origin'),clientOrigin);
  assert.equal(wrapped.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(wrapped.headers.get('Vary'),'Authorization, Origin');
  assert.equal(wrapped.headers.get('Cache-Control'),'private, no-store');
  const preflight=request('/api/receipt-inventory',clientOrigin,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'}});
  const allowed=nativePreflightResponse(preflight);assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),clientOrigin);
  for(const headers of [{'Access-Control-Request-Method':'DELETE'},{'Access-Control-Request-Headers':'Authorization, Cookie'},{'Access-Control-Request-Headers':'X-Admin-Key'},{'Access-Control-Request-Method':'PUT'}]){
   const denied=nativePreflightResponse(request('/api/receipt-inventory',clientOrigin,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST',...headers}}));
   assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Methods'),null);
  }
 }
});

test('Android transport never reflects lookalike origins, preview hosts, ports or non-API routes',()=>{
 const spoofed=['http://localhost','https://localhost:443','https://localhost:8443','https://localhost/','https://localhost.evil','https://LOCALHOST','https://%6cocalhost','https://user@localhost','null','*','https://localhost, https://evil.example'];
 const targets=['http://basketboss.co.uk/api/receipt-inventory','https://basketboss.co.uk:8443/api/receipt-inventory','https://preview.basketboss-site.pages.dev/api/receipt-inventory','https://basketboss-site.pages.dev/api/receipt-inventory','https://basketboss.co.uk.evil/api/receipt-inventory','https://basketboss.co.uk/app','https://basketboss.co.uk/api-evil/receipt-inventory'];
 const denied=[...spoofed.map(clientOrigin=>request('/api/receipt-inventory',clientOrigin,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST'}})),...targets.map(url=>new Request(url,{method:'OPTIONS',headers:{Origin:ANDROID_ORIGIN,'Access-Control-Request-Method':'POST'}})),new Request(origin+'/api/receipt-inventory',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST'}})];
 for(const req of denied){
  assert.equal(nativePreflightResponse(req),null,req.url+' '+req.headers.get('Origin'));
  const original=new Response('denied',{status:403});assert.equal(nativeCorsResponse(req,original),original);assert.equal(original.headers.get('Access-Control-Allow-Origin'),null);
 }
});

test('Android preflight retains the existing GET/POST and exact request-header allowlist',async()=>{
 for(const method of ['GET','POST']){
  const req=request('/api/receipt-inventory',ANDROID_ORIGIN,{method:'OPTIONS',headers:{'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'Accept, Authorization, Content-Type, Cache-Control, Pragma'}});
  let reached=false;const result=await middleware({request:req,env:{},next(){reached=true;throw Error('Preflight reached an account route');}});
  assert.equal(result.status,204);assert.equal(reached,false);assert.equal(result.headers.get('Access-Control-Allow-Origin'),ANDROID_ORIGIN);assert.equal(result.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(result.headers.get('Access-Control-Allow-Methods'),'GET, POST');
 }
 for(const method of ['HEAD','PATCH','DELETE','PUT','post',''])assert.equal(nativePreflightResponse(request('/api/receipt-inventory',ANDROID_ORIGIN,{method:'OPTIONS',headers:{'Access-Control-Request-Method':method}})).status,403);
});

test('Android CORS cannot authenticate a cookie, origin or browser Premium flag',async()=>{
 const env={BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',CF_PAGES_BRANCH:'main',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_test',SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40)};
 let next=0;
 const result=await middleware({request:request('/api/recipes/premium',ANDROID_ORIGIN,{headers:{Cookie:'access_token=synthetic','X-BB-Premium':'true','Sec-Fetch-Site':'cross-site'}}),env,next(){next++;throw Error('Anonymous native request reached Premium route.');}});
 assert.equal(result.status,401);assert.equal(next,0);assert.equal(result.headers.get('Access-Control-Allow-Origin'),ANDROID_ORIGIN);
 assert.equal(result.headers.get('Access-Control-Allow-Credentials'),null);
});

test('Android keeps the newest verified Premium-session gate after Supabase authentication',async()=>{
 const session='22222222-2222-4222-8222-222222222222',bearer='header.'+Buffer.from(JSON.stringify({sub:user,session_id:session,exp:Date.now()/1000+3600})).toString('base64url')+'.signature';
 const env={BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',CF_PAGES_BRANCH:'main',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_test',SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40)};
 const previous=globalThis.fetch;let current=false,next=0;
 globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')?Response.json({id:user,email:'android@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}):Response.json(current);
 try{
  const invoke=()=>middleware({request:request('/api/recipes/premium',ANDROID_ORIGIN,{headers:{Authorization:'Bearer '+bearer}}),env,next(){next++;return new Response('paid route');}});
  const stale=await invoke();assert.equal(stale.status,403);assert.equal(next,0);assert.equal(stale.headers.get('Access-Control-Allow-Origin'),ANDROID_ORIGIN);
  current=true;const allowed=await invoke();assert.equal(allowed.status,200);assert.equal(await allowed.text(),'paid route');assert.equal(next,1);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),ANDROID_ORIGIN);
 }finally{globalThis.fetch=previous;}
});

test('Android checkout configuration, purchase and portal fail closed before accessing any provider',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('Android fallback reached a payment provider.');};
 try{
  for(const env of [{},configured,new Proxy({},{get(){throw Error('Native billing denial must precede configuration, auth and provider access.');}})]){
   const config=await checkoutConfig({request:request('/api/subscription/checkout-config'),env});assert.equal(config.status,403);assert.deepEqual(await config.json(),{enabled:false,reason:'native_account_status_only'});
   const purchase=await checkout({request:request('/api/subscription/checkout',ANDROID_ORIGIN,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{"plan":"standard"}'}),env});
   assert.equal(purchase.status,403);assert.match((await purchase.json()).error,/Android test build/);
   const management=await portal({request:request('/api/subscription/portal',ANDROID_ORIGIN,{headers:{Authorization:'Bearer synthetic'}}),env});assert.equal(management.status,403);assert.match((await management.json()).error,/Android test build/);
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=previous;}
});

test('iOS and web checkout configuration and error ordering remain unchanged',async()=>{
 const iosConfig=await checkoutConfig({request:request('/api/subscription/checkout-config',IOS_ORIGIN),env:{}});assert.equal(iosConfig.status,200);assert.deepEqual(await iosConfig.json(),{enabled:false,reason:'native_account_status_only'});
 const iosDisabled=await checkout({request:request('/api/subscription/checkout',IOS_ORIGIN,{method:'POST'}),env:{}});assert.equal(iosDisabled.status,503);assert.equal((await iosDisabled.json()).error,'Checkout disabled or not configured');
 const iosPurchase=await checkout({request:request('/api/subscription/checkout',IOS_ORIGIN,{method:'POST'}),env:configured});assert.equal(iosPurchase.status,403);assert.equal((await iosPurchase.json()).error,'Purchases are unavailable in the iOS app. View your account status in Settings.');
 const iosPortal=await portal({request:request('/api/subscription/portal',IOS_ORIGIN),env:{}});assert.equal(iosPortal.status,403);assert.equal((await iosPortal.json()).error,'External billing is unavailable in the iOS app');
 const webConfig=await checkoutConfig({request:request('/api/subscription/checkout-config',origin),env:configured});assert.equal(webConfig.status,200);assert.deepEqual(await webConfig.json(),{enabled:true,mode:'live'});
 const webPurchase=await checkout({request:request('/api/subscription/checkout',origin,{method:'POST'}),env:configured});assert.equal(webPurchase.status,401);assert.equal((await webPurchase.json()).error,'Sign in with a verified account first');
 const webPortal=await portal({request:request('/api/subscription/portal',origin),env:configured});assert.equal(webPortal.status,401);assert.equal((await webPortal.json()).error,'Sign in required');
});

test('Android membership status remains read-only and requires a verified Supabase identity',async()=>{
 const env={BILLING_DB:unavailableDB,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_test',BB_OWNER_USER_ID:user};
 const previous=globalThis.fetch,calls=[];let verified=false;
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});assert.equal(String(url),env.SUPABASE_URL+'/auth/v1/user');return verified?Response.json({id:user,email:'android@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}):new Response(null,{status:401});};
 try{
  const anonymous=await status({request:request('/api/subscription/status',ANDROID_ORIGIN,{headers:{Cookie:'access_token=synthetic','X-BB-Premium':'true'}}),env});assert.equal(anonymous.status,401);assert.equal((await anonymous.json()).premium,false);assert.equal(calls.length,0);
  const invalid=await status({request:request('/api/subscription/status',ANDROID_ORIGIN,{headers:{Authorization:'Bearer invalid-test-token'}}),env});assert.equal(invalid.status,401);assert.equal((await invalid.json()).premium,false);
  verified=true;
  const owner=await status({request:request('/api/subscription/status',ANDROID_ORIGIN,{headers:{Authorization:'Bearer verified-test-token'}}),env});assert.equal(owner.status,200);const result=await owner.json();assert.equal(result.tier,'owner');assert.equal(result.premiumAccess,true);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer verified-test-token');assert.equal(calls.at(-1).options.redirect,'manual');
  const free=await status({request:request('/api/subscription/status',ANDROID_ORIGIN,{headers:{Authorization:'Bearer verified-test-token'}}),env:{...env,BB_OWNER_USER_ID:undefined}});assert.equal(free.status,200);assert.equal((await free.json()).premiumAccess,false);
 }finally{globalThis.fetch=previous;}
});
