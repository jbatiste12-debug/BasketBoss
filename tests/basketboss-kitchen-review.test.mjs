import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),review=require('../bb-kitchen-review.js'),homeModule=require('../bb-home.js'),policy=require('../bb-pantry-policy.js');
const FEATURES='basketboss_321_features_v1',SESSION='basketboss_cloud_session_v1',HOME='basketboss_at_home_requirements_v1';
require('../bb-weekly-essentials.js');
function fixture(){
 const item={id:'soap',name:'Soap',unit:'each',qty:4,targetQty:4,ownedQty:4,manualPending:false,selected:false,owned:true,packQuantity:1,packUnit:'each',packReviewed:true};
 const values=new Map([[FEATURES,JSON.stringify({version:1,essentials:[item]})],[SESSION,JSON.stringify({user:{id:'alice'}})],['stock',JSON.stringify({'rice|g':500})],['inventory','{}'],['ledger',JSON.stringify({generation:0})]]);
 let features=JSON.parse(values.get(FEATURES)),pending=false,draft=false,foodCurrent=true,failFlush=false,failRefresh=false,settlements=0;
 const calls=[],rows=new Map([['cupboard|rice',{key:'cupboard|rice',name:'Rice',loc:'cupboard',qty:500,unit:'g'}],['cupboard|honey',{key:'cupboard|honey',name:'Honey',loc:'cupboard',qty:1,unit:'each',staple:true,stapleStatus:'in'}]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const id=(name,unit)=>name.toLowerCase()+'|'+unit;
 const host={id,keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>JSON.parse(values.get('stock')),household:()=>features.essentials,
  requirements:()=>[{key:'Rice',required:300,toBuy:Math.max(0,300-Number(JSON.parse(values.get('stock'))['rice|g']||0)),unit:'g'}],
  householdAmountContext:()=>({actor:home.actor(),session:storage.getItem(SESSION),features:storage.getItem(FEATURES)}),
  prepareHousehold:entries=>{const next=JSON.parse(JSON.stringify(features));for(const [key,patch]of entries){const row=next.essentials.find(item=>item.id===key);if(!row)throw Error('Household list changed');Object.assign(row,patch,{manualPending:true,selected:true});if((row.targetQty??row.qty)>row.ownedQty)row.owned=false;}return {key:FEATURES,value:next,expected:storage.getItem(FEATURES)};},
  reload:()=>{features=JSON.parse(storage.getItem(FEATURES));},refresh:()=>{calls.push({type:'refresh'});if(failRefresh)throw Error('repaint');},shoppingKind:name=>name.toLowerCase()==='soap'?'household':'food',shoppingPurchaseContext:()=>({shopSessionId:'trip-one',quantity:0}),
  settlePurchases:ids=>{settlements++;const prior=storage.getItem('ledger'),generation=JSON.parse(prior).generation+1;return {updates:{ledger:{generation}},expected:{ledger:prior},history:{[ids[0]]:generation},generations:{[ids[0]]:generation},superseded:{[ids[0]]:true}};}
 };
 const win={localStorage:storage,document:{},location:{search:''},BBPantryPolicy:policy,BBHomeHost:host,BBReceiptHost:{hasPendingConfirmation:()=>pending,canConsumePantry:()=>!pending}};
 const home=homeModule.install(win);win.BBHome=home;
 win.BBPantryEditor={isCurrent:()=>foodCurrent,list:()=>[...rows.values()].map(row=>({...row})),read:key=>({...rows.get(key)}),status:()=>failFlush?'Could not save safely.':'Pantry saved. Shopping updated.',update:(key,patch)=>{calls.push({type:'food',key,patch});const row=rows.get(key);if(!row)return {ok:false};Object.assign(row,patch);if(row.staple&&patch.stapleStatus==='out')row.qty=0;draft=true;return {ok:true};},flush:async()=>{if(failFlush)return;const stock=JSON.parse(storage.getItem('stock'));for(const row of rows.values())stock[id(row.name,row.unit)]=Number(row.qty)||0;storage.setItem('stock',JSON.stringify(stock));draft=false;}};
 win.BBPantryLive={hasPending:()=>draft};const api=review.createController(win);
 return {api,win,home,host,values,storage,calls,rows,item,food:()=>api.snapshot().rows.find(row=>row.key==='cupboard|rice'),household:()=>api.snapshot().rows.find(row=>row.kind==='household'),read:key=>JSON.parse(storage.getItem(key)||'null'),setPending:value=>pending=value,setFoodCurrent:value=>foodCurrent=value,setFailFlush:value=>failFlush=value,setFailRefresh:value=>failRefresh=value,settlements:()=>settlements};
}
test('weekly review includes sufficient essentials and reads pantry amounts without writing',()=>{
 const h=fixture(),before=[...h.values],snapshot=h.api.snapshot();
 assert.equal(snapshot.rows.length,3);assert.equal(snapshot.rows.find(row=>row.kind==='household').qty,4);assert.deepEqual([...h.values],before);assert.equal(h.calls.length,0);
});
test('remaining food replaces the absolute balance once and updates automatic meal shortfall',async()=>{
 const h=fixture();assert.equal(h.api.shopping(h.food()).onList,false);
 assert.equal((await h.api.remaining(h.food(),'50')).ok,true);assert.equal(h.read('stock')['rice|g'],50);assert.equal(h.api.shopping(h.food()).automatic[0].quantity,250);
 assert.deepEqual(h.calls.find(call=>call.type==='food').patch,{qty:50});
 const row=h.food();assert.equal((await h.api.remaining(row,'0')).ok,true);assert.equal(h.read('stock')['rice|g'],0);assert.equal(h.api.shopping(h.food()).automatic[0].quantity,300);
});
test('unknown and invalid remaining amounts never turn into zero or change units',async()=>{
 const h=fixture(),before=h.values.get('stock');
 for(const raw of['','unknown','-1','1000001'])assert.equal((await h.api.remaining(h.food(),raw)).ok,false);
 assert.equal(h.values.get('stock'),before);assert.equal(h.calls.filter(call=>call.type==='food').length,0);
 h.rows.get('cupboard|rice').qty=null;assert.equal((await h.api.remaining(h.food(),'')).ok,false);assert.equal(h.rows.get('cupboard|rice').qty,null);
});
test('uneditable legacy ledger units remain visible and protected for review',async()=>{
 const h=fixture();h.storage.setItem('stock',JSON.stringify({'rice|g':500,'Mystery flour|scoop':3}));
 const row=h.api.snapshot().rows.find(row=>row.name==='Mystery flour');assert.ok(row);assert.equal(row.qty,3);assert.equal(row.unit,'scoop');assert.equal(row.readOnly,true);assert.equal(h.api.snapshot().stockIssue,true);
 const before=[...h.values];assert.equal((await h.api.remaining(row,'0')).ok,false);assert.deepEqual([...h.values],before);
});
test('a failed guarded pantry flush keeps a visible failure instead of reporting stock saved',async()=>{
 const h=fixture(),before=h.values.get('stock');h.setFailFlush(true);
 const result=await h.api.remaining(h.food(),'50');assert.equal(result.ok,false);assert.match(result.message,/Could not save/);assert.equal(h.values.get('stock'),before);
});
test('staples use status and container-count updates through the existing editor',async()=>{
 const h=fixture(),row=h.api.snapshot().rows.find(row=>row.staple);
 assert.equal((await h.api.remaining(row,'','low')).ok,true);assert.equal(h.rows.get(row.key).stapleStatus,'low');assert.equal(h.rows.get(row.key).qty,1);
 assert.equal((await h.api.remaining(h.api.snapshot().rows.find(row=>row.staple),'0','out')).ok,true);assert.equal(h.rows.get(row.key).qty,0);assert.equal(h.rows.get(row.key).unit,'each');
});
test('household consumption preserves its target and pack metadata, with receipt settlement',async()=>{
 const h=fixture(),before=h.household();const result=await h.api.remaining(before,'1');assert.equal(result.ok,true);
 const item=h.read(FEATURES).essentials[0];assert.equal(item.ownedQty,1);assert.equal(item.targetQty,4);assert.equal(item.unit,'each');assert.equal(item.packQuantity,1);assert.equal(item.packReviewed,true);assert.equal(h.settlements(),1);assert.equal(h.api.shopping(h.household()).automatic[0].quantity,3);
 assert.equal(h.home.receiptGeneration('ess:soap'),1);assert.equal(h.home.supersedesReceipt('ess:soap'),true);
});
test('default Restock preserves an existing automatic Shop quantity and never credits stock',async()=>{
 const h=fixture();await h.api.remaining(h.food(),'50');const stock=h.values.get('stock'),calls=h.calls.length;
 const result=await h.api.restock(h.food(),'250 g');assert.equal(result.ok,true);assert.equal(result.already,true);assert.equal(h.home.shoppingBuys().length,0);assert.equal(h.values.get('stock'),stock);assert.equal(h.calls.length,calls);
});
test('intentional extra restock uses the existing manual-buy replacement and idempotency contract',async()=>{
 const h=fixture(),stock=h.values.get('stock');assert.equal((await h.api.restock(h.food(),'200 g')).ok,true);assert.equal(h.home.shoppingBuys()[0].quantity,200);
 assert.equal((await h.api.restock(h.food(),'200 g',{extra:true})).already,true,'same request is not sent twice');
 assert.equal((await h.api.restock(h.food(),'300 g',{extra:true})).ok,true);assert.equal(h.home.shoppingBuys().length,1);assert.equal(h.home.shoppingBuys()[0].quantity,300,'editing extra replaces it rather than adding another 300g');assert.equal(h.values.get('stock'),stock);
});
test('a different account never reuses the previous user’s shopping request',async()=>{
 const h=fixture();assert.equal((await h.api.restock(h.food(),'100 g')).ok,true);
 h.storage.setItem(SESSION,JSON.stringify({user:{id:'bob'}}));const result=await h.api.restock(h.food(),'100 g');assert.equal(result.ok,true);assert.notEqual(result.already,true);assert.equal(h.home.shoppingBuys()[0].quantity,100);
 const data=h.read(HOME);assert.equal(Object.keys(data.byActor.alice.manualRequests).length,1);assert.equal(Object.keys(data.byActor.bob.manualRequests).length,1);
});
test('a new weekly check can request the same amount after the earlier top-up was fulfilled',async()=>{
 const h=fixture();assert.equal((await h.api.restock(h.food(),'100 g')).ok,true);const data=h.read(HOME);for(const row of Object.values(data.byActor.alice.manualBuys)){row.pending=false;row.quantity=0;}h.storage.setItem(HOME,JSON.stringify(data));
 assert.equal(h.api.beginReview(),true);const result=await h.api.restock(h.food(),'100 g');assert.equal(result.ok,true);assert.notEqual(result.already,true);assert.equal(h.home.shoppingBuys()[0].quantity,100);assert.equal(Object.keys(h.read(HOME).byActor.alice.manualRequests).length,2);
});
test('a fulfilled top-up gets a new request even when the controller stays open',async()=>{
 const h=fixture();await h.api.restock(h.food(),'200 g');const data=h.read(HOME);
 assert.equal(h.home.applyManualPurchases(data,{shopSessionId:'trip-one',additions:[{id:'rice|g',quantity:200,automaticQuantity:0}]}),true);h.storage.setItem(HOME,JSON.stringify(data));assert.equal(h.home.shoppingBuys().length,0);
 const result=await h.api.restock(h.food(),'200 g');assert.equal(result.ok,true);assert.notEqual(result.already,true);assert.equal(h.home.shoppingBuys()[0].quantity,200);assert.equal(Object.keys(h.read(HOME).byActor.alice.manualRequests).length,2);
});
test('an external manual edit invalidates the cached idempotency request before setting extra again',async()=>{
 const h=fixture();await h.api.restock(h.food(),'200 g');assert.equal(h.home.addShoppingBuy({name:'Rice',quantityText:'300 g',actorId:'alice',requestId:'external-extra'}).ok,true);assert.equal(h.home.shoppingBuys()[0].quantity,300);
 const result=await h.api.restock(h.food(),'200 g',{extra:true});assert.equal(result.ok,true);assert.notEqual(result.already,true);assert.equal(h.home.shoppingBuys()[0].quantity,200);
});
test('a viewed count quantity is delegated with its unit for the existing pantry converter',async()=>{
 const h=fixture();h.rows.set('fridge|carrot',{key:'fridge|carrot',name:'Carrots',loc:'fridge',qty:160,unit:'g'});const row=h.api.snapshot().rows.find(row=>row.name==='Carrots');
 assert.equal((await h.api.remaining(row,'1',undefined,'each')).ok,true);assert.deepEqual(h.calls.find(call=>call.key==='fridge|carrot').patch,{qty:1,unit:'each'});
});
test('a household target already on Shop is not duplicated by Restock',async()=>{
 const h=fixture();await h.api.remaining(h.household(),'1');const stock=h.values.get('stock');
 assert.equal((await h.api.restock(h.household(),'3 each')).already,true);assert.equal(h.home.shoppingBuys().length,0);
 assert.equal((await h.api.restock(h.household(),'1 each',{extra:true})).ok,true);assert.equal(h.home.shoppingBuys()[0].kind,'household');assert.equal(h.read(FEATURES).essentials[0].ownedQty,1);assert.equal(h.values.get('stock'),stock);
});
test('stale item, changed account and pending receipt prevent both balance and buying writes',async()=>{
 for(const mode of['stale','account','receipt']){
  const h=fixture(),food=h.food();if(mode==='stale')h.rows.get(food.key).qty=450;else if(mode==='account')h.storage.setItem(SESSION,JSON.stringify({user:{id:'bob'}}));else h.setPending(true);
  const before=[...h.values];assert.equal((await h.api.remaining(food,'10')).ok,false);assert.equal((await h.api.restock(food,'1 kg',{extra:true})).ok,false);assert.deepEqual([...h.values],before,mode);
 }
});
test('stale household context and failed persistence leave targets and balances untouched',()=>{
 const h=fixture(),pin=h.host.householdAmountContext(),before=[...h.values];
 assert.throws(()=>h.home.setHouseholdBalance('soap',1,{...pin,features:'{}'}),/household/);assert.deepEqual([...h.values],before);
 const put=h.storage.setItem;h.storage.setItem=(key,value)=>{if(key===FEATURES)throw Error('quota');put(key,value);};assert.throws(()=>h.home.setHouseholdBalance('soap',1,pin),/quota/);assert.deepEqual([...h.values],before);
});
test('a repaint failure after household commit does not report a false failed stock save',()=>{
 const h=fixture();h.setFailRefresh(true);assert.equal(h.home.setHouseholdBalance('soap',1,h.host.householdAmountContext()).ok,true);assert.equal(h.read(FEATURES).essentials[0].ownedQty,1);
});
test('an in-flight update locks other stock and restock actions immediately',async()=>{
 const h=fixture(),flush=h.win.BBPantryEditor.flush;let done;h.win.BBPantryEditor.flush=()=>new Promise(resolve=>{done=async()=>{await flush();resolve();};});
 const first=h.api.remaining(h.food(),'50');assert.equal(h.api.isBusy(),true);assert.equal((await h.api.restock(h.food(),'1 kg',{extra:true})).ok,false);assert.equal((await h.api.remaining(h.household(),'0')).ok,false);await done();assert.equal((await first).ok,true);assert.equal(h.api.isBusy(),false);
});
test('without a document the review enhancement leaves existing UI owners untouched',()=>{const api=review.install({});api.refresh();api.open();api.destroy();});
test('compact review projects the existing total and shortfall, including stock in other storage',()=>{
 const row={kind:'food',qty:200,unit:'g',otherOwned:300,totalNeeded:1250,shortfall:750,manualNeeded:250};
 assert.deepEqual(review.reviewAmounts(row),{atHome:500,planned:1250,toShop:750});
 assert.equal(row.qty,200,'the summary never replaces this storage balance with a kitchen total');
});
test('compact review shows the buffered goal and the full pack purchase without changing the editable base',()=>{
 const row={kind:'food',qty:200,unit:'ml',totalNeeded:333.333333,requiredNeeded:533.333333,extraBuffer:200,shortfall:1000};
 assert.deepEqual(review.reviewAmounts(row),{atHome:200,planned:533.333333,toShop:1000});
 assert.equal(row.totalNeeded,333.333333);
});
test('compact review keeps unknown and incompatible stock distinct from confirmed zero',()=>{
 const row={kind:'food',qty:null,unit:'g',otherOwned:0,totalNeeded:100,shortfall:100};
 assert.deepEqual(review.reviewAmounts(row),{atHome:null,planned:100,toShop:null});
 assert.deepEqual(review.reviewAmounts({...row,qty:0}),{atHome:0,planned:100,toShop:100});
 assert.deepEqual(review.reviewAmounts({...row,qty:50,otherOwnedNeedsReview:true}),{atHome:null,planned:100,toShop:null});
 assert.deepEqual(review.reviewAmounts({...row,qty:50,targetProblem:'Review units'}),{atHome:50,planned:null,toShop:null});
});
test('compact review never invents missing demand or infers a new shopping quantity',()=>{
 assert.deepEqual(review.reviewAmounts({kind:'food',qty:250,unit:'g'}),{atHome:250,planned:null,toShop:null});
 assert.deepEqual(review.reviewAmounts({kind:'food',qty:2,unit:'scoop',readOnly:true,totalNeeded:5,shortfall:3}),{atHome:2,planned:null,toShop:null});
 const h=fixture(),before=[...h.values],row=h.food(),target=h.home.foodTarget(row,{otherRows:h.api.snapshot().rows.filter(other=>other.kind==='food'&&other.key!==row.key)});
 assert.deepEqual(review.reviewAmounts(row,{foodTarget:target}),{atHome:500,planned:300,toShop:0});assert.deepEqual([...h.values],before);
});
test('compact review uses food targets for manual extras and staple stock without adding demand twice',()=>{
 const h=fixture(),row=h.food();assert.equal(h.home.addShoppingBuy({name:'Rice',quantityText:'200 g',actorId:'alice',requestId:'compact-extra'}).ok,true);
 const target=h.home.foodTarget(row);assert.deepEqual(review.reviewAmounts(row,{foodTarget:target}),{atHome:500,planned:700,toShop:200});
 const staple=h.api.snapshot().rows.find(item=>item.staple),stapleTarget=h.home.foodTarget(staple,{requirements:[{key:'Honey',required:15,unit:'ml',cupboardRequired:true}]});
 assert.deepEqual(review.reviewAmounts(staple,{foodTarget:stapleTarget}),{atHome:1,planned:1,toShop:0});
});
test('compact review delegates household balances and pending restock to the existing reconciler',()=>{
 const row={kind:'household',qty:2,unit:'pack'},household={qty:4,unit:'pack',targetQty:4,ownedQty:2,manualPending:true},reconcile=globalThis.BBWeeklyEssentials.reconcile;
 assert.deepEqual(review.reviewAmounts(row,{household,reconcile}),{atHome:2,planned:4,toShop:2});
 assert.deepEqual(review.reviewAmounts(row,{household:{...household,manualPending:false},reconcile}),{atHome:2,planned:4,toShop:0});
 assert.deepEqual(review.reviewAmounts({...row,qty:0},{household:{qty:4,unit:'pack',owned:false},reconcile}),{atHome:0,planned:4,toShop:4},'legacy required amounts are not replaced by the owned projection');
 assert.deepEqual(review.reviewAmounts(row,{household:{...household,ownedQty:null},reconcile}),{atHome:null,planned:null,toShop:null});
});
