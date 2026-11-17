import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
const captureBefore=process.env.BB_ADD_FOOD_CAPTURE_BEFORE==='1';
const baselineDirectory=process.env.BB_ADD_FOOD_BASELINE_DIR;
const output=process.env.BB_ADD_FOOD_SCREENSHOTS||'/workspace/shared/BasketBoss-Add-Food-20261116';
let chromium,browser;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const skip=!chromium?'Set BB_PLAYWRIGHT_MODULE to run real-app browser checks':false;

// Only the disposable browser context is seeded. Every control, calculation
// and save below uses the real generated app and its existing editor handlers.
async function fixture(width=390,{qty=500,pack=1000,buffer=0,unknown=false,reducedMotion='reduce'}={}){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 const baseline=captureBefore?await fs.readFile('/tmp/basketboss-add-food-before-app.html'):null;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let name=decodeURIComponent(url.pathname).replace(/^\//,'');
  const app=['app','app/','app.html','index.html','index',''].includes(name);
  if(app)name='pwa700/app.html';
  if(name.includes('..'))return route.fulfill({status:404,body:''});
  const source=baselineDirectory&&['bb-pantry-inline.js','bb-pantry-inline.css','bb-pantry-add-amount-presentation.js'].includes(name)?path.join(baselineDirectory,name):path.join(ROOT,name);
  let body;try{body=app&&baseline?baseline:await fs.readFile(source);}catch{return route.fulfill({status:404,body:''});}
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
 const key=await page.evaluate(async({qty,pack,buffer,unknown})=>{
  const added=unknown?{ok:!!BBPantryEditor.select('Rice','cupboard',{unit:'g'})}:BBPantryEditor.add({name:'Rice',loc:'cupboard',qty,unit:'g'});if(!added?.ok)throw Error(added?.message||'seed');await BBPantryEditor.flush();
  const row=BBPantryEditor.list().find(row=>BBHomeHost.id(row.name,'')===BBHomeHost.id('Rice',''));
  if(!unknown){const changed=BBPantryEditor.update(row.key,{packQuantity:pack,packUnit:'g',extraBuffer:buffer});if(!changed?.ok)throw Error(changed?.message||'capacity');await BBPantryEditor.flush();}return row.key;
 },{qty,pack,buffer,unknown});
 const panel=page.locator('#bbpi-current-editor');
 const snapshot=()=>page.evaluate(key=>{const keys=BBHomeHost.keys();return {row:BBPantryEditor.read(key),stock:localStorage.getItem(keys.stock),inventory:localStorage.getItem(keys.inventory)};},key);
 const open=async()=>{
  await page.locator('[role="tab"][data-bbpi-storage="cupboard"]').click();await page.locator('.bbpi-add-food:visible').click();await panel.waitFor();
  await panel.getByLabel('Food name',{exact:true}).fill('Rice');await panel.getByLabel('Food name',{exact:true}).press('Tab');
  if(!captureBefore)await panel.locator('.bbpa-amount').waitFor({state:'attached'});
 };
 const capture=async name=>{await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});};
 return {context,page,errors,key,panel,snapshot,open,capture};
}

async function expand(h){
 const amount=h.panel.locator('.bbpa-amount');
 if(!await amount.evaluate(node=>node.open))await amount.locator(':scope>summary').click();
 await h.panel.locator('.bbpi-stock-capacity').first().waitFor();
 return amount;
}
async function chooseCapacity(h,source='saved size'){
 await h.panel.locator('.bbpi-stock-capacity').filter({hasText:source}).first().click();
}
async function exactAmount(h,value){
 await expand(h);const details=h.panel.locator('.bbpi-amount-details');
 if(!await details.evaluate(node=>node.open))await details.locator(':scope>summary').click();
 await h.panel.locator('[data-bbpi-quantity]').fill(value);
}
async function save(h){await h.panel.getByRole('button',{name:'Done',exact:true}).click();await h.panel.waitFor({state:'detached'});}

if(captureBefore){
 test('capture the original Add food sheet before the presentation loader',{skip},async()=>{
  const h=await fixture();try{
   await h.open();assert.equal(await h.panel.locator('.bbpa-amount').count(),0,'saved baseline has no new presentation');await h.capture('before');assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });
}else{
 for(const width of [390,320])test('Add food starts collapsed and keeps native autocomplete and original controls at '+width+'px',{skip},async()=>{
  const h=await fixture(width);try{
   const original=await h.snapshot();await h.open();const amount=h.panel.locator('.bbpa-amount'),name=h.panel.getByLabel('Food name',{exact:true});
   assert.equal(await amount.evaluate(node=>node.tagName),'DETAILS');assert.equal(await amount.evaluate(node=>node.open),false);
   assert.equal(await name.getAttribute('list'),'bbpiFoodNames');assert.equal(await name.getAttribute('autocomplete'),'off');
   assert.ok(await h.panel.locator('#bbpiFoodNames option').count()>0,'the original food suggestions remain attached');
   assert.equal(await h.panel.locator('#bbpiFoodNames option[value="Rice"]').count(),1);
   assert.equal(await h.panel.locator('.bbpi-stock-pack-toggle').count(),1,'the original toggle remains mounted');
   assert.equal(await h.panel.locator('.bbpi-stock-pack-toggle').isVisible(),false);
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').isVisible(),false);assert.equal(await h.panel.locator('.bbpi-stock-spares').isVisible(),false);
   assert.deepEqual(await h.panel.locator('.bbpi-stock-choice').allTextContents(),['Got it','Running low','Out']);
   const targets=await h.panel.locator('.bbpi-stock-choice,.bbpi-close,.bbpi-done,.bbpa-amount>summary').evaluateAll(nodes=>nodes.map(node=>({label:node.textContent,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
   assert.ok(targets.every(rect=>rect.width>=44&&rect.height>=44),'all default controls keep 44px targets: '+JSON.stringify(targets));
   assert.equal(await h.panel.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
   await h.capture(width===390?'after':'after-320');
   await h.panel.evaluate(node=>{window.__addFoodControls={name:node.querySelector('.bbpi-name-label input'),quantity:node.querySelector('[data-bbpi-quantity]'),spares:node.querySelector('.bbpi-stock-spares'),portions:[...node.querySelectorAll('.bbpi-stock-portion')]};});
   await expand(h);assert.equal(await h.panel.getByLabel('Extra unopened packs',{exact:true}).count(),1);
   assert.match(await h.panel.locator('.bbpi-stock-spares-label').innerText(),/^Extra unopened packs/);
   assert.equal(await h.panel.locator('.bbpi-stock-portions').count(),1);assert.equal(await h.panel.locator('.bbpi-stock-portion:visible').count(),2);
   const portionBoxes=await h.panel.locator('.bbpi-stock-portion').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().y));
   assert.ok(Math.abs(portionBoxes[0]-portionBoxes[1])<2,'Full and Half share one row');
   assert.equal(await h.page.evaluate(()=>Object.values(__addFoodControls).flat().every(node=>node.isConnected)),true);
   assert.deepEqual(await h.snapshot(),original,'opening optional amount controls does not save stock');
   await h.capture(width===390?'after-expanded':'after-expanded-320');
   await amount.locator(':scope>summary').click();assert.equal(await amount.evaluate(node=>node.open),false);
   await h.panel.locator('.bbpi-close').click();assert.deepEqual(await h.snapshot(),original,'collapse and dismiss preserve saved pantry bytes');assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('Full, Half, extra unopened packs and exact decimals keep the existing arithmetic',{skip},async()=>{
  const h=await fixture();try{
   const original=await h.snapshot();await h.open();await expand(h);await chooseCapacity(h);
   await h.panel.locator('[data-bbpi-stock-portion="full"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'1000');
   await h.panel.locator('[data-bbpi-stock-portion="half"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'500');
   await h.panel.getByLabel('Extra unopened packs',{exact:true}).fill('2');assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'2500');
   assert.deepEqual(await h.snapshot(),original,'amount choices remain drafts before Done');
   await save(h);let saved=await h.snapshot();assert.equal(saved.row.qty,2500);assert.equal(saved.row.stockLevel.spares,2);assert.equal(saved.row.stockLevel.portion,'half');
   await h.open();await exactAmount(h,'175.25');await save(h);saved=await h.snapshot();assert.equal(saved.row.qty,175.25);assert.equal(saved.row.stockLevel,null);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('Running low keeps Estimated and check-label guidance visible outside Add amount',{skip},async()=>{
  const h=await fixture();try{
   await h.open();await h.panel.locator('[data-bbpi-stock-level="low"]').click();await chooseCapacity(h,'suggested');
   const explanation=h.panel.locator('.bbpi-stock-explanation');assert.match(await explanation.innerText(),/Estimated/);assert.match(await explanation.innerText(),/check the label/i);
   const amount=h.panel.locator('.bbpa-amount');await amount.locator(':scope>summary').click();assert.equal(await amount.evaluate(node=>node.open),false);
   assert.equal(await explanation.isVisible(),true);await save(h);const saved=await h.snapshot();assert.equal(saved.row.stockLevel.estimated,true);assert.equal(saved.row.stockLevel.capacityEstimated,true);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('Out with zero shows None at home while Out with unopened packs keeps a positive balance',{skip},async()=>{
  const h=await fixture();try{
   const original=await h.snapshot();await h.open();await h.panel.locator('[data-bbpi-stock-level="out"]').click();
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'0');assert.equal(await h.panel.getByText('None at home',{exact:true}).isVisible(),true);
   assert.equal(await h.panel.locator('.bbpa-amount').isVisible(),false);assert.equal(await h.panel.locator('[data-bbpi-quantity]').isVisible(),false);
   await h.capture('after-out');assert.deepEqual(await h.snapshot(),original);await h.panel.locator('.bbpi-close').click();
   await h.open();await expand(h);await chooseCapacity(h);await h.panel.locator('[data-bbpi-stock-portion="full"]').click();
   await h.panel.getByLabel('Extra unopened packs',{exact:true}).fill('1');await h.panel.locator('[data-bbpi-stock-level="out"]').click();
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'1000');assert.equal(await h.panel.getByText('None at home',{exact:true}).isVisible(),false);
   assert.equal(await h.panel.locator('.bbpi-stock-amount').isVisible(),true);assert.match(await h.panel.locator('.bbpi-stock-amount').innerText(),/at home/);
   await h.capture('after-out-with-unopened-pack');await save(h);const saved=await h.snapshot();assert.equal(saved.row.qty,1000);assert.equal(saved.row.stockLevel.portion,'out');assert.equal(saved.row.stockLevel.spares,1);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('a hidden invalid extra-pack count reveals the native disclosures and receives focus without saving',{skip},async()=>{
  const h=await fixture();try{
   const original=await h.snapshot();await h.open();await expand(h);await chooseCapacity(h);await h.panel.locator('[data-bbpi-stock-portion="half"]').click();
   const spares=h.panel.getByLabel('Extra unopened packs',{exact:true}),amount=h.panel.locator('.bbpa-amount');await spares.fill('-1');await amount.locator(':scope>summary').click();
   assert.equal(await amount.evaluate(node=>node.open),false);await h.panel.getByRole('button',{name:'Done',exact:true}).click();
   assert.equal(await amount.evaluate(node=>node.open),true);assert.equal(await spares.isVisible(),true);assert.equal(await spares.evaluate(node=>node===document.activeElement),true);
   assert.match(await h.panel.innerText(),/whole number|spare packs/i);assert.deepEqual(await h.snapshot(),original,'invalid hidden inputs cannot save an earlier draft');
   await h.panel.locator('.bbpi-close').click();assert.deepEqual(await h.snapshot(),original);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('unknown stock cannot be saved by Got it and the existing amount error reveals and focuses its field',{skip},async()=>{
  const h=await fixture(390,{unknown:true});try{
   const original=await h.snapshot();assert.equal(original.row.qty,null);await h.open();
   const amount=h.panel.locator('.bbpa-amount'),quantity=h.panel.locator('[data-bbpi-quantity]');assert.equal(await amount.evaluate(node=>node.open),false);
   await h.panel.locator('[data-bbpi-stock-level="got"]').click();assert.equal(await amount.evaluate(node=>node.open),true);
   assert.equal(await quantity.inputValue(),'');assert.deepEqual(await h.snapshot(),original,'Got it alone supplies no unknown stock');
   await amount.locator(':scope>summary').click();await h.panel.getByRole('button',{name:'Done',exact:true}).click();
   assert.equal(await amount.evaluate(node=>node.open),true);assert.equal(await quantity.isVisible(),true);assert.equal(await quantity.evaluate(node=>node===document.activeElement),true);
   assert.deepEqual(await h.snapshot(),original,'the existing unknown-amount validation preserves stock');await h.panel.locator('.bbpi-close').click();assert.deepEqual(await h.snapshot(),original);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('a prefilled quick-add opens in normal motion without focusing hidden amount fields or changing stock',{skip},async()=>{
  const h=await fixture(390,{reducedMotion:'no-preference'});try{
   await h.page.evaluate(async key=>{
    BBPantryEditor.remove(key);await BBPantryEditor.flush();
    window.__pantryOpenFocus=[];
    document.addEventListener('focusin',event=>{
     const panel=event.target.closest?.('#bbpi-current-editor');
     if(panel)window.__pantryOpenFocus.push({type:event.target.type||'',label:event.target.getAttribute('aria-label')});
    });
   },h.key);
   const original=await h.snapshot();
   await h.page.locator('[data-bbpi-quick-add="Pasta"]').click();await h.panel.waitFor();
   const amount=h.panel.locator('.bbpa-amount'),name=h.panel.getByLabel('Food name',{exact:true});
   assert.equal(await name.inputValue(),'Pasta');assert.equal(await amount.evaluate(node=>node.open),false);
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').isVisible(),false);
   const initialFocus=await h.page.evaluate(()=>({
    numberFocused:window.__pantryOpenFocus.some(entry=>entry.type==='number'),
    visible:document.activeElement.getClientRects().length>0,
    inSheet:!!document.activeElement.closest('#bbpi-current-editor'),
    hiddenAmount:!!document.activeElement.closest('.bbpa-amount:not([open])')
   }));
   assert.deepEqual(initialFocus,{numberFocused:false,visible:true,inSheet:true,hiddenAmount:false},'opening must not flash a number keyboard then blur to the page');
   await h.panel.evaluate(node=>{window.__quickAddControls=[node.querySelector('.bbpi-name-label input'),node.querySelector('[data-bbpi-quantity]'),node.querySelector('.bbpi-stock-spares')];});
   const frames=await h.panel.evaluate(async node=>{
    const result=[];for(let i=0;i<4;i++){await new Promise(requestAnimationFrame);const rect=node.getBoundingClientRect();result.push({top:rect.top,bottom:rect.bottom,left:rect.left,width:rect.width});}return result;
   });
   assert.ok(frames.every(rect=>Math.abs(rect.top-frames[0].top)<1&&Math.abs(rect.left-frames[0].left)<1&&rect.width<=390&&rect.bottom<=845),'the sheet settles without jumping between top and bottom');
   await h.page.setViewportSize({width:390,height:520});
   await name.focus();await name.fill('Pasta');
   const keyboardGeometry=await h.panel.boundingBox();
   assert.ok(keyboardGeometry.y>=0&&keyboardGeometry.y+keyboardGeometry.height<=521,'simulated keyboard viewport keeps the sheet in reach');
   assert.equal(await h.page.evaluate(()=>__quickAddControls.every(node=>node.isConnected)),true);
   assert.deepEqual(await h.snapshot(),original,'quick-add and viewport changes remain an unsaved draft');
   await h.page.setViewportSize({width:390,height:844});await h.capture('after-quick-add');
   await h.panel.locator('.bbpi-close').click();assert.deepEqual(await h.snapshot(),original);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 for(const unknown of [false,true])test('single touch level changes stay acknowledged and in place with '+(unknown?'unknown':'known')+' stock',{skip},async()=>{
  const h=await fixture(390,{unknown,reducedMotion:'no-preference'});try{
   const original=await h.snapshot();await h.open();
   const first=await h.panel.locator('[data-bbpi-stock-level="got"]').boundingBox();
   for(const level of ['low','got','out','got','low','out']){
    await h.panel.locator('[data-bbpi-stock-level="'+level+'"]').tap();
    assert.deepEqual(await h.panel.locator('.bbpi-stock-choice[aria-pressed="true"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.bbpiStockLevel)),[level],'one tap acknowledges the most recent choice');
    const box=await h.panel.locator('[data-bbpi-stock-level="'+level+'"]').boundingBox();
    assert.ok(Math.abs(box.y-first.y)<4,'changing level does not move the selector');
    if(level!=='out'&&await h.panel.locator('.bbpi-stock-pending').isVisible()){
     assert.match(await h.panel.locator('.bbpi-stock-pending').innerText(),/selected|Confirm/);
     assert.match(await h.panel.locator('.bbpi-stock-explanation').innerText(),/Amount not changed yet/);
     assert.equal(await h.panel.locator('.bbpa-amount>summary').innerText(),'Confirm amount\nConfirm the amount before Done');
    }
    assert.deepEqual(await h.snapshot(),original,'level taps remain drafts until Done');
   }
   await h.capture(unknown?'after-toggle-unknown':'after-toggle-known');
   await h.panel.locator('[data-bbpi-stock-level="got"]').tap();
   await h.panel.getByRole('button',{name:'Done',exact:true}).tap();
   assert.equal(await h.panel.isVisible(),true,'unconfirmed Got it cannot save the previous Out draft');
   assert.deepEqual(await h.snapshot(),original);assert.match(await h.panel.innerText(),/Confirm Full or Half pack/);
   await h.capture(unknown?'after-toggle-unknown-review':'after-toggle-known-review');
   await h.panel.locator('.bbpi-close').click();assert.deepEqual(await h.snapshot(),original);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('new Got it intent survives extra-pack and unit edits until an explicit portion is confirmed',{skip},async()=>{
  const h=await fixture(390,{reducedMotion:'no-preference'});try{
   const original=await h.snapshot();await h.open();await expand(h);await chooseCapacity(h);
   await h.panel.locator('[data-bbpi-stock-portion="half"]').tap();
   await h.panel.locator('[data-bbpi-stock-level="out"]').tap();
   await h.panel.locator('[data-bbpi-stock-level="got"]').tap();
   const spares=h.panel.getByLabel('Extra unopened packs',{exact:true});await spares.fill('2');
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'0','editing extras cannot reapply the old Out portion');
   assert.equal(await h.panel.locator('.bbpi-stock-pending').isVisible(),true);
   await h.panel.getByRole('button',{name:'Done',exact:true}).tap();assert.equal(await h.panel.isVisible(),true);assert.deepEqual(await h.snapshot(),original);
   const amount=h.panel.locator('.bbpi-amount-details');if(!await amount.evaluate(node=>node.open))await amount.locator(':scope>summary').click();
   await h.panel.locator('.bbpi-unit-label select').selectOption('kg');assert.equal(await h.panel.locator('.bbpi-stock-pending').isVisible(),true,'a unit-only edit cannot confirm Got it');
   await h.panel.getByRole('button',{name:'Done',exact:true}).tap();assert.equal(await h.panel.isVisible(),true);assert.deepEqual(await h.snapshot(),original);
   await h.panel.locator('.bbpi-unit-label select').selectOption('g');
   await h.panel.locator('[data-bbpi-quantity]').fill('175.25');
   assert.equal(await h.panel.locator('.bbpi-stock-pending').isVisible(),false,'an explicitly entered exact amount resolves the intent');
   await save(h);assert.equal((await h.snapshot()).row.qty,175.25);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('the latest requested level owns pack confirmation after an invalid extra-pack count',{skip},async()=>{
  const h=await fixture(390,{reducedMotion:'no-preference'});try{
   const original=await h.snapshot();await h.open();await h.panel.locator('[data-bbpi-stock-level="low"]').tap();
   const spares=h.panel.getByLabel('Extra unopened packs',{exact:true});await spares.fill('-1');
   await h.panel.locator('[data-bbpi-stock-level="out"]').tap();await spares.fill('2');await chooseCapacity(h);
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'2000','Out with two full spares must not apply the older Low request');
   assert.equal(await h.panel.locator('.bbpi-stock-pending').isVisible(),false);
   assert.deepEqual(await h.snapshot(),original);await save(h);const saved=await h.snapshot();
   assert.equal(saved.row.qty,2000);assert.equal(saved.row.stockLevel.portion,'out');assert.equal(saved.row.stockLevel.spares,2);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });

 test('an unconfirmed Half pack request cannot fall back to the previous Low portion',{skip},async()=>{
  const h=await fixture(390,{reducedMotion:'no-preference'});try{
   const original=await h.snapshot();await h.open();await expand(h);await chooseCapacity(h);
   await h.panel.locator('[data-bbpi-stock-level="low"]').tap();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'250');
   const spares=h.panel.getByLabel('Extra unopened packs',{exact:true});await spares.fill('-1');
   await h.panel.locator('[data-bbpi-stock-portion="half"]').tap();await spares.fill('2');
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'250','invalid Half confirmation must not apply the old Low draft with new spares');
   await h.panel.getByRole('button',{name:'Done',exact:true}).tap();assert.equal(await h.panel.isVisible(),true);assert.deepEqual(await h.snapshot(),original);
   await chooseCapacity(h);assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'2500');
   await save(h);const saved=await h.snapshot();assert.equal(saved.row.qty,2500);assert.equal(saved.row.stockLevel.portion,'half');assert.equal(saved.row.stockLevel.spares,2);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });
}
