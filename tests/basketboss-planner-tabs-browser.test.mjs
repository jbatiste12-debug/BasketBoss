import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)){try{({chromium}=require(name));break;}catch{}}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const output=process.env.BB_PLANNER_TABS_PREVIEW||'';
async function fixture(viewport){
 const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({authenticated:false,error:'sign_in_required'})});
  let rel=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(['app','app.html','index.html','index',''].includes(rel))rel='app.html';
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;
   // Canonical owned presentation assets are exercised before generated copies
   // are rebuilt. Other requests use the real generated 700-recipe application.
   if(['bb-simple-layout.js','bb-plan-premium-polish.css'].includes(rel))body=await fs.readFile(path.join(ROOT,rel));
   else{try{body=await fs.readFile(path.join(ROOT,'pwa700',rel));}catch{try{body=await fs.readFile(path.join(ROOT,rel));}catch{body=await fs.readFile(path.join(ROOT,'catalogues/700/release/assets',rel));}}}
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(rel)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'fajitas',day:'Monday'}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
  localStorage.setItem('basketboss_321_v8_school_lunchboxes_v1',JSON.stringify({children:2,days:{Monday:[],Tuesday:[],Wednesday:[],Thursday:[],Friday:[]},menus:{}}));
  localStorage.setItem('basketboss_321_v7_market','Guernsey');localStorage.setItem('basketboss_v172_weekly_budget_target_v1','150');
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
 });
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item="plan"]').click();
 await page.locator('#bbSimplePlannerTabs').waitFor();
 return {context,page,errors};
}
async function snapshot(page){return page.evaluate(()=>({
  saved:Object.fromEntries(Object.keys(localStorage).filter(key=>/stock|inventory|unified_state|school_lunchboxes|features_v1|budget|saved_week|purchased|shopping_session/i.test(key)).sort().map(key=>[key,localStorage.getItem(key)])),
  estimate:document.getElementById('myWeekEstimatedTotal').textContent,
  budget:document.querySelector('.bbnext-plan-donut').getAttribute('aria-valuetext'),
  percentage:document.querySelector('.bbnext-plan-donut').style.getPropertyValue('--bbnext-budget-pct')
 }));}
for(const viewport of [{width:390,height:844},{width:320,height:568}])test('planner tabs retain original plans, handlers and saved amounts at '+viewport.width+'px',{skip:!chromium?'Playwright unavailable':false},async()=>{
 const {context,page,errors}=await fixture(viewport);
 try{
  const dinners=page.getByRole('tab',{name:'Dinners (1/7)',exact:true}),lunches=page.getByRole('tab',{name:'School lunches (0/5)',exact:true});
  assert.equal(await dinners.getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#bbSimpleDinnersPane .bbnext-day').count(),7);
  assert.equal(await page.locator('#bb321SchoolLunchbox').count(),1);
  assert.ok(await page.locator('#clearWeek').isVisible());
  assert.ok(await page.getByRole('button',{name:'Saved weeks',exact:true}).isVisible());
  assert.ok(await page.getByRole('button',{name:'Saved meals',exact:true}).isVisible());
  assert.match(await page.locator('.bbnext-plan-budget-text>p:not(.bb77-pantry-savings)').innerText(),/1\/7 dinners • 0\/5 school lunches/);
  await page.evaluate(()=>{window.__plannerOriginalNodes={lunch:document.getElementById('bb321SchoolLunchbox'),clear:document.getElementById('clearWeek'),days:[...document.querySelectorAll('#bbSimpleDinnersPane .bbnext-day')],review:document.getElementById('bb321LunchReview')};window.scrollTo({top:0,behavior:'instant'});});
  const before=await snapshot(page);
  if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,viewport.width===390?'dinners.png':'dinners-small.png'),animations:'disabled'});}
  // Scroll just enough to keep the segmented bar visible on either phone.
  await page.locator('#bbSimplePlannerTabs').evaluate(node=>window.scrollTo({top:Math.max(0,node.getBoundingClientRect().top+window.scrollY-100),behavior:'instant'}));
  const scroll=await page.evaluate(()=>window.scrollY);
  await lunches.click();
  assert.equal(await page.evaluate(()=>window.scrollY),scroll,'tab selection keeps the viewport in place');
  assert.equal(await lunches.getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#bbSimpleDinnersPane').isVisible(),false);
  assert.equal(await page.locator('#clearWeek').isVisible(),false);
  assert.equal(await page.locator('#bb1759MealsSummary>.bb1759-summary-heading').isVisible(),false);
  assert.equal(await page.getByRole('button',{name:'Saved weeks',exact:true}).isVisible(),false);
  assert.ok(await page.getByRole('heading',{name:'School Lunchboxes (Mon–Fri)',exact:true}).isVisible());
  assert.equal(await page.locator('#bb1759MealsSummary #bb321SchoolLunchbox').count(),1);
  assert.equal(await page.evaluate(()=>document.getElementById('bb321SchoolLunchbox')===__plannerOriginalNodes.lunch&&document.getElementById('bb321LunchReview')===__plannerOriginalNodes.review),true);
  assert.deepEqual(await snapshot(page),before,'tab selection cannot change saved quantities, shopping or budget');
  if(output){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(output,viewport.width===390?'lunches.png':'lunches-small.png'),animations:'disabled'});await page.locator('#bbSimplePlannerTabs').evaluate(node=>window.scrollTo({top:Math.max(0,node.getBoundingClientRect().top+window.scrollY-100),behavior:'instant'}));}
  await dinners.click();
  assert.equal(await page.evaluate(()=>document.getElementById('clearWeek')===__plannerOriginalNodes.clear&&[...document.querySelectorAll('#bbSimpleDinnersPane .bbnext-day')].every((node,index)=>node===__plannerOriginalNodes.days[index])),true);
  assert.ok(await page.locator('#clearWeek').isVisible());assert.deepEqual(await snapshot(page),before);
  // Existing native dinner disclosure still opens its original action controls.
  const monday=page.locator('.bbnext-day[data-bbnext-day="Monday"]');await monday.locator('.bbnext-day-description>strong').click();await page.waitForFunction(()=>document.querySelector('.bbnext-day[data-bbnext-day="Monday"]').open);assert.equal(await monday.evaluate(node=>node.open),true);
  assert.ok(await monday.locator('[data-move]').isVisible());
  // Keyboard tabs remain usable without a pointer or navigation event.
  await dinners.focus();await dinners.press('ArrowRight');assert.equal(await lunches.getAttribute('aria-selected'),'true');await lunches.press('Home');assert.equal(await dinners.getAttribute('aria-selected'),'true');
  const bounds=await page.locator('#bbSimplePlannerTabs').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=viewport.width);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // The original, still-rendered section jump targets its original wrapper.
  const legacy=page.locator('[data-bb1759-jump="bb1756Lunchboxes"]');
  if(await legacy.count()){await legacy.first().evaluate(node=>node.click());assert.equal(await lunches.getAttribute('aria-selected'),'true');}
  else await lunches.click();
  assert.ok(await page.locator('#bb1756Lunchboxes #bb321SchoolLunchbox').isVisible());assert.equal(await page.locator('#bbSimpleSchoolLunchesPane>#bb1756Lunchboxes').count(),1);
  assert.deepEqual(await snapshot(page),before);await dinners.click();
  // Weekly overview shortcuts may navigate to Plan after their click capture.
  // Exercise that presentation contract without replacing an app handler.
  await page.evaluate(()=>{const shortcut=document.createElement('button');shortcut.id='planner-overview-shortcut-fixture';shortcut.dataset.bbUiFocus='bb321SchoolLunchbox';document.body.append(shortcut);shortcut.click();shortcut.remove();});
  assert.equal(await lunches.getAttribute('aria-selected'),'true');assert.ok(await page.locator('#bb1756Lunchboxes #bb321SchoolLunchbox').isVisible());assert.deepEqual(await snapshot(page),before);
  // The original lunch parser and save still work after the node is moved.
  await lunches.click();await page.locator('#bb321LunchSpeech').fill('apples');await page.locator('#bb321LunchReview').click();
  await page.locator('#bb321LunchSave').waitFor();assert.deepEqual(await snapshot(page),before,'reviewing lunch groceries cannot change stock or a saved plan');
  await page.locator('#bb321LunchSave').click();
  const savedLunch=page.getByRole('tab',{name:'School lunches (1/5)',exact:true});await savedLunch.waitFor();assert.equal(await savedLunch.getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#bb321SchoolLunchbox').count(),1);assert.ok(await page.getByRole('heading',{name:'School Lunchboxes (Mon–Fri)',exact:true}).isVisible());
  assert.match(await page.locator('.bbnext-plan-budget-text>p:not(.bb77-pantry-savings)').innerText(),/1\/7 dinners • 1\/5 school lunches/);
  const after=await snapshot(page);for(const key of Object.keys(before.saved).filter(key=>/stock|inventory/i.test(key)))assert.equal(after.saved[key],before.saved[key],'saving a lunch keeps physical stock unchanged');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
