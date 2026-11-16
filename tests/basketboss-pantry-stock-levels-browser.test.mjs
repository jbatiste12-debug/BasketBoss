import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const skip=!chromium?'Set BB_PLAYWRIGHT_MODULE to run real-app browser checks':false;
const output=process.env.BB_PANTRY_LEVELS_SCREENSHOTS;
async function fixture(width=390,{qty=500,unit='g',buffer=0,pack=1000,unknown=false}={}){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let name=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(['app','app/','app.html','index.html','index',''].includes(name))name='pwa700/app.html';
  if(name.includes('..'))return route.fulfill({status:404,body:''});
  let body;try{
   body=await fs.readFile(path.join(ROOT,name));
  }catch{return route.fulfill({status:404,body:''});}
  const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
  return route.fulfill({status:200,contentType:types[path.extname(name)]||'application/octet-stream',body});
 });
 await context.addInitScript(()=>{
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
 });
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();
 await page.waitForFunction(()=>window.BBPantryEditor?.isCurrent?.());
 const key=await page.evaluate(async({qty,unit,buffer,pack,unknown})=>{
  const added=unknown?{ok:!!BBPantryEditor.select('Rice','cupboard',{unit})}:BBPantryEditor.add({name:'Rice',loc:'cupboard',qty,unit});if(!added?.ok)throw Error(added?.message||'seed');await BBPantryEditor.flush();
  const row=BBPantryEditor.list().find(row=>BBHomeHost.id(row.name,'')===BBHomeHost.id('Rice',''));
  if(!unknown){const changed=BBPantryEditor.update(row.key,{packQuantity:pack,packUnit:'g',extraBuffer:buffer===0?0:BBPantryPolicy.normalize(row.name,buffer,unit).quantity/BBPantryPolicy.normalize(row.name,1,row.unit).quantity});if(!changed?.ok)throw Error(changed?.message||'capacity');await BBPantryEditor.flush();}return row.key;
 },{qty,unit,buffer,pack,unknown});
 const snapshot=()=>page.evaluate(key=>{const row=BBPantryEditor.read(key),keys=BBHomeHost.keys();return {row,stock:localStorage.getItem(keys.stock),inventory:localStorage.getItem(keys.inventory)};},key);
 const open=async()=>{await page.evaluate(key=>BBPantryInline.open(key),key);await page.locator('#bbpi-current-editor').waitFor();};
 const capture=async name=>{if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png')});}};
 return {context,page,errors,key,snapshot,open,capture,panel:page.locator('#bbpi-current-editor')};
}
async function low(h){
 await h.panel.locator('[data-bbpi-stock-level="low"]').click();
 const size=h.panel.locator('.bbpi-stock-capacity').filter({hasText:'saved size'}).first();
 if(await size.isVisible())await size.click();
}
test('unknown stock requires a confirmed amount and never covers the meal after quick taps',{skip},async()=>{
 const h=await fixture(390,{unknown:true});try{
  const original=await h.snapshot();assert.equal(original.row.qty,null);assert.equal(original.row.unroundedShortfall,500);await h.open();
  assert.equal(await h.panel.locator('.bbpi-amount-details').evaluate(node=>node.open),true);
  await h.panel.locator('[data-bbpi-stock-level="got"]').click();await h.panel.locator('[data-bbpi-stock-level="low"]').click();
  assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'');assert.deepEqual(await h.snapshot(),original);
  await h.panel.locator('.bbpi-close').click();assert.deepEqual(await h.snapshot(),original);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
for(const width of [320,390])test('stock levels keep exact stock, spare counts and mobile access at '+width+'px',{skip},async()=>{
 const h=await fixture(width);try{
  const original=await h.snapshot();await h.open();assert.equal(await h.panel.locator('.bbpi-amount-details').getAttribute('open'),null);
  await h.panel.locator('[data-bbpi-stock-level="got"]').click();assert.deepEqual(await h.snapshot(),original,'Got it does not silently replenish stock');
  await h.panel.locator('.bbpi-close').click();assert.deepEqual(await h.snapshot(),original,'dismiss keeps saved bytes');await h.open();
  await low(h);await h.panel.locator('[data-bbpi-stock-level="low"]').click();
  assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'250');assert.match(await h.panel.locator('.bbpi-stock-explanation').innerText(),/Estimated ¼/);
  const bounds=await h.panel.locator('.bbpi-stock-choice').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
  assert.ok(bounds.every(r=>r.width>=44&&r.height>=44),'all three level choices have 44px targets');
  assert.ok(await h.panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'dialog has no horizontal overflow');
  if(width===390)await h.capture('after-running-low');
  await h.panel.locator('.bbpi-stock-spares').fill('-1');await h.panel.locator('.bbpi-done').click();assert.ok(await h.panel.isVisible());assert.equal((await h.snapshot()).stock,original.stock,'invalid spares cannot save an earlier draft');
  await h.panel.locator('.bbpi-stock-spares').fill('1');assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'1250');
  await h.panel.locator('[data-bbpi-stock-level="out"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'1000','Out keeps a full spare');
  if(width===390)await h.capture('after-out-with-spare');
  await h.panel.locator('[data-bbpi-stock-level="low"]').click();await h.panel.locator('.bbpi-done').click();await h.panel.waitFor({state:'detached'});
  const saved=await h.snapshot();assert.equal(saved.row.qty,1250);assert.equal(saved.row.stockLevel.spares,1);assert.equal(saved.row.stockLevel.estimated,true);
  await h.open();await h.panel.locator('.bbpi-stock-pack-toggle').click();await h.panel.locator('[data-bbpi-stock-portion="half"]').click();
  if(await h.panel.locator('.bbpi-stock-capacity').filter({hasText:'saved size'}).first().isVisible())await h.panel.locator('.bbpi-stock-capacity').filter({hasText:'saved size'}).first().click();
  assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'1500');await h.panel.locator('.bbpi-stock-spares').fill('0');assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'500');
  await h.panel.locator('.bbpi-done').click();await h.panel.waitFor({state:'detached'});assert.equal((await h.snapshot()).row.qty,500);
  if(width===390)await h.capture('after-at-home');assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
test('pack selection converts an existing kg buffer and respects later exact edits',{skip},async()=>{
 const h=await fixture(390,{qty:.5,unit:'kg',buffer:.5});try{
  await h.open();await h.panel.locator('.bbpi-amount-details>summary').click();await h.panel.getByRole('combobox',{name:/^Unit for /}).selectOption('kg');await low(h);assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'250');
  await h.panel.locator('.bbpi-done').click();await h.panel.waitFor({state:'detached'});assert.equal((await h.snapshot()).row.extraBufferQuantity,500,'0.5kg buffer stays 500g');
  await h.open();await low(h);await h.panel.locator('.bbpi-amount-details>summary').click();await h.panel.locator('[data-bbpi-quantity]').fill('175.25');
  await h.panel.locator('.bbpi-done').click();await h.panel.waitFor({state:'detached'});const saved=await h.snapshot();assert.equal(saved.row.qty,175.25);assert.equal(saved.row.stockLevel,null);
  assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
test('later capacity edits are kept and stale stock dialogs cannot overwrite a new amount',{skip},async()=>{
 const h=await fixture();try{
  await h.open();await low(h);await h.panel.locator('.bbpi-more-options>summary').click();await h.panel.locator('.bbpi-pack>summary').click();
  await h.panel.getByRole('spinbutton',{name:/^Container size for /}).fill('500');await h.panel.locator('.bbpi-done').click();
  assert.ok(await h.panel.isVisible());assert.match(await h.panel.innerText(),/Pack size changed/);assert.equal((await h.snapshot()).row.packQuantity,1000,'an unresolved estimate cannot save a newly typed pack size');
  await h.panel.locator('[data-bbpi-stock-level="low"]').click();await h.panel.locator('.bbpi-stock-capacity').filter({hasText:/500 g.*saved size/}).click();
  await h.panel.locator('.bbpi-done').click();await h.panel.waitFor({state:'detached'});
  let saved=await h.snapshot();assert.equal(saved.row.packQuantity,500);assert.equal(saved.row.qty,125);assert.equal(saved.row.stockLevel.estimated,true);
  await h.open();await h.page.evaluate(async key=>{const changed=BBPantryEditor.update(key,{qty:123});if(!changed.ok)throw Error(changed.message);await BBPantryEditor.flush();},h.key);
  await h.page.waitForTimeout(150);assert.equal((await h.snapshot()).row.qty,123,'external update saves before stale dialog submit');await h.panel.locator('.bbpi-done').evaluate(node=>node.click());saved=await h.snapshot();assert.equal(saved.row.qty,123);assert.ok(await h.panel.isVisible());assert.match(await h.panel.innerText(),/changed|review|Reopen/i);
  assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
for(const width of [320,390])test('Shopping flags an estimate and opens the existing editor without changing the gap at '+width+'px',{skip},async()=>{
 const h=await fixture(width);try{
  await h.open();await low(h);await h.panel.locator('.bbpi-done').click();await h.panel.waitFor({state:'detached'});
  const saved=await h.snapshot();assert.equal(saved.row.qty,250);assert.equal(saved.row.unroundedShortfall,250);
  await h.page.locator('#bbPrimaryNavigation [data-bb-nav-item="shop"]').click();
  const check=h.page.locator('.bbpi-stock-shop-check');
  await check.waitFor();const bounds=await check.boundingBox(),buttonBounds=await check.getByRole('button',{name:'Check stock',exact:true}).boundingBox();assert.ok(bounds.height<=64,'the notice stays compact');assert.ok(buttonBounds.height>=44,'the button keeps a 44px tap target');if(width===390)await h.capture('after-shopping-check');
  await check.getByRole('button',{name:'Check stock',exact:true}).click();await h.panel.waitFor();
  assert.equal((await h.snapshot()).stock,saved.stock,'reviewing an estimate does not invent more stock');
  assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'250');assert.match(await h.panel.locator('.bbpi-stock-explanation').innerText(),/Estimated/);
  assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
