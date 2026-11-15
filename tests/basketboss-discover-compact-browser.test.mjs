import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const actor='00000000-0000-4000-8000-000000000079';
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// This bridge reads the original catalogue and stock, or enters the existing
// renderer. It does not replace filtering, recipe matching, controls or owners.
const bridge=`window.__discoverQA={
 ready:()=>RECIPES.length===200&&window.BBHome&&['premium','free'].includes(window.BasketBossVerifiedPremium?.state?.()),
 enter(id){bb174ViewRecipe(id);if(document.querySelector('.bb-featured-card')?.dataset.bbFeaturedRecipe!==id)bb174ViewRecipe(id);},
 snapshot:()=>JSON.parse(JSON.stringify({state,stock:bb307ReadStock(),inventory:localStorage.getItem('basketboss_makeameal_v1_inventory'),features:bb307FeatureState})),
 filter:()=>({query,collectionFilter,galleryPage}),
 recipe:id=>{const recipe=getRecipe(id);return recipe?{id:recipe.id,name:recipe.name,ingredients:recipe.ingredients.length,mins:window.BBDuration?.format(recipe.mins)||'?'}:null;},
 matches:id=>{const recipe=getRecipe(id);const result=BB174Leftover.match(recipe,RECIPES,bb174AllowedRecipe);return {main:result.main,matches:result.matches.map(match=>({id:match.id,name:match.name,shared:match.shared}))};},
 sources:()=>RECIPES.filter(recipe=>bb176AllowedRecipe(recipe.id)&&!String(recipe.id).startsWith('dessert-')&&!String(recipe.id).startsWith('leftover-')).map(recipe=>({id:recipe.id,count:BB174Leftover.match(recipe,RECIPES,bb174AllowedRecipe).matches.length})),
 missingSuggestion(){const host=document.createElement('div');bb321MountSuggestion(host,null);return host.children.length;}
};`;

async function fixture(width,{premium=true,compact=true}={}){
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');
 assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const height=width>=768?1366:844,context=await browser.newContext({viewport:{width,height},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // No request is continued: cloud saves, analytics and external assets all
 // receive local responses, so browser regressions cannot write to production.
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:actor,email:'discover-fixture@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/')){
   requests.push({path:url.pathname,method:request.method()});
   let data={ok:true};
   if(url.pathname==='/api/subscription/status')data={authenticated:true,tier:premium?'owner':'free',premium,premiumAccess:premium,mode:'live',subscription:null};
   else if(url.pathname==='/api/household')data={configured:false,premium,items:[]};
   else if(url.pathname==='/api/receipt-inventory')data={ok:true,configured:false,available:false};
   else if(url.pathname==='/api/shopping/weekly-trip')data={ok:true,allowed:true,premium};
   else if(url.pathname==='/api/recipes/v700/premium')return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Local fixture"}'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  let relative=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(['app','app.html','index','index.html',''].includes(relative))relative='app.html';
  if(relative.includes('..'))return route.fulfill({status:404,body:''});
  if(!compact&&/^bb-discover-compact\.(?:js|css)$/.test(relative))return route.fulfill({status:200,contentType:relative.endsWith('.js')?'application/javascript':'text/css',body:''});
  try{
   let body;
   if(relative==='app.html')body=app;
   else{
    try{body=await fs.readFile(path.join(root,relative));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',relative));}
    if(relative==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(relative==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(relative.endsWith('.js'))body=transform700Presentation(body.toString());
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(relative)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(({actor})=>{
  if(localStorage.getItem('discover-compact-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'discover-fixture@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,favourites:[],essentials:[]}));
  const stock={'chicken breast|g':533.123456,'pasta|g':250.654321,'brown onions|g':100.000001};
  localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify(stock));
  const inventory={};
  for(const [id,qty]of Object.entries(stock)){
   const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1),loc=name==='pasta'?'cupboard':'fridge';
   inventory[loc+'|'+name]={name,loc,selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty};
  }
  localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify(inventory));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
  sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('discover-compact-fixture-v1','1');
 },{actor});
 await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__discoverQA?.ready());
 await page.waitForFunction(expected=>window.BasketBossVerifiedPremium?.state?.()===expected,premium?'premium':'free');
 await enter(page,'fajitas',{compact});
 return {page,context,errors,requests};
}

async function enter(page,id,{compact=true}={}){
 await page.evaluate(id=>window.__discoverQA.enter(id),id);
 await page.locator('.bb-featured-card[data-bb-featured-recipe="'+id+'"]').waitFor();
 if(compact)await page.locator('#swipeCard>.bbdc-photo-open').waitFor();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
const snapshot=page=>page.evaluate(()=>window.__discoverQA.snapshot());
const featured=page=>page.locator('.bb-featured-card').getAttribute('data-bb-featured-recipe');
async function assertPantry(page,before){
 const after=await snapshot(page);assert.deepEqual(after.stock,before.stock);assert.equal(after.inventory,before.inventory);
 assert.equal(after.stock['chicken breast|g'],533.123456,'presentation and planning retain six-decimal stock');
 assert.ok(Object.values(after.stock).includes(100.000001),'small pantry remainders retain all six decimals');
}
async function screenshot(page,name){
 if(!process.env.BB_DISCOVER_ARTIFACT_DIR)return;
 await fs.mkdir(process.env.BB_DISCOVER_ARTIFACT_DIR,{recursive:true});
 await page.evaluate(async()=>{
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const images=[...document.images].filter(image=>{const box=image.getBoundingClientRect();return box.bottom>0&&box.top<innerHeight&&box.width>0;});
  await Promise.all(images.map(image=>Promise.race([image.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,2500))])));
 });
 await page.screenshot({path:path.join(process.env.BB_DISCOVER_ARTIFACT_DIR,name+'.png'),fullPage:false});
}
async function geometryArtifact(name,value){
 if(!process.env.BB_DISCOVER_ARTIFACT_DIR)return;
 await fs.mkdir(process.env.BB_DISCOVER_ARTIFACT_DIR,{recursive:true});
 await fs.writeFile(path.join(process.env.BB_DISCOVER_ARTIFACT_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n');
}
async function geometry(page){
 return page.evaluate(()=>{
  const box=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
  return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,search:box('#recipeSearch'),panel:box('.bb16-filter-panel'),hero:box('.bb-featured-card'),image:box('#swipeCard'),leftovers:box('.bb174-leftover-three'),nav:box('.shell>.tabs')};
 });
}

for(const width of [320,390,1024])test('Discover keeps search, category rail, spotlight and real leftovers compact at '+width+'px',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(width);
 try{
  const before=await snapshot(page),recipe=await page.evaluate(()=>window.__discoverQA.recipe('fajitas'));
  const matches=await page.evaluate(()=>window.__discoverQA.matches('fajitas'));
  if(matches.matches.length)await page.locator('.bb174-leftover-three').waitFor();
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  const g=await geometry(page);
  await screenshot(page,'discover-'+width);await geometryArtifact('discover-'+width+'-geometry',g);
  assert.ok(g.scrollWidth<=width+1,'carousels scroll internally without widening the page');
  assert.ok(g.panel.height<160,'search and categories do not form a tall introduction');
  assert.ok(g.hero.height<500,'spotlight remains a compact card rather than a full-page stack');
  assert.ok(Math.abs(g.image.width/g.image.height-16/9)<.05,'featured photo uses the requested wide framing');
  assert.ok(await page.locator('.grid-recipes .mini-img>.bb18-recipe-meta').evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>{const height=node.getBoundingClientRect().height;return height>0&&height<=30;})),'thumbnail time badges stay compact after leaving the old metadata row');
  assert.ok(g.search.y>=0&&g.search.bottom<g.height-70,'search is visible above the fixed navigation');
  assert.equal(await page.locator('.bb16-search-wrap label').evaluate(node=>{const style=getComputedStyle(node),box=node.getBoundingClientRect();return style.display==='none'||style.visibility==='hidden'||box.width<=1&&box.height<=1&&(style.clipPath!=='none'||style.clip!=='auto');}),true,'redundant search label is removed visually while its original association remains');
  assert.equal(await page.locator('#recipeSearch').getAttribute('aria-label'),'Search recipes','input retains its accessible name');
  assert.match(await page.locator('#recipeSearch').getAttribute('placeholder'),/Search recipes or ingredients/);
  assert.equal(await page.locator('.recipe-body h3').textContent(),recipe.name,'original dynamic title remains available to favourites');
  assert.equal(await page.locator('.bbdc-hero-title').textContent(),recipe.name);
  assert.match(await page.locator('.bbdc-hero-meta').textContent(),new RegExp(String(recipe.ingredients)+' ingredients'));
  assert.ok((await page.locator('.bbdc-hero-meta').textContent()).includes(recipe.mins),'time uses the original duration formatter');
  const rail=page.locator('.bb16-category-grid');
  assert.equal(await rail.evaluate(node=>getComputedStyle(node).flexWrap),'nowrap');
  assert.ok(await rail.evaluate(node=>node.scrollWidth>node.clientWidth),'the full existing category catalogue remains swipeable');
  const toggle=page.locator('.bb16-toggle-filters');
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  await toggle.click();assert.equal(await page.locator('.bb16-filter-categories').isVisible(),false,'original Hide categories still works');
  await toggle.click();assert.equal(await page.locator('.bb16-filter-categories').isVisible(),true,'original Browse categories still works');
  await rail.evaluate(node=>{node.scrollLeft=node.scrollWidth;});
  const category=page.locator('[data-collection="Curry & Thai Favourites"]');await category.click();
  await page.waitForFunction(()=>window.__discoverQA.filter().collectionFilter==='Curry & Thai Favourites');
  await page.locator('[data-collection="All"]').click();
  await page.locator('#recipeSearch').fill('fajitas');
  await page.waitForFunction(()=>window.__discoverQA.filter().query==='fajitas');
  assert.match(await page.locator('.recipe-body h3').textContent(),/fajitas/i,'the original live search updates actual recipe results');
  await enter(page,'fajitas');
  const controls=['skipRecipe','addRecipe','bbFeaturedAddWeek','cookRecipe','bbFeaturedBatch'];
  assert.ok(await page.evaluate(ids=>ids.every(id=>typeof document.getElementById(id)?.onclick==='function'),controls),'all original featured handlers remain attached');
  if(matches.matches.length){
   const current=await geometry(page);
   assert.ok(current.leftovers.y<current.height-70,'Leftover Magic starts above the navigation fold');
   assert.equal(await page.locator('.bb174-leftover-option').count(),matches.matches.length);
   assert.equal(await page.locator('.bb174-leftover-safety').count(),1,'one shared safety note remains below actual matches');
  }
  assert.deepEqual(await snapshot(page),before,'search, filters and presentation cannot mutate saved user data');
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await screenshot(page,'discover-'+width);
  if(width===390){
   if(matches.matches.length){
    await page.locator('.bb174-leftover-three').evaluate(node=>scrollTo({top:scrollY+node.getBoundingClientRect().top-90,behavior:'instant'}));
    await screenshot(page,'discover-390-leftovers');
   }
   await page.locator('.grid-recipes').evaluate(node=>scrollTo({top:scrollY+node.getBoundingClientRect().top-90,behavior:'instant'}));
   await screenshot(page,'discover-390-gallery');
  }
  await page.locator('#bbGalleryNext').scrollIntoViewIfNeeded();
  const nextBox=await page.locator('#bbGalleryNext').boundingBox(),navBox=await page.locator('.shell>.tabs').boundingBox();
  if(nextBox&&navBox)assert.ok(nextBox.y+nextBox.height<navBox.y||navBox.y>=g.height,'the final gallery controls can scroll above navigation');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('compact assets reduce actual phone spotlight height while keeping identical recipe and saved data',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const baseline=await fixture(390,{compact:false}),updated=await fixture(390);
 try{
  const a=await geometry(baseline.page),b=await geometry(updated.page);
  await geometryArtifact('discover-390-comparison',{before:a,after:b,spotlightReductionPercent:Math.round((1-b.hero.height/a.hero.height)*100)});
  await baseline.page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await screenshot(baseline.page,'discover-390-before');
  assert.ok(b.hero.height<a.hero.height*.8,'the same real recipe is at least 20% shorter after the presentation assets');
  assert.ok(b.panel.height<a.panel.height,'search/filter chrome becomes shorter');
  assert.equal(await baseline.page.locator('.recipe-body h3').textContent(),await updated.page.locator('.recipe-body h3').textContent());
  assert.deepEqual(await snapshot(updated.page),await snapshot(baseline.page),'the layout-only bundle has no state or stock effect');
  assert.deepEqual(baseline.errors,[]);assert.deepEqual(updated.errors,[]);
 }finally{await baseline.context.close();await updated.context.close();}
});

test('photo tap and keyboard open original Cook while horizontal swipes browse without opening it',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390);
 try{
  const before=await snapshot(page),name=(await page.evaluate(()=>window.__discoverQA.recipe('fajitas'))).name;
  const photo=page.locator('#swipeCard>.bbdc-photo-open');
  await photo.click();await page.locator('.cook-overlay').waitFor();
  assert.equal(await page.locator('#bbTitle').textContent(),name,'photo delegates to original recipe cooking view');
  await page.locator('#bbExit').click();
  await photo.focus();await page.keyboard.press('Enter');await page.locator('.cook-overlay').waitFor();
  assert.equal(await page.locator('#bbTitle').textContent(),name);await page.locator('#bbExit').click();
  await enter(page,'fajitas');
  const box=await page.locator('#swipeCard').boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width*.7,box.y+box.height*.45);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.7-110,box.y+box.height*.45,{steps:9});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('.bb-featured-card')?.dataset.bbFeaturedRecipe!=='fajitas');
  assert.equal(await page.locator('.cook-overlay').count(),0,'a skip swipe must never activate the photo tap target');
  assert.deepEqual((await snapshot(page)).features.favourites,before.features.favourites,'a left swipe still only skips');
  await enter(page,'fajitas');
  const start=await featured(page);await page.locator('#skipRecipe').click();
  assert.notEqual(await featured(page),start,'original dismiss still advances the card');
  await enter(page,'fajitas');await page.locator('#addRecipe').click();
  assert.ok((await snapshot(page)).features.favourites.includes('fajitas'),'original heart saves the actual featured recipe');
  assert.notEqual(await featured(page),'fajitas','the existing save-and-next behaviour is preserved');
  await enter(page,'fajitas');await page.locator('#bb307FavCurrent').waitFor();
  assert.match(await page.locator('#bb307FavCurrent').textContent(),/Remove from favourites/,'original h3-based favourite lookup still resolves the recipe');
  await page.locator('#bb307FavCurrent').click();
  assert.equal((await snapshot(page)).features.favourites.includes('fajitas'),false,'the separate favourite toggle still removes it');
  await assertPantry(page,before);assert.deepEqual((await snapshot(page)).state,before.state);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('featured and gallery Add/Batch controls retain original dialogs, propagation and planned-day writes',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390);
 try{
  const before=await snapshot(page);
  await page.locator('#bbFeaturedAddWeek').click();
  let add=page.locator('#bb80AddWeekDialog');await add.waitFor();
  await add.getByRole('combobox').selectOption('Monday');await add.getByRole('button',{name:'Add to dinners',exact:true}).click();
  await page.waitForFunction(()=>window.__discoverQA.snapshot().state.planned.some(slot=>slot.recipeId==='fajitas'&&slot.day==='Monday'));
  await enter(page,'fajitas');await page.locator('#bbFeaturedBatch').click();
  let batch=page.locator('#bbManualBatchDialog');await batch.waitFor();
  assert.match(await batch.locator('p').first().textContent(),/fajitas/i);await batch.getByRole('button',{name:'Cancel',exact:true}).click();
  const card=page.locator('.mini-recipe[data-recipe]:not([data-recipe="fajitas"])').filter({has:page.locator('[data-bb80-add-week]')}).first();
  const galleryId=await card.getAttribute('data-recipe'),heroId=await featured(page);
  await card.locator('[data-bb80-add-week]').click();add=page.locator('#bb80AddWeekDialog');await add.waitFor();
  assert.equal(await featured(page),heroId,'gallery Add does not bubble into featured selection');
  await add.getByRole('button',{name:'Cancel',exact:true}).click();
  await card.locator('[data-bb-manual-batch]').click();batch=page.locator('#bbManualBatchDialog');await batch.waitFor();
  assert.equal(await featured(page),heroId,'gallery Batch does not bubble into featured selection');
  await batch.getByRole('button',{name:'Cancel',exact:true}).click();
  await card.locator('.mini-img').click();
  await page.waitForFunction(id=>document.querySelector('.bb-featured-card')?.dataset.bbFeaturedRecipe===id,galleryId);
  assert.equal(await page.locator('.cook-overlay').count(),0,'gallery card still selects rather than starts Cook');
  const recipe=await page.evaluate(id=>window.__discoverQA.recipe(id),galleryId);
  assert.equal(await page.locator('.recipe-body h3').textContent(),recipe.name);
  assert.equal(await page.locator('.mini-recipe[data-recipe="'+galleryId+'"] .mini-img>.bb18-recipe-meta').count(),1,'the original dynamic cook-time node is on its thumbnail');
  await assertPantry(page,before);assert.equal((await snapshot(page)).state.planned.length,1,'only the explicitly confirmed Add writes a dinner');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('leftover carousel uses original matches and no-match fallback without padding it with unrelated recipes',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390);
 try{
  const before=await snapshot(page),sources=await page.evaluate(()=>window.__discoverQA.sources());
  const source=sources.find(recipe=>recipe.count>=2);assert.ok(source,'the real public catalogue provides a multi-card match');
  await enter(page,source.id);
  const matches=await page.evaluate(id=>window.__discoverQA.matches(id),source.id),cards=page.locator('.bb174-leftover-cards');
  await cards.waitFor();assert.equal(await cards.locator('.bb174-leftover-option').count(),matches.matches.length);
  assert.deepEqual(await cards.locator('[data-bb174-open]').evaluateAll(nodes=>nodes.map(node=>node.dataset.bb174Open)),matches.matches.map(match=>match.id));
  assert.ok(await cards.evaluate(node=>node.scrollWidth>node.clientWidth),'multiple leftover cards swipe horizontally');
  const matchText=await cards.locator('.bb174-leftover-info small:first-of-type').allTextContents();
  assert.deepEqual(matchText,matches.matches.map(match=>'Matches: '+match.shared.join(' + ')),'actual leftover ingredient bindings are retained');
  assert.equal(await page.locator('.bb174-leftover-safety').count(),1);
  await cards.evaluate(node=>{node.scrollLeft=node.scrollWidth;});
  const last=cards.locator('[data-bb174-open]').last(),lastId=await last.getAttribute('data-bb174-open');await last.click();
  await page.waitForFunction(id=>document.querySelector('.bb-featured-card')?.dataset.bbFeaturedRecipe===id,lastId);
  assert.equal(await page.locator('.cook-overlay').count(),0,'existing View recipe selects the matched recipe without cooking');
  const noMatch=sources.find(recipe=>recipe.count===0);assert.ok(noMatch,'the real catalogue also supplies a no-match case');
  await enter(page,noMatch.id);
  assert.equal(await page.locator('.bb174-leftover-option').count(),0,'a no-match source cannot invent carousel recipes');
  await page.locator('.bb175-browse-leftovers').waitFor();
  assert.match(await page.locator('.bb174-leftover-three').textContent(),/No reliable direct leftover matches/);
  assert.equal(await page.evaluate(()=>window.__discoverQA.missingSuggestion()),0,'a missing source never creates a suggestion');
  await assertPantry(page,before);assert.deepEqual((await snapshot(page)).state,before.state);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('Free Discover retains its original Premium leftover gate without displaying fabricated matches',{skip:!chromium&&'Playwright unavailable',timeout:60000},async()=>{
 const {page,context,errors}=await fixture(390,{premium:false});
 try{
  const before=await snapshot(page);
  assert.equal(await page.locator('.bb174-leftover-cards').count(),0);
  assert.equal(await page.locator('[data-collection="Leftover Magic"]').count(),0,'locked category remains behind its original membership gate');
  const trigger=page.locator('[data-bb173-leftovers]');await trigger.waitFor({state:'attached'});
  assert.equal(await trigger.isVisible(),false,'the pre-existing duplicated upsell remains hidden');
  await page.locator('#bbFeaturedBatch').click();
  const batchGate=page.locator('#bb173TierDialog[open]');await batchGate.waitFor();
  assert.equal(await page.locator('#bbManualBatchDialog').count(),0,'Free cannot open the Premium batch planner');
  await batchGate.locator('[data-bb173-close]').first().click();
  await page.locator('#bbpolUpgradePill').click();
  const comparison=page.locator('#bbMembershipCompare[open]');await comparison.waitFor();
  await comparison.getByRole('button',{name:'Close membership comparison',exact:true}).click();
  assert.equal(await page.locator('#bbMembershipCompare').evaluate(node=>node.open),false,'the original comparison close remains functional');
  assert.equal(await page.locator('.cook-overlay').count(),0);
  assert.deepEqual(await snapshot(page),before,'opening an upgrade changes no plan, stock or membership data');assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
