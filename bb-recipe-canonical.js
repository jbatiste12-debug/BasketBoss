/* Read-only source projection. Ambiguous recipe packs remain review records. */
(function(root,factory){const api=factory(root?.BBPantryPolicy||(typeof module==='object'?require('./bb-pantry-policy.js'):null));if(typeof module==='object')module.exports=api;if(root)root.BBRecipeCanonical=api;})(typeof window==='undefined'?null:window,function(policy){
 'use strict';
 function project(row,{sourceLine,canonicalize,canonicalMeasure,recipeIngredientUnit,factor=1,pantryRecord}={}){
  const name=row.name||row.key,key=policy.canonicalName(sourceLine?.[0]||row.name||row.key,canonicalize),source=String(sourceLine?.[1]||''),originalUnit=row.unit,unit=(/\b(?:sticks?|stalks?)\b/i.test(String(sourceLine?.[1]||''))&&/celery/i.test(name))?'stalk':recipeIngredientUnit?.(row,sourceLine?[sourceLine]:[])||originalUnit;
  const value=row.required??row.quantity;
  const raw=typeof value==='number'||typeof value==='string'&&value.trim()?Number(value):NaN;
  const quantity=Number.isFinite(raw)&&raw>=0&&Number.isFinite(factor)&&factor>0?raw*factor:null;
  const fact={name,key,source,sourceQuantity:quantity,sourceUnit:unit,recipeId:row.recipe_id||null,ingredientIndex:row.ingredient_index};
  const wholePepper=policy.isWholePepper(sourceLine?.[0]||name,unit,row);
  const measuredStaple=!!pantryRecord&&pantryRecord.trackingMode==='measured'&&pantryRecord.measurementReviewed===true&&policy.canonicalName(pantryRecord.name||pantryRecord.key,canonicalize)===key&&!policy.isContainerTracked(pantryRecord);
  if(policy.isStaple(name)&&!wholePepper&&!measuredStaple)return {...fact,unit:'each',quantity:quantity===null?null:1,required:quantity===null?null:1,staple:true,estimated:false};
  const unknown=/\b(?:blocks?|handfuls?|cartons?|standard pack|sachets?)\b/i.test(source)&&!/(?:\d+(?:\.\d+)?\s*(?:kg|g|ml|litres?)\b)/i.test(source);
  let normalized=!unknown&&quantity!==null?policy.normalize(key,quantity,unit,{market:'UK',canonicalize,wholePepper}):null;
  if(!normalized&&!unknown&&quantity!==null&&canonicalMeasure){const fallback=canonicalMeasure(key,quantity,unit);if(fallback&&['g','ml','each'].includes(fallback.unit))normalized=fallback;}
  if(!normalized||!['g','ml','each'].includes(normalized.unit)||!Number.isFinite(normalized.quantity)||normalized.quantity<0)return {...fact,unit:policy.baseUnit(key)==='ml'?'ml':'g',quantity:null,required:null,needsReview:true,reason:'Recipe amount or container size needs review; the source has been kept.'};
  return {...fact,unit:normalized.unit,quantity:normalized.quantity,required:normalized.quantity,estimated:!!normalized.estimated||row.estimated===true,assumption:[normalized.assumption||'',typeof row.parsingNote==='string'?row.parsingNote:''].filter(Boolean).join(' '),...(row.needsReview===true?{needsReview:true}:{}),...(wholePepper||measuredStaple?{staple:false}: {}),...(measuredStaple?{trackingMode:'measured',measurementReviewed:true}:{})};
 }
 function aggregate(rows,options={}){
  const groups=new Map(),prepared=rows.map(input=>input.sourceUnit!==undefined?input:project(input,options));
  const groupId=row=>row.key+(row.staple?'|staple':'|measured');
  const preferred=new Map();for(const row of prepared)if(!row.staple&&typeof row.quantity==='number'&&Number.isFinite(row.quantity)&&row.quantity>=0&&row.quantity<=1000000){const id=groupId(row),before=preferred.get(id);if(!before||['g','ml'].includes(row.unit)&&before==='each')preferred.set(id,row.unit);}
  for(const row of prepared){const key=row.key;if(!key)continue;const id=groupId(row),group=groups.get(id)||{key,name:row.name||key,unit:preferred.get(id)||row.unit,quantity:0,required:0,pendingSources:[],sources:[],estimated:false,assumptions:[],...(row.staple===false?{staple:false}:{})};
   group.sources.push(row);if(row.needsReview===true)group.needsReview=true;if(row.trackingMode==='measured'&&row.measurementReviewed===true){group.trackingMode='measured';group.measurementReviewed=true;}if(row.staple){group.staple=true;group.unit='each';group.quantity=group.required=1;}
   else if(typeof row.quantity!=='number'||!Number.isFinite(row.quantity)||row.quantity<0||row.quantity>1000000||group.unit!==row.unit){group.pendingSources.push({...row,reason:row.reason||'This source unit needs a checked conversion before it can join the canonical total.'});group.needsReview=true;}
   else{group.quantity=group.required=Math.round((group.quantity+row.quantity)*1000000)/1000000;group.estimated||=row.estimated;if(row.assumption)group.assumptions.push(row.assumption);}
   groups.set(id,group);
  }
  return [...groups.values()].map(row=>({...row,assumptions:[...new Set(row.assumptions)]}));
 }
 return Object.freeze({project,aggregate});
});
