import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const actor='00000000-0000-4000-8000-000000000039';
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// This bridge exposes real private application functions, without replacing
// shopping, recipe quantities, stock reconciliation, or completion behavior.
const bridge=`window.__ownedFlowQA={
 ready:()=>RECIPES.length===200&&window.BBWeeklyShop&&window.BBHome&&window.BBShopOwnership?.enabled?.(),
 openShop(){tab='shop';render();return window.BBWeeklyShop.start();},
 plan(){tab='week';render();},
 overview(){tab='shop-list';render();},
 stock:()=>bb307ReadStock(),
 purchase:()=>bb84ReadPurchased()[BB307Pantry.pantryId('Pork sausages','each')],
 summary:()=>bb321WeeklySummary(),
 session:()=>bbShopV7Snapshot(bbShopV7Session()),
 snapshot:()=>Object.fromEntries([BB307_STOCK_KEY,BB83_KITCHEN_INVENTORY,BB321_SHOP_TICKS_KEY,BB84_PURCHASED_KEY,BB_PARTIAL_PURCHASE_KEY,BB_BETA_RECEIPT_KEY,'basketboss_at_home_requirements_v1'].map(key=>[key,localStorage.getItem(key)])),
 preview:()=>BBHome.previewDay({day:'Friday',actorId:BBHome.actor()}),
 finishCount:()=>bb83TransferBought().count
};`;

async function fixture(width){
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[],network=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // Every request, including cloud saves and analytics, is fulfilled locally.
 // There is no route.continue and no opportunity for production writes.
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:actor,email:'owned-flow@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
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
 await context.addInitScript(({actor})=>{
  if(localStorage.getItem('owned-flow-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'owned-flow@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'sausage-gnocchi',day:'Friday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
  const stock={'pork sausages|each':5,'potato gnocchi|g':500,'passata|g':500,'mozzarella|each':1,'dried italian herbs|each':1};
  localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify(stock));
  const inventory={};
  for(const [id,qty]of Object.entries(stock)){
   const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1),loc=['passata','dried italian herbs'].includes(name)?'cupboard':'fridge';
   inventory[loc+'|'+name]={name,loc,selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty,...(name==='dried italian herbs'?{staple:true,stapleStatus:'in'}:{})};
  }
  localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify(inventory));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','UK');
  localStorage.setItem('owned-flow-fixture-v1','1');
 },{actor});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__ownedFlowQA?.ready());
 return {page,context,errors,network};
}

async function openShop(page){
 assert.equal(await page.evaluate(()=>window.__ownedFlowQA.openShop()),true);
 const shell=page.locator('#bb172Storefront');await shell.locator('.bbcompact-shop-row').first().waitFor();
 await shell.getByRole('button',{name:'All items',exact:true}).click();
 return shell;
}
const sausageRow=shell=>shell.locator('.bbcompact-shop-row').filter({hasText:'Pork Sausages'});
const stock=page=>page.evaluate(()=>window.__ownedFlowQA.stock());
async function boughtAmount(page,row,total){
 await row.locator('.bbcompact-toggle').click();
 await row.getByRole('button',{name:'Enter different amount',exact:true}).click();
 await row.getByRole('spinbutton',{name:'Total Pork Sausages bought in each',exact:true}).fill(String(total));
 await row.getByRole('button',{name:'Save amount',exact:true}).click();
 await page.waitForFunction(total=>window.__ownedFlowQA.purchase()?.actualQty===total,total);
}

for(const width of [390,320]){
 test(`current 700 shop immediately owns bought packs, corrects amounts and saves remainder at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
  const {page,context,errors}=await fixture(width);
  try{
   let shell=await openShop(page),row=sausageRow(shell);
   assert.equal(await row.locator('.bbcompact-qty').textContent(),'1 needed');
   assert.equal(await row.locator('.bb-shop-need-context').textContent(),'Have 5 at home (of 6) • Buy 1 pack (6 pk)');
   const before=await stock(page),beforeSnapshot=await page.evaluate(()=>window.__ownedFlowQA.snapshot());
   await row.locator('.bb172-storefront-checkbox').scrollIntoViewIfNeeded();const beforeY=await row.evaluate(node=>node.getBoundingClientRect().top);
   await row.locator('.bb172-storefront-checkbox').check();
   await page.waitForFunction(()=>window.__ownedFlowQA.stock()['pork sausages|each']===11);
   assert.equal(await row.count(),1,'the purchased row remains available for correction');
   assert.equal(await row.locator('.bb172-storefront-checkbox').isChecked(),true);
   const afterY=await row.evaluate(node=>node.getBoundingClientRect().top);
   assert.ok(Math.abs(afterY-beforeY)<3,'ticking preserves the row position: '+beforeY+' -> '+afterY);
   assert.equal((await page.evaluate(()=>window.__ownedFlowQA.purchase())).actualQty,6);
   await boughtAmount(page,row,2);
   assert.equal((await stock(page))['pork sausages|each'],7,'editing replaces the previous six-item credit with two');
   assert.equal((await stock(page))['potato gnocchi|g'],before['potato gnocchi|g']);
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ownedFlowQA?.ready());
   shell=await openShop(page);row=sausageRow(shell);
   assert.equal((await stock(page))['pork sausages|each'],7,'reload cannot replay the purchase');
   assert.equal(await row.locator('.bb172-storefront-checkbox').isChecked(),true);
   assert.equal(await page.evaluate(()=>window.__ownedFlowQA.finishCount()),0,'Finish has no pending stock credit');
   const afterPurchase=await stock(page);
   await shell.getByRole('button',{name:'Finish shop',exact:true}).click();
   const dialog=page.locator('#bb172ShopConfirm');
   await dialog.getByRole('button',{name:/Save \d+(?: items?)? for another shop/}).click();
   await shell.waitFor({state:'detached'});
   assert.deepEqual(await stock(page),afterPurchase,'finishing cannot credit the same pack again');
   const continuation=page.locator('.bb-shop-continuation-card');
   await continuation.getByRole('heading',{name:'Continue your shop',exact:true}).waitFor();
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ownedFlowQA?.ready());
   await page.evaluate(()=>window.__ownedFlowQA.overview());
   await continuation.getByRole('heading',{name:'Continue your shop',exact:true}).waitFor();
   await continuation.getByText('Saved list from your last shop',{exact:true}).click();
   assert.match(await continuation.locator('.bb-shop-continuation-list').innerText(),/Garlic Baguette/i);
   assert.doesNotMatch(await continuation.locator('.bb-shop-continuation-list').innerText(),/Pork Sausages/i,'bought food is excluded from the saved remainder');
   assert.notEqual((await page.evaluate(()=>window.__ownedFlowQA.snapshot()))['basketboss_purchase_receipts_v1'],beforeSnapshot['basketboss_purchase_receipts_v1']);
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });

 test(`current 700 Day done reads purchased stock and cancels without deduction at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
  const {page,context,errors}=await fixture(width);
  try{
   const shell=await openShop(page),row=sausageRow(shell);
   await row.locator('.bb172-storefront-checkbox').check();
   await page.waitForFunction(()=>window.__ownedFlowQA.stock()['pork sausages|each']===11);
   const baguette=shell.locator('.bbcompact-shop-row').filter({hasText:'Garlic Baguette'});
   await baguette.locator('.bb172-storefront-checkbox').check();
   const before=await page.evaluate(()=>window.__ownedFlowQA.snapshot()),preview=await page.evaluate(()=>window.__ownedFlowQA.preview());
   const sausage=preview.rows.find(row=>/pork sausages/i.test(row.name));
   assert.ok(sausage,'Friday dinner supplies the real sausage requirement');
   assert.equal(sausage.required,6);assert.equal(sausage.owned,11);assert.equal(sausage.remaining,5);
   assert.equal(preview.ok,true);assert.deepEqual(preview.issues,[]);
   assert.deepEqual(await page.evaluate(()=>window.__ownedFlowQA.snapshot()),before,'preview is read-only');
   await shell.getByRole('button',{name:'Exit shopping mode',exact:true}).click();
   await page.locator('#bb172ShopConfirm').getByRole('button',{name:'Exit shop (keep progress)',exact:true}).click();
   await shell.waitFor({state:'detached'});
   await page.evaluate(()=>window.__ownedFlowQA.plan());
   // The planner badge uses this public review entry point. Its normally
   // collapsed Day done button need not be exposed by changing saved UI state.
   assert.equal((await page.evaluate(()=>window.BBDayDone.quickComplete('Friday'))).ok,true);
   const dialog=page.locator('.bb-day-done-dialog');
   await dialog.getByRole('button',{name:'Confirm & update pantry',exact:true}).waitFor();
   const tableRow=dialog.locator('tr').filter({hasText:'Pork sausages'});
   assert.match(await tableRow.innerText(),/6 each\s+11 each\s+5 each/);
   await dialog.getByRole('button',{name:'Not yet',exact:true}).click();
   await dialog.waitFor({state:'detached'});
   assert.deepEqual(await page.evaluate(()=>window.__ownedFlowQA.snapshot()),before,'cancel preserves stock and purchase history');
   await page.evaluate(()=>window.BBDayDone.quickComplete('Friday'));
   await dialog.getByRole('button',{name:'Confirm & update pantry',exact:true}).click();
   await page.waitForFunction(()=>window.__ownedFlowQA.stock()['pork sausages|each']===5);
   assert.equal((await stock(page))['pork sausages|each'],5,'only confirmation consumes the six used sausages');
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });
}
