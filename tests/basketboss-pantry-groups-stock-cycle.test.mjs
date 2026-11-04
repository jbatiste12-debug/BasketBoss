import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';
const {normalizeStockMap}=receiptCore;
const groupsModule=createRequire(import.meta.url)('../bb-pantry-groups.js');
const ACTOR='manual_pantry_cycle_user';
const SESSION='basketboss_cloud_session_v1', RECEIPTS='basketboss_purchase_receipts_v1';

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
 const values=new Map([[INVENTORY,JSON.stringify(inventory)],[STOCK,JSON.stringify(stock)],[SESSION,JSON.stringify({user:{id:ACTOR},access_token:'local-cycle-test-token'})]]);
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

function cycle(h,{ingredient={key:'Rice',unit:'g',required:600}}={}){
 const read=key=>JSON.parse(h.storage.getItem(key)||'{}');
 const host=h.win.BBHomeHost;
 Object.assign(host,{keys:()=>({stock:STOCK,inventory:INVENTORY}),recipeIngredients:(_id,factor)=>[{...ingredient,required:ingredient.required*factor}],occurrence:()=>null,refresh(){}});
 const groups=groupsModule.install(h.win),group=groups.create('cupboard','Family favourites');groups.assign('cupboard',groups.itemKey('Rice'),group);
 const groupBytes=h.storage.getItem(groups.KEY);
 const win=h.win;vm.runInNewContext(fs.readFileSync(new URL('../bb-receipt-inventory.js',import.meta.url),'utf8'),{window:win,console});
 const adapter=win.BBReceiptInventoryFactory({storage:h.storage,core:receiptCore,canonicalize:name=>h.pantry.pantryName(name),
  getSession:()=>JSON.parse(h.storage.getItem(SESSION)),getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'cycle-trip'}),
  getCatalog:()=>({'rice|g':{}})});
 const packet=(receiptId,quantity=500)=>({receiptId,market:'UK',retailer:'Tesco',shopSessionId:'cycle-trip',stockPantry:true,
  items:[{key:'rice',name:'Rice',classification:'food',sourceKind:'purchase',quantity,unit:'g',lineTotal:2,reviewed:true}]});
 const event=sessionId=>({sessionId,recipeId:'rice-meal',factor:1,actorId:ACTOR});
 function unchangedGroups(){assert.equal(h.storage.getItem(groups.KEY),groupBytes);assert.equal(groups.groupFor('cupboard','rice','Rice'),group);}
 return {read,groups,group,unchangedGroups,adapter,packet,event};
}

function finishShop(h,quantity=400){
 const read=key=>JSON.parse(h.storage.getItem(key)||'{}');
 const item={id:'rice|g',name:'Rice',qty:quantity,unit:'g',aisle:'Cupboard / Pantry'};
 const context=vm.createContext({window:h.win,console,localStorage:h.storage,BB307Pantry:h.pantry,
  BB83_KITCHEN_INVENTORY:INVENTORY,BB83_SHOP_STOCK_LEDGER:'basketboss_shop_stock_ledger_v1',BB307_STOCK_KEY:STOCK,BB_BETA_RECEIPT_KEY:RECEIPTS,
  bbHomePhysicalStock:h.stock,bb307Stock:h.stock(),bb83ReadObject:read,bbBetaReceiptRead:()=>read(RECEIPTS),bbBetaShopWeek:()=> 'cycle-trip',bbBetaReceiptId:id=>'cycle-trip|'+id,
  bbBetaPendingBought:()=>read(RECEIPTS)['cycle-trip|rice|g']?[]:[item],bbBetaChoiceInfo:()=>({mode:'pack',unit:'g',qty:quantity,size:500,count:1,keep:true}),
  bbBetaPackSpec:()=>({size:500,review:false}),bbBetaDryVolumeUnit:()=>false,bbBetaIsPerishable:()=>false,bb83StockLoc:()=> 'cupboard',bb83KitchenName:name=>name.toLowerCase()});
 const begin=html.indexOf('function bbBetaChoiceSurplus('),end=html.indexOf('function bbBetaPendingBought(',begin);
 const transfer=html.indexOf('function bbHomePendingHouseholdPurchases(){'),transferEnd=html.indexOf('/* An item bought again after explicitly unchecking',transfer);
 assert.ok(begin>0&&end>begin&&transfer>0&&transferEnd>transfer);
 vm.runInContext(html.slice(begin,end)+html.slice(transfer,transferEnd),context);
 return ()=>context.bb83TransferBought();
}

test('manual kg quantity, confirmed Finish pack, matching receipt, cooking and next shopping keep one balance and custom groups',async()=>{
 const h=fixture({requirements:[{key:'Rice',unit:'g',required:600}]}),c=cycle(h);
 await h.choose('Rice','cupboard');
 let unit=h.control('data-bb5-unit','cupboard|rice');unit.value='kg';await unit.dispatch('change');
 const quantity=h.control('data-bb5-qty','cupboard|rice');quantity.value='.2';await quantity.dispatch('input');await h.confirm();
 assert.deepEqual(h.stock(),{'rice|g':200});assert.equal(h.needed()[0].toBuy,400);c.unchangedGroups();
 const finish=finishShop(h);assert.equal(finish().count,1);assert.deepEqual(h.stock(),{'rice|g':700});assert.equal(finish().count,0);assert.deepEqual(h.stock(),{'rice|g':700});c.unchangedGroups();
 const receipt=c.packet('manual-cycle-receipt-1');assert.equal((await c.adapter.commitLocalReceipt(receipt)).ok,true);
 assert.deepEqual(h.stock(),{'rice|g':700},'receipt nets the already deposited 500 g pack; the manual 200 g is preserved');
 assert.equal((await c.adapter.commitLocalReceipt(receipt)).duplicate,true);assert.equal(h.needed()[0].toBuy,0);c.unchangedGroups();
 const event=c.event('manual-cycle-cook'),preview=h.win.BBHome.previewCook(event);assert.equal(preview.ok,true);
 assert.equal((await h.win.BBHome.cooked({...event,expected:preview.fingerprint})).ok,true);assert.deepEqual(h.stock(),{'rice|g':100});
 assert.equal((await h.win.BBHome.cooked(event)).already,true);assert.deepEqual(h.stock(),{'rice|g':100});assert.equal(h.inventory()['cupboard|rice'].qty,100);
 assert.equal(h.needed()[0].toBuy,500,'next 600 g meal uses the remaining 100 g automatically');c.unchangedGroups();
});

test('a direct receipt adds to a manually confirmed amount and later cooking preserves the custom group',async()=>{
 const h=fixture({requirements:[{key:'Rice',unit:'g',required:600}]}),c=cycle(h);
 await h.choose('Rice','cupboard');const quantity=h.control('data-bb5-qty','cupboard|rice');quantity.value='250';await quantity.dispatch('input');await h.confirm();
 assert.deepEqual(h.stock(),{'rice|g':250});assert.equal(h.needed()[0].toBuy,350);
 const receipt=c.packet('direct-manual-receipt-1',1000);assert.equal((await c.adapter.commitLocalReceipt(receipt)).ok,true);assert.deepEqual(h.stock(),{'rice|g':1250});
 assert.equal((await c.adapter.commitLocalReceipt(receipt)).duplicate,true);assert.deepEqual(h.stock(),{'rice|g':1250});
 assert.equal((await h.win.BBHome.cooked(c.event('direct-manual-cook'))).ok,true);assert.deepEqual(h.stock(),{'rice|g':650});assert.equal(h.needed()[0].toBuy,0);c.unchangedGroups();
 h.requirements[0].required=800;assert.equal(h.needed()[0].toBuy,150,'future need reconciles against the current balance, without a weekly reset');
});

test('unknown pack contents remain intact while measured receipt stock can be used and category membership persists',async()=>{
 const inventory={'cupboard|rice':{name:'Rice',selected:true,loc:'cupboard',qty:1,unit:'pack',bb173StockKey:'rice|pack',bb173StockValue:1}};
 const h=fixture({requirements:[{key:'Rice',unit:'g',required:200}],stock:{'rice|pack':1},inventory}),c=cycle(h,{ingredient:{key:'Rice',unit:'g',required:200}});
 const receipt=c.packet('unknown-pack-receipt-1',100);assert.equal((await c.adapter.commitLocalReceipt(receipt)).ok,true);assert.deepEqual(h.stock(),{'rice|pack':1,'rice|g':100});
 assert.equal(Object.values(h.inventory()).find(row=>row.bb173StockKey==='rice|pack')?.qty,1,'adding measured food must not overwrite a different physical source at the same base inventory ID');
 const preview=h.win.BBHome.previewCook(c.event('unknown-pack-cook'));assert.equal(preview.ok,true);assert.equal(preview.rows[0].deduct,100);assert.equal(preview.issues.length,1);
 assert.match(preview.rows[0].issueLabel,/Review those units; they will not be converted or deducted/i);
 assert.equal((await h.win.BBHome.cooked({...c.event('unknown-pack-cook'),expected:preview.fingerprint})).ok,true);assert.deepEqual(h.stock(),{'rice|pack':1});c.unchangedGroups();
});

test('an existing fractional pack balance survives confirming an unrelated manually edited food',async()=>{
 const pack={name:'Rice',selected:true,loc:'cupboard',qty:.5,unit:'pack',bb173StockKey:'rice|pack',bb173StockValue:.5,packReviewed:true,packQuantity:500,packUnit:'g'};
 const h=fixture({requirements:[{key:'Milk',unit:'ml',required:500}],stock:{'rice|pack':.5},inventory:{'cupboard|rice':pack}}),c=cycle(h);
 await h.choose('Milk','fridge');const quantity=h.control('data-bb5-qty','fridge|milk');quantity.value='250';await quantity.dispatch('input');await h.confirm();
 assert.deepEqual(h.stock(),{'rice|pack':.5,'milk|ml':250},'existing partially used packages are pantry balances, not whole purchase counts');
 assert.equal(h.inventory()['cupboard|rice'].qty,.5);assert.equal(h.inventory()['cupboard|rice'].packQuantity,500);assert.equal(h.needed()[0].toBuy,250);c.unchangedGroups();
});

test('cloud pantry projection retains separate checked package contents when measured stock has the same ingredient name',async()=>{
 const pack={name:'Rice',selected:true,loc:'cupboard',qty:.5,unit:'pack',bb173StockKey:'rice|pack',bb173StockValue:.5,packReviewed:true,packQuantity:500,packUnit:'g'};
 const h=fixture({requirements:[{key:'Rice',unit:'g',required:400}],stock:{'rice|pack':.5},inventory:{'cupboard|rice':pack}}),c=cycle(h);
 c.adapter.configure({fetch:async(_url,options)=>{
  const body=JSON.parse(options.body);assert.equal(body.action,'confirm_pantry');
  const stock=body.stock;return {ok:true,status:200,json:async()=>({ok:true,initialized:true,inventoryRevision:1,scope:{kind:'user',id:ACTOR},stock,
   inventory:Object.entries(stock).map(([stockKey,quantity])=>{const at=stockKey.lastIndexOf('|');return {stockKey,canonicalKey:stockKey.slice(0,at),unit:stockKey.slice(at+1),quantity,location:'cupboard',revision:1};}),
   essentials:[],receipts:[],priceObservations:[],pantryReview:{required:false}})};
 }});
 const stock={'rice|pack':.5,'rice|g':100},result=await c.adapter.confirmPantry({stock,expectedRevision:0,expectedScope:{kind:'user',id:ACTOR},shopSessionId:'cycle-trip'});
 assert.equal(result.localApplied,true);assert.deepEqual(h.stock(),stock);
 const rows=Object.values(h.inventory()),saved=rows.find(row=>row.bb173StockKey==='rice|pack');
 assert.equal(saved?.qty,.5);assert.equal(saved?.packReviewed,true);assert.equal(saved?.packQuantity,500);assert.equal(rows.find(row=>row.bb173StockKey==='rice|g')?.qty,100);c.unchangedGroups();
});

test('opening At home cannot collapse separate package and gram records when another food is confirmed',async()=>{
 const pack={name:'Rice',selected:true,loc:'cupboard',qty:.5,unit:'pack',bb173StockKey:'rice|pack',bb173StockValue:.5,packReviewed:true,packQuantity:500,packUnit:'g'};
 const measured={name:'Rice',selected:true,loc:'cupboard',qty:100,unit:'g',bb173StockKey:'rice|g',bb173StockValue:100};
 const inventory={'cupboard|rice':pack,'cupboard|rice|rice|g':measured},stock={'rice|pack':.5,'rice|g':100};
 const h=fixture({requirements:[{key:'Milk',unit:'ml',required:500}],stock,inventory}),c=cycle(h);
 await h.choose('Milk','fridge');const quantity=h.control('data-bb5-qty','fridge|milk');quantity.value='250';await quantity.dispatch('input');await h.confirm();
 assert.equal(h.stock()['rice|pack'],.5,'a different source unit must never disappear during unrelated confirmation');assert.equal(h.stock()['rice|g'],100);
 const saved=Object.values(h.inventory()).filter(row=>row.selected),savedPack=saved.find(row=>row.bb173StockKey==='rice|pack'),savedMeasured=saved.find(row=>row.bb173StockKey==='rice|g');
 assert.equal(savedPack?.qty,.5);assert.equal(savedPack?.packQuantity,500);assert.equal(savedMeasured?.qty,100);c.unchangedGroups();
 if(!h.stock()['milk|ml']){assert.deepEqual(h.stock(),stock);assert.match(h.status(),/review|separate|different|units|source/i,'a safe blocked confirmation must explain the required source review');}
});

