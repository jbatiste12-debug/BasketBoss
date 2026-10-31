import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read = path => fs.readFile(new URL('../'+path,import.meta.url),'utf8');

const [index,terms,pricing,compare,privacy,subscription] = await Promise.all([
  read('index.html'),read('terms.html'),read('pricing-sandbox.html'),read('compare.html'),read('privacy.html'),read('subscriptions.html')
]);

test('Founder story lives on Why BasketBoss, not on working app',()=>{
  assert.doesNotMatch(index, /id="bb2026Trust"/);
  assert.doesNotMatch(index, /Built for busy families, by a dad of four/);
  assert.match(compare, /Made by a dad of four/);
  assert.match(index, /href="compare.html"/);
  assert.match(index, /href="privacy.html"/);
  assert.match(index, /href="subscriptions.html"/);
  assert.match(index, /mailto:support@basketboss.co.uk/);
});
test('Comparison page is accurate, accessible and links to existing actual product',()=>{
  assert.match(compare, /<html lang="en-GB">/);
  assert.match(compare, /<h1>More dinner ideas/);
  assert.match(compare, /<th scope="col">Free<\/th>/);
  assert.match(compare, /<th scope="col">Premium<\/th>/);
  assert.match(compare, /100 recipes/);
  assert.match(compare, /500 recipes/);
  assert.match(compare, /7-day free trial, then £1\.99\/month/);
  assert.match(compare, /3-day free trial, then £4\.99\/month/);
  assert.match(compare, /first 25 eligible confirmed subscribers/);
  assert.match(compare, /up to 5 scans and 10 meal ideas per day/);
  assert.match(compare, /subject to usage limits/);
  assert.match(compare, /href="basketboss-latest-guide.html"/);
  assert.match(compare, /href="pricing-sandbox.html"/);
  assert.match(compare, /href="privacy.html"/);
  assert.match(compare, /href="subscriptions.html"/);
  assert.doesNotMatch(compare, /(?:5-star|⭐⭐⭐⭐⭐|trusted by thousands|as seen on|number 1 app)/i);
});

test('Outdated paid-checkout notice is corrected without changing existing legal rights',()=>{
  assert.doesNotMatch(terms, /Paid checkout is not yet available/);
  assert.match(terms, /Premium checkout is available where enabled/);
  assert.match(terms, /Last updated 28 October 2026/);
  assert.match(terms, /Nothing in these Terms removes mandatory consumer rights/);
  assert.match(terms, /Paddle processes subscription payments as merchant of record/);
});

test('Pricing points to comparison but checkout and eligibility controls remain external',()=>{
  assert.match(pricing, /href="compare.html"/);
  assert.match(pricing, /data-plan="founder"/);
  assert.match(pricing, /data-plan="monthly"/);
  assert.match(pricing, /first 25 qualifying confirmed members/);
  assert.match(pricing, /paddle-sandbox\.js\?v=bb-live-checkout-20261027-v2-mobile/);
  assert.match(pricing, /paddle\.com\/paddle\/v2\/paddle\.js/);
});

test('Trust material links to real current policy and subscription documents',()=>{
  assert.match(privacy, /Plans|meal plans|localStorage/);
  assert.match(privacy, /support@basketboss\.co\.uk/);
  assert.match(subscription, /Manage subscription|Manage or cancel/);
  assert.match(subscription, /£1\.99\/month/);
  assert.match(subscription, /£4\.99\/month/);
  assert.match(subscription, /Paddle/);
});
