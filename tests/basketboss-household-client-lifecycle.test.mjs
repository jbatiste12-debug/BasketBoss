import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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

function fixture({household=PARTNER,entries=shared,confirm=true,enabledPantry=false,pantryResult,backupFailure=false,baselineFailure=false,readablePlan=true,emailSent=false}={}){
 const values=new Map([[AUTH,JSON.stringify({user:{id:ACTOR},access_token:'synthetic-token'})],[STOCK,'{"rice|g":250}'],[TICKS,'{"old-item":true}'],[BUDGET,'90']]);
 if(readablePlan)values.set(STATE,JSON.stringify({version:2,planned:[{day:'Monday',recipeId:'private-dinner'},{day:'Tuesday',recipeId:'private-tuesday'}],dayServings:{Monday:{recipeId:'private-dinner',count:4}},pantry:{'private-rice':true},servings:4,breakfasts:{Monday:'private-breakfast'},customMarker:'preserve-unshared'}));
 const body=element('body'),app=element('main'),account=element('section'),cloud=element('button'),docEvents=new Map(),win=new EventTarget(),calls=[],refreshes=[],events=[],timers=[];
 let state=structuredClone(household),rows=structuredClone(entries),ready=true,allowConfirm=confirm,onRequest=null,pantryCalls=0,clock=10000;
 app.querySelector=()=>null;account.querySelector=()=>null;
 const document={readyState:'loading',hidden:false,activeElement:null,body,
  createElement:tag=>element(tag),getElementById:id=>id==='app'?app:id==='bbuiAccountSection'?account:id==='cloud-open'?cloud:null,
  addEventListener(name,handler){docEvents.set(name,handler);},querySelector(){return null;}};
 const store={getItem:key=>values.get(key)??null,setItem(key,value){if(backupFailure&&key.startsWith('bb_partner_premerge_')||baselineFailure&&key===BASE)throw Error('Synthetic storage full');values.set(key,String(value));},removeItem:key=>values.delete(key)};
 win.location={hash:'',href:'https://www.basketboss.co.uk/app'};
 win.BBHomeHost={canRefreshSharedHousehold(pin){return ready&&!document.hidden&&pin.actor===JSON.parse(values.get(AUTH)||'null')?.user?.id&&pin.token===JSON.parse(values.get(AUTH)||'null')?.access_token&&pin.expected===values.get(STATE);},refreshSharedHousehold(pin){if(!this.canRefreshSharedHousehold(pin))return false;refreshes.push({...pin});return true;}};
 win.BBReceiptHost={accountPantrySyncEnabled:()=>enabledPantry,handlesInventorySync:()=>enabledPantry&&pantryCalls>0,async connectHouseholdPantry(){pantryCalls++;return pantryResult||{ok:true,adoptedScope:{kind:'household',id:HH},backupKey:'synthetic-pantry-backup'};}};
 win.addEventListener('basketboss:household-changed',event=>events.push(event.detail?.action));
 const sandbox={window:win,document,localStorage:store,navigator:{onLine:true,clipboard:{writeText:async()=>{}}},Event,JSON,console,Map,Set,Date:class extends Date{static now(){return clock;}},confirm:()=>allowConfirm,
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
 return {api:win.__lifecycle,win,document,values,body,calls,refreshes,events,timers,sandbox,account,
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

test('post-adoption local dinner edits retain per-leaf expected revision checks',async()=>{
 const h=fixture();await h.adopted();const next=h.saved();next.planned[0].recipeId='local-updated-dinner';h.values.set(STATE,JSON.stringify(next));
 await h.api.synchronize();const patches=h.writes().filter(call=>call.request.action==='patch');
 assert.deepEqual(patches.find(call=>call.request.section==='planned_day').request,{action:'patch',section:'planned_day',key:'Monday',value:{recipeId:'local-updated-dinner'},expected:1});
 assert.ok(patches.every(call=>call.request.expected===1&&['planned_day','servings'].includes(call.request.section)),'recipe-bound serving override cleanup uses the same revision guard');
});
