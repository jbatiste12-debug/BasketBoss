import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';
const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url)),ui=require('../bb-pantry-inline.js');
let chromium,browser;try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const tab=(page,loc)=>page.locator('[role="tab"][data-bbpi-storage="'+loc+'"]');
const visibleRows=page=>page.locator('.bbpi-summary-row:visible');

test('At home visibility excludes only an explicit exact zero and never changes a saved amount',()=>{
 const quantities=[0,'0','0.000000',null,undefined,'',' ','unknown',Infinity,-1,.000001,.00000001],rows=quantities.map(qty=>Object.freeze({name:'Saved ingredient',qty,unit:'g'})),before=JSON.stringify(rows);
 assert.deepEqual(rows.map(ui.hasAtHomeStock),[false,false,false,true,true,true,true,true,true,true,true,true]);
 assert.equal(JSON.stringify(rows),before);
});

// The real generated app renders saved rows and runs the guarded confirmed-cook
// ledger. A deterministic recipe host supplies only this fixture's ingredients.
async function fixture(viewport,run){
 const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
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
  await page.evaluate(()=>window.bb307SwitchIsland('Guernsey'));
  await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();await page.locator('#bbpiSearch').waitFor();
  await page.evaluate(async()=>{
   for(const item of [{name:'Garlic baguette',loc:'cupboard',qty:2,unit:'each'},{name:'Passata',loc:'cupboard',qty:500,unit:'g'},{name:'Potato gnocchi',loc:'cupboard',qty:1000,unit:'g'},{name:'Spinach',loc:'fridge',qty:200,unit:'g'},{name:'Tiny reserve',loc:'freezer',qty:.000001,unit:'g'}]){const added=BBPantryEditor.add(item);if(!added?.ok)throw Error(added?.message||'seed');}
   if(!BBPantryEditor.select('Milk','fridge',{unit:'ml'}))throw Error('seed unknown amount');
   await BBPantryEditor.flush();
   const passata=BBPantryEditor.list().find(row=>row.name==='Passata'),target=BBPantryEditor.update(passata.key,{totalNeeded:500,unit:'g'});if(!target?.ok)throw Error(target?.message||'seed target');await BBPantryEditor.flush();
   const original=BBHomeHost;
   window.BBHomeHost=Object.freeze({...original,recipeIngredients:(id,factor)=>id==='exhausted-view-dinner'?[{key:'garlic baguette',unit:'each',required:2*factor},{key:'passata',unit:'g',required:500*factor},{key:'potato gnocchi',unit:'g',required:500*factor},{key:'spinach',unit:'g',required:100*factor}]:original.recipeIngredients(id,factor)});
  });
  await tab(page,'all').click();await page.waitForFunction(()=>document.querySelector('.bbpi-hero-count')?.textContent==='6');
  await run(page);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

for(const viewport of [{width:390,height:844},{width:320,height:568}])test('confirmed cooking removes exhausted pantry rows and counts while retaining its ledger at '+viewport.width+'px',{skip:!chromium?'Playwright unavailable; set BB_PLAYWRIGHT_MODULE to run browser regressions':false},()=>fixture(viewport,async page=>{
 assert.equal(await visibleRows(page).count(),6);
 const targetsBefore=await page.evaluate(()=>BBHome.targets());
 const result=await page.evaluate(async()=>{
  const event={sessionId:'exhausted-view-cook',recipeId:'exhausted-view-dinner',day:'Monday',factor:1,actorId:BBHome.actor()},preview=BBHome.previewCook(event);if(!preview.ok)throw Error(preview.message);
  const result=await BBHome.cooked({...event,expected:preview.fingerprint});if(!result.ok)throw Error(result.message);
  const keys=BBHomeHost.keys(),stock=JSON.parse(localStorage.getItem(keys.stock)),inventory=JSON.parse(localStorage.getItem(keys.inventory)),home=JSON.parse(localStorage.getItem('basketboss_at_home_requirements_v1')).byActor[BBHome.actor()];
  return {stock,inventory,home,requirements:BBHomeHost.requirements(),targets:BBHome.targets()};
 });
 await page.waitForFunction(()=>document.querySelector('.bbpi-hero-count')?.textContent==='4');await tab(page,'all').click();
 const savedRows=Object.values(result.inventory);
 for(const name of ['Garlic baguette','Passata']){const row=savedRows.find(row=>row.name===name);assert.ok(row,'exhausted saved record is retained');assert.equal(row.qty,0);assert.equal(row.selected,true);assert.equal(result.stock[row.bb173StockKey]||0,0);}
 assert.equal(savedRows.find(row=>row.name==='Potato gnocchi').qty,500);
 assert.equal(savedRows.find(row=>row.name==='Milk').qty,null);
 assert.equal(savedRows.find(row=>row.name==='Tiny reserve').qty,.000001);
 assert.deepEqual(result.targets,targetsBefore,'cooking preserves saved shopping targets');assert.ok(result.home.cooked['exhausted-view-cook'],'confirmed-cook history remains saved');
 assert.equal(await visibleRows(page).count(),4);assert.equal(await page.locator('.bbpi-summary-row').filter({hasText:'Garlic baguette'}).count(),0);assert.equal(await page.locator('.bbpi-summary-row').filter({hasText:'Passata'}).count(),0);
 assert.match(await visibleRows(page).filter({hasText:'Milk'}).innerText(),/Amount unknown/);assert.match(await visibleRows(page).filter({hasText:'Tiny reserve'}).innerText(),/<1 g/);
 assert.equal(await page.locator('.bbpi-hero-count').getAttribute('aria-label'),'4 foods at home');
 for(const [loc,count]of [['cupboard',1],['fridge',2],['freezer',1],['all',4]])assert.equal(await tab(page,loc).getAttribute('aria-label'),loc[0].toUpperCase()+loc.slice(1)+', '+count+' item'+(count===1?'':'s'));
 await tab(page,'cupboard').click();assert.equal(await visibleRows(page).count(),1);assert.match(await visibleRows(page).innerText(),/Potato gnocchi/i);assert.equal(await page.locator('[data-bb76-store="cupboard"] .bbpi-count').textContent(),'1 item','section count excludes retained exhausted records');
 const before=await page.evaluate(()=>{const keys=BBHomeHost.keys();return [localStorage.getItem(keys.stock),localStorage.getItem(keys.inventory),localStorage.getItem('basketboss_at_home_requirements_v1')];});
 await page.locator('#bbpiSearch').fill('Passata');await page.waitForFunction(()=>document.querySelector('[role="tab"][data-bbpi-storage="all"] .bbpi-tab-count')?.textContent==='0');assert.equal(await visibleRows(page).count(),0);assert.equal(await page.locator('.bbpi-hero-count').textContent(),'4');
 await page.locator('#bbpiSearch').fill('');await tab(page,'all').click();await page.waitForFunction(()=>document.querySelector('[role="tab"][data-bbpi-storage="all"] .bbpi-tab-count')?.textContent==='4');
 await page.locator('#bbpiViewFilters').click();await page.getByRole('button',{name:'Low / Out',exact:true}).click();assert.equal(await visibleRows(page).count(),0,'status filters cannot reintroduce exhausted rows');await page.getByRole('button',{name:'All food',exact:true}).click();
 const after=await page.evaluate(()=>{const keys=BBHomeHost.keys();return {bytes:[localStorage.getItem(keys.stock),localStorage.getItem(keys.inventory),localStorage.getItem('basketboss_at_home_requirements_v1')],requirements:BBHomeHost.requirements(),targets:BBHome.targets(),shortfall:BBPantryEditor.list().find(row=>row.name==='Passata').shortfall};});
 assert.deepEqual(after.bytes,before,'all view changes preserve saved stock, records, targets and history byte for byte');assert.deepEqual(after.requirements,result.requirements);assert.deepEqual(after.targets,targetsBefore);assert.equal(after.shortfall,500,'a hidden empty record still contributes its shopping requirement');
 await visibleRows(page).filter({hasText:'Potato Gnocchi'}).getByRole('button',{name:/Edit Potato gnocchi in cupboard/i}).click();const editor=page.locator('#bbpi-current-editor');await editor.locator('[data-bbpi-quantity]').fill('0');assert.equal(await editor.isVisible(),true);assert.equal(await page.locator('.bbpi-summary-row').filter({hasText:'Potato Gnocchi'}).count(),1,'an intermediate zero draft keeps the saved positive row mounted');await editor.locator('.bbpi-close').click();await editor.waitFor({state:'detached'});
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();await page.locator('#bbpiSearch').waitFor();await tab(page,'all').click();await page.waitForFunction(()=>document.querySelector('.bbpi-hero-count')?.textContent==='4');
 assert.equal(await visibleRows(page).count(),4);assert.equal(await page.locator('.bbpi-summary-row').filter({hasText:'Passata'}).count(),0);assert.equal(await page.locator('.bbpi-summary-row').filter({hasText:'Garlic baguette'}).count(),0);assert.match(await visibleRows(page).filter({hasText:'Milk'}).innerText(),/Amount unknown/);assert.match(await visibleRows(page).filter({hasText:'Tiny Reserve'}).innerText(),/<1 g/);
 assert.deepEqual(await page.evaluate(()=>{const keys=BBHomeHost.keys();return [localStorage.getItem(keys.stock),localStorage.getItem(keys.inventory),localStorage.getItem('basketboss_at_home_requirements_v1')];}),before,'reloading keeps the exhausted ledger and all its history intact');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}));
