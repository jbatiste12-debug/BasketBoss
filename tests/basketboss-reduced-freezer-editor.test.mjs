import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const helper=createRequire(import.meta.url)('../bb-reduced-stock.js');
const source=fs.readFileSync(new URL('../shopping-inventory.js',import.meta.url),'utf8'),start=source.indexOf(' async function editorMoveToFreezer('),end=source.indexOf('\n window.BBPantryEditor=',start);assert.ok(start>0&&end>start);
const actor='tester-account',meta={version:1,actor,urgent:true,at:1,sources:['shop:one|carrot|g']};
function fixture({premium=true,blocked='',fail=false,dirty=false,invalid=false}={}){
 const inventory={'fridge|carrot':{name:'Carrot',loc:'fridge',qty:300,unit:'g',selected:true,bbReduced:meta},'freezer|carrot':{name:'Carrot',loc:'freezer',qty:100,unit:'g',selected:true}},events=[];
 const staged=new Map(Object.entries(inventory).map(([id,row])=>[id,{...row,inventoryId:id}]));let saves=0;
 const context={movingReduced:false,window:{BBReducedFoodHost:{isPremium:()=>premium},BBReducedStock:helper},editorGuard:()=>blocked,editorFail:message=>({ok:false,message}),saving:null,draftDirty:dirty,staged,openedActor:actor,sid:(loc,name)=>loc+'|'+name.toLowerCase(),render(){},INVENTORY:'inventory',read:()=>inventory,draftActor:()=>actor,pendingFoodDraft:null,note:{textContent:'Save failed'},editorEvent:(type,key)=>events.push({type,key}),editorRow:key=>staged.get(key)};
 context.runSave=async()=>{saves++;if(invalid||fail)return;for(const row of Object.values(inventory))row.selected=false;for(const [id,row]of staged)inventory[id]=JSON.parse(JSON.stringify(row));context.draftDirty=false;};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.move=editorMoveToFreezer;',context);
 return {context,inventory,staged,events,get saves(){return saves;},setPremium:value=>premium=value,setBlocked:value=>blocked=value};
}
test('the actual editor moves one reduced location record, preserving both its amount and existing freezer stock',async()=>{
 const h=fixture(),before=Object.values(h.inventory).reduce((n,row)=>n+row.qty,0),result=await h.context.move('fridge|carrot');
 assert.equal(result.ok,true);assert.equal(result.row.loc,'freezer');assert.equal(result.row.qty,300);assert.equal(result.row.bbReduced.urgent,false);
 const active=Object.values(h.inventory).filter(row=>row.selected!==false);assert.equal(active.reduce((n,row)=>n+row.qty,0),before);assert.equal(active.length,2);assert.ok(active.every(row=>row.loc==='freezer'));assert.equal(h.inventory['freezer|carrot'].qty,100);
});
test('a failed local save restores the editor draft and retains saved stock',async()=>{
 const h=fixture({fail:true}),before=JSON.stringify(h.inventory),result=await h.context.move('fridge|carrot');
 assert.equal(result.ok,false);assert.equal(JSON.stringify(h.inventory),before);assert.equal(h.staged.get('fridge|carrot').loc,'fridge');assert.equal(h.staged.size,2);
});
test('expired Premium, stale accounts and invalid pending amounts cannot relocate stock',async()=>{
 for(const options of [{premium:false},{blocked:'At home changed elsewhere.'},{dirty:true,invalid:true}]){
  const h=fixture(options),before=JSON.stringify(h.inventory),result=await h.context.move('fridge|carrot');assert.equal(result.ok,false);assert.equal(JSON.stringify(h.inventory),before);assert.equal(h.staged.get('fridge|carrot').loc,'fridge');
 }
});
test('Premium is checked again after waiting for an existing amount save',async()=>{
 const h=fixture(),before=JSON.stringify(h.inventory);h.context.saving=Promise.resolve().then(()=>h.setPremium(false));
 const result=await h.context.move('fridge|carrot');assert.equal(result.ok,false);assert.equal(JSON.stringify(h.inventory),before);assert.equal(h.saves,0);
});
