import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const helper=createRequire(import.meta.url)('../bb-household-amount.js');

test('reviewed partial containers produce physical household ownership and targets',()=>{
 assert.deepEqual(helper.prepare({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:2}),{unit:'ml',ownedQty:375,targetQty:1500,packQuantity:750,packUnit:'ml',packReviewed:true});
 const half=helper.prepare({remaining:'.5',capacity:'500',capacityUnit:'g',neededContainers:'1'});assert.equal(half.ownedQty,250);assert.equal(half.targetQty,500);assert.equal(half.unit,'g');
 const empty=helper.prepare({remaining:0,capacity:750,capacityUnit:'ml',neededContainers:0});assert.equal(empty.ownedQty,0);assert.equal(empty.targetQty,0);
});
test('litres and kilograms normalize by declared capacity without density assumptions',()=>{
 assert.equal(helper.prepare({remaining:.5,capacity:.75,capacityUnit:'l',neededContainers:2}).ownedQty,375);
 const kg=helper.prepare({remaining:1.5,capacity:2,capacityUnit:'kg',neededContainers:1});assert.equal(kg.ownedQty,3000);assert.equal(kg.targetQty,2000);assert.equal(kg.unit,'g');
});
test('unknown or incompatible container sizes never create a guessed quantity',()=>{
 for(const patch of [{capacity:''},{capacity:null},{capacity:undefined},{capacity:0},{capacity:-1},{capacity:750,capacityUnit:'bottle'},{capacity:750,capacityUnit:'each'},{remaining:''},{remaining:null},{remaining:-.5},{neededContainers:''},{neededContainers:null},{remaining:NaN},{capacity:Infinity}])assert.throws(()=>helper.prepare({remaining:.5,capacity:750,capacityUnit:'ml',neededContainers:1,...patch}));
});
test('limits apply to normalized totals and tiny positive balances cannot silently round to zero',()=>{
 for(const value of [{remaining:2000,capacity:750},{neededContainers:2000,capacity:750},{capacity:1001,capacityUnit:'l'},{remaining:.1,capacity:.000001}])assert.throws(()=>helper.prepare({remaining:1,capacity:750,capacityUnit:'ml',neededContainers:1,...value}));
 assert.equal(helper.prepare({remaining:2,capacity:500000,capacityUnit:'ml',neededContainers:0}).ownedQty,1000000);
});
test('only a reviewed compatible pack can prefill partial ownership; unknown capacity remains blank',()=>{
 const item={unit:'ml',ownedQty:375,targetQty:1500,packQuantity:750,packUnit:'ml'};
 assert.deepEqual(helper.defaultsFor(item),{remaining:'',capacity:'',capacityUnit:'ml',neededContainers:''});
 assert.deepEqual(helper.defaultsFor({...item,packReviewed:true}),{remaining:'0.5',capacity:'750',capacityUnit:'ml',neededContainers:'2'});
 assert.deepEqual(helper.defaultsFor({...item,packReviewed:true,unit:'pack',ownedQty:1,targetQty:2}),{remaining:'',capacity:'750',capacityUnit:'ml',neededContainers:''});
 assert.equal(helper.defaultsFor({...item,packReviewed:true,unit:'l',ownedQty:.375,targetQty:1.5}).remaining,'0.5');
 assert.equal(helper.defaultsFor({...item,packReviewed:true,packUnit:'each'}).capacity,'');
 assert.equal(item.ownedQty,375,'prefilling never mutates the saved item');
});
test('opening and saving a compatible measured balance does not round its container fraction away',()=>{
 for(const [ownedQty,targetQty,packQuantity]of [[375,1500,7000],[.000001,.000002,1000000],[1125.125,6000.375,750.5]]){
  const defaults=helper.defaultsFor({unit:'ml',ownedQty,targetQty,packQuantity,packUnit:'ml',packReviewed:true}),patch=helper.prepare(defaults);
  assert.equal(patch.ownedQty,ownedQty);assert.equal(patch.targetQty,targetQty);
 }
});

function fixture({item={id:'cleaner',name:'Kitchen cleaner',unit:'ml',ownedQty:375,targetQty:1500,packQuantity:750,packUnit:'ml',packReviewed:true},save}={}){
 let doc,calls=[],pin={actor:'alice',session:'session-alice',features:'features-revision'},connected=true;
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 const matches=(node,selector)=>selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):selector==='[data-bb307-skip]'?!!node.dataset.bb307Skip:node.tagName.toLowerCase()===selector;
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.className='';this.children=[];this.dataset={};this.attributes=new Map();this.events=new Map();this.value='';this.textContent='';this.disabled=false;this.open=false;this.ownerDocument=doc;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  setAttribute(key,value){this.attributes.set(key,String(value));}removeAttribute(key){this.attributes.delete(key);}
  addEventListener(type,fn){const list=this.events.get(type)||[];list.push(fn);this.events.set(type,list);}
  async dispatch(type,event={}){for(const fn of this.events.get(type)||[])await fn({target:this,preventDefault(){},...event});}
  querySelectorAll(selector){return descendants(this).slice(1).filter(node=>matches(node,selector));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parent)if(matches(node,selector))return node;return null;}
  get isConnected(){return connected;}
 }
 doc={createElement:tag=>new Element(tag)};const container=new Element('section'),row=new Element('div'),button=new Element('button');row.className='bb16-essential-row';button.dataset.bb307Skip=item.id;row.append(button);container.append(row);
 const win={document:doc,BBHomeHost:{household:()=>[item],householdAmountContext:()=>({...pin}),saveHouseholdAmount:async(id,patch,context)=>{calls.push({id,patch,context});return save?save(id,patch,context):{ok:true};}}};
 Object.defineProperty(win,'localStorage',{get(){throw Error('Editor must not access storage directly');}});
 const api=helper.install(win);api.decorate(container);
 const all=()=>descendants(container),text=()=>all().map(node=>node.textContent).join(' '),input=label=>all().find(node=>node.attributes.get('aria-label')===label+' for '+item.name);
 return {api,container,row,calls,item,input,text,details:row.querySelector('details'),form:row.querySelector('form'),save:row.querySelector('button[type=submit]')||row.querySelectorAll('button').at(-1),setPin(value){pin=value;},setConnected(value){connected=value;}};
}
test('the household editor sends an explicit conversion and its captured context through the host only',async()=>{
 const h=fixture();assert.match(h.text(),/Enter part of a bottle or pack/);assert.match(h.text(),/375 ml already at home · 1500 ml total needed/);
 h.input('Containers remaining').value='0.5';h.input('Full container size').value='750';h.input('Total containers needed').value='2';await h.form.dispatch('input');await h.form.dispatch('submit');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].id,'cleaner');assert.equal(h.calls[0].patch.ownedQty,375);assert.equal(h.calls[0].patch.targetQty,1500);assert.deepEqual(h.calls[0].context,{actor:'alice',session:'session-alice',features:'features-revision'});
 assert.match(h.text(),/Amount saved/);assert.equal(h.item.ownedQty,375);
 await h.form.dispatch('submit');assert.equal(h.calls.length,1,'a saved amount cannot be submitted again');
 h.api.decorate(h.container);assert.equal(h.row.querySelectorAll('details').length,1,'redecorating never duplicates an editor');
});
test('missing capacity and incomplete target stay as a visible review without any host save',async()=>{
 const h=fixture({item:{id:'cleaner',name:'Cleaner',unit:'each',ownedQty:1,targetQty:2,packQuantity:750,packUnit:'ml'}});
 assert.equal(h.input('Full container size').value,'');assert.equal(h.input('Total containers needed').value,'');assert.match(h.text(),/Unknown sizes stay unchanged/);
 h.input('Containers remaining').value='.5';await h.form.dispatch('submit');assert.equal(h.calls.length,0);assert.match(h.text(),/Enter the full container size/);
});
test('host rejection leaves the balance unchanged, keeps stale submission blocked and allows fresh reopening',async()=>{
 let reject=true;const h=fixture({save:async()=>{if(reject)throw Error('Your account or pantry changed. Reopen this item.');return {ok:true};}});
 await h.form.dispatch('submit');assert.equal(h.calls.length,1);assert.match(h.text(),/Your account or pantry changed/);assert.equal(h.item.ownedQty,375);
 await h.form.dispatch('submit');assert.equal(h.calls.length,1);assert.match(h.text(),/Close and reopen/);
 reject=false;h.setPin({actor:'bob',session:'session-bob',features:'new-features'});h.details.open=true;await h.details.dispatch('toggle');await h.form.dispatch('submit');assert.equal(h.calls.length,2);assert.equal(h.calls[1].context.actor,'bob');
});
test('a second submit during an in-flight save cannot duplicate the operation',async()=>{
 let resolve;const h=fixture({save:()=>new Promise(done=>{resolve=done;})}),pending=h.form.dispatch('submit');await h.form.dispatch('submit');assert.equal(h.calls.length,1);resolve({ok:true});await pending;
});
