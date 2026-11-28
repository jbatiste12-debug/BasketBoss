import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const original=fs.readFileSync(new URL('../bb-household-sharing.js',import.meta.url),'utf8');
// Exercise the shipped closure; only its test entry points are exposed.
const source=original.replace('function boot(){','window.__sharingAccessTest={open,refreshStatus};function boot(){');
assert.notEqual(source,original);
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',HOUSEHOLD='33333333-3333-4333-8333-333333333333';
const SESSION='basketboss_cloud_session_v1';
const PREMIUM={authenticated:true,premiumAccess:true,premium:true,tier:'premium',mode:'live'};
const FREE={authenticated:true,premiumAccess:false,premium:false,tier:'free',mode:'live'};
const UNAVAILABLE={configured:false,premium:false};
const INELIGIBLE={configured:true,premium:false,role:'free',household_id:null};
const OWNER={configured:true,premium:true,role:'free',household_id:null,invite_status:'none'};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({household=INELIGIBLE,householdStatus=200,membership=FREE,membershipStatus=200,fetchMembership,fetchHousehold,spoof=false,allowConfirm=false}={}){
 const values=new Map([[SESSION,JSON.stringify({user:{id:ACTOR},access_token:'synthetic-current-token'})],['basketboss_321_v7_measured_pantry','{"rice|g":250}']]);
 const calls=[],events=[],navigation=[];let state=structuredClone(household);
 function node(tag='button',attributes={},label=''){
  const handlers=new Map();
  const value={tagName:tag.toUpperCase(),attributes:{...attributes},value:attributes.value||'',textContent:label,disabled:false,
   addEventListener(name,handler){const list=handlers.get(name)||[];list.push(handler);handlers.set(name,list);},
   getAttribute(name){return this.attributes[name]??null;},setAttribute(name,content){this.attributes[name]=String(content);},
   removeAttribute(name){delete this.attributes[name];},
   async click(){const event={target:this,preventDefault(){},stopPropagation(){}};await this.onclick?.(event);for(const handler of handlers.get('click')||[])await handler(event);}
  };return value;
 }
 const body={nodes:[],html:'',_text:'',
  set textContent(text){this._text=String(text);this.html='';this.nodes=[];},
  get textContent(){return this._text;},
  set innerHTML(html){
   this.html=html;this._text=html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();this.nodes=[];
   for(const match of html.matchAll(/<(button|input|a|p)\b([^>]*)>([^<]*)/g)){
    const attributes={};for(const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[attribute[1]]=attribute[2]??'';
    this.nodes.push(node(match[1],attributes,match[3]));
   }
  },
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
  querySelectorAll(selector){return this.nodes.filter(value=>selector.split(',').some(part=>{
   const tag=part.match(/^([a-z]+)/)?.[1],attribute=part.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
   return (!tag||value.tagName===tag.toUpperCase())&&(!attribute||Object.hasOwn(value.attributes,attribute[1])&&(attribute[2]===undefined||value.attributes[attribute[1]]===attribute[2]));
  }));}
 };
 const message=node('p'),review={replaceChildren(){}},close=node(),dialogEvents=new Map();
 const dialog={open:false,innerHTML:'',setAttribute(){},showModal(){this.open=true;},
  addEventListener(name,handler){const list=dialogEvents.get(name)||[];list.push(handler);dialogEvents.set(name,list);},
  close(){this.open=false;for(const handler of dialogEvents.get('close')||[])handler({target:this});},
  querySelector:selector=>selector==='[data-bbhs-body]'?body:selector==='[data-bbhs-message]'?message:selector==='[data-bbhs-review]'?review:selector==='.bbhs-close'?close:null
 };
 const document={readyState:'loading',hidden:false,body:{append(){}},createElement:()=>dialog,addEventListener(){},getElementById:()=>null,querySelector:()=>null};
 const win=new EventTarget();win.location={href:'capacitor://localhost/index.html',assign:value=>navigation.push(value)};
 if(spoof){win.BasketBossVerifiedPremium={isActive:()=>true,state:()=> 'premium'};win.BasketBossPremium=true;win.bb175_isPremium=true;}
 win.addEventListener('basketboss:household-changed',event=>events.push(event.detail?.action));
 const storage={getItem:key=>values.get(key)??null,setItem(){throw Error('Access checks must not write pantry or account data');},removeItem(){throw Error('Access checks must not delete pantry or account data');}};
 const sandbox={AbortController,setTimeout,clearTimeout,window:win,document,localStorage:storage,navigator:{onLine:true},Event,JSON,Date,URL,console,
  location:{href:win.location.href,reload(){throw Error('Access checks must not reload or adopt household data');}},confirm:()=>allowConfirm,
  fetch:async(url,options={})=>{
   const path=new URL(String(url),'https://basketboss.co.uk').pathname,request=options.body?JSON.parse(options.body):null;
   calls.push({path,url:String(url),request,options});
   if(path==='/api/subscription/status')return fetchMembership?fetchMembership(options):Response.json(membership,{status:membershipStatus});
   assert.equal(path,'/api/household','only the two approved status endpoints and existing household actions are used');
   if(!request)return fetchHousehold?fetchHousehold(options):Response.json(state,{status:householdStatus});
   if(request.action==='invite'){state={...OWNER,role:'owner',household_id:HOUSEHOLD,invite_status:'pending',partner_email:request.email};return Response.json({ok:true,household_id:HOUSEHOLD,message:'Invitation pending'});}
   if(request.action==='accept'){state={configured:true,premium:true,role:'partner',household_id:HOUSEHOLD,invite_status:'accepted'};return Response.json({ok:true,household_id:HOUSEHOLD});}
   throw Error('Unexpected household write '+request.action);
  }
 };
 vm.runInNewContext(source,sandbox);
 return {api:win.__sharingAccessTest,win,values,calls,events,body,message,dialog,navigation,
  membershipCalls:()=>calls.filter(call=>call.path==='/api/subscription/status'),
  writes:()=>calls.filter(call=>call.request),
  event:name=>win.dispatchEvent(new Event(name)),
  changeSession({actor=ACTOR,token='synthetic-next-token'}={}){values.set(SESSION,JSON.stringify({user:{id:actor},access_token:token}));}
 };
}

const noInvite=h=>{assert.equal(h.body.querySelector('[data-invite]'),null);assert.equal(h.body.querySelector('[data-accept]'),null);};
const noUpsell=h=>assert.equal(h.body.querySelectorAll('a[href]').filter(link=>/pricing|paddle|checkout|subscribe/i.test(link.getAttribute('href')||'')).length,0);
const upgrade=h=>assert.ok(h.body.querySelectorAll('a[href]').some(link=>/pricing/.test(link.getAttribute('href')||'')),'confirmed Free keeps the ordinary upgrade route');

test('eligible Premium owner opens invitation controls without a second membership gate',async()=>{
 for(const role of ['free','owner']){
  const h=fixture({household:{...OWNER,role}}),before=new Map(h.values);await h.api.open();
  assert.ok(h.body.querySelector('[data-invite]'));assert.ok(h.body.querySelector('[data-email]'));noUpsell(h);
  assert.equal(h.membershipCalls().length,0);assert.equal(h.writes().length,0);assert.deepEqual(h.values,before);
 }
});

test('an explicitly confirmed invitation keeps its server action and only notifies after the mocked server commits',async()=>{
 const h=fixture({household:OWNER,allowConfirm:true}),before=new Map(h.values);await h.api.open();
 h.body.querySelector('[data-email]').value='partner@example.invalid';await h.body.querySelector('[data-invite]').click();
 assert.deepEqual(h.writes().map(call=>call.request),[{action:'invite',email:'partner@example.invalid'}]);
 assert.deepEqual(h.events,['invite']);assert.deepEqual(h.values,before);assert.equal(h.membershipCalls().length,0);
});

test('cancelling the owner sharing confirmation sends no invitation and changes no saved data',async()=>{
 const h=fixture({household:OWNER}),before=new Map(h.values);await h.api.open();
 h.body.querySelector('[data-email]').value='partner@example.invalid';await h.body.querySelector('[data-invite]').click();
 assert.deepEqual(h.writes(),[]);assert.deepEqual(h.events,[]);assert.deepEqual(h.values,before);
});

test('a pending partner sees and can accept an invitation without personal Premium',async()=>{
 const h=fixture({household:{...INELIGIBLE,invite:{household_id:HOUSEHOLD}}}),before=new Map(h.values);await h.api.open();
 assert.ok(h.body.querySelector('[data-accept]'));noUpsell(h);assert.equal(h.membershipCalls().length,0);
 await h.body.querySelector('[data-accept]').click();
 assert.deepEqual(h.writes().map(call=>call.request),[{action:'accept',household_id:HOUSEHOLD}]);
 assert.deepEqual(h.events,['accept']);assert.ok(h.body.querySelector('[data-sync]'));assert.deepEqual(h.values,before);
});

test('an accepted partner keeps the shared-household sync screen',async()=>{
 const h=fixture({household:{...OWNER,household_id:HOUSEHOLD,role:'partner',invite_status:'accepted'}});await h.api.open();
 assert.ok(h.body.querySelector('[data-sync]'));assert.equal(h.body.querySelector('[data-invite]'),null);noUpsell(h);assert.equal(h.membershipCalls().length,0);
});

test('server-recognised owner, Apple, founder and sandbox Premium never become a second-subscription offer',async()=>{
 for(const membership of [{...PREMIUM,tier:'owner',provider:'owner'},{...PREMIUM,provider:'apple'},{...PREMIUM,provider:'paddle',subscription:{plan:'founder'}},{...PREMIUM,provider:'apple',mode:'sandbox'}]){
  for(const household of [UNAVAILABLE,INELIGIBLE]){
   const h=fixture({household,membership}),before=new Map(h.values);await h.api.open();
   noUpsell(h);noInvite(h);assert.match(h.body.textContent,/Premium/i);assert.match(h.body.textContent,/unavailable|not available|not activated|not enabled|prepared/i);
   assert.equal(h.membershipCalls().length,1);assert.equal(h.writes().length,0);assert.deepEqual(h.values,before);
   const call=h.membershipCalls()[0];assert.equal(call.options.headers.Authorization,'Bearer synthetic-current-token');assert.equal(call.options.cache,'no-store');
  }
 }
});

test('verified Free retains the normal upgrade route without acquiring household rights',async()=>{
 for(const household of [UNAVAILABLE,INELIGIBLE]){
  const h=fixture({household,membership:FREE});await h.api.open();upgrade(h);noInvite(h);assert.equal(h.membershipCalls().length,1);assert.equal(h.writes().length,0);
 }
});

test('a disabled sharing response cannot be activated by Premium or a stray invitation field',async()=>{
 const h=fixture({household:{configured:false,premium:true,invite:{household_id:HOUSEHOLD}},membership:PREMIUM});await h.api.open();
 noInvite(h);noUpsell(h);assert.equal(h.membershipCalls().length,1);assert.equal(h.writes().length,0);
});

test('a forged browser Premium flag cannot substitute for server household eligibility',async()=>{
 const h=fixture({household:INELIGIBLE,membership:FREE,spoof:true});await h.api.open();
 noInvite(h);upgrade(h);assert.equal(h.membershipCalls().length,1);assert.equal(h.writes().length,0);assert.deepEqual(h.navigation,[]);
});

test('missing or malformed membership verification is unavailable rather than Free or a Premium grant',async()=>{
 for(const membership of [null,{},[],{premiumAccess:true},{authenticated:false,premiumAccess:true},{authenticated:'true',premiumAccess:true},{authenticated:true,premiumAccess:'true'},{authenticated:true,premiumAccess:'false'},{authenticated:true,premium:true}]){
  const h=fixture({household:INELIGIBLE,membership});await h.api.open();
  noInvite(h);noUpsell(h);assert.ok(h.body.querySelector('[data-retry]'),'unverified membership can be retried');assert.equal(h.writes().length,0);
 }
});

test('membership transport, HTTP and JSON failures do not sell another subscription',async()=>{
 for(const fail of ['network','503','invalid-json']){
  const fetchMembership=async()=>{if(fail==='network')throw Error('Synthetic offline fixture');if(fail==='503')return Response.json({error:'Unavailable'},{status:503});return {ok:true,status:200,json:async()=>{throw Error('Synthetic invalid JSON');}};};
  const h=fixture({household:UNAVAILABLE,fetchMembership});await h.api.open();
  noUpsell(h);noInvite(h);assert.ok(h.body.querySelector('[data-retry]'));assert.equal(h.writes().length,0);
 }
});

test('household service and session failures show recovery instead of a false Free classification',async()=>{
 for(const householdStatus of [401,403,503])for(const membership of [PREMIUM,FREE]){
  const h=fixture({household:{error:householdStatus===403?'A newer session is active':'Sharing unavailable'},householdStatus,membership});await h.api.open();
  noUpsell(h);noInvite(h);assert.ok(h.body.querySelector('[data-signin]')||h.body.querySelector('[data-retry]'),'failed household checks expose sign-in or retry');assert.equal(h.writes().length,0);
 }
});

test('a membership check is pinned to its original actor and token',async()=>{
 for(const change of [{actor:OTHER,token:'synthetic-current-token'},{actor:ACTOR,token:'synthetic-next-token'}]){
  const gate=deferred(),h=fixture({fetchMembership:()=>gate.promise}),opening=h.api.open();await tick();
  assert.equal(h.membershipCalls().length,1);h.changeSession(change);gate.resolve(Response.json(PREMIUM));await opening;
  noInvite(h);noUpsell(h);assert.doesNotMatch(h.body.textContent,/existing Premium|membership.*available/i);assert.equal(h.writes().length,0);
 }
});

test('deletion start and cancellation invalidate a pending membership response',async()=>{
 const gate=deferred(),h=fixture({fetchMembership:()=>gate.promise}),opening=h.api.open();await tick();
 assert.equal(h.membershipCalls().length,1);h.event('basketboss:account-deletion-started');h.event('basketboss:account-deletion-cancelled');
 gate.resolve(Response.json(PREMIUM));await opening;
 assert.equal(h.dialog.open,false);noInvite(h);noUpsell(h);assert.equal(h.writes().length,0);
});

test('closing or reopening the dialog prevents an older status check replacing the current screen',async()=>{
 for(const reopen of [false,true]){
  const gate=deferred();let reads=0;
  const h=fixture({fetchMembership:()=>++reads===1?gate.promise:Response.json(FREE)}),opening=h.api.open();await tick();
  assert.equal(h.membershipCalls().length,1);h.dialog.close();
  if(reopen){await h.api.open();upgrade(h);}
  gate.resolve(Response.json(PREMIUM));await opening;
  if(reopen)upgrade(h);else assert.equal(h.dialog.open,false);
  noInvite(h);assert.equal(h.writes().length,0);assert.doesNotMatch(h.body.textContent,/existing Premium|membership.*available/i);
 }
});
