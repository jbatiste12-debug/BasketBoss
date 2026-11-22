import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs/promises';
import path from'node:path';
import os from'node:os';
import{fileURLToPath}from'node:url';
import{createRequire}from'node:module';
import{execFileSync}from'node:child_process';
import{transformNativeHtml}from'../scripts/build-native-web.mjs';
import{transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release}from'../tools/catalogue700/build-client.mjs';
import{transform700Presentation}from'../tools/catalogue700/presentation.mjs';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
let chromium,build,browser,release;const runtimes=new Map(),platforms=['ios'];
for(const name of[process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
for(const name of['esbuild','/tmp/basketboss-android-sync-release-20261121/node_modules/esbuild'])try{({build}=require(name));break;}catch{}
const androidRoot=process.env.BB_ANDROID_SOURCE_ROOT||root;try{await fs.access(path.join(androidRoot,'native/android-runtime.mjs'));platforms.push('android');}catch{}
const baseline=process.env.BB_ACCOUNT_COLD_BASELINE==='1';
const source=async name=>baseline&&['bb-account-polish.js','bb-account-polish.css'].includes(name)?execFileSync('git',['show','81fea34:'+name],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}):fs.readFile(path.join(root,name),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const USER={id:'00000000-0000-4000-8000-000000000111',email:'native-account@example.invalid',email_confirmed_at:'2026-11-01T00:00:00Z',identities:[{provider:'email'}]};
const session=()=>({access_token:'synthetic-native-account-token',refresh_token:'synthetic-native-account-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:USER});
const next=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});if(!chromium||!build)return;
 for(const platform of platforms){
  const transport=`const call=(plugin,method)=>async(...args)=>{(window.__nativeCalls||=[]).push({plugin,method});if(method==='addListener'){(window.__nativeListeners||={})[plugin+':'+args[0]]=args[1];return{remove:async()=>{}};}if(method==='clearReceiptPhotos')return{ok:true};if(method==='isAvailable')return{available:true};return{};};const plugin=name=>new Proxy({},{get:(_,method)=>call(name,method)});export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>${JSON.stringify(platform)},isPluginAvailable:()=>true};export const registerPlugin=plugin;export const App=plugin('App'),Browser=plugin('Browser'),Camera=plugin('Camera'),Haptics=plugin('Haptics'),StatusBar=plugin('StatusBar'),SplashScreen=plugin('SplashScreen'),SystemBars=plugin('SystemBars');export const CameraResultType={Uri:'uri'},CameraSource={Prompt:'PROMPT'},ImpactStyle={Light:'LIGHT'},NotificationType={Success:'SUCCESS'},Style={Light:'LIGHT'},SystemBarsStyle={Light:'LIGHT'};`;
  const runtimeRoot=platform==='android'?androidRoot:root;
  const result=await build({entryPoints:[path.join(runtimeRoot,'native',platform==='android'?'android-runtime.mjs':'runtime.mjs')],write:false,bundle:true,format:'iife',platform:'browser',target:'es2020',absWorkingDir:runtimeRoot,plugins:[{name:'native-transport-only',setup(builder){builder.onResolve({filter:/^@capacitor\//},args=>({path:args.path,namespace:'transport'}));builder.onLoad({filter:/.*/,namespace:'transport'},()=>({contents:transport,loader:'js'}));}}]});runtimes.set(platform,result.outputFiles[0].text);
 }
 browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});
const options={skip:!chromium||!build?'Chromium or esbuild unavailable':false,timeout:45000};
async function fixture(platform,{held='bb-auth-sdk.js',returning=false,lock=false,missingSDK=false}={}){
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'no-preference'}),page=await context.newPage(),errors=[],script=deferred(),provider=deferred(),user=deferred(),verify=deferred();
 const html=transform700Presentation(transform700Html(transformNativeHtml(await source('app.html')),release));
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://basketboss.co.uk','Access-Control-Allow-Headers':'*','X-Supabase-Api-Version':'2024-01-01'},body:JSON.stringify(body)});
  if(url.hostname.endsWith('.supabase.co')){
   if(url.pathname==='/auth/v1/settings'){await provider.promise;return json({external:{email:true,apple:true,google:true}});}
   if(url.pathname==='/auth/v1/token')return json(session());
   if(url.pathname==='/auth/v1/user'){await user.promise;return json(USER);}
   if(url.pathname==='/auth/v1/verify'){await verify.promise;return json({code:'otp_expired',msg:'This email link is invalid or has expired.'},403);}
   if(url.pathname==='/auth/v1/recover')return json({});
   return json([]);
  }
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname==='/api/auth/apple-config')return json({available:true,nativeOnly:true,deletionReady:true});
  if(url.pathname.startsWith('/api/account/deletion'))return json({status:'pending',retryable:true},503);
  if(url.pathname==='/api/subscription/status')return json({authenticated:returning||request.headers().authorization?.includes('synthetic-native-account'),tier:'free',premiumAccess:false,mode:'live',subscription:null});
  if(url.pathname==='/api/household')return json({configured:false,premium:false,items:[]});
  if(url.pathname.startsWith('/api/'))return json({ok:true,available:false,configured:false});
  let rel=decodeURIComponent(url.pathname).replace(/^\//,'');if(['app','app.html','index.html',''].includes(rel))rel='app.html';
  if(rel.includes('..'))return route.fulfill({status:404,body:''});
  // This real parser-blocking script appears AFTER the legacy #account opener.
  // A stalled deferred script alone does not prove those raw parse frames.
  if(rel==='bb-us-market.js')await new Promise(resolve=>setTimeout(resolve,180));
  if(rel===held)await script.promise;
  if(rel==='bb-auth-sdk.js'&&missingSDK)return route.fulfill({status:200,contentType:'application/javascript',body:''});
  try{
   let body;
   if(rel==='app.html')body=html;
   else if(rel==='bb-native-runtime.js')body=runtimes.get(platform);
   else if(rel==='bb-native.css')body=await source('native/bb-native.css');
   else{try{body=await source(rel);}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',rel));}if(rel==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);else if(rel==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);if(rel.endsWith('.js'))body=transform700Presentation(body.toString());}
   const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
   return route.fulfill({status:200,contentType:mime[path.extname(rel)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 await context.addInitScript(({returning,lock,savedSession})=>{
  if(!sessionStorage.getItem('native-account-fixture-seeded')){
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true,house:'3–4 people',region:'Guernsey',goals:[],diets:[]}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'veggie-fried-rice',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem('basketboss_321_v7_market','Guernsey');localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_native_startup_seen_v1','1');sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');
  if(returning)localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify(savedSession));
  if(lock)localStorage.setItem('basketboss_account_deletion_v1',JSON.stringify({actorId:savedSession.user.id,phase:'pending'}));
  sessionStorage.setItem('native-account-fixture-seeded','1');}
  const probe=window.__nativeAccountPaint={frames:[],stop:false},visible=n=>!!n&&n.getClientRects().length>0&&n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  const sample=()=>{const panel=document.getElementById('cloud-panel'),form=document.getElementById('cloud-auth'),title=document.querySelector('#cloud-card h2');if(panel?.classList.contains('open'))probe.frames.push({ready:document.readyState,starting:document.documentElement.classList.contains('bb-native-starting'),deleting:window.BBAccountDeletion?.isDeleting?.()===true,panel:visible(panel),view:form?.dataset.bbAuthView,title:title?.textContent,heading:visible(title),intro:visible(document.getElementById('bbapAccountIntro')),status:visible(document.getElementById('cloud-status')),email:visible(document.getElementById('cloud-email')),login:visible(document.getElementById('cloud-login')),signup:visible(document.getElementById('cloud-signup')),signed:visible(document.getElementById('cloud-signed')),close:visible(document.getElementById('cloud-close')),message:visible(document.getElementById('cloud-message')),messageText:document.getElementById('cloud-message')?.textContent});if(!probe.stop&&probe.frames.length<2000)requestAnimationFrame(sample);};requestAnimationFrame(sample);
 },{returning,lock,savedSession:session()});
 const navigation=page.goto('https://basketboss.co.uk/index.html#account',{waitUntil:'domcontentloaded'});navigation.catch(()=>{});
 await page.waitForFunction(()=>document.getElementById('cloud-panel')?.classList.contains('open'));
 return{context,page,navigation,errors,releaseScript:script.resolve,releaseProvider:provider.resolve,releaseUser:user.resolve,releaseVerify:verify.resolve};
}
async function assertFrames(h,label){
 await next(h.page);const frames=await h.page.evaluate(()=>window.__nativeAccountPaint.frames);
 const dir=path.join(os.tmpdir(),'basketboss-ui-previews','native-account-'+label+(baseline?'-baseline':''));await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'paint-samples.json'),JSON.stringify(frames,null,2));
 assert.ok(frames.length>0);assert.ok(frames.some(f=>f.ready==='loading'),'observe actual raw account parse, before DOMContentLoaded');
 assert.deepEqual(frames.filter(f=>f.starting&&f.panel),[],'raw body-level account cannot escape native deletion/local-entry handoff');
 assert.deepEqual(frames.filter(f=>!f.view&&(f.heading||f.intro||f.status||f.email||f.login||f.signup||f.signed)),[],'uninitialised account cannot expose an earlier greeting, form or member state');
 const expected={'sign-in':'Welcome back.','sign-up':'Welcome back.','forgot-password':'Reset your password.','reset-sent':'Check your email.','check-email':'Check your email.','set-password':'Set a new password.',verifying:'Checking your link…','link-error':'This link couldn’t be used.'};
 for(const f of frames.filter(f=>f.panel&&f.view)){if(f.heading)assert.equal(f.title,f.signed?'Your account.':expected[f.view],JSON.stringify(f));assert.equal(f.signed&&f.email,false,JSON.stringify(f));}
 assert.deepEqual(h.errors,[]);
}
for(const platform of platforms)for(const held of['bb-auth-sdk.js','bb-auth-flow.js'])for(const returning of[false,true])test(`${platform} full native #account parse: ${returning?'returning':'new'} account with held ${held}`,options,async()=>{
 const h=await fixture(platform,{held,returning});
 try{
  await next(h.page);await assertFrames(h,platform+'-'+held+'-'+returning+'-held');h.releaseScript();await h.navigation;await h.page.waitForFunction(()=>!!window.BBAuthFlow);await next(h.page);
  if(!returning){assert.equal(await h.page.locator('#cloud-email').isVisible(),true);assert.equal(await h.page.locator('#cloud-login').isEnabled(),true,'email remains usable while provider readiness is pending');}
  const emailBounds=!returning?await h.page.locator('#cloud-email').boundingBox():null;
  h.releaseProvider();await h.page.waitForFunction(()=>window.BBAuthFlow.googleAvailable());
  if(emailBounds){const after=await h.page.locator('#cloud-email').boundingBox();assert.ok(Math.abs(after.y-emailBounds.y)<.1&&Math.abs(after.height-emailBounds.height)<.1,'provider readiness cannot move the existing email field');}
  if(held==='bb-auth-sdk.js'&&!returning){
   await h.page.locator('#cloud-email').fill(USER.email);await h.page.locator('#cloud-password').fill('synthetic-only-password');await h.page.locator('#cloud-login').click();await h.page.waitForFunction(()=>window.BBAuthFlow.state().busy);
   assert.equal(await h.page.locator('#cloud-signed').isVisible(),false);assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_cloud_session_v1')),null,'token exchange alone cannot remember an unverified session');h.releaseUser();await h.page.waitForFunction(()=>window.BasketBossSession.state().remembered===true);
  }else if(held==='bb-auth-flow.js'&&returning){
   await h.page.locator('#cloud-logout').click();await h.page.waitForFunction(()=>!!window.BBAuthFlow);if(!await h.page.locator('#cloud-panel').evaluate(node=>node.classList.contains('open')))await h.page.locator('#cloud-open').click();await h.page.locator('#cloud-email').waitFor({state:'visible'});await h.page.locator('#bbAuthGoogle').click();await h.page.waitForFunction(()=>window.__nativeCalls.some(c=>c.plugin==='Browser'&&c.method==='open'));await h.page.evaluate(()=>window.__nativeListeners['Browser:browserFinished']());await h.page.waitForFunction(()=>window.BBAuthFlow.state().busy===false);assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_cloud_session_v1')),null);
  }else if(held==='bb-auth-flow.js'&&!returning){
   await h.page.evaluate(()=>void window.__nativeListeners['App:appUrlOpen']({url:'basketboss://auth/callback?token_hash=synthetic-expired-reset&type=recovery'}));await h.page.waitForFunction(()=>document.getElementById('cloud-auth').dataset.bbAuthView==='verifying');await next(h.page);h.releaseVerify();await h.page.waitForFunction(()=>document.getElementById('cloud-auth').dataset.bbAuthView==='link-error');assert.equal(await h.page.locator('#bbAuthBack').isVisible(),true);
  }
  await assertFrames(h,platform+'-'+held+'-'+returning+'-settled');
 }finally{h.releaseScript();h.releaseProvider();h.releaseUser();h.releaseVerify();await h.context.close();}
});
for(const platform of platforms)test(`${platform} pending deletion remains guarded during actual raw #account parse`,options,async()=>{
 const h=await fixture(platform,{returning:true,lock:true});try{await next(h.page);await assertFrames(h,platform+'-deletion-held');h.releaseScript();h.releaseProvider();await h.navigation;await next(h.page);assert.equal(await h.page.evaluate(()=>window.BBAccountDeletion.isDeleting()),true);await assertFrames(h,platform+'-deletion-settled');}finally{h.releaseScript();h.releaseProvider();h.releaseUser();h.releaseVerify();await h.context.close();}
});

for(const platform of platforms)test(`${platform} full native failed auth SDK leaves the actual error and close action visible`,options,async()=>{
 const h=await fixture(platform,{missingSDK:true});try{await next(h.page);h.releaseScript();h.releaseProvider();await h.navigation;await h.page.waitForFunction(()=>window.BBNativeStartup?.phase==='ready');await next(h.page);assert.match(await h.page.locator('#cloud-message').innerText(),/Account tools could not load/);assert.equal(await h.page.locator('#cloud-message').isVisible(),true);assert.equal(await h.page.locator('#cloud-close').isVisible(),true);assert.equal(await h.page.locator('#cloud-email').isVisible(),false);await assertFrames(h,platform+'-missing-sdk');await h.page.locator('#cloud-close').click();assert.equal(await h.page.locator('#cloud-panel').isVisible(),false);}finally{h.releaseScript();h.releaseProvider();h.releaseUser();h.releaseVerify();await h.context.close();}
});
