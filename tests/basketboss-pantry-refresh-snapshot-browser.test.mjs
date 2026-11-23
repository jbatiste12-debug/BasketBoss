import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';
const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
const options={skip:!chromium?'Set BB_PLAYWRIGHT_MODULE for real-app browser checks':false};
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const baseline=()=>execFileSync('git',['show','c05180b:bb-pantry-inline.js'],{cwd:ROOT,encoding:'utf8'});
const rows=page=>page.evaluate(()=>BBPantryEditor.list());
const storage=page=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])));
async function fixture(source,run){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
   let rel=decodeURIComponent(url.pathname).replace(/^\//,'');
   if(['app','app/','app.html','index.html','index',''].includes(rel))rel='pwa700/app.html';
   if(rel.includes('..'))return route.fulfill({status:404,body:''});
   let body;
   try{
    if(rel.replace(/^pwa700\//,'')==='bb-pantry-inline.js')body=transform700Presentation(source);
    else body=await fs.readFile(path.join(ROOT,rel));
    if(rel.replace(/^pwa700\//,'')==='shopping-inventory.js'){
     body=String(body);const original='list:()=>[...staged.keys()].map(editorRow)';
     assert.equal(body.split(original).length,2,'instrument the original owner read only');
     body=body.replace(original,'list:()=>{(window.__pantryListReads||=[]).push(new Error().stack);return [...staged.keys()].map(editorRow)}');
     const guard='isCurrent:()=>!editorGuard()';assert.equal(body.split(guard).length,2);
     body=body.replace(guard,'isCurrent:()=>{window.__pantryGuardReads=(window.__pantryGuardReads||0)+1;return !editorGuard()}');
    }
   }catch(error){if(error.code==='ENOENT')return route.fulfill({status:404,body:''});throw error;}
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(rel)]||'application/octet-stream',body});
  });
  await context.addInitScript(()=>{
   const OriginalDate=Date,fixed=1795348800000;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
   Math.random=()=>.314159;Object.defineProperty(crypto,'randomUUID',{value:()=> '11111111-2222-4333-8444-555555555555'});
   localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
   localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
   localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
   sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
  });
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
  await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();await page.locator('#bbpiSearch').waitFor({state:'attached'});
  await page.evaluate(async()=>{
   const foods=[['Milk','fridge',500,'ml'],['Rice','cupboard',500,'g'],['Peas','freezer',350,'g'],['Pasta','cupboard',500,'g'],['Butter','fridge',125,'g'],['Cheddar','fridge',250,'g'],['Chicken breast','fridge',300,'g'],['Carrots','fridge',400,'g'],['Broccoli','fridge',200,'g'],['Passata','cupboard',500,'g'],['Plain flour','cupboard',500,'g'],['Frozen sweetcorn','freezer',300,'g'],['Sugar','cupboard',250,'g'],['Oats','cupboard',400,'g'],['Lentils','cupboard',400,'g']];
   for(const [name,loc,qty,unit]of foods){const added=BBPantryEditor.add({name,loc,qty,unit});if(!added?.ok)throw Error(added?.message||'fixture seed');}
   await BBPantryEditor.flush();
  });
  await settle(page);await run(page);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
async function paint(page){
 await page.evaluate(()=>{window.__pantryListReads=[];BBPantryInline.refresh();});await settle(page);
 return page.evaluate(()=>__pantryListReads.filter(stack=>/\bat refresh \(/.test(stack)).length);
}
async function presentation(page){return page.evaluate(()=>({rows:[...document.querySelectorAll('.bbpi-summary-row')].map(node=>node.innerText),tabs:[...document.querySelectorAll('[data-bbpi-storage]')].map(node=>[node.dataset.bbpiStorage,node.getAttribute('aria-selected'),node.getAttribute('aria-label')]),empty:document.getElementById('bbpiEmptyStart')?.hidden}));}

test('one synchronous pantry refresh reuses read-only descriptors and matches all baseline food rows and saved bytes',options,async()=>{
 let old;
 await fixture(baseline(),async page=>{const before=await storage(page),count=await paint(page);old={count,rows:await rows(page),presentation:await presentation(page),storage:await storage(page)};assert.equal(old.count,3);assert.deepEqual(old.storage,before,'baseline refresh is read-only');});
 await fixture(await fs.readFile(path.join(ROOT,'bb-pantry-inline.js'),'utf8'),async page=>{const before=await storage(page);assert.equal(await paint(page),1,'one owner list read per stable presentation paint');assert.deepEqual(await rows(page),old.rows);assert.equal(old.rows.length,15);assert.deepEqual(await presentation(page),old.presentation);assert.deepEqual(await storage(page),before,'optimized refresh is read-only');assert.deepEqual(await storage(page),old.storage,'every persisted key equals the unmodified source');});
});
test('later pantry actions and refreshes see live owner changes, market changes, conflicts and original safety guards',options,async()=>{
 await fixture(await fs.readFile(path.join(ROOT,'bb-pantry-inline.js'),'utf8'),async page=>{
  const rice=(await rows(page)).find(row=>/rice/i.test(row.name));assert.ok(rice);
  await page.getByRole('tab',{name:/^Cupboard,/}).click();
  await page.getByRole('button',{name:'More '+rice.name+' in cupboard',exact:true}).click();
  assert.ok((await rows(page)).find(row=>row.key===rice.key).qty>rice.qty,'next tap obtains a live row');
  await page.evaluate(async key=>{const result=BBPantryEditor.update(key,{qty:777});if(!result.ok)throw Error(result.message);await BBPantryEditor.flush();},rice.key);
  await settle(page);const before=await storage(page);await paint(page);
  assert.equal((await rows(page)).find(row=>row.key===rice.key).qty,777);assert.match((await presentation(page)).rows.join('\n'),/777/);assert.deepEqual(await storage(page),before,'no stale descriptor writeback after the original owner flush');
  await page.evaluate(()=>bb307SwitchIsland('US'));await settle(page);await paint(page);
  assert.equal(await page.evaluate(()=>bb307ActiveMarket()),'US');assert.match((await presentation(page)).rows.join('\n'),/oz|lb/,'next paint uses current market');
  await page.evaluate(key=>BBPantryInline.open(key),rice.key);await page.locator('#bbpi-current-editor').waitFor();
  await page.evaluate(key=>{const result=BBPantryEditor.update(key,{qty:900});if(!result.ok)throw Error(result.message);},rice.key);await settle(page);await paint(page);
  assert.match(await page.locator('#bbpi-current-editor').innerText(),/changed elsewhere/i);assert.equal(await page.locator('#bbpi-current-editor').getByRole('button',{name:'Done',exact:true}).isDisabled(),true,'the existing editor conflict check remains live');
  await page.locator('#bbpi-current-editor .bbpi-close').click();await page.evaluate(()=>BBPantryEditor.flush());await settle(page);
  const guarded=await storage(page);
  await page.evaluate(()=>{window.__oldDeletion=BBAccountDeletion;window.BBAccountDeletion={...BBAccountDeletion,isDeleting:()=>true};BBPantryInline.refresh();});await settle(page);
  assert.equal(await page.locator('#bbpiToolbar').count(),0,'original deletion guard tears down presentation before any owner read');assert.deepEqual(await storage(page),guarded);
  await page.evaluate(()=>{window.BBAccountDeletion=__oldDeletion;BBPantryInline.refresh();});await settle(page);
  await page.evaluate(()=>{localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({user:{id:'different-test-actor'}}));BBPantryInline.refresh();});await settle(page);
  assert.equal(await page.locator('#bbpiToolbar').count(),0,'original actor pin rejects an obsolete owner');
 });
});

// Native <details> toggle notifications arrive after applyStorageView has
// already updated the location, visibility markers and tab selection. Verify
// that only such settled notifications skip descriptor construction: a real
// legacy summary close, a missing/current-state marker or recovery still reads
// the live owner. The source at c05180b provides the paired event-flow oracle.
test('settled native storage notifications avoid duplicate work while real open/close, search, filters and recovery retain baseline behavior',options,async()=>{
 async function scenario(source,optimized){let result;
  await fixture(source,async page=>{
   await settle(page);const before=await storage(page);
   const notification=await page.evaluate(()=>{
    window.__pantryListReads=[];window.__pantryGuardReads=0;
    for(const area of document.querySelectorAll('[data-bb76-store]'))area.dispatchEvent(new Event('toggle'));
    return {reads:__pantryListReads.length,guards:__pantryGuardReads};
   });
   assert.equal(notification.reads,optimized?0:3,'only already-painted native notifications skip descriptor reads');assert.ok(notification.guards>=3,'every notification still invokes the current owner safety check');
   assert.deepEqual(await storage(page),before);
   await page.evaluate(()=>{
    document.querySelector('[role="tab"][data-bbpi-storage="all"]').setAttribute('aria-selected','false');
    window.__pantryListReads=[];document.querySelector('[data-bb76-store="fridge"]').dispatchEvent(new Event('toggle'));
   });
   assert.equal(await page.evaluate(()=>__pantryListReads.length),1,'a divergent nav marker gets the original live update');
   assert.equal(await page.getByRole('tab',{name:/^All,/}).getAttribute('aria-selected'),'true');
   await page.getByRole('tab',{name:/^Cupboard,/}).click();await settle(page);
   await page.evaluate(()=>{window.__pantryListReads=[];document.querySelector('[data-bb76-store="cupboard"]>summary').click();});await settle(page);
   assert.equal(await page.locator('[data-bbpi-storage][aria-selected="true"]').count(),0,'captured legacy summary close clears location selection');
   assert.equal(await page.locator('[data-bb76-store="cupboard"]').evaluate(node=>node.open),false);
   assert.ok(await page.evaluate(()=>__pantryListReads.length)>0,'legacy close retains its required fresh owner read');
   await page.locator('[data-bb76-store="cupboard"]>summary').evaluate(node=>node.click());await settle(page);
   assert.equal(await page.getByRole('tab',{name:/^Cupboard,/}).getAttribute('aria-selected'),'true');
   assert.equal(await page.locator('[data-bb76-store="cupboard"]').evaluate(node=>node.open),true);
   await page.getByRole('tab',{name:/^All,/}).click();await settle(page);
   await page.evaluate(()=>{document.querySelector('[data-bb76-store="fridge"]').open=false;});await settle(page);
   assert.equal(await page.locator('[data-bb76-store]').evaluateAll(nodes=>nodes.every(node=>node.open)),true,'an unexpected native collapse still runs original recovery and keeps All open');
   await page.locator('#bbpiSearch').fill('Milk');await settle(page);
   assert.equal(await page.locator('.bbpi-summary-row:visible').count(),1,'live search still updates row/location counts');
   await page.locator('#bbpiSearch').fill('');await page.locator('#bbpiViewFilters').click();
   await page.getByRole('button',{name:'Low / Out',exact:true}).click();await settle(page);
   assert.equal(await page.locator('.bbpi-summary-row:visible').count(),0,'filter change retains pending reveal and fresh row matching');
   await page.getByRole('button',{name:'All food',exact:true}).click();await settle(page);
   result={rows:await rows(page),presentation:await presentation(page),storage:await storage(page),open:await page.locator('[data-bb76-store]').evaluateAll(nodes=>nodes.map(node=>[node.dataset.bb76Store,node.open,node.dataset.bbpiVisible]))};
  });return result;
 }
 assert.deepEqual(await scenario(await fs.readFile(path.join(ROOT,'bb-pantry-inline.js'),'utf8'),true),await scenario(baseline(),false),'all resulting DOM, quantities and saved bytes match the original event flow');
});
