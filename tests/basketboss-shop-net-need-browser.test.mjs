import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)){try{({chromium}=require(name));break;}catch{}}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const actor='00000000-0000-4000-8000-000000000019';
const bridge=`window.__netNeedQA={
 ready:()=>typeof RECIPES!=='undefined'&&RECIPES.length>0&&window.BBWeeklyShop,
 prepare(){
  const items=[{key:'Pork sausages',unit:'each',required:6,pantryUsed:5,toBuy:6,displaySpend:1.95,priceQuote:{packQty:6,packUnit:'each',packCount:1,packAmount:1.95,amount:1.95,portionAmount:.33,shelfPrice:1.95}},{key:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:500,displaySpend:1.25,priceQuote:{packQty:500,packUnit:'g',packCount:1,packAmount:1.25,amount:1.25,portionAmount:.38,shelfPrice:1.25}}];
  bb321WeeklySummary=()=>({result:{items},items,essentials:[],total:3.20,pending:0,remainingTotal:3.20,remainingPending:0,extraNeed:[]});
  state.planned=[];state.plannedBreakfasts=[];state.plannedDesserts=[];state.servings=4;state.pantry={};state.mealPreferences=null;tab='shop';bbShopV7Session();render();
 },
 open:()=>window.BBWeeklyShop.start(),
 snapshot:()=>Object.fromEntries([BB307_STOCK_KEY,BB83_KITCHEN_INVENTORY,BB321_SHOP_TICKS_KEY,BB84_PURCHASED_KEY,BB_PARTIAL_PURCHASE_KEY,BB_BETA_CHOICE_KEY].map(key=>[key,localStorage.getItem(key)])),
 purchase:()=>bb84ReadPurchased()[BB307Pantry.pantryId('Pork sausages','each')],
 finish:()=>bb83TransferBought(),
 stock:()=>bb307ReadStock()
};`;
async function fixture(width){
 const original=await fs.readFile(path.join(root,'app.html'),'utf8'),anchor='window.BBHomeHost=Object.freeze({';assert.ok(original.includes(anchor));
 const app=original.replace(anchor,bridge+anchor),context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // All app/API requests are local disposable fixtures and cannot reach an account.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:actor,email:'net-need@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
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
   let body;if(relative==='app.html')body=app;else{try{body=await fs.readFile(path.join(root,relative));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',relative));}}
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(relative)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(({actor})=>{
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'net-need@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
  localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify({'pork sausages|each':5,'rice|g':350}));
  localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify({'fridge|pork sausages':{name:'Pork sausages',loc:'fridge',selected:true,qty:5,unit:'each',bb173StockKey:'pork sausages|each',bb173StockValue:5},'cupboard|rice':{name:'Rice',loc:'cupboard',selected:true,qty:350,unit:'g',bb173StockKey:'rice|g',bb173StockValue:350}}));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','UK');
 },{actor});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__netNeedQA?.ready());await page.evaluate(()=>window.__netNeedQA.prepare());
 return {page,context,errors};
}
for(const width of [390,320])test(`actual regular and compact Shop retain exact shortfalls and purchase packs at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(width);
 try{
  const regular=page.locator('#app .bb321-buy-row').filter({hasText:'Pork sausages'});assert.equal(await regular.locator('.bb321-shop-quantity strong').first().textContent(),'1 needed');assert.equal(await regular.locator('.bb-shop-need-context').textContent(),'Have 5 at home (of 6) • Buy 1 pack (6 pk)');
  const before=await page.evaluate(()=>window.__netNeedQA.snapshot());assert.equal(await page.evaluate(()=>window.__netNeedQA.open()),true);
  const shell=page.locator('#bb172Storefront');await shell.locator('.bbcompact-shop-row').first().waitFor();await shell.getByRole('button',{name:'All items',exact:true}).click();
  const sausage=shell.locator('.bbcompact-shop-row').filter({hasText:'Pork sausages'}),rice=shell.locator('.bbcompact-shop-row').filter({hasText:'Rice'});
  assert.equal(await sausage.locator('.bbcompact-qty').textContent(),'1 needed');assert.equal(await sausage.locator('.bb-shop-need-context').textContent(),'Have 5 at home (of 6) • Buy 1 pack (6 pk)');assert.equal(await rice.locator('.bbcompact-qty').textContent(),'150 g needed');assert.equal(await rice.locator('.bb-shop-need-context').textContent(),'Have 350 g at home (of 500 g) • Buy 1 pack (500 g)');
  assert.deepEqual(await page.evaluate(()=>window.__netNeedQA.snapshot()),before,'opening Shop cannot edit stock or purchase records');
  const bounds=await shell.evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth}));assert.ok(bounds.scroll<=bounds.width+1,'Shop fits the viewport');
  await sausage.scrollIntoViewIfNeeded();
  if(process.env.BB_NET_NEED_SCREENSHOTS){await fs.mkdir(process.env.BB_NET_NEED_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.BB_NET_NEED_SCREENSHOTS,`shop-net-need-${width}.png`),animations:'disabled'});}
  await sausage.locator('.bb172-storefront-checkbox').check();await page.waitForFunction(()=>window.__netNeedQA.purchase()?.actualQty===6);
  assert.equal((await page.evaluate(()=>window.__netNeedQA.purchase())).qty,1);const checked=await page.evaluate(()=>window.__netNeedQA.snapshot());for(const key of ['basketboss_321_v7_measured_pantry','basketboss_makeameal_v1_inventory'])assert.equal(checked[key],before[key],'checking Bought cannot pre-credit inventory');
  await sausage.locator('.bb172-storefront-checkbox').uncheck();await page.waitForFunction(()=>!window.__netNeedQA.purchase());assert.equal(await sausage.locator('.bbcompact-qty').textContent(),'1 needed');
  await sausage.locator('.bbcompact-toggle').click();await sausage.getByRole('button',{name:'Enter different amount',exact:true}).click();await sausage.getByRole('spinbutton',{name:'Total Pork Sausages bought in each',exact:true}).fill('1');await sausage.getByRole('button',{name:'Save amount',exact:true}).click();await page.waitForFunction(()=>window.__netNeedQA.purchase()?.actualQty===1);assert.equal(await shell.locator('.bb84-extra-row').count(),0,'an exact one-item purchase cannot create a phantom five-item shortfall');assert.equal(await sausage.locator('.bbcompact-qty').textContent(),'0 needed');await sausage.locator('.bb172-storefront-checkbox').uncheck();await page.waitForFunction(()=>!window.__netNeedQA.purchase());
  await sausage.locator('.bb172-storefront-checkbox').check();assert.equal((await page.evaluate(()=>window.__netNeedQA.finish())).count,1);assert.equal((await page.evaluate(()=>window.__netNeedQA.stock()))['pork sausages|each'],11);assert.equal((await page.evaluate(()=>window.__netNeedQA.finish())).count,0);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
