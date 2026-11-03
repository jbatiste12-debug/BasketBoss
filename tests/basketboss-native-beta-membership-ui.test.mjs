import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeMembership} from '../native/membership.mjs';

function fixture({settings=false,native=true,authenticated=true}={}){
 const nodes=[],listeners=new Set(),calls={claims:0,signin:0};
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.className='';this.ownText='';this.hidden=false;this.disabled=false;this.attrs={};this.dataset={};nodes.push(this);this.classList={contains:name=>this.className.split(' ').includes(name),add:name=>{this.className+=' '+name;}};}
  get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get isConnected(){return this===doc.body||this.parentElement?.isConnected===true;}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.ownText='';this.append(...children);}
  getAttribute(name){return this.attrs[name]??null;}
  setAttribute(name,value){this.attrs[name]=String(value);}
  click(){if(!this.hidden&&!this.disabled)this.dispatchEvent(new Event('click'));}
 }
 const doc={createElement:tag=>new Element(tag),createTextNode:value=>{const node=new Element('span');node.textContent=value;return node;},getElementById:id=>nodes.find(node=>node.id===id)||null,querySelectorAll:selector=>selector==='a[href]'?nodes.filter(node=>node.tagName==='A'&&node.getAttribute('href')):[]};
 doc.body=new Element('body');const parent=new Element('section');parent.id=settings?'bbuiLinksSection':'bbNativeMembershipMount';doc.body.append(parent);
 const login=new Element('button');login.id='cloud-open';login.addEventListener('click',()=>calls.signin++);doc.body.append(login);
 const win=new EventTarget();win.location={href:native?'capacitor://localhost/'+(settings?'index.html':'pricing-sandbox.html'):'https://basketboss.co.uk/app',hash:'',assign:()=>{}};win.BBNative=native?{isNative:true,platform:'ios'}:null;
 let state={authenticated,premiumAccess:false,provider:null,beta:null,products:[],available:false,busy:false,membershipState:authenticated?'free':'signed_out',message:'Apple subscription prices could not be loaded.'};
 const purchases={refresh:async()=>state,claimBeta:async()=>{calls.claims++;},subscribeState(listener){listeners.add(listener);listener(state);return ()=>listeners.delete(listener);}};
 const emit=change=>{state={...state,...change};for(const listener of listeners)listener(state);};
 class Observer{observe(){}disconnect(){}}
 return {doc,win,Observer,parent,calls,purchases,emit,find:cls=>nodes.find(node=>node.className.split(' ').includes(cls)),session:()=>authenticated?{access_token:'test-session',expires_at:Date.now()/1000+3600,user:{id:'test-actor'}}:null};
}
async function withFixture(options,run){
 const h=fixture(options),previous=globalThis.MutationObserver;globalThis.MutationObserver=h.Observer;let controller;
 try{controller=installNativeMembership({document:h.doc,window:h.win,readSession:h.session,purchases:h.purchases,apiURL:path=>'https://basketboss.co.uk'+path});await run(h);}
 finally{controller?.destroy();if(previous===undefined)delete globalThis.MutationObserver;else globalThis.MutationObserver=previous;}
}

test('Paywall and Settings show a direct beta unlock even when Apple prices are unavailable',async()=>{
 for(const settings of [false,true])await withFixture({settings},async h=>{
  const button=h.find('bb-native-beta-unlock');assert.equal(button.textContent,'Unlock TestFlight Beta Premium');assert.equal(button.hidden,false);assert.equal(button.disabled,false);
  assert.equal(h.find('bb-native-apple-plans').hidden,true);assert.match(h.parent.textContent,/without starting a subscription/);
  button.click();assert.equal(h.calls.claims,1);h.emit({busy:true});assert.equal(button.disabled,true);button.click();assert.equal(h.calls.claims,1);
 });
});

test('beta unlock is not presented to web or signed-out users',async()=>{
 for(const options of [{native:false},{authenticated:false}])await withFixture(options,async h=>{
  const button=h.find('bb-native-beta-unlock');assert.equal(button.hidden,true);button.click();assert.equal(h.calls.claims,0);
 });
});

test('verified beta membership shows expiry and no renewal charge without offering another purchase',async()=>withFixture({},async h=>{
 h.emit({premiumAccess:true,membershipState:'premium',provider:'testflight_beta',beta:{expiresAt:'2026-12-01T00:00:00.000Z'},message:'TestFlight Beta Premium is active.'});
 assert.equal(h.find('bb-native-beta-unlock').disabled,true);assert.equal(h.find('bb-native-apple-plans').hidden,true);assert.match(h.parent.textContent,/active until.*2026/);assert.match(h.parent.textContent,/No subscription or renewal charge/);
 h.find('bb-native-beta-unlock').click();assert.equal(h.calls.claims,0);
}));
