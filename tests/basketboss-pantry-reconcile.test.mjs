import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {normalizeStockMap} from '../bb-receipt-inventory-core.mjs';

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
function fixture({requirements=[{key:'Honey',unit:'tbsp',required:2},{key:'Lettuce',unit:'each',required:.5}],inventory={},stock={},onlineError=false,live=false}={}){
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

test('inline quantity edit saves through the existing pantry ledger and immediately reduces Shopping',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:500}]});
 const editor=h.win.BBPantryEditor,key=editor.select('Rice','cupboard',{unit:'g'});
 assert.equal(key,'cupboard|rice');assert.equal(editor.update(key,{qty:250}).ok,true);
 await editor.flush();assert.deepEqual(h.stock(),{'rice|g':250});assert.equal(h.needed()[0].toBuy,250);
 assert.equal(editor.select('Rice','cupboard'),key,'a second tile tap opens the existing amount');assert.equal(editor.list().length,1);
 assert.equal(h.visits(),0,'inline saving keeps the user at the food tile');
});

test('one-step manual food entry adds the exact amount and merges compatible stock',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:1000}]});
 const editor=h.win.BBPantryEditor;
 assert.equal(editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'}).ok,true);await editor.flush();
 assert.equal(editor.add({name:'Rice',loc:'cupboard',qty:150,unit:'g'}).ok,true);await editor.flush();
 assert.deepEqual(h.stock(),{'rice|g':400});assert.equal(editor.list().length,1);assert.equal(h.needed()[0].toBuy,600);
});

test('manual entry with an incompatible unit preserves both physical sources',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:1000}]});
 const editor=h.win.BBPantryEditor;
 editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'});await editor.flush();
 assert.equal(editor.add({name:'Rice',loc:'cupboard',qty:1,unit:'pack'}).ok,true);await editor.flush();
 assert.equal(editor.list().length,2);assert.deepEqual(h.stock(),{'rice|g':250,'rice|pack':1});
 assert.equal(Object.values(h.inventory()).filter(row=>row.selected).length,2,'unknown package data cannot overwrite the grams source');
});

test('invalid inline edits and incompatible unit switches keep the recorded amount intact',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:1000}]}),editor=h.win.BBPantryEditor;
 const {key}=editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'});await editor.flush();
 assert.equal(editor.update(key,{unit:'ml'}).ok,false);assert.equal(editor.read(key).qty,250);assert.equal(editor.read(key).unit,'g');
 for(const qty of [-1,'bad',Infinity,1000001,'','   ',null,undefined]){
  assert.equal(editor.update(key,{qty:300}).ok,true);assert.equal(editor.update(key,{qty}).ok,false);await editor.flush();assert.deepEqual(h.stock(),{'rice|g':250},'the invalid latest input blocks a queued prior valid value');
 }
 assert.equal(editor.update(key,{qty:250}).ok,true);await editor.flush();
 assert.equal(editor.add({name:'Milk',loc:'fridge',qty:'',unit:'ml'}).ok,false,'the one-step form requires an amount');
});

test('stale inline editors cannot write over receipts or another account',async()=>{
 const h=fixture({live:true,requirements:[]}),editor=h.win.BBPantryEditor;
 const {key}=editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'});await editor.flush();
 h.storage.setItem(STOCK,JSON.stringify({'rice|g':700}));
 assert.equal(editor.isCurrent(),false);assert.equal(editor.update(key,{qty:1}).ok,false);assert.equal(editor.remove(key).ok,false);
 assert.equal(editor.select('Milk','fridge'),null);assert.deepEqual(h.stock(),{'rice|g':700});
 const second=fixture({live:true,requirements:[]}),other=second.win.BBPantryEditor;
 second.storage.setItem('basketboss_cloud_session_v1',JSON.stringify({user:{id:'someone-else'}}));
 assert.equal(other.add({name:'Rice',loc:'cupboard',qty:1,unit:'g'}).ok,false);assert.deepEqual(second.stock(),{});
});

test('explicit inline remove updates Shopping without using selection taps to erase stock',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:500}]}),editor=h.win.BBPantryEditor;
 const {key}=editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'});await editor.flush();
 assert.equal(editor.remove(key).ok,true);await editor.flush();assert.deepEqual(h.stock(),{});assert.equal(h.needed()[0].toBuy,500);
});


test('incomplete inline quantity editing preserves the last staged and saved balance until a valid amount arrives',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:1000}]}),editor=h.win.BBPantryEditor;
 const {key}=editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'});await editor.flush();
 assert.equal(editor.update(key,{qty:300}).ok,true);assert.equal(editor.update(key,{qty:''}).ok,false);assert.equal(editor.read(key).qty,'','the incomplete edit remains visible as a draft');
 assert.equal(editor.add({name:'Rice',loc:'cupboard',qty:100,unit:'g'}).ok,false,'a manual addition cannot treat an incomplete amount as zero');
 await new Promise(resolve=>setTimeout(resolve,420));await editor.flush();assert.deepEqual(h.stock(),{'rice|g':250});assert.equal(h.needed()[0].toBuy,750,'neither the queued 300 g nor an unknown amount replaces saved stock');
 assert.equal(editor.update(key,{qty:350}).ok,true);await editor.flush();assert.deepEqual(h.stock(),{'rice|g':350});
 assert.equal(editor.update(key,{qty:0}).ok,true);await editor.flush();assert.equal(h.stock()['rice|g']??0,0);assert.equal(h.needed()[0].toBuy,1000,'explicit zero remains a valid out-of-stock declaration');
 const unknown=editor.select('Milk','fridge',{unit:'ml'});assert.equal(editor.read(unknown).qty,null);await editor.flush();assert.equal(h.inventory()[unknown].qty,null,'new unmeasured selections may remain unknown');
});


test('inline manual merges sum canonical US can and pint balances without fractional-container roundtrip loss',async()=>{
 const h=fixture({live:true,requirements:[]});h.win.BBPantryPolicy=pantryPolicy;h.win.bb307ActiveMarket=()=> 'US';const editor=h.win.BBPantryEditor;
 assert.equal(editor.add({name:'Chopped tomatoes',loc:'cupboard',qty:1,unit:'tin'}).ok,true);await editor.flush();assert.equal(h.stock()['chopped tomatoes|g'],411);
 assert.equal(editor.add({name:'Tinned tomatoes',loc:'cupboard',qty:400,unit:'g'}).ok,true);await editor.flush();assert.equal(h.stock()['chopped tomatoes|g'],811);
 assert.equal(editor.add({name:'Milk',loc:'fridge',qty:1,unit:'pint'}).ok,true);await editor.flush();assert.equal(h.stock()['milk|ml'],473);
 assert.equal(editor.add({name:'Milk',loc:'fridge',qty:1,unit:'ml'}).ok,true);await editor.flush();assert.equal(h.stock()['milk|ml'],474);
 assert.equal(editor.add({name:'Carrots',loc:'fridge',qty:2,unit:'each'}).ok,true);await editor.flush();assert.equal(h.stock()['carrot|g'],160);
 assert.equal(editor.add({name:'Carrot',loc:'fridge',qty:1,unit:'g'}).ok,true);await editor.flush();assert.equal(h.stock()['carrot|g'],161);
 assert.equal(editor.list().length,3,'compatible aliases and source measures do not create duplicate pantry rows');
});


test('incomplete API container-content edits cannot erase a reviewed pack capacity or its measured stock',async()=>{
 const h=fixture({live:true,requirements:[]});h.win.BBPantryPolicy=pantryPolicy;const editor=h.win.BBPantryEditor;
 const {key}=editor.add({name:'Rice',loc:'cupboard',qty:1,unit:'pack'});
 assert.equal(editor.update(key,{packQuantity:500,packUnit:'g'}).ok,true);await editor.flush();assert.deepEqual(h.stock(),{'rice|g':500});
 for(const patch of [{packQuantity:''},{packQuantity:'   '},{packQuantity:null},{packQuantity:undefined},{packUnit:''},{packUnit:null},{packUnit:undefined}]){
  assert.equal(editor.update(key,patch).ok,false);await editor.flush();
  assert.equal(editor.read(key).packQuantity,500);assert.equal(editor.read(key).packUnit,'g');assert.equal(editor.read(key).packReviewed,true);
  assert.deepEqual(h.stock(),{'rice|g':500},'the known pack stays measured instead of reverting to an unknown count');
 }
 assert.equal(h.inventory()[key].packQuantity,500);assert.equal(h.inventory()[key].packReviewed,true);
});

function targetShopping(h){
 const home=h.win.BBHome,id=h.win.BBHomeHost.id,requirements=home.augment(h.requirements,[],home.targets(),id),used=h.pantry.reconcileStock(h.stock(),requirements).pantry;
 return home.manualBuyItems(requirements.map(row=>({...row,pantryUsed:used[id(row.key,row.unit)]||0,toBuy:Math.max(0,row.required-(used[id(row.key,row.unit)]||0))})));
}

test('a new-food preview exposes plan need without selecting, saving or creating a Shop request',()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:600}]}),editor=h.win.BBPantryEditor,before=new Map(h.values),rows=editor.list().length;
 const preview=editor.preview('Rice','cupboard','g');assert.equal(preview.qty,null);assert.equal(preview.totalNeeded,600);assert.equal(preview.mealNeeded,600);assert.equal(preview.minimumNeeded,600);assert.equal(preview.shortfall,600);
 assert.equal(editor.list().length,rows);assert.deepEqual(h.values,before);assert.equal(h.win.BBPantryLive.hasPending(),false);
});
test('automatic pantry confirmations follow a changed plan instead of retaining its old demand',async()=>{
 const h=fixture({live:true,requirements:[{key:'Pasta',unit:'g',required:600}]});h.win.BBPantryPolicy=pantryPolicy;
 const editor=h.win.BBPantryEditor,{key}=editor.add({name:'Pasta',loc:'cupboard',qty:250,unit:'g'});await editor.flush();
 const patch={qty:250,unit:'g',totalNeeded:600,automaticNeeded:true,extraBuffer:0,buyMultiple:0};
 assert.equal(editor.update(key,patch).ok,true);await editor.flush();assert.equal(h.win.BBHome.targets()['pasta|g'].targetQty,0);
 h.requirements.splice(0,1,{key:'Pasta',unit:'g',required:300});await Promise.resolve();
 assert.equal(editor.read(key).totalNeeded,300);assert.equal(editor.read(key).shortfall,50);assert.equal(targetShopping(h)[0].toBuy,50);
 assert.equal(editor.update(key,patch).ok,true,'a stale automatic display is recalculated');await editor.flush();
 h.requirements.splice(0);await Promise.resolve();
 assert.equal(editor.read(key).totalNeeded,0);assert.equal(editor.read(key).shortfall,0);assert.equal(targetShopping(h).length,0);
 assert.equal(editor.update(key,{...patch,totalNeeded:''}).ok,true,'automatic demand never depends on a blank display input');await editor.flush();
 assert.deepEqual(h.stock(),{'pasta|g':250});assert.equal(h.inventory()[key].automaticNeeded,undefined,'presentation mode is not physical stock');
});

test('automatic buffer-only API saves retain one request and the same preview as actual Shop with direct extras',async()=>{
 const h=fixture({live:true,requirements:[]});h.win.BBPantryPolicy=pantryPolicy;
 Object.assign(h.win.BBHomeHost,{keys:()=>({stock:STOCK,inventory:INVENTORY}),shoppingKind:()=> 'food',shoppingPurchaseContext:()=>({shopSessionId:'auto-trip',quantity:0}),refresh(){}});
 const editor=h.win.BBPantryEditor,{key}=editor.add({name:'Pasta',loc:'cupboard',qty:500,unit:'g'});await editor.flush();
 assert.equal(h.win.BBHome.addShoppingBuy({name:'Pasta',quantityText:'200 g',requestId:'direct-extra',actorId:'guest'}).ok,true);
 for(let review=0;review<2;review++){
  const result=editor.update(key,{qty:500,unit:'g',automaticNeeded:true,extraBuffer:100,buyMultiple:0});assert.equal(result.ok,true);
  assert.equal(result.row.totalNeeded,0);assert.equal(result.row.shortfall,200);await editor.flush();
  assert.equal(editor.read(key).totalNeeded,0);assert.equal(editor.read(key).shortfall,200);assert.equal(targetShopping(h)[0].toBuy,200);
  assert.equal(h.win.BBHome.targets()['pasta|g'].targetQty,0);assert.equal(h.win.BBHome.shoppingBuys().length,1);
  assert.deepEqual(h.stock(),{'pasta|g':500});
 }
});
test('partial staple stock survives Add, automatic buffer saves and quantity-only edits without integer truncation',async()=>{
 const h=fixture({live:true,requirements:[]});h.win.BBPantryPolicy=pantryPolicy;
 const editor=h.win.BBPantryEditor,{key}=editor.add({name:'Olive oil',loc:'cupboard',qty:.5,unit:'bottle'});await editor.flush();
 assert.deepEqual(h.stock(),{'olive oil|each':.5});assert.equal(h.inventory()[key].qty,.5);
 const result=editor.update(key,{qty:.5,unit:'each',automaticNeeded:true,totalNeeded:0,extraBuffer:1,buyMultiple:0});
 assert.equal(result.ok,true);assert.equal(result.row.unroundedShortfall,.5);assert.equal(result.row.shortfall,1);await editor.flush();
 assert.equal(h.win.BBHome.targets()['olive oil|each'].buyMultiple,1);assert.deepEqual(h.stock(),{'olive oil|each':.5});
 assert.equal(editor.update(key,{qty:1.5}).ok,true);await editor.flush();assert.deepEqual(h.stock(),{'olive oil|each':1.5});
 assert.equal(editor.update(key,{qty:.5}).ok,true);await editor.flush();assert.deepEqual(h.stock(),{'olive oil|each':.5});
 const more=editor.add({name:'Olive oil',loc:'cupboard',qty:.25,unit:'bottle'});assert.equal(more.ok,true);await editor.flush();
 assert.equal(more.key,key);assert.deepEqual(h.stock(),{'olive oil|each':.75});assert.equal(Object.keys(h.inventory()).length,1);
});
test('switching a legacy container count to measured spice stock requires a new explicit amount',async()=>{
 const key='cupboard|black peppercorns',name='Black peppercorns',stockKey='black peppercorns|each';
 const h=fixture({live:true,requirements:[],inventory:{[key]:{name,loc:'cupboard',selected:true,unit:'each',qty:20,staple:true,stapleStatus:'in',bb173StockKey:stockKey,bb173StockValue:20}},stock:{[stockKey]:20}});h.win.BBPantryPolicy=pantryPolicy;
 const editor=h.win.BBPantryEditor,editKey=editor.list().find(row=>row.name===name).key,before=new Map(h.values),mode={trackingMode:'measured',measurementReviewed:true,unit:'g',automaticNeeded:true,extraBuffer:0,buyMultiple:0};
 assert.equal(editor.update(editKey,{...mode}).ok,false);await editor.flush();assert.deepEqual(h.values,before,'a unit switch never reinterprets 20 old jars as grams');
 assert.equal(editor.update(editKey,{...mode,qty:''}).ok,false);await editor.flush();assert.deepEqual(h.values,before);
 const confirmed=editor.update(editKey,{...mode,qty:20});assert.equal(confirmed.ok,true,confirmed.message);await editor.flush();
 assert.deepEqual(h.stock(),{'black peppercorns|g':20});assert.equal(h.inventory()[editKey].qty,20);assert.equal(h.inventory()[editKey].unit,'g');assert.equal(h.inventory()[editKey].trackingMode,'measured');assert.equal(h.inventory()[editKey].measurementReviewed,true);assert.equal(h.inventory()[editKey].staple,false);
 assert.equal(editor.read(editKey).staple,false);assert.equal(editor.read(editKey).shortfall,0);
});
test('reviewed measured staple stock keeps grams and fractional gram buffers without forcing container rounding',async()=>{
 const h=fixture({live:true,requirements:[{key:'Black peppercorns',unit:'g',required:25}]});h.win.BBPantryPolicy=pantryPolicy;
 const editor=h.win.BBPantryEditor,{key}=editor.add({name:'Black peppercorns',loc:'cupboard',qty:20,unit:'g',trackingMode:'measured',measurementReviewed:true});await editor.flush();
 assert.deepEqual(h.stock(),{'black peppercorns|g':20});
 const result=editor.update(key,{qty:20,unit:'g',trackingMode:'measured',measurementReviewed:true,automaticNeeded:true,extraBuffer:2.5,buyMultiple:0});
 assert.equal(result.ok,true);assert.equal(result.row.totalNeeded,25);assert.equal(result.row.shortfall,7.5);await editor.flush();
 assert.deepEqual(h.stock(),{'black peppercorns|g':20});assert.equal(h.win.BBHome.targets()['black peppercorns|g'].extraBuffer,2.5);assert.equal(h.win.BBHome.targets()['black peppercorns|g'].buyMultiple,undefined);
 assert.equal(h.inventory()[key].trackingMode,'measured');assert.equal(targetShopping(h)[0].toBuy,7.5);
});
test('ambiguous measured pepper cannot overwrite whole-pepper stock through Add or quantity-only edits',async()=>{
 const facts={trackingMode:'measured',measurementReviewed:true,staple:false},h=fixture({live:true,requirements:[],inventory:{'cupboard|pepper':{name:'Pepper',loc:'cupboard',selected:true,unit:'g',qty:20,...facts,bb173StockKey:'pepper|g',bb173StockValue:20}},stock:{'pepper|g':20}});h.win.BBPantryPolicy=pantryPolicy;
 const editor=h.win.BBPantryEditor,key=editor.list()[0].key,before=new Map(h.values);
 const added=editor.add({name:'Pepper',loc:'cupboard',qty:200,unit:'g',...facts});assert.equal(added.ok,false);assert.match(added.message,/separately from whole peppers/);
 const changed=editor.update(key,{qty:30});assert.equal(changed.ok,false);assert.match(changed.message,/separately from whole peppers/);await editor.flush();assert.deepEqual(h.values,before);
 assert.match(h.win.BBHome.foodTarget({name:'Pepper',qty:20,unit:'g',...facts}).targetProblem,/separately from whole peppers/);
});

test('an explicit pantry target shares the canonical tin conversion and adds only three tins after two at home',async()=>{
 const h=fixture({live:true,requirements:[{key:'Chopped tomatoes',unit:'g',required:1200}]});h.win.BBPantryPolicy=pantryPolicy;const editor=h.win.BBPantryEditor,key=editor.select('Tinned tomatoes','cupboard',{unit:'tin'});
 assert.equal(editor.read(key).mealNeeded,3);assert.equal(editor.update(key,{qty:2,unit:'tin',totalNeeded:5}).ok,true);await editor.flush();
 assert.deepEqual(h.stock(),{'chopped tomatoes|g':800});assert.equal(h.win.BBHome.targets()['chopped tomatoes|g'].targetQty,2000);
 assert.equal(targetShopping(h).length,1);assert.equal(targetShopping(h)[0].toBuy,1200,'three UK tins, not recipe shortfall plus three tins');
 assert.equal(h.inventory()[key].totalNeeded,undefined);assert.equal(h.inventory()[key].targetChanged,undefined);assert.equal(h.inventory()[key].pantryTarget,undefined);
 assert.equal(editor.update(key,{qty:2,unit:'tin',totalNeeded:5}).ok,true);await editor.flush();assert.equal(targetShopping(h)[0].toBuy,1200);assert.equal(Object.keys(h.win.BBHome.targets()).length,1);
});

test('explicit targets normalize UK and US packs, measured weights and produce counts before aggregation',async()=>{
 for(const [market,name,unit,owned,needed,expectedStock,expectedTarget,key]of [
  ['UK','Milk','l',.5,1.5,500,1500,'milk|ml'],['US','Milk','pint',1,3,473,1419,'milk|ml'],
  ['US','Chopped tomatoes','tin',2,5,822,2055,'chopped tomatoes|g'],['UK','Carrots','each',2,5,160,400,'carrot|g'],
  ['US','Rice','lb',1,2,453.6,907.2,'rice|g']
 ]){
  const h=fixture({live:true,requirements:[]});h.win.BBPantryPolicy=pantryPolicy;h.win.bb307ActiveMarket=()=>market;const editor=h.win.BBPantryEditor,id=editor.select(name,'cupboard',{unit});
  assert.equal(editor.update(id,{qty:owned,unit,totalNeeded:needed}).ok,true,market+' '+name);await editor.flush();
  assert.equal(h.stock()[key],expectedStock);assert.equal(h.win.BBHome.targets()[key].targetQty,expectedTarget);assert.equal(targetShopping(h)[0].toBuy,Math.round((expectedTarget-expectedStock)*1000000)/1000000);
 }
});

test('a lower target cannot erase meal-plan demand or write only the stock half of a failed confirmation',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:1000}]}),editor=h.win.BBPantryEditor,{key}=editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'});await editor.flush();const before=new Map(h.values);
 const result=editor.update(key,{qty:500,totalNeeded:750});assert.equal(result.ok,false);assert.match(result.message,/planned meals/);await editor.flush();assert.deepEqual(h.values,before);assert.equal(editor.read(key).qty,250);assert.equal(targetShopping(h)[0].toBuy,750);
});

test('unknown pack targets and incompatible plan dimensions keep the prior stock and targets intact',async()=>{
 for(const requirements of [[],[{key:'Rice',unit:'ml',required:200}]]){
  const h=fixture({live:true,requirements});h.win.BBPantryPolicy=pantryPolicy;const editor=h.win.BBPantryEditor,{key}=editor.add({name:'Rice',loc:'cupboard',qty:250,unit:'g'});await editor.flush();const before=new Map(h.values);
  const result=editor.update(key,{qty:1,unit:'bag',totalNeeded:3});assert.equal(result.ok,false);await editor.flush();assert.deepEqual(h.values,before);assert.equal(editor.read(key).qty,250);assert.deepEqual(h.win.BBHome.targets(),{});
 }
});

test('an explicit target accounts for existing manual Shop quantities without duplicating or deleting them',async()=>{
 const h=fixture({live:true,requirements:[{key:'Chopped tomatoes',unit:'g',required:1200}]});h.win.BBPantryPolicy=pantryPolicy;
 Object.assign(h.win.BBHomeHost,{keys:()=>({stock:STOCK,inventory:INVENTORY}),shoppingKind:()=> 'food',shoppingPurchaseContext:()=>({shopSessionId:'target-trip',quantity:0}),refresh(){}});
 assert.equal(h.win.BBHome.addShoppingBuy({name:'Chopped tomatoes',quantityText:'400 g',actorId:'guest',requestId:'already-on-shop'}).ok,true);
 const editor=h.win.BBPantryEditor,key=editor.select('Tinned tomatoes','cupboard',{unit:'tin'}),beforeManual=h.win.BBHome.shoppingBuys()[0];
 assert.equal(editor.read(key).totalNeeded,4);assert.equal(editor.read(key).manualNeeded,1);
 assert.equal(editor.update(key,{qty:2,unit:'tin',totalNeeded:5}).ok,true);await editor.flush();
 assert.equal(h.win.BBHome.targets()['chopped tomatoes|g'].targetQty,1600,'one existing manual tin is already part of the requested five');
 assert.equal(h.win.BBHome.shoppingBuys()[0].quantity,beforeManual.quantity);assert.equal(targetShopping(h)[0].toBuy,1200);
 assert.equal(editor.update(key,{qty:2,unit:'tin',totalNeeded:5}).ok,true);await editor.flush();assert.equal(targetShopping(h)[0].toBuy,1200);assert.equal(h.win.BBHome.shoppingBuys().length,1);
 assert.equal(editor.update(key,{qty:2,unit:'tin',totalNeeded:3}).ok,false,'lowering the total cannot silently discard the existing direct top-up');await editor.flush();assert.equal(targetShopping(h)[0].toBuy,1200);
});

test('compatible stock in another storage area is exposed and deducted from the same absolute target once',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:500}]});h.win.BBPantryPolicy=pantryPolicy;const editor=h.win.BBPantryEditor;
 const first=editor.add({name:'Rice',loc:'cupboard',qty:200,unit:'g'});await editor.flush();const second=editor.add({name:'Rice',loc:'freezer',qty:300,unit:'g'});await editor.flush();
 assert.equal(editor.read(first.key).otherOwned,300);assert.equal(editor.read(first.key).shortfall,0);assert.equal(editor.read(second.key).otherOwned,200);
 assert.equal(editor.update(first.key,{qty:200,unit:'g',totalNeeded:500}).ok,true);await editor.flush();assert.equal(targetShopping(h).length,1);assert.equal(targetShopping(h)[0].toBuy,0);assert.deepEqual(h.stock(),{'rice|g':500});
});

test('a failed combined stock/target transaction rolls back both and retry commits once',async()=>{
 const h=fixture({live:true,requirements:[{key:'Rice',unit:'g',required:500}]}),editor=h.win.BBPantryEditor,{key}=editor.add({name:'Rice',loc:'cupboard',qty:200,unit:'g'});await editor.flush();const before=new Map(h.values),original=h.storage.setItem;let fail=true;
 h.storage.setItem=(name,value)=>{if(name==='basketboss_at_home_requirements_v1'&&fail){fail=false;throw Error('quota');}original(name,value);};
 assert.equal(editor.update(key,{qty:250,totalNeeded:1000}).ok,true);await editor.flush();assert.deepEqual(h.values,before);assert.equal(h.win.BBPantryLive.hasPending(),true);
 await editor.flush();assert.equal(h.stock()['rice|g'],250);assert.equal(h.win.BBHome.targets()['rice|g'].targetQty,1000);assert.equal(targetShopping(h)[0].toBuy,750);
});

test('rounded US ounce/pound and fractional container/count defaults retain exact canonical targets with no phantom shortfall',async()=>{
 for(const [market,name,unit,grams,pack]of [
  ['US','Rice','oz',400,null],['US','Rice','lb',500,null],
  ['UK','Chopped tomatoes','tin',500,{packQuantity:350,packUnit:'g'}],['UK','Carrots','each',100.001,null]
 ]){
  const h=fixture({live:true,requirements:[{key:name,unit:'g',required:grams}]});h.win.BBPantryPolicy=pantryPolicy;h.win.bb307ActiveMarket=()=>market;const editor=h.win.BBPantryEditor,{key}=editor.add({name,loc:'cupboard',qty:grams,unit:'g'});
  if(pack)assert.equal(editor.update(key,pack).ok,true);await editor.flush();
  const options={market,...(pack?{...pack,packReviewed:true}:{})},one=pantryPolicy.normalize(name,1,unit,options).quantity,display=Math.round(grams/one*1000000)/1000000;
  for(let repeat=0;repeat<3;repeat++){
   assert.equal(editor.update(key,{qty:grams/one,unit,totalNeeded:display,...(pack||{})}).ok,true,market+' '+unit+' accepts its displayed default');
   assert.equal(editor.read(key).totalQuantity,grams,'pending totalQuantity exposes the exact requested base amount');await editor.flush();
   assert.equal(h.win.BBHome.targets()[Object.keys(h.stock())[0]].targetQty,grams);assert.equal(h.stock()[Object.keys(h.stock())[0]],grams);assert.equal(targetShopping(h)[0].toBuy,0,'no extra pack appears for a floating-point remainder');
  }
 }
});

test('half a display quantum may round up to the real meal minimum, while a full quantum below is rejected',async()=>{
 for(const [market,name,unit,required,higher,pack]of [['US','Rice','oz',400,500,null],['US','Rice','lb',500,700,null],['UK','Chopped tomatoes','tin',500,700,{packQuantity:350,packUnit:'g'}]]){
  const h=fixture({live:true,requirements:[{key:name,unit:'g',required}]}),editor=h.win.BBPantryEditor;h.win.BBPantryPolicy=pantryPolicy;h.win.bb307ActiveMarket=()=>market;const {key}=editor.add({name,loc:'cupboard',qty:0,unit:'g'});if(pack)editor.update(key,pack);await editor.flush();
  assert.equal(editor.update(key,{qty:0,unit:'g',totalNeeded:higher}).ok,true);await editor.flush();
  const one=pantryPolicy.normalize(name,1,unit,{market,...(pack?{...pack,packReviewed:true}:{})}).quantity,rounded=Math.round(required/one*1000000)/1000000;
  assert.equal(editor.update(key,{qty:0,unit,totalNeeded:rounded,...(pack||{})}).ok,true);await editor.flush();assert.equal(h.win.BBHome.targets()[Object.keys(h.stock())[0]||h.win.BBHomeHost.id(name,'g')].targetQty,required);
  const before=new Map(h.values);assert.equal(editor.update(key,{qty:0,unit,totalNeeded:Math.round((rounded-.000001)*1000000)/1000000,...(pack||{})}).ok,false);await editor.flush();assert.deepEqual(h.values,before,'a real change below the minimum does not save stock or target');
 }
});
