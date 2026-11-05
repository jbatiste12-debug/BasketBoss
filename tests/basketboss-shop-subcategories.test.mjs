import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{group}=require('../bb-shop-subcategories.js'),groups=require('../bb-pantry-groups.js');
function fixture(){
 const values=new Map(),writes=[];
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push(key);},removeItem:key=>values.delete(key)};
 let next=0;
 const api=groups.install({localStorage:storage,crypto:{randomUUID:()=>String(++next)}});
 const account=id=>{if(id)values.set('basketboss_cloud_session_v1',JSON.stringify({user:{id}}));else values.delete('basketboss_cloud_session_v1');};
 return {api,values,writes,account};
}
const rows=()=>[
 {id:'ess:soap',name:'Hand soap',quantity:2,price:1.2,checked:false},
 {id:'ess:wash',name:'Laundry detergent',quantity:1,price:4.5,checked:true},
 {id:'ess:bag',name:'Bin bags',quantity:3,price:2.1,checked:false},
 {id:'ess:other',name:'Spare household item',quantity:1,price:3.1,checked:false}
];
test('personal group names and assignments match the same household IDs in At home and Shop',()=>{
 const h=fixture(),items=rows(),custom=h.api.create('essentials','Bathroom shelf');
 h.api.assign('essentials','soap',custom);
 const output=group(items,{pantryGroups:h.api});
 assert.equal(output.find(row=>row.id===custom).name,'Bathroom shelf');
 assert.equal(output.find(row=>row.id===custom).items[0],items[0]);
 for(const item of items)assert.equal(output.find(row=>row.items.includes(item)).id,h.api.groupFor('essentials',item.id.slice(4),item.name));
});
test('grouping only arranges row references without writing stock, counts, prices or purchase state',()=>{
 const h=fixture(),items=rows(),before=JSON.stringify(items),writes=h.writes.length;
 const output=group(items,{pantryGroups:h.api}),all=output.flatMap(row=>row.items);
 assert.equal(all.length,items.length);assert.equal(new Set(all).size,items.length);
 assert.equal(JSON.stringify(items),before);assert.equal(h.writes.length,writes);
 assert.equal(all.reduce((sum,row)=>sum+row.quantity,0),items.reduce((sum,row)=>sum+row.quantity,0));
 assert.equal(all.reduce((sum,row)=>sum+row.price,0),items.reduce((sum,row)=>sum+row.price,0));
 assert.equal(all.filter(row=>row.checked).length,1);
});
test('switching account cannot retain another account custom headings or assignments',()=>{
 const h=fixture(),items=rows();h.account('alice');
 const custom=h.api.create('essentials','Alice items');h.api.assign('essentials','soap',custom);
 assert.ok(group(items,{pantryGroups:h.api}).some(row=>row.name==='Alice items'));
 h.account('bob');
 const output=group(items,{pantryGroups:h.api});assert.ok(!output.some(row=>row.name==='Alice items'));
 assert.equal(output.find(row=>row.items.includes(items[0])).id,'toiletries');
 h.account('alice');assert.equal(group(items,{pantryGroups:h.api}).find(row=>row.items.includes(items[0])).id,custom);
});
test('renames, reordering and removal follow personal groups without rebuilding any quantity data',()=>{
 const h=fixture(),items=rows();h.api.rename('essentials','cleaning','Home cleaning');h.api.move('essentials','toiletries',-1);
 let output=group(items,{pantryGroups:h.api});assert.equal(output[0].id,'toiletries');assert.equal(output.find(row=>row.id==='cleaning').name,'Home cleaning');
 h.api.assign('essentials','bag','cleaning');h.api.remove('essentials','cleaning');output=group(items,{pantryGroups:h.api});
 assert.ok(!output.some(row=>row.id==='cleaning'));assert.equal(output.find(row=>row.items.includes(items[2])).id,'other');
});
test('missing, corrupted or stale group metadata keeps every item visible in Other items',()=>{
 const items=rows();
 for(const pantryGroups of [undefined,{snapshot(){throw Error('bad saved groups');}}, {snapshot:()=>({groups:[{id:'cleaning',name:'Cleaning'}]}),groupFor:()=> 'deleted-id'}]){
  const output=group(items,{pantryGroups});assert.equal(output.length,1);assert.equal(output[0].id,'other');assert.equal(output[0].name,'Other items');assert.deepEqual(output[0].items,items);
 }
});
test('custom names remain plain labels and callback failures cannot drop a confirmed item',()=>{
 const items=rows(),pantryGroups={snapshot:()=>({groups:[{id:'custom',name:'<b>My supplies</b>'},{id:'other',name:'Other items'}]}),groupFor:()=> 'custom'};
 assert.equal(group(items,{pantryGroups})[0].name,'<b>My supplies</b>');
 const output=group(items,{pantryGroups,keyFor:()=>{throw Error('missing identity');}});assert.deepEqual(output[0].items,items);assert.equal(output[0].id,'other');
 assert.deepEqual(group(null,{pantryGroups}),[]);assert.deepEqual(group([],{pantryGroups}),[]);
});
test('direct Shop launch refreshes once deferred personal groups are available',()=>{
 const events=new Map();let paints=0;
 const win={document:{readyState:'loading',body:{dataset:{bbnextView:'shop-list'}},addEventListener:(event,fn)=>events.set(event,fn)},BBHomeHost:{refresh:()=>{paints++;}}};
 const {install}=require('../bb-shop-subcategories.js');install(win);assert.equal(paints,0);
 win.BBPantryGroups={};events.get('DOMContentLoaded')();assert.equal(paints,1);
});
test('group boot never rerenders another primary view or a missing group service',()=>{
 const {install}=require('../bb-shop-subcategories.js');let paints=0;
 for(const view of ['week','shop','discover'])install({document:{readyState:'complete',body:{dataset:{bbnextView:view}}},BBPantryGroups:{},BBHomeHost:{refresh:()=>{paints++;}},queueMicrotask:fn=>fn()});
 install({document:{readyState:'complete',body:{dataset:{bbnextView:'shop-list'}}},BBHomeHost:{refresh:()=>{paints++;}},queueMicrotask:fn=>fn()});
 assert.equal(paints,0);
});
