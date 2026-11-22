import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {transformNativeHtml} from '../scripts/build-native-web.mjs';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';
import {transform700MakeAMeal} from '../tools/catalogue700/make-a-meal.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser,release,androidDocument;const runtimes=new Map(),platforms=['ios'];
try{await fs.access(path.join(root,'native/android-runtime.mjs'));platforms.push('android');({androidDocument}=await import('../scripts/build-android-web.mjs'));}catch{}
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
let build;
for(const name of ['esbuild','/tmp/basketboss-android-sync-release-20261121/node_modules/esbuild'].filter(Boolean))try{({build}=require(name));break;}catch{}
const baseline=process.env.BB_NATIVE_ENTRY_BASELINE==='1';
const readSource=async(name,platform='ios')=>baseline&&['app.html','index.html','native/startup.mjs','native/entry-readiness.mjs','native/runtime.mjs','native/android-runtime.mjs'].includes(name)?execFileSync('git',['show',(platform==='android'?'d490dba':'81fea34')+':'+name],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}):fs.readFile(path.join(root,name),'utf8');
const transport=platform=>`
const call=(plugin,method)=>async(...args)=>{(window.__nativeTransportCalls||=[]).push({plugin,method});if(method==='addListener')return{remove:async()=>{}};if(method==='clearReceiptPhotos')return{ok:true};if(method==='isAvailable')return{available:true};return{};};
const plugin=name=>new Proxy({},{get:(_,method)=>call(name,method)});
export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> ${JSON.stringify(platform)},isPluginAvailable:()=>true};
export const registerPlugin=plugin;
export const App=plugin('App'),Browser=plugin('Browser'),Camera=plugin('Camera'),Haptics=plugin('Haptics'),StatusBar=plugin('StatusBar'),SplashScreen=plugin('SplashScreen'),SystemBars=plugin('SystemBars');
export const CameraResultType={Uri:'uri'},CameraSource={Prompt:'PROMPT'},ImpactStyle={Light:'LIGHT'},NotificationType={Success:'SUCCESS'},Style={Light:'LIGHT'},SystemBarsStyle={Light:'LIGHT'};
`;
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(!chromium||!build)return;
 // Compile the production runtime and all its real startup/deletion/onboarding
 // integrations. Only the unavailable native device transport is replaced.
 for(const platform of platforms){
 const result=await build({entryPoints:[path.join(root,platform==='android'?'native/android-runtime.mjs':'native/runtime.mjs')],write:false,bundle:true,format:'iife',platform:'browser',target:'es2020',absWorkingDir:root,plugins:[{name:'local-native-transport',setup(builder){
  builder.onResolve({filter:/^@capacitor\//},args=>({path:args.path,namespace:'native-transport'}));
  builder.onLoad({filter:/.*/,namespace:'native-transport'},()=>({contents:transport(platform),loader:'js'}));
  if(baseline)builder.onLoad({filter:/\/native\/(?:runtime|android-runtime|startup|entry-readiness)\.mjs$/},async args=>({contents:await readSource(path.relative(root,args.path),platform),loader:'js',resolveDir:path.dirname(args.path)}));
 }}]});runtimes.set(platform,result.outputFiles[0].text);
 }
 browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});
const options={skip:!chromium||!build?'Chromium or esbuild unavailable':false,timeout:45000};

for(const platform of platforms)for(const held of ['bb-plan-premium-polish.js','bb-auth-sdk.js'])test(platform+': returning native Cook → Plan never paints static or partially presented UI while '+held+' is delayed',options,async()=>{
 const origin=platform==='android'?'https://localhost':'https://basketboss.co.uk';
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,reducedMotion:'no-preference',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 const documents=new Map();
 const platformDocument=html=>platform==='android'?androidDocument(html):html;
 for(const name of ['app.html','index.html'])documents.set(name,platformDocument(transform700Presentation(transform700Html(transformNativeHtml(await readSource(name,platform)),release))));
 documents.set('make-a-meal.html',platformDocument(transform700Presentation(transformNativeHtml(await readSource('make-a-meal.html',platform))).replace('</head>','<script src="bb-recipe-planning.js"></script>\n</head>')));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['localhost','basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:'{"authenticated":false,"error":"sign_in_required"}'});
  const rel=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  // A parser-blocking script AFTER the static shell makes those frames real,
  // rather than hoping a fast local machine happens to paint while parsing.
  if(rel==='bb-pantry-policy.js')await new Promise(resolve=>setTimeout(resolve,100));
  if(rel===held)await new Promise(resolve=>setTimeout(resolve,600));
  try{
   let body;
   if(documents.has(rel))body=documents.get(rel);
   else if(rel==='bb-native-runtime.js')body=runtimes.get(platform);
   else if(rel==='bb-native.css')body=await fs.readFile(path.join(root,platform==='android'?'native/android.css':'native/bb-native.css'));
   else{
    try{body=await fs.readFile(path.join(root,rel));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',rel));}
    if(rel==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(rel==='make-a-meal.js')body=transform700MakeAMeal(body.toString(),release,{publicRecipesUrl:'recipes.json'});
    else if(rel==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(rel.endsWith('.js'))body=transform700Presentation(body.toString());
   }
   const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};
   return route.fulfill({status:200,contentType:mime[path.extname(rel)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(()=>{
  if(!sessionStorage.getItem('native-cold-plan-fixture')){
   localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
   localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
   localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');
   localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));
   sessionStorage.setItem('basketboss_native_startup_seen_v1','1');sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');sessionStorage.setItem('native-cold-plan-fixture','1');
  }
  const probe=window.__nativePlanPaint={frames:[],stop:false};
  const visible=node=>!!node&&node.getClientRects().length>0&&node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  const sample=()=>{
   const app=document.getElementById('app'),shell=document.querySelector('body>.shell'),header=shell?.querySelector('header.top'),nav=shell?.querySelector('nav.tabs');
   const card=app?.querySelector('.bbnext-plan-budget'),ring=card?.querySelector('.bbnext-plan-donut');
   probe.frames.push({time:performance.now(),ready:document.readyState,starting:document.documentElement.classList.contains('bb-native-starting'),hasShell:!!shell,hasApp:!!app,startupVisible:visible(document.getElementById('bbNativeStartup')),shell:visible(shell),app:visible(app),header:visible(header),headerReady:!!header?.dataset.bbAccountPolish,install:visible(document.querySelector('[data-bb173-install-banner]')),legacyRegion:visible(document.getElementById('bb307Island')?.closest('body>[role=note]')),view:document.body?.dataset.bbnextView,compact:app?.dataset.bbCompactHeader==='true'&&!!app?.querySelector('.bbpc-week-header'),ringHeight:ring?.getBoundingClientRect().height,cardHeight:card?.getBoundingClientRect().height,cardBackground:card&&getComputedStyle(card).backgroundImage,price:app?.querySelector('.bbpc-week-price')?.textContent,navVisible:visible(nav),navReady:nav?.dataset.bbNavigation==='polished',visualSelected:[...nav?.querySelectorAll(':scope>button,:scope>a')||[]].filter(visible).filter(node=>{const style=getComputedStyle(node),rgb=style.backgroundColor.match(/[\d.]+/g)?.map(Number)||[];return style.backgroundImage!=='none'||rgb[1]>rgb[0]+15&&rgb[1]>rgb[2]+10&&rgb[0]<200&&rgb[1]<210;}).map(node=>node.querySelector('.nav-label')?.textContent.trim()),selected:[...nav?.querySelectorAll('[data-bb-nav-current="true"]')||[]].filter(visible).map(node=>node.dataset.bbNavItem)});
   if(!probe.stop&&probe.frames.length<1500)requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 });
 try{
  await page.goto(origin+'/make-a-meal.html',{waitUntil:'domcontentloaded'});
  const plan=page.locator('nav[data-bb-navigation="polished"] [data-bb-nav-item="plan"]');await plan.waitFor({state:'visible'});
  const saved=await page.evaluate(()=>({planner:localStorage.getItem('basketboss_321_unified_state_v1'),stock:localStorage.getItem('basketboss_321_v7_measured_pantry')}));
  await Promise.all([page.waitForURL(/\/index\.html(?:\?|$)/),plan.click()]);
  await page.waitForFunction(()=>window.BBNativeStartup?.phase==='ready'&&document.querySelector('#app .bbpc-week-header'));
  await page.waitForTimeout(100);
  const frames=await page.evaluate(()=>{window.__nativePlanPaint.stop=true;return window.__nativePlanPaint.frames;});
  const directory=path.join(os.tmpdir(),'basketboss-ui-previews','native-cold-plan-'+platform+'-'+held.replace('.js','')+(baseline?'-baseline':''));await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'paint-samples.json'),JSON.stringify(frames,null,2));await page.screenshot({path:path.join(directory,'settled.png')});
  assert.ok(frames.some(frame=>frame.ready==='loading'),'probe begins while the new document is still parsing');
  assert.ok(frames.some(frame=>frame.ready==='loading'&&frame.hasShell&&frame.shell===false),'raw parsed shell stays isolated');
  assert.deepEqual(frames.filter(frame=>frame.install),[],'a native app must never flash browser installation markup');
  assert.deepEqual(frames.filter(frame=>frame.legacyRegion),[],'the retired raw region note outside the shell never paints');
  assert.deepEqual(frames.filter(frame=>frame.startupVisible),[],'returning tab navigation adds no logo/loading wall');
  const visibleFrames=frames.filter(frame=>frame.shell||frame.app||frame.header||frame.navVisible);
  assert.ok(visibleFrames.length>0,'the current local screen is actually revealed');
  for(const frame of visibleFrames){
   assert.equal(frame.view,'week',JSON.stringify(frame));assert.equal(frame.starting,false,JSON.stringify(frame));assert.equal(frame.compact,true,JSON.stringify(frame));assert.equal(frame.headerReady,true,JSON.stringify(frame));assert.equal(frame.navReady,true,JSON.stringify(frame));assert.deepEqual(frame.selected,['plan'],JSON.stringify(frame));assert.deepEqual(frame.visualSelected,['Plan'],JSON.stringify(frame));
  }
  assert.deepEqual(await page.evaluate(()=>({planner:localStorage.getItem('basketboss_321_unified_state_v1'),stock:localStorage.getItem('basketboss_321_v7_measured_pantry')})),saved,'native document navigation preserves saved plan, feeding and physical stock');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
