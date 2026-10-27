import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { onRequest } from '../functions/api/bb173/[action].js';

const uid='verified_trial_user', claimId='11111111-1111-4111-8111-111111111111';
const txn='txn_'+ 't'.repeat(26), subId='sub_'+'s'.repeat(26), customer='ctm_'+'c'.repeat(26);
const founderPrice='pri_'+'f'.repeat(26), standardPrice='pri_'+'p'.repeat(26);
const metadata={bb_claim_id:claimId,bb_plan:'standard',bb_environment:'live'};
const claim={claim_id:claimId,user_id:uid,plan:'standard',price_id:standardPrice,transaction_id:txn,slot_no:null};
const transaction={id:txn,status:'completed',collection_mode:'automatic',customer_id:customer,
  subscription_id:subId,custom_data:metadata,items:[{quantity:1,price:{id:standardPrice}}]};
const subscription={id:subId,status:'trialing',customer_id:customer,custom_data:metadata,
  items:[{quantity:1,price:{id:standardPrice}}]};

function environment(opts={}){
  const {entitlement=null,claimRow=claim,tx=transaction,subscriptionRow=subscription,
    actor=uid,slotRow=null,...config}=opts;
  const seen=[];
  const env={
    BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',BB_PREMIUM_AI_ENABLED:'true',
    BB_OWNER_USER_ID:'owner_id',BB_LIVE_CHECKOUT_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',
    SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_mock',
    PADDLE_LIVE_API_KEY:'pdl_live_apikey_mock',PADDLE_LIVE_STANDARD_PRICE_ID:standardPrice,
    PADDLE_LIVE_FOUNDER_PRICE_ID:founderPrice,
    GEMINI_API_KEY:'gemini_mock',TURNSTILE_SECRET_KEY:'turnstile_secret',
    TURNSTILE_SITE_KEY:'site_mock',BB_AI_GLOBAL_DAILY_CAP:'20',
    BILLING_DB:{prepare(sql){
      return {bind(...params){return {async first(){
        seen.push({sql,params});
        if(sql.includes('FROM bb_paid_entitlements'))return entitlement;
        if(sql.includes('FROM bb_billing_claims'))return params[0]===actor?claimRow:null;
        if(sql.includes('FROM bb_founder_slots'))return slotRow;
        throw Error('Unexpected D1 query');
      }}}};
    }},...config};
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    const address=String(url);
    seen.push({url:address,headers:options?.headers});
    if(address.endsWith('/auth/v1/user')){
      return Response.json({id:actor,email:'verified@example.com',email_confirmed_at:'2026-10-27T00:00:00Z'});
    }
    if(address.endsWith('/transactions/'+txn))return Response.json({data:tx});
    if(address.endsWith('/subscriptions/'+subId))return Response.json({data:subscriptionRow});
    throw Error('Unexpected network request: '+address);
  };
  return {
    env,seen,
    async status(){
      const request=new Request('https://basketboss.co.uk/api/bb173/status',
        {headers:{Authorization:'Bearer user_session_mock'}});
      const response=await onRequest({request,env,params:{action:'status'}});
      assert.equal(response.status,200);
      return response.json();
    },
    restore(){globalThis.fetch=oldFetch;}
  };
}
async function check(options,expected){
  const testEnv=environment(options);
  try{
    const data=await testEnv.status();
    assert.equal(data.premium_ai,expected);
    assert.equal(data.siteKey,expected?'site_mock':null);
    return testEnv.seen;
  }finally{testEnv.restore();}
}

test('new completed checkout grants AI during webhook lag for current trialing subscription',async()=>{
  const seen=await check({},true);
  assert.ok(seen.some(x=>x.url?.includes('/transactions/')));
  assert.ok(seen.some(x=>x.url?.includes('/subscriptions/')));
  assert.ok(seen.find(x=>x.url?.includes('/subscriptions/'))?.headers.Authorization.startsWith('Bearer '));
});
test('existing D1 verified trial does not need Paddle fallback',async()=>{
  const seen=await check({entitlement:{status:'trialing',plan:'standard',price_id:standardPrice}},true);
  assert.ok(!seen.some(x=>x.url?.includes('api.paddle.com')));
});
test('existing active D1 subscriber and owner retain AI access',async()=>{
  await check({entitlement:{status:'active',plan:'standard',price_id:standardPrice}},true);
  await check({actor:'owner_id',claimRow:null},true);
});
test('unverified D1 claim, canceled checkout, and canceled subscription never unlock AI',async()=>{
  await check({claimRow:null},false);
  await check({tx:{...transaction,status:'draft'}},false);
  await check({subscriptionRow:{...subscription,status:'canceled'}},false);
  await check({tx:{...transaction,custom_data:{...metadata,bb_claim_id:'wrong'}}},false);
});
test('mismatched plan/price/customer/session never unlock AI',async()=>{
  await check({claimRow:{...claim,price_id:founderPrice}},false);
  await check({tx:{...transaction,customer_id:'ctm_'+'x'.repeat(26)}},false);
  await check({subscriptionRow:{...subscription,items:[{quantity:1,price:{id:founderPrice}}]}},false);
  await check({actor:'different_user',claimRow:null},false);
});
test('Founder only grants AI when assigned slot and Paddle subscription are verified',async()=>{
  const founderMeta={...metadata,bb_plan:'founder'};
  const c={...claim,plan:'founder',price_id:founderPrice,slot_no:9};
  const t={...transaction,custom_data:founderMeta,items:[{quantity:1,price:{id:founderPrice}}]};
  const s={...subscription,custom_data:founderMeta,items:[{quantity:1,price:{id:founderPrice}}]};
  const hash=createHash('sha256').update(claimId).digest('hex');
  const reserved={state:'reserved',user_id:uid,reservation_token_hash:hash,paddle_subscription_id:null};
  await check({claimRow:c,tx:t,subscriptionRow:s,slotRow:reserved},true);
  await check({claimRow:c,tx:t,subscriptionRow:s,slotRow:{...reserved,user_id:'other'}},false);
  await check({claimRow:c,tx:t,subscriptionRow:s,slotRow:{...reserved,state:'retired'}},false);
});
test('missing Paddle read permissions fail closed',async()=>{
  const v=environment({claimRow:claim});
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async(url,opts)=>{
      if(String(url).includes('supabase.co'))return Response.json({
        id:uid,email:'test@example.com',email_confirmed_at:'2026-10-27T00:00:00Z'
      });
      return Response.json({error:{code:'forbidden'}},{status:403});
    };
    const data=await v.status();assert.equal(data.premium_ai,false);
  }finally{globalThis.fetch=old;v.restore();}
});
test('frontend refreshes false AI status before denial and preserves server Bearer authorization',async()=>{
  const js=await fs.readFile(new URL('../make-a-meal.js',import.meta.url),'utf8');
  assert.match(js,/if\(!aiEnabled\)await bbRefreshAIStatus\(\)/);
  assert.match(js,/if\(bbPaidToken\(\)!==accessToken\)throw Error/);
  assert.match(js,/'Authorization':'Bearer '\+accessToken/);
  const html=await fs.readFile(new URL('../make-a-meal.html',import.meta.url),'utf8');
  assert.match(html,/<label class="scan-upload-label" for="ai-photo-input">/);
  assert.match(html,/<input accept="image\/\*"[^>]+id="ai-photo-input" type="file"/);
});
