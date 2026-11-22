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
import {transformNativeHtml} from '../scripts/build-native-web.mjs';
import {androidDocument} from '../scripts/build-android-web.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

async function fixture(viewport,run,{slowPolishMs=0,observeColdPaint=false}={}){
 const context=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768,userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',reducedMotion:'no-preference',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 const app=androidDocument(transform700Presentation(transform700Html(transformNativeHtml(await fs.readFile(path.join(root,'app.html'),'utf8')),release)));
 // Every request is local, including API calls. No production data or billing
 // operations are possible, and the original renderer/handlers are exercised.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['localhost','basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let rel=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(slowPolishMs&&rel==='bb-plan-premium-polish.js')await new Promise(resolve=>setTimeout(resolve,slowPolishMs));
  if(['app','app/','app.html','index.html','index',''].includes(rel))rel='app.html';
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;
   if(rel==='app.html')body=app;
   else if(rel==='bb-native.css')body=process.env.BB_ANDROID_TOUCH_BASELINE==='1'?execFileSync('git',['show','96fccbd:native/android.css'],{cwd:root}):await fs.readFile(path.join(root,'native/android.css')); 
   else if(rel==='bb-native-runtime.js')body="document.documentElement.classList.add('bb-native-android');window.BBNative=Object.freeze({isNative:true,platform:'android'});";
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
  await page.goto('https://localhost/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.bbnext-day.has-meal');
  await page.waitForFunction(()=>typeof window.BBPantryNormalize==='function');
  await run(page,context);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

const styles=page=>page.locator('link[href="bb-native.css"]').evaluate(node=>{node.sheet.disabled=!node.sheet.disabled;return !node.sheet.disabled;});
const saved=page=>page.evaluate(()=>Object.fromEntries(['basketboss_321_unified_state_v1','basketboss_321_features_v1','basketboss_321_v7_measured_pantry','basketboss_cloud_session_v1'].map(key=>[key,localStorage.getItem(key)])));
const css=async(page,selector,pseudo)=>page.locator(selector).first().evaluate((node,pseudo)=>{const s=getComputedStyle(node,pseudo);return{touch:s.touchAction,blur:s.backdropFilter,background:s.backgroundColor,transition:s.transitionProperty,duration:s.transitionDuration,selection:s.userSelect};},pseudo);
const options={skip:!chromium?'Playwright unavailable':false,timeout:60000};

test('Android actual tap controls have immediate pressed feedback while dedicated gestures remain owned',options,()=>fixture({width:390,height:844},async page=>{
 const original=await saved(page),evidence=[];
 for(const selector of ['#bbPrimaryNavigation a[href]','.bbpc-week-info>summary']){
  assert.equal((await css(page,selector)).touch,'manipulation');await styles(page);const before=await css(page,selector);await styles(page);const after=await css(page,selector);evidence.push({selector,before,after});assert.equal(before.touch,'manipulation','the existing shared gesture policy remains intact');
 }
 assert.equal((await css(page,'summary.bbnext-day-toggle')).touch,'pan-y');
 assert.equal((await css(page,'[data-bb-plan-handle]')).touch,'none');
 // A held physical pointer tests the existing :active declaration. Releasing
 // outside the control avoids its original click action or any state change.
 const candidate=await page.evaluate(()=>[...document.querySelectorAll('button')].find(n=>n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&getComputedStyle(n).transitionDuration.split(',').some(v=>parseFloat(v)>0))?.id);
 assert.ok(candidate,'fixture must exercise an actual existing animated button');
 const box=await page.locator('#'+candidate).boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 const pressed=await css(page,'#'+candidate);assert.equal(pressed.duration,'0s');await styles(page);const oldPressed=await css(page,'#'+candidate);assert.notEqual(oldPressed.duration,'0s');await styles(page);await page.mouse.move(1,1);await page.mouse.up();evidence.push({candidate,pressed,oldPressed});
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item=discover]').click();assert.equal((await css(page,'#swipeCard')).touch,'pan-y');
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item=kitchen]').click();await page.waitForSelector('.bbpi-storage-tabs',{state:'attached'});assert.equal((await css(page,'.bbpi-storage-tabs')).touch,'pan-x');
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item=shop]').click();await page.waitForSelector('#bbReleaseShopOverview .bb-r6-track');
 assert.equal((await css(page,'#bbReleaseShopOverview .bb-r6-track span')).duration,'0s');await styles(page);const oldProgress=await css(page,'#bbReleaseShopOverview .bb-r6-track span');assert.equal(oldProgress.transition,'width');assert.notEqual(oldProgress.duration,'0s');await styles(page);evidence.push({oldProgress});
 await fs.writeFile(path.join(os.tmpdir(),'basketboss-android-touch-paint-controls.json'),JSON.stringify(evidence,null,2));assert.deepEqual(await saved(page),original);
}));

test('Android real owner dialogs retain dim backdrops, focus/close and saved state without live-page blur',options,()=>fixture({width:390,height:844},async page=>{
 const original=await saved(page),evidence=[];
 const dialogs=[
  {owner:'BBHowItWorks',selector:'#bbHowItWorksDialog',close:'.bb-how-close'},
  {owner:'BBEssentialsConfirm',selector:'#bbEssentialConfirm',close:'.bbec-cancel'},
  {owner:'BBKitchenReview',selector:'.bb-kitchen-review-dialog',close:'.bb-kitchen-review-close'},
 ];
 for(const item of dialogs){
  await page.evaluate(name=>window[name].open(),item.owner);await page.locator(item.selector).waitFor({state:'visible'});
  const current=await css(page,item.selector,'::backdrop');assert.equal(current.blur,'none');await styles(page);const before=await css(page,item.selector,'::backdrop');assert.match(before.blur,/blur\([34]px\)/);assert.equal(current.background,before.background);await styles(page);
  assert.equal(await page.locator(item.selector).evaluate(n=>n.contains(document.activeElement)),true,'original dialog still owns keyboard focus');
  await page.locator(item.selector+' '+item.close).click();await page.locator(item.selector).waitFor({state:'detached'});assert.deepEqual(await saved(page),original);evidence.push({...item,before,current});
 }
 await fs.writeFile(path.join(os.tmpdir(),'basketboss-android-touch-paint-dialogs.json'),JSON.stringify(evidence,null,2));
}));

for(const platform of ['web','ios'])test('Android touch/paint additions do not alter '+platform+' computed styles',options,()=>fixture({width:390,height:844},async page=>{
 await page.evaluate(platform=>{document.documentElement.classList.remove('bb-native-android');if(platform==='ios')document.documentElement.classList.add('bb-native-ios');},platform);
 const selectors=['#bbPrimaryNavigation a[href]','.bbpc-week-info>summary','summary.bbnext-day-toggle','[data-bb-plan-handle]'];
 const before=await Promise.all(selectors.map(selector=>css(page,selector)));await styles(page);const after=await Promise.all(selectors.map(selector=>css(page,selector)));assert.deepEqual(after,before);await styles(page);
 await page.evaluate(()=>BBHowItWorks.open());await page.locator('#bbHowItWorksDialog').waitFor({state:'visible'});const backdrop=await css(page,'#bbHowItWorksDialog','::backdrop');assert.match(backdrop.blur,/blur\(3px\)/);await styles(page);assert.deepEqual(await css(page,'#bbHowItWorksDialog','::backdrop'),backdrop);await styles(page);await page.locator('.bb-how-close').click();
}));
