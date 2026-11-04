import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {normalizeStockMap} from '../bb-receipt-inventory-core.mjs';

const homeModule=createRequire(import.meta.url)('../bb-home.js');
const source=fs.readFileSync(new URL('../shopping-inventory.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pantrySource=html.match(/const BB307Pantry=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/)[0];
const INVENTORY='basketboss_makeameal_v1_inventory',STOCK='basketboss_321_v7_measured_pantry';
const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase());

// Small DOM fixture: run the real picker handlers, persistence, Home contract,
// pantry allocator and online stock validator without depending on a browser.
function fixture({requirements=[{key:'Honey',unit:'tbsp',required:2},{key:'Lettuce',unit:'each',required:.5}],inventory={},stock={},onlineError=false}={}){
 const values=new Map([[INVENTORY,JSON.stringify(inventory)],[STOCK,JSON.stringify(stock)]]);
 let doc,shopVisits=0,syncs=0;
 function matches(node,selector){
  return selector.split(',').some(part=>{
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
 const win={document:doc,localStorage:storage,location:{search:''},scrollTo(){},BBReceiptHost:{confirmCurrentPantry:async({stock})=>{syncs++;if(onlineError)return {ok:false,needsReview:true};normalizeStockMap(stock);return {ok:true};},reviewPantry:async()=>{}}};
 const context=vm.createContext({window:win,document:doc,localStorage:storage,MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),queueMicrotask,console});
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 context.BBPriceV19=win.BBPriceV19;context.BB_WHOLE_PRODUCE_GRAMS={};vm.runInContext(pantrySource+'\nthis.pantry=BB307Pantry;',context);const pantry=context.pantry;
 const readStock=()=>JSON.parse(storage.getItem(STOCK)||'{}');
 win.BBHomeHost={id:pantry.pantryId,stock:readStock,requirements:()=>requirements,household:()=>[],reload(){},settlePurchases:()=>null,consume:pantry.reconcileStock};
 win.BBHome=homeModule.install(win);vm.runInContext(source,context);
 const selected=()=>doc.getElementById('bb5SelectedRows');
 const control=(attribute,key)=>selected().querySelector('['+attribute+'="'+key+'"]');
 return {win,doc,storage,values,pantry,requirements,selected,control,
  choose:async(name,loc)=>{const area=doc.querySelector('[data-bb76-store="'+loc+'"]');await area.querySelector('[data-bb5-food="'+name+'"]').click();},
  enough:async key=>{const button=control('data-bb5-enough',key);assert.ok(button,'coverage action exists for '+key);await button.click();},
  confirm:()=>doc.getElementById('bb5Reconcile').click(),
  needed:()=>{const used=pantry.reconcileStock(readStock(),requirements).pantry;return requirements.map(row=>({...row,toBuy:Math.max(0,row.required-(used[pantry.pantryId(row.key,row.unit)]||0))}));},
  stock:readStock,inventory:()=>JSON.parse(storage.getItem(INVENTORY)),visits:()=>shopVisits,syncs:()=>syncs,status:()=>doc.getElementById('bb5StockStatus').textContent};
}

test('selecting Honey and Lettuce alone saves unknown amounts and explains why Shopping still needs them',async()=>{
 const h=fixture();await h.choose('Honey','cupboard');await h.choose('Lettuce','fridge');
 assert.equal(h.control('data-bb5-unit','cupboard|honey').value,'tbsp');assert.equal(h.control('data-bb5-unit','fridge|lettuce').value,'each');
 await h.confirm();assert.deepEqual(h.stock(),{});assert.equal(h.inventory()['cupboard|honey'].qty,null);assert.equal(h.inventory()['fridge|lettuce'].qty,null);
 assert.deepEqual(h.needed().map(row=>row.toBuy),[2,.5]);assert.equal(h.visits(),0);assert.match(h.status(),/Amount unknown for Honey, Lettuce/);assert.match(h.status(),/not reduced To buy/);assert.equal(h.doc.activeElement.dataset.bb5Qty,'cupboard|honey');
});

test('explicit enough-for-week declarations reconcile Honey spoons and a whole Lettuce through the real stock contract',async()=>{
 const h=fixture();await h.choose('Honey','cupboard');await h.choose('Lettuce','fridge');
 assert.match(h.control('data-bb5-enough','cupboard|honey').textContent,/2 tbsp/);
 assert.match(h.control('data-bb5-enough','fridge|lettuce').textContent,/I have 1 each/,'the whole count being declared is visible even when the recipe needs half');
 await h.enough('cupboard|honey');await h.enough('fridge|lettuce');assert.deepEqual(h.stock(),{},'draft buttons do not commit stock');await h.confirm();
 assert.deepEqual(h.stock(),{'honey|tbsp':2,'lettuce|each':1});assert.deepEqual(h.needed().map(row=>row.toBuy),[0,0]);assert.equal(h.visits(),1);assert.equal(h.syncs(),1);
 assert.equal(h.inventory()['cupboard|honey'].bb173StockKey,'honey|tbsp');assert.equal(h.inventory()['fridge|lettuce'].bb173StockKey,'lettuce|each');
 await h.confirm();assert.deepEqual(h.stock(),{'honey|tbsp':2,'lettuce|each':1},'reconfirming cannot add or consume the same stock again');
});

test('legacy unknown units remain unchanged until the explicit weekly coverage action fixes them',async()=>{
 const h=fixture({inventory:{'cupboard|honey':{name:'Honey',loc:'cupboard',selected:true,qty:null,unit:'g'},'fridge|lettuce':{name:'Lettuce',loc:'fridge',selected:true,qty:null,unit:'g'}}});
 assert.equal(h.control('data-bb5-unit','cupboard|honey').value,'g');await h.enough('cupboard|honey');await h.enough('fridge|lettuce');await h.confirm();
 assert.deepEqual(h.stock(),{'honey|tbsp':2,'lettuce|each':1});assert.deepEqual(h.needed().map(row=>row.toBuy),[0,0]);
});

test('partial measured Honey remains to buy while unit mismatches keep review feedback visible',async()=>{
 const h=fixture();await h.choose('Honey','cupboard');await h.choose('Lettuce','fridge');
 const honey=h.control('data-bb5-qty','cupboard|honey');honey.value='1';await honey.dispatch('input');
 const lettuce=h.control('data-bb5-unit','fridge|lettuce');lettuce.value='g';await lettuce.dispatch('change');
 const quantity=h.control('data-bb5-qty','fridge|lettuce');quantity.value='100';await quantity.dispatch('input');await h.confirm();
 assert.deepEqual(h.stock(),{'honey|tbsp':1,'lettuce|g':100});assert.deepEqual(h.needed().map(row=>row.toBuy),[1,.5]);assert.equal(h.visits(),0);assert.match(h.status(),/Check the units for Lettuce/);
});

test('recorded owned quantities pass Home validation and failed online confirmation never claims Shopping is reconciled',async()=>{
 const h=fixture({requirements:[{key:'Honey',unit:'tbsp',required:2}],onlineError:true});await h.choose('Honey','cupboard');await h.enough('cupboard|honey');
 assert.equal(h.control('data-bb5-needed','cupboard|honey'),null);await h.confirm();
 assert.deepEqual(h.win.BBHome.targets(),{});assert.deepEqual(h.stock(),{'honey|tbsp':2});assert.equal(h.visits(),0);assert.match(h.status(),/Review the saved online pantry/);
});

test('the weekly action offers no invented conversion for multiple incompatible recipe measures',async()=>{
 const h=fixture({requirements:[{key:'Honey',unit:'g',required:20},{key:'Honey',unit:'tbsp',required:2}]});await h.choose('Honey','cupboard');
 assert.equal(h.control('data-bb5-enough','cupboard|honey'),null);await h.confirm();assert.deepEqual(h.stock(),{});assert.deepEqual(h.needed().map(row=>row.toBuy),[20,2]);
});

test('Cupboard, Fridge and Freezer foods have no editable total and owned amounts reduce recipe-generated shortfalls',async()=>{
 const h=fixture({requirements:[{key:'Rice',unit:'g',required:1000},{key:'Milk',unit:'ml',required:1000},{key:'Frozen peas',unit:'g',required:500}]});
 for(const [name,location,key,owned]of [['Rice','cupboard','rice',250],['Milk','fridge','milk',300],['Frozen peas','freezer','pea',125]]){
  await h.choose(name,location);const row=location+'|'+key;
  assert.equal(h.control('data-bb5-needed',row),null,location+' food has no Total needed input');
  assert.ok(h.control('data-bb5-unit',row),location+' keeps its amount unit editable');
  const input=h.control('data-bb5-qty',row);input.value=String(owned);await input.dispatch('input');
 }
 assert.doesNotMatch(h.selected().textContent,/Total needed/);await h.confirm();
 assert.deepEqual(h.stock(),{'rice|g':250,'milk|ml':300,'frozen peas|g':125});
 assert.deepEqual(h.needed().map(row=>row.toBuy),[750,700,375]);
 assert.deepEqual(h.win.BBHome.targets(),{},'recording ownership does not create manual food requirements');
});

test('stale total fields on a saved pantry item do not create new requirements when ownership is edited',async()=>{
 const h=fixture({requirements:[{key:'Rice',unit:'g',required:1000}],inventory:{'cupboard|rice':{name:'Rice',loc:'cupboard',selected:true,qty:100,unit:'g',totalNeeded:5000,targetChanged:true,bb173StockKey:'rice|g',bb173StockValue:100}},stock:{'rice|g':100}});
 assert.equal(h.control('data-bb5-needed','cupboard|rice'),null);
 const input=h.control('data-bb5-qty','cupboard|rice');input.value='250';await input.dispatch('input');await h.confirm();
 assert.deepEqual(h.stock(),{'rice|g':250});assert.equal(h.needed()[0].toBuy,750);assert.deepEqual(h.win.BBHome.targets(),{});
 assert.equal(h.inventory()['cupboard|rice'].totalNeeded,undefined);assert.equal(h.inventory()['cupboard|rice'].targetChanged,undefined);
});

test('unknown amounts remain explained when online confirmation is unavailable',async()=>{
 const h=fixture({onlineError:true});await h.choose('Honey','cupboard');await h.confirm();
 assert.deepEqual(h.stock(),{});assert.equal(h.visits(),0);assert.match(h.status(),/Amount unknown for Honey/);assert.match(h.status(),/not reduced To buy/);assert.match(h.status(),/saved on this device/);
});

test('built-in salmon Honey and half-serving burger Lettuce reconcile using their actual normalized recipe units',async()=>{
 const recipes=JSON.parse(html.match(/const BB307_NORMALIZED\s*=\s*(\[[^\n]+\])/)[1]);
 const honey=recipes.find(row=>row.id==='salmon').ingredients.find(row=>row.key==='honey');
 const lettuce=recipes.find(row=>row.id==='chicken-burgers').ingredients.find(row=>row.key==='lettuce');
 const h=fixture({requirements:[{...honey,required:honey.quantity},{...lettuce,required:lettuce.quantity*.5}]});
 await h.choose('Honey','cupboard');await h.choose('Lettuce','fridge');assert.equal(h.control('data-bb5-unit','cupboard|honey').value,'ml');assert.equal(h.control('data-bb5-unit','fridge|lettuce').value,'each');
 await h.enough('cupboard|honey');await h.enough('fridge|lettuce');await h.confirm();assert.deepEqual(h.stock(),{'honey|ml':30,'lettuce|each':1});assert.deepEqual(h.needed().map(row=>row.toBuy),[0,0]);assert.equal(h.visits(),1);
});

test('existing measured quantities survive confirmation and are never reduced to the weekly requirement',async()=>{
 const h=fixture({inventory:{'cupboard|honey':{name:'Honey',loc:'cupboard',selected:true,qty:10,unit:'tbsp',bb173StockKey:'honey|tbsp',bb173StockValue:10}},stock:{'honey|tbsp':10},requirements:[{key:'honey',unit:'tbsp',required:2}]});
 assert.equal(h.control('data-bb5-qty','cupboard|honey').value,'10');await h.confirm();assert.deepEqual(h.stock(),{'honey|tbsp':10});assert.equal(h.inventory()['cupboard|honey'].qty,10);assert.equal(h.visits(),1);
});
