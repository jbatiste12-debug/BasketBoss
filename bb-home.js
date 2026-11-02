/* At home owns manual requirements and completion receipts; measured stock
   remains in the existing pantry. No prices, billing or server data are invented. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBHome=api.install(root);})(typeof window==='undefined'?null:window,function(){
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
  for(const [key,value] of Object.entries(expected))if(storage.getItem(key)!==value)throw Error('At home changed elsewhere. Review the latest amounts first.');
  try{for(const [key,value] of Object.entries(updates)){const bytes=JSON.stringify(value);storage.setItem(key,bytes);if(storage.getItem(key)!==bytes)throw Error('Storage verification failed.');}}
  catch(error){for(const [key,value]of Object.entries(prior)){try{if(value===null)storage.removeItem(key);else storage.setItem(key,value);}catch{}}throw error;}
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
  async function cooked({sessionId,recipeId,day,factor,actorId,occurrence}){
   if(typeof sessionId!=='string'||!sessionId||!Number.isFinite(factor)||factor<=0||factor>100)return {ok:false,message:'Check the cooking servings before updating At home.'};
   if(actorId!==actor()||blocked())return {ok:false,message:'Review At home before updating these ingredients.'};
   const {all,data}=own();if(data.cooked[sessionId])return {ok:true,message:'At home already updated for this cooking session.'};
   const keys=host().keys(),oldStock=store.getItem(keys.stock),oldInv=store.getItem(keys.inventory),oldHome=store.getItem(KEY);
   const rows=host().recipeIngredients(recipeId,factor);if(!rows.length)return {ok:false,message:'Ingredient amounts need review in At home.'};
   if(host().needsLegacyReview?.(rows))return {ok:false,message:'Review the ingredient amounts in At home before updating this older shopping record.'};
   const current=host().stock(),result=host().consume(current,rows),inventory=JSON.parse(oldInv||'{}');
   const groups=new Map();for(const row of Object.values(inventory)){if(!row?.bb173StockKey)continue;const rows=groups.get(row.bb173StockKey)||[];rows.push(row);groups.set(row.bb173StockKey,rows);}
   for(const [key,records]of groups){let left=Number(result.remainingStock[key]||0);records.forEach((row,index)=>{const amount=index===records.length-1?left:Math.min(left,Number(row.bb173StockValue)||0);left=Math.max(0,left-amount);row.bb173StockValue=amount;row.qty=amount/(row.unit==='kg'||row.unit==='l'?1000:1);});}
   data.cooked[sessionId]={recipeId,at:Date.now()};if(occurrence&&host().occurrence(recipeId,day)===occurrence)data.planned[occurrence]=true;
   const shopping=settle(data,rows.map(row=>host().id?.(row.key,row.unit)).filter(Boolean),true);
   atomic(store,{[keys.stock]:result.remainingStock,[keys.inventory]:inventory,[KEY]:all,...shopping?.updates},{[keys.stock]:oldStock,[keys.inventory]:oldInv,[KEY]:oldHome,...shopping?.expected});host().refresh();
   if(win.BBReceiptHost?.confirmCurrentPantry){try{const sync=await win.BBReceiptHost.confirmCurrentPantry({stock:result.remainingStock});if(!sync?.ok||sync.needsReview)return {ok:true,message:'At home updated on this device. Review online pantry confirmation.'};}catch{return {ok:true,message:'At home updated on this device; online confirmation can be retried.'};}}
   return {ok:true,message:'At home updated. Your shopping list now uses the remaining stock.'};
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
  const api={prepareSharedPurchase,needsLegacyReview,receiptGeneration,supersedesReceipt,addHousehold,openRequested,reminders,decorate,committed:()=>{householdDraft.clear();host()?.reload();},difference,augment,targets,requirement,total,prepare,completionChanges,complete,isCooked,cooked,actor,blocked,atomic};
  setTimeout(()=>{win.BBKitchenEssentials?.refresh?.();openRequested();},0);
  return Object.freeze(api);
 }
 return {difference,augment,atomic,install};
});
