/* Reduced-food annotations share the existing Kitchen inventory. This module
   never creates a stock balance or treats a shopping intent as a purchase. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBReducedStock=api;})(typeof window==='undefined'?null:window,function(root){
 'use strict';
 const LIMIT=1000000,MAX_SOURCES=128;
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=LIMIT;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const clean=value=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' '):'';
 const safeActor=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value);
 const source=value=>typeof value==='string'&&value.length>0&&value.length<=300&&!/[\u0000-\u001f\u007f]/.test(value);
 const round=value=>Math.round(value*1000000)/1000000;
 const datedLot=row=>Object.keys(row||{}).some(key=>/^(?:useBy(?:ISO|Date)?|bestBefore(?:ISO|Date)?|expiry(?:ISO|Date)?|expires(?:At|On)?|opened(?:At|On|Date)?|frozenAt|bought(?:At|On)|purchased(?:At|On)|purchaseDate|lot(?:Id|Code|Number)?|batch(?:Id|Code|Number)?)$/i.test(key)&&row[key]!==undefined&&row[key]!==null&&row[key]!=='');
 function canonical(name,options={}){
  try{const policy=options.policy||root?.BBPantryPolicy,fn=options.canonicalize||root?.BBPriceV19?.canonical;const key=clean(policy?.canonicalName?policy.canonicalName(name,fn):fn?fn(name):name).toLowerCase();return key&&key.length<=160&&!key.includes('|')&&!['__proto__','constructor','prototype'].includes(key)?key:null;}catch{return null;}
 }
 function measure(row,options={}){
  if(!row||!positive(Number(row.qty??row.quantity)))return null;
  const name=canonical(row.name||row.canonicalKey||row.key,options),raw=clean(row.unit).toLowerCase(),qty=Number(row.qty??row.quantity);if(!name||!raw||raw.length>30)return null;
  try{const policy=options.policy||root?.BBPantryPolicy,result=policy?.normalize?.(name,qty,raw,{market:row.inputMarket||options.market||'UK',packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});if(result&&positive(result.quantity)&&typeof result.unit==='string')return {key:name+'|'+result.unit,quantity:result.quantity};}catch{}
  const unit=raw==='kg'?'g':['l','litre','litres'].includes(raw)?'ml':raw,factor=unit!==raw?1000:1;
  if(!['g','ml','each','clove','bulb','pack','bag','tin','can','bunch','loaf','slice','bottle','jar'].includes(unit)||!positive(qty*factor))return null;
  return {key:name+'|'+unit,quantity:round(qty*factor)};
 }
 function metadata(row,actor){
  const value=row?.bbReduced;if(!safeActor(actor)||!object(value)||value.version!==1||value.actor!==actor)return null;
  return {...value,sources:(Array.isArray(value.sources)?value.sources:[]).filter(source).slice(-MAX_SOURCES)};
 }
 function isUrgent(row,{actor=root?.BBHome?.actor?.()||'guest'}={}){
  return row?.selected!==false&&['fridge','cupboard'].includes(row?.loc)&&positive(Number(row.qty))&&metadata(row,actor)?.urgent===true;
 }
 function sort(rows=[],options={}){return (Array.isArray(rows)?rows:[]).map((row,index)=>({row,index,urgent:isUrgent(row,options)})).sort((a,b)=>Number(b.urgent)-Number(a.urgent)||a.index-b.index).map(value=>value.row);}
 function freeze(row,{actor=root?.BBHome?.actor?.()||'guest',at=Date.now()}={}){
  if(!isUrgent(row,{actor}))throw Error('This reduced item changed. Reopen At home before moving it.');
  const next=clone(row);next.loc='freezer';next.bbReduced={...metadata(row,actor),urgent:false,frozenAt:at};return next;
 }
 function settleInventory({before={},after={},actor,...options}={}){
  if(!object(after))throw Error('Kitchen inventory must remain an object.');const result=clone(after);if(!safeActor(actor)||!object(before))return result;
  const lot=value=>JSON.stringify([value.actor,[...new Set(value.sources)].sort()]);
  const priorGroups=new Map();for(const row of Object.values(before).slice(0,2500)){
   const meta=metadata(row,actor),identity=measure({...row,qty:1},options)?.key;if(!meta||!identity)continue;
   const key=JSON.stringify([identity,lot(meta)]),values=priorGroups.get(key)||[];values.push(row);priorGroups.set(key,values);
  }
  for(const [key,row]of Object.entries(result).slice(0,2500)){
   if(!object(row))continue;const identity=measure({...row,qty:1},options)?.key;
   const same=before[key],meta=metadata(row,actor)||(identity&&measure({...same,qty:1},options)?.key===identity?metadata(same,actor):null);
   if(!meta)continue;
   // A location and ingredient identify food, not a reduced purchase. A new
   // ordinary row must never inherit another row's Use soon annotation.
   const previous=identity?priorGroups.get(JSON.stringify([identity,lot(meta)]))||[]:[];
   const hadPositive=previous.some(value=>value.selected!==false&&positive(Number(value.qty))&&metadata(value,actor)?.urgent===true);
   row.bbReduced={...meta,urgent:meta.urgent===true&&row.selected!==false&&positive(Number(row.qty))&&row.loc!=='freezer'&&(previous.length===0||hadPositive)};
  }return result;
 }
 function prepareInventory({before={},after={},credits=[],actor,sourceId,at=Date.now(),onReview,...options}={}){
  const result=settleInventory({before,after,actor,...options});
  if(!object(before)||!safeActor(actor)||!source(sourceId)||!Array.isArray(credits))return result;
  const records=Object.entries(result).slice(0,2500),prior=Object.values(before).slice(0,2500),totals=rows=>{const map=new Map();for(const row of rows){if(row?.selected===false)continue;const value=measure(row,options);if(value)map.set(value.key,round((map.get(value.key)||0)+value.quantity));}return map;};
  const oldTotals=totals(prior),newTotals=totals(records.map(([,row])=>row));
  const additions=new Map([...newTotals].map(([key,value])=>[key,Math.max(0,round(value-(oldTotals.get(key)||0)))]));
  const addedByRow=new Map(),existingByRow=new Map();
  for(const [key,row]of records){const value=row?.selected!==false&&measure(row,options),old=before[key]?.selected!==false&&measure(before[key],options),previous=old&&value&&old.key===value.key?old.quantity:0;if(value){addedByRow.set(key,Math.max(0,round(value.quantity-previous)));existingByRow.set(key,Math.min(value.quantity,previous));}}
  const review=(credit,reason)=>{if(typeof onReview==='function')onReview({name:credit.name||credit.canonicalKey||credit.key,unit:credit.unit,sourceId:credit.sourceId||sourceId,reason});};
  // A reduced label belongs to the purchased portion, never to all stock of
  // that food. Splitting only reallocates existing row quantities.
  function markPortion(key,quantity,id){
   const row=result[key],value=measure(row,options);if(!value||quantity>value.quantity+0.000001)return false;
   const previousMeta=metadata(row,actor),whole=Math.abs(quantity-value.quantity)<0.000001;
   if(whole&&!row.bbReduced){row.bbReduced={version:1,actor,urgent:true,at,sources:[id]};return true;}
   const remaining=Math.max(0,round(value.quantity-quantity)),fraction=quantity/value.quantity,portion={};
   for(const field of ['name','loc','unit','inputMarket','packReviewed','packQuantity','packUnit','staple','stapleStatus','containerLabel'])if(row[field]!==undefined)portion[field]=row[field];
   portion.selected=true;portion.qty=Number(row.qty)*fraction;
   if(row.staple===true)portion.stapleCount=portion.qty;
   if(row.bb173StockKey){portion.bb173StockKey=row.bb173StockKey;portion.bb173StockValue=(Number(row.bb173StockValue)||0)*fraction;}
   portion.bbReduced={version:1,actor,urgent:true,at,sources:[id]};
   let nextKey=key+'|reduced',index=0;while(Object.hasOwn(result,nextKey))nextKey=key+'|reduced-'+(++index);
   result[nextKey]=portion;addedByRow.set(nextKey,0);existingByRow.set(nextKey,0);
   row.qty=remaining>0?Number(row.qty)*(1-fraction):null;row.selected=remaining>0;
   if(row.staple===true)row.stapleCount=Number(row.qty)||0;
   if(row.bb173StockKey){if(remaining>0)row.bb173StockValue=(Number(row.bb173StockValue)||0)*(1-fraction);else{delete row.bb173StockKey;delete row.bb173StockValue;}}
   if(!remaining&&previousMeta)row.bbReduced={...previousMeta,urgent:false};
   return true;
  }
  for(const credit of credits.slice(0,500)){
   if(!object(credit)||!positive(credit.quantity))continue;const value=measure({...credit,qty:credit.quantity},options);if(!value)continue;
   const id=source(credit.sourceId)?credit.sourceId:sourceId+'|'+value.key;if(!source(id))continue;
   const matching=Object.entries(result).filter(([,row])=>row?.selected!==false&&measure(row,options)?.key===value.key);
   if([...Object.values(result),...prior].some(row=>metadata(row,actor)?.sources.includes(id)&&measure({...row,qty:1},options)?.key===value.key))continue;
   // Receipts may confirm a purchase already credited by Finish shop. The
   // receipt host supplies this quantity only after checking its credit ledger.
   const existing=sourceId.startsWith('receipt:')&&source(credit.legacyCreditId)&&positive(credit.previouslyCreditedQuantity)&&credit.previouslyCreditedQuantity<=credit.quantity?measure({...credit,qty:credit.previouslyCreditedQuantity},options)?.quantity||0:0;
   const available=additions.get(value.key)||0,added=Math.min(available,Math.max(0,round(value.quantity-existing))),already=Math.min(existing,value.quantity);if(!(added>0||already>0))continue;
   const location=credit.loc||credit.location,candidates=matching.filter(([key,row])=>{
    if(credit.inventoryId!==undefined&&key!==credit.inventoryId)return false;
    if(!['fridge','cupboard'].includes(row.loc)||location&&row.loc!==location)return false;
    return true;
   });
   if(!candidates.length)continue;
   const newCandidates=candidates.filter(([key])=>(addedByRow.get(key)||0)>0),newCapacity=newCandidates.reduce((sum,[key])=>sum+(addedByRow.get(key)||0),0);
   if(added>0){
    if(newCandidates.length!==1&&Math.abs(newCapacity-added)>0.000001||newCapacity+0.000001<added){review(credit,'reduced_purchase_lot_ambiguous');continue;}
    let left=added;for(const [key]of newCandidates){const quantity=Math.min(left,addedByRow.get(key)||0);if(quantity>0&&markPortion(key,quantity,id)){addedByRow.set(key,Math.max(0,round((addedByRow.get(key)||0)-quantity)));left=round(left-quantity);}if(!(left>0))break;}
    if(left>0){review(credit,'reduced_purchase_quantity_needs_review');continue;}
    additions.set(value.key,Math.max(0,round(available-added)));
   }
   if(!(already>0))continue;
   const current=candidates.filter(([key])=>result[key]?.selected!==false&&(existingByRow.get(key)||0)>0),tagged=current.filter(([,row])=>metadata(row,actor));
   // A receipt confirming one already-reduced lot can add replay proof without
   // replacing that lot's purchase time or marking ordinary stock reduced.
   if(tagged.length===1&&(current.length===1||metadata(tagged[0][1],actor)?.sources.includes(credit.legacyCreditId))&&(existingByRow.get(tagged[0][0])||0)+0.000001>=already){const [key,row]=tagged[0],meta=metadata(row,actor);row.bbReduced={...meta,sources:[...new Set([...meta.sources,id])].slice(-MAX_SOURCES)};existingByRow.set(key,round((existingByRow.get(key)||0)-already));continue;}
   const ordinary=current.filter(([,row])=>!row.bbReduced);
   if(!tagged.length&&ordinary.length===1&&(existingByRow.get(ordinary[0][0])||0)+0.000001>=already){const [key]=ordinary[0];if(markPortion(key,already,id)){existingByRow.set(key,round((existingByRow.get(key)||0)-already));continue;}}
   review(credit,'previous_reduced_purchase_lot_ambiguous');
  }
  return result;
 }
 function priority(stock={},options={}){
  const allowed=options.allowed===undefined?(root?root.BBReducedFoodHost?.isPremium?.()===true:true):options.allowed===true;
  if(!allowed||!object(stock)||!object(options.inventory))return [];
  const keys=new Set();for(const row of Object.values(options.inventory).slice(0,2500)){
   if(!isUrgent(row,options))continue;const value=measure(row,options);if(!value)continue;
   for(const [key,amount]of Object.entries(stock)){if(!positive(amount))continue;const at=key.lastIndexOf('|');if(at<1)continue;const physical=measure({name:key.slice(0,at),unit:key.slice(at+1),qty:amount},options);if(physical?.key===value.key)keys.add(key);}
  }return [...keys];
 }
 // Cloud balances have one quantity per ingredient. Keep the user's storage
 // and reduced batches when that total is projected back into the Kitchen.
 function projectFrozenBuckets({inventory={},stockKey,currentQuantity,nextQuantity,location='cupboard',actor,...options}={}){
  if(!object(inventory)||typeof stockKey!=='string'||!safeActor(actor)||![currentQuantity,nextQuantity].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=LIMIT))return null;
  const split=stockKey.lastIndexOf('|');if(split<1)return null;
  const name=stockKey.slice(0,split),unit=stockKey.slice(split+1),entries=[];
  for(const [id,row]of Object.entries(inventory)){
   if(row?.selected===false)continue;const physical=measure(row,options);
   if(physical?.key===stockKey)entries.push({id,row:clone(row),quantity:physical.quantity});
  }
  // Ordinary freezer food is a physical reserve too. A receipt must not move
  // it into a fridge/cupboard merely because it has no reduced-food annotation.
  if(entries.some(entry=>object(entry.row.bbReduced)&&entry.row.bbReduced.actor!==actor))return null;
  const frozen=entry=>entry.row.loc==='freezer';
  const distinctNotes=entries.length>1&&entries.some(entry=>clean(entry.row.notes||entry.row.note));
  if(!entries.some(entry=>frozen(entry)||object(entry.row.bbReduced)||datedLot(entry.row))&&!distinctNotes||Math.abs(entries.reduce((sum,entry)=>sum+entry.quantity,0)-currentQuantity)>.000001)return null;
  let decrease=Math.max(0,currentQuantity-nextQuantity);
  for(const entry of [...entries].sort((a,b)=>Number(frozen(a))-Number(frozen(b))||Number(isUrgent(b.row,{actor}))-Number(isUrgent(a.row,{actor})))){const used=Math.min(decrease,entry.quantity);entry.quantity=round(entry.quantity-used);decrease=round(decrease-used);}
  const increase=Math.max(0,round(nextQuantity-currentQuantity));
  if(increase>0){
   const loc=['cupboard','fridge','freezer'].includes(location)?location:'cupboard',targets=entries.filter(entry=>entry.row.loc===loc&&!object(entry.row.bbReduced)&&!datedLot(entry.row));let target=targets.length===1?targets[0]:null;
   if(!target){let id=loc+'|'+name+'|purchase',suffix=0;while(Object.hasOwn(inventory,id))id=loc+'|'+name+'|purchase-'+(++suffix);target={id,row:{name,loc,selected:true},quantity:0};entries.push(target);}
   target.quantity=round(target.quantity+increase);
  }
  const result=clone(inventory);
  for(const entry of entries){const one=measure({...entry.row,qty:1},options),factor=one?.key===stockKey?one.quantity:1,row={...entry.row,unit:one?.key===stockKey?entry.row.unit:unit,qty:entry.quantity>0?entry.quantity/factor:null,selected:entry.quantity>0};if(entry.quantity>0){row.bb173StockKey=stockKey;row.bb173StockValue=entry.quantity;}else{delete row.bb173StockKey;delete row.bb173StockValue;}result[entry.id]=row;}
  return result;
 }
 return Object.freeze({prepareInventory,settleInventory,isUrgent,sort,freeze,priority,measure,projectFrozenBuckets});
});
