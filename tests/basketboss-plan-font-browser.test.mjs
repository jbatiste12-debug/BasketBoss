import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const compact=await fs.readFile(path.join(ROOT,'bb-plan-compact.css'),'utf8'),polish=await fs.readFile(path.join(ROOT,'bb-plan-premium-polish.css'),'utf8');
const FONT_MARKER='/* Inter font asset: @fontsource-variable/inter 5.2.8';
const baselineCompact=compact.slice(0,compact.indexOf(FONT_MARKER));
const baselinePolish=polish.replace('font-family:"Avenir Next",ui-sans-serif,system-ui,sans-serif!important','font-family:"Avenir Next",Inter,ui-sans-serif,system-ui,sans-serif!important');
const TITLE='.bbnext-day.has-meal .bbnext-day-description>strong',TIME='.bbnext-day.has-meal .bbpol-time';
const STATE='basketboss_321_unified_state_v1';

test('Plan Inter is a pinned licensed local variable font, with only text properties in the card overrides',()=>{
 const encoded=compact.match(/src:url\('data:font\/woff2;base64,([^']+)'\) format\('woff2'\)/)?.[1];assert.ok(encoded);
 const bytes=Buffer.from(encoded,'base64');assert.equal(bytes.length,48256);assert.equal(bytes.subarray(0,4).toString(),'wOF2');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),compact.match(/Asset SHA-256: ([a-f0-9]{64})/)[1]);
 assert.match(compact,/SIL OPEN FONT LICENSE Version 1\.1/);assert.match(compact,/font-weight:100 900;/);assert.match(compact,/font-display:swap;/);
 const overrides=compact.slice(compact.indexOf('html body[data-bbnext-view="week"]',compact.indexOf('/* Plan card Inter typography')));
 assert.doesNotMatch(overrides,/(?:^|[;{])\s*(?:display|position|margin|padding|gap|width|height|font-size|grid|background|color)\s*:/);
 assert.doesNotMatch(overrides,/button|bbfeed-control|bbfeed-meal/,'font overrides do not target controls or their parent');
});

async function fixture(updated,width){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),fontRequests=[],errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(/fonts\.(?:googleapis|gstatic)\.com|\.(?:woff2?|ttf)(?:\?|$)/.test(url.href))fontRequests.push(url.href);
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let rel=decodeURIComponent(url.pathname).replace(/^\//,'');if(['app','app/','app.html','index.html',''].includes(rel))rel='pwa700/app.html';
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  const canonical=rel.replace(/^pwa700\//,'');
  try{
   let body;
   if(canonical==='bb-plan-compact.css')body=updated?compact:baselineCompact;
   else if(canonical==='bb-plan-premium-polish.css')body=updated?polish:baselinePolish;
   else{try{body=await fs.readFile(path.join(ROOT,rel));}catch{body=await fs.readFile(path.join(ROOT,canonical));}}
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(rel)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4},{recipeId:'fajitas',day:'Tuesday',servings:3}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{rice:true},customPantry:[],dismissed:[],mealPreferences:null,pantryPlanGeneration:null,ingredientAvoidance:null,mealServings:{},dayServings:{},recipePhotos:{},recipeCollections:{},leftoverSources:{},leftoverConfirmed:{},bbManualBatch:null,bb81Batch:null}));
  localStorage.setItem('basketboss_321_v7_measured_pantry','{"rice|g":250}');localStorage.setItem('basketboss_321_v11_shop_ticks','{"rice":true}');
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
 });
 const client=await context.newCDPSession(page);await client.send('DOM.enable');await client.send('CSS.enable');
 const style=selector=>page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return Object.fromEntries(['fontFamily','fontWeight','fontSize','lineHeight','letterSpacing','margin','padding','gap','display','gridTemplateColumns'].map(key=>[key,s[key]]));});
 const fonts=async selector=>{const {root}=await client.send('DOM.getDocument');const {nodeId}=await client.send('DOM.querySelector',{nodeId:root.nodeId,selector});assert.ok(nodeId,selector);return (await client.send('CSS.getPlatformFontsForNode',{nodeId})).fonts.map(font=>({familyName:font.familyName,postScriptName:font.postScriptName,isCustomFont:font.isCustomFont}));};
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});await page.locator(TITLE).first().waitFor();await page.waitForFunction(()=>document.getElementById('app')?.dataset.bbCompactHeader==='true');await page.evaluate(()=>document.fonts.ready);
 return {context,page,style,fonts,fontRequests,errors};
}
async function nonPlan(h){
 const brand={fonts:await h.fonts('header.top .brand h1'),style:await h.style('header.top .brand h1')};delete brand.style.fontFamily;
 const control={fonts:await h.fonts('#bb172FillSixDinners'),style:await h.style('#bb172FillSixDinners')};
 const portions={fonts:await h.fonts('.bbnext-day.has-meal [data-bbfeed-delta]'),style:await h.style('.bbnext-day.has-meal [data-bbfeed-delta]')};
 await h.page.locator('#bbPrimaryNavigation [data-bb-nav-item="discover"]').click();await h.page.locator('#app .mini-content h4').first().waitFor();
 const discover={fonts:await h.fonts('#app .mini-content h4'),style:await h.style('#app .mini-content h4')};
 await h.page.goto('https://basketboss.co.uk/make-a-meal.html',{waitUntil:'domcontentloaded'});await h.page.locator('h1').first().waitFor();await h.page.evaluate(()=>document.fonts.ready);
 const cook={fonts:await h.fonts('h1'),style:await h.style('h1')};
 return {brand,control,portions,discover,cook};
}
for(const width of [390,1280])test('Inter 700 Plan titles and 500 metadata preserve other rendered fonts at '+width+'px',{skip:!chromium&&'Playwright unavailable'},async()=>{
 const before=await fixture(false,width),after=await fixture(true,width);
 try{
  const oldTitle=await before.style(TITLE),title=await after.style(TITLE),oldTime=await before.style(TIME),time=await after.style(TIME);
  assert.match(title.fontFamily,/^Inter, -apple-system, BlinkMacSystemFont, sans-serif$/);assert.equal(title.fontWeight,'700');assert.equal(title.fontSize,oldTitle.fontSize);assert.ok(Math.abs(Number.parseFloat(title.lineHeight)-Number.parseFloat(title.fontSize)*1.27)<.001);assert.ok(Math.abs(Number.parseFloat(title.letterSpacing)-Number.parseFloat(title.fontSize)*-.015)<.001);
  assert.match(time.fontFamily,/^Inter, -apple-system, BlinkMacSystemFont, sans-serif$/);assert.equal(time.fontWeight,'500');assert.equal(time.fontSize,oldTime.fontSize);assert.equal(time.lineHeight,oldTime.lineHeight);
  for(const key of ['margin','padding','gap','display','gridTemplateColumns']){assert.equal(title[key],oldTitle[key],key);assert.equal(time[key],oldTime[key],key);}
  assert.equal((await before.fonts(TITLE)).some(font=>font.isCustomFont),false);assert.ok((await after.fonts(TITLE)).some(font=>font.isCustomFont&&/Inter/i.test(font.familyName)));assert.ok((await after.fonts(TIME)).some(font=>font.isCustomFont&&/Inter/i.test(font.familyName)));
  const weights=await after.page.evaluate(async()=>Promise.all([500,600,700].map(async weight=>{const loaded=await document.fonts.load(weight+' 16px Inter','Crème brûlée £4');return {weight,loaded:loaded.length,families:loaded.map(face=>face.family),statuses:loaded.map(face=>face.status)};})));
  for(const result of weights){assert.equal(result.loaded,1);assert.deepEqual(result.families,['Inter']);assert.deepEqual(result.statuses,['loaded']);}
  await after.page.locator(TITLE).first().evaluate(node=>{node.textContent='Crème brûlée – £4';});
  assert.ok((await after.fonts(TITLE)).every(font=>font.isCustomFont&&/Inter/i.test(font.familyName)),'Latin accents and sterling use the actual Inter face');
  assert.deepEqual(await nonPlan(after),await nonPlan(before),'brand, Discover, Cook and Plan control font rendering remains unchanged');
  assert.deepEqual(after.fontRequests,[],'embedded font creates no font-network dependency');assert.deepEqual(after.errors,[]);assert.deepEqual(before.errors,[]);
 }finally{await before.context.close();await after.context.close();}
});
