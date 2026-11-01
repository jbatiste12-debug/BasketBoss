import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../bb-premium-features.js',import.meta.url),'utf8');
function fixture(paid=false){
 let premium=paid,focus=null,starts=0;
 const listeners=new Map(),nodes=new Map(),buttons=[],microtasks=[];
 const matches=(node,selectors)=>selectors.split(',').some(value=>{const selector=value.trim();return selector.startsWith('#')?node.id===selector.slice(1):selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):false;});
 class Node{
  constructor(id='',className=''){this.id=id;this.className=className;this.dataset={};this.attributes={};this.handlers={};this.children=new Map();this.open=false;this.textContent='';this.hidden=false;}
  querySelector(selector){return this.children.get(selector)||null;}
  closest(selectors){return matches(this,selectors)?this:null;}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]||null;}
  focus(){focus=this;}
  showModal(){this.open=true;}
  close(){this.open=false;}
 }
 const document={activeElement:null,querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selectors=>buttons.filter(button=>matches(button,selectors)),addEventListener(type,fn,capture=false){const list=listeners.get(type)||[];list.push({fn,capture});listeners.set(type,list);},body:{insertAdjacentHTML(){
  if(nodes.has('#bb173TierDialog'))return;
  const dialog=new Node('bb173TierDialog'),description=new Node(),status=new Node(),close=new Node();dialog.children.set('[data-bb173-close]',close);dialog.children.set('#bb173CheckoutStatus',status);nodes.set('#bb173TierDialog',dialog);nodes.set('#bb173TierDesc',description);nodes.set('#bb173CheckoutStatus',status);
 }}};
 const window={BasketBossVerifiedPremium:{isActive:()=>premium},addEventListener(){}};
 vm.runInNewContext(code,{window,document,location:{hostname:'basketboss.co.uk',hash:''},queueMicrotask:fn=>microtasks.push(fn)});
 function button(id,className=''){
  const node=new Node(id,className);node.onclick=()=>{starts++;nodes.set('#bb172Storefront',new Node('bb172Storefront'));};buttons.push(node);return node;
 }
 const desktop=button('','bb1745-go-button'),main=button('bb172ShopModeButton'),mode=button('bb172StoreMode');
 function click(node,{child=false}={}){
  const event={target:child?{closest:selector=>node.closest(selector)}:node,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  for(const listener of listeners.get('click')||[]){if(listener.capture)listener.fn(event);if(event.stopped)break;}
  if(!event.stopped)node.onclick?.();return event;
 }
 return {desktop,main,mode,document,nodes,click,setPremium:value=>{premium=value;},get starts(){return starts;},get focus(){return focus;},boot(){for(const {fn}of listeners.get('DOMContentLoaded')||[])fn();while(microtasks.length)microtasks.shift()();}};
}

test('all three advanced Shop launchers stop Free clicks before their original storefront handler',()=>{
 for(const name of ['desktop','main','mode']){
  const h=fixture(),event=h.click(h[name],{child:true});assert.equal(event.prevented,true,name);assert.equal(event.stopped,true,name);assert.equal(h.starts,0,name);assert.equal(h.nodes.has('#bb172Storefront'),false,name);assert.equal(h.nodes.get('#bb173TierDialog').open,true,name);
 }
});

test('verified Premium desktop clicks retain the original Shop launch and check current membership each time',()=>{
 const h=fixture(true);let event=h.click(h.desktop,{child:true});assert.equal(event.prevented,false);assert.equal(event.stopped,false);assert.equal(h.starts,1);assert.equal(h.nodes.has('#bb173TierDialog'),false);
 h.setPremium(false);event=h.click(h.desktop);assert.equal(event.stopped,true);assert.equal(h.starts,1,'a later Free click cannot invoke the launch handler again');
});

test('basic shopping checklist controls remain available to Free users',()=>{
 const h=fixture();let checked=false;
 const checkbox={closest(){return null;},onclick(){checked=!checked;}};
 const event=h.click(checkbox);assert.equal(checked,true);assert.equal(event.prevented,false);assert.equal(event.stopped,false);assert.equal(h.nodes.has('#bb173TierDialog'),false);
});

test('the desktop shortcut receives the same existing Premium marker as the other advanced launchers',()=>{
 const h=fixture();h.boot();
 for(const node of [h.desktop,h.main,h.mode]){assert.equal(node.dataset.bb173Marked,'1');assert.equal(node.getAttribute('title'),'Advanced Shop Mode · Premium preview');}
});
