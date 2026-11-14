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

function user(confirmed = true, provider = 'email') {
  return { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: SYNTHETIC_EMAIL,
    created_at: '2026-11-01T00:00:00Z', updated_at: new Date().toISOString(),
    email_confirmed_at: confirmed ? '2026-11-01T00:00:00Z' : null,
    confirmation_sent_at: '2026-11-01T00:00:00Z', app_metadata: { provider, providers: [provider] }, user_metadata: {},
    identities: [{ id: USER_ID, user_id: USER_ID, provider, identity_data: { sub: USER_ID } }] };
}
function session(provider = 'email') {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: USER_ID, exp: expires, aud: 'authenticated', role: 'authenticated' }) + '.synthetic-signature';
  return { access_token: token, refresh_token: 'synthetic-refresh-only-for-local-routing', token_type: 'bearer', expires_in: 3600, expires_at: expires, user: user(true, provider) };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture({ returning = false, existingSession = false, native = false, appleProvider = false, deletionReady = true, signupOutcomes = ['pending'], holdSignup = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], authRequests = [], events = [], checks = { deletion: false }, gate = deferred();
  let signupCount = 0, connected = existingSession;
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
        connected = true;
        return json(session(grant === 'id_token' ? 'apple' : 'email'));
      }
      if (url.pathname === '/auth/v1/user') { authRequests.push({ kind: 'verified-user' }); return json(user(true, native ? 'apple' : 'email')); }
      if (url.pathname === '/auth/v1/logout') return json({});
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
  await context.addInitScript(({ returning, existingSession, native, savedSession, onboardingKey, sessionKey }) => {
    if (!localStorage.getItem('auth-onboarding-browser-fixture-v1')) {
      localStorage.setItem('basketboss_321_unified_state_v1', JSON.stringify({ version: 2, planned: returning ? [{ recipeId: 'veggie-fried-rice', day: 'Monday', servings: 3 }] : [], plannedBreakfasts: [], plannedDesserts: [], servings: 4, feedingSet: true, pantry: returning ? { Rice: true } : {}, mealPreferences: { version: 1, scope: 'guest', diets: [], goals: [] } }));
      localStorage.setItem('basketboss_321_v7_measured_pantry', JSON.stringify(returning ? { 'long-grain rice|g': 300 } : {}));
      localStorage.setItem('basketboss_321_v7_market', 'UK');
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
  }, { returning, existingSession, native, savedSession: session(), onboardingKey: ONBOARDING, sessionKey: SESSION });
  await page.goto('https://basketboss.co.uk/app', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__authOnboardingQA?.ready());
  return { page, context, errors, authRequests, events, checks, releaseSignup: gate.resolve };
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
    await h.page.getByRole('button', { name: 'Explore BasketBoss Free', exact: true }).click();
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

test('Apple is native-only and requires provider plus deletion readiness before real SDK token exchange', options, async () => {
  for (const settings of [{ native: false, appleProvider: true, deletionReady: true }, { native: true, appleProvider: true, deletionReady: false }, { native: true, appleProvider: true, deletionReady: true }]) {
    const h = await fixture(settings);
    try {
      await openSignup(h.page);
      if (!settings.native || !settings.deletionReady) {
        if (settings.native) {
          await assertEventually(() => h.checks.deletion, 'native Apple deletion readiness must be checked');
          await h.page.evaluate(() => new Promise(requestAnimationFrame));
        }
        assert.equal(await h.page.locator('#bbAuthApple').isVisible(), false);
        assert.equal(h.authRequests.filter(x => x.grant === 'id_token').length, 0);
      } else {
        await h.page.locator('#bbAuthApple').waitFor({ state: 'visible' });
        await h.page.locator('#bbAuthApple').click();
        await h.page.waitForFunction(() => window.BasketBossSession?.state().remembered === true);
        assert.equal(await h.page.evaluate(() => window.__nativeAppleCalls), 1);
        assert.equal(h.authRequests.filter(x => x.grant === 'id_token').length, 1);
        assert.ok(h.authRequests.find(x => x.grant === 'id_token').appleNonce);
        assert.ok(h.authRequests.find(x => x.grant === 'id_token').appleProvider);
        await waitEvent(h.page, h.events, 'signup_succeeded');
      }
      assert.deepEqual(h.errors, []);
    } finally { await h.context.close(); }
  }
});
