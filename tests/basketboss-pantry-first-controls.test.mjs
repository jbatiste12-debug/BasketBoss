import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {install}=createRequire(import.meta.url)('../bb-pantry-first-controls.js');

// A small DOM fixture exercises delegation and remounting without a second
// browser runner or a replacement implementation of planner selection.
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes=new Map();this.className='';this.id='';this.disabled=false;this.listeners=new Map();}
 setAttribute(key,value){this.attributes.set(key,String(value));}
 getAttribute(key){return this.attributes.get(key)??null;}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 prepend(node){node.remove();node.parentNode=this;this.children.unshift(node);}
 remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}
 matches(selector){
  const tag=selector.match(/^([a-z][\w-]*)/i)?.[1];if(tag&&tag.toUpperCase()!==this.tagName)return false;
  for(const match of selector.matchAll(/\[([^=\]]+)(?:="?([^"\]]+)"?)?\]/g))if(!this.attributes.has(match[1])||match[2]!==undefined&&this.attributes.get(match[1])!==match[2])return false;
  const id=selector.match(/#([\w-]+)/)?.[1],classes=[...selector.matchAll(/\.([\w-]+)/g)].map(match=>match[1]);
  return (!id||this.id===id)&&classes.every(value=>this.className.split(/\s+/).includes(value));
 }
 closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentNode;}return null;}
 querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 addEventListener(type,handler){this.listeners.set(type,handler);}
 showModal(){this.setAttribute('open','');}
 focus(){}
}
function fixture({loading=false,plan=true}={}){
 const body=new Element('body'),app=new Element(),actions=new Element(),working=new Element('button'),add=new Element('button');
 app.id='app';app.className=plan?'bbnext-plan':'bbnext-shop';actions.className='bbnext-plan-actions';working.id='bb172FillSixDinners';
 const original=()=>{};working.onclick=original;actions.append(working,add);app.append(actions);body.append(app);
 const handlers=new Map(),observers=[],frames=[];
 const doc={body,readyState:loading?'loading':'complete',createElement:tag=>new Element(tag),querySelector:selector=>body.querySelector(selector),
  addEventListener(name,callback){const rows=handlers.get(name)||[];rows.push(callback);handlers.set(name,rows);}};
 const win={document:doc,requestAnimationFrame:callback=>frames.push(callback),MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.target=target;this.options=options;}}};
 Object.defineProperty(win,'localStorage',{get(){throw Error('Preference controls must not read or write customer storage.');}});
 const api=install(win),flush=()=>{while(frames.length)frames.shift()();};
 const click=target=>{const event={target,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};for(const handler of handlers.get('click')||[])handler(event);return event;};
 return {body,app,actions,working,original,doc,win,api,observers,frames,handlers,flush,click,group:()=>app.querySelector('.bb-pantry-first-controls'),choice:value=>app.querySelectorAll('[data-bb-pantry-first-mode]').find(node=>node.getAttribute('data-bb-pantry-first-mode')===value)};
}
test('mode controls mount once without cloning or invoking the existing Auto-fill action',()=>{
 const h=fixture();assert.equal(h.api.mode(),'pantry-first');assert.equal(h.api.capture(),'pantry-first');
 assert.equal(h.group().getAttribute('aria-label'),'Auto-fill preference');
 assert.equal(h.choice('pantry-first').getAttribute('aria-pressed'),'true');assert.equal(h.choice('fresh').getAttribute('aria-pressed'),'false');
 for(let i=0;i<5;i++)h.api.mount();
 assert.equal(h.actions.querySelectorAll('.bb-pantry-first-controls').length,1);
 assert.equal(h.actions.querySelector('#bb172FillSixDinners'),h.working);assert.equal(h.working.onclick,h.original);
 assert.equal(install(h.win),h.api);assert.equal(h.handlers.get('click').length,1);assert.equal(h.observers.length,1);
});
test('delegated chip taps preserve a captured preference and survive replacement of the action area',()=>{
 const h=fixture(),captured=h.api.capture(),nested=new Element('span');h.choice('fresh').append(nested);
 const event=h.click(nested);assert.equal(event.prevented,true);assert.equal(event.stopped,true);
 assert.equal(h.api.mode(),'fresh');assert.equal(captured,'pantry-first');assert.equal(h.choice('fresh').getAttribute('aria-pressed'),'true');
 h.actions.remove();const replacement=new Element();replacement.className='bbnext-plan-actions';replacement.append(h.working);h.app.append(replacement);
 h.observers[0].callback([]);h.observers[0].callback([]);assert.equal(h.frames.length,1);h.flush();
 assert.equal(h.group().parentNode,replacement);assert.equal(h.api.mode(),'fresh');assert.equal(h.choice('fresh').getAttribute('aria-pressed'),'true');
});
test('busy planning and unrelated controls cannot change the selected preference',()=>{
 const h=fixture();h.working.disabled=true;h.observers[0].callback([]);h.flush();assert.equal(h.choice('fresh').disabled,true);
 h.click(h.choice('fresh'));assert.equal(h.api.mode(),'pantry-first');
 h.working.disabled=false;h.working.setAttribute('aria-busy','true');h.click(h.choice('fresh'));assert.equal(h.api.mode(),'pantry-first');
 const event=h.click(h.working);assert.equal(event.prevented,undefined);assert.equal(event.stopped,undefined);
 const stray=new Element('button');stray.setAttribute('data-bb-pantry-first-mode','fresh');h.body.append(stray);h.click(stray);assert.equal(h.api.mode(),'pantry-first');
 h.working.setAttribute('aria-busy','false');h.observers[0].callback([]);h.flush();assert.equal(h.choice('fresh').disabled,false);
 h.click(h.choice('fresh'));assert.equal(h.api.mode(),'fresh');
});
test('deferred startup and non-Plan views do not attach duplicate handlers or create planner controls',()=>{
 const h=fixture({loading:true,plan:false});assert.equal(h.group(),null);assert.equal(h.handlers.has('click'),false);
 for(const start of h.handlers.get('DOMContentLoaded')){start();start();}
 assert.equal(h.group(),null);assert.equal(h.handlers.get('click').length,1);assert.equal(h.observers.length,1);
 h.app.className='bbnext-plan';h.observers[0].callback([]);h.flush();assert.ok(h.group());
 assert.equal(h.working.onclick,h.original);
});
test('Start next week captures one selected mode and blocks repeated taps until its existing host settles',async()=>{
 const h=fixture(),calls=[];let finish;
 h.win.BBPantryFirstHost={startNextWeek:options=>{calls.push(options);return new Promise(resolve=>{finish=resolve;});}};h.api.mount();
 h.click(h.choice('fresh'));const next=h.app.querySelector('[data-bb-start-next-week]');
 const event=h.click(next);h.click(next);h.click(h.choice('pantry-first'));
 assert.equal(event.stopped,true);assert.equal(event.prevented,true);assert.equal(calls.length,1);assert.equal(calls[0].mode,'fresh');assert.equal(calls[0].empty,true);assert.equal(typeof calls[0].confirmEmpty,'function');assert.equal(h.api.mode(),'fresh');
 assert.equal(next.disabled,true);assert.equal(h.working.onclick,h.original);
 finish({ok:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(next.disabled,false);
 assert.equal(h.actions.querySelectorAll('[data-bb-start-next-week]').length,1);
});
test('next-week host failures leave an accessible retry message without invoking the original Auto-fill button',async()=>{
 const h=fixture();h.win.BBPantryFirstHost={startNextWeek:async()=>{throw Error('unavailable');}};h.api.mount();
 const next=h.app.querySelector('[data-bb-start-next-week]');h.click(next);await new Promise(resolve=>setImmediate(resolve));
 const status=h.app.querySelector('.bb-pantry-first-status');assert.equal(status.hidden,false);assert.equal(status.getAttribute('role'),'status');
 assert.match(status.textContent,/current week has been kept/);assert.equal(next.disabled,false);assert.equal(h.working.onclick,h.original);
});

test('the next-week confirmation defaults to keeping pantry and permits an explicit review choice',async()=>{
 for(const review of [false,true]){
  const h=fixture(),answers=[];
  h.win.BBPantryFirstHost={startNextWeek:async options=>{answers.push(await options.confirmEmpty('Your current week is saved.','Start next week?','Start next week',['Monday','Thursday']));return {ok:true};}};h.api.mount();
  h.click(h.app.querySelector('[data-bb-start-next-week]'));
  const dialog=h.doc.querySelector('.bb-next-week-dialog'),inputs=dialog.querySelectorAll('input');assert.equal(inputs.length,2);assert.equal(inputs[0].checked,true);assert.equal(inputs[1].checked,false);
  assert.match(dialog.querySelector('.bb-next-week-note').textContent,/never marks meals done or deducts ingredients/);
  if(review){inputs[0].checked=false;inputs[1].checked=true;}
  dialog.querySelector('.bb-next-week-primary').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(answers,[{confirmed:true,reviewPantry:review}]);assert.equal(h.doc.querySelector('.bb-next-week-dialog'),null);
 }
});

test('cancelling or dismissing a next-week confirmation never opts into pantry review',async()=>{
 for(const escape of [false,true]){
  const h=fixture(),answers=[];h.win.BBPantryFirstHost={startNextWeek:async options=>{answers.push(await options.confirmEmpty('Keep old plan until confirmed.','Start next week?','Start next week',['Monday']));return {ok:false,cancelled:true};}};h.api.mount();
  h.click(h.app.querySelector('[data-bb-start-next-week]'));const dialog=h.doc.querySelector('.bb-next-week-dialog');dialog.querySelectorAll('input')[1].checked=true;
  if(escape)dialog.listeners.get('cancel')({preventDefault(){}});else dialog.querySelectorAll('button')[0].onclick();
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(answers,[{confirmed:false,reviewPantry:false}]);assert.equal(h.doc.querySelector('.bb-next-week-dialog'),null);
 }
});
