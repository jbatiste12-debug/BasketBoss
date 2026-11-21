import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const A='00000000-0000-4000-8000-000000000071',B='00000000-0000-4000-8000-000000000072',C='00000000-0000-4000-8000-000000000073';
const HH='33333333-3333-4333-8333-333333333333',OLD='sausage-gnocchi',NEXT='veggie-fried-rice';
const INITIAL={};
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
const clone=value=>JSON.parse(JSON.stringify(value));
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// Actual application shell, account controls and household host bridge. Every
// request is fulfilled locally; no customer, provider or live mutation is used.
const bridge=`window.__householdAutoSyncQA={
 ready:()=>RECIPES.length===200&&window.BBHome&&!!window.BBHomeHost&&window.BBReceiptHost?.accountPantrySyncEnabled?.()===true,
 planned:()=>JSON.parse(JSON.stringify(state.planned)),
 canRefresh(){const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');return window.BBHomeHost.canRefreshSharedHousehold({actor:s?.user?.id,token:s?.access_token,expected:localStorage.getItem(KEY)});}
};`;
const rows=recipe=>[{section:'planned_day',entry_key:'Monday',value:{recipeId:recipe},revision:1},{section:'servings',entry_key:'Monday',value:{count:4},revision:1},{section:'household_servings',entry_key:'default',value:{count:4},revision:1}];
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

function mockServer({shared=false}={}){
 const household={kind:'household',id:HH},assignments=new Map([A,B,C].map(actor=>[actor,shared&&[A,B].includes(actor)?household:{kind:'user',id:actor}])),scopeFor=actor=>assignments.get(actor);
 const records=new Map(),offline=new Set(),posts=[],reads=[],householdStatus=new Map();
 const scopeKey=scope=>scope.kind+':'+scope.id;
 for(const actor of [A,B,C]){const scope=scopeFor(actor),key=scopeKey(scope);if(!records.has(key))records.set(key,{scope,revision:3,stock:actor===C?{'egg|each':2}:clone(INITIAL)});}
 const record=actor=>records.get(scopeKey(scopeFor(actor)));
 const projection=actor=>{const row=record(actor);return {ok:true,scope:clone(row.scope),initialized:row.initialized!==false,inventoryRevision:row.revision,stock:clone(row.stock),pantryReview:{required:false},inventory:[],essentials:[],receipts:[],priceObservations:[]};};
 function setScope(actor,scope,{initialized=false,revision=0,stock={}}={}){const key=scopeKey(scope);if(!records.has(key))records.set(key,{scope:clone(scope),initialized,revision,stock:clone(stock)});assignments.set(actor,clone(scope));}
 return {offline,posts,reads,record,projection,scopeFor,householdStatus,setScope};
}
function requestActor(request){
 try{return JSON.parse(Buffer.from(request.headers().authorization?.replace(/^Bearer\s+/i,'').split('.')[1]||'','base64url').toString()).sub;}catch{return null;}
}
function householdServer(){
 const server=mockServer({shared:true});server.sharedRows=rows(OLD);server.entryReads=0;server.patches=[];server.entriesGate=null;server.beforePatch=null;
 for(const actor of [A,B])server.householdStatus.set(actor,{configured:true,premium:true,role:'partner',household_id:HH,invite_status:'accepted',invite:null});
 server.update=recipe=>{server.sharedRows=server.sharedRows.map(row=>row.section==='planned_day'?{...row,value:{recipeId:recipe},revision:row.revision+1}:row);};
 return server;
}
async function fixture(server,actor=A,{plannedDay='Monday',stateMode='seeded'}={}){
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // Every request is fulfilled or aborted locally. No route continues to any
 // external host, including authentication, cloud saves and pantry mutations.
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname.endsWith('.supabase.co'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:actor,email:'pantry-live-'+actor.slice(-2)+'@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return route.fulfill({status:200,body:''});
  if(url.pathname.startsWith('/api/')){
   let data={ok:true};
   if(url.pathname==='/api/subscription/status')data={authenticated:true,tier:'owner',premium:true,premiumAccess:true,mode:'live',subscription:null};
   else if(url.pathname==='/api/household'){
    const mode=url.searchParams.get('mode');
    if(request.method()==='POST'){
     const patch=request.postDataJSON();server.patches.push(clone(patch));
     assert.equal(patch.action,'patch','automatic sync never accepts, invites, unlinks or changes billing');
     server.beforePatch?.(patch);const prior=server.sharedRows.find(row=>row.section===patch.section&&row.entry_key===patch.key);
     if((prior?.revision||0)!==patch.expected)return route.fulfill({status:409,contentType:'application/json',body:'{"error":"Synthetic household revision conflict"}'});
     const revision=(prior?.revision||0)+1;server.sharedRows=server.sharedRows.filter(row=>row!==prior);server.sharedRows.push({section:patch.section,entry_key:patch.key,value:clone(patch.value),revision});data={ok:true,revision};
    }else if(mode==='entries'){
     server.entryReads++;const snapshot=clone(server.sharedRows),gate=server.entriesGate;server.entriesGate=null;
     if(gate){gate.started.resolve();await gate.release.promise;}
     data={household_id:HH,entries:snapshot};
    }else if(mode==='shopping')data={ok:true,configured:true,migration_ready:true,household_id:HH,role:'partner',items:[]};
    else if(mode==='pantry_packs')data={household_id:HH,entries:[]};
    else data=server.householdStatus.get(actor)||{configured:false,premium:true,items:[]};
   }
   else if(url.pathname==='/api/receipt-inventory'){
    const who=requestActor(request);assert.equal(who,actor,'the real adapter authenticates every request as this isolated browser account');
    if(server.offline.has(who))return route.abort('internetdisconnected');
    if(url.searchParams.get('mode')==='status')data={ok:true,configured:true,available:true,premium:true};
    else if(request.method()==='POST'){
     const body=request.postDataJSON(),row=server.record(who);server.posts.push({actor:who,scope:clone(row.scope),body:clone(body),committed:false});
     const post=server.posts.at(-1);
     if(body.action!=='confirm_pantry'||body.expectedRevision!==row.revision||JSON.stringify(body.expectedScope)!==JSON.stringify(row.scope))return route.fulfill({status:409,contentType:'application/json',body:'{"error":"inventory_revision_conflict"}'});
     row.stock=clone(body.stock);row.revision++;row.initialized=true;post.committed=true;data=server.projection(who);
    }else{server.reads.push({actor:who,at:Date.now(),revision:server.record(who).revision,scope:clone(server.scopeFor(who))});data=server.projection(who);}
   }
   else if(url.pathname==='/api/shopping/weekly-trip')data={ok:true,allowed:true,premium:true};
   else if(url.pathname==='/api/recipes/v700/premium')return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Local fixture"}'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  let relative=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');if(['app','app.html','index','index.html',''].includes(relative))relative='app.html';
  if(relative.includes('..'))return route.fulfill({status:404,body:''});
  try{
   let body;if(relative==='app.html')body=app;else{
    try{body=await fs.readFile(path.join(root,relative));}catch{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',relative));}
    if(relative==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
    else if(relative==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
    if(relative.endsWith('.js'))body=transform700Presentation(body.toString());
    if(relative==='bb-household-sharing.js'){
     const observed=body.replace('function boot(){','window.__householdAutoForeground=foregroundCheck;window.__householdAutoIdle=()=>!polling&&!busy&&!actionInFlight;function boot(){');
     assert.notEqual(observed,body);body=observed;
    }
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(relative)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 const remote=server.projection(actor);
 await context.addInitScript(({actor,remote,STOCK,INVENTORY,plannedDay,stateMode})=>{
  if(localStorage.getItem('account-pantry-live-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'pantry-live-'+actor.slice(-2)+'@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'sausage-gnocchi',day:plannedDay,servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  if(stateMode==='absent')localStorage.removeItem('basketboss_321_unified_state_v1');
  if(stateMode==='empty')localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[],servings:4}));
  if(stateMode==='recovered'){
   localStorage.setItem('basketboss_321_unified_recovery_v1',localStorage.getItem('basketboss_321_unified_state_v1'));
   localStorage.removeItem('basketboss_321_unified_state_v1');
  }
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem(STOCK,JSON.stringify(remote.stock));
  const inventory={};for(const [id,qty]of Object.entries(remote.stock)){const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1);inventory['fridge|'+name]={name,loc:'fridge',selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty};}
  localStorage.setItem(INVENTORY,JSON.stringify(inventory));
  const cacheKey='basketboss_receipt_inventory_v1:'+encodeURIComponent(actor)+':'+remote.scope.kind+':'+encodeURIComponent(remote.scope.id),cached={version:1,actorId:actor,scope:remote.scope,initialized:true,inventoryRevision:remote.inventoryRevision,serverStock:remote.stock,pantryReview:remote.pantryReview,inventory:[],essentials:[],receipts:[],priceObservations:[]};
  localStorage.setItem(cacheKey,JSON.stringify(cached));localStorage.setItem('basketboss_receipt_projection_owner_v1',JSON.stringify({version:1,actorId:actor,scope:remote.scope,cacheKey,initialized:true,inventoryRevision:remote.inventoryRevision,serverStock:remote.stock}));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('account-pantry-live-fixture-v1','1');
 },{actor,remote,STOCK,INVENTORY,plannedDay,stateMode});
 await context.addInitScript(({actor,HH,OLD,stateMode})=>{
  if(stateMode!=='seeded')return;
  localStorage.setItem('bb_partner_baseline_v1_'+HH+'_'+actor,JSON.stringify({
   ['planned_day\u001fMonday']:{revision:1,value:{recipeId:OLD}},['servings\u001fMonday']:{revision:1,value:{count:4}},['household_servings\u001fdefault']:{revision:1,value:{count:4}}
  }));
 },{actor,HH,OLD,stateMode});
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__householdAutoSyncQA?.ready());
  await page.waitForFunction(()=>window.BBReceiptHost?.getProjection?.()?.initialized===true&&window.BBReceiptHost.getConsumptionStatus().ready===true);
  await page.waitForFunction(()=>window.__householdAutoIdle?.());
  return {page,context,errors,actor};
 }catch(error){await context.close();throw error;}
}

// Invoke the same automatic handler installed on focus/visibility and the
// four-second timer. Never click Sync or call the manual synchronize helper.
async function foreground(page){
 await page.waitForFunction(()=>window.__householdAutoIdle?.());
 await page.evaluate(()=>window.__householdAutoForeground({force:true}));
}
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')));
const pantry=page=>page.evaluate(({STOCK,INVENTORY})=>[localStorage.getItem(STOCK),localStorage.getItem(INVENTORY)],{STOCK,INVENTORY});
async function received(page,id){
 await page.waitForFunction(id=>JSON.parse(localStorage.getItem('basketboss_321_unified_state_v1')).planned.some(row=>row.day==='Monday'&&row.recipeId===id),id);
 assert.equal((await page.evaluate(()=>window.__householdAutoSyncQA.planned())).find(row=>row.day==='Monday').recipeId,id,'the real host reloaded the saved dinner in memory');
 const recipe=release.free.find(row=>row.id===id);assert.ok(recipe,'fixture dinner is in the public catalogue');
 assert.ok((await page.locator('#app').innerText()).includes(recipe.name),'the actual Plan renderer displays the received recipe');
}
const skip=!chromium?'Playwright unavailable':false;

test('fresh linked browsers receive all seven dinners without pressing Sync and changes then travel both ways',{skip,timeout:60000},async()=>{
 const server=householdServer(),days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 server.householdStatus.set(A,{...server.householdStatus.get(A),role:'owner'});
 server.sharedRows=days.flatMap((day,i)=>[{section:'planned_day',entry_key:day,value:{recipeId:i%2?NEXT:OLD},revision:3},{section:'servings',entry_key:day,value:{count:4},revision:3}]);
 server.sharedRows.push({section:'household_servings',entry_key:'default',value:{count:4},revision:3});
 const owner=await fixture(server,A,{stateMode:'absent'}),partner=await fixture(server,B,{stateMode:'absent'});
 try{
  for(const h of [owner,partner]){
   await foreground(h.page);await h.page.waitForFunction(()=>window.__householdAutoSyncQA.planned().length===7);
   assert.equal((await saved(h.page)).planned.length,7);
   assert.match(await h.page.locator('#app').innerText(),/7\s*\/\s*7/,'the actual Plan displays all seven saved dinners');
   assert.equal(await h.page.evaluate(()=>window.__householdAutoSyncQA.canRefresh()),true);
   assert.deepEqual(h.errors,[]);
  }
  assert.equal(server.patches.length,0,'a fresh empty browser never uploads over the saved household');
  const initialOwnerPantry=await pantry(owner.page),initialPartnerPantry=await pantry(partner.page);
  await owner.page.locator('[data-bbfeed-day="Monday"] [data-bbfeed-delta="1"]').first().click();
  await foreground(owner.page);await foreground(partner.page);
  assert.equal((await partner.page.evaluate(()=>window.__householdAutoSyncQA.planned())).find(row=>row.day==='Monday').recipeId,OLD);
  assert.equal((await saved(partner.page)).dayServings.Monday.count,5);
  await partner.page.locator('[data-bbfeed-day="Monday"] [data-bbfeed-delta="-1"]').first().click();
  await foreground(partner.page);await foreground(owner.page);
  assert.equal((await saved(owner.page)).dayServings.Monday.count,4);
  assert.deepEqual(server.patches.map(p=>[p.section,p.key]),[['servings','Monday'],['servings','Monday']]);
  const move=async(page,recipeId)=>page.evaluate(recipeId=>{const snapshot=window.BBPlanMoveHost.snapshot();return window.BBPlanMoveHost.move({from:'Monday',to:'Tuesday',expected:snapshot.fingerprint,recipeId});},recipeId);
  assert.equal((await move(owner.page,OLD)).ok,true);
  await foreground(owner.page);await foreground(partner.page);
  assert.equal((await saved(partner.page)).planned.find(row=>row.day==='Monday').recipeId,NEXT);
  assert.equal((await saved(partner.page)).planned.find(row=>row.day==='Tuesday').recipeId,OLD);
  assert.equal((await move(partner.page,NEXT)).ok,true);
  await foreground(partner.page);await foreground(owner.page);
  assert.equal((await saved(owner.page)).planned.find(row=>row.day==='Monday').recipeId,OLD);
  assert.equal((await saved(owner.page)).planned.find(row=>row.day==='Tuesday').recipeId,NEXT);
  assert.deepEqual(server.patches.slice(2).map(p=>[p.section,p.key]),[['planned_day','Monday'],['planned_day','Tuesday'],['planned_day','Monday'],['planned_day','Tuesday']]);
  assert.deepEqual(await pantry(owner.page),initialOwnerPantry);assert.deepEqual(await pantry(partner.page),initialPartnerPantry);
 }finally{await owner.context.close();await partner.context.close();}
});

test('a recovered plan on a browser without its primary saved record is kept for review instead of initialized',{skip,timeout:60000},async()=>{
 const server=householdServer(),h=await fixture(server,A,{stateMode:'recovered'});
 try{
  const recovery=await h.page.evaluate(()=>localStorage.getItem('basketboss_321_unified_recovery_v1'));
  await foreground(h.page);
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1')),null);
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_321_unified_recovery_v1')),recovery);
  assert.equal((await h.page.evaluate(()=>window.__householdAutoSyncQA.planned()))[0].recipeId,OLD);
  assert.deepEqual(server.patches,[]);assert.equal(server.entryReads,0);
 }finally{await h.context.close();}
});

test('Settings and Account sharing entrypoints close their parent layers and receive automatic dinner changes with Sharing open or closed',{skip,timeout:60000},async()=>{
 const server=householdServer(),h=await fixture(server);
 try{
  const originalPantry=await pantry(h.page),next=release.free.find(row=>row.id===NEXT)||release.free.find(row=>row.id!==OLD);
  // Sharing attaches to the existing Settings section on the next ordinary
  // app render; use the real Plan navigation rather than fabricating a button.
  await h.page.locator('#bbPrimaryNavigation [data-bb-nav-item="plan"]').click();
  await h.page.locator('#bbuiAccountSection [data-bbhs-trigger]').waitFor({state:'attached'});
  await h.page.locator('#bbuiOpenSettings').click();await h.page.locator('.bbui-settings-overlay:not([hidden])').waitFor();
  await h.page.locator('#bbuiAccountSection [data-bbhs-trigger]').click();await h.page.locator('#bbhs-dialog [data-sync]').waitFor();
  assert.equal(await h.page.locator('.bbui-settings-overlay').evaluate(node=>node.hidden),true,'Sharing replaces its Settings entry layer');
  assert.equal(await h.page.evaluate(()=>window.__householdAutoSyncQA.canRefresh()),true);
  server.update(next.id);await foreground(h.page);await received(h.page,next.id);
  assert.equal(await h.page.locator('#bbhs-dialog').evaluate(node=>node.open),true,'an idle sharing panel does not stop entry polling');
  await h.page.locator('#bbhs-dialog .bbhs-close').click();
  await h.page.evaluate(()=>document.getElementById('cloud-open').click());await h.page.locator('#cloud-panel.open').waitFor();
  await h.page.locator('#cloud-signed [data-bbhs-trigger]').click();await h.page.locator('#bbhs-dialog [data-sync]').waitFor();
  assert.equal(await h.page.locator('#cloud-panel').evaluate(node=>node.classList.contains('open')),false,'Sharing closes its Account entry layer');
  assert.equal(await h.page.evaluate(()=>window.__householdAutoSyncQA.canRefresh()),true);
  server.update(OLD);await foreground(h.page);await received(h.page,OLD);
  await h.page.locator('#bbhs-dialog .bbhs-close').click();server.update(next.id);await foreground(h.page);await received(h.page,next.id);
  assert.deepEqual(server.patches,[],'receiving owner dinners never uploads this partner plan');assert.deepEqual(await pantry(h.page),originalPantry);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

test('automatic dinner refresh preserves a typed draft, cooking and an unrelated Account modal until they finish',{skip,timeout:60000},async()=>{
 const server=householdServer(),h=await fixture(server);
 try{
  const next=release.free.find(row=>row.id===NEXT)||release.free.find(row=>row.id!==OLD),before=await pantry(h.page);
  await h.page.locator('#app').evaluate(app=>{const input=document.createElement('input');input.id='shared-household-draft-fixture';input.setAttribute('aria-label','Unfinished dinner note');app.prepend(input);});
  await h.page.locator('#shared-household-draft-fixture').fill('unsaved pasta');server.update(next.id);await foreground(h.page);
  assert.equal((await saved(h.page)).planned[0].recipeId,OLD);assert.equal(await h.page.locator('#shared-household-draft-fixture').inputValue(),'unsaved pasta');
  await h.page.locator('#shared-household-draft-fixture').blur();await foreground(h.page);assert.equal((await saved(h.page)).planned[0].recipeId,OLD,'a blurred unsaved draft is still protected');
  await h.page.locator('#shared-household-draft-fixture').evaluate(node=>node.remove());
  assert.equal(await h.page.evaluate(id=>window.BBHomeHost.openCook(id),OLD),true);await h.page.locator('.cook-overlay').waitFor();await foreground(h.page);
  assert.equal((await saved(h.page)).planned[0].recipeId,OLD,'cooking blocks a remote plan replacement');
  await h.page.locator('#bbExit').click();await h.page.locator('.cook-overlay').waitFor({state:'detached'});
  await h.page.evaluate(()=>document.getElementById('cloud-open').click());await h.page.locator('#cloud-panel.open').waitFor();await foreground(h.page);
  assert.equal((await saved(h.page)).planned[0].recipeId,OLD,'Account remains a real unrelated modal outside the explicit Sharing transition');
  await h.page.locator('#cloud-close').click();await foreground(h.page);await received(h.page,next.id);
  assert.deepEqual(server.patches,[]);assert.deepEqual(await pantry(h.page),before);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});

for(const change of ['local edit','account switch'])test('an in-flight automatic dinner read cannot replace a concurrent '+change,{skip,timeout:60000},async()=>{
 const server=householdServer(),h=await fixture(server);
 const gate={started:deferred(),release:deferred()};
 try{
  const before=await pantry(h.page),next=release.free.find(row=>row.id===NEXT)||release.free.find(row=>row.id!==OLD);
  server.update(next.id);server.entriesGate=gate;
  const pending=foreground(h.page);await gate.started.promise;
  const expected=await h.page.evaluate(({change,B})=>{
   const key='basketboss_321_unified_state_v1';
   if(change==='local edit'){const value=JSON.parse(localStorage.getItem(key));value.planned[0].recipeId='private-concurrent-dinner';localStorage.setItem(key,JSON.stringify(value));}
   else{const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1'));s.user.id=B;s.access_token='synthetic-other-account';localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify(s));}
   return localStorage.getItem(key);
  },{change,B});
  gate.release.resolve();await pending;
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('basketboss_321_unified_state_v1')),expected);
  assert.deepEqual(server.patches,[]);assert.deepEqual(await pantry(h.page),before);assert.deepEqual(h.errors,[]);
 }finally{gate.release.resolve();await h.context.close();}
});

test('automatic outgoing edits retain CAS and keep a private dinner when a newer shared revision wins',{skip,timeout:60000},async()=>{
 const server=householdServer(),h=await fixture(server);
 try{
  const before=await pantry(h.page),privateId=release.free.find(row=>row.id===NEXT)?.id||release.free.find(row=>row.id!==OLD).id;
  await h.page.evaluate(privateId=>{const key='basketboss_321_unified_state_v1',value=JSON.parse(localStorage.getItem(key));value.planned[0].recipeId=privateId;localStorage.setItem(key,JSON.stringify(value));},privateId);
  server.beforePatch=patch=>{if(patch.section==='planned_day'){server.beforePatch=null;server.update('newer-shared-choice');}};
  await foreground(h.page);
  assert.equal((await saved(h.page)).planned[0].recipeId,privateId,'a rejected CAS cannot replace the local choice');
  assert.equal(server.sharedRows.find(row=>row.section==='planned_day').value.recipeId,'newer-shared-choice','a rejected CAS cannot replace the newer server choice');
  assert.equal(server.patches.length,1);assert.equal(server.patches[0].expected,1);assert.deepEqual(await pantry(h.page),before);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();}
});
