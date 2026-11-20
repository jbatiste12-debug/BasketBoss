import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

async function fixture(viewport,run){
 const context=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 const app=transform700Presentation(transform700Html(await fs.readFile(path.join(root,'app.html'),'utf8'),release));
 // The real catalogue renderer and controls run against local fixture files.
 // API calls are intercepted; these checks cannot access customer data.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let name=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(['app','app/','app.html','index.html','index',''].includes(name))name='app.html';
  if(name.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;
   if(name==='app.html')body=app;
   else{
    try{body=await fs.readFile(path.join(root,name));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',name));}
    if(name==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(name==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(name.endsWith('.js'))body=transform700Presentation(body.toString());
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(name)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
 });
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#app')?.dataset.bbCompactHeader==='true'&&!!document.querySelector('#bbpolRegionPill'));
  await page.waitForSelector('.bbnext-day.has-meal');
  await run(page);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

const snapshot=page=>page.evaluate(()=>Object.fromEntries(['basketboss_321_unified_state_v1','basketboss_321_v7_measured_pantry','basketboss_makeameal_v1_inventory','basketboss_v172_weekly_budget_target_v1','basketboss_v172_weekly_budget_v1'].map(key=>[key,localStorage.getItem(key)])));
async function assertPanelInFlow(page,selector,nextSelector){
 const result=await page.locator(selector).evaluate((node,nextSelector)=>{
  const rect=n=>{const b=n.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
  const host=node.closest('.bbpc-filter-row'),next=document.querySelector(nextSelector);
  return {panel:rect(node),host:rect(host),next:rect(next),position:getComputedStyle(node).position,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,pageWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth};
 },nextSelector);
 assert.equal(result.position,'static','the panel participates in document flow');
 assert.ok(result.panel.width>=result.host.width-4,'the panel uses the full options width: '+JSON.stringify(result));
 assert.ok(result.panel.left>=result.host.left-1&&result.panel.right<=result.host.right+1,'panel stays within the page');
 assert.ok(result.panel.bottom<=result.next.top+1,'expanded content pushes following options down');
 assert.ok(result.scrollHeight<=result.clientHeight+1,'no constrained internal panel clips content');
 assert.ok(result.pageWidth<=result.viewportWidth+1,'options do not create horizontal overflow');
}

for(const viewport of [{width:320,height:568},{width:390,height:844},{width:768,height:1024},{width:1440,height:1000}])test('Plan options expand in flow and retain original controls at '+viewport.width+'px',{skip:!chromium?'Playwright unavailable':false},()=>fixture(viewport,async page=>{
 const saved=await snapshot(page),hero=await page.locator('.bbnext-plan-budget').innerText();
 assert.equal(await page.locator('#bbPlanMoreOptions').evaluate(node=>node.open),false,'the default Plan remains collapsed');
 assert.equal(await page.locator('#bbSimpleBudget').isVisible(),false);
 await page.evaluate(()=>{
  window.__planOptionsOriginal=['bbSimpleBudget','bbSimpleMealPreferences','bbIngredientPicker','bb77BudgetTarget','clearWeek'].map(id=>{const node=document.getElementById(id);return {id,node,parent:node.parentNode,onclick:node.onclick};});
 });
 await page.locator('#bbPlanMoreOptions>summary').click();
 const clear=await page.locator('#clearWeek').boundingBox(),more=await page.locator('#bbPlanMoreOptions').boundingBox();
 assert.ok(clear.height>=44&&clear.width<more.width/2,'Clear week is a quiet text action with its full tap target');
 const summaries=page.locator('#bbSimpleBudget>summary,#bbSimpleMealPreferences>summary,#bbAvoidIngredientTab');
 for(const node of await summaries.all()){const box=await node.boundingBox();assert.ok(box.height>=44&&box.width>more.width-4,'each option has a full-width touch target');}
 await page.locator('#bbSimpleBudget>summary').click();
 await assertPanelInFlow(page,'#bbSimpleBudget>.bbs-budget-body','#bbSimpleMealPreferences');
 const input=page.locator('#bb77BudgetTarget'),save=page.locator('#bbSimpleBudget button[type="submit"]');
 for(const node of [input,save])assert.ok((await node.boundingBox()).height>=44,'budget input and save retain 44px targets');
 if(viewport.width<768){
  // Resizing the visual area is a keyboard-layout surrogate, not a claim of
  // physical iPhone keyboard testing. No quantity or budget is entered.
  await input.focus();await page.setViewportSize({width:viewport.width,height:430});
  await save.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
  const button=await save.boundingBox(),dock=await page.locator('#bbPrimaryNavigation').boundingBox();
  assert.ok(button.y>=0&&button.y+button.height<=(dock?.y??430),'budget save can scroll above the dock or keyboard-safe viewport edge');
  await assertPanelInFlow(page,'#bbSimpleBudget>.bbs-budget-body','#bbSimpleMealPreferences');
  await input.evaluate(node=>node.blur());await page.setViewportSize(viewport);
 }
 const directory=process.env.BB_PLAN_OPTIONS_SCREENSHOTS||path.join(os.tmpdir(),'basketboss-ui-previews','plan-options');await fs.mkdir(directory,{recursive:true});
 await page.locator('#bbPlanMoreOptions').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
 await page.screenshot({path:path.join(directory,'budget-'+viewport.width+'-after.png'),animations:'disabled'});
 await page.locator('#bbSimpleMealPreferences>summary').click();
 assert.equal(await page.locator('#bbSimpleBudget').evaluate(node=>node.open),false,'original outside-close behaviour remains');
 await assertPanelInFlow(page,'#bbSimpleMealPreferences>.bb-meal-preference-body','#bbIngredientPicker');
 const visibleChoices=page.locator('#bbSimpleMealPreferences .bb-meal-preference-pills>button:visible,#bbSimpleMealPreferences .bb81-pro-pill:visible');
 assert.ok(await visibleChoices.count()>=8,'the existing dietary and Premium filter choices are still present');
 for(const node of await visibleChoices.all())assert.ok((await node.boundingBox()).height>=44,'preference choices keep their touch targets');
 await page.locator('#bbSimpleBudget').evaluate(node=>node.open=true);
 await assertPanelInFlow(page,'#bbSimpleBudget>.bbs-budget-body','#bbSimpleMealPreferences');
 await assertPanelInFlow(page,'#bbSimpleMealPreferences>.bb-meal-preference-body','#bbIngredientPicker');
 await page.locator('#bbSimpleMealPreferences .bb-meal-preferences>details>summary').click();
 assert.ok(await visibleChoices.count()>=13,'nested planning goals can still be revealed');
 for(const node of await visibleChoices.all())assert.ok((await node.boundingBox()).height>=44,'nested choices also retain their touch targets');
 await assertPanelInFlow(page,'#bbSimpleMealPreferences>.bb-meal-preference-body','#bbIngredientPicker');
 await page.locator('#bbSimpleMealPreferences').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
 await page.screenshot({path:path.join(directory,'preferences-'+viewport.width+'-after.png'),animations:'disabled'});
 await page.locator('#bbAvoidIngredientTab').click();
 await page.locator('#bbAvoidIngredientPanel[open]').waitFor();
 const dialog=await page.locator('#bbAvoidIngredientPanel').boundingBox();
 assert.ok(dialog.x>=0&&dialog.x+dialog.width<=viewport.width&&dialog.y>=0&&dialog.y+dialog.height<=viewport.height,'the existing native avoid-food dialog remains contained');
 await page.locator('#bbAvoidIngredientPanel .bb-avoid-close').click();
 await page.locator('#clearWeek').click();
 await page.getByRole('button',{name:'Keep my week',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.__planOptionsOriginal.map(original=>({id:original.id,sameNode:document.getElementById(original.id)===original.node,sameParent:original.node.parentNode===original.parent,sameHandler:original.node.onclick===original.onclick}))),['bbSimpleBudget','bbSimpleMealPreferences','bbIngredientPicker','bb77BudgetTarget','clearWeek'].map(id=>({id,sameNode:true,sameParent:true,sameHandler:true})));
 assert.deepEqual(await snapshot(page),saved,'opening options and cancelling Clear week leaves saved plan, stock and budget unchanged');
 assert.equal(await page.locator('.bbnext-plan-budget').innerText(),hero,'live summary bindings remain unchanged');
 await page.locator('#bbPlanMoreOptions>summary').click();
 assert.equal(await page.locator('#bbSimpleBudget').isVisible(),false,'options collapse cleanly again');
}));
