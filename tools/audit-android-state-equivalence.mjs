#!/usr/bin/env node
// Compares actual generated Android pages with only the reviewed presentation
// changes restored. Never filters persisted keys or overrides app safety owners.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {transform700Presentation} from './catalogue700/presentation.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url)),BASE='c05180b1d28b4c30d2ae7b272faeab0f0565e546';
const require=createRequire(import.meta.url),{chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright');
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||path.join(os.tmpdir(),'basketboss-android-state-equivalence.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const old=name=>execFileSync('git',['show',BASE+':'+name],{cwd:ROOT,encoding:'utf8',maxBuffer:16e6});
const section=(text,begin,end)=>{const first=text.indexOf(begin),last=text.indexOf(end,first+begin.length);assert.ok(first>=0&&last>first&&text.indexOf(begin,first+1)<0,'unique '+begin);return text.slice(first,last);};
const baselineHTML=old('app.html'),baselineAssets=new Map();
for(const name of ['bb-pantry-inline.js','bb-plan-premium-polish.js','bb-pantry-stock-levels-ui.js','bb-us-market.js'])baselineAssets.set(name,transform700Presentation(old(name)));
const restoreHTML=current=>{for(const [begin,end]of [['function bbShopExactQuantity(','function bbShopPurchasePack('],['function bb172RenderBudget(','function bb172ImageMark(']])current=current.replace(section(current,begin,end),transform700Presentation(section(baselineHTML,begin,end)));return current;};
const transport=`const call=(plugin,method)=>async(...args)=>{if(method==='addListener')return{remove:async()=>{}};if(method==='clearReceiptPhotos')return{ok:true};if(method==='isAvailable')return{available:true};return{};};const plugin=name=>new Proxy({},{get:(_,method)=>call(name,method)});export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>true};export const registerPlugin=plugin;export const App=plugin('App'),Browser=plugin('Browser'),Camera=plugin('Camera'),Haptics=plugin('Haptics'),StatusBar=plugin('StatusBar'),SplashScreen=plugin('SplashScreen'),SystemBars=plugin('SystemBars');export const CameraResultType={Uri:'uri'},CameraSource={Prompt:'PROMPT'},ImpactStyle={Light:'LIGHT'},NotificationType={Success:'SUCCESS'},Style={Light:'LIGHT'},SystemBarsStyle={Light:'LIGHT'};`;
const bundled=await build({entryPoints:[path.join(ROOT,'native/android-runtime.mjs')],write:false,bundle:true,format:'iife',platform:'browser',target:'es2020',minify:true,absWorkingDir:ROOT,plugins:[{name:'unavailable-native-transport-only',setup(builder){builder.onResolve({filter:/^@capacitor\//},args=>({path:args.path,namespace:'transport'}));builder.onLoad({filter:/.*/,namespace:'transport'},()=>({contents:transport,loader:'js'}));}}]});
const reviewedClean={"bb-household-aliases.js":{"old":" const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\\u0000-\\u001f\\u007f]/g,' ').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\\s+/g,' ').trim():'';","new":" // Bounded primitive normalization only; callbacks and matching stay live.\n const cleanStrings=new Map();\n const clean=value=>{\n  if(typeof value!=='string')return '';\n  if(value.length<=256){const cached=cleanStrings.get(value);if(cached!==undefined)return cached;}\n  const result=value.normalize('NFKC').replace(/[\\u0000-\\u001f\\u007f]/g,' ').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\\s+/g,' ').trim();\n  if(value.length<=256){\n   if(cleanStrings.size===512)cleanStrings.delete(cleanStrings.keys().next().value);\n   cleanStrings.set(value,result);\n  }\n  return result;\n };","nativeBaselineSha256":"e661be8bd0f2cf19f395f70a337c0689080ac142f7f4ad01ac3201facdb64651"},"bb-pantry-policy.js":{"old":" const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\\u0000-\\u001f\\u007f]/g,' ').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\\s+/g,' ').trim():'';","new":" // Bounded primitive normalization only; callbacks and matching stay live.\n const cleanStrings=new Map();\n const clean=value=>{\n  if(typeof value!=='string')return '';\n  if(value.length<=256){const cached=cleanStrings.get(value);if(cached!==undefined)return cached;}\n  const result=value.normalize('NFKC').replace(/[\\u0000-\\u001f\\u007f]/g,' ').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\\s+/g,' ').trim();\n  if(value.length<=256){\n   if(cleanStrings.size===512)cleanStrings.delete(cleanStrings.keys().next().value);\n   cleanStrings.set(value,result);\n  }\n  return result;\n };","nativeBaselineSha256":"085205ffb0aacf65f5f0303f4100faed291ea879b5eaf7b09c92419bc1322fbc"},"basketboss-pricing-v19.js":{"old":"const clean=s=>String(s||'').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/,/g,' ').replace(/\\s+/g,' ').trim();","new":"// Bounded primitive normalization only; callbacks and matching stay live.\nconst cleanStrings=new Map();\nconst clean=s=>{\n const value=String(s||'');\n if(value.length<=256){const cached=cleanStrings.get(value);if(cached!==undefined)return cached;}\n const result=value.toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/,/g,' ').replace(/\\s+/g,' ').trim();\n if(value.length<=256){\n  if(cleanStrings.size===512)cleanStrings.delete(cleanStrings.keys().next().value);\n  cleanStrings.set(value,result);\n }\n return result;\n};","nativeBaselineSha256":"cfa61b2696731ec6cc6f82025ee48a7fda694781b50ac1ecb3bd31e42a74cbb6"}};
const reverseClean=(name,text)=>{const row=reviewedClean[name];assert.equal(text.split(row.new).length,2,'one reviewed primitive normalization cache '+name);return text.replace(row.new,row.old);};
const runtime=bundled.outputFiles[0].text,files=new Map();
async function generated(name){if(!files.has(name))files.set(name,await fs.readFile(path.join(ROOT,'dist/android',name)));return files.get(name);}
const browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const all=[];
try{for(const variant of ['baseline','fixed']){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[],missing=[];
 page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://localhost'},body:'{"authenticated":false,"error":"sign_in_required"}'});
  if(url.hostname!=='localhost')return route.fulfill({status:200,body:''});
  const rel=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';if(rel.includes('..'))return route.fulfill({status:404,body:''});
  try{let body=rel==='bb-native-runtime.js'?runtime:variant==='baseline'&&baselineAssets.has(rel)?baselineAssets.get(rel):await generated(rel);
   if(variant==='baseline'&&['app.html','index.html'].includes(rel))body=restoreHTML(body.toString());
   if(variant==='baseline'&&reviewedClean[rel]){body=reverseClean(rel,body.toString());assert.equal(sha(body),reviewedClean[rel].nativeBaselineSha256,'baseline restores exact original generated module including packs');}
   const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
   return route.fulfill({status:200,body,contentType:mime[path.extname(rel)]||'application/octet-stream'});
  }catch{missing.push(rel);return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  const OriginalDate=Date,fixed=1795348800000;
  window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
  Math.random=()=>.314159;Object.defineProperty(crypto,'randomUUID',{value:()=> '11111111-2222-4333-8444-555555555555'});
  if(!sessionStorage.getItem('__equivalence_seeded')){
   const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],ids=['fajitas','chicken-burgers','creamy-pasta','sausage-gnocchi','pulled-pork','beef-chilli','stir-fry'];
   localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
   localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:ids.map((recipeId,i)=>({recipeId,day:days[i]})),plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
   localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');localStorage.setItem('basketboss_v172_weekly_budget_target_v1','200');localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
   const foods=[['Milk','fridge',500,'ml'],['Rice','cupboard',500,'g'],['Pasta','cupboard',250,'g'],['Chopped tomatoes','cupboard',400,'g'],['Onion','cupboard',2,'each'],['Carrots','fridge',500,'g'],['Cheddar','fridge',200,'g'],['Chicken breast','fridge',300,'g'],['Beef mince','freezer',500,'g'],['Red pepper','fridge',2,'each'],['Spinach','fridge',100,'g'],['Broccoli','fridge',250,'g'],['Butter','fridge',100,'g'],['Eggs','fridge',6,'each'],['Potatoes','cupboard',1000,'g']],inventory={},stock={};
   for(const [name,loc,qty,unit]of foods){const key=name.toLowerCase()+'|'+unit;inventory[loc+'|'+name.toLowerCase()]={name,loc,qty,unit,selected:true,bb173StockKey:key,bb173StockValue:qty};stock[key]=qty;}
   localStorage.setItem('basketboss_makeameal_v1_inventory',JSON.stringify(inventory));localStorage.setItem('basketboss_321_v7_measured_pantry',JSON.stringify(stock));sessionStorage.setItem('__equivalence_seeded','1');sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');sessionStorage.setItem('basketboss_native_startup_seen_v1','1');
  }
  window.__equivalenceWork=performance.now();new MutationObserver(()=>{window.__equivalenceWork=performance.now();}).observe(document,{childList:true,subtree:true});
 });
 const snapshots=[];
 const settle=async()=>{await page.waitForFunction(()=>performance.now()-window.__equivalenceWork>800);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 async function capture(name){await settle();const value=await page.evaluate(()=>({
  storage:Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])),
  visible:document.body.innerText,
  budget:document.querySelector('.bbpc-week-header')?.innerText||null,
  view:document.body.dataset.bbnextView,
  nav:[...document.querySelectorAll('[data-bb-nav-current="true"]')].map(node=>node.dataset.bbNavItem),
  inputs:[...document.querySelectorAll('input,select,textarea')].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>({id:node.id,type:node.type,value:node.value,disabled:node.disabled,checked:node.checked})),
  settingsOpen:document.querySelector('.bbui-settings-overlay')?.hidden===false
 }));snapshots.push({name,...value});console.log(JSON.stringify({variant,checkpoint:name,keys:Object.keys(value.storage).length,visibleHash:sha(value.visible),storageHash:sha(JSON.stringify(value.storage))}));}
 async function click(selector){await page.evaluate(selector=>{const node=document.querySelector(selector);if(!node)throw Error('Missing original control '+selector);node.click();},selector);await settle();}
 try{
  await page.goto('https://localhost/index.html',{waitUntil:'load'});await page.waitForFunction(()=>window.BBNativeStartup?.phase==='ready'&&document.querySelector('#bbPrimaryNavigation [data-bb-nav-current="true"]'));
  await capture('startup');
  for(const [name,item]of [['Discover','discover'],['Plan','plan'],['At home','kitchen'],['Shop','shop'],['Plan return','plan']]){await click('#bbPrimaryNavigation [data-bb-nav-item="'+item+'"]');await capture(name);}
  await page.evaluate(()=>{const input=document.getElementById('bb77BudgetTarget');if(!input)throw Error('Budget input missing');input.value='250';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  await capture('budget saved 250');assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_v172_weekly_budget_target_v1')),'250');
  await page.evaluate(()=>{const plus=[...document.querySelectorAll('.bbfeed-global button')].find(node=>/\+/.test(node.textContent)||/increase|more/i.test(node.getAttribute('aria-label')||''));if(!plus)throw Error('Feeding plus missing');plus.click();});
  await capture('Feeding +');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')).servings),5);
  await click('#bbuiOpenSettings');await capture('Settings open');
  await click('.bbui-settings-close');await capture('Settings close');
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  all.push({variant,snapshots,errors,missing});
 }finally{await context.close();}
 }}finally{await browser.close();}
const [baseline,fixed]=all;const checkpoints=[];
const freeIds=new Set(JSON.parse(await generated('recipes.json')).map(row=>row.id));
for(const variant of all){
 const initial=variant.snapshots[0].storage,model=JSON.parse(initial.basketboss_321_unified_state_v1);
 assert.equal(model.planned.length,7);assert.ok(model.planned.every(row=>freeIds.has(row.recipeId)),'all seven saved dinners are in the real generated Free catalogue');
 assert.equal(model.servings,4);assert.equal(Object.keys(JSON.parse(initial.basketboss_makeameal_v1_inventory)).length,15);
 assert.equal(variant.snapshots.find(row=>row.name==='Settings open').settingsOpen,true);
 assert.equal(variant.snapshots.find(row=>row.name==='Settings close').settingsOpen,false);
}
for(let i=0;i<baseline.snapshots.length;i++){
 const a=baseline.snapshots[i],b=fixed.snapshots[i];assert.equal(a.name,b.name);assert.deepEqual(b.storage,a.storage,a.name+': ALL localStorage bytes');
 for(const key of ['visible','budget','view','nav','inputs','settingsOpen'])assert.deepEqual(b[key],a[key],a.name+': '+key);
 checkpoints.push({name:a.name,everyStorageByteEqual:true,persistedKeys:Object.keys(a.storage).length,storageSha256:sha(JSON.stringify(a.storage)),visibleSha256:sha(a.visible),view:a.view,selected:a.nav});
}
const report={baseline:BASE,generatedClient:'dist/android',fixture:'7 Free dinners, household 4 then5,15 foods, saved budget200 then250, guest/completed onboarding',limitations:'Desktop Chromium actual generated client. Only unavailable native transport replaced; server unavailable guest APIs return401. Date,crypto.randomUUID,Math.random fixed for repeatability. No localStorage keys excluded.',checkpoints,all};
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log('PASS '+checkpoints.length+' generated Android equivalence checkpoints: '+output);
