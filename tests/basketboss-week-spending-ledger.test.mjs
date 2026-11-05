import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),api=require('../bb-reduced-purchases.js');
const now=Date.parse('2026-11-05T12:00:00Z'),context={actor:'week-family',market:'UK'};
const session=()=>({version:7,id:'week-shop'});
const purchase=(extra={})=>({...context,id:'rice|g',purchaseId:'rice|g',name:'Rice',unit:'g',quantity:500,shopSessionId:'week-shop',at:now,...extra});
const quote={amount:2,packQty:500,shelfPrice:2},line={id:'rice|g',name:'Rice',unit:'g',quantity:1000,amount:4};
const progress=quantity=>({ticks:{'rice|g':true},purchases:{'rice|g':{actualQty:quantity,unit:'g',bbBetaSelectedWeek:'week-shop'}}});
const reprice=(_line,quantity)=>({amount:Math.ceil((quantity-1e-10)/500)*2});
const receipt=(lines,extra={})=>({...context,receiptId:'ordinary-receipt',shopSessionId:'week-shop',at:now,lines,...extra});
const receiptLine=(extra={})=>({lineId:'rice-line',purchaseId:'rice|g',name:'Rice',unit:'g',quantity:500,pricePaid:1.5,reduced:false,priceSource:'receipt',manualCoverageQuantity:500,...extra});

test('ordinary shopping spend survives Finish and remains separate from reduced-stock pins',()=>{
 const active=api.putCost(session(),purchase(),quote);
 assert.equal(api.costs(active,context,progress(500)).length,1);assert.equal(api.eligible(active,context,progress(500)).length,0);assert.equal(api.stockCredits(active,context,progress(500)).length,0);
 assert.deepEqual(api.budget({total:4,lines:[line],session:active,context,progress:progress(500),quote:reprice,now}),{total:4,pending:0,actualReduced:0,reducedSavings:0});
 const archived={...active,closedAt:new Date(now).toISOString()};
 assert.equal(api.budget({total:2,archives:{trip:archived},session:{id:'next'},context,quote:reprice,now}).total,4,'500g moved At home leaves £2 to buy plus £2 already spent');
 assert.equal(api.budget({total:0,archives:{trip:archived},context,quote:reprice,now}).total,2,'using the purchased stock cannot erase its spending');
 assert.equal(api.budget({total:2,archives:{trip:archived},context,quote:reprice,now:now+7*86400000}).total,2,'old trip costs do not leak into next week');
});
test('normal receipts replace an estimated trip cost once, including receipt replay and no-stock review',()=>{
 const active=api.putCost(session(),purchase(),quote),packet=receipt([receiptLine()]);
 const next=api.recordReceipt(active,packet);assert.equal(next.reducedPurchases['rice|g'],undefined);
 assert.equal(api.budget({total:2,session:next,context,quote:reprice,now}).total,3.5);
 assert.deepEqual(api.recordReceipt(next,{...packet,at:now+1000}),next);
 const noStock=api.recordReceipt(active,{...packet,deposited:false});
 assert.equal(api.budget({total:4,lines:[line],session:noStock,context,progress:progress(500),quote:reprice,now}).total,3.5,'receipt payment replaces only its forecast quantity');
});
test('partial ordinary receipts replace only the covered forecast, using the original pack basis',()=>{
 const active=api.putCost(session(),purchase({quantity:1000}),{...quote,amount:4});
 const partial=api.recordReceipt(active,receipt([receiptLine()]));
 assert.equal(api.budget({total:2,lines:[{...line,quantity:500,amount:2}],session:partial,context,progress:progress(1000),quote:reprice,now}).total,3.5);
 const complete=api.recordReceipt(partial,receipt([receiptLine({pricePaid:1.25})],{receiptId:'second-receipt'}));
 assert.equal(api.budget({total:0,session:complete,context,quote:reprice,now}).total,2.75);
});
test('an unknown purchase price stays pending rather than becoming free or NaN',()=>{
 const active=api.putCost(session(),purchase(),{amount:null});
 const cost=api.budget({total:2,lines:[{...line,quantity:500,amount:2}],session:active,context,progress:progress(500),quote:reprice,now});
 assert.equal(cost.total,0);assert.equal(cost.pending,1);assert.equal(Number.isFinite(cost.total),true);
 const partial=api.recordReceipt(api.putCost(session(),purchase({quantity:1000}),{amount:4}),receipt([receiptLine()]));
 const result=api.budget({total:2,lines:[{...line,quantity:500,amount:2}],session:partial,context,progress:progress(1000),quote:reprice,now});
 assert.equal(result.total,1.5);assert.equal(result.pending,1,'without a historical pack basis the uncovered estimate is not invented');
});
test('a normal zero-cost receipt is valid without making zero-price reduced claims',()=>{
 const free=api.recordReceipt(session(),receipt([receiptLine({pricePaid:0})]));
 assert.equal(api.budget({total:0,session:free,context,quote:reprice,now}).total,0);
 assert.throws(()=>api.record({...purchase(),pricePaid:0}));
});
test('invalid initial totals and broken quote results cannot escape as NaN, Infinity or negative money',()=>{
 for(const total of [NaN,Infinity,-1,Number.MAX_VALUE]){const value=api.budget({total,pending:Infinity,context,quote:reprice,now});assert.equal(value.total,0);assert.equal(value.pending,1);}
 const active=api.putCost(session(),purchase(),quote);
 for(const quote of [()=>({amount:NaN}),()=>({amount:Infinity}),()=>({amount:-1}),()=>{throw Error('offline');}]){
  const result=api.budget({total:4,lines:[line],session:active,context,progress:progress(500),quote,now});assert.equal(result.total,2);assert.equal(result.pending,1);
 }
});
test('currency addition uses cents across many trips and includes every current-week snapshot',()=>{
 const archives={};for(let index=0;index<30;index++){const id='trip-'+index;archives[id]={...api.putCost({id},purchase({id:'r'+index,purchaseId:'r'+index,shopSessionId:id,pricePaid:index%2?.2:.1})),closedAt:new Date(now).toISOString()};}
 const result=api.budget({total:10.49,archives,context,quote:reprice,now});assert.equal(result.total,14.99);assert.equal(String(result.total),'14.99');
});
test('metric-prefix changes do not double-count an active purchase or its receipt',()=>{
 const active=api.putCost(session(),purchase({unit:'kg',quantity:.5}),{amount:2,packQty:.5,shelfPrice:2});
 assert.equal(api.costs(active,context,progress(500)).length,1);
 assert.equal(api.budget({total:4,lines:[line],session:active,context,progress:progress(500),quote:reprice,now}).total,4);
 const receipted=api.recordReceipt(active,receipt([receiptLine()]));assert.equal(receipted.reducedPurchases['rice|g'],undefined);assert.equal(api.budget({total:2,session:receipted,context,quote:reprice,now}).total,3.5);
});
test('mixed actual-payment overlap becomes pending instead of charging the same covered receipt twice',()=>{
 const active=api.put(session(),{...purchase({quantity:1000}),pricePaid:2});
 const mixed=api.recordReceipt(active,receipt([receiptLine({quantity:750,pricePaid:1.5,manualCoverageQuantity:500})]));
 const result=api.budget({total:0,session:{...mixed,closedAt:new Date(now).toISOString()},archives:{one:{...mixed,closedAt:new Date(now).toISOString()}},context,progress:progress(1000),quote:reprice,now});
 assert.equal(result.total,2);assert.equal(result.pending,1,'the extra 250g has no defensible separate paid total');
});
test('US rollover follows the device calendar while UK rollover uses London time',()=>{
 const script=`const api=require(${JSON.stringify(require.resolve('../bb-reduced-purchases.js'))});const at=Date.parse('2026-11-09T02:00:00Z');process.stdout.write(JSON.stringify([api.week(at,'US'),api.week(at,'UK'),api.week(at)]));`;
 const result=JSON.parse(execFileSync(process.execPath,['-e',script],{encoding:'utf8',env:{...process.env,TZ:'America/Los_Angeles'}}));
 assert.deepEqual(result,['2026-11-02','2026-11-09','2026-11-09']);
});
test('one receipt can supersede both reduced and ordinary portions without reusing its coverage',()=>{
 const reduced=api.put(session(),{...purchase(),pricePaid:1});
 const mixed=api.putCost(reduced,purchase({id:'cost:rice|g'}),quote);
 assert.equal(api.budget({total:4,lines:[line],session:mixed,context,progress:progress(1000),quote:reprice,now}).total,3);
 const packet=receipt([receiptLine({quantity:1000,pricePaid:2.5,manualCoverageQuantity:1000})]);
 const confirmed=api.recordReceipt(mixed,packet);assert.equal(Object.keys(confirmed.reducedPurchases).length,1);
 assert.equal(api.budget({total:0,session:confirmed,context,quote:reprice,now}).total,2.5);assert.deepEqual(api.recordReceipt(confirmed,packet),confirmed);
 const half=api.recordReceipt(mixed,receipt([receiptLine({quantity:500,pricePaid:.75,manualCoverageQuantity:1000,reduced:true})]));
 assert.ok(half.reducedPurchases['cost:rice|g'],'500g receipt cannot discharge 1000g of trip entries');
 assert.equal(api.budget({total:0,session:{...half,closedAt:new Date(now).toISOString()},archives:{},context,progress:progress(1000),quote:reprice,now}).total,2.75);
 const normalHalf=api.recordReceipt(mixed,receipt([receiptLine({quantity:500,pricePaid:2,manualCoverageQuantity:500})]));assert.ok(normalHalf.reducedPurchases['rice|g'],'ordinary receipt replaces the ordinary portion before a same-ingredient reduced purchase');
 assert.equal(api.budget({total:0,session:{...normalHalf,closedAt:new Date(now).toISOString()},context,progress:progress(1000),quote:reprice,now}).total,3);
});
test('pack bases follow the purchase unit when the quote uses canonical metric units',()=>{
 const active=api.putCost(session(),purchase({quantity:1,unit:'kg'}),{amount:4,packQty:500,packUnit:'g',shelfPrice:2});
 assert.deepEqual(active.reducedPurchases['rice|g'].priceBasis,{quantity:.5,price:2});
 const partial=api.recordReceipt(active,receipt([receiptLine()]));
 assert.equal(api.budget({total:2,lines:[{...line,quantity:500,amount:2}],session:partial,context,progress:progress(1000),quote:reprice,now}).total,3.5);
});
test('a priced unmeasured receipt remains an expense without inventing food stock',()=>{
 const packet=receipt([{lineId:'unknown-amount',name:'Rice',pricePaid:3,reduced:false,priceSource:'receipt',expenseOnly:true}]);
 const value=api.recordReceipt(session(),packet),row=Object.values(value.reducedPurchases)[0];assert.equal(row.expenseOnly,true);assert.equal(row.unit,'pack');assert.equal(row.quantity,1);
 assert.equal(api.budget({total:0,session:value,context,quote:reprice,now}).total,3);assert.equal(api.stockCredits(value,context,{}).length,0);assert.deepEqual(api.recordReceipt(value,packet),value);
});
test('unmeasured linked receipt overlap stays pending without adding a second copy of its forecast or payment',()=>{
 const packet=receipt([{lineId:'unknown-amount',name:'Rice',purchaseId:'rice|g',pricePaid:3,reduced:false,priceSource:'receipt',expenseOnly:true}]);
 for(const manual of [api.putCost(session(),purchase({quantity:1000}),{...quote,amount:4}),api.put(session(),{...purchase({quantity:1000}),pricePaid:2})]){
  const value=api.recordReceipt(manual,packet),result=api.budget({total:4,lines:[line],session:value,context,progress:progress(1000),quote:reprice,now});
  assert.equal(result.total,3);assert.equal(result.pending,1);assert.equal(api.budget({total:0,session:{...value,closedAt:new Date(now).toISOString()},context,progress:progress(1000),quote:reprice,now}).total,3);
 }
});
test('ambiguous unmeasured receipt matches preserve all records and merge overlapping payment candidates once',()=>{
 let active=api.putCost(session(),purchase({id:'cost:first',purchaseId:'first',pricePaid:2}));active=api.putCost(active,purchase({id:'cost:second',purchaseId:'second',pricePaid:3}));
 const packet=receipt([{lineId:'a',name:'Rice',pricePaid:4,reduced:false,priceSource:'receipt',expenseOnly:true,coveredPurchaseIds:['first','second']},{lineId:'b',name:'Rice',pricePaid:1,reduced:false,priceSource:'receipt',expenseOnly:true,coveredPurchaseIds:['first']}]);
 const value=api.recordReceipt(active,packet),archived={...value,closedAt:new Date(now).toISOString()};
 const result=api.budget({total:0,archives:{one:archived},context,quote:reprice,now});assert.equal(result.total,5);assert.equal(result.pending,1);assert.equal(Object.keys(value.reducedPurchases).length,4,'uncertain matching cannot delete either payment or receipt evidence');
 assert.deepEqual(api.recordReceipt(value,packet),value);
});
test('ambiguous known expenses remain pending and keep their known cost when no candidate has a trip ledger yet',()=>{
 const value=api.recordReceipt(session(),receipt([{lineId:'a',name:'Soap',pricePaid:3,reduced:false,expenseOnly:true,coveredPurchaseIds:['ess:one','ess:two']}]));
 const result=api.budget({total:0,session:value,context,quote:reprice,now});assert.equal(result.total,3);assert.equal(result.pending,1);
});
test('unsafe expense-only candidate sets cannot enter the spending ledger',()=>{
 for(const coveredPurchaseIds of [[],['constructor'],['same','same'],Array.from({length:101},(_,index)=>'item-'+index)])assert.throws(()=>api.recordReceipt(session(),receipt([{lineId:'a',name:'Soap',pricePaid:3,reduced:false,expenseOnly:true,coveredPurchaseIds}])));
});
test('a partial receipt cannot erase the historical ordinary estimate when checkout progress becomes receipt-backed',()=>{
 const manual=api.put(session(),{...purchase({quantity:1000}),pricePaid:2}),mixed=api.putCost(manual,purchase({id:'cost:rice|g'}),quote);
 const value=api.recordReceipt(mixed,receipt([receiptLine({quantity:500,reduced:true,pricePaid:.5,manualCoverageQuantity:500})]));
 const receiptProgress={ticks:{'rice|g':true},purchases:{'rice|g':{qty:1500,actualQty:1500,unit:'g',bbBetaSelectedWeek:'week-shop',receiptInventoryReceiptId:'ordinary-receipt'}}};
 const result=api.budget({total:10,lines:[{...line,quantity:1000,amount:10}],session:value,context,progress:receiptProgress,quote:(_line,q)=>({amount:Math.ceil(q/500)*5}),now});
 assert.equal(result.total,4,'the existing £2 ordinary portion is not repriced at the later £5 baseline');
});
test('corrupt current-account cost records require review rather than silently pretending the trip was free',()=>{
 const value=api.putCost(session(),purchase(),quote);value.reducedPurchases['rice|g'].pricePaid=Infinity;
 const result=api.budget({total:4,lines:[line],session:value,context,progress:progress(500),quote:reprice,now});assert.equal(result.total,4);assert.equal(result.pending,1);
 assert.equal(api.budget({total:4,session:value,context:{...context,actor:'other'},quote:reprice,now}).pending,0,'another account cannot leak its record validity');
 assert.throws(()=>api.putCost(session(),purchase({at:1e308}),quote));
});
