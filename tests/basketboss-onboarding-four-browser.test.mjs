import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { transform700Html, transform700Planning, transform700PreviewConfig, validatePublic700Release } from '../tools/catalogue700/build-client.mjs';
import { transform700Presentation } from '../tools/catalogue700/presentation.mjs';

const require = createRequire(import.meta.url), root = fileURLToPath(new URL('..', import.meta.url));
const SESSION = 'basketboss_cloud_session_v1', ONBOARDING = 'bb_onboarding_fresh_once_20261028_v1';
const SYNTHETIC_EMAIL = 'family@example.invalid', SYNTHETIC_PASSWORD = 'synthetic-password-for-local-tests';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const PRIOR_USER_ID = '00000000-0000-4000-8000-000000000002';
let chromium, browser, release, app;
for (const name of [process.env.BB_PLAYWRIGHT_MODULE, 'playwright', '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(name)); break; } catch {}
}
before(async () => {
  release = validatePublic700Release({ directory: path.join(root, 'catalogues/700/release'), sourceDirectory: root });
  const source = await fs.readFile(path.join(root, 'app.html'), 'utf8'), anchor = 'window.BBHomeHost=Object.freeze({';
  assert.ok(source.includes(anchor));
  // Read-only observations of the real app closure: no replacement planning,
  // pantry, auth SDK or session implementation is injected into this document.
  app = transform700Presentation(transform700Html(source, release)).replace(anchor, `window.__authOnboardingQA={ready:()=>RECIPES.length===200&&!!window.BBAuthFlow,draft:()=>({planned:JSON.parse(JSON.stringify(state.planned)),pantry:JSON.parse(JSON.stringify(state.pantry)),stock:bb307ReadStock(),inventory:localStorage.getItem('basketboss_makeameal_v1_inventory')})};` + anchor);
  if (chromium) browser = await chromium.launch({ headless: true, executablePath: process.env.BB_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); });

function user(confirmed = true, provider = 'email', actorId = USER_ID) {
  return { id: actorId, aud: 'authenticated', role: 'authenticated', email: actorId === USER_ID ? SYNTHETIC_EMAIL : 'prior-household@example.invalid',
    created_at: '2026-11-01T00:00:00Z', updated_at: new Date().toISOString(),
    email_confirmed_at: confirmed ? '2026-11-01T00:00:00Z' : null,
    confirmation_sent_at: '2026-11-01T00:00:00Z', app_metadata: { provider, providers: [provider] }, user_metadata: {},
    identities: [{ id: actorId, user_id: actorId, provider, identity_data: { sub: actorId } }] };
}
function session(provider = 'email', actorId = USER_ID) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: actorId, exp: expires, aud: 'authenticated', role: 'authenticated' }) + '.synthetic-signature';
  return { access_token: token, refresh_token: 'synthetic-refresh-only-for-local-routing', token_type: 'bearer', expires_in: 3600, expires_at: expires, user: user(true, provider, actorId) };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture({ returning = false, existingSession = false, native = false, savedOnboarding = null, flowData = null, width = 390, height = 844, trialEligible = false, appleProvider = false, deletionReady = true, signupOutcomes = ['pending'], holdSignup = false, verificationState = { used: false }, priorProfile = false, holdCloud = false, initialActor = USER_ID, rejectPasswordOnce = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], authRequests = [], events = [], cloudWrites = [], checks = { deletion: false, cloudPending: false }, gate = deferred(), cloudGate = deferred();
  let signupCount = 0, passwordAttempts = 0, connected = existingSession, premium = false;
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  // All traffic is fulfilled here. Synthetic credentials never reach a real
  // Supabase project; request observations deliberately exclude their values.
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    // GoTrue advertises this version in production. The real SDK only treats
    // modern `code` fields as error categories when that response header exists.
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: url.hostname.endsWith('.supabase.co') ? {
      'X-Supabase-Api-Version': '2024-01-01',
      'Access-Control-Allow-Origin': 'https://basketboss.co.uk',
      'Access-Control-Expose-Headers': 'X-Supabase-Api-Version',
      'Vary': 'Origin',
    } : {}, body: JSON.stringify(data) });
    if (url.hostname.endsWith('.supabase.co')) {
      if (url.pathname === '/auth/v1/settings') return json({ external: { email: true, apple: appleProvider }, disable_signup: false });
      if (url.pathname === '/auth/v1/signup') {
        const body = request.postDataJSON();
        authRequests.push({ kind: 'signup', correctEmail: body.email === SYNTHETIC_EMAIL, passwordPresent: typeof body.password === 'string', pkce: typeof body.code_challenge === 'string' && body.code_challenge.length > 10 });
        const outcome = signupOutcomes[Math.min(signupCount++, signupOutcomes.length - 1)];
        if (holdSignup && signupCount === 1) await gate.promise;
        if (outcome === 'validation') return json({ code: 'weak_password', msg: 'Use a stronger password.', weak_password: { reasons: ['length'] } }, 422);
        if (outcome === 'network') return route.abort('internetdisconnected');
        return json(user(false));
      }
      if (url.pathname === '/auth/v1/token') {
        const body = request.postDataJSON(), grant = url.searchParams.get('grant_type');
        authRequests.push({ kind: 'token', grant, correctEmail: body.email === SYNTHETIC_EMAIL, passwordPresent: typeof body.password === 'string', hasVerifier: typeof body.code_verifier === 'string' && body.code_verifier.length > 10, appleNonce: body.nonce === 'synthetic-native-nonce', appleProvider: body.provider === 'apple' });
        if (grant === 'password' && rejectPasswordOnce && passwordAttempts++ === 0) return json({ code: 'invalid_credentials', msg: 'Invalid login credentials.' }, 400);
        connected = true;
        return json(session(grant === 'id_token' ? 'apple' : 'email'));
      }
      if (url.pathname === '/auth/v1/verify') {
        const body = request.postDataJSON();
        authRequests.push({ kind: 'verify-otp', signupType: body.type === 'signup', tokenHashPresent: body.token_hash === 'synthetic-one-use-confirmation-hash', verifierAbsent: !body.code_verifier });
        if (verificationState.used || body.token_hash !== 'synthetic-one-use-confirmation-hash') return json({ code: 'otp_expired', msg: 'This email link is invalid or has expired.' }, 403);
        verificationState.used = true; connected = true;
        return json(session());
      }
      if (url.pathname === '/auth/v1/user') { authRequests.push({ kind: 'verified-user' }); return json(user(true, native ? 'apple' : 'email')); }
      if (url.pathname === '/auth/v1/logout') return json({});
      if (url.pathname === '/rest/v1/basketboss_data') {
        if (request.method() === 'GET') {
          authRequests.push({ kind: 'cloud-read', ownActor: url.searchParams.get('user_id') === 'eq.' + USER_ID });
          if (holdCloud) { checks.cloudPending = true; await cloudGate.promise; checks.cloudPending = false; }
        } else if (request.method() === 'POST') {
          const body = request.postDataJSON();
          cloudWrites.push({ ownActor: body.user_id === USER_ID, plannedCount: body.data?.planned?.length ?? 0, containsPriorMeal: body.data?.planned?.some(row => row.recipeId === 'veggie-fried-rice') === true });
        }
        return json([]);
      }
      return json([]);
    }
    if (!['basketboss.co.uk', 'www.basketboss.co.uk'].includes(url.hostname)) return route.fulfill({ status: 200, body: '' });
    if (url.pathname.startsWith('/api/funnel/')) {
      events.push({ name: url.pathname.split('/').pop(), bodyAbsent: request.postData() === null, authorizationAbsent: !request.headers().authorization, cookieAbsent: !request.headers().cookie });
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.pathname === '/api/auth/apple-config') {
      const fulfilled = await json({ available: deletionReady, nativeOnly: true, deletionReady });
      checks.deletion = true;
      return fulfilled;
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/subscription/status') return json({ authenticated: connected, tier: premium?'premium':'free', premium, premiumAccess: premium, mode:'live', subscription: null });
      if (url.pathname === '/api/household') return json({ configured: false, premium: false, items: [] });
      if (url.pathname === '/api/receipt-inventory') return json({ ok: true, configured: false, available: false });
      if (url.pathname === '/api/recipes/v700/premium') return json({ error: 'Local guest fixture' }, 403);
      return json({ ok: true });
    }
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '').replace(/^pwa700\//, '');
    if (['app', 'app.html', 'index', 'index.html', ''].includes(relative)) relative = 'app.html';
    if (relative.includes('..')) return route.fulfill({ status: 404, body: '' });
    try {
      let body = app;
      if (relative !== 'app.html') {
        try { body = await fs.readFile(path.join(root, relative)); } catch { body = await fs.readFile(path.join(root, 'catalogues/700/release/assets', relative)); }
        if (relative === 'bb-recipe-planning.js') body = transform700Planning(body.toString(), release.roles);
        else if (relative === 'bb-premium-preview-config.js') body = transform700PreviewConfig(body.toString(), release);
        if (relative.endsWith('.js')) body = transform700Presentation(body.toString());
      }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
      return route.fulfill({ status: 200, contentType: types[path.extname(relative)] || 'application/octet-stream', body });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await context.addInitScript(({ returning, existingSession, native, savedSession, onboardingKey, sessionKey, priorProfile, priorActor, savedOnboarding, flowData, trialEligible }) => {
    if (!localStorage.getItem('auth-onboarding-browser-fixture-v1')) {
      localStorage.setItem('basketboss_321_unified_state_v1', JSON.stringify({ version: 2, planned: returning ? [{ recipeId: 'veggie-fried-rice', day: 'Monday', servings: 3 }] : [], plannedBreakfasts: [], plannedDesserts: [], servings: 4, feedingSet: true, pantry: returning ? { Rice: true } : {}, mealPreferences: { version: 1, scope: 'guest', diets: [], goals: [] } }));
      localStorage.setItem('basketboss_321_v7_measured_pantry', JSON.stringify(returning ? { 'long-grain rice|g': 300 } : {}));
      localStorage.setItem('basketboss_321_v7_market', 'UK');
      if (priorProfile) {
        const oldPlan = localStorage.getItem('basketboss_321_unified_state_v1');
        localStorage.setItem('basketboss_receipt_host_actor_v1', JSON.stringify({ version: 1, actorId: priorActor, localAccountSeen: true }));
        localStorage.setItem('basketboss_321_unified_recovery_v1', oldPlan);
        localStorage.setItem('basketboss_state_v2', oldPlan);
        localStorage.setItem('basketboss_321_unified_oldplan_v1', JSON.stringify([{ meal: { id: 'veggie-fried-rice' }, assignedDay: 'Monday' }]));
        localStorage.setItem('basketboss_321_unified_oldpantry_v1', JSON.stringify({ Rice: true }));
      }
      localStorage.setItem('basketboss_how_it_works_v1', JSON.stringify({ version: 1, seen: true }));
      sessionStorage.setItem('basketboss_welcome_splash_seen_v1', '1');
      if (returning) localStorage.setItem(onboardingKey, JSON.stringify({ complete: true, started: false, step: 10 }));
      if (existingSession) localStorage.setItem(sessionKey, JSON.stringify(savedSession));
      if(savedOnboarding)localStorage.setItem(onboardingKey,JSON.stringify(savedOnboarding));
      if(flowData)localStorage.setItem('bb_onboarding_four_step_v1',JSON.stringify(flowData));
      localStorage.setItem('auth-onboarding-browser-fixture-v1', '1');
    }
    if (native) {
      window.BasketBossNativeTrialOffer={isEligible:()=>trialEligible};
      window.BBNativeMembership={open(){window.__membershipOpened=(window.__membershipOpened||0)+1;return true;}};
      window.BBNative = { isNative: true, apiURL: value => 'https://basketboss.co.uk' + value };
      window.__nativeAppleCalls = 0;
      window.BBNativeAppleAuth = { available: async () => true, signIn: async () => { window.__nativeAppleCalls++; return { identityToken: 'synthetic-native-identity', nonce: 'synthetic-native-nonce' }; } };
    }
  }, { returning, existingSession, native, savedSession: session('email', initialActor), onboardingKey: ONBOARDING, sessionKey: SESSION, priorProfile, priorActor: PRIOR_USER_ID, savedOnboarding, flowData, trialEligible });
  await page.goto('https://basketboss.co.uk/app', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__authOnboardingQA?.ready());
  return { page, context, errors, authRequests, events, cloudWrites, checks, releaseSignup: gate.resolve, releaseCloud: cloudGate.resolve, setPremium(value){premium=value;} };
}
const options = { skip: !chromium && 'Playwright unavailable', timeout: 60000 };
const count = (events, name) => events.filter(event => event.name === name).length;
const draft = page => page.evaluate(() => window.__authOnboardingQA.draft());
async function openSignup(page) { await page.locator('#bbNewOnboarding [data-bbob="flow-email"]').click(); await page.locator('#cloud-signup').waitFor({ state: 'visible' }); }
async function fillAccount(page) { await page.locator('#cloud-email').fill(SYNTHETIC_EMAIL); await page.locator('#cloud-password').fill(SYNTHETIC_PASSWORD); }
async function waitEvent(_page, events, name, expected = 1) { await assertEventually(() => count(events, name) === expected, () => `expected ${expected} ${name} request(s); received safe event names: ${events.map(event => event.name).join(', ')}`); }
async function assertEventually(check, message) { const until = Date.now() + 10000; while (!check() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(check(), typeof message === 'function' ? message() : message); }

const FLOW='bb_onboarding_four_step_v1';
const step=page=>page.locator('#bbNewOnboarding .bbob-flow-shell').getAttribute('data-flow-step');
const setup=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),ONBOARDING);
async function personalise(page){
 await page.getByRole('button',{name:'Build My Weekly Plan',exact:true}).click();
 assert.equal(await step(page),'2');
 await page.locator('[data-bbob-group="flow-house"][data-bbob-opt="3"]').click();
 await page.locator('[data-bbob-group="flow-goal"][data-bbob-opt="0"]').click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
}
async function assertViewport(page){
 const view=page.viewportSize();
 for(const button of await page.locator('#bbNewOnboarding .bbob-flow-footer button').all()){
  const b=await button.boundingBox();assert.ok(b&&b.y>=0&&b.x>=0&&b.x+b.width<=view.width+1&&b.y+b.height<=view.height+1,'footer action fits viewport');
 }
 assert.equal(await page.locator('#bbNewOnboarding').evaluate(n=>n.scrollWidth>n.clientWidth+1),false);
}

test('new Email signup preserves selections through verified confirmation, resumes offer and completes only after verified Premium',options,async()=>{
 const h=await fixture();try{
  assert.equal(await step(h.page),'1');await personalise(h.page);assert.equal(await step(h.page),'3');
  await openSignup(h.page);await fillAccount(h.page);await h.page.locator('#cloud-password').press('Enter');
  await h.page.locator('#bbAuthCopy').filter({hasText:'confirm your account'}).waitFor();
  assert.equal((await setup(h.page)).complete,false);
  await h.page.goto('https://basketboss.co.uk/app#token_hash=synthetic-one-use-confirmation-hash&type=signup',{waitUntil:'domcontentloaded'});
  await h.page.waitForFunction(()=>document.querySelector('[data-flow-step="4"]'));
  assert.equal((await setup(h.page)).house,'3–4 people');assert.equal((await setup(h.page)).complete,false);
  assert.match(await h.page.locator('#bbob-title').innerText(),/4-person/);
  await h.page.getByRole('button',{name:'See trial & Premium plans',exact:true}).click();
  await h.page.waitForURL('**/pricing-sandbox.html#monthly');
  assert.equal((await setup(h.page)).complete,false,'opening checkout is not success');
  h.setPremium(true);await h.page.evaluate(()=>window.BasketBossVerifiedPremium.refresh(true));
  await h.page.waitForURL('**/app');await h.page.locator('#bbNewOnboarding').waitFor({state:'detached'});
  assert.equal((await setup(h.page)).complete,true);assert.equal(await h.page.evaluate(()=>window.BasketBossVerifiedPremium.isActive()),true);
  assert.equal(await h.page.locator('.shell nav.tabs [data-tab="week"]').evaluate(n=>n.classList.contains('active')),true);
  assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('native Apple uses its existing handler then resumes offer; cancelled purchase handoff remains incomplete',options,async()=>{
 const h=await fixture({native:true,appleProvider:true,trialEligible:true});try{
  await personalise(h.page);await h.page.locator('[data-bbob="flow-apple"]').waitFor({state:'visible'});
  await h.page.locator('[data-bbob="flow-apple"]').click();await h.page.waitForFunction(()=>document.querySelector('[data-flow-step="4"]'));
  assert.equal(await h.page.evaluate(()=>window.__nativeAppleCalls),1);
  assert.ok(h.authRequests.some(x=>x.grant==='id_token'&&x.appleProvider&&x.appleNonce));
  await h.page.getByRole('button',{name:'Start 7-Day Free Trial',exact:true}).click();
  assert.equal(await h.page.evaluate(()=>window.__membershipOpened),1);
  assert.equal((await setup(h.page)).complete,false);
  await h.page.reload({waitUntil:'domcontentloaded'});await h.page.waitForFunction(()=>document.querySelector('[data-flow-step="4"]'));
  assert.equal((await setup(h.page)).complete,false);assert.equal(await h.page.evaluate(()=>window.BasketBossVerifiedPremium.isActive()),false);
  assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('returning Step1 email signin enters Plan directly and never reopens onboarding after reload',options,async()=>{
 const h=await fixture();try{
  await h.page.getByRole('button',{name:'Already have an account? Sign in',exact:true}).click();
  await fillAccount(h.page);await h.page.locator('#cloud-password').press('Enter');
  await h.page.locator('#bbNewOnboarding').waitFor({state:'detached'});assert.equal((await setup(h.page)).complete,true);
  await h.page.reload({waitUntil:'domcontentloaded'});await h.page.waitForFunction(()=>window.BBAuthFlow);
  assert.equal(await h.page.locator('#bbNewOnboarding').count(),0);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('already signed-in unfinished setup skips account screen; completed accounts keep their existing opening',options,async()=>{
 const h=await fixture({existingSession:true,savedOnboarding:{step:1,started:true,complete:false,goals:[],diets:[],partnerStepV2:true}});try{
  await personalise(h.page);assert.equal(await step(h.page),'4');assert.equal(h.authRequests.some(x=>x.kind==='signup'||x.kind==='token'),false);
  await h.page.getByRole('button',{name:'Continue with Free',exact:true}).last().click();await h.page.locator('#bbNewOnboarding').waitFor({state:'detached'});
  assert.equal((await setup(h.page)).complete,true);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
 const completed=await fixture({returning:true,existingSession:true});try{assert.equal(await completed.page.locator('#bbNewOnboarding').count(),0);}finally{await completed.context.close();}
});

test('guest Browse200 completes directly into Discover without signup, purchase or pantry changes',options,async()=>{
 const h=await fixture();try{
  const before=await draft(h.page);await h.page.getByRole('button',{name:'Browse 200 free recipes',exact:true}).click();
  await h.page.locator('#bbNewOnboarding').waitFor({state:'detached'});assert.equal((await setup(h.page)).complete,true);
  assert.equal(await h.page.locator('.shell nav.tabs [data-tab="discover"]').evaluate(n=>n.classList.contains('active')),true);
  assert.deepEqual(await draft(h.page),before);assert.equal(h.authRequests.some(x=>x.kind==='signup'||x.kind==='token'),false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('guest Skip then Free enters Plan with original feeding setter, without session or high-protein planner logic',options,async()=>{
 const h=await fixture();try{
  await h.page.getByRole('button',{name:'Build My Weekly Plan',exact:true}).click();
  await h.page.locator('[data-bbob-group="flow-house"][data-bbob-opt="2"]').click();
  assert.equal(await h.page.evaluate(()=>JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')).servings),3,'feeding saves immediately through original app setter');
  await h.page.locator('[data-bbob-group="flow-goal"][data-bbob-opt="3"]').click();
  await h.page.getByRole('button',{name:'Continue',exact:true}).click();await h.page.getByRole('button',{name:'Skip for now',exact:true}).click();
  assert.equal(await step(h.page),'4');await h.page.getByRole('button',{name:'Continue with Free',exact:true}).last().click();
  await h.page.locator('#bbNewOnboarding').waitFor({state:'detached'});
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_cloud_session_v1')),null);
  const plan=await h.page.evaluate(()=>JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')));assert.equal(plan.servings,3);assert.deepEqual(plan.mealPreferences.goals,[]);
  assert.equal(await h.page.locator('.shell nav.tabs [data-tab="week"]').evaluate(n=>n.classList.contains('active')),true);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

for(const {width,height} of [{width:320,height:568},{width:390,height:844},{width:844,height:400}])test(`four screens remain readable with reachable actions at ${width}x${height}`,options,async()=>{
 const h=await fixture({width,height});try{
  await assertViewport(h.page);await h.page.getByRole('button',{name:'Build My Weekly Plan',exact:true}).click();await assertViewport(h.page);
  await h.page.getByRole('button',{name:'Continue',exact:true}).click();await assertViewport(h.page);
  await h.page.getByRole('button',{name:'Skip for now',exact:true}).click();await assertViewport(h.page);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('back from skipped offer restores save intent; original credentials remain mounted while typing and viewport shrinks',options,async()=>{
 const h=await fixture();try{
  await personalise(h.page);await h.page.getByRole('button',{name:'Skip for now',exact:true}).click();await h.page.getByRole('button',{name:'Back',exact:true}).click();
  await openSignup(h.page);await h.page.locator('#bbAuthSigninMode').click();const node=await h.page.locator('#cloud-password').elementHandle();
  await fillAccount(h.page);
  await h.page.evaluate(()=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>330});document.getElementById('cloud-password').focus();window.visualViewport.dispatchEvent(new Event('resize'));});
  assert.equal(await node.evaluate(n=>n===document.getElementById('cloud-password')),true);
  assert.equal(await h.page.locator('#bbNewOnboarding').evaluate(n=>n.classList.contains('bbob-keyboard')),true);
  await h.page.locator('#cloud-password').press('Enter');await h.page.waitForFunction(()=>document.querySelector('[data-flow-step="4"]'));
  assert.equal((await setup(h.page)).complete,false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('mobile preview captures actual four-step DOM without a live account or purchase',options,async()=>{
 const out=process.env.BB_ONBOARDING_PREVIEW_DIR;if(!out)return;
 await fs.mkdir(out,{recursive:true});
 const h=await fixture({native:true,appleProvider:true,trialEligible:true});try{
  await h.page.screenshot({path:path.join(out,'01-welcome.png')});
  await h.page.getByRole('button',{name:'Build My Weekly Plan',exact:true}).click();
  await h.page.locator('[data-bbob-group="flow-house"][data-bbob-opt="3"]').click();await h.page.locator('[data-bbob-group="flow-goal"][data-bbob-opt="0"]').click();
  await h.page.screenshot({path:path.join(out,'02-personalise.png')});
  await h.page.getByRole('button',{name:'Continue',exact:true}).click();await h.page.locator('[data-bbob="flow-apple"]').waitFor({state:'visible'});
  await h.page.screenshot({path:path.join(out,'03-save-plan.png')});await h.page.getByRole('button',{name:'Skip for now',exact:true}).click();
  await h.page.screenshot({path:path.join(out,'04-offer.png')});assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('declined Apple auth preserves personalisation and does not remount the original credentials',options,async()=>{
 const h=await fixture({native:true,appleProvider:true});try{
  await personalise(h.page);await h.page.locator('[data-bbob="flow-apple"]').waitFor({state:'visible'});await openSignup(h.page);
  const input=await h.page.locator('#cloud-email').elementHandle();await h.page.locator('#cloud-email').fill('draft@example.invalid');
  await h.page.evaluate(()=>{window.BBNativeAppleAuth.signIn=async()=>{throw Object.assign(new Error('Cancelled'),{code:'USER_CANCELLED'});};});
  // Email now uses its original provider controls; outer duplicates are hidden.
  await h.page.locator('#bbAuthApple').click();
  await h.page.waitForFunction(()=>window.BBAuthFlow?.state().busy===false);
  assert.equal(await step(h.page),'3');assert.equal((await setup(h.page)).house,'3–4 people');
  assert.equal(await input.evaluate(n=>n===document.getElementById('cloud-email')),true);assert.equal(await h.page.locator('#cloud-email').inputValue(),'draft@example.invalid');
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_cloud_session_v1')),null);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('onboarding completion storage failure remains retryable and deletion guards block interaction',options,async()=>{
 const h=await fixture();try{
  await personalise(h.page);await h.page.getByRole('button',{name:'Skip for now',exact:true}).click();
  await h.page.evaluate(key=>{const original=Storage.prototype.setItem;window.__restoreStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(k,v){if(k===key&&JSON.parse(v).complete===true)throw Error('storage blocked');return original.call(this,k,v);};},ONBOARDING);
  await h.page.getByRole('button',{name:'Continue with Free',exact:true}).click();
  assert.equal(await step(h.page),'4');assert.equal((await setup(h.page)).complete,false);assert.match(await h.page.locator('#bbobSaveError').innerText(),/retry/i);
  await h.page.evaluate(()=>{window.__restoreStorage();window.BBAccountDeletion={isDeleting:()=>true};});
  await h.page.getByRole('button',{name:'Continue with Free',exact:true}).click();assert.equal((await setup(h.page)).complete,false);
  await h.page.evaluate(()=>{window.BBAccountDeletion={isDeleting:()=>false};});await h.page.getByRole('button',{name:'Continue with Free',exact:true}).click();
  assert.equal((await setup(h.page)).complete,true);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('return from unverified checkout keeps offer and household choice, never completes from page navigation alone',options,async()=>{
 const h=await fixture({existingSession:true,savedOnboarding:{step:10,started:true,complete:false,house:'3 people',goals:[],diets:[],partnerStepV2:true}});try{
  await h.page.getByRole('button',{name:'See trial & Premium plans',exact:true}).click();await h.page.waitForURL('**/pricing-sandbox.html#monthly');
  await h.page.getByRole('button',{name:'Return to my plan',exact:true}).click();await h.page.waitForURL('**/app');
  await h.page.locator('[data-flow-step="4"]').waitFor();assert.equal((await setup(h.page)).complete,false);assert.equal((await setup(h.page)).house,'3 people');
  assert.equal(await h.page.evaluate(()=>window.BasketBossVerifiedPremium.isActive()),false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('a verified different account cannot auto-complete a previous checkout intent',options,async()=>{
 const h=await fixture({existingSession:true,savedOnboarding:{step:10,started:true,complete:false,house:'2 people',goals:[],diets:[],partnerStepV2:true},flowData:{version:1,goal:'',authIntent:'',checkoutActor:PRIOR_USER_ID}});try{
  h.setPremium(true);await h.page.evaluate(()=>window.BasketBossVerifiedPremium.refresh(true));
  assert.equal(await step(h.page),'4');assert.equal((await setup(h.page)).complete,false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('returning link with an already-valid unfinished account enters Plan instead of opening an empty form',options,async()=>{
 const h=await fixture({existingSession:true,savedOnboarding:{step:1,started:true,complete:false,goals:[],diets:[],partnerStepV2:true}});try{
  await h.page.getByRole('button',{name:'Already have an account? Sign in',exact:true}).click();
  await h.page.locator('#bbNewOnboarding').waitFor({state:'detached'});assert.equal((await setup(h.page)).complete,true);
  assert.equal(await h.page.locator('.shell nav.tabs [data-tab="week"]').evaluate(n=>n.classList.contains('active')),true);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

for(const inset of [0,24,48])test(`Android four-step actions clear the existing ${inset}px system-navigation inset`,options,async()=>{
 const h=await fixture();try{
  await h.page.evaluate(inset=>{document.documentElement.classList.add('bb-native-android');document.documentElement.style.setProperty('--bb-android-top','24px');document.documentElement.style.setProperty('--bb-android-bottom',inset+'px');},inset);
  for(const action of ['Build My Weekly Plan','Continue','Skip for now',null]){
   for(const button of await h.page.locator('#bbNewOnboarding .bbob-flow-footer button').all()){
    const b=await button.boundingBox();assert.ok(b&&b.y+b.height<=844-inset,'onboarding action stays above system navigation');
   }
   if(action)await h.page.getByRole('button',{name:action,exact:true}).click();
  }
  assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('PKCE email confirmation returns directly to offer with feeding and goal preserved',options,async()=>{
 const h=await fixture();try{
  await personalise(h.page);await openSignup(h.page);await fillAccount(h.page);await h.page.locator('#cloud-password').press('Enter');
  await h.page.locator('#bbAuthCopy').filter({hasText:'confirm your account'}).waitFor();
  await h.page.goto('https://basketboss.co.uk/app?code=synthetic-confirmation-code&bb_auth=signup',{waitUntil:'domcontentloaded'});
  await h.page.locator('[data-flow-step="4"]').waitFor();
  assert.ok(h.authRequests.some(x=>x.grant==='pkce'&&x.hasVerifier));assert.ok(h.authRequests.some(x=>x.kind==='verified-user'));
  assert.equal((await setup(h.page)).house,'3–4 people');assert.deepEqual((await setup(h.page)).goals,['Spend less on groceries']);assert.equal((await setup(h.page)).complete,false);
  assert.doesNotMatch(h.page.url(),/[?&](?:code|access_token|refresh_token)=/);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('four-step Settings replay can cancel without committing household or local goal draft',options,async()=>{
 const h=await fixture({returning:true});try{
  const original=await setup(h.page),plan=await h.page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1'));
  await h.page.evaluate(()=>window.BBOnboard2026.open());await h.page.getByRole('button',{name:'Build My Weekly Plan',exact:true}).click();
  await h.page.locator('[data-bbob-group="flow-house"][data-bbob-opt="2"]').click();await h.page.locator('[data-bbob-group="flow-goal"][data-bbob-opt="3"]').click();
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1')),plan);
  await h.page.getByRole('button',{name:'Cancel setup',exact:true}).click();await h.page.locator('#bbNewOnboarding').waitFor({state:'detached'});
  assert.deepEqual(await setup(h.page),original);assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1')),plan);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
