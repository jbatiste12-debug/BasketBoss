import test,{before,after,describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let chromium,browser;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
const source=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const groups=source('bb-pantry-groups.js'),ui=source('bb-pantry-groups-ui.js'),inline=source('bb-pantry-inline.js');
const sections=['cupboard','fridge','freezer','essentials'];
const markup=`<!doctype html><meta charset="utf-8"><style>.bbpg-tabs{display:flex;overflow:auto;width:220px}.bbpg-tabs>button{flex:none;white-space:nowrap}button{min-height:30px}section{margin-bottom:10px}</style><main>${sections.map(id=>'<section id="'+id+'"></section>').join('')}<div id="picker"></div></main>`;
async function fixture(run,{pantry=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('https://basketboss.test/**',route=>route.fulfill({contentType:'text/html',body:markup}));await page.goto('https://basketboss.test/');
  if(pantry){
   await page.evaluate(()=>{
    document.body.dataset.bbnextView='shop';document.body.innerHTML='<main id="app"><section id="card"><div id="bbKitchenFoodPanel"></div>'+['cupboard','fridge','freezer'].map(loc=>'<details data-bb76-store="'+loc+'"><summary>'+loc+'</summary><div class="bb76-store-body"><div data-bb76-tiles><button data-bb5-food="'+(loc==='cupboard'?'Tuna':loc==='fridge'?'Milk':'Frozen peas')+'">Choice</button></div></div></details>').join('')+'</section></main>';
    const rice={key:'cupboard|rice',name:'Rice',loc:'cupboard',qty:250,unit:'g'};
    window.__requirementsReads=0;window.__catalogReads=0;window.__stockWrites=0;
    window.BBPantryEditor={card:document.getElementById('card'),isCurrent:()=>true,list:()=>[rice],read:()=>rice,units:()=>['g','ml','each']};
    window.BBHomeHost={requirements:()=>{window.__requirementsReads++;return [{key:'Fresh tuna steak',unit:'g',required:200}];}};
    window.BBPriceV19={canonical:value=>value.toLowerCase(),aisle:()=> 'Meat & Fish',get catalog(){window.__catalogReads++;return {'tinned tuna|g':{ingredient:'tinned tuna',aisle:'Cupboard'}};}};
   });
   await page.addScriptTag({content:inline});await page.locator('#bbpiSearch').waitFor();
  }else{
   await page.evaluate(()=>{
    window.__changes=0;window.__groupGeometryReads=0;window.__tabScrollReads=0;
    localStorage.setItem('basketboss_makeameal_v1_inventory','{"rice":{"qty":500,"unit":"g"}}');
    const rect=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(...args){if(this.matches('.bbpg-tabs,.bbpg-tabs>button'))window.__groupGeometryReads++;return rect.apply(this,args);};
    const scroll=Object.getOwnPropertyDescriptor(Element.prototype,'scrollLeft');
    Object.defineProperty(Element.prototype,'scrollLeft',{...scroll,get(){if(this.matches('.bbpg-tabs'))window.__tabScrollReads++;return scroll.get.call(this);}});
   });
   await page.addScriptTag({content:groups});await page.addScriptTag({content:ui});
   await page.evaluate(sections=>{for(const section of sections)BBPantryGroupsUI.mount(document.getElementById(section),section,()=>window.__changes++);},sections);
  }
  await run(page);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
const cupboard=page=>page.locator('#cupboard');
describe('Kitchen presentation work stays proportional to visible controls',()=>{
 before(async()=>{if(chromium)browser=await chromium.launch({headless:true,...(process.env.BB_CHROMIUM_PATH?{executablePath:process.env.BB_CHROMIUM_PATH}:{}),args:['--no-sandbox']});});after(async()=>{await browser?.close();});
 const check=(name,run)=>test(name,{skip:!chromium?'Playwright unavailable; set BB_PLAYWRIGHT_MODULE to run browser regressions':false},run);

 check('initial group filters mount without hidden forms or forced tab geometry reads',()=>fixture(async page=>{
  assert.equal(await page.locator('.bbpg-controls').count(),4);assert.equal(await page.locator('.bbpg-tabs button').count(),24);
  assert.equal(await page.locator('.bbpg-editor').count(),4);assert.equal(await page.locator('.bbpg-editor:not([hidden])').count(),0);assert.equal(await page.locator('.bbpg-editor form').count(),0);
  assert.deepEqual(await page.evaluate(()=>({geometry:__groupGeometryReads,scroll:__tabScrollReads,changes:__changes})),{geometry:0,scroll:0,changes:0});
  assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_pantry_groups_v1')),null);
 }));

 check('Edit groups builds the same controls and preserves unsaved drafts through Done and reopen',()=>fixture(async page=>{
  await cupboard(page).getByRole('button',{name:'Edit Cupboard subcategories',exact:true}).click();
  assert.equal(await cupboard(page).locator('.bbpg-editor form').count(),5);
  await cupboard(page).getByRole('textbox',{name:'Name for Tins & jars',exact:true}).fill('Unsaved tins name');
  await cupboard(page).getByRole('textbox',{name:'New Cupboard subcategory',exact:true}).fill('Unsaved new group');
  await cupboard(page).getByRole('button',{name:'Finish editing Cupboard subcategories',exact:true}).click();
  assert.equal(await cupboard(page).locator('.bbpg-editor form').count(),0);
  await cupboard(page).getByRole('button',{name:'Edit Cupboard subcategories',exact:true}).click();
  assert.equal(await cupboard(page).getByRole('textbox',{name:'Name for Tins & jars',exact:true}).inputValue(),'Unsaved tins name');
  assert.equal(await cupboard(page).getByRole('textbox',{name:'New Cupboard subcategory',exact:true}).inputValue(),'Unsaved new group');
  assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_pantry_groups_v1')),null);
 }));

 check('rename, create, move, assign and remove keep the original metadata guards and stock intact',()=>fixture(async page=>{
  const stock=await page.evaluate(()=>localStorage.getItem('basketboss_makeameal_v1_inventory'));
  await cupboard(page).getByRole('button',{name:'Edit Cupboard subcategories',exact:true}).click();
  await cupboard(page).getByRole('textbox',{name:'Name for Tins & jars',exact:true}).fill('Tins and cans');
  await cupboard(page).getByRole('button',{name:'Save Tins & jars name',exact:true}).click();
  assert.equal(await cupboard(page).locator('.bbpg-tabs').getByRole('button',{name:'Tins and cans',exact:true}).count(),1);
  await cupboard(page).getByRole('textbox',{name:'New Cupboard subcategory',exact:true}).fill('Weekly staples');
  await cupboard(page).getByRole('button',{name:'＋ Add group',exact:true}).click();
  const before=await page.evaluate(()=>BBPantryGroups.snapshot('cupboard').groups.map(row=>row.name));
  await cupboard(page).getByRole('button',{name:'Move Weekly staples up',exact:true}).click();
  const after=await page.evaluate(()=>BBPantryGroups.snapshot('cupboard').groups.map(row=>row.name));
  assert.equal(after.indexOf('Weekly staples'),before.indexOf('Weekly staples')-1);
  const id=await page.evaluate(()=>{const id=BBPantryGroups.snapshot('cupboard').groups.find(row=>row.name==='Weekly staples').id;document.getElementById('picker').append(BBPantryGroupsUI.picker('cupboard','rice','Rice',()=>window.__changes++));return id;});
  await page.getByRole('combobox',{name:'Subcategory for Rice',exact:true}).selectOption(id);
  assert.equal(await page.evaluate(()=>BBPantryGroups.groupFor('cupboard','rice','Rice')),id);
  await cupboard(page).getByRole('button',{name:'Remove Weekly staples group',exact:true}).click();
  assert.equal(await page.evaluate(()=>BBPantryGroups.groupFor('cupboard','rice','Rice')),'other');
  assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_makeameal_v1_inventory')),stock);
 }));

 check('stale metadata pins still reject edits after an external group change',()=>fixture(async page=>{
  await cupboard(page).getByRole('button',{name:'Edit Cupboard subcategories',exact:true}).click();
  await cupboard(page).getByRole('textbox',{name:'Name for Tins & jars',exact:true}).fill('Must not save');
  await page.evaluate(()=>BBPantryGroups.create('cupboard','External group'));
  await cupboard(page).getByRole('button',{name:'Save Tins & jars name',exact:true}).click();
  assert.match(await cupboard(page).getByRole('alert').textContent(),/account or groups changed/);
  assert.equal(await page.evaluate(()=>BBPantryGroups.snapshot('cupboard').groups.find(row=>row.id==='tins').name),'Tins & jars');
  assert.equal(await page.evaluate(()=>__changes),0);
 }));

 check('filter selection retains focus and reveals the selected pill within its own scroll row',()=>fixture(async page=>{
  await page.evaluate(()=>document.querySelector('#cupboard [data-bbpg-group="spices"]').click());
  assert.equal(await page.evaluate(()=>BBPantryGroupsUI.active('cupboard')),'spices');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.bbpgGroup),'spices');
  assert.equal(await page.evaluate(()=>{const tabs=document.querySelector('#cupboard .bbpg-tabs'),pill=tabs.querySelector('[data-bbpg-group="spices"]'),a=tabs.getBoundingClientRect(),b=pill.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1;}),true);
  assert.ok(await page.evaluate(()=>__groupGeometryReads)>0,'a non-default selection still receives the existing scroll reveal');
 }));

 check('blank pantry search skips catalogue work while typed searches and cleared results behave normally',()=>fixture(async page=>{
  assert.deepEqual(await page.evaluate(()=>({catalog:__catalogReads,requirements:__requirementsReads})),{catalog:0,requirements:0});
  assert.equal(await page.locator('.bbpi-search-matches').isHidden(),true);
  await page.locator('#bbpiSearch').fill('tuna');
  await page.locator('.bbpi-search-choice').first().waitFor();
  assert.ok(await page.evaluate(()=>__catalogReads)>0);assert.ok(await page.evaluate(()=>__requirementsReads)>0);
  assert.match(await page.locator('.bbpi-search-matches').innerText(),/Tinned tuna|Fresh tuna steak/);
  const calls=await page.evaluate(()=>({catalog:__catalogReads,requirements:__requirementsReads}));
  await page.locator('#bbpiSearch').fill('   ');
  assert.equal(await page.locator('.bbpi-search-matches').isHidden(),true);assert.equal(await page.locator('.bbpi-search-matches>*').count(),0);
  assert.deepEqual(await page.evaluate(()=>({catalog:__catalogReads,requirements:__requirementsReads})),calls);
  await page.locator('#bbpiSearch').fill('No matching food');
  await page.getByText('No match — add your own food.',{exact:true}).waitFor();
 },{pantry:true}));

 check('pantry keeps one search and filter row, real storage accordions and per-area Add food without duplicate shortcuts',()=>fixture(async page=>{
  assert.equal(await page.locator('#bbpiAddItem,.bbpi-location-nav,[data-bbpi-location]').count(),0);
  assert.equal(await page.locator('#bbpiSearch').count(),1);
  assert.equal(await page.locator('[data-bb76-store]>summary').count(),3);
  assert.equal(await page.locator('[data-bb76-store] .bbpi-add-food').count(),3);
  const filter=page.getByRole('button',{name:'Filters',exact:true});
  assert.equal(await filter.getAttribute('aria-expanded'),'false');
  await filter.click();assert.equal(await filter.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#card').getAttribute('data-bbpi-filters'),'true');
  await page.getByRole('button',{name:'Low / Out',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.bbpi-summary-row').length===0);
  assert.equal(await page.locator('.bbpi-summary-row').count(),0);
  await page.getByRole('button',{name:'All food',exact:true}).click();await page.locator('.bbpi-summary-row').waitFor();
  await filter.click();assert.equal(await filter.getAttribute('aria-expanded'),'false');
  await page.locator('[data-bb76-store="cupboard"] .bbpi-add-food').click();
  await page.locator('#bbpi-current-editor').waitFor();
  assert.match(await page.locator('#bbpi-current-editor').innerText(),/Add food/);
  await page.locator('#bbpi-current-editor .bbpi-close').click();
  await page.locator('#bbpi-current-editor').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>__stockWrites),0,'opening and closing presentation must not save stock');
 },{pantry:true}));
});
