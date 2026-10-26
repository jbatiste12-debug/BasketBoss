import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ownerPreviewAI, aiConfigurationChecks, onRequest } from '../functions/api/bb173/[action].js';
const good={
  BB_OWNER_AI_PREVIEW_ENABLED:'true', BB_PREMIUM_AI_ENABLED:'true',
  BB_BILLING_MODE:'sandbox',BB_BILLING_ENABLED:'false',
  CF_PAGES_BRANCH:'billing-premium-secure-20261026-2',
  BB_OWNER_AI_PREVIEW_BRANCH:'billing-premium-secure-20261026-2',
  BB_LIVE_CHECKOUT_ENABLED:'false', BB_LIVE_WEBHOOK_ENABLED:'false',
  BB_OWNER_USER_ID:'verified_owner_id', SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'test_key',
  GEMINI_API_KEY:'test_secret',TURNSTILE_SECRET_KEY:'test_secret',
  TURNSTILE_SITE_KEY:'test_site', BB_AI_GLOBAL_DAILY_CAP:'20',
  BILLING_DB:{prepare(){throw Error('Must never query DB for anonymous status')}}
};
test('Owner AI Preview requires every explicit sandbox safeguard',()=>{
  assert.equal(ownerPreviewAI(good),true);
  for(const [key,value] of Object.entries({
    BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',
    CF_PAGES_BRANCH:'main', BB_OWNER_AI_PREVIEW_BRANCH:'main',
    BB_LIVE_CHECKOUT_ENABLED:'true',
    BB_LIVE_WEBHOOK_ENABLED:'true', BB_PREMIUM_AI_ENABLED:'false',
    BB_OWNER_AI_PREVIEW_ENABLED:'false', BB_OWNER_USER_ID:''
  }))assert.equal(ownerPreviewAI({...good,[key]:value}),false,key);
});
test('Owner AI readiness requires Gemini, Turnstile, D1 and quotas',()=>{
  assert.deepEqual(aiConfigurationChecks(good),[]);
  assert.ok(aiConfigurationChecks({...good,GEMINI_API_KEY:''}).includes('gemini_secret_missing'));
  assert.ok(aiConfigurationChecks({...good,TURNSTILE_SECRET_KEY:''}).includes('turnstile_secret_missing'));
  assert.ok(aiConfigurationChecks({...good,TURNSTILE_SITE_KEY:''}).includes('turnstile_site_key_missing'));
  assert.ok(aiConfigurationChecks({...good,BB_AI_GLOBAL_DAILY_CAP:'0'}).includes('global_daily_cap_missing_or_invalid'));
  assert.ok(aiConfigurationChecks({...good,BILLING_DB:null}).includes('billing_db_binding_missing'));
});
test('Anonymous status never exposes readiness codes, site key or AI access',async()=>{
  const request=new Request('https://preview.example/api/bb173/status');
  const response=await onRequest({request,env:good,params:{action:'status'}});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.premium_ai,false);
  assert.equal(data.siteKey,null);
  assert.equal(data.checks,undefined);
});
test('Anonymous requests cannot generate AI meals or scan photos',async()=>{
  const request=new Request('https://preview.example/api/bb173/generate',{
    method:'POST',headers:{Origin:'https://preview.example','Content-Type':'application/json'},
    body:JSON.stringify({ingredients:['eggs'],mode:'only_have',servings:2,turnstileToken:'dummy_token_long'})
  });
  const response=await onRequest({request,env:good,params:{action:'generate'}});
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,'Verified Premium membership required');
});
test('Only an authenticated Owner is offered Preview AI availability',async()=>{
  const old=globalThis.fetch;
  const request=new Request('https://preview.example/api/bb173/status',{
    headers:{Authorization:'Bearer test_user_token'}
  });
  try{
    globalThis.fetch=async()=>Response.json({
      id:'verified_owner_id',email:'owner@example.com',
      email_confirmed_at:'2026-10-26T00:00:00Z'
    });
    const owner=await (await onRequest({request,env:good,params:{action:'status'}})).json();
    assert.equal(owner.premium_ai,true);
    assert.equal(owner.status,'available');
    globalThis.fetch=async()=>Response.json({
      id:'different_free_user',email:'free@example.com',
      email_confirmed_at:'2026-10-26T00:00:00Z'
    });
    const free=await (await onRequest({request,env:good,params:{action:'status'}})).json();
    assert.equal(free.premium_ai,false);
    assert.equal(free.siteKey,null);
  }finally{globalThis.fetch=old;}
});
test('Smart Auto-Fill and related inline Premium UI recognise verified access',async()=>{
  const source=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/function bb176IsPremiumPreview\(\)\{\s*\/\/ Presentation only\.[^\n]*\n\s*if\(window\.BasketBossVerifiedPremium\?\.isActive\?\.\(\)===true\)return true;/);
});
test('Live payment flags and real production paths remain unchanged',async()=>{
  const source=await fs.readFile(new URL('../functions/api/bb173/[action].js',import.meta.url),'utf8');
  assert.match(source,/BB_LIVE_CHECKOUT_ENABLED!=='true'/);
  assert.match(source,/BB_OWNER_AI_PREVIEW_BRANCH==='billing-premium-secure-20261026-2'/);
  assert.match(source,/consumeQuota\(/);
  assert.match(source,/siteVerify\(/);
});
