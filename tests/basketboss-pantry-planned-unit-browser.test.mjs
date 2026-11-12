import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
const ACTOR='00000000-0000-4000-8000-000000000063';
const MORNAY='smoked-haddock-mornay-with-spinach';
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(ROOT,'catalogues/700/release'),sourceDirectory:ROOT});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// Use the current generated 700 client, the real pantry modal, requirement
// calculation and persistence. Only network and optional mixed-unit source
// requirements are fixtures; no stock or unit implementation is replaced.
const bridge=`window.__plannedUnitQA={
 ready:()=>RECIPES.length===200&&window.BBHome&&window.BBPantryInline,
 summary:()=>bb321WeeklySummary(),
 stock:()=>bb307ReadStock(),
 inventory:()=>JSON.parse(localStorage.getItem('basketboss_makeameal_v1_inventory')||'{}'),
 snapshot:()=>Object.fromEntries(['basketboss_321_v7_measured_pantry','basketboss_makeameal_v1_inventory'].map(key=>[key,localStorage.getItem(key)])),
 plan(){tab='week';render();},
 overview(){tab='shop-list';render();},
 recipe:id=>getRecipe(id)
};`;

async function fixture({width=390,recipeId=MORNAY,servings=4,requirements=null,stock={},inventory={}}={}){
 const source=await fs.readFile(path.join(ROOT,'app.html'),'utf8'),anchor='window.BBHomeHost=Object.freeze({';
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor)
  .replace('requirements:()=>bb321UnifiedShop(bb307Plan().items,true),','requirements:()=>window.__plannedUnitRequirements||bb321UnifiedShop(bb307Plan().items,true),');
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // Every request is fulfilled locally, including authenticated API requests.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:ACTOR,email:'planned-unit@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
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
    try{body=await fs.readFile(path.join(ROOT,relative));}catch{body=await fs.readFile(path.join(ROOT,'catalogues/700/release/assets',relative));}
    if(relative==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(relative==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(relative.endsWith('.js'))body=transform700Presentation(body.toString());
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(relative)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(({actor,recipeId,servings,requirements,stock,inventory})=>{
  window.__plannedUnitRequirements=requirements;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'planned-unit@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:recipeId?[{recipeId,day:'Friday',servings}]:[],plannedBreakfasts:[],plannedDesserts:[],servings,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
  localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify(stock));
  localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify(inventory));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
  localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('basketboss_v172_weekly_budget_target_v1','150');
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
 },{actor:ACTOR,recipeId,servings,requirements,stock,inventory});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__plannedUnitQA?.ready());
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();
 await page.locator('#bbpiSearch').waitFor();
 return {page,context,errors};
}

async function addFood(page,name){
 await page.locator('[role="tab"][data-bbpi-storage="fridge"]').click();
 await page.locator('.bbpi-add-food:visible').first().click();
 const panel=page.locator('#bbpi-current-editor');
 await panel.getByLabel('Food name',{exact:true}).fill(name);
 await panel.getByLabel('Food name',{exact:true}).press('Tab');
 return panel;
}
const descriptor=(page,name)=>page.evaluate(name=>BBPantryEditor.list().find(row=>BBHomeHost.id(row.name,'')===BBHomeHost.id(name,'')),name);
const summary=page=>page.evaluate(()=>window.__plannedUnitQA.summary());
const skip=!chromium&&'Playwright unavailable';

for(const width of [320,390]){
 test(`new Smoked haddock follows the planned weight and immediately updates Shop and budget at ${width}px`,{skip,timeout:60000},async()=>{
  const {page,context,errors}=await fixture({width});
  try{
   const before=await summary(page),panel=await addFood(page,'Smoked haddock');
   assert.equal(await panel.locator('[aria-label^="Unit for "]').inputValue(),'g');
   assert.equal(await panel.locator('[data-bbpi-needed]').inputValue(),'600');
   await panel.locator('[data-bbpi-quantity]').fill('200');
   assert.equal(await panel.locator('.bbpi-readout').textContent(),'Add to Shop: 400 g');
   await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});
   const row=await descriptor(page,'Smoked haddock');
   assert.equal(row.unit,'g');assert.equal(row.qty,200);assert.equal(row.mealQuantity,600);assert.equal(row.shortfall,400);
   const after=await summary(page),fish=after.items.find(row=>row.key==='smoked haddock fillets');
   assert.ok(fish);assert.equal(fish.required,600);assert.equal(fish.pantryUsed,200);assert.equal(fish.toBuy,400);
   assert.ok(after.remainingTotal<before.remainingTotal,'200 g stock crosses the haddock pack boundary and reduces the shopping estimate');
   await page.evaluate(()=>window.__plannedUnitQA.plan());
   assert.match(await page.locator('#myWeekEstimatedTotal').textContent(),new RegExp(after.remainingTotal.toFixed(2).replace('.', '\\.')));
   await page.evaluate(()=>window.__plannedUnitQA.overview());
   const shop=await summary(page);
   assert.equal(shop.items.find(row=>row.key==='smoked haddock fillets').toBuy,400,'navigation immediately uses the committed amount');
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });

 for(const item of [
  {name:'Whole milk',recipeId:MORNAY,unit:'ml',needed:600,owned:200,buy:400},
  {name:'Cod',recipeId:'seafood-crepes-in-white-wine-cream-sauce',unit:'g',needed:350,owned:200,buy:150},
  {name:'Salmon',recipeId:'salmon',unit:'each',needed:4,owned:1,buy:3},
  {name:'Eggs',recipeId:'veggie-fried-rice',unit:'each',needed:6,owned:2,buy:4}
 ])test(`new ${item.name} uses its planned ${item.unit} amount at ${width}px`,{skip,timeout:60000},async()=>{
  const {page,context,errors}=await fixture({width,recipeId:item.recipeId});
  try{
   const panel=await addFood(page,item.name);
   assert.equal(await panel.locator('[aria-label^="Unit for "]').inputValue(),item.unit);
   assert.equal(await panel.locator('[data-bbpi-needed]').inputValue(),String(item.needed));
   await panel.locator('[data-bbpi-quantity]').fill(String(item.owned));
   assert.equal(await panel.locator('.bbpi-readout').textContent(),`Add to Shop: ${item.buy} ${item.unit}`);
   await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});
   const row=await descriptor(page,item.name);
   assert.equal(row.unit,item.unit);assert.equal(row.qty,item.owned);assert.equal(row.mealQuantity,item.needed);assert.equal(row.shortfall,item.buy);
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });

 test(`mixed weight and count requirements remain a visible unit review at ${width}px`,{skip,timeout:60000},async()=>{
  const requirements=[{key:'cod fillets',name:'Cod fillets',unit:'g',required:600},{key:'cod fillets',name:'Cod fillets',unit:'each',required:2}];
  const {page,context,errors}=await fixture({width,recipeId:null,requirements});
  try{
   const before=await page.evaluate(()=>window.__plannedUnitQA.snapshot()),panel=await addFood(page,'Cod');
   const info=await page.evaluate(()=>BBPantryEditor.preview('Cod','fridge'));
   assert.ok(info.plannedNeedsReview||/unit/i.test(info.targetProblem||''),'incompatible planned measures require review');
   const help=await panel.locator('#bbpiNeededHelp').textContent();
   assert.match(help,/unit|review/i);assert.doesNotMatch(help,/Not needed for your planned meals/i);
   assert.notEqual(await panel.locator('[data-bbpi-needed]').inputValue(),'602','counts cannot be added to grams');
   await panel.locator('.bbpi-close').click();
   assert.deepEqual(await page.evaluate(()=>window.__plannedUnitQA.snapshot()),before);
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });

 test(`saved 200 each Smoked haddock is preserved for review at ${width}px`,{skip,timeout:60000},async()=>{
  const stock={'smoked haddock|each':200},inventory={'fridge|smoked haddock':{name:'Smoked haddock',loc:'fridge',selected:true,qty:200,unit:'each',bb173StockKey:'smoked haddock|each',bb173StockValue:200}};
  const {page,context,errors}=await fixture({width,stock,inventory});
  try{
   const before=await page.evaluate(()=>window.__plannedUnitQA.snapshot());
   await page.locator('[role="tab"][data-bbpi-storage="fridge"]').click();
   await page.getByRole('button',{name:'Edit Smoked haddock in fridge',exact:true}).click();
   const panel=page.locator('#bbpi-current-editor');
   assert.equal(await panel.locator('[aria-label^="Unit for "]').inputValue(),'each');
   assert.equal(await panel.locator('[data-bbpi-quantity]').inputValue(),'200');
   const help=await panel.locator('#bbpiNeededHelp').textContent();
   assert.match(help,/unit|review/i);assert.doesNotMatch(help,/Not needed for your planned meals/i);
   await panel.locator('.bbpi-close').click();
   assert.deepEqual(await page.evaluate(()=>window.__plannedUnitQA.snapshot()),before,'opening the editor cannot reinterpret the old amount');
   const row=await descriptor(page,'Smoked haddock');assert.equal(row.qty,200);assert.equal(row.unit,'each');assert.ok(row.plannedNeedsReview||/unit/i.test(row.targetProblem||''));
   assert.deepEqual(await page.evaluate(()=>window.__plannedUnitQA.stock()),stock);
   // Repair the old entry only after the user explicitly enters its weight.
   await page.getByRole('button',{name:'Edit Smoked haddock in fridge',exact:true}).click();
   await panel.locator('[data-bbpi-quantity]').fill('');
   await panel.locator('[aria-label^="Unit for "]').selectOption('g');
   await panel.locator('[data-bbpi-quantity]').fill('200');
   assert.equal(await panel.locator('[data-bbpi-needed]').inputValue(),'600');
   assert.equal(await panel.locator('.bbpi-readout').textContent(),'Add to Shop: 400 g');
   await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});
   const repaired=await descriptor(page,'Smoked haddock');
   assert.equal(repaired.qty,200);assert.equal(repaired.unit,'g');assert.equal(repaired.mealQuantity,600);assert.equal(repaired.shortfall,400);
   assert.deepEqual(await page.evaluate(()=>window.__plannedUnitQA.stock()),{'smoked haddock|g':200},'the explicit repair replaces the old count stock');
   const fish=(await summary(page)).items.find(row=>row.key==='smoked haddock fillets');
   assert.equal(fish.required,600);assert.equal(fish.pantryUsed,200);assert.equal(fish.toBuy,400);
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });
}
