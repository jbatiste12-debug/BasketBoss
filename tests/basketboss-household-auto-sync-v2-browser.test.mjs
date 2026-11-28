import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {transform700Html,transform700Planning,transform700PreviewConfig,validatePublic700Release} from '../tools/catalogue700/build-client.mjs';
import {transform700Presentation} from '../tools/catalogue700/presentation.mjs';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const A='00000000-0000-4000-8000-000000000071',B='00000000-0000-4000-8000-000000000072';
const HH='33333333-3333-4333-8333-333333333333',OLD='sausage-gnocchi';
const STATE='basketboss_321_unified_state_v1',STOCK='basketboss_321_v7_measured_pantry',KITCHEN='basketboss_makeameal_v1_inventory';
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
let chromium,browser,release;
for(const name of [process.env.BB_PLAYWRIGHT_MODULE,'playwright','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
before(async()=>{
 release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
 if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});

// The real app, editor, receipt adapter and outbox own all writes. This bridge
// only navigates the existing renderer and reads its private in-memory state.
const bridge=`window.__householdV2App={
 ready:()=>RECIPES.length===200&&window.BBHome&&!!window.BBHomeHost&&window.BBReceiptHost?.accountPantrySyncEnabled?.()===true,
 planned:()=>JSON.parse(JSON.stringify(state.planned)),stock:()=>bb307ReadStock(),
 home(){bb172StorefrontClose();bb172ShopSetActive(false);tab='shop';render();},
 plan(){bb172StorefrontClose();bb172ShopSetActive(false);tab='week';render();},
 openMondayPicker(){bb172OpenReplacePicker(state.planned.find(row=>row.day==='Monday').recipeId);}
};`;

function orderedServer({initialStock={}}={}){
 const entries=new Map([
  ['planned_day:Monday',{section:'planned_day',entry_key:'Monday',value:{recipeId:OLD},revision:1}],
  ['servings:Monday',{section:'servings',entry_key:'Monday',value:{count:4},revision:1}],
  ['household_servings:default',{section:'household_servings',entry_key:'default',value:{count:4},revision:1}]
 ]),operations=new Map(),targets=new Map(),requests=[],gates=new Map();
 let clock=0,inventoryRevision=1,stock=clone(initialStock),locations={};
 const inventory=()=>({ok:true,schemaVersion:1,autoStockReady:true,scope:{kind:'household',id:HH},initialized:true,inventoryRevision,stock:clone(stock),
  inventory:Object.entries(stock).map(([stockKey,quantity])=>{const at=stockKey.lastIndexOf('|');return {stockKey,canonicalKey:stockKey.slice(0,at),unit:stockKey.slice(at+1),quantity,location:locations[stockKey]||'cupboard',revision:inventoryRevision};}),
  essentials:[],receipts:[],priceObservations:[],pantryReview:{required:false,shopSessionId:null,confirmedAt:null}});
 const snapshot=operation=>({ok:true,protocol:2,household_id:HH,clock,pruneFloor:0,...(operation?{operation:{id:operation.id,order:operation.order,status:operation.status}}:{}),
  state:{entries:clone([...entries.values()]),stock:clone(stock),locations:clone(locations),inventoryRevision,initialized:true,inventory:inventory()}});
 const leaf=(section,key,value)=>{const id=section+':'+key;entries.set(id,{section,entry_key:key,value:clone(value),revision:(entries.get(id)?.revision||0)+1,updated_at:'2026-11-28T12:00:00Z'});};
 return {requests,operations,inventory,snapshot,stock:()=>clone(stock),dinner:day=>clone(entries.get('planned_day:'+day)?.value),
  reserveCount:()=>requests.filter(row=>row.body?.action==='sync_reserve').length,
  pauseApply(actor,target){const gate={started:deferred(),release:deferred()};gates.set(actor+'|'+target,gate);return gate;},
  async request(actor,url,body){
   assert.ok([A,B].includes(actor),'every sync request authenticates the isolated device actor');requests.push({actor,path:url.pathname,mode:url.searchParams.get('mode'),body:clone(body),at:Date.now()});
   if(url.pathname==='/api/receipt-inventory'){
    assert.equal(body,null,'automatic sharing never posts the old whole-stock receipt endpoint');
    return url.searchParams.get('mode')==='status'?{ok:true,available:true,premium:true,configured:true}:inventory();
   }
   assert.equal(url.pathname,'/api/household');
   if(!body){
    const mode=url.searchParams.get('mode');if(mode==='auto_sync')return snapshot();
    if(mode==='shopping')return {ok:true,configured:true,migration_ready:true,household_id:HH,role:actor===A?'owner':'partner',items:[]};
    if(mode==='pantry_packs')return {household_id:HH,entries:[]};
    if(mode==='entries')return {household_id:HH,entries:clone([...entries.values()])};
    return {configured:true,premium:true,role:actor===A?'owner':'partner',household_id:HH,invite_status:'accepted',invite:null};
   }
   assert.ok(['sync_reserve','sync_apply'].includes(body.action),'only protocol-2 operations may upload');assert.equal(body.expectedHouseholdId,HH);
   if(body.action==='sync_reserve'){
    let operation=operations.get(body.operationId);
    const intent={actor,baseClock:body.baseClock,target:body.target,value:body.value};
    if(operation)assert.deepEqual(operation.intent,intent,'a reserve retry retains immutable identity and value');
    else{operation={id:body.operationId,order:++clock,status:'reserved',intent:clone(intent)};operations.set(operation.id,operation);targets.set(body.target.kind+':'+body.target.key,operation.order);}
    return snapshot(operation);
   }
   const operation=operations.get(body.operationId);assert.ok(operation);assert.equal(operation.intent.actor,actor);assert.equal(operation.order,body.order);
   const targetId=operation.intent.target.kind+':'+operation.intent.target.key,gate=gates.get(actor+'|'+targetId);
   if(gate){gate.started.resolve();await gate.release.promise;gates.delete(actor+'|'+targetId);}
   if(operation.status==='reserved'){
    const {target,value}=operation.intent;
    if(targets.get(targetId)>operation.order)operation.status='superseded';
    else{
     if(target.kind==='dinner'){leaf('planned_day',target.key,value.recipeId===null?{deleted:true}:{recipeId:value.recipeId});leaf('servings',target.key,value.servings===null?{deleted:true}:{count:value.servings});}
     else if(target.kind==='pantry'){if(value.quantity===0){delete stock[target.key];delete locations[target.key];}else{stock[target.key]=value.quantity;locations[target.key]=value.location;}inventoryRevision++;}
     else{const at=target.key.indexOf(':');leaf(target.key.slice(0,at),target.key.slice(at+1),value);}
     operation.status='applied';
    }
   }
   return snapshot(operation);
  }
 };
}
function requestActor(request){try{return JSON.parse(Buffer.from(request.headers().authorization?.replace(/^Bearer\s+/i,'').split('.')[1]||'','base64url').toString()).sub;}catch{return null;}}

async function fixture(server,actor){
 const anchor='window.BBHomeHost=Object.freeze({',source=await fs.readFile(path.join(root,'app.html'),'utf8');assert.ok(source.includes(anchor));
 const app=transform700Presentation(transform700Html(source,release)).replace(anchor,bridge+anchor);
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[],routeErrors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 // No route continues: application assets, auth, cloud backups and every API
 // response are fulfilled locally. The fixture never touches a live service.
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  try{
   if(url.hostname.endsWith('.supabase.co'))return await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.includes('/auth/v1/user')?{id:actor,email:'household-v2-'+actor.slice(-2)+'@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:[])});
   if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(url.hostname))return await route.fulfill({status:200,body:''});
   if(url.pathname.startsWith('/api/')){
    let data={ok:true};
    if(['/api/household','/api/receipt-inventory'].includes(url.pathname)){
     const who=requestActor(request);assert.equal(who,actor);data=await server.request(who,url,request.method()==='POST'?request.postDataJSON():null);
    }else if(url.pathname==='/api/subscription/status')data={authenticated:true,tier:'owner',premium:true,premiumAccess:true,mode:'live',subscription:null};
    else if(url.pathname==='/api/shopping/weekly-trip')data={ok:true,allowed:true,premium:true};
    else if(url.pathname==='/api/recipes/v700/premium')return await route.fulfill({status:403,contentType:'application/json',body:'{"error":"Local fixture"}'});
    return await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   }
   let relative=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^pwa700\//,'');if(['app','app.html','index','index.html',''].includes(relative))relative='app.html';
   if(relative.includes('..'))return await route.fulfill({status:404,body:''});
   let body;
   try{body=relative==='app.html'?app:await fs.readFile(path.join(root,relative));}catch{
    try{body=await fs.readFile(path.join(root,'catalogues/700/release/assets',relative));}catch{return await route.fulfill({status:404,body:''});}
   }
   if(relative==='bb-recipe-planning.js')body=transform700Planning(body.toString(),release.roles);
   else if(relative==='bb-premium-preview-config.js')body=transform700PreviewConfig(body.toString(),release);
   if(relative.endsWith('.js'))body=transform700Presentation(body.toString());
   if(relative==='bb-household-sharing.js'){
    const observed=body.replace('function boot(){','window.__householdV2={foregroundCheck,read:()=>autoEngine?.read(),idle:()=>!polling&&!busy&&!actionInFlight};function boot(){');assert.notEqual(observed,body);body=observed;
   }
   const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
   return await route.fulfill({status:200,contentType:types[path.extname(relative)]||'application/octet-stream',body});
  }catch(error){routeErrors.push(error.message);await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:error.message})}).catch(()=>{});}
 });
 const remote=server.inventory();
 await context.addInitScript(({actor,remote,HH,OLD,STATE,STOCK,KITCHEN})=>{
  if(localStorage.getItem('household-v2-browser-fixture'))return;
  const expires=Math.floor(Date.now()/1000)+7200,encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('basketboss_cloud_session_v1',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor,exp:expires,iat:expires-3600,aud:'authenticated',role:'authenticated'})+'.synthetic',expires_at:expires,user:{id:actor,email:'household-v2-'+actor.slice(-2)+'@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}}));
  localStorage.setItem(STATE,JSON.stringify({version:2,planned:[{recipeId:OLD,day:'Monday',servings:4}],plannedBreakfasts:[],plannedDesserts:[],servings:4,feedingSet:true,pantry:{},mealServings:{},dayServings:{},mealPreferences:{version:1,scope:actor,diets:[],goals:[]}}));
  localStorage.setItem('basketboss_321_features_v1',JSON.stringify({version:1,essentials:[]}));localStorage.setItem(STOCK,JSON.stringify(remote.stock));
  const inventory={};for(const [id,qty]of Object.entries(remote.stock)){const at=id.lastIndexOf('|'),name=id.slice(0,at),unit=id.slice(at+1);inventory['cupboard|'+name]={name,loc:'cupboard',selected:true,qty,unit,bb173StockKey:id,bb173StockValue:qty};}localStorage.setItem(KITCHEN,JSON.stringify(inventory));
  const cacheKey='basketboss_receipt_inventory_v1:'+encodeURIComponent(actor)+':household:'+encodeURIComponent(HH),cached={version:1,actorId:actor,scope:remote.scope,initialized:true,inventoryRevision:remote.inventoryRevision,serverStock:remote.stock,pantryReview:remote.pantryReview,inventory:remote.inventory,essentials:[],receipts:[],priceObservations:[]};
  localStorage.setItem(cacheKey,JSON.stringify(cached));localStorage.setItem('basketboss_receipt_projection_owner_v1',JSON.stringify({version:1,actorId:actor,scope:remote.scope,cacheKey,initialized:true,inventoryRevision:remote.inventoryRevision,serverStock:remote.stock}));
  localStorage.setItem('bb_partner_baseline_v1_'+HH+'_'+actor,JSON.stringify({['planned_day\u001fMonday']:{revision:1,value:{recipeId:OLD}},['servings\u001fMonday']:{revision:1,value:{count:4}},['household_servings\u001fdefault']:{revision:1,value:{count:4}}}));
  localStorage.setItem('bb_onboarding_fresh_once_20261028_v1',JSON.stringify({step:10,complete:true,started:false,partnerStepV2:true}));localStorage.setItem('basketboss_how_it_works_v1',JSON.stringify({version:1,seen:true}));sessionStorage.setItem('basketboss_welcome_splash_seen_v1','1');localStorage.setItem('basketboss_321_v7_market','Guernsey');localStorage.setItem('household-v2-browser-fixture','1');
 },{actor,remote,HH,OLD,STATE,STOCK,KITCHEN});
 try{
  await page.goto('https://basketboss.co.uk/app',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__householdV2App?.ready());
  await page.waitForFunction(()=>window.BBReceiptHost?.getProjection?.()?.initialized===true&&window.BBReceiptHost.getConsumptionStatus().ready===true);
  await page.waitForFunction(()=>window.BBHouseholdSharingAuto?.isReady()===true&&window.__householdV2?.idle());
  return {page,context,errors,routeErrors};
 }catch(error){error.message+='\nFixture diagnostics: '+JSON.stringify({errors,routeErrors,requests:server.requests.slice(-8),status:await page.evaluate(()=>({text:document.body.innerText.slice(-1000),engine:window.__householdV2?.read()})).catch(()=>null)});await context.close();throw error;}
}
async function foreground(page){await page.waitForFunction(()=>window.__householdV2?.idle());await page.evaluate(()=>window.__householdV2.foregroundCheck({force:true}));await page.waitForFunction(()=>window.__householdV2?.idle());}
async function home(page){await page.evaluate(()=>window.__householdV2App.home());await page.waitForFunction(()=>window.BBPantryEditor?.card?.isConnected&&window.BBPantryEditor.isCurrent()&&!!window.BBPantryLive);}
async function setPantry(page,food,{navigate=true}={}){
 if(navigate)await home(page);
 const result=await page.evaluate(async food=>{const editor=window.BBPantryEditor,row=editor.list().find(row=>row.name.toLowerCase()===food.name.toLowerCase());const result=row?editor.update(row.key,food):editor.add(food);await window.BBPantryLive.flush();return result;},food);
 assert.equal(result.ok,true,JSON.stringify(result));
}
async function replaceMonday(page,id){
 await page.evaluate(()=>window.__householdV2App.plan());
 // The current compact Plan hides the legacy replace shortcut. Open its
 // existing picker without mutating state, then choose through the real UI.
 await page.evaluate(()=>window.__householdV2App.openMondayPicker());
 const recipe=release.free.find(row=>row.id===id);assert.ok(recipe);
 await page.locator('#bb172ReplaceSearch').fill(recipe.name);
 await page.locator('.bb172-replace-option').filter({hasText:recipe.name}).getByRole('button',{name:'Choose',exact:true}).click();
 await page.locator('.bb172-replace-veil').waitFor({state:'detached'});
}
async function assertState(page,{dinner,stock}){
 await page.waitForFunction(({STATE,STOCK,dinner,stock})=>{
  const saved=JSON.parse(localStorage.getItem(STATE)),pantry=JSON.parse(localStorage.getItem(STOCK)||'{}');
  return saved?.planned?.find(row=>row.day==='Monday')?.recipeId===dinner&&JSON.stringify(Object.entries(pantry).sort())===JSON.stringify(Object.entries(stock).sort());
 },{STATE,STOCK,dinner,stock});
 assert.equal((await page.evaluate(()=>window.__householdV2App.planned())).find(row=>row.day==='Monday')?.recipeId,dinner,'the actual app host reloads the received dinner in memory');
 assert.deepEqual(await page.evaluate(()=>window.__householdV2App.stock()),stock);
 await page.evaluate(()=>window.__householdV2App.plan());assert.ok((await page.locator('#app').innerText()).includes(release.free.find(row=>row.id===dinner).name));
 await home(page);await page.locator('button[role="tab"][data-bbpi-storage="all"]').click();
 for(const [id,quantity]of Object.entries(stock)){
  const name=id.slice(0,id.lastIndexOf('|'));assert.ok((await page.locator('.bbpi-summary-row').allTextContents()).some(text=>text.toLowerCase().includes(name)),name+' appears in the real pantry renderer');
  assert.ok(await page.evaluate(({id,quantity,KITCHEN})=>Object.values(JSON.parse(localStorage.getItem(KITCHEN)||'{}')).some(row=>row.bb173StockKey===id&&row.qty===quantity),{id,quantity,KITCHEN}),'the receipt adapter projects the exact shared amount into Kitchen');
 }
}
function assertNoUnsafeRequests(server,devices){
 assert.deepEqual(devices.flatMap(device=>device.routeErrors),[]);assert.deepEqual(devices.flatMap(device=>device.errors),[]);
 assert.deepEqual(server.requests.filter(row=>row.path==='/api/receipt-inventory'&&row.body),[]);
 assert.ok(server.requests.filter(row=>row.body).every(row=>['sync_reserve','sync_apply'].includes(row.body.action)));
}
async function diagnostics(server,devices){return {serverStock:server.stock(),operations:[...server.operations.values()],requests:server.requests.slice(-10),devices:await Promise.all(devices.map(async device=>({errors:device.errors,routeErrors:device.routeErrors,state:await device.page.evaluate(({STATE,STOCK,KITCHEN})=>({saved:JSON.parse(localStorage.getItem(STATE)),stock:JSON.parse(localStorage.getItem(STOCK)),kitchen:JSON.parse(localStorage.getItem(KITCHEN)),engine:window.__householdV2?.read(),visible:document.querySelector('#app')?.innerText.slice(-1000),monday:[...document.querySelectorAll('[data-bbnext-day="Monday"] button')].map(node=>({text:node.textContent,visible:node.getClientRects().length>0,ancestors:[node,node.parentElement,node.parentElement?.parentElement,node.closest('.bbnext-day')].filter(Boolean).map(p=>({tag:p.tagName,classes:p.className,display:getComputedStyle(p).display,open:p.open}))}))}),{STATE,STOCK,KITCHEN}).catch(()=>null)})))};}
const skip=!chromium?'Playwright unavailable':false;

test('protocol 2 sends deliberate Monday Salmon and Pasta 500 g to another Chromium device without whole-stock writes or echoes',{skip,timeout:90000},async()=>{
 const server=orderedServer({initialStock:{'long-grain rice|g':200}}),owner=await fixture(server,A),partner=await fixture(server,B);
 try{
  await replaceMonday(owner.page,'salmon');await setPantry(owner.page,{name:'Pasta',loc:'cupboard',qty:500,unit:'g'});
  await foreground(owner.page);await foreground(partner.page);
  await assertState(partner.page,{dinner:'salmon',stock:{'long-grain rice|g':200,'pasta|g':500}});
  assert.deepEqual(server.dinner('Monday'),{recipeId:'salmon'});assert.deepEqual(server.stock(),{'long-grain rice|g':200,'pasta|g':500});
  const reserves=server.reserveCount();assert.equal(reserves,2,'one deliberate dinner and one item edit create exactly two operations');
  await foreground(owner.page);await foreground(partner.page);assert.equal(server.reserveCount(),reserves,'received snapshots never become fresh edit intents');
  assertNoUnsafeRequests(server,[owner,partner]);
 }catch(error){console.error('Browser diagnostics: '+JSON.stringify(await diagnostics(server,[owner,partner])));await owner.page.screenshot({path:'/tmp/bb-household-v2-owner-failure.png'});throw error;}finally{await owner.context.close();await partner.context.close();}
});

test('a later same-item intention wins over a delayed older apply while an unrelated pantry item is retained on both devices',{skip,timeout:90000},async()=>{
 const server=orderedServer({initialStock:{'long-grain rice|g':200}}),owner=await fixture(server,A),partner=await fixture(server,B),gate=server.pauseApply(A,'pantry:pasta|g');
 try{
  await home(partner.page);
  await setPantry(owner.page,{name:'Pasta',loc:'cupboard',qty:500,unit:'g'});await gate.started.promise;
  await setPantry(partner.page,{name:'Pasta',loc:'cupboard',qty:750,unit:'g'},{navigate:false});await setPantry(partner.page,{name:'Milk',loc:'fridge',qty:250,unit:'ml'},{navigate:false});await foreground(partner.page);
  gate.release.resolve();await foreground(owner.page);await foreground(partner.page);
  for(const device of [owner,partner])await assertState(device.page,{dinner:OLD,stock:{'long-grain rice|g':200,'pasta|g':750,'semi-skimmed milk|ml':250}});
  assert.deepEqual([...server.operations.values()].map(row=>row.status),['superseded','applied','applied']);assert.equal(server.reserveCount(),3,'the older intent does not reserve a new order');
  const reserves=server.reserveCount();await foreground(owner.page);await foreground(partner.page);assert.equal(server.reserveCount(),reserves);assertNoUnsafeRequests(server,[owner,partner]);
 }catch(error){console.error('Browser diagnostics: '+JSON.stringify(await diagnostics(server,[owner,partner])));throw error;}finally{gate.release.resolve();await owner.context.close();await partner.context.close();}
});
