import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../bb-navigation-polish.js',import.meta.url),'utf8');

function fixture({cook=false,existingId='',unsupported=false}={}){
 const frames=[],watchers=[],windowEvents=new Map();let targets=[];
 class Node{
  constructor(tag,text=''){this.tagName=tag.toUpperCase();this._text=text;this.children=[];this.attributes=new Map();this.classes=new Set();this.id='';this.inner='';this.handlers=new Map();this.parent=null;}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}set textContent(value){this._text=value;this.children=[];}
  get className(){return [...this.classes].join(' ');}set className(value){this.classes=new Set(value.split(' '));}
  get classList(){return {contains:name=>this.classes.has(name),add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)};}
  setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}
  prepend(node){node.parent=this;this.children.unshift(node);}remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
  querySelector(selector){if(selector==='.nav-label')return this.children.find(x=>x.classes.has('nav-label'))||null;if(selector==='.nav-icon')return this.children.find(x=>x.classes.has('nav-icon'))||null;if(selector==='svg')return this.children.find(x=>x.tagName==='SVG')||this.children.map(x=>x.querySelector('svg')).find(Boolean)||null;return null;}
  set innerHTML(value){this.inner=value;this.children=[];if(value.startsWith('<svg')){const svg=new Node('svg');svg.parent=this;this.children=[svg];}}
 }
 const names=['Plan','Discover','Kitchen','Shop','Cook'];if(unsupported)names.pop();
 const nav=new Node('nav');nav.id=existingId;
 nav.children=names.map((name,index)=>{
  const item=new Node(cook?'a':index===4?'a':'button');item.parent=nav;
  const icon=new Node(cook?'svg':'span');icon.parent=item;if(!cook)icon.className='nav-icon';
  const label=new Node('span',name);label.parent=item;if(!cook)label.className='nav-label';item.children=[icon,label];
  if(cook)item.setAttribute('href',index===4?'make-a-meal.html':'index.html?bbview='+['week','discover','shop','shop-list'][index]);
  else if(index===4)item.setAttribute('href','make-a-meal.html');else item.setAttribute('data-tab',['week','discover','shop','shop-list'][index]);
  if(index===(cook?4:1)){item.classes.add('active');item.setAttribute('aria-current','page');}
  item.handlers.set('click',()=>targets.push(name));return item;
 });
 const body=new Node('body');
 const doc={readyState:'complete',body,querySelectorAll:()=>[nav],createElement:tag=>new Node(tag)};
 const win={addEventListener:(name,fn)=>windowEvents.set(name,fn)};
 const context=vm.createContext({document:doc,window:win,MutationObserver:class{constructor(fn){this.fn=fn;watchers.push(this);}observe(node,options){this.node=node;this.options=options;}},requestAnimationFrame:fn=>frames.push(fn)});
 vm.runInContext(source,context);
 return {nav,items:nav.children,body,win,frames,watchers,windowEvents,targets,refresh:()=>win.BBNavigationPolish.refresh()};
}

test('polishing preserves real tab elements, targets, labels, aria and click handlers',()=>{
 for(const cook of [false,true]){
  const h=fixture({cook});
  assert.equal(h.nav.getAttribute('data-bb-navigation'),'polished');assert.equal(h.items.length,5);
  assert.deepEqual(h.items.map(node=>node.textContent),['Plan','Discover','At home','Shop','Cook']);
  assert.deepEqual(h.items.map(node=>node.getAttribute('href')),cook?['index.html?bbview=week','index.html?bbview=discover','index.html?bbview=shop','index.html?bbview=shop-list','make-a-meal.html']:[null,null,null,null,'make-a-meal.html']);
  for(const item of h.items)item.handlers.get('click')();assert.deepEqual(h.targets,['Plan','Discover','Kitchen','Shop','Cook']);
  assert.equal(h.items[cook?4:1].getAttribute('aria-current'),'page');
  assert.equal(h.items.filter(item=>item.getAttribute('data-bb-nav-current')==='true').length,1);
  assert.notEqual(h.items[2].querySelector('.nav-icon').inner,h.items[4].querySelector('.nav-icon').inner,'Kitchen and Cook must remain visually distinct');
 }
});

test('Shop overview presentation follows its actual body state without rewriting Kitchen handlers',()=>{
 const h=fixture();h.items[1].classes.delete('active');h.items[1].attributes.delete('aria-current');h.items[2].classes.add('active');h.items[2].setAttribute('aria-current','page');
 h.body.classes.add('bb-qa-shop-nav-active');h.refresh();
 assert.equal(h.items[3].getAttribute('data-bb-nav-current'),'true');assert.equal(h.items[2].getAttribute('data-bb-nav-current'),'false');
 assert.equal(h.items[2].getAttribute('data-tab'),'shop');assert.equal(h.items[2].getAttribute('aria-current'),'page','existing app state remains authoritative');
 h.body.classes.delete('bb-qa-shop-nav-active');h.refresh();assert.equal(h.items[2].getAttribute('data-bb-nav-current'),'true');
});

test('refresh is stable and observers stay scoped to navigation and body state',()=>{
 const h=fixture({existingId:'existing-navigation'});const icons=h.items.map(item=>item.querySelector('.nav-icon'));
 h.refresh();h.refresh();assert.deepEqual(h.items.map(item=>item.querySelector('.nav-icon')),icons);assert.equal(h.nav.id,'existing-navigation');
 assert.equal(h.watchers.length,2);assert.equal(h.watchers[0].node,h.nav);assert.equal(h.watchers[0].options.subtree,true);
 assert.equal(h.watchers[1].node,h.body);assert.equal(h.watchers[1].options.subtree,undefined,'do not rescan on every app content mutation');
 h.watchers[0].fn();h.watchers[0].fn();assert.equal(h.frames.length,1,'batch repeated navigation mutations');h.frames.shift()();
});

test('unrelated or incomplete navigation is untouched',()=>{
 const h=fixture({unsupported:true});assert.equal(h.nav.getAttribute('data-bb-navigation'),null);assert.equal(h.items.length,4);assert.equal(h.items[0].getAttribute('data-bb-nav-item'),null);
});
