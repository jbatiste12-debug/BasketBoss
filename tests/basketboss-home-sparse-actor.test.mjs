import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fixture as pantryFixture} from './basketboss-pantry-policy-ui.test.mjs';

const require=createRequire(import.meta.url),{install,atomic}=require('../bb-home.js');
const HOME='basketboss_at_home_requirements_v1',SESSION='basketboss_cloud_session_v1';
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const id=(name,unit)=>name.toLowerCase()+'|'+unit;
const rice={name:'Rice',unit:'g',qty:500,totalNeeded:0,pantryTarget:true,automaticNeeded:true,extraBuffer:0,buyMultiple:0};

function fixture(home,actor=ACTOR){
 const values=new Map([['stock',JSON.stringify({'rice|g':500})],['inventory',JSON.stringify({rice:{name:'Rice',qty:500,unit:'g'}})]]);
 if(home!==undefined)values.set(HOME,JSON.stringify(home));
 if(actor!=='guest')values.set(SESSION,JSON.stringify({user:{id:actor}}));
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const win={localStorage:storage,location:{search:''},document:{getElementById:()=>null},BBPantryPolicy:require('../bb-pantry-policy.js'),BBHomeHost:{id,requirements:()=>[],household:()=>[],stock:()=>JSON.parse(values.get('stock'))}};
 return {api:install(win),values,storage,read:key=>JSON.parse(values.get(key)),bytes:()=>JSON.stringify([...values])};
}

for(const sparse of [{},{cooked:{saved:{recipeId:'old-dinner',at:123}}},{receiptGenerations:{'shop|rice|g':2},supersededReceipts:{'shop|rice|g':true}}, {targets:null,cooked:null,planned:null}]){
 test('restored sparse account can confirm 500 g Rice without changing its physical stock: '+JSON.stringify(sparse),()=>{
  const h=fixture({version:1,byActor:{[ACTOR]:sparse}}),before=h.bytes();
  assert.deepEqual(h.api.targets(),{});
  const proposal=h.api.prepare([rice]);
  assert.equal(h.bytes(),before,'reading and proposing never writes or repairs storage');
  assert.equal(proposal.who,ACTOR);
  assert.deepEqual(proposal.value.byActor[ACTOR].targets['rice|g'],{name:'Rice',unit:'g',targetQty:0,pending:false,automaticNeeded:true});
  for(const key of ['targets','cooked','planned'])assert.equal(Array.isArray(proposal.value.byActor[ACTOR][key]),false);
  for(const [key,value]of Object.entries(sparse))if(value!==null)assert.deepEqual(proposal.value.byActor[ACTOR][key],value);
  atomic(h.storage,{[proposal.key]:proposal.value},{[proposal.key]:proposal.expected});
  assert.deepEqual(h.read('stock'),{'rice|g':500});
  assert.deepEqual(h.read('inventory'),{rice:{name:'Rice',qty:500,unit:'g'}});
  assert.equal(h.api.targets()['rice|g'].pending,false,'no shopping demand is invented when no meals require Rice');
 });
}

test('initializing the current account retains other accounts, receipts and unknown metadata',()=>{
 const other={targets:{'milk|ml':{name:'Milk',unit:'ml',targetQty:200,pending:true}},cooked:{otherReceipt:{at:1}}};
 const current={cooked:{receipt:{at:2}},planned:{occurrence:true},manualBuys:{kept:{pending:false}},manualRequests:{historical:'intent'},receiptGenerations:{receipt:3},settledPurchases:{kept:{purchase:{qty:100}}},extraMetadata:{preserved:true}};
 const h=fixture({version:1,legacyMarker:'keep',byActor:{[ACTOR]:current,[OTHER]:other}});
 const proposal=h.api.prepare([rice]);
 assert.equal(proposal.value.legacyMarker,'keep');assert.deepEqual(proposal.value.byActor[OTHER],other);
 for(const [key,value]of Object.entries(current))assert.deepEqual(proposal.value.byActor[ACTOR][key],value);
 atomic(h.storage,{[proposal.key]:proposal.value},{[proposal.key]:proposal.expected});
 h.storage.setItem(SESSION,JSON.stringify({user:{id:OTHER}}));
 assert.deepEqual(h.api.targets(),other.targets,'the next read uses the active account');
 assert.deepEqual(h.read(HOME).byActor[ACTOR].cooked,current.cooked);
});

test('fresh guest records retain the existing proposal shape and save without changing stock',()=>{
 const h=fixture(undefined,'guest'),proposal=h.api.prepare([{name:'Rice',unit:'g',qty:500,totalNeeded:800}]);
 assert.equal(proposal.expected,null);assert.equal(h.values.has(HOME),false);
 assert.deepEqual(proposal.value.byActor.guest,{targets:{'rice|g':{name:'Rice',unit:'g',targetQty:800,pending:true}},cooked:{},planned:{}});
 atomic(h.storage,{[proposal.key]:proposal.value},{[proposal.key]:proposal.expected});
 assert.deepEqual(h.read('stock'),{'rice|g':500});
});

for(const field of ['targets','cooked','planned'])for(const value of [[],17,'invalid',false])test('present invalid '+field+' is rejected without overwriting saved data: '+JSON.stringify(value),()=>{
 const h=fixture({version:1,byActor:{[ACTOR]:{[field]:value,receiptGenerations:{kept:1}}}}),before=h.bytes();
 assert.throws(()=>h.api.prepare([rice]),/^Error: Review your saved At home records before updating stock\.$/);
 assert.equal(h.bytes(),before);
});

for(const malformed of [[],3,'invalid'])test('invalid actor record is preserved and reports a readable error: '+JSON.stringify(malformed),()=>{
 const h=fixture({version:1,byActor:{[ACTOR]:malformed}}),before=h.bytes();
 assert.throws(()=>h.api.prepare([rice]),/Review your saved At home records/);assert.equal(h.bytes(),before);
});

test('a competing metadata write still rejects the prepared update without replacing pantry or history',()=>{
 const h=fixture({version:1,byActor:{[ACTOR]:{cooked:{kept:{at:1}}}}}),proposal=h.api.prepare([rice]);
 const later={version:1,byActor:{[ACTOR]:{targets:{'rice|g':{name:'Rice',unit:'g',targetQty:900,pending:true}},cooked:{newer:{at:2}}}}};
 h.storage.setItem(HOME,JSON.stringify(later));const before=h.bytes();
 assert.throws(()=>atomic(h.storage,{[proposal.key]:proposal.value},{[proposal.key]:proposal.expected}),/changed elsewhere/);
 assert.equal(h.bytes(),before);
});

test('completion of a sparse restored account safely reports no pending target without writing',()=>{
 const h=fixture({version:1,byActor:{[ACTOR]:{receiptGenerations:{kept:1}}}}),before=h.bytes();
 assert.deepEqual(h.api.completionChanges('rice|g'),{});assert.equal(h.bytes(),before);
});

for(const raw of ['{broken','[]','null','false','{}',JSON.stringify({version:2,byActor:{[ACTOR]:{targets:{keep:{targetQty:900}},cooked:{history:{at:1}}}}})])test('unreadable or unsupported Home metadata cannot be replaced by a fresh confirmation: '+raw,()=>{
 const h=fixture(undefined);h.storage.setItem(HOME,raw);const before=h.bytes();
 assert.throws(()=>h.api.prepare([rice]),/Review your saved At home records before updating stock/);
 assert.equal(h.bytes(),before);assert.equal(h.storage.getItem(HOME),raw);
});

for(const invalid of [null,[],2,'invalid'])test('invalid account map is retained rather than replaced: '+JSON.stringify(invalid),()=>{
 const h=fixture({version:1,byActor:invalid}),before=h.bytes();
 assert.throws(()=>h.api.prepare([rice]),/Review your saved At home records/);assert.equal(h.bytes(),before);
});

test('real pantry Add item and flush save new 500 g Rice when restored home has only receipt history',async()=>{
 const history={receiptGenerations:{'old-shop|rice|g':2},supersededReceipts:{'old-shop|rice|g':true}};
 const h=await pantryFixture({live:true,requirements:[],configureWindow(win){
  win.localStorage.setItem(SESSION,JSON.stringify({user:{id:ACTOR}}));
  win.localStorage.setItem(HOME,JSON.stringify({version:1,byActor:{[ACTOR]:history,[OTHER]:{cooked:{kept:{at:7}}}}}));
 }});
 const result=h.win.BBPantryEditor.add({name:'Rice',loc:'cupboard',qty:500,unit:'g'});
 assert.equal(result.ok,true);await h.win.BBPantryEditor.flush();
 assert.deepEqual(h.stock(),{'rice|g':500});assert.equal(h.win.BBPantryEditor.list().length,1);
 const saved=JSON.parse(h.storage.getItem(HOME));
 assert.deepEqual(saved.byActor[ACTOR].receiptGenerations,history.receiptGenerations);
 assert.deepEqual(saved.byActor[ACTOR].supersededReceipts,history.supersededReceipts);
 assert.deepEqual(saved.byActor[OTHER],{cooked:{kept:{at:7}}});
});

test('real pantry edit and flush retain existing 500 g Rice and cooked history from a sparse restore',async()=>{
 const history={cooked:{kept:{recipeId:'previous-dinner',at:123}}};
 const h=await pantryFixture({live:true,requirements:[],stock:{'rice|g':500},inventory:{'cupboard|rice':{name:'Rice',loc:'cupboard',qty:500,unit:'g',selected:true,bb173StockKey:'rice|g',bb173StockValue:500}},configureWindow(win){
  win.localStorage.setItem(SESSION,JSON.stringify({user:{id:ACTOR}}));
  win.localStorage.setItem(HOME,JSON.stringify({version:1,byActor:{[ACTOR]:history}}));
 }});
 const editor=h.win.BBPantryEditor;
 assert.equal(editor.update('cupboard|rice',{qty:500,automaticNeeded:true}).ok,true);
 await editor.flush();assert.deepEqual(h.stock(),{'rice|g':500});
 assert.equal(h.inventory()['cupboard|rice'].qty,500);
 assert.deepEqual(JSON.parse(h.storage.getItem(HOME)).byActor[ACTOR].cooked,history.cooked);
});

function shoppingRows(h){
 const home=h.win.BBHome,id=h.win.BBHomeHost.id,requirements=home.augment(h.requirements,[],home.targets(),id);
 const used=h.pantry.reconcileStock(h.stock(),requirements).pantry;
 return home.manualBuyItems(requirements.map(row=>({...row,pantryUsed:used[id(row.key,row.unit)]||0,toBuy:Math.max(0,row.required-(used[id(row.key,row.unit)]||0))})));
}

for(const [required,buffer,expected]of [[0,600,100],[0,100,0],[400,300,200]])test('sparse account buffer uses the real pantry and Shop pipeline: needed '+required+', buffer '+buffer+', stock 500',async()=>{
 const history={receiptGenerations:{kept:2}};
 const h=await pantryFixture({live:true,requirements:required?[{key:'Rice',unit:'g',required}]:[],stock:{'rice|g':500},inventory:{'cupboard|rice':{name:'Rice',loc:'cupboard',qty:500,unit:'g',selected:true,bb173StockKey:'rice|g',bb173StockValue:500}},configureWindow(win){
  win.localStorage.setItem(SESSION,JSON.stringify({user:{id:ACTOR}}));
  win.localStorage.setItem(HOME,JSON.stringify({version:1,byActor:{[ACTOR]:history}}));
 }});
 const editor=h.win.BBPantryEditor,result=editor.update('cupboard|rice',{automaticNeeded:true,extraBuffer:buffer,buyMultiple:0});
 assert.equal(result.ok,true);assert.equal(result.row.shortfall,expected);
 await editor.flush();
 assert.equal(editor.read('cupboard|rice').shortfall,expected);
 const row=shoppingRows(h).find(row=>h.win.BBHomeHost.id(row.key,row.unit)==='rice|g');
 assert.equal(row?.toBuy||0,expected);if(expected>0)assert.ok(row,'a missing amount must be represented on Shop');
 assert.deepEqual(h.stock(),{'rice|g':500});assert.equal(h.inventory()['cupboard|rice'].qty,500);
 assert.equal(h.win.BBHome.targets()['rice|g'].extraBuffer,buffer);
 assert.deepEqual(JSON.parse(h.storage.getItem(HOME)).byActor[ACTOR].receiptGenerations,history.receiptGenerations);
});

test('buffer input cannot guess an unknown pantry quantity or erase its saved record',async()=>{
 const saved={version:1,byActor:{[ACTOR]:{receiptGenerations:{kept:2}}}};
 const h=await pantryFixture({live:true,requirements:[],stock:{},inventory:{'cupboard|rice':{name:'Rice',loc:'cupboard',qty:null,unit:'g',selected:true}},configureWindow(win){
  win.localStorage.setItem(SESSION,JSON.stringify({user:{id:ACTOR}}));win.localStorage.setItem(HOME,JSON.stringify(saved));
 }});
 const before=new Map(h.values),result=h.win.BBPantryEditor.update('cupboard|rice',{automaticNeeded:true,extraBuffer:100});
 assert.equal(result.ok,false);assert.match(result.message,/Enter how much you already have/);
 assert.deepEqual(h.values,before);assert.equal(h.inventory()['cupboard|rice'].qty,null);assert.deepEqual(h.stock(),{});
});

for(const raw of ['{broken',JSON.stringify({version:2}),JSON.stringify({version:1,byActor:{[ACTOR]:17}})])test('read-only Home screen survives unreadable history without resetting its bytes: '+raw,()=>{
 const h=fixture(undefined);h.storage.setItem(HOME,raw);const before=h.bytes();
 assert.deepEqual(h.api.targets(),{});assert.equal(h.api.isCooked('old-meal'),false);assert.deepEqual(h.api.shoppingBuys(),[]);
 assert.equal(h.api.receiptGeneration('kept'),0);assert.equal(h.api.supersedesReceipt('kept'),false);assert.equal(h.bytes(),before);
 assert.throws(()=>h.api.prepare([rice]),/Review your saved At home records/);assert.equal(h.bytes(),before);
});
test('a valid saved target stays visible when a different history map needs review',()=>{
 const targets={'rice|g':{name:'Rice',unit:'g',targetQty:800,pending:true}},h=fixture({version:1,byActor:{[ACTOR]:{targets,cooked:17}}}),before=h.bytes();
 assert.deepEqual(h.api.targets(),targets);assert.equal(h.bytes(),before);assert.throws(()=>h.api.prepare([rice]),/Review your saved At home records/);assert.equal(h.bytes(),before);
});
