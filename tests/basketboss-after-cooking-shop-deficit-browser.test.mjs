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

// This bridge exposes real private application functions, without replacing
// shopping, recipe quantities, stock reconciliation, or completion behavior.
const bridge=`window.__stockDeficitQA={
 ready:()=>RECIPES.length===200&&window.BBWeeklyShop&&window.BBHome&&window.BBShopPurchaseUI?.createPicker&&window.BBShopOwnership?.enabled?.(),
 openShop(){bb172StorefrontClose();bb172ShopSetActive(false);tab='shop';render();return window.BBWeeklyShop.start();},
 home(){bb172StorefrontClose();bb172ShopSetActive(false);tab='shop';render();},
 plan(){bb172StorefrontClose();bb172ShopSetActive(false);tab='week';render();},
 planned:()=>state.planned,summary:()=>bb321WeeklySummary(),stock:()=>bb307ReadStock(),canonicalStock:()=>BBPantryDeduction.stockData(bb307ReadStock(),BB307Pantry.pantryId).values,
 addTuesday(){state.planned.push({recipeId:'family-chicken-wraps',day:'Tuesday',servings:4});persist();render();},
 diagnostics(){return {physical:bbHomePhysicalStock(),available:bbBetaStockForCurrentWeek(bbHomePhysicalStock()),review:bbReceiptPantryReviewRequired(),summary:bb321WeeklySummary().items.filter(r=>/chicken/i.test(r.key)),session:bbShopV7Session(),purchases:bb84ReadPurchased(),receipts:bb83ReadObject(BB_BETA_RECEIPT_KEY)};}
};`;

async function fixture(width,{plans=[{recipeId:'chicken-burgers',day:'Monday',servings:4},{recipeId:'family-chicken-wraps',day:'Tuesday',servings:4}],stock={'chicken breast|g':1200},online=false,reviewRequired=false}={}){
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
   if(url.pathname==='/api/subscription/status')data={authenticated:true,tier:'owner',premium:true,premiumAccess:true,mode:'live',subscription:null};
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
 await page.waitForFunction(()=>window.__stockDeficitQA?.ready());
 if(online)await page.waitForFunction(()=>window.BBReceiptHost?.getProjection?.()?.initialized===true);
 return {page,context,errors};
}


async function confirmMonday(page){
 await page.evaluate(()=>window.__stockDeficitQA.plan());
 assert.equal((await page.evaluate(()=>window.BBDayDone.quickComplete('Monday'))).ok,true);
 const dialog=page.locator('.bb-day-done-dialog');await dialog.getByRole('button',{name:'Confirm & update pantry',exact:true}).click();
 await page.waitForFunction(()=>Math.abs(window.__stockDeficitQA.canonicalStock()['chicken breast|g']-533.333333)<1e-6);
 if(await dialog.count())await dialog.locator('[data-bb-day-action=close]').click();
}
async function assertTuesday(page){
 await page.evaluate(()=>window.__stockDeficitQA.home());await page.locator('[data-bbpi-storage=fridge]').click();
 const home=page.locator('.bbpi-summary-row').filter({hasText:/chicken breast/i});await home.waitFor();assert.match(await home.innerText(),/533\s*g/);
 await page.evaluate(()=>window.__stockDeficitQA.openShop());const shell=page.locator('#bb172Storefront');await shell.waitFor();
 const row=shell.locator('[data-bb-shop-purchase-id="chicken breast|g"]');await row.locator('.bb-shop-buying-pill').waitFor();
 const diagnostic=await page.evaluate(()=>window.__stockDeficitQA.diagnostics());
 const item=diagnostic.summary.find(r=>r.key==='chicken breast');
 assert.equal(item.required,600,JSON.stringify(diagnostic));
 assert.equal(item.pantryUsed,533.333333,JSON.stringify(diagnostic));assert.equal(item.toBuy,66.666667);
 assert.match(await row.innerText(),/Have 533 g at home/);assert.match(await row.locator('.bbcompact-qty').innerText(),/67 g needed/);
 assert.match(await row.locator('.bbcompact-price').innerText(),/£0\.68/);
 assert.match(await row.locator('.bb-shop-buying-pill').innerText(),/Buying: 67 g/,'a small pantry top-up uses the precise deficit for its buying suggestion');
}

test('Monday Day done leaves precise chicken stock available for Tuesday without refreshing the app',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390);
 try{await page.evaluate(()=>window.__stockDeficitQA.summary());await confirmMonday(page);await assertTuesday(page);assert.deepEqual(errors,[]);}finally{await context.close();}
});

test('a current-trip purchase consumed on Monday cannot hide the live remainder from Tuesday',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{plans:[{recipeId:'chicken-burgers',day:'Monday',servings:4}],stock:{}});
 try{
  await page.evaluate(()=>window.__stockDeficitQA.openShop());const shell=page.locator('#bb172Storefront'),row=shell.locator('[data-bb-shop-purchase-id="chicken breast|g"]');await row.locator('.bb-shop-buying-pill').click();
  await row.locator('[data-bb-pack-preset=custom]').click();await row.locator('[data-bb-pack-custom]').fill('1200');await row.locator('.bb-shop-pack-save').click();await row.locator('.bb172-storefront-checkbox').click();
  await page.waitForFunction(()=>window.__stockDeficitQA.stock()['chicken breast|g']===1200);
  await confirmMonday(page);await page.evaluate(()=>window.__stockDeficitQA.addTuesday());await assertTuesday(page);
  await page.locator('#bb172Storefront [data-bb-shop-purchase-id="chicken breast|g"] .bb172-storefront-checkbox').click();
  await page.waitForFunction(()=>Math.abs(window.__stockDeficitQA.stock()['chicken breast|g']-600.333333)<1e-8);
  const purchase=await page.evaluate(()=>window.__stockDeficitQA.diagnostics().purchases['chicken breast|g']);assert.equal(purchase.actualQty,67);
  await page.evaluate(()=>window.__stockDeficitQA.openShop());await page.locator('#bb172Storefront').getByRole('button',{name:'All items',exact:true}).click();
  const nextRow=page.locator('#bb172Storefront [data-bb-shop-purchase-id="chicken breast|g"]');
  await nextRow.locator('.bb172-storefront-checkbox').click();await page.waitForFunction(()=>Math.abs(window.__stockDeficitQA.stock()['chicken breast|g']-533.333333)<1e-8);
  await nextRow.locator('.bb172-storefront-checkbox').click();await page.waitForFunction(()=>Math.abs(window.__stockDeficitQA.stock()['chicken breast|g']-600.333333)<1e-8);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});


test('a routine saved-stock review after online Day done does not hide the trusted remaining pantry',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{online:true,reviewRequired:true});
 try{
  assert.equal(await page.evaluate(()=>BBReceiptHost.requiresPantryReview()),true);
  assert.equal(await page.evaluate(()=>BBReceiptHost.getConsumptionStatus().ready),true);
  await page.evaluate(()=>window.__stockDeficitQA.openShop());
  const before=await page.evaluate(()=>window.__stockDeficitQA.summary().items.find(r=>r.key==='chicken breast'));
  assert.equal(before.required,1266.666667);assert.equal(before.pantryUsed,1200);
  await confirmMonday(page);await page.waitForFunction(()=>BBReceiptHost.getConsumptionStatus().ready);
  assert.equal(await page.evaluate(()=>BBReceiptHost.requiresPantryReview()),true,'a routine reminder is retained without hiding confirmed stock');
  await assertTuesday(page);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});


test('Plan offers pantry-first and fresh modes without changing stock or existing meals before confirmation',{skip:!chromium&&'Playwright unavailable',timeout:90000},async()=>{
 const stock={'chicken breast|g':533.333333,'rice|g':500,'peas|g':250,'water|ml':0};
 const plans=[{recipeId:'sausage-gnocchi',day:'Wednesday',servings:4}];
 const {page,context,errors}=await fixture(390,{plans,stock});
 try{
  await page.evaluate(()=>window.__stockDeficitQA.plan());
  const modes=page.locator('.bb-pantry-first-controls');await modes.waitFor();
  const before=await page.evaluate(()=>({stock:__stockDeficitQA.stock(),planned:__stockDeficitQA.planned()}));
  await page.evaluate(()=>{
   const actual=window.BBPantryAutofill;window.__pantryFirstTrace=[];
   window.BBPantryAutofill={...actual,create(options){
    const ledger=actual.create(options),record={mode:options.scoringMode,stock:ledger.snapshot(),choices:[]};window.__pantryFirstTrace.push(record);let candidates=[];
    return {...ledger,assess(rows,context){const result=ledger.assess(rows,context);candidates.push({rows,percent:result.availabilityPercent||0,coverage:result.quantityCoverage||0});return result;},reserve(rows,context){
     if(candidates.length){const selected=candidates.find(x=>x.rows===rows),max=Math.max(...candidates.map(x=>x.percent)),coverage=Math.max(...candidates.filter(x=>x.percent===max).map(x=>x.coverage));record.choices.push({selected:selected?.percent,max,coverage:selected?.coverage,maxCoverage:coverage});candidates=[];}
     return ledger.reserve(rows,context);
    }};
   }};
  });
  assert.equal(await modes.locator('[data-bb-pantry-first-mode="pantry-first"]').getAttribute('aria-pressed'),'true');
  await page.locator('#bb172FillSixDinners').click();const confirm=page.locator('#bbQaConfirmOverlay');await confirm.waitFor();
  const pantry=await page.evaluate(()=>window.__pantryFirstTrace[0]);assert.equal(pantry.mode,'pantry-first');assert.equal(pantry.stock['chicken breast|g'],533.333333);assert.equal(pantry.stock['rice|g'],500);assert.equal(pantry.stock['peas|g'],250);assert.equal(Object.hasOwn(pantry.stock,'water|ml'),false);
  assert.ok(pantry.choices.length);for(const choice of pantry.choices){assert.equal(choice.selected,choice.max);assert.equal(choice.coverage,choice.maxCoverage);}
  assert.deepEqual(await page.evaluate(()=>({stock:__stockDeficitQA.stock(),planned:__stockDeficitQA.planned()})),before);
  await confirm.getByRole('button',{name:'Keep my week',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#bb172FillSixDinners')?.disabled);
  await modes.locator('[data-bb-pantry-first-mode="fresh"]').click();await page.locator('#bb172FillSixDinners').click();await confirm.waitFor();
  const fresh=await page.evaluate(()=>window.__pantryFirstTrace.find(record=>record.mode!=='pantry-first'));assert.ok(fresh);assert.deepEqual(fresh.stock,{});
  await confirm.getByRole('button',{name:'Keep my week',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>({stock:__stockDeficitQA.stock(),planned:__stockDeficitQA.planned()})),before);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});


test('Start next week saves the current plan and keeps real post-cooking pantry balances',{skip:!chromium&&'Playwright unavailable',timeout:90000},async()=>{
 const {page,context,errors}=await fixture(390,{online:true,reviewRequired:true});
 try{
  await confirmMonday(page);await page.waitForFunction(()=>BBReceiptHost.getConsumptionStatus().ready);
  assert.equal(await page.evaluate(()=>BBReceiptHost.requiresPantryReview()),true);
  const before=await page.evaluate(()=>({stock:localStorage.getItem('basketboss_321_v7_measured_pantry'),inventory:localStorage.getItem('basketboss_makeameal_v1_inventory'),planned:__stockDeficitQA.planned(),generation:JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')).pantryPlanGeneration,cooked:JSON.parse(localStorage.getItem('basketboss_at_home_requirements_v1')).byActor[BBHome.actor()].cooked}));
  await page.locator('[data-bb-start-next-week]').click();const confirmation=page.locator('#bbQaConfirmOverlay');await confirmation.waitFor();
  assert.match(await confirmation.innerText(),/At home quantities stay unchanged/);
  const preview=await page.evaluate(()=>({stock:localStorage.getItem('basketboss_321_v7_measured_pantry'),planned:__stockDeficitQA.planned(),saved:BBSavedWeeks.createStore({storage:localStorage,context:BBSavedWeeksHost.context}).read()}));
  assert.equal(preview.stock,before.stock);assert.deepEqual(preview.planned,before.planned);assert.equal(preview.saved.weeks.length,0,'preview has not saved or replaced the week');
  await confirmation.getByRole('button',{name:'Start next week',exact:true}).click();await confirmation.waitFor({state:'detached'});
  await page.waitForFunction(()=>__stockDeficitQA.planned().length===7);
  const after=await page.evaluate(()=>({stock:localStorage.getItem('basketboss_321_v7_measured_pantry'),inventory:localStorage.getItem('basketboss_makeameal_v1_inventory'),planned:__stockDeficitQA.planned(),generation:JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')).pantryPlanGeneration,cooked:JSON.parse(localStorage.getItem('basketboss_at_home_requirements_v1')).byActor[BBHome.actor()].cooked,saved:BBSavedWeeks.createStore({storage:localStorage,context:BBSavedWeeksHost.context}).read()}));
  assert.equal(after.stock,before.stock);assert.equal(after.inventory,before.inventory);assert.deepEqual(after.cooked,before.cooked);
  assert.notEqual(after.generation,before.generation);assert.equal(after.saved.weeks.length,1);assert.deepEqual(after.saved.weeks[0].week.planned,before.planned);assert.equal(new Set(after.planned.map(row=>row.day)).size,7);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
