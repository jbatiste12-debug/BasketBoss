import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createAppleFetch,Headers} from '../bb-server-lib/bb-apple-fetch.js';

test('Apple transport sends exact OCSP DER bytes and returns a Node Buffer without a text roundtrip',async()=>{
 const request=Buffer.from([0,255,128,1,13,10,0]),reply=Buffer.from([48,130,0,255,128,10,13]),headers=new Headers({'Content-Type':'application/ocsp-request'});let seen;
 const perform=createAppleFetch({fetch:async(url,init)=>{seen={url,init};return new Response(reply,{status:200,headers:{'Content-Type':'application/ocsp-response'}});}});
 const response=await perform('http://ocsp.fixture.test/status',{method:'POST',headers,body:request,timeout:30000});
 assert.equal(seen.url,'http://ocsp.fixture.test/status');assert.equal(seen.init.method,'POST');assert.equal(seen.init.headers,headers);assert.deepEqual(seen.init.body,request);assert.equal('timeout' in seen.init,false);assert.ok(seen.init.signal instanceof AbortSignal);
 assert.equal(response.status,200);assert.equal(response.ok,true);assert.equal(response.headers.get('content-type'),'application/ocsp-response');const bytes=await response.buffer();assert.equal(Buffer.isBuffer(bytes),true);assert.deepEqual(bytes,reply);await assert.rejects(response.buffer(),TypeError,'body remains single-use');
});
test('Apple API JSON and error response status are preserved for the official SDK to interpret',async()=>{
 const perform=createAppleFetch({fetch:async()=>new Response(JSON.stringify({errorCode:4040010,errorMessage:'fixture transaction missing'}),{status:404,statusText:'Not Found',headers:{'Content-Type':'application/json'}})});
 const response=await perform('https://api.storekit.example.test/inApps/v1/transactions/1');assert.equal(response.ok,false);assert.equal(response.status,404);assert.equal(response.statusText,'Not Found');assert.deepEqual(await response.json(),{errorCode:4040010,errorMessage:'fixture transaction missing'});
 const empty=await createAppleFetch({fetch:async()=>new Response(null,{status:204})})('https://fixture.test');assert.equal(empty.status,204);assert.equal((await empty.buffer()).length,0);
});
test('network failures remain rejected and release the timeout',async()=>{
 const failure=Error('fixture network failure'),cancelled=[];let scheduled;
 const perform=createAppleFetch({fetch:async()=>{throw failure;},setTimeout:(fn,ms)=>{scheduled={fn,ms};return 123;},clearTimeout:id=>cancelled.push(id)});
 await assert.rejects(perform('http://ocsp.fixture.test',{timeout:30000}),error=>error===failure);assert.equal(scheduled.ms,30000);assert.deepEqual(cancelled,[123]);
});
test('timeout covers a stalled response body and cancellation propagates to native fetch',async()=>{
 let expire,requestSignal,clearCount=0;
 const perform=createAppleFetch({setTimeout:fn=>{expire=fn;return 1;},clearTimeout:()=>clearCount++,fetch:async(_url,{signal})=>{requestSignal=signal;return {body:{},arrayBuffer:()=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})};}});
 const pending=perform('http://ocsp.fixture.test',{timeout:30000});await Promise.resolve();const rejected=assert.rejects(pending,error=>error.name==='TimeoutError');expire();await rejected;assert.equal(requestSignal.aborted,true);assert.equal(clearCount,1);
});
test('existing abort signals are honored, forwarded, and detached after request completion',async()=>{
 const upstream=new AbortController();let requestSignal;
 const perform=createAppleFetch({fetch:async(_url,{signal})=>{requestSignal=signal;return new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}});
 const pending=perform('http://ocsp.fixture.test',{signal:upstream.signal,timeout:30000}),failure=Error('fixture cancelled');const rejected=assert.rejects(pending,error=>error===failure);upstream.abort(failure);await rejected;assert.equal(requestSignal.aborted,true);
 const already=new AbortController();already.abort(failure);await assert.rejects(perform('http://ocsp.fixture.test',{signal:already.signal,timeout:30000}),error=>error===failure);
 const response=await createAppleFetch({fetch:async(_url,{signal})=>{assert.equal(signal,upstream.signal);return Response.json({ok:true});}})('https://fixture.test',{signal:upstream.signal});assert.deepEqual(await response.json(),{ok:true});
});
