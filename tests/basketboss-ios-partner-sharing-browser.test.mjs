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
async function fixture({household=eligible,premium=true,lifecycle=false,emailSent=true}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
 const requests=[],errors=[],unexpected=[];let serverHousehold=structuredClone(household),entries=[];page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(({lifecycle})=>{
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:'synthetic-sharing-browser-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'11111111-1111-4111-8111-111111111111'}}));
  localStorage.setItem('basketboss_321_v7_measured_pantry','{"rice|g":250}');
  if(lifecycle){localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{day:'Tuesday',recipeId:'private-dinner'}],pantry:{},servings:4}));window.__sharedRefreshes=[];window.BBHomeHost={canRefreshSharedHousehold:pin=>!document.activeElement?.matches('input,textarea,select')&&pin.expected===localStorage.getItem('basketboss_321_unified_state_v1'),refreshSharedHousehold(pin){if(!this.canRefreshSharedHousehold(pin))return false;window.__sharedRefreshes.push(JSON.parse(pin.expected));return true;}};}
 },{lifecycle});
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
   const body=request.method()==='POST'?request.postDataJSON():null;
   requests.push({path:url.pathname,search:url.search,method:request.method(),authorization:request.headers().authorization,body});
   if(!lifecycle)assert.equal(request.method(),'GET','opening sharing must not mutate a household or start billing');
   assert.equal(request.headers().authorization,'Bearer synthetic-sharing-browser-token');
   if(url.pathname==='/api/household'){
    const send=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
    if(body?.action==='invite'){serverHousehold={...eligible,role:'owner',household_id:HOUSEHOLD,invite_status:'pending',partner_email:body.email};return send({ok:true,household_id:HOUSEHOLD,email_sent:emailSent,email_status:emailSent?'accepted':'not_configured'});}
    if(body?.action==='accept'){serverHousehold={...eligible,role:'partner',household_id:HOUSEHOLD,invite_status:'accepted'};entries=[{section:'planned_day',entry_key:'Monday',value:{recipeId:'owner-dinner'},revision:1},{section:'household_servings',entry_key:'default',value:{count:3},revision:1}];return send({ok:true,household_id:HOUSEHOLD});}
    if(body?.action==='patch'){const found=entries.find(row=>row.section===body.section&&row.entry_key===body.key),revision=(found?.revision||0)+1;entries=entries.filter(row=>row!==found);entries.push({section:body.section,entry_key:body.key,value:body.value,revision});return send({ok:true,revision});}
    if(url.searchParams.get('mode')==='entries')return send({household_id:HOUSEHOLD,entries});
    return send(serverHousehold);
   }
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
 const clean=async({adopted=false}={})=>{
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  assert.deepEqual(await page.evaluate(()=>window.__nativeNavigation),[]);
  if(!adopted)assert.equal(await page.evaluate(()=>localStorage.getItem('basketboss_321_v7_measured_pantry')),original);
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

for(const emailSent of [true,false])test('the real native owner flow confirms sharing and shows honest email '+(emailSent?'acceptance':'fallback'),{skip},async()=>{
 const h=await fixture({lifecycle:true,emailSent});try{
  await h.dialog.locator('[data-email]').fill('partner@example.invalid');h.page.once('dialog',dialog=>dialog.accept());
  // iOS touch can retain the email field as active after a button tap. A real
  // DOM click preserves that focus here; only confirmed sharing may blur it.
  await h.page.evaluate(()=>document.querySelector('[data-invite]').click());
  await h.dialog.locator('[data-invite-link]').waitFor();await h.dialog.locator('[data-bbhs-message]').filter({hasText:emailSent?/accepted.*sending/:/could not be sent/}).waitFor();
  assert.equal(h.requests.filter(value=>value.body?.action==='invite').length,1);assert.ok(h.requests.some(value=>value.body?.action==='patch'));
  assert.equal(await h.dialog.locator('a[href]').count(),0);assert.deepEqual(await h.page.evaluate(()=>window.__nativeNavigation),[]);assert.deepEqual(await h.page.evaluate(()=>window.__sharedRefreshes),[]);
  assert.deepEqual(await h.page.evaluate(()=>JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')).planned),[{day:'Tuesday',recipeId:'private-dinner'}]);
  await h.clean();
 }finally{await h.context.close();}
});

test('the real native partner flow explicitly adopts shared dinners with a backup and no partner plan upload',{skip},async()=>{
 const h=await fixture({household:{...free,invite:{household_id:HOUSEHOLD}},premium:false,lifecycle:true});try{
  await h.dialog.locator('[data-accept]').click();await h.dialog.locator('[data-bbhs-message]').filter({hasText:/connected.*backup/}).waitFor();
  assert.equal(h.requests.filter(value=>value.body?.action==='accept').length,1);assert.equal(h.requests.filter(value=>value.body?.action==='patch').length,0);
  const saved=await h.page.evaluate(()=>({state:JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')),backup:Object.keys(localStorage).filter(key=>key.startsWith('bb_partner_premerge_')).map(key=>JSON.parse(localStorage.getItem(key))),renders:window.__sharedRefreshes.length}));
  assert.deepEqual(saved.state.planned,[{day:'Monday',recipeId:'owner-dinner'}]);assert.equal(saved.backup.length,1);assert.equal(saved.renders,1);
  assert.equal(saved.backup[0].basketboss_321_v7_measured_pantry,'{"rice|g":250}','explicit legacy pantry adoption retains the previous stock in its recovery copy');
  assert.equal(await h.dialog.locator('a[href]').count(),0);await h.clean({adopted:true});
 }finally{await h.context.close();}
});
