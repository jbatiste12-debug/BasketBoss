import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const {install}=createRequire(import.meta.url)('../bb-home.js');
const receiptSource=await fs.readFile(new URL('../bb-receipt-host.js',import.meta.url),'utf8');
const ACTOR='11111111-1111-4111-8111-111111111111';
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory',HOME='basketboss_at_home_requirements_v1',SESSION='basketboss_cloud_session_v1',PLAN='basketboss_321_unified_state_v1',LUNCH='basketboss_321_lunch_v1';
const id=(name,unit)=>String(name).toLowerCase().trim()+'|'+unit;
const copy=value=>JSON.parse(JSON.stringify(value));
const food=(kind,recipeId,ingredients,extra={})=>({kind,recipeId,name:recipeId,day:'Monday',factor:1,occurrence:'week-one|'+kind+'|Monday|'+recipeId,ingredients,...extra});
const foods=()=>[
 food('dinner','rice-dinner',[{key:'rice',unit:'g',required:400}]),
 food('lunch','lunchbox:Monday',[{key:'bread',unit:'each',required:4},{key:'milk',unit:'ml',required:100}]),
 food('dessert','rice-pudding',[{key:'rice',unit:'g',required:100},{key:'milk',unit:'ml',required:200}])
];
function fixture({items=foods(),stock={'rice|g':1000,'bread|each':12,'milk|ml':1000},inventory={rice:{selected:true,name:'Rice',qty:1,unit:'kg',bb173StockKey:'rice|g',bb173StockValue:1000}}}={}){
 const values=new Map([[STOCK,JSON.stringify(stock)],[INVENTORY,JSON.stringify(inventory)],[SESSION,JSON.stringify({user:{id:ACTOR}})],[PLAN,JSON.stringify({plan:'week-one'})],[LUNCH,JSON.stringify({children:2})]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const state={items:copy(items),pending:false,weeklyReview:false,unsafe:false,deleting:false,refreshes:0,syncs:[],messages:[],syncResult:{ok:true}};
 const host={id,keys:()=>({stock:STOCK,inventory:INVENTORY}),completionKeys:()=>[LUNCH],stock:()=>JSON.parse(storage.getItem(STOCK)||'{}'),
  dayMeals:day=>state.items.filter(item=>item.day===day),recipeIngredients:(recipeId,factor)=>state.items.find(item=>item.recipeId===recipeId)?.ingredients.map(row=>({...row,required:row.required===null?null:row.required*factor})),
  occurrence:(recipeId,day,kind='dinner')=>state.items.find(item=>item.recipeId===recipeId&&item.day===day&&item.kind===kind)?.occurrence||null,
  refresh:()=>state.refreshes++,notify:message=>state.messages.push(message),household:()=>[],requirements:()=>[]};
 const receipt={hasPendingConfirmation:()=>state.pending,requiresPantryReview:()=>state.weeklyReview,canConsumePantry:()=>!state.unsafe,
  async confirmCookedPantry(packet){state.syncs.push(copy(packet));if(state.syncError)throw Error('Offline');if(state.syncWait)await state.syncWait;return state.syncResult;}};
 const win={localStorage:storage,document:{},location:{search:''},BBHomeHost:host,BBReceiptHost:receipt,BBAccountDeletion:{isDeleting:()=>state.deleting}};
 const home=install(win);win.BBHome=home;
 return {values,storage,state,host,win,home,stock:host.stock,data:()=>JSON.parse(storage.getItem(HOME)||'{}'),event:{day:'Monday',actorId:ACTOR},preview(){return home.previewDay(this.event);},async confirm(){const preview=this.preview();return home.finishDay({...this.event,expected:preview.fingerprint});}};
}

async function realReceipt(h,{reason='pantry_uninitialized'}={}){
 const scope={kind:'user',id:ACTOR},state={cached:{initialized:reason!=='pantry_uninitialized',scope,inventoryRevision:2,pantryReview:{required:true}},pending:{},syncs:[]};
 const root={localStorage:h.storage,Intl,Date,queueMicrotask,addEventListener(){}};
 vm.runInNewContext(receiptSource,root,{filename:'bb-receipt-host.js'});
 const inventory={configure(){},getCachedProjection:()=>state.cached,getPendingConfirmation:()=>state.pending,recoverLocalTransaction(){},
  async synchronize(){return reason==='pantry_merge'?{ok:false,localApplied:false,localError:'receipt_initial_pantry_merge_required'}:{ok:true,localApplied:true};},
  async confirmPantry(packet){state.syncs.push(packet);return {ok:true,localApplied:true};}};
 const receipt=root.BBReceiptHostFactory({storage:h.storage,inventory,getSession:()=>JSON.parse(h.storage.getItem(SESSION)),getContext:()=>({market:'UK',shopSessionId:'current-shop'}),getStock:h.stock,getEssentials:()=>[],setEssentials:()=>true,fetch:async()=>({ok:true,json:async()=>({ok:true,available:true,premium:true})})});
 receipt.configure();await receipt.refreshAvailability({force:true,synchronize:reason==='pantry_merge'});
 if(reason==='receipt_pending')state.pending={receiptId:'unresolved'};
 if(reason==='account_mismatch')state.cached={...state.cached,scope:{kind:'user',id:'another-account'}};
 if(reason==='storage_unreadable')h.storage.setItem('basketboss_receipt_projection_owner_v1','{broken');
 h.win.BBReceiptHost=receipt;h.host.schoolLunchWeekMeals=()=>h.state.items.filter(item=>item.kind==='lunch');
 return {receipt,state};
}

test('Day done preview is read-only and its confirmation deducts dinner, child lunches and dessert together once',async()=>{
 const h=fixture(),before=[...h.values],preview=h.preview();
 assert.equal(preview.ok,true);assert.equal(preview.already,false);assert.deepEqual(preview.items.map(item=>item.kind),['dinner','lunch','dessert']);
 assert.deepEqual(preview.rows.map(row=>[row.id,row.required]),[['rice|g',500],['bread|each',4],['milk|ml',300]]);
 assert.deepEqual([...h.values],before,'opening the daily review must never spend stock');
 const result=await h.home.finishDay({...h.event,expected:preview.fingerprint});
 assert.equal(result.ok,true);assert.equal(result.completedCount,3);assert.deepEqual(h.stock(),{'rice|g':500,'bread|each':8,'milk|ml':700});
 assert.equal(h.state.syncs.length,1);assert.equal(h.state.refreshes,1);assert.equal(h.state.messages.length,1);
 assert.equal(JSON.parse(h.storage.getItem(INVENTORY)).rice.qty,.5);
 for(const item of h.state.items)assert.equal(h.home.isCooked(item.occurrence),true);
 const records=Object.values(h.data().byActor[ACTOR].cooked);
 assert.equal(records.length,3);assert.equal(records.flatMap(record=>record.ingredients).filter(row=>row.key==='rice').reduce((sum,row)=>sum+row.quantity,0),500);
 const saved=[...h.values];assert.equal((await h.confirm()).already,true);assert.deepEqual([...h.values],saved);assert.equal(h.state.syncs.length,1);
});

test('individual Cook and Day done share dinner and dessert completion identities',async()=>{
 const h=fixture();
 for(const kind of ['dinner','dessert']){
  const item=h.state.items.find(row=>row.kind===kind);
  const result=await h.home.cooked({sessionId:'cook-'+kind,actorId:ACTOR,recipeId:item.recipeId,kind,day:item.day,factor:item.factor,occurrence:item.occurrence});
  assert.equal(result.ok,true);
 }
 const preview=h.preview();assert.deepEqual(preview.items.map(row=>row.already),[true,false,true]);
 const result=await h.home.finishDay({...h.event,expected:preview.fingerprint});
 assert.equal(result.completedCount,1);assert.deepEqual(h.stock(),{'rice|g':500,'bread|each':8,'milk|ml':700});
 const dessert=h.state.items.find(row=>row.kind==='dessert');
 assert.equal((await h.home.cooked({sessionId:'dessert-reopened',actorId:ACTOR,recipeId:dessert.recipeId,kind:'dessert',day:'Monday',factor:1,occurrence:dessert.occurrence})).already,true);
 assert.equal(h.state.syncs.length,3);
});

test('repeated overlapping Day done confirmations cannot spend the same occurrence twice',async()=>{
 const h=fixture();let release;h.state.syncWait=new Promise(resolve=>{release=resolve;});
 const preview=h.preview(),first=h.home.finishDay({...h.event,expected:preview.fingerprint});
 const duplicate=await h.home.finishDay({...h.event,expected:preview.fingerprint});
 assert.equal(duplicate.already,true);assert.equal(h.state.syncs.length,1);assert.deepEqual(h.stock(),{'rice|g':500,'bread|each':8,'milk|ml':700});
 release();assert.equal((await first).ok,true);assert.equal(h.state.messages.length,1);
});

test('changed plan, lunch count, quantities or actor require fresh daily review without a write',async()=>{
 for(const change of ['ingredients','lunch','stock','actor','plan']){
  const h=fixture(),preview=h.preview();
  if(change==='ingredients')h.state.items[0].ingredients[0].required=300;
  if(change==='lunch')h.storage.setItem(LUNCH,JSON.stringify({children:3}));
  if(change==='stock')h.storage.setItem(STOCK,JSON.stringify({'rice|g':700}));
  if(change==='actor')h.storage.setItem(SESSION,JSON.stringify({user:{id:'other-actor'}}));
  if(change==='plan')h.storage.setItem(PLAN,JSON.stringify({plan:'replaced'}));
  const before=[...h.values],result=await h.home.finishDay({...h.event,expected:preview.fingerprint});
  assert.equal(result.ok,false,change);assert.deepEqual([...h.values],before,change);assert.equal(h.state.syncs.length,0);
 }
});

test('normal weekly pantry review does not block known consumption, but unsafe or pending records do',async()=>{
 const h=fixture();h.state.weeklyReview=true;h.state.syncResult={ok:true,weeklyReviewRequired:true};
 assert.equal(h.preview().ok,true);
 const result=await h.confirm();assert.equal(result.ok,true);assert.equal(result.weeklyReviewRequired,true);assert.match(result.message,/before the next shop/);
 for(const flag of ['pending','unsafe','deleting']){
  const stopped=fixture();stopped.state[flag]=true;const before=[...stopped.values];
  assert.equal(stopped.preview().ok,false,flag);assert.equal((await stopped.confirm()).ok,false,flag);assert.deepEqual([...stopped.values],before);assert.equal(stopped.state.syncs.length,0);
 }
});

test('failed local atomic save rolls back stock, Kitchen, settlement and all completion identities',async()=>{
 const h=fixture(),purchase='synthetic_purchase_ticks';h.storage.setItem(purchase,JSON.stringify({rice:true}));
 h.host.settlePurchases=()=>({updates:{[purchase]:{rice:false}},expected:{[purchase]:JSON.stringify({rice:true})}});
 const put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key===purchase&&fail){fail=false;throw Error('quota');}return put(key,value);};
 const before=[...h.values];await assert.rejects(()=>h.confirm(),/quota/);
 assert.deepEqual([...h.values],before);assert.equal(h.state.refreshes,0);assert.equal(h.state.syncs.length,0);
 assert.equal((await h.confirm()).ok,true);assert.deepEqual(h.stock(),{'rice|g':500,'bread|each':8,'milk|ml':700});
});

test('offline sync retains the local daily deduction and retry is harmless',async()=>{
 const h=fixture();h.state.syncError=true;
 const result=await h.confirm();assert.equal(result.ok,true);assert.match(result.message,/on this device/);assert.equal(h.state.messages.length,1);
 const before=[...h.values];assert.equal((await h.confirm()).already,true);assert.deepEqual([...h.values],before);assert.equal(h.state.syncs.length,1);
});

test('stock stays nonnegative and incompatible or unknown quantities are flagged without guessing',async()=>{
 const h=fixture({stock:{'rice|g':100,'garlic|bulb':1,'salt|g':50},items:[food('dinner','main',[
  {key:'rice',unit:'g',required:300},{key:'garlic',unit:'clove',required:2},{key:'salt',unit:'g',required:null}
 ])]});
 const preview=h.preview();assert.equal(preview.issues.length,2);
 const result=await h.confirm();assert.equal(result.ok,true);assert.equal(result.issues.length,2);assert.deepEqual(h.stock(),{'garlic|bulb':1,'salt|g':50});
 const record=Object.values(h.data().byActor[ACTOR].cooked)[0];assert.deepEqual(record.ingredients,[{key:'rice',unit:'g',quantity:100}]);assert.equal(record.skipped.length,2);
});

test('linked batch leftovers require the original cook and do not deduct raw ingredients again',async()=>{
 const source=food('dinner','batch-rice',[{key:'rice',unit:'g',required:600}]),leftover=food('leftover','batch-leftovers',[],{day:'Wednesday',occurrence:'week-one|leftover|Wednesday|batch-rice',sourceOccurrence:source.occurrence});
 const h=fixture({items:[source,leftover]});
 assert.equal(h.home.previewDay({day:'Wednesday',actorId:ACTOR}).ok,false);
 assert.match(h.home.previewDay({day:'Wednesday',actorId:ACTOR}).message,/original batch/);
 assert.equal((await h.confirm()).ok,true);assert.equal(h.stock()['rice|g'],400);
 const event={day:'Wednesday',actorId:ACTOR},preview=h.home.previewDay(event);assert.equal(preview.ok,true);assert.deepEqual(preview.rows,[]);
 assert.equal((await h.home.finishDay({...event,expected:preview.fingerprint})).ok,true);assert.equal(h.stock()['rice|g'],400);
 assert.equal(h.home.isCooked(leftover.occurrence),true);
});

test('manual dinner notes show a stock-review issue without inventing ingredient quantities',async()=>{
 const h=fixture({items:[food('note','quick-dinner',[],{name:'Homemade soup',manualReview:true})]});
 const beforeStock=h.stock(),preview=h.preview();assert.equal(preview.ok,true);assert.equal(preview.issues.length,1);assert.match(preview.issues[0].message,/no measured ingredient list/);
 const result=await h.confirm();assert.equal(result.ok,true);assert.equal(result.completedCount,1);assert.deepEqual(h.stock(),beforeStock);
});

test('a fresh plan cycle keeps the pantry balance while the next day uses its new occurrence only',async()=>{
 const h=fixture();await h.confirm();assert.equal(h.stock()['rice|g'],500);
 h.state.items=[food('dinner','next-week-rice',[{key:'rice',unit:'g',required:300}],{occurrence:'week-two|dinner|Monday|next-week-rice'})];
 h.storage.setItem(PLAN,JSON.stringify({plan:'week-two'}));
 assert.equal(h.preview().already,false);assert.equal((await h.confirm()).ok,true);assert.equal(h.stock()['rice|g'],200);
 assert.equal(Math.max(0,300-h.stock()['rice|g']),100,'the next shopping balance is required food less the actual remaining stock');
});

test('a late sync result does not toast a different account after account switching',async()=>{
 const h=fixture();let release;h.state.syncWait=new Promise(resolve=>{release=resolve;});
 const promise=h.confirm();await Promise.resolve();h.storage.setItem(SESSION,JSON.stringify({user:{id:'other-user'}}));release();
 assert.equal((await promise).ok,true);assert.equal(h.state.messages.length,0);
});

for(const reason of ['pantry_uninitialized','pantry_merge','receipt_pending','account_mismatch','storage_unreadable'])test('real '+reason+' pantry gate keeps planned Day and lunch ingredients visible without reading stock',async()=>{
 const h=fixture(),{receipt,state}=await realReceipt(h,{reason});
 assert.equal(receipt.getConsumptionStatus().reason,reason);
 const expectedStatus=JSON.parse(JSON.stringify(receipt.getConsumptionStatus())),before=[...h.values],reads=[];
 for(const name of ['stock','keys','conversionContext'])h.host[name]=()=>{reads.push(name);throw Error('Pantry data must stay private while blocked');};
 const day=h.preview();assert.equal(day.ok,false);assert.equal(day.needsReview,true);assert.equal(day.reviewAction,'pantry');assert.deepEqual(day.pantryStatus,expectedStatus);
 assert.deepEqual(day.items.map(item=>item.name),['rice-dinner','lunchbox:Monday','rice-pudding']);
 assert.deepEqual(day.rows.map(row=>[row.id,row.required]),[['rice|g',500],['bread|each',4],['milk|ml',300]]);
 assert.ok(day.rows.every(row=>row.planned===true&&!('owned'in row)&&!('deduct'in row)&&!('remaining'in row)));
 const week=h.home.previewLunchWeek({actorId:ACTOR});assert.equal(week.ok,false);assert.equal(week.reviewAction,'pantry');assert.deepEqual(week.pantryStatus,expectedStatus);
 assert.deepEqual(week.items,[{kind:'lunch',name:'lunchbox:Monday',day:'Monday',already:false}]);
 assert.deepEqual(week.rows.map(row=>[row.id,row.required]),[['bread|each',4],['milk|ml',100]]);
 assert.equal((await h.home.finishDay({...h.event,expected:'blocked'})).ok,false);
 assert.equal((await h.home.finishLunchWeek({actorId:ACTOR,expected:'blocked'})).ok,false);
 assert.deepEqual([...h.values],before);assert.deepEqual(reads,[]);assert.equal(state.syncs.length,0);
});

for(const change of ['actor','contexts','ingredient','home','generic-pantry-error'])test('invalid '+change+' keeps completion failure data guarded',async()=>{
 const h=fixture();await realReceipt(h);
 if(change==='actor')h.storage.setItem(SESSION,JSON.stringify({user:{id:'another-account'}}));
 if(change==='contexts')h.state.items[1].occurrence=h.state.items[0].occurrence;
 if(change==='ingredient')h.state.items[0].ingredients[0].required=-1;
 if(change==='home')h.storage.setItem(HOME,'{broken');
 if(change==='generic-pantry-error'){
  h.win.BBReceiptHost={hasPendingConfirmation:()=>false,canConsumePantry:()=>true};
  // The same human message is not evidence of a typed pantry block.
  h.host.stock=()=>{throw Error('Review At home before updating these ingredients.');};
 }
 const before=[...h.values],preview=h.preview();assert.equal(preview.ok,false);assert.deepEqual(preview.items,[]);assert.deepEqual(preview.rows,[]);assert.equal(preview.reviewAction,undefined);assert.equal(preview.pantryStatus,undefined);
 assert.equal((await h.home.finishDay({...h.event,expected:'invalid'})).ok,false);assert.deepEqual([...h.values],before);
});

test('blocked ingredient rows aggregate planned units without applying pantry conversions or implying empty stock',async()=>{
 const h=fixture({items:[food('lunch','lunchbox:Monday',[{key:'rice',unit:'kg',required:.25},{key:'rice',unit:'g',required:100},{key:'salt',unit:'tsp',required:null}])]}),{receipt}=await realReceipt(h);
 assert.equal(receipt.canConsumePantry(),false);
 const preview=h.preview();assert.equal(preview.ok,false);assert.deepEqual(preview.rows.map(row=>[row.name,row.unit,row.required]),[['rice','g',350],['salt','tsp',null]]);
 assert.ok(preview.rows.every(row=>!('owned'in row)&&!('canDeduct'in row)));
});
