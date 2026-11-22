import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

async function fixture(viewport,run){
 const context=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 const app=transform700Presentation(transform700Html(await fs.readFile(path.join(root,'app.html'),'utf8'),release));
 // The real catalogue renderer and controls run against local fixture files.
 // API calls are intercepted; these checks cannot access customer data.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let name=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(['app','app/','app.html','index.html','index',''].includes(name))name='app.html';
  if(name.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;
   if(name==='app.html')body=app;
   else{
    try{body=await fs.readFile(path.join(root,name));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',name));}
    if(name==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(name==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(name==='bb-plan-compact.js')body=body.toString().replace('polishWeekOverview(app);','window.__captureWeekPresentation?.(app);polishWeekOverview(app);window.__checkWeekPresentation?.(app);');
    if(name.endsWith('.js'))body=transform700Presentation(body.toString());
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(name)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  window.__weekPresentationChecks=[];
  window.__captureWeekPresentation=app=>{
   const overview=app.querySelector('.bbpc-budget-overview'),copy=overview.querySelector('.bbnext-plan-budget-text'),price=overview.querySelector('.bbnext-plan-donut');
   window.__weekPresentationBefore={heading:copy.querySelector('h2'),feed:app.querySelector('.bbfeed-global'),count:copy.querySelector(':scope>p:not(.bb77-pantry-savings)'),price,attrs:[...price.attributes].map(a=>[a.name,a.value]),estimate:price.querySelector('#myWeekEstimatedTotal'),state:JSON.stringify({...localStorage}),disclaimer:app.querySelector('#bbSimpleBudget>.bbs-budget-body>small')};
  };
  window.__checkWeekPresentation=app=>{
   const b=window.__weekPresentationBefore,info=app.querySelector('.bbpc-week-info-body');
   window.__weekPresentationChecks.push({heading:app.querySelector('.bbpc-week-header>h2')===b.heading,feed:app.querySelector('.bbpc-week-header>.bbfeed-global')===b.feed,count:app.querySelector('.bbnext-plan-budget-text>p:not(.bb77-pantry-savings)')===b.count,price:app.querySelector('.bbpc-week-price>.bbnext-plan-donut')===b.price,estimate:document.getElementById('myWeekEstimatedTotal')===b.estimate,attributes:JSON.stringify([...b.price.attributes].map(a=>[a.name,a.value]))===JSON.stringify(b.attrs),disclaimer:!b.disclaimer||info.contains(b.disclaimer),state:JSON.stringify({...localStorage})===b.state});
  };
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
 });
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#app')?.dataset.bbCompactHeader==='true'&&!!document.querySelector('#bbpolRegionPill'));
  await page.waitForSelector('.bbnext-day.has-meal');
  await run(page);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}


const read=page=>page.evaluate(()=>({state:JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')),pantry:localStorage.getItem('basketboss_321_v7_measured_pantry'),inventory:localStorage.getItem('basketboss_makeameal_v1_inventory'),estimate:document.getElementById('myWeekEstimatedTotal').textContent}));
for(const width of [320,390,1440])test('My Week keeps heading and original household controls aligned at '+width+'px',{skip:!chromium},()=>fixture({width,height:900},async page=>{
 const boxes=await page.evaluate(()=>{
  const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  return {heading:rect(document.querySelector('.bbpc-week-header>h2')),feed:rect(document.querySelector('.bbpc-week-header>.bbfeed-global')),header:rect(document.querySelector('.bbpc-week-header')),price:rect(document.querySelector('.bbpc-week-price')),next:rect(document.querySelector('[data-bb-start-next-week]')),buttons:[...document.querySelectorAll('.bbpc-week-header button')].map(rect),pageWidth:document.documentElement.scrollWidth,viewport:innerWidth};
 });
 assert.ok(boxes.heading.right<=boxes.feed.left,'heading and stepper do not overlap');
 assert.ok(boxes.heading.top>=boxes.feed.top&&boxes.heading.bottom<=boxes.feed.bottom,'heading is vertically centered on the same row');
 assert.ok(boxes.feed.right<=boxes.header.right+1,'household controls fit inside the header');
 assert.ok(boxes.price.bottom<=boxes.next.top+1,'the footer actions clear the price/info row');
 assert.ok(boxes.buttons.every(r=>r.width>=44&&r.height>=44),'original household buttons retain 44px touch targets');
 assert.ok(boxes.pageWidth<=boxes.viewport+1,'no horizontal overflow');
 assert.ok(await page.evaluate(()=>window.__weekPresentationChecks.length>0&&window.__weekPresentationChecks.every(check=>Object.values(check).every(Boolean))),'presentation preserves the original controls, live price attributes/count references, and all stored state');
 const directory=process.env.BB_MY_WEEK_SCREENSHOTS||path.join(os.tmpdir(),'basketboss-ui-previews','my-week');await fs.mkdir(directory,{recursive:true});await page.screenshot({path:path.join(directory,'my-week-'+width+'.png'),animations:'disabled'});
}));

test('weekly estimate info uses native keyboard disclosure without changing saved data',{skip:!chromium},()=>fixture({width:390,height:844},async page=>{
 const saved=await read(page),info=page.locator('.bbpc-week-info'),summary=info.locator(':scope>summary');
 assert.equal(await info.evaluate(n=>n.open),false);
 await summary.focus();await page.keyboard.press('Enter');assert.equal(await info.evaluate(n=>n.open),true);
 await page.getByText('Shopping estimates use full-pack prices, so fewer servings may still need the same packs. Meals with their own people count keep it when you change household size. Actual checkout prices may vary.',{exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('.bbpc-week-info-body').evaluate(n=>n.closest('.bbnext-plan-donut')===null),true,'interactive info is outside the price/progressbar role');
 assert.equal(await page.locator('.bbpc-week-info-body>[hidden]:visible').count(),0,'renderer-owned hidden price/savings notes remain hidden');
 const color=await page.locator('.bbpc-week-info-body>small:visible').last().evaluate(n=>getComputedStyle(n).color);assert.equal(color,'rgba(255, 255, 255, 0.88)','dark-card helper copy is pale and readable');
 await page.keyboard.press('Space');assert.equal(await info.evaluate(n=>n.open),false);
 assert.deepEqual(await read(page),saved,'opening/closing information changes no plan, estimate or stock');
}));

test('original household plus/minus and budget save/validation retain their calculations and live bindings',{skip:!chromium},()=>fixture({width:390,height:844},async page=>{
 const initial=await read(page),plus=page.getByRole('button',{name:'Feed one more person',exact:true}),minus=page.getByRole('button',{name:'Feed one fewer person',exact:true});
 await plus.click();await page.waitForFunction(()=>document.querySelector('.bbpc-week-header .bbfeed-global>strong')?.textContent==='5');
 const increased=await read(page);assert.equal(increased.state.servings,5);assert.deepEqual(increased.state.planned,initial.state.planned,'meals with their own serving count stay unchanged');assert.equal(increased.estimate,initial.estimate,'the original full-pack estimate for an explicitly sized meal is unchanged');assert.equal(increased.pantry,initial.pantry);assert.equal(increased.inventory,initial.inventory);
 await minus.click();await page.waitForFunction(()=>document.querySelector('.bbpc-week-header .bbfeed-global>strong')?.textContent==='4');const returned=await read(page);for(const [key,value]of Object.entries(initial.state))assert.deepEqual(returned.state[key],value,'reversing household size preserves '+key);assert.equal(returned.estimate,initial.estimate);assert.equal(returned.pantry,initial.pantry);assert.equal(returned.inventory,initial.inventory);
 await page.locator('#bbPlanMoreOptions>summary').click();await page.locator('#bbSimpleBudget>summary').click();
 const input=page.locator('#bb77BudgetTarget'),save=page.locator('#bbSimpleBudget button[type="submit"]');
 const labelColor=await page.locator('label[for="bb77BudgetTarget"]').evaluate(n=>getComputedStyle(n).color);assert.notEqual(labelColor,'rgba(255, 255, 255, 0.88)','the light settings form keeps dark text');
 await input.fill('0');await save.click();await page.locator('.bb77-budget-status').filter({hasText:'Enter a target between'}).waitFor({state:'visible'});
 await input.fill('123.45');await page.locator('.bb77-budget-status').filter({hasText:'Budget automatically saved'}).waitFor({state:'visible'});
 assert.match(await page.locator('.bbnext-plan-budget-line').innerText(),/123\.45/,'existing live weekly target copy updates on the original input handler');
 await save.click();await page.waitForFunction(()=>document.querySelector('#app')?.dataset.bbCompactHeader==='true'&&document.querySelector('#bb77BudgetTarget')?.value==='123.45');
 const final=await read(page);assert.equal(final.state.servings,initial.state.servings);assert.deepEqual(final.state.planned,initial.state.planned);assert.equal(final.pantry,initial.pantry);assert.equal(final.inventory,initial.inventory);assert.equal(final.estimate,initial.estimate);
 assert.match(await page.locator('.bbnext-plan-budget-text>p:not(.bb77-pantry-savings)').textContent(),/1\/7 dinners.*0\/5 school lunches/,'the original direct-child count binding continues updating');
}));

test('completion check remains inside its original day badge and clear of the Remove menu',{skip:!chromium},()=>fixture({width:390,height:844},async page=>{
 const initial=await read(page);
 // Supply the completed presentation state to the real existing badge. Core
 // completion/undo behavior is covered separately by the Day Done suites.
 await page.locator('.bbnext-day[data-bbnext-day="Monday"] .bbnext-day-label').evaluate(badge=>{badge.classList.add('bb-day-is-done');const check=document.createElement('span');check.className='bb-day-done-check';check.textContent='✓';check.setAttribute('aria-hidden','true');badge.append(check);});
 const result=await page.locator('.bbnext-day[data-bbnext-day="Monday"]').evaluate(row=>{const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};},badge=row.querySelector('.bbnext-day-label'),check=badge.querySelector('.bb-day-done-check');return {badge:rect(badge),check:rect(check),menu:rect(row.querySelector('.bbpc-overflow-trigger')),sameOwner:check.parentNode===badge,position:getComputedStyle(check).position};});
 assert.equal(result.sameOwner,true);assert.equal(result.position,'static');assert.ok(result.check.left>=result.badge.left&&result.check.right<=result.badge.right&&result.check.top>=result.badge.top&&result.check.bottom<=result.badge.bottom,'check is inline inside the day pill: '+JSON.stringify(result));assert.ok(result.check.right<result.menu.left,'check does not overlap the ellipsis');
 await page.getByRole('button',{name:'More options for Monday dinner',exact:true}).click();await page.getByRole('button',{name:'Remove Monday dinner',exact:true}).click();await page.getByRole('button',{name:'Keep my week',exact:true}).click();
 assert.deepEqual(await read(page),initial,'presenting completion and cancelling Remove do not change saved data');
}));
