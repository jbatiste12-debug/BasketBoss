import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const actor='00000000-0000-4000-8000-000000000040';
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// This bridge exposes original application entry points and reads; it never
// replaces recipes, pantry reconciliation, shopping quotes or budget math.
const bridge=`window.__budgetQA={
 ready:()=>RECIPES.length===200&&window.BBWeeklyShop&&window.BBHome&&window.BBShopOwnership?.enabled?.(),
 plan(){tab='week';render();},
 overview(){tab='shop-list';render();},
 add:(id,day)=>addRecipe(id,day),
 state:()=>JSON.parse(JSON.stringify(state)),
 summary:()=>bb321WeeklySummary(),
 stock:()=>bb307ReadStock(),
 purchase:()=>bb84ReadPurchased()[BB307Pantry.pantryId('Pork sausages','each')],
 archive:()=>localStorage.getItem(BB_SHOP_ARCHIVE_V7_KEY),
};`;

async function fixture(width,{unpriced=false}={}){
 const at=Date.now(),ledger=require('../bb-reduced-purchases.js'),historic={...ledger.putCost({version:7,id:'shop-budget-historic-trip'},{actor,market:'UK',id:'long-grain rice|g',purchaseId:'long-grain rice|g',name:'Rice',unit:'g',quantity:500,shopSessionId:'shop-budget-historic-trip',pricePaid:251.45,at}),closedAt:new Date(at).toISOString()};
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[],network=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // Every request, including cloud saves and analytics, is fulfilled locally.
 // There is no route.continue and no opportunity for production writes.
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:actor,email:'budget-flow@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/')){
   network.push({path:url.pathname,method:request.method()});
   let data={ok:true};
   if(url.pathname==='/api/subscription/status')data={authenticated:true,tier:'owner',premium:true,premiumAccess:true,mode:'live',subscription:null};
   else if(url.pathname==='/api/household')data={configured:false,premium:true,items:[]};
   else if(url.pathname==='/api/receipt-inventory')data={ok:true,configured:false,available:false};
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
 await context.addInitScript(({actor,historic,unpriced})=>{
  if(localStorage.getItem('budget-flow-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'budget-flow@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday'},{recipeId:'sausage-gnocchi',day:'Friday'}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:unpriced?[{id:'shampoo-unpriced',name:'Shampoo',qty:1,unit:'pack',selected:true,owned:false,estimatedPackPrice:null}]:[]}));
  const stock={'pork sausages|each':5,'potato gnocchi|g':500,'passata|g':500,'mozzarella|each':1,'dried italian herbs|each':1};
  localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify(stock));
  localStorage.setItem('basketboss_v172_weekly_budget_target_v1','150');
  const inventory={};
  for(const [id,qty]of Object.entries(stock)){
   const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1),loc=['passata','dried italian herbs'].includes(name)?'cupboard':'fridge';
   inventory[loc+'|'+name]={name,loc,selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty,...(name==='dried italian herbs'?{staple:true,stapleStatus:'in'}:{})};
  }
  localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify(inventory));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','UK');
  localStorage.setItem('basketboss_shop_session_archive_v7',JSON.stringify({'shop-budget-historic-trip':historic}));
  localStorage.setItem('budget-flow-fixture-v1','1');
 },{actor,historic,unpriced});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__budgetQA?.ready());
 await page.evaluate(()=>window.__budgetQA.plan());
 return {page,context,errors,network};
}


const money=amount=>'£'+amount.toFixed(2);
async function assertPlanBudget(page,amount,message,weeklyTotal=Math.round((251.45+amount)*100)/100){
 const summary=await page.evaluate(()=>window.__budgetQA.summary());
 assert.equal(await page.locator('#myWeekEstimatedTotal').textContent(),money(amount)+(summary.remainingPending?' +':''),message);
 assert.equal(await page.evaluate(()=>document.body.dataset.bbnextView),'week','the estimate updates on Plan before any Shop navigation');
 assert.equal(summary.remainingTotal,amount,'real current shopping quantities support the visible estimate');
 assert.equal(summary.total,weeklyTotal,'the completed trip stays in weekly spending history');
 assert.equal(await page.locator('#myWeekEstimatedTotal').evaluate(node=>node.parentElement.querySelector('small')?.textContent),'to buy','the headline explains which money is shown');
 const settings=page.locator('#bbSimpleBudget');await settings.waitFor();
 assert.equal(await settings.evaluate(node=>node.open),false,'weekly spending stays in the existing closed Budget & household disclosure');
 const forecast=settings.locator('.bb77-weekly-forecast');
 assert.match(await forecast.textContent(),new RegExp('This week: £'+weeklyTotal.toFixed(2).replace('.','\\.')));
 assert.equal(await forecast.isVisible(),false);
 const trim=page.locator('.bb81-trim-banner');
 if(await trim.count()){
  assert.equal(await settings.locator('.bbs-budget-body .bb81-trim-banner').count(),await trim.count(),'a weekly-spending trim suggestion stays with its budget comparison');
  assert.equal(await trim.first().isVisible(),false,'history-driven budget suggestions stay hidden while Budget & household is closed');
 }
}
async function clearDinner(page,day){
 await page.getByRole('button',{name:'Clear only '+day+' dinner',exact:true}).click();
 await page.locator('#bbQaConfirmOverlay').getByRole('button',{name:'Clear this meal',exact:true}).click();
 await page.waitForFunction(day=>!window.__budgetQA.state().planned.some(slot=>slot.day===day),day);
}
async function assertOverviewBudget(page,amount){
 await page.evaluate(()=>window.__budgetQA.overview());
 const total=page.locator('.bb321-shop-total').first();await total.waitFor({state:'attached'});
 assert.match(await total.textContent(),new RegExp('£'+amount.toFixed(2).replace('.','\\.')));
 const metric=page.locator('#bbReleaseShopOverview .bb-r6-stat').last();
 await metric.waitFor();assert.match(await metric.textContent(),new RegExp('£'+amount.toFixed(2).replace('.','\\.')));
}
async function openShoppingMode(page){
 await page.locator('#bbReleaseShopOverview .bb-r6-begin').click();
 const shell=page.locator('#bb172Storefront');await shell.locator('.bbcompact-shop-row').first().waitFor();
 await shell.getByRole('button',{name:'All items',exact:true}).click();return shell;
}
async function exitShoppingMode(page,shell){
 await shell.evaluate(node=>{node.scrollTop=0;});
 await page.waitForFunction(()=>document.getElementById('bb172Storefront')?.dataset.bbShopCompact==='false');
 await shell.locator('.bb172-storefront-exit').click();
 await page.locator('#bb172ShopConfirm').getByRole('button',{name:'Exit shop (keep progress)',exact:true}).click();
 await shell.waitFor({state:'detached'});
}
async function setSausagesBought(page,row,amount){
 await row.locator('.bbcompact-toggle').click();
 await row.getByRole('button',{name:'Enter different amount',exact:true}).click();
 await row.getByRole('spinbutton',{name:'Total Pork Sausages bought in each',exact:true}).fill(String(amount));
 await row.getByRole('button',{name:'Save amount',exact:true}).click();
 await page.waitForFunction(amount=>window.__budgetQA.stock()['pork sausages|each']===5+amount,amount);
}

for(const width of [390,320])test(`current 700 Plan recalculates its current basket after remove, add and servings without visiting Shop at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors,network}=await fixture(width);
 try{
  const archive=await page.evaluate(()=>window.__budgetQA.archive()),stock=await page.evaluate(()=>window.__budgetQA.stock());
  await assertPlanBudget(page,12.50,'a past completed shop cannot inflate the current Plan estimate');
  await clearDinner(page,'Monday');
  await assertPlanBudget(page,4.45,'removing the rice dinner changes the visible estimate immediately');
  await clearDinner(page,'Friday');
  await assertPlanBudget(page,0,'removing the last dinner leaves no groceries to buy');
  // Invoke the original add entry point, keeping its access checks, save and
  // render. All recipe quantities, pantry use and prices remain real.
  await page.evaluate(()=>window.__budgetQA.add('sausage-gnocchi','Friday'));
  await assertPlanBudget(page,4.45,'adding the sausage dinner refreshes the estimate without Shop navigation');
  await page.locator('.bbnext-day[data-bbnext-day="Friday"] summary [data-bbfeed-delta="1"]').click();
  await assertPlanBudget(page,11.20,'a fifth person needs the next full packs after pantry deductions');
  await page.locator('.bbnext-day[data-bbnext-day="Friday"] summary [data-bbfeed-delta="-1"]').click();
  await assertPlanBudget(page,4.45,'reducing servings refreshes the amount as well');
  const settings=page.locator('#bbSimpleBudget');
  await settings.locator(':scope>summary').click();
  await settings.locator('#bb77BudgetTarget').fill('300');
  assert.match(await settings.locator('.bb77-weekly-budget-state').textContent(),/£44\.10 under your £300 budget/,'typing a target immediately updates the weekly comparison');
  assert.match(await settings.locator('.bb77-weekly-forecast').textContent(),/This week: £255\.90/);
  assert.equal(await page.locator('#myWeekEstimatedTotal').textContent(),'£4.45','saving a weekly target cannot change the current groceries to buy');
  assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_v172_weekly_budget_target_v1')),'300');
  await settings.locator(':scope>summary').click();
  await assertPlanBudget(page,4.45,'closing budget settings preserves the current estimate');
  assert.deepEqual(await page.evaluate(()=>window.__budgetQA.stock()),stock,'planning edits and budget saves do not change physical pantry stock');
  assert.equal(await page.evaluate(()=>window.__budgetQA.archive()),archive,'planning edits preserve completed-trip history');
  assert.equal(network.some(request=>request.path==='/api/shopping/weekly-trip'),false,'all remove/add/servings checks ran before starting a shop');
  await assertOverviewBudget(page,4.45);
  const shell=await openShoppingMode(page);
  assert.match(await shell.locator('.bb172-storefront-compact-budget').textContent(),/£4\.45/);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('current 700 Plan and Shop agree after real partial purchases while preserving the previous trip',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390);
 try{
  const archive=await page.evaluate(()=>window.__budgetQA.archive());
  await clearDinner(page,'Monday');
  await page.locator('.bbnext-day[data-bbnext-day="Friday"] summary [data-bbfeed-delta="1"]').click();
  await assertOverviewBudget(page,11.20);
  let shell=await openShoppingMode(page),row=shell.locator('[data-bb-shop-purchase-id="pork sausages|each"]');
  await row.locator('.bb172-storefront-checkbox').check();
  await setSausagesBought(page,row,1);
  assert.equal((await page.evaluate(()=>window.__budgetQA.stock()))['pork sausages|each'],6,'only the one purchased sausage is added to the five owned');
  await exitShoppingMode(page,shell);
  await page.evaluate(()=>window.__budgetQA.plan());
  await assertPlanBudget(page,11.20,'a partial purchase still requires a full pack to cover the shortfall',265.45);
  await assertOverviewBudget(page,11.20);
  shell=await openShoppingMode(page);row=shell.locator('[data-bb-shop-purchase-id="pork sausages|each"]');
  await setSausagesBought(page,row,3);
  assert.equal((await page.evaluate(()=>window.__budgetQA.stock()))['pork sausages|each'],8,'correcting the purchase replaces the earlier one-item credit');
  await exitShoppingMode(page,shell);
  await page.evaluate(()=>window.__budgetQA.plan());
  // Weekly spending includes this active trip's £2.80 purchase as well as
  // the previous £251.45, while the remaining food is £8.40.
  assert.equal(await page.locator('#myWeekEstimatedTotal').textContent(),'£8.40');
  const finalSummary=await page.evaluate(()=>window.__budgetQA.summary());
  assert.equal(finalSummary.remainingTotal,8.40);assert.equal(finalSummary.total,262.65,'weekly spending retains both previous and active trip costs');
  await assertOverviewBudget(page,8.40);
  shell=await openShoppingMode(page);
  assert.match(await shell.locator('.bb172-storefront-compact-budget').textContent(),/£8\.40/);
  assert.equal(await page.evaluate(()=>window.__budgetQA.archive()),archive,'active purchase edits cannot rewrite the previous completed trip');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});


test('current 700 current-basket totals retain real unpriced essentials as pending',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{unpriced:true});
 try{
  const archive=await page.evaluate(()=>window.__budgetQA.archive());
  const summary=await page.evaluate(()=>window.__budgetQA.summary());
  assert.equal(summary.pending,1);assert.equal(summary.remainingPending,1);
  assert.equal(summary.remainingTotal,12.50,'the underlying basket retains its known-price subtotal');
  assert.equal(summary.total,263.95,'the completed trip stays in weekly spending history');
  const shampoo=summary.essentials.find(item=>item.id==='shampoo-unpriced');
  assert.equal(shampoo.priceQuote.amount,null,'a display guide cannot invent an authoritative product price');
  assert.equal(shampoo.priceQuote.priceNeeded,true);
  const displayed=await page.locator('#myWeekEstimatedTotal').textContent();
  assert.equal(displayed,'£15.00','Plan includes the optional guide for the unpriced essential');
  assert.equal(Number(displayed.slice(1))-summary.remainingTotal,2.50,'the guide contributes exactly £2.50 to the display only');
  assert.equal(await page.evaluate(()=>document.body.dataset.bbnextView),'week','the displayed estimate is ready before any Shop navigation');
  assert.equal(await page.locator('#myWeekEstimatedTotal').evaluate(node=>node.parentElement.querySelector('small')?.textContent),'to buy');
  const settings=page.locator('#bbSimpleBudget');await settings.waitFor();
  assert.equal(await settings.evaluate(node=>node.open),false,'weekly spending remains in the existing closed budget disclosure');
  assert.equal(await settings.locator('.bb77-weekly-forecast').isVisible(),false);
  const trim=page.locator('.bb81-trim-banner');
  if(await trim.count()){
   assert.equal(await settings.locator('.bbs-budget-body .bb81-trim-banner').count(),await trim.count());
   assert.equal(await trim.first().isVisible(),false,'history-driven suggestions remain inside the closed budget disclosure');
  }
  assert.equal(await page.locator('.bb77-price-note').textContent(),'','the current shopping display uses its numeric guide');
  assert.match(await page.locator('#bbSimpleBudget .bb77-weekly-forecast').textContent(),/£263\.95 \+/,'weekly history stays visibly incomplete too');
  await assertOverviewBudget(page,15.00);
  assert.doesNotMatch(await page.locator('#bbReleaseShopOverview .bb-r6-stat').last().textContent(),/\+/,'Shop overview includes the numeric guide');
  assert.doesNotMatch(await page.locator('.bb321-shop-summary-stats').textContent(),/\bunpriced\b/);
  assert.equal(await page.evaluate(()=>window.__budgetQA.archive()),archive);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
