import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {install}=createRequire(import.meta.url)('../bb-home.js');
const ACTOR='11111111-1111-4111-8111-111111111111';
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory',HOME='basketboss_at_home_requirements_v1',SESSION='basketboss_cloud_session_v1',PLAN='basketboss_321_unified_state_v1',LUNCH='basketboss_321_lunch_v1';
const OWNER='basketboss_receipt_projection_owner_v1';
const id=(name,unit)=>String(name).toLowerCase().trim()+'|'+unit;
const copy=value=>JSON.parse(JSON.stringify(value));
const food=(kind,recipeId,ingredients,{day='Monday',...extra}={})=>({kind,recipeId,name:recipeId,day,factor:1,occurrence:'week-one|'+kind+'|'+day+'|'+recipeId,ingredients,...extra});
const foods=()=>[
 food('dinner','rice-dinner',[{key:'rice',unit:'g',required:400}]),
 food('breakfast','milk-breakfast',[{key:'milk',unit:'ml',required:100}]),
 food('lunch','lunchbox:Monday',[{key:'bread',unit:'each',required:4},{key:'milk',unit:'ml',required:100}],{factor:2}),
 food('lunch','lunchbox:Tuesday',[{key:'bread',unit:'each',required:6},{key:'milk',unit:'ml',required:150}],{day:'Tuesday',factor:3}),
 food('dessert','rice-pudding',[{key:'rice',unit:'g',required:100},{key:'milk',unit:'ml',required:200}])
];
function fixture({items=foods(),stock={'rice|g':1000,'bread|each':20,'milk|ml':1000},inventory={rice:{selected:true,name:'Rice',qty:1,unit:'kg',bb173StockKey:'rice|g',bb173StockValue:1000}}}={}){
 const values=new Map([[STOCK,JSON.stringify(stock)],[INVENTORY,JSON.stringify(inventory)],[SESSION,JSON.stringify({user:{id:ACTOR}})],[PLAN,JSON.stringify({plan:'week-one'})],[LUNCH,JSON.stringify({children:2})]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const state={items:copy(items),pending:false,weeklyReview:false,unsafe:false,deleting:false,refreshes:0,syncs:[],messages:[],syncResult:{ok:true}};
 const host={id,keys:()=>({stock:STOCK,inventory:INVENTORY}),completionKeys:()=>[LUNCH],stock:()=>JSON.parse(storage.getItem(STOCK)||'{}'),
  dayMeals:day=>state.items.filter(item=>item.day===day),schoolLunchWeekMeals:()=>state.weekContexts??state.items.filter(item=>item.kind==='lunch'),
  recipeIngredients:(recipeId,factor)=>{const item=state.items.find(item=>item.recipeId===recipeId);return item?.ingredients.map(row=>({...row,required:row.required===null?null:row.required*factor/item.factor}));},
  occurrence:(recipeId,day,kind='dinner')=>state.items.find(item=>item.recipeId===recipeId&&item.day===day&&item.kind===kind)?.occurrence||null,
  refresh:()=>{state.refreshes++;state.onRefresh?.();},notify:message=>state.messages.push(message),household:()=>[],requirements:()=>[]};
 const receipt={hasPendingConfirmation:()=>state.pending,requiresPantryReview:()=>state.weeklyReview,canConsumePantry:()=>!state.unsafe,
  async confirmCookedPantry(packet){state.syncs.push(copy(packet));if(state.syncError)throw Error('Offline');if(state.syncWait)await state.syncWait;return state.syncResult;}};
 const win={localStorage:storage,document:{},location:{search:''},BBHomeHost:host,BBReceiptHost:receipt,BBAccountDeletion:{isDeleting:()=>state.deleting}};
 const home=install(win);win.BBHome=home;
 const weekEvent={actorId:ACTOR},event={day:'Monday',actorId:ACTOR};
 const preview=()=>home.previewLunchWeek(weekEvent),confirm=async()=>{const review=preview();return home.finishLunchWeek({...weekEvent,expected:review.fingerprint});};
 return {values,storage,state,host,win,home,weekEvent,event,preview,confirm,stock:host.stock,data:()=>JSON.parse(storage.getItem(HOME)||'{}').byActor?.[ACTOR],
  async confirmDay(day='Monday'){const event={day,actorId:ACTOR},review=home.previewDay(event);assert.equal(review.ok,true,review.message);return home.finishDay({...event,expected:review.fingerprint});},
  async cook(recipeId){const item=state.items.find(item=>item.recipeId===recipeId),event={sessionId:'cook-'+recipeId,actorId:ACTOR,recipeId:item.recipeId,kind:item.kind,day:item.day,factor:item.factor,occurrence:item.occurrence},review=home.previewCook(event);assert.equal(review.ok,true,review.message);return home.cooked({...event,expected:review.fingerprint});}};
}

test('school lunch week reviews shared ingredients with planned portions and commits only lunches once',async()=>{
 const h=fixture(),before=[...h.values],preview=h.preview();
 assert.equal(preview.ok,true,preview.message);assert.equal(preview.already,false);
 assert.deepEqual(preview.items.map(item=>item.kind),['lunch','lunch']);
 assert.deepEqual(preview.items.map(item=>item.name),['lunchbox:Monday','lunchbox:Tuesday']);
 assert.deepEqual(preview.rows.map(row=>[row.id,row.required]),[['bread|each',10],['milk|ml',250]]);
 assert.deepEqual([...h.values],before,'opening the ingredient review must never deduct food');
 const result=await h.home.finishLunchWeek({...h.weekEvent,expected:preview.fingerprint});
 assert.equal(result.ok,true);assert.equal(result.completedCount,2);
 assert.deepEqual(h.stock(),{'rice|g':1000,'bread|each':10,'milk|ml':750});
 assert.equal(h.state.syncs.length,1);assert.equal(h.state.refreshes,1);assert.equal(h.state.messages.length,1);
 const records=h.data().cooked,lunches=h.state.items.filter(item=>item.kind==='lunch');
 assert.deepEqual(Object.keys(records).sort(),lunches.map(item=>'day:'+item.occurrence).sort());
 for(const item of h.state.items)assert.equal(h.home.isCooked(item.occurrence),item.kind==='lunch');
 assert.deepEqual(lunches.map(item=>records['day:'+item.occurrence].factor),[2,3]);
 assert.deepEqual(lunches.map(item=>records['day:'+item.occurrence].ingredients.find(row=>row.key==='bread').quantity),[4,6]);
 assert.equal(h.data().dayActions,undefined,'the week does not invent a Day done undo journal');
 const saved=[...h.values],again=h.preview();assert.equal(again.already,true);assert.deepEqual(again.items.map(item=>item.already),[true,true]);
 assert.equal((await h.confirm()).already,true);assert.deepEqual([...h.values],saved);assert.equal(h.state.syncs.length,1);
});

test('individual lunch, school lunch week and Day done share the same occurrence protections',async()=>{
 const h=fixture();assert.equal((await h.cook('lunchbox:Monday')).ok,true);
 const individual=copy(h.data().cooked['cook-lunchbox:Monday']),review=h.preview();
 assert.deepEqual(review.items.map(item=>item.already),[true,false]);
 assert.deepEqual(review.rows.map(row=>[row.id,row.required]),[['bread|each',6],['milk|ml',150]]);
 assert.equal((await h.home.finishLunchWeek({...h.weekEvent,expected:review.fingerprint})).completedCount,1);
 assert.deepEqual(h.stock(),{'rice|g':1000,'bread|each':10,'milk|ml':750});
 const dayReview=h.home.previewDay(h.event);assert.equal(dayReview.items.find(item=>item.kind==='lunch').already,true);
 assert.equal((await h.confirmDay()).completedCount,3);assert.deepEqual(h.stock(),{'rice|g':500,'bread|each':10,'milk|ml':450});
 assert.equal((await h.confirmDay('Tuesday')).already,true);assert.equal((await h.confirm()).already,true);
 assert.deepEqual(h.data().cooked['cook-lunchbox:Monday'],individual);assert.equal(h.data().cooked['day:'+h.state.items.find(item=>item.recipeId==='lunchbox:Monday').occurrence],undefined);
 assert.equal(h.state.syncs.length,3);
});

test('rapid overlapping school lunch confirmations deduct and synchronize exactly once',async()=>{
 const h=fixture();let release;h.state.syncWait=new Promise(resolve=>{release=resolve;});
 const preview=h.preview(),first=h.home.finishLunchWeek({...h.weekEvent,expected:preview.fingerprint});
 const second=await h.home.finishLunchWeek({...h.weekEvent,expected:preview.fingerprint});
 assert.equal(second.ok,true);assert.equal(second.already,true);assert.equal(h.state.syncs.length,1);
 assert.deepEqual(h.stock(),{'rice|g':1000,'bread|each':10,'milk|ml':750});
 release();assert.equal((await first).ok,true);assert.equal(h.state.messages.length,1);
});

for(const change of ['ingredients','portions','lunch','stock','inventory','actor','session','plan','occurrence'])test('changed '+change+' invalidates the reviewed school lunch week without a write',async()=>{
 const h=fixture(),preview=h.preview();
 if(change==='ingredients')h.state.items.find(item=>item.kind==='lunch').ingredients[0].required=8;
 if(change==='portions')h.state.items.find(item=>item.kind==='lunch').factor=4;
 if(change==='lunch')h.storage.setItem(LUNCH,JSON.stringify({children:3}));
 if(change==='stock')h.storage.setItem(STOCK,JSON.stringify({'bread|each':30}));
 if(change==='inventory')h.storage.setItem(INVENTORY,JSON.stringify({other:{name:'Rice',qty:2,unit:'kg'}}));
 if(change==='actor')h.storage.setItem(SESSION,JSON.stringify({user:{id:'other-actor'}}));
 if(change==='session')h.storage.setItem(SESSION,JSON.stringify({user:{id:ACTOR},access_token:'different-session'}));
 if(change==='plan')h.storage.setItem(PLAN,JSON.stringify({plan:'replaced'}));
 if(change==='occurrence')h.state.items.find(item=>item.kind==='lunch').occurrence='week-two|lunch|Monday|replacement';
 const before=[...h.values],result=await h.home.finishLunchWeek({...h.weekEvent,expected:preview.fingerprint});
 assert.equal(result.ok,false,change);assert.deepEqual([...h.values],before);assert.equal(h.state.syncs.length,0);assert.equal(h.state.refreshes,0);
});

test('local atomic failure rolls back lunch stock, Kitchen, settlement and every completion receipt',async()=>{
 const h=fixture(),purchase='synthetic_lunch_purchase_ticks';h.storage.setItem(purchase,JSON.stringify({bread:true}));
 h.host.settlePurchases=()=>({updates:{[purchase]:{bread:false}},expected:{[purchase]:JSON.stringify({bread:true})}});
 const put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key===purchase&&fail){fail=false;throw Error('quota');}return put(key,value);};
 const before=[...h.values];await assert.rejects(()=>h.confirm(),/quota/);
 assert.deepEqual([...h.values],before);assert.equal(h.state.refreshes,0);assert.equal(h.state.syncs.length,0);
 assert.equal((await h.confirm()).ok,true);assert.deepEqual(h.stock(),{'rice|g':1000,'bread|each':10,'milk|ml':750});
});

test('Day undo preserves previously confirmed weekly lunches as individual confirmations',async()=>{
 const h=fixture();assert.equal((await h.confirm()).ok,true);
 const weekly=copy(h.data().cooked),stockAfterLunches=h.stock();
 assert.equal(h.home.previewUndoDay(h.event).ok,false,'a weekly lunch has no unsupported Day undo');
 assert.equal((await h.confirmDay()).completedCount,3);
 const preview=h.home.previewUndoDay(h.event);assert.equal(preview.ok,true,preview.message);
 assert.deepEqual(preview.items.map(item=>item.kind),['dinner','breakfast','dessert']);
 const result=await h.home.undoDay({...h.event,expected:preview.fingerprint});
 assert.equal(result.ok,true,result.message);assert.equal(result.restoredCount,3);assert.equal(result.remainingConfirmedCount,1);
 assert.deepEqual(h.stock(),stockAfterLunches);assert.deepEqual(h.data().cooked,weekly);
 for(const item of h.state.items)assert.equal(h.home.isCooked(item.occurrence),item.kind==='lunch');
 assert.equal((await h.confirm()).already,true);
});

for(const invalid of ['dinner','breakfast','dessert','duplicate','day','factor','quantity'])test('invalid '+invalid+' weekly context is rejected without partial confirmation',async()=>{
 const h=fixture(),lunches=h.state.items.filter(item=>item.kind==='lunch');
 h.state.weekContexts=copy(lunches);
 if(['dinner','breakfast','dessert'].includes(invalid))h.state.weekContexts.push(copy(h.state.items.find(item=>item.kind===invalid)));
 if(invalid==='duplicate')h.state.weekContexts.push(copy(lunches[0]));
 if(invalid==='day')h.state.weekContexts[0].day='Notaday';
 if(invalid==='factor')h.state.weekContexts[0].factor=0;
 if(invalid==='quantity')h.state.weekContexts[0].ingredients[0].required=-1;
 const before=[...h.values],preview=h.preview();assert.equal(preview.ok,false,invalid);
 assert.equal((await h.home.finishLunchWeek({...h.weekEvent,expected:'invalid'})).ok,false);
 assert.deepEqual([...h.values],before);assert.equal(h.state.syncs.length,0);
});

test('shared ingredient receipts consume only the aggregate available stock when lunches exceed the pantry',async()=>{
 const h=fixture({stock:{'bread|each':7,'milk|ml':100}}),preview=h.preview();
 assert.equal(preview.ok,true,preview.message);
 assert.deepEqual(preview.rows.map(row=>[row.id,row.required,row.deduct]),[['bread|each',10,7],['milk|ml',250,100]]);
 assert.equal((await h.home.finishLunchWeek({...h.weekEvent,expected:preview.fingerprint})).ok,true);
 assert.deepEqual(h.stock(),{});
 const records=Object.values(h.data().cooked),used=name=>records.flatMap(record=>record.ingredients).filter(row=>row.key===name).reduce((sum,row)=>sum+row.quantity,0);
 assert.equal(used('bread'),7);assert.equal(used('milk'),100);
 assert.deepEqual(records.map(record=>record.ingredients.find(row=>row.key==='bread')?.quantity||0),[4,3]);
 assert.deepEqual(records.map(record=>record.ingredients.find(row=>row.key==='milk')?.quantity||0),[100,0]);
});

test('routine pantry review allows known lunch consumption while pending, unsafe and deleting contexts block it',async()=>{
 const h=fixture();h.state.weeklyReview=true;h.state.syncResult={ok:true,weeklyReviewRequired:true};
 assert.equal(h.preview().ok,true);const result=await h.confirm();assert.equal(result.ok,true);assert.equal(result.weeklyReviewRequired,true);
 for(const flag of ['pending','unsafe','deleting']){
  const blocked=fixture();blocked.state[flag]=true;const before=[...blocked.values];
  assert.equal(blocked.preview().ok,false,flag);assert.equal((await blocked.confirm()).ok,false,flag);
  assert.deepEqual([...blocked.values],before);assert.equal(blocked.state.syncs.length,0);
 }
});

test('offline weekly acknowledgement keeps the local lunch deduction and retry is harmless',async()=>{
 const h=fixture();h.state.syncError=true;const result=await h.confirm();assert.equal(result.ok,true);assert.match(result.message,/on this device/);
 const before=[...h.values];assert.equal((await h.confirm()).already,true);assert.deepEqual([...h.values],before);assert.equal(h.state.syncs.length,1);
});

for(const change of ['actor','session','deletion','owner','stock'])test('changed '+change+' during lunch refresh cannot synchronize the original pantry into a new context',async()=>{
 const h=fixture();h.state.onRefresh=()=>{
  if(change==='actor')h.storage.setItem(SESSION,JSON.stringify({user:{id:'other-actor'}}));
  if(change==='session')h.storage.setItem(SESSION,JSON.stringify({user:{id:ACTOR},access_token:'new-session'}));
  if(change==='deletion')h.state.deleting=true;
  if(change==='owner')h.storage.setItem(OWNER,JSON.stringify({actorId:ACTOR,inventoryRevision:3}));
  if(change==='stock')h.storage.setItem(STOCK,JSON.stringify({'rice|g':1000,'bread|each':11,'milk|ml':750}));
 };
 const result=await h.confirm();assert.equal(result.ok,true);assert.equal(result.localOnly,true);
 assert.deepEqual(h.stock(),{'rice|g':1000,'bread|each':change==='stock'?11:10,'milk|ml':750});
 assert.equal(h.state.syncs.length,0);if(['actor','session','deletion'].includes(change))assert.deepEqual(h.state.messages,[]);
});

for(const change of ['actor','session','deletion'])test('late lunch acknowledgement cannot notify a changed '+change+' context',async()=>{
 const h=fixture();let release;h.state.syncWait=new Promise(resolve=>{release=resolve;});
 const promise=h.confirm();await Promise.resolve();
 if(change==='actor')h.storage.setItem(SESSION,JSON.stringify({user:{id:'other-actor'}}));
 if(change==='session')h.storage.setItem(SESSION,JSON.stringify({user:{id:ACTOR},access_token:'new-session'}));
 if(change==='deletion')h.state.deleting=true;
 release();assert.equal((await promise).ok,true);assert.deepEqual(h.state.messages,[]);
});

for(const order of ['week-first','day-first'])test('overlapping '+order+' confirmation spends their shared lunch occurrence only once',async()=>{
 const h=fixture();let release;h.state.syncWait=new Promise(resolve=>{release=resolve;});
 let week,day;
 if(order==='week-first'){week=h.confirm();day=h.confirmDay();}
 else{day=h.confirmDay();week=h.confirm();}
 assert.equal(h.state.syncs.length,2);assert.deepEqual(h.stock(),{'rice|g':500,'bread|each':10,'milk|ml':450});
 release();const [weekResult,dayResult]=await Promise.all([week,day]);
 assert.equal(weekResult.ok,true);assert.equal(dayResult.ok,true);
 assert.equal(weekResult.completedCount,order==='week-first'?2:1);assert.equal(dayResult.completedCount,order==='week-first'?3:4);
 const before=[...h.values];assert.equal((await h.confirm()).already,true);assert.equal((await h.confirmDay()).already,true);
 assert.deepEqual([...h.values],before);assert.equal(h.state.syncs.length,2);
});
