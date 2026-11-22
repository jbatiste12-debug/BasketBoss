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


const snapshot=()=>{
 const app=document.getElementById('app');
 const visible=node=>!!node&&node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
 return {view:document.body.dataset.bbnextView,shopVisible:visible(document.getElementById('bbReleaseShopOverview')),weekHeader:!!app.querySelector('.bbpc-week-header'),compactHeader:app.dataset.bbCompactHeader==='true',discoverCopy:!!app.querySelector('#swipeCard>.bbdc-hero-copy'),discoverCaption:app.querySelector('#swipeCard>.bbdc-hero-copy')?.textContent,active:[...document.querySelectorAll('#bbPrimaryNavigation>[data-bb-nav-current="true"]')].filter(visible).map(n=>n.dataset.bbNavItem),height:app.querySelector('.bbnext-plan-budget')?.getBoundingClientRect().height,weekSummary:app.querySelector('.bbpc-week-header')?.textContent,weekPrice:app.querySelector('.bbpc-week-price')?.textContent};
};

for(const viewport of [{width:390,height:844},{width:1440,height:1000}])test('first paint commits complete local tab presentation without a stale Shop or Plan view at '+viewport.width+'px',{skip:!chromium},()=>fixture(viewport,async(page)=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));
 await page.evaluate(()=>{
  const app=document.getElementById('app'),width=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetWidth').get;
  window.__tabAnimationLayoutReads=0;
  Object.defineProperty(app,'offsetWidth',{configurable:true,get(){window.__tabAnimationLayoutReads++;return width.call(this);}});
 });
 const before=await page.evaluate(()=>({state:localStorage.getItem('basketboss_321_unified_state_v1'),stock:localStorage.getItem('basketboss_321_v7_measured_pantry')}));
 const evidence=[];
 for(const target of ['shop','plan','discover','plan']){
  const first=await page.evaluate(({target,source})=>new Promise(resolve=>{
   const take=eval('('+source+')'),started=performance.now();
   // Queue the observer BEFORE the tap. A decorator scheduled in the next
   // animation frame would miss this first visible-frame boundary.
   requestAnimationFrame(()=>resolve({...take(),elapsed:performance.now()-started}));
   document.querySelector('#bbPrimaryNavigation [data-bb-nav-item="'+target+'"]').click();
  }),{target,source:snapshot.toString()});
  assert.equal(await page.evaluate(()=>window.__tabAnimationLayoutReads),0,'tab rendering does not force layout to restart an already-disabled entrance animation');
  assert.deepEqual(first.active,[target],JSON.stringify({target,first}));
  assert.equal(first.shopVisible,viewport.width<768&&target==='shop',JSON.stringify({target,first}));
  if(target==='plan'){
   assert.ok(first.weekHeader&&first.compactHeader,JSON.stringify({target,first}));
   const settled=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const app=document.getElementById('app');resolve({height:app.querySelector('.bbnext-plan-budget')?.getBoundingClientRect().height,weekSummary:app.querySelector('.bbpc-week-header')?.textContent,weekPrice:app.querySelector('.bbpc-week-price')?.textContent});}))));
   assert.deepEqual(settled,{height:first.height,weekSummary:first.weekSummary,weekPrice:first.weekPrice},'the My Week card and computed values cannot change after the first frame');
  }
  if(target==='discover')assert.ok(first.discoverCopy,JSON.stringify({target,first}));
  evidence.push({target,first});
 }
 const after=await page.evaluate(()=>({state:localStorage.getItem('basketboss_321_unified_state_v1'),stock:localStorage.getItem('basketboss_321_v7_measured_pantry')}));
 assert.deepEqual(after,before,'tab presentation never changes planner/stock persistence');
 await page.evaluate(()=>{window.__presentationMutations=0;new MutationObserver(records=>{window.__presentationMutations+=records.length;}).observe(document.getElementById('app'),{childList:true,subtree:true,attributes:true});});
 await page.waitForTimeout(200);
 const idle=await page.evaluate(()=>window.__presentationMutations);
 assert.equal(idle,0,'presentation observers settle instead of mutating every animation frame');
 const dir=path.join(os.tmpdir(),'basketboss-ui-previews','instant-tab-'+viewport.width);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'first-paint.json'),JSON.stringify({evidence,idle},null,2));
}));
