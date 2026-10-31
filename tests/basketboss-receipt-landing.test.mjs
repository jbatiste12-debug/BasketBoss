import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {onRequest} from '../functions/index.js';
const html=await fs.readFile(new URL('../welcome.html',import.meta.url),'utf8');
const env={BB_RECEIPT_INVENTORY_ENABLED:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',CF_PAGES_BRANCH:'main',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_'+'a'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40),BILLING_DB:{prepare(){}},ASSETS:{fetch:async()=>new Response(html,{headers:{'Content-Type':'text/html'}})}};
test('SmartReceipt remains hidden until the production feature is configured',async()=>{
 assert.match(html,/<section[^>]*data-bb-smart-receipt-ready[^>]*hidden/);
 const response=await onRequest({request:new Request('https://basketboss.co.uk/'),env:{...env,BB_RECEIPT_INVENTORY_ENABLED:'false'}});
 assert.match(await response.text(),/<section[^>]*data-bb-smart-receipt-ready[^>]*hidden/);
});
test('configured live landing reveals the reviewed receipt workflow only',async()=>{
 const prior=globalThis.HTMLRewriter;const selected=[];let removed;
 globalThis.HTMLRewriter=class{on(selector,handler){selected.push(selector);handler.element({removeAttribute(name){removed=name;}});return this;}transform(response){return response;}};
 try{await onRequest({request:new Request('https://basketboss.co.uk/'),env});assert.deepEqual(selected,['[data-bb-smart-receipt-ready]']);assert.equal(removed,'hidden');}
 finally{globalThis.HTMLRewriter=prior;}
 assert.match(html,/review the matched items/i);assert.match(html,/Weekly Essentials/i);assert.match(html,/up to 5 scans/i);
});
test('preview and unconfigured backends never enable new receipt marketing',async()=>{
 for(const patch of [{CF_PAGES_BRANCH:'preview'},{SUPABASE_SECRET_KEY:''},{BB_BILLING_ENABLED:'false'}]){
  const response=await onRequest({request:new Request('https://basketboss.co.uk/'),env:{...env,...patch}});
  assert.match(await response.text(),/<section[^>]*data-bb-smart-receipt-ready[^>]*hidden/);
 }
});
