/* A strict, pure Cook stock proposal. Only compatible metric units convert;
 * packages, bulbs and cloves never acquire an inferred equivalence here. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBPantryDeduction=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 /** @typedef {import('./types/pantry-workflow').StockMap} StockMap */
 /** @typedef {import('./types/pantry-workflow').CanonicalId} CanonicalId */
 /** @typedef {import('./types/pantry-workflow').DeductionInput} DeductionInput */
 /** @typedef {import('./types/pantry-workflow').DeductionRow} DeductionRow */
 const MAX=1000000;
 /** @type {Record<string,string>} */
 const aliases={gram:'g',grams:'g',kilogram:'kg',kilograms:'kg',millilitre:'ml',millilitres:'ml',milliliter:'ml',milliliters:'ml',litre:'l',litres:'l',liter:'l',liters:'l',cloves:'clove',bulbs:'bulb',tins:'tin',can:'tin',cans:'tin',packs:'pack',bags:'bag',bunches:'bunch',loaves:'loaf',slices:'slice',items:'each',item:'each',pieces:'each',piece:'each',whole:'each',teaspoon:'tsp',teaspoons:'tsp',tablespoon:'tbsp',tablespoons:'tbsp',cups:'cup'};
 const known=new Set(['g','ml','each','clove','bulb','tin','pack','bag','bunch','loaf','slice','tsp','tbsp','cup']);
 /** @param {unknown} value @returns {value is Record<string,unknown>} */
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 /** @param {number} value */
 const round=value=>Math.round(value*1000000)/1000000;
 /** @param {unknown} value @returns {value is number} */
 const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX;
 /** @param {unknown} value */
 const unit=value=>{const raw=String(value||'').trim().toLowerCase();return aliases[raw]||raw;};
 /** @param {unknown} value @returns {import('./types/pantry-workflow').MeasureInfo} */
 function measure(value){const parsed=unit(value),base=parsed==='kg'?'g':parsed==='l'?'ml':parsed;return {unit:base,factor:parsed==='kg'||parsed==='l'?1000:1,known:known.has(base)};}
 /** @param {unknown} value @returns {string|null} */
 const name=value=>typeof value==='string'&&value.trim()&&value.length<=180&&!value.includes('|')&&!['__proto__','constructor','prototype'].includes(value)?value.trim():null;
 /** @type {CanonicalId} */
 const defaultId=(food,units)=>food.toLowerCase().trim()+'|'+units;
 /** @param {string} food @param {string} units @param {CanonicalId} id */
 function canonicalId(food,units,id){const value=id(food,units);if(typeof value!=='string'||value.length>220||!value.includes('|')||['__proto__','constructor','prototype'].includes(value))throw Error('Check the pantry ingredient names.');return value;}
 /** @param {StockMap} stock @param {CanonicalId} [id] @returns {import('./types/pantry-workflow').StockData} */
 function stockData(stock,id=defaultId){
  if(!object(stock))throw Error('Review your saved pantry amounts before cooking.');
  const values=/** @type {StockMap} */ ({}),names=new Map();
  for(const [raw,quantity]of Object.entries(stock)){
   const at=raw.lastIndexOf('|'),food=name(raw.slice(0,at));
   if(at<1||!food||!valid(quantity))throw Error('Review your saved pantry amounts before cooking.');
   const info=measure(raw.slice(at+1));
   if(!info.unit||info.unit.length>40)throw Error('Review your saved pantry units before cooking.');
   const key=canonicalId(food,info.unit,id),amount=quantity*info.factor;
   if(!valid(amount)||!valid((values[key]||0)+amount))throw Error('Check the pantry amounts before cooking.');
   values[key]=round((values[key]||0)+amount);names.set(key,canonicalId(food,'',id).split('|')[0]);
  }
  return {values,names};
 }
 /** @param {DeductionInput} [input] @returns {import('./types/pantry-workflow').DeductionResult} */
 function proposal({stock,ingredients,amounts,id=defaultId}=/** @type {DeductionInput} */ ({})){
  if(!Array.isArray(ingredients)||ingredients.length>500)throw Error('Review the recipe ingredients before cooking.');
  const {values,names}=stockData(stock,id),remaining={...values},rows=/** @type {DeductionRow[]} */ ([]),byId=/** @type {Map<string,DeductionRow>} */ (new Map());
  for(const [index,ingredient]of ingredients.entries()){
   const food=name(ingredient?.key||ingredient?.name),display=name(ingredient?.name)||food||'Ingredient '+(index+1),info=measure(ingredient?.unit);
   const measured=valid(ingredient?.required),required=measured?round(/** @type {number} */ (ingredient.required)*info.factor):null;
   if(required!==null&&!valid(required))throw Error('Check the cooked serving amounts.');
   const rowId=food&&info.unit?canonicalId(food,info.unit,id):'unmeasured-'+index;
   const existing=byId.get(rowId);
   if(existing){existing.required=required===null||existing.required===null?null:round(existing.required+required);if(existing.required!==null&&!valid(existing.required))throw Error('Check the cooked serving amounts.');continue;}
   const row=/** @type {DeductionRow} */ ({id:rowId,name:display,unit:info.unit||null,required,owned:0,deduct:0,remaining:0,canDeduct:false,issue:null,issueLabel:''});
   rows.push(row);byId.set(row.id,row);
  }
  const edits=/** @type {Map<string,number>} */ (new Map());
  if(amounts!==undefined){
   if(!Array.isArray(amounts)||amounts.length>rows.length)throw Error('Review the used ingredient amounts.');
   for(const edit of amounts){
    if(!object(edit)||!byId.has(edit.id)||edits.has(edit.id)||!valid(edit.quantity))throw Error('Review the used ingredient amounts.');
    const row=/** @type {DeductionRow} */ (byId.get(edit.id)),info=measure(edit.unit);
    if(edit.quantity!==0&&(!info.known||info.unit!==row.unit||!valid(edit.quantity*info.factor)))throw Error('Choose a compatible unit for '+row.name+'.');
    edits.set(edit.id,round(edit.quantity*info.factor));
   }
  }
  for(const row of rows){
   const measurable=!!row.unit&&known.has(row.unit)&&row.required!==null&&row.id.indexOf('unmeasured-')!==0;
   const wanted=edits.has(row.id)?/** @type {number} */ (edits.get(row.id)):row.required;
   row.owned=remaining[row.id]||0;row.remaining=row.owned;
   if(!measurable){row.issue=row.required===null?'amount_unknown':'unit_unknown';row.issueLabel='Amount or unit needs review in At home; no stock will be deducted.';continue;}
   const food=row.id.slice(0,row.id.lastIndexOf('|'));
   const incompatible=Object.keys(remaining).filter(key=>names.get(key)===food&&key!==row.id&&remaining[key]>0);
   row.canDeduct=row.owned>0||!incompatible.length;
   if(incompatible.length&&row.owned<(wanted||0)){
    row.issue='unit_mismatch';row.issueLabel='At home also has '+incompatible.map(key=>remaining[key]+' '+key.slice(key.lastIndexOf('|')+1)).join(', ')+'. Review those units; they will not be converted or deducted.';
   }
   if(edits.has(row.id)&&!row.canDeduct&&/** @type {number} */ (wanted)>0)throw Error('Review the pantry unit for '+row.name+' before deducting it.');
   const used=Math.min(row.owned,Math.max(0,wanted||0));row.deduct=round(used);row.remaining=round(Math.max(0,row.owned-used));
   remaining[row.id]=row.remaining;
  }
  const remainingStock=Object.fromEntries(Object.entries(remaining).filter(([,amount])=>amount>0));
  const used=rows.filter(row=>row.deduct>0).map(row=>({id:row.id,key:row.name,unit:/** @type {string} */ (row.unit),required:row.deduct}));
  return {rows,remainingStock,used,issues:rows.filter(row=>row.issue).map(row=>({id:row.id,message:row.issueLabel}))};
 }
 return Object.freeze({proposal,measure,stockData});
});
