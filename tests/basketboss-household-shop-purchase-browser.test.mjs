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
 summary:()=>bb321WeeklySummary()
};`;

async function fixture(width,{online=false,name='Toilet rolls',recipeId=null,stock={'rice|g':16},remoteStock=null,seedReceipts=false}={}){
 const latency=150;
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
 return {page,context,errors,remote,inventoryWrites};
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
function assertHousehold(snapshot,quantity){
 const item=snapshot.features.essentials.find(row=>row.id==='toilet-rolls');
 assert.equal(item.targetQty,5);assert.equal(item.ownedQty,2+quantity,'the purchased number of rolls increases household ownership');
 assert.equal(item.unit,'each');assert.equal(item.owned,true);assert.equal(item.manualPending,false);
 assert.deepEqual(snapshot.stock,{'rice|g':16},'a household purchase never enters measured food stock');
 assert.equal(Object.values(snapshot.inventory).some(row=>/toilet/i.test(row.name)),false,'a household purchase never enters Cupboard, Fridge or Freezer');
 const receipt=Object.values(snapshot.receipts).filter(row=>row.stockBasis==='household-purchase'&&/toilet/i.test(row.name));
 assert.equal(receipt.length,1,'one purchase has one household replay proof');assert.equal(receipt[0].credited,quantity);
}
for(const width of [320,390])for(const chosenQuantity of [null,12])test(`weekly essentials target 5, owned 2, ${chosenQuantity?'green Buying 12':'default Buying 3'} credits only household stock at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const name=width===390?'ToiletRolls':'Toilet rolls',quantity=chosenQuantity||3;
 const {page,context,errors}=await fixture(width,{online:width===390,name});
 try{
  if(width===390)await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  const before=await current(page),summary=await page.evaluate(()=>window.__householdPurchaseQA.summary()),essential=summary.essentials.find(row=>row.id==='toilet-rolls');
  assert.equal(before.features.essentials[0].name,name,'display classification preserves the stored household name');
  assert.equal(essential.qty,3,'five required less two owned leaves three to buy');assert.equal(before.features.essentials[0].ownedQty,2);
  const shell=await openShop(page),row=rowFor(shell);assert.match(await row.locator('.bbcompact-qty').textContent(),/3.*needed|Need.*3/i);
  if(chosenQuantity){
   await row.locator('.bb-shop-buying-pill').click();const panel=row.locator('.bb-shop-pack-picker');await panel.waitFor({state:'visible'});
   await panel.locator('[data-bb-pack-preset="12"]').click();await panel.waitFor({state:'hidden'});
   assert.equal((await current(page)).features.essentials[0].ownedQty,2,'planning a 12-roll pack does not own it before ticking');
   assert.equal((await current(page)).ticks[essentialId],undefined);
   assert.deepEqual((await current(page)).stock,before.stock);
   assert.match(await row.locator('.bb-shop-buying-pill').textContent(),/12/);
  }
  await row.locator('.bb172-storefront-checkbox').click();
  await page.waitForFunction(id=>window.__householdPurchaseQA.state().ticks[id]===true,essentialId).catch(async error=>{throw Error(error.message+'\nActual purchase state: '+JSON.stringify(await current(page)));});
  assert.equal(await row.locator('.bb172-storefront-checkbox').isChecked(),true,'the household purchase remains checked');
  const bought=await current(page);assertHousehold(bought,quantity);assert.equal(bought.purchases[essentialId].actualQty,quantity);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__householdPurchaseQA?.ready());
  let reloaded=await current(page);assertHousehold(reloaded,quantity);assert.equal(reloaded.ticks[essentialId],true,'reload retains the bought check');
  const reopened=await openShop(page);assert.equal(await rowFor(reopened).locator('.bb172-storefront-checkbox').isChecked(),true);
  if(width===390)await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());
  await finish(page,reopened);assertHousehold(await current(page),quantity);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__householdPurchaseQA?.ready());assertHousehold(await current(page),quantity);
  await page.evaluate(()=>window.__householdPurchaseQA.home());
  const weekly=page.locator('#bbKitchenSections').getByRole('tab',{name:'Weekly essentials',exact:true});await weekly.click();
  const household=page.locator('#bbKitchenEssentials'),confirmed=household.locator('.bbec-list>li').filter({hasText:/Toilet\s*rolls/i});
  await confirmed.waitFor({state:'visible'});assert.match(await confirmed.innerText(),/Already at home.*Nothing to buy/);
  await confirmed.getByRole('button',{name:'Amend '+name,exact:true}).click();
  const editor=page.locator('#bbEssentialConfirm');assert.equal(await editor.getByRole('spinbutton',{name:'Already at home',exact:true}).inputValue(),String(2+quantity));
  assert.equal(await editor.getByRole('spinbutton',{name:'Total needed this week',exact:true}).inputValue(),'5');
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();assertHousehold(await current(page),quantity);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});


async function assertReadableVisible(scope,label){
 await scope.waitFor({state:'visible'});const text=await scope.innerText();
 assert.doesNotMatch(text,/\b\d+\.\d{3,}\b/,label+' never exposes long calculation decimals');
 assert.doesNotMatch(text,/\b(?:NaN|undefined|Infinity)\b/,label+' never exposes invalid numeric labels');
 return text;
}
const priceValue=text=>{const match=String(text).match(/[£$]\s*([\d,]+(?:\.\d+)?)/);assert.ok(match,'a usable numeric estimate is shown: '+text);return Number(match[1].replaceAll(',',''));};
const rowPriceValue=async row=>priceValue(await row.locator('.bbcompact-price').innerText());
const totalPriceValue=async shell=>{const expanded=priceValue(await shell.locator('.bb172-storefront-stat.is-estimate strong').textContent()),compact=priceValue(await shell.locator('.bb172-storefront-compact-budget strong').textContent());assert.equal(compact,expanded,'expanded and compact shopping headers show the same estimate');return expanded;};
const frozenPriceKeys=summary=>[...(summary.items||[]),...(summary.essentials||[])].map(({key,name,unit,required,pantryUsed,toBuy,qty,priceQuote})=>({key,name,unit,required,pantryUsed,toBuy,qty,priceQuote}));

for(const width of [320,390])test(`scaled quantities remain readable across Shop, At home, Plan and Day done at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const stock={'rice|g':16.666667,'cheddar|g':500.333333,'chicken breast|g':900.666667,'soured cream|g':200.666667,'tortilla wraps|each':4.333333,'lime|each':1.333333};
 const {page,context,errors}=await fixture(width,{recipeId:'fajitas',stock});
 try{
  const precise=await page.evaluate(()=>window.__householdPurchaseQA.precise('fajitas')),shell=await openShop(page);
  await assertReadableVisible(shell,'Shop');
  for(const row of await shell.locator('.bbcompact-shop-row').all()){
   await row.locator('.bbcompact-toggle').click();await assertReadableVisible(row,'Shop details');
   await row.locator('.bbcompact-toggle').click();
  }
  await page.evaluate(()=>window.__householdPurchaseQA.home());
  const all=page.locator('[role="tab"][data-bbpi-storage="all"]');await all.click();
  await page.locator('.bbpi-summary-row').first().waitFor({state:'visible'});await assertReadableVisible(page.locator('#app'),'At home');
  await page.evaluate(()=>window.__householdPurchaseQA.plan());await assertReadableVisible(page.locator('#app'),'Plan');
  const friday=page.locator('.bbnext-day[data-bbnext-day="Friday"]');await friday.locator('.bbnext-day-description>strong').click();
  await friday.locator('[data-bb-day-done="Friday"]').click();
  const done=page.locator('.bb-day-done-dialog');await done.locator('.bb-day-done-ingredient-table tbody tr').first().waitFor({state:'visible'});
  await assertReadableVisible(done,'Day done');
  const raw=await done.locator('[data-bb-day-quantity-field="required"]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.bbDayRawAmount)));
  assert.ok(raw.some(value=>Math.abs(value-Math.round(value))>.000001),'the readability audit exercises real fractional recipe requirements');
  await done.getByRole('button',{name:'Not yet',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.__householdPurchaseQA.precise('fajitas')),precise,'opening the four screens does not round or rewrite source quantities');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('unpriced toilet rolls show a UI estimate, scale selected packs and accept an edited total without altering the core quote',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{online:true,name:'ToiletRolls'});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  const core=await page.evaluate(()=>window.__householdPurchaseQA.summary()),essential=core.essentials.find(row=>row.id==='toilet-rolls');assert.equal(essential.priceQuote.amount,null);
  const source=frozenPriceKeys(core),shell=await openShop(page),row=rowFor(shell);assert.equal(await rowPriceValue(row),2.50);assert.equal(await totalPriceValue(shell),2.50);
  assert.doesNotMatch(await assertReadableVisible(shell,'Unpriced household shopping'),/Check estimate/);
  await row.locator('.bb-shop-buying-pill').click();const pack=row.locator('.bb-shop-pack-picker');await pack.locator('[data-bb-pack-preset="12"]').click();await pack.waitFor({state:'hidden'});
  assert.equal(await rowPriceValue(row),10);assert.equal(await totalPriceValue(shell),10,'the displayed header follows the selected 12-roll purchase');
  assert.equal((await current(page)).features.essentials[0].ownedQty,2,'changing a pack estimate cannot buy household stock');
  await row.locator('.bbcompact-price').click();const editor=row.locator('.bb-shop-pack-picker');await editor.waitFor({state:'visible'});
  const price=editor.locator('[data-bb-pack-price]');assert.equal(await price.evaluate(node=>node===document.activeElement),true,'the visible price opens its editable total directly');
  await price.fill('3.99');await editor.locator('.bb-shop-pack-save').click();await editor.waitFor({state:'hidden'});
  assert.equal(await rowPriceValue(row),3.99);assert.equal(await totalPriceValue(shell),3.99);
  assert.deepEqual(frozenPriceKeys(await page.evaluate(()=>window.__householdPurchaseQA.summary())),source,'fallback and edited estimates leave the underlying quantity and price quote unchanged');
  await page.evaluate(()=>window.__householdPurchaseQA.plan());assert.equal(priceValue(await page.locator('#myWeekEstimatedTotal').innerText()),3.99,'Plan uses the same displayed remaining estimate');
  const reopened=await openShop(page);await rowFor(reopened).locator('.bb172-storefront-checkbox').click();await page.waitForFunction(()=>window.__householdPurchaseQA.state().ticks['ess:toilet-rolls']===true);
  assertHousehold(await current(page),12);assert.equal(await totalPriceValue(reopened),0,'buying the item removes its estimate from what remains');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

for(const name of ['Unpriced laundry pods','Festival grain blend'])test(`custom ${name} retains a numeric editable shopping estimate`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const household=/laundry/.test(name),stock=household?{'rice|g':16}:{'rice|g':16,'festival grain blend|g':2};
 const {page,context,errors}=await fixture(390,{name:household?name:'Toilet rolls',stock});
 try{
  let id=essentialId;
  if(!household){
   const added=await page.evaluate(name=>window.__householdPurchaseQA.manual(name,'200 g'),name);assert.equal(added.ok,true);
   const summary=await page.evaluate(()=>window.__householdPurchaseQA.summary()),food=summary.items.find(row=>row.key.includes('festival grain blend'));assert.ok(food);id=food.key+'|'+food.unit;
  }
  const core=await page.evaluate(()=>window.__householdPurchaseQA.summary()),shell=await openShop(page),row=shell.locator('[data-bb-shop-purchase-id="'+id+'"]'),record=household?core.essentials.find(row=>row.id==='toilet-rolls'):core.items.find(row=>row.key+'|'+row.unit===id),base=record.priceQuote.amount;
  assert.equal(await rowPriceValue(row),base===null?2.50:base,'known custom quotes stay unchanged; an unknown quote receives only a view guide');
  assert.doesNotMatch(await assertReadableVisible(row,'Custom shopping row'),/Check estimate/);
  await row.locator('.bbcompact-price').click();const editor=row.locator('.bb-shop-pack-picker');await editor.waitFor({state:'visible'});
  await editor.locator('[data-bb-pack-price]').fill('3.99');await editor.locator('.bb-shop-pack-save').click();await editor.waitFor({state:'hidden'});assert.equal(await rowPriceValue(row),3.99);
  const after=await page.evaluate(()=>window.__householdPurchaseQA.summary()),saved=household?after.essentials.find(row=>row.id==='toilet-rolls'):after.items.find(row=>row.key+'|'+row.unit===id);assert.equal(saved.priceQuote.amount,base,'editing a shopping estimate does not write a catalogue or core quote');
  assert.deepEqual((await current(page)).stock,stock,'an estimate edit never adds household or food stock');assert.equal((await current(page)).ticks[id],undefined);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});


const repairState=snapshot=>({stock:snapshot.stock,inventory:snapshot.inventory,features:snapshot.features,receipts:snapshot.receipts});
async function foodAll(page){
 await page.evaluate(()=>window.__householdPurchaseQA.home());
 await page.locator('[role="tab"][data-bbpi-storage="all"]').click();
 await page.locator('.bbpi-summary-row').first().waitFor({state:'visible'});
}
for(const total of [16,18])test(`a tick reviews misplaced household stock and moves the explicitly confirmed ${total} total without buying it again`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors,remote,inventoryWrites}=await fixture(390,{online:true,name:'ToiletRolls',stock:{'rice|g':16,'toiletrolls|each':16},seedReceipts:true});
 try{
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));const initial=repairState(await current(page));
  await foodAll(page);assert.equal(await page.locator('.bbpi-hero-count').textContent(),'1','misplaced household stock is excluded from the food counter');
  assert.equal(await page.locator('.bbpi-summary-row:visible').filter({hasText:/toilet/i}).count(),0);
  assert.deepEqual(repairState(await current(page)),initial,'rendering At home never silently merges or removes a saved balance');
  const shell=await openShop(page),row=rowFor(shell);assert.deepEqual(repairState(await current(page)),initial,'rendering Shop does not repair stock without review');
  await row.locator('.bb172-storefront-checkbox').click();let dialog=page.getByRole('dialog',{name:'Review household stock',exact:true});await dialog.waitFor({state:'visible'});
  assert.equal(await dialog.getByRole('spinbutton',{name:'Actual total of toiletrolls in each',exact:true}).inputValue(),'16','the default is the recorded physical16, never an assumed18');
  assert.equal((await current(page)).ticks[essentialId],undefined);await dialog.getByRole('button',{name:'Not now',exact:true}).click();await dialog.waitFor({state:'detached'});
  assert.deepEqual(repairState(await current(page)),initial,'Not now leaves food, household balances and receipt history unchanged');
  await row.locator('.bb172-storefront-checkbox').click();dialog=page.getByRole('dialog',{name:'Review household stock',exact:true});await dialog.waitFor({state:'visible'});
  if(total===18)await dialog.getByRole('button',{name:'Combine to 18 each total',exact:true}).click();
  assert.equal(await dialog.getByRole('spinbutton',{name:'Actual total of toiletrolls in each',exact:true}).inputValue(),String(total));
  await dialog.getByRole('button',{name:'Move to Weekly essentials',exact:true}).click();await dialog.waitFor({state:'detached'});
  const saved=await current(page),essential=saved.features.essentials.find(row=>row.id==='toilet-rolls');assert.equal(essential.name,'ToiletRolls');assert.equal(essential.unit,'each');assert.equal(essential.targetQty,5);assert.equal(essential.ownedQty,total,'only the confirmed total is retained');
  assert.deepEqual(saved.stock,{'rice|g':16});const old=saved.inventory['cupboard|toiletrolls'];assert.ok(old);assert.equal(old.selected,false);assert.equal(old.qty,0);assert.equal(old.bb173StockKey,undefined);assert.equal(old.bb173StockValue,undefined);
  assert.deepEqual(saved.receipts,initial.receipts,'a reviewed storage move cannot erase or duplicate a purchase receipt');assert.equal(saved.purchases[essentialId],undefined,'moving existing stock does not additionally buy three more rolls');
  await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());assert.deepEqual(remote.stock,{'rice|g':16},'the existing revision-checked sync removes the misplaced food quantity online');assert.ok(inventoryWrites.some(row=>row.action==='confirm_pantry'&&!Object.hasOwn(row.stock,'toiletrolls|each')));
  await foodAll(page);assert.equal(await page.locator('.bbpi-hero-count').textContent(),'1');
  await page.locator('#bbKitchenSections').getByRole('tab',{name:'Weekly essentials',exact:true}).click();const confirmed=page.locator('#bbKitchenEssentials .bbec-list>li').filter({hasText:'ToiletRolls'});await confirmed.getByRole('button',{name:'Amend ToiletRolls',exact:true}).click();
  const edit=page.locator('#bbEssentialConfirm');assert.equal(await edit.getByRole('spinbutton',{name:'Already at home',exact:true}).inputValue(),String(total));assert.equal(await edit.getByRole('spinbutton',{name:'Total needed this week',exact:true}).inputValue(),'5');await edit.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__householdPurchaseQA?.ready());const reloaded=await current(page);assert.deepEqual(reloaded.stock,{'rice|g':16});assert.equal(reloaded.features.essentials.find(row=>row.id==='toilet-rolls').ownedQty,total);assert.deepEqual(reloaded.receipts,initial.receipts);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('reviewing misplaced household stock cannot bypass an unresolved online pantry conflict',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors,remote,inventoryWrites}=await fixture(390,{online:true,name:'ToiletRolls',stock:{'rice|g':16,'toiletrolls|each':16},remoteStock:{'rice|g':8},seedReceipts:true});
 try{
  // Keep the existing legacy cloud-confirmation contract covered. The shipped
  // Account mode uses current At home stock while its guarded outbox waits;
  // that workflow is exercised by account-pantry-live-browser and host tests.
  await page.evaluate(()=>BBReceiptHost.configure({accountPantrySync:false}));
  await page.evaluate(()=>BBReceiptHost.refreshAvailability({force:true,synchronize:true}));
  // A previous online conflict leaves this actor-scoped durable job. The
  // household review must preserve its guard rather than acknowledge it.
  await page.evaluate(()=>{const actorId=BBHome.actor();localStorage.setItem('basketboss_purchase_pantry_sync_v1:'+encodeURIComponent(actorId),JSON.stringify({version:1,actorId,scope:{kind:'user',id:actorId},market:'UK',retailer:null,expectedRevision:3,baselineStock:{'rice|g':8},stock:{'rice|g':16,'toiletrolls|each':16},shopSessionId:window.__householdPurchaseQA.state().session.id,queuedAt:Date.now(),needsReview:true,remoteConflict:true}));});
  const initial=repairState(await current(page)),shell=await openShop(page);await rowFor(shell).locator('.bb172-storefront-checkbox').click();
  const dialog=page.getByRole('dialog',{name:'Review household stock',exact:true});await dialog.waitFor({state:'visible'});await dialog.getByRole('button',{name:'Move to Weekly essentials',exact:true}).click();
  await dialog.waitFor({state:'detached'});const saved=await current(page);assert.deepEqual(saved.stock,{'rice|g':16},'the explicitly reviewed local move retains the local food balance');assert.equal(saved.features.essentials.find(row=>row.id==='toilet-rolls').ownedQty,16);assert.deepEqual(saved.receipts,initial.receipts);assert.equal(saved.ticks[essentialId],undefined);
  const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('basketboss_purchase_pantry_sync_v1:'+encodeURIComponent(BBHome.actor()))));assert.equal(queued.needsReview,true,'a local reviewed repair cannot acknowledge an unrelated online stock conflict');assert.deepEqual(queued.stock,{'rice|g':16});assert.deepEqual(queued.baselineStock,{'rice|g':8});assert.equal(queued.actorId,actor);
  await page.evaluate(()=>BBReceiptHost.retryPurchasedPantry());assert.equal(await page.evaluate(()=>BBReceiptHost.requiresPantryReview()),true);assert.equal(await page.evaluate(()=>BBReceiptHost.canConsumePantry()),false);assert.deepEqual(remote.stock,{'rice|g':8});assert.equal(inventoryWrites.length,0,'an unresolved stock conflict cannot issue a pantry overwrite');assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

for(const count of [1,2])test(`actual scaled fajita shopping buys ${count} whole lime${count===1?'':'s'}, preserves canonical grams and displays counted pantry stock`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{recipeId:'fajitas'}),quantity=count*70;
 try{
  const initial=await page.evaluate(()=>window.__householdPurchaseQA.precise('fajitas')),summary=await page.evaluate(()=>window.__householdPurchaseQA.summary()),lime=summary.items.find(row=>row.key==='lime');assert.ok(lime);assert.equal(lime.unit,'g');assert.equal(lime.toBuy,46.666667);
  const shell=await openShop(page),row=shell.locator('[data-bb-shop-purchase-id="lime|g"]');assert.match(await row.locator('.bb-shop-buying-pill').textContent(),/Buying:\s*1 lime$/i,'a small culinary fraction recommends one physical lime');
  if(count===2){await row.locator('.bb-shop-buying-pill').click();const picker=row.locator('.bb-shop-pack-picker');await picker.locator('[data-bb-pack-preset="2"]').click();await picker.waitFor({state:'hidden'});assert.match(await row.locator('.bb-shop-buying-pill').textContent(),/Buying:\s*2 limes$/i);}
  assert.deepEqual((await current(page)).stock,{'rice|g':16},'a count plan is still read-only until ticked');await row.locator('.bb172-storefront-checkbox').click();
  await page.waitForFunction(quantity=>window.__householdPurchaseQA.state().stock['lime|g']===quantity,quantity);const bought=await current(page);assert.equal(bought.purchases['lime|g'].actualQty,quantity);assert.equal(bought.ticks['lime|g'],true);
  const proof=await page.evaluate(quantity=>BBLooseProduceUI.readStockProof(localStorage,{actor:BBHome.actor(),stockKey:'lime|g',canonicalQuantity:quantity},BBPantryPolicy),quantity);assert.ok(proof);assert.equal(proof.maxCanonicalQuantity,quantity);assert.equal(proof.gramsPerEach,70);
  await foodAll(page);const pantry=page.locator('.bbpi-summary-row').filter({has:page.locator('strong').filter({hasText:/^lime$/i})});assert.equal(await pantry.locator('.bbpi-summary-amount').textContent(),count+' each');assert.equal(await pantry.locator('.bbpi-count-review').count(),0);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__householdPurchaseQA?.ready());await foodAll(page);assert.equal(await pantry.locator('.bbpi-summary-amount').textContent(),count+' each');assert.deepEqual((await current(page)).stock,{'rice|g':16,'lime|g':quantity});
  const final=await page.evaluate(()=>window.__householdPurchaseQA.precise('fajitas'));assert.deepEqual(final.recipe,initial.recipe);assert.deepEqual(final.normalized,initial.normalized,'retail count choices never rewrite scaled source recipe data');assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
