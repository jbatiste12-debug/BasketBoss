import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const Serving=createRequire(import.meta.url)('../bb-serving-scale.js');

// Execute the shipped closure. Network, host rendering and storage failures are
// synthetic; no customer records, environment flags or credentials are used.
const original=fs.readFileSync(new URL('../bb-household-sharing.js',import.meta.url),'utf8');
const source=original.replace('function boot(){','window.__lifecycle={open,refreshStatus,synchronize,adoptRemote,accountPin,foregroundCheck,invitationEntry,boot};function boot(){');
assert.notEqual(source,original);
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',HH='33333333-3333-4333-8333-333333333333';
const AUTH='basketboss_cloud_session_v1',STATE='basketboss_321_unified_state_v1',STOCK='basketboss_321_v7_measured_pantry',TICKS='basketboss_321_v11_shop_ticks',BUDGET='basketboss_v172_weekly_budget_target_v1';
const BASE='bb_partner_baseline_v1_'+HH+'_'+ACTOR;
const OWNER={configured:true,premium:true,role:'owner',household_id:HH,invite_status:'none'};
const INVITED={configured:true,premium:false,role:'free',household_id:null,invite:{household_id:HH}};
const PARTNER={configured:true,premium:true,role:'partner',household_id:HH,invite_status:'accepted'};
const row=(section,entry_key,value,revision=1)=>({section,entry_key,value,revision});
const shared=[row('planned_day','Monday',{recipeId:'owner-dinner'}),row('servings','Monday',{count:3}),row('household_servings','default',{count:3}),row('shopping_checked','rice',true)];
const wait=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

function element(tag='div'){
 const handlers=new Map(),attributes={};let html='',text='';
 const result={tagName:tag.toUpperCase(),nodes:[],disabled:false,value:'',open:false,
  setAttribute(k,v){attributes[k]=String(v);},getAttribute:k=>attributes[k]??null,
  addEventListener(name,handler){const list=handlers.get(name)||[];list.push(handler);handlers.set(name,list);},
  async emit(name,event={}){for(const handler of handlers.get(name)||[])await handler(event);},
  async click(){if(this.disabled)return;const event={target:this,preventDefault(){},stopPropagation(){}};await this.onclick?.(event);await this.emit('click',event);},
  append(...items){this.nodes.push(...items);for(const node of items)node.parent=this;},
  replaceChildren(...items){this.nodes=items;},remove(){if(this.parent)this.parent.nodes=this.parent.nodes.filter(node=>node!==this);},
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
  querySelectorAll(selector){return this.nodes.flatMap(node=>[node,...node.querySelectorAll('*')]).filter(node=>selector.split(',').some(part=>{
   if(part==='*')return true;
   const tag=part.match(/^([a-z]+)/)?.[1],attribute=part.match(/\[([^=\]]+)(?:="([^"]*)")?\]/),cls=part.match(/^\.([\w-]+)/)?.[1];
   return (!tag||node.tagName===tag.toUpperCase())&&(!cls||node.className===cls)&&(!attribute||node.getAttribute(attribute[1])!==null&&(attribute[2]===undefined||node.getAttribute(attribute[1])===attribute[2]));
  }));},
  showModal(){this.open=true;},close(){this.open=false;this.emit('close');},matches(){return false;},select(){this.selected=true;},
  set textContent(value){text=String(value);html='';this.nodes=[];},get textContent(){return text;},
  set innerHTML(value){html=value;text=value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');this.nodes=[];
   for(const match of value.matchAll(/<(button|input|a|p|div|label)\b([^>]*)>([^<]*)/g)){
    const node=element(match[1]);for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2]??'');
    node.className=node.getAttribute('class')||'';node.value=node.getAttribute('value')||'';node.textContent=match[3];this.append(node);
   }
  },get innerHTML(){return html;}
 };return result;
}

function fixture({household=PARTNER,entries=shared,confirm=true,enabledPantry=false,pantryResult,backupFailure=false,baselineFailure=false,readablePlan=true,emailSent=false,prepareRecipes}={}){
 const values=new Map([[AUTH,JSON.stringify({user:{id:ACTOR},access_token:'synthetic-token'})],[STOCK,'{"rice|g":250}'],[TICKS,'{"old-item":true}'],[BUDGET,'90']]);
 if(readablePlan)values.set(STATE,JSON.stringify({version:2,planned:[{day:'Monday',recipeId:'private-dinner'},{day:'Tuesday',recipeId:'private-tuesday'}],dayServings:{Monday:{recipeId:'private-dinner',count:4}},pantry:{'private-rice':true},servings:4,breakfasts:{Monday:'private-breakfast'},customMarker:'preserve-unshared'}));
 const body=element('body'),app=element('main'),account=element('section'),cloud=element('button'),docEvents=new Map(),win=new EventTarget(),calls=[],refreshes=[],events=[],timers=[],preparations=[],membershipChecks=[];
 let state=structuredClone(household),rows=structuredClone(entries),ready=true,allowConfirm=confirm,onRequest=null,pantryCalls=0,clock=10000;
 app.querySelector=()=>null;account.querySelector=()=>null;
 const document={readyState:'loading',hidden:false,activeElement:null,body,
  createElement:tag=>element(tag),getElementById:id=>id==='app'?app:id==='bbuiAccountSection'?account:id==='cloud-open'?cloud:null,
  addEventListener(name,handler){docEvents.set(name,handler);},querySelector(){return null;}};
 const store={getItem:key=>values.get(key)??null,setItem(key,value){if(backupFailure&&key.startsWith('bb_partner_premerge_')||baselineFailure&&key===BASE)throw Error('Synthetic storage full');values.set(key,String(value));},removeItem:key=>values.delete(key)};
 win.location={hash:'',href:'https://www.basketboss.co.uk/app'};
 win.BBHomeHost={canRefreshSharedHousehold(pin){return ready&&!document.hidden&&pin.actor===JSON.parse(values.get(AUTH)||'null')?.user?.id&&pin.token===JSON.parse(values.get(AUTH)||'null')?.access_token&&pin.expected===values.get(STATE);},refreshSharedHousehold(pin){if(!this.canRefreshSharedHousehold(pin))return false;refreshes.push({...pin});return true;}};
 if(prepareRecipes)win.BBHomeHost.prepareSharedHouseholdRecipes=async pin=>{preparations.push({...pin});return prepareRecipes(pin);};
 win.BasketBossVerifiedPremium={refresh:force=>{membershipChecks.push(force);return Promise.resolve(false);}};
 win.BBReceiptHost={accountPantrySyncEnabled:()=>enabledPantry,handlesInventorySync:()=>enabledPantry&&pantryCalls>0,async connectHouseholdPantry(){pantryCalls++;return pantryResult||{ok:true,adoptedScope:{kind:'household',id:HH},backupKey:'synthetic-pantry-backup'};}};
 win.addEventListener('basketboss:household-changed',event=>events.push(event.detail?.action));
 const sandbox={AbortController,setTimeout,clearTimeout,window:win,document,localStorage:store,navigator:{onLine:true,clipboard:{writeText:async()=>{}}},Event,JSON,console,Map,Set,Date:class extends Date{static now(){return clock;}},confirm:()=>allowConfirm,
  location:{reload(){throw Error('Foreground sharing must never reload the document');}},MutationObserver:class{observe(){}},setInterval:handler=>timers.push(handler),
  fetch:async(url,options={})=>{
   const request=options.body?JSON.parse(options.body):null;calls.push({url,request,options});
   if(onRequest){const result=await onRequest({url,request,options});if(result)return result;}
   if(url==='/api/subscription/status')return Response.json({authenticated:true,premiumAccess:false});
   if(String(url).includes('mode=entries'))return Response.json({household_id:HH,entries:rows});
   if(!request)return Response.json(state);
   if(request.action==='accept'){state={...PARTNER};return Response.json({ok:true,household_id:HH});}
   if(request.action==='invite'){state={...OWNER,invite_status:'pending',partner_email:request.email};return Response.json({ok:true,household_id:HH,email_sent:emailSent,email_status:emailSent?'accepted':'not_configured'});}
   if(request.action==='unlink'){state={...OWNER,invite_status:'none'};return Response.json({ok:true});}
   if(request.action==='patch'){const found=rows.find(row=>row.section===request.section&&row.entry_key===request.key),revision=(found?.revision||0)+1;
    if((found?.revision||0)!==request.expected)return Response.json({error:'Synthetic concurrent edit'},{status:409});
    rows=rows.filter(row=>row!==found);rows.push(row(request.section,request.key,request.value,revision));return Response.json({ok:true,revision});}
   throw Error('Unexpected synthetic request');
  }};
 vm.runInNewContext(source,sandbox);
 return {api:win.__lifecycle,win,document,values,body,calls,refreshes,events,timers,sandbox,account,preparations,membershipChecks,
  get dialog(){return body.nodes.find(node=>node.id==='bbhs-dialog');},get modalBody(){return this.dialog?.querySelector('[data-bbhs-body]');},get message(){return this.dialog?.querySelector('[data-bbhs-message]')?.textContent||'';},
  get pantryCalls(){return pantryCalls;},get state(){return state;},set state(next){state=next;},set entries(next){rows=structuredClone(next);},set ready(value){ready=value;},set requestHook(value){onRequest=value;},
  changeActor(){values.set(AUTH,JSON.stringify({user:{id:OTHER},access_token:'other-token'}));win.dispatchEvent(new Event('basketboss:session-changed'));},
  noticeCount(){return body.nodes.filter(node=>node.className==='bbhs-invite-notice').length;},
  advance(){clock+=4001;},saved(){return JSON.parse(values.get(STATE)||'null');},writes(){return calls.filter(call=>call.request);},
  async open(){await this.api.open();return this.modalBody;},async click(selector){await this.modalBody.querySelector(selector).click();},
  async adopted(){await this.api.refreshStatus();return this.api.adoptRemote(this.api.accountPin(),HH);}
 };
}

test('explicit partner adoption backs up then replaces supported local data without uploading it',async()=>{
 const h=fixture(),before=h.values.get(STATE),result=await h.adopted();assert.equal(result.ok,true);
 assert.deepEqual(h.saved().planned,[{day:'Monday',recipeId:'owner-dinner'}]);assert.equal(h.saved().dayServings.Monday.count,3);
 assert.deepEqual(h.saved().breakfasts,{Monday:'private-breakfast'});assert.equal(h.saved().customMarker,'preserve-unshared');
 assert.deepEqual(JSON.parse(h.values.get(TICKS)),{rice:true});assert.deepEqual(h.writes(),[]);
 const backup=[...h.values].find(([key])=>key.startsWith('bb_partner_premerge_'));assert.ok(backup);assert.equal(JSON.parse(backup[1])[STATE],before);
 assert.equal(h.refreshes.length,1);assert.ok(h.values.has(BASE));
});

test('a storage-full backup aborts adoption before any plan, list or baseline changes',async()=>{
 const h=fixture({backupFailure:true}),before=new Map(h.values);await assert.rejects(()=>h.adopted(),/storage full/);assert.deepEqual(h.values,before);assert.deepEqual(h.writes(),[]);assert.equal(h.refreshes.length,0);
});

test('a failed baseline commit rolls the plan and list back together before rendering',async()=>{
 const h=fixture({baselineFailure:true}),before=new Map(h.values);await assert.rejects(()=>h.adopted(),/original data restored/);
 for(const [key,value] of before)assert.equal(h.values.get(key),value);assert.equal(h.values.has(BASE),false);assert.equal(h.refreshes.length,0);assert.deepEqual(h.writes(),[]);
 assert.equal([...h.values.keys()].filter(key=>key.startsWith('bb_partner_premerge_')).length,1,'recovery copy survives the failed commit');
});

for(const change of ['account','deletion','local-edit','dirty-editor'])test(`pending remote adoption aborts safely after ${change}`,async()=>{
 const h=fixture(),gate=deferred();h.requestHook=async({url})=>String(url).includes('mode=entries')?(await gate.promise,Response.json({household_id:HH,entries:shared})):null;
 const pending=h.adopted();await wait();
 if(change==='account')h.changeActor();
 if(change==='deletion')h.win.dispatchEvent(new Event('basketboss:account-deletion-started'));
 if(change==='local-edit')h.values.set(STATE,JSON.stringify({...h.saved(),planned:[{day:'Friday',recipeId:'newer-local-edit'}]}));
 if(change==='dirty-editor')h.ready=false;
 const before=new Map(h.values);gate.resolve();await assert.rejects(()=>pending,/changed|kept|ready/i);assert.deepEqual(h.values,before);assert.deepEqual(h.writes(),[]);assert.equal(h.refreshes.length,0);
});

test('an empty uninitialised household does not erase a partner plan',async()=>{
 const h=fixture({entries:[]}),before=new Map(h.values),result=await h.adopted();assert.equal(result.ok,false);assert.match(result.message,/not shared/);assert.deepEqual(h.values,before);
});

test('unconfirmed Not now leaves invitation, local data and network unchanged',async()=>{
 const h=fixture({household:INVITED});await h.open();const before=new Map(h.values);await h.click('[data-not-now]');assert.deepEqual(h.values,before);assert.deepEqual(h.writes(),[]);assert.equal(h.dialog.open,false);assert.equal(h.pantryCalls,0);
});

test('accept is explicit, double taps commit once, then adopts the verified shared household',async()=>{
 const h=fixture({household:INVITED,enabledPantry:true}),gate=deferred();
 h.requestHook=async({request})=>{if(request?.action==='accept')await gate.promise;return null;};await h.open();
 const button=h.modalBody.querySelector('[data-accept]'),first=button.click();await button.click();assert.equal(h.writes().length,1);gate.resolve();await first;
 assert.equal(h.writes().filter(call=>call.request.action==='accept').length,1);assert.equal(h.pantryCalls,1);assert.deepEqual(h.events,['accept']);assert.equal(h.saved().planned[0].recipeId,'owner-dinner');assert.match(h.message,/backup/);
 assert.equal(h.writes().some(call=>call.request.action==='patch'),false);
});

test('offline acceptance sends no POST and does not touch data',async()=>{
 const h=fixture({household:INVITED});await h.open();h.sandbox.navigator.onLine=false;const before=new Map(h.values);await h.click('[data-accept]');assert.deepEqual(h.writes(),[]);assert.deepEqual(h.values,before);assert.match(h.message,/offline/);
});

test('a mismatched server household after accept cannot adopt remote data',async()=>{
 const h=fixture({household:INVITED});h.requestHook=async({request})=>request?.action==='accept'?(h.state={...PARTNER,household_id:OTHER},Response.json({ok:true,household_id:HH})):null;
 await h.open();const before=h.values.get(STATE);await h.click('[data-accept]');assert.equal(h.values.get(STATE),before);assert.equal(h.pantryCalls,0);assert.deepEqual(h.events,[]);assert.match(h.message,/refreshing/);
});

test('a pending owner pantry keeps partner data and reports the partial connection truthfully',async()=>{
 const h=fixture({household:INVITED,enabledPantry:true,pantryResult:{ok:false,waitingForOwner:true}});await h.open();const before=h.values.get(STATE);await h.click('[data-accept]');assert.equal(h.values.get(STATE),before);assert.match(h.message,/lead needs to finish/);assert.equal(h.calls.some(call=>String(call.url).includes('mode=entries')),false);
});

for(const emailSent of [true,false])test(`owner invitation requires confirmation and reports email accepted=${emailSent} honestly`,async()=>{
 const h=fixture({household:OWNER,entries:[],emailSent});await h.open();h.modalBody.querySelector('[data-email]').value='partner@example.invalid';await h.click('[data-invite]');
 assert.equal(h.writes().filter(call=>call.request.action==='invite').length,1);assert.ok(h.writes().some(call=>call.request.action==='patch'));
 assert.match(h.message,emailSent?/accepted.*sending/:/could not be sent/);assert.doesNotMatch(h.message,/delivered/i);assert.ok(h.modalBody.querySelector('[data-invite-link]'));assert.deepEqual(h.events,['invite']);
});

test('ordinary foreground sync never overwrites a concurrent edit or uploads a fresh partner plan',async()=>{
 const h=fixture();await h.api.refreshStatus();await h.api.synchronize({automatic:true});assert.deepEqual(h.writes(),[]);assert.equal(h.saved().planned[0].recipeId,'private-dinner');assert.ok(JSON.parse(h.values.get(BASE))['planned_day\u001fMonday']===undefined);
});

test('foreground polling discovers, deduplicates and removes in-app invitations after sign-in',async()=>{
 const h=fixture({household:INVITED,readablePlan:false});await h.api.foregroundCheck({force:true});assert.equal(h.noticeCount(),1);await h.api.foregroundCheck({force:true});assert.equal(h.noticeCount(),1);
 h.state=PARTNER;await h.api.foregroundCheck({force:true});assert.equal(h.noticeCount(),0);
 h.state=INVITED;await h.api.foregroundCheck({force:true});assert.equal(h.noticeCount(),1);h.win.dispatchEvent(new Event('basketboss:account-deletion-started'));assert.equal(h.noticeCount(),0);
});

test('the generic invitation entry opens review without accepting or granting access',async()=>{
 const h=fixture({household:INVITED,readablePlan:false});h.win.location.hash='#partner-sharing';await h.api.invitationEntry();await wait();
 assert.ok(h.modalBody.querySelector('[data-accept]'));assert.deepEqual(h.writes(),[]);assert.equal(h.state.premium,false);
});

test('foreground checks pause when hidden, offline or editing without changing the saved baseline',async()=>{
 const h=fixture();h.document.hidden=true;await h.api.foregroundCheck({force:true});assert.equal(h.calls.length,0);
 h.document.hidden=false;h.sandbox.navigator.onLine=false;await h.api.foregroundCheck({force:true});assert.equal(h.calls.length,0);
 h.sandbox.navigator.onLine=true;h.ready=false;await h.api.foregroundCheck({force:true});assert.equal(h.calls.length,1);assert.equal(h.values.has(BASE),false);assert.deepEqual(h.writes(),[]);
});

test('after explicit adoption a foreground remote dinner edit renders without reload or a plan upload',async()=>{
 const h=fixture();await h.adopted();const before=h.refreshes.length;
 h.entries=shared.map(value=>value.section==='planned_day'?row('planned_day','Monday',{recipeId:'new-shared-dinner'},2):value);
 await h.api.foregroundCheck({force:true});assert.equal(h.saved().planned[0].recipeId,'new-shared-dinner');assert.equal(h.refreshes.length,before+1);assert.deepEqual(h.writes(),[]);
});

test('a status poll started before explicit adoption cannot race that action with automatic entry sync',async()=>{
 const h=fixture(),status=deferred(),adoption=deferred(),adoptionStarted=deferred();await h.open();await h.adopted();
 let holdStatus=true;
 h.requestHook=async({url,request})=>{
  if(!request&&String(url).includes('mode=status')&&holdStatus){holdStatus=false;await status.promise;}
  if(!request&&String(url).includes('mode=entries')){adoptionStarted.resolve();await adoption.promise;}
  return null;
 };
 const entriesBefore=h.calls.filter(call=>String(call.url).includes('mode=entries')).length;
 const polling=h.api.foregroundCheck({force:true}),action=h.click('[data-adopt]');await adoptionStarted.promise;
 status.resolve();await polling;
 assert.equal(h.calls.filter(call=>String(call.url).includes('mode=entries')).length,entriesBefore+1,'only the explicit adoption may read entries while its action is pending');
 adoption.resolve();await action;assert.deepEqual(h.writes(),[]);assert.match(h.message,/backup/);
});

test('post-adoption local dinner edits retain per-leaf expected revision checks',async()=>{
 const h=fixture();await h.adopted();const next=h.saved();next.planned[0].recipeId='local-updated-dinner';h.values.set(STATE,JSON.stringify(next));
 await h.api.synchronize();const patches=h.writes().filter(call=>call.request.action==='patch');
 assert.deepEqual(patches.find(call=>call.request.section==='planned_day').request,{action:'patch',section:'planned_day',key:'Monday',value:{recipeId:'local-updated-dinner'},expected:1});
 assert.ok(patches.every(call=>call.request.expected===1&&['planned_day','servings'].includes(call.request.section)),'recipe-bound serving override cleanup uses the same revision guard');
});

test('adopting a dinner without a day override uses the shared default over private legacy servings',async()=>{
 const h=fixture({entries:[row('planned_day','Monday',{recipeId:'owner-dinner'}),row('household_servings','default',{count:4})]});
 const local=h.saved();local.dayServings={};local.mealServings={'owner-dinner':8};h.values.set(STATE,JSON.stringify(local));
 assert.equal((await h.adopted()).ok,true);const saved=h.saved();
 assert.equal(Serving.forMeal(saved,saved.planned[0],{servings:4}),4);
 assert.equal(saved.mealServings['owner-dinner'],8,'unrelated legacy preferences stay saved');
 assert.deepEqual(saved.dayServings.Monday,{recipeId:'owner-dinner',count:null});
 assert.deepEqual(JSON.parse(h.values.get(BASE))['servings\u001fMonday'],{revision:0,value:{deleted:true}});
 await h.api.synchronize();assert.deepEqual(h.writes(),[],'the private legacy override is never uploaded after adoption');
});

test('owner import serialises the same explicit slot serving count used by the meal resolver',async()=>{
 const h=fixture({household:OWNER,entries:[]}),local=h.saved();local.planned[0].servings=6;local.mealServings={'private-dinner':8};h.values.set(STATE,JSON.stringify(local));
 const actual=Serving.forMeal(local,local.planned[0],{servings:4});assert.equal(actual,6);
 await h.api.refreshStatus();await h.api.synchronize({allowInitialImport:true});
 assert.equal(h.writes().find(call=>call.request.section==='servings'&&call.request.key==='Monday').request.value.count,actual);
});

test('an invalid explicit slot count falls back to the matching day override when sharing',async()=>{
 for(const invalid of [0,13,'invalid']){
  const h=fixture({household:OWNER,entries:[]}),local=h.saved();local.planned[0].servings=invalid;h.values.set(STATE,JSON.stringify(local));
  const actual=Serving.forMeal(local,local.planned[0],{servings:4});assert.equal(actual,4);
  await h.api.refreshStatus();await h.api.synchronize({allowInitialImport:true});
  assert.equal(h.writes().find(call=>call.request.section==='servings'&&call.request.key==='Monday').request.value.count,actual);
 }
});

test('ordinary dinner replacement retains an unchanged authoritative day serving override',async()=>{
 const h=fixture();await h.adopted();const local=h.saved();local.mealServings={'replacement-dinner':8};h.values.set(STATE,JSON.stringify(local));
 h.entries=shared.map(value=>value.section==='planned_day'?row('planned_day','Monday',{recipeId:'replacement-dinner'},2):value);
 await h.api.synchronize();const saved=h.saved();assert.equal(saved.planned[0].recipeId,'replacement-dinner');
 assert.equal(Serving.forMeal(saved,saved.planned[0],{servings:4}),3);await h.api.synchronize();assert.deepEqual(h.writes(),[],'private legacy count never overwrites the unchanged shared override');
});

test('ordinary replacement without a day override uses the shared household default',async()=>{
 const entries=[row('planned_day','Monday',{recipeId:'owner-dinner'}),row('household_servings','default',{count:4})],h=fixture({entries});await h.adopted();
 const local=h.saved();local.mealServings={'replacement-dinner':8};h.values.set(STATE,JSON.stringify(local));h.entries=entries.map(value=>value.section==='planned_day'?row('planned_day','Monday',{recipeId:'replacement-dinner'},2):value);
 await h.api.synchronize();const saved=h.saved();assert.equal(Serving.forMeal(saved,saved.planned[0],{servings:4}),4);assert.deepEqual(saved.dayServings.Monday,{recipeId:'replacement-dinner',count:null});
 await h.api.synchronize();assert.deepEqual(h.writes(),[]);
});

test('a conflicting day serving override defers its replacement dinner without advancing that baseline',async()=>{
 const h=fixture();await h.adopted();const local=h.saved();local.dayServings.Monday.count=5;h.values.set(STATE,JSON.stringify(local));
 h.entries=shared.map(value=>value.section==='planned_day'?row('planned_day','Monday',{recipeId:'replacement-dinner'},2):value.section==='servings'?row('servings','Monday',{count:6},2):value);
 const result=await h.api.synchronize();assert.ok(result.conflicts>=2);const saved=h.saved();assert.equal(saved.planned[0].recipeId,'owner-dinner');assert.equal(Serving.forMeal(saved,saved.planned[0],{servings:4}),5);
 assert.deepEqual(JSON.parse(h.values.get(BASE))['planned_day\u001fMonday'],{revision:1,value:{recipeId:'owner-dinner'}});assert.deepEqual(h.writes(),[]);
});

test('a conflicting dinner defers incoming serving changes and preserves the local recipe headcount',async()=>{
 const h=fixture();await h.adopted();const local=h.saved();local.planned[0].recipeId='private-replacement';local.dayServings.Monday={recipeId:'private-replacement',count:3};h.values.set(STATE,JSON.stringify(local));
 h.entries=shared.map(value=>value.section==='planned_day'?row('planned_day','Monday',{recipeId:'remote-replacement'},2):value.section==='servings'?row('servings','Monday',{count:6},2):value);
 await h.api.synchronize();const saved=h.saved();assert.equal(saved.planned[0].recipeId,'private-replacement');assert.equal(Serving.forMeal(saved,saved.planned[0],{servings:4}),3);
 assert.deepEqual(JSON.parse(h.values.get(BASE))['servings\u001fMonday'],{revision:1,value:{count:3}});assert.deepEqual(h.writes(),[]);
});

for(const variant of ['different-recipes','local-count-remote-recipe','local-recipe-remote-count'])test(`recipe/count pair preflight prevents outgoing or incoming cross-recipe changes: ${variant}`,async()=>{
 const h=fixture();await h.adopted();const local=h.saved();
 if(variant!=='local-count-remote-recipe')local.planned[0].recipeId='private-replacement';
 const localCount=variant==='local-recipe-remote-count'?3:5;local.dayServings.Monday={recipeId:local.planned[0].recipeId,count:localCount};h.values.set(STATE,JSON.stringify(local));
 h.entries=shared.map(value=>value.section==='planned_day'&&variant!=='local-recipe-remote-count'?row('planned_day','Monday',{recipeId:'remote-replacement'},2):value.section==='servings'&&variant==='local-recipe-remote-count'?row('servings','Monday',{count:6},2):value).reverse();
 const result=await h.api.synchronize();assert.ok(result.conflicts>=2);const saved=h.saved();assert.equal(saved.planned[0].recipeId,local.planned[0].recipeId);assert.equal(Serving.forMeal(saved,saved.planned[0],{servings:4}),localCount);
 assert.deepEqual(h.writes(),[],'neither recipe nor headcount is uploaded before the pair conflict is resolved');
 const baseline=JSON.parse(h.values.get(BASE));assert.deepEqual(baseline['planned_day\u001fMonday'],{revision:1,value:{recipeId:'owner-dinner'}});assert.deepEqual(baseline['servings\u001fMonday'],{revision:1,value:{count:3}});
});

test('identical concurrent recipe/count pair changes can establish the new baseline without a conflict',async()=>{
 const h=fixture();await h.adopted();const local=h.saved();local.planned[0].recipeId='same-replacement';local.dayServings.Monday={recipeId:'same-replacement',count:5};h.values.set(STATE,JSON.stringify(local));
 h.entries=shared.map(value=>value.section==='planned_day'?row('planned_day','Monday',{recipeId:'same-replacement'},2):value.section==='servings'?row('servings','Monday',{count:5},2):value);
 const result=await h.api.synchronize();assert.equal(result.conflicts,0);assert.deepEqual(h.writes(),[]);assert.equal(JSON.parse(h.values.get(BASE))['servings\u001fMonday'].revision,2);
});

for(const marker of ['held','localOnly'])test(`a ${marker} dinner keeps both recipe and serving changes isolated`,async()=>{
 const h=fixture();await h.adopted();const baseline=JSON.parse(h.values.get(BASE));baseline['planned_day\u001fMonday'][marker]=true;h.values.set(BASE,JSON.stringify(baseline));
 const local=h.saved();local.planned[0].recipeId='private-replacement';local.dayServings.Monday={recipeId:'private-replacement',count:5};h.values.set(STATE,JSON.stringify(local));
 h.entries=shared.map(value=>value.section==='planned_day'?row('planned_day','Monday',{recipeId:'remote-replacement'},2):value.section==='servings'?row('servings','Monday',{count:6},2):value);
 const before=h.values.get(STATE);await h.api.synchronize();assert.equal(h.values.get(STATE),before);assert.deepEqual(h.writes(),[]);assert.deepEqual(JSON.parse(h.values.get(BASE))['planned_day\u001fMonday'],baseline['planned_day\u001fMonday']);assert.deepEqual(JSON.parse(h.values.get(BASE))['servings\u001fMonday'],baseline['servings\u001fMonday']);
});

test('only an explicit owner import releases a held recipe/count pair into an empty household',async()=>{
 const h=fixture({household:OWNER,entries:[]});await h.api.refreshStatus();await h.api.synchronize();assert.deepEqual(h.writes(),[]);assert.equal(JSON.parse(h.values.get(BASE))['planned_day\u001fMonday'].held,true);
 await h.api.synchronize({allowInitialImport:true});const writes=h.writes().map(value=>value.request);
 assert.ok(writes.some(value=>value.section==='planned_day'&&value.key==='Monday'&&value.expected===0));assert.ok(writes.some(value=>value.section==='servings'&&value.key==='Monday'&&value.value.count===4&&value.expected===0));
 assert.equal(JSON.parse(h.values.get(BASE))['planned_day\u001fMonday'].held,undefined);
});

test('explicit acceptance awaits server recipe preparation before reading or adopting shared dinners',async()=>{
 const gate=deferred(),h=fixture({household:INVITED,prepareRecipes:()=>gate.promise});await h.open();const before=new Map(h.values),pending=h.click('[data-accept]');await wait();
 assert.equal(h.preparations.length,1);assert.equal(h.preparations[0].actor,ACTOR);assert.equal(h.preparations[0].token,'synthetic-token');assert.equal(h.preparations[0].expected,before.get(STATE));
 assert.equal(h.calls.some(call=>String(call.url).includes('mode=entries')),false);assert.deepEqual(h.values,before);assert.equal(h.refreshes.length,0);
 gate.resolve(true);await pending;assert.equal(h.saved().planned[0].recipeId,'owner-dinner');assert.equal(h.refreshes.length,1);assert.deepEqual(h.membershipChecks,[true],'the existing UI verifier rechecks server status after accepting');
});

test('a declined or dirty recipe preparation leaves local stock, plan and baseline unchanged',async()=>{
 for(const dirty of [false,true]){
  const h=fixture({prepareRecipes:async()=>{if(dirty)h.ready=false;return false;}}),before=new Map(h.values);
  await assert.rejects(()=>h.adopted(),/editing|safely|changed/i);assert.deepEqual(h.values,before);assert.deepEqual(h.writes(),[]);assert.equal(h.refreshes.length,0);assert.equal(h.calls.some(call=>String(call.url).includes('mode=entries')),false);
 }
});

for(const change of ['actor','plan','dirty','deletion'])test(`delayed recipe preparation cancels shared adoption after ${change} changes`,async()=>{
 const gate=deferred(),h=fixture({prepareRecipes:async pin=>{await gate.promise;return h.win.BBHomeHost.canRefreshSharedHousehold(pin);}});const pending=h.adopted();await wait();assert.equal(h.preparations.length,1);
 if(change==='actor')h.changeActor();
 if(change==='plan')h.values.set(STATE,JSON.stringify({...h.saved(),planned:[{day:'Friday',recipeId:'new-local-draft'}]}));
 if(change==='dirty')h.ready=false;
 if(change==='deletion')h.win.dispatchEvent(new Event('basketboss:account-deletion-started'));
 const before=new Map(h.values);gate.resolve();await assert.rejects(()=>pending,/editing|safely|changed/i);assert.deepEqual(h.values,before);assert.deepEqual(h.writes(),[]);assert.equal(h.refreshes.length,0);assert.equal(h.calls.some(call=>String(call.url).includes('mode=entries')),false);
});

test('the explicit Use shared household data retry runs recipe preparation again without inventing Premium',async()=>{
 const h=fixture({prepareRecipes:async()=>true});await h.open();await h.click('[data-adopt]');assert.equal(h.preparations.length,1);assert.equal(h.saved().planned[0].recipeId,'owner-dinner');assert.deepEqual(h.membershipChecks,[],'recipe preparation does not publish a new membership');assert.deepEqual(h.writes(),[]);
});
