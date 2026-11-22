import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), root = fileURLToPath(new URL('..', import.meta.url));
const SESSION = 'basketboss_cloud_session_v1', EMAIL = 'account-frames@example.invalid';
let chromium, browser, documentHTML;
for (const module of [process.env.BB_PLAYWRIGHT_MODULE, 'playwright', '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(module)); break; } catch {}
}
before(async () => {
  const source = await fs.readFile(path.join(root, 'app.html'), 'utf8');
  const begin = source.indexOf('<style>\n#cloud-account'), open = source.indexOf("if(location.hash==='#account')", begin);
  assert.ok(begin > 0 && open > begin);
  const account = source.slice(begin, source.indexOf('</script>', open) + '</script>'.length);
  // Use the actual account markup, legacy owner, session manager and modern SDK
  // controller. Only unrelated planner UI is omitted from this focused fixture.
  documentHTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>*{box-sizing:border-box}body{margin:0}</style>
    <script src="/bb-auth-callback.js"></script>
    <link rel="stylesheet" href="/bb-account-polish.css"><script defer src="/bb-account-polish.js"></script>
    <link rel="stylesheet" href="/bb-auth-flow.css"><script defer src="/bb-auth-sdk.js"></script><script defer src="/bb-auth-flow.js"></script>
    </head><body><main class="shell"><h1>Saved kitchen behind account</h1><button>Planner control</button></main>
    <div class="bbui-settings-overlay">Settings behind account</div>${account}</body></html>`;
  if (chromium) browser = await chromium.launch({ headless: true, executablePath: process.env.BB_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); });
const options = { skip: !chromium && 'Playwright unavailable', timeout: 30000 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function session() {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: 'synthetic-frame-token', refresh_token: 'synthetic-frame-refresh', expires_at: expires, token_type: 'bearer', user: { id: '00000000-0000-4000-8000-000000000111', email: EMAIL, email_confirmed_at: '2026-11-01T00:00:00Z' } };
}
async function fixture({ holdScript, missingSDK = false, returning = false, width = 390, height = 844, native = '', providerOutcome = 'available', holdProvider = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'no-preference', serviceWorkers: 'block' });
  const page = await context.newPage(), scriptGate = deferred(), verifyGate = deferred(), providerGate = deferred(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: {
      'X-Supabase-Api-Version': '2024-01-01', 'Access-Control-Allow-Origin': 'https://basketboss.co.uk', 'Access-Control-Expose-Headers': 'X-Supabase-Api-Version',
    }, body: JSON.stringify(body) });
    if (url.hostname.endsWith('.supabase.co')) {
      requests.push({ path: url.pathname, method: request.method() });
      if (url.pathname === '/auth/v1/settings') {
        if (holdProvider) await providerGate.promise;
        if (providerOutcome === 'error') return json({ message: 'Synthetic settings outage' }, 503);
        return json({ external: { email: true, apple: providerOutcome !== 'disabled' } });
      }
      if (url.pathname === '/auth/v1/recover') return json({});
      if (url.pathname === '/auth/v1/verify') { await verifyGate.promise; return json({ code: 'otp_expired', msg: 'This email link is invalid or has expired.' }, 403); }
      if (url.pathname === '/auth/v1/token') return json(session());
      if (url.pathname === '/auth/v1/user') return json(session().user);
      return json([]);
    }
    if (url.hostname !== 'basketboss.co.uk') return route.fulfill({ status: 200, body: '' });
    if (url.pathname.startsWith('/api/')) return json({ ok: true, available: true, nativeOnly: true, deletionReady: true });
    if (url.pathname === '/app') return route.fulfill({ contentType: 'text/html', body: documentHTML });
    const relative = url.pathname.replace(/^\//, '');
    if (relative === holdScript) await scriptGate.promise;
    if (relative === 'bb-auth-sdk.js' && missingSDK) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (relative.includes('..')) return route.fulfill({ status: 404, body: '' });
    try {
      const body = await fs.readFile(path.join(root, relative));
      return route.fulfill({ contentType: relative.endsWith('.css') ? 'text/css' : 'application/javascript', body });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await context.addInitScript(({ returning, savedSession, sessionKey, native, providerOutcome }) => {
    if (native) {
      document.documentElement?.classList.add('bb-native-' + native);
      window.BBNative = { isNative: true, platform: native, apiURL: value => 'https://basketboss.co.uk' + value };
      window.BBNativeAppleAuth = { available: async () => providerOutcome !== 'unavailable' };
    }
    window.addEventListener('basketboss:apple-auth-availability', () => { window.__providerSettled = true; });
    if (returning) localStorage.setItem(sessionKey, JSON.stringify(savedSession));
    window.__accountFrames = [];
    const visible = node => !!node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
    const sample = () => {
      const panel = document.getElementById('cloud-panel'), form = document.getElementById('cloud-auth');
      if (panel?.classList.contains('open')) window.__accountFrames.push({
        ready: !!form?.dataset.bbAuthView, view: form?.dataset.bbAuthView,
        title: document.querySelector('#cloud-card h2')?.textContent,
        heading: visible(document.querySelector('#cloud-card h2')), status: visible(document.getElementById('cloud-status')), close: visible(document.getElementById('cloud-close')),
        email: visible(document.getElementById('cloud-email')), login: visible(document.getElementById('cloud-login')), signup: visible(document.getElementById('cloud-signup')),
        signed: visible(document.getElementById('cloud-signed')), shell: visible(document.querySelector('.shell')),
        background: getComputedStyle(panel).backgroundColor, cardBackground: getComputedStyle(document.getElementById('cloud-card')).backgroundColor,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { returning, savedSession: session(), sessionKey: SESSION, native, providerOutcome });
  const navigation = page.goto('https://basketboss.co.uk/app#account', { waitUntil: 'domcontentloaded' });
  navigation.catch(() => {});
  await page.waitForFunction(() => document.getElementById('cloud-panel')?.classList.contains('open'));
  return { context, page, navigation, errors, requests, releaseScript: scriptGate.resolve, releaseVerify: verifyGate.resolve, releaseProvider: providerGate.resolve };
}
const nextFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function paintedAction(page, id) {
  await page.evaluate(id => new Promise(resolve => requestAnimationFrame(() => { document.getElementById(id).click(); resolve(); })), id);
  await nextFrames(page);
}

test('normal-motion first frames conceal legacy controls while SDK or controller is delayed', options, async () => {
  for (const holdScript of ['bb-auth-sdk.js', 'bb-auth-flow.js']) for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
    const h = await fixture({ holdScript, ...size });
    try {
      await nextFrames(h.page);
      const frames = await h.page.evaluate(() => window.__accountFrames.filter(frame => !frame.ready));
      assert.ok(frames.length >= 1, 'observe frames before controller readiness');
      assert.ok(frames.every(frame => !frame.email && !frame.login && !frame.signup), JSON.stringify({ holdScript, size, frames }));
      assert.ok(frames.every(frame => !frame.shell && frame.background === 'rgb(245, 247, 239)'), JSON.stringify(frames));
      assert.ok(frames.every(frame => (!frame.heading || frame.title !== '☁ BasketBoss account') && frame.close && frame.cardBackground === 'rgb(255, 253, 247)'), JSON.stringify(frames));
      await h.page.locator('#cloud-close').waitFor({ state: 'visible' });
      h.releaseScript(); await h.navigation;
      await h.page.waitForFunction(() => !!window.BBAuthFlow);
      assert.equal(await h.page.locator('#cloud-login').isVisible(), true);
      assert.equal(await h.page.locator('#cloud-signup').isVisible(), false);
      assert.deepEqual(h.errors, []);
    } finally { h.releaseScript(); await h.context.close(); }
  }
});

test('failed SDK retains readable failure copy and a working close control', options, async () => {
  const h = await fixture({ missingSDK: true });
  try {
    await h.navigation; await nextFrames(h.page);
    assert.match(await h.page.locator('#cloud-message').innerText(), /Account tools could not load/);
    assert.equal(await h.page.locator('#cloud-message').isVisible(), true);
    assert.equal(await h.page.locator('#cloud-email').isVisible(), false);
    await h.page.locator('#cloud-close').click();
    assert.equal(await h.page.locator('#cloud-panel').isVisible(), false);
    assert.equal(await h.page.locator('.shell').isVisible(), true);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test('the readiness gate follows the original form into onboarding without hiding its loading copy', options, async () => {
  const h = await fixture({ holdScript: 'bb-auth-flow.js' });
  try {
    await h.page.evaluate(() => {
      document.getElementById('cloud-close').click();
      const host = document.createElement('div'); host.id = 'bbNewOnboarding';
      host.append(document.getElementById('cloud-auth'), document.getElementById('cloud-message')); document.body.append(host);
    });
    await nextFrames(h.page);
    assert.equal(await h.page.locator('#bbNewOnboarding').isVisible(), true);
    assert.equal(await h.page.locator('#cloud-email').isVisible(), false);
    assert.equal(await h.page.locator('#cloud-login').isVisible(), false);
    assert.equal(await h.page.locator('#cloud-signup').isVisible(), false);
    assert.match(await h.page.locator('#cloud-auth').evaluate(node => getComputedStyle(node, '::before').content), /Account tools are opening/);
    assert.equal(await h.page.locator('#cloud-message').isVisible(), true);
    h.releaseScript(); await h.navigation;
    await h.page.waitForFunction(() => !!window.BBAuthFlow);
    assert.equal(await h.page.locator('#cloud-login').isVisible(), true);
    assert.deepEqual(h.errors, []);
  } finally { h.releaseScript(); await h.context.close(); }
});

test('each painted forgot, reset, verifying and link-error frame has the matching account heading', options, async () => {
  const h = await fixture();
  try {
    await h.navigation; await h.page.waitForFunction(() => !!window.BBAuthFlow); await nextFrames(h.page);
    await h.page.evaluate(() => { window.__accountFrames = []; });
    await paintedAction(h.page, 'bbAuthForgot');
    await h.page.locator('#bbAuthResetEmail').fill(EMAIL);
    await paintedAction(h.page, 'bbAuthReset');
    await h.page.waitForFunction(() => document.getElementById('cloud-auth').dataset.bbAuthView === 'reset-sent');
    await nextFrames(h.page);
    await h.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => { void window.BBAuthFlow.handleCallbackURL('https://basketboss.co.uk/app?token_hash=synthetic-expired-reset&type=recovery'); resolve(); })));
    await h.page.waitForFunction(() => document.getElementById('cloud-auth').dataset.bbAuthView === 'verifying');
    await nextFrames(h.page); h.releaseVerify();
    await h.page.waitForFunction(() => document.getElementById('cloud-auth').dataset.bbAuthView === 'link-error');
    await nextFrames(h.page);
    const frames = await h.page.evaluate(() => window.__accountFrames);
    const titles = { 'sign-in': 'Welcome back.', 'forgot-password': 'Reset your password.', 'reset-sent': 'Check your email.', verifying: 'Checking your link…', 'link-error': 'This link couldn’t be used.' };
    assert.ok(['forgot-password', 'reset-sent', 'verifying', 'link-error'].every(view => frames.some(frame => frame.view === view)), JSON.stringify(frames));
    assert.deepEqual(frames.filter(frame => frame.title !== titles[frame.view]), [], 'no frame mixes a new auth view with an old heading');
    assert.ok(frames.filter(frame => frame.view !== 'sign-in').every(frame => !frame.email && !frame.login && !frame.signup && !frame.signed));
    assert.deepEqual(h.errors, []);
  } finally { h.releaseVerify(); await h.context.close(); }
});

test('returning account and sign-out never paint both member controls and a legacy form', options, async () => {
  const h = await fixture({ returning: true });
  try {
    await h.navigation; await h.page.waitForFunction(() => !!window.BBAuthFlow); await nextFrames(h.page);
    assert.equal(await h.page.locator('#cloud-signed').isVisible(), true);
    await h.page.evaluate(() => { window.__accountFrames = []; });
    await paintedAction(h.page, 'cloud-logout');
    const frames = await h.page.evaluate(() => window.__accountFrames);
    assert.ok(frames.some(frame => frame.email && frame.login));
    assert.ok(frames.every(frame => !(frame.signed && frame.email) && !frame.signup), JSON.stringify(frames));
    assert.ok(frames.filter(frame => frame.email).every(frame => frame.title === 'Welcome back.'), JSON.stringify(frames));
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test('native provider group keeps email and submit bounds stable without blocking email or adding a recovery slot', options, async () => {
  const measurements = [], directory = path.join(os.tmpdir(), 'basketboss-ui-previews/account-providers');
  await fs.mkdir(directory, { recursive: true });
  for (const scenario of [
    { native: 'ios', providerOutcome: 'available' },
    { native: 'android', providerOutcome: 'unavailable' },
    { native: 'android', providerOutcome: 'disabled' },
    { native: 'ios', providerOutcome: 'error' },
    { native: 'ios', providerOutcome: 'error', width: 320 },
    { native: 'ios', providerOutcome: 'available', width: 844, height: 390 },
    { native: 'ios', providerOutcome: 'error', width: 844, height: 390 },
  ]) for (const mode of ['sign-in', 'sign-up']) {
    const h = await fixture({ ...scenario, holdProvider: true });
    try {
      await h.navigation; await h.page.waitForFunction(() => !!window.BBAuthFlow); await nextFrames(h.page);
      if (mode === 'sign-up') await h.page.locator('#bbAuthSignupMode').click();
      await h.page.locator('#cloud-email').fill(EMAIL); await h.page.locator('#cloud-password').fill('synthetic-frame-password');
      await nextFrames(h.page);
      const bounds = () => h.page.evaluate(() => Object.fromEntries(['cloud-card', 'cloud-email', 'cloud-login', 'cloud-signup', 'bbAuthProviders', 'bbAuthAppleSection'].map(id => {
        const node = document.getElementById(id), rect = node.getBoundingClientRect(); return [id, { top: rect.top, height: rect.height, scrollTop: node.scrollTop }];
      })));
      const before = await bounds(), submit = mode === 'sign-up' ? 'cloud-signup' : 'cloud-login';
      assert.equal(await h.page.locator('#' + submit).isEnabled(), true, 'email submission remains available while provider settings are pending');
      assert.equal(h.requests.filter(request => request.path === '/auth/v1/token' || request.path === '/auth/v1/signup').length, 0);
      h.releaseProvider(); await h.page.waitForFunction(() => window.__providerSettled); await nextFrames(h.page);
      const after = await bounds();
      measurements.push({ scenario, mode, before, after });
      if (mode === 'sign-in') await h.page.screenshot({ path: path.join(directory, `${scenario.native}-${scenario.providerOutcome}-${scenario.width || 390}-${scenario.height || 844}.png`) });
      for (const id of ['cloud-card', 'cloud-email', submit, 'bbAuthProviders']) {
        assert.ok(Math.abs(before[id].top - after[id].top) < 0.1 && Math.abs(before[id].height - after[id].height) < 0.1, JSON.stringify({ scenario, mode, id, before, after }));
      }
      // The shared Apple/Google wrapper reserves platform rows before either
      // provider settles. Its initially hidden child is allowed to become visible.
      assert.equal(after.bbAuthProviders.height, scenario.native === 'ios' ? 132 : 66);
      const applePlatform = scenario.native === 'ios';
      assert.equal(await h.page.locator('#bbAuthApple').isVisible(), applePlatform && scenario.providerOutcome === 'available');
      if (applePlatform && scenario.providerOutcome === 'available') assert.equal(await h.page.locator('#bbAuthApple').isEnabled(), true);
      assert.equal(await h.page.locator('#bbAuthAppleRetry').isVisible(), applePlatform && scenario.providerOutcome === 'error');
      if (applePlatform && scenario.providerOutcome === 'error') assert.equal(await h.page.locator('#bbAuthAppleRetry').isEnabled(), true);
      assert.equal(await h.page.locator('#bbAuthAppleStatus').isVisible(), applePlatform && ['unavailable', 'error'].includes(scenario.providerOutcome));
      assert.equal(await h.page.locator('#bbAuthAppleDivider').isVisible(), false);
      if (scenario.providerOutcome === 'disabled') assert.match(await h.page.locator('#bbAuthProviders').evaluate(node => getComputedStyle(node, '::before').content), /continue with email/);
      const row = await h.page.locator('#bbAuthAppleSection').evaluate(node => {
        const rect = node.getBoundingClientRect(), group = node.closest('#bbAuthProviders').getBoundingClientRect(); return { visible: node.getClientRects().length > 0, top: rect.top, bottom: rect.bottom, groupTop: group.top, groupBottom: group.bottom, children: [...node.children].filter(child => child.getClientRects().length).map(child => ({ top: child.getBoundingClientRect().top, bottom: child.getBoundingClientRect().bottom })) };
      });
      if (row.visible) assert.ok(row.top >= row.groupTop - 0.1 && row.bottom <= row.groupBottom + 0.1, JSON.stringify({ scenario, row }));
      assert.ok(row.children.every(child => child.top >= row.top - 0.1 && child.bottom <= row.bottom + 0.1), JSON.stringify({ scenario, row }));
      await h.page.locator('#cloud-close').click(); await h.page.locator('#cloud-open').click(); await nextFrames(h.page);
      // Normal Account entry selects sign-in; compare the same mode on reopen.
      if (mode === 'sign-up') await h.page.locator('#bbAuthSignupMode').click();
      await nextFrames(h.page); const reopened = await bounds();
      // A short viewport can scroll the focused password within the card.
      // Compare content positions so the existing blur/focus scroll behavior
      // remains independent of the provider reservation.
      assert.ok(Math.abs(after['cloud-email'].top + after['cloud-card'].scrollTop - reopened['cloud-email'].top - reopened['cloud-card'].scrollTop) < 0.1, JSON.stringify({ scenario, mode, after, reopened }));
      assert.equal(after.bbAuthProviders.height, reopened.bbAuthProviders.height);
      assert.equal(await h.page.locator('#cloud-email').inputValue(), EMAIL);
      await h.page.locator('#bbAuthSigninMode').click(); await h.page.locator('#bbAuthForgot').click(); await nextFrames(h.page);
      assert.equal(await h.page.locator('#bbAuthAppleSection').isVisible(), false, 'recovery has no provider reservation');
      assert.equal(await h.page.locator('#bbAuthProviders').isVisible(), false, 'recovery has no shared provider reservation');
      assert.equal((await bounds()).bbAuthProviders.height, 0);
      assert.equal((await bounds()).bbAuthAppleSection.height, 0);
      assert.deepEqual(h.errors, []);
    } finally { h.releaseProvider(); await h.context.close(); }
  }
  await fs.writeFile(path.join(directory, 'bounds.json'), JSON.stringify(measurements, null, 2));
});
