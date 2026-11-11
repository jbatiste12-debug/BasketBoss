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
 precise(id){return {stock:bb307ReadStock(),recipe:getRecipe(id),normalized:BB307_NORMALIZED.find(row=>row.id===id)};},
 dayPreview:()=>BBHome.previewDay({day:'Friday',actorId:BBHome.actor()}),
 manual(name,quantityText){return BBHome.addShoppingBuy({name,quantityText,actorId:BBHome.actor(),requestId:'household-browser-'+name});},
 state:()=>({stock:bb307ReadStock(),inventory:bb83ReadObject(BB83_KITCHEN_INVENTORY),features:bb307ReadFeatures(),ticks:bb321ReadShopTicks(),purchases:bb84ReadPurchased(),receipts:bbBetaReceiptRead(),session:bbShopV7Session(),toast:document.getElementById('toastRoot')?.innerText}),
 aisle:name=>bb172Aisle({name}),
 refresh(){render();bb172StorefrontRefresh();},
 cook(){return openCook('chicken-burgers','Friday','dinner');},
 summary:()=>bb321WeeklySummary()
};`;

async function fixture(width,{holdRules=false,online=false,name='Toilet rolls',recipeId=null,stock={'rice|g':16},remoteStock=null,seedReceipts=false}={}){
 const latency=150;let releaseRules;const rulesHydrated=new Promise(resolve=>releaseRules=resolve);if(!holdRules)releaseRules();
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const remote={stock:{...(remoteStock??stock)},revision:3},inventoryWrites=[];
 const remoteProjection=()=>({ok:true,stock:{...remote.stock},scope:{kind:'user',id:actor},initialized:true,inventoryRevision:remote.revision,pantryReview:{required:false},inventory:[],essentials:[],receipts:[],priceObservations:[]});
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
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
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__householdPurchaseQA?.ready());
 return {page,context,errors,remote,inventoryWrites,releaseRules};
}


const essentialId='ess:toilet-rolls';
const current=page=>page.evaluate(()=>window.__householdPurchaseQA.state());
const rowFor=shell=>shell.locator('[data-bb-shop-purchase-id="'+essentialId+'"]');
async function openShop(page){
 assert.equal(await page.evaluate(()=>window.__householdPurchaseQA.openShop()),true);
 const shell=page.locator('#bb172Storefront');await shell.waitFor({state:'visible'});
 await shell.getByRole('button',{name:'All items',exact:true}).click();await rowFor(shell).waitFor({state:'visible'});return shell;
}
async function finish(page,shell){
 await shell.getByRole('button',{name:'Finish shop',exact:true}).click();
 const dialog=page.locator('#bb172ShopConfirm');await dialog.waitFor({state:'visible'});
 await dialog.getByRole('button',{name:'Finish shop',exact:true}).click();await shell.waitFor({state:'detached'});
}

const visualIssues=[],visited=[];
async function scanText(page,label){
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const issues=await page.evaluate(()=>{
  const found=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  for(let node;node=walker.nextNode();){
   const el=node.parentElement,text=node.nodeValue?.trim();if(!el||!text||el.closest('script,style,noscript,[hidden],[aria-hidden="true"]'))continue;
   const range=document.createRange();range.selectNodeContents(node);
   if(!range.getClientRects().length||getComputedStyle(el).visibility==='hidden')continue;
   const quantityText=text.replace(/[£$€]\s*\d[\d,]*(?:\.\d{2})?\b/g,'PRICE');
   if(/\b(?:NaN|undefined|null|Infinity)\b|Check estimate/i.test(text)||/\b\d+\.\d{2,}\b/.test(quantityText)){
    const selector=el.id?'#'+el.id:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,3).join('.'):'');
    found.push({selector,text});
   }
  }return found;
 });
 visited.push(label);for(const issue of issues){const entry={view:label,...issue};visualIssues.push(entry);console.log('GATE_UI_VIOLATION '+JSON.stringify(entry));}
}
const persisted=snapshot=>{const {toast,...saved}=snapshot;return saved;};
const foodRow=shell=>shell.locator('[data-bb-shop-purchase-id="brioche buns|each"]');
async function finishCurrent(page,shell){
 await shell.getByRole('button',{name:'Finish shop',exact:true}).click();await scanText(page,'Finish shop confirmation');
 const dialog=page.locator('#bb172ShopConfirm'),save=dialog.getByRole('button',{name:/^Save \d+(?: items?)? for another shop$/});
 if(await save.count())await save.click();else await dialog.getByRole('button',{name:'Finish shop',exact:true}).click();
 await shell.waitFor({state:'detached'});
}
async function isolateControls(page,shell,id){
 const row=shell.locator('[data-bb-shop-purchase-id="'+id+'"]'),before=persisted(await current(page)),checked=await row.locator('.bb172-storefront-checkbox').isChecked();
 for(const control of ['.bb-shop-buying-pill','.bbcompact-price','.bbcompact-toggle']){
  const target=await row.locator(control).boundingBox();assert.ok(target&&target.width>=44&&target.height>=44,control+' is at least 44px in each dimension: '+JSON.stringify({target,style:await row.locator(control).evaluate(node=>{const s=getComputedStyle(node);return {height:s.height,minHeight:s.minHeight,width:s.width,minWidth:s.minWidth,padding:s.padding,transform:s.transform};})}));
  await row.locator(control).click();await scanText(page,'Shopping '+control+' '+id);
  assert.deepEqual(persisted(await current(page)),before,'opening a Buying/price/details control cannot alter purchases or pantry');
  assert.equal(await row.locator('.bb172-storefront-checkbox').isChecked(),checked,'an independent control cannot toggle the checkbox');
  if(control==='.bb-shop-buying-pill')await row.locator(control).click();
  else if(control==='.bbcompact-price')await row.locator('.bb-shop-pack-picker').getByRole('button',{name:'Cancel',exact:true}).click();
  else await row.locator(control).click();
 }
}
test('sequential final release gate: cold start, food six-pack, Day done leftovers, household purchase and all visible readouts',{skip:!chromium&&'Playwright unavailable',timeout:240000},async()=>{
 const initial={'chicken breast|g':200,'rice|g':16.666667,'cheddar|g':240,'milk|ml':568.333333};
 const {page,context,errors,releaseRules}=await fixture(390,{holdRules:true,recipeId:'chicken-burgers',stock:initial});
 try{
  const precise=await page.evaluate(()=>window.__householdPurchaseQA.precise('chicken-burgers'));
  let shell=await openShop(page),essential=rowFor(shell);assert.equal(await page.evaluate(()=>BBShopPurchaseHost.isReady()),false);
  const cold=await current(page);await essential.locator('.bb172-storefront-checkbox').click();
  const blocked=await current(page);assert.deepEqual(blocked.stock,cold.stock);assert.deepEqual(blocked.ticks,cold.ticks);assert.deepEqual(blocked.features,cold.features);assert.match(blocked.toast,/still loading/);await scanText(page,'Cold-start blocked purchase toast');
  releaseRules();await page.waitForFunction(()=>window.BBShopPurchaseHost?.isReady()===true);
  await page.evaluate(()=>window.__householdPurchaseQA.refresh());shell=page.locator('#bb172Storefront');
  for(const name of ['To buy','All items']){
   await page.setViewportSize({width:name==='To buy'?375:390,height:844});
   await shell.getByRole('button',{name,exact:true}).click();await scanText(page,'Shop '+name);
   await isolateControls(page,shell,'brioche buns|each');await isolateControls(page,shell,essentialId);
  }
  let buns=foodRow(shell);assert.match(await buns.locator('.bbcompact-qty').textContent(),/4.*needed/);
  const before=await current(page);await buns.locator('.bb-shop-buying-pill').click();
  await buns.locator('[data-bb-pack-preset="6"]').click();assert.deepEqual((await current(page)).stock,before.stock);assert.deepEqual((await current(page)).ticks,before.ticks);
  await buns.locator('.bb172-storefront-checkbox').click();await page.waitForFunction(()=>window.__householdPurchaseQA.state().stock['brioche buns|each']===6);
  assert.equal(await buns.locator('.bb172-storefront-checkbox').isChecked(),true);await isolateControls(page,shell,'brioche buns|each');await scanText(page,'Bought six buns');
  await finishCurrent(page,shell);assert.equal((await current(page)).stock['brioche buns|each'],6);
  await page.evaluate(()=>window.__householdPurchaseQA.home());await page.locator('[role="tab"][data-bbpi-storage="all"]').click();await scanText(page,'At home all food');
  const oldStock=(await current(page)).stock,rice=page.locator('.bbpi-summary-row').filter({has:page.locator('strong').filter({hasText:/^rice$/i})});
  await rice.getByRole('button',{name:/Edit rice/i}).click();await scanText(page,'At home precise quantity editor');
  await page.locator('#bbpi-current-editor .bbpi-close').click();assert.deepEqual((await current(page)).stock,oldStock,'opening pantry editors never changes six-decimal stored amounts');
  await page.evaluate(()=>window.__householdPurchaseQA.plan());await scanText(page,'Plan dinner list');
  await page.locator('#app details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));await scanText(page,'Plan budget and preferences disclosures');await page.locator('#app details').evaluateAll(nodes=>nodes.forEach(node=>node.open=false));await page.getByRole('tab',{name:'School lunches (0/5)',exact:true}).evaluate(node=>node.scrollIntoView({block:'center'}));
  await page.getByRole('tab',{name:'School lunches (0/5)',exact:true}).click();await scanText(page,'School lunches planner');await page.getByRole('tab',{name:'Dinners (1/7)',exact:true}).click();
  const friday=page.locator('.bbnext-day[data-bbnext-day="Friday"]');if(!await friday.evaluate(node=>node.open))await friday.locator('.bbnext-day-description>strong').click();await scanText(page,'Plan expanded meal');
  await page.evaluate(()=>window.__householdPurchaseQA.cook());await page.locator('.cook-overlay').waitFor({state:'visible'});await scanText(page,'Cook preparation');
  for(const details of await page.locator('.cook-overlay details').all())await details.evaluate(node=>node.open=true);
  await scanText(page,'Cook preparation notes');await page.locator('#bbPhaseCook').click();await scanText(page,'Cook method');await page.locator('#bbExit').click();
  await friday.locator('[data-bb-day-done="Friday"]').click();const done=page.locator('.bb-day-done-dialog');
  await done.locator('.bb-day-done-ingredient-table tbody tr').first().waitFor();await scanText(page,'Day done ingredient confirmation');
  for(const details of await done.locator('details').all())await details.evaluate(node=>node.open=true);
  await scanText(page,'Day done amount details');const bunLine=done.locator('tbody tr').filter({hasText:/brioche buns/i});assert.match(await bunLine.innerText(),/4 each.*6 each.*2 each/s);
  await done.getByRole('button',{name:'Confirm & update pantry',exact:true}).click();await page.waitForFunction(()=>window.__householdPurchaseQA.state().stock['brioche buns|each']===2);await scanText(page,'Day done success toast');
  assert.equal((await current(page)).stock['rice|g'],16.666667,'an unrelated precise reserve stays exact after cooking');
  shell=await openShop(page);essential=rowFor(shell);assert.equal(await page.evaluate(()=>window.__householdPurchaseQA.aisle('Toilet rolls')),'Household & Other');
  await isolateControls(page,shell,essentialId);await essential.locator('.bb-shop-buying-pill').click();await essential.locator('[data-bb-pack-preset="12"]').click();
  assert.equal((await current(page)).features.essentials[0].ownedQty,2);
  await essential.locator('.bbcompact-price').click();const custom=essential.locator('.bb-shop-pack-picker');await custom.locator('[data-bb-pack-price]').fill('3.99');await custom.getByRole('button',{name:'Save buying amount',exact:true}).click();
  assert.match(await essential.locator('.bbcompact-price').innerText(),/3\.99/);await scanText(page,'Weekly essentials editable guide price');
  await essential.locator('.bb172-storefront-checkbox').click();await page.waitForFunction(()=>window.__householdPurchaseQA.state().features.essentials[0].ownedQty===14);
  assert.equal(await essential.locator('.bb172-storefront-checkbox').isChecked(),true);await isolateControls(page,shell,essentialId);
  const bought=await current(page);assert.equal(Object.keys(bought.stock).some(key=>/toilet/i.test(key)),false);assert.equal(Object.values(bought.inventory).some(item=>/toilet/i.test(item.name)),false);
  await finishCurrent(page,shell);assert.equal((await current(page)).features.essentials[0].ownedQty,14);assert.equal((await current(page)).stock['brioche buns|each'],2);
  await page.evaluate(()=>window.__householdPurchaseQA.home());await page.locator('#bbKitchenEssentialsTab').click();await scanText(page,'At home Weekly essentials');
  const confirmed=page.locator('#bbKitchenEssentials .bbec-list>li').filter({hasText:/Toilet rolls/i});await confirmed.getByRole('button',{name:'Amend Toilet rolls',exact:true}).click();await scanText(page,'Weekly essentials confirmation editor');await page.locator('#bbEssentialConfirm').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('#bbKitchenFoodTab').click();await page.locator('[role="tab"][data-bbpi-storage="all"]').click();
  const stillExact=await current(page);await page.evaluate(()=>{localStorage.setItem('basketboss_321_v7_market','US');window.dispatchEvent(new Event('basketboss:market-changed'));});await scanText(page,'US At home quantities');
  await page.evaluate(()=>window.__householdPurchaseQA.plan());await scanText(page,'US Plan');if(!await page.locator('.bbnext-day[data-bbnext-day="Friday"]').evaluate(node=>node.open))await page.locator('.bbnext-day[data-bbnext-day="Friday"] .bbnext-day-description>strong').click();await scanText(page,'US expanded Plan');
  await page.evaluate(()=>window.__householdPurchaseQA.cook());await page.locator('.cook-overlay').waitFor();await scanText(page,'US Cook prep');await page.locator('#bbPhaseCook').click();await scanText(page,'US Cook method');await page.locator('#bbExit').click();
  assert.deepEqual((await current(page)).stock,stillExact.stock,'regional rendering never changes physical balances');
  const final=await page.evaluate(()=>window.__householdPurchaseQA.precise('chicken-burgers'));assert.deepEqual(final.recipe,precise.recipe);assert.deepEqual(final.normalized,precise.normalized);assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.__householdPurchaseQA.home());await page.locator('#bbKitchenFoodTab').click();await page.locator('[role="tab"][data-bbpi-storage="fridge"]').click();
  await page.evaluate(()=>{window.__nativeUpgradeRoutes=0;window.BBNative={...(window.BBNative||{}),isNative:true};window.BasketBossMembershipUI={...(window.BasketBossMembershipUI||{}),open(){window.__nativeUpgradeRoutes++;return true;}};window.BBPantryCameraHost={...window.BBPantryCameraHost,isPremium:()=>false};});
  await page.locator('.bbpi-ai-scan').click();assert.equal(await page.evaluate(()=>window.__nativeUpgradeRoutes),1,'the actual camera Premium CTA reaches the native Apple membership router');
  assert.equal(await page.locator('#bb173TierDialog[open]').count(),0,'native camera upgrade cannot stop at the web information dialog');
  await page.evaluate(()=>window.BasketBossPremiumPreview.show());assert.equal(await page.evaluate(()=>window.__nativeUpgradeRoutes),2,'the central legacy feature gate reaches the same native router');
  assert.deepEqual(visualIssues,[],'every visited rendered view, modal, drawer and toast satisfies quantity/string gate');
 }finally{
  releaseRules();await fs.writeFile('/tmp/bb-final-release-visual-report.json',JSON.stringify({visited,issues:visualIssues},null,2));await context.close();
 }
});
