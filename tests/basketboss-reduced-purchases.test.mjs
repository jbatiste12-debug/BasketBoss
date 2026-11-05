import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)('../bb-reduced-purchases.js');
const now=Date.parse('2026-11-05T12:00:00Z'),context={actor:'tester',market:'UK'},session=()=>({version:7,id:'shop-one'});
const purchase=(extra={})=>({...context,id:'rice|g',name:'Rice',unit:'g',quantity:500,pricePaid:1,shopSessionId:'shop-one',at:now,...extra});
const progress=(quantity=500)=>({ticks:{'rice|g':true},purchases:{'rice|g':{actualQty:quantity,unit:'g',bbBetaSelectedWeek:'shop-one'}},partials:{}});
const line={id:'rice|g',name:'Rice',unit:'g',quantity:1000,amount:4};
const quote=(_line,quantity)=>({amount:Math.ceil(quantity/500)*2});
test('recording a reduced purchase is a pure proposal and never edits a usual price baseline',()=>{
 const old=session(),before=JSON.stringify(old),result=api.put(old,purchase());assert.equal(JSON.stringify(old),before);assert.equal(result.reducedPurchases['rice|g'].pricePaid,1);assert.equal(result.reducedPurchases['rice|g'].currency,'GBP');assert.equal(Object.hasOwn(result,'shelfEdits'),false);
});
test('only actual purchases matching actor, region, trip, unit and quantity affect spending or stock metadata',()=>{
 const value=api.put(session(),purchase());assert.equal(api.eligible(value,context,progress()).length,1);
 for(const changes of [{actor:'other'},{market:'Guernsey'}])assert.equal(api.eligible(value,{...context,...changes},progress()).length,0);
 for(const data of [{ticks:{},purchases:{},partials:{}},progress(100),{...progress(),purchases:{'rice|g':{actualQty:500,unit:'ml',bbBetaSelectedWeek:'shop-one'}}},{...progress(),purchases:{'rice|g':{actualQty:500,unit:'g',bbBetaSelectedWeek:'shop-old'}}}])assert.equal(api.eligible(value,context,data).length,0);
 assert.equal(api.stockCredits(value,context,progress())[0].quantity,500);assert.equal(api.eligible({...value,id:'shop-other'},context,progress()).length,0);
});
test('a reduced partial purchase replaces one pack cost and estimates only what remains',()=>{
 const value=api.put(session(),purchase()),budget=api.budget({total:4,lines:[line],session:value,context,progress:progress(),quote,now});assert.deepEqual(budget,{total:3,pending:0,actualReduced:1,reducedSavings:1});
 const full=api.put(session(),purchase({quantity:1000,pricePaid:1.5}));assert.equal(api.budget({total:4,lines:[line],session:full,context,progress:progress(1000),quote,now}).total,1.5);
});
test('unchecking removes an active purchase cost and quantity mismatches cannot manufacture savings',()=>{
 const value=api.put(session(),purchase());assert.equal(api.budget({total:4,lines:[line],session:value,context,progress:{},quote,now}).total,4);
 assert.equal(api.budget({total:4,lines:[{...line,unit:'ml'}],session:value,context,progress:progress(),quote,now}).total,5,'paid stock remains a real expense but incompatible requirements are not discounted');
});
test('completed trips retain actual spending in their calendar week without making next week prices cheaper',()=>{
 const prior={...api.put(session(),purchase()),closedAt:new Date(now).toISOString()};
 assert.equal(api.budget({total:0,lines:[],session:{id:'shop-next'},archives:{one:prior},context,quote,now}).total,1);
 assert.equal(api.budget({total:4,lines:[line],session:{id:'shop-next'},archives:{one:prior},context,quote,now:now+7*86400000}).total,4);
 assert.equal(api.budget({total:0,lines:[],session:prior,archives:{one:prior},context,progress:progress(),quote,now}).total,1,'archival duplicate is counted once');
});
test('unknown guide prices become known actual spending only for the covered amount',()=>{
 const full=api.put(session(),purchase({quantity:1000})),partial=api.put(session(),purchase());
 assert.equal(api.budget({total:0,pending:1,lines:[{...line,amount:null}],session:full,context,progress:progress(1000),quote:()=>({amount:null}),now}).pending,0);
 const result=api.budget({total:0,pending:1,lines:[{...line,amount:null}],session:partial,context,progress:progress(),quote:()=>({amount:null}),now});assert.equal(result.total,1);assert.equal(result.pending,1);
});
test('a confirmed receipt supersedes manual logging, retries once, and keeps offers out of baseline learning',()=>{
 const value=api.put(session(),purchase()),packet={...context,receiptId:'receipt-one',shopSessionId:'shop-one',at:now,lines:[{lineId:'line-one',purchaseId:'rice|g',name:'Rice',unit:'g',quantity:500,pricePaid:.5,manualCoverageQuantity:500}]};
 const receipted=api.recordReceipt(value,packet);assert.equal(Object.keys(receipted.reducedPurchases).length,1);assert.equal(receipted.reducedPurchases['rice|g'],undefined);
 assert.deepEqual(api.recordReceipt(receipted,{...packet,at:now+1000}),receipted);assert.throws(()=>api.recordReceipt(receipted,{...packet,lines:[{...packet.lines[0],pricePaid:1}]}));
 assert.equal(api.budget({total:2,lines:[{...line,quantity:500,amount:2}],session:receipted,context,quote,now}).total,2.5,'deposited receipt does not discount a shortfall already reduced by pantry');
 assert.equal(api.stockCredits(receipted,context,progress()).length,0,'receipt stock is not credited again by Finish');
});
test('multiple receipt lines for one non-deposited item aggregate before applying the remaining need',()=>{
 const packet={...context,receiptId:'receipt-one',shopSessionId:'shop-one',at:now,deposited:false,lines:[{lineId:'a',purchaseId:'rice|g',name:'Rice',unit:'g',quantity:500,pricePaid:.5},{lineId:'b',purchaseId:'rice|g',name:'Rice',unit:'g',quantity:500,pricePaid:.7}]};
 const value=api.recordReceipt(session(),packet),result=api.budget({total:4,lines:[line],session:value,context,quote,now});assert.equal(result.total,1.2);assert.equal(result.actualReduced,1.2);
});
test('invalid amounts, unsafe identities and fractional count quantities cannot become purchase records',()=>{
 for(const change of [{pricePaid:0},{pricePaid:.001},{pricePaid:Infinity},{quantity:-1},{quantity:.5,unit:'each'},{actor:'__proto__'},{id:'constructor'},{market:'Unknown'}])assert.throws(()=>api.record(purchase(change)));
 assert.equal(api.week(Date.parse('2026-10-25T00:30:00Z')),'2026-10-19');assert.equal(api.week(Date.parse('2026-10-26T00:01:00Z')),'2026-10-26');
});

test('a partial receipt preserves the original paid total until all of the matching manual purchase is covered',()=>{
 const manual=api.put(session(),purchase({quantity:1000,pricePaid:2}));
 const packet={...context,receiptId:'receipt-part',shopSessionId:'shop-one',at:now,lines:[{lineId:'a',purchaseId:'rice|g',name:'Rice',unit:'g',quantity:500,pricePaid:.5,manualCoverageQuantity:500}]};
 const first=api.recordReceipt(manual,packet);assert.equal(first.reducedPurchases['rice|g'].quantity,1000);assert.equal(first.reducedPurchases['rice|g'].pricePaid,2);assert.equal(first.reducedPurchases['rice|g'].depositedQuantity,500);
 const cost=api.budget({total:2,lines:[{...line,quantity:500,amount:2}],session:first,context,progress:progress(1000),quote,now});assert.equal(cost.total,2,'the covered receipt is not charged twice');
 const next=api.recordReceipt(first,{...packet,receiptId:'receipt-rest',lines:[{...packet.lines[0],pricePaid:.7}]});assert.equal(next.reducedPurchases['rice|g'],undefined);assert.equal(next.reducedSuperseded['rice|g'].pricePaid,2);
 assert.equal(api.budget({total:0,session:next,context,quote,now}).total,1.2,'complete receipts now supply the actual full cost');
 assert.deepEqual(api.recordReceipt(first,{...packet,at:now+5000}),first,'retry never advances partial receipt coverage again');
});
