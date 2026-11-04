import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),homeModule=require('../bb-home.js');
const source=fs.readFileSync(new URL('../shopping-inventory.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pantrySource=html.match(/const BB307Pantry=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/)[0];
const INVENTORY='basketboss_makeameal_v1_inventory',STOCK='basketboss_321_v7_measured_pantry';
const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase());
async function fixture({requirements=[{key:'Honey',unit:'tbsp',required:2},{key:'Lettuce',unit:'each',required:.5}],inventory={},stock={},onlineError=false,live=false}={}){
 const values=new Map([[INVENTORY,JSON.stringify(inventory)],[STOCK,JSON.stringify(stock)]]);
 let doc,shopVisits=0,syncs=0;
 function matches(node,selector){
  return selector.split(',').some(part=>{
   const segments=part.trim().split(/\s+(?![^\[]*\])/);if(segments.length>1){if(!matches(node,segments.pop()))return false;let ancestor=node.parentNode;while(segments.length){const wanted=segments.pop();while(ancestor&&!matches(ancestor,wanted))ancestor=ancestor.parentNode;if(!ancestor)return false;ancestor=ancestor.parentNode;}return true;}
   part=part.trim();const attr=[...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
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
  get isConnected(){for(let node=this;node;node=node.parentNode)if(node===doc.body)return true;return false;}
  get firstElementChild(){return this.children[0]||null;}
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
 const win={BBPantryLiveSync:live,document:doc,localStorage:storage,location:{search:''},scrollTo(){},BBReceiptHost:{confirmCurrentPantry:async({stock})=>{syncs++;if(onlineError)return {ok:false,needsReview:true};receiptCore.normalizeStockMap(stock);return {ok:true};},reviewPantry:async()=>{}}};
 const context=vm.createContext({window:win,document:doc,localStorage:storage,MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),setTimeout,clearTimeout,queueMicrotask,console});
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 context.BBPriceV19=win.BBPriceV19;context.BB_WHOLE_PRODUCE_GRAMS={};vm.runInContext(pantrySource+'\nthis.pantry=BB307Pantry;',context);const pantry=context.pantry;
 const readStock=()=>JSON.parse(storage.getItem(STOCK)||'{}');
 win.BBHomeHost={id:pantry.pantryId,stock:readStock,requirements:()=>requirements,household:()=>[],reload(){},settlePurchases:()=>null,consume:pantry.reconcileStock};
 win.BBHome=homeModule.install(win);win.BBPantryPolicy=policy;win.BBReceiptInventoryCore=receiptCore;vm.runInContext(source,context);await new Promise(resolve=>setTimeout(resolve,0));
 const selected=()=>doc.getElementById('bb5SelectedRows');
 const control=(attribute,key)=>selected().querySelector('['+attribute+'="'+key+'"]');
 return {win,doc,storage,values,pantry,requirements,selected,control,
  choose:async(name,loc)=>{const area=doc.querySelector('[data-bb76-store="'+loc+'"]');await area.querySelector('[data-bb5-food="'+name+'"]').click();},
  enough:async key=>{const button=control('data-bb5-enough',key);assert.ok(button,'coverage action exists for '+key);await button.click();},
  confirm:()=>doc.getElementById('bb5Reconcile').click(),
  needed:()=>{const used=pantry.reconcileStock(readStock(),requirements).pantry;return requirements.map(row=>({...row,toBuy:Math.max(0,row.required-(used[pantry.pantryId(row.key,row.unit)]||0))}));},
  stock:readStock,inventory:()=>JSON.parse(storage.getItem(INVENTORY)),visits:()=>shopVisits,syncs:()=>syncs,status:()=>doc.getElementById('bb5StockStatus').textContent};
}

test('staple picker uses status and container count, then saves In Stock without a measured volume',async()=>{
 const h=await fixture({requirements:[]});await h.choose('Ketchup','cupboard');
 const status=h.control('data-bb5-staple-status','cupboard|ketchup');assert.ok(status);assert.equal(status.value,'in');
 assert.equal(h.control('data-bb5-qty','cupboard|ketchup').value,'1');assert.equal(h.control('data-bb5-unit','cupboard|ketchup').value,'each');
 await h.confirm();assert.deepEqual(h.stock(),{'ketchup|each':1});assert.equal(h.inventory()['cupboard|ketchup'].stapleStatus,'in');assert.equal(h.inventory()['cupboard|ketchup'].staple,true);
});

test('Low and Out statuses preserve the explicit signal and Out retains a pantry record at zero containers',async()=>{
 for(const status of ['low','out']){
  const h=await fixture({requirements:[]});await h.choose('Honey','cupboard');const control=h.control('data-bb5-staple-status','cupboard|honey');control.value=status;await control.dispatch('change');await h.confirm();
  const row=h.inventory()['cupboard|honey'];assert.equal(row.stapleStatus,status);assert.equal(row.selected,true);assert.equal(row.unit,'each');assert.equal(row.qty,status==='out'?0:1);
  assert.equal(h.stock()['honey|each']??0,status==='out'?0:1);
 }
});

test('opening legacy measured staples changes no saved data until explicit confirmation',async()=>{
 const inventory={'cupboard|ketchup':{name:'Ketchup',loc:'cupboard',unit:'ml',qty:800,selected:true,bb173StockKey:'ketchup|ml',bb173StockValue:800}};
 const h=await fixture({requirements:[],inventory,stock:{'ketchup|ml':800}});assert.deepEqual(h.stock(),{'ketchup|ml':800});assert.equal(h.inventory()['cupboard|ketchup'].unit,'ml');
 assert.equal(h.control('data-bb5-qty','cupboard|ketchup').value,'1');await h.confirm();assert.deepEqual(h.stock(),{'ketchup|each':1});assert.equal(h.inventory()['cupboard|ketchup'].stapleStatus,'in');
});

test('a tin source and measured stock of chopped tomatoes merge to one 800g pantry row on confirmation',async()=>{
 const inventory={'cupboard|tomatoes':{name:'Chopped tomatoes',loc:'cupboard',unit:'tin',qty:1,selected:true,bb173StockKey:'chopped tomatoes|tin',bb173StockValue:1},'cupboard|tomatoes|grams':{name:'Chopped tomatoes',loc:'cupboard',unit:'g',qty:400,selected:true,bb173StockKey:'chopped tomatoes|g',bb173StockValue:400}};
 const h=await fixture({requirements:[{key:'Chopped tomatoes',unit:'g',required:1000}],inventory,stock:{'chopped tomatoes|tin':1,'chopped tomatoes|g':400}});
 assert.equal(h.control('data-bb5-qty','cupboard|tomatoes').value,'800');assert.match(h.control('data-bb5-buy','cupboard|tomatoes').textContent,/2 tins \(800 g\)/);await h.confirm();
 assert.deepEqual(h.stock(),{'chopped tomatoes|g':800});const selected=Object.values(h.inventory()).filter(row=>row.selected);assert.equal(selected.length,1);assert.equal(selected[0].qty,800);assert.equal(selected[0].unit,'g');
});

test('a reviewed pack size overrides its UK default at manual confirmation',async()=>{
 const h=await fixture({requirements:[]});await h.choose('Frozen mince','freezer');
 let unit=h.control('data-bb5-unit','freezer|frozen mince');unit.value='pack';await unit.dispatch('change');
 let qty=h.control('data-bb5-qty','freezer|frozen mince');qty.value='2';await qty.dispatch('input');
 const contents=h.control('data-bb5-pack-quantity','freezer|frozen mince');contents.value='300';await contents.dispatch('input');
 const contentsUnit=h.control('data-bb5-pack-unit','freezer|frozen mince');contentsUnit.value='g';await contentsUnit.dispatch('change');await h.confirm();
 assert.deepEqual(h.stock(),{'frozen mince|g':600});const row=h.inventory()['freezer|frozen mince'];assert.equal(row.packQuantity,300);assert.equal(row.packReviewed,true);assert.equal(row.packEstimated,false);
});

test('an unknown package stays intact while an unrelated measured quantity can be confirmed',async()=>{
 const inventory={'cupboard|rice':{name:'Rice',loc:'cupboard',unit:'pack',qty:.5,selected:true,bb173StockKey:'rice|pack',bb173StockValue:.5}};
 const h=await fixture({requirements:[{key:'Milk',unit:'ml',required:500}],inventory,stock:{'rice|pack':.5}});await h.choose('Milk','fridge');
 const qty=h.control('data-bb5-qty','fridge|milk');qty.value='250';await qty.dispatch('input');await h.confirm();
 assert.equal(h.stock()['rice|pack'],.5);assert.equal(h.stock()['milk|ml'],250);assert.equal(h.inventory()['cupboard|rice'].qty,.5);assert.equal(h.inventory()['cupboard|rice'].unit,'pack');assert.match(h.status(),/review|Check the units/i);
});

test('a counted whole Pepper stays a measured produce row when another pantry amount is confirmed',async()=>{
 const inventory={'fridge|pepper':{name:'Pepper',loc:'fridge',unit:'each',qty:2,selected:true,bb173StockKey:'pepper|each',bb173StockValue:2}};
 const h=await fixture({requirements:[{key:'Milk',unit:'ml',required:500}],inventory,stock:{'pepper|each':2}});
 assert.equal(h.control('data-bb5-staple-status','fridge|pepper'),null);
 assert.equal(h.control('data-bb5-qty','fridge|pepper').value,'2');
 await h.choose('Milk','fridge');const qty=h.control('data-bb5-qty','fridge|milk');qty.value='250';await qty.dispatch('input');await h.confirm();
 assert.equal(h.stock()['pepper|each'],2);assert.equal(h.stock()['milk|ml'],250);assert.equal(h.inventory()['fridge|pepper'].unit,'each');assert.notEqual(h.inventory()['fridge|pepper'].staple,true);
});

test('an explicitly tagged Pepper container remains a staple',async()=>{
 const inventory={'cupboard|pepper':{name:'Pepper',loc:'cupboard',unit:'each',qty:1,staple:true,stapleStatus:'in',selected:true,bb173StockKey:'pepper|each',bb173StockValue:1}};
 const h=await fixture({requirements:[],inventory,stock:{'pepper|each':1}});assert.equal(h.control('data-bb5-staple-status','cupboard|pepper').value,'in');await h.confirm();assert.equal(h.inventory()['cupboard|pepper'].staple,true);
});


test('live pantry saves valid piece counts, flushes pending edits and keeps stock during incomplete input',async()=>{
 const h=await fixture({requirements:[{key:'Carrots',unit:'g',required:800}],live:true});
 await h.choose('Carrots','fridge');
 let unit=h.control('data-bb5-unit','fridge|carrot');unit.value='each';await unit.dispatch('change');
 let qty=h.control('data-bb5-qty','fridge|carrot');qty.value='2';await qty.dispatch('input');
 await h.win.BBPantryLive.flush();assert.equal(h.stock()['carrot|g'],160);assert.equal(h.visits(),0,'automatic saves keep At home open');
 assert.doesNotMatch(h.doc.getElementById('bb75DraftIndicator').textContent,/Not confirmed/);
 qty=h.control('data-bb5-qty','fridge|carrot');qty.value='3';await qty.dispatch('input');
 await new Promise(resolve=>setTimeout(resolve,420));assert.equal(h.stock()['carrot|g'],240,'valid quantity edits save without pressing Reconcile');
 qty.value='';await qty.dispatch('input');await new Promise(resolve=>setTimeout(resolve,420));assert.equal(h.stock()['carrot|g'],240,'clearing an input while typing never clears saved stock');
 qty.value='4';await qty.dispatch('input');await h.win.BBPantryLive.flush();assert.equal(h.stock()['carrot|g'],320);assert.equal(h.win.BBPantryLive.hasPending(),false);
 assert.equal(h.syncs(),3,'each valid saved revision syncs once');
});
