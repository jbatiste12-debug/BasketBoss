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

async function fixture({ returning = false, existingSession = false, native = false, platform = 'ios', googleProvider = true, holdGoogleOpen = false, savedOnboarding = null, flowData = null, width = 390, height = 844, trialEligible = false, appleProvider = false, deletionReady = true, signupOutcomes = ['pending'], holdSignup = false, verificationState = { used: false }, priorProfile = false, holdCloud = false, initialActor = USER_ID, rejectPasswordOnce = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], authRequests = [], events = [], cloudWrites = [], checks = { deletion: false, cloudPending: false }, gate = deferred(), cloudGate = deferred();
  let signupCount = 0, passwordAttempts = 0, connected = existingSession, premium = false, activeProvider = existingSession?'google':'email';
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
      if (url.pathname === '/auth/v1/settings') return json({ external: { email: true, apple: appleProvider, google:googleProvider }, disable_signup: false });
      if(url.pathname === '/auth/v1/authorize'){
        authRequests.push({kind:'google-authorize',provider:url.searchParams.get('provider'),pkce:url.searchParams.get('code_challenge_method')==='s256',redirect:url.searchParams.get('redirect_to')});
        return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><a href="https://basketboss.co.uk/app?bb_auth=google&amp;code=synthetic-google-code">Return to BasketBoss</a>'});
      }
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
        connected = true;activeProvider=grant==='pkce'?'google':grant==='id_token'?'apple':activeProvider;
        return json({...session(activeProvider),...(body.auth_code==='synthetic-google-code'?{provider_token:'synthetic-google-api-token',provider_refresh_token:'synthetic-google-api-refresh'}:{})});
      }
      if (url.pathname === '/auth/v1/verify') {
        const body = request.postDataJSON();
        authRequests.push({ kind: 'verify-otp', signupType: body.type === 'signup', tokenHashPresent: body.token_hash === 'synthetic-one-use-confirmation-hash', verifierAbsent: !body.code_verifier });
        if (verificationState.used || body.token_hash !== 'synthetic-one-use-confirmation-hash') return json({ code: 'otp_expired', msg: 'This email link is invalid or has expired.' }, 403);
        verificationState.used = true; connected = true;
        return json(session());
      }
      if (url.pathname === '/auth/v1/user') { if(request.method()==='PUT')authRequests.push({kind:'set-password',correctPassword:request.postDataJSON().password===SYNTHETIC_PASSWORD});else authRequests.push({ kind: 'verified-user' }); return json(user(true,activeProvider)); }
      if (url.pathname === '/auth/v1/logout') return json({});
      if(url.pathname === '/auth/v1/recover'){authRequests.push({kind:'recover',correctEmail:request.postDataJSON().email===SYNTHETIC_EMAIL});return json({});}
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
  await context.addInitScript(({ returning, existingSession, native, savedSession, onboardingKey, sessionKey, priorProfile, priorActor, savedOnboarding, flowData, trialEligible, platform, holdGoogleOpen }) => {
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
      window.__googleURLs=[];window.BBNativeAuthBrowser={open:async address=>{window.__googleURLs.push(address);if(holdGoogleOpen)await new Promise(resolve=>{window.__finishGoogleOpen=resolve;});}};
      window.BBNative = { isNative: true, platform, apiURL: value => 'https://basketboss.co.uk' + value };
      window.__nativeAppleCalls = 0;
      if(platform==='ios')window.BBNativeAppleAuth = { available: async () => true, signIn: async () => { window.__nativeAppleCalls++; return { identityToken: 'synthetic-native-identity', nonce: 'synthetic-native-nonce' }; } };
    }
  }, { returning, existingSession, native, savedSession: session('google', initialActor), onboardingKey: ONBOARDING, sessionKey: SESSION, priorProfile, priorActor: PRIOR_USER_ID, savedOnboarding, flowData, trialEligible, platform, holdGoogleOpen });
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

const flowStep=page=>page.locator('[data-flow-step]').getAttribute('data-flow-step');
async function newSave(page){
 await page.getByRole('button',{name:'Build My Weekly Plan',exact:true}).click();
 await page.locator('[data-bbob-group="flow-house"][data-bbob-opt="2"]').click();
 await page.locator('[data-bbob-group="flow-goal"][data-bbob-opt="1"]').click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.locator('[data-bbob="flow-google"]').waitFor({state:'visible'});
}
async function nativeReturn(page){await page.evaluate(()=>window.BBAuthFlow.handleCallbackURL('basketboss://auth/callback?bb_auth=google&code=synthetic-google-code'));}
async function noProviderTokens(page){
 assert.equal(await page.evaluate(()=>/provider_token|provider_refresh_token|synthetic-google-api/.test(localStorage.getItem('basketboss_cloud_session_v1')||'')),false);
}

test('web Google uses real SDK PKCE, validates getUser and resumes personalised Offer after full redirect',options,async()=>{
 const h=await fixture();try{
  await newSave(h.page);await h.page.locator('[data-bbob="flow-google"]').click();
  await h.page.getByRole('link',{name:'Return to BasketBoss'}).click();await h.page.locator('[data-flow-step="4"]').waitFor();
  assert.equal(h.authRequests.filter(r=>r.kind==='google-authorize').length,1);assert.equal(h.authRequests.find(r=>r.kind==='google-authorize').pkce,true);
  assert.ok(h.authRequests.some(r=>r.grant==='pkce'&&r.hasVerifier));assert.ok(h.authRequests.some(r=>r.kind==='verified-user'));
  const saved=await h.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),ONBOARDING);assert.equal(saved.house,'3 people');assert.deepEqual(saved.goals,['Waste less food']);assert.equal(saved.complete,false);
  await noProviderTokens(h.page);assert.equal(await h.page.evaluate(()=>window.BasketBossVerifiedPremium.isActive()),false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

for(const platform of ['ios','android'])test(`${platform} Google callback resumes Offer while native browser open is still pending`,options,async()=>{
 const h=await fixture({native:true,platform,appleProvider:platform==='ios',holdGoogleOpen:true});try{
  await newSave(h.page);await h.page.locator('[data-bbob="flow-google"]').click();await h.page.waitForFunction(()=>window.__googleURLs?.length===1);
  assert.equal(await h.page.evaluate(()=>window.BBAuthFlow.state().busy),false);
  await nativeReturn(h.page);await h.page.locator('[data-flow-step="4"]').waitFor();
  await h.page.evaluate(()=>window.__finishGoogleOpen?.());await noProviderTokens(h.page);
  assert.equal(await h.page.evaluate(()=>window.BasketBossSession.state().remembered),true);assert.equal(await h.page.evaluate(()=>window.BasketBossVerifiedPremium.isActive()),false);
  assert.equal(h.authRequests.some(r=>r.kind==='signup'||r.grant==='id_token'||r.grant==='password'),false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('returning Google account signs in from existing Account controls and enters Plan directly',options,async()=>{
 const h=await fixture({native:true,platform:'android'});try{
  await h.page.getByRole('button',{name:'Already have an account? Sign in',exact:true}).click();await h.page.locator('#bbAuthGoogle').waitFor({state:'visible'});
  await h.page.locator('#bbAuthGoogle').click();await h.page.waitForFunction(()=>window.__googleURLs?.length===1);await nativeReturn(h.page);
  await h.page.locator('#bbNewOnboarding').waitFor({state:'detached'});
  assert.equal(await h.page.locator('.shell nav.tabs [data-tab="week"]').evaluate(n=>n.classList.contains('active')),true);
  assert.equal(await h.page.evaluate(key=>JSON.parse(localStorage.getItem(key)).complete,ONBOARDING),true);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('Google disabled in provider settings stays hidden while original Email signup remains usable',options,async()=>{
 const h=await fixture({googleProvider:false});try{
  await h.page.getByRole('button',{name:'Build My Weekly Plan',exact:true}).click();await h.page.getByRole('button',{name:'Continue',exact:true}).click();
  assert.equal(await h.page.locator('[data-bbob="flow-google"]').isVisible(),false);await openSignup(h.page);await fillAccount(h.page);
  await h.page.locator('#cloud-password').press('Enter');await h.page.locator('#bbAuthCopy').filter({hasText:'confirm your account'}).waitFor();
  assert.equal(h.authRequests.filter(r=>r.kind==='signup').length,1);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('Google cancellation and rejected callback preserve choices and permit a fresh attempt',options,async()=>{
 const h=await fixture({native:true,platform:'android'});try{
  await newSave(h.page);await h.page.locator('[data-bbob="flow-google"]').click();await h.page.waitForFunction(()=>window.__googleURLs?.length===1);
  await h.page.evaluate(()=>window.BBAuthFlow.cancelGoogleSignIn());assert.equal(await flowStep(h.page),'3');
  assert.equal(await h.page.evaluate(()=>window.BasketBossSession.state().remembered),false);
  await h.page.locator('[data-bbob="flow-google"]').click();await h.page.waitForFunction(()=>window.__googleURLs?.length===2);
  await h.page.evaluate(()=>window.BBAuthFlow.handleCallbackURL('basketboss://auth/callback?bb_auth=google&error=access_denied'));
  await h.page.locator('#bbAuthFeedback').filter({hasText:'Google sign-in was not completed'}).waitFor();
  assert.equal(await h.page.evaluate(()=>window.BasketBossSession.state().remembered),false);
  assert.equal(await h.page.evaluate(key=>JSON.parse(localStorage.getItem(key)).house,ONBOARDING),'3 people');assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('Google signed-in account can open existing verified password setup without sending automatically or using Google password',options,async()=>{
 const h=await fixture({returning:true,existingSession:true});try{
  await h.page.evaluate(()=>document.getElementById('cloud-open').click());await h.page.locator('#bbGooglePasswordHelp').waitFor({state:'visible'});
  assert.match(await h.page.locator('#bbGooglePasswordHelp').innerText(),/separate from your Google password/);
  await h.page.getByRole('button',{name:'Set a BasketBoss password',exact:true}).click();
  assert.equal(await h.page.locator('#cloud-auth').getAttribute('data-bb-auth-view'),'forgot-password');
  assert.equal(await h.page.locator('#bbAuthResetEmail').inputValue(),SYNTHETIC_EMAIL);assert.equal(h.authRequests.filter(r=>r.kind==='recover').length,0);
  await h.page.locator('#bbAuthReset').click();await h.page.locator('#cloud-auth[data-bb-auth-view="reset-sent"]').waitFor();
  assert.equal(h.authRequests.filter(r=>r.kind==='recover'&&r.correctEmail).length,1);
  await h.page.goto('https://basketboss.co.uk/app?bb_auth=recovery&code=synthetic-recovery-code',{waitUntil:'domcontentloaded'});
  await h.page.locator('#bbAuthNewPassword').fill(SYNTHETIC_PASSWORD);await h.page.locator('#bbAuthRepeatPassword').fill(SYNTHETIC_PASSWORD);await h.page.locator('#bbAuthSavePassword').click();
  await h.page.waitForFunction(()=>window.BBAuthFlow?.state().busy===false&&window.BBAuthFlow?.state().view==='sign-in');
  assert.equal(h.authRequests.filter(r=>r.kind==='set-password'&&r.correctPassword).length,1);
  assert.equal(await h.page.evaluate(()=>JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')).user.id),USER_ID);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

for(const platform of ['ios','android','web'])test(`${platform} provider checks preserve Account fields and submit position`,options,async()=>{
 const h=await fixture({returning:true,native:platform!=='web',platform,googleProvider:true,appleProvider:platform==='ios'});try{
  await h.page.evaluate(()=>document.getElementById('cloud-open').click());await h.page.locator('#cloud-email').waitFor({state:'visible'});
  await h.page.locator('#bbAuthGoogle').waitFor({state:'visible'});await h.page.evaluate(()=>new Promise(requestAnimationFrame));
  const before=await h.page.locator('#cloud-email').boundingBox(),button=await h.page.locator('#cloud-login').elementHandle();
  await h.page.evaluate(()=>window.dispatchEvent(new Event('basketboss:auth-browser-ready')));
  await h.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const after=await h.page.locator('#cloud-email').boundingBox();assert.ok(Math.abs(before.y-after.y)<1,'provider retry cannot move email');
  assert.equal(await button.evaluate(n=>n===document.getElementById('cloud-login')),true);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('Google preview shows actual Step3 with matching Apple, Google and Email buttons',options,async()=>{
 const directory=process.env.BB_GOOGLE_PREVIEW_DIR;if(!directory)return;await fs.mkdir(directory,{recursive:true});
 const h=await fixture({native:true,platform:'ios',appleProvider:true});try{
  await newSave(h.page);await h.page.locator('[data-bbob="flow-apple"]').waitFor({state:'visible'});
  await h.page.screenshot({path:path.join(directory,'google-save-plan.png')});assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
