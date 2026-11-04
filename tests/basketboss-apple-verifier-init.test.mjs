import test from 'node:test';import assert from 'node:assert/strict';
import {createAppleAppTransactionVerifier,getAppleAppTransactionVerifier,classifyAppleVerifierInitFailure,AppleBillingError}from'../bb-server-lib/bb-apple-subscriptions.js';
const PRIVATE='private-bearer-secret signed.receipt.proof tester@example.invalid 11111111-1111-4111-8111-111111111111';
const roots=[Buffer.from('fixture root')];
test('verifier construction retains pinned-root source, online checking and exact Sandbox app identity',async()=>{
 let args;class Verifier{constructor(...values){args=values;}}
 const result=await createAppleAppTransactionVerifier({loadLibrary:async()=>({SignedDataVerifier:Verifier}),rootCertificates:()=>roots});assert.ok(result instanceof Verifier);assert.deepEqual(args,[roots,true,'Sandbox','uk.co.basketboss.app']);
 const real=await getAppleAppTransactionVerifier();assert.equal(real.environment,'Sandbox');assert.equal(real.enableOnlineChecks,true);assert.equal(real.bundleId,'uk.co.basketboss.app');assert.equal(real.rootCertificates.length,1);
});
test('CommonJS default fallback accepts only a real constructor',async()=>{
 class Verifier{}
 assert.ok(await createAppleAppTransactionVerifier({loadLibrary:async()=>({default:{SignedDataVerifier:Verifier}}),rootCertificates:()=>roots}) instanceof Verifier);
 assert.ok(await createAppleAppTransactionVerifier({loadLibrary:async()=>({SignedDataVerifier:()=>{},default:{SignedDataVerifier:Verifier}}),rootCertificates:()=>roots}) instanceof Verifier);
 for(const sdk of[{}, {SignedDataVerifier:()=>{}}, {default:{SignedDataVerifier:{}}}])await assert.rejects(createAppleAppTransactionVerifier({loadLibrary:async()=>sdk,rootCertificates:()=>roots}),error=>error instanceof AppleBillingError&&error.status===503&&error.message.includes('BB_BETA_APPLE_MODULE_MISSING_EXPORT'));
});
test('module, trust root and constructor failures expose only fixed initialization references',async()=>{
 for(const stage of['MODULE','ROOTS','CONSTRUCTOR']){
  const fail=()=>{throw Error(PRIVATE);};class Verifier{constructor(){if(stage==='CONSTRUCTOR')fail();}}
  const options={loadLibrary:async()=>{if(stage==='MODULE')fail();return {SignedDataVerifier:Verifier};},rootCertificates:()=>{if(stage==='ROOTS')fail();return roots;}};
  await assert.rejects(createAppleAppTransactionVerifier(options),error=>{assert.ok(error instanceof AppleBillingError);assert.equal(error.status,503);assert.equal(error.code,'testflight_beta_unavailable');assert.ok(error.message.includes('BB_BETA_APPLE_'+stage+'_UNKNOWN'));for(const secret of[PRIVATE,'private-bearer-secret','signed.receipt.proof','tester@example.invalid'])assert.equal(error.message.includes(secret),false);return true;});
 }
});
test('initialization failure classification uses a closed, non-sensitive vocabulary',()=>{
 for(const [message,stack,expected]of[
  ['Disallowed operation called within global scope. '+PRIVATE,'','GLOBAL_CONTEXT'],
  ['Cannot read properties of undefined (reading prototype) '+PRIVATE,'at buffer-equal-constant-time/index.js','BUFFER_COMPAT'],
  ['SignedDataVerifier is not a constructor '+PRIVATE,'','MISSING_EXPORT'],
  ['X509Certificate is not implemented '+PRIVATE,'','NODE_CRYPTO'],
  ['Apple trust anchor integrity check failed '+PRIVATE,'','ROOT_INTEGRITY'],
  [PRIVATE,'','UNKNOWN']
 ])assert.equal(classifyAppleVerifierInitFailure({message,stack}),expected);
 const hostile={get message(){throw Error(PRIVATE);},get stack(){throw Error(PRIVATE);}};assert.equal(classifyAppleVerifierInitFailure(hostile),'UNKNOWN');
});
