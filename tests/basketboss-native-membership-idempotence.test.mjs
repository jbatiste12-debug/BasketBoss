import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeMembership} from '../native/membership.mjs';
import {isNativeBillingURL,nativeMembershipURL} from '../native/routing.mjs';

// Keep the literal Capacitor origin: localhost HTTP is not an app/billing
// origin and cannot reproduce this native MutationObserver starvation bug.
function fixture(){
 let observed=false,pending=false,mutations=0,callback,observer;
 const nodes=[],events=new Map();
 const changed=()=>{if(observed){pending=true;mutations++;}};
 class Element{
  constructor(tag,text=''){this.tagName=tag.toUpperCase();this.dataset={};this.attrs={};this.children=[];this._text=text;this.classes=new Set();this.open=false;nodes.push(this);this.classList={contains:name=>this.classes.has(name),add:name=>this.classes.add(name)};}
  set textContent(value){this._text=String(value);this.children=[];changed();}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  getAttribute(name){return this.attrs[name]??null;}
  setAttribute(name,value){this.attrs[name]=String(value);}
  append(...children){this.children.push(...children);changed();}
  replaceChildren(...children){this._text='';this.children=[...children];changed();}
  close(){this.open=false;}
  addEventListener(){}
 }
 const premium=new Element('a','⭐ Premium plans');premium.classes.add('bb17513-meal-premium');premium.setAttribute('href','pricing-sandbox.html?bb_native_doc=exact-build');
 const provider=new Element('a','Manage subscription');provider.setAttribute('href','https://billing.stripe.com/p/session');
 const privacy=new Element('a','Privacy');privacy.setAttribute('href','/privacy');
 const plan=new Element('div','Start a Premium trial');plan.classes.add('bbob-plan-premium');
 const footnote=new Element('p','Founder trial uses Paddle checkout.');
 const compare=new Element('button','Compare Premium');
 const shortcut=new Element('button','Premium account');
 const doc={body:{},createElement:tag=>new Element(tag),getElementById:id=>id==='bb16AccountShortcut'?shortcut:null,
  querySelectorAll(selector){
   if(selector==='a[href]')return nodes.filter(node=>node.tagName==='A'&&node.getAttribute('href'));
   if(selector==='.bb17513-meal-premium')return [premium];
   if(selector==='.bbob-plan-premium')return [plan];
   if(selector==='.bbob-footnote')return [footnote];
   if(selector==='#bb175Compare,button[data-bbob="premium"]')return [compare];
   return [];
  }};
 const win={location:{href:'capacitor://localhost/make-a-meal.html',hash:'',assign(){throw Error('No navigation during presentation cleanup');}},addEventListener:(name,listener)=>events.set(name,listener),removeEventListener:name=>events.delete(name)};
 class Observer{constructor(fn){callback=fn;observer=this;}observe(target,options){assert.equal(target,doc.body);assert.equal(options.childList,true);assert.equal(options.subtree,true);observed=true;}disconnect(){observed=false;pending=false;}}
 return {doc,win,Observer,premium,provider,privacy,plan,footnote,compare,shortcut,events,get observer(){return observer;},get mutations(){return mutations;},
  mutate(){pending=true;},flush(max=12){let runs=0;while(pending&&runs<max){pending=false;runs++;callback([{type:'childList'}]);}return {runs,pending};},
  addBillingLink(){const link=new Element('a','Buy Premium');link.setAttribute('href','https://buy.stripe.com/example');changed();return link;}};
}
async function withFixture(run){
 const h=fixture(),previous=globalThis.MutationObserver;globalThis.MutationObserver=h.Observer;
 let membership;
 try{
  membership=installNativeMembership({document:h.doc,window:h.win,readSession:()=>null,apiURL:path=>'https://basketboss.co.uk'+path,fetch:()=>{throw Error('No account/network request is needed for this cleanup');}});
  await run(h);
 }finally{membership?.destroy();if(previous===undefined)delete globalThis.MutationObserver;else globalThis.MutationObserver=previous;}
}

test('Cook account link cleanup settles on the real Capacitor origin rather than starving the native event loop',async()=>withFixture(h=>{
 assert.equal(isNativeBillingURL(h.premium.getAttribute('href'),h.win.location.href),true);
 assert.equal(h.premium.getAttribute('href'),nativeMembershipURL(h.win.location.href));
 const before=h.mutations;
 h.mutate();assert.deepEqual(h.flush(),{runs:1,pending:false});
 assert.equal(h.mutations,before,'an unrelated DOM change must not trigger cleanup writes');
 assert.equal(h.premium.textContent,'Your account status');
 assert.equal(h.premium.getAttribute('aria-label'),'View your BasketBoss account status');
 for(let i=0;i<4;i++){h.mutate();assert.deepEqual(h.flush(),{runs:1,pending:false});}
 assert.equal(h.premium.textContent,'Your account status');
}));

test('native billing redirection, setup disclosures and late links stay guarded while the observer becomes idle',async()=>withFixture(h=>{
 assert.equal(h.provider.getAttribute('href'),'capacitor://localhost/pricing-sandbox.html');
 assert.equal(h.provider.textContent,'Your account status');
 assert.equal(h.privacy.getAttribute('href'),'/privacy');assert.equal(h.privacy.textContent,'Privacy');
 assert.equal(h.shortcut.textContent,'Account');assert.equal(h.compare.textContent,'Your account status');
 assert.equal(h.plan.dataset.nativeMembership,'true');assert.match(h.plan.textContent,/Purchases are not offered/);
 assert.match(h.footnote.textContent,/Purchases are not available/);
 const late=h.addBillingLink();assert.deepEqual(h.flush(),{runs:2,pending:false});
 assert.equal(late.getAttribute('href'),'capacitor://localhost/pricing-sandbox.html');assert.equal(late.textContent,'Your account status');
 const before=h.mutations;h.mutate();assert.deepEqual(h.flush(),{runs:1,pending:false});assert.equal(h.mutations,before);
}));
