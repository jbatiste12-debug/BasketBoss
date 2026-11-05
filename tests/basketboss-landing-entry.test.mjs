import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const root=process.env.BB_LANDING_TEST_ROOT||path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const page=read('welcome.html');
const js=read('bb-family-landing.js');
const css=read('bb-family-landing.css');
const handler=read('functions/index.js');
const route=await import(pathToFileURL(path.join(root,'functions/index.js')).href);

test('the public root serves welcome with revalidation and preview robots protection',async()=>{
 const calls=[];
 const env={ASSETS:{fetch:async r=>{calls.push(r);return new Response('<html>Landing mock</html>',{status:200,headers:{'Content-Type':'text/html'}})}}};
 const r=await route.onRequest({request:new Request('https://basketboss.co.uk/'),env});
 assert.equal(r.status,200);assert.equal(await r.text(),'<html>Landing mock</html>');
 assert.equal(new URL(calls[0].url).pathname,'/welcome');
 assert.equal(r.headers.get('Cache-Control'),'no-cache, must-revalidate');
 assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal(r.headers.get('X-Robots-Tag'),null);
 const preview=await route.onRequest({request:new Request('https://abcd.basketboss-site.pages.dev/'),env});
 assert.equal(preview.headers.get('X-Robots-Tag'),'noindex, nofollow');
 const blocked=await route.onRequest({request:new Request('https://basketboss.co.uk/',{method:'POST'}),env});
 assert.equal(blocked.status,405);assert.equal(calls.length,2);
});

test('Start free hooks lead to the existing app, with pricing and policy routes reachable',()=>{
 const freeLinks=[...page.matchAll(/<a\b[^>]*\bdata-bbc-free\b[^>]*>/g)].map(match=>match[0]);
 assert.ok(freeLinks.length>=2,'Free calls to action appear at entry and later on the page');
 for(const link of freeLinks)assert.match(link,/href="\/app"/);
 for(const route of ['/pricing-sandbox.html','/compare.html','/privacy.html','/terms.html','/tutorial.html'])assert.ok(page.includes('href="'+route+'"'),route);
 assert.doesNotMatch(handler,/bb_paid_entitlements|SUPABASE_SECRET_KEY|BB_OWNER_USER_ID/);
});

test('existing-member redirects respect expiry and pending authentication callbacks',()=>{
 const source=[...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(script=>script.includes('basketboss_cloud_session_v1'));
 assert.ok(source,'existing-member entry guard is present');
 const now=Date.now(),session={user:{id:'test-user'},access_token:'test-session',expires_at:(now+3600000)/1000};
 function run({stored={},standalone=false,pending=false,blockedStorage=false}={}){
  const redirects=[];
  vm.runInNewContext(source,{window:{matchMedia:()=>({matches:standalone}),BBAuthCallbackBridge:{pending:()=>pending}},localStorage:{getItem:key=>{if(blockedStorage)throw Error('storage unavailable');return stored[key]??null;}},location:{replace:value=>redirects.push(value)},Date,JSON});
  return redirects;
 }
 assert.deepEqual(run(),[]);
 assert.deepEqual(run({stored:{basketboss_cloud_session_v1:JSON.stringify(session)}}),['/app']);
 assert.deepEqual(run({stored:{basketboss_cloud_session_v1:JSON.stringify({...session,expires_at:(now-1000)/1000})}}),[]);
 assert.deepEqual(run({stored:{basketboss_cloud_session_v1:JSON.stringify({...session,access_token:null})}}),[]);
 assert.deepEqual(run({stored:{bb_onboarding_fresh_once_20261028_v1:'{"complete":true}'}}),['/app']);
 assert.deepEqual(run({standalone:true}),['/app']);
 assert.deepEqual(run({standalone:true,pending:true,stored:{basketboss_cloud_session_v1:JSON.stringify(session)}}),[]);
 assert.deepEqual(run({stored:{basketboss_cloud_session_v1:'invalid JSON'}}),[]);
 assert.deepEqual(run({blockedStorage:true}),[]);
});

test('callback capture precedes other scripts and the landing makes no account or demo requests',()=>{
 const scripts=[...page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match=>match[1]);
 assert.match(scripts[0],/^bb-auth-callback\.js\?/);
 assert.ok(scripts.some(source=>/^bb-family-landing\.js\?/.test(source)));
 assert.doesNotMatch(page,/<script[^>]*src="(?:bb-beta-landing|bb-funnel|basketboss-pricing-v19)/);
 assert.match(page,/<meta name="referrer" content="no-referrer">/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|Authorization|\/api\/|\bfetch\s*\(|\.setItem\(|innerHTML|insertAdjacentHTML|eval\(/);
});

test('the savings-led hero presents £25 as a variable example target',()=>{
 const hero=page.match(/<section\b[^>]*\bclass="hero wrap"[^>]*>([\s\S]*?)<\/section>/)?.[1];
 assert.ok(hero);
 assert.match(hero,/<h1\b[^>]*>Aim to save<br><span>£25\+ a week\.<\/span><\/h1>/);
 assert.match(hero,/class="savings-note">An example target; your savings will vary\./);
 assert.match(page,/not a measured result or a guarantee/);
 assert.match(hero,/100 free recipes\. No payment card\./);
 assert.doesNotMatch(page,/Loved by thousands|star rating|App Store badge|Google Play badge|average savings|guaranteed £25/i);
});

test('the hero uses an app screenshot and preserves the public PWA identity',()=>{
 assert.match(page,/src="landing-assets\/basketboss-plan-build21\.png"/);
 assert.match(page,/Actual app screen · example plan/);
 assert.match(page,/alt="BasketBoss Plan screen[^"]+"/);
 assert.match(page,/<link rel="canonical" href="https:\/\/basketboss\.co\.uk\/">/);
 assert.match(page,/<link rel="manifest" href="\/manifest\.webmanifest">/);
 assert.match(page,/<link rel="apple-touch-icon" href="\/icons\/basketboss-crowned-v1766-192\.png">/);
});

test('stock and Premium claims retain confirmation, review and availability boundaries',()=>{
 assert.match(page,/Confirmed purchases add stock\. Confirmed cooking deducts it\./);
 assert.match(page,/Review and adjust what’s left/);
 assert.match(page,/Premium puts yellow-sticker food first/);
 assert.match(page,/AI outputs need review\. Daily limits and availability apply\./);
 assert.match(page,/<section[^>]*id="smart-receipt"[^>]*data-bb-smart-receipt-ready[^>]*hidden/);
 assert.match(page,/one verified household partner/);
});

test('the page exposes navigation, a skip target and native FAQ disclosure controls',()=>{
 assert.match(page,/<main id="main">/);
 assert.match(page,/<a class="skip" href="#main">/);
 assert.match(page,/<nav class="desktop-nav" aria-label="Main navigation">/);
 assert.ok((page.match(/<details\b/g)||[]).length>=3);
 assert.equal((page.match(/<details\b/g)||[]).length,(page.match(/<summary>/g)||[]).length);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/:focus-visible/);
});

test('no secret keys, QA tenant, personal details or fake endorsement is introduced',()=>{
 for(const content of [page,js,css,handler])assert.doesNotMatch(content,/cbucbdvwgmkgmsajtbfe|sb_secret_[a-z0-9]{20}|SUPABASE_SERVICE_ROLE_KEY|PADDLE_LIVE_API_KEY|BB_PARTNER_QA_MODE/);
 assert.doesNotMatch(page,/(?:fpdrivinggsy|@gmail\.com|session_id=|fake testimonial|thousands of customers)/i);
 assert.match(page,/PLAN SMARTER\. EAT BETTER\. LESS WASTE\./);
 assert.match(page,/Plan Smarter\. Eat Better\. Less Waste\./);
});

test('checkout and cancellation trust links remain available alongside Premium',()=>{
 const pricing=read('pricing-sandbox.html');
 assert.match(page,/Secure checkout via Paddle ·/);
 assert.match(page,/href="\/subscriptions\.html">Cancel anytime/);
 assert.equal((pricing.match(/class="bb-paddle-trust"/g)||[]).length,2);
 for(const tier of ['founder','monthly']){
  const button=pricing.indexOf(`data-plan="${tier}"`),trust=pricing.indexOf('class="bb-paddle-trust"',button);
  assert.ok(button>=0&&trust>button);
 }
 assert.match(pricing,/href="subscriptions\.html">Cancel anytime/);
});
