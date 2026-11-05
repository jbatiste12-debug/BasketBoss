/* Actual yellow-sticker costs belong to a purchase and trip, never a usual
   shelf-price override. Pure proposals are committed by the existing journal. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBReducedPurchases=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const CURRENCY={UK:'GBP',Guernsey:'GBP',Jersey:'GBP',US:'USD'},UNITS=new Set(['each','pack','clove','g','kg','ml','l']);
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const finite=(value,max=1000000)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max;
 const safe=(value,max=180)=>typeof value==='string'&&value.trim()===value&&!!value&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
 const round=value=>Math.round((value+Number.EPSILON)*100)/100;
 const clone=value=>JSON.parse(JSON.stringify(value));
 function record(input={}){
  if(!safe(input.actor)||!Object.hasOwn(CURRENCY,input.market)||!safe(input.shopSessionId)||!safe(input.id,400)||!safe(input.purchaseId||input.id,300)||!safe(input.name,120)||!UNITS.has(input.unit)||!finite(input.quantity)||['each','pack','clove'].includes(input.unit)&&!Number.isInteger(input.quantity)||!finite(input.pricePaid,100000)||input.pricePaid<0.01||!Number.isFinite(input.at)||input.at<=0)throw Error('Review the reduced purchase quantity and total paid.');
  const kind=input.kind==='receipt'?'receipt':'manual',depositedQuantity=input.depositedQuantity??0,receiptCoveredQuantity=input.receiptCoveredQuantity??0;
  if(typeof depositedQuantity!=='number'||!Number.isFinite(depositedQuantity)||depositedQuantity<0||depositedQuantity>input.quantity||typeof receiptCoveredQuantity!=='number'||!Number.isFinite(receiptCoveredQuantity)||receiptCoveredQuantity<0||receiptCoveredQuantity>input.quantity)throw Error('Review the receipt coverage for this purchase.');
  if(kind==='receipt'&&(!safe(input.receiptId,120)||!safe(input.lineId,100)))throw Error('Review this receipt identity before saving its price.');
  return {version:1,id:input.id,purchaseId:input.purchaseId||input.id,actor:input.actor,market:input.market,currency:CURRENCY[input.market],shopSessionId:input.shopSessionId,name:input.name,unit:input.unit,quantity:input.quantity,pricePaid:round(input.pricePaid),at:input.at,kind,deposited:input.deposited===true,...(depositedQuantity>0?{depositedQuantity}:{}),...(receiptCoveredQuantity>0?{receiptCoveredQuantity}:{}),...(safe(input.coveredManualId,400)?{coveredManualId:input.coveredManualId}:{}),...(kind==='receipt'?{receiptId:input.receiptId,lineId:input.lineId}:{})};
 }
 function rows(session){return object(session?.reducedPurchases)?session.reducedPurchases:{};}
 function put(session,input){
  const next=clone(session||{}),value=record(input);if(next.id!==value.shopSessionId)throw Error('Your shopping trip changed. Reopen the purchase.');
  next.reducedPurchases={...rows(next),[value.id]:value};if(Object.keys(next.reducedPurchases).length>1000)throw Error('Finish this shop before recording more reduced purchases.');return next;
 }
 function remove(session,id){const next=clone(session||{});next.reducedPurchases={...rows(next)};delete next.reducedPurchases[id];return next;}
 function normalize(value,context,session){
  try{const result=record(value);return result.actor===context.actor&&result.market===context.market&&result.currency===CURRENCY[context.market]&&result.shopSessionId===session?.id?result:null;}catch{return null;}
 }
 function purchasedQuantity(id,{ticks={},purchases={},partials={},shopSessionId}={}){
  const purchase=purchases[id],partial=partials[shopSessionId+'|'+id];
  if(ticks[id]&&purchase&&!purchase.legacySnapshot&&!purchase.receiptInventoryReceiptId&&purchase.bbBetaSelectedWeek===shopSessionId){const quantity=Number(purchase.actualQty??purchase.qty);return finite(quantity)?{quantity,unit:purchase.unit}:null;}
  if(!ticks[id]&&partial?.week===shopSessionId){const quantity=Number(partial.bought);return finite(quantity)?{quantity,unit:partial.unit}:null;}
  return null;
 }
 function eligible(session,context,progress={}){
  const result=[];for(const raw of Object.values(rows(session))){const value=normalize(raw,context,session);if(!value)continue;
   if(value.kind==='receipt'||value.receiptCoveredQuantity>0){result.push(value);continue;}
   const bought=purchasedQuantity(value.purchaseId,{...progress,shopSessionId:session.id});if(bought&&bought.unit===value.unit&&bought.quantity+1e-7>=value.quantity)result.push(value);
  }return result;
 }
 function stockCredits(session,context,progress={}){return eligible(session,context,progress).filter(row=>row.kind==='manual').map(row=>({id:row.purchaseId,name:row.name,unit:row.unit,quantity:row.quantity,pricePaid:row.pricePaid,sourceId:'reduced:'+row.actor+':'+row.shopSessionId+':'+row.id+':'+row.at}));}
 function week(at){
  const value=new Date(at);if(!Number.isFinite(value.getTime()))return null;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value),get=key=>parts.find(part=>part.type===key)?.value;
  const day=new Date(get('year')+'-'+get('month')+'-'+get('day')+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);
 }
 function budget({total=0,pending=0,lines=[],session,archives={},context,progress={},quote,now=Date.now()}={}){
  if(!context||!Object.hasOwn(CURRENCY,context.market)||!Number.isFinite(total)||total<0||typeof quote!=='function')return {total,pending,actualReduced:0,reducedSavings:0};
  const all=[],seen=new Set(),currentWeek=week(now),lineById=new Map(lines.map(line=>[line.id,line]));
  for(const row of eligible(session,context,progress))all.push({...row,active:true});
  for(const old of Object.values(object(archives)?archives:{}).slice(-20)){if(!old?.closedAt)continue;for(const raw of Object.values(rows(old))){const value=normalize(raw,context,old);if(value)all.push({...value,active:false});}}
  let amount=total,unpriced=pending,actualReduced=0,savings=0;const grouped=new Map(),manualIds=new Set(all.filter(row=>row.kind==='manual').map(row=>row.actor+'|'+row.shopSessionId+'|'+row.id));
  for(const value of all){const identity=value.actor+'|'+value.shopSessionId+'|'+value.id;if(seen.has(identity)||week(value.at)!==currentWeek)continue;seen.add(identity);
   if(value.coveredManualId&&manualIds.has(value.actor+'|'+value.shopSessionId+'|'+value.coveredManualId))continue;
   actualReduced+=value.pricePaid;const line=value.active&&!value.deposited?lineById.get(value.purchaseId):null;
   if(line&&line.unit===value.unit&&finite(line.quantity)){const group=grouped.get(value.purchaseId)||{line,quantity:0,pricePaid:0};group.quantity+=Math.max(0,value.quantity-(value.depositedQuantity||0));group.pricePaid+=value.pricePaid;grouped.set(value.purchaseId,group);}
   else amount+=value.pricePaid;
  }
  for(const {line,quantity,pricePaid}of grouped.values()){
   const remaining=Math.max(0,line.quantity-quantity),rest=remaining>0?quote(line,remaining):{amount:0};
   const old=Number.isFinite(line.amount)&&line.amount>=0?line.amount:null,remainingPrice=Number.isFinite(rest?.amount)&&rest.amount>=0?rest.amount:null;
   amount-=old??0;amount+=pricePaid+(remainingPrice??0);unpriced+=(remainingPrice===null?1:0)-(old===null?1:0);
   if(old!==null&&remainingPrice!==null)savings+=Math.max(0,old-(pricePaid+remainingPrice));
  }
  return {total:round(Math.max(0,amount)),pending:Math.max(0,unpriced),actualReduced:round(actualReduced),reducedSavings:round(savings)};
 }
 function recordReceipt(session,{actor,market,receiptId,shopSessionId,at=Date.now(),lines=[],deposited=true}={}){
  if(session?.id!==shopSessionId)return clone(session||{});if(!safe(receiptId,120)||!Array.isArray(lines)||lines.length>200)throw Error('Review this reduced receipt before saving.');
  let next=clone(session),values={...rows(next)};
  for(const line of lines){const id='receipt:'+receiptId+':'+line.lineId;let value=record({...line,id,actor,market,shopSessionId,at,receiptId,kind:'receipt',deposited});
   const previous=values[id];if(previous){const compare={...value,at:previous.at,...(previous.coveredManualId?{coveredManualId:previous.coveredManualId}:{})};if(Object.keys(previous).length!==Object.keys(compare).length||Object.keys(previous).some(key=>previous[key]!==compare[key]))throw Error('This reduced receipt changed. Review it before saving.');continue;}
   const manual=Object.values(values).find(prior=>prior.kind!=='receipt'&&prior.actor===actor&&prior.market===market&&prior.purchaseId===value.purchaseId&&prior.unit===value.unit);
   if(manual){const proof=Number(line.manualCoverageQuantity??line.legacyCreditQuantity??0),left=Math.max(0,manual.quantity-(manual.receiptCoveredQuantity||0)),covered=Number.isFinite(proof)&&proof>0?Math.min(left,value.quantity,proof):0;
    if(covered>0){
     if(covered+1e-7>=left){next.reducedSuperseded={...(next.reducedSuperseded||{}),[manual.id]:manual};delete values[manual.id];}
     else{values[manual.id]=record({...manual,receiptCoveredQuantity:(manual.receiptCoveredQuantity||0)+covered,depositedQuantity:(manual.depositedQuantity||0)+(deposited?covered:0)});if(covered+1e-7>=value.quantity)value=record({...value,coveredManualId:manual.id});}
    }
   }
   values[id]=value;
  }
  if(Object.keys(values).length>1000)throw Error('Finish this shop before recording more receipt prices.');next.reducedPurchases=values;return next;
 }
 return Object.freeze({record,put,remove,rows,eligible,purchasedQuantity,stockCredits,budget,recordReceipt,week});
});
