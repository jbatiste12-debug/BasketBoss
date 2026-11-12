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
const INITIAL={'chicken breast|g':533.333333,'lime|g':93.333333,'mixed peppers|g':80};
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
const clone=value=>JSON.parse(JSON.stringify(value));
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// Navigation and read-only diagnostics expose the actual private application
// functions. Edits, queue persistence, projections, matching and polling remain
// owned by the shipped editor, live-save, receipt adapter and account host.
const bridge=`window.__accountPantryQA={
 ready:()=>RECIPES.length===200&&window.BBWeeklyShop&&window.BBHome&&window.BBShopOwnership?.enabled?.()&&window.BBReceiptHost?.accountPantrySyncEnabled?.()===true&&!!window.BBAccountPantryLive,
 home(){bb172StorefrontClose();bb172ShopSetActive(false);tab='shop';render();},
 openShop(){bb172StorefrontClose();bb172ShopSetActive(false);tab='shop';render();return window.BBWeeklyShop.start();},
 stock:()=>bb307ReadStock(),summary:()=>bb321WeeklySummary(),
 owner:()=>JSON.parse(localStorage.getItem('basketboss_receipt_projection_owner_v1')||'null'),
 outbox:()=>JSON.parse(localStorage.getItem('basketboss_purchase_pantry_sync_v1:'+BBHome.actor())||'null'),
 discover(id){bb172StorefrontClose();bb172ShopSetActive(false);tab='discover';query='';collectionFilter='All';window.__bbStartRandomised=true;recipeIndex=RECIPES.filter(r=>bb176AllowedRecipe(r.id)).findIndex(r=>r.id===id);render();}
};`;

function mockServer({shared=false}={}){
 const household={kind:'household',id:'release-audit-household'},assignments=new Map([A,B,C].map(actor=>[actor,shared&&[A,B].includes(actor)?household:{kind:'user',id:actor}])),scopeFor=actor=>assignments.get(actor);
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
async function fixture(server,actor=A){
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
   else if(url.pathname==='/api/household')data=server.householdStatus.get(actor)||{configured:false,premium:true,items:[]};
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
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return route.fulfill({status:200,contentType:types[path.extname(relative)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:''});}
 });
 const remote=server.projection(actor);
 await context.addInitScript(({actor,remote,STOCK,INVENTORY})=>{
  if(localStorage.getItem('account-pantry-live-fixture-v1'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'pantry-live-'+actor.slice(-2)+'@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem('basketboss_321_unified_state_v1',JSON.stringify({version:2,planned:[{recipeId:'sausage-gnocchi',day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem(STOCK,JSON.stringify(remote.stock));
  const inventory={};for(const [id,qty]of Object.entries(remote.stock)){const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1);inventory['fridge|'+name]={name,loc:'fridge',selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty};}
  localStorage.setItem(INVENTORY,JSON.stringify(inventory));
  const cacheKey='basketboss_receipt_inventory_v1:'+encodeURIComponent(actor)+':'+remote.scope.kind+':'+encodeURIComponent(remote.scope.id),cached={version:1,actorId:actor,scope:remote.scope,initialized:true,inventoryRevision:remote.inventoryRevision,serverStock:remote.stock,pantryReview:remote.pantryReview,inventory:[],essentials:[],receipts:[],priceObservations:[]};
  localStorage.setItem(cacheKey,JSON.stringify(cached));localStorage.setItem('basketboss_receipt_projection_owner_v1',JSON.stringify({version:1,actorId:actor,scope:remote.scope,cacheKey,initialized:true,inventoryRevision:remote.inventoryRevision,serverStock:remote.stock}));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','Guernsey');
  localStorage.setItem('account-pantry-live-fixture-v1','1');
 },{actor,remote,STOCK,INVENTORY});
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__accountPantryQA?.ready());
  await page.waitForFunction(()=>window.BBReceiptHost?.getProjection?.()?.initialized===true&&window.BBReceiptHost.getConsumptionStatus().ready===true);
  return {page,context,errors,actor};
 }catch(error){await context.close();throw error;}
}
async function waitStock(page,expected){
 await page.waitForFunction(expected=>JSON.stringify(Object.entries(window.__accountPantryQA.stock()).sort(([a],[b])=>a.localeCompare(b)))===JSON.stringify(Object.entries(expected).sort(([a],[b])=>a.localeCompare(b))),expected,{timeout:15000});
 assert.deepEqual(await page.evaluate(()=>window.__accountPantryQA.stock()),expected);
}
async function home(page){
 await page.evaluate(()=>window.__accountPantryQA.home());
 await page.waitForFunction(()=>window.BBPantryEditor?.card?.isConnected&&window.BBPantryEditor.isCurrent()&&!!window.BBPantryLive);
}
async function replaceFood(page,foods){
 await home(page);
 const results=await page.evaluate(async foods=>{
  const editor=window.BBPantryEditor,results=editor.list().map(row=>editor.remove(row.key));for(const food of foods)results.push(editor.add(food));await window.BBPantryLive.flush();return results;
 },foods);assert.ok(results.every(result=>result.ok===true),JSON.stringify(results));
}
async function noPantrySourcePrompt(page){
 const visible=await page.locator('body').innerText();assert.doesNotMatch(visible,/Confirm Pantry|Check saved stock|Your saved online pantry and this device need checking|Use (?:the )?saved pantry/i);
 assert.equal(await page.getByRole('dialog').filter({hasText:/choose.*pantry|confirm.*pantry|check saved stock/i}).count(),0);
}
async function assertSausageNeed(page){
 assert.equal(await page.evaluate(()=>window.__accountPantryQA.openShop()),true);
 const shell=page.locator('#bb172Storefront'),row=shell.locator('[data-bb-shop-purchase-id="pork sausages|each"]');await row.locator('.bb-shop-buying-pill').waitFor();
 const item=await page.evaluate(()=>window.__accountPantryQA.summary().items.find(row=>/sausages?/.test(row.key)));
 assert.equal(item.required,6);assert.equal(item.pantryUsed,4);assert.equal(item.toBuy,2);
 assert.equal(await row.locator('.bbcompact-qty').innerText(),'2 needed');assert.match(await row.locator('.bb-shop-purchase-context').innerText(),/Have 4 at home/);
 assert.equal(await shell.locator('[data-bb-shop-purchase-id="chicken breast|g"]').count(),0,'deleted chicken is neither stock nor a phantom shopping requirement');
 await noPantrySourcePrompt(page);return row;
}

test('offline At home deletions and four sausages survive reconnect/reload without a second pantry confirmation',{skip:!chromium&&'Playwright unavailable',timeout:90000},async()=>{
 const server=mockServer(),h=await fixture(server);
 try{
  await waitStock(h.page,INITIAL);await home(h.page);await noPantrySourcePrompt(h.page);
  server.offline.add(A);await h.context.setOffline(true);
  await replaceFood(h.page,[{name:'Sausages',loc:'fridge',qty:4,unit:'each'}]);await waitStock(h.page,{'pork sausages|each':4});
  const queued=await h.page.evaluate(()=>window.__accountPantryQA.outbox());assert.deepEqual(queued.stock,{'pork sausages|each':4});assert.deepEqual(server.record(A).stock,INITIAL);
  const offlineNeed=await h.page.evaluate(()=>window.__accountPantryQA.summary().items.find(row=>/sausages?/.test(row.key)));assert.equal(offlineNeed.pantryUsed,4);assert.equal(offlineNeed.toBuy,2);
  // Reload with API connectivity still absent, while all app assets are
  // fulfilled locally. The outbox must survive before the reconnect retry.
  await h.context.setOffline(false);await h.page.reload({waitUntil:'domcontentloaded'});await h.page.waitForFunction(()=>window.__accountPantryQA?.ready());await waitStock(h.page,{'pork sausages|each':4});
  await noPantrySourcePrompt(h.page);server.offline.delete(A);await h.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await h.page.waitForFunction(()=>window.__accountPantryQA.outbox()===null,{},{timeout:15000});await waitStock(h.page,{'pork sausages|each':4});assert.deepEqual(server.record(A).stock,{'pork sausages|each':4});
  await assertSausageNeed(h.page);await home(h.page);await h.page.locator('[data-bbpi-storage=all]').click();
  const foods=h.page.locator('.bbpi-summary-row');assert.equal(await foods.count(),1);assert.match(await foods.innerText(),/Sausages\s+Edit\s*›?\s+4 each/i);assert.doesNotMatch(await h.page.locator('#app').innerText(),/Chicken Breast|Mixed Peppers|Lime/i);
  await h.page.evaluate(()=>window.BBAccountPolish.openPantrySync());const account=h.page.locator('#bbAccountPantrySync');await account.waitFor({state:'visible'});
  assert.equal(await account.getByRole('button').count(),1);assert.equal(await account.getByRole('button',{name:'Sync At home pantry',exact:true}).count(),1);assert.doesNotMatch(await account.innerText(),/saved or device|choose.*pantry|use.*saved|confirm pantry/i);
  await h.page.locator('#cloud-close').click();await noPantrySourcePrompt(h.page);
  await h.page.evaluate(()=>window.__accountPantryQA.discover('sausage-gnocchi'));await h.page.locator('.bbfeed-ingredients>summary').click();
  const ingredient=h.page.locator('.bbfeed-ingredients .ingredient-row').filter({hasText:'Pork sausages'});assert.match(await ingredient.innerText(),/6 each/);assert.doesNotMatch(await ingredient.innerText(),/6 packs/);
  assert.deepEqual(h.errors,[]);assert.equal(server.posts.filter(row=>row.actor===A&&row.committed).length,1,'one absolute offline edit cannot become multiple stock credits');
 }finally{await h.context.close();}
});

test('linked household accounts automatically share exact edits and preserve an idle Buying draft without cross-account leakage',{skip:!chromium&&'Playwright unavailable',timeout:120000},async()=>{
 const server=mockServer({shared:true}),contexts=[];
 try{
  const a=await fixture(server,A);contexts.push(a);const b=await fixture(server,B);contexts.push(b);const unrelated=await fixture(server,C);contexts.push(unrelated);
  await home(a.page);await home(b.page);await home(unrelated.page);await waitStock(a.page,INITIAL);await waitStock(b.page,INITIAL);await waitStock(unrelated.page,{'egg|each':2});
  assert.deepEqual(await a.page.evaluate(()=>window.__accountPantryQA.owner().scope),server.scopeFor(A));assert.deepEqual(await b.page.evaluate(()=>window.__accountPantryQA.owner().scope),server.scopeFor(B));
  await replaceFood(a.page,[{name:'Sausages',loc:'fridge',qty:4,unit:'each'}]);await waitStock(a.page,{'pork sausages|each':4});
  // No refresh API, online event or navigation is invoked for B: the shipped
  // foreground four-second poll must observe the other account's revision.
  await waitStock(b.page,{'pork sausages|each':4});await noPantrySourcePrompt(b.page);assert.deepEqual(server.record(A).stock,{'pork sausages|each':4});
  const row=await assertSausageNeed(a.page);await row.locator('.bb-shop-buying-pill').click();await row.locator('[data-bb-pack-preset=custom]').click();
  const custom=row.locator('[data-bb-pack-custom]');await custom.fill('9');const draftNode=await custom.elementHandle(),reads=server.reads.filter(entry=>entry.actor===A).length;
  await a.page.waitForTimeout(4500);
  assert.ok(server.reads.filter(entry=>entry.actor===A).length>reads,'an unchanged remote pantry was fetched during the open draft');
  assert.equal(await custom.isVisible(),true);assert.equal(await custom.inputValue(),'9');assert.equal(await draftNode.evaluate(node=>node.isConnected&&document.activeElement===node),true,'an unchanged poll preserves the actual focused input, including its keyboard focus');assert.equal(await row.locator('.bb172-storefront-checkbox').isChecked(),false);await waitStock(a.page,{'pork sausages|each':4});
  await row.locator('.bb-shop-pack-cancel').click();await noPantrySourcePrompt(a.page);
  await home(b.page);const changed=await b.page.evaluate(async()=>{
   const editor=window.BBPantryEditor,sausage=editor.list().find(row=>/sausages?/i.test(row.name)),results=[editor.update(sausage.key,{qty:7,unit:'each'}),editor.add({name:'Milk',loc:'fridge',qty:300,unit:'ml'})];await window.BBPantryLive.flush();return results;
  });assert.ok(changed.every(result=>result.ok===true),JSON.stringify(changed));
  await waitStock(b.page,{'pork sausages|each':7,'semi-skimmed milk|ml':300});await waitStock(a.page,{'pork sausages|each':7,'semi-skimmed milk|ml':300});
  assert.deepEqual(server.record(A).stock,{'pork sausages|each':7,'semi-skimmed milk|ml':300});assert.equal(server.record(A),server.record(B));
  await waitStock(unrelated.page,{'egg|each':2});assert.deepEqual(server.record(C).stock,{'egg|each':2});assert.equal(server.posts.filter(row=>row.actor===C).length,0);
  assert.equal(server.posts.filter(row=>[A,B].includes(row.actor)&&row.committed).length,2,'each absolute edit is saved once, without doubled shared stock');
  for(const h of contexts){await noPantrySourcePrompt(h.page);assert.deepEqual(h.errors,[]);}
 }finally{for(const h of contexts)await h.context.close();}
});

test('verified Premium inviter seeds an empty new household once and the invited partner adopts the lead pantry',{skip:!chromium&&'Playwright unavailable',timeout:90000},async()=>{
 const server=mockServer(),contexts=[],household={kind:'household',id:'11111111-1111-4111-8111-111111111143'},leadStock={'pork sausages|each':4},partnerStock={'semi-skimmed milk|ml':500};
 server.record(A).stock=clone(leadStock);server.record(B).stock=clone(partnerStock);
 try{
  const lead=await fixture(server,A);contexts.push(lead);const partner=await fixture(server,B);contexts.push(partner);
  await home(lead.page);await home(partner.page);await waitStock(lead.page,leadStock);await waitStock(partner.page,partnerStock);
  // Successful acceptance establishes the existing server-authorized scope.
  // A partner arriving before the inviter must wait rather than seed it from
  // their unrelated personal pantry, even though both accounts are Premium.
  server.setScope(B,household);server.householdStatus.set(B,{configured:true,premium:true,role:'partner',household_id:household.id,invite_status:'accepted'});
  const partnerRead=partner.page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/receipt-inventory'&&!url.searchParams.has('mode')&&response.request().method()==='GET';},{timeout:15000});
  await partner.page.evaluate(()=>window.dispatchEvent(new CustomEvent('basketboss:household-changed',{detail:{action:'accept'}})));await partnerRead;
  assert.equal(server.record(B).initialized,false);assert.equal(server.record(B).revision,0);assert.deepEqual(server.record(B).stock,{});await waitStock(partner.page,partnerStock);
  assert.equal(server.posts.filter(row=>row.actor===B&&row.committed).length,0,'the invited partner never seeds their personal foods');
  server.setScope(A,household);server.householdStatus.set(A,{configured:true,premium:true,role:'owner',household_id:household.id,invite_status:'pending'});
  await lead.page.evaluate(()=>window.dispatchEvent(new CustomEvent('basketboss:household-changed',{detail:{action:'invite'}})));
  await lead.page.waitForFunction(id=>window.__accountPantryQA.owner()?.scope?.id===id&&window.BBReceiptHost.getProjection()?.initialized===true,household.id,{timeout:15000});
  await waitStock(lead.page,leadStock);assert.equal(server.record(A).initialized,true);assert.deepEqual(server.record(A).stock,leadStock);
  // The waiting partner's ordinary foreground lifecycle must notice that the
  // lead has now initialized the scope; no manual sync/adoption call is made.
  await waitStock(partner.page,leadStock);await partner.page.waitForFunction(id=>window.__accountPantryQA.owner()?.scope?.id===id,household.id,{timeout:15000});
  await noPantrySourcePrompt(lead.page);await noPantrySourcePrompt(partner.page);
  const seeds=server.posts.filter(row=>row.actor===A&&row.committed&&row.body.expectedRevision===0);assert.equal(seeds.length,1);assert.deepEqual(seeds[0].body.stock,leadStock);assert.deepEqual(seeds[0].body.expectedScope,household);
  for(const row of server.posts.filter(row=>row.committed))assert.deepEqual(row.body.stock,leadStock,'scope adoption never adds or merges personal stock');
  // A later authoritative shared update must win over either device's stale
  // four-sausage balance when the invitation lifecycle is replayed.
  const existingShared={'pork sausages|each':2,'egg|each':6};server.record(A).stock=clone(existingShared);server.record(A).revision++;
  const initializedRevision=server.record(A).revision,postsBeforeReplay=server.posts.length;
  await lead.page.evaluate(()=>window.dispatchEvent(new CustomEvent('basketboss:household-changed',{detail:{action:'invite'}})));await partner.page.evaluate(()=>window.dispatchEvent(new CustomEvent('basketboss:household-changed',{detail:{action:'accept'}})));
  await waitStock(lead.page,existingShared);await waitStock(partner.page,existingShared);assert.deepEqual(server.record(A).stock,existingShared);
  assert.equal(server.posts.filter(row=>row.actor===A&&row.committed&&row.body.expectedRevision===0).length,1);assert.ok(server.record(A).revision>=initializedRevision);
  for(const row of server.posts.slice(postsBeforeReplay).filter(row=>row.committed))assert.deepEqual(row.body.stock,existingShared,'an initialized shared pantry can never be overwritten by the stale lead pantry');
  const milkBackup=await partner.page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('basketboss_pantry_scope_backup_v1:')).map(key=>JSON.parse(localStorage.getItem(key))));
  assert.ok(milkBackup.some(row=>JSON.stringify(row).includes('semi-skimmed milk|ml')&&row.actorId===B),'the partner’s previous personal pantry has a scoped local backup');
  for(const h of contexts){await noPantrySourcePrompt(h.page);assert.deepEqual(h.errors,[]);assert.deepEqual(await h.page.evaluate(()=>window.__accountPantryQA.stock()),existingShared);}
 }finally{for(const h of contexts)await h.context.close();}
});
