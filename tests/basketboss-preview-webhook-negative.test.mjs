/* Read-only negative-path tests for the actual webhook route.
   All requests synthetic; no database, Paddle, or HTTP provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const billingSource = await fs.readFile(new URL('bb-server-lib/bb-billing.js',root),'utf8');
const billingUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(billingSource).replace(/'/g,'%27');
let webhookSource = await fs.readFile(new URL('functions/api/paddle/webhook.js',root),'utf8');
const old = "from '../../../bb-server-lib/bb-billing.js'";
assert.ok(webhookSource.includes(old), 'expected locked webhook module dependency');
webhookSource = webhookSource.replace(old, `from '${billingUrl}'`);
const {onRequestPost} = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(webhookSource));
const url='https://preview.example/api/paddle/webhook';
const db={prepare:()=>{ throw Error('must not touch D1 in negative test'); }};
const request=(signature='ts=invalid;h1=invalid')=>new Request(url,{method:'POST',headers:{'Paddle-Signature':signature},body:'{}'});

test('webhook refuses all requests when billing is disabled (Preview default)',async()=>{
  const response=await onRequestPost({request:request(),env:{BB_BILLING_MODE:'sandbox',BB_BILLING_ENABLED:'false',BILLING_DB:db,PADDLE_SANDBOX_WEBHOOK_SECRET:'fake'}});
  assert.equal(response.status,503);
});

test('webhook refuses enabled sandbox with absent webhook secret',async()=>{
  const response=await onRequestPost({request:request(),env:{BB_BILLING_MODE:'sandbox',BB_BILLING_ENABLED:'true',BILLING_DB:db}});
  assert.equal(response.status,503);
});

test('webhook refuses invalid Paddle signature without touching D1',async()=>{
  const response=await onRequestPost({request:request(),env:{BB_BILLING_MODE:'sandbox',BB_BILLING_ENABLED:'true',BILLING_DB:db,PADDLE_SANDBOX_WEBHOOK_SECRET:'fake'}});
  assert.equal(response.status,401);
});

test('live webhook remains disabled without separately enabled live webhook flag',async()=>{
  const response=await onRequestPost({request:request(),env:{BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',BILLING_DB:db,PADDLE_LIVE_WEBHOOK_SECRET:'fake',BB_LIVE_WEBHOOK_ENABLED:'false'}});
  assert.equal(response.status,503);
});

test.todo('Paddle adjustment.created/updated refund and chargeback entitlement policy: requires design and sandbox validation');
test.todo('Paddle subscription lifecycle, replay and out-of-order handling: requires D1 and sandbox integration acceptance');
