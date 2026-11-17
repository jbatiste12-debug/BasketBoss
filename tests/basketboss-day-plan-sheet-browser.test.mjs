import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});

async function fixture(width,height){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<768,hasTouch:width<768,serviceWorkers:'block',reducedMotion:'no-preference'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // All requests are local fixtures. No account, AI or production data is used.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let name=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(['app','app/','app.html','index.html','index',''].includes(name))name='pwa700/app.html';
  if(name.includes('..'))return route.fulfill({status:404,body:''});
  try{
   const body=await fs.readFile(path.join(root,name)),types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(name)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4},{recipeId:'fajitas',day:'Tuesday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
 });
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.locator('.bbnext-day.has-meal').first().waitFor();
 await page.waitForFunction(()=>!document.querySelector('#app').getAnimations().some(animation=>animation.playState==='running'));
 const snapshot=()=>page.evaluate(()=>Object.fromEntries(['basketboss_321_unified_state_v1','basketboss_321_v7_measured_pantry','basketboss_makeameal_v1_inventory'].map(key=>[key,localStorage.getItem(key)])));
 return {context,page,errors,snapshot};
}

async function assertVisibleViewportSheet(page,width,height){
 const bounds=await page.locator('.bbdps-active').evaluate(row=>{
  const content=row.querySelector(':scope>.bbnext-day-content'),backdrop=row.querySelector(':scope>.bbdps-backdrop'),title=content.querySelector('.bbdps-title');
  const rect=node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:box.width,height:box.height};};
  const titleBox=title.getBoundingClientRect(),point=document.elementFromPoint(titleBox.x+Math.min(20,titleBox.width/2),titleBox.y+titleBox.height/2);
  return {content:rect(content),backdrop:rect(backdrop),title:rect(title),front:content.contains(point),appTransform:getComputedStyle(document.querySelector('#app')).transform};
 });
 assert.equal(bounds.appTransform,'none','a completed entrance animation cannot contain the fixed sheet');
 assert.ok(bounds.content.y>=0&&bounds.content.bottom<=height+1,'the whole sheet remains in the viewport: '+JSON.stringify(bounds));
 assert.ok(bounds.title.y>=0&&bounds.title.bottom<height,'the title is on screen');assert.equal(bounds.front,true,'the sheet paints above its backdrop');
 assert.ok(Math.abs(bounds.backdrop.x)<1&&Math.abs(bounds.backdrop.y)<1,'the backdrop begins at the viewport origin');
 assert.ok(Math.abs(bounds.backdrop.width-width)<1&&Math.abs(bounds.backdrop.height-height)<1,'the backdrop covers the viewport');
 return bounds;
}

async function assertBudgetCopyDoesNotOverlap(page){
 const checks=await page.locator('.bbpc-budget-overview .bbnext-plan-donut-core').evaluate(core=>{
  const price=core.querySelector('strong'),caption=core.querySelector('small'),saved=price.textContent;
  try{return [saved,'£0.00','£1,234.56'].map(value=>{
   // Exercise typography only; no pricing function or saved value is changed.
   price.textContent=value;const amount=price.getBoundingClientRect(),label=caption.getBoundingClientRect(),hero=core.closest('.bbnext-plan-budget').getBoundingClientRect();
   return {value,amountWidth:amount.width,amountInk:price.scrollWidth,labelWidth:label.width,labelInk:caption.scrollWidth,gap:label.x-amount.right,right:Math.max(amount.right,label.right),heroRight:hero.right};
  });}finally{price.textContent=saved;}
 });
 for(const check of checks){
  assert.ok(check.amountInk<=check.amountWidth+1,'the amount has room for its full text: '+JSON.stringify(check));
  assert.ok(check.labelInk<=check.labelWidth+1,'the caption cannot shrink under the price');
  assert.ok(check.gap>=8,'the amount and caption retain a visible gap: '+JSON.stringify(check));
  assert.ok(check.right<=check.heroRight+1,'budget copy remains inside its card');
 }
}

for(const [width,height]of [[1280,900],[390,844]])test('normal-motion day arrow keeps the editor above a viewport backdrop at '+width+'px',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const h=await fixture(width,height);try{
  const {page}=h,original=await h.snapshot(),monday=page.locator('.bbnext-day[data-bbnext-day="Monday"]'),tuesday=page.locator('.bbnext-day[data-bbnext-day="Tuesday"]');
  await assertBudgetCopyDoesNotOverlap(page);
  if(process.env.BB_DAY_PLAN_SCREENSHOTS){await fs.mkdir(process.env.BB_DAY_PLAN_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.BB_DAY_PLAN_SCREENSHOTS,'plan-'+width+'-after.png'),animations:'disabled'});}
  if(width>=768)assert.notEqual(await page.locator('#app').evaluate(node=>getComputedStyle(node).transform),'none','the desktop fixture exercises the original retained animation transform');
  await monday.locator(':scope>summary .bbnext-day-caret').click();await page.locator('.bbdps-active .bbdps-title').waitFor();
  await assertVisibleViewportSheet(page,width,height);
  if(process.env.BB_DAY_PLAN_SCREENSHOTS){await fs.mkdir(process.env.BB_DAY_PLAN_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.BB_DAY_PLAN_SCREENSHOTS,'day-sheet-'+width+'-after.png'),animations:'disabled'});}
  const ingredients=monday.locator('.bbdps-ingredients');await ingredients.locator(':scope>summary').click();assert.equal(await ingredients.evaluate(node=>node.open),true);
  await ingredients.locator(':scope>summary').click();
  await monday.locator('[data-cook]').click();const cook=page.locator('#modalRoot .cook-overlay');await cook.waitFor();
  const exit=cook.locator('#bbExit');assert.equal(await exit.evaluate(node=>{const rect=node.getBoundingClientRect();return node.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));}),true,'the original Cook dialog stays above the day editor');
  await exit.click();await cook.waitFor({state:'detached'});await assertVisibleViewportSheet(page,width,height);
  await monday.locator('.bbdps-close').click();
  assert.equal(await monday.evaluate(node=>node.open),false);assert.equal(await page.locator('html').evaluate(node=>node.classList.contains('bb-day-plan-sheet-open')),false);
  await tuesday.locator(':scope>summary .bbnext-day-caret').click();await page.locator('.bbdps-active .bbdps-title').waitFor();await assertVisibleViewportSheet(page,width,height);
  assert.equal(await page.locator('.bbdps-active .bbdps-title').innerText(),'Tuesday plan');
  await page.keyboard.press('Escape');assert.equal(await tuesday.evaluate(node=>node.open),false);
  await monday.locator(':scope>summary .bbnext-day-caret').click();await page.locator('.bbdps-active .bbdps-title').waitFor();await assertVisibleViewportSheet(page,width,height);
  await page.locator('.bbdps-active>.bbdps-backdrop').click({position:{x:4,y:4}});assert.equal(await monday.evaluate(node=>node.open),false);
  assert.deepEqual(await h.snapshot(),original,'opening, reading and dismissing preserve saved plan and pantry bytes');assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
