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

async function fixture({ returning = false, existingSession = false, native = false, appleProvider = false, deletionReady = true, signupOutcomes = ['pending'], holdSignup = false, verificationState = { used: false }, priorProfile = false, holdCloud = false, initialActor = USER_ID, rejectPasswordOnce = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], authRequests = [], events = [], cloudWrites = [], checks = { deletion: false, cloudPending: false }, gate = deferred(), cloudGate = deferred();
  let signupCount = 0, passwordAttempts = 0, connected = existingSession;
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
      if (url.pathname === '/api/subscription/status') return json({ authenticated: connected, tier: 'free', premium: false, premiumAccess: false, subscription: null });
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
  await context.addInitScript(({ returning, existingSession, native, savedSession, onboardingKey, sessionKey, priorProfile, priorActor }) => {
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
      localStorage.setItem('auth-onboarding-browser-fixture-v1', '1');
    }
    if (native) {
      window.BBNative = { isNative: true, apiURL: value => 'https://basketboss.co.uk' + value };
      window.__nativeAppleCalls = 0;
      window.BBNativeAppleAuth = { available: async () => true, signIn: async () => { window.__nativeAppleCalls++; return { identityToken: 'synthetic-native-identity', nonce: 'synthetic-native-nonce' }; } };
    }
  }, { returning, existingSession, native, savedSession: session('email', initialActor), onboardingKey: ONBOARDING, sessionKey: SESSION, priorProfile, priorActor: PRIOR_USER_ID });
  await page.goto('https://basketboss.co.uk/app', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__authOnboardingQA?.ready());
  return { page, context, errors, authRequests, events, cloudWrites, checks, releaseSignup: gate.resolve, releaseCloud: cloudGate.resolve };
}
const options = { skip: !chromium && 'Playwright unavailable', timeout: 60000 };
const count = (events, name) => events.filter(event => event.name === name).length;
const draft = page => page.evaluate(() => window.__authOnboardingQA.draft());
async function openSignup(page) { await page.locator('#bbNewOnboarding [data-bbob="quick-signup"]').click(); await page.locator('#cloud-signup').waitFor({ state: 'visible' }); }
async function fillAccount(page) { await page.locator('#cloud-email').fill(SYNTHETIC_EMAIL); await page.locator('#cloud-password').fill(SYNTHETIC_PASSWORD); }
async function waitEvent(_page, events, name, expected = 1) { await assertEventually(() => count(events, name) === expected, () => `expected ${expected} ${name} request(s); received safe event names: ${events.map(event => event.name).join(', ')}`); }
async function assertEventually(check, message) { const until = Date.now() + 10000; while (!check() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(check(), typeof message === 'function' ? message() : message); }

test('fresh guest explores, creates a real meal and shopping list, then sees contextual signup without automatic registration', options, async () => {
  const h = await fixture();
  try {
    await h.page.getByRole('button', { name: 'Explore recipes', exact: true }).click();
    await h.page.locator('#bbNewOnboarding').waitFor({ state: 'detached' });
    await h.page.locator('.shell nav.tabs [data-tab="discover"]').click();
    await h.page.locator('[data-bb80-add-week="fajitas"]').click();
    const dialog = h.page.locator('#bb80AddWeekDialog'); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Add to dinners', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await h.page.waitForFunction(() => window.__authOnboardingQA.draft().planned.length === 1);
    await h.page.locator('#bbFunnelNudge').waitFor({ state: 'visible' });
    await waitEvent(h.page, h.events, 'first_meal_plan_created');
    await waitEvent(h.page, h.events, 'first_shopping_list_created');
    assert.equal(h.authRequests.filter(x => ['signup', 'token'].includes(x.kind)).length, 0);
    await h.page.locator('#bbFunnelNudge [data-bbf-signup]').click();
    assert.equal(await h.page.locator('#cloud-auth').getAttribute('data-bb-auth-mode'), 'sign-up');
    assert.equal(await h.page.locator('#cloud-signup').isVisible(), true);
    assert.ok(h.events.every(x => x.bodyAbsent && x.authorizationAbsent && x.cookieAbsent));
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test('signup Return uses the real SDK PKCE request; confirmation becomes success only after verified persisted callback', options, async () => {
  const h = await fixture();
  try {
    await openSignup(h.page); await fillAccount(h.page);
    assert.equal(await h.page.locator('#cloud-password').getAttribute('autocomplete'), 'new-password');
    assert.ok(await h.page.locator('#cloud-email').evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16));
    await h.page.locator('#cloud-password').press('Enter');
    await h.page.locator('#bbAuthCopy').filter({ hasText: 'confirm your account' }).waitFor();
    assert.equal(h.authRequests.filter(x => x.kind === 'signup').length, 1);
    assert.ok(h.authRequests.find(x => x.kind === 'signup').correctEmail && h.authRequests.find(x => x.kind === 'signup').pkce);
    await waitEvent(h.page, h.events, 'signup_confirmation_pending');
    assert.equal(count(h.events, 'signup_succeeded'), 0);
    assert.equal(await h.page.evaluate(key => localStorage.getItem(key) === null, SESSION), true);
    await h.page.evaluate(() => document.getElementById('cloud-open').click());
    assert.equal(await h.page.locator('#cloud-auth').getAttribute('data-bb-auth-view'), 'check-email', 'Account entry preserves a pending confirmation instead of resubmitting signup');
    await h.page.goto('https://basketboss.co.uk/app?code=synthetic-confirmation-code&bb_auth=signup', { waitUntil: 'domcontentloaded' });
    await h.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true);
    await waitEvent(h.page, h.events, 'signup_succeeded');
    assert.equal(h.authRequests.filter(x => x.kind === 'token' && x.grant === 'pkce').length, 1);
    assert.ok(h.authRequests.find(x => x.grant === 'pkce').hasVerifier);
    assert.ok(h.authRequests.some(x => x.kind === 'verified-user'));
    assert.doesNotMatch(h.page.url(), /[?&](?:code|access_token|refresh_token)=/);
    await h.page.reload({ waitUntil: 'domcontentloaded' });
    await h.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true);
    assert.equal(count(h.events, 'signup_succeeded'), 1, 'restored sessions never double-count registration');
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test('real signup failure unlocks retry and repeated Return cannot submit twice', options, async () => {
  const h = await fixture({ signupOutcomes: ['validation', 'pending'], holdSignup: true });
  try {
    await openSignup(h.page); await fillAccount(h.page);
    await h.page.locator('#cloud-password').press('Enter');
    await assertEventually(() => h.authRequests.some(x => x.kind === 'signup'), 'SDK signup request should begin');
    assert.equal(await h.page.locator('#cloud-signup').isDisabled(), true);
    await h.page.keyboard.press('Enter'); await h.page.keyboard.press('Enter');
    assert.equal(h.authRequests.filter(x => x.kind === 'signup').length, 1);
    h.releaseSignup();
    await h.page.locator('#bbAuthFeedback').filter({ hasText: 'stronger password' }).waitFor();
    assert.equal(await h.page.locator('#cloud-signup').isEnabled(), true);
    await h.page.locator('#cloud-password').press('Enter');
    await h.page.locator('#bbAuthCopy').filter({ hasText: 'confirm your account' }).waitFor();
    await waitEvent(h.page, h.events, 'signup_attempted', 2);
    await waitEvent(h.page, h.events, 'signup_failed_validation');
    await waitEvent(h.page, h.events, 'signup_confirmation_pending');
    assert.equal(count(h.events, 'signup_failed_validation'), 1);
    assert.equal(count(h.events, 'signup_confirmation_pending'), 1);
    assert.equal(count(h.events, 'signup_succeeded'), 0);
    assert.deepEqual(h.errors, []);
  } finally { h.releaseSignup(); await h.context.close(); }
});

test('returning user signs in with Return and signs out without exposing or losing the account plan and pantry', options, async () => {
  const h = await fixture({ returning: true });
  try {
    const saved = await draft(h.page);
    assert.equal(await h.page.locator('#bbNewOnboarding').count(), 0);
    await h.page.evaluate(() => document.getElementById('cloud-open').click());
    await h.page.locator('#bbAuthSigninMode').click(); await fillAccount(h.page);
    assert.equal(await h.page.locator('#cloud-password').getAttribute('autocomplete'), 'current-password');
    await h.page.locator('#cloud-password').press('Enter');
    await h.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true);
    assert.equal(h.authRequests.filter(x => x.kind === 'token' && x.grant === 'password').length, 1);
    assert.deepEqual(await draft(h.page), saved);
    await h.page.reload({ waitUntil: 'domcontentloaded' }); await h.page.waitForFunction(() => window.__authOnboardingQA?.ready());
    assert.equal(await h.page.locator('#bbNewOnboarding').count(), 0);
    assert.equal(await h.page.evaluate(() => window.BasketBossSession.state().remembered), true);
    await h.page.evaluate(() => document.getElementById('cloud-open').click());
    await Promise.all([h.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), h.page.locator('#cloud-logout').click()]);
    await h.page.waitForFunction(() => window.__authOnboardingQA?.ready());
    await h.page.waitForFunction(() => window.BasketBossSession?.state().remembered === false);
    assert.deepEqual(await draft(h.page), { planned: [], pantry: {}, stock: {}, inventory: null }, 'signed-out guests cannot see the account kitchen');
    const accountArchive = await h.page.evaluate(id => {
      const archived = JSON.parse(localStorage.getItem('basketboss_receipt_host_snapshot_v1:' + encodeURIComponent(id)) || 'null');
      const values = archived?.values || {}, plan = JSON.parse(values.basketboss_321_unified_state_v1 || '{}');
      return { ownProfile: archived?.actorId === id, draft: { planned: plan.planned, pantry: plan.pantry, stock: JSON.parse(values.basketboss_321_v7_measured_pantry || '{}'), inventory: values.basketboss_makeameal_v1_inventory ?? null } };
    }, USER_ID);
    assert.equal(accountArchive.ownProfile, true);
    assert.deepEqual(accountArchive.draft, saved, 'the account-scoped profile retains the exact plan and pantry');
    await h.page.evaluate(() => document.getElementById('cloud-open').click());
    await h.page.locator('#bbAuthSigninMode').click(); await fillAccount(h.page);
    await Promise.all([h.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), h.page.locator('#cloud-password').press('Enter')]);
    await h.page.waitForFunction(() => window.__authOnboardingQA?.ready() && window.BasketBossSession?.state().remembered === true);
    assert.deepEqual(await draft(h.page), saved, 'signing into the same account restores its own kitchen');
    assert.equal(h.authRequests.filter(x => x.kind === 'token' && x.grant === 'password').length, 2);
    assert.equal(count(h.events, 'signup_succeeded'), 0);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test('Apple is available directly on the native welcome only after provider and deletion readiness checks', options, async () => {
  for (const settings of [{ native: false, appleProvider: true, deletionReady: true }, { native: true, appleProvider: true, deletionReady: false }, { native: true, appleProvider: true, deletionReady: true }]) {
    const h = await fixture(settings);
    try {
      if (!settings.native || !settings.deletionReady) {
        if (settings.native) {
          await assertEventually(() => h.checks.deletion, 'native Apple deletion readiness must be checked');
          await h.page.evaluate(() => new Promise(requestAnimationFrame));
        }
        assert.equal(await h.page.locator('[data-bbob="quick-apple"]').isVisible(), false);
        await openSignup(h.page);
        assert.equal(await h.page.locator('#bbAuthApple').isVisible(), false);
        assert.equal(h.authRequests.filter(x => x.grant === 'id_token').length, 0);
      } else {
        await h.page.locator('[data-bbob="quick-apple"]').waitFor({ state: 'visible' });
        assert.equal(await h.page.locator('#bbobQuickAccountPanel').isVisible(), false, 'Apple does not require opening the email form');
        assert.equal(await h.page.locator('#cloud-password').isVisible(), false);
        await h.page.locator('[data-bbob="quick-apple"]').click();
        await h.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true);
        assert.equal(await h.page.evaluate(() => window.__nativeAppleCalls), 1);
        assert.equal(h.authRequests.filter(x => x.grant === 'id_token').length, 1);
        assert.ok(h.authRequests.find(x => x.grant === 'id_token').appleNonce);
        assert.ok(h.authRequests.find(x => x.grant === 'id_token').appleProvider);
        assert.equal(h.authRequests.some(x => x.kind === 'signup' || x.grant === 'password'), false);
        await waitEvent(h.page, h.events, 'signup_succeeded');
      }
      assert.deepEqual(h.errors, []);
    } finally { await h.context.close(); }
  }
});

test('an expired or reused email callback offers verified password sign-in instead of assuming the account failed', options, async () => {
  const h = await fixture();
  try {
    await h.page.goto('https://basketboss.co.uk/app#error=access_denied&error_code=otp_expired&bb_auth=signup', { waitUntil: 'domcontentloaded' });
    await h.page.locator('#bbAuthFeedback').filter({ hasText: 'may already be confirmed' }).waitFor();
    assert.equal(await h.page.evaluate(() => window.BasketBossSession.state().remembered), false);
    assert.equal(h.authRequests.filter(x => ['signup', 'token', 'verified-user'].includes(x.kind)).length, 0, 'failed callback alone never establishes a session');
    await h.page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
    assert.equal(await h.page.locator('#cloud-login').isVisible(), true);
    await fillAccount(h.page); await h.page.locator('#cloud-password').press('Enter');
    await h.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true);
    assert.equal(h.authRequests.filter(x => x.grant === 'password').length, 1);
    assert.ok(h.authRequests.some(x => x.kind === 'verified-user'));
    assert.equal(count(h.events, 'signup_succeeded'), 0);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test('optional token-hash confirmation verifies in a fresh browser context without PKCE and rejects reuse', options, async () => {
  const verificationState = { used: false }, original = await fixture(), fresh = await fixture({ verificationState });
  let reused;
  try {
    await openSignup(original.page); await fillAccount(original.page);
    await original.page.locator('#cloud-password').press('Enter');
    await original.page.locator('#bbAuthCopy').filter({ hasText: 'confirm your account' }).waitFor();
    assert.equal(await fresh.page.evaluate(() => Object.keys(localStorage).some(key => key.includes('code-verifier'))), false, 'fresh browser has no PKCE verifier from signup');
    await fresh.page.goto('https://basketboss.co.uk/app#token_hash=synthetic-one-use-confirmation-hash&type=signup', { waitUntil: 'domcontentloaded' });
    await fresh.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true);
    const verification = fresh.authRequests.filter(request => request.kind === 'verify-otp');
    assert.equal(verification.length, 1);
    assert.ok(verification[0].signupType && verification[0].tokenHashPresent && verification[0].verifierAbsent);
    assert.ok(fresh.authRequests.some(request => request.kind === 'verified-user'), 'verified OTP response still passes the independent getUser check');
    assert.equal(fresh.authRequests.some(request => request.grant === 'pkce'), false);
    assert.doesNotMatch(fresh.page.url(), /token_hash/);
    await fresh.page.reload({ waitUntil: 'domcontentloaded' });
    await fresh.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true);
    assert.equal(fresh.authRequests.filter(request => request.kind === 'verify-otp').length, 1, 'reload never reuses the scrubbed token');
    assert.equal(await original.page.evaluate(() => window.BasketBossSession.state().remembered), false, 'confirmation never copies another browser session into the originating app');
    reused = await fixture({ verificationState });
    await reused.page.goto('https://basketboss.co.uk/app#token_hash=synthetic-one-use-confirmation-hash&type=signup', { waitUntil: 'domcontentloaded' });
    await reused.page.locator('#bbAuthFeedback').filter({ hasText: 'may already be confirmed' }).waitFor();
    assert.equal(await reused.page.evaluate(() => window.BasketBossSession.state().remembered), false, 'a reused token never grants access');
    assert.equal(reused.authRequests.some(request => request.kind === 'verified-user'), false);
    assert.deepEqual([...original.errors, ...fresh.errors, ...reused.errors], []);
  } finally { await original.context.close(); await fresh.context.close(); await reused?.context.close(); }
});

test('a new verified account cannot resurrect or upload the previous local profile through recovery keys', options, async () => {
  const h = await fixture({ returning: true, priorProfile: true });
  try {
    await h.page.waitForFunction(() => window.__authOnboardingQA?.ready() && window.__authOnboardingQA.draft().planned.length === 0);
    await h.page.evaluate(() => document.getElementById('cloud-open').click());
    await h.page.locator('#bbAuthSigninMode').click(); await fillAccount(h.page);
    await Promise.all([h.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), h.page.locator('#cloud-password').press('Enter')]);
    await h.page.waitForFunction(() => window.__authOnboardingQA?.ready() && window.BasketBossSession?.state().remembered === true);
    assert.deepEqual(await draft(h.page), { planned: [], pantry: {}, stock: {}, inventory: null });
    await assertEventually(() => h.authRequests.some(request => request.kind === 'cloud-read' && request.ownActor), 'the new verified actor must check its own cloud backup');
    assert.ok(h.cloudWrites.every(write => write.ownActor && write.plannedCount === 0 && !write.containsPriorMeal), 'previous profile meals never enter a new account upload');
    const priorArchive = await h.page.evaluate(actorId => {
      const archive = JSON.parse(localStorage.getItem('basketboss_receipt_host_snapshot_v1:' + encodeURIComponent(actorId)) || 'null');
      const fallback = ['basketboss_321_unified_recovery_v1', 'basketboss_state_v2', 'basketboss_321_unified_oldplan_v1', 'basketboss_321_unified_oldpantry_v1'];
      return { ownerMatches: archive?.actorId === actorId, archivedFallbackCount: fallback.filter(key => typeof archive?.values?.[key] === 'string').length, activeFallbackHasPriorMeal: fallback.some(key => (localStorage.getItem(key) || '').includes('veggie-fried-rice')) };
    }, PRIOR_USER_ID);
    assert.deepEqual(priorArchive, { ownerMatches: true, archivedFallbackCount: 4, activeFallbackHasPriorMeal: false });
    assert.match(await h.page.locator('#bb16AccountShortcut').textContent(), /Your account/);
    assert.equal(await h.page.locator('#cloud-panel').isVisible(), false, 'verified login enters the app directly');
    await h.page.evaluate(() => document.getElementById('cloud-open').click());
    assert.equal(await h.page.evaluate(() => window.BasketBossCloud.needsChoice()), false);
    assert.equal(await h.page.locator('#cloud-backup-controls').evaluate(node => node.open), false, 'no nonexistent saved plan is presented as a restore choice');
    await Promise.all([h.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), h.page.locator('#cloud-logout').click()]);
    await h.page.waitForFunction(() => window.__authOnboardingQA?.ready() && window.BasketBossSession?.state().remembered === false);
    assert.deepEqual(await draft(h.page), { planned: [], pantry: {}, stock: {}, inventory: null });
    assert.ok(h.cloudWrites.every(write => !write.containsPriorMeal));
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test('verified sign-in enters the app while cloud backup is pending and normal Account entry defaults to sign-in', options, async () => {
  const h = await fixture({ returning: true, holdCloud: true });
  try {
    const saved = await draft(h.page);
    await h.page.evaluate(() => document.getElementById('cloud-open').click());
    await h.page.locator('#bbAuthSignupMode').click(); await fillAccount(h.page);
    await h.page.locator('#cloud-close').click();
    await h.page.evaluate(() => document.getElementById('cloud-open').click());
    assert.equal(await h.page.locator('#cloud-auth').getAttribute('data-bb-auth-mode'), 'sign-in');
    assert.equal(await h.page.locator('#cloud-password').getAttribute('autocomplete'), 'current-password');
    assert.equal((await h.page.locator('#cloud-email').inputValue()) === SYNTHETIC_EMAIL, true, 'switching normal entry does not erase the credential draft');
    await h.page.locator('#cloud-password').press('Enter');
    await h.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true && window.BBAuthFlow?.state().busy === false);
    await assertEventually(() => h.checks.cloudPending, 'the real backup request must remain pending for this check');
    assert.equal(await h.page.locator('#cloud-panel').isVisible(), false, 'the app is accessible before backup responds');
    await h.page.locator('.shell nav.tabs [data-tab="shop"]').click();
    await h.page.locator('.shell nav.tabs [data-tab="week"]').click();
    assert.deepEqual(await draft(h.page), saved);
    h.releaseCloud();
    await assertEventually(() => !h.checks.cloudPending, 'the independent backup request can complete afterwards');
    assert.equal(await h.page.evaluate(() => window.BasketBossSession.state().remembered), true);
    assert.deepEqual(h.errors, []);
  } finally { h.releaseCloud(); await h.context.close(); }
});

test('failed confirmation in a browser remembering another account offers a real verified account switch', options, async () => {
  const h = await fixture({ returning: true, existingSession: true, initialActor: PRIOR_USER_ID, rejectPasswordOnce: true });
  try {
    const priorDraft = await draft(h.page);
    assert.equal(priorDraft.planned.length, 1);
    await h.page.goto('https://basketboss.co.uk/app#error=access_denied&error_code=otp_expired&bb_auth=signup', { waitUntil: 'domcontentloaded' });
    await h.page.locator('#bbAuthFeedback').filter({ hasText: 'may already be confirmed' }).waitFor();
    assert.equal(await h.page.evaluate(actor => window.BasketBossSession.read()?.user?.id === actor, PRIOR_USER_ID), true);
    assert.deepEqual(await draft(h.page), priorDraft, 'the failed link neither signs into the new account nor erases the remembered account');
    assert.equal(await h.page.locator('#cloud-signed').isVisible(), false, 'existing account backup actions cannot look like success for the failed link');
    assert.equal(await h.page.locator('#cloud-status').isVisible(), false);
    await h.page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
    await h.page.locator('#cloud-login').waitFor({ state: 'visible' });
    assert.equal(await h.page.locator('#cloud-email').isVisible(), true, 'recovery can open the switch form even while another account is remembered');
    assert.equal(await h.page.getByRole('button', { name: 'Keep current account', exact: true }).isVisible(), true);
    await fillAccount(h.page); await h.page.locator('#cloud-password').press('Enter');
    await h.page.locator('#bbAuthFeedback').filter({ hasText: 'Invalid login credentials' }).waitFor();
    assert.equal(await h.page.evaluate(actor => window.BasketBossSession.read()?.user?.id === actor, PRIOR_USER_ID), true, 'a rejected new login retains the existing verified session');
    assert.deepEqual(await draft(h.page), priorDraft);
    assert.equal(await h.page.locator('#cloud-login').isVisible(), true);
    await Promise.all([h.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), h.page.locator('#cloud-password').press('Enter')]);
    await h.page.waitForFunction(actor => window.__authOnboardingQA?.ready() && window.BasketBossSession.read()?.user?.id === actor, USER_ID);
    assert.deepEqual(await draft(h.page), { planned: [], pantry: {}, stock: {}, inventory: null }, 'only the verified new account switches the visible private profile');
    assert.equal(h.authRequests.filter(request => request.grant === 'password').length, 2);
    assert.equal(h.authRequests.filter(request => request.kind === 'verified-user').length, 1);
    assert.equal(count(h.events, 'signup_succeeded'), 0);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});
