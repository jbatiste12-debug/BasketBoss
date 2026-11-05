import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ui=require('../bb-essentials-confirm.js'),amount=require('../bb-household-amount.js');
function fixture(){
 const calls=[];let rows=[{id:'soap',name:'Soap',unit:'each',qty:1,targetQty:4,ownedQty:1,selected:true,manualPending:true}],actor='alice',version=0;
 const pin=()=>({actor,session:actor+'-session',features:JSON.stringify({version,essentials:rows})});
 const win={BBKitchenChoiceRules:{isHousehold:name=>/soap|shampoo|detergent|toilet rolls/i.test(name)},BBHomeHost:{household:()=>rows,householdAmountContext:pin},BBHome:{
  confirmHousehold(id,patch){calls.push({kind:'amend',id,patch});rows=rows.map(row=>row.id===id?{...row,...patch}:row);version++;return {ok:true,id,item:rows.find(row=>row.id===id)};},
  confirmHouseholdEntry(entry){calls.push({kind:'new',entry});const row={...entry,id:'new',selected:true};rows.push(row);version++;return {ok:true,id:row.id,item:row};},
  removeHousehold(id){calls.push({kind:'remove',id});rows=rows.map(row=>row.id===id?{...row,selected:false}:row);version++;return {ok:true,id};}
 }};
 return {api:ui.createController(win),win,calls,rows:()=>rows,change:()=>{version++;},account:()=>{actor='bob';}};
}
test('opening and cancelling a thumbnail draft performs no household or Shop save',()=>{
 const h=fixture(),before=JSON.stringify(h.rows()),view=h.api.open({name:'Shampoo',unit:'pack'});
 assert.equal(view.item,null);assert.equal(view.defaults.targetQty,'1');assert.equal(view.defaults.ownedQty,'0');assert.equal(h.calls.length,0);assert.equal(JSON.stringify(h.rows()),before);
});
test('Confirm creates one weekly item; the same confirmed draft cannot submit twice',async()=>{
 const h=fixture(),view=h.api.open({name:'Shampoo',unit:'pack'});
 assert.equal((await h.api.confirm(view,{name:'Shampoo',unit:'pack',targetQty:'3',ownedQty:'1'})).ok,true);
 assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].entry,{name:'Shampoo',unit:'pack',targetQty:3,ownedQty:1});
 assert.equal((await h.api.confirm(view,{name:'Shampoo',unit:'pack',targetQty:'3',ownedQty:'1'})).ok,false);assert.equal(h.calls.length,1);
});
test('existing names open Amend rather than creating duplicate requests',async()=>{
 const h=fixture(),view=h.api.open({name:' soap '});assert.equal(view.item.id,'soap');
 assert.equal((await h.api.confirm(view,{name:'Soap',unit:'each',targetQty:'6',ownedQty:'2'})).ok,true);
 assert.equal(h.calls[0].kind,'amend');assert.deepEqual(h.calls[0].patch,{targetQty:6,ownedQty:2});assert.equal(h.rows().length,1);
});
test('input validation stops food, fractional packs and blank amounts before saving',async()=>{
 for(const input of [{name:'Rice',unit:'g',targetQty:'500',ownedQty:'0'},{name:'Shampoo',unit:'pack',targetQty:'1.5',ownedQty:'0'},{name:'Shampoo',unit:'each',targetQty:'',ownedQty:'0'}]){
  const h=fixture();assert.equal((await h.api.confirm(h.api.open(),input)).ok,false);assert.equal(h.calls.length,0);
 }
});
test('stale account or essentials snapshots cannot confirm an old dialog',async()=>{
 for(const change of ['account','change']){const h=fixture(),view=h.api.open({id:'soap'});h[change]();assert.equal((await h.api.confirm(view,{name:'Soap',targetQty:'4',ownedQty:'1'})).ok,false);assert.equal(h.calls.length,0);}
});
test('Confirm locks both save and Delete while the request is pending',async()=>{
 const h=fixture();let done;h.win.BBHome.confirmHousehold=()=>new Promise(resolve=>{h.calls.push('pending');done=()=>resolve({ok:true,id:'soap'});});
 const view=h.api.open({id:'soap'}),pending=h.api.confirm(view,{name:'Soap',targetQty:'4',ownedQty:'1'});assert.equal(h.api.isBusy(),true);
 assert.equal((await h.api.confirm(view,{name:'Soap',targetQty:'4',ownedQty:'1'})).busy,true);assert.equal((await h.api.remove(view)).busy,true);assert.equal(h.calls.length,1);done();assert.equal((await pending).ok,true);assert.equal(h.api.isBusy(),false);
});
test('failed confirmations retain the draft for correction and retry',async()=>{
 const h=fixture(),view=h.api.open({id:'soap'});h.win.BBHome.confirmHousehold=()=>{throw Error('Storage full');};assert.match((await h.api.confirm(view,{name:'Soap',targetQty:'4',ownedQty:'1'})).message,/Storage/);assert.equal(view.done,false);assert.equal(h.api.isBusy(),false);
 h.win.BBHome.confirmHousehold=()=>({ok:true,id:'soap'});assert.equal((await h.api.confirm(view,{name:'Soap',targetQty:'4',ownedQty:'1'})).ok,true);
});
test('part-container confirmation passes measured ownership through the reviewed capacity contract',async()=>{
 const h=fixture(),view=h.api.open({id:'soap'}),measured=amount.prepare({remaining:'.5',capacity:'750',capacityUnit:'ml',neededContainers:'1'});
 assert.equal((await h.api.confirm(view,{name:'Soap'},{measured})).ok,true);assert.equal(h.calls[0].patch.ownedQty,375);assert.equal(h.calls[0].patch.targetQty,750);assert.equal(h.calls[0].patch.packReviewed,true);
});
test('Delete delegates soft removal without clearing the saved owned balance',async()=>{
 const h=fixture(),view=h.api.open({id:'soap'});assert.equal((await h.api.remove(view)).ok,true);assert.equal(h.rows()[0].selected,false);assert.equal(h.rows()[0].ownedQty,1);assert.equal(h.calls[0].kind,'remove');
});
