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

async function fixture(viewport,run,{slowPolishMs=0,observeColdPaint=false}={}){
 const context=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768,reducedMotion:'no-preference',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 const app=transform700Presentation(transform700Html(await fs.readFile(path.join(root,'app.html'),'utf8'),release));
 // Every request is local, including API calls. No production data or billing
 // operations are possible, and the original renderer/handlers are exercised.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let rel=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(slowPolishMs&&rel==='bb-plan-premium-polish.js')await new Promise(resolve=>setTimeout(resolve,slowPolishMs));
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
 if(observeColdPaint)await context.addInitScript(()=>{
  const probe=window.__coldNavPaint={frames:[],stop:false};
  const visible=node=>!!node&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none'&&(!node.checkVisibility||node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
  const sample=()=>{
   const region=document.getElementById('bb307Island')?.closest('[role="note"]'),ring=document.querySelector('#app.bbnext-plan .bbnext-plan-donut');
   const legacyPlan=visible(ring)&&!document.querySelector("#app .bbpc-week-header")&&ring.getBoundingClientRect().height>70;
   let diagnostic;
   if(legacyPlan){
    const declarations=[];
    const inspect=(rules,source)=>{for(const rule of rules){
     if(rule.selectorText){try{if(ring.matches(rule.selectorText)&&(rule.style.height||rule.style.minHeight||rule.style.padding||rule.style.transform))declarations.push({source,selector:rule.selectorText,height:rule.style.height,minHeight:rule.style.minHeight,padding:rule.style.padding,transform:rule.style.transform});}catch{}}
     else if(rule.cssRules&&(!rule.media||matchMedia(rule.conditionText).matches))inspect(rule.cssRules,source);
    }};
    for(const sheet of document.styleSheets)try{inspect(sheet.cssRules,sheet.href);}catch{}
    diagnostic={appData:{...document.getElementById('app')?.dataset},appClass:document.getElementById('app')?.className,ringClass:ring.className,ringParent:ring.parentElement?.className,ringHeight:ring.getBoundingClientRect().height,computedHeight:getComputedStyle(ring).height,overview:!!document.querySelector('.bbpc-budget-overview'),declarations};
   }
   const view=document.body?.dataset.bbnextView,app=document.getElementById('app');
   const nav=[...document.querySelectorAll('.shell nav.tabs>.tab')].filter(visible).map(button=>{
    const style=getComputedStyle(button),parts=style.backgroundColor.match(/[\d.]+/g)?.map(Number)||[];
    const [red=0,green=0,blue=0,alpha=1]=parts;
    const selected=style.backgroundImage!=='none'||alpha>.95&&green>red+15&&green>blue+10&&red<200&&green<210;
    return {label:button.querySelector('.nav-label')?.textContent.trim(),selected,current:button.getAttribute('data-bb-nav-current'),active:button.classList.contains('active'),background:style.backgroundColor,image:style.backgroundImage};
   });
   const settings=document.getElementById('bbuiOpenSettings'),style=settings&&getComputedStyle(settings),icon=settings?.querySelector('svg');
   const foreground=style?.color.match(/[\d.]+/g)?.map(Number)||[],background=style?.backgroundColor.match(/[\d.]+/g)?.map(Number)||[];
   const blankSettings=visible(settings)&&foreground.slice(0,3).every(value=>value>230)&&background.slice(0,3).every(value=>value>230)&&(background[3]??1)>.95;
   probe.frames.push({time:performance.now(),ready:document.readyState,view,entryHint:document.documentElement.dataset.bbPlanEntry,nav,
    appOpacity:view==='week'&&visible(app)?getComputedStyle(app).opacity:null,
    settings:visible(settings)?{svg:!!icon,iconWidth:icon?.getBoundingClientRect().width||0,blank:blankSettings,foreground:style.color,background:style.backgroundColor}:null,
    legacyRegion:region?.parentElement===document.body&&visible(region),legacyPlan,...(diagnostic?{diagnostic}:{})});
   if(!probe.stop&&probe.frames.length<3000)requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 });
 await context.addInitScript(()=>{
  if(localStorage.getItem('navigation-first-paint-fixture'))return;
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
  localStorage.setItem('navigation-first-paint-fixture','1');
 });
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.bbnext-day.has-meal');
  await page.waitForFunction(()=>typeof window.BBPantryNormalize==='function');
  await run(page,context);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

const physical=page=>page.evaluate(()=>({inventory:localStorage.getItem('basketboss_makeameal_v1_inventory'),stock:localStorage.getItem('basketboss_321_v7_measured_pantry'),state:localStorage.getItem('basketboss_321_unified_state_v1'),features:localStorage.getItem('basketboss_321_features_v1'),planned:JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')).planned}));
const nav=(page,name)=>page.locator('#bbPrimaryNavigation [data-bb-nav-item="'+name+'"]');

for(const viewport of [{width:320,height:760},{width:390,height:844},{width:1440,height:1000}])for(const slowPolishMs of [0,800])test('cold entry and Cook return paint one opaque Plan with a visible settings icon at '+viewport.width+'px (presenter '+slowPolishMs+'ms)',{skip:!chromium?'Playwright unavailable':false},()=>fixture(viewport,async page=>{
 const saved=await physical(page);
 async function checkColdPaint(label){
  await page.waitForFunction(()=>document.querySelector('#app')?.dataset.bbCompactHeader==='true');
  await page.waitForTimeout(100);
  const frames=await page.evaluate(()=>{window.__coldNavPaint.stop=true;return window.__coldNavPaint.frames;});
  const directory=path.join(process.env.BB_UI_SCREENSHOT_DIR||path.join(os.tmpdir(),'basketboss-ui-previews'),'cold-navigation-'+viewport.width+'-'+slowPolishMs);await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,label==='initial entry'?'entry-paint-samples.json':'cook-return-paint-samples.json'),JSON.stringify(frames,null,2));
  assert.ok(frames.length>2,label+': sampled the actual document loading period');
  assert.ok(frames.some(frame=>frame.ready==='loading'),label+': probe starts before deferred presentation scripts');
  assert.deepEqual(frames.filter(frame=>frame.legacyRegion),[],label+': no raw region banner flashes before the current header');
  assert.deepEqual(frames.filter(frame=>frame.legacyPlan),[],label+': no retired full-size budget ring flashes before the compact hero');
  const planFrames=frames.filter(frame=>frame.view==='week'||!frame.view&&frame.entryHint==='true');
  assert.ok(planFrames.some(frame=>frame.nav.length===5),label+': sampled the real five-tab dock');
  for(const frame of planFrames){
   if(frame.nav.length===5)assert.deepEqual(frame.nav.filter(button=>button.selected).map(button=>button.label),['Plan'],label+': only Plan may be visibly highlighted at '+frame.time+'ms');
   if(frame.appOpacity!==null)assert.equal(frame.appOpacity,'1',label+': Plan never enters through a half-opacity legacy frame');
   if(frame.settings){assert.equal(frame.settings.svg,true,label+': settings SVG is present before its decorator');assert.ok(frame.settings.iconWidth>0,label+': settings icon has visible geometry');assert.equal(frame.settings.blank,false,label+': settings never paints ivory on opaque white');}
  }
  assert.equal(await page.locator('#bbpolRegionPill').count(),1,label+': the current region control is installed after its original DOM becomes available');
  assert.equal(await page.locator('#bbpolUpgradePill').count(),1,label+': the current membership control remains available');
 }
 await checkColdPaint('initial entry');
 const budget=await page.locator('#headerTotal').innerText();
 await nav(page,'cook').click();await page.waitForURL(/make-a-meal\.html/);
 await page.waitForFunction(()=>document.body.classList.contains('bb-r6-cook-page'));
 await page.locator('[data-bb-navigation="polished"] [data-bb-nav-item="plan"]').click();
 await page.waitForSelector('.bbnext-day.has-meal');
 await checkColdPaint('return from Cook');
 assert.equal(await nav(page,'plan').getAttribute('data-bb-nav-current'),'true');
 assert.deepEqual(await physical(page),saved,'returning from Cook preserves the complete saved plan, stock, servings and budget data');
 assert.equal(await page.locator('#headerTotal').innerText(),budget,'the original budget calculation is unchanged');
 assert.equal(new URL(page.url()).searchParams.has('bbview'),false,'the original destination cleanup still runs');
 await page.getByRole('button',{name:'Open BasketBoss settings',exact:true}).click();await page.locator('.bbui-settings-overlay').waitFor({state:'visible'});await page.locator('.bbui-settings-close').click();
 assert.deepEqual(await physical(page),saved,'the same settings handler opens and closes without changing saved data');
},{slowPolishMs,observeColdPaint:true}));

for(const viewport of [{width:390,height:844},{width:1440,height:1000}])test('normal-motion tab paints never expose retired pantry UI at '+viewport.width+'px',{skip:!chromium?'Playwright unavailable':false},()=>fixture(viewport,async(page,context)=>{
 const saved=await physical(page);
 // A rAF sample runs in the browser before each paint, rather than querying
 // the DOM after a screenshot event (which can see a later, corrected DOM).
 await page.evaluate(()=>{
  const probe=window.__navPaint={frames:[],mutations:0};
  const visible=node=>!!node&&node.getClientRects().length>0&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden';
  new MutationObserver(records=>probe.mutations+=records.length).observe(document.getElementById('app'),{childList:true,subtree:true,attributes:true,characterData:true});
  const sample=()=>{
   const view=document.body.dataset.bbnextView;
   const region=document.getElementById('bb307Island')?.closest('[role="note"]'),ring=document.querySelector('#app.bbnext-plan .bbnext-plan-donut');
   probe.frames.push({view,legacy:view==='shop'&&['bb172Cupboard','bb172StaplesPanel'].some(id=>visible(document.getElementById(id))),legacyRegion:region?.parentElement===document.body&&visible(region),legacyPlan:visible(ring)&&!document.querySelector("#app .bbpc-week-header")&&ring.getBoundingClientRect().height>70,pantryReady:view==='shop'&&!!document.querySelector('#bb173ShopFridge.bbpi-enhanced #bbpiToolbar')});
   if(probe.frames.length<2000)requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 });
 const directory=path.join(process.env.BB_UI_SCREENSHOT_DIR||path.join(os.tmpdir(),'basketboss-ui-previews'),'navigation-'+viewport.width);await fs.mkdir(directory,{recursive:true});
 const cdp=await context.newCDPSession(page),frames=[],pending=[];
 cdp.on('Page.screencastFrame',event=>{
  const index=frames.length;frames.push(event.metadata.timestamp);
  pending.push(Promise.all([cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}),fs.writeFile(path.join(directory,String(index).padStart(3,'0')+'.png'),Buffer.from(event.data,'base64'))]));
 });
 await cdp.send('Page.startScreencast',{format:'png',everyNthFrame:1});
 // The first At home entry is cold; later entries reuse the same core module.
 for(const target of ['discover','kitchen','shop','plan','kitchen','plan']){
  await nav(page,target).click();await page.waitForTimeout(400);
  const view={plan:'week',discover:'discover',kitchen:'shop',shop:'shop-list'}[target];
  assert.equal(await page.evaluate(()=>document.body.dataset.bbnextView),view);
  assert.equal(await nav(page,target).getAttribute('data-bb-nav-current'),'true');
  if(target==='kitchen')await page.locator('#bb173ShopFridge.bbpi-enhanced #bbpiEmptyStart').waitFor({state:'attached'});
 }
 // Queue quick genuine nav clicks within a task, including a pending At home
 // render, to exercise disconnected-card and stale-observer guards.
 await page.evaluate(()=>{for(const key of ['kitchen','discover','plan','shop','kitchen'])document.querySelector('#bbPrimaryNavigation [data-bb-nav-item="'+key+'"]').click();});
 await page.waitForTimeout(700);
 assert.equal(await nav(page,'kitchen').getAttribute('data-bb-nav-current'),'true');
 assert.equal(await page.locator('#bb173ShopFridge.bbpi-enhanced').count(),1);
 assert.equal(await page.locator('#bbpiToolbar').count(),1);
 assert.equal(await page.locator('#bbKitchenSections').count(),1);
 assert.equal(await page.locator('.bbpi-global-actions').count(),1);
 const samples=await page.evaluate(()=>__navPaint.frames);
 assert.ok(samples.filter(frame=>frame.view==='shop').length>5,'recorded several real At home paint opportunities');
 assert.deepEqual(samples.filter(frame=>frame.legacy),[],'no retired cupboard tiles appear for even one frame');
 assert.deepEqual(samples.filter(frame=>frame.legacyRegion||frame.legacyPlan),[],'tab changes never repaint the retired region banner or Plan card');
 assert.deepEqual(samples.filter(frame=>frame.view==='shop'&&!frame.pantryReady),[],'At home presentation is ready before its first paint');
 const baseline=await page.evaluate(()=>__navPaint.mutations);await page.waitForTimeout(700);
 const after=await page.evaluate(()=>__navPaint.mutations);
 assert.ok(after-baseline<20,'presentation observers converge while idle: '+(after-baseline)+' mutations');
 assert.deepEqual(await physical(page),saved,'navigation does not change physical pantry quantities or the meal plan');
 await cdp.send('Page.stopScreencast');await Promise.all(pending);assert.ok(frames.length>6,'captured actual compositor frames for visual inspection');
 await fs.writeFile(path.join(directory,'paint-samples.json'),JSON.stringify(samples,null,2));
 // Cook is the existing standalone fifth destination, not a replaced handler.
 const href=await nav(page,'cook').getAttribute('href');assert.match(href,/make-a-meal\.html/);
 await nav(page,'cook').click();await page.waitForURL(/make-a-meal\.html/);
 await page.waitForFunction(()=>document.body.classList.contains('bb-r6-cook-page'));
 await page.locator('[data-bb-navigation="polished"] [data-bb-nav-item="plan"]').click();
 await page.waitForSelector('.bbnext-day.has-meal');assert.equal(await nav(page,'plan').getAttribute('data-bb-nav-current'),'true');
 assert.deepEqual(await physical(page),saved);
}));

test('pantry runtime exposes the existing module API without replacing an injected host',async()=>{
 const {readFile}=fs,vm=await import('node:vm'),source=await readFile(new URL('../bb-pantry-runtime.mjs',import.meta.url),'utf8');
 const runtime=source.replace(/^import[^\n]+\n/m,''),normalise=()=>{},core={normalizePantryState:normalise};
 for(const existing of [undefined,{normalizePantryState:()=>{}}]){
  const win={BBReceiptInventoryCore:existing};vm.runInNewContext(runtime,{window:win,receiptCore:core});
  assert.equal(win.BBReceiptInventoryCore,existing||core);assert.equal(win.BBPantryNormalize,normalise);assert.equal(win.BBPantryLiveSync,true);
 }
});
