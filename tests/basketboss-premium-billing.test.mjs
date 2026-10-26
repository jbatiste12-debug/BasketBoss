import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Load the dependency-free ES module without changing the repository's module type.
const source=await fs.readFile(new URL('../bb-server-lib/bb-billing.js',import.meta.url),'utf8');
const lib=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
const price = c => 'pri_'+c.repeat(26);
const base={BB_BILLING_ENABLED:'true',PADDLE_SANDBOX_API_KEY:'sandbox_FAKE',PADDLE_LIVE_API_KEY:'live_FAKE',
  PADDLE_SANDBOX_STANDARD_PRICE_ID:price('s'), PADDLE_LIVE_STANDARD_PRICE_ID:price('l'),
  PADDLE_SANDBOX_FOUNDER_PRICE_ID:price('f'),PADDLE_LIVE_FOUNDER_PRICE_ID:price('g')};

test('billing disabled is fail-closed for either mode',()=>{
  for(const mode of ['sandbox','live','unknown']){
    const e={...base,BB_BILLING_MODE:mode,BB_BILLING_ENABLED:'false'};
    assert.equal(lib.isBillingEnabled(e),false); assert.equal(lib.expectedPrice(e,'standard'),null);
  }
});

test('sandbox and live prices must be different',()=>{
  const s={...base,BB_BILLING_MODE:'sandbox'};
  const l={...base,BB_BILLING_MODE:'live'};
  assert.equal(lib.isSandbox(s),true);assert.equal(lib.isLive(s),false);
  assert.equal(lib.isSandbox(l),false);assert.equal(lib.isLive(l),true);
  assert.equal(lib.expectedPrice(s,'standard'),price('s'));
  assert.equal(lib.expectedPrice(l,'standard'),price('l'));
  assert.equal(lib.expectedPrice(s,'founder'),price('f'));
  assert.equal(lib.expectedPrice(l,'founder'),price('g'));
  assert.equal(lib.expectedPrice(s,'annual'),null);
  assert.equal(lib.expectedPrice(l,'annual'),null);
});

test('Paddle requests use separate credentials and hosts and never follow redirects',async()=>{
  const realFetch=globalThis.fetch;
  const seen=[];
  try{
    globalThis.fetch=async (url,opts)=>{
      seen.push({url,opts});
      return new Response(JSON.stringify({data:{id:'fake'}}), {status:200,headers:{'content-type':'application/json'}});
    };
    for(const [mode,host,apiKey] of [['sandbox','https://sandbox-api.paddle.com','sandbox_FAKE'],['live','https://api.paddle.com','live_FAKE']]){
      const output=await lib.paddleApi({...base,BB_BILLING_MODE:mode},'/transactions','GET');
      assert.equal(output.id,'fake');
      const call=seen.at(-1); assert.equal(call.url,host+'/transactions');
      assert.equal(call.opts.headers.Authorization,'Bearer '+apiKey);
      assert.equal(call.opts.redirect,'manual');
    }
    globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://example.invalid'}});
    await assert.rejects(lib.paddleApi({...base,BB_BILLING_MODE:'sandbox'},'/transactions'),/not successful/);
  }finally{globalThis.fetch=realFetch;}
});

test('Make a Meal does not advertise unsupported annual or 3-day plans',async()=>{
  const html=await fs.readFile(new URL('../make-a-meal.html',import.meta.url),'utf8');
  assert.ok(html.includes('Founding Member'));
  assert.ok(html.includes('7 days free'));
  assert.ok(html.includes('no Standard trial currently offered'));
  for(const text of ['£49.90','3-day trial','pricing-sandbox.html#annual'])
    assert.equal(html.includes(text),false,'obsolete offer: '+text);
});
