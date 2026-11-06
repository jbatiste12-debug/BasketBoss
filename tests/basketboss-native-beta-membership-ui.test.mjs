import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeMembership} from '../native/membership.mjs';

function fixture({settings=false,native=true,authenticated=true}={}){
 const nodes=[],listeners=new Set(),calls={claims:0,signin:0,subscriptions:[],refreshes:0};
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
 const purchases={refresh:async()=>{calls.refreshes++;return state;},subscribe:async productId=>{calls.subscriptions.push(productId);return {ok:true};},claimBeta:async()=>{calls.claims++;},subscribeState(listener){listeners.add(listener);listener(state);return ()=>listeners.delete(listener);}};
 const emit=change=>{state={...state,...change};for(const listener of listeners)listener(state);};
 class Observer{observe(){}disconnect(){}}
 return {doc,win,Observer,parent,calls,purchases,emit,find:cls=>nodes.find(node=>node.className.split(' ').includes(cls)),session:()=>authenticated?{access_token:'test-session',expires_at:Date.now()/1000+3600,user:{id:'test-actor'}}:null};
}
async function withFixture(options,run){
 const h=fixture(options),previous=globalThis.MutationObserver;globalThis.MutationObserver=h.Observer;let controller;
 try{controller=installNativeMembership({document:h.doc,window:h.win,readSession:h.session,purchases:h.purchases,apiURL:path=>'https://basketboss.co.uk'+path});await run(h);}
 finally{controller?.destroy();if(previous===undefined)delete globalThis.MutationObserver;else globalThis.MutationObserver=previous;}
}

test('shipping Paywall and Settings offer Apple plans without any beta activation control',async()=>{
 for(const settings of [false,true])await withFixture({settings},async h=>{
  assert.equal(h.find('bb-native-beta-unlock'),undefined);assert.doesNotMatch(h.parent.textContent,/Unlock TestFlight|eligible TestFlight builds/);
  assert.equal(h.find('bb-native-apple-plans').hidden,false);assert.equal(h.find('bb-native-existing-access').hidden,true);
  for(const button of h.find('bb-native-apple-plans').children)button.click();
  assert.equal(h.calls.claims,0);assert.equal(h.calls.subscriptions.length,2);
 });
});

test('web and signed-out renderers have no beta activation and signed-out Apple actions open sign-in',async()=>{
 for(const options of [{native:false},{authenticated:false}])await withFixture(options,async h=>{
  assert.equal(h.find('bb-native-beta-unlock'),undefined);assert.equal(h.calls.claims,0);
  if(options.authenticated===false){h.find('bb-native-apple-plans').children[0].click();assert.equal(h.calls.signin,1);assert.deepEqual(h.calls.subscriptions,[]);}
 });
});

test('verified beta membership retains the Apple purchase options and shows its separate complimentary expiry',async()=>withFixture({},async h=>{
 h.emit({premiumAccess:true,membershipState:'premium',provider:'testflight_beta',beta:{expiresAt:'2026-12-01T00:00:00.000Z'},message:'Your complimentary Premium access is active.'});
 assert.equal(h.find('bb-native-beta-unlock'),undefined);assert.equal(h.find('bb-native-apple-plans').hidden,false);
 const existing=h.find('bb-native-existing-access');assert.equal(existing.hidden,false);assert.match(existing.textContent,/complimentary Premium access is active until.*2026/);assert.match(existing.textContent,/No subscription or renewal charge/);assert.equal(h.calls.claims,0);
 h.emit({premiumAccess:false,membershipState:'signed_out',authenticated:false,provider:null,beta:null});assert.equal(existing.hidden,true);assert.equal(existing.textContent,'');
}));


test('fixed monthly and annual Apple CTAs stay primary and retry missing prices',async()=>{
 for(const settings of [false,true])await withFixture({settings},async h=>{
  const plans=h.find('bb-native-apple-plans'),controls=h.find('bb-native-apple-actions'),status=h.find('bb-native-apple-catalogue-state');
  assert.equal(plans.hidden,false);assert.equal(plans.children.length,2);assert.ok(h.parent.children[0].children.indexOf(plans)<h.parent.children[0].children.indexOf(controls));
  const expected=['uk.co.basketboss.premium.monthly','uk.co.basketboss.premium.annual'];
  for(const [index,button]of plans.children.entries()){
   assert.equal(button.disabled,false);assert.equal(button.getAttribute('data-apple-product'),expected[index]);assert.match(button.textContent,/Price shown by Apple.*Try Apple subscription/);button.click();
  }
  assert.deepEqual(h.calls.subscriptions,expected);assert.match(status.textContent,/prices could not be loaded/);
  h.emit({busy:true});for(const button of plans.children)assert.equal(button.disabled,true);
 });
});

test('verified sandbox test eligibility preserves Apple testing and Production coverage without beta activation',async()=>withFixture({},async h=>{
 h.emit({premiumAccess:true,membershipState:'premium',provider:'testflight_beta',sandboxPurchaseAllowed:true,productLoadState:'empty'});
 const plans=h.find('bb-native-apple-plans');assert.equal(plans.hidden,false);assert.equal(plans.children.length,2);assert.match(plans.textContent,/Test subscription with Apple/);
 assert.match(h.find('bb-native-apple-testing').textContent,/Sandbox purchase testing/);plans.children[0].click();assert.deepEqual(h.calls.subscriptions,['uk.co.basketboss.premium.monthly']);
 h.emit({premiumAccess:true,provider:'paddle',sandboxPurchaseAllowed:false});assert.equal(plans.hidden,false);assert.match(h.find('bb-native-apple-testing').textContent,/existing membership covers Premium/);
 assert.equal(h.find('bb-native-beta-unlock'),undefined);assert.equal(h.calls.claims,0);assert.equal(h.find('bb-native-existing-access').hidden,true);
}));
