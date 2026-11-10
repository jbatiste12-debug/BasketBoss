import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {install}=createRequire(import.meta.url)('../bb-shared-shopping.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',H='33333333-3333-4333-8333-333333333333';
const SESSION='basketboss_cloud_session_v1';
const session=(actor=A,extra={})=>({user:{id:actor},access_token:'isolated-test-token',expires_at:Math.floor(Date.now()/1000)+3600,...extra});
const item=(id,extra={})=>({id:id.repeat(8)+'-'+id.repeat(4)+'-4'+id.repeat(3)+'-8'+id.repeat(3)+'-'+id.repeat(12),household_id:H,name:'Milk',quantity:1,unit:'l',created_by:A,added_by_name:'Alex',completed:false,completed_by:null,revision:1,...extra});

async function fixture({items=[],initialSession=session(),status={}}={}){
 const values=new Map(initialSession?[[SESSION,JSON.stringify(initialSession)]]:[]),listeners=new Map(),tasks=[],mutations=[],observers=[],calls=[];
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 let doc,observing=false,placements=0,sharing=0;
 const matches=(node,selector)=>selector.split(',').some(raw=>{
  const parts=raw.trim().split(/\s+/),last=parts.pop();
  const simple=(entry,part)=>{
   if(part==='*')return true;
   const id=part.match(/#([\w-]+)/)?.[1];if(id&&entry.id!==id)return false;
   if([...part.matchAll(/\.([\w-]+)/g)].some(([,name])=>!entry.className.split(/\s+/).includes(name)))return false;
   const tag=part.match(/^[a-z]+/i)?.[0];if(tag&&entry.tagName!==tag.toUpperCase())return false;
   for(const [,name,value]of part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)){if(!entry.hasAttribute(name)||value!==undefined&&entry.getAttribute(name)!==value)return false;}
   return true;
  };
  if(!simple(node,last))return false;
  let parent=node.parentNode;while(parts.length){const wanted=parts.pop();while(parent&&!simple(parent,wanted))parent=parent.parentNode;if(!parent)return false;parent=parent.parentNode;}return true;
 });
 const record=(target,addedNodes=[],removedNodes=[])=>{if(observing)mutations.push({type:'childList',target,addedNodes,removedNodes});};
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.nodeType=1;this.children=[];this.parentNode=null;this.className='';this.attributes=new Map();this.dataset={};this.events=new Map();this.style={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');},toggle:(name,force)=>{const active=force??!this.classList.contains(name);this.classList[active?'add':'remove'](name);return active;}};}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  prepend(...nodes){for(const node of [...nodes].reverse())this.insertBefore(node,this.firstElementChild);}
  insertBefore(node,anchor){if(node===anchor)return node;node.remove();const index=anchor===null?this.children.length:this.children.indexOf(anchor);assert.ok(index>=0,'insertion anchor belongs to parent');this.children.splice(index,0,node);node.parentNode=this;if(node.id==='bbSharedShopping')placements++;record(this,[node]);return node;}
  before(...nodes){assert.ok(this.parentNode,'before target has a parent');for(const node of nodes)this.parentNode.insertBefore(node,this);}
  remove(){if(!this.parentNode)return;const parent=this.parentNode;parent.children=parent.children.filter(node=>node!==this);this.parentNode=null;record(parent,[],[this]);}
  replaceChildren(...nodes){const old=[...this.children];for(const node of old)node.parentNode=null;this.children=[];record(this,[],old);this.append(...nodes);}
  setAttribute(key,value){this.attributes.set(key,String(value));if(key==='class')this.className=String(value);if(key==='id')this.id=String(value);}
  getAttribute(key){return this.attributes.get(key)??null;}
  hasAttribute(key){return this.attributes.has(key);}
  addEventListener(name,fn){const handlers=this.events.get(name)||[];handlers.push(fn);this.events.set(name,handlers);}
  click(){for(const fn of this.events.get('click')||[])fn({target:this,preventDefault(){}});}
  focus(){doc.activeElement=this;}
  scrollIntoView(){this.scrolled=true;}
  querySelectorAll(selector){return descendants(this).slice(1).filter(node=>matches(node,selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  matches(selector){return matches(this,selector);}
  contains(node){return descendants(this).includes(node);}
  get firstElementChild(){return this.children[0]||null;}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  get nextElementSibling(){return this.nextSibling;}
  get previousElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)-1]||null;}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  set textContent(value){this._text=String(value);for(const node of this.children)node.parentNode=null;this.children=[];}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 }
 doc={readyState:'complete',hidden:false,activeElement:null,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),addEventListener(){},getElementById:id=>descendants(doc.body).find(node=>node.id===id)||null,querySelector:selector=>doc.body.querySelector(selector)};
 doc.body=new Element('body');doc.body.classList.add('bb172-storefront-visible');doc.body.dataset.bbnextView='shop-list';
 const app=new Element('main');app.id='app';doc.body.append(app);
 const storefront=new Element('section');storefront.id='bb172Storefront';doc.body.append(storefront);
 const buildStorefront=()=>{const header=new Element('header');header.className='bb172-storefront-header';const controls=new Element('div');controls.className='bb172-storefront-controls';const main=new Element('main');storefront.replaceChildren(header,controls,main);return {header,controls,main};};
 let parts=buildStorefront();
 const win={document:doc,localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))},queueMicrotask:fn=>tasks.push(fn),crypto:{randomUUID(){throw Error('UI fixture does not create items');}},setInterval(){return 1;},addEventListener(name,fn){const handlers=listeners.get(name)||[];handlers.push(fn);listeners.set(name,handlers);},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){observing=true;}},BBSharedShoppingHost:{openSharing(){sharing++;}},fetch:async(url,init)=>{
  calls.push({url,init});assert.equal(init.method,'GET','UI tests never perform live or synthetic API writes');
  const data=url.includes('mode=status')?{configured:true,premium:true,role:'owner',household_id:H,...status}:{ok:true,household_id:H,items};
  return {ok:true,status:200,json:async()=>data};
 }};
 const flush=async()=>{for(let round=0;round<60;round++){while(tasks.length)tasks.shift()();if(mutations.length){const records=mutations.splice(0);for(const callback of observers)callback(records);}await Promise.resolve();if(!tasks.length&&!mutations.length){await Promise.resolve();if(!tasks.length&&!mutations.length)return;}}assert.fail('shared UI did not settle; possible observer loop');};
 install(win);await flush();await win.BBSharedShopping.refresh({force:true});await flush();
 return {win,doc,storefront,values,calls,flush,parts:()=>parts,replaceStorefront(){parts=buildStorefront();return parts;},placements:()=>placements,sharing:()=>sharing,dispatch(name,event={}){for(const fn of listeners.get(name)||[])fn(event);}};
}

const findName=card=>card.querySelectorAll('input').find(node=>node.name==='name');

test('shared additions stay in the storefront below its header and survive storefront replacement with the same draft',async()=>{
 const h=await fixture(),card=h.doc.getElementById('bbSharedShopping'),form=h.doc.getElementById('bbSharedShoppingForm');
 assert.equal(card.parentNode,h.storefront);assert.equal(h.storefront.firstElementChild,h.parts().header);assert.equal(card.nextSibling,h.parts().controls);
 h.win.BBSharedShopping.openAdd();const name=findName(card);name.value='Washing-up liquid';
 h.replaceStorefront();await h.flush();
 assert.equal(h.doc.getElementById('bbSharedShopping'),card);assert.equal(h.doc.getElementById('bbSharedShoppingForm'),form);assert.equal(findName(card),name);assert.equal(name.value,'Washing-up liquid');assert.equal(form.hidden,false);
 assert.equal(h.storefront.firstElementChild,h.parts().header);assert.equal(card.nextSibling,h.parts().controls);assert.equal(h.doc.body.querySelectorAll('#bbSharedShopping').length,1);
 const placements=h.placements();h.win.BBSharedShopping.afterRender();await h.flush();assert.equal(h.placements(),placements,'stable placement does not reinsert the card or create an observer loop');
});

test('Add item opens and focuses the existing form while Partner Sharing stays available beside it',async()=>{
 const h=await fixture(),card=h.doc.getElementById('bbSharedShopping'),add=card.querySelector('.bbss-add'),connect=card.querySelector('.bbss-connect'),form=h.doc.getElementById('bbSharedShoppingForm'),name=findName(card);
 assert.ok(connect);assert.equal(connect.hidden,false);assert.equal(connect.parentNode,add.parentNode);assert.match(connect.textContent,/Partner Sharing/);assert.equal(form.hidden,true);
 h.win.BBSharedShopping.openAdd();assert.equal(form.hidden,false);assert.equal(h.doc.activeElement,name);assert.equal(add.getAttribute('aria-expanded'),'true');name.value='Bread';
 h.win.BBSharedShopping.openAdd();assert.equal(form.hidden,false);assert.equal(name.value,'Bread');assert.equal(h.doc.activeElement,name);
 connect.click();assert.equal(h.sharing(),1);assert.equal(form.hidden,false);assert.equal(h.calls.some(call=>call.init.method==='POST'),false);
});

test('Add item routes a gated household to its existing sharing flow',async()=>{
 for(const options of [{initialSession:null},{status:{premium:false,household_id:null}}]){
  const h=await fixture(options),form=h.doc.getElementById('bbSharedShoppingForm');
  h.win.BBSharedShopping.openAdd();assert.equal(h.sharing(),1);assert.equal(form.hidden,true);assert.equal(h.doc.getElementById('bbSharedShopping').querySelector('.bbss-add').getAttribute('aria-expanded'),'false');
 }
});

test('only another signed-in creator gets the partner icon and badge while creator names remain visible',async()=>{
 const own=item('5'),partner=item('6',{created_by:B,added_by_name:'Sam',name:'Eggs'}),former=item('7',{created_by:null,added_by_name:null,name:'Soap'}),done=item('8',{created_by:B,added_by_name:'Sam',completed:true,completed_by:A,name:'Tea'});
 const h=await fixture({items:[own,partner,former,done]}),card=h.doc.getElementById('bbSharedShopping'),rows=card.querySelectorAll('.bbss-item');
 for(const entry of [own,partner,former,done]){
  const row=rows.find(node=>node.dataset.sharedItem===entry.id),expected=entry.created_by===B;
  assert.ok(row);assert.equal(row.classList.contains('is-partner-added'),expected);
  assert.equal(!!row.querySelector('.bbss-partner-badge'),expected);
  if(expected){assert.match(row.querySelector('.bbss-partner-badge').textContent,/Partner added/);assert.equal(row.querySelector('.bbss-partner-icon').getAttribute('aria-hidden'),'true');}
  assert.match(row.querySelector('.bbss-attribution').textContent,entry.created_by===null?/Added by Former household member/:new RegExp('Added by '+entry.added_by_name));
 }
});

test('an expired or invalid actor cannot retain partner attribution on rendered rows',async()=>{
 for(const invalidSession of [session(A,{expires_at:1}),session('not-a-uuid'),session(A,{access_token:null})]){
  const h=await fixture({items:[item('6',{created_by:B,added_by_name:'Sam'})]});
  h.values.set(SESSION,JSON.stringify(invalidSession));h.win.BBSharedShopping.afterRender();await h.flush();
  assert.equal(h.doc.body.querySelectorAll('.is-partner-added').length,0);assert.equal(h.doc.body.querySelectorAll('.bbss-partner-badge').length,0);
 }
});
