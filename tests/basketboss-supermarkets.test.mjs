import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../bb-supermarkets.js',import.meta.url),'utf8');
const prefix='basketboss_321_v10_price_retailer_';

function preferences(initial=[]){
 const saved=new Map(initial);let blocked=false;
 const context=vm.createContext({localStorage:{
  getItem:key=>{if(blocked)throw Error('Storage blocked');return saved.get(key)??null;},
  setItem:(key,value)=>{if(blocked)throw Error('Storage blocked');saved.set(key,String(value));},
  removeItem:key=>{if(blocked)throw Error('Storage blocked');saved.delete(key);}
 }});
 vm.runInContext(source,context);
 return {api:context.BBSupermarkets,saved,context,block:()=>{blocked=true;}};
}

test('supermarkets are specific to each supported region',()=>{
 const {api}=preferences();
 assert.deepEqual([...api.forRegion('UK')],['Tesco','Sainsbury’s','Asda','Morrisons','Aldi','Lidl','Waitrose & Partners','M&S Food','Co-op','Iceland','Ocado']);
 for(const market of ['Jersey','Guernsey']){
  assert.deepEqual([...api.forRegion(market)],['Channel Islands Coop','Waitrose & Partners','Alliance','Morrisons Daily','M&S Food']);
  for(const absent of ['Walmart','Tesco','Sainsbury’s','Asda','Aldi','Lidl','Ocado'])assert.equal(api.forRegion(market).includes(absent),false);
 }
 assert.ok(api.forRegion('US').includes('Walmart'));
 assert.equal(api.forRegion('US').includes('Waitrose & Partners'),false);
 assert.equal(api.forRegion('US').includes('Channel Islands Coop'),false);
 assert.deepEqual([...api.forRegion('unsupported')],[]);
 assert.ok(Object.isFrozen(api.forRegion('UK')));
});

test('each region retains its own supermarket and invalid selections never write',()=>{
 const {api,saved}=preferences();
 for(const [market,name] of [['UK','Tesco'],['Jersey','Alliance'],['Guernsey','Channel Islands Coop'],['US','Walmart']])assert.equal(api.setSelected(market,name),true);
 for(const [market,name] of [['US','Walmart'],['Guernsey','Channel Islands Coop'],['UK','Tesco'],['Jersey','Alliance']])assert.equal(api.getSelected(market),name);
 const before=JSON.stringify([...saved]);
 assert.equal(api.setSelected('US','Waitrose'),false);
 assert.equal(api.setSelected('Jersey','Tesco'),false);
 assert.equal(api.setSelected('UK','Invented Shop'),false);
 assert.equal(api.setSelected('invalid','Tesco'),false);
 assert.equal(api.setSelected('UK',null),false);
 assert.equal(JSON.stringify([...saved]),before);
 assert.equal(api.setSelected('Jersey',''),true);
 assert.equal(api.getSelected('Jersey'),null);
 assert.equal(saved.has(prefix+'Jersey'),false);
 assert.equal(api.getSelected('UK'),'Tesco');
});

test('legacy Waitrose preferences resolve without a migration write',()=>{
 const {api,saved}=preferences([[prefix+'Guernsey','Waitrose'],[prefix+'US','Waitrose']]);
 assert.equal(api.getSelected('Guernsey'),'Waitrose & Partners');
 assert.equal(saved.get(prefix+'Guernsey'),'Waitrose');
 assert.equal(api.getSelected('US'),null);
 assert.equal(api.setSelected('UK','Waitrose'),true);
 assert.equal(saved.get(prefix+'UK'),'Waitrose & Partners');
});

test('blocked storage keeps the last readable preference and rejects saving or clearing',()=>{
 const h=preferences([[prefix+'UK','Tesco']]);
 assert.equal(h.api.getSelected('UK'),'Tesco');
 h.block();
 assert.equal(h.api.setSelected('UK','Aldi'),false);
 assert.equal(h.api.setSelected('UK',''),false);
 assert.equal(h.api.getSelected('UK'),'Tesco');
 assert.equal(h.saved.get(prefix+'UK'),'Tesco');
});

function ui(){
 const h=preferences();let market='Guernsey',mutations=0;
 const frames=[],listeners=new Map(),observers=[];
 const notify=()=>{mutations++;for(const observer of observers)observer();};
 class Element {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.value='';this.ownText='';}
  append(...nodes){this.children.push(...nodes);notify();}
  replaceChildren(...nodes){this.children=[...nodes];notify();}
  set textContent(value){this.ownText=String(value);this.children=[];notify();}
  get textContent(){return this.ownText+this.children.map(node=>node.textContent).join('');}
  setAttribute(name,value){this.attributes[name]=String(value);}
  addEventListener(name,callback){this.listeners[name]=callback;}
  querySelector(selector){return descendants(this).find(node=>matches(node,selector))??null;}
 }
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
 const matches=(node,selector)=>{
  if(selector==='select')return node.tag==='select';
  const match=/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if(!match)return false;
  const key=match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  return Object.hasOwn(node.dataset,key)&&(match[2]===undefined||node.dataset[key]===match[2]);
 };
 const body=new Element('body'),head=new Element('head'),region=new Element('section'),top=new Element('div'),shopping=new Element('section');
 region.id='bb17RegionCard';top.className='bb17-region-top';region.append(top);body.append(region,shopping);
 const document={body,head,readyState:'complete',createElement:tag=>new Element(tag),
  getElementById:id=>[head,body,...descendants(head),...descendants(body)].find(node=>node.id===id)??null,
  querySelector:selector=>selector==='#app .bb321-shop-summary'?shopping:null};
 h.context.document=document;
 h.context.window=h.context;
 h.context.bb307ActiveMarket=()=>market;
 h.context.addEventListener=(name,callback)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(callback);};
 const dispatch=name=>{for(const callback of listeners.get(name)||[])callback({});};
 h.context.bb307SelectPricingRetailer=value=>{const saved=h.context.BBSupermarkets.setSelected(market,value);if(saved)dispatch('basketboss:supermarket-changed');return saved;};
 h.context.requestAnimationFrame=callback=>frames.push(callback);
 h.context.MutationObserver=class {constructor(callback){this.callback=callback;}observe(){observers.push(this.callback);}};
 vm.runInContext(source,h.context);
 const flush=()=>{let iterations=0;while(frames.length){assert.ok(++iterations<10,'Picker observers must settle without a render loop');frames.shift()();}};
 flush();
 return {...h,region,top,shopping,flush,dispatch,document,get mutations(){return mutations;},switchRegion:value=>{market=value;dispatch('basketboss:market-changed');flush();}};
}

test('accessible region and Shopping dropdowns sync, restore saved stores and settle after updates',()=>{
 const h=ui();
 const region=h.region.querySelector('select'),shopping=h.shopping.querySelector('select');
 assert.ok(region&&shopping);
 assert.equal(h.top.querySelector('select'),null,'Picker must be outside the region header controls');
 assert.equal(h.document.getElementById(region.id+'-help').textContent,'Prices use sourced online guides where available, otherwise regional estimates.');
 assert.match(region.attributes['aria-describedby'],new RegExp(region.id+'-help'));
 assert.equal(h.document.getElementById(region.id+'-status').attributes.role,'status');
 const label=h.region.children.find(node=>node.dataset.bbSupermarketPicker==='region').children.find(node=>node.tag==='label');
 assert.equal(label.htmlFor,region.id);
 assert.equal(label.textContent,'Where are you shopping?');
 assert.equal(region.children[0].textContent,'Choose supermarket');
 assert.ok(region.children.some(option=>option.value==='Alliance'));
 assert.equal(region.children.some(option=>option.value==='Walmart'),false);
 region.value='Alliance';region.listeners.change();h.flush();
 assert.equal(shopping.value,'Alliance');
 h.switchRegion('US');
 assert.ok(region.children.some(option=>option.value==='Walmart'));
 assert.equal(region.children.some(option=>option.value==='Waitrose & Partners'),false);
 assert.equal(region.value,'');
 shopping.value='Walmart';shopping.listeners.change();h.flush();
 assert.equal(region.value,'Walmart');
 h.switchRegion('Guernsey');assert.equal(region.value,'Alliance');assert.equal(shopping.value,'Alliance');
 h.switchRegion('US');assert.equal(region.value,'Walmart');assert.equal(shopping.value,'Walmart');
 const before=h.mutations;h.dispatch('basketboss:supermarket-changed');h.flush();
 assert.equal(h.mutations,before,'Unchanged selection and region must not rebuild picker DOM');
});

test('dropdown restores the previous value and reports a failed save when storage is blocked',()=>{
 const h=ui();const region=h.region.querySelector('select'),shopping=h.shopping.querySelector('select');
 region.value='Alliance';region.listeners.change();h.flush();h.block();
 region.value='M&S Food';region.listeners.change();h.flush();
 assert.equal(region.value,'Alliance');assert.equal(shopping.value,'Alliance');
 assert.equal(h.context.BBSupermarkets.getSelected('Guernsey'),'Alliance');
 assert.match(h.document.getElementById(region.id+'-status').textContent,/Could not save/);
 assert.equal(h.saved.get(prefix+'Guernsey'),'Alliance');
});
