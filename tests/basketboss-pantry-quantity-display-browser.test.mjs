import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';
const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
// Real generated application and guarded pantry persistence, with every request
// intercepted locally. These disposable contexts use no real account or data.
async function checkQuantity(item){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
 page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 try{
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname)){requests.push(url.origin);return route.fulfill({status:200,body:''});}
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({authenticated:false,error:'sign_in_required'})});
  let rel=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(['app','app.html','index.html','index',''].includes(rel))rel='app.html';
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  let body;
  try{
   if(['bb-onboarding-v2.js','bb-how-it-works.js','bb-pantry-inline.js','bb-pantry-selection.js'].includes(rel))body=transform700Presentation(await fs.readFile(path.join(ROOT,rel),'utf8'));
   else if(['bb-onboarding-v2.css','bb-pantry-inline.css'].includes(rel))body=await fs.readFile(path.join(ROOT,rel));
   else{try{body=await fs.readFile(path.join(ROOT,'pwa700',rel));}catch{try{body=await fs.readFile(path.join(ROOT,rel));}catch{body=await fs.readFile(path.join(ROOT,'catalogues/700/release/assets',rel));}}}
  }catch{return route.fulfill({status:404,body:''});}
  const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
  return route.fulfill({status:200,contentType:types[path.extname(rel)]||'application/octet-stream',body});
 });

  await context.addInitScript(()=>{
   localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
   localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
   localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));
   localStorage.setItem('basketboss_321_v7_market','Guernsey');localStorage.setItem('basketboss_v172_weekly_budget_target_v1','150');
   sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
  });

  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
  await page.evaluate(market=>window.bb307SwitchIsland(market),item.market||'Guernsey');
  await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();await page.locator('#bbpiSearch').waitFor();
  await page.evaluate(async item=>{const result=BBPantryEditor.add({name:item.name,loc:'cupboard',qty:item.qty,unit:item.unit});if(!result?.ok)throw Error(result?.message||'seed');await BBPantryEditor.flush();const row=BBPantryEditor.list().find(row=>row.name===item.name);const patch={totalNeeded:item.target,unit:item.unit,...(item.pack?{packQuantity:item.pack,packUnit:'g'}:{}),...(item.buffer?{extraBuffer:item.buffer}:{}),...(item.multiple?{buyMultiple:item.multiple,buyMultipleUnit:item.multipleUnit||item.unit}:{})};const saved=BBPantryEditor.update(row.key,patch);if(!saved?.ok)throw Error(saved?.message||'target');await BBPantryEditor.flush();},item);
  const snapshot=()=>page.evaluate(name=>{const row=BBPantryEditor.list().find(row=>row.name===name),keys=BBHomeHost.keys();return {qty:row.qty,unit:row.unit,packQuantity:row.packQuantity,extraBufferQuantity:row.extraBufferQuantity,buyMultipleQuantity:row.buyMultipleQuantity,canonical:BBPantryPolicy.normalize(row.name,row.qty,row.unit,{market:'Guernsey',packReviewed:row.packReviewed,packQuantity:row.packQuantity,packUnit:row.packUnit}),stock:localStorage.getItem(keys.stock),inventory:localStorage.getItem(keys.inventory)};},item.name);
  const original=await snapshot(),edit=()=>page.locator('.bbpi-summary-row').filter({hasText:item.name}).getByRole('button',{name:'Edit '+item.name+' in cupboard',exact:true}).click();
  await edit();const panel=page.locator('#bbpi-current-editor'),quantity=panel.locator('[data-bbpi-quantity]'),needed=panel.locator('[data-bbpi-needed]'),unit=panel.getByRole('combobox',{name:'Unit for '+item.name,exact:true});
  const opened={quantity:await quantity.inputValue(),needed:await needed.inputValue(),unit:await unit.inputValue()};
  if(!item.before){assert.equal(opened.quantity,item.display);assert.equal(opened.unit,item.displayUnit||item.unit);assert.equal(opened.needed,item.needed);}
  await page.evaluate(()=>document.activeElement?.blur());

  await panel.locator('.bbpi-close').click();await panel.waitFor({state:'detached'});assert.deepEqual(await snapshot(),original,'opening/closing cannot write');
  if(!item.before){
   await edit();await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});let saved=await snapshot();assert.equal(saved.canonical.quantity,original.canonical.quantity,'untouched Done preserves exact balance');assert.equal(saved.stock,original.stock,'untouched Done preserves physical stock bytes');if(item.pack)assert.equal(saved.packQuantity,item.pack);
   await edit();await unit.selectOption(item.roundTripUnit||(item.unit==='each'?'g':'each'));await unit.selectOption(item.displayUnit||item.unit);assert.equal(await quantity.inputValue(),item.display);await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});saved=await snapshot();assert.equal(saved.canonical.quantity,original.canonical.quantity,'untouched unit round trip preserves exact balance');assert.equal(saved.stock,original.stock);
   if(item.packRoundTrip){await edit();await panel.locator('.bbpi-pack>summary').click();const packUnit=panel.getByRole('combobox',{name:'Container contents unit',exact:true});await packUnit.selectOption('ml');await packUnit.selectOption('g');await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});saved=await snapshot();assert.equal(saved.packQuantity,item.pack);}
   if(item.multiple){await edit();const mode=panel.locator('[data-bbpi-buy-multiple]');await mode.selectOption('off');await mode.selectOption('custom');const buyUnit=panel.locator('[data-bbpi-buy-unit]');await buyUnit.selectOption('g');await buyUnit.selectOption(item.multipleUnit||item.unit);await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});saved=await snapshot();assert.equal(saved.buyMultipleQuantity,original.buyMultipleQuantity);assert.equal(saved.extraBufferQuantity,original.extraBufferQuantity);}
   if(item.retype){await edit();await quantity.fill(item.display);await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});saved=await snapshot();assert.equal(saved.canonical.quantity,item.retype,'retyping rounded display is an explicit edit');}
   if(item.step){await edit();await panel.getByRole('button',{name:'More Amount of '+item.name+' at home',exact:true}).click();await panel.locator('.bbpi-done').click();await panel.waitFor({state:'detached'});saved=await snapshot();assert.equal(saved.canonical.quantity,item.step,'stepper adds its exact delta behind rounded text');}
  }
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
 const cases=[{name:'Potatoes',qty:750,unit:'g',target:750,display:'750',needed:'750',step:800},
 {name:'Baking potatoes',qty:833.333333,unit:'g',target:833.333333,display:'833.33',needed:'833.33',retype:833.33},
 {name:'Potatoes',qty:2.5,unit:'each',target:2.5,display:'2.5',needed:'2.5'},
 {name:'Potatoes',qty:.001,unit:'g',target:.001,display:'0.001',needed:'0.001',pack:.000001,packRoundTrip:true},
 {name:'Potatoes',qty:.000001,unit:'g',target:.000001,display:'3.53e-8',needed:'0',displayUnit:'oz',roundTripUnit:'g',market:'US'},
 {name:'Rice',qty:500/453.6,unit:'lb',target:500/453.6,display:'1.1',needed:'1.1',displayUnit:'lb',roundTripUnit:'kg',market:'US',multiple:1.1022927689594357,multipleUnit:'lb',buffer:.333333/453.6,pack:350.123456,packRoundTrip:true}];
for(const item of cases)test('readable pantry defaults preserve exact '+item.qty+' '+item.unit+' '+item.name+' in '+(item.market||'Guernsey'),{skip:!chromium?'Playwright unavailable; set BB_PLAYWRIGHT_MODULE to run browser regressions':false},()=>checkQuantity(item));
