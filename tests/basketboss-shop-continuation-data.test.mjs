import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const continuation=createRequire(import.meta.url)('../bb-shop-continuation.js');
const archiveKey='basketboss_shop_session_archive_v7';
const stamp='2026-11-11T10:20:30.000Z';
const context={actor:'alice',market:'UK',savedAt:stamp};
const trip=(id='shop-original')=>({version:7,id,createdAt:'2026-11-10T18:00:00.000Z',bought:{'rice|g':true},purchases:{}});
const row=(patch={})=>({id:'milk|kg',name:'Milk',unit:'kg',quantity:0.125,kind:'food',...patch});
const copy=value=>JSON.parse(JSON.stringify(value));
function saved(rows=[row()],pin=context,session=trip()){
 const result=continuation.prepareContinuation(session,rows,pin);
 assert.equal(result.ok,true,result.error);
 return result.snapshot;
}
function archived(snapshot=saved(),session=trip()){
 return {...session,closedAt:stamp,receiptContext:{actorId:snapshot.actorId,market:snapshot.market},savedRemaining:snapshot};
}

test('a continuation preserves exact remaining amounts and opaque food, household and shared IDs',()=>{
 const rows=[row(),row({id:'ess:manual-food:bin bags|pack',name:'Bin bags',unit:'pack',quantity:1.5,kind:'household',manualBuyId:'household:bin bags|pack'}),row({id:'shared:household-id:request-id',name:'Washing liquid',unit:'ml',quantity:17.000001,kind:'household'})];
 const snapshot=saved(rows);
 assert.equal(snapshot.version,1);
 assert.equal(snapshot.shopSessionId,'shop-original');
 assert.equal(snapshot.actorId,'alice');
 assert.equal(snapshot.market,'UK');
 assert.equal(snapshot.savedAt,stamp);
 assert.equal(snapshot.status,'pending');
 assert.deepEqual(snapshot.rows,rows);
 assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).rows,rows);
});

test('preparing a continuation neither changes caller records nor keeps unrelated demand or stock fields',()=>{
 const session=trip(),rows=[row({required:999,ownedQty:700,toBuy:299,pantryUsed:700,checked:false,custom:{secret:true}})];
 const before={session:copy(session),rows:copy(rows)},snapshot=saved(rows,context,session);
 assert.deepEqual(session,before.session);
 assert.deepEqual(rows,before.rows);
 assert.deepEqual(snapshot.rows,[row()]);
 rows[0].quantity=900;rows[0].custom.secret=false;session.bought['rice|g']=false;
 assert.equal(snapshot.rows[0].quantity,0.125);
 assert.equal(Object.hasOwn(snapshot.rows[0],'custom'),false);
 assert.equal(Object.hasOwn(snapshot,'bought'),false);
});

test('an empty list has no saved remainder and demand is never inferred from stock or targets',()=>{
 assert.deepEqual(continuation.prepareContinuation(trip(),[],context),{ok:true,snapshot:null});
 for(const candidate of [{id:'x',name:'Rice',unit:'g',required:500,ownedQty:200,toBuy:300},{...row(),quantity:undefined}]){
  assert.equal(continuation.prepareContinuation(trip(),[candidate],context).ok,false);
 }
});

test('invalid quantities, duplicate opaque IDs and malformed rows reject the entire snapshot',()=>{
 for(const quantity of [0,-1,NaN,Infinity,1000001,null,undefined,'']){
  assert.equal(continuation.prepareContinuation(trip(),[row(),row({id:'bad',quantity})],context).ok,false,String(quantity));
 }
 assert.equal(continuation.prepareContinuation(trip(),[row(),row({name:'Other milk',quantity:1})],context).ok,false);
 for(const candidate of [null,[],row({id:''}),row({name:'   '}),row({unit:''}),row({id:'x'.repeat(513)}),row({manualBuyId:'x'.repeat(513)}),row({name:'x'.repeat(201)}),row({unit:'x'.repeat(41)})]){
  assert.equal(continuation.prepareContinuation(trip(),[candidate],context).ok,false);
 }
 assert.equal(continuation.prepareContinuation(trip(),Array.from({length:1001},(_,i)=>row({id:'id-'+i})),context).ok,false);
});

test('session and context validation scopes snapshots to the supported market and original shop',()=>{
 for(const session of [null,[],{},trip(''),{...trip(),version:8}])assert.equal(continuation.prepareContinuation(session,[row()],context).ok,false);
 for(const pin of [null,{}, {...context,actor:''},{...context,market:'GB'},{...context,savedAt:'not a date'}])assert.equal(continuation.prepareContinuation(trip(),[row()],pin).ok,false);
 for(const market of ['UK','Guernsey','Jersey','US'])assert.equal(saved([row()],{...context,market}).market,market);
});

test('pending snapshots survive reload and are ordered newest first without consulting the meal plan',()=>{
 const older=saved(),newer=saved([row({id:'ess:bottles',name:'Milk bottles',unit:'each',quantity:2})],{...context,savedAt:'2026-11-11T11:20:30.000Z'},trip('shop-newer'));
 const archive=JSON.parse(JSON.stringify({'shop-original':archived(older),'shop-newer':archived(newer,trip('shop-newer'))}));
 assert.deepEqual(continuation.listPending(archive,context),[newer,older]);
 const text=continuation.formatList(older);
 assert.match(text,/Milk/);assert.match(text,/0\.125/);assert.match(text,/kg/);
});

test('pending reads hide other actors, other markets and inconsistent archive context',()=>{
 const good=archived();
 assert.equal(continuation.listPending({'shop-original':good},{actor:'bob',market:'UK'}).length,0);
 assert.equal(continuation.listPending({'shop-original':good},{actor:'alice',market:'US'}).length,0);
 for(const receiptContext of [{actorId:'bob',market:'UK'},{actorId:'alice',market:'US'},{}]){
  assert.equal(continuation.listPending({'shop-original':{...good,receiptContext}},context).length,0);
 }
 assert.equal(continuation.listPending({'shop-original':good},context).length,1);
});

test('invalid archived records and settled snapshots are hidden without returning a partial list',()=>{
 const good=archived();
 const records=[null,[],{}, {...good,version:8},{...good,id:'shop-other'}, {...good,savedRemaining:{...good.savedRemaining,shopSessionId:'shop-other'}}, {...good,savedRemaining:{...good.savedRemaining,status:'completed'}}, {...good,savedRemaining:{...good.savedRemaining,rows:[row(),row({id:'bad',quantity:-1})]}}, {...good,savedRemaining:{...good.savedRemaining,savedAt:'bad'}}];
 for(const record of records)assert.deepEqual(continuation.listPending({'shop-original':record},context),[]);
 for(const archive of [null,undefined,[],true,'bad'])assert.deepEqual(continuation.listPending(archive,context),[]);
});

test('readPending uses the existing archive key and safely handles corrupt or unavailable storage without writes',()=>{
 const values=new Map([[archiveKey,JSON.stringify({'shop-original':archived()})]]),reads=[],writes=[];
 const storage={getItem(key){reads.push(key);return values.get(key)??null;},setItem(...args){writes.push(args);},removeItem(...args){writes.push(args);}};
 assert.equal(continuation.readPending(storage,context).length,1);
 assert.deepEqual(reads,[archiveKey]);assert.deepEqual(writes,[]);
 for(const bytes of ['{broken','[]','null','true']){values.set(archiveKey,bytes);assert.deepEqual(continuation.readPending(storage,context),[]);}
 values.delete(archiveKey);assert.deepEqual(continuation.readPending(storage,context),[]);
 assert.deepEqual(continuation.readPending({getItem(){throw Error('unavailable');}},context),[]);
 assert.deepEqual(writes,[]);
});

test('an explicitly unknown remaining quantity stays readable after reload and copies as Check quantity',()=>{
 const unknown=row({id:'ess:manual:unmeasured',name:'Kitchen rolls',unit:'pack',quantity:null,quantityNeedsReview:true,kind:'household'});
 const snapshot=saved([unknown]);
 assert.deepEqual(snapshot.rows,[unknown]);
 const archive=JSON.parse(JSON.stringify({'shop-original':archived(snapshot)}));
 const pending=continuation.listPending(archive,context);
 assert.deepEqual(pending,[snapshot]);
 assert.equal(pending[0].rows[0].quantity,null);
 assert.equal(pending[0].rows[0].quantityNeedsReview,true);
 const text=continuation.formatList(pending[0]);
 assert.match(text,/Kitchen rolls/);
 assert.match(text,/Check quantity/);
 assert.doesNotMatch(text,/null|undefined|NaN/);
});

test('only an explicit null with its review flag can represent an unknown quantity',()=>{
 for(const candidate of [row({quantity:null}),row({quantity:null,quantityNeedsReview:false}),row({quantity:undefined,quantityNeedsReview:true}),row({quantity:NaN,quantityNeedsReview:true}),row({quantity:Infinity,quantityNeedsReview:true}),row({quantity:1,quantityNeedsReview:true})]){
  assert.equal(continuation.prepareContinuation(trip(),[candidate],context).ok,false);
 }
 const snapshot=saved([row({quantity:null,quantityNeedsReview:true})]);
 for(const candidate of [row({quantity:null}),row({quantity:1,quantityNeedsReview:true})]){
  const bad={...snapshot,rows:[candidate]};
  assert.deepEqual(continuation.listPending({'shop-original':archived(bad)},context),[]);
 }
});
