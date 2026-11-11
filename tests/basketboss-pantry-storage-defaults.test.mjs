import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as Core from '../bb-receipt-inventory-core.mjs';
const {normalizeStockMap}=Core;

const homeModule=createRequire(import.meta.url)('../bb-home.js');
const pantryPolicy=createRequire(import.meta.url)('../bb-pantry-policy.js');
const source=fs.readFileSync(new URL('../shopping-inventory.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pantrySource=html.match(/const BB307Pantry=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/)[0];
const INVENTORY='basketboss_makeameal_v1_inventory',STOCK='basketboss_321_v7_measured_pantry';
const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase());

// Small DOM fixture: run the real picker handlers, persistence, Home contract,
// pantry allocator and online stock validator without depending on a browser.
function fixture({requirements=[{key:'Honey',unit:'tbsp',required:2},{key:'Lettuce',unit:'each',required:.5}],inventory={},stock={},onlineError=false,live=false,classifier=true}={}){
 const values=new Map([[INVENTORY,JSON.stringify(inventory)],[STOCK,JSON.stringify(stock)]]);
 let doc,shopVisits=0,syncs=0;
 function matches(node,selector){
  return selector.split(',').some(part=>{
   part=part.trim();const pieces=part.match(/(?:[^\s[]|\[[^\]]*\])+/g)||[];
   if(pieces.length>1){if(!matches(node,pieces.at(-1)))return false;for(let parent=node.parentNode;parent;parent=parent.parentNode)if(matches(parent,pieces.slice(0,-1).join(' ')))return true;return false;}
   const attr=[...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
   if(attr.some(([,key,value])=>!node.attributes.has(key)||(value!==undefined&&node.attributes.get(key)!==value)))return false;
   part=part.replace(/\[[^\]]*\]/g,'');const id=part.match(/#([\w-]+)/)?.[1];if(id&&node.id!==id)return false;
   for(const [,name]of part.matchAll(/\.([\w-]+)/g))if(!node.className.split(' ').includes(name))return false;
   const tag=part.match(/^[a-z]+/i)?.[0];return !tag||node.tagName===tag.toUpperCase();
  });
 }
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.events=new Map();this.attributes=new Map();this.dataset={};this.className='';this.value='';this._text='';this.disabled=false;this.style={};}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  prepend(node){node.remove();node.parentNode=this;this.children.unshift(node);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  setAttribute(key,value){this.attributes.set(key,String(value));if(key==='id')this.id=value;if(key==='class')this.className=value;if(key==='value')this.value=value;if(key.startsWith('data-'))this.dataset[dataKey(key)]=value;}
  querySelectorAll(selector){const all=this.children.flatMap(node=>[node,...node.querySelectorAll('*')]);return all.filter(node=>selector==='*'||matches(node,selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parentNode)if(matches(node,selector))return node;return null;}
  addEventListener(name,fn){const list=this.events.get(name)||[];list.push(fn);this.events.set(name,list);}
  async dispatch(type){const target=this,promises=[];for(let node=this;node;node=node.parentNode)for(const fn of node.events.get(type)||[])promises.push(fn({target,preventDefault(){}}));await Promise.all(promises);}
  click(){return this.dispatch('click');}
  focus(){doc.activeElement=this;}
  scrollIntoView(){this.scrolled=true;}
  get firstElementChild(){return this.children[0]||null;}
  get isConnected(){for(let node=this;node;node=node.parentNode)if(node===doc.body||node===doc.head)return true;return false;}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  set innerHTML(markup){
   this.children=[];this._text='';const stack=[this];
   for(const token of markup.match(/<[^>]+>|[^<]+/g)||[]){
    if(token.startsWith('</')){stack.pop();continue;}
    if(token.startsWith('<')){
     const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const node=new Element(tag);
     for(const [,key,value]of token.matchAll(/\s([^\s=/>]+)(?:="([^"]*)")?/g))node.setAttribute(key,decode(value??''));
     stack.at(-1).append(node);if(!['input','br','hr','img'].includes(tag))stack.push(node);
    }else stack.at(-1)._text+=decode(token);
   }
   for(const select of this.querySelectorAll('select'))select.value=(select.querySelector('option[selected]')||select.querySelector('option'))?.attributes.get('value')||'';
  }
 }
 doc={readyState:'complete',activeElement:null,head:new Element('head'),body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>doc.body.querySelector('#'+id),querySelector:selector=>doc.body.querySelector(selector)};
 const app=new Element('main');app.id='app';const panel=new Element('section');panel.id='bb172StaplesPanel';app.append(panel);doc.body.append(app);
 for(const tab of ['shop','shop-list']){const button=new Element('button');button.setAttribute('class',tab==='shop'?'tab active':'tab');button.setAttribute('data-tab',tab);if(tab==='shop-list')button.addEventListener('click',()=>shopVisits++);doc.body.append(button);}
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const win={document:doc,localStorage:storage,location:{search:''},BBPantryLiveSync:live,scrollTo(){},BBReceiptHost:{confirmCurrentPantry:async({stock})=>{syncs++;if(onlineError)return {ok:false,needsReview:true};normalizeStockMap(stock);return {ok:true};},reviewPantry:async()=>{}}};
 const context=vm.createContext({window:win,document:doc,localStorage:storage,MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),queueMicrotask,setTimeout,clearTimeout,console});
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 context.BBPriceV19=win.BBPriceV19;context.BB_WHOLE_PRODUCE_GRAMS={};vm.runInContext(pantrySource+'\nthis.pantry=BB307Pantry;',context);const pantry=context.pantry;
 const readStock=()=>JSON.parse(storage.getItem(STOCK)||'{}');
 win.BBHomeHost={id:pantry.pantryId,stock:readStock,requirements:()=>requirements,household:()=>[],reload(){},settlePurchases:()=>null,consume:pantry.reconcileStock};
 win.BBHome=homeModule.install(win);if(classifier){const start=html.indexOf('function bb83StockLoc('),end=html.indexOf('\n}',start);assert.ok(start>=0&&end>start);vm.runInContext(html.slice(start,end+2),context);win.bb83StockLoc=context.bb83StockLoc;}vm.runInContext(source,context);
 const selected=()=>doc.getElementById('bb5SelectedRows');
 const control=(attribute,key)=>selected().querySelector('['+attribute+'="'+key+'"]');
 return {win,doc,storage,values,pantry,requirements,selected,control,
  choose:async(name,loc)=>{const area=doc.querySelector('[data-bb76-store="'+loc+'"]');await area.querySelector('[data-bb5-food="'+name+'"]').click();},
  enough:async key=>{const button=control('data-bb5-enough',key);assert.ok(button,'coverage action exists for '+key);await button.click();},
  confirm:()=>doc.getElementById('bb5Reconcile').click(),
  needed:()=>{const used=pantry.reconcileStock(readStock(),requirements).pantry;return requirements.map(row=>({...row,toBuy:Math.max(0,row.required-(used[pantry.pantryId(row.key,row.unit)]||0))}));},
  stock:readStock,inventory:()=>JSON.parse(storage.getItem(INVENTORY)),visits:()=>shopVisits,syncs:()=>syncs,status:()=>doc.getElementById('bb5StockStatus').textContent};
}

test('unmanaged chilled cheeses use the existing classifier without changing their amounts',async()=>{
 const stock={'mozzarella|each':4,'mozzarella torn|g':250,'ricotta|g':125},h=fixture({requirements:[],stock});
 for(const [name,quantity,unit]of [['mozzarella',4,'each'],['mozzarella torn',250,'g'],['ricotta',125,'g']]){
  const row=h.win.BBPantryEditor.list().find(row=>row.name===name);
  assert.ok(row);assert.equal(row.loc,'fridge');assert.equal(row.qty,quantity);assert.equal(row.unit,unit);
 }
 await h.confirm();assert.deepEqual(h.stock(),stock);
 for(const row of Object.values(h.inventory()))assert.equal(row.loc,'fridge');
});

test('importing measured stock preserves saved cupboard and freezer choices and known cupboard presets',async()=>{
 for(const loc of ['cupboard','freezer']){
  const key=loc+'|mozzarella',record={name:'Mozzarella',loc,selected:true,qty:4,unit:'each',bb173StockKey:'mozzarella|each',bb173StockValue:4};
  const h=fixture({requirements:[],inventory:{[key]:record},stock:{'mozzarella|each':4}});
  assert.equal(h.win.BBPantryEditor.list().find(row=>row.name==='Mozzarella').loc,loc);
  await h.confirm();assert.equal(h.inventory()[key].loc,loc);assert.equal(h.stock()['mozzarella|each'],4);
 }
 const h=fixture({requirements:[],stock:{'rice|g':200}});
 assert.equal(h.win.BBPantryEditor.list().find(row=>row.name==='rice').loc,'cupboard');
});

test('legacy imports without a host classifier keep their original default and manual locations stay explicit',async()=>{
 const h=fixture({requirements:[],stock:{'ricotta|g':125},classifier:false});
 assert.equal(h.win.BBPantryEditor.list().find(row=>row.name==='ricotta').loc,'cupboard');
 const added=h.win.BBPantryEditor.add({name:'Mozzarella',loc:'freezer',qty:2,unit:'each'});
 assert.equal(added.ok,true);await h.win.BBPantryEditor.flush();
 assert.equal(h.win.BBPantryEditor.read(added.key).loc,'freezer');
});

function receiptFixture({existingLocation,classifier=true}={}){
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 if(existingLocation){storage.setItem(STOCK,JSON.stringify({'mozzarella|each':2}));storage.setItem(INVENTORY,JSON.stringify({[existingLocation+'|mozzarella']:{name:'Mozzarella',loc:existingLocation,selected:true,qty:2,unit:'each',bb173StockKey:'mozzarella|each',bb173StockValue:2}}));}
 const root={localStorage:storage,addEventListener(){},queueMicrotask,console};root.window=root;
 for(const file of ['basketboss-pricing-v19.js','bb-receipt-inventory.js'])vm.runInNewContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),root);
 if(classifier){const start=html.indexOf('function bb83StockLoc('),end=html.indexOf('\n}',start);vm.runInNewContext(html.slice(start,end+2),root);}
 const adapter=root.BBReceiptInventoryFactory({core:Core,storage,getSession:()=>({user:{id:'storage_user_01'},access_token:'fixture-token',expires_at:9999999999}),getContext:()=>({market:'UK',retailer:'Fixture',shopSessionId:'shop-storage'}),getCatalog:()=>({'mozzarella|each':{}})});
 const commit=location=>adapter.commitLocalReceipt({receiptId:'receipt-storage-test',market:'UK',retailer:'Fixture',shopSessionId:'shop-storage',items:[{name:'Mozzarella',key:'mozzarella',classification:'food',quantity:4,unit:'each',price:2,...(location===undefined?{}:{location})}]});
 return {values,commit,stock:()=>JSON.parse(storage.getItem(STOCK)||'{}'),rows:()=>Object.values(JSON.parse(storage.getItem(INVENTORY)||'{}'))};
}

test('a local receipt keeps its validated incoming fridge location and exact purchase quantity',async()=>{
 const h=receiptFixture(),result=await h.commit('fridge');
 assert.equal(result.ok,true);assert.equal(h.stock()['mozzarella|each'],4);assert.equal(h.rows()[0].loc,'fridge');assert.equal(h.rows()[0].qty,4);
 assert.equal((await h.commit('fridge')).duplicate,true);assert.equal(h.stock()['mozzarella|each'],4);
});

test('receipt classification supplies only missing locations and preserves explicit saved choices',async()=>{
 for(const loc of ['cupboard','fridge','freezer']){
  const h=receiptFixture({existingLocation:loc});await h.commit('fridge');
  assert.equal(h.stock()['mozzarella|each'],6);assert.equal(h.rows().filter(row=>row.selected)[0].loc,loc);
 }
 for(const loc of ['cupboard','freezer']){const h=receiptFixture();await h.commit(loc);assert.equal(h.rows()[0].loc,loc);}
 const missing=receiptFixture();await missing.commit();assert.equal(missing.rows()[0].loc,'fridge');
 const invalid=receiptFixture();await invalid.commit('wardrobe');assert.equal(invalid.rows()[0].loc,'fridge');
 const legacy=receiptFixture({classifier:false});await legacy.commit();assert.equal(legacy.rows()[0].loc,'cupboard');
});
