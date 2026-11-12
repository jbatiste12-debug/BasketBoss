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
// purchase quantities, stock reconciliation, or completion behavior.
const bridge=`window.__householdPurchaseQA={
 ready:()=>RECIPES.length===200&&window.BBWeeklyShop&&window.BBHome&&window.BBShopPurchaseUI?.createPicker&&window.BBShopOwnership?.enabled?.(),
 openShop(){tab='shop';render();return window.BBWeeklyShop.start();},
 home(){bb172StorefrontClose();bb172ShopSetActive(false);tab='shop';render();},
 plan(){bb172StorefrontClose();bb172ShopSetActive(false);tab='week';render();},
 extras(){const breakfast=RECIPES.find(bbIsBreakfast),dessert=RECIPES.find(bbIsDessert);if(!breakfast||!dessert)throw Error('Audit requires real breakfast and dessert recipes');state.plannedBreakfasts=[{recipeId:breakfast.id,day:'Friday',servings:4}];state.plannedDesserts=[{recipeId:dessert.id,day:'Friday',servings:4}];render();},
 discover(){bb172StorefrontClose();bb172ShopSetActive(false);tab='discover';render();},
 ordinaryShop(){bb172StorefrontClose();bb172ShopSetActive(false);tab='shop-list';render();},
 precise(id){return {stock:bb307ReadStock(),recipe:getRecipe(id),normalized:BB307_NORMALIZED.find(row=>row.id===id)};},
 dayPreview:()=>BBHome.previewDay({day:'Friday',actorId:BBHome.actor()}),
 manual(name,quantityText){return BBHome.addShoppingBuy({name,quantityText,actorId:BBHome.actor(),requestId:'household-browser-'+name});},
 state:()=>({stock:bb307ReadStock(),inventory:bb83ReadObject(BB83_KITCHEN_INVENTORY),features:bb307ReadFeatures(),ticks:bb321ReadShopTicks(),purchases:bb84ReadPurchased(),receipts:bbBetaReceiptRead(),session:bbShopV7Session(),toast:document.getElementById('toastRoot')?.innerText}),
 aisle:name=>bb172Aisle({name}),
 refresh(){render();bb172StorefrontRefresh();},
 cook(){return openCook('chicken-burgers','Friday','dinner');},
 summary:()=>bb321WeeklySummary()
};`;

async function fixture(width,{holdRules=false,online=false,name='Toilet rolls',recipeId=null,stock={'long-grain rice|g':16},remoteStock=null,seedReceipts=false}={}){
 const latency=150;let releaseRules;const rulesHydrated=new Promise(resolve=>releaseRules=resolve);if(!holdRules)releaseRules();
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const remote={stock:{...(remoteStock??stock)},revision:3},inventoryWrites=[];
 const remoteProjection=()=>({ok:true,stock:{...remote.stock},scope:{kind:'user',id:actor},initialized:true,inventoryRevision:remote.revision,pantryReview:{required:false},inventory:[],essentials:[],receipts:[],priceObservations:[]});
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // Every request, including cloud saves and analytics, is fulfilled locally.
 // There is no route.continue and no opportunity for production writes.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:actor,email:'household-purchase@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/')){
   let data={ok:true};
   if(url.pathname==='/api/subscription/status')data={authenticated:true,tier:'owner',premium:true,premiumAccess:true,mode:'live',subscription:null};
   else if(url.pathname==='/api/household')data={configured:false,premium:true,items:[]};
   else if(url.pathname==='/api/receipt-inventory'){
    if(!online)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,configured:false,available:false})});
    if(url.searchParams.get('mode')==='status')data={ok:true,configured:true,available:true,premium:true};
    else if(route.request().method()==='POST'){
     const body=route.request().postDataJSON();inventoryWrites.push(body);
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
  if(relative==='bb-kitchen-choice-rules.mjs')await rulesHydrated;
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
 await context.addInitScript(({actor,recipeId,stock,name,seedReceipts})=>{
  if(localStorage.getItem('household-purchase-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'household-purchase@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:recipeId?[{recipeId,day:'Friday',servings:4}]:[],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_v172_weekly_budget_v1','200');
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[{id:'toilet-rolls',name,qty:5,unit:'each',targetQty:5,ownedQty:2,manualPending:true,selected:true,owned:false,estimatedPackPrice:null}]}));
  localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify(stock));
  const inventory={};
  for(const [id,qty]of Object.entries(stock)){
   const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1),loc=/toilet/i.test(name)?'cupboard':'fridge';
   inventory[loc+'|'+name]={name,loc,selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty};
  }
  localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify(inventory));
  if(seedReceipts)localStorage.setItem('basketboss_purchase_receipts_v1',JSON.stringify({'previous-trip|toiletrolls|each':{name:'ToiletRolls',unit:'each',qty:16,credited:16,stockBasis:'full-purchase',week:'previous-trip',purchasedAt:'2026-11-10T10:00:00.000Z'}}));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','UK');
  localStorage.setItem('household-purchase-fixture-v1','1');
 },{actor,recipeId,stock,name,seedReceipts});
 await context.addInitScript(()=>{const vv=new EventTarget();Object.assign(vv,{height:innerHeight,width:innerWidth,offsetTop:0,offsetLeft:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});window.__auditKeyboard=(height,top=0)=>{Object.assign(vv,{height,width:innerWidth,offsetTop:top});vv.dispatchEvent(new Event('resize'));window.BBKeyboardLayout?.refresh();};});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__householdPurchaseQA?.ready());
 return {page,context,errors,remote,inventoryWrites,releaseRules};
}

const findings=[];
const nativeCss=await fs.readFile(path.join(root,'native/bb-native.css'),'utf8');
async function fonts(page,label){
 const rows=await page.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]),select,textarea').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(n=>({tag:n.tagName,id:n.id,type:n.type,classes:n.className,font:parseFloat(getComputedStyle(n).fontSize)})));
 findings.push({view:label,fields:rows,small:rows.filter(n=>n.font<16)});
 assert.deepEqual(rows.filter(n=>n.font<16),[],label+' editable controls prevent iOS auto-zoom');
 await page.locator('html').evaluate(n=>n.classList.add('bb-native-ios'));
 const nativeRows=await page.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]),select,textarea').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(n=>({id:n.id,type:n.type,font:parseFloat(getComputedStyle(n).fontSize)})));
 assert.deepEqual(nativeRows.filter(n=>n.font<16),[],label+' native controls prevent auto-zoom');
 findings.push({view:label+' native',fields:nativeRows,small:nativeRows.filter(n=>n.font<16)});
 await page.locator('html').evaluate(n=>n.classList.remove('bb-native-ios'));
}
for(const width of [320,375,768,1024,1366])test('release iOS/iPad editable-field and footer audit '+width,{timeout:120000},async()=>{
 const {page,context,errors}=await fixture(width,{recipeId:'chicken-burgers'});
 try{
  await page.setViewportSize({width,height:width===320?568:width===375?812:width===1366?1024:width===1024?768:1024});
  await page.addStyleTag({content:nativeCss});
  await page.evaluate(()=>window.__auditKeyboard(innerHeight));await page.waitForTimeout(80);
  await page.waitForFunction(()=>window.BBShopPurchaseHost?.isReady());
  await page.evaluate(()=>window.__householdPurchaseQA.plan());await page.evaluate(()=>window.__householdPurchaseQA.extras());await page.locator('#app details').evaluateAll(ns=>ns.forEach(n=>n.open=true));await fonts(page,'Plan '+width);
  const budget=page.locator('.bb-r7-budget-pill');if(await budget.isVisible())await budget.click();await page.locator('#bbSimpleBudget').evaluate(n=>n.open=true);await page.locator('#bb77BudgetTarget').waitFor({state:'visible'});assert.equal(await page.locator('select[data-extra-move]').count(),2);await fonts(page,'Budget and extra meals '+width);
  await page.locator('.bbui-settings-trigger').first().click();await page.locator('.bbui-settings-panel').waitFor();await fonts(page,'Settings '+width);await page.locator('.bbui-settings-close').click();
  await page.evaluate(()=>window.__householdPurchaseQA.discover());await fonts(page,'Discover '+width);
  await page.evaluate(()=>window.__householdPurchaseQA.plan());await page.evaluate(()=>window.__householdPurchaseQA.cook());await page.locator('.cook-overlay').waitFor();await fonts(page,'Cook '+width);await page.locator('#bbExit').click();
  const day=page.locator('.bbnext-day[data-bbnext-day=Friday]');await day.evaluate(n=>n.open=true);await day.locator('[data-bb-day-done=Friday]').click();await page.locator('.bb-day-done-dialog').waitFor();await fonts(page,'Day done '+width);await page.locator('.bb-day-done-dialog [data-bb-day-action=close]').click();
  await page.evaluate(()=>window.__householdPurchaseQA.home());await page.locator('[data-bbpi-storage=all]').click();await fonts(page,'At home '+width);
  await page.locator('#bbKitchenEssentialsTab').click();await fonts(page,'Weekly essentials '+width);await page.locator('#bbKitchenFoodTab').click();
  const docks=await page.locator('nav#bbPrimaryNavigation[data-bb-navigation]').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,bottom:r.bottom};}));assert.ok(docks.length);for(const b of docks)assert.ok(b.x>=-1&&b.right<=page.viewportSize().width+1&&b.y>=0&&b.bottom<=page.viewportSize().height+1,'primary dock stays in iPad/phone viewport');
  const row=page.locator('.bbpi-summary-row').filter({hasText:/rice/i}).first();await row.getByRole('button',{name:/^Edit (?:long-grain )?rice in /i}).click();await fonts(page,'Pantry modal '+width);await page.locator('#bbpi-current-editor .bbpi-close').click();
  await page.evaluate(()=>window.__householdPurchaseQA.openShop());const shell=page.locator('#bb172Storefront');await shell.waitFor();await fonts(page,'Shop '+width);
  await page.evaluate(()=>window.__householdPurchaseQA.ordinaryShop());await page.locator('.bb-shop-add-open').click();const add=page.locator('.bb-shop-add-dialog');await add.waitFor();await add.locator('input[name=name]').fill('Rice');await add.locator('input[name=quantityText]').fill('1');await fonts(page,'Shop add modal '+width);await page.evaluate(()=>window.__auditKeyboard(350));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await add.locator('button[type=submit]').evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const addButton=await add.locator('button[type=submit]').boundingBox();assert.ok(addButton&&addButton.y>=0&&addButton.y+addButton.height<=350,'modal confirm remains above keyboard: '+JSON.stringify({addButton,dialog:await add.boundingBox(),scroll:await add.evaluate(n=>n.scrollTop),html:await page.locator('html').getAttribute('class')}));await add.getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>window.__auditKeyboard(innerHeight));await page.evaluate(()=>window.__householdPurchaseQA.openShop());await shell.waitFor();
  const buns=shell.locator('[data-bb-shop-purchase-id="brioche buns|each"]');await buns.locator('.bb-shop-buying-pill').click();await buns.locator('[data-bb-pack-preset="custom"]').click();await fonts(page,'Custom pack '+width);
  const bars=await page.locator('#bb172Storefront button').filter({hasText:/^Finish shop$/}).evaluateAll(ns=>ns.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right,visible:!!n.getClientRects().length};}));findings.push({view:'Footer '+width,bars,viewport:page.viewportSize()});for(const box of bars)assert.ok(box.x>=0&&box.right<=page.viewportSize().width+1&&box.y>=0&&box.bottom<=page.viewportSize().height+1,'iPad/phone footer stays in bounds');

  await buns.locator('.bb-shop-pack-price').focus();await page.evaluate(()=>window.__auditKeyboard(350));await page.waitForTimeout(100);
  const structure=await shell.evaluate(node=>({cls:node.className,style:{display:getComputedStyle(node).display,height:getComputedStyle(node).height},children:[...node.children].map(n=>({tag:n.tagName,id:n.id,cls:n.className,display:getComputedStyle(n).display,overflowY:getComputedStyle(n).overflowY}))}));
  await buns.locator('.bb-shop-pack-save').evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));
  findings.push({view:'Keyboard '+width,structure,action:await buns.locator('.bb-shop-pack-save').boundingBox(),footer:await shell.getByRole('button',{name:'Finish shop',exact:true}).boundingBox(),visibleHeight:350,active:await page.evaluate(()=>document.documentElement.className)});
  const overlap=async label=>findings.push({view:label+' '+width,save:await buns.locator('.bb-shop-pack-save').evaluate(n=>{const b=n.getBoundingClientRect(),f=document.querySelector('.bb172-storefront-bottom').getBoundingClientRect();return{top:b.top,bottom:b.bottom,footerTop:f.top,footerStyle:{height:getComputedStyle(document.querySelector('.bb172-storefront-bottom')).height,padding:getComputedStyle(document.querySelector('.bb172-storefront-bottom')).padding,minHeight:getComputedStyle(document.querySelector('.bb172-storefront-bottom')).minHeight},centerHit:n.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),bottomHit:n.contains(document.elementFromPoint(b.x+b.width/2,b.bottom-2))};})});
  await overlap('Keyboard action hit areas');
  const checked=findings.at(-1).save;
  assert.equal(checked.centerHit,true,'Save center remains tappable above keyboard');assert.equal(checked.bottomHit,true,'Save bottom is not covered by Finish bar');assert.ok(checked.bottom<=checked.footerTop,'Finish footer cannot cover Save');
  const finish=await shell.getByRole('button',{name:'Finish shop',exact:true}).boundingBox();assert.ok(finish&&finish.y>=0&&finish.y+finish.height<=350,'Finish remains inside visual viewport');


  await page.evaluate(()=>window.__auditKeyboard(innerHeight));
  assert.deepEqual(errors,[]);
 }finally{await context.close();await fs.writeFile('/tmp/bb-ios-release-viewport-report.json',JSON.stringify(findings,null,2));}
});

test('stalled classifier falls back to the bundled unchanged rules and allows safe household purchase',{timeout:45000},async()=>{
 const {page,context,errors,releaseRules}=await fixture(375,{holdRules:true});
 try{
  await page.waitForFunction(()=>window.BBShopPurchaseHost?.isReady(),{},{timeout:15000});
  assert.equal(await page.evaluate(()=>BBKitchenEssentials.loadRules.status().source),'fallback');
  assert.equal(await page.evaluate(()=>BBKitchenChoiceRules.isHousehold('Toilet Rolls')),true);
  assert.equal(await page.evaluate(()=>BBKitchenChoiceRules.isHousehold('Chicken breast')),false);
  const before=await page.evaluate(()=>window.__householdPurchaseQA.state().stock);await page.evaluate(()=>window.__householdPurchaseQA.openShop());
  const row=page.locator('[data-bb-shop-purchase-id="ess:toilet-rolls"]');await row.locator('.bb-shop-buying-pill').click();await row.locator('[data-bb-pack-preset="12"]').click();await row.locator('.bb172-storefront-checkbox').click();
  await page.waitForFunction(()=>window.__householdPurchaseQA.state().features.essentials.find(r=>r.id==='toilet-rolls').ownedQty===14);
  assert.deepEqual(await page.evaluate(()=>window.__householdPurchaseQA.state().stock),before,'fallback never routes household purchase into food stock');assert.deepEqual(errors,[]);
 }finally{releaseRules();await context.close();}
});
