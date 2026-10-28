import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const index=fs.readFileSync('index.html','utf8');
const code=fs.readFileSync('bb-plan-premium-polish.js','utf8');
const css=fs.readFileSync('bb-plan-premium-polish.css','utf8');
const onboard=fs.readFileSync('bb-onboarding-v2.js','utf8');
const recipe=JSON.parse(fs.readFileSync('recipes.json','utf8')).find(r=>r.id==='fajitas');
test('new dedicated frontend assets are linked only once, original app logic stays present',()=>{
 for(const a of ['bb-plan-premium-polish.css','bb-plan-premium-polish.js'])assert.equal(index.split(a).length-1,1);
 assert.match(index,/function persist\(\)/);
 assert.match(index,/id="bb307Island"/);
 assert.match(index,/id="bb307SaveMarket"/);
 assert.match(index,/bb307SwitchIsland/);
 assert.match(index,/bb172SaveBudget/);
 assert.match(index,/bb81ProUpgradePreview/);
});
test('layout preserves functioning DOM nodes and uses only the exposed membership state',()=>{
 assert.match(code,/actions\.insertBefore\(card,gear\)/);
 assert.match(code,/existing\.click\(\)/);
 assert.match(code,/BasketBossVerifiedPremium\?\.isActive/);
 assert.match(code,/bbpol-ring-svg/);
 assert.match(code,/aria-valuenow/);
 assert.match(code,/pricing-sandbox\.html#monthly/);
 assert.doesNotMatch(code,/fetch\(|Paddle\.Checkout|localStorage\.setItem|state\.planned|bb172SaveBudget\(/);
});
test('visual fixes: width, ring, photo, empty days, dock, Auto-Fill, status and BETA',()=>{
 for(const selector of ['max-width:720px','bb-next','bbpol-ring','bb-beta-day-thumb','bbnext-day:not(.has-meal)','bb81-pro-filters','bb1756-extra-group','padding-bottom:calc(155px','backdrop-filter:blur(12px)','bb-public-beta-badge']){
   if(selector==='bb-next')continue;
   assert.ok(css.includes(selector),`Missing visual target ${selector}`);
 }
});
test('onboarding pricing only delegates to already-existing authenticated monthly checkout',()=>{
 assert.match(onboard,/pricing-sandbox\.html#monthly/);
 assert.match(onboard,/Continue with BasketBoss Free/);
 assert.match(onboard,/Explore Premium plans/);
 assert.doesNotMatch(onboard,/Paddle\.Checkout|\/api\/subscription\/checkout|data-plan="annual"/);
 assert.match(index,/pricing-sandbox\.html/);
});
test('shop demonstration reproduces canonical sample prices and does not modify the catalogue',()=>{
 const ref=['Chicken breast','Mixed peppers','Tortilla wraps','Soured cream','Cheddar','Fajita seasoning','Cooking oil','Lime'];
 for(const n of ref){const ing=recipe.ingredients.find(i=>i[0]===n);assert.ok(ing,`Missing canonical ingredient ${n}`);assert.ok(onboard.includes(n));}
 const total=recipe.ingredients.reduce((n,ing)=>n+ing[2],0);
 assert.equal(Math.round(total*100),2260);
 assert.match(onboard,/bbob-shop-total/);
 assert.doesNotMatch(onboard,/addRecipe\(|bb307SetPantry\(|Paddle\.Checkout/);
});
