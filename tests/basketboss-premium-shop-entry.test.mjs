import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../bb-premium-features.js',import.meta.url),'utf8');
function fixture(paid=false,options={}){
 let premium=paid,focus=null,starts=0,approvals=0;
 const listeners=new Map(),nodes=new Map(),buttons=[],microtasks=[],requests=[],navigations=[],timers=new Map();let timerId=0;const location={hostname:'basketboss.co.uk',hash:'',assign:url=>navigations.push(url)};
 const matches=(node,selectors)=>selectors.split(',').some(value=>{const selector=value.trim();return selector.startsWith('#')?node.id===selector.slice(1):selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):false;});
 class Node{
  constructor(id='',className=''){this.id=id;this.className=className;this.dataset={};this.attributes={};this.handlers={};this.children=new Map();this.open=false;this.textContent='';this.hidden=false;}
  querySelector(selector){return this.children.get(selector)||null;}
  querySelectorAll(selector){return selector==='.bb173-tier-plans a'?this.plans||[]:[];}
  closest(selectors){return matches(this,selectors)?this:null;}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]||null;}
  removeAttribute(name){delete this.attributes[name];}
  focus(){focus=this;}
  showModal(){this.open=true;}
  close(){this.open=false;}
 }
 const document={activeElement:null,querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selectors=>buttons.filter(button=>matches(button,selectors)),addEventListener(type,fn,capture=false){const list=listeners.get(type)||[];list.push({fn,capture});listeners.set(type,list);},body:{insertAdjacentHTML(){
  if(nodes.has('#bb173TierDialog'))return;
  const dialog=new Node('bb173TierDialog'),description=new Node(),status=new Node(),close=new Node();dialog.plans=['monthly','founder'].map(plan=>{const link=new Node('',plan);link.hash='#'+plan;link.href='https://basketboss.co.uk/pricing-sandbox.html'+link.hash;link.closest=selector=>selector==='.bb173-tier-plans a'?link:null;return link;});dialog.children.set('[data-bb173-close]',close);dialog.children.set('#bb173CheckoutStatus',status);nodes.set('#bb173TierDialog',dialog);nodes.set('#bb173TierDesc',description);nodes.set('#bb173CheckoutStatus',status);
 }}};
 const window={BBShoppingLaunch:{start:()=>{approvals++;}},BasketBossVerifiedPremium:{isActive:()=>premium},addEventListener(){}};
 vm.runInNewContext(code,{window,document,location,AbortController,fetch:(url,input)=>{requests.push({url,input});return options.fetch?.(url,input)||Promise.resolve({ok:true,json:async()=>({enabled:false,mode:'live'})});},setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),queueMicrotask:fn=>microtasks.push(fn)});
 function button(id,className=''){
  const node=new Node(id,className);node.onclick=()=>{starts++;nodes.set('#bb172Storefront',new Node('bb172Storefront'));};buttons.push(node);return node;
 }
 const desktop=button('','bb1745-go-button'),main=button('bb172ShopModeButton'),mode=button('bb172StoreMode');
 function click(node,{child=false}={}){
  const event={target:child?{closest:selector=>node.closest(selector)}:node,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  for(const listener of listeners.get('click')||[]){if(listener.capture)listener.fn(event);if(event.stopped)break;}
  if(!event.stopped)node.onclick?.();return event;
 }
 return {desktop,main,mode,document,nodes,click,requests,navigations,timers,openPremium(){window.BasketBossPremiumPreview.show();return nodes.get('#bb173TierDialog');},dialogEvent(type,target){const dialog=nodes.get('#bb173TierDialog');return Promise.all((dialog.handlers[type]||[]).map(fn=>fn({target,preventDefault(){}})));},setPremium:value=>{premium=value;},get starts(){return starts;},get approvals(){return approvals;},get focus(){return focus;},boot(){for(const {fn}of listeners.get('DOMContentLoaded')||[])fn();while(microtasks.length)microtasks.shift()();}};
}

test('all three advanced Shop launchers delegate Free clicks before their original storefront handler',()=>{
 for(const name of ['desktop','main','mode']){
  const h=fixture(),event=h.click(h[name],{child:true});assert.equal(event.prevented,true,name);assert.equal(event.stopped,true,name);assert.equal(h.starts,0,name);assert.equal(h.nodes.has('#bb172Storefront'),false,name);assert.equal(h.approvals,1,name);assert.equal(h.nodes.has('#bb173TierDialog'),false,name);
 }
});

test('Premium and Free desktop clicks both use fresh central server approval',()=>{
 const h=fixture(true);let event=h.click(h.desktop,{child:true});assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(h.starts,0);assert.equal(h.approvals,1);assert.equal(h.nodes.has('#bb173TierDialog'),false);
 h.setPremium(false);event=h.click(h.desktop);assert.equal(event.stopped,true);assert.equal(h.starts,0);assert.equal(h.approvals,2);
});

test('basic shopping checklist controls remain available to Free users',()=>{
 const h=fixture();let checked=false;
 const checkbox={closest(){return null;},onclick(){checked=!checked;}};
 const event=h.click(checkbox);assert.equal(checked,true);assert.equal(event.prevented,false);assert.equal(event.stopped,false);assert.equal(h.nodes.has('#bb173TierDialog'),false);
});

test('the desktop shortcut describes the same weekly Free allowance as the other launchers',()=>{
 const h=fixture();h.boot();
 for(const node of [h.desktop,h.main,h.mode]){assert.equal(node.dataset.bb173Marked,'1');assert.equal(node.getAttribute('title'),'Advanced Shop Mode · 1 Free trip per week. Unlimited with Premium.');}
});

test('Premium plan taps lock both choices immediately and coalesce one availability request',async()=>{
 let resolve;const response=new Promise(done=>{resolve=done;}),h=fixture(false,{fetch:()=>response}),dialog=h.openPremium();
 const first=h.dialogEvent('click',dialog.plans[0]);assert.equal(dialog.getAttribute('aria-busy'),'true');assert.ok(dialog.plans.every(link=>link.getAttribute('aria-disabled')==='true'));
 await h.dialogEvent('click',dialog.plans[1]);assert.equal(h.requests.length,1);
 resolve({ok:true,json:async()=>({enabled:true,mode:'live'})});await first;
 assert.deepEqual(h.navigations,[dialog.plans[0].href]);assert.equal(dialog.getAttribute('aria-busy'),null);assert.ok(dialog.plans.every(link=>link.getAttribute('aria-disabled')===null));assert.equal(h.timers.size,0);
});

test('a stalled Premium availability check times out and permits retry without navigation',async()=>{
 const h=fixture(false,{fetch:(_url,input)=>new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(Error('synthetic supermarket offline')),{once:true}))}),dialog=h.openPremium();
 const pending=h.dialogEvent('click',dialog.plans[0]);const timer=[...h.timers.values()][0];assert.equal(timer.delay,15000);timer.fn();await pending;
 assert.equal(dialog.getAttribute('aria-busy'),null);assert.equal(h.navigations.length,0);assert.match(h.nodes.get('#bb173CheckoutStatus').textContent,/not available yet/);assert.equal(h.timers.size,0);
 const retry=h.dialogEvent('click',dialog.plans[1]);assert.equal(h.requests.length,2);[...h.timers.values()][0].fn();await retry;
});

test('closing a Premium availability check aborts it and ignores a late live response after reopening',async()=>{
 let resolve;const response=new Promise(done=>{resolve=done;}),h=fixture(false,{fetch:()=>response}),dialog=h.openPremium();
 const pending=h.dialogEvent('click',dialog.plans[0]);await h.dialogEvent('cancel',dialog);assert.equal(h.requests[0].input.signal.aborted,true);assert.equal(dialog.open,false);assert.equal(dialog.getAttribute('aria-busy'),null);
 h.openPremium();resolve({ok:true,json:async()=>({enabled:true,mode:'live'})});await pending;
 assert.equal(h.navigations.length,0);assert.equal(h.nodes.get('#bb173CheckoutStatus').hidden,true);assert.equal(h.timers.size,0);
});
