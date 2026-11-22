import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser,release;const baseline=process.env.BB_MENU_TOUCH_BASELINE==='1';
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
   else if(rel==='bb-plan-compact.js'&&baseline)body=execFileSync('git',['show','96fccbd:bb-plan-compact.js'],{cwd:root,encoding:'utf8'});
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
  window.__compactTouch=[];
  const original=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,listener,options){
   if(type==='touchstart'&&new Error().stack.includes('bb-plan-compact.js'))window.__compactTouch.push({node:this,capture:typeof options==='boolean'?options:options?.capture===true,passive:typeof options==='object'&&options?.passive===true});
   return original.call(this,type,listener,options);
  };

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
  await page.waitForFunction(()=>typeof window.BBPantryNormalize==='function'&&!!document.querySelector('.bbpc-meal-menu'));
  await page.evaluate(()=>document.documentElement.classList.add('bb-native-android'));
  await run(page,context);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

const options={skip:!chromium?'Playwright unavailable':false,timeout:45000};
const day='.bbnext-day[data-bbnext-day="Monday"]';
const state=page=>page.evaluate(()=>Object.fromEntries(['basketboss_321_unified_state_v1','basketboss_321_features_v1','basketboss_321_v7_measured_pantry','basketboss_cloud_session_v1'].map(key=>[key,localStorage.getItem(key)])));
const counts=page=>page.evaluate(()=>({
 global:__compactTouch.filter(r=>[window,document,document.body,document.documentElement].includes(r.node)&&!r.passive).length,
 menus:[...document.querySelectorAll('.bbpc-meal-menu')].map(node=>({id:node.id,listeners:__compactTouch.filter(r=>r.node===node&&r.capture&&!r.passive).length})),
}));
const sample=async(page,label,value)=>{
 const dir=path.join(os.tmpdir(),'basketboss-ui-previews','menu-touch'+(baseline?'-baseline':''));await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,label+'.json'),JSON.stringify(value,null,2));
};

test('meal-menu touch cancellation is local, attached once and renewed only for real rebuilt menus',options,()=>fixture({width:390,height:844},async page=>{
 const initial=await counts(page);await sample(page,'listener-scope',initial);
 assert.equal(initial.global,0,'this adapter must not register a cancelable global touchstart');
 assert.ok(initial.menus.length>0);assert.ok(initial.menus.every(row=>row.listeners===1));
 await page.evaluate(()=>{window.__firstMenu=document.querySelector('.bbpc-meal-menu');for(let i=0;i<4;i++)BBPlanCompact.refresh();});
 assert.deepEqual(await counts(page),initial,'refresh reuses the same menu and does not add listeners');
 await page.locator('.bbpc-week-header .bbfeed-global>button:last-child').click();
 await page.waitForFunction(()=>document.querySelector('.bbpc-meal-menu')!==__firstMenu);
 const rebuilt=await counts(page);assert.equal(rebuilt.global,0);assert.ok(rebuilt.menus.every(row=>row.listeners===1),'new renderer-owned menus get exactly one local handler');
}));

test('menu padding cancels only its own touch while original button and outside touches remain eligible',options,()=>fixture({width:390,height:844},async page=>{
 const original=await state(page);
 await page.locator(day+' .bbpc-overflow-trigger').tap();
 const results=await page.evaluate(()=>{
  const row=document.querySelector('.bbnext-day[data-bbnext-day="Monday"]'),menu=row.querySelector('.bbpc-meal-menu'),button=menu.querySelector('button'),outside=document.getElementById('bbuiOpenSettings');
  const seen=[];document.addEventListener('touchstart',e=>seen.push(e.target),{once:false,passive:true});
  const fire=node=>{const e=new TouchEvent('touchstart',{bubbles:true,cancelable:true});const allowed=node.dispatchEvent(e);return{allowed,prevented:e.defaultPrevented,bubbled:seen.includes(node)};};
  const padding=fire(menu),action=fire(button),normal=fire(outside);
  return{padding,action,normal,rowOpen:row.open,menuHidden:menu.hidden};
 });
 assert.deepEqual(results,{padding:{allowed:false,prevented:true,bubbled:false},action:{allowed:true,prevented:false,bubbled:true},normal:{allowed:true,prevented:false,bubbled:true},rowOpen:false,menuHidden:false});
 const box=await page.locator(day+' .bbpc-meal-menu').boundingBox();await page.touchscreen.tap(box.x+2,box.y+2);
 assert.equal(await page.locator(day).evaluate(row=>row.open),false,'physical padding tap cannot activate the underlying day summary');
 assert.equal(await page.locator(day+' .bbpc-meal-menu').isVisible(),true);
 assert.deepEqual(await state(page),original);
 await sample(page,'touch-eligibility',results);
}));

test('the original Remove confirmation, Escape focus and pointer cancellation remain intact',options,()=>fixture({width:390,height:844},async page=>{
 const original=await state(page),trigger=page.locator(day+' .bbpc-overflow-trigger'),remove=page.locator(day+' .bbpc-meal-menu button');
 await page.evaluate(()=>{window.__originalRemove=document.querySelector('.bbnext-day[data-bbnext-day="Monday"] .bbpc-meal-menu button');window.__originalRemoveHandler=__originalRemove.onclick;});
 await trigger.press('ArrowDown');await remove.waitFor({state:'visible'});
 assert.equal(await remove.evaluate(n=>n===document.activeElement),true);
 await remove.click();await page.locator('#bbQaConfirmOverlay').waitFor();
 assert.equal(await page.locator('#bbQaConfirmTitle').innerText(),'Clear Monday dinner?');
 await page.locator('#bbQaConfirmOverlay').getByRole('button',{name:'Keep my week',exact:true}).click();
 assert.deepEqual(await state(page),original);
 assert.equal(await remove.evaluate(n=>n===__originalRemove&&n.onclick===__originalRemoveHandler&&n===document.activeElement),true,'the original control, handler and focus restoration remain owned by the existing flow');
 await remove.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(n=>n===document.activeElement),true);
 await trigger.press('ArrowDown');await remove.waitFor({state:'visible'});
 await page.evaluate(()=>{
  const trigger=document.querySelector('.bbnext-day[data-bbnext-day="Monday"] .bbpc-overflow-trigger');
  trigger.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:7}));
  document.getElementById('bbuiOpenSettings').focus();
  trigger.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:7}));
 });
 assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await page.locator(day+' .bbpc-meal-menu').isVisible(),false);
 assert.deepEqual(await state(page),original);
}));
