import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const api=createRequire(import.meta.url)('../bb-shop-continuation.js');
const key='basketboss_shop_session_archive_v7';
const session={version:7,id:'shop-saved',createdAt:'2026-11-11T10:00:00.000Z'};
const rows=[{id:'milk|l',name:'<Milk & cream>',unit:'l',quantity:0.125},{id:'ess:manual:bags',name:'Bin bags',unit:'pack',quantity:2,kind:'household'}];
const snapshot=api.prepareContinuation(session,rows,{actor:'alice',market:'UK'}).snapshot;

function fixture(options={}){
 let doc,who={actor:'alice',market:'UK'},deleting=false;
 const listeners=new Map(),writes=[],continued=[],copied=[];
 const data=new Map([[key,JSON.stringify({[session.id]:{...session,savedRemaining:snapshot,receiptContext:{actorId:'alice',market:'UK'}}})]]);
 const walk=node=>[node,...node.children.flatMap(walk)];
 class Node{
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parentNode:null,ownerDocument:doc,className:'',attributes:new Map(),hidden:false,disabled:false,open:false,value:'',_text:''});}
  set textContent(value){this._text=String(value);this.replaceChildren();}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  querySelector(selector){return walk(this).find(node=>node!==this&&node.tagName===selector.toUpperCase())||null;}
  focus(){doc.activeElement=this;}
  select(){this.selected=true;}
 }
 doc={createElement:tag=>new Node(tag),activeElement:null};doc.body=new Node('body');
 const container=doc.createElement('div');doc.body.append(container);
 const win={document:doc,localStorage:{getItem:name=>data.get(name)??null,setItem(){writes.push('write');}},navigator:options.clipboard===false?{}:{clipboard:{writeText:async value=>{copied.push(value);if(options.copy)return options.copy(value);}}},BBAccountDeletion:{isDeleting:()=>deleting},addEventListener(name,handler){listeners.set(name,handler);},removeEventListener(name,handler){if(listeners.get(name)===handler)listeners.delete(name);}};
 const view=api.mount({container,win,context:()=>who,onContinue:async value=>{continued.push(value);if(options.continue)return options.continue(value);}});
 const find=selector=>walk(container).find(node=>node.className.split(' ').includes(selector));
 return {doc,win,container,data,listeners,writes,continued,copied,view,find,text:()=>container.textContent,actor(value){who={...who,actor:value};},market(value){who={...who,market:value};},deletion(value){deleting=value;},fire(name,event){listeners.get(name)?.(event);}};
}

test('saved card reads its frozen list without inferring current demand and renders names as text',async()=>{
 const h=fixture();assert.match(h.text(),/Continue your shop/);assert.match(h.text(),/2 items saved/);assert.match(h.text(),/Open your current list to see what is still needed/);assert.match(h.text(),/<Milk & cream>/);assert.match(h.text(),/0.125 l/);assert.equal(h.container.querySelector('script'),null);
 await h.find('bb-shop-continuation-resume').onclick();
 assert.deepEqual(h.continued[0],snapshot);assert.deepEqual(h.writes,[]);
 assert.match(h.text(),/2 items saved/);assert.doesNotMatch(h.text(),/2 left/);
});

test('copy uses the saved quantities after a reload and never changes pantry or demand',async()=>{
 const h=fixture();await h.find('bb-shop-continuation-copy').onclick();
 assert.equal(h.copied.length,1);assert.match(h.copied[0],/0\.125 l <Milk & cream>/);assert.match(h.copied[0],/2 pack Bin bags/);assert.match(h.text(),/Saved shopping list copied/);assert.deepEqual(h.writes,[]);
 h.view.refresh();await h.find('bb-shop-continuation-copy').onclick();assert.equal(h.copied[1],h.copied[0]);
});

test('an explicitly unknown quantity stays visible for review without showing null or inventing an amount',async()=>{
 const h=fixture(),review=api.prepareContinuation(session,[{id:'household-opaque',name:'Kitchen rolls',unit:'pack',quantity:null,quantityNeedsReview:true}],{actor:'alice',market:'UK'}).snapshot;
 h.data.set(key,JSON.stringify({[session.id]:{...session,savedRemaining:review}}));h.view.refresh();assert.match(h.text(),/Kitchen rollsCheck quantity/);assert.doesNotMatch(h.text(),/null|0 pack/);await h.find('bb-shop-continuation-copy').onclick();assert.match(h.copied[0],/Check quantity Kitchen rolls/);assert.doesNotMatch(h.copied[0],/null|0 pack/);assert.deepEqual(h.writes,[]);
});

test('clipboard failure exposes a labelled selectable copy field with the actual saved list',async()=>{
 const h=fixture({clipboard:false});await h.find('bb-shop-continuation-copy').onclick();
 const field=h.container.querySelector('textarea');assert.equal(field.readOnly,true);assert.equal(field.getAttribute('aria-label'),'Saved shopping list to copy');assert.equal(field.value,api.formatList(snapshot));assert.equal(field.selected,true);assert.equal(h.doc.activeElement,field);assert.match(h.text(),/Select and copy/);assert.deepEqual(h.writes,[]);
});

test('stale account or market callbacks cannot open or copy another context',async()=>{
 const h=fixture(),resume=h.find('bb-shop-continuation-resume'),copy=h.find('bb-shop-continuation-copy');h.actor('bob');await resume.onclick();await copy.onclick();assert.equal(h.continued.length,0);assert.equal(h.copied.length,0);
 h.fire('basketboss:session-changed');assert.equal(h.container.children[0].hidden,true);assert.equal(h.text(),'');
 h.actor('alice');h.market('US');h.view.refresh();assert.equal(h.text(),'');h.market('UK');h.view.refresh();assert.match(h.text(),/Continue your shop/);
});

test('account deletion and settled archive storage changes hide saved cards safely',()=>{
 const h=fixture();h.deletion(true);h.fire('basketboss:account-deletion-started');assert.equal(h.text(),'');h.deletion(false);h.view.refresh();assert.match(h.text(),/Continue your shop/);
 h.data.set(key,JSON.stringify({[session.id]:{...session,savedRemaining:{...snapshot,status:'continued'}}}));h.fire('storage',{key});assert.equal(h.text(),'');assert.deepEqual(h.writes,[]);
});

test('detached cards and duplicate resume clicks cannot continue an archived list twice',async()=>{
 let complete;const h=fixture({continue:()=>new Promise(resolve=>{complete=resolve;})}),button=h.find('bb-shop-continuation-resume');
 const pending=button.onclick();await button.onclick();assert.equal(h.continued.length,1);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');h.view.dispose();await button.onclick();complete();await pending;assert.equal(h.continued.length,1);assert.equal(h.container.children.length,0);assert.equal(h.listeners.size,0);
});

test('a copy finishing after an account change cannot display old account clipboard content',async()=>{
 let reject;const h=fixture({copy:()=>new Promise((_,fail)=>{reject=fail;})});const pending=h.find('bb-shop-continuation-copy').onclick();h.actor('bob');h.fire('basketboss:session-changed');reject(Error('blocked'));await pending;assert.equal(h.container.querySelector('textarea'),null);assert.equal(h.text(),'');
});

test('the module requests the host refresh once DOM content is ready',()=>{
 const source=fs.readFileSync(new URL('../bb-shop-continuation.js',import.meta.url),'utf8');let ready,refreshes=0;
 const win={document:{readyState:'loading',addEventListener(name,callback){assert.equal(name,'DOMContentLoaded');ready=callback;}},BBShopContinuationHost:{refresh(){refreshes++;}}};vm.runInNewContext(source,{window:win,Date,Set,Object,Number,Array,JSON,Intl});assert.equal(refreshes,0);ready();assert.equal(refreshes,1);assert.equal(typeof win.BBShopContinuation.mount,'function');
});
