import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

const essentialsSource=fs.readFileSync(new URL('../bb-kitchen-essentials.js',import.meta.url),'utf8');
const addSource=fs.readFileSync(new URL('../bb-shop-add.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(read){const deadline=Date.now()+5000;while(!read()){assert.ok(Date.now()<deadline,'the local module import starts');await new Promise(resolve=>setTimeout(resolve,5));}}

function loaderFixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bb-household-readiness-')),key='bbRulesTest_'+randomUUID(),attempts=[],frames=[];
 const record={invalid:false,enter:url=>new Promise((resolve,reject)=>attempts.push({url,resolve,reject}))};globalThis[key]=record;
 fs.writeFileSync(path.join(folder,'bb-kitchen-choice-rules.mjs'),`const record=globalThis[${JSON.stringify(key)}];await record.enter(import.meta.url);export const isHousehold=record.invalid?null:()=>true;export const previewOrder=items=>items;export const FOOD_PREVIEWS={};export const HOUSEHOLD_PREVIEWS=[];`);
 const win={},doc={readyState:'loading',currentScript:{src:pathToFileURL(path.join(folder,'bb-kitchen-essentials.js')).href},addEventListener(){}};
 // Execute the real browser script with native import(), not an importer mock.
 new Function('window','document','location','requestAnimationFrame',essentialsSource)(win,doc,{href:doc.currentScript.src},callback=>frames.push(callback));
 t.after(()=>{delete globalThis[key];fs.rmSync(folder,{recursive:true,force:true});});
 return {win,attempts,frames,record,api:win.BBKitchenEssentials};
}

test('household classification publishes only after the shared pending import completes',async t=>{
 const h=loaderFixture(t),pending=h.api.loadRules();assert.equal(h.api.loadRules(),pending);assert.equal(h.win.BBKitchenChoiceRules,undefined);assert.equal(h.frames.length,0);
 await until(()=>h.attempts.length===1);assert.equal(h.api.loadRules(),pending);h.attempts[0].resolve();
 const rules=await pending;assert.equal(typeof rules.isHousehold,'function');assert.equal(h.win.BBKitchenChoiceRules,rules);assert.equal(h.frames.length,1);
 assert.equal(await h.api.loadRules(),rules);assert.equal(h.attempts.length,1,'ready rules do not trigger another import');
});

test('a failed import stays unpublished and an explicit deduped retry bypasses the failed module URL',async t=>{
 const h=loaderFixture(t),initial=h.api.loadRules();await until(()=>h.attempts.length===1);h.attempts[0].reject(Error('Temporary local asset failure'));
 assert.equal(await initial,null);assert.equal(h.win.BBKitchenChoiceRules,undefined);assert.equal(h.frames.length,0);await tick();assert.equal(h.attempts.length,1,'failure does not start an automatic retry loop');
 const retry=h.api.loadRules();assert.equal(h.api.loadRules(),retry);await until(()=>h.attempts.length===2);
 assert.notEqual(h.attempts[1].url,h.attempts[0].url);assert.equal(new URL(h.attempts[1].url).searchParams.get('bbRulesRetry'),'2');h.attempts[1].resolve();
 const rules=await retry;assert.equal(h.win.BBKitchenChoiceRules,rules);assert.equal(typeof rules.isHousehold,'function');assert.equal(h.frames.length,1);
});

test('an invalid rules module never opens the readiness barrier and can be explicitly retried',async t=>{
 const h=loaderFixture(t);h.record.invalid=true;const initial=h.api.loadRules();await until(()=>h.attempts.length===1);h.attempts[0].resolve();
 assert.equal(await initial,null);assert.equal(h.win.BBKitchenChoiceRules,undefined);assert.equal(h.frames.length,0);
 h.record.invalid=false;const retry=h.api.loadRules();await until(()=>h.attempts.length===2);h.attempts[1].resolve();assert.equal(typeof(await retry).isHousehold,'function');
});

function addFixture({host=true,ready=false}={}){
 let doc;const calls=[];const walk=node=>[node,...node.children.flatMap(walk)];
 class Node{
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),ownerDocument:doc,children:[],parentNode:null,attributes:new Map(),events:new Map(),style:{},value:'',disabled:false,hidden:false,open:false,_text:''});}
  set textContent(value){this.children.forEach(child=>child.parentNode=null);this.children=[];this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='open')this.open=true;}
  removeAttribute(name){this.attributes.delete(name);if(name==='open')this.open=false;}
  addEventListener(name,handler){const handlers=this.events.get(name)||[];handlers.push(handler);this.events.set(name,handlers);}
  async fire(name){const event={target:this,preventDefault(){},stopPropagation(){}};await Promise.all([...(this.events.get(name)||[]).map(handler=>handler(event)),this['on'+name]?.(event)]);}
  matches(selector){return selector.split(',').some(value=>value==='dialog[open]'?this.tagName==='DIALOG'&&this.open:value.trim()===this.tagName.toLowerCase());}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  contains(node){return walk(this).includes(node);}
  get isConnected(){return this===doc.body||this.parentNode?.isConnected===true;}
  focus(){doc.activeElement=this;}
  blur(){if(doc.activeElement===this)doc.activeElement=doc.body;}
  showModal(){this.open=true;}
  close(){this.open=false;void this.fire('close');}
 }
 doc={createElement:tag=>new Node(tag),querySelector:selector=>doc.body.querySelector(selector)};doc.body=new Node('body');doc.activeElement=doc.body;
 const win={document:doc,addEventListener(){},removeEventListener(){},BBHome:{actor:()=> 'readiness-actor',addShoppingBuy:request=>{calls.push(request);return {ok:true};}}};
 if(host)win.BBShopPurchaseHost={isReady:()=>ready};
 vm.runInNewContext(addSource,{window:win});const container=new Node('div');doc.body.append(container);win.BBShopAdd.mount({container,win});
 const field=name=>walk(doc.body).find(node=>node.name===name),button=text=>walk(doc.body).find(node=>node.tagName==='BUTTON'&&node.textContent===text);
 return {doc,win,calls,field,button,setReady:value=>{ready=value;},open:()=>button('Add item to buy').fire('click'),submit:()=>doc.body.querySelector('form').fire('submit'),
  async fill(){field('name').value='Toilet rolls';field('quantityText').value='3';await field('quantityText').fire('input');}};
}

test('manual Add item blocks opening during classification warm-up and opens after readiness',async()=>{
 const h=addFixture();await h.open();assert.equal(h.doc.body.querySelector('dialog'),null);assert.match(h.doc.body.textContent,/still loading.*Try again/);assert.equal(h.calls.length,0);
 h.setReady(true);await h.open();assert.ok(h.doc.body.querySelector('dialog'));await h.fill();await h.submit();assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'Toilet rolls');
});

test('a form opened earlier retains its draft and cannot submit while classification is unavailable',async()=>{
 const h=addFixture({ready:true});await h.open();await h.fill();h.setReady(false);await h.submit();
 assert.equal(h.calls.length,0);assert.equal(h.field('name').value,'Toilet rolls');assert.equal(h.field('quantityText').value,'3');assert.equal(h.field('name').disabled,false);assert.match(h.doc.body.textContent,/still loading.*Try again/);
 h.setReady(true);await h.submit();assert.equal(h.calls.length,1);assert.equal(h.calls[0].quantityText,'3');assert.equal(h.doc.body.querySelector('dialog'),null);
});

test('legacy hosts without the optional readiness hook preserve direct Add item behavior',async()=>{
 for(const host of [false,true]){
  const h=addFixture({host});if(host)delete h.win.BBShopPurchaseHost.isReady;
  await h.open();await h.fill();await h.submit();assert.equal(h.calls.length,1);assert.equal(h.doc.body.querySelector('dialog'),null);
 }
});
