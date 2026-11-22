import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build700Pwa} from '../tools/catalogue700/build-pwa.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser,source,iosCSS,pwaSource,pwaTemporary,pwaDirectory;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 [source,iosCSS]=await Promise.all([fs.readFile(path.join(root,'make-a-meal.html'),'utf8'),fs.readFile(path.join(root,'native/bb-native.css'),'utf8')]);
 pwaTemporary=await fs.mkdtemp(path.join(os.tmpdir(),'bb-cook-first-paint-pwa-'));pwaDirectory=path.join(pwaTemporary,'pwa700');
 build700Pwa({sourceRoot:root,publicRelease:path.join(root,'catalogues/700/release'),outputDirectory:pwaDirectory,writeImageRedirects:false});
 pwaSource=await fs.readFile(path.join(pwaDirectory,'make-a-meal.html'),'utf8');
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();if(pwaTemporary)await fs.rm(pwaTemporary,{recursive:true,force:true});});

const stored={
 basketboss_321_unified_state_v1:JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}),
 basketboss_makeameal_v1_inventory:JSON.stringify({rice:{name:'Rice',loc:'cupboard',qty:500,unit:'g',selected:true}}),
 basketboss_321_v7_measured_pantry:JSON.stringify({rice:{name:'Rice',loc:'cupboard',qty:500,unit:'g'}})
};
const available={skip:!chromium?'Playwright unavailable':false};
// Android's native container has the same forced raw-nav / pre-ready Back
// display contract. Exercise those author !important rules without requiring
// the separate Android checkout or changing either native implementation.
const androidCSS='html.bb-native-android body nav.bb-r6-cook-nav{display:flex!important;position:fixed!important;left:0!important;right:0!important;bottom:8px!important;z-index:9990!important}.bb-native-android:not(.bb-cook-ready) .bb17513-meal-back{display:inline-flex!important;min-height:44px;align-items:center}';

async function fixture({width=390,platform='web',motion='no-preference',baseline=false,failScript=null,query='',pwa=false,holdController=false,throwController=false}={},run){
 const context=await browser.newContext({viewport:{width,height:width<768?844:1000},isMobile:width<768,hasTouch:width<768,reducedMotion:motion,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 let releaseController;const controllerWait=new Promise(resolve=>{releaseController=resolve;});
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 let document=pwa?pwaSource:source;
 // Remove this presentation fix from the current source copy; the baseline
 // remains a counterexample after any later commit becomes HEAD.
 if(baseline)document=document.replace(/<style id="bb-cook-first-paint">[\s\S]*?<\/style>/,'').replace('bb-premium-companion bb-r6-cook-page','bb-premium-companion').replace(/<section id="bbCookOpening"[\s\S]*?<\/section>/,'').replace('data-bb-navigation="polished"','');
 if(platform!=='web')document=document.replace('<html lang="en">','<html lang="en" class="bb-native-'+platform+'">').replace('</head>','<style>'+(platform==='ios'?iosCSS:androidCSS)+'</style></head>');
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='basketboss.co.uk')return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  const requested=decodeURIComponent(url.pathname).replace(/^\//,''),generated=pwa&&requested.startsWith('pwa700/'),rel=generated?requested.slice('pwa700/'.length):requested;
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  if(rel===failScript)return route.abort('failed');
  if(rel==='make-a-meal.js'){if(holdController)await controllerWait;else await new Promise(resolve=>setTimeout(resolve,baseline?1500:650));}
  if(rel==='bb-navigation-polish.js')await new Promise(resolve=>setTimeout(resolve,350));
  try{
   let body=rel==='make-a-meal.html'?document:await fs.readFile(path.join(generated?pwaDirectory:root,rel));
   if(throwController&&rel==='make-a-meal.js')body='throw new Error("Cook controller fixture failure");\n'+body;
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};
   return route.fulfill({status:200,contentType:types[path.extname(rel)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(saved=>{
  for(const [key,value]of Object.entries(saved))localStorage.setItem(key,value);
  const create=URL.createObjectURL.bind(URL);window.__photoObjectURLs=0;URL.createObjectURL=(...args)=>{window.__photoObjectURLs++;return create(...args);};
  const probe=window.__cookFirstPaint={frames:[],stop:false};
  const visible=node=>!!node&&node.getClientRects().length>0&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden'&&(!node.checkVisibility||node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
  const sample=()=>{
   const nav=document.querySelector('nav.bb-r6-cook-nav'),hero=document.querySelector('#bb15AiPremiumHub .bbpm-intro'),heroStyle=visible(hero)?getComputedStyle(hero):null;
   probe.frames.push({time:performance.now(),state:document.readyState,ready:document.documentElement.classList.contains('bb-cook-ready'),photo:document.body?.classList.contains('bb-photo-meal-page')||false,
    legacyDashboard:visible(document.querySelector('.bb-meal-dashboard')),legacyHeader:!document.body?.classList.contains('bb-photo-meal-page')&&visible(document.querySelector('.bb17513-meal-topbar')),legacyBack:visible(document.querySelector('.bb17513-meal-back')),
    rawNav:nav?.dataset.bbNavigation!=='polished'&&visible(nav),rawNavIcon:nav?.dataset.bbNavigation!=='polished'&&[...nav?.querySelectorAll('svg')||[]].some(visible),
    studio:visible(document.querySelector('#bb15AiPremiumHub')),heroOpacity:heroStyle?.opacity??null,heroTransform:heroStyle?.transform??null,opening:visible(document.getElementById('bbCookOpening')),polishedNav:nav?.dataset.bbNavigation==='polished'&&visible(nav)});
   if(!probe.stop&&probe.frames.length<2000)requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 },stored);
 try{
  await page.goto('https://basketboss.co.uk/'+(pwa?'pwa700/':'')+'make-a-meal.html'+query,{waitUntil:'commit'});
  await run(page,{releaseController});
  assert.deepEqual(await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),Object.keys(stored)),stored,'opening Cook leaves the saved plan and pantry data unchanged');
  assert.deepEqual(errors,throwController?['Cook controller fixture failure']:[]);
 }finally{releaseController();await context.close();}
}

async function samples(page,name){
 const frames=await page.evaluate(()=>{__cookFirstPaint.stop=true;return __cookFirstPaint.frames;});
 const directory=path.join(process.env.BB_UI_SCREENSHOT_DIR||path.join(os.tmpdir(),'basketboss-ui-previews'),'cook-first-paint');await fs.mkdir(directory,{recursive:true});
 await fs.writeFile(path.join(directory,name+'.json'),JSON.stringify(frames,null,2));await page.screenshot({path:path.join(directory,name+'.png')});
 return frames;
}

test('the delayed Cook baseline exposes the retired dashboard before its photo workspace',available,()=>fixture({baseline:true,platform:'ios'},async page=>{
 await page.waitForFunction(()=>document.documentElement.classList.contains('bb-cook-ready'));await page.waitForTimeout(100);
 const frames=await samples(page,'baseline');
 assert.ok(frames.some(frame=>!frame.ready&&frame.legacyDashboard),'the paint probe catches the original legacy-dashboard flash');
 assert.ok(frames.some(frame=>!frame.ready&&frame.rawNav),'the probe catches raw navigation before its decorator');
}));

for(const {width,platform}of [{width:390,platform:'web'},{width:1440,platform:'web'},{width:390,platform:'ios'},{width:390,platform:'android'}])for(const motion of ['no-preference','reduce'])test('Cook paints only its current workspace at '+width+'px / '+platform+' / '+motion,available,()=>fixture({width,platform,motion},async page=>{
 await page.waitForFunction(()=>document.documentElement.classList.contains('bb-cook-ready')&&document.body?.classList.contains('bb-photo-meal-page'));await page.waitForTimeout(100);
 const frames=await samples(page,width+'-'+platform+'-'+motion),pre=frames.filter(frame=>!frame.ready||!frame.photo);
 assert.ok(pre.length>5,'sampled real frames while the existing Cook module was delayed');
 assert.ok(pre.some(frame=>frame.photo&&frame.studio&&!frame.ready),'the actual photo workspace paints while the larger controller is still loading');
 assert.deepEqual(frames.filter(frame=>frame.opening),[],'normal tab entry never paints an intermediate opening gate');
 assert.deepEqual(pre.filter(frame=>frame.legacyDashboard||frame.legacyHeader||frame.legacyBack),[],'no retired controls or native pre-ready Back link escape the parent gate');
 assert.deepEqual(frames.filter(frame=>frame.rawNav||frame.rawNavIcon),[],'raw navigation never paints before its existing decorator');
 const heroFrames=frames.filter(frame=>frame.heroOpacity!==null);assert.ok(heroFrames.length>0,'sampled the actual visible opening hero');
 for(const frame of heroFrames){assert.equal(frame.heroOpacity,'1','the opening hero paints at full contrast at '+frame.time+'ms');assert.equal(frame.heroTransform,'none','the opening hero is already in its final position at '+frame.time+'ms');}
 assert.ok(frames.some(frame=>frame.ready&&frame.photo&&frame.studio&&!frame.opening&&frame.polishedNav),'the real current workspace and five-tab dock replace the opening state');
 assert.equal(await page.locator('[data-bb-nav-item="cook"]').getAttribute('data-bb-nav-current'),'true');
 assert.equal(await page.locator('#ai-photo-input').count(),1,'the existing file control stays intact');
}));

for(const {platform,pwa=false}of [{platform:'web'},{platform:'ios'},{platform:'android'},{platform:'web',pwa:true}])for(const failScript of ['make-a-meal.js','bb-cook-studio.js'])test('Cook keeps working recovery links when '+failScript+' fails / '+platform+(pwa?' / generated PWA':''),available,()=>fixture({platform,pwa,failScript,motion:'reduce',query:'?bbscan=pantry'},async page=>{
 await page.waitForLoadState('domcontentloaded');await page.waitForTimeout(150);
 const frames=await samples(page,'failed-'+(pwa?'pwa700-':'')+platform+'-'+failScript),painted=frames.filter(frame=>frame.opening||frame.studio||frame.legacyDashboard);
 assert.ok(painted.some(frame=>frame.opening),'a failed script leaves meaningful recovery content');
 assert.deepEqual(painted.filter(frame=>frame.legacyDashboard||frame.legacyHeader||frame.legacyBack),[],'failure never releases the retired shell, including when the controller alone marks ready');
 const retry=page.getByRole('link',{name:'Try again',exact:true}),back=page.getByRole('link',{name:'Back to Plan',exact:true});
 assert.equal(await retry.isVisible(),true);assert.equal(await back.isVisible(),true);
 const openingURL=page.url();
 if(pwa)assert.equal(await page.locator('base').getAttribute('href'),'/','exercise the actual generated PWA base element');
 assert.equal(await retry.evaluate(node=>node.href),openingURL,'the recovery link targets the current Cook document even under a root base URL');
 assert.equal(await retry.evaluate(node=>new URL(node.href).search),'?bbscan=pantry','the ordinary retry link retains the current scan mode');
 assert.equal(await back.getAttribute('href'),'index.html?bbview=week');
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),retry.click()]);
 assert.equal(page.url(),openingURL,'Try again reloads the same Cook pathname and scan mode');
 assert.equal(await page.getByRole('link',{name:'Back to Plan',exact:true}).isVisible(),true,'the recovery action remains available after a second failed load');
 // Intercept only the next document to exercise the real ordinary-link action.
 await page.route('**/index.html?bbview=week',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Plan recovery destination</title><p>Plan</p>'}));
 await back.click();await page.waitForURL('**/index.html?bbview=week');
 assert.equal(await page.title(),'Plan recovery destination');
}));

test('native iOS Cook keeps its current workspace and its authored dock when decoration fails',available,()=>fixture({platform:'ios',failScript:'bb-navigation-polish.js'},async page=>{
 await page.waitForFunction(()=>document.documentElement.classList.contains('bb-cook-ready')&&document.body?.classList.contains('bb-photo-meal-page'));await page.waitForTimeout(100);
 const frames=await samples(page,'failed-ios-navigation-polish');
 assert.deepEqual(frames.filter(frame=>frame.rawNav||frame.rawNavIcon||frame.legacyDashboard),[],'failed decoration never exposes raw navigation or the retired dashboard');
 assert.equal(await page.locator('#bb15AiPremiumHub').isVisible(),true,'a failed dock decorator does not block the healthy current workspace');
 assert.equal(await page.locator('#bbCookOpening').isVisible(),false);
 const back=page.locator('nav [data-bb-nav-item="plan"]');assert.equal(await back.isVisible(),true,'the existing Plan anchor remains reachable before the optional decorator');
 await page.route('**/index.html?bbview=week',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Plan recovery destination</title><p>Plan</p>'}));
 await back.click();await page.waitForURL('**/index.html?bbview=week');assert.equal(await page.title(),'Plan recovery destination');
}));


const firstPhoto={name:'first.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WZQAAAAASUVORK5CYII=','base64')};
test('Cook accepts a camera selection before controller hydration and delivers it once to the original handler',available,()=>fixture({holdController:true},async(page,{releaseController})=>{
 await page.waitForFunction(()=>document.body?.classList.contains('bb-photo-meal-page'));
 assert.equal(await page.locator('#bb15AiPremiumHub').isVisible(),true);
 assert.equal(await page.locator('#bbCookOpening').isVisible(),false);
 assert.equal(await page.locator('nav [data-bb-nav-item="cook"]').getAttribute('data-bb-nav-current'),'true');
 await page.locator('#ai-photo-input').setInputFiles(firstPhoto);
 assert.equal(await page.evaluate(()=>__photoObjectURLs),0,'presentation does not process or upload the file');
 releaseController();await page.waitForFunction(()=>document.documentElement.classList.contains('bb-cook-ready'));
 await page.waitForFunction(()=>document.getElementById('photoPreview').classList.contains('show'));
 assert.equal(await page.evaluate(()=>__photoObjectURLs),1,'exactly one original-handler photo preview');
 assert.match(await page.locator('#scanResults').textContent(),/Photo ready/);
 await page.locator('#ai-photo-input').setInputFiles({...firstPhoto,name:'second.png'});
 assert.equal(await page.evaluate(()=>__photoObjectURLs),2,'later native changes keep ordinary exactly-once delivery');
}));
for(const action of ['cancel','replace','account-change'])test('Cook drops a stale pre-hydration camera selection after '+action,available,()=>fixture({holdController:true},async(page,{releaseController})=>{
 await page.waitForFunction(()=>document.body?.classList.contains('bb-photo-meal-page'));
 await page.locator('#ai-photo-input').setInputFiles(firstPhoto);
 await page.evaluate(action=>{const input=document.getElementById('ai-photo-input');if(action==='cancel')input.dispatchEvent(new Event('cancel',{bubbles:true}));else if(action==='replace')input.replaceWith(input.cloneNode());else window.dispatchEvent(new Event('basketboss:session-changed'));},action);
 releaseController();await page.waitForFunction(()=>document.documentElement.classList.contains('bb-cook-ready'));
 await page.waitForTimeout(50);
 assert.equal(await page.evaluate(()=>__photoObjectURLs),0,'no obsolete photo event reaches the original handler');
 assert.equal(await page.locator('#photoPreview').evaluate(node=>node.classList.contains('show')),false);
 if(action==='cancel')assert.match(await page.locator('#scanResults').textContent(),/No photo selected/);
}));


test('a Cook controller runtime failure leaves real Retry and Plan actions instead of an inert photo workspace',available,()=>fixture({throwController:true},async page=>{
 await page.waitForLoadState('domcontentloaded');
 assert.equal(await page.getByRole('link',{name:'Try again',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('link',{name:'Back to Plan',exact:true}).isVisible(),true);
 assert.equal(await page.locator('#bb15AiPremiumHub').isVisible(),false);
 assert.equal(await page.locator('nav [data-bb-nav-item="plan"]').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('bb-cook-ready')),false,'presentation never fabricates controller readiness');
}));

for(const premium of [false,true])test('early Cook camera taps retain the original '+(premium?'verified-member native chooser':'Free membership gate'),available,()=>fixture({holdController:true},async(page,{releaseController})=>{
 await page.waitForFunction(()=>document.body?.classList.contains('bb-photo-meal-page'));
 let choosers=0;page.on('filechooser',()=>choosers++);
 if(premium){
  await page.evaluate(()=>{window.BasketBossVerifiedPremium={isActive:()=>true};});
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('label[for="ai-photo-input"]').click()]);
  await chooser.setFiles(firstPhoto);assert.equal(choosers,1);
  releaseController();await page.waitForFunction(()=>document.documentElement.classList.contains('bb-cook-ready'));
  await page.waitForFunction(()=>document.getElementById('photoPreview').classList.contains('show'));
  assert.equal(await page.evaluate(()=>__photoObjectURLs),1);
 }else{
  await page.locator('label[for="ai-photo-input"]').click();
  assert.equal(choosers,0,'original synchronous membership capture blocks native chooser');
  assert.equal(await page.locator('#bbPremiumDialog').evaluate(node=>node.open),true);
  assert.equal(await page.evaluate(()=>__photoObjectURLs),0);
 }
}));
