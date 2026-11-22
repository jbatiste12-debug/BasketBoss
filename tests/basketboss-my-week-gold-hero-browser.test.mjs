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

async function fixture(viewport,run,{slowPolishMs=0,observeColdPaint=false}={}){
 const context=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768,reducedMotion:'no-preference',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 const app=transform700Presentation(transform700Html(await fs.readFile(path.join(root,'app.html'),'utf8'),release));
 // Every request is local, including API calls. No production data or billing
 // operations are possible, and the original renderer/handlers are exercised.
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"authenticated":false,"error":"sign_in_required"}'});
  let rel=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');
  if(slowPolishMs&&rel==='bb-plan-premium-polish.js')await new Promise(resolve=>setTimeout(resolve,slowPolishMs));
  if(['app','app/','app.html','index.html','index',''].includes(rel))rel='app.html';
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;
   if(rel==='app.html')body=app;
   else{
    try{body=await fs.readFile(path.join(root,rel));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',rel));}
    if(rel==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(rel==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(rel.endsWith('.js'))body=transform700Presentation(body.toString());
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};
   return route.fulfill({status:200,contentType:types[path.extname(rel)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  if(localStorage.getItem('navigation-first-paint-fixture'))return;
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
  localStorage.setItem('navigation-first-paint-fixture','1');
 });
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.bbnext-day.has-meal');
  await page.waitForFunction(()=>typeof window.BBPantryNormalize==='function');
  await run(page,context);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}


const heroSelector='#app.bbnext-plan[data-bb-compact-header="true"] .bbnext-plan-budget';
const readHero=()=>{
 const card=document.querySelector('#app.bbnext-plan .bbnext-plan-budget'),price=card.querySelector('#myWeekEstimatedTotal'),caption=card.querySelector('.bbnext-plan-donut-core>small'),info=card.querySelector('.bbpc-week-info>summary'),anchor=card.querySelector('.bbpc-week-price'),feed=card.querySelector('.bbfeed-global'),title=card.querySelector('h2'),next=document.querySelector('.bb-pantry-first-next-week'),help=document.querySelector('#bbnextPlanAutofill>summary');
 const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const style=getComputedStyle(price),core=getComputedStyle(price.parentElement),body=card.querySelector('.bbpc-week-info-body');
 return {card:rect(card),price:rect(price),caption:rect(caption),info:rect(info),anchor:rect(anchor),feed:rect(feed),title:rect(title),next:rect(next),help:rect(help),font:style.fontFamily,weight:style.fontWeight,size:parseFloat(style.fontSize),color:style.color,coreDirection:core.flexDirection,coreWrap:core.flexWrap,coreAlign:core.alignItems,watermark:getComputedStyle(card.querySelector('.bb77-week-mark')).display,infoRing:{width:parseFloat(getComputedStyle(info,'::before').width),height:parseFloat(getComputedStyle(info,'::before').height)},nextBackground:getComputedStyle(next).backgroundImage,cardBackground:getComputedStyle(card).backgroundImage,border:getComputedStyle(card).borderTopColor,body:rect(body),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
};
const options={skip:!chromium,timeout:90000};
test('gold My Week hero retains a single nonwrapping estimate row and current controls at phone and desktop widths',options,()=>fixture({width:390,height:844},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('.bbpc-week-header .bbfeed-global>span').textContent(),'Feeding:');
 const stored=await page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1')),evidence=[];
 for(const width of [320,360,390,430,768,1440]){
  await page.setViewportSize({width,height:900});
  for(const amount of ['£94.35','£175.50','£1,234.56']){
   await page.evaluate(amount=>{document.querySelector('#myWeekEstimatedTotal').textContent=amount;document.querySelector('.bbpc-week-header .bbfeed-global>strong').textContent='12';},amount);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const h=await page.evaluate(readHero);evidence.push({width,amount,...h});
   assert.equal(h.weight,'800');assert.match(h.font,/Inter/);assert.equal(h.color,'rgb(255, 255, 255)');
   assert.equal(h.coreDirection,'row');assert.equal(h.coreWrap,'nowrap');assert.equal(h.coreAlign,'baseline');
   assert.equal(h.watermark,'none');assert.deepEqual(h.infoRing,{width:18,height:18});
   assert.ok(h.info.width>=44&&h.info.height>=44,'visible ring keeps an accessible hit target');
   assert.ok(h.title.right<=h.feed.left+1,JSON.stringify({width,amount,h}));
   assert.ok(h.anchor.right<=h.next.left+1,JSON.stringify({width,amount,h}));
   assert.ok(h.price.right<=h.caption.left+1&&h.caption.right<=h.info.left+1,JSON.stringify({width,amount,h}));
   assert.ok(h.info.right<=h.anchor.right+1,JSON.stringify({width,amount,h}));
   assert.ok(h.next.right<=h.card.right+1&&h.help.bottom<=h.card.bottom+1,JSON.stringify({width,amount,h}));
   assert.ok(h.scrollWidth<=width+1,JSON.stringify({width,amount,h}));
   assert.match(h.cardBackground,/radial-gradient/);assert.match(h.cardBackground,/linear-gradient/);assert.match(h.nextBackground,/255, 253, 247/);
  }
 }
 assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1')),stored,'presentation never writes planning state');
 await fs.writeFile('/tmp/basketboss-my-week-gold-hero-layout-20261122.json',JSON.stringify(evidence,null,2));
}));
test('native estimate disclosure is nonblocking, keyboard operable and does not cover the next-week or Feeding controls',options,()=>fixture({width:390,height:844},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));
 const info=page.locator('.bbpc-week-info');
 const before=await page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1'));
 await info.locator('summary').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.bbpc-week-info').open);
 const h=await page.evaluate(readHero);assert.ok(h.body.top>=h.next.bottom&&h.body.top>=h.feed.bottom);assert.ok(h.body.right<=h.card.right+1);assert.ok(h.scrollWidth<=h.viewport+1);
 await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('.bbpc-week-info').open);
 assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1')),before);
 await page.locator('#bbnextPlanAutofill>summary').click();await page.waitForFunction(()=>document.querySelector('#bbnextPlanAutofill').open);
 assert.equal(await page.locator('#bbPantryPlannerButton').isVisible(),true,'the original Auto-fill disclosure still exposes its real action');
 await page.locator('#bbnextPlanAutofill>summary').click();
 await page.getByRole('button',{name:'Feed one more person',exact:true}).click();
 assert.equal(await page.locator('.bbpc-week-header .bbfeed-global>strong').textContent(),'5');
}));
test('gold My Week hero preview',options,()=>fixture({width:390,height:844},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>{document.querySelector('#myWeekEstimatedTotal').textContent='£94.35';document.querySelector('.bbpc-week-header+.bbnext-plan-kicker+p').textContent='7/7 dinners • 0/5 school lunches';});
 await page.screenshot({path:'/tmp/basketboss-my-week-gold-hero-20261122.jpg',type:'jpeg',quality:65,fullPage:false});
}));

test('all seven longer day pills retain full names, mobile geometry and the existing tap/double-tap actions',options,()=>fixture({width:390,height:844},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));
 const expected=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 for(const width of [320,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  const pills=await page.locator('#app .bbnext-day-label').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),d=n.closest('summary').querySelector('.bbnext-day-description'),dr=d.getBoundingClientRect();return{text:n.textContent.trim(),width:r.width,height:r.height,left:r.left,right:r.right,parentRight:n.parentElement.getBoundingClientRect().right,empty:!n.closest('.bbnext-day').classList.contains('has-meal'),descLeft:dr.left,nowrap:getComputedStyle(n).whiteSpace};}));
  assert.deepEqual(pills.map(n=>n.text),expected);
  for(const pill of pills){assert.ok(pill.width>=90&&pill.height>=44,JSON.stringify({width,pill}));assert.equal(pill.nowrap,'nowrap');if(pill.empty)assert.ok(pill.right<=pill.descLeft+1,JSON.stringify({width,pill}));else assert.ok(pill.right<=pill.parentRight+1,JSON.stringify({width,pill}));}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 const monday=page.locator('.bbnext-day[data-bbnext-day="Monday"] .bbnext-day-label');
 await monday.click();await page.waitForSelector('.bbnext-day[data-bbnext-day="Monday"].bbdps-active');
 await page.locator('.bbdps-active .bbdps-close').click();await page.waitForFunction(()=>!document.querySelector('.bbdps-active'));
 await monday.dblclick({delay:90});await page.waitForSelector('dialog.bb-day-done-dialog[open]');
 assert.equal(await page.locator('dialog.bb-day-done-dialog[open]').isVisible(),true);
 assert.equal(await page.locator('dialog.bb-day-done-dialog[open]').getAttribute('aria-label'),'Review Monday planned food');
}));

for(const width of [320,390,1440])test('estimate explanation paints and hit-tests above Auto-fill controls at '+width+'px',options,()=>fixture({width,height:900},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));
 const before=await page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1'));
 await page.evaluate(()=>{window.__estimateSummary=document.querySelector('.bbpc-week-info>summary');});
 const summary=page.locator('.bbpc-week-info>summary');await summary.focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.bbpc-week-info').open);
 const result=await page.evaluate(()=>{
  const body=document.querySelector('.bbpc-week-info-body'),box=body.getBoundingClientRect(),walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT),probes=[];
  let node;while(node=walker.nextNode()){
   if(!node.textContent.trim())continue;
   const range=document.createRange();range.selectNodeContents(node);
   for(const r of range.getClientRects()){
    if(!r.width||!r.height||r.bottom<0||r.top>=innerHeight)continue;
    const x=Math.min(r.right-1,r.left+Math.max(1,Math.min(20,r.width/2))),y=r.top+r.height/2;
    const hits=document.elementsFromPoint(x,y);probes.push({x,y,unobscured:body.contains(hits[0]),top:hits[0]?.tagName+'#'+hits[0]?.id,owners:hits.slice(0,5).map(n=>n.id||n.className)});
   }
  }
  for(const [x,y]of [[box.left+6,box.top+6],[box.right-6,box.top+6],[box.left+6,box.bottom-6],[box.right-6,box.bottom-6]]){
   const hits=document.elementsFromPoint(x,y);probes.push({x,y,background:true,unobscured:body.contains(hits[0]),top:hits[0]?.tagName+'#'+hits[0]?.id});
  }
  const controlUncovered=selector=>{const n=document.querySelector(selector),r=n.getBoundingClientRect();return n===document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)||n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));};
  return {probes,body:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},nextUncovered:controlUncovered('.bb-pantry-first-next-week'),feedingUncovered:controlUncovered('.bbpc-week-header .bbfeed-global>button:last-child'),overflow:document.documentElement.scrollWidth>innerWidth+1};
 });
 assert.ok(result.probes.length>0,JSON.stringify(result));for(const probe of result.probes)assert.ok(probe.unobscured,JSON.stringify({width,...probe}));
 assert.equal(result.nextUncovered,true);assert.equal(result.feedingUncovered,true);assert.equal(result.overflow,false);
 await summary.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('.bbpc-week-info').open);
 assert.equal(await page.evaluate(()=>window.__estimateSummary===document.querySelector('.bbpc-week-info>summary')),true,'same original summary owns closing');
 assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1')),before,'opening/closing explanation does not write state');
 if(width===390){await summary.click();await page.screenshot({path:'/tmp/basketboss-my-week-info-visible-20261122.jpg',type:'jpeg',quality:65});}
}));

const budgetCopies=()=>{
 const app=document.getElementById('app'),comparison=app.querySelector('.bbpc-week-budget-comparison');
 return {target:app.querySelector('#bbSimpleBudget .bbnext-plan-budget-line')?.textContent,forecast:app.querySelector('#bbSimpleBudget .bb77-weekly-forecast')?.textContent,status:app.querySelector('#bbSimpleBudget .bb77-weekly-budget-state')?.textContent,statusHidden:app.querySelector('#bbSimpleBudget .bb77-weekly-budget-state')?.hidden,shownForecast:comparison?.querySelector('.bbpc-week-budget-forecast')?.textContent,shownStatus:comparison?.querySelector('.bbpc-week-budget-state')?.textContent,exists:!!comparison};
};
async function saveExistingBudget(page,value){
 if(!await page.locator('#bbPlanMoreOptions').evaluate(node=>node.open))await page.locator('#bbPlanMoreOptions>summary').click();
 if(!await page.locator('#bbSimpleBudget').evaluate(node=>node.open))await page.locator('#bbSimpleBudget>summary').click();
 await page.locator('#bb77BudgetTarget').fill(value);
 await page.waitForFunction(value=>localStorage.getItem('basketboss_v172_weekly_budget_target_v1')===value,value);
 await page.waitForSelector('.bbpc-week-budget-comparison');
}
test('unset budget keeps the original Set budget control and creates no suggested-target comparison',options,()=>fixture({width:390,height:844},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));
 const copy=await page.evaluate(budgetCopies);assert.equal(copy.statusHidden,true);assert.equal(copy.exists,false);assert.equal(copy.target,'Set your weekly budget');
 await page.locator('#bbPlanMoreOptions>summary').click();await page.locator('#bbSimpleBudget>summary').click();
 assert.equal(await page.locator('#bb77BudgetTarget').isVisible(),true);assert.equal(await page.locator('.bb77-budget-form button[type="submit"]').textContent(),'Set budget');
}));
for(const [budget,qualification]of [['200','under'],['1','over']])test('saved '+budget+' budget mirrors the canonical '+qualification+' comparison without calculation',options,()=>fixture({width:390,height:844},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));await saveExistingBudget(page,budget);
 const copy=await page.evaluate(budgetCopies);assert.equal(copy.statusHidden,false);assert.equal(copy.shownForecast,copy.forecast);assert.equal(copy.shownStatus,copy.status);assert.match(copy.shownStatus,new RegExp(' '+qualification+' your £'+budget+' budget'));
 await page.locator('#bbSimpleBudget>summary').click();await page.locator('#bbPlanMoreOptions>summary').click();
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:900});const geometry=await page.locator('.bbpc-week-budget-comparison').evaluate(n=>{const r=n.getBoundingClientRect(),b=n.closest('.bbnext-plan-budget').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,cardLeft:b.left,cardRight:b.right,cardBottom:b.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};});
  assert.ok(geometry.left>=geometry.cardLeft&&geometry.right<=geometry.cardRight&&geometry.bottom<=geometry.cardBottom);assert.equal(geometry.overflow,false);
 }
}));
test('editing a draft cannot replace the saved comparison until the original budget owner saves it',options,()=>fixture({width:390,height:844},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));await saveExistingBudget(page,'200');const before=await page.evaluate(budgetCopies);
 const saved=await page.evaluate(()=>({target:localStorage.getItem('basketboss_v172_weekly_budget_target_v1'),state:localStorage.getItem('basketboss_321_unified_state_v1')}));
 await page.locator('#bb77BudgetTarget').fill('');await page.evaluate(()=>window.BBPlanCompact.refresh());
 assert.deepEqual(await page.evaluate(budgetCopies),before);
 await page.locator('#bb77BudgetTarget').evaluate(node=>{node.value='999';window.BBPlanCompact.refresh();});
 assert.deepEqual(await page.evaluate(budgetCopies),before);
 assert.deepEqual(await page.evaluate(()=>({target:localStorage.getItem('basketboss_v172_weekly_budget_target_v1'),state:localStorage.getItem('basketboss_321_unified_state_v1')})),saved);
 await page.locator('#bb77BudgetTarget').fill('250');await page.waitForFunction(()=>document.querySelector('.bbpc-week-budget-state')?.textContent.includes('£250 budget'));
 const after=await page.evaluate(budgetCopies);assert.equal(after.shownForecast,after.forecast);assert.equal(after.shownStatus,after.status);
}));
test('unpriced and incomplete canonical comparisons retain their qualification instead of inventing a remainder',options,()=>fixture({width:390,height:844},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));await saveExistingBudget(page,'200');
 const saved=await page.evaluate(()=>({target:localStorage.getItem('basketboss_v172_weekly_budget_target_v1'),state:localStorage.getItem('basketboss_321_unified_state_v1')}));
 await page.evaluate(()=>{
  document.querySelector('#bbSimpleBudget .bb77-weekly-forecast').textContent='Recorded purchases + shopping estimate: £94.35 +';
  document.querySelector('#bbSimpleBudget .bb77-weekly-budget-state').textContent='£94.35 priced so far · £200 budget';
  window.BBPlanCompact.refresh();
 });
 const copy=await page.evaluate(budgetCopies);assert.equal(copy.shownForecast,copy.forecast);assert.equal(copy.shownStatus,copy.status);assert.match(copy.shownStatus,/priced so far/);assert.doesNotMatch(copy.shownStatus,/under|over|remaining/);
 await page.evaluate(()=>{document.querySelector('#bbSimpleBudget .bb77-weekly-forecast').textContent='';window.BBPlanCompact.refresh();});
 assert.equal(await page.locator('.bbpc-week-budget-comparison').count(),0,'an incomplete owner cannot produce a fake zero');
 assert.deepEqual(await page.evaluate(()=>({target:localStorage.getItem('basketboss_v172_weekly_budget_target_v1'),state:localStorage.getItem('basketboss_321_unified_state_v1')})),saved);
}));
test('saved £200 comparison preview',options,()=>fixture({width:390,height:900},async page=>{
 await page.waitForFunction(()=>!!document.querySelector('.bbpc-week-header'));await saveExistingBudget(page,'200');
 await page.locator('#bbSimpleBudget>summary').click();await page.locator('#bbPlanMoreOptions>summary').click();
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'/tmp/basketboss-my-week-budget-comparison-20261122.jpg',type:'jpeg',quality:65});
}));
