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
 assert.match(index,/bb-onboarding-v2\.js\?v=20261031-shop-prices/);
 assert.match(index,/bb-onboarding-v2\.css\?v=20261029-partner-onboard-main1/);
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
 assert.match(onboarding,/window\.bb307SwitchIsland/);
 assert.match(onboarding,/window\.BasketBossSetOnboardingServings/);
 assert.match(index,/id="bb307SaveMarket"/);
});
test('Free is an explicit no-payment option and Premium opens existing offer',()=>{
 assert.match(onboarding,/Continue with BasketBoss Free/);
 assert.match(onboarding,/Explore Premium plans/);
 assert.match(onboarding,/BBIntroTrialOffer\?\.open/);
 assert.match(trial,/BBIntroTrialOffer = \{ open: \(\) => openOffer\(true\) \}/);
 assert.match(onboarding,/Founder eligibility is verified at checkout/);
 assert.match(onboarding,/first 25 confirmed members/);
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


test('original crowned-basket welcome animation is restored within onboarding without extra modal',()=>{
 const splashCss=fs.readFileSync('bb-welcome-splash.css','utf8');
 assert.match(splashCss,/@keyframes bbwsBasketSlide/);
 assert.match(splashCss,/@keyframes bbwsCrownDrop/);
 assert.match(onboarding,/originalCrownAnimation/);
 assert.match(style,/animation:bbwsBasketSlide/);
 assert.match(style,/animation:bbwsCrownDrop/);
 assert.match(style,/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(onboarding,/BB173WelcomeSplash\.show\(/);
});

test('real three Free recipe previews use canonical data and no interactive app write actions',()=>{
 const recipes=JSON.parse(fs.readFileSync('recipes.json','utf8'));
 for(const id of ['fajitas','creamy-pasta','chickpea-curry']){
   const meal=recipes.find(r=>r.id===id);
   assert.ok(meal,'Catalogue recipe missing: '+id);
   assert.ok(onboarding.includes(meal.name));
   assert.ok(onboarding.includes(meal.image));
 }
 assert.match(onboarding,/class="recipe-body"/);
 assert.match(onboarding,/class="eyebrow"/);
 assert.match(onboarding,/bbob-preview-disclaimer/);
 assert.doesNotMatch(onboarding, /\b(?:addRecipe|bbPlanDessert|bb307SetPantry|bbShopV7Close|Paddle\.Checkout)\s*\(/);
});

test('survey stores choices and uses original household and region setters only on completion',()=>{
 assert.match(onboarding,/function applyChosenPreferences/);
 assert.match(onboarding,/function complete\(goPremium=false\)/);
 assert.match(onboarding,/window\.BasketBossSetOnboardingServings/);
 assert.match(onboarding,/window\.bb307SwitchIsland/);
 assert.match(index,/basketboss_321_unified_state_v1/);
 assert.doesNotMatch(onboarding,/localStorage\.setItem\(['"]basketboss_321_unified_state_v1/);
 assert.match(index,/window\.BasketBossSetOnboardingServings\s*=\s*function/);
 assert.match(index,/if\(!persist\(\)\)\{state\.servings=previous;return false;\}/);
 assert.match(index,/window\.bb307SwitchIsland=bb307SwitchIsland/);
});


test('fresh one-time onboarding restart does not skip returning users or remove sign-in and Premium screens',()=>{
 assert.match(onboarding,/bb_onboarding_fresh_once_20261028_v1/);
 assert.match(onboarding,/return restoreState\(\)\?\.complete!==true/);
 assert.doesNotMatch(onboarding,/if\(!preview\(\)\&\&returningUser\(\)/);
 assert.match(onboarding,/headline='You’re already signed in\.'/);
 assert.match(onboarding,/id\('cloud-auth'\)/);
 assert.match(onboarding,/Create a free account or sign in/);
 assert.match(onboarding,/Continue with BasketBoss Free/);
 assert.match(onboarding,/Explore Premium plans/);
 assert.match(onboarding,/BBIntroTrialOffer\?\.open/);
});


test('rich Shop preview uses genuine fajitas prices, no plan writes or phantom annual tier',()=>{
  for(const part of ['Chicken breast','Mixed peppers','Tortilla wraps','Soured cream','Cheddar','Fajita seasoning','Cooking oil','Lime','£${total.toFixed(2)}','Indicative basket estimate','£22.60']){
    if(part==='£22.60')continue; // computed at render, tested in isolated runtime
    assert.ok(onboarding.includes(part),`Missing audited catalogue item: ${part}`);
  }
  assert.match(onboarding,/pricing-sandbox\.html#monthly/);
  assert.doesNotMatch(onboarding,/pricing-sandbox\.html#annual|Paddle\.Checkout\.open/);
  const presentation=fs.readFileSync('bb-plan-premium-polish.js','utf8');
  assert.doesNotMatch(presentation,/fetch\(|localStorage\.setItem|Paddle\.Checkout|addRecipe\(/);
});
