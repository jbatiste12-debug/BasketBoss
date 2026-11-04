import test from 'node:test';import assert from 'node:assert/strict';
import {createAppleVerifierHealthHandler}from'../functions/api/apple/verifier-health.js';
import {AppleBillingError}from'../bb-server-lib/bb-apple-subscriptions.js';
const PRIVATE='private-bearer-token signed.receipt.proof tester@example.invalid';
const request=(url='https://basketboss.co.uk/api/apple/verifier-health',method='GET')=>new Request(url,{method,headers:{Origin:'capacitor://localhost'}});
const verifier=()=>({verifyAndDecodeAppTransaction(){assert.fail('readiness must never verify a proof');}});
test('public GET reports only factory readiness without account, proof, database or grant access',async()=>{
 let initialized=0;const env={CF_PAGES_BRANCH:'main',get BILLING_DB(){assert.fail('database must not be read');},get SUPABASE_URL(){assert.fail('account authentication must not be read');}};
 const handler=createAppleVerifierHealthHandler({initialize:async()=>{initialized++;return verifier();}});
 const result=await handler({request:request(),env});assert.equal(result.status,200);assert.deepEqual(await result.json(),{ready:true});assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(initialized,1);
});
test('untrusted origins, non-HTTPS hosts and preview branches cannot initialize SDK',async()=>{
 let initialized=0;const handler=createAppleVerifierHealthHandler({initialize:async()=>{initialized++;return verifier();}});
 for(const [url,env]of[['https://evil.example/api/apple/verifier-health',{}],['http://basketboss.co.uk/api/apple/verifier-health',{}],['https://basketboss.co.uk:444/api/apple/verifier-health',{}],['https://preview.basketboss-site.pages.dev/api/apple/verifier-health',{CF_PAGES_BRANCH:'preview'}],['https://basketboss.co.uk/api/apple/verifier-health',{CF_PAGES_BRANCH:'feature/test'}]]){
  const response=await handler({request:request(url),env});assert.equal(response.status,404);assert.deepEqual(await response.json(),{ready:false});
 }
 assert.equal(initialized,0);
});
test('trusted production aliases work and non-GET methods return 405 without initializing',async()=>{
 let initialized=0;const handler=createAppleVerifierHealthHandler({initialize:async()=>{initialized++;return verifier();}});
 for(const host of['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev'])assert.equal((await handler({request:request('https://'+host+'/api/apple/verifier-health'),env:{CF_PAGES_BRANCH:'main'}})).status,200);
 for(const method of['POST','PUT','DELETE'])assert.equal((await handler({request:request(undefined,method),env:{}})).status,405);assert.equal(initialized,3);
});
test('known initialization failure references are strictly allowlisted and raw details never leave',async()=>{
 for(const reference of['BB_BETA_APPLE_MODULE_GLOBAL_CONTEXT','BB_BETA_APPLE_MODULE_DYNAMIC_IMPORT','BB_BETA_APPLE_MODULE_UNDEFINED_PROTOTYPE','BB_BETA_APPLE_MODULE_MISSING_GLOBAL','BB_BETA_APPLE_MODULE_JSON_IMPORT','BB_BETA_APPLE_MODULE_TYPE_ERROR','BB_BETA_APPLE_ROOTS_ROOT_INTEGRITY','BB_BETA_APPLE_CONSTRUCTOR_NODE_CRYPTO']){
  const handler=createAppleVerifierHealthHandler({initialize:async()=>{throw new AppleBillingError('testflight_beta_unavailable',PRIVATE+' Reference: '+reference+'.');}});
  const result=await handler({request:request(),env:{}}),body=await result.json();assert.equal(result.status,503);assert.deepEqual(body,{ready:false,code:'testflight_beta_unavailable',reference});for(const secret of[PRIVATE,'private-bearer-token','signed.receipt.proof','tester@example.invalid'])assert.equal(JSON.stringify(body).includes(secret),false);
 }
});
test('unknown errors and forged or non-allowlisted references return a fixed unknown result',async()=>{
 for(const error of[Error(PRIVATE),Object.assign(Error('Reference: BB_BETA_APPLE_MODULE_GLOBAL_CONTEXT.'),{code:'testflight_beta_unavailable'}),new AppleBillingError('other_code','Reference: BB_BETA_APPLE_MODULE_GLOBAL_CONTEXT.'),new AppleBillingError('testflight_beta_unavailable','Reference: BB_BETA_APPLE_MODULE_UNKNOWN_PRIVATE_SUFFIX.'),new AppleBillingError('testflight_beta_unavailable',PRIVATE)]){
  const result=await createAppleVerifierHealthHandler({initialize:async()=>{throw error;}})({request:request(),env:{}});assert.equal(result.status,503);assert.deepEqual(await result.json(),{ready:false,code:'testflight_beta_unavailable',reference:'BB_BETA_APPLE_MODULE_UNKNOWN'});
 }
});
test('bounded initializer clears timer on timeout and failed initialization can retry',async()=>{
 let initialized=0,cleared=0;
 const handler=createAppleVerifierHealthHandler({initialize:()=>{initialized++;return initialized===1?new Promise(()=>{}):Promise.resolve(verifier());},setTimeout:(fn,ms)=>{assert.equal(ms,5000);return setTimeout(fn,1);},clearTimeout:id=>{cleared++;clearTimeout(id);}});
 const failed=await handler({request:request(),env:{}});assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{ready:false,code:'testflight_beta_unavailable',reference:'BB_BETA_APPLE_MODULE_UNKNOWN'});
 const success=await handler({request:request(),env:{}});assert.equal(success.status,200);assert.equal(initialized,2);assert.equal(cleared,2);
});
test('incomplete factory resolution cannot report readiness',async()=>{
 const result=await createAppleVerifierHealthHandler({initialize:async()=>({})})({request:request(),env:{}});assert.equal(result.status,503);assert.equal((await result.json()).ready,false);
});
