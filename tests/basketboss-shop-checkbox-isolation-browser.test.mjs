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
const bridge=`window.__readableShopQA={
 ready:()=>RECIPES.length===200&&window.BBWeeklyShop&&window.BBHome&&window.BBShopPurchaseUI?.createPicker&&window.BBShopOwnership?.enabled?.(),
 openShop(){tab='shop';render();return window.BBWeeklyShop.start();},
 ordinaryShop(){tab='shop-list';render();},
 atHome(){bb172ShopSetActive(false);tab='shop';render();},
 pantryRows:()=>Object.values(JSON.parse(localStorage.getItem(BB83_KITCHEN_INVENTORY)||'{}')).filter(row=>row?.selected===true),
 shopSession:()=>bbShopV7Session(),
 plan(){tab='week';render();},
 renderAgain(){render();},
 summary:()=>bb321WeeklySummary(),
 stock:()=>bb307ReadStock(),
 purchase:id=>bb84ReadPurchased()[id],
 debugState:()=>({availability:BBReceiptHost.getAvailability(),allowPurchase:BBReceiptHost.allowPurchaseTransfer(),review:BBReceiptHost.requiresPantryReview(),stock:bb307ReadStock(),ticks:bb321ReadShopTicks(),purchases:bb84ReadPurchased(),plans:JSON.parse(localStorage.getItem('basketboss_shop_pack_ui_v1')||'{}'),receipts:bb83ReadObject(BB_BETA_RECEIPT_KEY),toast:document.getElementById('toastRoot')?.innerText}),
 pack:(name,unit)=>BBPriceV19.getPack(name,unit,bb307Market),
 catalogue:id=>BBPriceV19.catalog[id],
 cookEvent(){const recipe=getRecipe('chicken-burgers'),slot=state.planned.find(row=>row.recipeId===recipe.id);return {sessionId:'readable-packs-cook',recipeId:recipe.id,day:'Friday',factor:BBServing.ratio(BBServing.forMeal(state,slot,recipe),recipe),actorId:BBHome.actor(),occurrence:bbHomeOccurrence(recipe.id,'Friday')};},
 cookPreview(){return BBHome.previewCook(this.cookEvent());},
 cookFinish(expected){return BBHome.cooked({...this.cookEvent(),expected});},
 snapshot:()=>({storage:Object.fromEntries([KEY,BB307_STOCK_KEY,BB83_KITCHEN_INVENTORY,BB321_SHOP_TICKS_KEY,BB84_PURCHASED_KEY,BB_PARTIAL_PURCHASE_KEY,BB_BETA_RECEIPT_KEY,BB_BETA_CHOICE_KEY,'basketboss_at_home_requirements_v1'].map(key=>[key,localStorage.getItem(key)])),recipe:getRecipe('chicken-burgers'),normalized:BB307_NORMALIZED.find(row=>row.id==='chicken-burgers')}),
 addTiny:()=>BBHome.addShoppingBuy({name:'Chicken breast',quantityText:'0.000001 g',actorId:BBHome.actor(),requestId:'tiny-readable-shop-quantity'})
};`;

async function fixture(width,{recipeId='chicken-burgers',stock={'chicken breast|g':200},emptyOnline=false,latency=300}={}){
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const remote={stock:emptyOnline?{}:{...stock},revision:3};
 const remoteProjection=()=>({ok:true,stock:{...remote.stock},scope:{kind:'user',id:actor},initialized:true,inventoryRevision:remote.revision,pantryReview:{required:false},inventory:[],essentials:[],receipts:[],priceObservations:[]});
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
    if(url.searchParams.get('mode')==='status')data={ok:true,configured:true,available:true,premium:true};
    else if(route.request().method()==='POST'){
     const body=route.request().postDataJSON();
     await new Promise(resolve=>setTimeout(resolve,latency));
     if(body.expectedRevision!==remote.revision)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'inventory_revision_conflict'})});
     remote.stock={...body.stock};remote.revision++;data=remoteProjection();
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
 await context.addInitScript(({actor,recipeId,stock})=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(value){window.__readableShopCopy=String(value);}}});
  if(localStorage.getItem('readable-shop-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'readable-shop@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:recipeId?[{recipeId,day:'Friday',servings:4}]:[],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
  localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify(stock));
  const inventory={};
  for(const [id,qty]of Object.entries(stock)){
   const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1),loc='fridge';
   inventory[loc+'|'+name]={name,loc,selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty};
  }
  localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify(inventory));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('readable-shop-fixture-v1','1');
 },{actor,recipeId,stock});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__readableShopQA?.ready());
 return {page,context,errors};
}

async function openShop(page){
 assert.equal(await page.evaluate(()=>window.__readableShopQA.openShop()),true);
 const shell=page.locator('#bb172Storefront');await shell.locator('.bbcompact-shop-row').first().waitFor();
 await shell.getByRole('button',{name:'All items',exact:true}).click();
 return shell;
}

const rowFor=(shell,id)=>shell.locator('[data-bb-shop-purchase-id="'+id+'"]');
const snapshot=page=>page.evaluate(()=>window.__readableShopQA.snapshot());
const summary=page=>page.evaluate(()=>window.__readableShopQA.summary());
const rawDecimals=/\b\d+\.\d{5,}\b/;
const roundMoney=value=>Math.round((value+Number.EPSILON)*100)/100;
const money=text=>{const match=String(text).match(/[£$]\s*([\d,]+(?:\.\d+)?)/);assert.ok(match,'a readable price is shown: '+text);return Number(match[1].replaceAll(',',''));};
const remaining=shell=>shell.locator('.bb172-storefront-compact-budget strong');
const rowPrice=row=>row.locator('.bbcompact-price');
async function assertRowLayout(row){
 const layout=await row.evaluate(row=>{
  const main=row.querySelector('.bbcompact-main'),body=row.querySelector('.bb-shop-purchase-body');
  const box=selector=>{const r=row.querySelector(selector).getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height};};
  return {columns:getComputedStyle(main).gridTemplateColumns.split(/\s+/).length,bodyDisplay:getComputedStyle(body).display,bodyWidth:body.getBoundingClientRect().width,title:box('.bb172-storefront-item-title'),price:box('.bbcompact-price'),more:box('.bbcompact-toggle'),need:box('.bbcompact-qty'),buying:box('.bb-shop-buying-pill')};
 });
 assert.equal(layout.columns,2);assert.equal(layout.bodyDisplay,'block');assert.ok(layout.bodyWidth>150);
 assert.ok(layout.title.width>60,'the food title retains a readable width');
 assert.ok(layout.title.right<=layout.price.x+1);assert.ok(layout.price.right<=layout.more.x+1);
 assert.ok(layout.title.bottom<=layout.need.y+1);assert.ok(layout.need.right<=layout.buying.x+1);
 assert.ok(layout.more.width>=44&&layout.more.height>=44,'item details retain a touch-sized control');
}
async function picker(page,row){
 await row.locator('.bb-shop-buying-pill').click();
 const dialog=row.locator('.bb-shop-pack-picker');await dialog.waitFor({state:'visible'});return dialog;
}
async function savePicker(dialog){await dialog.locator('.bb-shop-pack-save').click();await dialog.waitFor({state:'hidden'});}
async function assertUnbought(page,id,stock){
 assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.stock()),stock,'saving a buying plan cannot add food');
 assert.equal(await page.evaluate(id=>window.__readableShopQA.purchase(id),id),undefined,'saving a buying plan cannot create a purchase');
}
async function finishAndReload(page,shell,expectedStock){
 await shell.getByRole('button',{name:'Finish shop',exact:true}).click();
 const dialog=page.locator('#bb172ShopConfirm'),save=dialog.getByRole('button',{name:/^Save \d+(?: items?)? for another shop$/});
 if(await save.count())await save.click();else await dialog.getByRole('button',{name:'Finish shop',exact:true}).click();
 await shell.waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.stock()),expectedStock,'Finish cannot credit a bought amount twice');
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__readableShopQA?.ready());
 assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.stock()),expectedStock,'reload cannot replay the bought amount');
}



const idFor=row=>row.key+'|'+row.unit;
async function current(page){return page.evaluate(()=>window.__readableShopQA.debugState());}
async function choose(page,shell,id,preset){const panel=await picker(page,rowFor(shell,id));await panel.locator('[data-bb-pack-preset="'+preset+'"]').click();await panel.waitFor({state:'hidden'});}
async function saved(page,id){await page.waitForFunction(id=>window.__readableShopQA.debugState().ticks[id]===true,id);}
async function assertIsolated(row,perform){
 await row.evaluate(row=>{window.__shopInteractionBubbles=0;for(const type of ['click','change'])row.addEventListener(type,()=>window.__shopInteractionBubbles++);});
 await perform();assert.equal(await row.page().evaluate(()=>window.__shopInteractionBubbles),0,'a checkbox/picker event cannot reach the row completion handler');
}
for(const width of [320,390])test('green pack choices, independent checkbox events and Finish preserve other purchases at '+width,{timeout:90000},async()=>{
 const {page,context,errors}=await fixture(width,{recipeId:'fajitas'});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  const shell=await openShop(page),wraps='tortilla wraps|each',cream='soured cream|g',cheddar='cheddar|g';
  await assertIsolated(rowFor(shell,wraps),()=>rowFor(shell,wraps).locator('.bb172-storefront-checkbox').click());await saved(page,wraps);
  const before=(await current(page)).stock;
  await assertIsolated(rowFor(shell,cheddar),()=>choose(page,shell,cheddar,'exact'));
  assert.deepEqual((await current(page)).stock,before,'choosing an unbought pack must not change stock');assert.equal((await current(page)).ticks[wraps],true);
  await assertIsolated(rowFor(shell,cheddar),()=>rowFor(shell,cheddar).locator('.bb172-storefront-checkbox').click());await saved(page,cheddar);
  await choose(page,shell,cream,'200');await rowFor(shell,cream).locator('.bb172-storefront-checkbox').click();await saved(page,cream);
  await choose(page,shell,wraps,'6');
  const expected={'chicken breast|g':200,'tortilla wraps|each':12,'cheddar|g':267,'soured cream|g':200},result=await current(page);
  assert.deepEqual(result.stock,expected);for(const id of [wraps,cream,cheddar])assert.equal(result.ticks[id],true);
  assert.equal(result.purchases[wraps].actualQty,12);assert.equal(result.purchases[cheddar].actualQty,267);assert.equal(result.purchases[cream].actualQty,200);
  await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());await finishAndReload(page,shell,expected);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
for(const width of [320,390])test('Shop uses At home while any saved-stock conflict stays inside Account sync at '+width,{timeout:90000},async()=>{
 const {page,context,errors}=await fixture(width,{recipeId:'fajitas',emptyOnline:true});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));const shell=await openShop(page),wraps='tortilla wraps|each';
  await rowFor(shell,wraps).locator('.bb172-storefront-checkbox').click();
  await saved(page,wraps);
  assert.equal(await rowFor(shell,wraps).locator('.bb172-storefront-checkbox').isChecked(),true,'confirmed local purchases stay ticked while account sync is pending');
  assert.equal(await page.locator('.bb-receipt-pantry-dialog').count(),0,'there is no separate Confirm Pantry screen');
  await choose(page,shell,'cheddar|g','exact');assert.equal((await current(page)).ticks[wraps],true);
  await rowFor(shell,'cheddar|g').locator('.bb172-storefront-checkbox').click();await saved(page,'cheddar|g');
  const expected={'chicken breast|g':200,'tortilla wraps|each':8,'cheddar|g':267};assert.deepEqual((await current(page)).stock,expected);
  await page.evaluate(()=>BBAccountPolish.openPantrySync());
  const account=page.locator('#cloud-panel');await account.locator('#bbAccountPantrySyncButton').click();
  await page.waitForFunction(()=>BBReceiptHost.getAccountPantryStatus().status==='synced');
  assert.equal(await account.locator('input[type=number]').count(),0,'account sync never asks for all food amounts again');
  await account.locator('#cloud-close').click();
  await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());await finishAndReload(page,shell,expected);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('a failed native checkbox save restores its visible state and never clears an unrelated successful tick',{timeout:90000},async()=>{
 const {page,context,errors}=await fixture(390,{recipeId:'fajitas'});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));const shell=await openShop(page),wraps='tortilla wraps|each',cream='soured cream|g';
  await rowFor(shell,wraps).locator('.bb172-storefront-checkbox').click();await saved(page,wraps);await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());
  const before=await current(page);
  await page.evaluate(()=>{window.__originalShopSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='basketboss_321_v11_shop_ticks'&&JSON.parse(value)['soured cream|g'])throw Error('Synthetic checkout save failure');return window.__originalShopSetItem.call(this,key,value);};});
  await rowFor(shell,cream).locator('.bb172-storefront-checkbox').click();await page.waitForFunction(()=>document.querySelector('[data-bb-shop-purchase-id="soured cream|g"] .bb172-storefront-checkbox')?.checked===false);
  const after=await current(page);assert.deepEqual(after.stock,before.stock);assert.deepEqual(after.ticks,before.ticks);assert.equal(await rowFor(shell,wraps).locator('.bb172-storefront-checkbox').isChecked(),true);
  await choose(page,shell,'cheddar|g','exact');assert.equal((await current(page)).ticks[wraps],true);assert.equal(await rowFor(shell,wraps).locator('.bb172-storefront-checkbox').isChecked(),true);
  await page.evaluate(()=>{Storage.prototype.setItem=window.__originalShopSetItem;});await rowFor(shell,cream).locator('.bb172-storefront-checkbox').click();await saved(page,cream);assert.equal((await current(page)).ticks[wraps],true);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('an online purchase acknowledgement preserves the next open Buying editor and its custom draft',{timeout:90000},async()=>{
 const {page,context,errors}=await fixture(320,{recipeId:'fajitas',latency:1800});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));const shell=await openShop(page);
  await rowFor(shell,'tortilla wraps|each').locator('.bb172-storefront-checkbox').click();await saved(page,'tortilla wraps|each');
  const panel=await picker(page,rowFor(shell,'soured cream|g'));await panel.locator('[data-bb-pack-preset="custom"]').click();await panel.locator('[data-bb-pack-custom]').fill('222.222');await panel.locator('[data-bb-pack-price]').fill('2.99');
  await page.waitForFunction(()=>BBReceiptHost.getProjection()?.inventoryRevision>3);
  const fresh=rowFor(shell,'soured cream|g').locator('.bb-shop-pack-picker');await fresh.waitFor({state:'visible'});assert.equal(await fresh.locator('[data-bb-pack-custom]').inputValue(),'222.222');assert.equal(await fresh.locator('[data-bb-pack-price]').inputValue(),'2.99');
  await savePicker(fresh);await rowFor(shell,'soured cream|g').locator('.bb172-storefront-checkbox').click();await saved(page,'soured cream|g');const result=await current(page);assert.equal(result.stock['soured cream|g'],222.222);assert.equal(result.ticks['tortilla wraps|each'],true);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('a synchronized bought pack remains editable after reload and a fresh Shop availability check',{timeout:90000},async()=>{
 const {page,context,errors}=await fixture(390,{recipeId:'fajitas'});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  let shell=await openShop(page);const wraps='tortilla wraps|each';
  await rowFor(shell,wraps).locator('.bb172-storefront-checkbox').click();await saved(page,wraps);
  await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());
  assert.equal((await current(page)).stock[wraps],8);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__readableShopQA?.ready());
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  shell=await openShop(page);await choose(page,shell,wraps,'6');
  const value=await current(page);assert.equal(value.stock[wraps],12);assert.equal(value.purchases[wraps].actualQty,12);assert.equal(value.ticks[wraps],true);
  assert.equal(await page.locator('.bb-receipt-pantry-dialog').count(),0);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});


// These regressions exercise the public 700 app, the existing physical-stock
// transfer and the real account receipt round-trip together. They deliberately
// use an existing generic household name rather than pre-normalized fixtures.
const progressLabel=shell=>shell.locator('.bb172-storefront-progress-label span');
async function assertProgress(page,shell,complete,total){
 await page.waitForFunction(({complete,total})=>document.querySelector('#bb172Storefront .bb172-storefront-progress-label span')?.textContent===complete+' of '+total+' checked',{complete,total});
 assert.equal(await progressLabel(shell).textContent(),complete+' of '+total+' checked');
 assert.equal(await shell.locator('.bb172-storefront-progress-track[role=progressbar]').getAttribute('aria-valuenow'),String(total?Math.round(complete*100/total):0));
}
async function expectBought(page,shell,id,checked=true){
 await page.waitForFunction(({id,checked})=>[...document.querySelectorAll('#bb172Storefront [data-bb-shop-purchase-id]')].find(row=>row.dataset.bbShopPurchaseId===id)?.querySelector('.bb172-storefront-checkbox')?.checked===checked,{id,checked});
 assert.equal(await rowFor(shell,id).locator('.bb172-storefront-checkbox').isChecked(),checked);
}
async function waitPantry(page,expected){
 await page.waitForFunction(expected=>JSON.stringify(Object.entries(window.__readableShopQA.stock()).sort())===JSON.stringify(Object.entries(expected).sort()),expected);
 assert.deepEqual((await current(page)).stock,expected);
}

test('a bought sausage pack merges the household alias, stays in Bought across account refresh and reload, and unticks exactly once',{timeout:90000},async()=>{
 const {page,context,errors}=await fixture(390,{recipeId:'sausage-gnocchi',stock:{'sausages|each':3}});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  await waitPantry(page,{'pork sausages|each':3});
  let shell=await openShop(page);const pork='pork sausages|each',baguette='garlic baguette|each',total=await shell.locator('.bbcompact-shop-row').count();
  assert.match(await rowFor(shell,pork).locator('.bbcompact-qty').textContent(),/^3 needed$/);
  assert.match(await rowFor(shell,pork).locator('.bb-shop-purchase-context').textContent(),/Have 3 at home/);
  await rowFor(shell,baguette).locator('.bb172-storefront-checkbox').click();await expectBought(page,shell,baguette);
  await choose(page,shell,pork,'6');
  await rowFor(shell,pork).locator('.bb172-storefront-checkbox').click();await expectBought(page,shell,pork);
  await waitPantry(page,{'pork sausages|each':9,'garlic baguette|each':1});
  await assertProgress(page,shell,2,total);
  await shell.getByRole('button',{name:'To buy',exact:true}).click();assert.equal(await rowFor(shell,pork).count(),0);
  await shell.getByRole('button',{name:'Bought',exact:true}).click();await expectBought(page,shell,pork);await expectBought(page,shell,baguette);
  assert.equal(await shell.locator('.bbcompact-shop-row').count(),2);
  assert.match(await rowFor(shell,pork).locator('.bb172-storefront-item-title').textContent(),/pork sausages/i);
  const pantry=await page.evaluate(()=>window.__readableShopQA.pantryRows());
  const sausageRows=pantry.filter(row=>/^(?:pork )?sausages?$/i.test(row.name));
  assert.equal(sausageRows.length,1,'one ordinary fridge food represents the shared sausage identity');assert.match(sausageRows[0].name,/^pork sausages$/i);assert.equal(sausageRows[0].qty,9);assert.equal(sausageRows[0].unit,'each');
  await page.evaluate(async()=>{await BBReceiptHost.retryPurchasedPantry();await BBReceiptHost.refreshAccountPantry();});
  await expectBought(page,shell,pork);await assertProgress(page,shell,2,total);
  await page.evaluate(()=>{const key='basketboss_active_shop_session_v7',session=JSON.parse(localStorage.getItem(key));delete session.completedPurchases;localStorage.setItem(key,JSON.stringify(session));});
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__readableShopQA?.ready());
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  shell=await openShop(page);await shell.getByRole('button',{name:'Bought',exact:true}).click();await expectBought(page,shell,pork);await expectBought(page,shell,baguette);await assertProgress(page,shell,2,total);
  await rowFor(shell,pork).locator('.bb172-storefront-checkbox').click();
  await waitPantry(page,{'pork sausages|each':3,'garlic baguette|each':1});
  await assertProgress(page,shell,1,total);assert.equal(await rowFor(shell,pork).count(),0,'unticked food leaves Bought');await expectBought(page,shell,baguette);
  await shell.getByRole('button',{name:'To buy',exact:true}).click();await expectBought(page,shell,pork,false);
  await shell.getByRole('button',{name:'All items',exact:true}).click();
  await rowFor(shell,pork).locator('.bb172-storefront-checkbox').click();await expectBought(page,shell,pork);
  await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());
  await finishAndReload(page,shell,{'pork sausages|each':9,'garlic baguette|each':1});
  assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.shopSession().completedPurchases||{}),{},'Finish retires the active shop completion records');assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('a confirmed smaller actual purchase stays checked in Bought while exact partial stock math remains reversible',{timeout:90000},async()=>{
 const {page,context,errors}=await fixture(390,{recipeId:'sausage-gnocchi',stock:{}});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  const shell=await openShop(page),pork='pork sausages|each',total=await shell.locator('.bbcompact-shop-row').count();
  const panel=await picker(page,rowFor(shell,pork));await panel.locator('[data-bb-pack-preset="custom"]').click();await panel.locator('[data-bb-pack-custom]').fill('2');await savePicker(panel);
  await rowFor(shell,pork).locator('.bb172-storefront-checkbox').click();const bought='bought:'+(await page.evaluate(()=>__readableShopQA.shopSession().id))+'|'+pork;await expectBought(page,shell,bought);
  await waitPantry(page,{'pork sausages|each':2});await assertProgress(page,shell,1,total+1);assert.match(await rowFor(shell,pork).locator('.bbcompact-qty').textContent(),/^4 more needed$/);
  const data=await current(page);assert.equal(data.ticks[pork],undefined,'the pre-existing partial purchase ledger keeps its original shortfall semantics');
  const partials=await page.evaluate(()=>JSON.parse(localStorage.getItem('basketboss_partial_purchases_v1')||'{}'));
  assert.equal(Object.values(partials).find(row=>row.name==='Pork Sausages'||row.name==='pork sausages')?.bought,2);
  await shell.getByRole('button',{name:'Bought',exact:true}).click();await expectBought(page,shell,bought);
  await rowFor(shell,bought).locator('.bb172-storefront-checkbox').click();await waitPantry(page,{});await assertProgress(page,shell,0,total);
  await shell.getByRole('button',{name:'To buy',exact:true}).click();await expectBought(page,shell,pork,false);assert.match(await rowFor(shell,pork).locator('.bbcompact-qty').textContent(),/^6 needed$/);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('legacy generic and specific sausage rows consolidate on load while chicken cuts remain independent',{timeout:90000},async()=>{
 const expected={'pork sausages|each':9,'chicken breast|g':200,'chicken thigh|g':300};
 const {page,context,errors}=await fixture(390,{recipeId:'chicken-burgers',stock:{'sausages|each':3,'pork sausages|each':6,'chicken breast|g':200,'chicken thigh|g':300}});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));await waitPantry(page,expected);
  await page.evaluate(()=>window.__readableShopQA.atHome());await page.waitForFunction(()=>window.BBPantryEditor?.isCurrent());
  const rows=await page.evaluate(()=>window.BBPantryEditor.list());
  const sausages=rows.filter(row=>/^(?:pork )?sausages?$/i.test(row.name));assert.equal(sausages.length,1);assert.match(sausages[0].name,/^pork sausages$/i);assert.equal(sausages[0].qty,9);
  assert.equal(rows.filter(row=>/chicken breast/i.test(row.name)).length,1);assert.equal(rows.filter(row=>/chicken thigh/i.test(row.name)).length,1);
  const shell=await openShop(page),breast=rowFor(shell,'chicken breast|g');
  assert.match(await breast.locator('.bb-shop-purchase-context').textContent(),/Have 200 g at home/);
  assert.match(await breast.locator('.bbcompact-qty').textContent(),/^467 g needed$/,'the separate 300 g thigh stock cannot cover a breast requirement');
  assert.deepEqual((await current(page)).stock,expected,'viewing Shop does not reassign distinct cuts');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__readableShopQA?.ready());await waitPantry(page,expected);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('saving At home retains active Bought records and refuses an unsafe untick after that purchase amount changes',{timeout:90000},async()=>{
 const {page,context,errors}=await fixture(390,{recipeId:'sausage-gnocchi',stock:{'sausages|each':3}});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));await waitPantry(page,{'pork sausages|each':3});
  let shell=await openShop(page);const pork='pork sausages|each',baguette='garlic baguette|each',total=await shell.locator('.bbcompact-shop-row').count();
  await choose(page,shell,pork,'6');await rowFor(shell,pork).locator('.bb172-storefront-checkbox').click();await expectBought(page,shell,pork);
  await rowFor(shell,baguette).locator('.bb172-storefront-checkbox').click();await expectBought(page,shell,baguette);await assertProgress(page,shell,2,total);
  await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());
  await page.evaluate(()=>window.__readableShopQA.atHome());await page.waitForFunction(()=>window.BBPantryEditor?.isCurrent());
  const edit=await page.evaluate(async()=>{const editor=window.BBPantryEditor,row=editor.list().find(row=>/^(?:pork )?sausages?$/i.test(row.name));const result=editor.update(row.key,{qty:8});if(result.ok)await editor.flush();return result;});assert.equal(edit.ok,true);
  await waitPantry(page,{'pork sausages|each':8,'garlic baguette|each':1});
  shell=await openShop(page);await shell.getByRole('button',{name:'Bought',exact:true}).click();await expectBought(page,shell,pork);await expectBought(page,shell,baguette);await assertProgress(page,shell,2,total);
  await rowFor(shell,pork).locator('.bb172-storefront-checkbox').click();
  await page.waitForFunction(()=>/used or changed/i.test(document.getElementById('toastRoot')?.textContent||''));
  await expectBought(page,shell,pork);await expectBought(page,shell,baguette);await assertProgress(page,shell,2,total);assert.deepEqual((await current(page)).stock,{'pork sausages|each':8,'garlic baguette|each':1});assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
