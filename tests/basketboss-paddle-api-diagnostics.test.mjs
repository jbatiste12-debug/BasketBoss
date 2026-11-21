import test from 'node:test';
import assert from 'node:assert/strict';
import {paddleApi} from '../bb-server-lib/bb-billing.js';

const env={BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',PADDLE_LIVE_API_KEY:'synthetic-private-live-key',PADDLE_SANDBOX_API_KEY:'synthetic-private-sandbox-key'};
const path='/subscriptions/sub_'+'s'.repeat(26),body={effective_from:'immediately'};
const json=(data,status=200)=>Response.json(data,{status});
const safe=values=>{assert.doesNotMatch(JSON.stringify(values),/synthetic-private|sub_|subscriptions|paddle\.com|effective_from|Bearer/);};

test('disabled billing and missing selected credentials report once before any provider call',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;assert.fail('No provider call is allowed');});
 for(const [patch,reason,message] of [
  [{BB_BILLING_ENABLED:'false'},'disabled','Paddle billing mode disabled'],
  [{BB_BILLING_MODE:'unconfigured'},'disabled','Paddle billing mode disabled'],
  [{PADDLE_LIVE_API_KEY:''},'credential_missing','Paddle API credential not configured'],
  [{BB_BILLING_MODE:'sandbox',PADDLE_SANDBOX_API_KEY:''},'credential_missing','Paddle API credential not configured']
 ]){
  const seen=[];await assert.rejects(paddleApi({...env,...patch},path,'GET',undefined,{onFailure:value=>seen.push(value)}),error=>error.message===message);
  assert.deepEqual(seen,[{reason}]);safe(seen);
 }
 assert.equal(calls,0);
});

test('transport and timeout diagnostics preserve the original rejection object',async t=>{
 for(const [name,reason] of [['TypeError','transport'],['TimeoutError','timeout'],['AbortError','timeout']]){
  const original=Object.assign(Error('synthetic-private-upstream-error'),{name}),seen=[];
  t.mock.method(globalThis,'fetch',async()=>{throw original;});
  await assert.rejects(paddleApi(env,path,'GET',undefined,{onFailure:value=>seen.push(value)}),error=>error===original);
  assert.deepEqual(seen,[{reason}]);safe(seen);t.mock.restoreAll();
 }
});

test('provider HTTP failures report bounded status once without response bodies',async t=>{
 for(const status of [301,302,307,400,401,403,404,409,429,500,502,503,504]){
  const seen=[];t.mock.method(globalThis,'fetch',async()=>json({error:'synthetic-private-provider-body'},status));
  await assert.rejects(paddleApi(env,path,'GET',undefined,{onFailure:value=>seen.push(value)}),error=>error.message==='Paddle API response not successful: '+status);
  assert.deepEqual(seen,[{reason:'http',status}]);safe(seen);t.mock.restoreAll();
 }
});

test('non-JSON and missing data preserve the original HTTP200 failure message',async t=>{
 for(const response of [()=>new Response('synthetic-private-non-json'),()=>json({error:'synthetic-private-provider-body'}),()=>json({data:null}),()=>json({data:false})]){
  const seen=[];t.mock.method(globalThis,'fetch',async()=>response());
  await assert.rejects(paddleApi(env,path,'GET',undefined,{onFailure:value=>seen.push(value)}),error=>error.message==='Paddle API response not successful: 200');
  assert.deepEqual(seen,[{reason:'response_invalid',status:200}]);safe(seen);t.mock.restoreAll();
 }
});

test('only documented fixed Paddle codes can explain HTTP failures',async t=>{
 for(const code of ['invalid_token','forbidden','not_found','invalid_field','authentication_missing','authentication_malformed','subscription_is_canceled_action_invalid','private response','__proto__',null]){
  const seen=[];t.mock.method(globalThis,'fetch',async()=>json({error:{code,detail:'synthetic-private-provider-body'},request_id:'synthetic-private-request'},403));
  await assert.rejects(paddleApi(env,path,'GET',undefined,{onFailure:value=>seen.push(value)}),error=>error.message==='Paddle API response not successful: 403');
  const allowed=typeof code==='string'&&!['private response','__proto__'].includes(code);
  assert.deepEqual(seen,[{reason:'http',status:403,...(allowed?{providerCode:code}:{})}]);safe(seen);t.mock.restoreAll();
 }
});

test('body-read timeouts report timeout while preserving the original response failure',async t=>{
 const seen=[];t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){controller.error(new DOMException('synthetic-private-timeout','AbortError'));}})));
 await assert.rejects(paddleApi(env,path,'GET',undefined,{onFailure:value=>seen.push(value)}),error=>error.message==='Paddle API response not successful: 200');
 assert.deepEqual(seen,[{reason:'timeout',status:200}]);safe(seen);
});

test('diagnostic status excludes non-integer and out-of-range response values',async t=>{
 for(const status of [0,99,600,200.5,'401',undefined]){
  const seen=[];t.mock.method(globalThis,'fetch',async()=>({ok:false,status,json:async()=>({error:'synthetic-private-provider-body'})}));
  await assert.rejects(paddleApi(env,path,'GET',undefined,{onFailure:value=>seen.push(value)}),error=>error.message==='Paddle API response not successful: '+status);
  assert.deepEqual(seen,[{reason:'http'}]);safe(seen);t.mock.restoreAll();
 }
});

test('throwing observers cannot turn a failure into success or replace its error',async t=>{
 t.mock.method(globalThis,'fetch',async()=>json({error:'synthetic-private-provider-body'},403));let calls=0;
 await assert.rejects(paddleApi(env,path,'GET',undefined,{onFailure:()=>{calls++;throw Error('observer failure');}}),error=>error.message==='Paddle API response not successful: 403');
 assert.equal(calls,1);
});

test('successful calls retain mode, credentials, request policy, body and returned data without diagnostics',async t=>{
 for(const [mode,host,key] of [['live','https://api.paddle.com',env.PADDLE_LIVE_API_KEY],['sandbox','https://sandbox-api.paddle.com',env.PADDLE_SANDBOX_API_KEY]]){
  const returned={id:'synthetic-returned-id',status:'canceled'},seen=[];
  t.mock.method(globalThis,'fetch',async(address,init)=>{
   assert.equal(address,host+path);assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer '+key);
   assert.equal(init.headers['Content-Type'],'application/json');assert.equal(init.body,JSON.stringify(body));assert.equal(init.redirect,'manual');assert.ok(init.signal instanceof AbortSignal);
   return {ok:true,status:200,json:async()=>({data:returned})};
  });
  assert.equal(await paddleApi({...env,BB_BILLING_MODE:mode},path,'POST',body,{onFailure:value=>seen.push(value)}),returned);assert.deepEqual(seen,[]);t.mock.restoreAll();
 }
});
