import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs/promises';
import{createRequire}from'node:module';
const require=createRequire(import.meta.url);let chromium,browser;
for(const name of[process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
const js=await fs.readFile(new URL('../bb-plan-home-snapshot.js',import.meta.url),'utf8'),css=await fs.readFile(new URL('../bb-plan-home-snapshot.css',import.meta.url),'utf8');
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const options={skip:!chromium&&'Playwright unavailable',timeout:30000};
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function fixture({ready=true,deleting=false,stock={},household=[],functionalExtras=false,width=390}={}){
 const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();
 await page.setContent(`<style>${css}</style><body data-bbnext-view="week"><main id="app" class="bbnext-plan"><section id="bb1759MealsSummary"><div id="bbSimpleSchoolLunchesPane"><button id="realLunch">Plan school lunches</button></div></section><section id="bb1756PlannerExtras"><header class="bb1756-extras-header"><h2>School lunches</h2><p>Extras for this week</p></header>${functionalExtras?'<button id="fallbackLunch">Actual lunch control</button>':''}</section><details id="bb1759MealsEditor"><summary>More planning actions &amp; favourites</summary><div class="bb1759-original-meals"><header id="bb1756Dinners"><div><h3>Your weekly game plan</h3><p>Old guidance</p></div></header><p class="notice">Tip: old planning advice</p><button id="realFavourite">Favourite recipe</button><button id="realSavedWeeks">Saved weeks</button></div></details><section class="bb173-leftover-card"><p>Leftover guidance</p><button id="realLeftover">Leftover Magic</button></section></main></body>`);
 await page.evaluate(({ready,deleting,stock,household})=>{
  window.__ready=ready;window.__deleting=deleting;window.__stock=Object.freeze(stock);window.__household=Object.freeze(household.map(Object.freeze));window.__reads={stock:0,household:0};window.__actions=[];
  window.BBReceiptHost={getConsumptionStatus:()=>({ready:window.__ready})};window.BBAccountDeletion={isDeleting:()=>window.__deleting};
  window.BBHomeHost={stock(){window.__reads.stock++;return window.__stock;},household(){window.__reads.household++;return window.__household;}};
  window.__controls=['realLunch','realFavourite','realSavedWeeks','realLeftover'].map(id=>document.getElementById(id));
  for(const node of window.__controls)node.addEventListener('click',()=>window.__actions.push(node.id));
  Object.defineProperty(window,'localStorage',{get(){throw Error('Snapshot must not read or write account/app storage');}});
  window.fetch=()=>{throw Error('Snapshot must not fetch');};
 },{ready,deleting,stock,household});
 await page.addScriptTag({content:js});await settle(page);return{context,page};
}
test('Plan replaces only information cards with current saved names and presentation counts',options,async()=>{
 const h=await fixture({stock:{'Rice|g':200,'Pasta|g':0,'Onions|each':2,'Frozen peas|g':300,'Milk|ml':500,'Garlic|each':3,'Eggs|each':6},household:[{name:'Toilet rolls',selected:true},{name:'Toothpaste',selected:true},{name:'Detergent',selected:false}]});
 try{
  const text=await h.page.locator('#bbPlanHomeSnapshot').innerText();assert.match(text,/6 stocked items/);assert.match(text,/2 selected items/);assert.match(text,/Rice/);assert.match(text,/Garlic/);assert.doesNotMatch(text,/Pasta|Eggs|Detergent|200|300|500|£/);
  assert.equal(await h.page.locator('#bb1756PlannerExtras').isVisible(),false);
  await h.page.locator('#bb1759MealsEditor > summary').click();assert.equal(await h.page.locator('#bb1756Dinners').isVisible(),false);assert.equal(await h.page.locator('.notice').isVisible(),false);
  assert.equal(await h.page.locator('.bb1759-original-meals .bb173-leftover-card').count(),1);
  await h.page.evaluate(()=>{const warning=document.createElement('p');warning.className='notice';warning.id='realWarning';warning.textContent='Saved stock needs review.';document.querySelector('.bb1759-original-meals').append(warning);});await settle(h.page);assert.equal(await h.page.locator('#realWarning').isVisible(),true,'operational notices remain visible');
  for(const id of['realLunch','realFavourite','realSavedWeeks','realLeftover'])await h.page.locator('#'+id).click();
  assert.deepEqual(await h.page.evaluate(()=>window.__actions),['realLunch','realFavourite','realSavedWeeks','realLeftover']);
  assert.equal(await h.page.evaluate(()=>window.__controls.every(node=>document.getElementById(node.id)===node)),true);
  assert.equal(await h.page.evaluate(()=>window.__household[2].selected),false,'live household source was not changed');
 }finally{await h.context.close();}
});
test('a legacy extras section with actual controls remains visible and functional',options,async()=>{
 const h=await fixture({functionalExtras:true});try{assert.equal(await h.page.locator('#fallbackLunch').isVisible(),true);assert.equal(await h.page.locator('#bb1756PlannerExtras').getAttribute('data-bbph-information'),'false');}finally{await h.context.close();}
});
for(const deleting of[false,true])test(`unready/deletion-locked stock is never read or shown (${deleting?'deleting':'unready'})`,options,async()=>{
 const h=await fixture({ready:deleting,deleting,stock:{'Private old stock|g':500}});try{assert.deepEqual(await h.page.evaluate(()=>window.__reads),{stock:0,household:0});assert.doesNotMatch(await h.page.locator('#bbPlanHomeSnapshot').innerText(),/Private|0 stocked/);assert.match(await h.page.locator('#bbPlanHomeSnapshot').innerText(),/Review your saved stock/);}finally{await h.context.close();}
});
test('current gate changes remove an older snapshot before paint and idle observers settle',options,async()=>{
 const h=await fixture({stock:{'Rice|g':200},household:[{name:'Toilet rolls',selected:true}]});try{
  assert.match(await h.page.locator('#bbPlanHomeSnapshot').innerText(),/Rice/);
  await h.page.evaluate(()=>{window.__ready=false;window.dispatchEvent(new Event('basketboss:session-changed'));});await settle(h.page);
  assert.doesNotMatch(await h.page.locator('#bbPlanHomeSnapshot').innerText(),/Rice|Toilet/);
  await h.page.evaluate(()=>{window.__stock=Object.freeze({'Pasta|g':100});window.__household=Object.freeze([]);window.__ready=true;window.dispatchEvent(new Event('bb:pantry-editor'));});await settle(h.page);
  assert.match(await h.page.locator('#bbPlanHomeSnapshot').innerText(),/Pasta/);
  const before=await h.page.evaluate(()=>({...window.__reads}));for(let i=0;i<4;i++)await settle(h.page);assert.deepEqual(await h.page.evaluate(()=>window.__reads),before,'own rendering does not create a perpetual observer loop');
  await h.page.evaluate(()=>{document.body.dataset.bbnextView='shop-list';});await settle(h.page);assert.equal(await h.page.locator('#bbPlanHomeSnapshot').isVisible(),false);assert.deepEqual(await h.page.evaluate(()=>window.__reads),before,'other tabs do not read the snapshot');
 }finally{await h.context.close();}
});

test('legacy layouts retain custom controls and the original Leftover action without repeating guidance',options,async()=>{
 const h=await fixture();try{
  await h.page.evaluate(()=>{const app=document.getElementById('app'),card=app.querySelector('.bb173-leftover-card');app.append(card);document.getElementById('bb1759MealsEditor').remove();const custom=document.createElement('span');custom.id='customLunch';custom.setAttribute('role','button');custom.textContent='Legacy lunch action';document.getElementById('bb1756PlannerExtras').append(custom);});await settle(h.page);
  assert.equal(await h.page.locator('#customLunch').isVisible(),true);assert.equal(await h.page.locator('.bb173-leftover-card p').isVisible(),false);assert.equal(await h.page.locator('#realLeftover').isVisible(),true);await h.page.locator('#realLeftover').click();assert.deepEqual(await h.page.evaluate(()=>window.__actions),['realLeftover']);
 }finally{await h.context.close();}
});
