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
let chromium,PNG,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
for(const name of ['pngjs','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs'].filter(Boolean))try{({PNG}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium&&PNG)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

async function fixture(viewport,run){
 const context=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 const app=transform700Presentation(transform700Html(await fs.readFile(path.join(root,'app.html'),'utf8'),release));
 // Serve the original application locally and reject every API request. These
 // tests cannot access a production account or perform remote writes.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let rel=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(['app','app/','app.html','index.html','index',''].includes(rel))rel='app.html';
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;
   if(rel==='app.html')body=app;
   else{
    try{body=await fs.readFile(path.join(root,rel));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',rel));}
    if(rel==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(rel==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(rel.endsWith('.js'))body=transform700Presentation(body.toString());
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};
   return route.fulfill({status:200,contentType:types[path.extname(rel)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day,index)=>({recipeId:index===0?'veggie-fried-rice':'fajitas',day,servings:4})),plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
 });
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.bbnext-day.has-meal');
  await page.waitForFunction(()=>document.getElementById('app')?.dataset.bbCompactHeader==='true'&&document.querySelector('#bbPrimaryNavigation[data-bb-navigation="polished"]'));
  await run(page,context);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

const saved=page=>page.evaluate(()=>Object.fromEntries(['basketboss_321_unified_state_v1','basketboss_321_features_v1','basketboss_321_v7_measured_pantry','basketboss_makeameal_v1_inventory'].map(key=>[key,localStorage.getItem(key)])));
const geometry=page=>page.locator('#bbPrimaryNavigation').evaluate(nav=>({nav:nav.getBoundingClientRect().toJSON(),items:[...nav.querySelectorAll('[data-bb-nav-item]')].map(item=>({key:item.dataset.bbNavItem,rect:item.getBoundingClientRect().toJSON(),href:item.getAttribute('href')}))}));
const pixel=(buffer,x,y)=>{const image=PNG.sync.read(buffer),index=(Math.floor(y)*image.width+Math.floor(x))*4;return [...image.data.subarray(index,index+3)];};

for(const viewport of [{width:320,height:760},{width:390,height:844},{width:1440,height:1000}])test('floating dock covers scrolled content below its safe-area gap without changing controls at '+viewport.width+'px',{skip:!chromium||!PNG?'Browser image dependencies unavailable':false},()=>fixture(viewport,async(page,context)=>{
 const physical=await saved(page),directory=path.join(process.env.BB_UI_SCREENSHOT_DIR||path.join(os.tmpdir(),'basketboss-ui-previews'),'bottom-nav-mask-'+viewport.width);await fs.mkdir(directory,{recursive:true});
 // Deliberately mark a real scrolling meal card. The test must prove the card
 // really paints in the bottom gap when the production cover is disabled.
 const marker=await page.addStyleTag({content:'#app .bbnext-day.has-meal{position:relative!important}#app .bbnext-day.has-meal::after{content:""!important;position:absolute!important;inset:0!important;background:rgb(244,0,183)!important;z-index:5!important;pointer-events:none!important}'});
 const cdp=await context.newCDPSession(page);
 for(const safeBottom of [0,34]){
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:safeBottom}});
  await page.evaluate(()=>{const card=document.querySelectorAll('.bbnext-day.has-meal')[3];window.scrollTo({top:card.getBoundingClientRect().top+window.scrollY-(window.innerHeight-60),behavior:'instant'});});
  const position=await geometry(page),gap=viewport.height-position.nav.bottom;assert.equal(gap,Math.max(8,safeBottom));
  const pseudo=await page.locator('#bbPrimaryNavigation').evaluate(nav=>{const style=getComputedStyle(nav,'::after');return {position:style.position,pointerEvents:style.pointerEvents,height:style.height,background:style.backgroundColor,zIndex:style.zIndex};});
  assert.deepEqual(pseudo,{position:'fixed',pointerEvents:'none',height:Math.max(8,safeBottom)+'px',background:'rgb(255, 253, 246)',zIndex:'-1'});
  const disabled=await page.addStyleTag({content:'html body nav#bbPrimaryNavigation[data-bb-navigation="polished"]::after{content:none!important}'});
  const unmasked=await page.screenshot({path:path.join(directory,'unmasked-'+safeBottom+'.png')});
  const uncovered=pixel(unmasked,viewport.width/2,viewport.height-3);
  assert.ok(uncovered[0]>200&&uncovered[1]<30&&uncovered[2]>140,'the real scrolling meal card is visible through the original gap, including the dock shadow');
  await disabled.evaluate(node=>node.remove());
  const masked=await page.screenshot({path:path.join(directory,'masked-'+safeBottom+'.png')});
  for(const x of [2,viewport.width/2,viewport.width-3])for(const y of [viewport.height-gap+1,viewport.height-Math.ceil(gap/2),viewport.height-3])assert.deepEqual(pixel(masked,x,y),[255,253,246],'the entire width and height of the bottom viewport gap has an opaque ivory cover');
  assert.deepEqual(await geometry(page),position,'the cover never changes the nav or any button/link dimensions');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal overflow');
  assert.equal(await page.evaluate(()=>!!document.elementFromPoint(innerWidth/2,innerHeight-3)?.closest('.bbnext-day.has-meal')),true,'the decorative cover does not intercept the underlying pointer target');
  await page.evaluate(()=>document.body.classList.add('bb172-storefront-visible'));
  assert.equal(await page.locator('#bbPrimaryNavigation').isVisible(),false,'the existing full-screen shopping rule hides the dock');
  assert.deepEqual(pixel(await page.screenshot(),viewport.width/2,viewport.height-3),[244,0,183],'hiding the dock also hides the cover');
  await page.evaluate(()=>document.body.classList.remove('bb172-storefront-visible'));
 }
 await marker.evaluate(node=>node.remove());await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
 const lastCard=await page.locator('.bbnext-day.has-meal').last().boundingBox(),dock=await page.locator('#bbPrimaryNavigation').boundingBox();
 assert.ok(lastCard.y+lastCard.height<dock.y,'the last meal card remains fully reachable above the floating dock');
 // Use the actual navigation and settings handlers, including keyboard focus.
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item="discover"]').click();await page.waitForFunction(()=>document.body.dataset.bbnextView==='discover');
 const plan=page.locator('#bbPrimaryNavigation [data-bb-nav-item="plan"]');await plan.focus();assert.equal(await plan.evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Enter');await page.waitForFunction(()=>document.body.dataset.bbnextView==='week');
 await page.getByRole('button',{name:'Open BasketBoss settings',exact:true}).click();const modal=page.locator('.bbui-settings-overlay');await modal.waitFor({state:'visible'});
 assert.equal(await modal.evaluate(node=>node.contains(document.elementFromPoint(innerWidth/2,innerHeight-3))),true,'the existing settings overlay paints and receives input above the cover');
 await page.screenshot({path:path.join(directory,'settings-above-cover.png')});await page.locator('.bbui-settings-close').click();
 assert.equal(await page.evaluate(()=>window.BBHomeHost.openCook('veggie-fried-rice')),true);await page.locator('.cook-overlay').waitFor({state:'visible'});
 assert.equal(await page.locator('#bbPrimaryNavigation').isVisible(),false,'the original full-screen Cook visibility rule still hides the navigation');
 assert.equal(await page.locator('#bbPrimaryNavigation').evaluate(nav=>getComputedStyle(nav,'::after').visibility),'hidden','the cover inherits the dock’s hidden visibility in full-screen Cook');
 assert.equal(await page.evaluate(()=>!!document.elementFromPoint(innerWidth/2,innerHeight-3)?.closest('.cook-overlay')),true,'the cover does not paint or intercept input above full-screen Cook');
 await page.locator('#bbExit').click();await page.locator('.cook-overlay').waitFor({state:'detached'});
 assert.deepEqual(await saved(page),physical,'presentation and navigation keep all saved plan, servings and pantry state unchanged');
}));
