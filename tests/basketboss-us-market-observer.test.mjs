import test,{before,after,describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
let browser;
const source=fs.readFileSync(new URL('../bb-us-market.js',import.meta.url),'utf8');
const markup=`<!doctype html><meta charset="utf-8"><main>
<section id="bb17RegionCard"><div class="bb17-price-details"><span>Original regional guide.</span></div></section>
<p id="food">Courgette · 100 g</p>
<div id="bbPremiumDialog" hidden><span class="bb-premium-price">£4.99 per month</span><p id="bbPremiumDescription">Original membership explanation.</p><a aria-label="Premium £4.99">Membership</a></div>
</main>`;

async function fixture(run,{market='UK'}={}){
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

 check('US rendering stops while preserving regional units and checkout currency wording',()=>fixture(async page=>{
  await quiescent(page);
  assert.equal(await page.locator('#food').textContent(),'Zucchini · 3.5 oz');
  assert.equal(await page.locator('.bb-premium-price').textContent(),'US$ · see checkout');
  assert.match(await page.locator('#bbUSMarketNote').textContent(),/illustrative US pack sizes and USD price guides/);
  assert.match(await page.locator('#bbPremiumDescription').textContent(),/GBP £4\.99\/month/);
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
