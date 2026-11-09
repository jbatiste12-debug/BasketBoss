import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fixture} from './basketboss-pantry-policy-ui.test.mjs';
import {transform700PantryPerformance} from '../tools/catalogue700/pantry-performance.mjs';

const require=createRequire(import.meta.url),home=require('../bb-home.js');
const raw=fs.readFileSync(new URL('../shopping-inventory.js',import.meta.url),'utf8');
const optimized=transform700PantryPerformance(raw),HOME='basketboss_at_home_requirements_v1';
const plain=value=>JSON.parse(JSON.stringify(value));
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));

function homeFixture(initial=[{key:'Rice',unit:'g',required:500}]){
 const values=new Map();let calls=0,requirements=initial;
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const win={localStorage:storage,location:{search:''},document:{},BBHomeHost:{id:(name,unit)=>name.toLowerCase()+'|'+unit,requirements:()=>{calls++;return requirements;},household:()=>[],settlePurchases:()=>null}};
 return {api:home.install(win),storage,values,setRequirements:value=>{requirements=value;},get calls(){return calls;}};
}

test('read-only requirement snapshots preserve units and keep saved shopping targets and buffers fresh',()=>{
 const h=homeFixture(),snapshot=[{key:'Rice',unit:'g',required:750},{key:'Milk',unit:'ml',required:1500}];
 assert.equal(h.api.requirement('Rice','kg'),.5);assert.equal(h.calls,1);
 assert.equal(h.api.requirement('Rice','kg',{requirements:snapshot}),.75);
 assert.equal(h.api.requirement('Milk','l',{requirements:snapshot}),1.5);assert.equal(h.calls,1);
 const save=(targetQty,extraBuffer)=>h.storage.setItem(HOME,JSON.stringify({version:1,byActor:{guest:{targets:{'rice|g':{name:'Rice',unit:'g',targetQty,pending:true,extraBuffer}},planned:{},cooked:{}}}}));
 save(1000,250);assert.equal(h.api.total('Rice','kg',{requirements:snapshot}),1.25);
 save(1500,100);assert.equal(h.api.total('Rice','kg',{requirements:snapshot}),1.6,'saved preferences are read afresh even when a plan snapshot is provided');
 assert.equal(h.calls,1);
 assert.equal(h.api.requirement('Rice','g',{requirements:[]}),0,'an explicitly empty plan stays empty');
 h.setRequirements([{key:'Rice',unit:'g',required:900}]);assert.equal(h.api.requirement('Rice','g'),900,'legacy/default reads still query the current plan');
});

test('generated pantry readouts share exactly one plan evaluation across 31 measured foods',async()=>{
 const inventory={},stock={},requirements=[];
 for(let i=0;i<31;i++){
  const name=i===0?'Rice':'QA pantry food '+i,key='cupboard|'+name.toLowerCase();
  inventory[key]={name,loc:'cupboard',unit:'g',qty:10,selected:true,bb173StockKey:name.toLowerCase()+'|g',bb173StockValue:10};stock[name.toLowerCase()+'|g']=10;requirements.push({key:name,unit:'g',required:20});
 }
 async function setup(sourceOverride){
  let calls=0;
  const h=await fixture({inventory,stock,requirements,sourceOverride,configureWindow(win){const original=win.BBHomeHost.requirements;win.BBHomeHost.requirements=()=>{calls++;return original();};}});
  return {h,get calls(){return calls;}};
 }
 const legacy=await setup(raw),fast=await setup(optimized);await pause();
 const legacyBefore=legacy.calls,legacyRows=plain(legacy.h.win.BBPantryEditor.list()),fastBefore=fast.calls,fastRows=plain(fast.h.win.BBPantryEditor.list());
 assert.deepEqual(fastRows,legacyRows,'every descriptor and readout remains identical');
 assert.equal(fastRows.length,31);assert.equal(fast.calls-fastBefore,1,'the generated list evaluates the plan once');
 assert.ok(legacy.calls-legacyBefore>=31,'the baseline reproduces the per-row plan recalculation');
 await pause();
 fast.h.win.BBHomeHost.requirements=()=>{return [{key:'Rice',unit:'g',required:80}];};
 assert.equal(fast.h.win.BBPantryEditor.list().find(row=>row.name==='Rice').mealNeeded,80,'the next list evaluation sees a changed meal requirement');
});

test('generated readouts retain measured, counted, packaged, unknown and manual-buffer behavior',async()=>{
 const seeds=[['Rice','g',250,'cupboard'],['Pasta','kg',.5,'cupboard'],['Milk','l',.25,'fridge'],['Garlic','clove',3,'cupboard'],['Lettuce','each',.5,'fridge'],['Chopped tomatoes','tin',1,'cupboard'],['Frozen mince','pack',2,'freezer'],['Ketchup','ml',100,'cupboard'],['Unknown food','bag',1,'cupboard']];
 const inventory={},stock={};
 for(const [name,unit,qty,loc]of seeds){const id=name.toLowerCase()+'|'+unit;inventory[loc+'|'+name.toLowerCase()]={name,unit,qty,loc,selected:true,bb173StockKey:id,bb173StockValue:qty,...(name==='Frozen mince'?{packReviewed:true,packQuantity:300,packUnit:'g'}:{})};stock[id]=qty;}
 const requirements=[{key:'Rice',unit:'g',required:500},{key:'Pasta',unit:'g',required:1000},{key:'Milk',unit:'ml',required:1000},{key:'Garlic',unit:'clove',required:5},{key:'Lettuce',unit:'each',required:1},{key:'Chopped tomatoes',unit:'g',required:800}];
 const prefs={version:1,byActor:{guest:{targets:{'rice|g':{name:'Rice',unit:'g',targetQty:800,pending:true,extraBuffer:100,buyMultiple:500}},planned:{},cooked:{}}}};
 const options={requirements,inventory,stock,configureWindow(win){win.localStorage.setItem(HOME,JSON.stringify(prefs));}};
 const legacy=await fixture({...options,sourceOverride:raw}),fast=await fixture({...options,sourceOverride:optimized});await pause();
 assert.deepEqual(plain(fast.win.BBPantryEditor.list()),plain(legacy.win.BBPantryEditor.list()));
 assert.equal(fast.storage.getItem(HOME),JSON.stringify(prefs),'reading never commits target preferences');
});

test('preparing 31 pantry targets reads one plan and preserves the full proposal without committing it',()=>{
 const requirements=Array.from({length:31},(_,i)=>({key:'Food '+i,unit:'g',required:20})),h=homeFixture(requirements);
 const chosen=requirements.map((row,i)=>({name:row.key,unit:'g',qty:10,totalNeeded:i===0?50:20,pantryTarget:true,automaticNeeded:i!==0,extraBuffer:5,buyMultiple:10}));
 const result=h.api.prepare(chosen);
 assert.equal(h.calls,1,'both validation passes per row share the same plan snapshot');
 assert.equal(h.values.size,0,'proposal has not written storage');
 assert.deepEqual(plain(result),{key:HOME,value:{version:1,targets:{},cooked:{},planned:{},byActor:{guest:{targets:Object.fromEntries(chosen.map((row,i)=>['food '+i+'|g',{name:row.name,unit:'g',targetQty:i===0?50:0,pending:i===0,extraBuffer:5,buyMultiple:10,...(i!==0?{automaticNeeded:true}:{})}])),cooked:{},planned:{}}}},expected:null,who:'guest',featureChange:null,shoppingChange:null});
 h.setRequirements(requirements.map(row=>({...row,required:100})));
 assert.throws(()=>h.api.prepare(chosen),/Total needed cannot be less/,'a later proposal reads the changed plan rather than retaining a previous snapshot');
 assert.equal(h.calls,2);assert.equal(h.values.size,0,'a failed validation commits nothing');
});

test('proposals without pantry targets retain lazy host reads and unit/error behavior',()=>{
 const h=homeFixture();
 const result=h.api.prepare([{name:'Rice',unit:'kg',qty:.5,totalNeeded:1}]);
 assert.equal(h.calls,0);assert.equal(result.value.byActor.guest.targets['rice|g'].targetQty,1000);
 assert.throws(()=>h.api.prepare([{name:'Rice',unit:'g',qty:null,totalNeeded:20,pantryTarget:true}]),/Enter how much/);assert.equal(h.calls,0,'invalid amounts fail before unnecessary plan computation');
});

test('generated-only readout transform rejects missing, duplicate or changed call sites',()=>{
 assert.equal(fs.readFileSync(new URL('../shopping-inventory.js',import.meta.url),'utf8'),raw);
 assert.equal((optimized.match(/\{requirements:bb5Requirements\(\)\}/g)||[]).length,4);
 for(const value of [null,'',raw.replace('window.BBHome?.total?.(row.name,actual.unit)','otherTotal(row)'),raw+'\nwindow.BBHome?.total?.(row.name,actual.unit)'])assert.throws(()=>transform700PantryPerformance(value),/catalogue700_pantry_performance_/);
});

function tileDOM(h){
 const tree=node=>({tag:node.tagName,attributes:[...node.attributes],text:node._text,children:node.children.map(tree)});
 return ['cupboard','fridge','freezer'].map(loc=>({loc,tiles:h.doc.querySelector('[data-bb76-tiles="'+loc+'"]').children.map(tree),count:h.doc.querySelector('[data-bb76-count="'+loc+'"]').textContent}));
}

test('fresh render indexes preserve complete tile DOM and physical descriptors for variants, brands and units',async()=>{
 const seeds=[
  ['Tomatoes','fridge','each',2],['Chopped tomatoes','cupboard','g',200],['Tinned tomatoes','cupboard','tin',1],['Passata','cupboard','g',500],['Frozen tomatoes','freezer','g',200],
  ['John West Tuna Chunks','cupboard','g',145],['Waitrose Tuna Chunks','cupboard','g',160],['Fresh tuna steak','fridge','g',200],['Frozen tuna','freezer','g',300],
  ['Milk','fridge','ml',250],['Milk','fridge','l',.5],['Rice','cupboard','g',500],['Rice','cupboard','pack',null],
  ['Pepper','fridge','each',2],['Black Peppercorns','cupboard','each',1],['Garlic','cupboard','clove',3],['Garlic','cupboard','bulb',1],
  ['Pasta','cupboard','g',250],['Pasta','cupboard','kg',1],['Not selected custom food','cupboard','g',100]
 ];
 const inventory={},stock={};
 for(const [i,[name,loc,unit,qty]]of seeds.entries()){
  const key=loc+'|source-'+i,id=name.toLowerCase()+'|'+unit;
  inventory[key]={name,loc,unit,qty,selected:i!==seeds.length-1,...(qty!==null?{bb173StockKey:id,bb173StockValue:qty}:{}),...(name==='Black Peppercorns'?{staple:true,stapleStatus:'in'}:{})};
  if(qty!==null&&i!==seeds.length-1)stock[id]=(stock[id]||0)+qty;
 }
 const options={requirements:[{key:'Milk',unit:'ml',required:1000},{key:'Chopped tomatoes',unit:'g',required:800}],inventory,stock};
 const legacy=await fixture({...options,sourceOverride:raw}),fast=await fixture({...options,sourceOverride:optimized});await pause();
 const equal=()=>{assert.deepEqual(tileDOM(fast),tileDOM(legacy),'tile names/order/emoji/accessibility/selection/counts are exact');assert.deepEqual(plain(fast.win.BBPantryEditor.list()),plain(legacy.win.BBPantryEditor.list()),'stock descriptors retain all original physical identities');};
 equal();
 for(const h of [legacy,fast]){
  for(const row of h.win.BBPantryEditor.list().filter(row=>row.name==='Rice'))assert.equal(h.win.BBPantryEditor.remove(row.key).ok,true);
 }
 await pause();equal();
 for(const h of [legacy,fast]){
  assert.equal(h.win.BBPantryEditor.add({name:'Fresh tomatoes',loc:'fridge',unit:'each',qty:1}).ok,true);
  assert.equal(h.win.BBPantryEditor.add({name:'Different brand tuna chunks',loc:'cupboard',unit:'g',qty:100}).ok,true);
 }
 await pause();equal();
 assert.equal(fast.storage.getItem('basketboss_makeameal_v1_inventory'),legacy.storage.getItem('basketboss_makeameal_v1_inventory'),'pure rendering and draft edits have not written inventory');
});

test('per-render selected identities avoid repeated canonical scans without retaining a cache',async()=>{
 const inventory={},stock={};
 for(let i=0;i<31;i++){const name='QA pantry food '+i,id=name.toLowerCase()+'|g';inventory['cupboard|source-'+i]={name,loc:'cupboard',unit:'g',qty:10,selected:true,bb173StockKey:id,bb173StockValue:10};stock[id]=10;}
 async function setup(sourceOverride){let calls=0;const h=await fixture({inventory,stock,requirements:[],sourceOverride,configureWindow(win){const policy=win.BBPantryPolicy;win.BBPantryPolicy={...policy,canonicalName(...args){calls++;return policy.canonicalName(...args);}};}});return {h,get calls(){return calls;}};}
 const legacy=await setup(raw),fast=await setup(optimized);await pause();
 const legacyBefore=legacy.calls;assert.equal(legacy.h.win.BBPantryEditor.remove('cupboard|source-0').ok,true);const legacyWork=legacy.calls-legacyBefore;
 const fastBefore=fast.calls;assert.equal(fast.h.win.BBPantryEditor.remove('cupboard|source-0').ok,true);const fastWork=fast.calls-fastBefore;
 assert.ok(fastWork<legacyWork/2,'fresh local membership indexes eliminate most repeated selected-tile canonicalization: '+fastWork+' versus '+legacyWork);
 assert.deepEqual(tileDOM(fast.h),tileDOM(legacy.h));
});
