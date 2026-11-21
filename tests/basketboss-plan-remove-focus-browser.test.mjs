import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const skip=!chromium&&'Playwright unavailable';
const STATE='basketboss_321_unified_state_v1';
const OTHER_KEYS=['basketboss_321_v7_measured_pantry','basketboss_makeameal_v1_inventory','basketboss_321_features_v1','basketboss_321_v11_shop_ticks'];

async function fixture(){
 const context=await browser.newContext({viewport:{width:1280,height:900},isMobile:false,hasTouch:false,serviceWorkers:'block'}),page=await context.newPage(),errors=[],householdWrites=[];
 page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 // Serve the shipped app and intercept every request. No customer, household,
 // account, billing or provider service is contacted by this fixture.
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/')){
   if(url.pathname==='/api/household'&&request.method()!=='GET')householdWrites.push(request.method());
   return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  }
  let name=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(['app','app/','app.html','index.html','index',''].includes(name))name='pwa700/app.html';
  if(name.includes('..'))return route.fulfill({status:404,body:''});
  try{const body=await fs.readFile(path.join(root,name)),types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};return route.fulfill({status:200,contentType:types[path.extname(name)]||'application/octet-stream',body});}
  catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4},{recipeId:'fajitas',day:'Tuesday',servings:3}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{rice:true},customPantry:[],dismissed:[],scanEndpoint:'',mealPreferences:null,pantryPlanGeneration:null,ingredientAvoidance:null,mealServings:{},dayServings:{},recipePhotos:{},recipeCollections:{},leftoverSources:{},leftoverConfirmed:{},bbManualBatch:null,bb81Batch:null}));
  localStorage.setItem('basketboss_321_v7_measured_pantry','{"rice|g":250}');localStorage.setItem('basketboss_makeameal_v1_inventory','{}');
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v11_shop_ticks','{"rice":true}');localStorage.setItem('basketboss_321_v7_market','Guernsey');
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
 });
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'More options for Monday dinner',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.getElementById('app').getAnimations().some(animation=>animation.playState==='running'));
 const snapshot=()=>page.evaluate(({STATE,OTHER_KEYS})=>({state:JSON.parse(localStorage.getItem(STATE)),other:Object.fromEntries(OTHER_KEYS.map(key=>[key,localStorage.getItem(key)]))}),{STATE,OTHER_KEYS});
 const monday=page.locator('.bbnext-day[data-bbnext-day="Monday"]'),trigger=monday.getByRole('button',{name:'More options for Monday dinner',exact:true}),remove=monday.getByRole('button',{name:'Remove Monday dinner',exact:true});
 return {context,page,monday,trigger,remove,snapshot,errors,householdWrites};
}

async function mouseRemove(h,{blur=false}={}){
 await h.trigger.click();await h.remove.waitFor({state:'visible'});
 // Model focus moving away during a desktop button press. This reproduces the
 // observed retargeting path; it does not pretend Chromium is native Safari.
 if(blur)await h.remove.evaluate(node=>node.addEventListener('mousedown',()=>node.blur(),{once:true}));
 const rect=await h.remove.boundingBox();await h.page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await h.page.mouse.down();
 assert.equal(await h.remove.isVisible(),true,'focus loss cannot hide the pressed action before mouseup/click');
 await h.page.mouse.up();await h.page.locator('#bbQaConfirmOverlay').waitFor();
 assert.equal(await h.page.locator('#bbQaConfirmTitle').innerText(),'Clear Monday dinner?');
 assert.equal(await h.page.locator('.bbdps-active').count(),0,'Remove must not open the underlying day editor');
}

for(const blur of [false,true])test('desktop Remove preserves confirmation and dinner isolation with mousedown blur='+blur,{skip},async()=>{
 const h=await fixture();try{
  const before=await h.snapshot();await mouseRemove(h,{blur});
  await h.page.locator('#bbQaConfirmOverlay').getByRole('button',{name:'Keep my week',exact:true}).click();
  assert.deepEqual(await h.snapshot(),before,'cancelling preserves all saved plan and pantry data');
  assert.equal(await h.remove.evaluate(node=>node===document.activeElement),true,'cancellation restores the real Remove control');
  await h.remove.press('Escape');assert.equal(await h.trigger.getAttribute('aria-expanded'),'false');
  await mouseRemove(h,{blur});await h.page.locator('#bbQaConfirmOverlay').getByRole('button',{name:'Clear this meal',exact:true}).click();
  await h.page.waitForFunction(STATE=>!JSON.parse(localStorage.getItem(STATE)).planned.some(item=>item.day==='Monday'),STATE);
  const after=await h.snapshot();assert.deepEqual(after.state.planned,before.state.planned.filter(item=>item.day!=='Monday'));
  assert.deepEqual({...after.state,planned:before.state.planned},before.state,'the removal changes only the intended dinner');
  assert.deepEqual(after.other,before.other,'pantry, essentials and shopping checkmarks stay unchanged');
  assert.deepEqual(h.householdWrites,[]);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('meal overflow retains outside, Tab, Escape and pointer cancellation behavior',{skip},async()=>{
 const h=await fixture();try{
  const before=await h.snapshot();await h.trigger.click();await h.remove.waitFor({state:'visible'});await h.remove.press('Tab');
  assert.equal(await h.trigger.getAttribute('aria-expanded'),'false','Tab leaving the menu closes it');
  await h.trigger.focus();await h.trigger.press('ArrowDown');await h.remove.waitFor({state:'visible'});await h.remove.press('Escape');
  assert.equal(await h.trigger.evaluate(node=>node===document.activeElement),true);assert.equal(await h.trigger.getAttribute('aria-expanded'),'false');
  await h.trigger.click();await h.remove.waitFor({state:'visible'});await h.page.mouse.click(4,4);
  assert.equal(await h.trigger.getAttribute('aria-expanded'),'false','an outside pointer closes the menu');
  await h.trigger.click();await h.remove.waitFor({state:'visible'});
  await h.remove.dispatchEvent('pointerdown',{button:0,pointerId:1,pointerType:'mouse'});await h.remove.evaluate(node=>node.blur());
  await h.remove.dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse'});
  assert.equal(await h.trigger.getAttribute('aria-expanded'),'false','a cancelled activation cannot leave focusout suppression behind');
  assert.deepEqual(await h.snapshot(),before);assert.deepEqual(h.householdWrites,[]);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
