/* Explicit container estimates for the existing pantry editor. This module
   prepares absolute amounts; it never reads storage or reapplies a saved level. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBPantryStockLevels=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const MAX=1000000,PORTIONS=Object.freeze({full:1,half:.5,low:.25,out:0}),SOURCES=['label','receipt','catalogue','photo'];
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX;
 const round=value=>Math.round(value*1000000)/1000000;
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
 function base(quantity,unit){
  if(!amount(quantity))return null;
  const scale={g:1,kg:1000,ml:1,l:1000,each:1};if(!Object.hasOwn(scale,unit))return null;
  const value=round(quantity*scale[unit]);return amount(value)&&(quantity===0||value>0)?{quantity:value,unit:unit==='kg'?'g':unit==='l'?'ml':unit}:null;
 }
 function optional(value,result){
  if(Object.hasOwn(value,'scope')){
   if(!object(value.scope)||!['user','household'].includes(value.scope.kind)||!uuid(value.scope.id))return false;
   result.scope={kind:value.scope.kind,id:value.scope.id};
  }
  if(Object.hasOwn(value,'confirmedAt')){
   if(typeof value.confirmedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.confirmedAt))return false;
   try{if(new Date(value.confirmedAt).toISOString()!==value.confirmedAt)return false;}catch{return false;}
   result.confirmedAt=value.confirmedAt;
  }
  return true;
 }
 function validate(value){
  if(!object(value)||value.version!==1||!Object.hasOwn(PORTIONS,value.portion)||!SOURCES.includes(value.source)||!Number.isInteger(value.spares)||value.spares<0||value.spares>100||typeof value.estimated!=='boolean'||typeof value.capacityEstimated!=='boolean')return null;
  const capacity=base(value.capacity,value.unit),confirmed=base(value.confirmedQuantity,value.confirmedUnit);
  if(!capacity||!(capacity.quantity>0)||!confirmed||capacity.unit!==confirmed.unit)return null;
  const quantity=round(capacity.quantity*(value.spares+PORTIONS[value.portion]));
  if(!amount(quantity)||quantity!==confirmed.quantity||quantity===0&&value.portion!=='out'||!value.estimated&&(value.portion==='half'||value.portion==='low'||value.capacityEstimated))return null;
  const result={version:1,capacity:capacity.quantity,unit:capacity.unit,spares:value.spares,portion:value.portion,source:value.source,estimated:value.estimated,capacityEstimated:value.capacityEstimated,confirmedQuantity:confirmed.quantity,confirmedUnit:confirmed.unit};
  return optional(value,result)?result:null;
 }
 function qualitative(row,policy){try{return row.staple===true||policy?.isStaple?.(row.name||row.key)===true;}catch{return true;}}
 function normalized(row,quantity,policy,market,canonicalize){
  const direct=base(quantity,row.unit);if(direct)return direct;
  try{
   const result=policy?.normalize?.(row.name||row.key,quantity,row.unit,{market:row.inputMarket||market,canonicalize,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});
   return result&&amount(result.quantity)&&['g','ml','each'].includes(result.unit)&&result.estimated!==true?{quantity:result.quantity,unit:result.unit}:null;
  }catch{return null;}
 }
 function select(row,choice={},options={}){
  const fail=message=>({ok:false,message});
  if(!object(row)||!String(row.name||row.key||'').trim())return fail('Choose a food before setting its stock level.');
  if(qualitative(row,options.policy))return fail('Use the existing stock status for this cupboard staple.');
  if(!object(choice)||!Object.hasOwn(PORTIONS,choice.portion)||!Number.isInteger(choice.spares)||choice.spares<0||choice.spares>100)return fail('Choose a stock level and a whole spare count from 0 to 100.');
  const missing=choice.capacity===null||choice.capacity===undefined||choice.capacity==='';
  if(missing&&choice.portion==='out'&&choice.spares===0)return {ok:true,patch:{qty:0,unit:row.unit||'each',stockLevel:null}};
  if(choice.confirmed!==true)return fail('Confirm the physical container size before estimating stock.');
  if(!SOURCES.includes(choice.source)||typeof choice.capacityEstimated!=='boolean')return fail('Review the container size and its source before saving.');
  const capacity=base(choice.capacity,choice.unit);if(!capacity||!(capacity.quantity>0))return fail('Enter a positive container size in g, ml or each.');
  const previous=normalized(row,1,options.policy,options.market,options.canonicalize);
  if(previous&&previous.unit!==capacity.unit)return fail('The container size uses a different unit from this food. Review its amount first.');
  const quantity=round(capacity.quantity*(choice.spares+PORTIONS[choice.portion]));
  if(!amount(quantity)||quantity===0&&choice.portion!=='out')return fail('The estimated stock amount is outside the supported range.');
  const stockLevel=validate({version:1,capacity:capacity.quantity,unit:capacity.unit,spares:choice.spares,portion:choice.portion,source:choice.source,estimated:choice.capacityEstimated||choice.portion==='half'||choice.portion==='low',capacityEstimated:choice.capacityEstimated,confirmedQuantity:quantity,confirmedUnit:capacity.unit,...(Object.hasOwn(choice,'scope')?{scope:choice.scope}:{}),...(Object.hasOwn(choice,'confirmedAt')?{confirmedAt:choice.confirmedAt}:{})});
  if(!stockLevel)return fail('Review the saved container details before setting its stock level.');
  return {ok:true,patch:{qty:quantity,unit:capacity.unit,packQuantity:capacity.quantity,packUnit:capacity.unit,stockLevel}};
 }
 function describe(row,{policy,market}={}){
  if(!object(row)||qualitative(row,policy))return null;
  const saved=validate(row.stockLevel);if(!saved)return null;
  const known=typeof row.qty==='number'&&amount(row.qty),current=known?normalized(row,row.qty,policy,market):null;
  const matched=!!current&&current.unit===saved.confirmedUnit&&round(current.quantity)===saved.confirmedQuantity;
  const needsCheck=!matched||row.needsCheck===true||row.conflict===true;
  const label=needsCheck?(saved.estimated?'Estimated amount remaining':'Check pack level'):({full:'Got it',half:'Half left',low:'Running low',out:'Out'})[saved.portion]+(saved.spares?' · '+saved.spares+' spare'+(saved.spares===1?'':'s'):'');
  return {label,estimated:saved.estimated,matched,needsCheck};
 }
 return Object.freeze({validate,select,describe});
});
