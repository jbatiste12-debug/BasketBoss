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

const physical=page=>page.evaluate(()=>({inventory:localStorage.getItem('basketboss_makeameal_v1_inventory'),stock:localStorage.getItem('basketboss_321_v7_measured_pantry'),state:localStorage.getItem('basketboss_321_unified_state_v1'),features:localStorage.getItem('basketboss_321_features_v1'),planned:JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')).planned}));
const nav=(page,name)=>page.locator('#bbPrimaryNavigation [data-bb-nav-item="'+name+'"]');



for(const viewport of [{width:390,height:844},{width:1440,height:1000}])test('fresh tab DOM owns layout and every normal-motion tab paint is opaque at '+viewport.width+'px',{skip:!chromium},()=>fixture(viewport,async(page)=>{
 const saved=await physical(page),output=[];
 for(const target of ['discover','kitchen','shop','plan','discover','plan']){
  await page.evaluate(target=>{
   window.__transitionSamples=[];let frames=0;const sample=()=>{
    const app=document.getElementById('app'),ring=app.querySelector('.bbnext-plan-donut'),budget=app.querySelector('.bbnext-plan-budget'),s=getComputedStyle(app);
    const visible=node=>!!node&&node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    const selected=[...document.querySelectorAll('#bbPrimaryNavigation>[data-bb-nav-item]')].filter(visible).filter(n=>{const s=getComputedStyle(n);return s.backgroundImage!=='none';}).map(n=>n.dataset.bbNavItem);
    window.__transitionSamples.push({view:document.body.dataset.bbnextView,display:s.display,opacity:s.opacity,animation:s.animationName,selected,replacementShop:visible(document.getElementById('bbReleaseShopOverview')),ringHeight:ring?.getBoundingClientRect().height,budgetBackground:budget&&getComputedStyle(budget).backgroundColor,budgetImage:budget&&getComputedStyle(budget).backgroundImage,decorated:!!app.querySelector('.bbpc-week-header')});
    if(frames++<20)requestAnimationFrame(sample);
   };document.querySelector('#bbPrimaryNavigation [data-bb-nav-item="'+target+'"]').click();requestAnimationFrame(sample);
  },target);
  await page.waitForTimeout(400);
  const samples=await page.evaluate(()=>window.__transitionSamples);output.push({target,samples});assert.ok(samples.length>3);
  for(const frame of samples){
   assert.equal(frame.opacity,'1',JSON.stringify({target,frame}));assert.equal(frame.animation,'none');
   assert.deepEqual(frame.selected,[target],JSON.stringify({target,frame}));
   if(target!=='plan'){if(target==='shop'){assert.ok(['flex','none'].includes(frame.display),'Shop retains its own layout instead of the stale Plan grid');if(frame.display==='none')assert.ok(frame.replacementShop,'the current Shop overview is visible when it hides the old app container');}else assert.equal(frame.display,'block','retained Plan decoration attributes cannot turn '+target+' into the Plan grid');}
   if(target==='plan'&&!frame.decorated){assert.ok(frame.budgetImage!=='none'||!['rgb(255, 255, 255)','rgba(0, 0, 0, 0)'].includes(frame.budgetBackground),'fresh undecorated Plan card remains dark');assert.ok(frame.ringHeight<=70,'a rerender cannot expose the retired full-size budget ring');}
  }
 }
 const dir=path.join(os.tmpdir(),'basketboss-ui-previews','whole-transitions-'+viewport.width);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'paint-samples.json'),JSON.stringify(output,null,2));
 assert.deepEqual(await physical(page),saved,'all tab changes preserve every recorded plan/pantry/serving value');
}));
