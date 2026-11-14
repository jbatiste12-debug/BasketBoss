import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const actor='00000000-0000-4000-8000-000000000064';
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// Observe the real planner, quantity projections and completion owner. All
// user mutations below use existing buttons or the public BBHome API.
const bridge=`window.__batchPlanQA={
 ready:()=>RECIPES.length===200&&window.BBHome&&window.BBShopOwnership?.enabled?.()&&['premium','free'].includes(window.BasketBossVerifiedPremium?.state?.()),
 snapshot:()=>JSON.parse(JSON.stringify({tab,planned:state.planned,manual:state.bbManualBatch,legacy:state.bb81Batch,servings:state.servings,dayServings:state.dayServings,stock:bb307ReadStock(),inventory:localStorage.getItem('basketboss_makeameal_v1_inventory')})),
 meals:day=>bbHomeDayMeals(day),
 ingredientCount:id=>getRecipe(id)?.ingredients?.length,
 async confirm(day){const actorId=BBHome.actor(),preview=BBHome.previewDay({day,actorId});if(!preview.ok)return preview;return BBHome.finishDay({day,actorId,expected:preview.fingerprint});}
};`;

async function fixture(width,{plans=[{recipeId:'chicken-burgers',day:'Monday',servings:4},{recipeId:'family-chicken-wraps',day:'Tuesday',servings:4}],stock={'chicken breast|g':1200},online=false,reviewRequired=false,premium=true}={}){
 const remote={stock:{...stock},revision:3,reviewRequired};const remoteProjection=()=>({ok:true,stock:{...remote.stock},scope:{kind:'user',id:actor},initialized:true,inventoryRevision:remote.revision,pantryReview:{required:remote.reviewRequired},inventory:[],essentials:[],receipts:[],priceObservations:[]});
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // Every request, including cloud saves and analytics, is fulfilled locally.
 // There is no route.continue and no opportunity for production writes.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:actor,email:'readable-shop@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/')){
   let data={ok:true};
   if(url.pathname==='/api/subscription/status')data={authenticated:true,tier:premium?'owner':'free',premium,premiumAccess:premium,mode:'live',subscription:null};
   else if(url.pathname==='/api/household')data={configured:false,premium:true,items:[]};
   else if(url.pathname==='/api/receipt-inventory'){
    if(!online)data={ok:true,configured:false,available:false};
    else if(url.searchParams.get('mode')==='status')data={ok:true,configured:true,available:true,premium:true};
    else if(route.request().method()==='POST'){
     const body=route.request().postDataJSON();
     if(body.expectedRevision!==remote.revision)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'inventory_revision_conflict'})});
     remote.stock={...body.stock};remote.revision++;remote.reviewRequired=false;data=remoteProjection();
    }else data=remoteProjection();
   }
   else if(url.pathname==='/api/shopping/weekly-trip')data={ok:true,allowed:true,premium:true};
   else if(url.pathname==='/api/recipes/v700/premium')return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Local fixture"}'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
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
 await context.addInitScript(({actor,plans,stock})=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(value){window.__readableShopCopy=String(value);}}});
  if(localStorage.getItem('readable-shop-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'readable-shop@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:plans,plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
  localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify(stock));
  const inventory={};
  for(const [id,qty]of Object.entries(stock)){
   const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1),loc=/rice|wrap/i.test(name)?'cupboard':/peas/i.test(name)?'freezer':'fridge';
   inventory[loc+'|'+name]={name,loc,selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty};
  }
  localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify(inventory));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('readable-shop-fixture-v1','1');
 },{actor,plans,stock});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__batchPlanQA?.ready());
 await page.waitForFunction(expected=>window.BasketBossVerifiedPremium?.state?.()===expected,premium?'premium':'free');
 if(online)await page.waitForFunction(()=>window.BBReceiptHost?.getProjection?.()?.initialized===true);
 return {page,context,errors};
}

const stock={'chicken breast|g':10000};
const snapshot=page=>page.evaluate(()=>window.__batchPlanQA.snapshot());
async function discoverBatch(page){
 await page.locator('.tabs button[data-tab="discover"]').click();
 await page.locator('#recipeSearch').fill('Sheet-pan chicken fajitas');
 await page.locator('[data-bb-manual-batch="fajitas"]').first().click();
 const dialog=page.locator('#bbManualBatchDialog');await dialog.waitFor();return dialog;
}
async function assertPair(page,sourceDay,leftoverDay){
 await page.waitForFunction(()=>document.body.dataset.bbnextView==='week');
 const source=page.locator('.bbnext-day[data-bbnext-day="'+sourceDay+'"]');
 const leftover=page.locator('.bbnext-day[data-bbnext-day="'+leftoverDay+'"]');
 assert.match(await source.locator('.bbnext-day-description>strong').innerText(),/Sheet-pan chicken fajitas/);
 assert.match(await source.locator('.bb81-batch-source-label').innerText(),new RegExp('Batch portion for '+leftoverDay));
 assert.equal(await source.locator('.bbnext-day-description .bbfeed-control').count(),1,'batch caption preserves the source day serving stepper');
 assert.equal(await source.locator('.bbnext-day-description .bbfeed-control button').count(),2);
 assert.equal(Number(await source.locator('.bbnext-meal-ingredients').getAttribute('data-bb-ingredient-count')),await page.evaluate(()=>window.__batchPlanQA.ingredientCount('fajitas')),'ingredient count comes from the full recipe, not its truncated summary');
 assert.equal(await leftover.evaluate(node=>node.classList.contains('has-meal')&&node.classList.contains('bb81-leftover-night')),true,'reserved batch day renders as a filled meal');
 assert.match(await leftover.locator('.bbnext-day-description>strong').innerText(),/Batch cook.*Sheet-pan chicken fajitas/);
 assert.match(await leftover.locator('.bbnext-day-description>small').first().innerText(),new RegExp('Batch-cooked on '+sourceDay));
 assert.notEqual(await leftover.locator('.bbnext-day-description').evaluate(node=>getComputedStyle(node,'::before').content),'"+"','linked batch day is not an empty add-dinner tile');
 assert.equal(await leftover.locator('[data-cook]').count(),0,'the reserved portion does not create another cook-and-deduct action');
 assert.equal(await leftover.getByRole('button',{name:'View '+sourceDay+' meal',exact:true}).count(),1);
 const saved=await snapshot(page);
 assert.equal(saved.planned.filter(slot=>slot.day===sourceDay&&slot.recipeId==='fajitas').length,1);
 assert.equal(saved.planned.some(slot=>slot.day===leftoverDay),false,'the reserved portion is a link rather than a second scaled recipe');
 assert.deepEqual(saved.manual.pairs.find(pair=>pair.sourceDay===sourceDay),{sourceDay,leftoverDay,recipeId:'fajitas'});
 const meals=await page.evaluate(day=>window.__batchPlanQA.meals(day),leftoverDay);
 assert.equal(meals.length,1);assert.equal(meals[0].kind,'leftover');assert.deepEqual(meals[0].ingredients,[]);
 return {source,leftover,saved};
}

for(const width of [390,402])test('Discover batch button saves and reveals both linked Plan days at '+width+'px',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(width,{plans:[],stock});
 try{
  const before=await snapshot(page),dialog=await discoverBatch(page);
  assert.deepEqual((await snapshot(page)).planned,[],'opening batch choices does not change the week');
  await dialog.getByRole('combobox').selectOption('Monday');
  await dialog.getByRole('button',{name:'Batch cook (2 days)'}).click();
  const pair=await assertPair(page,'Monday','Tuesday');
  assert.deepEqual(pair.saved.stock,before.stock);assert.equal(pair.saved.inventory,before.inventory);
  await pair.leftover.getByRole('button',{name:'View Monday meal',exact:true}).click();
  assert.equal(await pair.source.evaluate(node=>node.open),true);
  const persisted=await snapshot(page);await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__batchPlanQA?.ready());
  const reloaded=await assertPair(page,'Monday','Tuesday');
  assert.deepEqual(reloaded.saved.planned,persisted.planned);assert.deepEqual(reloaded.saved.manual,persisted.manual);
  assert.deepEqual(reloaded.saved.stock,before.stock);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('an existing three-person dinner retains its portions and only the source day deducts ingredients',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{plans:[{recipeId:'fajitas',day:'Wednesday',servings:3}],stock});
 try{
  const before=await snapshot(page),normal=await page.evaluate(()=>window.__batchPlanQA.meals('Wednesday'));
  const source=page.locator('.bbnext-day[data-bbnext-day="Wednesday"]');
  if(await page.evaluate(()=>!!window.BBPlanDaySheet)||!await source.evaluate(node=>node.open))await source.locator(':scope>summary .bbnext-day-description>strong').click();
  await source.locator('.bb-manual-batch-btn').click();
  const dialog=page.locator('#bbManualBatchDialog');assert.equal(await dialog.getByRole('combobox').inputValue(),'Wednesday');
  await dialog.getByRole('button',{name:'Batch cook (2 days)'}).click();
  const pair=await assertPair(page,'Wednesday','Thursday');
  assert.equal(pair.saved.planned.find(slot=>slot.day==='Wednesday').servings,3);
  assert.equal(await pair.source.locator('.bbnext-day-description .bbfeed-value').getAttribute('aria-label'),'3 people');
  assert.deepEqual(pair.saved.stock,before.stock);assert.deepEqual(pair.saved.dayServings,before.dayServings);
  const batch=await page.evaluate(()=>window.__batchPlanQA.meals('Wednesday'));
  assert.equal(batch[0].factor,normal[0].factor*2,'existing scaling projects one double batch at the saved portions');
  const confirmed=await page.evaluate(()=>window.__batchPlanQA.confirm('Wednesday'));assert.equal(confirmed.ok,true,confirmed.message);
  const cooked=await snapshot(page);assert.ok(cooked.stock['chicken breast|g']<before.stock['chicken breast|g']);
  const portion=await page.evaluate(()=>window.__batchPlanQA.confirm('Thursday'));assert.equal(portion.ok,true,portion.message);
  assert.deepEqual((await snapshot(page)).stock,cooked.stock,'confirming the reserved portion deducts nothing a second time');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('occupied batch days require explicit replacement consent and leave pantry stock alone',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{plans:[{recipeId:'sausage-gnocchi',day:'Tuesday',servings:2}],stock});
 try{
  const before=await snapshot(page),dialog=await discoverBatch(page);
  await dialog.getByRole('combobox').selectOption('Monday');
  await dialog.getByRole('button',{name:'Batch cook (2 days)'}).click();
  assert.match(await dialog.locator('[role="status"]').innerText(),/tick the replacement confirmation/);
  assert.deepEqual((await snapshot(page)).planned,before.planned);assert.deepEqual((await snapshot(page)).stock,before.stock);
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Batch cook (2 days)'}).click();
  const pair=await assertPair(page,'Monday','Tuesday');assert.equal(pair.saved.planned.length,1);
  assert.deepEqual(pair.saved.stock,before.stock);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('Free accounts cannot create batch links through the real recipe action',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{plans:[],stock,premium:false});
 try{
  const before=await snapshot(page);await page.locator('.tabs button[data-tab="discover"]').click();
  await page.locator('#recipeSearch').fill('Sheet-pan chicken fajitas');
  await page.locator('[data-bb-manual-batch="fajitas"]').first().click();
  assert.equal(await page.locator('#bbManualBatchDialog').count(),0);
  const after=await snapshot(page);assert.deepEqual(after.planned,before.planned);assert.deepEqual(after.manual,before.manual);
  assert.deepEqual(after.stock,before.stock);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});


for(const width of [390,320,768])test('day sheet preserves original actions and leaves Day done above the dock at '+width+'px',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(width,{plans:[{recipeId:'fajitas',day:'Monday',servings:4}],stock});
 try{
  await page.locator('.tabs button[data-tab="week"]').click();const day=page.locator('.bbnext-day[data-bbnext-day="Monday"]'),before=await snapshot(page);
  await day.evaluate(node=>{window.__originalDayControls=[...node.querySelectorAll('.bbnext-day-content button,.bbnext-day-content select')].map(control=>({control,parent:control.parentNode,click:control.onclick,change:control.onchange}));});
  await day.locator(':scope>summary .bbnext-day-description>strong').click();await day.locator('.bbdps-header').waitFor();
  assert.equal(await page.evaluate(()=>__originalDayControls.every(({control,parent,click,change})=>control.isConnected&&control.parentNode===parent&&control.onclick===click&&control.onchange===change)),true);
  assert.equal(await day.locator('.bbdps-ingredients').evaluate(node=>node.open),false);
  assert.equal(await day.locator('.bbdps-ingredients>summary').innerText(),'Ingredients ('+await page.evaluate(()=>__batchPlanQA.ingredientCount('fajitas'))+')');
  await day.locator('.bbdps-ingredients>summary').click();await day.locator('.bbdps-ingredients>summary').click();
  assert.equal(await day.locator('.bb-day-done-trigger').evaluate(node=>{node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'the dimmed dock cannot cover Day done');
  await day.locator('.bb-manual-batch-btn').click();const dialog=page.locator('#bbManualBatchDialog[open]');await dialog.waitFor();await dialog.getByRole('button',{name:/cancel|close/i}).first().click();
  assert.equal(await day.evaluate(node=>node.open),true,'nested action dismissal preserves the same day');
  await day.locator('.bbdps-close').click();assert.equal(await day.evaluate(node=>node.open),false);
  const after=await snapshot(page);assert.deepEqual(after.planned,before.planned);assert.deepEqual(after.stock,before.stock);assert.equal(after.inventory,before.inventory);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
