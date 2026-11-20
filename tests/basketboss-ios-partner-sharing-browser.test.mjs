import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ROOT=fileURLToPath(new URL('..',import.meta.url));
let chromium,browser;
try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'playwright'));}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const skip=!chromium?'Set BB_PLAYWRIGHT_MODULE to run the real-DOM native membership integration':false;
const HOUSEHOLD='22222222-2222-4222-8222-222222222222';
const eligible={configured:true,premium:true,role:'free',household_id:null,invite_status:'none',invite:null};
const free={...eligible,premium:false};

// Use the actual shipped sharing button, handlers, native membership controller
// and native routing classifier. Only the network and native location are fixtures;
// no customer account, household mutation, purchase or native build is involved.
async function fixture({household=eligible,premium=true}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
 const requests=[],errors=[],unexpected=[];page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(()=>{
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:'synthetic-sharing-browser-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'11111111-1111-4111-8111-111111111111'}}));
  localStorage.setItem('basketboss_321_v7_measured_pantry','{"rice|g":250}');
 });
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Partner Sharing regression</title><link rel="stylesheet" href="/bb-household-sharing.css"><style>body{margin:0;padding:20px;background:#faf8f2;font:16px system-ui;color:#1b4332}section{padding:12px 0}button{min-height:44px}aside{margin-top:24px;padding:16px;border:1px solid #cad7c7;border-radius:12px}</style></head><body><main id="app"><h1>Settings</h1><section id="bbuiAccountSection"><h2>Account &amp; welcome</h2></section></main><button id="cloud-open">Sign in</button><aside id="bbNativeMembershipMount"></aside><script defer src="/bb-household-sharing.js"></script><script type="module">
 import {installNativeMembership} from '/native/membership.mjs';
 window.__nativeNavigation=[];
 const location={href:'capacitor://localhost/index.html',hash:'',assign:value=>window.__nativeNavigation.push(value)};
 const nativeWindow=new Proxy(window,{get(target,key){if(key==='location')return location;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 window.__nativeMembership=installNativeMembership({window:nativeWindow,document,readSession:()=>JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null'),apiURL:path=>'https://basketboss.co.uk'+path,fetch:window.fetch.bind(window)});
 window.__nativeReady=true;
 </script></body></html>`;
 const files=new Set(['bb-household-sharing.js','bb-household-sharing.css','native/membership.mjs','native/routing.mjs']);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!=='basketboss.co.uk'){unexpected.push(request.url());return route.fulfill({status:404,body:''});}
  if(url.pathname.startsWith('/api/')){
   requests.push({path:url.pathname,search:url.search,method:request.method(),authorization:request.headers().authorization});
   assert.equal(request.method(),'GET','opening sharing must not mutate a household or start billing');
   assert.equal(request.headers().authorization,'Bearer synthetic-sharing-browser-token');
   if(url.pathname==='/api/household')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(household)});
   if(url.pathname==='/api/subscription/status')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:true,premiumAccess:premium,tier:premium?'owner':'free'})});
   unexpected.push(request.url());return route.fulfill({status:404,body:''});
  }
  if(url.pathname==='/sharing-fixture')return route.fulfill({status:200,contentType:'text/html',body:html});
  const name=url.pathname.slice(1);if(!files.has(name))return route.fulfill({status:404,body:''});
  return route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':'application/javascript',body:await fs.readFile(path.join(ROOT,name))});
 });
 await page.goto('https://basketboss.co.uk/sharing-fixture',{waitUntil:'load'});
 await page.waitForFunction(()=>window.__nativeReady===true);
 await page.locator('.bb-native-membership [role="status"]').filter({hasText:premium?'Your existing Premium membership is available.':'Your account currently has Free access.'}).waitFor();
 const original=await page.evaluate(()=>localStorage.getItem('basketboss_321_v7_measured_pantry'));
 const before=requests.filter(request=>request.path==='/api/subscription/status').length;
 await page.locator('#bbuiAccountSection [data-bbhs-trigger]').click();
 const dialog=page.locator('#bbhs-dialog');await dialog.waitFor();
 const clean=async()=>{
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  assert.deepEqual(await page.evaluate(()=>window.__nativeNavigation),[]);
  assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_321_v7_measured_pantry')),original);
 };
 return {context,page,dialog,requests,before,clean};
}

test('the native Settings sharing button opens an eligible Premium invitation form without a billing route',{skip},async()=>{
 const h=await fixture();try{
  await h.dialog.locator('[data-invite]').waitFor();assert.equal(await h.dialog.locator('[data-email]').isVisible(),true);
  assert.equal(await h.dialog.locator('a[href]').count(),0);
  assert.equal(h.requests.filter(request=>request.path==='/api/subscription/status').length,h.before,'eligible household access needs no second membership lookup');
  await h.clean();
 }finally{await h.context.close();}
});

test('an invited Free partner sees Accept before personal membership or upgrade checks',{skip},async()=>{
 const h=await fixture({household:{...free,invite:{household_id:HOUSEHOLD,expires_at:'2099-01-01T00:00:00Z'}},premium:false});try{
  await h.dialog.locator('[data-accept]').waitFor();assert.equal(await h.dialog.locator('[data-invite],a[href]').count(),0);
  assert.equal(h.requests.filter(request=>request.path==='/api/subscription/status').length,h.before);
  await h.clean();
 }finally{await h.context.close();}
});

for(const [name,household]of [['account-specific sharing unavailable',free],['server sharing configuration unavailable',{configured:false,premium:false,role:'unavailable',household_id:null,invite:null}]])test('native recognised Premium avoids another subscription when '+name,{skip},async()=>{
 const h=await fixture({household,premium:true});try{
  await h.dialog.getByText(/You do not need another subscription/).waitFor();
  assert.equal(await h.dialog.locator('a[href],[data-invite],[data-accept],[data-sync]').count(),0);
  assert.equal(await h.dialog.locator('[data-retry]').isVisible(),true);
  assert.equal(h.requests.filter(request=>request.path==='/api/subscription/status').length,h.before+1);
  await h.clean();
 }finally{await h.context.close();}
});

test('verified Free sharing access retains the real canonical iOS membership link',{skip},async()=>{
 const h=await fixture({household:free,premium:false});try{
  const upgrade=h.dialog.locator('a[href]');await upgrade.waitFor();
  await h.page.waitForFunction(()=>document.querySelector('#bbhs-dialog a[href]')?.getAttribute('href')==='capacitor://localhost/pricing-sandbox.html');
  assert.equal(await upgrade.getAttribute('href'),'capacitor://localhost/pricing-sandbox.html');
  assert.equal(await h.dialog.locator('[data-invite],[data-accept]').count(),0);
  await h.clean();
 }finally{await h.context.close();}
});
