import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const ONBOARDING='bb_onboarding_fresh_once_20261028_v1';
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// Expose reads from the original application's closure. The generated 700 app,
// catalogue, persistence, household setters and price engine all remain real.
const bridge=`window.__onboardingQA={
 ready:()=>RECIPES.length===200&&typeof window.BasketBossSetOnboardingServings==='function'&&typeof window.BasketBossSetOnboardingMealPreferences==='function',
 state:()=>JSON.parse(JSON.stringify(state)),
 stock:()=>bb307ReadStock(),
 market:()=>bb307Market,
};`;

async function fixture({width=390,height=844,onboarding}={}){
 const source=await fs.readFile(path.join(root,'app.html'),'utf8'),anchor='window.BBHomeHost=Object.freeze({';
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 assert.match(app,/<meta name="basketboss-onboarding" content="quick-v1">/,'the current generated document opts into the quick flow');
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[],network=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // Fulfil every request locally, including auth, billing and analytics. There
 // is no route.continue and the Premium destination cannot create a checkout.
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  network.push({host:url.hostname,path:url.pathname,method:request.method()});
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{user:null}:[])});
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/')){
   let data={ok:true};
   if(url.pathname==='/api/subscription/status')data={authenticated:false,tier:'free',premium:false,premiumAccess:false,subscription:null};
   else if(url.pathname==='/api/household')data={configured:false,premium:false,items:[]};
   else if(url.pathname==='/api/receipt-inventory')data={ok:true,configured:false,available:false};
   else if(url.pathname==='/api/recipes/v700/premium')return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Local guest fixture"}'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.pathname==='/pricing-sandbox.html')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Existing Premium plans destination</title><p>Premium navigation captured locally.</p>'});
  let relative=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(['app','app.html','index','index.html',''].includes(relative))relative='app.html';
  if(relative.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;
   if(relative==='app.html')body=app;
   else{
    try{body=await fs.readFile(path.join(root,relative));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',relative));}
    if(relative==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(relative==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(relative.endsWith('.js'))body=transform700Presentation(body.toString());
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(relative)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(({onboarding,key})=>{
  if(!localStorage.getItem('quick-onboarding-fixture-v1')){
   localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:3},{recipeId:'sausage-gnocchi',day:'Friday'}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{Rice:true},mealPreferences:{version:1,scope:'guest',diets:[],goals:[]}}));
   localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify({'rice|g':300,'pork sausages|each':5}));
   localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify({'cupboard|rice':{name:'Rice',loc:'cupboard',selected:true,qty:300,unit:'g',bb173StockKey:'rice|g',bb173StockValue:300}}));
   localStorage.setItem('basketboss_321_v7_market','UK');
   localStorage.setItem('basketboss_v172_weekly_budget_target_v1','150');
   localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
   sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
   if(onboarding)localStorage.setItem(key,JSON.stringify(onboarding));
   localStorage.setItem('quick-onboarding-fixture-v1','1');
  }
  window.__onboardingStorageWrites=[];
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(this===localStorage)window.__onboardingStorageWrites.push({key,value:String(value)});return original.apply(this,arguments);};
 },{onboarding,key:ONBOARDING});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__onboardingQA?.ready());
 await page.evaluate(()=>{
  window.__onboardingQA.calls=[];
  for(const name of ['BasketBossSetOnboardingServings','BasketBossSetOnboardingMealPreferences','bb307SwitchIsland']){
   const original=window[name];
   window[name]=function(...args){window.__onboardingQA.calls.push({name,args});return original.apply(this,args);};
  }
 });
 return {page,context,errors,network};
}

async function snapshot(page){return page.evaluate(()=>({state:window.__onboardingQA.state(),stock:window.__onboardingQA.stock(),inventory:localStorage.getItem('basketboss_makeameal_v1_inventory'),market:window.__onboardingQA.market(),session:localStorage.getItem('basketboss_cloud_session_v1')}));}
async function assertStep(page,step){
 const host=page.locator('#bbNewOnboarding.bbob-quick');await host.waitFor();
 assert.equal(await host.locator('.bbob-quick-progress').getAttribute('aria-label'),`Setup step ${step} of 3`);
 assert.doesNotMatch(await host.innerText(),/\bof 11\b|Optional tour/,'the current flow never exposes the old eleven-screen tutorial');
 assert.equal(await host.locator('.bbob-stepname,.bbob-progress').count(),0);
 assert.equal(await host.locator('.bbob-exit').isVisible(),true,'Free is available on every screen');
 assert.equal(await host.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(250, 248, 241)','setup shares the BasketBoss cream background');
 assert.equal(await host.locator('.bbob-primary').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(23, 63, 48)','the primary action uses the BasketBoss forest colour');
 await assertActionsInViewport(page);
 return host;
}
async function assertActionsInViewport(page){
 const buttons=page.locator('#bbNewOnboarding .bbob-footer button');
 for(const button of await buttons.all()){
  const box=await button.boundingBox(),view=page.viewportSize();assert.ok(box,`action ${await button.textContent()} is visible`);
  assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=view.width+1&&box.y+box.height<=view.height+1,`action ${await button.textContent()} stays within ${view.width}×${view.height}`);
 }
 const overflow=await page.locator('#bbNewOnboarding').evaluate(node=>node.scrollWidth>node.clientWidth+1);
 assert.equal(overflow,false,'onboarding has no horizontal overflow');
}
function assertPreserved(before,after){
 for(const field of ['planned','plannedBreakfasts','plannedDesserts','pantry','mealServings','dayServings','leftoverSources','leftoverConfirmed'])assert.deepEqual(after.state[field],before.state[field],`${field} is untouched by setup`);
 assert.deepEqual(after.stock,before.stock,'physical pantry amounts are untouched');
 assert.equal(after.inventory,before.inventory,'inventory contents are untouched');
 assert.equal(after.session,before.session,'setup does not write an authentication session');
}
async function assertNoCheckoutOrEntitlement(page,network){
 assert.deepEqual(billingRequests(network),[],'setup creates no checkout or purchase request');
 assert.equal(network.some(request=>/\/auth\/v1\/(signup|token)/.test(request.path)),false,'guest setup never signs up or signs in');
 const writes=await page.evaluate(()=>window.__onboardingStorageWrites.filter(entry=>/entitlement|membership|subscription|premium_(active|access|tier|until)/i.test(entry.key)));
 assert.deepEqual(writes,[],'setup cannot grant a local Premium entitlement');
}
// The actual app loads bb-reduced-purchases.js; serving that source asset is
// unrelated to initiating a purchase. Check billing APIs and remote mutations.
const billingRequests=network=>network.filter(request=>/\/api\/.*(?:checkout|transaction|purchase|billing)/i.test(request.path)||(request.host.includes('paddle')&&!['GET','HEAD'].includes(request.method)));

for(const viewport of [{width:320,height:700},{width:390,height:844},{width:844,height:400}])test(`generated 700 quick setup preserves drafts and finishes Free once at ${viewport.width}×${viewport.height}`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors,network}=await fixture(viewport);
 try{
  const original=await snapshot(page);let host=await assertStep(page,1);
  assert.equal(await host.locator('[data-bbob-account]').evaluate(node=>node.open),false,'sign-in starts optional and collapsed');
  assert.match(await host.innerText(),/No subscription or account needed/);
  assert.match(await host.innerText(),/200 free recipes/,'the current generated release advertises its actual Free catalogue');
  assert.doesNotMatch(await host.innerText(),/\b100\b/,'the current release never shows the legacy Free recipe count');
  assert.equal(await host.locator('#bbob-title').evaluate(node=>getComputedStyle(node).outlineStyle),'none','programmatic heading focus does not draw clipped outline rules');
  await host.locator('[data-bbob-account]>summary').click();
  assert.equal(await host.locator('#cloud-auth #cloud-login').count(),1,'the existing sign-in control is reused');
  assert.equal(await host.locator('#cloud-auth #cloud-signup').count(),1,'the existing create-account control remains available');
  await host.locator('#cloud-email').fill('returning@example.invalid');
  await host.locator('#cloud-password').fill('existing-account-password');
  await host.locator('[data-bbob="next"]').click();host=await assertStep(page,2);
  await host.locator('[data-bbob-group="house"][data-bbob-opt="3"]').click();
  await host.locator('#bbob-region').selectOption('US');
  await host.locator('[data-bbob-preferences]>summary').click();
  await host.locator('[data-bbob-group="diets"]').filter({hasText:'Vegetarian'}).click();
  await host.locator('[data-bbob-group="goals"]').filter({hasText:'Waste less food'}).click();
  assert.deepEqual(await snapshot(page),original,'selecting choices only saves the onboarding draft');
  await host.locator('[data-bbob="back"]').click();host=await assertStep(page,1);
  assert.equal(await host.locator('#cloud-email').inputValue(),'returning@example.invalid','Back restores the original auth form with its draft');
  assert.equal(await host.locator('#cloud-password').inputValue(),'existing-account-password');
  await host.locator('[data-bbob="next"]').click();host=await assertStep(page,2);
  assert.equal(await host.locator('[data-bbob-group="house"][data-bbob-opt="3"]').getAttribute('aria-pressed'),'true');
  assert.equal(await host.locator('#bbob-region').inputValue(),'US');
  assert.equal(await host.locator('[data-bbob-group="diets"]').filter({hasText:'Vegetarian'}).getAttribute('aria-pressed'),'true');
  assert.equal(await host.locator('[data-bbob-group="goals"]').filter({hasText:'Waste less food'}).getAttribute('aria-pressed'),'true');
  await host.locator('[data-bbob="next"]').click();host=await assertStep(page,3);
  assert.equal(await host.getByRole('button',{name:'See Premium plans',exact:true}).isVisible(),true);
  assert.equal(await host.getByRole('button',{name:'Continue with BasketBoss Free',exact:true}).last().isVisible(),true);
  assert.match(await host.innerText(),/700 recipes/);
  await host.locator('[data-bbob="back"]').click();host=await assertStep(page,2);
  assert.equal(await host.locator('#bbob-region').inputValue(),'US','Back from Premium preserves household setup');
  await host.locator('[data-bbob="next"]').click();host=await assertStep(page,3);
  await host.locator('[data-bbob="free-complete"]').click();await host.waitFor({state:'detached'});
  const result=await snapshot(page);assertPreserved(original,result);
  assert.equal(result.state.servings,5,'the original household setter saves selected portions');
  assert.equal(result.market,'US','the original market setter saves the selected region');
  assert.deepEqual(result.state.mealPreferences,{version:1,scope:'guest',diets:['Vegetarian'],goals:['Waste less food']});
  assert.deepEqual(await page.evaluate(()=>window.__onboardingQA.calls.map(call=>call.name)),['BasketBossSetOnboardingServings','bb307SwitchIsland','BasketBossSetOnboardingMealPreferences'],'each original preference setter runs once, on completion');
  const completion=await page.evaluate(key=>({saved:JSON.parse(localStorage.getItem(key)),writes:window.__onboardingStorageWrites.filter(entry=>entry.key===key&&JSON.parse(entry.value).complete===true).length}),ONBOARDING);
  assert.equal(completion.saved.complete,true);assert.equal(completion.saved.started,false);assert.equal(completion.writes,1);
  await assertNoCheckoutOrEntitlement(page,network);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__onboardingQA?.ready());
  assert.equal(await page.locator('#bbNewOnboarding').count(),0,'completed users do not see setup again');
  assertPreserved(original,await snapshot(page));
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('generated 700 resumes a legacy incomplete tutorial at Premium without losing chosen preferences',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const legacy={step:7,complete:false,started:true,house:'2 people',region:'Jersey',diets:['Dairy-free'],goals:['Plan dinners faster'],wantsPartnerInvite:true,partnerIntent:'invite'};
 const {page,context,errors,network}=await fixture({onboarding:legacy});
 try{
  const original=await snapshot(page);let host=await assertStep(page,3);
  assert.deepEqual(await page.evaluate(()=>window.BBOnboard2026.getPreferences()),{house:'2 people',region:'Jersey',diets:['Dairy-free'],goals:['Plan dinners faster']});
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),ONBOARDING);assert.equal(saved.step,10);assert.equal(saved.wantsPartnerInvite,true);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__onboardingQA?.ready());host=await assertStep(page,3);
  await host.locator('[data-bbob="back"]').click();host=await assertStep(page,2);
  assert.equal(await host.locator('[data-bbob-group="house"][data-bbob-opt="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(await host.locator('#bbob-region').inputValue(),'Jersey');
  await host.locator('[data-bbob="next"]').click();host=await assertStep(page,3);
  await host.locator('[data-bbob="free-complete"]').click();await host.waitFor({state:'detached'});
  const result=await snapshot(page);assertPreserved(original,result);assert.equal(result.state.servings,2);assert.equal(result.market,'Jersey');
  assert.deepEqual(result.state.mealPreferences.diets,['Dairy-free']);assert.deepEqual(result.state.mealPreferences.goals,['Plan dinners faster']);
  await assertNoCheckoutOrEntitlement(page,network);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('generated 700 skips optional setup without applying its abandoned choices',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors,network}=await fixture();
 try{
  const original=await snapshot(page);let host=await assertStep(page,1);
  await host.locator('[data-bbob="next"]').click();host=await assertStep(page,2);
  await host.locator('[data-bbob-group="house"][data-bbob-opt="0"]').click();await host.locator('#bbob-region').selectOption('Guernsey');
  await host.locator('[data-bbob="skip"]').click();host=await assertStep(page,3);
  await host.locator('[data-bbob="free-complete"]').click();await host.waitFor({state:'detached'});
  assert.deepEqual(await snapshot(page),original,'Skip keeps existing household, meal preferences, region, plan and pantry');
  assert.deepEqual(await page.evaluate(()=>window.__onboardingQA.calls),[]);
  await assertNoCheckoutOrEntitlement(page,network);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('generated 700 offers the existing Premium page after saving setup without creating a purchase',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors,network}=await fixture();
 try{
  let host=await assertStep(page,1);await host.locator('[data-bbob="next"]').click();host=await assertStep(page,2);
  await host.locator('[data-bbob-group="house"][data-bbob-opt="1"]').click();await host.locator('#bbob-region').selectOption('Jersey');
  await host.locator('[data-bbob="next"]').click();host=await assertStep(page,3);
  await Promise.all([page.waitForURL('**/pricing-sandbox.html#monthly'),host.locator('[data-bbob="quick-premium"]').click()]);
  const result=await page.evaluate(key=>({onboarding:JSON.parse(localStorage.getItem(key)),state:JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')),market:localStorage.getItem('basketboss_321_v7_market'),session:localStorage.getItem('basketboss_cloud_session_v1')}),ONBOARDING);
  assert.equal(result.onboarding.complete,true);assert.equal(result.state.servings,2);assert.equal(result.market,'Jersey');assert.equal(result.session,null);
  assert.deepEqual(billingRequests(network),[],'opening the existing plans page cannot charge the guest');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('native keyboard smoke identifiers open the real optional account disclosure in generated 700 setup',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const swift=await fs.readFile(path.join(root,'ios/App/App/AppDelegate.swift'),'utf8');
 const start=swift.indexOf('const identifyControls=()=>{'),end=swift.indexOf('const check=setInterval',start);
 assert.ok(start>=0&&end>start,'the real Debug simulator keyboard helper is available');
 const identifyControls=swift.slice(start,end);
 const {page,context,errors,network}=await fixture();
 try{
  let host=await assertStep(page,1);
  // Execute the helper extracted from AppDelegate's raw JavaScript, keeping
  // its exact selectors, accessible names and disclosure role adaptation.
  await page.evaluate(identifyControls+'\nidentifyControls();');
  const next=host.getByRole('button',{name:'bbobNext',exact:true});
  assert.equal(await next.evaluate(node=>node.tagName),'SUMMARY','the native smoke tap addresses the account disclosure');
  await next.click();host=await assertStep(page,1);
  assert.equal(await host.locator('[data-bbob-account]').evaluate(node=>node.open),true);
  assert.equal(await host.locator('#cloud-auth #cloud-email').isVisible(),true,'the original email field is available to the native keyboard test');
  assert.equal(await host.locator('#cloud-auth #cloud-password').isVisible(),true,'the original password field is available to the native keyboard test');
  const continueSetup=host.getByRole('button',{name:'Continue without signing in',exact:true});
  assert.equal(await continueSetup.getAttribute('data-bbob'),'next','the real setup action keeps its existing handler');
  assert.equal(await continueSetup.getAttribute('aria-label'),null,'the account identifier does not replace the setup action label');
  await continueSetup.click();await assertStep(page,2);
  await assertNoCheckoutOrEntitlement(page,network);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
