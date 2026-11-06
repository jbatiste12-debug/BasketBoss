import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {APP_STORE_ID, APP_STORE_URL, appStoreLaunchEnabled} from '../bb-server-lib/bb-app-store-launch.js';
import {getDownloadDestination} from '../bb-download-routing.mjs';
import {onRequest} from '../functions/download.js';

const live = {BB_APP_STORE_LAUNCH_ENABLED: 'true'};
const request = (url = 'https://basketboss.co.uk/download', method = 'GET') => new Request(url, {method});
const iphone = {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'};
const ipad = {userAgent: 'Mozilla/5.0 (iPad; CPU OS 26_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'};
const macUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.2 Safari/605.1.15';

test('the launch gate defaults off and accepts only the explicit release setting', async () => {
  assert.equal(APP_STORE_ID, '6829160611');
  assert.equal(APP_STORE_URL, 'https://apps.apple.com/app/id6829160611');
  for (const env of [undefined, null, {}, {BB_APP_STORE_LAUNCH_ENABLED: true}, {BB_APP_STORE_LAUNCH_ENABLED: 'TRUE'}, {BB_APP_STORE_LAUNCH_ENABLED: 'false'}]) {
    assert.equal(appStoreLaunchEnabled(env), false);
    const response = onRequest({request: request(), env});
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), '/#features');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await response.text(), '');
  }
  assert.equal(appStoreLaunchEnabled(live), true);
});

test('download only accepts GET and HEAD, without caching or executing a redirect for writes', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = onRequest({request: request(undefined, method), env: live});
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
    assert.equal(response.headers.get('Location'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  const head = onRequest({request: request(undefined, 'HEAD'), env: live});
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(await head.text(), '');
  const offHead = onRequest({request: request(undefined, 'HEAD'), env: {}});
  assert.equal(offHead.status, 302);
  assert.equal(offHead.headers.get('Location'), '/#features');
  assert.equal(await offHead.text(), '');
});

test('the browser utility recognizes Apple mobile devices including desktop-mode iPadOS', () => {
  for (const browser of [iphone, ipad, {userAgent: 'iPod touch'}, {userAgent: macUA, platform: 'MacIntel', maxTouchPoints: 5}, {platform: 'MacIntel', maxTouchPoints: 5}]) {
    assert.equal(getDownloadDestination(browser), APP_STORE_URL);
  }
  for (const browser of [undefined, null, {}, {userAgent: 'Mozilla/5.0 (Linux; Android 16)'}, {userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 10}, {userAgent: macUA, platform: 'MacIntel', maxTouchPoints: 0}, {userAgent: macUA, platform: 'MacIntel', maxTouchPoints: 1}, {userAgent: macUA, maxTouchPoints: '5'}]) {
    assert.equal(getDownloadDestination(browser), '/#features');
  }
});

test('custom App Store destinations stay on trusted HTTPS Apple app pages', () => {
  const url = 'https://apps.apple.com/gb/app/basketboss/id6829160611?pt=123&ct=website';
  assert.equal(getDownloadDestination(iphone, url), url);
  for (const bad of ['https://evil.example/app/id6829160611', 'https://apps.apple.com.evil.example/app/id6829160611', 'https://apps.apple.com:444/app/id6829160611', 'http://apps.apple.com/app/id6829160611', 'javascript:alert(1)', '//apps.apple.com/app/id6829160611', 'https://user:password@apps.apple.com/app/id6829160611', 'https://apps.apple.com/redirect', 'https://apps.apple.com/app/anything', 'not a URL']) {
    assert.equal(getDownloadDestination(iphone, bad), '/#features');
  }
});

test('the live route executes its actual script for mobile, desktop, Android and missing navigator', async () => {
  const response = onRequest({request: request(), env: live});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const page = await response.text();
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1);
  for (const [browser, expected] of [[iphone, APP_STORE_URL], [ipad, APP_STORE_URL], [{userAgent: macUA, maxTouchPoints: 5}, APP_STORE_URL], [{userAgent: macUA, maxTouchPoints: 0}, '/#features'], [{userAgent: 'Android 16'}, '/#features'], [undefined, '/#features']]) {
    const destinations = [];
    const context = {URL, location: {replace: url => destinations.push(url)}, ...(browser ? {navigator: browser} : {})};
    vm.runInNewContext(scripts[0], context);
    assert.deepEqual(destinations, [expected]);
  }
  assert.match(page, /href="https:\/\/apps\.apple\.com\/app\/id6829160611">Open BasketBoss in the App Store<\/a>/);
  assert.match(page, /href="\/#features">Explore BasketBoss features<\/a>/);
});

test('download metadata and routing ignore hostile request parameters and remain crawler-readable', async () => {
  const hostile = 'https://basketboss.co.uk/download?url=https://evil.example&app_id=1&next=%22%3E%3Cscript%3Ealert(1)%3C/script%3E';
  const page = await onRequest({request: request(hostile), env: live}).text();
  assert.doesNotMatch(page, /evil\.example|alert\(1\)|app_id=1/);
  assert.match(page, /<link rel="canonical" href="https:\/\/basketboss\.co\.uk\/">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/basketboss\.co\.uk\/">/);
  assert.match(page, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(page, /<meta property="og:image" content="https:\/\/basketboss\.co\.uk\/[^\"]+\.png">/);
  assert.match(page, /<meta property="og:image:width" content="1200">/);
  assert.match(page, /<meta property="og:image:height" content="630">/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|\/api\/|\bfetch\s*\(|Authorization/);
});
