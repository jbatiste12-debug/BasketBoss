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

test('ordinary desktop Shop uses the same Buying plan, estimates and single selected purchase',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(1280);
 try{
  await page.evaluate(()=>window.__readableShopQA.ordinaryShop());
  assert.equal(await page.locator('#bb172Storefront').count(),0);
  const row=page.locator('.bb321-buy-row').filter({has:page.locator('[data-bb321-tick="chicken breast|g"]')});
  await row.locator('.bb-shop-buying-pill').waitFor({state:'visible'});
  const beforeTotal=money(await page.locator('.bb321-shop-total').textContent()),beforePrice=money(await row.locator('.bb321-shop-price .bb79-price-tap').textContent());
  const pack=await page.evaluate(()=>window.__readableShopQA.pack('chicken breast','g'));
  const dialog=await picker(page,row);await dialog.locator('[data-bb-pack-preset="500"]').click();await dialog.waitFor({state:'hidden'});
  const selectedPrice=roundMoney(beforePrice*500/pack.standard_pack_size),selectedTotal=roundMoney(beforeTotal-beforePrice+selectedPrice);
  assert.match(await row.locator('.bb-shop-buying-pill').textContent(),/500\s*g/);
  assert.equal(money(await row.locator('.bb321-shop-price .bb79-price-tap').textContent()),selectedPrice);
  assert.equal(money(await page.locator('.bb321-shop-total').textContent()),selectedTotal);
  await assertUnbought(page,'chicken breast|g',{'chicken breast|g':200});
  await page.evaluate(()=>window.__readableShopQA.plan());
  assert.equal(money(await page.locator('#myWeekEstimatedTotal').textContent()),selectedTotal);
  await page.evaluate(()=>window.__readableShopQA.ordinaryShop());
  await row.locator('[data-bb321-tick="chicken breast|g"]').check();
  await page.waitForFunction(()=>window.__readableShopQA.stock()['chicken breast|g']===700);
  assert.equal((await page.evaluate(()=>window.__readableShopQA.purchase('chicken breast|g'))).actualQty,500);
  await page.evaluate(()=>window.__readableShopQA.renderAgain());
  assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.stock()),{'chicken breast|g':700});
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__readableShopQA?.ready());
  assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.stock()),{'chicken breast|g':700});
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

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

for(const width of [320,390]){
 test(`scaled real recipe Buying rows are readable and rendering and copying preserve exact balances at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
  const {page,context,errors}=await fixture(width);
  try{
   const shell=await openShop(page),before=await snapshot(page),original=await summary(page);
   const chicken=original.items.find(row=>row.key==='chicken breast'),egg=original.items.find(row=>row.key==='egg'),garlic=original.items.find(row=>row.key==='garlic');
   assert.equal(chicken.required,666.666667);assert.equal(chicken.pantryUsed,200);assert.equal(chicken.toBuy,466.666667);
   assert.equal(egg.required,.666667);assert.equal(garlic.required,1.333333);
   const chickenRow=rowFor(shell,'chicken breast|g'),eggRow=rowFor(shell,'egg|each'),garlicRow=rowFor(shell,'garlic|each');
   assert.match(await chickenRow.locator('.bbcompact-qty').textContent(),/^(?:Need\s+467\s*g|467\s*g\s+needed)$/i);
   assert.match(await chickenRow.innerText(),/Have\s+200\s*g/i);
   assert.match(await eggRow.locator('.bbcompact-qty').textContent(),/^(?:Need\s+1\s*egg|1\s*egg\s+needed)$/i);
   assert.match(await garlicRow.locator('.bbcompact-qty').textContent(),/^(?:Need\s+2\s*cloves|2\s*cloves\s+needed)$/i);
   assert.match(await chickenRow.locator('.bb-shop-buying-pill').textContent(),/Buying/i);
   assert.doesNotMatch(await shell.innerText(),rawDecimals);
   for(const row of [chickenRow,eggRow,garlicRow,rowFor(shell,'brioche buns|each')])await assertRowLayout(row);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Shopping fits the narrow viewport');

   await page.evaluate(()=>window.__readableShopQA.renderAgain());
   await shell.getByRole('button',{name:'Pantry',exact:true}).click();
   await shell.getByRole('button',{name:'All items',exact:true}).click();
   await shell.getByRole('button',{name:'Copy remaining',exact:true}).click();
   await page.waitForFunction(()=>typeof window.__readableShopCopy==='string');
   const copied=await page.evaluate(()=>window.__readableShopCopy);
   assert.match(copied,/Chicken Breast/i);assert.doesNotMatch(copied,rawDecimals);
   assert.deepEqual(await snapshot(page),before,'display and clipboard formatting cannot mutate stock, source recipe or purchase records');
   const after=await summary(page);
   assert.deepEqual(after.items.map(({key,unit,required,pantryUsed,toBuy})=>({key,unit,required,pantryUsed,toBuy})),original.items.map(({key,unit,required,pantryUsed,toBuy})=>({key,unit,required,pantryUsed,toBuy})));
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });

 test(`weight and six-bun packs preserve proportional price and exact Cook deductions at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
  const {page,context,errors}=await fixture(width);
  try{
   const shell=await openShop(page),row=rowFor(shell,'chicken breast|g');
   const catalogue=await page.evaluate(()=>window.__readableShopQA.catalogue('chicken breast|g')),pack=await page.evaluate(()=>window.__readableShopQA.pack('chicken breast','g'));
   const oldPrice=money(await rowPrice(row).textContent()),oldRemaining=money(await remaining(shell).textContent());
   const dialog=await picker(page,row);
   for(const preset of ['exact','200','250','300','400','500','1000','custom'])assert.equal(await dialog.locator('[data-bb-pack-preset="'+preset+'"]').count(),1);
   await dialog.locator('[data-bb-pack-preset="500"]').click();await dialog.waitFor({state:'hidden'});
   const expectedPrice=roundMoney(oldPrice*500/pack.standard_pack_size);
   assert.equal(money(await rowPrice(row).textContent()),expectedPrice);
   assert.equal(money(await remaining(shell).textContent()),roundMoney(oldRemaining-oldPrice+expectedPrice));
   assert.match(await row.locator('.bb-shop-buying-pill').textContent(),/500\s*g/i);
   await assertUnbought(page,'chicken breast|g',{'chicken breast|g':200});
   assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.catalogue('chicken breast|g')),catalogue,'a buying preference cannot rewrite the catalogue');
   const item=(await summary(page)).items.find(row=>row.key==='chicken breast');assert.equal(item.required,666.666667);assert.equal(item.toBuy,466.666667);
   const buns=rowFor(shell,'brioche buns|each');
   if(width===390&&process.env.BB_SHOP_SCREENSHOTS==='1'){
    await fs.mkdir('/workspace/shared',{recursive:true});
    await page.screenshot({path:'/workspace/shared/BasketBoss-Shop-Packs-Preview.png'});
   }
   const bunsDialog=await picker(page,buns);
   if(width===390&&process.env.BB_SHOP_SCREENSHOTS==='1')await page.screenshot({path:'/workspace/shared/BasketBoss-Shop-Packs-Picker.png'});
   await bunsDialog.locator('[data-bb-pack-preset="6"]').click();await bunsDialog.waitFor({state:'hidden'});
   await assertUnbought(page,'brioche buns|each',{'chicken breast|g':200});
   await row.locator('.bb172-storefront-checkbox').check();
   await page.waitForFunction(()=>window.__readableShopQA.stock()['chicken breast|g']===700);
   assert.equal((await page.evaluate(()=>window.__readableShopQA.purchase('chicken breast|g'))).actualQty,500);
   await buns.locator('.bb172-storefront-checkbox').check();
   await page.waitForFunction(()=>window.__readableShopQA.stock()['brioche buns|each']===6);
   assert.equal((await page.evaluate(()=>window.__readableShopQA.purchase('brioche buns|each'))).actualQty,6,'a six-bun pack is six buns');
   const coleslawItem=(await summary(page)).items.find(row=>/coleslaw/.test(row.key)),coleslawId=coleslawItem.key+'|'+coleslawItem.unit;
   const coleslaw=rowFor(shell,coleslawId);
   assert.match(await coleslaw.locator('.bb-shop-buying-pill').textContent(),/300\s*g/);
   await coleslaw.locator('.bb172-storefront-checkbox').check();
   await page.waitForFunction(id=>window.__readableShopQA.stock()[id]===300,coleslawId);
   assert.equal((await page.evaluate(id=>window.__readableShopQA.purchase(id),coleslawId)).actualQty,300,'the display default is a 300 g tub');
   await finishAndReload(page,shell,{'chicken breast|g':700,'brioche buns|each':6,[coleslawId]:300});
   const preview=await page.evaluate(()=>window.__readableShopQA.cookPreview());assert.equal(preview.ok,true);
   const cookedChicken=preview.rows.find(row=>row.id==='chicken breast|g'),cookedBuns=preview.rows.find(row=>row.id==='brioche buns|each');
   assert.equal(cookedChicken.required,666.666667,'the 467 g Shop display cannot round the recipe requirement to 667 g');
   const chickenRemainder=700-666.666667;
   assert.equal(cookedChicken.deduct,666.666667);assert.ok(Math.abs(cookedChicken.remaining-chickenRemainder)<1e-9);
   assert.equal(cookedBuns.required,4);assert.equal(cookedBuns.deduct,4);assert.equal(cookedBuns.remaining,2);
   const confirmed=await page.evaluate(expected=>window.__readableShopQA.cookFinish(expected),preview.fingerprint);assert.equal(confirmed.ok,true);
   const remainingStock=await page.evaluate(()=>window.__readableShopQA.stock());
   assert.deepEqual(Object.keys(remainingStock).sort(),['brioche buns|each','chicken breast|g',coleslawId].sort());
   assert.ok(Math.abs(remainingStock['chicken breast|g']+cookedChicken.deduct-700)<1e-9);
   assert.equal(remainingStock['brioche buns|each'],2);assert.equal(remainingStock[coleslawId],100);
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });

 test(`two six-item packs keep twelve actual items and accept one total price at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
  const initial={'pork sausages|each':5},{page,context,errors}=await fixture(width,{recipeId:'sausage-gnocchi',stock:initial});
  try{
   const shell=await openShop(page),row=rowFor(shell,'pork sausages|each');
   const original=(await summary(page)).items.find(row=>row.key==='pork sausages');assert.equal(original.required,6);assert.equal(original.pantryUsed,5);assert.equal(original.toBuy,1);
   const catalogue=await page.evaluate(()=>window.__readableShopQA.catalogue('pork sausages|each')),pack=await page.evaluate(()=>window.__readableShopQA.pack('pork sausages','each'));
   const oldPrice=money(await rowPrice(row).textContent()),oldRemaining=money(await remaining(shell).textContent());
   let dialog=await picker(page,row);
   for(const preset of ['exact','4','6','8','10','12','custom'])assert.equal(await dialog.locator('[data-bb-pack-preset="'+preset+'"]').count(),1);
   await dialog.locator('[data-bb-pack-preset="6"]').click();await dialog.waitFor({state:'hidden'});
   dialog=await picker(page,row);await dialog.locator('[data-bb-pack-count="plus"]').click();await savePicker(dialog);
   const plannedPrice=roundMoney(oldPrice*12/pack.standard_pack_size);
   assert.equal(money(await rowPrice(row).textContent()),plannedPrice);
   assert.equal(money(await remaining(shell).textContent()),roundMoney(oldRemaining-oldPrice+plannedPrice));
   assert.match(await row.locator('.bb-shop-buying-pill').textContent(),/2\s*[×x]\s*6/i);
   await assertUnbought(page,'pork sausages|each',initial);
   dialog=await picker(page,row);await dialog.locator('[data-bb-pack-preset="custom"]').click();await dialog.locator('[data-bb-pack-price]').fill('7.50');await savePicker(dialog);
   assert.equal(money(await rowPrice(row).textContent()),7.5,'the entered price is the total for both packs');
   assert.equal(money(await remaining(shell).textContent()),roundMoney(oldRemaining-oldPrice+7.5));
   await assertUnbought(page,'pork sausages|each',initial);
   assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.catalogue('pork sausages|each')),catalogue);
   assert.deepEqual(await page.evaluate(()=>window.__readableShopQA.pack('pork sausages','each')),pack,'a manual total does not alter the base pack or price');
   await row.locator('.bb172-storefront-checkbox').check();
   await page.waitForFunction(()=>window.__readableShopQA.stock()['pork sausages|each']===17);
   assert.equal((await page.evaluate(()=>window.__readableShopQA.purchase('pork sausages|each'))).actualQty,12,'two packs remain twelve each, never one physical pack');
   await finishAndReload(page,shell,{'pork sausages|each':17});
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });

 test(`a tiny positive Shopping demand stays exact and is never displayed as zero at ${width}px`,{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
  const {page,context,errors}=await fixture(width,{recipeId:null,stock:{}});
  try{
   assert.equal((await page.evaluate(()=>window.__readableShopQA.addTiny())).ok,true);
   const shell=await openShop(page),row=rowFor(shell,'chicken breast|g');
   const item=(await summary(page)).items.find(row=>row.key==='chicken breast');assert.equal(item.toBuy,.000001);
   const text=await row.locator('.bbcompact-qty').textContent();assert.match(text,/[1-9]/);assert.doesNotMatch(text,/^(?:Need\s+)?0(?:\.0+)?\s*g(?:\s+needed)?$/i);assert.doesNotMatch(await shell.innerText(),rawDecimals);
   // The old demand can be finer than supported purchase precision. Rendering
   // it never attempts a purchase or changes that protected transaction rule.
   await assertUnbought(page,'chicken breast|g',{});
   assert.match(await row.locator('.bb-shop-buying-pill').textContent(),/[1-9]/);assert.doesNotMatch(await shell.innerText(),rawDecimals);
   const before=await snapshot(page);
   await shell.getByRole('button',{name:'Copy remaining',exact:true}).click();await page.waitForFunction(()=>typeof window.__readableShopCopy==='string');
   const copied=await page.evaluate(()=>window.__readableShopCopy),line=copied.split('\n').find(line=>/Chicken Breast/i.test(line));
   assert.ok(line);assert.match(line,/[1-9]/);assert.doesNotMatch(line,rawDecimals);assert.deepEqual(await snapshot(page),before);
   assert.equal((await summary(page)).items.find(row=>row.key==='chicken breast').toBuy,.000001);
   await assertUnbought(page,'chicken breast|g',{});
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });
}
