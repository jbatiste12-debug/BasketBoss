import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {validatePublic700Release,transform700PreviewConfig,transform700Planning,transform700Html} from '../tools/catalogue700/build-client.mjs';
import {transform700MakeAMeal} from '../tools/catalogue700/make-a-meal.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const SESSION='basketboss_cloud_session_v1',STOCK='basketboss_321_v7_measured_pantry';
const ACTOR='00000000-0000-4000-8000-000000000001';
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});
function session(id=ACTOR){
 const expires=Math.floor(Date.now()/1000)+3600,encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 return {access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:id,exp:expires,aud:'authenticated',role:'authenticated'})+'.synthetic',refresh_token:'local-fixture-only',expires_at:expires,expires_in:3600,token_type:'bearer',user:{id,aud:'authenticated',role:'authenticated',email:'family@example.invalid',email_confirmed_at:'2026-11-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{}}};
}
async function fixture(){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
 const errors=[],calls=[];let remaining=1;
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await context.addInitScript(({key,value})=>{
  localStorage.setItem(key,JSON.stringify(value));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({complete:true}));
  localStorage.setItem('basketboss_onboarding_seen_v1','true');
  localStorage.setItem('basketboss_321_v7_market','UK');
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
 },{key:SESSION,value:session()});
 // Every request is fulfilled locally. No account, photograph, AI request or
 // checkout leaves this fixture; production credentials are never used.
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.hostname==='challenges.cloudflare.com')return route.fulfill({status:200,contentType:'application/javascript',body:'window.turnstile={render:function(_,options){this.options=options;queueMicrotask(()=>{window.__humanReady=true;options.callback("synthetic-human-check")});return 1},reset:function(){if(this.options)queueMicrotask(()=>this.options.callback("synthetic-human-check"))}};'});
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://basketboss.co.uk','X-Supabase-Api-Version':'2024-01-01','Access-Control-Expose-Headers':'X-Supabase-Api-Version'},body:JSON.stringify(url.pathname.endsWith('/user')?session().user:[])});
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/')){
   calls.push({path:url.pathname,method:request.method()});
   if(url.pathname==='/api/bb173/status')return json({status:remaining>0?'available':'disabled',premium_ai:false,food_scan_available:remaining>0,food_scan_remaining:remaining,food_scan_limit:2,food_scan_preview:true,turnstileRequired:true,siteKey:'0x4AAAA_fixture'});
   if(url.pathname==='/api/bb173/scan'){
    assert.equal(request.method(),'POST');const body=request.postDataJSON();assert.equal(body.scanKind,undefined);assert.ok(body.turnstileToken);assert.ok(body.imageBase64);
    if(remaining<=0)return json({error:'Free photo scan allowance reached'},429);
    remaining--;return json({ok:true,reviewRequired:true,aiGenerated:true,scan:{items:[{name:'Chicken breast',estimatedQuantity:'unknown',confidence:'high',notes:'Check the amount.'},{name:'Rice',estimatedQuantity:'unknown',confidence:'high',notes:'Check the amount.'}],caution:'Review before saving.'}});
   }
   if(url.pathname.includes('/recipes/'))return json({error:'Premium required'},403);
   if(url.pathname==='/api/subscription/status')return json({authenticated:true,tier:'free',premium:false,premiumAccess:false,subscription:null});
   if(url.pathname==='/api/receipt-inventory')return json({ok:true,configured:false,available:false});
   if(url.pathname==='/api/auth/apple-config')return json({available:false,nativeOnly:true,deletionReady:false});
   if(url.pathname==='/api/household')return json({configured:false,premium:false,items:[]});
   return json({ok:true});
  }
  let relative=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(relative==='app')relative='app.html';
  if(relative==='make-a-meal')relative='make-a-meal.html';
  if(relative.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;
   if(relative==='recipes.json')body=JSON.stringify(release.free);
   else try{body=await fs.readFile(path.join(root,relative));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',relative));}
   // Match the real PWA700 page and role dependency; no fake recipe renderer.
   if(relative==='app.html')body=transform700Presentation(transform700Html(body.toString(),release));
   else if(relative==='make-a-meal.html')body=body.toString().replace('</head>','<script src="bb-recipe-planning.js"></script></head>');
   else if(relative==='make-a-meal.js')body=transform700MakeAMeal(body.toString(),release);
   else if(relative==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
   else if(relative==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
   else if(relative.endsWith('.js'))body=transform700Presentation(body.toString());
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
   return route.fulfill({status:200,contentType:types[path.extname(relative)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 // Let the real application's persistence owner initialise the plan. The
 // companion never receives a made-up empty planner in this test.
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(actor=>!!window.BBPhotoOnboardingHost?.preparePlan&&window.BBHome?.actor?.()===actor,ACTOR);
 assert.equal(await page.evaluate(()=>window.BBPhotoOnboardingHost.preparePlan()),true);
 assert.equal(await page.evaluate(()=>Array.isArray(JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')||'null')?.planned)),true);
 await page.goto('https://basketboss.co.uk/make-a-meal.html?bbscan=pantry&location=fridge',{waitUntil:'domcontentloaded'});
 await page.locator('#aiScanner').waitFor({state:'visible'});
 await page.waitForFunction(()=>window.BBFoodScanAccess?.state?.()==='available'&&window.__humanReady===true);
 return {context,page,errors,calls};
}
async function scan(h){
 // Handoff deliberately removes bbscan from the URL. A real label click must
 // still open the picker, not redirect back to this page in an endless loop.
 const [chooser]=await Promise.all([h.page.waitForEvent('filechooser'),h.page.locator('label[for="ai-photo-input"]').click()]);
 await chooser.setFiles(path.join(root,'icons/basketboss-crowned-v1766-192.png'));
 await h.page.locator('#scanBtn').click();
 await h.page.locator('#reviewFoods').waitFor();
 assert.equal(h.calls.filter(call=>call.path==='/api/bb173/scan').length,1);
 const row=h.page.locator('.scan-result-row').first();
 await row.locator('[name="food"]').check();
 await row.locator('[data-scan-quantity]').fill('400');
 await row.locator('[data-scan-unit]').selectOption('g');
 await row.locator('[data-scan-location]').selectOption('fridge');
}
test('the final free scan remains saveable and reveals usable real catalogue matches',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const h=await fixture();
 try{
  await scan(h);await h.page.locator('#reviewFoods button[type="submit"]').click();
  await h.page.waitForFunction(()=>document.getElementById('scanResults')?.textContent?.includes('Your reviewed foods were saved'));
  assert.match(await h.page.locator('#scanResults').innerText(),/matching catalogue recipes/);
  const stock=await h.page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),STOCK);assert.equal(stock['chicken breast|g'],400);
  assert.equal(await h.page.locator('#bbRecipesDrawer').evaluate(node=>node.open),true);
  assert.ok(await h.page.locator('#recipes [data-plan]').count()>0);
  assert.equal(await h.page.locator('#recipes [data-plan]').first().isVisible(),true,'recipe actions are visibly rendered');
  assert.equal(await h.page.locator('#bb82MealWorkspace').isVisible(),true);
  assert.equal(await h.page.locator('#bbToolStage').evaluate(node=>node.classList.contains('bb-ai-native-visible')),false,'the scanner cannot cover catalogue actions');
  await h.page.locator('#recipes [data-plan]').first().click();await h.page.locator('#mealReview').waitFor({state:'visible'});
  assert.equal(h.calls.some(call=>/generate|meal-image|checkout/.test(call.path)),false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
test('manual food entry opens a visible workspace without uploading a photo',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const h=await fixture();
 try{
  await h.page.locator('#bbScanManual').click();
  assert.equal(await h.page.locator('#bb82MealWorkspace').isVisible(),true);
  assert.equal(await h.page.locator('[data-add-area] [data-food-name]').first().isVisible(),true,'the original manual form is reachable');
  assert.equal(h.calls.some(call=>/\/scan$|generate|meal-image|checkout/.test(call.path)),false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
test('changing account after scanning cannot save the prior account photo review',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const h=await fixture();
 try{
  await scan(h);const before=await h.page.evaluate(key=>localStorage.getItem(key),STOCK);
  await h.page.evaluate(({key,value})=>{localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event('basketboss:session-changed'));},{key:SESSION,value:session('00000000-0000-4000-8000-000000000002')});
  await h.page.evaluate(()=>document.querySelector('#reviewFoods')?.requestSubmit());
  assert.equal(await h.page.evaluate(key=>localStorage.getItem(key),STOCK),before);
  assert.equal(h.calls.some(call=>/generate|meal-image|checkout/.test(call.path)),false);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
