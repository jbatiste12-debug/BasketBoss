/* At home owns manual requirements and completion receipts; measured stock
   remains in the existing pantry. No prices, billing or server data are invented. */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(root?.BBPantryDeduction||(common?require('./bb-pantry-deduction.js'):null));if(common)module.exports=api;if(root)root.BBHome=api.install(root);})(typeof window==='undefined'?null:window,function(deduction){
 'use strict';
 const KEY='basketboss_at_home_requirements_v1';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000;
 function difference(needed,owned){if(!valid(needed)||!valid(owned))throw Error('Enter valid non-negative amounts.');return Math.max(0,Math.round((needed-owned)*1000000)/1000000);}
 function augment(items,lunch,targets,id){
  const map=new Map(items.map(row=>[id(row.key,row.unit),{...row}]));
  const lunchTotals=new Map();for(const row of lunch||[]){const key=id(row.name,row.unit);lunchTotals.set(key,(lunchTotals.get(key)||0)+Number(row.qty||0));}
  for(const row of Object.values(targets||{})){
   if(!row?.pending||!valid(row.targetQty)||!row.name||!row.unit)continue;
   const key=id(row.name,row.unit),before=map.get(key),base=Number(before?.required||0)+(lunchTotals.get(key)||0);
   const extra=Math.max(0,row.targetQty-base);
   map.set(key,{...(before||{key:row.name,unit:row.unit,required:0,toBuy:0,pantryUsed:0}),required:Number(before?.required||0)+extra,bbHomePending:true});
  }return [...map.values()];
 }
 function atomic(storage,updates,expected={}){
  const prior=Object.fromEntries(Object.keys(updates).map(key=>[key,storage.getItem(key)]));
  const after=Object.fromEntries(Object.entries(updates).map(([key,value])=>[key,JSON.stringify(value)])),written=[];
  for(const [key,value] of Object.entries(expected))if(storage.getItem(key)!==value)throw Error('At home changed elsewhere. Review the latest amounts first.');
  try{for(const [key,bytes] of Object.entries(after)){if(storage.getItem(key)!==prior[key])throw Error('At home changed elsewhere. Review the latest amounts first.');written.push(key);storage.setItem(key,bytes);if(storage.getItem(key)!==bytes)throw Error('Storage verification failed.');}}
  catch(error){for(const key of written.reverse()){try{if(storage.getItem(key)!==after[key])continue;if(prior[key]===null)storage.removeItem(key);else storage.setItem(key,prior[key]);}catch{}}throw error;}
 }
 function install(win){
  const householdDraft=new Map();let householdActor=null;
  function checkDraftActor(){const who=actor();if(who!==householdActor){householdDraft.clear();householdActor=who;}}
  const store=win.localStorage,read=()=>{try{const value=JSON.parse(store.getItem(KEY)||'{}');return value&&value.version===1?value:{version:1,targets:{},cooked:{},planned:{}};}catch{return {version:1,targets:{},cooked:{},planned:{}};}};
  const actor=()=>{try{return JSON.parse(store.getItem('basketboss_cloud_session_v1')||'null')?.user?.id||'guest';}catch{return 'guest';}};
  const blocked=()=>win.BBAccountDeletion?.isDeleting?.()||win.BBReceiptHost?.hasPendingConfirmation?.()||win.BBReceiptHost?.requiresPantryReview?.();
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
   const drafts=new Map(householdDraft);drafts.set(id,{targetQty,ownedQty});
   const feature=host().prepareHousehold([...drafts]),shopping=settle(data,[...drafts.keys()].map(key=>'ess:'+key));
   atomic(store,{[KEY]:all,[feature.key]:feature.value,...shopping?.updates},{[KEY]:expected,[feature.key]:feature.expected,...shopping?.expected});householdDraft.clear();host().reload();host().refresh();return true;
  }
  function requirement(name,unit){try{const base=unit==='kg'?'g':unit==='l'?'ml':unit;return (host()?.requirements()?.find(row=>host().id(row.key,row.unit)===host().id(name,base))?.required||0)/(unit==='kg'||unit==='l'?1000:1);}catch{return 0;}}
  function total(name,unit){const base=unit==='kg'?'g':unit==='l'?'ml':unit,row=targets()[host().id(name,base)];return Math.max(requirement(name,unit),row?.pending?row.targetQty/(unit==='kg'||unit==='l'?1000:1):0);}
  function prepare(chosen){
   checkDraftActor();const {all,data,who}=own();const expected=store.getItem(KEY);
   for(const row of chosen){if(row.totalNeeded===undefined||row.totalNeeded===''||row.totalNeeded===null)continue;
    const unit=row.unit==='kg'?'g':row.unit==='l'?'ml':row.unit;
    if(row.qty===null||row.qty===undefined||row.qty==='')throw Error('Enter how much '+row.name+' you already have; use 0 for none.');
    const targetQty=Number(row.totalNeeded)*(row.unit==='kg'||row.unit==='l'?1000:1);
    if(!valid(targetQty)||!['g','ml','each','pack','clove','tin','loaf','slice','bulb'].includes(unit)||unit==='pack'&&!Number.isInteger(targetQty))throw Error('Check the total needed for '+row.name+'.');
    const id=host().id(row.name,unit),before=data.targets[id];
    const legacy=host().household().find(item=>item.selected&&!item.owned&&!Object.hasOwn(item,'targetQty')&&host().id(item.name,'g')===host().id(row.name,'g'));if(legacy)throw Error('Check the saved '+row.name+' food top-up first so it is not counted twice.');
    data.targets[id]={name:row.name,unit,targetQty,pending:row.targetChanged||!before?true:before.pending};
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
  function isCooked(key){return !!own().data.planned?.[key];}
  function cookSnapshot(event={}){
   const {sessionId,recipeId,day,factor,actorId,occurrence}=event;
   if(typeof sessionId!=='string'||!sessionId||sessionId.length>160||typeof recipeId!=='string'||!recipeId||recipeId.length>256||!Number.isFinite(factor)||factor<=0||factor>100)throw Error('Check the cooking servings before updating At home.');
   const who=actor();if(actorId!==who)throw Error('Your account changed. Reopen Cook before updating At home.');
   const oldHome=store.getItem(KEY),all=oldHome===null?{version:1,byActor:{}}:JSON.parse(oldHome),object=value=>value&&typeof value==='object'&&!Array.isArray(value);
   if(!object(all)||all.version!==1||all.byActor!==undefined&&!object(all.byActor))throw Error('Review your saved At home records before updating stock.');
   all.byActor??={};all.byActor[who]??={targets:{},cooked:{},planned:{}};
   const data=all.byActor[who];if(!object(data))throw Error('Review your saved At home records before updating stock.');
   for(const key of ['targets','cooked','planned']){data[key]??={};if(!object(data[key]))throw Error('Review your saved At home records before updating stock.');}
   if(data.cooked[sessionId]||occurrence&&data.planned[occurrence])return {already:true,all,data,who};
   if(blocked())throw Error('Review At home before updating these ingredients.');
   if(!deduction)throw Error('Pantry quantities are still loading. Reopen Cook to try again.');
   const currentOccurrence=host().occurrence?.(recipeId,day)||null;
   if(occurrence&&occurrence!==currentOccurrence)throw Error('Your planned dinner changed. Reopen Cook before updating At home.');
   const keys=host().keys(),oldStock=store.getItem(keys.stock),oldInv=store.getItem(keys.inventory),oldOwner=store.getItem('basketboss_receipt_projection_owner_v1'),oldPlan=store.getItem('basketboss_321_unified_state_v1'),oldSession=store.getItem('basketboss_cloud_session_v1');
   const ingredients=host().recipeIngredients(recipeId,factor);if(!ingredients?.length)throw Error('Ingredient amounts need review in At home.');
   if(host().needsLegacyReview?.(ingredients))throw Error('Review the ingredient amounts in At home before updating this older shopping record.');
   const stock=host().stock(),result=deduction.proposal({stock,ingredients,id:host().id});
   const inventory=oldInv===null?{}:JSON.parse(oldInv);if(!object(inventory))throw Error('Review your saved pantry inventory before updating stock.');
   const fingerprint=JSON.stringify({who,sessionId,recipeId,day,factor,occurrence,currentOccurrence,oldHome,oldStock,oldInv,oldOwner,oldPlan,ingredients,stock});
   return {keys,all,data,who,stock,ingredients,inventory,result,fingerprint,expected:{[keys.stock]:oldStock,[keys.inventory]:oldInv,[KEY]:oldHome,basketboss_receipt_projection_owner_v1:oldOwner,basketboss_321_unified_state_v1:oldPlan,basketboss_cloud_session_v1:oldSession}};
  }
  function previewCook(event){
   try{const state=cookSnapshot(event);if(state.already)return {ok:true,already:true,rows:[],issues:[],fingerprint:null,message:'At home already updated for this cooked meal.'};return {ok:true,already:false,rows:state.result.rows,issues:state.result.issues,fingerprint:state.fingerprint};}
   catch(error){return {ok:false,rows:[],issues:[],message:error?.message||'Review your pantry amounts before updating At home.'};}
  }
  async function cooked(event={}){
   let state;try{state=cookSnapshot(event);}catch(error){return {ok:false,message:error?.message||'Review At home before updating these ingredients.'};}
   if(state.already)return {ok:true,already:true,message:'At home already updated for this cooked meal.'};
   if(event.expected!==undefined&&(typeof event.expected!=='string'||event.expected!==state.fingerprint))return {ok:false,needsReview:true,message:'Your pantry or recipe changed. Review the latest amounts before deducting.'};
   let result;try{result=deduction.proposal({stock:state.stock,ingredients:state.ingredients,amounts:event.amounts,id:host().id});}catch(error){return {ok:false,needsReview:true,message:error?.message||'Review the used ingredient amounts.'};}
   const groups=new Map();
   for(const row of Object.values(state.inventory)){
    if(!row?.bb173StockKey)continue;const at=row.bb173StockKey.lastIndexOf('|');if(at<1)continue;
    const info=deduction.measure(row.bb173StockKey.slice(at+1)),key=host().id(row.bb173StockKey.slice(0,at),info.unit),records=groups.get(key)||[];
    records.push({row,value:(Number(row.bb173StockValue)||0)*info.factor});groups.set(key,records);
   }
   for(const [key,records]of groups){
    let left=Number(result.remainingStock[key]||0);const base=key.slice(key.lastIndexOf('|')+1);
    records.forEach(({row,value},index)=>{const amount=index===records.length-1?left:Math.min(left,Math.max(0,value));left=Math.max(0,left-amount);row.bb173StockKey=key;row.bb173StockValue=amount;const display=deduction.measure(row.unit);if(display.unit!==base)row.unit=base;row.qty=amount/(display.unit===base?display.factor:1);});
   }
   const {sessionId,recipeId,day,factor,occurrence}=event;
   state.data.cooked[sessionId]={recipeId,day:day||null,factor,at:Date.now(),ingredients:result.used.map(row=>({key:row.key,unit:row.unit,quantity:row.required})),skipped:result.issues.map(row=>row.id)};
   if(occurrence)state.data.planned[occurrence]=true;
   const shopping=settle(state.data,result.used.map(row=>row.id),true);
   if(actor()!==state.who||blocked())return {ok:false,message:'Your account or pantry changed. Review the latest amounts first.'};
   atomic(store,{[state.keys.stock]:result.remainingStock,[state.keys.inventory]:state.inventory,[KEY]:state.all,...shopping?.updates},{...state.expected,...shopping?.expected});host().refresh();
   const review=result.issues.length?' Some amounts need review in At home; those units were not guessed.':'';
   if(win.BBReceiptHost?.confirmCurrentPantry){try{const sync=await win.BBReceiptHost.confirmCurrentPantry({stock:result.remainingStock});if(!sync?.ok||sync.needsReview)return {ok:true,issues:result.issues,message:'At home updated on this device. Review online pantry confirmation.'+review};}catch{return {ok:true,issues:result.issues,message:'At home updated on this device; online confirmation can be retried.'+review};}}
   return {ok:true,issues:result.issues,message:'At home updated. Your shopping list now uses the remaining stock.'+review};
  }
  function decorate(container){
   checkDraftActor();if(!container)return;
   if(householdDraft.size){const confirm=win.document.getElementById('bb5Reconcile');if(confirm)confirm.disabled=false;}
   for(const button of container.querySelectorAll('[data-bb307-skip]')){
    const id=button.dataset.bb307Skip,row=button.closest('.bb16-essential-row'),item=host()?.household()?.find(x=>x.id===id);
    if(!row||!item||row.querySelector('.bb-home-quantities'))continue;
    const editor=win.document.createElement('div');editor.className='bb-home-quantities';
    const draft=householdDraft.get(id),target=draft?.targetQty??item.targetQty??item.qty,owned=draft?.ownedQty??item.ownedQty??(item.owned?item.qty:0);
    for(const [key,label,value]of[['targetQty','Total needed',target],['ownedQty','Already got',owned]]){const tag=win.document.createElement('label');tag.textContent=label;const input=win.document.createElement('input');input.type='number';input.min='0';input.max='1000000';input.step=['g','ml'].includes(item.unit)?'any':'1';input.value=value;input.dataset.homeQuantity=key;input.addEventListener('input',()=>{const values=Object.fromEntries([...editor.querySelectorAll('input')].map(n=>[n.dataset.homeQuantity,n.value.trim()===''?null:Number(n.value)]));householdDraft.set(id,values);try{editor.querySelector('output').textContent='To buy: '+difference(values.targetQty,values.ownedQty)+' '+item.unit;}catch{editor.querySelector('output').textContent='Check the amounts';}const confirm=win.document.getElementById('bb5Reconcile');if(confirm)confirm.disabled=false;});tag.append(input);editor.append(tag);}
    const output=win.document.createElement('output');output.textContent='To buy: '+(item.manualPending===false?0:Math.max(0,target-owned))+' '+item.unit;editor.append(output);row.append(editor);row.querySelector('[data-bb307-owned]')?.setAttribute('hidden','');
   }
  }
  function reminders(){const list=win.document.getElementById('bb321Printable');if(!list)return;list.querySelector('.bb-home-covered')?.remove();const data=Object.values(targets()).filter(row=>row.pending&&row.targetQty>0);const needed=host().requirements();const covered=data.filter(row=>{const item=needed.find(x=>host().id(x.key,x.unit)===host().id(row.name,row.unit));const current=host().stock()[host().id(row.name,row.unit)]||0;return Math.max(row.targetQty,item?.required||0)<=current;});const households=host().household().filter(row=>Object.hasOwn(row,'targetQty')&&row.manualPending!==false&&row.targetQty>0&&row.ownedQty>=row.targetQty).map(row=>({...row,homeId:'ess:'+row.id}));if(!covered.length&&!households.length)return;const box=win.document.createElement('div');box.className='bb-home-covered';for(const row of [...covered,...households]){const label=win.document.createElement('label'),tick=win.document.createElement('input');tick.type='checkbox';tick.addEventListener('change',()=>{if(tick.checked){complete(row.homeId||host().id(row.name,row.unit));host().refresh();}});label.append(tick,win.document.createTextNode(row.name+' · covered at home'));box.append(label);}list.append(box);}
  function openRequested(){const id=new URLSearchParams(win.location.search).get('bbcook');if(id)host()?.openCook?.(id);}
  const api={prepareSharedPurchase,needsLegacyReview,receiptGeneration,supersedesReceipt,addHousehold,openRequested,reminders,decorate,committed:()=>{householdDraft.clear();host()?.reload();},difference,augment,targets,requirement,total,prepare,completionChanges,complete,isCooked,previewCook,cooked,actor,blocked,atomic};
  setTimeout(()=>{win.BBKitchenEssentials?.refresh?.();openRequested();},0);
  return Object.freeze(api);
 }
 return {difference,augment,atomic,install};
});
