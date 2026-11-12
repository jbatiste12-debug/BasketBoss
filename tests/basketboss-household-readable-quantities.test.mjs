import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),formatter=require('../bb-shop-purchase-ui.js'),amount=require('../bb-household-amount.js');
const source=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

function elements(){
 let doc;
 const walk=node=>[node,...node.children.flatMap(walk)];
 class Element{
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parent:null,className:'',dataset:{},attributes:new Map(),events:new Map(),value:'',textContent:'',disabled:false,ownerDocument:doc});}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attributes.set(key,String(value));}removeAttribute(key){this.attributes.delete(key);}
  addEventListener(type,fn){const list=this.events.get(type)||[];list.push(fn);this.events.set(type,list);}
  async dispatch(type){for(const fn of this.events.get(type)||[])await fn({target:this,preventDefault(){}});}
  matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):selector==='[data-bb307-skip]'?!!this.dataset.bb307Skip:this.tagName.toLowerCase()===selector;}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parent)if(node.matches(selector))return node;return null;}
  get isConnected(){return true;}
 }
 doc={createElement:tag=>new Element(tag)};return {doc,Element,walk};
}

function amountFixture(item){
 const h=elements(),calls=[],container=new h.Element('section'),row=new h.Element('div'),control=new h.Element('button');
 row.className='bb16-essential-row';control.dataset.bb307Skip=item.id;row.append(control);container.append(row);
 const win={document:h.doc,BBShopPurchaseUI:formatter,BBHomeHost:{household:()=>[item],householdAmountContext:()=>({actor:'fixture',session:null,features:null}),saveHouseholdAmount:async(id,patch)=>{calls.push({id,patch});return {ok:true};}}};
 amount.install(win).decorate(container);
 return {...h,container,row,calls,form:row.querySelector('form'),preview:row.querySelector('output'),input:title=>h.walk(container).find(node=>node.attributes.get('aria-label')===title+' for '+item.name)};
}

test('part-container preview is readable while exact inputs and the prepared saved patch stay unchanged',async()=>{
 const item=Object.freeze({id:'cleaner',name:'Cleaner',unit:'ml',ownedQty:666.666667,targetQty:1333.333333,packQuantity:1000,packUnit:'ml',packReviewed:true}),before=JSON.stringify(item),h=amountFixture(item);
 assert.equal(h.preview.textContent,'667 ml already at home · 1333 ml total needed');
 assert.equal(h.input('Containers remaining').value,amount.defaultsFor(item).remaining);assert.equal(h.input('Total containers needed').value,amount.defaultsFor(item).neededContainers);
 assert.equal(h.calls.length,0);await h.form.dispatch('submit');assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].patch.ownedQty,666.666667);assert.equal(h.calls[0].patch.targetQty,1333.333333);assert.equal(JSON.stringify(item),before);
});
test('tiny positive part-container previews stay positive and retain the exact saved grams',async()=>{
 const item=Object.freeze({id:'powder',name:'Cleaning powder',unit:'g',ownedQty:.000001,targetQty:.000002,packQuantity:1,packUnit:'g',packReviewed:true}),h=amountFixture(item);
 assert.equal(h.preview.textContent,'<1 g already at home · <1 g total needed');await h.form.dispatch('submit');
 assert.equal(h.calls[0].patch.ownedQty,.000001);assert.equal(h.calls[0].patch.targetQty,.000002);
});

function confirmationDraw(records=[]){
 const anchor='  schedule();return Object.freeze({open:openDialog';let script=source('bb-essentials-confirm.js');assert.equal(script.split(anchor).length,2);
 // Expose the existing closure only in this disposable in-memory fixture.
 // The actual draw function, prepare function and input objects are unchanged.
 script=script.replace(anchor,'  win.__drawFixture={draw,renderConfirmed,setActive:value=>active=value};'+anchor);
 const win={document:{...elements().doc,addEventListener(){},getElementById:()=>null},addEventListener(){},requestAnimationFrame(){},BBShopPurchaseUI:formatter,BBHouseholdAmount:amount,BBHomeHost:{household:()=>records},BBKitchenChoiceRules:{isHousehold:()=>true},BBWeeklyEssentials:{reconcile:()=>({valid:true,toBuy:666.666666})}};
 vm.runInNewContext(script,{window:win});return win.__drawFixture;
}
test('weekly-essential confirmation preview rounds only its displayed difference',()=>{
 const h=confirmationDraw(),fields={targetQty:{value:'1333.333333'},ownedQty:{value:'666.666667'},unit:{value:'ml'}},preview={textContent:''},confirm={disabled:true};
 const state={fields,preview,confirm,view:{item:{unit:'ml'}},measured:{open:false},busy:false,invalid:false},before=JSON.stringify(fields);
 h.setActive(state);h.draw();assert.equal(preview.textContent,'667 ml to buy');assert.equal(confirm.disabled,false);assert.equal(JSON.stringify(fields),before);
 assert.ok(Math.abs(Number(fields.targetQty.value)-Number(fields.ownedQty.value)-666.666666)<1e-9);
});
test('measured essential confirmation retains exact part-container preparation behind its tiny positive preview',()=>{
 const h=confirmationDraw(),parts=Object.fromEntries(Object.entries({remaining:'0.000001',capacity:'1',capacityUnit:'g',neededContainers:'0.000002'}).map(([key,value])=>[key,{value}]));
 const state={fields:{name:{value:'Powder'},unit:{value:'g'}},parts,preview:{},confirm:{},view:{item:{unit:'g'}},measured:{open:true},busy:false,invalid:false},before=JSON.stringify(parts);
 h.setActive(state);h.draw();assert.equal(state.preview.textContent,'<1 g to buy');assert.equal(JSON.stringify(parts),before);
 assert.deepEqual(amount.prepare(Object.fromEntries(Object.entries(parts).map(([key,node])=>[key,node.value]))),{unit:'g',ownedQty:.000001,targetQty:.000002,packQuantity:1,packUnit:'g',packReviewed:true});
});
test('confirmed essential summary rounds its visible shortfall without changing saved targets or ownership',()=>{
 const records=Object.freeze([Object.freeze({id:'cleaner',name:'Cleaner',unit:'ml',targetQty:1333.333333,ownedQty:666.666667,selected:true})]),before=JSON.stringify(records),h=elements(),region=new h.Element('section');
 confirmationDraw(records).renderConfirmed(region);
 assert.equal(h.walk(region).find(node=>node.tagName==='SMALL').textContent,'On your Shop list · Buy 667 ml');assert.equal(JSON.stringify(records),before);
});

function kitchenReadouts(){
 const h=elements(),callbacks=[],win={BBShopPurchaseUI:formatter,BBPantryPolicy:{containerLabel:()=> 'bottle'}};
 const anchor=' window.BBKitchenEssentials=Object.freeze({refresh,loadRules});';let script=source('bb-kitchen-essentials.js');assert.equal(script.split(anchor).length,2);
 script=script.replace(anchor,' window.__readoutFixture={selectedReadout,readableHouseholdOutputs};'+anchor).replace(' void loadRules();','');
 Object.assign(h.doc,{readyState:'loading',currentScript:{src:'https://basketboss.co.uk/bb-kitchen-essentials.js'},addEventListener:(name,callback)=>callbacks.push(callback)});
 vm.runInNewContext(script,{window:win,document:h.doc,location:{href:'https://basketboss.co.uk/app'},URL,requestAnimationFrame:callback=>callbacks.push(callback)});
 return {...h,api:win.__readoutFixture};
}
test('Selected here readouts use whole measures and one-decimal counts without changing any input or raw pantry output',()=>{
 const h=kitchenReadouts(),summary={textContent:''},list=new h.Element('ul'),details={dataset:{},querySelector:selector=>selector==='summary'?summary:list},body={querySelector:()=>details},area={dataset:{bb76Store:'fridge'},querySelector:()=>body};
 const records=[{name:'Chicken',amount:'666.666667',unit:'g',needed:'1333.333333',buy:'At home: 666.666667 g · To buy: 666.666666 g'},
  {name:'Egg',amount:'1.333333',unit:'each',needed:'2.666667',buy:'To buy: 1.333334 each'},
  {name:'Cleaner',amount:'1.333333',unit:'each',status:'in',buy:''}];
 const rows=records.map(record=>({querySelector:selector=>selector==='strong'?{textContent:record.name}:selector==='[data-bb5-qty]'?{value:record.amount}:selector==='[data-bb5-unit]'?{value:record.unit}:selector==='[data-bb5-needed]'?(record.needed===undefined?null:{value:record.needed}):selector==='[data-bb5-staple-status]'?(record.status?{value:record.status}:null):{textContent:record.buy}}));
 const before=JSON.stringify(records);h.api.selectedReadout(area,{querySelectorAll:()=>rows});
 assert.deepEqual(list.children.map(node=>node.children[1].textContent),['667 g already got · 1333 g needed · At home: 667 g · To buy: 667 g','1.3 each already got · 2.7 each needed · To buy: 1.3 each','In Stock · 1.3 bottles · container tracking']);
 assert.equal(JSON.stringify(records),before);assert.equal(summary.textContent,'Selected here (3)');
});
test('the essentials adapter sanitizes frozen BBHome output after each original input redraw without touching raw editable values',()=>{
 const h=kitchenReadouts(),outputs=[{textContent:'To buy: 2.333333 each'},{textContent:'To buy: 666.666667 g'}],inputs=[{value:'3.666667'},{value:'1.333334'}],container={querySelectorAll:selector=>selector==='.bb-home-quantities output'?outputs:inputs},before=JSON.stringify(inputs);
 h.api.readableHouseholdOutputs(container);assert.deepEqual(outputs.map(node=>node.textContent),['To buy: 2.3 each','To buy: 667 g']);
 outputs[0].textContent='To buy: 1.666666 each';h.api.readableHouseholdOutputs(container);assert.equal(outputs[0].textContent,'To buy: 1.7 each');assert.equal(JSON.stringify(inputs),before);
 const current=source('bb-home.js'),start=current.indexOf('  function targets(){'),end=current.indexOf('\n  function receiptGeneration',start),reader=current.slice(start,end);
 assert.equal(crypto.createHash('sha256').update(reader).digest('hex'),'f85250fbe79b0de22e79e992dca87de45f52c28f2fe285ceaf45f56bc4866571','only the approved alias reader is outside the frozen calculation body');
 const unchanged=current.replace(reader,'  function targets(){const data=viewData();return object(data.targets)?data.targets:{};}').replaceAll('win.BBPantryConversionCanonical||win.BBPriceV19?.canonical','win.BBPriceV19?.canonical').replaceAll('win.BBPantryAliasCanonical||win.BBPriceV19?.canonical','win.BBPriceV19?.canonical');
 const digest=crypto.createHash('sha256').update(unchanged).digest('hex');assert.equal(digest,'c9bde043c90016d9db4fc23ef9d61098623282152ceddee6de4b97e36977bf6f');
});
