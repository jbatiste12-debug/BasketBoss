import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {install}=createRequire(import.meta.url)('../bb-tab-viewport.js');
const KEY='basketboss_tab_navigation_v1';

function fixture({view='week',href='https://basketboss.co.uk/index.html',session=new Map()}={}){
 const frames=new Map(),scrolls=[],watchers=[];let frameId=0;
 const events=()=>{const handlers=new Map();return {addEventListener(type,fn){const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);},removeEventListener(type,fn){handlers.set(type,(handlers.get(type)||[]).filter(value=>value!==fn));},fire(type,event={}){for(const fn of [...handlers.get(type)||[]])fn({type,...event});}};};
 class Node{
  constructor(id='',tag='DIV'){this.id=id;this.tagName=tag;this.dataset={};this.attrs=new Map();this.children=[];this.parentNode=null;this.hidden=false;this.isConnected=true;this.scrollTop=300;this.scrollLeft=8;this.className='';this.computed={display:'block',visibility:'visible',position:'static',zIndex:'0'};this.rect={top:0,bottom:600,left:0,right:390,width:390,height:600};const styles=new Map();this.style={getPropertyValue:name=>styles.get(name)||'',setProperty:(name,value)=>styles.set(name,value)};this.classList={contains:name=>this.className.split(/\s+/).includes(name)};}
  setAttribute(name,value){this.attrs.set(name,String(value));}getAttribute(name){return this.attrs.get(name)??null;}hasAttribute(name){return this.attrs.has(name);}removeAttribute(name){this.attrs.delete(name);}
  append(node){node.parentNode=this;this.children.push(node);}
  contains(node){for(let current=node;current;current=current.parentNode)if(current===this)return true;return false;}
  getClientRects(){return this.hidden||this.computed.display==='none'?[]:[this.rect];}getBoundingClientRect(){return this.rect;}
  querySelector(selector){return selector==='.nav-label'?this.label||null:selector==='.bb172-storefront-bottom'?this.footer||null:null;}
  closest(selector){if(selector.includes('nav.tabs')&&nav.contains(this))return nav;if(selector==='.cook-panel'&&panel.contains(this))return panel;return null;}
  scrollTo({top,left}){this.scrollTop=top;this.scrollLeft=left;}
 }
 const body=new Node('body','BODY');body.dataset.bbnextView=view;const html=new Node('html','HTML'),app=new Node('app'),nav=new Node('nav','NAV'),panel=new Node('cook-panel'),storefront=new Node('bb172Storefront'),overview=new Node('bbReleaseShopOverview');storefront.hidden=true;overview.hidden=true;
 const overlays=[],bars=[],byId=new Map([html,body,app,storefront,overview].map(node=>[node.id,node]));
 const doc={...events(),readyState:'complete',documentElement:html,body,scrollingElement:html,getElementById:id=>byId.get(id)||null,querySelector:selector=>selector==='main,.page'?app:null,querySelectorAll:selector=>selector.includes('dialog[open]')?overlays:selector.includes('[data-bb-tab-action-bar]')?bars:[]};
 const win={...events(),document:doc,location:{href},innerHeight:844,scrollY:500,sessionStorage:{getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},getComputedStyle:node=>node.computed,requestAnimationFrame(fn){const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),scrollTo(options){scrolls.push(options);win.scrollY=options.top;},MutationObserver:class{constructor(fn){watchers.push(fn);}observe(){}disconnect(){}}};
 const controller=install(win);
 const flush=()=>{for(let count=0;frames.size&&count<20;count++){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();}assert.equal(frames.size,0,'scheduled viewport work settles');};
 const button=(tab,tag='BUTTON',target=null)=>{const node=new Node('',tag);node.dataset.tab=tab;if(target)node.setAttribute('href',target);nav.append(node);return node;};
 return {win,doc,html,app,nav,panel,body,storefront,overview,overlays,bars,scrolls,controller,session,Node,button,flush,change(next){body.dataset.bbnextView=next;for(const fn of watchers)fn();},click(node){doc.fire('click',{isTrusted:true,button:0,target:{closest:()=>node}});}};
}

test('each primary view starts at the document top, while an ordinary rerender preserves scroll',()=>{
 const h=fixture();for(const next of ['discover','shop','shop-list','cook','week']){h.win.scrollY=500;h.html.scrollTop=500;h.app.scrollTop=300;h.change(next);h.flush();assert.equal(h.win.scrollY,0,next);assert.equal(h.html.scrollTop,0);assert.equal(h.app.scrollTop,0);}
 h.win.scrollY=410;h.app.scrollTop=170;h.change('week');h.flush();assert.equal(h.win.scrollY,410);assert.equal(h.app.scrollTop,170);assert.equal(h.html.getAttribute('data-bb-tab-viewport'),'document');
});

test('zero-area overlay placeholders cannot lock tabs; a visible modal defers the reset until closed',()=>{
 const h=fixture(),empty=new h.Node('bb172Onboarding');empty.rect={top:0,bottom:0,left:0,right:0,width:0,height:0};h.overlays.push(empty);h.controller.reset({view:'week'});h.flush();assert.equal(h.win.scrollY,0);assert.equal(h.html.hasAttribute('data-bb-tab-scroll-lock'),false);
 const modal=new h.Node('dialog');h.overlays.push(modal);h.win.scrollY=600;h.controller.reset({view:'week'});h.flush();assert.equal(h.win.scrollY,600);assert.equal(h.html.getAttribute('data-bb-tab-scroll-lock'),'overlay');modal.hidden=true;h.controller.refresh();h.flush();assert.equal(h.win.scrollY,0);assert.equal(h.html.hasAttribute('data-bb-tab-scroll-lock'),false);
});

test('manual scrolling cancels a pending navigation reset',()=>{
 const h=fixture();h.controller.reset({view:'week'});h.win.fire('wheel',{isTrusted:true});h.flush();assert.equal(h.win.scrollY,500);assert.deepEqual(h.scrolls,[]);
});

test('same-tab dock selection resets once and modified links preserve ordinary browser navigation',()=>{
 const h=fixture(),control=h.button('week');h.click(control);h.flush();assert.equal(h.scrolls.length,1);h.win.scrollY=350;h.doc.fire('click',{isTrusted:true,button:0,ctrlKey:true,target:{closest:()=>control}});h.flush();assert.equal(h.win.scrollY,350);
});

test('changing Cook content tabs resets the panel without moving the background document',()=>{
 const h=fixture(),control=new h.Node('bbPhaseCook','BUTTON');h.panel.append(control);h.click(control);h.flush();assert.equal(h.panel.scrollTop,0);assert.equal(h.win.scrollY,500);assert.deepEqual(h.scrolls,[]);
});

test('cross-page Cook navigation carries one short-lived reset marker into the destination',()=>{
 const h=fixture(),control=h.button('cook','A','make-a-meal.html');h.click(control);h.flush();assert.ok(h.session.has(KEY));const next=fixture({view:'cook',href:'https://basketboss.co.uk/make-a-meal.html',session:h.session});next.flush();assert.equal(next.win.scrollY,0);assert.equal(next.session.has(KEY),false);
 const stale=new Map([[KEY,JSON.stringify({version:1,target:'/make-a-meal.html',view:'cook',createdAt:Date.now()-61000})]]),expired=fixture({view:'cook',href:'https://basketboss.co.uk/make-a-meal.html',session:stale});expired.flush();assert.equal(expired.win.scrollY,500);assert.equal(stale.has(KEY),false);
});

test('fixed bottom actions and the in-store footer reserve their measured clearance',()=>{
 const h=fixture(),bar=new h.Node('action');bar.computed.position='fixed';bar.rect={top:744,bottom:844,width:390,height:100};h.bars.push(bar);h.controller.refresh();h.flush();assert.equal(h.html.style.getPropertyValue('--bb-tab-action-clearance'),'116px');
 h.storefront.hidden=false;h.storefront.footer=new h.Node('footer');h.storefront.footer.rect={top:684,bottom:844,width:390,height:160};h.overlays.push(h.storefront);h.controller.refresh();h.flush();assert.equal(h.html.style.getPropertyValue('--bb-tab-storefront-clearance'),'176px');assert.equal(h.html.getAttribute('data-bb-tab-scroll-lock'),'overlay');
});

test('controller installation is idempotent and destroy removes navigation hooks',()=>{
 const h=fixture();assert.equal(install(h.win),h.controller);h.controller.destroy();h.click(h.button('week'));h.flush();assert.deepEqual(h.scrolls,[]);
});
