import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),completion=require('../bb-shop-completion.js'),ownership=require('../bb-shop-ownership.js'),quantity=require('../bb-receipt-quantity.js'),home=require('../bb-home.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
const original={version:7,id:'shop-completion',shelfEdits:{},purchases:{},partials:{}};
const item={key:'Chicken breast',name:'Chicken breast',unit:'g',required:600,pantryUsed:533.333333,toBuy:66.666667,priceQuote:{amount:.68,packQty:1000,packUnit:'g'}};
const details={id:'chicken breast|g',actor:'tester',receiptId:'shop-completion|chicken breast|g',amount:67,unit:'g',item,price:.68};

test('completion records copy only presentation metadata without changing exact pantry requirements or quote',()=>{
 const session=copy(original),before=JSON.stringify([session,item]),next=completion.update(session,details),proof=completion.get(next,details.id,'tester');
 assert.equal(JSON.stringify([session,item]),before);assert.equal(proof.amount,67);assert.equal(proof.item.required,600);assert.equal(proof.item.pantryUsed,533.333333);assert.equal(proof.item.toBuy,66.666667);assert.equal(proof.price,.68);
 const repeated=completion.update(next,{...details,price:99});assert.equal(repeated.completedPurchases[details.id].price,.68,'a repeated write preserves the original single displayed purchase cost');
 assert.deepEqual(completion.update(next,{...details,amount:0}).completedPurchases,{});
});
test('completed rows survive loss of unmet recipe rows and partial purchases count as bought in the view only',()=>{
 const next=completion.update(original,details),rows=[{id:'milk|ml',checked:false,name:'Milk'}],before=JSON.stringify([next,rows]);
 const visible=completion.decorate(rows,next,'tester');assert.equal(visible.length,2);assert.equal(visible.filter(row=>row.checked).length,1);assert.equal(visible.filter(row=>!row.checked).length,1);
 const bought=visible.find(row=>row.id===details.id);assert.equal(bought.checked,true);assert.equal(bought.box,null);assert.equal(bought.basketItem.pantryUsed,533.333333);assert.equal(bought.completion.amount,67);assert.equal(JSON.stringify([next,rows]),before);
 const partial=completion.update(original,{...details,amount:50}),existing=[{id:details.id,checked:false,name:'Chicken breast',basketItem:item}];
 const partialRows=completion.decorate(existing,partial,'tester');assert.equal(partialRows.find(row=>row.id===details.id).checked,false);assert.equal(partialRows.filter(row=>row.checked).length,1,'the confirmed purchase has its own Bought row while the deficit stays pending');assert.equal(existing[0].checked,false,'the core checkbox state is not rewritten');
});
test('completion history is isolated by actor and shopping session and cannot leak into a new trip',()=>{
 const next=completion.update(original,details);
 assert.equal(completion.get(next,details.id,'someone-else'),null);assert.deepEqual(completion.decorate([],next,'someone-else'),[]);
 assert.deepEqual(completion.decorate([],{...next,id:'shop-next'},'tester'),[]);assert.deepEqual(completion.decorate([],original,'tester'),[]);
 assert.throws(()=>completion.update({...original,completedPurchases:[]},details),/saved shopping progress/);
});
test('undo requires the exact original actor, session, receipt generation, amount, unit and active marker',()=>{
 const next=completion.update(original,details),proof=completion.get(next,details.id,'tester'),marker={kind:'shop-owned-v1',actor:'tester',receiptId:details.receiptId,amount:67,unit:'g'};
 const context={actor:'tester',sessionId:original.id,receiptId:details.receiptId,marker,active:true};assert.equal(completion.canUndo(proof,context),true);
 for(const patch of [{actor:'other'},{sessionId:'shop-next'},{receiptId:details.receiptId+'|home:1'},{active:false},{active:undefined},{marker:{...marker,amount:50}},{marker:{...marker,unit:'kg'}},{marker:{...marker,actor:'other'}}])assert.equal(completion.canUndo(proof,{...context,...patch}),false);
});

function actual(name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);
 const lineEnd=html.indexOf('\n',start);if(html.slice(start,lineEnd).endsWith('}'))return html.slice(start,lineEnd);
 const end=html.indexOf('\n}',start);assert.ok(end>start,name);return html.slice(start,end+2);
}
// Only reuse the established VM fixture function, without registering/running
// its sibling tests. Its purchase journal and subtraction functions stay real.
const helper=fs.readFileSync(new URL('./basketboss-shop-ownership.test.mjs',import.meta.url),'utf8'),start=helper.indexOf('function fixture('),end=helper.indexOf('\n\ntest(',start),keyLine=helper.split('\n').find(line=>line.startsWith('const keys='));
assert.ok(start>=0&&end>start&&keyLine);
const scope={assert,require,vm,quantity,home,ownership,html,actual,copy,Map};
vm.runInNewContext(keyLine+'\n'+helper.slice(start,end)+'\nthis.makeFixture=fixture;',scope);
function fixture(options){
 const h=scope.makeFixture(options),messages=[];h.ctx.window.BBShopCompletion=completion;h.ctx.notify=message=>messages.push(message);
 h.ctx.bbShopV7Snapshot=session=>({...session,bought:h.read('ticks'),purchases:h.read('purchases'),partials:h.read('partials'),choices:h.read('choices')});
 vm.runInContext(actual('bbShopCompletionProofContext'),h.ctx);
 vm.runInContext(actual('bb172StorefrontToggle'),h.ctx);
 return {...h,messages,proof:()=>completion.get(h.read('session'),h.id,'tester'),view:()=>completion.decorate([],h.read('session'),'tester')[0],undo:()=>h.ctx.bb172StorefrontToggle(completion.decorate([],h.read('session'),'tester')[0])};
}

test('the actual full-purchase transaction retains Bought and undo reverses the selected stock once',()=>{
 const h=fixture();assert.equal(h.check(true),true);assert.equal(h.read('stock')['pork sausages|each'],11);assert.equal(h.proof().amount,6);assert.equal(h.view().checked,true);
 h.undo();assert.equal(h.read('stock')['pork sausages|each'],5);assert.equal(h.read('ticks')[h.id],undefined);assert.equal(h.proof(),null);
});
test('the actual partial-purchase transaction keeps its core partial math but exposes a confirmed Bought row and reverses through zero',()=>{
 const h=fixture({name:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150,quote:{packQty:500,packUnit:'g'}});
 assert.equal(h.amount(50),true);assert.equal(h.read('stock')['rice|g'],400);assert.equal(h.read('ticks')[h.id],undefined);assert.equal(h.read('partials')['shop-net-test|rice|g'].bought,50);
 assert.equal(h.view().checked,true);assert.equal(h.proof().amount,50);h.undo();assert.equal(h.read('stock')['rice|g'],350);assert.equal(h.proof(),null);assert.equal(h.read('partials')['shop-net-test|rice|g'],undefined);
});
test('pantry settlement retains the completed row until Finish while refusing unsafe stock reversal',()=>{
 const h=fixture();assert.equal(h.check(true),true);const session=h.read('session');
 for(const key of ['ticks','purchases','partials','choices'])h.storage.setItem(key,'{}');
 h.storage.setItem('session',JSON.stringify({...session,bought:{},purchases:{},partials:{},choices:{}}));h.storage.setItem('stock',JSON.stringify({'pork sausages|each':8}));
 h.ctx.bbBetaReceiptId=id=>'shop-net-test|'+id+'|home:1';const before=new Map(h.values);assert.equal(h.view().checked,true);h.undo();
 assert.deepEqual(h.values,before);assert.match(h.messages.at(-1),/used or changed/);assert.equal(h.view().checked,true);
 const nextTrip={version:7,id:'shop-finished',bought:{},purchases:{},partials:{}};assert.deepEqual(completion.decorate([],nextTrip,'tester'),[]);
});
test('current-generation external stock changes still fail the existing rewind without clearing completion',()=>{
 const h=fixture();assert.equal(h.check(true),true);h.storage.setItem('stock',JSON.stringify({'pork sausages|each':10}));const before=new Map(h.values);h.undo();
 assert.deepEqual(h.values,before);assert.equal(h.view().checked,true);assert.match(h.messages.at(-1),/used or changed/);
});
test('a failed combined stock write cannot leave a phantom completion or tick',()=>{
 const h=fixture(),before=new Map(h.values),write=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key==='inventory'&&fail){fail=false;throw Error('quota');}return write(key,value);};
 assert.equal(h.check(true),false);assert.deepEqual(h.values,before);assert.equal(h.proof(),null);
});

function legacy({partial=false,settled=false}={}){
 const id='rice|g',receiptId='shop-completion|rice|g',marker={kind:'shop-owned-v1',actor:'tester',receiptId,amount:50,unit:'g',anchor:{key:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150}};
 const purchase={name:'Rice',unit:'g',actualQty:50,qty:50,legacySnapshot:false,bbBetaSelectedWeek:original.id},part={name:'Rice',unit:'g',bought:50,week:original.id};
 const session={...copy(original),shelfEdits:{[id]:marker},purchases:!partial&&!settled?{[id]:purchase}:{},partials:partial&&!settled?{[original.id+'|'+id]:part}:{}};
 const context={active:(row,key)=>ownership.active(row,key,session),receipts:{[receiptId]:{name:'Rice',unit:'g',credited:50,stockBasis:'full-purchase',week:original.id}},settledPurchases:settled?{[receiptId+'|settled:123:proof']:{purchase:partial?null:purchase,partial:partial?part:null}}:{}};
 return {id,receiptId,marker,purchase,part,session,context};
}
test('pre-upgrade active full and partial markers derive Bought without writing metadata or inspecting pantry balances',()=>{
 for(const partial of [false,true]){
  const h=legacy({partial}),before=JSON.stringify([h.session,h.context]);
  const rows=completion.decorate([],h.session,'tester',h.context);assert.equal(rows.length,1);assert.equal(rows[0].id,h.id);assert.equal(rows[0].checked,true);assert.equal(rows[0].completion.amount,50);assert.equal(rows[0].completion.legacy,true);assert.equal(rows[0].completion.settled,false);
  assert.equal(JSON.stringify([h.session,h.context]),before);assert.equal(h.session.completedPurchases,undefined);
 }
 const h=legacy();assert.deepEqual(completion.decorate([],h.session,'other-person',h.context),[]);
 assert.deepEqual(completion.decorate([],original,'tester',{stock:{'rice|g':10000}}),[],'stock on its own proves no shopping completion');
});
test('pre-upgrade settled Bought requires both exact actor-scoped settlement history and processed receipt proof',()=>{
 for(const partial of [false,true]){
  const h=legacy({partial,settled:true}),rows=completion.decorate([],h.session,'tester',h.context);assert.equal(rows.length,1);assert.equal(rows[0].completion.settled,true);assert.equal(rows[0].checked,true);
  assert.equal(completion.canUndo(rows[0].completion,{actor:'tester',sessionId:h.session.id,receiptId:h.receiptId,marker:h.marker,active:false}),false);
  for(const context of [{...h.context,receipts:{}},{...h.context,settledPurchases:{}},{...h.context,receipts:{[h.receiptId]:{...h.context.receipts[h.receiptId],credited:51}}},{...h.context,receipts:{[h.receiptId]:{...h.context.receipts[h.receiptId],week:'shop-old'}}}])assert.deepEqual(completion.decorate([],h.session,'tester',context),[]);
 }
});
test('unknown activity, mismatched history and another trip cannot backfill old shopping completion',()=>{
 const h=legacy({settled:true});
 for(const active of [undefined,()=>undefined,()=>{throw Error('unavailable');}])assert.deepEqual(completion.decorate([],h.session,'tester',{...h.context,active}),[]);
 assert.deepEqual(completion.decorate([],{...h.session,id:'shop-new'},'tester',h.context),[]);
 const badHistory={[h.receiptId+'|settled:123']:{purchase:{...h.purchase,actualQty:49}}};assert.deepEqual(completion.decorate([],h.session,'tester',{...h.context,settledPurchases:badHistory}),[]);
});
test('a real pre-upgrade active marker still reverses through the unchanged purchase journal',()=>{
 const h=fixture();assert.equal(h.check(true),true);const session=h.read('session');delete session.completedPurchases;h.storage.setItem('session',JSON.stringify(session));
 const proof=h.ctx.bbShopCompletionProofContext(h.ctx.bbShopV7Snapshot(h.read('session'))),row=completion.decorate([],h.read('session'),'tester',proof)[0];assert.equal(row.checked,true);assert.equal(row.completion.legacy,true);
 h.ctx.bb172StorefrontToggle(row);assert.equal(h.read('stock')['pork sausages|each'],5);assert.equal(h.proof(),null);
});
test('completion undo waits for the existing startup readiness guard without changing the purchase',()=>{
 const h=fixture();assert.equal(h.check(true),true);h.ctx.bbShopPurchaseRulesReady=()=>false;const before=new Map(h.values);h.undo();
 assert.deepEqual(h.values,before);assert.equal(h.view().checked,true);assert.match(h.messages.at(-1),/still loading/);
});

test('an old receipt ID stays pinned while equivalent uncompleted alias rows are displayed once',()=>{
 const id='butter|g',session=completion.update(original,{...details,id,receiptId:original.id+'|'+id,item:{key:'Butter',unit:'g',required:100,toBuy:100}}),before=JSON.stringify(session);
 const canonicalId=id=>id==='butter|g'?'salted butter|g':id;
 const rows=completion.decorate([{id:'salted butter|g',name:'Salted butter',checked:false,basketItem:{key:'salted butter',unit:'g'}},{id:'butter|g',name:'Butter',checked:false}],session,'tester',{canonicalId});
 assert.equal(rows.length,1);assert.equal(rows[0].id,id);assert.equal(rows[0].checked,true);assert.equal(rows[0].completion.receiptId,original.id+'|'+id);assert.equal(JSON.stringify(session),before);
});
test('the actual tick reader never copies an active old receipt tick into a phantom alias tick',()=>{
 const values=new Map([['ticks',JSON.stringify({'butter|g':true})],['basketboss_active_shop_session_v7',JSON.stringify({shelfEdits:{'butter|g':{kind:'shop-owned-v1'}}})]]),storage={getItem:key=>values.get(key)??null};
 const ctx=vm.createContext({localStorage:storage,BB321_SHOP_TICKS_KEY:'ticks',BB307Pantry:{pantryId:(name,unit)=>(name==='butter'?'salted butter':name)+'|'+unit},window:{BBShopOwnership:{enabled:()=>true}}});
 vm.runInContext(actual('bb321ReadShopTicks'),ctx);assert.deepEqual(JSON.parse(JSON.stringify(ctx.bb321ReadShopTicks())),{'butter|g':true});
 assert.deepEqual(JSON.parse(values.get('ticks')),{'butter|g':true});
 values.delete('basketboss_active_shop_session_v7');assert.deepEqual(JSON.parse(JSON.stringify(ctx.bb321ReadShopTicks())),{'butter|g':true,'salted butter|g':true},'old unowned tick compatibility stays available');
});

test('a used purchase stays Bought without hiding a later meal shortfall for the same food',()=>{
 const saved=completion.update(original,details),pending={id:details.id,name:'Chicken breast',checked:false,basketItem:{key:'Chicken breast',unit:'g',required:600,pantryUsed:533.333333,toBuy:66.666667}};
 const context={receiptIdFor:()=>details.receiptId+'|home:1'},rows=completion.decorate([pending],saved,'tester',context);
 assert.equal(rows.length,2);assert.equal(rows.find(row=>row.id===details.id).checked,false);assert.equal(rows.find(row=>row.id===details.id).basketItem.toBuy,66.666667);
 const history=rows.find(row=>row.completion);assert.equal(history.checked,true);assert.equal(history.completion.historical,true);assert.equal(history.id,'bought:'+details.receiptId);
 assert.equal(history.completion.amount,details.amount);assert.equal(saved.completedPurchases[details.id].receiptId,details.receiptId);
});
test('a later purchase generation keeps the first purchase history until the trip is explicitly finished',()=>{
 const first=completion.update(original,details),nextDetails={...details,receiptId:details.receiptId+'|home:1',amount:100},next=completion.update(first,nextDetails);
 const rows=completion.decorate([],next,'tester',{receiptIdFor:()=>nextDetails.receiptId});
 assert.equal(rows.length,2);assert.equal(rows.filter(row=>row.checked).length,2);assert.equal(rows.filter(row=>row.completion.historical).length,1);
 assert.equal(next.completedPurchaseHistory[details.receiptId].amount,details.amount);assert.equal(next.completedPurchases[details.id].amount,100);
 assert.deepEqual(completion.decorate([],{id:'shop-new',completedPurchases:{}},'tester'),[]);
});

test('a smaller confirmed amount has a Bought record alongside the remaining To buy row',()=>{
 const saved=completion.update(original,{...details,amount:20}),pending={id:details.id,name:'Chicken breast',checked:false,basketItem:{key:'Chicken breast',unit:'g',toBuy:67,required:600}};
 const rows=completion.decorate([pending],saved,'tester',{receiptIdFor:()=>details.receiptId});
 assert.equal(rows.length,2);assert.equal(rows.find(row=>row.id===details.id).checked,false);assert.equal(rows.find(row=>row.id===details.id).basketItem.toBuy,67);
 const purchase=rows.find(row=>row.purchaseId===details.id);assert.equal(purchase.checked,true);assert.equal(purchase.completion.purchaseOnly,true);assert.equal(purchase.completion.historical,undefined);assert.equal(purchase.completion.amount,20);
});

test('increasing the plan during an active trip keeps the old purchase Bought and exposes the extra requirement',()=>{
 const saved=completion.update(original,details),expanded={id:details.id,name:'Chicken breast',checked:false,basketItem:{key:'Chicken breast',unit:'g',required:700,pantryUsed:533.333333,toBuy:166.666667}};
 const before=JSON.stringify([saved,expanded]),rows=completion.decorate([expanded],saved,'tester',{receiptIdFor:()=>details.receiptId});
 assert.equal(rows.length,2);assert.equal(rows.find(row=>row.id===details.id).checked,false);assert.equal(rows.find(row=>row.id===details.id).basketItem.toBuy,166.666667);
 const bought=rows.find(row=>row.completion);assert.equal(bought.checked,true);assert.equal(bought.completion.amount,67);assert.equal(bought.completion.purchaseOnly,true);assert.equal(JSON.stringify([saved,expanded]),before);
});
