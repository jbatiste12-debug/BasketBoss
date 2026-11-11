/* Optional retail-count presentation. Canonical stock and conversions stay outside this module. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBLooseProduceUI=api;})(typeof window==='undefined'?null:window,function(root){
 'use strict';
 const KEY='basketboss_loose_produce_stock_ui_v1',MAX=1000000,LIMIT=256;
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX;
 const positive=value=>amount(value)&&value>0;
 const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
 const near=(left,right)=>Math.abs(left-right)<=Math.max(1e-9,Math.max(Math.abs(left),Math.abs(right))*Number.EPSILON*8);
 function profile(name,policy=root?.BBPantryPolicy){
  if(typeof name!=='string')return null;
  const label=name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' '),match=/^(?:fresh )?(?:whole )?(lime|lemon|orange)s?$/.exec(label);
  if(!match)return null;
  const food=match[1],gramsPerEach=policy?.countGrams?.[food];if(!positive(gramsPerEach))return null;
  return Object.freeze({food,gramsPerEach,unitLabel:food,estimated:true,assumption:'Existing planning estimate: '+gramsPerEach+' g per whole '+food+'. Check the actual number and size.'});
 }
 function selection(name,count,policy=root?.BBPantryPolicy){
  const known=profile(name,policy);if(!known||!Number.isSafeInteger(count)||count<1||!positive(count*known.gramsPerEach))return null;
  const quantity=count*known.gramsPerEach,retailCount=Object.freeze({food:known.food,count,gramsPerEach:known.gramsPerEach,unitLabel:known.unitLabel});
  return Object.freeze({kind:'pack',packQuantity:known.gramsPerEach,packCount:count,quantity,unit:'g',label:'pack',boughtQtyOverride:quantity,retailCount});
 }
 function recommend(name,neededG,policy=root?.BBPantryPolicy){
  const known=profile(name,policy);return known&&positive(neededG)?selection(name,Math.ceil(neededG/known.gramsPerEach),policy):null;
 }
 function describeSelection(value,name,policy=root?.BBPantryPolicy){
  const known=profile(name,policy),retail=value?.retailCount;
  if(!known||!object(retail)||retail.food!==known.food||retail.unitLabel!==known.unitLabel||retail.gramsPerEach!==known.gramsPerEach||!Number.isSafeInteger(retail.count)||retail.count<1||value.unit!=='g'||!positive(value.quantity)||!near(value.quantity,retail.count*known.gramsPerEach)||value.boughtQtyOverride!==undefined&&!near(value.boughtQtyOverride,value.quantity))return null;
  const label=retail.count+' '+known.unitLabel+(retail.count===1?'':'s');
  return {...known,quantity:retail.count,unit:'each',canonicalQuantity:value.quantity,canonicalUnit:'g',label,buyingLabel:'Buying: '+label};
 }
 function contextOf(value,policy){
  if(!object(value)||!text(value.actor,200)||!text(value.stockKey,220))return null;
  const at=value.stockKey.lastIndexOf('|'),known=at>0&&value.stockKey.slice(at+1)==='g'?profile(value.stockKey.slice(0,at),policy):null;
  if(!known||value.name!==undefined&&profile(value.name,policy)?.food!==known.food)return null;
  return {actor:value.actor,stockKey:value.stockKey,...known};
 }
 function proofOf(value,policy){
  const context=contextOf(value,policy);
  if(!context||value.version!==1||value.source!=='ui-count-purchase'||value.food!==context.food||value.unitLabel!==context.unitLabel||value.gramsPerEach!==context.gramsPerEach||value.estimated!==true||!positive(value.maxCanonicalQuantity))return null;
  return {version:1,actor:context.actor,stockKey:context.stockKey,food:context.food,gramsPerEach:context.gramsPerEach,unitLabel:context.unitLabel,maxCanonicalQuantity:value.maxCanonicalQuantity,estimated:true,source:'ui-count-purchase'};
 }
 function proofsOf(raw,policy){
  if(raw===null)return [];
  if(typeof raw!=='string'||raw.length>1048576)throw Error('invalid_produce_ui_proofs');
  const parsed=JSON.parse(raw);if(!object(parsed)||parsed.version!==1||!Array.isArray(parsed.proofs)||parsed.proofs.length>LIMIT)throw Error('invalid_produce_ui_proofs');
  return parsed.proofs.map(value=>{const checked=proofOf(value,policy);if(!checked)throw Error('invalid_produce_ui_proofs');return checked;});
 }
 function readStockProof(storage,context,policy=root?.BBPantryPolicy){
  try{
   const checked=contextOf(context,policy);if(!checked)return null;
   const proofs=proofsOf(storage.getItem(KEY),policy),found=proofs.filter(value=>value.actor===checked.actor&&value.stockKey===checked.stockKey).at(-1);
   if(!found)return null;
   if(context.canonicalQuantity!==undefined&&(!amount(context.canonicalQuantity)||context.canonicalQuantity>found.maxCanonicalQuantity&&!near(context.canonicalQuantity,found.maxCanonicalQuantity)))return null;
   return Object.freeze({...found});
  }catch{return null;}
 }
 function writeStockProof(storage,context,change,policy=root?.BBPantryPolicy){
  const failed=()=>({ok:false,rollback:()=>false});let oldRaw,newRaw;
  try{
   const checked=contextOf(context,policy);if(!checked||!object(change)||!amount(change.beforeQuantity)||!amount(change.afterQuantity))return failed();
   oldRaw=storage.getItem(KEY);const proofs=proofsOf(oldRaw,policy),same=value=>value.actor===checked.actor&&value.stockKey===checked.stockKey;
   const prior=proofs.filter(same).at(-1),chosen=describeSelection(change.selection,checked.food,policy);
   const covered=change.beforeQuantity===0||prior&&(change.beforeQuantity<=prior.maxCanonicalQuantity||near(change.beforeQuantity,prior.maxCanonicalQuantity));
   const plausible=chosen&&change.afterQuantity<=change.beforeQuantity+chosen.canonicalQuantity+1e-9;
   const remaining=proofs.filter(value=>!same(value));
   const recorded=change.afterQuantity>0&&covered&&plausible;
   if(recorded)remaining.push({version:1,actor:checked.actor,stockKey:checked.stockKey,food:checked.food,gramsPerEach:checked.gramsPerEach,unitLabel:checked.unitLabel,maxCanonicalQuantity:change.afterQuantity,estimated:true,source:'ui-count-purchase'});
   newRaw=JSON.stringify({version:1,proofs:remaining.slice(-LIMIT)});
   if(storage.getItem(KEY)!==oldRaw)return failed();
   storage.setItem(KEY,newRaw);if(storage.getItem(KEY)!==newRaw)throw Error('produce_ui_proof_write_failed');
   let undone=false;
   return {ok:true,recorded:!!recorded,rollback(){if(undone)return false;try{if(storage.getItem(KEY)!==newRaw)return false;if(oldRaw===null)storage.removeItem(KEY);else storage.setItem(KEY,oldRaw);undone=true;return storage.getItem(KEY)===oldRaw;}catch{return false;}}};
  }catch{
   try{if(newRaw!==undefined&&storage.getItem(KEY)===newRaw){if(oldRaw===null)storage.removeItem(KEY);else storage.setItem(KEY,oldRaw);}}catch{}
   return failed();
  }
 }
 function describeStock(row,policy=root?.BBPantryPolicy,proof){
  const known=profile(row?.name,policy);if(!known)return null;
  // An explicitly entered count already has its own unit. Do not reinterpret it.
  if(!['g','kg'].includes(row.unit))return null;
  const quantity=typeof row.qty==='number'?row.qty:null,canonical=quantity===null?null:quantity*(row.unit==='kg'?1000:1),stockKey=row.bb173StockKey||row.stockKey;
  const checked=proofOf(proof,policy),needsReview={...known,quantity:null,unit:'each',needsReview:true,message:'Check the number of whole '+known.unitLabel+'s. The saved weight has been kept.'};
  if(!amount(canonical)||!checked||checked.stockKey!==stockKey||checked.food!==known.food||canonical>checked.maxCanonicalQuantity&&!near(canonical,checked.maxCanonicalQuantity)||row.bb173StockValue!==undefined&&(!amount(row.bb173StockValue)||!near(row.bb173StockValue,canonical)))return needsReview;
  return {...known,quantity:canonical/known.gramsPerEach,unit:'each',canonicalQuantity:canonical,canonicalUnit:'g',needsReview:false};
 }
 return Object.freeze({key:KEY,profile,selection,recommend,describeSelection,readStockProof,writeStockProof,describeStock});
});
