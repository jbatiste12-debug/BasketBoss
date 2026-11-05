/* Weekly essentials are complete purchases. A generic household name has no
   invented shelf price. The host passes only its current account's projection. */
(function(root){
 'use strict';
 const MARKETS=Object.freeze({UK:'GBP',Guernsey:'GBP',Jersey:'GBP',US:'USD'});
 const SYMBOLS=Object.freeze({GBP:'£',USD:'$'});
 const COUNTS=new Set(['each','pack','bag','tin','bunch','loaf']);
 const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').trim().replace(/\s+/g,' ').slice(0,200):'';
 const same=(a,b)=>clean(a).toLowerCase()===clean(b).toLowerCase();
 const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
 const nonnegative=value=>number(value)!==null&&value>=0&&value<=1000000;
 const round=value=>Math.round((value+Number.EPSILON)*100)/100;
 function measured(quantity,unit){
  if(!nonnegative(quantity))return null;
  let u=clean(unit).toLowerCase(),q=quantity;
  if(u==='kg'){u='g';q*=1000;}else if(['l','litre','litres'].includes(u)){u='ml';q*=1000;}
  if(!['g','ml',...COUNTS].includes(u)||q>1000000||COUNTS.has(u)&&!Number.isInteger(q))return null;
  return {quantity:q,unit:u};
 }
 function reconcile(item={}){
  const manual=Object.hasOwn(item,'targetQty')||Object.hasOwn(item,'ownedQty');
  if(!manual){
   const required=measured(item.qty,item.unit);
   return required?{valid:true,manual:false,totalNeeded:item.qty,alreadyGot:item.owned?item.qty:0,toBuy:item.owned?0:item.qty}:{valid:false,manual:false,totalNeeded:null,alreadyGot:null,toBuy:null};
  }
  // Both quantities describe the SAME entered unit. Household ownership is
  // never converted into food stock or subtracted from a recipe ingredient.
  const target=measured(item.targetQty,item.unit),owned=measured(item.ownedQty,item.unit);
  if(!target||!owned)return {valid:false,manual:true,totalNeeded:null,alreadyGot:null,toBuy:null};
  const difference=Math.max(0,item.targetQty-item.ownedQty);
  return {valid:true,manual:true,totalNeeded:item.targetQty,alreadyGot:item.ownedQty,toBuy:item.manualPending===false?0:Math.round((difference+Number.EPSILON)*1000000)/1000000};
 }
 function scoped(record,context,{legacy=false}={}){
  const market=record?.market??record?.priceMarket,currency=record?.currency??record?.priceCurrency;
  const retailer=record?.retailer??record?.priceRetailer;
  if(market!==context.market||currency!==MARKETS[context.market])return false;
  if(record?.priceScope==='region')return legacy;
  return !!context.retailer&&same(retailer,context.retailer);
 }
 function unknown(context,reason='price_needed'){
  return {essential:true,amount:null,portionAmount:null,packAmount:null,knownAmount:0,source:'price_needed',priceKind:'unpriced',priceNeeded:true,
   reason,rough:false,market:context.market,currency:SYMBOLS[MARKETS[context.market]]||null};
 }
 function result(total,context,{source,packPrice,packCount,packQuantity,packUnit,brand='',samples=0}={}){
  if(!nonnegative(total)||total>1000000)return unknown(context,'price_out_of_range');
  const amount=round(total);
  return {essential:true,amount,portionAmount:amount,packAmount:amount,knownAmount:amount,source,priceKind:source==='account_store_receipt_regular_price'?'receipt_regular':'user_price',
   priceNeeded:false,rough:false,userOverride:source!=='account_store_receipt_regular_price',receiptLearned:source==='account_store_receipt_regular_price',receiptSamples:samples,
   shelfPrice:packPrice,packCount,packQty:packQuantity,packUnit,userBrand:clean(brand),market:context.market,currency:SYMBOLS[MARKETS[context.market]],sourceRetailer:context.retailer||null};
 }
 function quotePack(required,packQuantity,packUnit,price,context,details){
  const pack=measured(packQuantity,packUnit);
  if(!pack||pack.quantity<=0||!nonnegative(price)||price>10000)return null;
  let count;
  if(required.unit==='pack')count=required.quantity;
  else if(required.unit===pack.unit)count=Math.ceil((required.quantity-1e-10)/pack.quantity);
  else return null;
  return result(count*price,context,{...details,packPrice:price,packCount:count,packQuantity:pack.quantity,packUnit:pack.unit});
 }
 function manualQuote(item,required,context){
  const price=number(item.estimatedPackPrice);
  if(price===null||price<0||price>10000||!scoped(item,context,{legacy:true}))return null;
  const packQuantity=number(item.packQuantity),packUnit=item.packUnit;
  if(packQuantity!==null){
   return quotePack(required,packQuantity,packUnit,price,context,{source:'user_essential_price',brand:item.brand});
  }
  // Older entries described a price per entered count unit. A price recorded
  // beside grams or millilitres is ambiguous and cannot become £4.50 per gram.
  if(!COUNTS.has(required.unit))return null;
  return result(required.quantity*price,context,{source:'user_essential_price',packPrice:price,packCount:required.quantity,packQuantity:1,packUnit:required.unit,brand:item.brand});
 }
 function paidQuote(item,required,record,context){
  if(!record||!scoped(record,context)||!nonnegative(record.pricePaid)||record.pricePaid>100000||record.priceType!==undefined&&record.priceType!=='regular')return null;
  if(!same(record.name||record.productName,item.productName||item.name)||!same(record.brand||'',item.brand||''))return null;
  const amount=measured(record.quantity,record.unit);
  if(!amount||amount.quantity<=0)return null;
  const packQuantity=number(record.packQuantity),packUnit=record.packUnit;
  if(packQuantity!==null&&number(record.packCount)>0){
   return quotePack(required,packQuantity,packUnit,record.pricePaid/record.packCount,context,{source:'user_paid_price',brand:record.brand});
  }
  if(required.unit!==amount.unit)return null;
  if(COUNTS.has(required.unit))return result(required.quantity*record.pricePaid/amount.quantity,context,{source:'user_paid_price',packPrice:record.pricePaid/amount.quantity,packCount:required.quantity,packQuantity:1,packUnit:required.unit,brand:record.brand});
  if(required.quantity!==amount.quantity)return null;
  return result(record.pricePaid,context,{source:'user_paid_price',packPrice:record.pricePaid,packCount:1,packQuantity:amount.quantity,packUnit:amount.unit,brand:record.brand});
 }
 function receiptQuote(item,required,observations,context){
  // A generic label such as Shampoo cannot identify its brand, bottle or pack.
  const product=clean(item.productName),pack=measured(item.packQuantity,item.packUnit);
  if(!product||!pack||pack.quantity<=0||!Array.isArray(observations))return null;
  const samples=observations.filter(row=>{
   if(!row||row.kind!==undefined&&row.kind!=='essential'||!scoped(row,context)||row.priceType!=='regular'||row.eligibleForRegularPrice===false)return false;
   if(!same(row.productName||row.name,product)||!same(row.brand||'',item.brand||''))return false;
   const actual=measured(row.packQuantity,row.packUnit);
   return actual&&actual.quantity===pack.quantity&&actual.unit===pack.unit;
  }).map((value,index)=>({value,index,time:Date.parse(value.purchasedAt||value.confirmedAt||value.observedAt||'')||0})).sort((a,b)=>b.time-a.time||a.index-b.index).slice(0,21).map(({value:row})=>{
   if(number(row.packPrice)!==null)return row.packPrice;
   return number(row.pricePaid)!==null&&Number.isInteger(row.packCount)&&row.packCount>0?row.pricePaid/row.packCount:null;
  }).filter(price=>number(price)!==null&&price>0&&price<=10000).sort((a,b)=>a-b);
  if(!samples.length)return null;
  const median=values=>values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2;
  const center=median(samples),robust=samples.length>=3?samples.filter(price=>price>=center/3&&price<=center*3):samples;
  return quotePack(required,pack.quantity,pack.unit,round(median(robust)),context,{source:'account_store_receipt_regular_price',brand:item.brand,samples:robust.length});
 }
 function quote(item={},options={}){
  const context={market:options.market,retailer:options.retailer||null};
  if(typeof context.market!=='string'||!Object.hasOwn(MARKETS,context.market))return unknown(context,'unsupported_market');
  const quantities=reconcile(item);
  if(quantities.manual&&!quantities.valid)return unknown(context,'household_quantities_require_review');
  const required=measured(quantities.manual?quantities.toBuy:item.qty,item.unit);
  if(!clean(item.name)||!required)return unknown(context,'quantity_or_item_required');
  if(required.quantity===0)return result(0,context,{source:'none',packCount:0,packPrice:0,packQuantity:1,packUnit:required.unit});
  return manualQuote(item,required,context)||paidQuote(item,required,options.paidRecord,context)||receiptQuote(item,required,options.receiptObservations,context)||unknown(context);
 }
 function summarize(items=[],options={}){
  const lines=(Array.isArray(items)?items:[]).filter(item=>{
   if(!item||item.selected===false)return false;
   const quantities=reconcile(item);
   return quantities.manual?(!quantities.valid||quantities.toBuy>0):!item.owned;
  }).map(item=>({item,quote:quote(item,options)}));
  const pending=lines.filter(line=>line.quote.amount===null).length;
  const knownAmount=round(lines.reduce((sum,line)=>sum+(line.quote.amount??0),0));
  return {amount:pending?null:knownAmount,knownAmount,pending,unpriced:pending,complete:pending===0,lines};
 }
 root.BBWeeklyEssentials=Object.freeze({quote,summarize,reconcile});
})(typeof window!=='undefined'?window:globalThis);
