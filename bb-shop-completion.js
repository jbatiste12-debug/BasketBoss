/* Purchase completion is presentation history for one actor and shopping trip.
 * Physical stock and reversal remain owned by the existing purchase journal. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBShopCompletion=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const text=value=>typeof value==='string'&&value.length>0&&value.length<=300&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
 const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000;
 const copy=value=>JSON.parse(JSON.stringify(value));
 function snapshot(item,unit){
  if(!object(item))throw Error('Review this purchase before confirming it.');
  const key=item.key||item.name,name=item.name||item.key;if(!text(key)||!text(name)||!text(unit))throw Error('Review this purchase name and unit.');
  const out={key,name,unit};
  for(const field of ['required','pantryUsed','toBuy','qty','targetQty','ownedQty','manualBuyQty','displaySpend','buyMultiple'])if(amount(item[field]))out[field]=item[field];
  for(const field of ['buyMultipleUnit','aisle'])if(text(item[field]))out[field]=item[field];
  for(const field of ['staple','bbHomePending'])if(typeof item[field]==='boolean')out[field]=item[field];
  if(object(item.priceQuote)){
   const quote={};for(const [field,value]of Object.entries(item.priceQuote))if(amount(value)||typeof value==='boolean'||text(value))quote[field]=value;
   out.priceQuote=quote;
  }
  return out;
 }
 function get(session,id,actor){
  const row=session?.completedPurchases?.[id];
  return object(row)&&row.version===1&&row.actor===actor&&row.sessionId===session?.id&&text(row.receiptId)&&amount(row.amount)&&row.amount>0&&text(row.unit)&&object(row.item)&&text(row.item.key||row.item.name)&&text(row.item.name||row.item.key)&&row.item.unit===row.unit&&(row.price===undefined||amount(row.price))?row:null;
 }
 function update(session,{id,actor,receiptId,amount:quantity,unit,essential=false,item,price}={}){
  if(!object(session)||!text(session.id)||!text(id)||!text(actor)||!text(receiptId)||!amount(quantity))throw Error('Review the current purchase before confirming it.');
  if(session.completedPurchases!==undefined&&!object(session.completedPurchases))throw Error('Review the saved shopping progress before confirming this purchase.');
  const rows={...(object(session.completedPurchases)?session.completedPurchases:{})};
  if(quantity===0)delete rows[id];
  else{
   const previous=get(session,id,actor),keptPrice=previous?.amount===quantity&&previous.unit===unit&&amount(previous.price)?previous.price:price;
   rows[id]={version:1,sessionId:session.id,actor,receiptId,amount:quantity,unit,essential:essential===true,item:snapshot(item,unit),...(amount(keptPrice)?{price:keptPrice}:{})};
  }
  const history={...(object(session.completedPurchaseHistory)?session.completedPurchaseHistory:{})},previous=get(session,id,actor);
  if(previous&&previous.receiptId!==receiptId)history[previous.receiptId]={...copy(previous),id};
  return {...session,completedPurchases:rows,...(Object.keys(history).length?{completedPurchaseHistory:history}:{})};
 }
 function resolve(session,id,actor,context={}){
  const saved=get(session,id,actor);if(saved)return saved;
  const marker=session?.shelfEdits?.[id],base=session?.id+'|'+id;
  if(marker?.kind!=='shop-owned-v1'||marker.actor!==actor||!amount(marker.amount)||!(marker.amount>0)||!text(marker.unit)||!text(marker.receiptId)||!(marker.receiptId===base||marker.receiptId.startsWith(base+'|home:')&&/^[1-9]\d*$/.test(marker.receiptId.slice((base+'|home:').length))))return null;
  let active;try{active=context.active?.(marker,id);}catch{return null;}if(active!==true&&active!==false)return null;
  if(!active){
   const receipt=context.receipts?.[marker.receiptId];
   if(!object(receipt)||!['full-purchase','household-purchase'].includes(receipt.stockBasis)||receipt.week!==session.id||!amount(receipt.credited))return null;
   let same=receipt.unit===marker.unit&&receipt.credited===marker.amount;
   if(!same&&typeof context.measure==='function')try{const paid=context.measure(marker.amount,marker.unit),credited=context.measure(receipt.credited,receipt.unit);same=!!paid&&!!credited&&paid.unit===credited.unit&&paid.quantity===credited.quantity;}catch{}
   if(!same)return null;
   const settled=Object.entries(object(context.settledPurchases)?context.settledPurchases:{}).some(([key,row])=>{
    if(!key.startsWith(marker.receiptId+'|settled:')||!object(row))return false;
    const purchase=row.purchase,partial=row.partial;
    return object(purchase)&&purchase.legacySnapshot!==true&&purchase.bbBetaSelectedWeek===session.id&&purchase.unit===marker.unit&&(purchase.actualQty??purchase.qty)===marker.amount||object(partial)&&partial.week===session.id&&partial.unit===marker.unit&&partial.bought===marker.amount;
   });
   if(!settled)return null;
  }
  try{return {version:1,sessionId:session.id,actor,receiptId:marker.receiptId,amount:marker.amount,unit:marker.unit,essential:marker.essential===true,item:snapshot(marker.anchor,marker.unit),legacy:true,settled:!active,...(amount(marker.anchor?.displaySpend)?{price:marker.anchor.displaySpend}:amount(marker.anchor?.priceQuote?.amount)?{price:marker.anchor.priceQuote.amount}:{})};}catch{return null;}
 }
 function decorate(rows,session,actor,context={}){
  const result=(rows||[]).map(row=>({...row})),byId=new Map(result.map(row=>[row.id,row]));
  const canonical=value=>typeof context.canonicalId==='function'?context.canonicalId(value):value;
  const ids=new Set([...Object.keys(object(session?.completedPurchases)?session.completedPurchases:{}),...Object.keys(object(session?.shelfEdits)?session.shelfEdits:{})]),entries=[],seen=new Set();
  for(const id of ids){const completed=resolve(session,id,actor,context);if(completed){entries.push({id,completed});seen.add(completed.receiptId);}}
  for(const [receiptId,record]of Object.entries(object(session?.completedPurchaseHistory)?session.completedPurchaseHistory:{})){
   if(seen.has(receiptId)||!object(record)||!text(record.id))continue;
   const completed=get({...session,completedPurchases:{[record.id]:record}},record.id,actor);
   if(completed)entries.push({id:record.id,completed,history:true});
  }
  for(const entry of entries){
   const {id}=entry,completed=copy(entry.completed),identity=canonical(id);
   const current=typeof context.receiptIdFor!=='function'||context.receiptIdFor(id)===completed.receiptId;
   let existing=byId.get(id)||result.find(row=>!row.completion&&canonical(row.id)===identity);
   // A used purchase remains Bought, while a later meal's fresh shortfall is
   // its own To buy row. Completion history never covers a new receipt cycle.
   const freshDemand=existing&&Number(existing.basketItem?.toBuy??existing.basketItem?.qty)>0;
   const historical=entry.history||!current&&freshDemand,purchaseOnly=!historical&&freshDemand&&completed.amount<Number(existing.basketItem?.toBuy??existing.basketItem?.qty??completed.item.toBuy??completed.item.qty)-0.000001;
   if(historical||purchaseOnly){if(historical)completed.historical=true;if(purchaseOnly)completed.purchaseOnly=true;existing=null;}
   if(existing){
    const previousId=existing.id;existing.id=id;existing.checked=true;existing.completion=completed;
    if(previousId!==id){existing.basketItem=copy(completed.item);existing.name=completed.item.name||completed.item.key;byId.delete(previousId);}
    byId.set(id,existing);
    for(let index=result.length-1;index>=0;index--)if(result[index]!==existing&&!result[index].completion&&canonical(result[index].id)===identity){byId.delete(result[index].id);result.splice(index,1);}
    continue;
   }
   const item=copy(completed.item),viewId=historical||purchaseOnly?'bought:'+completed.receiptId:id,row={id:viewId,purchaseId:id,name:item.name||item.key,unit:item.unit,essential:completed.essential,basketItem:item,row:null,box:null,checked:true,completion:completed,qty:'',price:''};
   result.push(row);byId.set(viewId,row);
  }
  return result;
 }

 function canUndo(completed,{actor,sessionId,receiptId,marker,active}={}){
  return object(completed)&&completed.historical!==true&&completed.version===1&&completed.actor===actor&&completed.sessionId===sessionId&&completed.receiptId===receiptId&&marker?.kind==='shop-owned-v1'&&marker.actor===actor&&marker.receiptId===receiptId&&marker.amount===completed.amount&&marker.unit===completed.unit&&active===true;
 }
 return Object.freeze({get,resolve,update,decorate,canUndo});
});
