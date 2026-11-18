import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
const baseline=process.env.BB_SIMPLE_INPUT_BASELINE_DIR;
const captureOnly=process.env.BB_SIMPLE_INPUT_CAPTURE_ONLY==='1';
const output=process.env.BB_SIMPLE_INPUT_SCREENSHOTS||'/tmp/basketboss-pantry-simple-input-screenshots';
let chromium,browser;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const skip=!chromium?'Set BB_PLAYWRIGHT_MODULE to run the real-app browser checks':false;

// All stock and account fixtures stay inside a disposable browser context.
// Original app controls, persistence guards and shopping calculations run live.
async function fixture({name='Rice',unit='g',qty=500,pack=1000,unknown=false,spares=0,width=390}={}){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let name=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(['app','app/','app.html','index.html','index',''].includes(name))name='pwa700/app.html';
  if(name.includes('..'))return route.fulfill({status:404,body:''});
  const source=baseline&&['bb-pantry-inline.js','bb-pantry-inline.css','bb-pantry-add-amount-presentation.js','bb-pantry-stock-levels-ui.js'].includes(name)?path.join(baseline,name):path.join(ROOT,name);
  let body;try{body=await fs.readFile(source);}catch{return route.fulfill({status:404,body:''});}
  const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
  return route.fulfill({status:200,contentType:types[path.extname(name)]||'application/octet-stream',body});
 });
 await context.addInitScript(()=>{
  // iOS shrinks visualViewport while CSS layout viewport remains unchanged.
  const viewport=new EventTarget();Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});
  window.__pantryKeyboardViewport=viewport;
  Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>viewport});
  window.__setPantryKeyboardHeight=height=>{viewport.height=height;viewport.dispatchEvent(new Event('resize'));};
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
 });
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.locator('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]').click();
 await page.waitForFunction(()=>window.BBPantryEditor?.isCurrent?.());
 const key=await page.evaluate(async({name,unit,qty,pack,unknown,spares})=>{
  const added=unknown?{ok:!!BBPantryEditor.select(name,'cupboard',{unit})}:BBPantryEditor.add({name,loc:'cupboard',qty,unit});
  if(!added?.ok)throw Error(added?.message||'seed');await BBPantryEditor.flush();
  let row=BBPantryEditor.list().find(row=>BBHomeHost.id(row.name,'')===BBHomeHost.id(name,''));
  if(!unknown&&pack){
   let patch={packQuantity:pack,packUnit:unit};
   if(spares){const selected=BBPantryStockLevels.select(row,{portion:'full',capacity:pack,unit,spares,confirmed:true,source:'label',capacityEstimated:false},{policy:BBPantryPolicy,market:'Guernsey'});if(!selected.ok)throw Error(selected.message);patch=selected.patch;}
   const changed=BBPantryEditor.update(row.key,patch);if(!changed?.ok)throw Error(changed?.message||'capacity');await BBPantryEditor.flush();
  }
  return row.key;
 },{name,unit,qty,pack,unknown,spares});
 const panel=page.locator('#bbpi-current-editor');
 const snapshot=()=>page.evaluate(key=>{const keys=BBHomeHost.keys();return {row:BBPantryEditor.read(key),stock:localStorage.getItem(keys.stock),inventory:localStorage.getItem(keys.inventory)};},key);
 const open=async()=>{await page.locator('[role="tab"][data-bbpi-storage="cupboard"]').click();await page.locator('.bbpi-add-food:visible').click();await panel.waitFor();await panel.getByLabel('Food name',{exact:true}).fill(name);await panel.getByLabel('Food name',{exact:true}).press('Tab');await panel.locator('.bbpa-amount').waitFor({state:'attached'});};
 const capture=async suffix=>{await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,(baseline?'before-':'after-')+suffix+'.png'),animations:'disabled'});};
 return {context,page,errors,key,panel,snapshot,open,capture};
}
async function save(h){await h.panel.getByRole('button',{name:'Done',exact:true}).click();await h.panel.waitFor({state:'detached'});assert.deepEqual(h.errors,[]);}
async function expand(h){const amount=h.panel.locator('.bbpa-amount');if(!await amount.evaluate(node=>node.open))await amount.locator(':scope>summary').click();return amount;}
async function exact(h){await expand(h);const details=h.panel.locator('.bbpi-amount-details');if(!await details.evaluate(node=>node.open))await details.locator(':scope>summary').click();return h.panel.locator('[data-bbpi-quantity]');}

if(captureOnly){
 for(const [name,unit,qty,pack]of [['Eggs','each',6,0],['Tinned tomatoes','tin',2,0],['Rice','g',250,1000]])test('capture '+name+' current mobile sheet',{skip},async()=>{
  const h=await fixture({name,unit,qty,pack});try{
   await h.open();if(name==='Rice')await expand(h);else{await h.panel.locator('[data-bbpi-stock-level="low"]').click();if(baseline)await h.panel.getByRole('button',{name:'Done',exact:true}).click();}
   await h.capture(name.toLowerCase().replaceAll(' ','-'));
   if(name==='Rice'){
    const quantity=await exact(h);await quantity.focus();await h.page.evaluate(()=>__setPantryKeyboardHeight(450));
    await h.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(!baseline)await quantity.scrollIntoViewIfNeeded();await h.capture('rice-keyboard');
   }
   assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });
}else{
 test('Eggs show count presets and one stepper without pack interrogation; Low saves immediately',{skip},async()=>{
  const h=await fixture({name:'Eggs',unit:'each',qty:6,pack:0});try{
   const original=await h.snapshot();await h.open();
   assert.deepEqual(await h.panel.locator('.bbpa-count-preset').allTextContents(),['1','2','4','6','12']);
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').isVisible(),true);
   assert.equal(await h.panel.locator('.bbpi-stock-capacity:visible,.bbpi-stock-portions:visible,.bbpi-stock-spares-label:visible,.bbpi-stock-pack-toggle:visible').count(),0);
   await h.panel.locator('[data-bbpi-stock-level="low"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'2');
   assert.doesNotMatch(await h.panel.innerText(),/Confirm the pack size|Confirm the size of one pack|Same-size full spares|quarter remaining/);
   assert.deepEqual(await h.snapshot(),original,'Low remains a draft until Done');await h.capture('eggs-low');await save(h);assert.equal((await h.snapshot()).row.qty,2);
  }finally{await h.context.close();}
 });
 test('Running low never increases a known count of one and repeated taps do not compound',{skip},async()=>{
  const h=await fixture({name:'Eggs',unit:'each',qty:1,pack:0});try{await h.open();for(let index=0;index<3;index++)await h.panel.locator('[data-bbpi-stock-level="low"]').tap();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'1');await save(h);assert.equal((await h.snapshot()).row.qty,1);}finally{await h.context.close();}
 });
 test('count presets use the original input and save tins through the existing conversion',{skip},async()=>{
  const h=await fixture({name:'Tinned tomatoes',unit:'tin',qty:2,pack:0});try{
   await h.open();
   // Existing containerUnit metadata keeps the editable tin count while the
   // stock transaction continues to persist its canonical gram quantity.
   await h.panel.locator('.bbpa-counts').waitFor();assert.deepEqual(await h.panel.locator('.bbpa-count-preset').allTextContents(),['1','2','3','4']);
   await h.panel.locator('.bbpa-count-preset').getByText('3',{exact:true}).click();
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'3');
   await h.capture('tinned-tomatoes');await save(h);const saved=await h.snapshot();
   const inventory=JSON.parse(saved.inventory),persisted=inventory[h.key]||Object.values(inventory).find(row=>row.selected&&row.containerUnit==='tin');assert.ok(persisted,JSON.stringify({key:h.key,inventory,row:saved.row}));assert.equal(persisted.qty,1200,JSON.stringify({persisted,row:saved.row,stock:saved.stock}));assert.equal(persisted.unit,'g');assert.equal(persisted.containerUnit,'tin');
   const normal=await h.page.evaluate(key=>{const row=BBPantryEditor.read(key);return BBPantryPolicy.normalize(row.name,row.qty,row.unit,{market:'Guernsey',packReviewed:row.packReviewed,packQuantity:row.packQuantity,packUnit:row.packUnit});},h.key);assert.equal(normal.unit,'g');assert.equal(normal.quantity,1200,'three tins still convert through the existing 400g contents');
  }finally{await h.context.close();}
 });
 test('unknown Got it saves unknown and retains the full shopping requirement and Check stock prompt',{skip},async()=>{
  const h=await fixture({unknown:true});try{
   const original=await h.snapshot();assert.equal(original.row.qty,null);await h.open();await h.panel.locator('[data-bbpi-stock-level="got"]').click();await save(h);
   const saved=await h.snapshot();assert.equal(saved.row.qty,null);assert.equal(saved.row.unroundedShortfall,original.row.unroundedShortfall);assert.ok(saved.row.unroundedShortfall>0);assert.equal(saved.stock,original.stock);
   await h.page.locator('#bbPrimaryNavigation [data-bb-nav-item="shop"]').click();await h.page.locator('.bbpi-stock-shop-check').waitFor();assert.match(await h.page.locator('.bbpi-stock-shop-check').innerText(),/Rice.*Check amount/);
  }finally{await h.context.close();}
 });
 test('measured Running low uses saved 1kg pack automatically and leaves the exact 250g gap',{skip},async()=>{
  const h=await fixture({qty:500,pack:1000});try{
   await h.open();await h.panel.locator('[data-bbpi-stock-level="low"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'250');
   assert.equal(await h.panel.locator('.bbpa-amount').evaluate(node=>node.open),false);await h.capture('rice-low');await save(h);
   const saved=await h.snapshot();assert.equal(saved.row.qty,250);assert.equal(saved.row.stockLevel.estimated,true);assert.equal(saved.row.stockLevel.portion,'low');assert.equal(saved.row.unroundedShortfall,250);
   await h.open();await h.panel.locator('[data-bbpi-stock-level="got"]').click();await save(h);assert.equal((await h.snapshot()).row.qty,250,'Got it cannot silently refill a measured balance');
  }finally{await h.context.close();}
 });
 test('Running low uses a newly edited physical pack size instead of stale level metadata',{skip},async()=>{
  const h=await fixture({qty:500,pack:1000});try{
   await h.open();await h.panel.locator('[data-bbpi-stock-level="low"]').click();await save(h);
   assert.equal((await h.snapshot()).row.stockLevel.capacity,1000);
   await h.open();await expand(h);
   const more=h.panel.locator('.bbpi-more-options');if(!await more.evaluate(node=>node.open))await more.locator(':scope>summary').click();
   const pack=h.panel.locator('.bbpi-pack');if(!await pack.evaluate(node=>node.open))await pack.locator(':scope>summary').click();
   await pack.locator('input').fill('500');assert.equal(await pack.locator('select').inputValue(),'g');
   await h.panel.locator('[data-bbpi-stock-level="low"]').click();
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'125','a new 500g physical pack must replace the previous 1kg basis');
   await save(h);const saved=await h.snapshot();assert.equal(saved.row.qty,125);assert.equal(saved.row.packQuantity,500);assert.equal(saved.row.stockLevel.capacity,500);assert.equal(saved.row.unroundedShortfall,375);
  }finally{await h.context.close();}
 });
 test('Full, Half and Quarter actions are one row and duplicate taps keep an absolute balance',{skip},async()=>{
  const h=await fixture({qty:500,pack:1000});try{
   await h.open();await expand(h);
   assert.deepEqual(await h.panel.locator('.bbpi-stock-portion:visible').allTextContents(),['Full pack','Half pack','Quarter left']);
   for(const [portion,qty]of [['full','1000'],['half','500'],['low','250']]){for(let tap=0;tap<2;tap++)await h.panel.locator('[data-bbpi-stock-portion="'+portion+'"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),qty);}
   await save(h);assert.equal((await h.snapshot()).row.qty,250);
  }finally{await h.context.close();}
 });
 test('Out shows None at home at zero and retains two unopened packs as stock',{skip},async()=>{
  for(const [spares,total]of [[0,0],[2,2000]]){
   const h=await fixture({qty:1000,pack:1000,spares});try{
    await h.open();await h.panel.locator('[data-bbpi-stock-level="out"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),String(total));
    assert.equal(await h.panel.getByText('None at home',{exact:true}).isVisible(),spares===0);
    if(spares)assert.equal(await h.panel.getByText('Opened pack finished · 2 unopened packs left',{exact:true}).isVisible(),true);
    await save(h);const saved=await h.snapshot();assert.equal(saved.row.qty,total);if(spares)assert.equal(saved.row.stockLevel.spares,2);
   }finally{await h.context.close();}
  }
 });
 test('Out on counted eggs preserves two unopened six-packs',{skip},async()=>{
  const h=await fixture({name:'Eggs',unit:'each',qty:6,pack:6,spares:2});try{
   await h.open();assert.equal(await h.panel.locator('.bbpi-stock-spares-label:visible').count(),0);
   await h.panel.locator('[data-bbpi-stock-level="out"]').tap();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'12');
   assert.equal(await h.panel.getByText('None at home',{exact:true}).isVisible(),false);
   assert.equal(await h.panel.getByText('Opened pack finished · 2 unopened packs left',{exact:true}).isVisible(),true);
   await save(h);const saved=await h.snapshot();assert.equal(saved.row.qty,12);assert.equal(saved.row.stockLevel.spares,2);assert.equal(saved.row.stockLevel.capacity,6);
  }finally{await h.context.close();}
 });
 test('the real visual viewport shrinks without clipping the amount controls or moving Done under the keyboard',{skip},async()=>{
  const h=await fixture({qty:250,pack:1000});try{
   const original=await h.snapshot();await h.open();const quantity=await exact(h);await quantity.focus();
   await h.page.evaluate(()=>__setPantryKeyboardHeight(450));await h.panel.waitFor({state:'visible'});
   await h.page.waitForFunction(()=>document.querySelector('#bbpi-current-editor').classList.contains('bbpa-keyboard-open'));
   await quantity.scrollIntoViewIfNeeded();
   const geometry=await h.panel.evaluate(node=>{
    const input=node.querySelector('[data-bbpi-quantity]'),stepper=input.closest('.bbpi-stepper'),scroll=node.querySelector('.bbpi-editor-content'),done=node.querySelector('.bbpi-done');
    const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    return {layout:innerHeight,visible:visualViewport.height,input:rect(input),scroll:rect(scroll),done:rect(done),controls:[...stepper.children].map(rect),accordion:rect(node.querySelector('.bbpa-amount'))};
   });
   assert.equal(geometry.layout,844,'the CSS layout viewport did not shrink');assert.equal(geometry.visible,450);
   assert.ok(geometry.controls.every(rect=>rect.width>=44&&rect.height>=44),'all stepper controls retain 44px targets: '+JSON.stringify(geometry));
   assert.ok(geometry.input.y>=geometry.scroll.y-1&&geometry.input.bottom<=geometry.scroll.bottom+1,'the complete input can scroll above Done: '+JSON.stringify(geometry));
   assert.ok(geometry.done.y>=0&&geometry.done.bottom<=451,'Done remains above the simulated keyboard: '+JSON.stringify(geometry));
   await h.capture('rice-keyboard');assert.deepEqual(await h.snapshot(),original,'keyboard adjustments cannot save or alter stock');
  }finally{await h.context.close();}
 });
 test('tapping a count preset or stepper never focuses the numeric input',{skip},async()=>{
  const h=await fixture({name:'Eggs',unit:'each',qty:6,pack:0});try{
   await h.open();await h.panel.locator('[data-bbpi-stock-level="got"]').focus();
   await h.page.evaluate(()=>{window.__pantryNumberFocus=0;document.addEventListener('focusin',event=>{if(event.target.matches('[data-bbpi-quantity]'))__pantryNumberFocus++;},true);});
   await h.panel.locator('.bbpa-count-preset').getByText('4',{exact:true}).click();
   await h.panel.locator('.bbpi-quantity-label .bbpi-step').last().click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'5');
   assert.equal(await h.page.evaluate(()=>__pantryNumberFocus),0);await save(h);assert.equal((await h.snapshot()).row.qty,5);
  }finally{await h.context.close();}
 });
 test('editing an existing counted item also uses the simplified count row',{skip},async()=>{
  const h=await fixture({name:'Eggs',unit:'each',qty:6,pack:0});try{
   assert.equal(await h.page.evaluate(key=>BBPantryInline.open(key),h.key),true);await h.panel.waitFor();
   assert.equal(await h.panel.locator('.bbpi-name-label').count(),0,'this is the original existing-item editor');
   assert.equal(await h.panel.locator('.bbpa-counts').isVisible(),true);assert.equal(await h.panel.locator('.bbpi-stock-portion:visible,.bbpi-stock-spares-label:visible').count(),0);
   await h.panel.getByRole('button',{name:'4',exact:true}).click();await save(h);assert.equal((await h.snapshot()).row.qty,4);
  }finally{await h.context.close();}
 });
 test('Got it after an Out draft restores unknown instead of inventing stock',{skip},async()=>{
  const h=await fixture({unknown:true});try{
   const original=await h.snapshot();await h.open();await h.panel.locator('[data-bbpi-stock-level="out"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'0');
   await h.panel.locator('[data-bbpi-stock-level="got"]').click();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'');
   await save(h);const saved=await h.snapshot();assert.equal(saved.row.qty,null);assert.equal(saved.stock,original.stock);assert.equal(saved.row.unroundedShortfall,original.row.unroundedShortfall);
  }finally{await h.context.close();}
 });
 test('unknown Eggs keep blank count until an explicit preset is tapped',{skip},async()=>{
  const h=await fixture({name:'Eggs',unit:'each',unknown:true,pack:0});try{
   const original=await h.snapshot();await h.open();assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'');
   await save(h);let saved=await h.snapshot();assert.equal(saved.row.qty,null);assert.equal(saved.row.unroundedShortfall,original.row.unroundedShortfall);assert.equal(saved.stock,original.stock);
   await h.open();await h.panel.getByRole('button',{name:'4',exact:true}).click();await save(h);saved=await h.snapshot();assert.equal(saved.row.qty,4);
  }finally{await h.context.close();}
 });
 for(const unit of ['jar','g'])test('Running low saves an unknown custom '+unit+' without inventing a container or crediting stock',{skip},async()=>{
  const h=await fixture({name:'Family preserve',unit,unknown:true,pack:0});try{
   const original=await h.snapshot();assert.equal(original.row.qty,null);await h.open();await h.panel.locator('[data-bbpi-stock-level="low"]').click();
   assert.equal(await h.panel.locator('[data-bbpi-quantity]').inputValue(),'','no compatible physical size means the amount stays unknown');
   assert.equal(await h.panel.locator('[data-bbpi-stock-level="low"]').getAttribute('aria-pressed'),'true');
   await save(h);const saved=await h.snapshot();assert.equal(saved.row.qty,null);assert.equal(saved.stock,original.stock);assert.equal(saved.row.unroundedShortfall,original.row.unroundedShortfall);
   assert.equal(saved.row.packQuantity,original.row.packQuantity);assert.equal(saved.row.stockLevel,original.row.stockLevel);
  }finally{await h.context.close();}
 });
}
