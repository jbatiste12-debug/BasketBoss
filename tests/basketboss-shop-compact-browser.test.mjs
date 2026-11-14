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

// Read the real shopping and inventory owners. No requirements, pricing,
// checkbox, account or pantry implementation is replaced by the fixture.
const bridge=`window.__compactShopQA={
 ready:()=>RECIPES.length===200&&window.BBWeeklyShop&&window.BBHome&&window.BBShopOwnership?.enabled?.()&&typeof window.BBShopFriendlyQuantityUI?.view==='function',
 plan(){tab='week';render();},overview(){tab='shop-list';render();},
 startShop(){tab='shop';render();return window.BBWeeklyShop.start();},
 summary:()=>bb321WeeklySummary(),stock:()=>bb307ReadStock(),
 debug:()=>({stock:bb307ReadStock(),ticks:bb321ReadShopTicks(),purchases:bb84ReadPurchased(),features:JSON.parse(localStorage.getItem(BB307_FEATURE_KEY)||'{}'),inventory:JSON.parse(localStorage.getItem(BB83_KITCHEN_INVENTORY)||'{}')})
};`;

async function fixture(width){
 const at=Date.now(),ledger=require('../bb-reduced-purchases.js'),historic={...ledger.putCost({version:7,id:'shop-budget-historic-trip'},{actor,market:'UK',id:'long-grain rice|g',purchaseId:'long-grain rice|g',name:'Rice',unit:'g',quantity:500,shopSessionId:'shop-budget-historic-trip',pricePaid:251.45,at}),closedAt:new Date(at).toISOString()};
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const context=await browser.newContext({viewport:{width,height:width>=768?1366:844},isMobile:width<768,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[],network=[];
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
 await context.addInitScript(({actor,historic})=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(value){window.__compactShopCopied=String(value);}}});
  if(localStorage.getItem('budget-flow-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'budget-flow@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday'},{recipeId:'sausage-gnocchi',day:'Friday'}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[{id:'toilet-rolls',name:'Toilet rolls',qty:5,unit:'each',targetQty:5,ownedQty:2,manualPending:true,selected:true,owned:false,estimatedPackPrice:null}]}));
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
 },{actor,historic});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__compactShopQA?.ready());
 await page.waitForFunction(()=>window.BasketBossVerifiedPremium?.state?.()==='premium');
 await page.evaluate(()=>window.__compactShopQA.plan());
 return {page,context,errors,network};
}

const foodId='pork sausages|each',essentialId='ess:toilet-rolls';
const rowFor=(shell,id)=>shell.locator('[data-bb-shop-purchase-id="'+id+'"]');
const state=page=>page.evaluate(()=>window.__compactShopQA.debug());
async function core(page){return page.evaluate(()=>{const s=window.__compactShopQA.summary();return {food:s.items.map(({key,unit,required,pantryUsed,toBuy})=>({key,unit,required,pantryUsed,toBuy})),essentials:s.essentials.map(({id,unit,qty})=>({id,unit,qty}))};});}
async function openShop(page){
 await page.evaluate(()=>window.__compactShopQA.overview());
 if(page.viewportSize().width<768)await page.locator('#bbReleaseShopOverview .bb-r6-begin').click();
 else{
  assert.equal(await page.evaluate(()=>typeof window.BBWeeklyShop?.start==='function'),true,'the responsive layout retains the real shopping entry point');
  assert.equal(await page.evaluate(()=>window.__compactShopQA.startShop()),true);
 }
 const shell=page.locator('#bb172Storefront');await shell.locator('.bbcompact-shop-row').first().waitFor();
 await shell.getByRole('button',{name:'All items',exact:true}).click();return shell;
}
async function assertTarget(locator){
 await locator.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest'}));
 const box=await locator.boundingBox(),viewport=locator.page().viewportSize();assert.ok(box);
 assert.ok(box.width>=44&&box.height>=44,'primary shopping controls retain 44px touch targets');
 assert.ok(box.x>=-1&&box.x+box.width<=viewport.width+1,'touch target fits horizontally');
 assert.ok(box.y>=0&&box.y+box.height<=viewport.height+1,'touch target fits vertically');
 assert.equal(await locator.evaluate(node=>{const b=node.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return hit===node||node.contains(hit);}),true,'the intended control receives the tap rather than an overlay');
}
async function isolated(page,row,action){
 const before=await state(page),checked=await row.locator('.bb172-storefront-checkbox').isChecked();
 await action();const after=await state(page);
 assert.deepEqual(after.ticks,before.ticks,'utility controls cannot complete or uncheck any row');
 assert.deepEqual(after.stock,before.stock,'utility controls cannot credit or remove pantry stock');
 assert.equal(await row.locator('.bb172-storefront-checkbox').isChecked(),checked,'the row checkbox stays independent');
}
async function checkState(page,id,value){await page.waitForFunction(({id,value})=>Boolean(window.__compactShopQA.debug().ticks[id])===value,{id,value});}
async function assertOneChecked(shell,total){
 assert.equal(await shell.locator('.bb172-storefront-progress-label>span').textContent(),'1 of '+total+' checked');
 assert.equal(await shell.getByRole('progressbar',{name:'Items bought',exact:true}).getAttribute('aria-valuenow'),String(Math.round(100/total)));
}

for(const width of [320,390,1024])test('compact Shop retains precise quantities, isolated controls and actual purchases at '+width+'px',{skip:!chromium&&'Playwright unavailable',timeout:120000},async()=>{
 const {page,context,errors}=await fixture(width);
 try{
  const before=await state(page),requirements=await core(page),shell=await openShop(page),total=await shell.locator('.bbcompact-shop-row').count();
  assert.ok(total>3,'the fixture exercises several food aisles and Weekly essentials');
  const sausage=rowFor(shell,foodId),eggs=rowFor(shell,'egg|each'),produce=rowFor(shell,'spring onion|g'),essential=rowFor(shell,essentialId);
  for(const row of [sausage,eggs,produce,essential]){
   await row.locator('.bb-shop-buying-pill').waitFor();
   const sizes=await row.evaluate(node=>({title:parseFloat(getComputedStyle(node.querySelector('.bb172-storefront-item-title')).fontSize),qty:parseFloat(getComputedStyle(node.querySelector('.bbcompact-qty')).fontSize),price:parseFloat(getComputedStyle(node.querySelector('.bbcompact-price')).fontSize)}));
   assert.ok(sizes.title>sizes.qty&&sizes.title>sizes.price,'item name is the largest row label');
  }
  assert.equal(await sausage.locator('.bb-shop-purchase-context').textContent(),'Have 5 at home');assert.equal(await sausage.locator('.bb-shop-purchase-context').isVisible(),true);
  assert.equal(await eggs.locator('.bb-shop-purchase-context').getAttribute('hidden'),'');assert.equal(await eggs.locator('.bb-shop-purchase-context').isVisible(),false);
  assert.equal(await produce.locator('.bbcompact-qty').textContent(),'100 g needed','the exact requirement remains beside the friendly count');
  assert.match(await produce.locator('.bb-shop-friendly-quantity').textContent(),/^About 7 spring onions · For: Mon$/);
  assert.equal(await produce.locator('.bb321-shop-used-in').isVisible(),false,'the source days are not repeated below the friendly hint');
  assert.deepEqual(await core(page),requirements);assert.deepEqual((await state(page)).stock,before.stock,'display hints cannot change quantity state');
  const geometry=await shell.locator('.bbcompact-shop-row').evaluateAll(rows=>rows.map(row=>{const b=row.getBoundingClientRect();return {left:b.left,right:b.right,overflow:row.scrollWidth>row.clientWidth+1};}));
  assert.ok(geometry.every(row=>row.left>=-1&&row.right<=width+1&&!row.overflow),'rows have no horizontal clipping');
  assert.equal(await shell.evaluate(node=>node.scrollWidth>node.clientWidth+1),false);
  assert.doesNotMatch(await shell.innerText(),/\b\d+\.\d{3,}\b|\bNaN\b|\bundefined\b|Check estimate/);
  for(const selector of ['.bb172-storefront-checkbox','.bbcompact-price','.bbcompact-toggle','.bb-shop-buying-pill'])await assertTarget(sausage.locator(selector));

  await isolated(page,sausage,async()=>{await sausage.locator('.bbcompact-price').click();await sausage.locator('.bb-shop-pack-picker').waitFor({state:'visible'});await sausage.locator('.bb-shop-pack-cancel').click();});
  await isolated(page,sausage,async()=>{await sausage.locator('.bbcompact-toggle').click();assert.equal(await sausage.locator('.bbcompact-toggle').getAttribute('aria-expanded'),'true');await sausage.locator('.bbcompact-toggle').click();});
  await isolated(page,sausage,async()=>{await sausage.locator('.bb-shop-buying-pill').click();await sausage.locator('[data-bb-pack-preset="4"]').click();});
  assert.equal(await sausage.locator('.bb172-storefront-checkbox').isChecked(),false);assert.deepEqual((await state(page)).stock,before.stock);assert.deepEqual(await core(page),requirements);
  await sausage.locator('.bb172-storefront-checkbox').click();await checkState(page,foodId,true);
  assert.equal((await state(page)).stock[foodId],9,'selected four-pack adds four to the five already owned');
  await shell.getByRole('button',{name:'Bought',exact:true}).click();await rowFor(shell,foodId).waitFor();
  assert.equal(await rowFor(shell,foodId).locator('.bb172-storefront-checkbox').isChecked(),true);await assertOneChecked(shell,total);
  await rowFor(shell,foodId).locator('.bb172-storefront-checkbox').click();await checkState(page,foodId,false);
  await shell.getByRole('button',{name:'To buy',exact:true}).click();assert.equal(await rowFor(shell,foodId).locator('.bb172-storefront-checkbox').isChecked(),false);assert.deepEqual((await state(page)).stock,before.stock);
  await shell.getByRole('button',{name:'All items',exact:true}).click();

  for(const selector of ['.bb172-storefront-checkbox','.bbcompact-price','.bbcompact-toggle','.bb-shop-buying-pill'])await assertTarget(essential.locator(selector));
  await isolated(page,essential,async()=>{await essential.locator('.bbcompact-price').click();await essential.locator('.bb-shop-pack-picker').waitFor({state:'visible'});await essential.locator('.bb-shop-pack-cancel').click();});
  await isolated(page,essential,async()=>{await essential.locator('.bbcompact-toggle').click();await essential.locator('.bbcompact-toggle').click();});
  await isolated(page,essential,async()=>{await essential.locator('.bb-shop-buying-pill').click();await essential.locator('[data-bb-pack-preset="12"]').click();});
  assert.equal(await essential.locator('.bb172-storefront-checkbox').isChecked(),false);assert.equal((await state(page)).features.essentials.find(row=>row.id==='toilet-rolls').ownedQty,2);
  await essential.locator('.bb172-storefront-checkbox').click();await checkState(page,essentialId,true);
  let purchased=await state(page);assert.equal(purchased.features.essentials.find(row=>row.id==='toilet-rolls').ownedQty,14);assert.deepEqual(purchased.stock,before.stock);
  assert.equal(Object.values(purchased.inventory).some(row=>/toilet/i.test(row.name)),false,'Weekly essentials never become food inventory');
  await shell.getByRole('button',{name:'Bought',exact:true}).click();assert.equal(await rowFor(shell,essentialId).locator('.bb172-storefront-checkbox').isChecked(),true);await assertOneChecked(shell,total);
  await shell.getByRole('button',{name:'All items',exact:true}).click();
  const footer=shell.locator('.bb172-storefront-bottom'),copy=footer.getByRole('button',{name:'Copy remaining',exact:true}),finish=footer.getByRole('button',{name:'Finish shop',exact:true});
  assert.equal(await copy.isVisible(),true);assert.equal(await finish.isVisible(),true);await assertTarget(copy);await assertTarget(finish);
  await shell.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  const last=await shell.locator('.bbcompact-shop-row').last().boundingBox(),foot=await footer.boundingBox();
  assert.ok(last.y+last.height<=foot.y+1,'the final item can scroll fully above Finish/Copy');
  await copy.click();await page.waitForFunction(()=>typeof window.__compactShopCopied==='string');assert.match(await page.evaluate(()=>window.__compactShopCopied),/Pork Sausages/);
  await finish.click();const confirm=page.locator('#bb172ShopConfirm');await confirm.waitFor({state:'visible'});
  const save=confirm.getByRole('button',{name:/^Save \d+(?: items?)? for another shop$/});if(await save.count())await save.click();else await confirm.getByRole('button',{name:'Finish shop',exact:true}).click();
  await shell.waitFor({state:'detached'});purchased=await state(page);assert.equal(purchased.features.essentials.find(row=>row.id==='toilet-rolls').ownedQty,14);assert.deepEqual(purchased.stock,before.stock,'Finish cannot credit the selected purchase twice');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__compactShopQA?.ready());assert.equal((await state(page)).features.essentials.find(row=>row.id==='toilet-rolls').ownedQty,14);assert.deepEqual((await state(page)).stock,before.stock);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

