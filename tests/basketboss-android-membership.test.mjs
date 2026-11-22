import test from 'node:test';
import assert from 'node:assert/strict';
import {installAndroidMembership} from '../native/android-membership.mjs';

function fixture(){
 let observed=false,pending=false,observer,mutations=0,session=null,answer=async()=>Response.json({authenticated:true,premiumAccess:false}),deleting=false;
 const nodes=[],events=new Map(),calls=[],writes=[];
 const changed=()=>{mutations++;if(observed)pending=true;};
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.dataset={};this.attrs={};this.children=[];this._text='';this.classes=new Set();this.handlers=new Map();this.isConnected=false;this.classList={contains:name=>this.classes.has(name),add:name=>{this.classes.add(name);changed();}};nodes.push(this);}
  set textContent(value){this._text=String(value);this.children=[];changed();}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  getAttribute(name){return this.attrs[name]??null;}setAttribute(name,value){this.attrs[name]=String(value);}
  append(...items){for(const node of items){node.isConnected=true;this.children.push(node);}changed();}
  replaceChildren(...items){this.children=[];this._text='';this.append(...items);}addEventListener(name,handler){this.handlers.set(name,handler);}close(){this.open=false;}
 }
 const parent=new Element('main');parent.isConnected=true;const provider=new Element('a');provider.setAttribute('href','https://checkout.paddle.com/fixture');provider.textContent='Buy';const premium=new Element('button'),intro=new Element('dialog');intro.open=true;
 const doc={body:{},createElement:tag=>new Element(tag),getElementById:id=>id==='bbNativeMembershipMount'?parent:id==='bbIntroTrialDialog'?intro:null,querySelectorAll:selector=>selector==='a[href]'?nodes.filter(n=>n.tagName==='A'&&n.getAttribute('href')):selector==='#bb175Compare,#bbpolUpgradePill,button[data-bbob="premium"],.bb17513-meal-premium'?[premium]:[]};
 const win={location:{href:'https://localhost/pricing-sandbox.html',assign:url=>writes.push(url)},BBAccountDeletion:{isDeleting:()=>deleting},addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name),MutationObserver:class{constructor(handler){observer=handler;}observe(){observed=true;}disconnect(){observed=false;}}};
 const api=installAndroidMembership({window:win,document:doc,readSession:()=>session,apiURL:path=>'https://basketboss.co.uk'+path,fetch:async(...args)=>{calls.push(args);return answer(...args);}});
 return {api,win,doc,parent,provider,premium,intro,calls,writes,nodes,events,get mutations(){return mutations;},set session(value){session=value;},set answer(value){answer=value;},set deleting(value){deleting=value;},flush(){let loops=0;while(pending&&loops<15){pending=false;loops++;observer();}return {loops,pending};},mutate(){pending=true;}};
}
const session=(actor='member-a',token='synthetic-token')=>({user:{id:actor},access_token:token,expires_at:Date.now()/1000+3600});
test('Android account UI offers sign-in and read-only status without Apple, Google or web purchase plans',async()=>{
 const h=fixture();try{
  assert.equal(h.calls.length,0);assert.equal(h.intro.open,false);assert.equal(h.provider.getAttribute('href'),'https://localhost/pricing-sandbox.html');assert.equal(h.provider.textContent,'Sign in');
  assert.match(h.parent.textContent,/New purchases are not available in this Android test build/);assert.doesNotMatch(h.parent.textContent,/Subscribe with Apple|Start 7-day|Restore Purchases/);
  assert.equal(h.win.BasketBossNativeTrialOffer.isEligible(),false);assert.equal(h.win.BasketBossVerifiedPremium,undefined);assert.deepEqual(h.writes,[]);
  h.flush();const before=h.mutations;for(let i=0;i<4;i++){h.mutate();assert.equal(h.flush().pending,false);}assert.equal(h.mutations,before,'unchanged DOM mutations do not restart observer writes');
 }finally{h.api.destroy();}
});
test('only authenticated current-session server membership changes the Android label',async()=>{
 const h=fixture();try{
  h.session=session();h.answer=async()=>Response.json({authenticated:true,premiumAccess:true,tier:'owner',mode:'live'});assert.equal(await h.api.refresh(),true);h.flush();assert.equal(h.premium.textContent,'PREMIUM');assert.equal(h.win.BasketBossNativeMembershipState,'premium');
  assert.equal(h.calls[0][1].headers.Authorization,'Bearer synthetic-token');assert.equal(h.calls[0][1].credentials,'omit');assert.equal(h.calls[0][1].cache,'no-store');assert.equal(h.win.BasketBossVerifiedPremium,undefined,'presentation never creates a Premium authorisation flag');
  for(const body of [{premiumAccess:true},{authenticated:true,premiumAccess:true,tier:'free',mode:'live'},{authenticated:true,premiumAccess:true,tier:'owner',mode:'unknown'}]){h.answer=async()=>Response.json(body);assert.equal(await h.api.refresh(),false);h.flush();assert.equal(h.premium.textContent,'Check membership');}
  h.answer=async()=>Response.json({authenticated:true,premiumAccess:false});await h.api.refresh();h.flush();assert.equal(h.premium.textContent,'FREE · Account');assert.deepEqual(h.writes,[]);
 }finally{h.api.destroy();}
});
test('delayed membership responses cannot leak a former actor or token into the new account UI',async()=>{
 for(const change of ['actor','token','deletion']){
  const h=fixture();try{
   let finish;h.session=session();h.answer=()=>new Promise(resolve=>{finish=resolve;});const pending=h.api.refresh();
   if(change==='deletion'){h.deleting=true;h.events.get('basketboss:account-deletion-started')();}else h.session=session(change==='actor'?'member-b':'member-a',change==='token'?'replacement-token':'synthetic-token');
   finish(Response.json({authenticated:true,premiumAccess:true,tier:'premium',mode:'live'}));assert.equal(await pending,false);assert.notEqual(h.win.BasketBossNativeMembershipState,'premium');assert.deepEqual(h.writes,[]);
  }finally{h.api.destroy();}
 }
});
test('expired sessions do not call status and server/network failures remain non-Premium',async()=>{
 const h=fixture();try{
  h.session={...session(),expires_at:1};await h.api.refresh();assert.equal(h.calls.length,0);
  h.session=session();h.answer=async()=>new Response('{}',{status:401});await h.api.refresh();assert.equal(h.win.BasketBossNativeMembershipState,'signed_out');
  h.answer=async()=>{throw Error('synthetic offline');};await h.api.refresh();assert.equal(h.win.BasketBossNativeMembershipState,'unavailable');assert.equal(h.win.BasketBossVerifiedPremium,undefined);
  h.api.destroy();const count=h.calls.length;await h.api.refresh();assert.equal(h.calls.length,count);
 }finally{h.api.destroy();}
});
