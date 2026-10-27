import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {onRequest} from '../functions/api/bb173/[action].js';

const price='pri_'+'p'.repeat(26);
const txId='txn_'+'t'.repeat(26);
const subId='sub_'+'s'.repeat(26);
const ctmId='ctm_'+'c'.repeat(26);
const claimId='11111111-1111-4111-8111-111111111111';
const metadata={bb_claim_id:claimId,bb_plan:'standard',bb_environment:'live'};
const jpeg=Buffer.from([0xff,0xd8,0xff,...Array(75).fill(4)]).toString('base64');
const scanInput={mimeType:'image/jpeg',imageBase64:jpeg};

function makeHarness({mode='live',actor='paid_user',entitlementStatus='trialing',
    fallback=false,validTurnstile=false,denyQuota=false}={}){
 const calls=[];
 const env={
   BB_BILLING_ENABLED:'true',BB_BILLING_MODE:mode,
   BB_PREMIUM_AI_ENABLED:'true',BB_OWNER_USER_ID:'owner_user',
   BB_LIVE_CHECKOUT_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',
   SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test_publishable',
   PADDLE_LIVE_API_KEY:'pdl_live_apikey_dummy',PADDLE_LIVE_STANDARD_PRICE_ID:price,
   PADDLE_SANDBOX_STANDARD_PRICE_ID:price,PADDLE_SANDBOX_API_KEY:'pdl_sdbx_apikey_dummy',
   GEMINI_API_KEY:'dummy_gemini',TURNSTILE_SITE_KEY:'0x4AAAA_dummy',
   TURNSTILE_SECRET_KEY:'dummy_turnstile',BB_AI_GLOBAL_DAILY_CAP:'20',
   BILLING_DB: {
     prepare(sql) {
       return {
         bind(...args) {
           return {
             async first() {
               calls.push({kind:'d1',sql,args});
               if(sql.includes('bb_paid_entitlements'))
                 return entitlementStatus===null?null:{status:entitlementStatus,plan:'standard',price_id:price};
               if(sql.includes('bb_billing_claims'))
                 return fallback?{claim_id:claimId,plan:'standard',price_id:price,
                   slot_no:null,transaction_id:txId}:null;
               if(sql.includes('bb_founder_slots'))throw Error('Should not need Founder slot');
               if(sql.includes('bb_ai_daily_usage'))return denyQuota?null:{used:1};
               throw Error('Unexpected query: '+sql);
             }
           };
         }
       };
     }
   }
 };
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async (url,options={})=>{
   const u=String(url);calls.push({kind:'fetch',url:u});
   if(u.endsWith('/auth/v1/user')){
     if(options.headers?.Authorization==='Bearer invalid')return Response.json({error:'invalid'},{status:401});
     return Response.json({id:actor,email:'paid@example.com',email_confirmed_at:'2026-10-27T00:00:00Z'});
   }
   if(u.endsWith('/transactions/'+txId))return Response.json({data:{
     id:txId,status:'completed',collection_mode:'automatic',customer_id:ctmId,
     subscription_id:subId,custom_data:metadata,items:[{quantity:1,price:{id:price}}]
   }});
   if(u.endsWith('/subscriptions/'+subId))return Response.json({data:{
     id:subId,status:'trialing',customer_id:ctmId,custom_data:metadata,
     items:[{quantity:1,price:{id:price}}]
   }});
   if(u.includes('turnstile/v0/siteverify'))return Response.json({
     success:validTurnstile,action:'bb_ai',hostname:'basketboss.co.uk'
   });
   if(u.includes('generativelanguage.googleapis.com'))return Response.json({
     candidates:[{content:{parts:[{text:JSON.stringify({
       items:[{name:'apple',estimatedQuantity:'3',confidence:'high',notes:'visible'}],
       caution:''
     })}]}}]
   });
   throw Error('Unexpected URL: '+u);
 };
 return {
   calls,
   async scan({token='good_token',turnstileToken=''}={}){
     const request=new Request('https://basketboss.co.uk/api/bb173/scan',{
       method:'POST',headers:{
         Origin:'https://basketboss.co.uk','Content-Type':'application/json',
         Authorization:'Bearer '+token
       },body:JSON.stringify({...scanInput,turnstileToken})
     });
     const r=await onRequest({request,env,params:{action:'scan'}});
     return {status:r.status,body:await r.json()};
   },restore(){globalThis.fetch=originalFetch;}
 };
}

async function check(options,request,expected){
 const h=makeHarness(options);
 try{
   const response=await h.scan(request);
   assert.equal(response.status,expected,JSON.stringify(response.body));
   return {body:response.body,calls:h.calls};
 }finally{h.restore();}
}

test('Live D1 trialing subscriber can scan with no Turnstile widget',async()=>{
 const {body,calls}=await check({}, {},200);
 assert.equal(body.reviewRequired,true);
 assert.ok(calls.some(x=>x.url?.includes('generativelanguage.googleapis.com')));
 assert.ok(!calls.some(x=>x.url?.includes('siteverify')));
});
test('Live D1 active subscriber can scan with no Turnstile token',async()=>{
 await check({entitlementStatus:'active'},{},200);
});
test('Paddle-completed fresh trial can scan before subscription.created webhook',async()=>{
 const {calls}=await check({entitlementStatus:null,fallback:true},{},200);
 assert.ok(calls.some(x=>x.url?.includes('/transactions/')));
 assert.ok(calls.some(x=>x.url?.includes('/subscriptions/')));
});
test('Live verified Owner can scan; unauthenticated/free users remain denied',async()=>{
 await check({actor:'owner_user',entitlementStatus:null},{},200);
 await check({entitlementStatus:null,fallback:false},{},403);
 await check({}, {token:'invalid'},403);
});
test('Live inactive subscriber cannot bypass entitlement',async()=>{
 const {calls}=await check({entitlementStatus:'canceled'},{},403);
 assert.ok(!calls.some(x=>x.url?.includes('generativelanguage.googleapis.com')));
});
test('Sandbox subscription must pass Turnstile, with no Live bypass',async()=>{
 await check({mode:'sandbox'}, {},403);
 await check({mode:'sandbox',validTurnstile:true},{turnstileToken:'example_challenge'},200);
});
test('AI per-user quota still blocks requests after authentication',async()=>{
 const {calls}=await check({denyQuota:true},{},429);
 assert.ok(!calls.some(x=>x.url?.includes('generativelanguage.googleapis.com')));
});
test('Safari modal observer and cached script changes never touch camera label',async()=>{
 const js=await fs.readFile(new URL('../make-a-meal.js',import.meta.url),'utf8');
 const html=await fs.readFile(new URL('../make-a-meal.html',import.meta.url),'utf8');
 assert.match(js,/function bbObserveAIHumanPanel\(\)/);
 assert.match(js,/new MutationObserver\(check\)\.observe\(stage/);
 assert.match(js,/if\(bbTurnstileRequired&&!\$\('#bbToolStage'\)\?\.hidden\)setupHumanCheck\(bbSiteKey\)/);
 assert.match(js,/window\.turnstile\.render\(host,/);
 assert.match(js,/if\(!aiEnabled\)await bbRefreshAIStatus\(\)/);
 assert.match(js,/const token=turnstileToken\|\|''/);
 assert.match(html,/<label class="scan-upload-label" for="ai-photo-input">/);
 assert.match(html,/<input accept="image\/\*"[^>]+id="ai-photo-input" type="file"/);
 assert.match(html,/make-a-meal\.js\?v=bb-ai-quota-turnstile-live-20261027-v1/);
});
