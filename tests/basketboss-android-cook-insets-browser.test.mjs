import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser,androidCSS;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 androidCSS=await fs.readFile(path.join(root,'native/android.css'),'utf8');
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

async function fixture(width,run,{platform='android',height=844}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<=600,hasTouch:width<=600,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // Reuse the real offline app/Cook fixture. Native CSS is loaded before the
 // application styles, matching the packaged Android document; all requests
 // stay local and every API request is rejected without production access.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let name=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(['app','app/','app.html','index.html','index',''].includes(name))name='pwa700/app.html';
  if(name.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body=await fs.readFile(path.join(root,name));
   if(name==='pwa700/app.html')body=body.toString().replace('<html lang="en">','<html lang="en" class="'+(platform==='web'?'':'bb-native-'+platform)+'">').replace('<head>','<head><style id="android-native-fixture">'+androidCSS+'</style>');
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(name)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
 });
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});await page.locator('.bbnext-day.has-meal').first().waitFor();
  const saved=await physical(page);assert.equal(await page.evaluate(()=>window.BBHomeHost.openCook('veggie-fried-rice')),true);await page.locator('.cook-overlay').waitFor({state:'visible'});
  await run(page,context);await page.locator('#bbExit').click();await page.locator('.cook-overlay').waitFor({state:'detached'});
  assert.deepEqual(await physical(page),saved,'opening and navigating Cook preserves all saved plan, servings and pantry bytes');assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
const physical=page=>page.evaluate(()=>Object.fromEntries(['basketboss_321_unified_state_v1','basketboss_321_features_v1','basketboss_321_v7_measured_pantry','basketboss_makeameal_v1_inventory'].map(key=>[key,localStorage.getItem(key)])));
const scroll=async(page,position)=>page.locator('.cook-panel.bb-kitchen').evaluate((node,position)=>{node.scrollTop=position==='end'?node.scrollHeight:position==='middle'?(node.scrollHeight-node.clientHeight)/2:0;return {actual:node.scrollTop,max:node.scrollHeight-node.clientHeight};},position);
const measure=page=>page.locator('.cook-panel.bb-kitchen').evaluate(panel=>{
 const rect=node=>node&&node.getBoundingClientRect().toJSON(),start=panel.querySelector('#bbStart'),controls=panel.querySelector('.bb-controls'),body=panel.querySelector('#bbBody');
 const buttons=[...(controls?.querySelectorAll('button')||[])],front=node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));};
 return {viewport:{width:innerWidth,height:innerHeight},panel:rect(panel),bodyPadding:parseFloat(getComputedStyle(body).paddingBottom),start:rect(start),startBottom:start&&getComputedStyle(start).bottom,startFront:start&&front(start),equipment:rect(panel.querySelector('#bbuiEquipment')),controls:rect(controls),controlsBottom:controls&&getComputedStyle(controls).bottom,controlsPadding:controls&&parseFloat(getComputedStyle(controls).paddingBottom),buttons:buttons.map(node=>({rect:rect(node),front:front(node)}))};
});

for(const width of [320,390,600])test('Android Cook actions clear injected 0/24/48px system insets throughout scrolling at '+width+'px',{skip:!chromium?'Playwright unavailable':false},()=>fixture(width,async(page,context)=>{
 const cdp=await context.newCDPSession(page),evidence=[],directory=path.join(process.env.BB_UI_SCREENSHOT_DIR||path.join(os.tmpdir(),'basketboss-ui-previews'),'android-cook-insets-'+width);await fs.mkdir(directory,{recursive:true});
 for(const bottom of [0,24,48])for(const envBottom of bottom===0?[0]:[0,bottom]){
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:envBottom}});await page.evaluate(bottom=>document.documentElement.style.setProperty('--safe-area-inset-bottom',bottom+'px'),bottom);
  const limit=844-bottom;
  for(const position of ['start','middle','end']){
   const range=await scroll(page,position),actual=await measure(page);evidence.push({phase:'prep',bottom,envBottom,position,range,actual});
   assert.ok(range.max>0,'the real ingredient/equipment list overflows and exercises sticky positioning');
   assert.equal(actual.startBottom,bottom+'px');assert.equal(actual.bodyPadding,20+bottom);
   assert.ok(actual.start.bottom<=limit+1,JSON.stringify({width,bottom,envBottom,position,actual}));assert.ok(actual.start.y>=0&&actual.start.height>=54);assert.equal(actual.startFront,true,'the existing Start action remains the top pointer target');
   assert.ok(actual.start.x>=0&&actual.start.right<=width+1,'the action stays within the unchanged card width');
   if(position==='end')assert.ok(actual.start.y-actual.equipment.bottom>=17,'the final equipment section keeps its existing 18px gap instead of being overlapped by the lifted sticky button');
   if(width===390&&bottom===48&&envBottom===0)await page.screenshot({path:path.join(directory,'prep-'+position+'.png')});
  }
  if(bottom===48&&envBottom===0){
   await scroll(page,'middle');await page.evaluate(()=>document.documentElement.classList.remove('bb-native-android'));const legacy=await measure(page);
   assert.ok(legacy.start.bottom>limit,'disabling the Android presentation scope reproduces the original button/system-navigation overlap');await page.evaluate(()=>document.documentElement.classList.add('bb-native-android'));
  }
 }
 // Use the original phase handlers. No cooking completion or pantry mutation
 // is performed; the next/back controls are measured in the real Cook phase.
 await page.locator('#bbStart').click();await page.waitForFunction(()=>document.querySelector('.cook-panel.bb-kitchen')?.dataset.phase==='cook');
 await page.locator('#bbTimerPanel').evaluate(node=>node.open=true);
 for(const bottom of [0,24,48])for(const envBottom of bottom===0?[0]:[0,bottom]){
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:envBottom}});await page.evaluate(bottom=>document.documentElement.style.setProperty('--safe-area-inset-bottom',bottom+'px'),bottom);
  for(const position of ['start','middle','end']){
   const range=await scroll(page,position),actual=await measure(page);evidence.push({phase:'cook',bottom,envBottom,position,range,actual});
   assert.equal(actual.controlsBottom,'0px');assert.equal(actual.controlsPadding,15+bottom);assert.equal(actual.bodyPadding,20+bottom);
   assert.ok(actual.buttons.length===2);for(const button of actual.buttons){assert.ok(button.rect.bottom<=844-bottom+1,'Back/Next stay above system navigation');assert.ok(button.rect.y>=0&&button.rect.height>=44,JSON.stringify({width,bottom,envBottom,position,actual}));assert.equal(button.front,true,'the original Back/Next buttons remain pointer targets');}
   if(width===390&&bottom===48&&envBottom===0)await page.screenshot({path:path.join(directory,'cook-'+position+'.png')});
  }
 }
 await fs.writeFile(path.join(directory,'geometry.json'),JSON.stringify(evidence,null,2));
}));

for(const scenario of [{width:601,platform:'android'},{width:1440,platform:'android'},{width:390,platform:'ios'},{width:390,platform:'web'}])test('Cook inset overrides leave '+scenario.platform+' at '+scenario.width+'px unchanged outside their mobile Android scope',{skip:!chromium?'Playwright unavailable':false},()=>fixture(scenario.width,async(page,context)=>{
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:24}});await page.evaluate(()=>document.documentElement.style.setProperty('--safe-area-inset-bottom','48px'));
 for(const phase of ['prep','cook']){
  if(phase==='cook'){await page.locator('#bbStart').click();await page.waitForFunction(()=>document.querySelector('.cook-panel.bb-kitchen')?.dataset.phase==='cook');}
  for(const position of ['start','middle','end']){
   await scroll(page,position);const active=await measure(page);await page.locator('#android-native-fixture').evaluate(node=>node.sheet.disabled=true);const baseline=await measure(page);
   assert.deepEqual(active,baseline,'loading Android native CSS cannot change Cook outside the targeted platform/mobile media scope');await page.locator('#android-native-fixture').evaluate(node=>node.sheet.disabled=false);
  }
 }
},{platform:scenario.platform}));
