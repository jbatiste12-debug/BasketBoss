import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const actor='00000000-0000-4000-8000-000000000065';
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
 plan(){tab='week';render();},
 renderAgain(){render();},
 summary:()=>bb321WeeklySummary(),
 stock:()=>bb307ReadStock(),
 purchase:id=>bb84ReadPurchased()[id],
 pack:(name,unit)=>BBPriceV19.getPack(name,unit,bb307Market),
 catalogue:id=>BBPriceV19.catalog[id],
 cookEvent(){const recipe=getRecipe('chicken-burgers'),slot=state.planned.find(row=>row.recipeId===recipe.id);return {sessionId:'readable-packs-cook',recipeId:recipe.id,day:'Friday',factor:BBServing.ratio(BBServing.forMeal(state,slot,recipe),recipe),actorId:BBHome.actor(),occurrence:bbHomeOccurrence(recipe.id,'Friday')};},
 cookPreview(){return BBHome.previewCook(this.cookEvent());},
 cookFinish(expected){return BBHome.cooked({...this.cookEvent(),expected});},
 snapshot:()=>({storage:Object.fromEntries([KEY,BB307_STOCK_KEY,BB83_KITCHEN_INVENTORY,BB321_SHOP_TICKS_KEY,BB84_PURCHASED_KEY,BB_PARTIAL_PURCHASE_KEY,BB_BETA_RECEIPT_KEY,BB_BETA_CHOICE_KEY,'basketboss_at_home_requirements_v1'].map(key=>[key,localStorage.getItem(key)])),recipe:getRecipe('chicken-burgers'),normalized:BB307_NORMALIZED.find(row=>row.id==='chicken-burgers')}),
 addTiny:()=>BBHome.addShoppingBuy({name:'Chicken breast',quantityText:'0.000001 g',actorId:BBHome.actor(),requestId:'tiny-readable-shop-quantity'})
};`;

async function fixture(width,{recipeId='chicken-burgers',stock={'chicken breast|g':200}}={}){
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


async function openPantry(page){
 if(!await page.evaluate(()=>!!window.BBLooseProduceUI))await page.addScriptTag({content:await fs.readFile(path.join(root,'bb-loose-produce-ui.js'),'utf8')});
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();await page.locator('#bbpiSearch').waitFor();
 await page.locator('[role="tab"][data-bbpi-storage="fridge"]').click();
}
for(const width of [320,390]){
 test(`proven lime stock stays counted after the existing At home stepper at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
  const {page,context,errors}=await fixture(width,{recipeId:null,stock:{'lime|g':140,'toilet roll|each':4}});
  try{
   if(!await page.evaluate(()=>!!window.BBLooseProduceUI))await page.addScriptTag({content:await fs.readFile(path.join(root,'bb-loose-produce-ui.js'),'utf8')});
   const saved=await page.evaluate(()=>BBLooseProduceUI.writeStockProof(localStorage,{actor:BBHome.actor(),stockKey:'lime|g',name:'Lime'},{beforeQuantity:0,afterQuantity:140,selection:BBLooseProduceUI.selection('Lime',2,BBPantryPolicy)},BBPantryPolicy));
   assert.equal(saved.ok,true);assert.equal(saved.recorded,true);
   await openPantry(page);
   const row=page.locator('.bbpi-summary-row').filter({has:page.locator('strong').filter({hasText:/^lime$/i})});
   assert.equal(await row.locator('.bbpi-summary-amount').textContent(),'2 each');
   assert.equal(await row.locator('.bbpi-count-review').count(),0);
   assert.equal(await page.locator('.bbpi-summary-row').filter({hasText:/toilet roll/i}).count(),0,'household stock is not shown as food');
   assert.equal(await page.locator('.bbpi-hero-count').textContent(),'1');
   assert.ok(await page.evaluate(()=>BBPantryEditor.list().some(row=>row.name==='toilet roll')),'the household inventory record remains intact');
   await page.evaluate(()=>window.__produceBeforeAPI=BBPantryEditor);
   await row.getByRole('button',{name:/^More lime in fridge$/i,exact:true}).click();
   await page.waitForFunction(()=>BBHomeHost.stock()['lime|g']===210);
   try{await page.waitForFunction(()=>[...document.querySelectorAll('.bbpi-summary-row')].some(row=>row.querySelector('strong')?.textContent?.toLowerCase()==='lime'&&row.querySelector('.bbpi-summary-amount')?.textContent==='3 each'));}
   catch(error){
    const diagnostic=await page.evaluate(()=>({amount:document.querySelector('.bbpi-summary-amount')?.textContent,proof:localStorage.getItem(BBLooseProduceUI.key),same:BBPantryEditor===window.__produceBeforeAPI,current:window.__produceBeforeAPI.isCurrent(),connected:window.__produceBeforeAPI.card.isConnected,pending:BBPantryLive.hasPending(),status:BBPantryEditor.status(),row:BBPantryEditor.list().find(row=>row.name.toLowerCase()==='lime')}));
    throw Error(error.message+' '+JSON.stringify(diagnostic));
   }
   const data=await page.evaluate(()=>({stock:BBHomeHost.stock(),row:BBPantryEditor.list().find(row=>row.name.toLowerCase()==='lime'),physical:JSON.parse(localStorage.getItem(BBHomeHost.keys().inventory))['fridge|lime'],proof:BBLooseProduceUI.readStockProof(localStorage,{actor:BBHome.actor(),stockKey:'lime|g',canonicalQuantity:210},BBPantryPolicy)}));
   assert.equal(data.stock['lime|g'],210);assert.equal(data.stock['toilet roll|each'],4);assert.equal(data.row.unit,'g');assert.equal(data.row.qty,210);assert.equal(data.physical.bb173StockValue,210);assert.equal(data.physical.unit,'g');assert.equal(data.physical.qty,210);
   assert.equal(data.proof.maxCanonicalQuantity,210);assert.equal(data.physical.retailCount,undefined,'no metadata is appended to the physical inventory row');
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });
 test(`an old unproved kilogram of limes keeps its weight and asks for a count check at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
  const {page,context,errors}=await fixture(width,{recipeId:null,stock:{'lime|g':1000}});
  try{
   await openPantry(page);
   const row=page.locator('.bbpi-summary-row').filter({has:page.locator('strong').filter({hasText:/^lime$/i})});
   assert.match(await row.locator('.bbpi-summary-amount').textContent(),/^(?:1000 g|1 kg)$/);
   assert.equal(await row.locator('.bbpi-count-review').textContent(),'Check count');
   const data=await page.evaluate(()=>({stock:BBHomeHost.stock(),row:BBPantryEditor.list().find(row=>row.name.toLowerCase()==='lime')}));
   assert.deepEqual(data.stock,{'lime|g':1000});assert.equal(data.row.unit,'g');assert.equal(data.row.qty,1000);
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });
}
