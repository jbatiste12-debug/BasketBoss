import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../bb-verified-premium-ui.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const PREMIUM={authenticated:true,premiumAccess:true,tier:'premium',mode:'live'};
const FREE={authenticated:true,premiumAccess:false,tier:'free',mode:'live'};

function fixture(initialToken='actor-a'){
 const storage=new Map(),requests=[],signals=[],intervals=[],windowHandlers=new Map(),documentHandlers=new Map();
 const session=(token,actor=token)=>{if(token===null)storage.delete('basketboss_cloud_session_v1');else storage.set('basketboss_cloud_session_v1',JSON.stringify({access_token:token,user:{id:actor},expires_at:Date.now()/1000+3600}));};
 session(initialToken);
 const window={addEventListener:(name,fn)=>windowHandlers.set(name,fn)};
 const document={hidden:false,addEventListener:(name,fn)=>documentHandlers.set(name,fn),dispatchEvent:event=>signals.push({event:event.type,state:window.BasketBossVerifiedPremium.state(),active:window.BasketBossVerifiedPremium.isActive()})};
 const context=vm.createContext({window,document,localStorage:{getItem:key=>storage.get(key)??null},Event:class{constructor(type){this.type=type;}},setInterval:fn=>intervals.push(fn),
  fetch:(url,options)=>{const pending=deferred();requests.push({url,options,...pending});return pending.promise;}});
 vm.runInContext(code,context);
 const api=window.BasketBossVerifiedPremium;
 const respond=async(data,{index=requests.length-1,ok=true,status=200,json}={})=>{requests[index].resolve({ok,status,json:json||(async()=>data)});await tick();};
 return {api,session,storage,requests,signals,respond,intervals,event:(name,event={})=>windowHandlers.get(name)?.(event),documentEvent:name=>documentHandlers.get(name)?.()};
}

test('verified Premium remains bound to explicit authenticated access, the accepted tier and billing mode',async()=>{
 for(const tier of ['premium','owner'])for(const mode of ['live','sandbox']){
  const h=fixture();assert.equal(h.api.state(),'checking');assert.equal(h.api.isActive(),false);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/subscription/status');
  assert.equal(h.requests[0].options.headers.Authorization,'Bearer actor-a');assert.equal(h.requests[0].options.cache,'no-store');
  await h.respond({...PREMIUM,tier,mode});assert.equal(h.api.state(),'premium');assert.equal(h.api.isActive(),true);
  assert.equal(h.signals.at(-1).event,'basketboss:premium-verified');
 }
});

test('only an authenticated explicit false Premium flag confirms Free membership',async()=>{
 for(const data of [FREE,{authenticated:true,premiumAccess:false},{authenticated:true,premiumAccess:false,tier:'premium',mode:'unknown'}]){
  const h=fixture();await h.respond(data);assert.equal(h.api.state(),'free');assert.equal(h.api.isActive(),false);assert.equal(h.signals.at(-1).state,'free');
 }
});

test('malformed or incomplete HTTP 200 responses cannot classify an account as Free or grant Premium',async()=>{
 const malformed=[null,undefined,false,true,0,'premium','false',[],{},
  {authenticated:true},{premiumAccess:false},{authenticated:false,premiumAccess:false},
  {authenticated:'true',premiumAccess:false},{authenticated:true,premiumAccess:'false'},
  {authenticated:'true',premiumAccess:true,tier:'premium',mode:'live'},
  {authenticated:true,premiumAccess:'true',tier:'premium',mode:'live'},
  {...PREMIUM,tier:'free'},{...PREMIUM,tier:'Premium'},{...PREMIUM,mode:'unknown'},
  {authenticated:true,premiumAccess:true}];
 for(const data of malformed){
  const h=fixture();await h.respond(data);assert.equal(h.api.state(),'unavailable',JSON.stringify(data));assert.equal(h.api.isActive(),false,JSON.stringify(data));
  assert.equal(h.signals.at(-1).state,'unavailable');
 }
});

test('HTTP, transport and JSON errors clear an old grant without falsely reporting Free',async()=>{
 for(const failure of ['http','network','json','unauthorized']){
  const h=fixture();await h.respond(PREMIUM);const refresh=h.api.refresh(true);assert.equal(h.api.isActive(),true,'same-token refresh preserves the prior verified grant while pending');
  if(failure==='http')await h.respond(FREE,{ok:false,status:503});
  if(failure==='unauthorized')await h.respond(FREE,{ok:false,status:401});
  if(failure==='network'){h.requests.at(-1).reject(Error('offline'));await tick();}
  if(failure==='json')await h.respond(null,{json:async()=>{throw Error('invalid json');}});
  assert.equal(await refresh,false);assert.equal(h.api.isActive(),false);assert.equal(h.api.state(),failure==='unauthorized'?'signed_out':'unavailable');
 }
 const h=fixture();await h.respond(PREMIUM);const refresh=h.api.refresh(true);await h.respond({});await refresh;
 assert.equal(h.api.isActive(),false);assert.equal(h.api.state(),'unavailable','malformed successful refresh also clears the old grant');
});

test('sign-out invalidates Premium synchronously and an old JSON body cannot restore it',async()=>{
 const h=fixture();await h.respond(PREMIUM);const body=deferred(),refresh=h.api.refresh(true);
 await h.respond(null,{json:()=>body.promise});h.session(null);
 assert.equal(h.api.isActive(),false);assert.equal(h.api.state(),'signed_out');
 body.resolve(PREMIUM);await refresh;assert.equal(h.api.isActive(),false);assert.equal(h.api.state(),'signed_out');
});

test('a delayed JSON body from a previous account cannot overwrite a new checking or Free state',async()=>{
 for(const settleNew of [false,true])for(const oldData of [FREE,PREMIUM,{}]){
  const h=fixture(),body=deferred();await h.respond(null,{index:0,json:()=>body.promise});
  h.session('actor-b');const current=h.api.refresh(true);assert.equal(h.api.state(),'checking');
  assert.equal(h.requests[1].options.headers.Authorization,'Bearer actor-b');
  if(settleNew){await h.respond(FREE,{index:1});await current;assert.equal(h.api.state(),'free');}
  const signalCount=h.signals.length;body.resolve(oldData);await tick();
  assert.equal(h.api.state(),settleNew?'free':'checking');assert.equal(h.api.isActive(),false);assert.equal(h.signals.length,signalCount,'obsolete JSON does not emit a misleading membership event');
  if(!settleNew){await h.respond(FREE,{index:1});await current;}
 }
});

test('a later verification for the same account wins over an earlier JSON response',async()=>{
 const h=fixture(),body=deferred();await h.respond(null,{index:0,json:()=>body.promise});
 const current=h.api.refresh(true);await h.respond(PREMIUM,{index:1});await current;
 const signalCount=h.signals.length;body.resolve(FREE);await tick();
 assert.equal(h.api.state(),'premium');assert.equal(h.api.isActive(),true);assert.equal(h.signals.length,signalCount);
});

test('same-tab sign-out clears the rendered grant immediately without waiting for polling or network',async()=>{
 const h=fixture();await h.respond(PREMIUM);const before=h.signals.length;
 h.session(null);h.event('basketboss:session-changed');
 assert.equal(h.api.isActive(),false);assert.equal(h.api.state(),'signed_out');
 assert.equal(h.signals.length,before+1);assert.equal(h.signals.at(-1).state,'signed_out');
 assert.equal(h.requests.length,1,'logout does not need a successful server call');
});

test('the same token cannot carry a Premium display grant into a different saved account identity',async()=>{
 const h=fixture();await h.respond(PREMIUM);const pending=h.api.refresh(true),body=deferred();
 await h.respond(null,{json:()=>body.promise});h.session('actor-a','free-account-b');
 assert.equal(h.api.isActive(),false);assert.equal(h.api.state(),'checking');
 const signals=h.signals.length;body.resolve(PREMIUM);assert.equal(await pending,false);assert.equal(h.signals.length,signals);
 h.event('basketboss:session-changed');assert.equal(h.api.isActive(),false);assert.equal(h.api.state(),'checking');
 await h.respond(FREE);assert.equal(h.api.state(),'free');assert.equal(h.api.isActive(),false);
});

test('explicit membership invalidation discards an in-flight response even if the token is later reused',async()=>{
 const h=fixture();await h.respond(PREMIUM);const pending=h.api.refresh(true),body=deferred();
 await h.respond(null,{json:()=>body.promise});h.api.invalidate();
 assert.equal(h.api.isActive(),false);assert.equal(h.api.state(),'checking');
 const signals=h.signals.length;body.resolve(PREMIUM);assert.equal(await pending,false);assert.equal(h.signals.length,signals);
 h.event('basketboss:session-changed');await h.respond(FREE);assert.equal(h.api.state(),'free');
});

test('a saved token without an account identity cannot grant a membership display or start verification',()=>{
 const h=fixture(null);h.storage.set('basketboss_cloud_session_v1',JSON.stringify({access_token:'actor-a',expires_at:Date.now()/1000+3600}));
 h.event('basketboss:session-changed');assert.equal(h.api.state(),'signed_out');assert.equal(h.api.isActive(),false);assert.equal(h.requests.length,0);
});
