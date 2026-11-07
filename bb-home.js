/* At home owns manual requirements and completion receipts; measured stock
   remains in the existing pantry. No prices, billing or server data are invented. */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(root?.BBPantryDeduction||(common?require('./bb-pantry-deduction.js'):null));if(common)module.exports=api;if(root)root.BBHome=api.install(root);})(typeof window==='undefined'?null:window,function(deduction){
 'use strict';
 const KEY='basketboss_at_home_requirements_v1';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000;
 function difference(needed,owned){if(!valid(needed)||!valid(owned))throw Error('Enter valid non-negative amounts.');return Math.max(0,Math.round((needed-owned)*1000000)/1000000);}
 const roundQuantity=value=>Math.round(value*1000000)/1000000;
 function purchaseAmounts({needed,buffer=0,owned,multiple=0,unit}={}){
  if(![needed,buffer,owned,multiple].every(valid))throw Error('Enter valid amounts and a non-negative pack size.');
  if(!valid(needed+buffer))throw Error('The combined amount is too large.');
  const shortfall=roundQuantity(Math.max(0,needed+buffer-owned));
  if(!(multiple>0)||shortfall===0)return {shortfall,rawShortfall:shortfall,purchaseQuantity:shortfall,packCount:0,rounded:false,unit};
  const size=Math.round(multiple*1000000);if(size<1)throw Error('Choose a larger pack size.');
  const packCount=Math.ceil(Math.round(shortfall*1000000)/size),quantity=roundQuantity(packCount*size/1000000);
  if(!valid(quantity))throw Error('The rounded purchase is too large.');
  return {shortfall,rawShortfall:shortfall,purchaseQuantity:quantity,packCount,rounded:quantity!==shortfall,unit};
 }
 function purchaseQuantity(needed,buffer,owned,multiple=0){return purchaseAmounts({needed,buffer,owned,multiple}).purchaseQuantity;}
 function augment(items,lunch,targets,id){
  const map=new Map(items.map(row=>[id(row.key,row.unit),{...row}]));
  const lunchTotals=new Map();for(const row of lunch||[]){const key=id(row.name,row.unit);lunchTotals.set(key,(lunchTotals.get(key)||0)+Number(row.qty||0));}
  for(const row of Object.values(targets||{})){
   if(!row?.name||!row.unit)continue;
   const buffer=valid(row.extraBuffer)?row.extraBuffer:0,target=row.pending&&valid(row.targetQty)?row.targetQty:0;if(!(buffer>0)&&!row.pending)continue;if(!valid(row.targetQty))continue;
   const key=id(row.name,row.unit),before=map.get(key),base=Number(before?.required||0)+(lunchTotals.get(key)||0);
   const extra=roundQuantity(Math.max(0,target-base)+buffer);
   map.set(key,{...(before||{key:row.name,unit:row.unit,required:0,toBuy:0,pantryUsed:0}),required:Number(before?.required||0)+extra,bbHomePending:true});
  }return [...map.values()];
 }
 function atomic(storage,updates,expected={}){
  const prior=Object.fromEntries(Object.keys(updates).map(key=>[key,storage.getItem(key)]));
  const after=Object.fromEntries(Object.entries(updates).map(([key,value])=>[key,JSON.stringify(value)])),written=[];
  for(const [key,value] of Object.entries(expected))if(storage.getItem(key)!==value)throw Error('At home changed elsewhere. Review the latest amounts first.');
  try{for(const [key,bytes] of Object.entries(after)){if(storage.getItem(key)!==prior[key])throw Error('At home changed elsewhere. Review the latest amounts first.');written.push(key);storage.setItem(key,bytes);if(storage.getItem(key)!==bytes)throw Error('Storage verification failed.');}
   for(const key of written)if(storage.getItem(key)!==after[key])throw Error('At home changed while saving.');
   for(const [key,value]of Object.entries(expected))if(!Object.hasOwn(after,key)&&storage.getItem(key)!==value)throw Error('Your account or At home changed while saving.');
  }
  catch(error){for(const key of written.reverse()){try{if(storage.getItem(key)!==after[key])continue;if(prior[key]===null)storage.removeItem(key);else storage.setItem(key,prior[key]);}catch{}}throw error;}
 }
 function install(win){
  const householdDraft=new Map();let householdActor=null;
  function checkDraftActor(){const who=actor();if(who!==householdActor){householdDraft.clear();householdActor=who;}}
  const store=win.localStorage,read=()=>{try{const value=JSON.parse(store.getItem(KEY)||'{}');return value&&value.version===1?value:{version:1,targets:{},cooked:{},planned:{}};}catch{return {version:1,targets:{},cooked:{},planned:{}};}};
  const actor=()=>{try{return JSON.parse(store.getItem('basketboss_cloud_session_v1')||'null')?.user?.id||'guest';}catch{return 'guest';}};
  const blocked=()=>{
   const receipt=win.BBReceiptHost;
   if(win.BBAccountDeletion?.isDeleting?.()||receipt?.hasPendingConfirmation?.())return true;
   try{return typeof receipt?.canConsumePantry==='function'?receipt.canConsumePantry()!==true:!!receipt?.requiresPantryReview?.();}catch{return true;}
  };
  const host=()=>win.BBHomeHost;
  function own(){const all=read();const who=actor();all.byActor??={};all.byActor[who]??={targets:{},cooked:{},planned:{}};return {all,data:all.byActor[who],who};}
  function targets(){return own().data.targets||{};}
  function receiptGeneration(id){const data=own().data;return data.receiptGenerations?.[id]||0;}
  function supersedesReceipt(id){return !!own().data.supersededReceipts?.[id];}
  function settle(data,ids,cooking=false){
   const change=host()?.settlePurchases?.([...new Set(ids)],{cooking});if(!change)return null;
   data.receiptGenerations={...(data.receiptGenerations||{}),...change.generations};
   data.supersededReceipts={...(data.supersededReceipts||{}),...change.superseded};
   data.settledPurchases={...(data.settledPurchases||{}),...change.history};
   return change;
  }
  function addHousehold(id){
   checkDraftActor();const item=host()?.household()?.find(row=>row.id===id);if(!item)return false;
   const {all,data}=own(),expected=store.getItem(KEY),ownedQty=Number(householdDraft.get(id)?.ownedQty??item.ownedQty??(item.owned?item.qty:0));
   const targetQty=Math.max(householdDraft.get(id)?.targetQty??(item.manualPending!==false?Number(item.targetQty??item.qty):0),ownedQty)+1;
   const drafts=new Map(householdDraft);drafts.set(id,{targetQty,ownedQty,selected:true,owned:false});
   const feature=host().prepareHousehold([...drafts]),shopping=settle(data,[...drafts.keys()].map(key=>'ess:'+key));
   atomic(store,{[KEY]:all,[feature.key]:feature.value,...shopping?.updates},{[KEY]:expected,[feature.key]:feature.expected,...shopping?.expected});householdDraft.clear();host().reload();host().refresh();return true;
  }
  function setHouseholdAmount(id,patch,pin){
   checkDraftActor();
   if(householdDraft.size)throw Error('Confirm your other household quantity edits first, then enter this bottle or pack amount.');
   if(win.BBAccountDeletion?.isDeleting?.()||win.BBReceiptHost?.hasPendingConfirmation?.())throw Error('Finish the pending account or receipt review before updating this amount.');
   if(!pin||pin.actor!==actor()||pin.session!==store.getItem('basketboss_cloud_session_v1'))throw Error('Your account changed. Reopen the amount editor.');
   if(!patch||!['ml','g'].includes(patch.unit)||patch.packUnit!==patch.unit||!valid(patch.packQuantity)||patch.packQuantity<=0||!valid(patch.ownedQty)||!valid(patch.targetQty))throw Error('Review the container size and amounts first.');
   let savedFeatures;try{savedFeatures=JSON.parse(pin.features);}catch{throw Error('Review your saved household records before changing this amount.');}
   if(!savedFeatures||typeof savedFeatures!=='object'||!Array.isArray(savedFeatures.essentials))throw Error('Review your saved household records before changing this amount.');
   host().reload();
   const {all,data,who}=own(),expected=store.getItem(KEY),feature=host().prepareHousehold([[id,{unit:patch.unit,ownedQty:patch.ownedQty,targetQty:patch.targetQty,packQuantity:patch.packQuantity,packUnit:patch.unit,packReviewed:true}]]);
   if(feature.expected!==pin.features)throw Error('Your household amounts changed. Reopen the amount editor.');
   const shopping=settle(data,['ess:'+id]);
   if(actor()!==who||win.BBAccountDeletion?.isDeleting?.())throw Error('Your account changed. Reopen the amount editor.');
   atomic(store,{[KEY]:all,[feature.key]:feature.value,...shopping?.updates},{[KEY]:expected,[feature.key]:feature.expected,...shopping?.expected,basketboss_cloud_session_v1:pin.session});
   host().reload();host().refresh();return {ok:true,message:'Amount saved in '+patch.unit+'. Matching purchases will add to this balance.'};
  }
  // A weekly stock check replaces the owned balance, never its usual target,
  // container contents or purchase ledger. Existing receipt settlement applies.
  function setHouseholdBalance(id,ownedQty,pin){
   checkDraftActor();
   if(householdDraft.size)throw Error('Finish your other household quantity edits first.');
   if(blocked())throw Error('Finish the pending account or receipt review before updating stock.');
   if(!pin||pin.actor!==actor()||pin.session!==store.getItem('basketboss_cloud_session_v1'))throw Error('Your account changed. Reopen the weekly kitchen check.');
   if(!valid(ownedQty))throw Error('Enter a valid non-negative amount up to 1,000,000.');
   let features;try{features=JSON.parse(pin.features);}catch{throw Error('Review the saved household list before changing it.');}
   if(!features||!Array.isArray(features.essentials)||!features.essentials.some(row=>row.id===id))throw Error('This household item changed. Reopen the weekly kitchen check.');
   host().reload();
   const {all,data,who}=own(),expected=store.getItem(KEY),feature=host().prepareHousehold([[id,{ownedQty}]]);
   if(feature.expected!==pin.features)throw Error('Your household stock changed. Refresh the weekly kitchen check.');
   const shopping=settle(data,['ess:'+id]);
   if(actor()!==who||blocked())throw Error('Your account or pantry changed. Reopen the weekly kitchen check.');
   atomic(store,{[KEY]:all,[feature.key]:feature.value,...shopping?.updates},{[KEY]:expected,[feature.key]:feature.expected,...shopping?.expected,basketboss_cloud_session_v1:pin.session});
   host().reload();try{host().refresh();}catch{}
   return {ok:true,message:'Remaining amount updated. Shopping uses the new balance.'};
  }
  function householdConfirmationContext(pin){
   checkDraftActor();
   if(win.BBAccountDeletion?.isDeleting?.()||win.BBReceiptHost?.hasPendingConfirmation?.())throw Error('Finish the pending account or receipt review before confirming Weekly essentials.');
   if(!pin||pin.actor!==actor()||pin.session!==store.getItem('basketboss_cloud_session_v1'))throw Error('Your account changed. Close and reopen this confirmation.');
   if(pin.features!==null&&typeof pin.features!=='string')throw Error('Review your saved Weekly essentials before confirming.');
   let features=null;try{features=pin.features===null?null:JSON.parse(pin.features);}catch{throw Error('Review your saved Weekly essentials before confirming.');}
   if(features!==null&&(!object(features)||!Array.isArray(features.essentials)))throw Error('Review your saved Weekly essentials before confirming.');
   return {features,who:actor(),session:pin.session};
  }
  function householdConfirmationPatch(patch){
   if(!object(patch)||Object.keys(patch).some(key=>!['targetQty','ownedQty','unit','packQuantity','packUnit','packReviewed'].includes(key))||!valid(patch.targetQty)||!valid(patch.ownedQty))throw Error('Enter valid Total needed and Already at home amounts.');
   const measured=['unit','packQuantity','packUnit','packReviewed'].some(key=>Object.hasOwn(patch,key));
   if(measured&&(!['g','ml'].includes(patch.unit)||patch.packUnit!==patch.unit||patch.packReviewed!==true||!valid(patch.packQuantity)||patch.packQuantity<=0))throw Error('Review the full container size and amounts before confirming.');
   return {...patch};
  }
  function commitHouseholdConfirmation(feature,pin,context,{remove=false}={}){
   if(!feature||typeof feature.key!=='string'||feature.expected!==pin.features||!object(feature.value)||!Array.isArray(feature.value.essentials)||typeof feature.id!=='string')throw Error('Your Weekly essentials changed. Close and reopen this confirmation.');
   const item=feature.value.essentials.find(row=>row.id===feature.id);if(!item)throw Error('This essential changed. Close and reopen this confirmation.');
   const before=context.features?.essentials.find(row=>row.id===feature.id);
   // A larger target alone must retain this shop's checked/partial purchases.
   // An explicit replacement of stock, or a new weekly request, uses the same
   // receipt settlement as the existing absolute-amount editor.
   const ownedBefore=before?.ownedQty??(before?.owned?before.qty:0),ownedAfter=item.ownedQty??(item.owned?item.qty:0);
   const resetCredit=!remove&&(!before||before.selected===false||before.manualPending===false||before.unit!==item.unit||ownedBefore!==ownedAfter);
   let homeChange=null,shopping=null;
   if(resetCredit){const {all,data,who}=own(),expected=store.getItem(KEY);if(who!==context.who)throw Error('Your account changed. Reopen this confirmation.');shopping=settle(data,['ess:'+feature.id]);homeChange={all,expected};}
   if(actor()!==context.who||store.getItem('basketboss_cloud_session_v1')!==context.session||win.BBAccountDeletion?.isDeleting?.()||win.BBReceiptHost?.hasPendingConfirmation?.())throw Error('Your account or receipt review changed. Reopen this confirmation.');
   atomic(store,{...(homeChange?{[KEY]:homeChange.all}:{}),[feature.key]:feature.value,...shopping?.updates},{...(homeChange?{[KEY]:homeChange.expected}:{}),[feature.key]:feature.expected,...shopping?.expected,basketboss_cloud_session_v1:context.session});
   householdDraft.delete(feature.id);
   try{host().reload();}catch{}try{host().refresh();}catch{}
   return {ok:true,id:feature.id,item:{...item},message:remove?'Weekly requirement removed. Your stock has been kept.':'Weekly essential confirmed. Shop is up to date.'};
  }
  function confirmHousehold(id,patch,pin){
   const context=householdConfirmationContext(pin),next=householdConfirmationPatch(patch);
   if(typeof id!=='string'||!context.features?.essentials.some(row=>row.id===id))throw Error('This essential changed. Reopen its confirmation.');
   host().reload();const feature=host().prepareHousehold([[id,next]]);return commitHouseholdConfirmation({...feature,id},pin,context);
  }
  function confirmHouseholdEntry(entry,pin){
   const context=householdConfirmationContext(pin);
   if(!object(entry)||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>70||typeof entry.unit!=='string'||!valid(entry.targetQty)||!valid(entry.ownedQty))throw Error('Enter the item, unit and valid household amounts.');
   if(typeof host()?.prepareHouseholdEntry!=='function')throw Error('Weekly essentials are still loading. Close and reopen this confirmation.');
   host().reload();return commitHouseholdConfirmation(host().prepareHouseholdEntry({...entry}),pin,context);
  }
  function removeHousehold(id,pin){
   const context=householdConfirmationContext(pin);
   if(typeof id!=='string'||!context.features?.essentials.some(row=>row.id===id)||typeof host()?.prepareHouseholdRemoval!=='function')throw Error('This essential changed. Reopen Weekly essentials.');
   host().reload();return commitHouseholdConfirmation(host().prepareHouseholdRemoval(id),pin,context,{remove:true});
  }
  function foodTarget(row,{requirements,otherRows=[]}={}){
   const problem=message=>({totalNeeded:null,mealNeeded:null,minimumNeeded:null,manualNeeded:null,targetProblem:message});
   if(!row?.name||!row.unit)return problem('Choose an item and unit first.');
   const market=row.inputMarket||win.bb307ActiveMarket?.()||'UK',policy=win.BBPantryPolicy;
   const identityProblem=policy?.measuredIdentityProblem?.(row,win.BBPriceV19?.canonical);if(identityProblem)return problem(identityProblem);
   const automatic=row.automaticNeeded===true,container=row.staple===true&&policy?.isContainerTracked?.(row)!==false,measuredMode=row.trackingMode==='measured'&&row.measurementReviewed===true&&policy?.isContainerTracked?.(row)===false;
   const options=value=>({market:value?.inputMarket||market,canonicalize:win.BBPriceV19?.canonical,packReviewed:value?.packReviewed===true,packQuantity:value?.packQuantity,packUnit:value?.packUnit,wholePepper:policy?.isWholePepper?.(value?.name||value?.key,value?.unit,value)});
   const measure=(value,quantity)=>{
    if(container&&value.staple===true&&policy?.isContainerTracked?.(value)!==false)return value.unit==='each'&&valid(quantity)&&quantity<=10000?{quantity,unit:'each'}:null;
    if(policy)return policy.normalize(value.name||value.key,quantity,value.unit,options(value));
    const unit=value.unit==='kg'?'g':value.unit==='l'?'ml':value.unit,factor=['kg','l'].includes(value.unit)?1000:1;
    return ['g','ml','each'].includes(unit)&&valid(quantity*factor)?{quantity:Math.round(quantity*factor*1000000)/1000000,unit}:null;
   };
   const one=measure(row,1);if(!one||!(one.quantity>0))return problem('Set compatible container contents before adding this item to Shop. Your saved stock has been kept.');
   const nameId=host().id(row.name,''),matching=name=>host().id(name,'')===nameId;
   const raw=row.qty===null||row.qty===undefined||row.qty===''?null:Number(row.qty),owned=raw===null?{quantity:0,unit:one.unit}:measure(row,raw);
   if(!owned||owned.unit!==one.unit||!valid(owned.quantity))return problem('Review the amount at home before adding this item to Shop.');
   let planned=0,prior=0,manual=0,otherOwned=0,otherOwnedNeedsReview=false,defaultRestock=0,hasPrior=false,plannedNeedsReview=false,otherRequestsNeedReview=false;
   for(const item of otherRows){
    if(!matching(item?.name||item?.key)||item.qty===null||item.qty===undefined||item.qty==='')continue;
    const value=measure(item,Number(item.qty));
    if(!value||value.unit!==one.unit){if(Number(item.qty)>0)otherOwnedNeedsReview=true;continue;}otherOwned+=value.quantity;
   }
   for(const item of requirements||host()?.requirements?.()||[]){
    if(!matching(item.key||item.name)||!(Number(item.required)>0))continue;
    if(container){if(item.cupboardRequired===false){if(!automatic||!(raw>0)||(policy?.stapleStatus?.(row)||row.stapleStatus)!=='in')defaultRestock=1;continue;}planned=1;continue;}
    const value=measure(item,Number(item.required));
    if(measuredMode&&(!value||value.unit!==one.unit)){plannedNeedsReview=true;continue;}
    if(!value||value.unit!==one.unit)return problem('Review the planned ingredient units before adding this item to Shop.');planned+=value.quantity;
   }
   for(const target of Object.values(targets())){
    if(!target?.pending||!matching(target.name)||!valid(target.targetQty))continue;
    const value=measure({...target,staple:container},target.targetQty);if(measuredMode&&(!value||value.unit!==one.unit)){otherRequestsNeedReview=true;continue;}
    if(!value||value.unit!==one.unit||container&&!Number.isInteger(value.quantity))return problem('Review the saved shopping target unit before changing it.');hasPrior=true;prior=Math.max(prior,value.quantity);
   }
   for(const buy of shoppingBuys()){
    if(buy.kind==='household'||buy.source==='cupboard'||buy.purpose==='bought'||!matching(buy.name))continue;
    const value=measure({...buy,staple:container},buy.quantity);if(measuredMode&&(!value||value.unit!==one.unit)){otherRequestsNeedReview=true;continue;}
    if(!value||value.unit!==one.unit||container&&!Number.isInteger(value.quantity))return problem('Review this item’s existing Shop unit before changing its total.');manual+=value.quantity;
   }
   const restock=Math.max(prior,hasPrior?0:defaultRestock),totalOwned=owned.quantity+otherOwned;
   const minimum=automatic?planned:(manual>0?Math.max(planned,totalOwned):planned)+manual;
   const total=automatic?Math.max(planned,restock):Math.max(planned,restock,manual>0?totalOwned:0)+manual;
   if(![planned,prior,manual,minimum,total,totalOwned,restock].every(valid))return problem('Review the combined amount needed before adding this item to Shop.');
   const saved=Object.values(targets()).filter(target=>matching(target?.name)&&target.unit===one.unit).at(-1);
   let extraBuffer=0,buyMultiple=0;
   if(container&&(Object.hasOwn(row,'extraBuffer')&&!Number.isInteger(Number(row.extraBuffer))||Object.hasOwn(row,'buyMultiple')&&row.buyMultiple!==null&&!Number.isInteger(Number(row.buyMultiple))))return problem('Use whole container counts for this staple.');
   if(Object.hasOwn(row,'extraBuffer')&&typeof row.extraBuffer==='string'&&!row.extraBuffer.trim())return problem('Enter a valid extra stock buffer; use 0 for none.');
   if(Object.hasOwn(row,'buyMultiple')&&typeof row.buyMultiple==='string'&&!row.buyMultiple.trim())return problem('Choose a valid standard pack size, or use Exact amount.');
   if(Object.hasOwn(row,'extraBuffer')){const value=measure(row,Number(row.extraBuffer));if(!valid(Number(row.extraBuffer))||!value||value.unit!==one.unit)return problem('Enter a valid extra stock buffer.');extraBuffer=value.quantity;}
   else if(saved?.extraBuffer!==undefined){if(!valid(saved.extraBuffer))return problem('Review the saved extra stock buffer.');extraBuffer=saved.extraBuffer;}
   if(Object.hasOwn(row,'buyMultiple')){
    const amount=row.buyMultiple===null?0:Number(row.buyMultiple),unit=row.buyMultipleUnit||row.unit;
    const value=amount===0?{quantity:0,unit:one.unit}:measure({...row,unit,inputMarket:win.bb307ActiveMarket?.()||market},amount);
    if(!valid(amount)||!value||value.unit!==one.unit||amount>0&&!(value.quantity>0))return problem('Choose a compatible standard pack size.');buyMultiple=value.quantity;
   }else if(saved?.buyMultiple!==undefined){if(!valid(saved.buyMultiple))return problem('Review the saved standard pack size.');buyMultiple=saved.buyMultiple;}
   if(container&&(!Number.isInteger(extraBuffer)||!Number.isInteger(buyMultiple)))return problem('Use whole container counts for this staple.');
   // A half-used bottle is valid stock; a purchase is still a whole bottle.
   if(container)buyMultiple=Math.max(1,buyMultiple);
   let purchase;try{
    // Deliberate Shop purchases are extra quantities to buy. Existing pantry
    // stock covers meals and the buffer first, but never cancels that request.
    const missing=automatic?roundQuantity(Math.max(0,total+extraBuffer-totalOwned)+manual):null;
    purchase=automatic?purchaseAmounts({needed:missing,owned:0,multiple:buyMultiple,unit:one.unit}):purchaseAmounts({needed:total,buffer:extraBuffer,owned:totalOwned,multiple:buyMultiple,unit:one.unit});
   }catch(error){return problem(error.message);}
   const view=value=>Math.round(value/one.quantity*1000000)/1000000;
   return {totalNeeded:view(total),totalQuantity:total,requiredNeeded:view(total+extraBuffer),requiredQuantity:roundQuantity(total+extraBuffer),extraBuffer:view(extraBuffer),extraBufferQuantity:extraBuffer,buyMultiple:view(buyMultiple),buyMultipleUnit:row.unit,buyMultipleQuantity:buyMultiple,unroundedShortfall:view(purchase.shortfall),purchasePackCount:purchase.packCount,mealNeeded:view(planned),minimumNeeded:view(minimum),manualNeeded:view(manual),otherOwned:view(otherOwned),otherOwnedNeedsReview,plannedNeedsReview,otherRequestsNeedReview,shortfall:view(purchase.purchaseQuantity),targetProblem:'',canonicalUnit:one.unit,quantityPerUnit:one.quantity,quantityTolerance:Math.max(0.000001,one.quantity*0.0000005+0.0000005),mealQuantity:planned,manualQuantity:manual,minimumQuantity:minimum,restockQuantity:prior,restockPending:hasPrior,defaultRestockQuantity:hasPrior?0:defaultRestock};
  }
  function roundShoppingItems(items){
   const preferences=Object.values(targets()),policy=win.BBPantryPolicy,market=win.bb307ActiveMarket?.()||'UK';
   return (items||[]).map(item=>{
    if(!(Number(item.toBuy)>0))return item;
    const recorded=valid(item.recordedPurchaseFloor)?item.recordedPurchaseFloor:0;
    const name=item.key||item.name;
    let one,multiple;
    try{
     if(item.staple===true)one={quantity:1,unit:'each'};
     else if(policy)one=policy.normalize(name,1,item.unit,{market,canonicalize:win.BBPriceV19?.canonical});
     else one={quantity:['kg','l'].includes(item.unit)?1000:1,unit:item.unit==='kg'?'g':item.unit==='l'?'ml':item.unit};
     if(!one||!(one.quantity>0))return item;
     // Preferences are saved in canonical units. Name aliases alone cannot
     // distinguish a spice container from measured whole produce (pepper).
     const match=preferences.find(row=>host().id(row.name,'')===host().id(name,'')&&row.unit===one.unit&&valid(row.buyMultiple)&&row.buyMultiple>0);if(!match)return item;
     multiple={quantity:match.buyMultiple,unit:match.unit};
     const size=multiple.quantity/one.quantity;
     if(recorded>0&&Number(item.rawAutomaticPurchaseDemand)<=recorded)return {...item,buyMultiple:size,buyMultipleUnit:item.unit,purchasePackCount:0,unroundedToBuy:0,purchaseRounded:false};
     const purchase=purchaseAmounts({needed:Number(item.toBuy),owned:recorded,multiple:size,unit:item.unit});
     return {...item,toBuy:roundQuantity(recorded+purchase.purchaseQuantity),buyMultiple:size,buyMultipleUnit:item.unit,purchasePackCount:purchase.packCount,unroundedToBuy:purchase.shortfall,purchaseRounded:purchase.rounded};
    }catch{return item;}
   });
  }
  function requirement(name,unit){try{const base=unit==='kg'?'g':unit==='l'?'ml':unit;return (host()?.requirements()?.find(row=>host().id(row.key,row.unit)===host().id(name,base))?.required||0)/(unit==='kg'||unit==='l'?1000:1);}catch{return 0;}}
  function total(name,unit){const base=unit==='kg'?'g':unit==='l'?'ml':unit,row=targets()[host().id(name,base)],factor=unit==='kg'||unit==='l'?1000:1;return roundQuantity(Math.max(requirement(name,unit),row?.pending?row.targetQty/factor:0)+(valid(row?.extraBuffer)?row.extraBuffer/factor:0));}
  function prepare(chosen){
   checkDraftActor();const {all,data,who}=own();const expected=store.getItem(KEY);
   for(const [index,row]of chosen.entries()){if(row.automaticNeeded!==true&&(row.totalNeeded===undefined||row.totalNeeded===''||row.totalNeeded===null))continue;
    let unit=row.unit==='kg'?'g':row.unit==='l'?'ml':row.unit;
    if(row.qty===null||row.qty===undefined||row.qty==='')throw Error('Enter how much '+row.name+' you already have; use 0 for none.');
    let targetQty=Number(row.totalNeeded)*(row.unit==='kg'||row.unit==='l'?1000:1),automaticTargetPending=false;
    if(row.pantryTarget===true){
     const info=foodTarget(row,{otherRows:chosen.filter((_,at)=>at!==index)});if(info.targetProblem)throw Error(info.targetProblem);
     targetQty=row.automaticNeeded===true?info.totalQuantity:Math.round(Number(row.totalNeeded)*info.quantityPerUnit*1000000)/1000000;unit=info.canonicalUnit;
     if(Number(row.totalNeeded)===info.totalNeeded)targetQty=info.totalQuantity;
     if(row.staple===true&&win.BBPantryPolicy?.isContainerTracked?.(row)!==false&&(!Number.isInteger(targetQty)||targetQty>10000))throw Error('Use whole container counts for this staple.');
     if(!valid(targetQty)||targetQty+info.quantityTolerance<info.minimumQuantity)throw Error(info.manualQuantity>0?'This item already has an extra amount on Shop. Keep its current total or amend that Shop item first.':'Total needed cannot be less than your planned meals need.');
     targetQty=Math.abs(targetQty-info.minimumQuantity)<=info.quantityTolerance?info.minimumQuantity:Math.max(targetQty,info.minimumQuantity);
     // Direct Shop top-ups already contribute after pantry deduction. Keep
     // them intact and add only the remainder of this absolute stock target.
     targetQty=row.automaticNeeded===true?info.restockQuantity:Math.round(Math.max(0,targetQty-info.manualQuantity)*1000000)/1000000;
     if(row.automaticNeeded===true)automaticTargetPending=info.restockPending;
     for(const buy of Object.values(data.manualBuys||{}))if(buy?.pending!==false&&buy.kind!=='household'&&buy.source!=='cupboard'&&buy.purpose!=='bought'&&host().id(buy.name,'')===host().id(row.name,'')&&(!(row.trackingMode==='measured'&&row.measurementReviewed===true)||buy.unit===info.canonicalUnit))buy.boughtAtRequest=0;
    }
    if(!valid(targetQty)||!['g','ml','tsp','tbsp','each','pack','clove','tin','loaf','slice','bulb'].includes(unit)||unit==='pack'&&!Number.isInteger(targetQty))throw Error('Check the total needed for '+row.name+'.');
    const id=host().id(row.name,unit),before=data.targets[id];
    const legacy=host().household().find(item=>item.selected&&!item.owned&&!Object.hasOwn(item,'targetQty')&&host().id(item.name,'g')===host().id(row.name,'g'));if(legacy)throw Error('Check the saved '+row.name+' food top-up first so it is not counted twice.');
    let preferences={};
    if(row.pantryTarget===true){const info=foodTarget(row,{otherRows:chosen.filter((_,at)=>at!==index)});if(info.targetProblem)throw Error(info.targetProblem);if(info.extraBufferQuantity>0)preferences.extraBuffer=info.extraBufferQuantity;if(info.buyMultipleQuantity>0)preferences.buyMultiple=info.buyMultipleQuantity;}
    else{if(valid(before?.extraBuffer)&&before.extraBuffer>0)preferences.extraBuffer=before.extraBuffer;if(valid(before?.buyMultiple)&&before.buyMultiple>0)preferences.buyMultiple=before.buyMultiple;}
    data.targets[id]={name:row.name,unit,targetQty,pending:row.automaticNeeded===true?automaticTargetPending:row.targetChanged||!before?true:before.pending,...preferences,...(row.automaticNeeded===true?{automaticNeeded:true}:{})};
   }
   for(const item of win.BBSharedShopping?.knownCompletedItems?.()||[]){if(item.completed&&item.completed_by===who&&chosen.some(row=>row.qty!==null&&row.qty!==undefined&&row.qty!==''&&host().id(row.name,row.unit)===host().id(item.name,item.unit))){data.sharedPurchases??={};const key=item.household_id+':'+item.id;if((data.sharedPurchases[key]?.revision||0)<item.revision)data.sharedPurchases[key]={revision:item.revision,checked:true};}}
   const featureChange=householdDraft.size?host().prepareHousehold([...householdDraft]):null;
   const shoppingChange=settle(data,[...chosen.filter(row=>row.qty!==null&&row.qty!==undefined&&row.qty!=='').map(row=>host().id(row.name,row.unit)),...[...householdDraft.keys()].map(id=>'ess:'+id)]);
   return {key:KEY,value:all,expected,who,featureChange,shoppingChange};
  }
  function prepareSharedPurchase(item,checked,pin){
   if(!item||!!item.completed!==!!checked||checked&&item.completed_by!==pin?.actor||pin?.actor!==actor()||pin.actor==='guest'||item.household_id!==pin.household_id||!Number.isSafeInteger(item.revision)||item.revision<1)throw Error('Shared shopping account changed. Refresh the list.');
   const {all,data}=own(),expected=store.getItem(KEY),key=item.household_id+':'+item.id;data.sharedPurchases??={};
   if(Number(data.sharedPurchases[key]?.revision||0)>=item.revision)return {already:true};
   data.sharedPurchases[key]={revision:item.revision,checked:!!checked};
   return {updates:{[KEY]:all},expected:{[KEY]:expected}};
  }
  function completionChanges(id){
   if(id.startsWith('ess:'))return host()?.completeHousehold(id.slice(4))||{};
   const {all,data}=own();if(!data.targets[id]?.pending)return {};data.targets[id].pending=false;return {[KEY]:all};
  }
  function complete(id){atomic(store,completionChanges(id));host()?.reload?.();}

  function needsLegacyReview(id){try{return !!host()?.needsLegacyReview?.(host().recipeIngredients(id,1));}catch{return true;}}
  function completed(data,key,details={}){
   const exact=!!data.planned?.[key];
   // Builds that used UTC weeks could write Monday's identifier while a US
   // family was still finishing Sunday. Retain that confirmed occurrence only
   // when its recorded cooking timestamp belongs to the current regional week.
   if(typeof key!=='string'||!/^\d{4}-\d\d-\d\d\|/.test(key)||typeof win.BBReducedPurchases?.week!=='function')return exact;
   const week=key.slice(0,10),suffix=key.slice(10),kinds=['dinner','dessert','lunch','leftover','note'];
   let match=details;
   if(!match.recipeId){const parts=key.slice(11).split('|'),at=parts.findIndex((part,index)=>kinds.includes(part)&&['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].includes(parts[index+1]));
    if(at>=0)match={kind:parts[at],day:parts[at+1],recipeId:parts.slice(at+2).join('|')};
    else{try{const row=JSON.parse(key.slice(11));match={kind:'dinner',day:row.day,recipeId:row.recipeId};}catch{return exact;}}
   }
   let market,current;try{market=host()?.conversionContext?.()?.market;current=win.BBReducedPurchases.week(win.Date?.now?.()??Date.now(),market);}catch{return exact;}
   if(current!==week)return exact;
   const matching=row=>row&&row.recipeId===match.recipeId&&row.day===match.day&&(row.kind||'dinner')===(match.kind||'dinner')&&Number.isFinite(row.at);
   if(exact){let fromOtherWeek=false;
    for(const row of Object.values(data.cooked||{})){if(!matching(row)||row.occurrence&&row.occurrence!==key)continue;
     const utc=new Date(row.at);if(!Number.isFinite(utc.getTime()))continue;utc.setUTCHours(0,0,0,0);utc.setUTCDate(utc.getUTCDate()-(utc.getUTCDay()+6)%7);
     try{const regional=win.BBReducedPurchases.week(row.at,market);if(regional===week)return true;if(utc.toISOString().slice(0,10)===week)fromOtherWeek=true;}catch{}
    }
    return !fromOtherWeek;
   }
   const alternatives=Object.keys(data.planned||{}).filter(old=>data.planned[old]&&old.slice(10)===suffix&&old.slice(0,10)!==week&&/^\d{4}-\d\d-\d\d\|/.test(old));
   for(const old of alternatives)for(const row of Object.values(data.cooked||{})){
    if(!matching(row)||row.occurrence&&row.occurrence!==old)continue;
    const utc=new Date(row.at);if(!Number.isFinite(utc.getTime()))continue;utc.setUTCHours(0,0,0,0);utc.setUTCDate(utc.getUTCDate()-(utc.getUTCDay()+6)%7);
    if(utc.toISOString().slice(0,10)!==old.slice(0,10))continue;
    try{if(win.BBReducedPurchases.week(row.at,market)===week)return true;}catch{}
   }
   return false;
  }
  function isCooked(key){return completed(own().data,key);}
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  function completionHome(actorId){
   const who=actor();if(actorId!==who)throw Error('Your account changed. Reopen Cook before updating At home.');
   const oldHome=store.getItem(KEY),all=oldHome===null?{version:1,byActor:{}}:JSON.parse(oldHome);
   if(!object(all)||all.version!==1||all.byActor!==undefined&&!object(all.byActor))throw Error('Review your saved At home records before updating stock.');
   all.byActor??={};all.byActor[who]??={targets:{},cooked:{},planned:{}};
   const data=all.byActor[who];if(!object(data))throw Error('Review your saved At home records before updating stock.');
   for(const key of ['targets','cooked','planned']){data[key]??={};if(!object(data[key]))throw Error('Review your saved At home records before updating stock.');}
   return {all,data,who,oldHome};
  }
  function pantrySnapshot(state,ingredients,identity){
   if(blocked())throw Error('Review At home before updating these ingredients.');
   if(!deduction)throw Error('Pantry quantities are still loading. Reopen Cook to try again.');
   if(host().needsLegacyReview?.(ingredients))throw Error('Review the ingredient amounts in At home before updating this older shopping record.');
   const keys=host().keys();if(typeof keys?.stock!=='string'||typeof keys?.inventory!=='string')throw Error('Pantry storage is still loading.');
   const oldStock=store.getItem(keys.stock),oldInv=store.getItem(keys.inventory),oldOwner=store.getItem('basketboss_receipt_projection_owner_v1'),oldPlan=store.getItem('basketboss_321_unified_state_v1'),oldSession=store.getItem('basketboss_cloud_session_v1');
   const stock=host().stock(),conversion=host().conversionContext?.(),result=deduction.proposal({stock,ingredients,id:host().id,conversion});
   const inventory=oldInv===null?{}:JSON.parse(oldInv);if(!object(inventory))throw Error('Review your saved pantry inventory before updating stock.');
   const extraKeys=host().completionKeys?.()||[];if(!Array.isArray(extraKeys)||extraKeys.length>30||extraKeys.some(key=>typeof key!=='string'||!key||key.length>200))throw Error('Review your saved meal plan before updating stock.');
   const extra=Object.fromEntries(extraKeys.map(key=>[key,store.getItem(key)]));
   const fingerprint=JSON.stringify({who:state.who,...identity,oldHome:state.oldHome,oldStock,oldInv,oldOwner,oldPlan,oldSession,extra,ingredients,stock,conversion});
   return {...state,keys,stock,ingredients,inventory,conversion,result,fingerprint,expected:{...extra,[keys.stock]:oldStock,[keys.inventory]:oldInv,[KEY]:state.oldHome,basketboss_receipt_projection_owner_v1:oldOwner,basketboss_321_unified_state_v1:oldPlan,basketboss_cloud_session_v1:oldSession}};
  }
  function cookSnapshot(event={}){
   const {sessionId,recipeId,day,factor,actorId,occurrence,kind}=event;
   if(typeof sessionId!=='string'||!sessionId||sessionId.length>160||typeof recipeId!=='string'||!recipeId||recipeId.length>256||!Number.isFinite(factor)||factor<=0||factor>100)throw Error('Check the cooking servings before updating At home.');
   const state=completionHome(actorId);
   if(state.data.cooked[sessionId]||occurrence&&completed(state.data,occurrence,{recipeId,day,kind}))return {...state,already:true};
   const currentOccurrence=host().occurrence?.(recipeId,day,kind)||null;
   if(occurrence&&occurrence!==currentOccurrence)throw Error('Your planned '+(kind==='dessert'?'dessert':'dinner')+' changed. Reopen Cook before updating At home.');
   const ingredients=host().recipeIngredients(recipeId,factor);if(!ingredients?.length)throw Error('Ingredient amounts need review in At home.');
   return pantrySnapshot(state,ingredients,{sessionId,recipeId,day,factor,occurrence,currentOccurrence,kind});
  }
  function previewCook(event){
   try{const state=cookSnapshot(event);if(state.already)return {ok:true,already:true,rows:[],issues:[],fingerprint:null,message:'At home already updated for this cooked meal.'};return {ok:true,already:false,rows:state.result.rows,issues:state.result.issues,fingerprint:state.fingerprint};}
   catch(error){return {ok:false,rows:[],issues:[],message:error?.message||'Review your pantry amounts before updating At home.'};}
  }
  function projectKitchen(state,result){
   // Keep frozen reserves until fresh food has been used. Retaining balances
   // in this order spends urgent reduced food first, then other unfrozen stock.
   const retentionRank=row=>row.loc==='freezer'?0:win.BBReducedStock?.isUrgent?.(row,{actor:state.who})?2:1;
   const retain=records=>records.sort((a,b)=>retentionRank(a.row||a)-retentionRank(b.row||b));
   if(result.preservesSourceUnits){
    const groups=new Map();
    for(const row of Object.values(state.inventory)){const key=row?.bb173StockKey;if(row?.selected===false||typeof key!=='string'||!Object.hasOwn(state.stock,key))continue;const records=groups.get(key)||[];records.push(row);groups.set(key,records);}
    for(const [key,records]of groups){
     retain(records);
     const source=deduction.measure(key.slice(key.lastIndexOf('|')+1));let left=result.remainingStock[key]||0;
     records.forEach((row,index)=>{const amount=index===records.length-1?left:Math.min(left,Math.max(0,Number(row.bb173StockValue)||0));left=Math.max(0,left-amount);row.bb173StockValue=amount;const display=deduction.measure(row.unit);if(display.unit===source.unit)row.qty=amount*source.factor/display.factor;else{row.unit=key.slice(key.lastIndexOf('|')+1);row.qty=amount;}});
    }
    return;
   }
   const groups=new Map(),remaining=deduction.stockData(result.remainingStock,host().id).values;
   for(const row of Object.values(state.inventory)){
    if(row?.selected===false||!row?.bb173StockKey)continue;const at=row.bb173StockKey.lastIndexOf('|');if(at<1)continue;
    const info=deduction.measure(row.bb173StockKey.slice(at+1)),key=host().id(row.bb173StockKey.slice(0,at),info.unit),records=groups.get(key)||[];
    records.push({row,value:(Number(row.bb173StockValue)||0)*info.factor});groups.set(key,records);
   }
   for(const [key,records]of groups){
    retain(records);
    let left=Number(remaining[key]||0);const base=key.slice(key.lastIndexOf('|')+1);
    records.forEach(({row,value},index)=>{const amount=index===records.length-1?left:Math.min(left,Math.max(0,value));left=Math.max(0,left-amount);row.bb173StockKey=key;row.bb173StockValue=amount;const display=deduction.measure(row.unit);if(display.unit!==base)row.unit=base;row.qty=amount/(display.unit===base?display.factor:1);});
   }
  }
  function commitConsumption(state,result){
   projectKitchen(state,result);
   if(win.BBReducedStock?.settleInventory){
    const previous=state.expected[state.keys.inventory],before=previous===null?{}:JSON.parse(previous);
    state.inventory=win.BBReducedStock.settleInventory({before,after:state.inventory,actor:state.who,policy:win.BBPantryPolicy,market:state.conversion?.market});
   }
   const physical=result.used.flatMap(row=>(row.allocations||[]).map(allocation=>{const at=allocation.stockKey.lastIndexOf('|');return host().id(allocation.stockKey.slice(0,at),deduction.measure(allocation.stockKey.slice(at+1)).unit);}));
   const shopping=settle(state.data,[...result.used.map(row=>row.id),...physical],true);
   if(actor()!==state.who||blocked())return false;
   atomic(store,{[state.keys.stock]:result.remainingStock,[state.keys.inventory]:state.inventory,[KEY]:state.all,...shopping?.updates},{...state.expected,...shopping?.expected});host().refresh();return true;
  }
  async function syncConsumption(result){
   const review=result.issues.length?' Some amounts need review in At home; those units were not guessed.':'';
   const receipt=win.BBReceiptHost,sync=receipt?.confirmCookedPantry||receipt?.confirmCurrentPantry;
   if(sync){try{
    const response=await sync.call(receipt,{stock:result.remainingStock});
    if(response?.code==='inventory_ambiguous_package_sources')return {ok:true,issues:result.issues,message:'Different pack sizes need review in At home. Your amounts remain saved on this device.'+review};
    if(!response?.ok||response.needsReview)return {ok:true,issues:result.issues,message:'At home updated on this device. Review online pantry confirmation.'+review};
    if(response.weeklyReviewRequired)return {ok:true,issues:result.issues,weeklyReviewRequired:true,message:'At home updated. Review your remaining food and essentials before the next shop.'+review};
   }catch{return {ok:true,issues:result.issues,message:'At home updated on this device; online confirmation can be retried.'+review};}}
   return {ok:true,issues:result.issues,message:'At home updated. Your shopping list now uses the remaining stock.'+review};
  }
  async function cooked(event={}){
   let state;try{state=cookSnapshot(event);}catch(error){return {ok:false,message:error?.message||'Review At home before updating these ingredients.'};}
   if(state.already)return {ok:true,already:true,message:'At home already updated for this cooked meal.'};
   if(event.expected!==undefined&&(typeof event.expected!=='string'||event.expected!==state.fingerprint))return {ok:false,needsReview:true,message:'Your pantry or recipe changed. Review the latest amounts before deducting.'};
   let result;try{result=deduction.proposal({stock:state.stock,ingredients:state.ingredients,amounts:event.amounts,id:host().id,conversion:state.conversion});}catch(error){return {ok:false,needsReview:true,message:error?.message||'Review the used ingredient amounts.'};}
   const {sessionId,recipeId,day,factor,occurrence,kind}=event;
   state.data.cooked[sessionId]={recipeId,day:day||null,factor,...(kind?{kind}:{}),...(occurrence?{occurrence}:{}),at:Date.now(),ingredients:result.used.map(row=>({key:row.key,unit:row.unit,quantity:row.required})),skipped:result.issues.map(row=>row.id)};
   if(occurrence)state.data.planned[occurrence]=true;
   if(!commitConsumption(state,result))return {ok:false,message:'Your account or pantry changed. Review the latest amounts first.'};
   return syncConsumption(result);
  }
  function daySnapshot(event={}){
   const {day,actorId}=event;if(typeof day!=='string'||!day.trim()||day.length>16)throw Error('Choose a planned day before confirming its food.');
   const state=completionHome(actorId),contexts=host()?.dayMeals?.(day);
   if(!Array.isArray(contexts)||!contexts.length||contexts.length>30)throw Error('There is no planned food to confirm for this day.');
   const seen=new Set(),items=contexts.map(context=>{
    const {kind,recipeId,factor,occurrence}=context||{};
    if(!['dinner','dessert','lunch','leftover','note'].includes(kind)||typeof recipeId!=='string'||!recipeId||recipeId.length>256||!Number.isFinite(factor)||factor<=0||factor>100||context.day!==day||typeof occurrence!=='string'||!occurrence||occurrence.length>2000||['__proto__','constructor','prototype'].includes(occurrence)||seen.has(occurrence))throw Error('The day’s food changed. Review the planned meals before confirming.');
    seen.add(occurrence);
    if(!Array.isArray(context.ingredients)||context.ingredients.length>500||!context.ingredients.length&&!['leftover','note'].includes(kind))throw Error('Review the ingredient amounts for '+(context.name||recipeId)+' before confirming this day.');
    const item={kind,recipeId,name:String(context.name||recipeId).slice(0,240),day,factor,occurrence,ingredients:context.ingredients.map(row=>({...row})),already:completed(state.data,occurrence,{recipeId,day,kind}),manualReview:context.manualReview===true};
    if(kind==='leftover'&&context.sourceOccurrence===undefined)throw Error('Review the original batch before confirming leftovers.');
    if(context.sourceOccurrence!==undefined){if(typeof context.sourceOccurrence!=='string'||!context.sourceOccurrence||context.sourceOccurrence.length>2000||['__proto__','constructor','prototype'].includes(context.sourceOccurrence))throw Error('Review the original batch before confirming leftovers.');item.sourceOccurrence=context.sourceOccurrence;}
    return item;
   });
   const pending=items.filter(item=>!item.already);
   if(!pending.length)return {...state,items,already:true};
   for(const item of pending)if(item.sourceOccurrence&&!completed(state.data,item.sourceOccurrence))throw Error('Confirm the original batch cooked before marking these leftovers done.');
   const ingredients=pending.flatMap(item=>item.ingredients),snapshot=pantrySnapshot(state,ingredients,{day,items});
   const manualIssues=pending.filter(item=>item.manualReview).map(item=>({id:'manual:'+item.occurrence,message:item.name+' has no measured ingredient list. Check its remaining amounts in At home.'}));
   return {...snapshot,day,items,pending,manualIssues};
  }
  function previewDay(event){
   try{
    const state=daySnapshot(event),items=state.items.map(({kind,name,already})=>({kind,name,already}));
    if(state.already)return {ok:true,already:true,items,rows:[],issues:[],fingerprint:null,message:'All planned food for this day is already confirmed.'};
    return {ok:true,already:false,items,rows:state.result.rows,issues:[...state.result.issues,...state.manualIssues],fingerprint:state.fingerprint};
   }catch(error){return {ok:false,already:false,items:[],rows:[],issues:[],needsReview:true,message:error?.message||'Review this day’s food and pantry amounts first.'};}
  }
  async function finishDay(event={}){
   let state;try{state=daySnapshot(event);}catch(error){return {ok:false,needsReview:true,message:error?.message||'Review this day’s food and pantry amounts first.'};}
   if(state.already)return {ok:true,already:true,completedCount:0,issues:[],message:'All planned food for this day is already confirmed.'};
   if(typeof event.expected!=='string'||event.expected!==state.fingerprint)return {ok:false,needsReview:true,message:'Your day’s food or pantry changed. Review the latest amounts before confirming.'};
   const result={...state.result,issues:[...state.result.issues,...state.manualIssues]},available=new Map(result.used.map(row=>[row.id,row.required]));
   for(const item of state.pending){
    const rows=deduction.proposal({stock:state.stock,ingredients:item.ingredients,id:host().id,conversion:state.conversion}).rows,ingredients=[];
    for(const row of rows){const amount=Math.min(available.get(row.id)||0,row.required||0);if(amount>0){ingredients.push({key:row.name,unit:row.unit,quantity:amount});available.set(row.id,(available.get(row.id)||0)-amount);}}
    state.data.cooked['day:'+item.occurrence]={kind:item.kind,recipeId:item.recipeId,day:item.day,factor:item.factor,occurrence:item.occurrence,at:Date.now(),ingredients,skipped:result.issues.filter(issue=>issue.id==='manual:'+item.occurrence||rows.some(row=>row.id===issue.id)).map(issue=>issue.id)};
    state.data.planned[item.occurrence]=true;
   }
   if(!commitConsumption(state,result))return {ok:false,needsReview:true,message:'Your account or pantry changed. Review the latest amounts first.'};
   const response={...await syncConsumption(result),completedCount:state.pending.length};
   if(actor()===state.who&&!win.BBAccountDeletion?.isDeleting?.())try{host().notify?.(response.message);}catch{}
   return response;
  }
  function shoppingBuys(){
   const data=own().data;return Object.entries(object(data.manualBuys)?data.manualBuys:{}).filter(([,row])=>row?.pending!==false&&valid(row.quantity)&&row.quantity>0).map(([id,row])=>({...row,id}));
  }
  function shoppingBuyId(row){
   if(row.kind!=='household')return host().id(row.name,row.unit);
   const saved=(host().household?.()||[]).find(item=>host().id(item.name,item.unit)===host().id(row.name,row.unit));
   const prior=row.purpose==='bought'?shoppingBuys().find(item=>item.kind==='household'&&item.id!==row.id&&host().id(item.name,item.unit)===host().id(row.name,row.unit)):null;
   return 'ess:'+(saved?.id||'manual-'+(prior?.id||row.id));
  }
  function addShoppingBuy(request={}){
   let state;
   try{
    const name=typeof request.name==='string'?request.name.trim().replace(/\s+/g,' '):'',text=String(request.quantityText??'').trim();
    if(!name||name.length>70||name.includes('|')||['__proto__','constructor','prototype'].includes(name.toLowerCase()))throw Error('Enter an item name of up to 70 characters.');
    const number='(\\d+(?:\\.\\d+)?|\\.\\d+)',contents='(kg|g|ml|l|each|items?)',containers='(bags?|packs?|packets?|bottles?|cartons?|tins?|cans?|boxes?|tubs?)';
    const sized=text.match(new RegExp('^'+number+'\\s*[x×]\\s*'+number+'\\s*'+contents+'$','i'))||text.match(new RegExp('^'+number+'\\s*'+containers+'\\s*\\(\\s*'+number+'\\s*'+contents+'\\s*(?:each)?\\s*\\)$','i'));
    const match=sized?null:text.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([a-zA-Z][a-zA-Z .]*|)$/);if(!match&&!sized)throw Error('Enter 2, 500 g, or a known pack amount such as 1 pack (500 g).');
    const aliases={pcs:'each',pc:'each',count:'each',counts:'each',bottle:'each',bottles:'each',jar:'each',jars:'each',box:'pack',boxes:'pack'},packCount=sized?Number(sized[1]):null,contentQuantity=sized?Number(sized.length===4?sized[2]:sized[3]):null,contentUnit=sized?(sized.length===4?sized[3]:sized[4]).toLowerCase():null;
    if(sized&&(!Number.isInteger(packCount)||packCount<1||packCount>10000||!(contentQuantity>0)))throw Error('Check the number of packs and their contents.');
    const rawUnit=sized?(sized.length===4?'pack':sized[2].toLowerCase()):match[2].toLowerCase()||'each',raw=sized?packCount:Number(match[1]),info=deduction.measure(sized?contentUnit:aliases[rawUnit]||rawUnit),purchaseQuantity=sized?packCount*contentQuantity:raw;
    const policyMeasured=win.BBPantryPolicy?.normalize?.(name,purchaseQuantity,sized?contentUnit:aliases[rawUnit]||rawUnit);
    if(!info.known&&!policyMeasured||!valid(purchaseQuantity)||!valid(purchaseQuantity*info.factor)||!['g','ml','tsp','tbsp','cup','pint','oz','lb','fl oz'].includes(info.unit)&&!Number.isInteger(purchaseQuantity))throw Error('Check the quantity and unit; use whole numbers for items and packs.');
    if(typeof request.requestId!=='string'||!request.requestId||request.requestId.length>180||['__proto__','constructor','prototype'].includes(request.requestId))throw Error('Reopen Add item to save this request safely.');
    state=completionHome(request.actorId);if(blocked())throw Error('Finish the pending pantry or receipt review before changing this list.');
    state.data.manualBuys??={};state.data.manualRequests??={};if(!object(state.data.manualBuys)||!object(state.data.manualRequests))throw Error('Review your saved manual shopping items first.');
    const kind=host().shoppingKind?.(name)||'food',measured=kind==='food'&&host().shoppingMeasure?host().shoppingMeasure(name,purchaseQuantity,sized?contentUnit:aliases[rawUnit]||rawUnit,sized?{packCount,packQuantity:contentQuantity,packUnit:contentUnit,reviewed:true}:{}):{key:name,quantity:purchaseQuantity*info.factor,unit:info.unit};
    if(!measured?.key||!valid(measured.quantity)||!measured.unit)throw Error('Review this item’s quantity and unit.');
    const id=kind+(request.reduced!==undefined?':bought:':':')+host().id(measured.key,measured.unit),intent=JSON.stringify({id,quantity:measured.quantity}),prior=state.data.manualRequests[request.requestId];
    if(prior){if(prior!==intent)throw Error('This saved request has changed. Reopen Add item.');return {ok:true,already:true,message:'This manual shopping request was already saved.'};}
    if(request.source==='cupboard'&&(kind!=='food'||!win.BBPantryPolicy?.isStaple(name)||measured.unit!=='each'||measured.quantity!==1))throw Error('Choose one cupboard staple to add to the list.');
    const candidate={id,name:measured.key,displayName:name,kind,quantity:measured.quantity,unit:measured.unit,sourceQuantity:raw,sourceUnit:aliases[rawUnit]||rawUnit,estimated:measured.estimated===true,needsReview:measured.needsReview===true,assumption:measured.assumption||'',pending:measured.quantity>0,...(request.source==='cupboard'?{source:'cupboard'}:{}),...(request.reduced!==undefined?{purpose:'bought'}:{}),...(sized?{packCount,packQuantity:contentQuantity,packUnit:contentUnit,packReviewed:true}:{})};
    const context=host().shoppingPurchaseContext?.(shoppingBuyId(candidate))||{};
    candidate.shopSessionId=context.shopSessionId||null;candidate.boughtAtRequest=valid(context.quantity)?context.quantity:0;
    state.data.manualBuys[id]=candidate;state.data.manualRequests[request.requestId]=intent;
    for(const old of Object.keys(state.data.manualRequests).slice(0,-200))delete state.data.manualRequests[old];
    const keys=host().keys(),expected={[KEY]:state.oldHome,[keys.stock]:store.getItem(keys.stock),basketboss_receipt_projection_owner_v1:store.getItem('basketboss_receipt_projection_owner_v1'),basketboss_cloud_session_v1:store.getItem('basketboss_cloud_session_v1')};
    if(actor()!==state.who||blocked())throw Error('Your account or pantry changed. Reopen Add item.');
    let purchase={};
    if(request.reduced!==undefined){
     if(win.BBReducedFoodHost?.isPremium?.()!==true)throw Error('Premium is required to log a reduced purchase.');
     if(typeof host().prepareManualPurchase!=='function')throw Error('Reduced purchases are still loading. Reopen Add item.');
     purchase=host().prepareManualPurchase({request,candidate,id:shoppingBuyId(candidate),context});
     if(!object(purchase)||!object(purchase.updates)||!object(purchase.expected)||Object.hasOwn(purchase.updates,KEY))throw Error('The reduced purchase could not be prepared safely.');
     for(const [key,value]of Object.entries(expected))if(Object.hasOwn(purchase.expected,key)&&purchase.expected[key]!==value)throw Error('Your account or shopping changed. Reopen Add item.');
    }
    atomic(store,{[KEY]:state.all,...purchase.updates},{...purchase.expected,...expected});
    const message=request.reduced!==undefined?name+' recorded as a reduced purchase. Finish shop to add it to At home.':measured.quantity>0?name+' added to buy: '+raw+' '+(aliases[rawUnit]||rawUnit)+'.':name+' removed from manual top-ups.';
    // The intent is committed even if a later repaint cannot complete.
    try{host().refresh();}catch{}try{host().notify?.(message);}catch{}
    return {ok:true,message};
   }catch(error){return {ok:false,message:error?.message||'Could not save this manual shopping item.'};}
  }
  function manualBuyItems(items){
   const output=items.map(row=>({...row})),map=new Map(output.map(row=>[host().id(row.key,row.unit),row]));
   for(const buy of shoppingBuys().filter(row=>row.kind!=='household')){
    const id=host().id(buy.name,buy.unit),context=host().shoppingPurchaseContext?.(id)||{},base=map.get(id)||{key:buy.name,unit:buy.unit,required:0,toBuy:0,pantryUsed:0,spend:null,sharedAcrossRecipes:0};
    // A cupboard promotion is a reminder to replace missing stock. A later
    // confirmed In stock edit covers it; deliberate Shop buys remain additive.
    if(buy.source==='cupboard'&&buy.purpose!=='bought'&&base.staple===true&&base.stapleStatus==='in'&&Number(base.pantryUsed)>0)continue;
    if(!map.has(id)){map.set(id,base);output.push(base);}
    const automatic=Number(base.toBuy)||0,baseline=buy.shopSessionId===context.shopSessionId?Number(buy.boughtAtRequest)||0:0,next=buy.source==='cupboard'||buy.purpose==='bought'?Math.max(automatic,baseline+buy.quantity):Math.max(automatic,baseline)+buy.quantity;
    if(buy.purpose==='bought'){base.recordedPurchaseFloor=Math.max(Number(base.recordedPurchaseFloor)||0,baseline+buy.quantity);base.rawAutomaticPurchaseDemand??=automatic;}else if(Object.hasOwn(base,'recordedPurchaseFloor'))base.rawAutomaticPurchaseDemand=next;
    base.required=(Number(base.required)||0)+next-automatic;base.toBuy=next;base.manualBuyQty=buy.quantity;base.manualBuyId=buy.id;base.quantityEstimated=!!base.quantityEstimated||buy.estimated;
    const policy=win.BBPantryPolicy,label=buy.displayName||buy.name,wholePepper=/^peppers?$/i.test(String(label||'').trim())&&buy.source!=='cupboard'&&base.staple!==true;
    if(policy?.isStaple(label)&&['each','pack','bottle','jar'].includes(String(buy.unit||'').toLowerCase())&&!wholePepper){base.staple=true;base.stapleContainer=policy.containerLabel(label);}
   }
   return output;
  }
  function manualBuyEssentials(items){
   const output=items.map(row=>({...row}));
   for(const buy of shoppingBuys().filter(row=>row.kind==='household')){
    let item=output.find(row=>host().id(row.name,row.unit)===host().id(buy.name,buy.unit));
    if(!item){const saved=(host().household?.()||[]).find(row=>host().id(row.name,row.unit)===host().id(buy.name,buy.unit));item={...(saved||{}),id:saved?.id||'manual-'+buy.id,name:buy.displayName||buy.name,unit:buy.unit,qty:0,selected:true,owned:false,estimatedPackPrice:saved?.estimatedPackPrice??null};output.push(item);}
    const context=host().shoppingPurchaseContext?.('ess:'+item.id)||{},baseline=buy.shopSessionId===context.shopSessionId?Number(buy.boughtAtRequest)||0:0;
    item.qty=buy.purpose==='bought'?Math.max(Number(item.qty)||0,baseline+buy.quantity):Math.max(Number(item.qty)||0,baseline)+buy.quantity;item.manualBuyQty=buy.quantity;item.manualBuyId=buy.id;
    delete item.targetQty;delete item.ownedQty;delete item.manualPending;
   }
   return output;
  }
  function applyManualPurchases(home,{shopSessionId,additions}={}){
   const rows=home?.byActor?.[actor()]?.manualBuys;if(!object(rows)||!Array.isArray(additions))return false;
   let changed=false;
   for(const row of Object.values(rows)){
    if(!row?.pending||row.shopSessionId!==shopSessionId)continue;
    const addition=additions.find(value=>value.id===host().id(row.name,row.unit));
    if(!addition||!valid(addition.quantity)||!valid(addition.automaticQuantity))continue;
    const credit=Math.min(row.quantity,row.source==='cupboard'||row.purpose==='bought'?addition.quantity:Math.max(0,addition.quantity-addition.automaticQuantity));if(!(credit>0))continue;
    row.quantity=Math.round((row.quantity-credit)*1000000)/1000000;row.pending=row.quantity>0;row.boughtAtRequest=0;changed=true;
   }
   return changed;
  }
  function decorate(container){
   checkDraftActor();if(!container)return;
   if(householdDraft.size){const confirm=win.document.getElementById('bb5Reconcile');if(confirm)confirm.disabled=false;}
   for(const button of container.querySelectorAll('[data-bb307-skip]')){
    const id=button.dataset.bb307Skip,row=button.closest('.bb16-essential-row'),item=host()?.household()?.find(x=>x.id===id);
    if(!row||!item||row.querySelector('.bb-home-quantities'))continue;
    const editor=win.document.createElement('div');editor.className='bb-home-quantities';
    const draft=householdDraft.get(id),target=draft?.targetQty??item.targetQty??item.qty,owned=draft?.ownedQty??item.ownedQty??(item.owned?item.qty:0);
    for(const [key,label,value]of[['targetQty','Total needed',target],['ownedQty','Already got',owned]]){const tag=win.document.createElement('label');tag.textContent=label;const input=win.document.createElement('input');input.type='number';input.min='0';input.max='1000000';input.step=['g','ml'].includes(item.unit)?'any':'1';input.value=value;input.dataset.homeQuantity=key;input.addEventListener('input',()=>{const values=Object.fromEntries([...editor.querySelectorAll('input')].map(n=>[n.dataset.homeQuantity,n.value.trim()===''?null:Number(n.value)]));householdDraft.set(id,values);try{editor.querySelector('output').textContent='To buy: '+difference(values.targetQty,values.ownedQty)+' '+item.unit;}catch{editor.querySelector('output').textContent='Check the amounts';}const confirm=win.document.getElementById('bb5Reconcile');if(confirm)confirm.disabled=false;if(Object.values(values).every(value=>Number.isFinite(value)&&value>=0))win.BBPantryLive?.householdChanged?.();});tag.append(input);editor.append(tag);}
    const output=win.document.createElement('output');output.textContent='To buy: '+(item.manualPending===false?0:Math.max(0,target-owned))+' '+item.unit;editor.append(output);row.append(editor);row.querySelector('[data-bb307-owned]')?.setAttribute('hidden','');
   }
  }
  function reminders(){const list=win.document.getElementById('bb321Printable');if(!list)return;list.querySelector('.bb-home-covered')?.remove();const data=Object.values(targets()).filter(row=>row.pending&&(row.targetQty>0||valid(row.extraBuffer)&&row.extraBuffer>0));const needed=host().requirements();const covered=data.filter(row=>{const item=needed.find(x=>host().id(x.key,x.unit)===host().id(row.name,row.unit));const current=host().stock()[host().id(row.name,row.unit)]||0;return Math.max(row.targetQty,item?.required||0)+(valid(row.extraBuffer)?row.extraBuffer:0)<=current;});const households=host().household().filter(row=>Object.hasOwn(row,'targetQty')&&row.manualPending!==false&&row.targetQty>0&&row.ownedQty>=row.targetQty).map(row=>({...row,homeId:'ess:'+row.id}));if(!covered.length&&!households.length)return;const box=win.document.createElement('div');box.className='bb-home-covered';for(const row of [...covered,...households]){const label=win.document.createElement('label'),tick=win.document.createElement('input');tick.type='checkbox';tick.addEventListener('change',()=>{if(tick.checked){complete(row.homeId||host().id(row.name,row.unit));host().refresh();}});label.append(tick,win.document.createTextNode(row.name+' · covered at home'));box.append(label);}list.append(box);}
  function openRequested(){const id=new URLSearchParams(win.location.search).get('bbcook');if(id)host()?.openCook?.(id);}
  const api={purchaseQuantity,purchaseAmounts,roundShoppingItems,prepareSharedPurchase,needsLegacyReview,receiptGeneration,supersedesReceipt,addHousehold,setHouseholdAmount,setHouseholdBalance,confirmHousehold,confirmHouseholdEntry,removeHousehold,openRequested,reminders,decorate,hasHouseholdDraft:()=>{checkDraftActor();return householdDraft.size>0;},committed:()=>{householdDraft.clear();host()?.reload();},difference,augment,targets,foodTarget,requirement,total,prepare,completionChanges,complete,isCooked,previewCook,cooked,previewDay,finishDay,shoppingBuys,addShoppingBuy,manualBuyItems,manualBuyEssentials,applyManualPurchases,actor,blocked,atomic};
  setTimeout(()=>{win.BBKitchenEssentials?.refresh?.();openRequested();},0);
  return Object.freeze(api);
 }
 return {difference,purchaseQuantity,purchaseAmounts,augment,atomic,install};
});
