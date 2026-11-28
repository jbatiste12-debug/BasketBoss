import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as receiptCore from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),homeModule=require('../bb-home.js'),inlineApi=require('../bb-pantry-inline.js');
const source=fs.readFileSync(new URL('../shopping-inventory.js',import.meta.url),'utf8'),inline=fs.readFileSync(new URL('../bb-pantry-inline.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),pantrySource=html.match(/const BB307Pantry=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/)[0];
const INVENTORY='basketboss_makeameal_v1_inventory',STOCK='basketboss_321_v7_measured_pantry',fixtureURL=new URL('./basketboss-pantry-policy-ui.test.mjs',import.meta.url).href;
const helper=fs.readFileSync(new URL(fixtureURL),'utf8'),start=helper.indexOf('export async function fixture('),end=helper.indexOf('\n\ntest(',start);
assert.ok(start>=0&&end>start);
const held=new Map();let timerSerial=0;
const scope={assert,fs,vm,URL,fixtureURL,source,pantrySource,policy,homeModule,receiptCore,STOCK,INVENTORY,console,queueMicrotask,
 setTimeout(fn,delay){if(delay===350){const id={held:++timerSerial};held.set(id,fn);return id;}return setTimeout(fn,delay);},
 clearTimeout(id){if(held.has(id))held.delete(id);else clearTimeout(id);},
 decode:value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x])),dataKey:name=>name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())};
// Execute the existing DOM fixture without registering its unrelated tests.
vm.runInNewContext(helper.slice(start,end).replace('export async function fixture','async function fixture').replaceAll('import.meta.url','fixtureURL')+'\nthis.makeFixture=fixture;',scope);
const fixture=options=>scope.makeFixture({requirements:[],live:true,...options});
const event=()=>({preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}});
const clone=value=>JSON.parse(JSON.stringify(value));
function actionSource(prefix,suffix){const from=inline.indexOf(prefix),to=inline.indexOf(suffix,from);assert.ok(from>=0&&to>from,prefix);return inline.slice(from+prefix.length,to)+'\n}';}
const flushStart=inline.indexOf('  async function flushSaved('),flushEnd=inline.indexOf('\n  function fitEditor',flushStart);
const flushSource=inline.slice(flushStart,flushEnd);
function addForm(h){
 const api=h.win.BBPantryEditor,notices=[],name={value:'Pasta',disabled:false,focus(){}},quantity={value:'500',disabled:false},unit={value:'g',disabled:false},add={disabled:false},view={busy:false};
 const context={current:api,win:h.win,view,name,quantity,unit,add,loc:'cupboard',actor:()=>h.win.BBHome.actor(),valid:()=>true,teardown(){throw Error('unexpected teardown');},notice:(_view,message,error=false)=>notices.push({message,error}),schedule(){}};
 vm.runInNewContext(flushSource+'\nthis.submit='+actionSource("form.addEventListener('submit',async event=>{",'\n   });').replace(/^/,'async event=>{')+';',context);
 return {submit:()=>context.submit(event()),notices,name,quantity,view};
}

test('Add saves before its success and survives a tab change and cold restart with its 350ms timer held',async()=>{
 const h=await fixture(),form=addForm(h);assert.deepEqual(clone(h.stock()),{});
 const saving=form.submit();assert.equal(form.notices[0].message,'Saving…');
 h.doc.querySelector('.tab.active').setAttribute('class','tab');h.win.BBPantryEditor.card.remove();
 await saving;assert.match(form.notices.at(-1).message,/Food saved/);assert.equal(h.win.BBPantryLive.hasPending(),false);assert.deepEqual(clone(h.stock()),{'pasta|g':500});
 const reopened=await fixture({stock:h.stock(),inventory:h.inventory()});assert.deepEqual(clone(reopened.stock()),{'pasta|g':500});assert.equal(reopened.win.BBPantryEditor.list().filter(row=>row.qty>0).length,1);
});

test('a failed Add retains its inputs and retry saves its staged food once without claiming success',async()=>{
 const h=await fixture(),form=addForm(h),write=h.storage.setItem;
 h.storage.setItem=(key,value)=>{if(key===INVENTORY&&value!=='{}')throw Error('synthetic storage full');write(key,value);};
 await form.submit();assert.deepEqual(clone(h.stock()),{});assert.equal(h.win.BBPantryLive.hasPending(),true);assert.equal(form.quantity.value,'500');assert.equal(form.name.value,'Pasta');assert.equal(form.notices.at(-1).error,true);assert.equal(form.notices.some(row=>/Food saved/.test(row.message)),false);
 h.storage.setItem=write;await form.submit();assert.deepEqual(clone(h.stock()),{'pasta|g':500});assert.match(form.notices.at(-1).message,/Food saved/);assert.equal(form.quantity.value,'');
});

test('explicit flush commits a validated pending edit after its original card disconnects',async()=>{
 const h=await fixture();assert.equal(h.win.BBPantryEditor.add({name:'Pasta',loc:'cupboard',qty:500,unit:'g'}).ok,true);
 h.win.BBPantryEditor.card.remove();await h.win.BBPantryEditor.flush();assert.deepEqual(clone(h.stock()),{'pasta|g':500});assert.equal(h.win.BBPantryLive.hasPending(),false);
});

test('explicit flush retains account-deletion and physical-state guards after disconnection',async()=>{
 for(const changed of ['deletion','physical']){
  const h=await fixture();h.win.BBPantryEditor.add({name:'Pasta',loc:'cupboard',qty:500,unit:'g'});h.win.BBPantryEditor.card.remove();
  if(changed==='deletion')h.win.BBAccountDeletion={isDeleting:()=>true};else h.storage.setItem(STOCK,JSON.stringify({'milk|ml':250}));
  const before=new Map(h.values);await h.win.BBPantryEditor.flush();assert.deepEqual(clone([...h.values]),clone([...before]));assert.equal(h.win.BBPantryLive.hasPending(),true);
 }
});

test('Done adding waits for durable stock and stays open when saving fails',async()=>{
 for(const failure of [false,true]){
  const h=await fixture(),api=h.win.BBPantryEditor;api.add({name:'Pasta',loc:'cupboard',qty:500,unit:'g'});
  if(failure){const write=h.storage.setItem;h.storage.setItem=(key,value)=>{if(key===INVENTORY&&value!=='{}')throw Error('synthetic quota');write(key,value);};}
  const body={dataset:{bbpiAdding:'true'}},view={busy:false},notices=[];let closed=0;
  const context={current:api,win:h.win,view,body,name:{value:'Pasta'},quantity:{value:'500'},closeAdd:{disabled:false},actor:()=>h.win.BBHome.actor(),valid:()=>true,notice:(_view,message,error=false)=>notices.push({message,error}),closeEditor(){closed++;}};
  vm.runInNewContext(flushSource+'\nthis.done='+actionSource("closeAdd=btn('Done adding',async()=>{","\n   },'bbpi-close-add')").replace(/^/,'async()=>{')+';',context);
  await context.done();assert.equal(closed,failure?0:1);assert.equal(body.dataset.bbpiAdding,failure?'true':undefined);assert.deepEqual(clone(h.stock()),failure?{}:{'pasta|g':500});
  if(failure)assert.equal(notices.at(-1).error,true);
 }
});

test('ordinary summary step controls save their amount before reporting success',async()=>{
 const h=await fixture({stock:{'pasta|g':500},inventory:{'cupboard|pasta':{name:'Pasta',loc:'cupboard',qty:500,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:500}}}),api=h.win.BBPantryEditor,key=api.list()[0].key,notices=[];
 const view={},context={current:api,win:h.win,summarySaves:new Set(),sections:new Map([['cupboard',view]]),actor:()=>h.win.BBHome.actor(),valid:()=>true,teardown(){},looseProduce:()=>null,rowUnit:row=>row.unit,stepPatch:inlineApi.stepPatch,market:()=> 'UK',safe:fn=>fn(),openEditor(){throw Error('unexpected editor');},editor:null,notice:(_view,message,error=false)=>notices.push({message,error}),schedule(){}};
 const from=inline.indexOf('  async function adjustSummary('),to=inline.indexOf('\n  async function freezeSummary',from);vm.runInNewContext(flushSource+inline.slice(from,to)+'\nthis.step=adjustSummary;',context);
 await context.step(key,1);assert.deepEqual(clone(h.stock()),{'pasta|g':550});assert.match(notices.at(-1).message,/Amount saved/);assert.equal(h.win.BBPantryLive.hasPending(),false);
});

test('legacy Add retains its selected food across restart without waiting for the auto-save timer',async()=>{
 const h=await fixture(),form=h.doc.querySelector('[data-bb76-add="cupboard"]');let resets=0;
 form.elements={name:{value:'Pasta'}};form.reset=()=>{resets++;form.elements.name.value='';};await form.dispatch('submit');
 assert.equal(resets,1);assert.equal(h.win.BBPantryLive.hasPending(),false);assert.equal(h.inventory()['cupboard|pasta'].selected,true);
 const reopened=await fixture({stock:h.stock(),inventory:h.inventory()});assert.equal(reopened.win.BBPantryEditor.list().find(row=>row.name==='Pasta')?.qty,null);
});

test('legacy removal reports success only after the existing stock transaction saves',async()=>{
 for(const failure of [false,true]){
  const inventory={'cupboard|pasta':{name:'Pasta',loc:'cupboard',qty:500,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:500}},h=await fixture({stock:{'pasta|g':500},inventory});
  if(failure){const write=h.storage.setItem,before=h.storage.getItem(INVENTORY);h.storage.setItem=(key,value)=>{if(key===INVENTORY&&value!==before)throw Error('synthetic quota');write(key,value);};}
  await h.control('data-bb5-remove','cupboard|pasta').click();assert.deepEqual(clone(h.stock()),failure?{'pasta|g':500}:{});assert.equal(h.win.BBPantryLive.hasPending(),failure);assert.match(h.status(),failure?/not been saved/:/removed and saved/);
 }
});

test('tab navigation continues only after every active pantry draft has saved',async()=>{
 for(const failure of [false,true]){
  let handler;const h=await fixture({configureWindow(win){win.document.addEventListener=(type,fn)=>{if(type==='click')handler=fn;};}});
  h.win.BBPantryEditor.add({name:'Pasta',loc:'cupboard',qty:500,unit:'g'});
  if(failure){const write=h.storage.setItem;h.storage.setItem=(key,value)=>{if(key===INVENTORY&&value!=='{}')throw Error('synthetic quota');write(key,value);};}
  const button=h.doc.querySelector('.tab[data-tab="shop-list"]');handler({target:button,...event()});
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.visits(),failure?0:1);assert.equal(h.win.BBPantryLive.hasPending(),failure);assert.deepEqual(clone(h.stock()),failure?{}:{'pasta|g':500});
 }
});
