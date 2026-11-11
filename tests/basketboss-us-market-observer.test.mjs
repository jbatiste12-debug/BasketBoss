import test,{before,after,describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
let browser;
const source=fs.readFileSync(new URL('../bb-us-market.js',import.meta.url),'utf8');
const readableSources=['bb-shop-purchase-ui.js','bb-recipe-measures.js'].map(name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'));
const markup=`<!doctype html><meta charset="utf-8"><main>
<section id="bb17RegionCard"><div class="bb17-price-details"><span>Original regional guide.</span></div></section>
<p id="food">Courgette · 100 g</p>
<div id="bbPremiumDialog" hidden><span class="bb-premium-price">£4.99 per month</span><p id="bbPremiumDescription">Original membership explanation.</p><a aria-label="Premium £4.99">Membership</a></div>
</main>`;

async function fixture(run,{market='UK',readableHelpers=false}={}){
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('https://basketboss.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:markup}));
  await page.goto('https://basketboss.test/');
  await page.evaluate(market=>{
   localStorage.setItem('basketboss_321_v7_market',market);
   window.BBPriceV19={regionalMarkets:{US:{currency:'USD'}}};
   window.__marketFrames=0;
   const frame=requestAnimationFrame.bind(window);
   window.requestAnimationFrame=callback=>frame(time=>{window.__marketFrames++;callback(time);});
   window.__setMarket=market=>{
    localStorage.setItem('basketboss_321_v7_market',market);
    dispatchEvent(new Event('basketboss:market-changed'));
   };
  },market);
  if(readableHelpers)for(const content of readableSources)await page.addScriptTag({content});
  await page.addScriptTag({content:source});
  await page.waitForFunction(()=>window.__marketFrames>0);
  await run(page);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

async function quiescent(page){
 // Real DOM textContent setters emit mutations even for equal strings. A
 // second quiet interval must not schedule more presentation animation frames.
 await page.waitForTimeout(160);
 const before=await page.evaluate(()=>window.__marketFrames);
 await page.waitForTimeout(160);
 assert.equal(await page.evaluate(()=>window.__marketFrames),before,'presentation settles instead of scheduling itself every frame');
}

describe('regional presentation mutation observer',()=>{
 before(async()=>{if(chromium)browser=await chromium.launch({headless:true,...(process.env.BB_CHROMIUM_PATH?{executablePath:process.env.BB_CHROMIUM_PATH}:{}),args:['--no-sandbox']});});
 after(async()=>{await browser?.close();});
 const check=(name,run)=>test(name,{skip:!chromium?'Playwright is unavailable; set BB_PLAYWRIGHT_MODULE to run browser regressions':false},run);

 check('UK rendering stops with mounted region and hidden Premium controls',()=>fixture(async page=>{
  await quiescent(page);
  assert.equal(await page.locator('#food').textContent(),'Courgette · 100 g');
  assert.equal(await page.locator('.bb-premium-price').textContent(),'£4.99 per month');
  assert.equal(await page.locator('#bbPremiumDescription').textContent(),'Original membership explanation.');
 }));

 check('UK decimal sanitization preserves exact mentor prose after repeated Cook reopen',()=>fixture(async page=>{
  const phrase='You’ll need 265 grams of cheddar.';
  const before=await page.evaluate(phrase=>{
   window.__preciseMentorSource={required:666.666667,remaining:233.333333};
   const raw=JSON.stringify(window.__preciseMentorSource);
   localStorage.setItem('mentor-precision-source',raw);
   const answer=document.createElement('p');answer.className='bbcv-answer';answer.textContent=phrase;document.body.append(answer);
   const quantity=document.createElement('p');quantity.id='fractional-mentor-amount';quantity.textContent='You’ll need '+window.__preciseMentorSource.required+' grams of chicken.';document.body.append(quantity);
   return {state:JSON.parse(raw),stored:raw};
  },phrase);
  await page.waitForFunction(()=>document.getElementById('fractional-mentor-amount').textContent==='You’ll need 667 g of chicken.');
  assert.equal(await page.locator('.bbcv-answer').textContent(),phrase,'already-readable assistant wording is kept verbatim');
  assert.doesNotMatch(await page.locator('#fractional-mentor-amount').textContent(),/\d+\.\d{2,}/,'precise source decimals are still cleaned');
  await quiescent(page);
  for(let reopen=0;reopen<3;reopen++){
   await page.evaluate(phrase=>{
    document.querySelector('.bbcv-answer').remove();
    const answer=document.createElement('p');answer.className='bbcv-answer';answer.textContent=phrase;document.body.append(answer);
   },phrase);
   await quiescent(page);
   assert.equal(await page.locator('.bbcv-answer').textContent(),phrase,'a fresh conversation keeps the exact typed answer after observer processing');
  }
  const after=await page.evaluate(()=>({state:window.__preciseMentorSource,stored:localStorage.getItem('mentor-precision-source')}));
  assert.deepEqual(after,before,'display sanitation never rounds the six-decimal source or saved quantities');
  assert.equal(after.state.required,666.666667);
  assert.equal(after.state.remaining,233.333333);
 },{readableHelpers:true}));

 check('US rendering stops while preserving regional units and checkout currency wording',()=>fixture(async page=>{
  await quiescent(page);
  assert.equal(await page.locator('#food').textContent(),'Zucchini · 3.5 oz');
  assert.equal(await page.locator('.bb-premium-price').textContent(),'US$ · see checkout');
  assert.match(await page.locator('#bbUSMarketNote').textContent(),/illustrative US pack sizes and USD price guides/);
  assert.match(await page.locator('#bbPremiumDescription').textContent(),/GBP £3\.99\/month/);
  assert.match(await page.locator('#bbPremiumDescription').textContent(),/three days free/);
  assert.doesNotMatch(await page.locator('#bbPremiumDescription').textContent(),/with no trial|No real payments/);
 },{market:'US'}));

 check('market changes restore UK source text and then settle again',()=>fixture(async page=>{
  await quiescent(page);
  await page.evaluate(()=>window.__setMarket('US'));
  await page.waitForFunction(()=>document.documentElement.dataset.bbMarket==='US');
  assert.equal(await page.locator('#food').textContent(),'Zucchini · 3.5 oz');
  await quiescent(page);
  await page.evaluate(()=>window.__setMarket('UK'));
  await page.waitForFunction(()=>document.documentElement.dataset.bbMarket==='UK');
  await quiescent(page);
  assert.equal(await page.locator('#food').textContent(),'Courgette · 100 g');
  assert.equal(await page.locator('.bb-premium-price').textContent(),'£4.99 per month');
  assert.equal(await page.locator('#bbPremiumDescription').textContent(),'Original membership explanation.');
  assert.equal(await page.locator('.bb17-price-details span').textContent(),'Original regional guide.');
 }));

 check('new food text and newly mounted offers still refresh after idle',()=>fixture(async page=>{
  await quiescent(page);
  await page.evaluate(()=>{
   document.getElementById('food').textContent='Aubergine · 200 g';
   const host=document.createElement('div');host.className='bbpremium-modal';host.innerHTML='<span class="bb-price">£7.50 annual example</span>';document.body.append(host);
  });
  await page.waitForFunction(()=>document.getElementById('food').textContent==='Eggplant · 7.1 oz');
  assert.equal(await page.locator('.bbpremium-modal .bb-price').textContent(),'US$ · see checkout');
  await quiescent(page);
  await page.evaluate(()=>window.__setMarket('UK'));
  await page.waitForFunction(()=>document.documentElement.dataset.bbMarket==='UK');
  assert.equal(await page.locator('#food').textContent(),'Aubergine · 200 g');
  assert.equal(await page.locator('.bbpremium-modal .bb-price').textContent(),'£7.50 annual example');
  await quiescent(page);
 },{market:'US'}));
});
