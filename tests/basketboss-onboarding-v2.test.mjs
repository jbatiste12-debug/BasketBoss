import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const index=fs.readFileSync('index.html','utf8');
const splash=fs.readFileSync('bb-welcome-splash.js','utf8');
const trial=fs.readFileSync('bb-intro-trial.js','utf8');
const onboarding=fs.readFileSync('bb-onboarding-v2.js','utf8');
const style=fs.readFileSync('bb-onboarding-v2.css','utf8');
const compare=fs.readFileSync('compare.html','utf8');

test('new onboarding runs before legacy animation without modifying its artwork',()=>{
 assert.match(index,/bb-onboarding-v2\.js\?v=20261028-onboard-v2/);
 assert.match(index,/bb-onboarding-v2\.css\?v=20261028-onboard-v2/);
 assert.ok(index.indexOf('bb-onboarding-v2.js')<index.indexOf('bb-welcome-splash.js'));
 assert.match(index,/if\(window\.BBOnboard2026\?\.willShow\(\)\)return;/);
 assert.match(splash,/!window\.BBOnboard2026\?\.willShow\(\)/);
});
test('the real Supabase controls are reused and restored; signup is not replaced',()=>{
 assert.match(index,/id="cloud-auth"/);assert.match(index,/id="cloud-signup"/);
 assert.match(onboarding,/id\('cloud-auth'\)/);assert.match(onboarding,/restoreAuth\(\)/);
 assert.doesNotMatch(onboarding,/auth\/v1\/signup|GEMINI_API_KEY|PADDLE_LIVE_API_KEY/);
});
test('all required onboarding screens and actual logo are present',()=>{
 for(const phrase of ['Welcome to BasketBoss','YOUR ACCOUNT','HOUSEHOLD','WHAT MATTERS MOST','YOUR PREFERENCES','STEP 1 OF 3','STEP 2 OF 3','STEP 3 OF 3','You’re all set','Choose your BasketBoss experience'])
  assert.ok(onboarding.includes(phrase),`missing screen: ${phrase}`);
 assert.match(onboarding,/icons\/basketboss-crowned-v1766-512\.png/);
 assert.match(style,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(onboarding,/Sheet-pan chicken fajitas/);
 assert.match(onboarding,/release-assets\/basketboss-v17\/images\/existing\/fajitas\.webp/);
 assert.match(onboarding,/REGIONS/);
 assert.match(onboarding,/bb307SaveMarket/);
});
test('Free is an explicit no-payment option and Premium opens existing offer',()=>{
 assert.match(onboarding,/Continue with BasketBoss Free/);
 assert.match(onboarding,/Explore Premium plans/);
 assert.match(onboarding,/BBIntroTrialOffer\?\.open/);
 assert.match(trial,/BBIntroTrialOffer = \{ open: \(\) => openOffer\(true\) \}/);
 assert.match(onboarding,/Founder places are not guaranteed/);
});
test('founder story is optional while privacy, pricing and feedback remain',()=>{
 assert.match(onboarding,/SHOW_FOUNDER_STORY=false/);
 assert.doesNotMatch(index,/id="bb2026Trust"/);
 assert.match(index,/href="privacy\.html"/);
 assert.match(index,/href="subscriptions\.html"/);
 assert.match(compare,/Made by a dad of four/);
});
test('legacy Paddle, Cloud D1 quota and camera routes are untouched',()=>{
 assert.match(index,/id="cloud-login"/);
 assert.match(index,/data-bbtrial-free/);
 assert.doesNotMatch(onboarding,/consumeQuota|siteVerify|Paddle\.Checkout|MediaDevices\.getUserMedia/);
});
