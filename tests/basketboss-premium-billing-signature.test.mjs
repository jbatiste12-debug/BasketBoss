/* Additional negative-path tests for the existing Paddle billing helper.
   These are local tests only: they never contact Paddle or Cloudflare. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const source=await fs.readFile(new URL('../bb-server-lib/bb-billing.js',import.meta.url),'utf8');
const billing=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
const nowMs=Date.parse('2026-10-27T12:00:00Z');
const ts=String(nowMs/1000);
const secret='isolated_test_secret_not_real';
const body=JSON.stringify({event_id:'evt_demo',event_type:'subscription.updated'});
async function signature(payload=body,time=ts,signingSecret=secret){
  const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(signingSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(time+':'+payload));
  return Buffer.from(bytes).toString('hex');
}
const request=value=>new Request('https://preview.example/api/paddle/webhook',{
  method:'POST',headers:{'Paddle-Signature':value},body
});

test('Paddle signature accepts exact raw-body HMAC within allowed time',async()=>{
  assert.equal(await billing.verifyPaddleSignature(request(`ts=${ts};h1=${await signature()}`),body,secret,nowMs),true);
});

test('Paddle signature rejects tampering, wrong secret and unsigned body',async()=>{
  const header=`ts=${ts};h1=${await signature()}`;
  assert.equal(await billing.verifyPaddleSignature(request(header),body+' ',secret,nowMs),false);
  assert.equal(await billing.verifyPaddleSignature(request(header),body,'a_different_secret',nowMs),false);
  assert.equal(await billing.verifyPaddleSignature(request(`ts=${ts}`),body,secret,nowMs),false);
  assert.equal(await billing.verifyPaddleSignature(request(header),body,'',nowMs),false);
});

test('Paddle signature rejects stale, future and malformed timestamps',async()=>{
  for(const delta of [-301,301]){
    const altered=String(Number(ts)+delta);
    assert.equal(await billing.verifyPaddleSignature(request(`ts=${altered};h1=${await signature(body,altered)}`),body,secret,nowMs),false);
  }
  assert.equal(await billing.verifyPaddleSignature(request(`ts=wrong;h1=${await signature()}`),body,secret,nowMs),false);
});

test('Paddle signature rejects malformed h1 but supports multiple headers',async()=>{
  const good=await signature();
  assert.equal(await billing.verifyPaddleSignature(request(`ts=${ts};h1=zzzz;h1=${good}`),body,secret,nowMs),true);
  assert.equal(await billing.verifyPaddleSignature(request(`ts=${ts};h1=${good.slice(1)}`),body,secret,nowMs),false);
});

test('billing operations and Premium price IDs fail closed when disabled',()=>{
  const env={BB_BILLING_ENABLED:'false',BB_BILLING_MODE:'live',PADDLE_LIVE_API_KEY:'fake',PADDLE_LIVE_STANDARD_PRICE_ID:'pri_'+'a'.repeat(26)};
  assert.equal(billing.isBillingEnabled(env),false);
  assert.equal(billing.expectedPrice(env,'standard'),null);
  assert.equal(billing.entitlementForStatus('past_due'),false);
  assert.equal(billing.entitlementForStatus('paused'),false);
  assert.equal(billing.entitlementForStatus('canceled'),false);
  assert.equal(billing.entitlementForStatus('active'),true);
  assert.equal(billing.entitlementForStatus('trialing'),true);
});

test('server requires matching Origin for checkout requests',()=>{
  const url='https://preview.example/api/subscription/checkout';
  assert.equal(billing.requireSameOrigin(new Request(url)),false);
  assert.equal(billing.requireSameOrigin(new Request(url,{headers:{Origin:'https://evil.example'}})),false);
  assert.equal(billing.requireSameOrigin(new Request(url,{headers:{Origin:'https://preview.example'}})),true);
});
