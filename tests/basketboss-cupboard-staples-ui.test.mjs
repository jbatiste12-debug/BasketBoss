import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const ui=createRequire(import.meta.url)('../bb-cupboard-staples.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({items=[{key:'soy sauce',name:'Soy sauce',container:'bottle',days:['Thursday'],active:false}],promote,tab='shop-list',auto=false}={}){
 let doc,actor='alice';const calls=[],events=new Map(),frames=[],observers=[];
 const walk=node=>[node,...node.children.flatMap(walk)];
 class Node{
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),ownerDocument:doc,parentNode:null,children:[],className:'',id:'',dataset:{},attributes:new Map(),handlers:new Map(),hidden:false,disabled:false,open:false,_text:''});}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  set textContent(value){this._text=String(value);this.replaceChildren();}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  get isConnected(){return this===doc.body||this===doc.head||!!this.parentNode?.isConnected;}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='id')this.id=String(value);}
  getAttribute(name){return this.attributes.get(name)??null;}
  addEventListener(name,fn){const list=this.handlers.get(name)||[];list.push(fn);this.handlers.set(name,list);}
  async fire(name){await Promise.all((this.handlers.get(name)||[]).map(fn=>fn({target:this})));}
 }
 doc={readyState:'complete',createElement:tag=>new Node(tag),getElementById:id=>[...walk(doc.head),...walk(doc.body)].find(node=>node.id===id)||null,querySelector:()=>null};doc.head=new Node('head');doc.body=new Node('body');doc.body.dataset.bbnextView=tab;
 let app=new Node('main');app.id='app';doc.body.append(app);
 const api={items:()=>items,promote:async key=>{calls.push(key);if(promote)return promote(key);items=items.map(row=>row.key===key?{...row,active:true}:row);return {ok:true};}};
 const win={document:doc,BBHome:{actor:()=>actor},BBCupboardStaples:api,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}},addEventListener:(name,fn)=>{events.set(name,fn);},removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}};
 const controller=auto?ui.install(win):null,view=auto?null:ui.mount({container:app,win});
 const nodes=()=>walk(doc.body),find=cls=>nodes().find(node=>node.className.split(' ').includes(cls)),buttons=()=>nodes().filter(node=>node.tagName==='BUTTON');
 return {win,doc,api,view,controller,calls,events,nodes,find,buttons,panel:()=>doc.getElementById('bbCupboardStaples'),items:value=>{items=value;},actor:value=>{actor=value;},
  flush(){while(frames.length)frames.shift()();},navigate(value){doc.body.dataset.bbnextView=value;controller.refresh();this.flush();},
  addContainer(id,parent=app){const node=new Node('section');node.id=id;parent.append(node);return node;},app:()=>app,
  replaceApp(){app.remove();app=new Node('main');app.id='app';doc.body.append(app);controller.refresh();this.flush();}};
}

test('weekly reminder starts collapsed, displays clean days and standard container, and excludes active items',()=>{
 const h=fixture({items:[{key:'soy sauce',name:'Soy sauce',container:'bottle',days:['Thursday','Mon','Thursday','source needs review'],active:false},{key:'honey',name:'Honey',container:'jar',days:['Tuesday'],active:true}]});
 assert.equal(h.panel().open,false);assert.equal(h.panel().hidden,false);assert.match(h.panel().textContent,/Check your cupboard/);assert.match(h.panel().textContent,/1 staple to check/);
 assert.equal(h.find('bbcs-days').textContent,'For: Mon · Thu');assert.equal(h.find('bbcs-pack').textContent,'1 bottle');assert.doesNotMatch(h.panel().textContent,/Honey|source needs review|check unit/);
 assert.equal(h.buttons().length,1);assert.equal(h.buttons()[0].textContent,'+ Add to list');assert.equal(h.buttons()[0].getAttribute('aria-label'),'Add Soy sauce to shopping list');
});

test('one tap promotes once and the active staple leaves cupboard reminders',async()=>{
 const h=fixture();h.panel().open=true;await h.buttons()[0].fire('click');assert.deepEqual(h.calls,['soy sauce']);assert.equal(h.buttons().length,0);assert.equal(h.panel().hidden,true);
});

test('an asynchronous promotion disables duplicate taps, then leaves a retry after failure',async()=>{
 let resolve;const h=fixture({promote:()=>new Promise(done=>{resolve=done;})}),button=h.buttons()[0];const pending=button.fire('click');await tick();
 assert.equal(button.disabled,true);await button.fire('click');assert.deepEqual(h.calls,['soy sauce']);resolve({ok:false,message:'source needs review'});await pending;
 assert.equal(h.buttons()[0].disabled,false);assert.match(h.find('bbcs-status').textContent,/could not be added/);assert.doesNotMatch(h.panel().textContent,/source needs review/);
});

test('late original-account completion cannot announce success or block the current account',async()=>{
 let resolve;const h=fixture({promote:()=>new Promise(done=>{resolve=done;})});h.panel().open=true;const pending=h.buttons()[0].fire('click');await tick();h.actor('bob');h.view.render();
 assert.equal(h.panel().open,false);assert.equal(h.buttons()[0].disabled,false);resolve({ok:true});await pending;assert.equal(h.find('bbcs-status').textContent,'');assert.equal(h.buttons()[0].disabled,false);
});

test('reminder names are text and unchanged data keeps the same DOM nodes',()=>{
 const name='<img src=x onerror=alert(1)>';const h=fixture({items:[{key:'unsafe',name,container:'unknown',days:[]}]});const button=h.buttons()[0];assert.ok(h.panel().textContent.includes(name));assert.equal(h.nodes().filter(node=>node.tagName==='IMG').length,0);assert.equal(h.find('bbcs-pack').textContent,'1 pack');assert.equal(h.find('bbcs-days').textContent,'Pantry top-up');h.view.render();assert.equal(h.buttons()[0],button);
});

test('installer mounts only on Shop, remounts after app replacement, and removes the panel on At home',()=>{
 const h=fixture({auto:true,tab:'shop'});assert.equal(h.panel(),null);h.navigate('shop-list');assert.ok(h.panel());assert.equal(h.panel().open,false);const first=h.panel();first.open=true;h.replaceApp();assert.ok(h.panel());assert.notEqual(h.panel(),first);assert.equal(h.panel().open,true,'a Shop refresh preserves the open drawer');h.navigate('shop');assert.equal(h.panel(),null);h.controller.destroy();assert.equal(h.events.size,0);
});


test('drawer follows the visible release snapshot, mobile snapshot and free full list',()=>{
 const h=fixture({auto:true}),overview=h.addContainer('bbReleaseShopOverview',h.doc.body),mobile=h.addContainer('bbMobileShopPreview'),list=h.addContainer('bb321Printable');
 h.doc.body.className='bb-r6-shop-ready';h.app().className='bbmobile-shop-overview';h.controller.refresh();h.flush();assert.equal(h.panel().parentNode,overview);assert.equal(h.panel().open,false);h.panel().open=true;
 h.doc.body.className='bb-r6-shop-ready bb-weekly-basic-open';h.controller.refresh();h.flush();assert.equal(h.panel().parentNode,list,'basic mode hides the mobile preview and shows the canonical list');assert.equal(h.panel().open,true);
 h.doc.body.className='';h.controller.refresh();h.flush();assert.equal(h.panel().parentNode,mobile);assert.equal(h.panel().open,true);
 h.app().className='';h.controller.refresh();h.flush();assert.equal(h.panel().parentNode,h.app());assert.equal(h.panel().open,true);
 h.navigate('shop');assert.equal(h.panel(),null);
});
