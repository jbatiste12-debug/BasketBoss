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
   const names=()=>new Set(this.className.split(' ').filter(Boolean));
   this.classList={toggle:(name,on)=>{const set=names();if(on===undefined)on=!set.has(name);if(on)set.add(name);else set.delete(name);this.className=[...set].join(' ');},add:(...values)=>{const set=names();values.forEach(value=>set.add(value));this.className=[...set].join(' ');},remove:(...values)=>{const set=names();values.forEach(value=>set.delete(value));this.className=[...set].join(' ');},contains:name=>names().has(name)};
   this.style={setProperty(name,value){this[name]=String(value);},getPropertyValue(name){return this[name]||'';},removeProperty(name){const old=this[name]||'';delete this[name];return old;}};
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
  removeAttribute(name){delete this.attributes[name];if(name==='open'){this.open=false;this._modal=false;}}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  fire(type,event={}){for(const fn of this.handlers[type]||[])fn(event);}
  click(){this.fire('click');}
  focus(){doc.activeElement=this;}
  blur(){if(doc.activeElement===this)doc.activeElement=doc.body;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  showModal(){this.open=true;this._modal=true;this.setAttribute('open','');}
  close(){this.open=false;this._modal=false;this.removeAttribute('open');}
  matches(selector){return selector===':modal'?this._modal===true:matches(this,selector);}
  get isConnected(){return this===doc.body||Boolean(this.parentNode?.isConnected);}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(matches(child,selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 }
 const body=new Element('body'),html=new Element('html');html.append(body);doc={body,documentElement:html,readyState:'complete',activeElement:null,createElement:tag=>new Element(tag),querySelector:selector=>body.querySelector(selector)};
 const app=new Element('main');app.id='app';app.className='bbnext-plan';body.append(app);
 const addActions=()=>{const actions=new Element('div');actions.className='bbnext-plan-actions';app.append(actions);return actions;};
 addActions();
 const CATALOG=[{id:'chicken',name:'Chicken',group:'Meat',thumbnail:'Cooked chicken',emoji:'🍗'},{id:'mushrooms',name:'Mushrooms',group:'Vegetables',thumbnail:'Mushrooms',emoji:'🍄'},{id:'carrots',name:'Carrots',group:'Vegetables',thumbnail:'Carrots',emoji:'🥕'}];
 const preferences={CATALOG,getSelected:()=>[...ids],scope:()=>scope,subscribe:fn=>listeners.push(fn),setSelected(next){if(fail)return {ok:false,selected:[...ids]};ids=[...next];writes.push([...ids]);for(const fn of listeners)fn({selected:[...ids],scope});return {ok:true,selected:[...ids]};}};
 const window={document:doc,innerHeight:812,innerWidth:375,scrollY:240,scrollX:0,scrollTo(options,y){this.scrollY=typeof options==='object'?options.top:y;this.scrollX=typeof options==='object'?options.left||0:options;},BBIngredientPreferences:preferences,BBFoodVisuals:{html:(name,options)=>{photos.push({name,options});return '<span class="photo"></span>';}},MutationObserver:class{constructor(fn){observer=fn;}observe(){}}};
 vm.runInNewContext(code,{window});
 const $=selector=>doc.querySelector(selector);
 return {window,doc,app,$,photos,writes,get ids(){return ids;},get tab(){return $('#bbAvoidIngredientTab');},get panel(){return $('#bbAvoidIngredientPanel');},tile:id=>$('[data-bb-avoid-id="'+id+'"]'),mount:()=>window.BBIngredientPicker.mount(),observe:()=>observer(),addActions,
  failSave:()=>{fail=true;},changeScope(next='account-b'){scope=next;ids=[];for(const fn of listeners)fn({selected:[],scope});},search(value){const input=$('#bbAvoidIngredientSearch');input.value=value;input.fire('input');}};
}

test('the ingredient tab starts closed and mounts no thumbnail grid until the user opens it',()=>{
 const h=fixture();assert.equal(h.tab.getAttribute('aria-expanded'),'false');assert.equal(h.panel.hidden,true);assert.equal(h.$('.bb-avoid-options'),null);assert.equal(h.photos.length,0);
 const tab=h.tab;h.observe();h.mount();assert.equal(h.tab,tab);assert.equal(h.app.querySelectorAll('#bbIngredientPicker').length,1);
 h.tab.click();assert.equal(h.panel.hidden,false);assert.equal(h.tab.getAttribute('aria-expanded'),'true');assert.notEqual(h.doc.activeElement,h.$('#bbAvoidIngredientSearch'),'opening a food preference must not summon the software keyboard');assert.equal(h.photos.length,3);
 assert.equal(h.photos[0].name,'Cooked chicken');
 h.tab.click();assert.equal(h.panel.hidden,true);h.tab.click();assert.equal(h.photos.length,3,'reopening reuses the existing picker');
});

test('opening and reopening leave search unfocused until the user explicitly chooses it',()=>{
 const h=fixture();h.tab.focus();h.tab.click();
 const search=h.$('#bbAvoidIngredientSearch');
 assert.ok([h.tab,h.$('.bb-avoid-close')].includes(h.doc.activeElement),'opening keeps focus on a non-editable control');
 search.focus();assert.equal(h.doc.activeElement,search,'search remains available for an explicit tap');
 h.search('mush');assert.equal(h.doc.activeElement,search,'filtering must not replace the focused search input');assert.equal(h.$('#bbAvoidIngredientSearch'),search);assert.ok(h.tile('mushrooms'));assert.equal(h.tile('chicken'),null);
 h.$('.bb-avoid-done').click();assert.equal(h.panel.hidden,true);assert.equal(h.doc.activeElement,h.tab);
 h.tab.click();assert.ok([h.tab,h.$('.bb-avoid-close')].includes(h.doc.activeElement));assert.equal(h.$('#bbAvoidIngredientSearch'),search);assert.equal(search.value,'mush');assert.equal(h.panel.hidden,false);
});

test('choosing an ingredient does not steal focus from search or change the query',()=>{
 const h=fixture();h.tab.click();const search=h.$('#bbAvoidIngredientSearch');search.focus();h.search('mush');
 h.tile('mushrooms').click();
 assert.equal(h.doc.activeElement,search);assert.equal(search.value,'mush');assert.deepEqual(h.ids,['mushrooms']);assert.equal(h.tile('mushrooms').getAttribute('aria-pressed'),'true');
});

test('the top close action closes the panel and releases search focus',()=>{
 const h=fixture();h.tab.click();const search=h.$('#bbAvoidIngredientSearch');search.focus();
 const close=h.$('.bb-avoid-close');assert.ok(close,'a close action is available before scrolling through the choices');assert.equal(close.textContent,'×');assert.equal(close.getAttribute('aria-label'),'Close foods to avoid');
 close.click();assert.equal(h.panel.hidden,true);assert.equal(h.tab.getAttribute('aria-expanded'),'false');assert.equal(h.doc.activeElement,h.tab);
});

test('the modal locks the background and restores the original scroll and unrelated styles on close',()=>{
 const h=fixture(),html=h.doc.documentElement;
 html.style.setProperty('--existing-setting','kept');html.style.setProperty('--bb-avoid-scroll-top','-12px');h.tab.focus();h.tab.click();
 assert.equal(h.panel.tagName,'DIALOG');assert.equal(h.panel.open,true);assert.equal(h.panel.getAttribute('aria-modal'),'true');assert.equal(html.classList.contains('bb-avoid-modal-open'),true);assert.equal(html.style.getPropertyValue('--bb-avoid-scroll-top'),'-240px');
 assert.equal(h.panel.style.getPropertyValue('--bb-avoid-viewport-height'),'812px');assert.equal(h.panel.style.getPropertyValue('--bb-avoid-viewport-top'),'0px');
 h.window.scrollY=0;h.$('.bb-avoid-done').click();
 assert.equal(h.panel.open,false);assert.equal(html.classList.contains('bb-avoid-modal-open'),false);assert.equal(html.style.getPropertyValue('--bb-avoid-scroll-top'),'-12px');assert.equal(html.style.getPropertyValue('--existing-setting'),'kept');assert.equal(h.window.scrollY,240);
});

test('Plan remounts transfer the open modal and release the lock when leaving Plan',()=>{
 const h=fixture();h.tab.click();h.search('mush');const old=h.panel;h.window.scrollY=0;
 h.app.replaceChildren();h.addActions();h.mount();
 assert.notEqual(h.panel,old);assert.equal(h.panel.open,true);assert.equal(h.$('#bbAvoidIngredientSearch').value,'mush');assert.equal(h.doc.documentElement.style.getPropertyValue('--bb-avoid-scroll-top'),'-240px');
 old.fire('close');assert.equal(h.panel.open,true,'queued events from the old dialog cannot close the replacement');
 h.app.className='bbnext-discover';h.observe();
 assert.equal(h.doc.documentElement.classList.contains('bb-avoid-modal-open'),false);assert.equal(h.window.scrollY,240);assert.equal(h.panel.open,false);
});

test('reparented open dialogs regain the top layer without losing search, query or the original scroll lock',()=>{
 const h=fixture();h.tab.click();const panel=h.panel,search=h.$('#bbAvoidIngredientSearch');search.focus();h.search('mush');
 panel._modal=false;h.window.scrollY=0;h.observe();
 assert.equal(h.panel,panel);assert.equal(panel.open,true);assert.equal(panel.matches(':modal'),true);assert.equal(h.doc.activeElement,search);assert.equal(search.value,'mush');assert.equal(h.doc.documentElement.style.getPropertyValue('--bb-avoid-scroll-top'),'-240px');assert.equal(h.writes.length,0);
 h.$('.bb-avoid-close').click();h.mount();assert.equal(panel.open,false,'a closed picker must never reopen during reconciliation');assert.equal(h.window.scrollY,240);
});

test('top-layer repair restores a remembered focused field after reparenting blurred it',()=>{
 const h=fixture();h.tab.click();const panel=h.panel,search=h.$('#bbAvoidIngredientSearch');search.focus();panel.fire('focusin',{target:search});
 panel._modal=false;search.blur();h.observe();assert.equal(h.doc.activeElement,search);assert.equal(panel.matches(':modal'),true);
 h.changeScope();h.mount();assert.equal(panel.open,false);assert.equal(h.doc.documentElement.classList.contains('bb-avoid-modal-open'),false);
});

test('reconciliation cannot reopen a native owner-close before its queued close event',()=>{
 const h=fixture();h.tab.click();const panel=h.panel;panel.close();h.observe();
 assert.equal(panel.open,false);panel.fire('close');assert.equal(panel.hidden,true);assert.equal(h.doc.documentElement.classList.contains('bb-avoid-modal-open'),false);assert.equal(h.window.scrollY,240);
});

test('backdrop dismissal requires a tap starting outside, and native cancel or close releases the modal',()=>{
 const h=fixture();h.window.PointerEvent=function(){};h.tab.click();const panel=h.panel;panel.getBoundingClientRect=()=>({left:20,right:355,top:12,bottom:700});
 const outside={target:panel,clientX:5,clientY:100,detail:1,preventDefault(){}};
 panel.fire('pointerdown',{target:h.$('#bbAvoidIngredientSearch'),clientX:50,clientY:100});panel.fire('click',outside);assert.equal(panel.open,true,'ending an in-panel swipe outside is not a backdrop tap');
 panel.fire('pointerdown',outside);panel.fire('click',outside);assert.equal(panel.open,false);assert.equal(h.doc.documentElement.classList.contains('bb-avoid-modal-open'),false);
 h.tab.click();let prevented=false;panel.fire('cancel',{preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(panel.open,false);
 h.tab.click();panel.close();panel.fire('close');assert.equal(h.panel.hidden,true);assert.equal(h.doc.documentElement.classList.contains('bb-avoid-modal-open'),false);
});

test('changing account while search is focused releases the hidden field and preserves unrelated focus',()=>{
 const h=fixture();h.tab.click();const search=h.$('#bbAvoidIngredientSearch');search.focus();h.search('mush');h.changeScope();
 assert.equal(h.panel.hidden,true);assert.notEqual(h.doc.activeElement,search,'a hidden search must not retain the software keyboard');assert.equal(search.value,'');assert.deepEqual(h.ids,[]);
 h.tab.click();h.tab.focus();h.changeScope('account-c');assert.equal(h.doc.activeElement,h.tab,'account reset must not steal focus from another visible control');
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
