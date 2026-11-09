/* Actual yellow-sticker costs belong to a purchase and trip, never a usual
   shelf-price override. Pure proposals are committed by the existing journal. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBReducedPurchases=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const CURRENCY={UK:'GBP',Guernsey:'GBP',Jersey:'GBP',US:'USD'},UNITS=new Set(['each','pack','clove','g','kg','ml','l']);
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const finite=(value,max=1000000)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max;
 const safe=(value,max=180)=>typeof value==='string'&&value.trim()===value&&!!value&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
 const round=value=>Math.round((value+Number.EPSILON)*100)/100;
 const cents=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round((value+Number.EPSILON)*100))?Math.round((value+Number.EPSILON)*100):null;
 const clone=value=>JSON.parse(JSON.stringify(value));
 function convert(quantity,from,to){if(from===to)return quantity;const factors={g:1,kg:1000,ml:1,l:1000},family=unit=>['g','kg'].includes(unit)?'weight':['ml','l'].includes(unit)?'volume':null;return family(from)&&family(from)===family(to)?quantity*factors[from]/factors[to]:null;}
 function record(input={}){
  const reduced=input.reduced!==false,estimated=input.priceSource==='estimate';
  if(!safe(input.actor)||!Object.hasOwn(CURRENCY,input.market)||!safe(input.shopSessionId)||!safe(input.id,400)||!safe(input.purchaseId||input.id,300)||!safe(input.name,120)||!UNITS.has(input.unit)||!finite(input.quantity)||['each','pack','clove'].includes(input.unit)&&!Number.isInteger(input.quantity)||!(input.pricePaid===null&&!reduced&&estimated||cents(input.pricePaid)!==null&&input.pricePaid<=100000&&(!reduced||input.pricePaid>=.01))||!Number.isFinite(input.at)||input.at<=0||!Number.isFinite(new Date(input.at).getTime()))throw Error('Review the purchase quantity and total paid.');
  if(input.priceSource!==undefined&&!['estimate','manual','receipt'].includes(input.priceSource)||estimated&&reduced)throw Error('Review the purchase price source.');
  const kind=input.kind==='receipt'?'receipt':'manual',depositedQuantity=input.depositedQuantity??0,receiptCoveredQuantity=input.receiptCoveredQuantity??0;
  if(typeof depositedQuantity!=='number'||!Number.isFinite(depositedQuantity)||depositedQuantity<0||depositedQuantity>input.quantity||typeof receiptCoveredQuantity!=='number'||!Number.isFinite(receiptCoveredQuantity)||receiptCoveredQuantity<0||receiptCoveredQuantity>input.quantity)throw Error('Review the receipt coverage for this purchase.');
  if(kind==='receipt'&&(!safe(input.receiptId,120)||!safe(input.lineId,100)))throw Error('Review this receipt identity before saving its price.');
  let priceBasis;
  if(input.priceBasis!==undefined){const b=input.priceBasis;if(!object(b)||!finite(b.quantity)||cents(b.price)===null||b.price>100000)throw Error('Review the purchase pack price.');priceBasis={quantity:b.quantity,price:round(b.price)};}
  const coveredManualQuantity=input.coveredManualQuantity;if(coveredManualQuantity!==undefined&&(!finite(coveredManualQuantity)||coveredManualQuantity>input.quantity))throw Error('Review the receipt price coverage.');
  const coveredManualIds=input.coveredManualIds;if(coveredManualIds!==undefined&&(!Array.isArray(coveredManualIds)||!coveredManualIds.length||coveredManualIds.length>200||coveredManualIds.some(id=>!safe(id,400))||new Set(coveredManualIds).size!==coveredManualIds.length))throw Error('Review the receipt price coverage.');
  const coveredPurchaseIds=input.coveredPurchaseIds;if(coveredPurchaseIds!==undefined&&(!Array.isArray(coveredPurchaseIds)||!coveredPurchaseIds.length||coveredPurchaseIds.length>100||coveredPurchaseIds.some(id=>!safe(id,300))||new Set(coveredPurchaseIds).size!==coveredPurchaseIds.length))throw Error('Review the unmeasured receipt matches.');
  return {version:1,id:input.id,purchaseId:input.purchaseId||input.id,actor:input.actor,market:input.market,currency:CURRENCY[input.market],shopSessionId:input.shopSessionId,name:input.name,unit:input.unit,quantity:input.quantity,pricePaid:input.pricePaid===null?null:round(input.pricePaid),at:input.at,kind,deposited:input.deposited===true,...(!reduced?{reduced:false}:{}),...(input.priceSource?{priceSource:input.priceSource}:{}),...(priceBasis?{priceBasis}:{}),...(depositedQuantity>0?{depositedQuantity}:{}),...(receiptCoveredQuantity>0?{receiptCoveredQuantity}:{}),...(safe(input.coveredManualId,400)?{coveredManualId:input.coveredManualId}:{}),...(coveredManualIds?{coveredManualIds:[...coveredManualIds]}:{}),...(coveredManualQuantity?{coveredManualQuantity}:{}),...(kind==='receipt'?{receiptId:input.receiptId,lineId:input.lineId}:{}),...(kind==='receipt'&&input.expenseOnly===true?{expenseOnly:true,...(safe(input.coveredPurchaseId,300)?{coveredPurchaseId:input.coveredPurchaseId}:{}),...(coveredPurchaseIds?{coveredPurchaseIds:[...coveredPurchaseIds]}:{})}:{})};
 }
 function rows(session){return object(session?.reducedPurchases)?session.reducedPurchases:{};}
 function put(session,input){
  const next=clone(session||{}),value=record(input);if(next.id!==value.shopSessionId)throw Error('Your shopping trip changed. Reopen the purchase.');
  next.reducedPurchases={...rows(next),[value.id]:value};if(Object.keys(next.reducedPurchases).length>1000)throw Error('Finish this shop before recording more reduced purchases.');return next;
 }
 function remove(session,id){const next=clone(session||{});next.reducedPurchases={...rows(next)};delete next.reducedPurchases[id];return next;}
 function putCost(session,input={},quote){
  const explicit=input.pricePaid!==undefined,price=explicit?input.pricePaid:quote?.amount??null;
  const packQuantity=finite(quote?.packQty)?convert(quote.packQty,quote.packUnit||input.unit,input.unit):null;
  const basis=!explicit&&finite(packQuantity)&&cents(quote?.shelfPrice)!==null?{quantity:packQuantity,price:quote.shelfPrice}:undefined;
  return put(session,{...input,reduced:input.reduced===true,pricePaid:price,priceSource:input.priceSource||(explicit?'manual':'estimate'),...(basis?{priceBasis:basis}:{})});
 }
 function normalize(value,context,session){
  try{const result=record(value);return result.actor===context.actor&&result.market===context.market&&result.currency===CURRENCY[context.market]&&result.shopSessionId===session?.id?result:null;}catch{return null;}
 }
 function purchasedQuantity(id,{ticks={},purchases={},partials={},shopSessionId}={}){
  const purchase=purchases[id],partial=partials[shopSessionId+'|'+id];
  if(ticks[id]&&purchase&&!purchase.legacySnapshot&&!purchase.receiptInventoryReceiptId&&purchase.bbBetaSelectedWeek===shopSessionId){const quantity=Number(purchase.actualQty??purchase.qty);return finite(quantity)?{quantity,unit:purchase.unit}:null;}
  if(!ticks[id]&&partial?.week===shopSessionId){const quantity=Number(partial.bought);return finite(quantity)?{quantity,unit:partial.unit}:null;}
  return null;
 }
 function costs(session,context,progress={}){
  const receipted=new Set(Object.values(rows(session)).map(raw=>normalize(raw,context,session)).filter(row=>row?.kind==='receipt'&&!row.expenseOnly).map(row=>row.purchaseId));
  const result=[];for(const raw of Object.values(rows(session))){const value=normalize(raw,context,session);if(!value)continue;
   if(value.kind==='receipt'||value.receiptCoveredQuantity>0||receipted.has(value.purchaseId)){result.push(value);continue;}
   const bought=purchasedQuantity(value.purchaseId,{...progress,shopSessionId:session.id}),amount=bought?convert(bought.quantity,bought.unit,value.unit):null;if(amount!==null&&amount+1e-7>=value.quantity)result.push(value);
  }return result;
 }
 function eligible(session,context,progress={}){return costs(session,context,progress).filter(row=>row.reduced!==false);}
 function stockCredits(session,context,progress={}){return eligible(session,context,progress).filter(row=>row.kind==='manual').map(row=>({id:row.purchaseId,name:row.name,unit:row.unit,quantity:row.quantity,pricePaid:row.pricePaid,sourceId:'reduced:'+row.actor+':'+row.shopSessionId+':'+row.id+':'+row.at}));}
 // Reuse only the locale/time-zone formatter. Dates and week results remain
 // fresh on every call, including after a US device time-zone change.
 const weekFormatters=new Map();
 function weekFormatter(timeZone){
  let formatter=weekFormatters.get(timeZone);
  if(!formatter){
   formatter=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
   if(weekFormatters.size>=8)weekFormatters.delete(weekFormatters.keys().next().value);
   weekFormatters.set(timeZone,formatter);
  }
  return formatter;
 }
 function week(at,market){
  const value=new Date(at);if(!Number.isFinite(value.getTime()))return null;
  const timeZone=market==='US'?Intl.DateTimeFormat().resolvedOptions().timeZone:'Europe/London';
  const parts=weekFormatter(timeZone).formatToParts(value),get=key=>parts.find(part=>part.type===key)?.value;
  const day=new Date(get('year')+'-'+get('month')+'-'+get('day')+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);
 }
 function budget({total=0,pending=0,lines=[],session,archives={},context,progress={},quote,now=Date.now()}={}){
  let amount=cents(total)??0,unpriced=Number.isFinite(pending)&&pending>=0?Math.floor(pending):0;if(cents(total)===null)unpriced++;
  const fallback=()=>({total:amount/100,pending:unpriced,actualReduced:0,reducedSavings:0});
  if(!context||!Object.hasOwn(CURRENCY,context.market))return fallback();
  const all=[],seen=new Set(),currentWeek=week(now,context.market),lineById=new Map((Array.isArray(lines)?lines:[]).filter(line=>object(line)).map(line=>[line.id,line]));
  if(!currentWeek){unpriced++;return fallback();}
  const invalidSeen=new Set();for(const candidate of [session,...Object.values(object(archives)?archives:{})])for(const [key,raw]of Object.entries(rows(candidate))){if(!object(raw)||raw.actor!==context.actor||raw.market!==context.market||raw.shopSessionId!==candidate?.id||normalize(raw,context,candidate))continue;const at=typeof raw.at==='number'&&Number.isFinite(raw.at)?week(raw.at,context.market):null,id=String(candidate.id)+'|'+key;if((!at||at===currentWeek)&&!invalidSeen.has(id)){invalidSeen.add(id);unpriced++;}}
  for(const row of costs(session,context,progress))all.push({...row,active:true});
  for(const old of Object.values(object(archives)?archives:{})){if(!old?.closedAt)continue;for(const raw of Object.values(rows(old))){const value=normalize(raw,context,old);if(value)all.push({...value,active:false});}}
  const identity=value=>value.actor+'|'+value.shopSessionId+'|'+value.id,current=[];
  for(const row of all){const id=identity(row);if(seen.has(id)||week(row.at,context.market)!==currentWeek)continue;seen.add(id);current.push(row);}
  let actualReduced=0,savings=0;const grouped=new Map(),manualIds=new Set(current.filter(row=>row.kind==='manual').map(identity)),expenseGroups=[],financial=new Map(),expensePending=new Set();
  for(const row of current)if(row.expenseOnly&&(row.coveredPurchaseId||row.coveredPurchaseIds?.length)){
   const scope=row.actor+'|'+row.shopSessionId,ids=new Set([...(row.coveredPurchaseIds||[]),...(row.coveredPurchaseId?[row.coveredPurchaseId]:[])]),matches=expenseGroups.filter(group=>group.scope===scope&&[...ids].some(id=>group.ids.has(id)));
   const group={scope,ids,expenses:[row]};for(const previous of matches){for(const id of previous.ids)group.ids.add(id);group.expenses.push(...previous.expenses);expenseGroups.splice(expenseGroups.indexOf(previous),1);}expenseGroups.push(group);
  }
  for(const {scope,ids,expenses}of expenseGroups){const manuals=current.filter(row=>row.kind==='manual'&&row.actor+'|'+row.shopSessionId===scope&&ids.has(row.purchaseId));if(!manuals.length){if(ids.size>1)expensePending.add(identity(expenses[0]));continue;}
   const receiptsPaid=expenses.reduce((sum,row)=>sum+(cents(row.pricePaid)??0),0),actualPaid=manuals.filter(row=>row.priceSource!=='estimate').reduce((sum,row)=>sum+(cents(row.pricePaid)??0),0);
   // A price-only receipt has no defensible quantity allocation. Keep the
   // known payment floor once, leave quantity-based forecasts separate, and
   // mark the overlap for review rather than double-charging both records.
   for(const row of [...manuals,...expenses])financial.set(identity(row),0);
   financial.set(identity(expenses[0]),Math.max(receiptsPaid,actualPaid));expensePending.add(identity(expenses[0]));
  }
  for(const value of current){const id=identity(value);
   const coverage=[...(value.coveredManualIds||[]),...(value.coveredManualId?[value.coveredManualId]:[])];
   if(coverage.some(manualId=>manualIds.has(value.actor+'|'+value.shopSessionId+'|'+manualId))){if(value.coveredManualQuantity&&value.coveredManualQuantity+1e-7<value.quantity)unpriced++;continue;}
   let paid=cents(value.pricePaid);
   // A confirmed receipt replaces an estimated portion. Keep the original pack
   // basis for the uncovered estimate; never prorate a known actual payment.
   if(value.priceSource==='estimate'&&value.receiptCoveredQuantity>0){const left=Math.max(0,value.quantity-value.receiptCoveredQuantity);paid=left===0?0:value.priceBasis?cents(Math.ceil((left-1e-10)/value.priceBasis.quantity)*value.priceBasis.price):null;}
   if(financial.has(id))paid=financial.get(id);if(expensePending.has(id))unpriced++;
   if(value.reduced!==false&&paid!==null)actualReduced+=paid;
   const line=value.active&&!value.deposited?lineById.get(value.purchaseId):null,uncoveredQuantity=Math.max(0,value.quantity-Math.max(value.depositedQuantity||0,value.priceSource==='estimate'?value.receiptCoveredQuantity||0:0)),lineQuantity=line?convert(uncoveredQuantity,value.unit,line.unit):null;
   if(line&&lineQuantity!==null&&finite(line.quantity)){const group=grouped.get(value.purchaseId)||{line,quantity:0,pricePaid:0,unknown:0,reduced:false};group.quantity+=lineQuantity;group.pricePaid+=paid??0;group.unknown+=paid===null?1:0;group.reduced||=value.reduced!==false;grouped.set(value.purchaseId,group);}
   else{amount+=paid??0;if(paid===null)unpriced++;}
  }
  for(const {line,quantity,pricePaid,unknown,reduced}of grouped.values()){
   const remaining=Math.max(0,line.quantity-quantity);let rest=remaining===0?{amount:0}:null;try{if(remaining>0&&typeof quote==='function')rest=quote(line,remaining);}catch{}
   const old=cents(line.amount),remainingPrice=cents(rest?.amount);
   amount-=old??0;amount+=pricePaid+(remainingPrice??0);unpriced+=(remainingPrice===null?1:0)-(old===null?1:0);
   unpriced+=unknown;if(reduced&&old!==null&&remainingPrice!==null&&unknown===0)savings+=Math.max(0,old-(pricePaid+remainingPrice));
  }
  return {total:Math.max(0,amount)/100,pending:Math.max(0,unpriced),actualReduced:actualReduced/100,reducedSavings:savings/100};
 }
 function recordReceipt(session,{actor,market,receiptId,shopSessionId,at=Date.now(),lines=[],deposited=true}={}){
  if(session?.id!==shopSessionId)return clone(session||{});if(!safe(receiptId,120)||!Array.isArray(lines)||lines.length>200)throw Error('Review this reduced receipt before saving.');
  let next=clone(session),values={...rows(next)};
  for(const line of lines){const id='receipt:'+receiptId+':'+line.lineId;
   const expense=line.expenseOnly===true?{expenseOnly:true,quantity:1,unit:'pack',purchaseId:'receipt-expense:'+line.lineId,...(line.coveredPurchaseIds?{coveredPurchaseIds:line.coveredPurchaseIds}:safe(line.purchaseId,300)?{coveredPurchaseId:line.purchaseId}:{})}:{};
   let value=record({...line,...expense,id,actor,market,shopSessionId,at,receiptId,kind:'receipt',deposited});
   const previous=values[id];if(previous){const compare={...value,at:previous.at};for(const key of ['coveredManualId','coveredManualIds','coveredManualQuantity'])if(previous[key]!==undefined)compare[key]=previous[key];if(Object.keys(previous).length!==Object.keys(compare).length||Object.keys(previous).some(key=>JSON.stringify(previous[key])!==JSON.stringify(compare[key])))throw Error('This receipt changed. Review it before saving.');continue;}
   let proof=Math.min(value.quantity,Number(line.manualCoverageQuantity??line.legacyCreditQuantity??0)),suppressed=0;const suppressedIds=[];
   const matches=Object.values(values).filter(prior=>prior.kind!=='receipt'&&prior.actor===actor&&prior.market===market&&prior.purchaseId===value.purchaseId&&convert(value.quantity,value.unit,prior.unit)!==null).sort((a,b)=>Number((b.reduced!==false)===(value.reduced!==false))-Number((a.reduced!==false)===(value.reduced!==false)));
   if(!value.expenseOnly)for(const manual of matches){
    const available=convert(proof,value.unit,manual.unit),left=Math.max(0,manual.quantity-(manual.receiptCoveredQuantity||0)),covered=Number.isFinite(available)&&available>0?Math.min(left,convert(value.quantity,value.unit,manual.unit),available):0;
    if(covered<=0)continue;
    const used=convert(covered,manual.unit,value.unit);proof=Math.max(0,proof-used);
    if(covered+1e-7>=left){next.reducedSuperseded={...(next.reducedSuperseded||{}),[manual.id]:manual};delete values[manual.id];}
    else{values[manual.id]=record({...manual,receiptCoveredQuantity:(manual.receiptCoveredQuantity||0)+covered,depositedQuantity:(manual.depositedQuantity||0)+(deposited?covered:0)});if(manual.priceSource!=='estimate'){suppressedIds.push(manual.id);suppressed+=used;}}
    if(proof<=1e-7)break;
   }
   if(suppressedIds.length)value=record({...value,...(suppressedIds.length===1?{coveredManualId:suppressedIds[0]}:{coveredManualIds:suppressedIds}),...(suppressed+1e-7<value.quantity?{coveredManualQuantity:suppressed}:{})});
   values[id]=value;
  }
  if(Object.keys(values).length>1000)throw Error('Finish this shop before recording more receipt prices.');next.reducedPurchases=values;return next;
 }
 return Object.freeze({record,put,putCost,remove,rows,eligible,costs,purchasedQuantity,stockCredits,budget,recordReceipt,week});
});
