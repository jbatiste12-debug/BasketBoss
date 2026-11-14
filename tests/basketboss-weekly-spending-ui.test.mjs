import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),core=require('../bb-reduced-purchases.js'),ui=require('../bb-weekly-spending-ui.js');
const now=Date.parse('2026-11-12T12:00:00Z'),context={actor:'weekly-ui-actor',market:'Guernsey'};
const money=value=>'£'+value.toFixed(2);
const session=id=>({version:7,id});
const input=(id,changes={})=>({...context,id:'cost:rice|g',purchaseId:'rice|g',shopSessionId:id,name:'Rice',unit:'g',quantity:500,at:now,...changes});
const closed=value=>({...value,closedAt:new Date(now).toISOString()});
const actual=(id,price,changes={})=>closed(core.putCost(session(id),input(id,{pricePaid:price,...changes})));
const progress=id=>({ticks:{'rice|g':true},purchases:{'rice|g':{actualQty:500,unit:'g',bbBetaSelectedWeek:id}},partials:{}});
const view=changes=>ui.view({shoppingSpend:99.40,shoppingPending:0,baseTotal:99.40,basePending:0,ledger:core,session:session('shop-active'),archives:{},context,progress:{},now,money,...changes});

function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const row of Object.values(value))freeze(row);}return value;}

test('recorded purchases are read through the existing zero-requirement ledger calculation',()=>{
 const archive=actual('shop-finished',40),active=core.putCost(session('shop-active'),input('shop-active',{pricePaid:2,deposited:true})),quotes=[];
 const quote=(...args)=>{quotes.push(args);return {amount:0};};
 let call;
 const ledger={...core,budget:options=>{assert.equal(call,undefined,'one existing ledger read');call=options;return core.budget(options);}};
 const options=freeze({shoppingSpend:12.40,shoppingPending:0,baseTotal:54.40,basePending:0,ledger,session:active,archives:{finished:archive},context,progress:progress('shop-active'),quote,now,money});
 const before=JSON.stringify(options),result=ui.view(options);
 assert.equal(call.total,0);assert.equal(call.pending,0);assert.deepEqual(call.lines,[]);
 for(const key of ['session','archives','context','progress','quote'])assert.equal(call[key],options[key],key+' keeps the existing ledger inputs');
 assert.equal(result.recordedKnown,42);assert.equal(result.leftToBuy,12.40);assert.equal(result.combinedTotal,54.40);
 assert.equal(result.leftToBuyText,'£12.40');assert.equal(result.recordedText,'£42.00');assert.equal(result.combinedText,'£54.40');
 assert.equal(JSON.stringify(options),before,'presentation never writes history, quantities, progress or prices');assert.deepEqual(quotes,[],'no requirement quote is introduced into the recorded-only read');
});

test('calendar week, actor and market filters remain those of the existing purchase ledger',()=>{
 const archives={own:actual('shop-own',10),otherActor:actual('shop-other-actor',900,{actor:'another-actor'}),otherMarket:actual('shop-other-market',800,{market:'UK'}),old:actual('shop-last-week',700,{at:now-7*86400000})};
 const before=JSON.stringify(archives),result=view({archives,baseTotal:109.40});
 assert.equal(result.recordedKnown,10);assert.equal(result.combinedTotal,109.40);
 assert.equal(result.weekStart,'2026-11-09');assert.equal(result.weekEnd,'2026-11-15');assert.match(result.periodText,/9 Nov.*15 Nov 2026/);
 assert.equal(JSON.stringify(archives),before);
 const next=view({archives,now:now+7*86400000});assert.equal(next.recordedKnown,0);assert.equal(next.combinedTotal,99.40);assert.equal(next.weekStart,'2026-11-16');
});

test('an active trip also present in the archive contributes its purchase only once',()=>{
 const active=actual('shop-active',3.10),before=JSON.stringify(active);
 const result=view({session:active,archives:{duplicate:active},progress:progress(active.id),baseTotal:102.50});
 assert.equal(result.recordedKnown,3.10);assert.equal(result.combinedTotal,102.50);assert.equal(JSON.stringify(active),before);
});

test('ordinary estimates, manual prices and receipt replacement are counted without double charging covered purchases',()=>{
 const estimate=closed(core.putCost(session('shop-estimated'),input('shop-estimated'),{amount:2.50,packQty:500,packUnit:'g',shelfPrice:2.50}));
 const original=core.putCost(session('shop-receipt'),input('shop-receipt',{pricePaid:4}));
 const packet={...context,receiptId:'receipt-weekly-ui',shopSessionId:'shop-receipt',at:now,deposited:true,lines:[{lineId:'rice-line',purchaseId:'rice|g',name:'Rice',unit:'g',quantity:500,pricePaid:1.75,manualCoverageQuantity:500}]};
 const receipted=closed(core.recordReceipt(original,packet)),archives=freeze({manual:actual('shop-manual',3.10),estimate,receipted});
 const before=JSON.stringify(archives),result=view({archives,shoppingSpend:10,baseTotal:17.35});
 assert.equal(result.recordedKnown,7.35);assert.equal(result.combinedTotal,17.35);assert.match(result.recordedNote,/can include estimates/);
 assert.equal(core.rows(receipted)['cost:rice|g'],undefined,'the existing receipt path supplies replacement coverage');
 assert.equal(JSON.stringify(archives),before);assert.equal(core.rows(original)['cost:rice|g'].pricePaid,4,'the original proposal remains unchanged');
});

test('unticked active estimates do not become recorded spending',()=>{
 const active=core.putCost(session('shop-active'),input('shop-active'),{amount:3,packQty:500,packUnit:'g',shelfPrice:3});
 const result=view({session:active,progress:{}});assert.equal(result.recordedKnown,0);assert.equal(result.combinedTotal,99.40);
});

test('no purchase override leaves displayed combined spending equal to the original core total',()=>{
 const archive=actual('shop-finished',40),options={total:12.40,pending:0,lines:[{id:'rice|g',name:'Rice',unit:'g',quantity:500,amount:12.40}],session:session('shop-active'),archives:{finished:archive},context,progress:{},now};
 const original=core.budget(options),before=JSON.stringify(options),result=view({...options,shoppingSpend:12.40,baseTotal:original.total,basePending:original.pending});
 assert.equal(original.total,52.40);assert.equal(result.combinedTotal,original.total);assert.equal(result.combinedPending,original.pending);
 assert.equal(JSON.stringify(options),before);assert.deepEqual(core.budget(options),original);
});

test('selected pack amounts and manual price estimates alter only the display layer',()=>{
 const archives=freeze({finished:actual('shop-finished',40)}),options={total:12.40,pending:0,lines:[],session:session('shop-active'),archives,context,progress:{},now};
 const original=core.budget(options),before=JSON.stringify(options);
 const smallerPack=view({...options,shoppingSpend:10.25,baseTotal:original.total});
 const customPrice=view({...options,shoppingSpend:7.65,baseTotal:original.total});
 assert.equal(smallerPack.combinedTotal,50.25);assert.equal(customPrice.combinedTotal,47.65);
 assert.equal(smallerPack.recordedKnown,40);assert.equal(customPrice.recordedKnown,40);
 assert.equal(JSON.stringify(options),before);assert.deepEqual(core.budget(options),original);assert.equal(original.total,52.40);
});

test('a numeric guide for an unpriced item contributes to presentation without rewriting the unpriced core quote',()=>{
 const archives=freeze({finished:actual('shop-finished',40)}),options={total:12.40,pending:1,lines:[{id:'custom|each',unit:'each',quantity:1,amount:null}],session:session('shop-active'),archives,context,progress:{},now};
 const original=core.budget(options),before=JSON.stringify(options),result=view({...options,shoppingSpend:14.90,shoppingPending:0,baseTotal:original.total,basePending:original.pending});
 assert.equal(original.total,52.40);assert.equal(original.pending,1);assert.equal(result.combinedTotal,54.90);assert.equal(result.recordedKnown,40);
 assert.equal(JSON.stringify(options),before);assert.deepEqual(core.budget(options),original);assert.equal(options.lines[0].amount,null);
});

test('unknown historical prices remain explicitly pending rather than becoming a known zero',()=>{
 const unknown=closed(core.putCost(session('shop-unpriced'),input('shop-unpriced'),{amount:null}));
 const result=view({archives:{unknown},shoppingPending:2});
 assert.equal(result.recordedKnown,0);assert.equal(result.recordedPending,1);assert.equal(result.combinedPending,3);
 assert.match(result.recordedNote,/prices need checking/);assert.match(result.combinedNote,/prices.*checking/);
 assert.doesNotMatch(result.combinedText,/\+|NaN|undefined|null/);
});

test('missing or failed history leaves the original combined estimate intact without inferring a recorded amount',()=>{
 for(const ledger of [null,{}, {budget(){throw Error('private provider detail');}},{budget:()=>({total:NaN,pending:0})},{budget:()=>({total:10,pending:-1})}]){
  const result=view({ledger,baseTotal:406.06,basePending:1});
  assert.equal(result.recordedAvailable,false);assert.equal(result.recordedKnown,null);assert.equal(result.recordedText,'Unavailable');assert.equal(result.combinedTotal,406.06);assert.equal(result.combinedPending,1);
  assert.equal(result.combinedLabel,'Existing weekly estimate');assert.doesNotMatch(JSON.stringify(result),/private provider detail|NaN|undefined/);
 }
});

test('week labels use the ledger calendar across a year boundary',()=>{
 const result=view({now:Date.parse('2027-01-01T12:00:00Z')});
 assert.equal(result.weekStart,'2026-12-28');assert.equal(result.weekEnd,'2027-01-03');assert.match(result.periodText,/2026.*2027/);
});
