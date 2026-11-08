import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),{install}=require('../bb-home.js'),reduced=require('../bb-reduced-stock.js'),policy=require('../bb-pantry-policy.js');
const ACTOR='undo-day-account',HOME='basketboss_at_home_requirements_v1',SESSION='basketboss_cloud_session_v1',PLAN='basketboss_321_unified_state_v1',OWNER='basketboss_receipt_projection_owner_v1',STOCK='undo-stock',INVENTORY='undo-inventory';
const clone=value=>JSON.parse(JSON.stringify(value)),id=(name,unit)=>String(name).toLowerCase()+'|'+unit;
const food=(kind,recipeId,ingredients,extra={})=>({kind,recipeId,name:recipeId,day:'Monday',factor:1,occurrence:'week-one|'+kind+'|Monday|'+recipeId,ingredients,...extra});
const foods=()=>[food('dinner','rice-dinner',[{key:'rice',unit:'g',required:400}]),food('breakfast','milk-breakfast',[{key:'milk',unit:'ml',required:100}]),food('dessert','rice-pudding',[{key:'rice',unit:'g',required:100},{key:'milk',unit:'ml',required:200}])];
const kitchenRow=(name,quantity,unit='g',extra={})=>({name,qty:quantity,unit,selected:true,loc:'cupboard',bb173StockKey:id(name,unit),bb173StockValue:quantity,...extra});
function fixture({items=foods(),stock={'rice|g':1000,'milk|ml':1000},inventory={rice:kitchenRow('rice',1000),milk:kitchenRow('milk',1000,'ml')},conversion,receipt=true}={}){
 const values=new Map([[STOCK,JSON.stringify(stock)],[INVENTORY,JSON.stringify(inventory)],[SESSION,JSON.stringify({user:{id:ACTOR},access_token:'synthetic-token'})],[PLAN,JSON.stringify({pantryPlanGeneration:'week-one'})],['extra-plan',JSON.stringify({children:2})]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const state={items:clone(items),pending:false,unsafe:false,deleting:false,syncs:[],messages:[],refreshes:0,syncResult:{ok:true}};
 const host={id,keys:()=>({stock:STOCK,inventory:INVENTORY}),completionKeys:()=>['extra-plan'],stock:()=>JSON.parse(storage.getItem(STOCK)||'{}'),dayMeals:day=>state.items.filter(item=>item.day===day),recipeIngredients:(recipeId,factor)=>state.items.find(item=>item.recipeId===recipeId)?.ingredients.map(row=>({...row,required:row.required===null?null:row.required*factor})),occurrence:(recipeId,day,kind='dinner')=>state.items.find(item=>item.recipeId===recipeId&&item.day===day&&item.kind===kind)?.occurrence||null,refresh(){state.refreshes++;state.onRefresh?.();},notify:message=>state.messages.push(message),requirements:()=>[],household:()=>[],...(conversion?{conversionContext:()=>conversion}:{})};
 const receiptHost={hasPendingConfirmation:()=>state.pending,canConsumePantry:()=>!state.unsafe,async confirmCookedPantry(packet){state.syncs.push(clone(packet));if(state.syncError)throw Error('offline');if(state.syncWait)await state.syncWait;return state.syncResult;}};
 const win={localStorage:storage,document:{},location:{search:''},BBHomeHost:host,BBAccountDeletion:{isDeleting:()=>state.deleting},BBReducedStock:reduced,BBPantryPolicy:policy,...(receipt?{BBReceiptHost:receiptHost}:{})};
 const home=install(win);win.BBHome=home;
 const event={day:'Monday',actorId:ACTOR};
 const read=key=>JSON.parse(storage.getItem(key)||'{}'),write=(key,value)=>storage.setItem(key,JSON.stringify(value));
 const confirm=async(day='Monday')=>{const event={day,actorId:ACTOR},preview=home.previewDay(event);assert.equal(preview.ok,true,preview.message);return home.finishDay({...event,expected:preview.fingerprint});};
 const undo=async()=>{const preview=home.previewUndoDay(event);assert.equal(preview.ok,true,preview.message);return home.undoDay({...event,expected:preview.fingerprint});};
 const cook=async recipeId=>{const item=state.items.find(item=>item.recipeId===recipeId),event={sessionId:'cook-'+recipeId,actorId:ACTOR,recipeId,kind:item.kind,day:item.day,factor:item.factor,occurrence:item.occurrence};const preview=home.previewCook(event);assert.equal(preview.ok,true,preview.message);return home.cooked({...event,expected:preview.fingerprint});};
 return {values,storage,state,host,win,home,event,read,write,confirm,undo,cook,stock:()=>read(STOCK),inventory:()=>read(INVENTORY),data:()=>read(HOME).byActor?.[ACTOR]};
}

test('new Day done reverses dinner, breakfast and dessert exactly once after a read-only preview',async()=>{
 const h=fixture(),originalStock=h.stock(),originalKitchen=h.inventory();await h.confirm();
 assert.deepEqual(h.stock(),{'rice|g':500,'milk|ml':700});
 const before=[...h.values],preview=h.home.previewUndoDay(h.event);assert.equal(preview.ok,true,preview.message);assert.deepEqual([...h.values],before);
 assert.deepEqual(preview.items.map(item=>item.kind),['dinner','breakfast','dessert']);assert.deepEqual(preview.rows.map(row=>[row.name,row.unit,row.restore]),[['rice','g',500],['milk','ml',300]]);
 const result=await h.home.undoDay({...h.event,expected:preview.fingerprint});assert.equal(result.ok,true);assert.equal(result.restoredCount,3);assert.equal(result.remainingConfirmedCount,0);
 assert.deepEqual(h.stock(),originalStock);assert.deepEqual(h.inventory(),originalKitchen);assert.equal(Object.values(h.data().cooked).length,0);
 for(const item of h.state.items)assert.equal(h.home.isCooked(item.occurrence),false);
 const saved=[...h.values],syncs=h.state.syncs.length;assert.equal((await h.home.undoDay({...h.event,expected:preview.fingerprint})).already,true);assert.deepEqual([...h.values],saved);assert.equal(h.state.syncs.length,syncs);
 assert.equal((await h.confirm()).completedCount,3);assert.deepEqual(h.stock(),{'rice|g':500,'milk|ml':700});assert.equal((await h.undo()).restoredCount,3);
});

test('earlier individual Cook confirmations survive Day done undo, including breakfast',async()=>{
 const h=fixture();await h.cook('rice-dinner');await h.cook('milk-breakfast');const original=clone(h.data().cooked);
 assert.equal((await h.confirm()).completedCount,1);assert.equal((await h.undo()).remainingConfirmedCount,2);
 assert.deepEqual(h.stock(),{'rice|g':600,'milk|ml':900});assert.deepEqual(h.data().cooked,original);
 assert.equal(h.home.isCooked(h.state.items[0].occurrence),true);assert.equal(h.home.isCooked(h.state.items[1].occurrence),true);assert.equal(h.home.isCooked(h.state.items[2].occurrence),false);
});

test('later purchases, another cooked meal and unrelated Kitchen notes remain after additive restoration',async()=>{
 const h=fixture();await h.confirm();
 const kitchen=h.inventory();kitchen.rice.qty+=500;kitchen.rice.bb173StockValue+=500;kitchen.rice.notes='Keep this later note';kitchen.unrelated=kitchenRow('beans',300);h.write(INVENTORY,kitchen);h.write(STOCK,{...h.stock(),'rice|g':1000,'beans|g':300});
 h.state.items.push(food('dinner','later-rice',[{key:'rice',unit:'g',required:200}],{day:'Tuesday',occurrence:'week-one|dinner|Tuesday|later-rice'}));await h.cook('later-rice');
 const later=clone(h.data().cooked['cook-later-rice']);await h.undo();
 assert.deepEqual(h.stock(),{'rice|g':1300,'milk|ml':1000,'beans|g':300});assert.equal(h.inventory().rice.qty,1300);assert.equal(h.inventory().rice.notes,'Keep this later note');assert.deepEqual(h.inventory().unrelated,kitchen.unrelated);assert.deepEqual(h.data().cooked['cook-later-rice'],later);
});

test('undo preserves receipt generations, settled history and new shopping records without re-crediting purchases',async()=>{
 const h=fixture();h.host.settlePurchases=()=>({updates:{'shop-ticks':{}},expected:{'shop-ticks':h.storage.getItem('shop-ticks')},history:{original:{purchase:{qty:500}}},generations:{'shop|rice|g':1},superseded:{old:true}});h.write('shop-ticks',{rice:true});await h.confirm();
 const history=clone(h.data());h.write('shop-ticks',{newPurchase:true});h.write('later-receipt',{credited:200});await h.undo();
 assert.deepEqual(h.data().receiptGenerations,history.receiptGenerations);assert.deepEqual(h.data().supersededReceipts,history.supersededReceipts);assert.deepEqual(h.data().settledPurchases,history.settledPurchases);assert.deepEqual(h.read('shop-ticks'),{newPurchase:true});assert.deepEqual(h.read('later-receipt'),{credited:200});
 assert.equal(h.storage.getItem(HOME).includes('synthetic-token'),false,'tokens belong in a transient fingerprint, never the saved action journal');
});

for(const change of ['stock','inventory','plan','extra-plan','owner','session','home'])test('stale '+change+' invalidates the reviewed undo without a write',async()=>{
 const h=fixture();await h.confirm();const preview=h.home.previewUndoDay(h.event);assert.equal(preview.ok,true);
 if(change==='stock')h.write(STOCK,{...h.stock(),'rice|g':501});
 if(change==='inventory')h.write(INVENTORY,{...h.inventory(),other:kitchenRow('beans',20)});
 if(change==='plan')h.write(PLAN,{pantryPlanGeneration:'new-cycle'});
 if(change==='extra-plan')h.write('extra-plan',{children:3});
 if(change==='owner')h.write(OWNER,{actorId:ACTOR,inventoryRevision:3});
 if(change==='session')h.write(SESSION,{user:{id:ACTOR},access_token:'fresh-token'});
 if(change==='home'){const data=h.read(HOME);data.byActor[ACTOR].targets.new={targetQty:4};h.write(HOME,data);}
 const before=[...h.values],syncs=h.state.syncs.length;assert.equal((await h.home.undoDay({...h.event,expected:preview.fingerprint})).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.state.syncs.length,syncs);
});

for(const change of ['name','unit','loc','package','deleted','selected','plan-occurrence','factor','actor','pending','unsafe','deleting','overflow','corrupt-journal'])test('unsafe '+change+' refuses undo without guessing or mutation',async()=>{
 const h=fixture();await h.confirm();let inventory=h.inventory();
 if(change==='name')inventory.rice.name='Fresh rice noodles';
 if(change==='unit')inventory.rice.unit='each';
 if(change==='loc')inventory.rice.loc='freezer';
 if(change==='package')inventory.rice.packQuantity=500;
 if(change==='deleted')delete inventory.rice;
 if(change==='selected')inventory.rice.selected=false;
 if(['name','unit','loc','package','deleted','selected'].includes(change))h.write(INVENTORY,inventory);
 if(change==='plan-occurrence')h.state.items[0].occurrence='week-two|dinner|Monday|rice-dinner';
 if(change==='factor')h.state.items[0].factor=2;
 if(change==='actor')h.write(SESSION,{user:{id:'another-account'}});
 if(['pending','unsafe','deleting'].includes(change))h.state[change]=true;
 if(change==='overflow'){inventory.rice.qty=1000000;inventory.rice.bb173StockValue=1000000;h.write(INVENTORY,inventory);h.write(STOCK,{...h.stock(),'rice|g':1000000});}
 if(change==='corrupt-journal'){const data=h.read(HOME),action=Object.values(data.byActor[ACTOR].dayActions)[0];action.stock[0].restore=-1;h.write(HOME,data);}
 const before=[...h.values];assert.equal(h.home.previewUndoDay(h.event).ok,false);assert.equal((await h.home.undoDay({...h.event,expected:'invalid'})).ok,false);assert.deepEqual([...h.values],before);
});

test('legacy and individual confirmations never infer old deductions from current recipe quantities',async()=>{
 const h=fixture({items:[food('dinner','only-dinner',[{key:'rice',unit:'g',required:400}])]});await h.cook('only-dinner');
 const before=[...h.values];assert.equal(h.home.previewUndoDay(h.event).ok,false);assert.match(h.home.previewUndoDay(h.event).message,/individually|before Undo/);assert.deepEqual([...h.values],before);
 const legacy=fixture();await legacy.confirm();const data=legacy.read(HOME);delete data.byActor[ACTOR].dayActions;legacy.write(HOME,data);assert.equal(legacy.home.previewUndoDay(legacy.event).ok,false);
});

test('atomic storage failure rolls restored quantities and completion identities back together',async()=>{
 const h=fixture();await h.confirm();const before=[...h.values],preview=h.home.previewUndoDay(h.event),put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key===HOME&&fail){fail=false;throw Error('quota');}put(key,value);};
 await assert.rejects(h.home.undoDay({...h.event,expected:preview.fingerprint}),/quota/);assert.deepEqual([...h.values],before);assert.equal((await h.undo()).ok,true);assert.deepEqual(h.stock(),{'rice|g':1000,'milk|ml':1000});
});

test('reduced and freezer lots restore their original consumed portions, not a full pantry snapshot',async()=>{
 const urgent={version:1,actor:ACTOR,urgent:true,at:1,sources:['reduced:original']};
 const h=fixture({items:[food('dinner','carrot-meal',[{key:'carrot',unit:'g',required:300}])],stock:{'carrot|g':500},inventory:{urgent:kitchenRow('carrot',300,'g',{loc:'fridge',bbReduced:urgent}),frozen:kitchenRow('carrot',200,'g',{loc:'freezer'})},conversion:{pantryMode:true,market:'UK'}});
 await h.confirm();assert.equal(h.inventory().urgent.qty,0);assert.equal(h.inventory().urgent.bbReduced.urgent,false);const frozen=clone(h.inventory().frozen);
 const inventory=h.inventory();inventory.newPurchase=kitchenRow('carrot',100,'g',{loc:'fridge'});h.write(INVENTORY,inventory);h.write(STOCK,{'carrot|g':300});await h.undo();
 assert.equal(h.inventory().urgent.qty,300);assert.deepEqual(h.inventory().urgent.bbReduced,urgent);assert.deepEqual(h.inventory().frozen,frozen);assert.equal(h.inventory().newPurchase.qty,100);assert.deepEqual(h.stock(),{'carrot|g':600});
});

test('a refilled depleted reduced lot needs review rather than marking a later ordinary purchase urgent',async()=>{
 const h=fixture({items:[food('dinner','carrot-meal',[{key:'carrot',unit:'g',required:300}])],stock:{'carrot|g':300},inventory:{urgent:kitchenRow('carrot',300,'g',{loc:'fridge',bbReduced:{version:1,actor:ACTOR,urgent:true,at:1,sources:['reduced:original']}})},conversion:{pantryMode:true,market:'UK'}});
 await h.confirm();const inventory=h.inventory();inventory.urgent.qty=100;inventory.urgent.bb173StockValue=100;h.write(INVENTORY,inventory);h.write(STOCK,{'carrot|g':100});
 const before=[...h.values];assert.equal(h.home.previewUndoDay(h.event).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.inventory().urgent.bbReduced.urgent,false);
});

for(const mode of ['kg','reviewed-pack'])test('exact '+mode+' physical quantities restore without invented grams',async()=>{
 const pack=mode==='reviewed-pack',unit=pack?'pack':'kg',key='rice|'+unit,conversion=pack?{stock:{[key]:{reviewed:true,packQuantity:500,packUnit:'g',stockKey:key,sourceUnit:'pack',canonicalKey:'rice'}}}:{};
 const h=fixture({items:[food('dinner','rice-meal',[{key:'rice',unit:'g',required:300}])],stock:{[key]:1},inventory:{rice:kitchenRow('rice',1,unit)},conversion});await h.confirm();assert.ok(Math.abs(h.stock()[key]-(pack?.4:.7))<1e-9);await h.undo();assert.deepEqual(h.stock(),{[key]:1});assert.equal(h.inventory().rice.qty,1);assert.equal(h.inventory().rice.unit,unit);
});

test('confirmed dependent leftovers must be undone before their original batch can be restored',async()=>{
 const main=food('dinner','batch',[{key:'rice',unit:'g',required:600}]),leftover=food('leftover','batch-leftover',[],{day:'Tuesday',occurrence:'week-one|leftover|Tuesday|batch',sourceOccurrence:main.occurrence});const h=fixture({items:[main,leftover]});await h.confirm();await h.confirm('Tuesday');
 assert.equal(h.home.previewUndoDay(h.event).ok,false);assert.match(h.home.previewUndoDay(h.event).message,/leftovers/);const event={day:'Tuesday',actorId:ACTOR},preview=h.home.previewUndoDay(event);assert.equal(preview.ok,true);assert.deepEqual(preview.rows,[]);assert.equal((await h.home.undoDay({...event,expected:preview.fingerprint})).ok,true);await h.undo();assert.equal(h.stock()['rice|g'],1000);
});

test('manual notes can reverse their completion without inventing ingredient amounts',async()=>{
 const h=fixture({items:[food('note','custom-soup',[],{manualReview:true})]});await h.confirm();const before=h.stock(),preview=h.home.previewUndoDay(h.event);assert.equal(preview.ok,true);assert.deepEqual(preview.rows,[]);assert.equal((await h.undo()).restoredCount,1);assert.deepEqual(h.stock(),before);
});

for(const mode of ['offline','local-only','conflict','no-adapter'])test('undo '+mode+' reports saved local restoration honestly and never replays it',async()=>{
 const h=fixture({receipt:mode!=='no-adapter'});await h.confirm();
 if(mode==='offline')h.state.syncError=true;if(mode==='local-only')h.state.syncResult={ok:true,localOnly:true};if(mode==='conflict')h.state.syncResult={ok:false,needsReview:true,conflict:true};
 const result=await h.undo();assert.equal(result.ok,true);assert.match(result.message,/on this device|online pantry/i);assert.equal(mode==='conflict'?result.onlinePending:result.localOnly||result.onlinePending,true);assert.deepEqual(h.stock(),{'rice|g':1000,'milk|ml':1000});const count=h.state.syncs.length;assert.equal((await h.home.undoDay(h.event)).already,true);assert.equal(h.state.syncs.length,count);
});

test('account switching during refresh cannot send the original pantry to the new account',async()=>{
 const h=fixture();await h.confirm();const syncs=h.state.syncs.length;h.state.onRefresh=()=>h.write(SESSION,{user:{id:'different-account'}});const result=await h.undo();assert.equal(result.ok,true);assert.equal(result.localOnly,true);assert.equal(h.state.syncs.length,syncs);assert.deepEqual(h.stock(),{'rice|g':1000,'milk|ml':1000});
});

// Re-seal corrupted journal fixtures and the separate receipt markers so the
// following tests exercise structural quantity checks, not only checksum drift.
function reseal(data,action,{receiptMarkers=true}={}){
 const body=clone(action);delete body.integrity;for(const item of body.items)delete item.receipt.dayUndoIntegrity;
 const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 const bytes=Buffer.from(JSON.stringify(stable(body)),'utf8');let hash=14695981039346656037n;for(const byte of bytes)hash=((hash^BigInt(byte))*1099511628211n)&0xffffffffffffffffn;
 action.integrity='fnv64:'+hash.toString(16).padStart(16,'0');
 for(const item of action.items){item.receipt.dayUndoIntegrity=action.integrity;if(receiptMarkers)data.byActor[ACTOR].cooked[item.receiptKey].dayUndoIntegrity=action.integrity;}
}

for(const corruption of ['stock-only','all-delta-families','duplicate-stock','duplicate-kitchen','duplicate-receipt','duplicate-source','missing-kitchen-delta','display-physical-mismatch','journal-receipt-mismatch','checksum-without-receipt-marker'])test('corrupt '+corruption+' journal cannot manufacture food, even with an internally valid checksum',async()=>{
 const h=fixture();await h.confirm();const data=h.read(HOME),action=Object.values(data.byActor[ACTOR].dayActions)[0];
 const rice=action.stock.find(row=>row.key==='rice|g'),kitchen=action.inventory.find(row=>row.id==='rice'),allocation=action.allocations.find(row=>row.id==='rice|g');
 if(['stock-only','all-delta-families','checksum-without-receipt-marker'].includes(corruption)){rice.before+=500;rice.restore+=500;}
 if(corruption==='all-delta-families'){
  kitchen.quantity.before+=500;kitchen.quantity.restore+=500;kitchen.stockValue.before+=500;kitchen.stockValue.restore+=500;
  allocation.quantity+=500;allocation.sources[0].sourceQuantity+=500;allocation.sources[0].quantity+=500;
 }
 if(corruption==='duplicate-stock')action.stock.push(clone(rice));
 if(corruption==='duplicate-kitchen')action.inventory.push(clone(kitchen));
 if(corruption==='duplicate-receipt')action.items.push(clone(action.items[0]));
 if(corruption==='duplicate-source')allocation.sources.push(clone(allocation.sources[0]));
 if(corruption==='missing-kitchen-delta')action.inventory=action.inventory.filter(row=>row.id!=='rice');
 if(corruption==='display-physical-mismatch'){kitchen.quantity.before+=100;kitchen.quantity.restore+=100;}
 if(corruption==='journal-receipt-mismatch')action.items[0].receipt.ingredients[0].quantity+=100;
 reseal(data,action,{receiptMarkers:corruption!=='checksum-without-receipt-marker'});h.write(HOME,data);
 const before=[...h.values],syncs=h.state.syncs.length;assert.equal(h.home.previewUndoDay(h.event).ok,false,corruption);assert.equal((await h.home.undoDay({...h.event,expected:'stale'})).ok,false);assert.deepEqual([...h.values],before);assert.equal(h.state.syncs.length,syncs);
});

test('the journal checksum uses stable UTF-8 and binds to separately saved Cook receipts',async()=>{
 const h=fixture();h.state.items[0].name='Crème brûlée 🍳';await h.confirm();const data=h.read(HOME),action=Object.values(data.byActor[ACTOR].dayActions)[0],saved=action.integrity;reseal(data,action);assert.equal(action.integrity,saved,'independent UTF-8 reference agrees');
 for(const item of action.items)assert.equal(h.data().cooked[item.receiptKey].dayUndoIntegrity,saved);assert.equal(h.home.previewUndoDay(h.event).ok,true);
});

test('raw physical stock without a Kitchen row remains reversible using its saved exact allocations',async()=>{
 const h=fixture({inventory:{}});await h.confirm();assert.equal(h.home.previewUndoDay(h.event).ok,true);await h.undo();assert.deepEqual(h.stock(),{'rice|g':1000,'milk|ml':1000});assert.deepEqual(h.inventory(),{});
});

for(const outcome of ['offline','conflict','local-only','online'])test('a rerendered/disposed Day done dialog still reports the final '+outcome+' undo result',async()=>{
 const h=fixture();await h.confirm();h.state.messages.length=0;let disposed=false;h.state.onRefresh=()=>{disposed=true;};
 if(outcome==='offline')h.state.syncError=true;if(outcome==='conflict')h.state.syncResult={ok:false,needsReview:true};if(outcome==='local-only')h.state.syncResult={ok:true,localOnly:true,weeklyReviewRequired:true};
 const result=await h.undo();assert.equal(disposed,true);assert.equal(result.ok,true);assert.deepEqual(h.state.messages,[result.message]);if(outcome==='local-only')assert.equal(result.weeklyReviewRequired,true);
});

for(const change of ['actor','session','deletion'])test('late undo notification does not reach a changed '+change+' context',async()=>{
 const h=fixture();await h.confirm();h.state.messages.length=0;let release;h.state.syncWait=new Promise(resolve=>{release=resolve;});
 const promise=h.undo();await Promise.resolve();
 if(change==='actor')h.write(SESSION,{user:{id:'other-account'}});if(change==='session')h.write(SESSION,{user:{id:ACTOR},access_token:'new-session'});if(change==='deletion')h.state.deleting=true;
 release();assert.equal((await promise).ok,true);assert.deepEqual(h.state.messages,[]);
});

test('separate Cook receipts retain exact physical pack portions shared by two planned meals',async()=>{
 const key='rice|pack',h=fixture({items:[food('dinner','rice-dinner',[{key:'rice',unit:'g',required:200}]),food('dessert','rice-pudding',[{key:'rice',unit:'g',required:300}])],stock:{[key]:1},inventory:{rice:kitchenRow('rice',1,'pack')},conversion:{stock:{[key]:{reviewed:true,packQuantity:500,packUnit:'g',stockKey:key,sourceUnit:'pack',canonicalKey:'rice'}}}});await h.confirm();
 const records=Object.values(h.data().cooked),sources=records.map(row=>row.dayUndoAllocations[0]);assert.deepEqual(sources.map(row=>row.quantity),[200,300]);assert.ok(Math.abs(sources[0].sourceQuantity-.4)<1e-9);assert.ok(Math.abs(sources[1].sourceQuantity-.6)<1e-9);assert.equal(sources.reduce((sum,row)=>sum+row.sourceQuantity,0),1);await h.undo();assert.deepEqual(h.stock(),{[key]:1});
});

for(const changeReceipt of [false,true])test('coherently changed package journal cannot restore an extra fraction of a physical pack'+(changeReceipt?' even when receipt source metadata is also corrupted':''),async()=>{
 const key='rice|pack',h=fixture({items:[food('dinner','rice-meal',[{key:'rice',unit:'g',required:300}])],stock:{[key]:1},inventory:{rice:kitchenRow('rice',1,'pack')},conversion:{stock:{[key]:{reviewed:true,packQuantity:500,packUnit:'g',stockKey:key,sourceUnit:'pack',canonicalKey:'rice'}}}});await h.confirm();
 const data=h.read(HOME),action=Object.values(data.byActor[ACTOR].dayActions)[0],stock=action.stock[0],kitchen=action.inventory[0];
 stock.before=1.4;stock.restore=1;kitchen.quantity.before=1.4;kitchen.quantity.restore=1;kitchen.stockValue.before=1.4;kitchen.stockValue.restore=1;action.allocations[0].sources[0].sourceQuantity=1;
 if(changeReceipt){const item=action.items[0];item.receipt.dayUndoAllocations[0].sourceQuantity=1;data.byActor[ACTOR].cooked[item.receiptKey].dayUndoAllocations[0].sourceQuantity=1;}
 reseal(data,action);h.write(HOME,data);const before=[...h.values];assert.equal(h.home.previewUndoDay(h.event).ok,false);assert.equal((await h.home.undoDay({...h.event,expected:'invalid'})).ok,false);assert.deepEqual([...h.values],before);
});
