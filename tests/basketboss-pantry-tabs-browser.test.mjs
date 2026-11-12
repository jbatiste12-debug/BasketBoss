import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';
const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const check=(name,run)=>test(name,{skip:!chromium?'Playwright unavailable; set BB_PLAYWRIGHT_MODULE to run browser regressions':false},run);
const tab=(page,loc)=>page.locator('[role="tab"][data-bbpi-storage="'+loc+'"]');
const visibleRows=page=>page.locator('.bbpi-summary-row:visible');
// Exercise the actual generated app with disposable local storage and local
// assets. Fresh source overrides prevent a stale pwa700 enhancement from hiding
// a failure in the presentation under test.
async function fixture(viewport,run){
 const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({authenticated:false,error:'sign_in_required'})});
   let rel=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
   if(['app','app.html','index.html','index',''].includes(rel))rel='app.html';
   if(rel.includes('..'))return route.fulfill({status:404,body:''});
   let body;
   try{
    if(['bb-onboarding-v2.js','bb-how-it-works.js','bb-pantry-inline.js','bb-pantry-selection.js','bb-kitchen-review.js','bb-kitchen-essentials.js'].includes(rel))body=transform700Presentation(await fs.readFile(path.join(ROOT,rel),'utf8'));
    else if(['bb-onboarding-v2.css','bb-pantry-inline.css','bb-kitchen-review.css'].includes(rel))body=await fs.readFile(path.join(ROOT,rel));
    else{try{body=await fs.readFile(path.join(ROOT,'pwa700',rel));}catch{try{body=await fs.readFile(path.join(ROOT,rel));}catch{body=await fs.readFile(path.join(ROOT,'catalogues/700/release/assets',rel));}}}
   }catch{return route.fulfill({status:404,body:''});}
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(rel)]||'application/octet-stream',body});
  });
  await context.addInitScript(()=>{
   localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
   localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
   localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
   localStorage.setItem('basketboss_321_v7_market','Guernsey');localStorage.setItem('basketboss_v172_weekly_budget_target_v1','150');
   sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
  });
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>window.bb307SwitchIsland('Guernsey'));
  await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();await page.locator('#bbpiSearch').waitFor();
  await page.evaluate(async()=>{
   for(const item of [{name:'Milk',loc:'fridge',qty:500,unit:'ml'},{name:'Rice',loc:'cupboard',qty:500,unit:'g'},{name:'Peas',loc:'freezer',qty:350,unit:'g'}]){const added=BBPantryEditor.add(item);if(!added?.ok)throw Error(added?.message||'seed');}
   await BBPantryEditor.flush();
  });
  await tab(page,'all').waitFor();
  await run(page);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
for(const viewport of [{width:390,height:844},{width:320,height:568}])check('At home tabs stay on one horizontal row and preserve pantry nodes at '+viewport.width+'px',()=>fixture(viewport,async page=>{
 const list=page.getByRole('tablist',{name:'Pantry storage'});assert.equal(await list.count(),1);
 assert.deepEqual(await list.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>node.dataset.bbpiStorage)),['fridge','cupboard','freezer','all']);
 const layout=await list.evaluate(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return {overflow:s.overflowX,whiteSpace:s.whiteSpace,scrollbar:s.scrollbarWidth,width:r.width,ys:[...node.querySelectorAll('[role="tab"]')].map(tab=>tab.getBoundingClientRect().y)};});
 assert.equal(layout.overflow,'auto');assert.equal(layout.whiteSpace,'nowrap');assert.equal(layout.scrollbar,'none');assert.ok(Math.max(...layout.ys)-Math.min(...layout.ys)<2,'all four tabs share a row');assert.ok(layout.width<=viewport.width);
 const header=await page.locator('#bb173ShopFridge .bb76-kitchen-intro').boundingBox();assert.ok(header&&header.height<60,'At home header stays compact');
 await page.evaluate(()=>scrollTo(0,0));
 await page.waitForFunction(()=>{const kitchen=document.getElementById('bb173ShopFridge'),intro=kitchen?.querySelector('.bb76-kitchen-intro'),review=document.getElementById('bbKitchenWeeklyReview');return review?.parentNode===kitchen&&intro?.previousElementSibling===review;});
 const topAction=await page.locator('#bbKitchenWeeklyReview').evaluate(review=>{const intro=review.nextElementSibling,toolbar=document.getElementById('bbpiToolbar'),button=review.querySelector('button'),rect=node=>{const r=node.getBoundingClientRect();return {y:r.y,bottom:r.bottom,width:r.width,height:r.height};};const style=getComputedStyle(button);return {position:getComputedStyle(review).position,intro:rect(intro),review:rect(review),toolbar:rect(toolbar),button:rect(button),buttonStyle:{minHeight:style.minHeight,minWidth:style.minWidth,font:style.font}};});
 assert.equal(topAction.position,'static','weekly review uses the existing document scroller');
 assert.ok(topAction.review.bottom<=topAction.intro.y&&topAction.intro.bottom<=topAction.toolbar.y,'Review & restock appears above the At home heading, with search/storage below the heading: '+JSON.stringify(topAction));
 await fs.mkdir('/workspace/shared',{recursive:true});await page.screenshot({path:'/workspace/shared/basketboss-at-home-top-restock'+(viewport.width===390?'':'-'+viewport.width)+'.png',animations:'disabled'});
 assert.ok(topAction.button.height>=48&&topAction.button.width>=120,'the prominent review action keeps a large touch target: '+JSON.stringify(topAction));

 for(const button of await page.locator('#bbKitchenSections>button,[data-bbpi-storage]').all()){const box=await button.boundingBox();assert.ok(box&&box.height>=44&&box.width>=44,'new header and storage controls retain44px touch targets');}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'storage overflow stays inside its horizontal tab strip');
 await page.evaluate(()=>window.__pantryNodes=[...document.querySelectorAll('#bb173ShopFridge [data-bb76-store]')].map(area=>({area,body:area.querySelector('.bb76-store-body'),id:area.id,loc:area.dataset.bb76Store,tiles:[...area.querySelectorAll('[data-bb5-food]')]})));
 const stockBefore=await page.evaluate(()=>{const keys=BBHomeHost.keys();return [localStorage.getItem(keys.stock),localStorage.getItem(keys.inventory)];});
 for(const loc of ['fridge','cupboard','freezer','all','fridge']){
  await page.evaluate(()=>scrollTo(0,0));const targetTab=tab(page,loc);
  // Reveal the target before measuring: browser automation may scroll it into
  // the safe area above fixed navigation before dispatching the actual click.
  await targetTab.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);
  await targetTab.click();
  assert.equal(await tab(page,loc).getAttribute('aria-selected'),'true');assert.equal(await page.evaluate(()=>scrollY),before,'switching storage leaves document position stable');
  assert.equal(await page.locator('[data-bb76-store]:visible').count(),loc==='all'?3:1);
  assert.equal(await visibleRows(page).count(),loc==='all'?3:1);
  assert.equal(await page.locator('[data-bb76-store]>summary:visible').count(),0,'original accordion headers are retained but visually replaced');
 }
 assert.equal(await page.evaluate(()=>__pantryNodes.every(({area,body,id,loc,tiles})=>area.isConnected&&area.id===id&&area.dataset.bb76Store===loc&&area.querySelector('.bb76-store-body')===body&&tiles.every(tile=>tile.isConnected))),true);
 assert.deepEqual(await page.evaluate(()=>{const keys=BBHomeHost.keys();return [localStorage.getItem(keys.stock),localStorage.getItem(keys.inventory)];}),stockBefore,'presentation changes preserve saved pantry bytes');
 assert.equal(await page.locator('.bbpi-add-food:visible').count(),1);assert.equal(await page.locator('.bbpi-ai-scan:visible').count(),1);assert.equal(await page.locator('.bb-pantry-camera-bar').count(),1);assert.equal(await page.locator('.bb-pantry-camera-bar:visible').count(),0);
 await page.evaluate(()=>scrollTo(0,document.scrollingElement.scrollHeight));
 await page.locator('#bbKitchenReviewOpen').scrollIntoViewIfNeeded();
 const review=await page.locator('#bbKitchenReviewOpen').boundingBox(),nav=await page.locator('#bbPrimaryNavigation').boundingBox();
 assert.ok(review&&nav&&review.y>=0&&review.y+review.height<=nav.y,'Review & restock remains fully above the fixed navigation: '+JSON.stringify({review,nav}));
 await page.locator('#bbKitchenReviewOpen').click();await page.locator('#bbKitchenReviewDialog').waitFor();await page.locator('#bbKitchenReviewDialog .bb-kitchen-review-close').click();
}));
check('At home actions use the selected storage and original Premium camera handlers',()=>fixture({width:390,height:844},async page=>{
 for(const loc of ['fridge','freezer','all']){
  await tab(page,loc).click();await page.locator('.bbpi-add-food:visible').click();
  const panel=page.locator('#bbpi-current-editor');await panel.waitFor();
  // Adding from All must choose Cupboard without a second global Add/scan pair.
  const expected=loc==='all'?'cupboard':loc;
  await panel.getByLabel('Food name',{exact:true}).fill('Tabs test '+expected);
  await panel.locator('[data-bbpi-quantity]').fill('1');
  await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});
  assert.equal(await page.evaluate(name=>BBPantryEditor.list().find(row=>row.name===name)?.loc,'Tabs test '+expected),expected);
 }
 await page.evaluate(()=>{window.__scanCalls=[];const original=BBPantryCameraHost;window.BBPantryCameraHost={...original,isPremium:()=>false,upgrade:feature=>__scanCalls.push('upgrade:'+feature)};for(const loc of ['fridge','cupboard'])document.querySelector('.bb-pantry-camera-button[aria-label="Scan '+loc+' ingredients with Premium AI"]').addEventListener('click',()=>__scanCalls.push(loc));});
 for(const loc of ['fridge','cupboard']){await tab(page,loc).click();await page.locator('.bbpi-ai-scan:visible').click();}
 assert.deepEqual(await page.evaluate(()=>__scanCalls),['upgrade:AI pantry scanning','fridge','upgrade:AI pantry scanning','cupboard']);
 await tab(page,'all').click();await page.locator('.bbpi-ai-scan:visible').click();await page.getByRole('group',{name:'Choose where to scan',exact:true}).getByRole('button',{name:'Cupboard',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>__scanCalls),['upgrade:AI pantry scanning','fridge','upgrade:AI pantry scanning','cupboard','upgrade:AI pantry scanning','cupboard']);
 assert.equal(await page.locator('.bbpi-add-food:visible').count(),1);assert.equal(await page.locator('.bbpi-ai-scan:visible').count(),1);
 await tab(page,'freezer').click();const scan=page.locator('.bbpi-ai-scan:visible');assert.equal(await scan.isDisabled(),true);assert.match((await scan.getAttribute('title')||'')+' '+(await page.locator('#bb173ShopFridge').innerText()),/supports? Fridge and Cupboard|Fridge and Cupboard only/i);
}));
check('At home row controls, search, filters and selection keep their existing flows',()=>fixture({width:390,height:844},async page=>{
 await tab(page,'cupboard').click();
 const riceState=await page.evaluate(()=>{const id=BBHomeHost.id('Rice','g'),row=BBPantryEditor.list().find(row=>BBHomeHost.id(row.name,row.unit)===id);return {id,name:row.name,qty:row.qty};});
 const rice=page.locator('.bbpi-summary-row:visible').filter({hasText:riceState.name}),before=riceState.qty;
 await rice.getByRole('button',{name:'More '+riceState.name+' in cupboard',exact:true}).click();
 await page.waitForFunction(({id,before})=>BBPantryEditor.list().find(row=>BBHomeHost.id(row.name,row.unit)===id)?.qty>before,{id:riceState.id,before});
 assert.equal(await page.locator('#bbpi-current-editor').count(),0,'stepper click does not also open the row editor');
 await rice.getByRole('button',{name:'Edit '+riceState.name+' in cupboard',exact:true}).click();await page.locator('#bbpi-current-editor').waitFor();await page.locator('#bbpi-current-editor .bbpi-close').click();
 await page.locator('#bbpiSearch').fill('Milk');await page.waitForFunction(()=>[...document.querySelectorAll('.bbpi-summary-row')].filter(node=>node.getClientRects().length).length===1&&[...document.querySelectorAll('.bbpi-summary-row')].some(node=>node.getClientRects().length&&node.textContent.includes('Milk')));assert.match(await visibleRows(page).innerText(),/Milk/);await page.locator('#bbpiSearch').fill('');
 await page.locator('#bbpiViewFilters').click();assert.equal(await page.locator('#bbpiViewFilters').getAttribute('aria-expanded'),'true');await page.getByRole('button',{name:'All food',exact:true}).click();
 await tab(page,'all').click();await page.getByRole('button',{name:'Select items',exact:true}).click();await page.getByRole('button',{name:'Select all shown',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.bbps-count')?.textContent==='3 selected');assert.equal(await page.locator('.bbps-count').innerText(),'3 selected');await page.locator('.bbps-cancel').click();await page.locator('.bbps-bar').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>BBPantryEditor.list().length),3);
}));
