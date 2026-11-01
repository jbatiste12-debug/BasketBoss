import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../bb-ingredient-picker.js',import.meta.url),'utf8');
function fixture(){
 let ids=[],scope='account-a',fail=false,observer;
 const listeners=[],photos=[],writes=[];
 let doc;
 const matches=(node,selector)=>{
  if(selector==='#app.bbnext-plan')return node.id==='app'&&node.className.split(' ').includes('bbnext-plan');
  if(selector.startsWith('#'))return node.id===selector.slice(1);
  if(selector.startsWith('.'))return node.className.split(' ').includes(selector.slice(1));
  if(selector==='[data-bb-avoid-id]')return node.dataset.bbAvoidId!==undefined;
  const match=selector.match(/^\[data-bb-avoid-id="([^"]+)"\]$/);
  return match?node.dataset.bbAvoidId===match[1]:false;
 };
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.className='';this.dataset={};this.attributes={};this.handlers={};this._text='';this.hidden=false;this.value='';this.id='';
   this.classList={toggle:(name,on)=>{const set=new Set(this.className.split(' ').filter(Boolean));if(on)set.add(name);else set.delete(name);this.className=[...set].join(' ');}};
  }
  append(...nodes){for(const node of nodes){node.parentNode?.removeChild(node);node.parentNode=this;this.children.push(node);}}
  removeChild(node){this.children=this.children.filter(item=>item!==node);node.parentNode=null;}
  after(node){const parent=this.parentNode;node.parentNode?.removeChild(node);parent.children.splice(parent.children.indexOf(this)+1,0,node);node.parentNode=parent;}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  set innerHTML(value){this.replaceChildren();this._html=value;}
  get innerHTML(){return this._html||'';}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  fire(type,event={}){for(const fn of this.handlers[type]||[])fn(event);}
  click(){this.fire('click');}
  focus(){doc.activeElement=this;}
  get isConnected(){return this===doc.body||Boolean(this.parentNode?.isConnected);}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(matches(child,selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 }
 const body=new Element('body');doc={body,readyState:'complete',activeElement:null,createElement:tag=>new Element(tag),querySelector:selector=>body.querySelector(selector)};
 const app=new Element('main');app.id='app';app.className='bbnext-plan';body.append(app);
 const addActions=()=>{const actions=new Element('div');actions.className='bbnext-plan-actions';app.append(actions);return actions;};
 addActions();
 const CATALOG=[{id:'chicken',name:'Chicken',group:'Meat',thumbnail:'Cooked chicken',emoji:'🍗'},{id:'mushrooms',name:'Mushrooms',group:'Vegetables',thumbnail:'Mushrooms',emoji:'🍄'},{id:'carrots',name:'Carrots',group:'Vegetables',thumbnail:'Carrots',emoji:'🥕'}];
 const preferences={CATALOG,getSelected:()=>[...ids],scope:()=>scope,subscribe:fn=>listeners.push(fn),setSelected(next){if(fail)return {ok:false,selected:[...ids]};ids=[...next];writes.push([...ids]);for(const fn of listeners)fn({selected:[...ids],scope});return {ok:true,selected:[...ids]};}};
 const window={document:doc,BBIngredientPreferences:preferences,BBFoodVisuals:{html:(name,options)=>{photos.push({name,options});return '<span class="photo"></span>';}},MutationObserver:class{constructor(fn){observer=fn;}observe(){}}};
 vm.runInNewContext(code,{window});
 const $=selector=>doc.querySelector(selector);
 return {window,doc,app,$,photos,writes,get ids(){return ids;},get tab(){return $('#bbAvoidIngredientTab');},get panel(){return $('#bbAvoidIngredientPanel');},tile:id=>$('[data-bb-avoid-id="'+id+'"]'),mount:()=>window.BBIngredientPicker.mount(),observe:()=>observer(),addActions,
  failSave:()=>{fail=true;},changeScope(){scope='account-b';ids=[];for(const fn of listeners)fn({selected:[],scope});},search(value){const input=$('#bbAvoidIngredientSearch');input.value=value;input.fire('input');}};
}

test('the ingredient tab starts closed and mounts no thumbnail grid until the user opens it',()=>{
 const h=fixture();assert.equal(h.tab.getAttribute('aria-expanded'),'false');assert.equal(h.panel.hidden,true);assert.equal(h.$('.bb-avoid-options'),null);assert.equal(h.photos.length,0);
 const tab=h.tab;h.observe();h.mount();assert.equal(h.tab,tab);assert.equal(h.app.querySelectorAll('#bbIngredientPicker').length,1);
 h.tab.click();assert.equal(h.panel.hidden,false);assert.equal(h.tab.getAttribute('aria-expanded'),'true');assert.equal(h.doc.activeElement,h.$('#bbAvoidIngredientSearch'));assert.equal(h.photos.length,3);
 assert.equal(h.photos[0].name,'Cooked chicken');
 h.tab.click();assert.equal(h.panel.hidden,true);h.tab.click();assert.equal(h.photos.length,3,'reopening reuses the existing picker');
});

test('choosing, searching, removing and clearing ingredients changes the saved preferences and accessible state',()=>{
 const h=fixture();h.tab.click();h.tile('chicken').click();assert.deepEqual(h.ids,['chicken']);assert.equal(h.tile('chicken').getAttribute('aria-pressed'),'true');assert.match(h.$('.bb-avoid-count').textContent,/1 selected/);
 h.search('mush');assert.equal(h.tile('chicken'),null);assert.ok(h.tile('mushrooms'));h.tile('mushrooms').click();assert.deepEqual(h.ids,['chicken','mushrooms']);
 h.search('nothing matches');assert.match(h.$('.bb-avoid-results').textContent,/No ingredients found/);assert.equal(h.$('.bb-avoid-selected').children.length,2);
 h.$('.bb-avoid-selected').children[0].click();assert.deepEqual(h.ids,['mushrooms']);
 h.$('.bb-avoid-clear').click();assert.deepEqual(h.ids,[]);assert.equal(h.$('.bb-avoid-clear').disabled,true);assert.equal(h.$('.bb-avoid-selected').hidden,true);assert.match(h.$('.bb-avoid-status').textContent,/All ingredients can be used/);
});

test('a failed save leaves the previous ingredient choice intact and reports the failure',()=>{
 const h=fixture();h.tab.click();h.failSave();h.tile('chicken').click();assert.deepEqual(h.ids,[]);assert.equal(h.tile('chicken').getAttribute('aria-pressed'),'false');assert.match(h.$('.bb-avoid-status').textContent,/Could not save/);assert.match(h.$('.bb-avoid-status').className,/is-error/);assert.equal(h.writes.length,0);
});

test('Escape and Done return focus to the tab, while changing account closes and resets the picker',()=>{
 const h=fixture();h.tab.click();let prevented=false;h.$('#bbIngredientPicker').fire('keydown',{key:'Escape',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.panel.hidden,true);assert.equal(h.doc.activeElement,h.tab);
 h.tab.click();h.search('mush');h.tile('mushrooms').click();h.changeScope();assert.equal(h.panel.hidden,true);assert.equal(h.$('#bbAvoidIngredientSearch').value,'');assert.equal(h.$('.bb-avoid-count').textContent,'None selected');assert.ok(h.tile('chicken'));
 h.tab.click();h.$('.bb-avoid-done').click();assert.equal(h.panel.hidden,true);assert.equal(h.doc.activeElement,h.tab);
});

test('Plan rerenders retain the active disclosure, and leaving Plan returns it to its closed default',()=>{
 const h=fixture();h.tab.click();h.tile('chicken').click();h.app.replaceChildren();h.addActions();h.mount();assert.equal(h.panel.hidden,false);assert.equal(h.tile('chicken').getAttribute('aria-pressed'),'true');
 h.app.className='bbnext-discover';h.observe();h.app.replaceChildren();h.app.className='bbnext-plan';h.addActions();h.mount();assert.equal(h.panel.hidden,true);assert.equal(h.$('.bb-avoid-options'),null);assert.match(h.$('.bb-avoid-count').textContent,/1 selected/);
});
