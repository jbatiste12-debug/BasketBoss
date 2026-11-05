/* Reviewed receipt quantity suggestions. Estimates never write stock and never
 * convert between dimensions or guess clove/bulb, pack/count or spoon density. */
(function(root,factory){'use strict';const common=typeof module==='object'&&module.exports,api=factory(root?.BBPantryPolicy||(common?require('./bb-pantry-policy.js'):null));if(common)module.exports=api;if(root)root.BBReceiptQuantity=api;})(typeof window==='undefined'?null:window,function(/** @type {typeof import('./bb-pantry-policy')|null} */ policy){
 'use strict';
 /** @typedef {import('./types/pantry-workflow').ReceiptLine} ReceiptLine */
 /** @typedef {import('./types/pantry-workflow').QuantityContext} QuantityContext */
 /** @typedef {import('./types/pantry-workflow').MeasuredQuantity} MeasuredQuantity */
 /** @typedef {import('./types/pantry-workflow').ReceiptSuggestion} ReceiptSuggestion */
 /** @typedef {import('./types/pantry-workflow').CatalogueRows} CatalogueRows */
 const LIMIT=1000000,COUNT=new Set(['each','clove','bulb','tin','pack','bag','bunch','loaf','slice']);
 /** @type {Record<string,string>} */
 const aliases={eggs:'egg',potatoes:'potato',tomatoes:'tomato',onions:'onion',carrots:'carrot',peppers:'pepper',bananas:'banana',apples:'apple',lemons:'lemon',limes:'lime',mushrooms:'mushroom',courgettes:'courgette',wraps:'wrap'};
 /** @param {unknown} value @returns {string} */
 const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim():'';
 /** @param {unknown} value @returns {string|null} */
 const key=value=>{const text=clean(value).toLowerCase();return !text||text.includes('|')||['__proto__','prototype','constructor'].includes(text)?null:aliases[text]||text;};
 /** @param {unknown} value @returns {string} */
 const unit=value=>(/** @type {Record<string,string>} */ ({gram:'g',grams:'g',kilogram:'kg',kilograms:'kg',litre:'l',litres:'l',liter:'l',liters:'l',millilitre:'ml',millilitres:'ml',milliliter:'ml',milliliters:'ml',pcs:'each',pc:'each',pieces:'each',piece:'each',items:'each',item:'each',eggs:'each',cloves:'clove',bulbs:'bulb',tins:'tin',can:'tin',cans:'tin',packs:'pack',bags:'bag',bunches:'bunch',loaves:'loaf',slices:'slice',cups:'cup',pints:'pint',floz:'fl oz','fl. oz.':'fl oz','fluid ounce':'fl oz','fluid ounces':'fl oz',ounces:'oz',ounce:'oz',lbs:'lb',pound:'lb',pounds:'lb'}))[clean(value).toLowerCase()]||clean(value).toLowerCase();
 /** @param {unknown} value @returns {number|null} */
 const numeric=value=>value!==null&&value!==undefined&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value))?Number(value):null;
 /** @param {unknown} value @param {unknown} rawUnit @returns {MeasuredQuantity|null} */
 function measured(value,rawUnit){const n=numeric(value),u=unit(rawUnit),base=u==='kg'?'g':u==='l'?'ml':u,amount=Math.round(/** @type {number} */ (n)*(u==='kg'||u==='l'?1000:1)*1000)/1000;return n!==null&&n>0&&n<=LIMIT&&['g','ml','tsp','tbsp',...COUNT].includes(base)&&amount>0&&amount<=LIMIT&&(!COUNT.has(base)||Number.isInteger(amount))?{quantity:amount,unit:/** @type {import('./types/pantry-workflow').ReceiptUnit} */ (base)}:null;}
 /** @param {MeasuredQuantity} amount @param {import('./types/pantry-workflow').ReceiptSource} source @param {boolean} estimated @param {string} note @param {Partial<import('./types/pantry-workflow').ReceiptPack>} [pack] @returns {ReceiptSuggestion} */
 const result=(amount,source,estimated,note,pack={})=>({...amount,...pack,source,estimated,note});
 /** @param {ReceiptLine} line @param {QuantityContext} context @returns {ReceiptSuggestion|{invalid:true}|null} */
 function explicit(line,context){
  /** @param {unknown} quantity @param {unknown} units @returns {MeasuredQuantity|null} */
  const convert=(quantity,units)=>context.pantryPolicy===true&&policy?policy.normalize(line.canonicalKey||line.ingredientKey||line.key||line.name||line.description,quantity,unit(units).replace(/^fl\.?\s*oz\.?$/,'fl oz'),{market:context.market}):measured(quantity,units);
  const rawUnit=unit(line.unit),direct=rawUnit==='pack'&&(line.packQuantity||line.packSize)?null:convert(line.quantity,line.unit);
  const pack=convert(line.packQuantity??line.packSize,line.packUnit??line.packSizeUnit??(line.packQuantity!==undefined?line.unit:null));
  const rawCount=line.packCount??line.count??(rawUnit==='pack'?line.quantity:null),count=numeric(rawCount);
  if(count!==null&&(!Number.isInteger(count)||count<=0||count>10000))return {invalid:true};
  if(pack){const actual=count??1,total=measured(pack.quantity*actual,pack.unit);if(!total)return {invalid:true};if(direct&&(direct.unit!==total.unit||Math.abs(direct.quantity-total.quantity)>.001))return {invalid:true};return result(total,'receipt',count===null,'Pack amount read from receipt'+(count===null?'; assumes one pack — check it.':'.'),{packQuantity:pack.quantity,packUnit:pack.unit,packCount:actual});}
  if(direct&&rawUnit!=='pack')return result(direct,'receipt',false,'Amount read from receipt.');
  const description=clean(line.packText||line.description||line.name);
  const multi=description.match(/(?:^|\s)(\d{1,4})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|fluid\s+ounces?|floz|lbs?|pounds?|oz|ounces?|cups?|pints?|kg|g|ml|litres?|liters?|l)\b/i);
  const single=multi||description.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|fluid\s+ounces?|floz|lbs?|pounds?|oz|ounces?|cups?|pints?|kg|g|ml|litres?|liters?|l)\b/i);
  if(single){const contents=convert(multi?multi[2]:single[1],multi?multi[3]:single[2]),packs=multi?Number(multi[1]):count??1,total=contents&&measured(contents.quantity*packs,contents.unit);if(!total)return {invalid:true};return result(total,'receipt',!multi&&count===null,'Pack amount read from receipt'+(!multi&&count===null?'; assumes one pack — check it.':'.'),{packQuantity:contents.quantity,packUnit:contents.unit,packCount:packs});}
  const countText=description.match(/(?:^|\s)(\d{1,4})\s*(?:eggs?|each|pcs?|pieces?|rolls?)\b/i)||description.match(/\b(?:eggs?|rolls?)\s*(\d{1,4})\s*(?:pack|pk)\b/i);
  if(countText){const amount=measured(Number(countText[1]),'each');if(amount)return result(amount,'receipt',false,'Count read from receipt.');}
  return null;
 }
 /** @type {Record<string,[number,string]>} */
 const defaults={pasta:[500,'g'],spaghetti:[500,'g'],rice:[1000,'g'],milk:[1000,'ml'],'whole milk':[1000,'ml'],'semi-skimmed milk':[1000,'ml'],'skimmed milk':[1000,'ml'],egg:[6,'each'],cheddar:[400,'g'],butter:[250,'g'],'chicken breast':[500,'g'],'beef mince':[500,'g'],'chopped tomatoes':[400,'g'],passata:[500,'g'],flour:[1500,'g'],'plain flour':[1500,'g'],'self-raising flour':[1500,'g'],sugar:[1000,'g'],'olive oil':[500,'ml'],'cooking oil':[1000,'ml'],gnocchi:[500,'g']};
 /** @param {ReceiptLine} [line] @param {QuantityContext} [context] @returns {ReceiptSuggestion|null} */
 function infer(line={},context={}){
  if(!line||typeof line!=='object'||Array.isArray(line))return null;
  const kind=line.classification||line.kind;if(line.sourceKind&&line.sourceKind!=='purchase'||['discount','refund','tax','total','ignore'].includes(/** @type {string} */ (kind))||line.selected===false)return null;
  const name=key(line.canonicalKey||line.ingredientKey||line.key||line.name||line.description),essential=kind==='essential';
  const found=explicit(line,context);
  if(context.pantryPolicy===true&&policy&&name&&!essential){
   const canonical=policy.canonicalName(name),saved=Object.values(context.inventory||{}).filter(row=>row?.selected!==false&&policy.canonicalName(row?.name)===canonical),existing=saved[0];
   if(policy.isStaple(canonical)&&!policy.isWholePepper(line.description||line.name||canonical,line.unit,line)){
    const source=found&&!found.invalid?found:line,purchase=policy.staplePurchase({name:canonical,quantity:source.quantity??line.quantity,unit:source.unit??line.unit,packCount:line.packCount??source.packCount,packQuantity:source.packQuantity,packUnit:source.packUnit});
    if(purchase)return result({quantity:purchase.quantity,unit:'each'},'receipt',purchase.estimated,canonical+' → +'+purchase.quantity+' '+purchase.label+(purchase.quantity===1?'':'s')+(existing?' (matches your pantry)':' · container tracking')+'. Check the bought container count.');
   }
   const source=found&&!found.invalid?found:line,normalized=policy.normalize(canonical,source.quantity??line.quantity,source.unit??line.unit,{market:context.market,wholePepper:policy.isWholePepper(line.description||line.name||canonical,source.unit??line.unit,line),reviewed:line.packReviewed===true,packQuantity:line.packQuantity,packUnit:line.packUnit});
   if(normalized){
    const currentUnit=existing&&policy.normalize(canonical,existing.qty,existing.unit,{market:context.market,reviewed:existing.packReviewed===true,packQuantity:existing.packQuantity,packUnit:existing.packUnit});
    let amount=normalized,note=normalized.assumption||'Amount read from receipt.';
    // Prefer the existing measured display unit only when it is the same
    // physical dimension. Containers are converted to the canonical amount.
    if(existing&&currentUnit?.unit===normalized.unit)note=canonical+' → +'+normalized.quantity+' '+normalized.unit+' (matches your pantry). '+note;
    return result(amount,'receipt',normalized.estimated,note);
   }
  }
  if(found)return found.invalid?null:found;
  if(!name&&!essential)return null;
  const choices=Array.isArray(context.choices)?context.choices:[],choice=choices.find(row=>key(row.key||row.name)===name);
  /** @param {MeasuredQuantity} amount */
  const compatible=amount=>!choice?.units?.length||choice.units.some(value=>unit(value)===(/** @type {string} */ (amount.unit)==='kg'?'g':/** @type {string} */ (amount.unit)==='l'?'ml':amount.unit));
  if(['UK','Guernsey','Jersey'].includes(/** @type {string} */ (context.market))){
   const catalog=/** @type {CatalogueRows} */ ((/** @type {import('./types/pantry-workflow').CatalogueEnvelope|undefined} */ (context.catalog))?.ingredients||context.catalog||{}),rows=Array.isArray(catalog)?catalog:Object.entries(catalog).map(([id,row])=>({...row,_pair:id}));
   const available=rows.filter(row=>key(row.ingredient||row.key||row.canonicalKey||row._pair?.split('|')[0])===name).map(row=>measured(row.standard_pack_size??row.packQuantity,row.standard_pack_unit??row.packUnit??row.unit??row._pair?.split('|')[1])).filter(/** @param {MeasuredQuantity|null} value @returns {value is MeasuredQuantity} */ value=>!!value&&compatible(value));
   const distinct=[...new Map(available.map(value=>[value.quantity+'|'+value.unit,value])).values()];
   const picked=distinct.length===1?distinct[0]:distinct.length?null:defaults[/** @type {string} */ (name)]&&measured(...defaults[/** @type {string} */ (name)]);
   if(picked&&compatible(picked)){const count=unit(line.unit)==='pack'?numeric(line.quantity):numeric(line.packCount);const packs=count??1,total=measured(picked.quantity*packs,picked.unit);if(total&&Number.isInteger(packs)&&packs>0&&packs<=10000)return result(total,'uk-default',true,'Estimated UK pack — check the amount before saving.',{packQuantity:picked.quantity,packUnit:picked.unit,packCount:packs});}
  }
  const shopping=Array.isArray(context.shoppingItems)?context.shoppingItems:[];
  const matches=shopping.filter(row=>key(row.canonicalKey||row.key||row.name)===name).map(row=>measured(row.quantity??row.qty??row.toBuy??row.required,row.unit)).filter(/** @param {MeasuredQuantity|null} value @returns {value is MeasuredQuantity} */ value=>!!value&&compatible(value));
  const unique=[...new Map(matches.map(value=>[value.quantity+'|'+value.unit,value])).values()];
  if(unique.length===1)return result(unique[0],'shopping-list',true,'Estimated from your current shopping list — check the amount bought.');
  if(essential)return result({quantity:1,unit:'each'},'essential-count',true,'Estimated as one item — check the number or pack amount.');
  return null;
 }
 return Object.freeze({infer,measured,key});
});
