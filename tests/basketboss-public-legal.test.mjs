import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {onRequest as privacyRoute} from '../functions/privacy.js';
import {onRequest as termsRoute} from '../functions/terms.js';

const documents=[['privacy',privacyRoute],['terms',termsRoute]];
for(const [name,route] of documents){
 test(`/${name} is public, preserves the document and does not forward private request data`,async()=>{
  const calls=[];
  const content=await fs.readFile(new URL(`../${name}.html`,import.meta.url),'utf8');
  const env={ASSETS:{fetch:async request=>{calls.push(request);return new Response(content,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=86400'}});}}};
  const response=await route({request:new Request(`https://basketboss.co.uk/${name}?access_token=private`,{headers:{Authorization:'Bearer private',Cookie:'session=private'}}),env});
  assert.equal(response.status,200);
  assert.equal(await response.text(),content);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,`https://basketboss.co.uk/${name}`);
  assert.equal(calls[0].headers.get('Authorization'),null);
  assert.equal(calls[0].headers.get('Cookie'),null);
  assert.equal(response.headers.get('Cache-Control'),'no-cache, must-revalidate');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(response.headers.get('X-Robots-Tag'),null);
 });

 test(`/${name} supports bodyless HEAD and preview noindex without authentication`,async()=>{
  let method;
  const env={ASSETS:{fetch:async request=>{method=request.method;return new Response('asset',{headers:{'Content-Type':'text/html'}});}}};
  const response=await route({request:new Request(`https://branch.basketboss-site.pages.dev/${name}`,{method:'HEAD'}),env});
  assert.equal(method,'HEAD');
  assert.equal(response.status,200);
  assert.equal(await response.text(),'');
  assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
 });

 test(`/${name} rejects writes before accessing assets and preserves asset errors`,async()=>{
  for(const method of ['POST','PUT','PATCH','DELETE']){
   const response=await route({request:new Request(`https://basketboss.co.uk/${name}`,{method}),env:{get ASSETS(){throw new Error('Write must not reach assets');}}});
   assert.equal(response.status,405);
   assert.equal(response.headers.get('Allow'),'GET, HEAD');
   assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  const missing=await route({request:new Request(`https://www.basketboss.co.uk/${name}`),env:{ASSETS:{fetch:async()=>new Response('Missing asset',{status:404})}}});
  assert.equal(missing.status,404);
  assert.equal(await missing.text(),'Missing asset');
  assert.equal(missing.headers.get('X-Robots-Tag'),null);
 });
}

test('policy documents have public canonical URLs and navigation compatible with the offline iOS bundle',async()=>{
 for(const [name] of documents){
  const html=await fs.readFile(new URL(`../${name}.html`,import.meta.url),'utf8');
  assert.match(html,new RegExp(`<link rel="canonical" href="https://basketboss\\.co\\.uk/${name}">`));
  assert.match(html,/<main class="wrap">/);
  assert.match(html,/aria-label="Legal navigation"/);
  assert.match(html,/href="privacy\.html"/);
  assert.match(html,/href="terms\.html"/);
  assert.match(html,/script-src 'self'/);
  assert.match(html,/base-uri 'self'/);
  assert.doesNotMatch(html,/<script\b|<iframe\b/i);
 }
});

test('privacy explains actual data processors, receipt consent and the limits of account deletion',async()=>{
 const html=await fs.readFile(new URL('../privacy.html',import.meta.url),'utf8');
 for(const term of ['Supabase','Cloudflare D1','Google Gemini','Paddle','localStorage','Delete Account &amp; Data'])assert.ok(html.includes(term),term);
 assert.match(html,/Before an AI upload, the app asks for your permission/);
 assert.match(html,/Only after confirmation does BasketBoss save approved receipt metadata/);
 assert.match(html,/we do not promise zero retention by external providers/);
 assert.match(html,/reports that deletion is incomplete so you can retry/);
 assert.match(html,/does not remotely erase exported backups/);
 assert.match(html,/local app\/browser copies on another device/);
 assert.match(html,/records required for accounting, tax, fraud prevention or legal obligations/);
});
