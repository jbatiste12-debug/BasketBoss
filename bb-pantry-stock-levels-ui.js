/* Quick stock controls are drafts over the existing guarded pantry form. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root&&!root.BBPantryStockLevelsUI){root.BBPantryStockLevelsUI=Object.freeze(api);api.install(root);}})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const EMPTY=Object.freeze({refresh(){},patch(value){return value;},destroy(){}});
 const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0;
 function mount(view,deps={}){
  const win=deps.win||view?.element?.ownerDocument?.defaultView,doc=deps.doc||win?.document,content=view?.element?.querySelector('.bbpi-editor-content'),details=view?.amountDetails||content?.querySelector('.bbpi-amount-details');
  if(!doc||!content||!details||!view.quantity||!view.units||typeof deps.model!=='function'||typeof deps.setQuantity!=='function')return EMPTY;
  const policy=deps.policy||win.BBPantryPolicy,market=()=>typeof deps.market==='function'?deps.market():deps.market||win.bb307ActiveMarket?.()||'UK';
  const model=()=>deps.model(),isQualitative=row=>row?.staple===true||policy?.isStaple?.(row?.name)===true;
  if(isQualitative(model()))return EMPTY;
  let destroyed=false,pending=null,manual=false,applying=false,opened=false,desired=null,selected=null,confirmed=false,sparesDirty=false,capacityReview=false,reviewAmount=null,lastName=String(model().name||''),initialStamp=null,capacityStamp=null,requestedStatus=null,displayStatus=null,countEstimated=false;
  const counted=row=>['each','tin','can','jar','pack','bag','bottle','loaf','slice','bulb','clove','whole','item','piece'].includes(row.unit);
  const listeners=[],node=(tag,className,value)=>{const element=doc.createElement(tag);if(className)element.className=className;if(value!==undefined)element.textContent=value;return element;};
  const listen=(element,event,handler)=>{element.addEventListener(event,handler);listeners.push(()=>element.removeEventListener(event,handler));};
  const button=(label,className,handler)=>{const element=node('button',className,label);element.type='button';listen(element,'click',handler);return element;};
  const number=value=>new Intl.NumberFormat(market()==='US'?'en-US':'en-GB',{maximumFractionDigits:3,useGrouping:false}).format(value);
  const amount=(qty,unit)=>{try{if(typeof deps.formatAmount==='function')return deps.formatAmount(qty,unit);const visible=win.BBShopPurchaseUI?.formatDisplayQty?.(qty,unit,{market:market(),countMode:'balance'});if(visible&&!/^Check\b/.test(visible))return visible;}catch{}const rendered=number(qty);return (qty>0&&Number(rendered)===0?'<0.001':rendered)+' '+(unit==='l'?'litres':unit||'');};
  const region=node('section','bbpi-stock-levels'),statusGroup=node('div','bbpi-stock-choices'),readout=node('p','bbpi-stock-amount'),explanation=node('p','bbpi-stock-explanation'),chooser=node('div','bbpi-stock-pack'),capacityGroup=node('div','bbpi-stock-capacities'),capacityHelp=node('p','bbpi-stock-capacity-help'),portionGroup=node('div','bbpi-stock-portions'),sparesLabel=node('label','bbpi-stock-spares-label','Same-size full spares'),spares=node('input','bbpi-stock-spares'),message=node('p','bbpi-stock-message'),confirmation=node('p','bbpi-stock-pending');
  region.setAttribute('aria-label','Quick stock update');statusGroup.setAttribute('role','group');statusGroup.setAttribute('aria-label','Stock status for '+model().name);readout.setAttribute('aria-live','polite');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const statuses={};
  for(const [key,label]of[['got','Got it'],['low','Running low'],['out','Out']]){const control=button(label,'bbpi-stock-choice',()=>chooseStatus(key));control.dataset.bbpiStockLevel=key;control.setAttribute('aria-pressed','false');statuses[key]=control;statusGroup.append(control);}
  const toggle=button('Full / half pack…','bbpi-stock-pack-toggle',()=>{opened=!opened;desired=null;paint();});toggle.setAttribute('aria-expanded','false');chooser.id='bbpiStockPackChoices';toggle.setAttribute('aria-controls',chooser.id);chooser.hidden=true;
  capacityHelp.textContent='Suggested sizes are estimates; check the label.';capacityGroup.setAttribute('role','group');capacityGroup.setAttribute('aria-label','Size of one pack');
  portionGroup.setAttribute('role','group');portionGroup.setAttribute('aria-label','Amount remaining in the opened pack');
  for(const [key,label]of[['full','Full pack'],['half','Half pack'],['low','Quarter left']]){const control=button(label,'bbpi-stock-portion',()=>choosePortion(key));control.dataset.bbpiStockPortion=key;control.setAttribute('aria-pressed','false');portionGroup.append(control);}
  spares.type='number';spares.inputMode='numeric';spares.min='0';spares.max='100';spares.step='1';spares.value='0';spares.setAttribute('aria-label','Same-size full spare packs');sparesLabel.append(spares,node('small','','Unopened packs in addition to the opened pack.'));
  confirmation.id='bbpiStockPending';confirmation.hidden=true;confirmation.setAttribute('role','status');
  chooser.append(capacityHelp,capacityGroup,portionGroup,sparesLabel);region.append(statusGroup,confirmation,readout,explanation,toggle,chooser,message);content.insertBefore(region,details);
  const savedMeta=row=>{let value=row.stockLevel;try{const synced=win.BBPantryPackSync?.read?.(row);if(synced&&Object.hasOwn(synced,'stockLevel'))value=synced.stockLevel;value=typeof win.BBPantryStockLevels?.validate==='function'?win.BBPantryStockLevels.validate(value):value&&typeof value==='object'?value:null;if(value?.scope){const projection=win.BBReceiptHost?.getProjection?.(),active=value.scope.kind==='user'?win.BBHome?.actor?.()||projection?.actorId:projection?.scope?.kind==='household'?projection.scope.id:null;if(active!==value.scope.id)return null;}return value;}catch{return null;}};
  const canonical=(row,qty=row.qty,unit=row.unit)=>{if(!finite(qty))return null;try{return policy?.normalize?.(row.name,Number(qty),unit,{market:row.inputMarket||market(),packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit})||{quantity:Number(qty),unit};}catch{return null;}};
  const equal=(row,qty,unit)=>{const a=canonical(row),b=canonical(row,qty,unit);return !!a&&!!b&&a.unit===b.unit&&Math.abs(a.quantity-b.quantity)<=Math.max(.000001,Math.abs(b.quantity)*.00000001);};
  const trustedMeta=row=>{const metadata=savedMeta(row);return metadata&&finite(metadata.confirmedQuantity)&&equal(row,metadata.confirmedQuantity,metadata.confirmedUnit||row.unit)?metadata:null;};
  const stamp=row=>JSON.stringify([row.name,finite(row.qty)?Number(row.qty):null,row.unit]);
  function currentMeta(row){return pending?.stockLevel||(!manual?trustedMeta(row):null);}
  function capacityOptions(row){
   const values=[],add=(quantity,unit,source,estimated)=>{if(!finite(quantity)||!(Number(quantity)>0)||!unit)return;let converted;try{converted=policy?.normalize?.(row.name,Number(quantity),unit,{market:row.inputMarket||market(),packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});}catch{}if(!converted||!['g','ml','each'].includes(converted.unit)||!(converted.quantity>0))return;const option={capacity:converted.quantity,unit:converted.unit,source,capacityEstimated:estimated===true||converted.estimated===true};if(!values.some(item=>item.unit===option.unit&&Math.abs(item.capacity-option.capacity)<=.000001))values.push(option);};
   const metadata=savedMeta(row);if(metadata)add(metadata.capacity,metadata.unit,metadata.source||'label',metadata.capacityEstimated===true);
   const shared=win.BBPantryPackSync?.read?.(row);if(shared?.packReviewed===true)add(shared.packQuantity,shared.packUnit,shared.packSource||'label',shared.packEstimated===true);
   if(row.packReviewed===true)add(row.packQuantity,row.packUnit,'label',row.packEstimated===true);
   let suggestions=[];try{suggestions=deps.suggestions?.()||[];}catch{}
   for(const suggestion of suggestions)add(suggestion.quantity,suggestion.unit,'catalogue',true);
   return values;
  }
  function paintCapacities(row){
   const values=capacityOptions(row),nextStamp=JSON.stringify([market(),values]);
   if(nextStamp!==capacityStamp){capacityStamp=nextStamp;capacityGroup.replaceChildren();
    for(const [index,value]of values.entries()){const control=node('button','bbpi-stock-capacity',amount(value.capacity,value.unit)+(value.capacityEstimated?' · suggested':' · saved size'));control.type='button';control.dataset.bbpiCapacityIndex=String(index);control.onclick=()=>{selected=value;confirmed=true;if(desired||pending?.stockLevel)apply(desired||pending.stockLevel.portion);else{text(message,'Pack size selected.');paint();}};capacityGroup.append(control);}
    if(!values.length)capacityGroup.append(node('p','bbpi-stock-no-capacity','No pack size is confirmed. Use Edit amount, or add the size on the label in More options.'));
   }
   for(const control of capacityGroup.querySelectorAll('button')){const value=values[Number(control.dataset.bbpiCapacityIndex)];control.setAttribute('aria-pressed',String(confirmed&&selected?.unit===value?.unit&&Math.abs(selected.capacity-value.capacity)<=.000001));}
  }
  function text(element,value){if(element.textContent!==value)element.textContent=value;}
  function automaticCapacity(row){
   if(confirmed&&selected)return selected;
   const values=capacityOptions(row),metadata=trustedMeta(row),shared=win.BBPantryPackSync?.read?.(row);
   if(view.touched?.has('pack')){
    let edited;try{edited=policy?.normalize?.(row.name,Number(row.packQuantity),row.packUnit,{market:row.inputMarket||market()});}catch{}
    return row.packReviewed===true&&values.find(value=>value.unit===edited?.unit&&Math.abs(value.capacity-edited.quantity)<=.000001)||null;
   }
   const saved=metadata||shared?.packReviewed===true||row.packReviewed===true?values[0]:null;if(saved)return saved;
   // A generic pricing fallback is not evidence of a custom food's pack size.
   let standard;try{standard=deps.defaultPack?.();}catch{}
   if(!standard)return null;
   let normalized;try{normalized=policy?.normalize?.(row.name,standard.quantity,standard.unit,{market:row.inputMarket||market(),packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});}catch{}
   return values.find(value=>value.unit===normalized?.unit&&Math.abs(value.capacity-normalized.quantity)<=.000001)||null;
  }
  function directCount(row){
   const suggestion=/\beggs?\b/i.test(row.name)?2:1;
   const quantity=finite(row.qty)&&Number(row.qty)>0?Math.min(Number(row.qty),suggestion):suggestion;
   let normalized;try{normalized=policy?.normalize?.(row.name,quantity,row.unit,{market:row.inputMarket||market(),packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});}catch{}
   if(!normalized){
    // No physical size is known for a custom jar/bag. Keep its unknown stock
    // as a check item instead of inventing contents or forcing pack setup.
    requestedStatus=null;desired=null;displayStatus='low';countEstimated=false;
    text(message,'Amount unknown. Your shopping list will ask you to check it.');paint();return;
   }
   pending={qty:quantity,unit:row.unit,stockLevel:null};manual=true;desired=null;requestedStatus=null;displayStatus='low';countEstimated=true;applying=true;
   try{if(deps.setQuantity(quantity,row.unit)===false){pending=null;displayStatus=null;countEstimated=false;}}finally{applying=false;}
   text(message,'Suggested count. Done confirms the number shown.');paint();
  }
  function stockStatus(row){const metadata=currentMeta(row);return capacityReview?null:metadata?.portion==='low'?'low':metadata?.portion==='out'?'out':finite(row.qty)?Number(row.qty)===0?'out':'got':null;}
  function sparesValue(){return spares.value.trim()!==''&&spares.validity.valid&&Number.isInteger(Number(spares.value))?Number(spares.value):null;}
  function showChooser(portion){opened=true;desired=portion;paint();text(message,portion==='low'?'Choose the size of one pack to estimate a quarter remaining.':portion==='out'?'Confirm the pack size to keep your full spares counted.':'Choose a confirmed pack size, then Full pack or Half pack.');}
  function chooseStatus(value){
   if(destroyed)return;const row=model();if(isQualitative(row))return;
   displayStatus=null;
   if(value==='got'&&finite(row.qty)&&Number(row.qty)>0){requestedStatus=null;desired=null;displayStatus='got';text(message,'Your current amount is kept.');paint();return;}
   if(value==='got'&&pending?.qty===0){
    // Undo an unsaved Out selection rather than replenishing a real balance.
    pending=null;manual=false;requestedStatus=null;desired=null;countEstimated=false;applying=true;
    try{deps.setQuantity(view.row?.qty??null,view.row?.unit||row.unit);}finally{applying=false;}
    displayStatus='got';paint();return;
   }
   if(value==='low'&&counted(row)&&Number(currentMeta(row)?.spares||0)===0){directCount(row);return;}
   const unchangedSpares=!sparesDirty||Number(currentMeta(row)?.spares||0)===sparesValue();
   // A requested level is a UI draft, never an amount. Returning to the
   // existing level cancels that request without crediting or clearing stock.
   if(requestedStatus&&value===stockStatus(row)&&unchangedSpares){requestedStatus=null;desired=null;text(message,'Your current amount is kept.');paint();return;}
   if(value==='got'){
    if(!finite(row.qty)&&!finite(view.row?.qty)&&unchangedSpares&&sparesValue()===0&&!pending&&!capacityReview){requestedStatus=null;desired=null;text(message,'Amount unknown. Your shopping list will ask you to check it.');paint();return;}
    if(!finite(row.qty)||Number(row.qty)===0||currentMeta(row)?.portion==='low'||currentMeta(row)?.portion==='out'||!unchangedSpares){
     if(counted(row)){directCount(row);displayStatus='got';paint();}else choosePortion('full');
    }
    else{requestedStatus=null;desired=null;text(message,'Your current amount is kept. Use Full / half pack to change it.');paint();}
    return;
   }
   requestedStatus=value;
   choosePortion(value);
  }
  function choosePortion(portion){
   desired=portion;displayStatus=null;countEstimated=false;
   if(portion==='full'||portion==='half')requestedStatus='got';
   if(sparesValue()===null){opened=true;paint();text(message,'Use a whole number of same-size full spare packs from 0 to 100.');spares.focus({preventScroll:true});return;}
   if((portion!=='out'||sparesValue()>0)&&(!confirmed||!selected)){
    const automatic=automaticCapacity(model());
    if(automatic){selected=automatic;confirmed=true;}
    else{requestedStatus=null;desired=null;displayStatus=portion==='low'?'low':'got';text(message,'Amount unknown. Your shopping list will ask you to check it.');paint();return;}
   }
   apply(portion);
  }
  function apply(portion){
   const row=model(),count=sparesValue();if(count===null)return;
   const core=win.BBPantryStockLevels;if(typeof core?.select!=='function'){text(message,'Open Edit amount to update your stock.');details.open=true;return;}
   const result=core.select(row,{portion,capacity:confirmed?selected?.capacity:null,unit:confirmed?selected?.unit:row.unit,spares:count,confirmed:true,source:selected?.source||'label',capacityEstimated:selected?.capacityEstimated===true},{policy,market:market()});
   if(!result?.ok||!result.patch){text(message,result?.message||result?.error||'Confirm the pack size, or use Edit amount.');return;}
   const before=pending,wasManual=manual;pending=result.patch;manual=false;desired=null;applying=true;let success=true;
   try{success=deps.setQuantity(result.patch.qty,result.patch.unit)!==false;}catch{success=false;}finally{applying=false;}
   if(!success){pending=before;manual=wasManual;text(message,'This amount could not be applied. Review Edit amount before saving.');paint();return;}
   capacityReview=false;reviewAmount=null;requestedStatus=null;text(message,'Draft updated. Confirm below to save.');paint();
  }
  function invalidate(event){if(applying||destroyed)return;const keepIntent=event===true||event?.target===view.units;if(!keepIntent)requestedStatus=null;pending=null;manual=true;sparesDirty=false;capacityReview=false;reviewAmount=null;displayStatus=null;countEstimated=false;text(message,'Your edited amount will be used.');paint();}
  listen(view.quantity,'input',invalidate);listen(view.units,'change',invalidate);
  const invalidateCapacity=()=>{if(applying||destroyed)return;const review=capacityReview||!!pending?.stockLevel||!manual&&savedMeta(model())?.estimated===true;selected=null;confirmed=false;desired=null;invalidate(true);if(review){capacityReview=true;reviewAmount=stamp(model());opened=true;paint();text(message,'Pack size changed. Choose a stock level again, or edit the amount.');}else text(message,'Your edited container size will be used. Choose a stock level again to make a new estimate.');};
  if(view.packQuantity)listen(view.packQuantity,'input',invalidateCapacity);if(view.packUnit)listen(view.packUnit,'change',invalidateCapacity);
  listen(spares,'input',()=>{if(destroyed)return;sparesDirty=true;if(sparesValue()===null){text(message,'Use a whole number of same-size full spare packs from 0 to 100.');return;}if(requestedStatus){text(message,'Confirm the amount remaining in the opened pack to include these spares.');paint();return;}if(pending?.stockLevel&&confirmed)apply(pending.stockLevel.portion);else if(pending){pending=null;showChooser('out');}else text(message,'Choose the amount remaining in the opened pack to include these spares.');});
  function paint(){
   if(destroyed)return;const row=model();region.hidden=isQualitative(row);if(region.hidden)return;
   statusGroup.setAttribute('aria-label','Stock status for '+row.name);
   const metadata=currentMeta(row),quantityKnown=finite(row.qty),state=requestedStatus||displayStatus||stockStatus(row)||(!quantityKnown?'got':null);
   region.dataset.bbpiCounted=String(counted(row));region.dataset.bbpiEstimated=String(countEstimated||metadata?.estimated===true||counted(row)&&row.packEstimated===true);
   region.dataset.bbpiPending=requestedStatus||'';
   for(const [key,control]of Object.entries(statuses)){
    control.setAttribute('aria-pressed',String(key===state));control.dataset.bbpiPending=String(!!requestedStatus&&key===requestedStatus);
    if(requestedStatus&&key===requestedStatus)control.setAttribute('aria-describedby',confirmation.id);else control.removeAttribute('aria-describedby');
   }
   const pendingCopy=requestedStatus==='got'?'Got it selected. Choose Full or Half pack, or edit the amount, before Done.':requestedStatus==='low'?'Running low selected. Confirm the pack size before Done.':requestedStatus==='out'?'Out selected. Confirm the pack size and extra unopened packs before Done.':'';
   text(confirmation,pendingCopy);confirmation.hidden=!requestedStatus;
   text(readout,(requestedStatus?'Current amount: ':'')+(quantityKnown?amount(Number(row.qty),row.unit)+' at home':'Amount unknown'));
   const capacity=metadata&&finite(metadata.capacity)?amount(metadata.capacity,metadata.unit):'';
   let note=metadata?.portion==='low'?'Estimated ¼ of one '+capacity+' pack remaining.':metadata?.portion==='half'?'Estimated ½ of one '+capacity+' pack remaining.':metadata?.portion==='out'?'No opened pack remaining.':metadata?.portion==='full'?'One full '+capacity+' pack remaining.':quantityKnown?'Keeps your current amount.':'Choose a pack amount or enter the amount you have.';
   if(metadata&&Number(metadata.spares)>0)note+=' Plus '+number(metadata.spares)+' same-size full spare'+(Number(metadata.spares)===1?' pack.':' packs.');
   if(metadata?.capacityEstimated)note+=' Pack size is estimated; check the label.';
   if(!manual&&!pending&&savedMeta(row)&&!trustedMeta(row))note='Current amount shown. Previous pack estimate needs checking after stock changed.';
   if(capacityReview)note='This amount was estimated with a different pack size. Choose a stock level again, or edit the amount.';
   text(explanation,(requestedStatus?'Amount not changed yet. ':'')+note);toggle.setAttribute('aria-expanded',String(opened));chooser.hidden=!opened;
   for(const control of portionGroup.querySelectorAll('button'))control.setAttribute('aria-pressed',String(control.dataset.bbpiStockPortion===metadata?.portion));
   if(opened)paintCapacities(row);
  }
  function refresh(){
   if(destroyed)return;const row=model(),name=String(row.name||'');
   if(name!==lastName){
    const restored=name===String(view.row?.name||'')?trustedMeta(row):null;
    pending=null;manual=!restored;selected=null;confirmed=false;desired=null;sparesDirty=false;capacityReview=false;reviewAmount=null;requestedStatus=null;displayStatus=null;countEstimated=false;spares.value=String(restored?.spares||0);lastName=name;initialStamp=stamp(row);
   }
   if(capacityReview&&!applying&&stamp(row)!==reviewAmount){capacityReview=false;reviewAmount=null;manual=true;}
   if(pending&&!applying&&!equal(row,pending.qty,pending.unit)){pending=null;manual=true;displayStatus=null;countEstimated=false;}
   if(!pending&&!manual&&initialStamp!==null&&stamp(row)!==initialStamp)manual=true;
   paint();
  }
  const initial=model(),metadata=trustedMeta(initial);initialStamp=stamp(initial);if(metadata&&Number.isInteger(Number(metadata.spares))&&Number(metadata.spares)>=0&&Number(metadata.spares)<=100)spares.value=String(metadata.spares);
  // Retain the existing native disclosure and every bound exact-amount field.
  details.open=!finite(initial.qty);paint();
  return {refresh,allowsUnknown(){
   refresh();
   return !isQualitative(model())&&!finite(view.row?.qty)&&view.quantity.value.trim()===''&&!pending&&!requestedStatus&&!capacityReview&&!sparesDirty&&sparesValue()===0&&!['buffer','buy','pack','tracking'].some(field=>view.touched?.has(field));
  },patch(existingPatch){
   const fail=(error,field=spares)=>{opened=true;paint();return {error,field};};
   refresh();if(capacityReview){opened=true;paint();return {error:'Pack size changed. Choose a stock level again, or edit the amount.',field:capacityGroup.querySelector('button')||details.querySelector('summary')};}
   if((pending||sparesDirty&&!manual)&&sparesValue()===null)return fail('Use a whole number of same-size full spare packs from 0 to 100.');
   if(sparesDirty&&!manual&&!pending)return fail('Confirm the pack size and choose what remains in the opened pack to include these spares.');
   if(requestedStatus)return fail(requestedStatus==='got'?'Confirm Full or Half pack, or enter the amount, before saving Got it.':requestedStatus==='low'?'Confirm the pack size before saving Running low.':'Confirm the pack size and extra unopened packs before saving Out.',confirmed&&selected?portionGroup.querySelector('button'):capacityGroup.querySelector('button')||details.querySelector('summary'));
   if(pending)return {...existingPatch,...pending};
   return manual?{...existingPatch,stockLevel:null}:existingPatch;
  },destroy(){if(destroyed)return;destroyed=true;for(const remove of listeners)remove();region.remove();}};
 }
 // A review prompt reads the existing target calculation. It never adjusts a
 // shopping requirement or treats unknown stock as enough for a meal.
 function install(win){
  const doc=win.document;if(!doc?.createElement||!win.MutationObserver)return;
  let banner=null,stamp='',queued=false,pending=null;
  const actor=()=>win.BBHome?.actor?.()||'guest',session=()=>win.localStorage.getItem('basketboss_cloud_session_v1');
  function open(key){
   pending={key,actor:actor(),session:session(),until:Date.now()+5000};
   doc.querySelector('#bbPrimaryNavigation [data-bb-nav-item="kitchen"]')?.click();schedule();
  }
  function refresh(){
   queued=false;
   if(pending){
    if(pending.actor!==actor()||pending.session!==session()||Date.now()>pending.until)pending=null;
    else if(win.BBPantryEditor?.isCurrent?.()){
     const key=pending.key;pending=null;win.BBPantryInline?.open?.(key);
    }
   }
   const shop=doc.querySelector('.shell nav.tabs .tab.active')?.dataset.tab==='shop-list',target=['#bb172Storefront','#bbReleaseShopOverview','#bb321Printable','#app'].map(selector=>doc.querySelector(selector)).find(node=>node&&node.getClientRects().length&&win.getComputedStyle(node).display!=='none');
   if(!shop||!target||win.BBAccountDeletion?.isDeleting?.()){banner?.remove();banner=null;stamp='';return;}
   let rows,requirements;
   try{const keys=win.BBHomeHost?.keys?.();if(!keys)return;rows=Object.entries(JSON.parse(win.localStorage.getItem(keys.inventory)||'{}')).filter(([,row])=>row?.selected&&row.name&&!row.staple).map(([key,row])=>({...row,key}));requirements=win.BBHomeHost.requirements();}catch{return;}
   const checks=[];
   for(const row of rows){
    const synced=win.BBPantryPackSync?.read?.(row),current={...row,...(synced||{})},level=win.BBPantryStockLevels?.describe?.(current,{policy:win.BBPantryPolicy});
    const unknown=row.qty===null||row.qty===undefined||row.qty==='';if(!unknown&&!level?.estimated&&!level?.needsCheck)continue;
    try{
     const info=win.BBHome?.foodTarget?.(current,{requirements,otherRows:rows.filter(other=>other.key!==row.key)});
     const measured=unknown?null:win.BBPantryPolicy?.normalize?.(row.name,Number(row.qty),row.unit,{market:row.inputMarket||win.bb307ActiveMarket?.()||'UK',packReviewed:current.packReviewed===true,packQuantity:current.packQuantity,packUnit:current.packUnit});
     if(info?.requiredQuantity>0&&(unknown||!measured||info.canonicalUnit!==measured.unit||info.requiredQuantity>measured.quantity))checks.push(row);
    }catch{}
   }
   if(!checks.length){banner?.remove();banner=null;stamp='';return;}
   const next=JSON.stringify([actor(),checks.map(row=>[row.key,row.qty,row.unit,row.stockLevel])]);if(banner?.isConnected&&stamp===next)return;stamp=next;
   banner?.remove();banner=doc.createElement('section');banner.className='bbpi-stock-shop-check';banner.setAttribute('aria-label','Check pantry amounts');
   const text=doc.createElement('p');text.textContent=checks.length===1?checks[0].name+' · Check amount':'Check '+checks.length+' pantry amounts';text.title='Your shopping list still includes the calculated gaps.';banner.append(text);
   const button=doc.createElement('button');button.type='button';button.textContent='Check stock';button.onclick=()=>open(checks[0].key);banner.append(button);target.prepend(banner);
  }
  function schedule(){if(queued)return;queued=true;win.requestAnimationFrame(refresh);}
  new win.MutationObserver(schedule).observe(doc.body||doc.documentElement,{childList:true,subtree:true});
  for(const event of ['bb:pantry-editor','bb:pantry-pack-metadata','basketboss:session-changed','basketboss:household-changed','storage'])win.addEventListener(event,schedule);
  schedule();
 }
 return {mount,install};
});
