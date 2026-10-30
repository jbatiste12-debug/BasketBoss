import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.env.BB_LANDING_TEST_ROOT||path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const page=read('welcome.html');
const js=read('bb-beta-landing.js');
const css=read('bb-beta-landing.css');
const handler=read('functions/index.js');
const route=await import('data:text/javascript;base64,'+Buffer.from(handler).toString('base64'));
test('only the official root route serves the new public landing document',async()=>{
 const calls=[];
 const env={ASSETS:{fetch:async r=>{calls.push(r);return new Response('<html>Landing mock</html>',{status:200,headers:{'Content-Type':'text/html'}})}}};
 const r=await route.onRequest({request:new Request('https://basketboss.co.uk/'),env});
 assert.equal(r.status,200);
 assert.equal(await r.text(),'<html>Landing mock</html>');
 assert.equal(new URL(calls[0].url).pathname,'/welcome');
 assert.equal(r.headers.get('Cache-Control'),'no-cache, must-revalidate');
 assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal(r.headers.get('X-Robots-Tag'),null);
 const preview=await route.onRequest({request:new Request('https://abcd.basketboss-site.pages.dev/'),env});
 assert.equal(preview.headers.get('X-Robots-Tag'),'noindex, nofollow');
 const blocked=await route.onRequest({request:new Request('https://basketboss.co.uk/',{method:'POST'}),env});
 assert.equal(blocked.status,405);assert.equal(calls.length,2);
});
test('the existing app and signup remain reachable, no rewriting index',()=>{
 assert.match(page,/href="\/app"/);
 assert.match(page,/href="\/pricing-sandbox\.html"/);
 assert.match(page,/basketboss_cloud_session_v1/);
 assert.match(page,/bb_onboarding_fresh_once_20261028_v1/);
 assert.match(page,/location\.replace\('\/app'\)/);
 assert.doesNotMatch(handler,/bb_paid_entitlements|SUPABASE_SECRET_KEY|BB_OWNER_USER_ID/);
});
test('real public recipe images, source catalogue and only read-only interactive demo',()=>{
 assert.match(page,/fajitas\.webp/);
 assert.match(page,/creamy-pasta\.webp/);
 assert.match(page,/chickpea-curry\.webp/);
 assert.match(js,/fetch\('\/recipes\.json'/);
 assert.match(js,/data\.length!==100/);
 assert.match(js,/renderShopping\(\)/);
 assert.match(js,/Math\.max\(1,portions\[i\]-1\)/);
 assert.match(js,/Math\.min\(10,portions\[i\]\+1\)/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|Authorization|\/api\/|bb_paid_entitlements|\.setItem\(/);
 assert.doesNotMatch(page,/Upload this device|Restore cloud plan|No Paddle subscription|Loved by thousands|reviews|star rating/i);
});
test('no secret keys or QA tenant introduced in public landing',()=>{
 for(const content of [page,js,css,handler]){
  assert.doesNotMatch(content,/cbucbdvwgmkgmsajtbfe|sb_secret_[a-z0-9]{20}|SUPABASE_SERVICE_ROLE_KEY|PADDLE_LIVE_API_KEY|BB_PARTNER_QA_MODE/);
 }
});
test('responsive layout, landmark and accessible interactive controls',()=>{
 assert.match(page,/<main id="main">/);
 assert.match(page,/<nav class="desktop-nav" aria-label="Main navigation">/);
 assert.match(page,/aria-selected="true"/);
 assert.match(page,/aria-live="polite"/);
 assert.match(css,/@media\(max-width:570px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('verified BasketBoss slogan, mobile presentation and correct public app links',()=>{
 assert.match(page,/PLAN SMARTER\. EAT BETTER\. LESS WASTE\./);
 assert.match(page,/Plan Smarter\. Eat Better\. Less Waste\./);
 assert.match(page,/bb-app-snapshot/);
 assert.match(page,/bb-app-bottom/);
 assert.match(page,/Sample view/);
 assert.match(page,/release-assets\/basketboss-v17\/images\/existing\/fajitas.webp/);
 assert.match(page,/href="\/app"/);
 assert.doesNotMatch(page,/(?:fpdrivinggsy|@gmail\.com|sb_secret_|session_id=)/i);
});
test('shopping preview uses real recipe ingredient quantities and grouped aisles, not a marketing-only checklist',()=>{
 assert.match(js,/AISLE_ORDER/);
 assert.match(js,/function rowsForShopping\(\)/);
 assert.match(js,/r\.ingredients/);
 assert.match(js,/portions\[i\]\/Number\(r\.servings/);
 assert.match(js,/shop-item-price/);
 assert.match(js,/shopping progress|Sample shopping progress/i);
 assert.match(js,/demoChecked\.add/);
 assert.match(js,/demoChecked\.delete/);
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML|eval\(/);
});
test('pack and pantry example requires a deliberate demo action, makes no customer writes',()=>{
 assert.match(page,/500g pack → 200g needed/);
 assert.match(page,/300g left/);
 assert.match(page,/Next week&#39;s 250g recipe|Next week's 250g recipe/);
 assert.match(page,/Fresh food requires safe-storage confirmation/);
 assert.match(page,/No real purchases, pantry changes or account data/);
 assert.match(js,/confirm-pantry-demo/);
 assert.match(js,/300g in Kitchen/);
 assert.match(js,/0g to buy · 50g remains/);
 assert.match(js,/render\(false\)/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|Authorization|\/api\/|bb_paid_entitlements|\.setItem\(/);
});

test('Cook Mode preview reads actual public recipe method, with no private data access',()=>{
 assert.match(page,/id="cook-demo"/);
 assert.match(page,/step-by-step cooking instructions/);
 assert.match(js,/cookRecipe=publicRecipes\.find/);
 assert.match(js,/cookRecipe\.method/);
 assert.match(js,/cook-step-text/);
 assert.doesNotMatch(js,/sessionStorage|localStorage|Authorization|\/api\/|\.setItem\(/);
});

test('approved family-first cards reuse actual BasketBoss recipe assets and no account data',()=>{
 assert.match(page,/class="features features-rich features-compact"/);
 assert.match(page,/Sheet-pan chicken fajitas/);
 assert.match(page,/real, step-by-step recipe instructions/);
 assert.match(page,/release-assets\/basketboss-v17\/images\/existing\/fajitas\.webp/);
 assert.match(page,/class="feature-serving-control"/);
 assert.doesNotMatch(page,/2 <span>−<\/span> 4/);
 assert.match(css,/features-rich/);
});
test('shopping aggregation totals compatible quantities without guessing packs',()=>{
 assert.match(js,/function combinedQuantity\(amounts\)/);
 assert.match(js,/combinedQuantity\(row\.amounts\)/);
 assert.match(js,/unitAliases/);
 assert.match(js,/values\.join\(' \+ '\)/);
 assert.doesNotMatch(js,/row\.amounts\.join\(' \+ '\)/);
});

test('compact genuine-assets hero and three-column family feature previews',()=>{
 assert.match(page,/class="hero-art hero-app-preview"/);
 assert.match(page,/class="bb-app-snapshot"/);
 assert.match(page,/illustrative sample, not a captured account screen/);
 assert.match(page,/features-rich features-compact/);
 assert.match(page,/class="feature-serving-control"/);
 assert.doesNotMatch(page,/class="phone-shell"/);
 assert.match(css,/features-compact\{display:grid!important;grid-template-columns:repeat\(3/);
 assert.match(page,/release-assets\/basketboss-v17\/images\/existing\/fajitas\.webp/);
});


test('final hero is a phone-framed public sample, not a fabricated screenshot',()=>{
 assert.match(page,/class="hero-art hero-app-preview"/);
 assert.match(page,/class="bb-device"/);
 assert.match(page,/class="bb-device-speaker"/);
 assert.match(page,/class="bb-device-home"/);
 assert.match(page,/not a captured account screen/);
 assert.doesNotMatch(page,/class="phone-shell"/);
 assert.match(css,/\.bb-device\{position:relative/);
});
test('mobile cards keep generous internal padding and responsive preview sizing',()=>{
 assert.match(css,/@media\(max-width:580px\)/);
 assert.match(css,/features-compact article\{padding:20px!important/);
 assert.match(css,/feature-mini\{padding:13px!important/);
 assert.match(css,/@media\(max-width:370px\)/);
});
test('free planning calls to action are prominent with readable contrast',()=>{
 assert.match(page,/Start planning free/);
 assert.match(page,/class="button solid large" href="\/app">Start planning free/);
 assert.match(css,/background:#075431!important;color:#fff!important/);
});
test('secure checkout and cancellation trust copy is underneath both pricing tiers',()=>{
 const pricing=read('pricing-sandbox.html');
 assert.match(page,/Secure checkout via Paddle ·/);
 assert.equal((pricing.match(/class="bb-paddle-trust"/g)||[]).length,2);
 for(const tier of ['founder','monthly']){
  const button=pricing.indexOf(`data-plan="${tier}"`);
  const trust=pricing.indexOf('class="bb-paddle-trust"',button);
  assert.ok(button>=0&&trust>button);
 }
 assert.match(pricing,/Secure checkout via Paddle/);
 assert.match(pricing,/href="subscriptions\.html">Cancel anytime/);
 assert.match(pricing,/paddle-sandbox\.js|class="bb-paddle-trust"/);
});


test('father-of-four founder story uses the original submitted photo in one circular portrait',()=>{
 assert.match(page,/id="about-founder"/);
 assert.match(page,/Why I built BasketBoss/);
 assert.match(page,/As a father of four/);
 assert.match(page,/src="\/bb-founder-portrait\.jpg"/);
 assert.match(page,/class="bb-founder-portrait"/);
 assert.match(css,/\.bb-founder-portrait img\{[^}]*border-radius:50%;object-fit:cover/);
 assert.ok(page.indexOf('id="about-founder"')<page.indexOf('id="premium"'));
 assert.match(css,/\.bb-founder-section/);
 assert.doesNotMatch(page,/fake testimonial|thousands of customers|founder family photo|helmet illustration/i);
 assert.equal((page.match(/bb-founder-portrait\.jpg/g)||[]).length,1);
});

test('founder photograph is the actual staged JPEG and no generated portrait is referenced',()=>{
 const photo=fs.readFileSync(path.join(root,'bb-founder-portrait.jpg'));
 assert.ok(photo.length>30000);
 assert.equal(photo[0],0xff);assert.equal(photo[1],0xd8);
 assert.doesNotMatch(page,/AI-generated founder|generated firefighter|firefighter-illustration|decorative-helmet/i);
});
