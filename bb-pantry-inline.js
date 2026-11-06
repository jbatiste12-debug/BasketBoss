/* At home presentation. Every quantity action uses the guarded pantry editor;
   this module owns no stock, receipts, meal requirements or account storage. */
(function(root,factory){const helpers=factory();if(typeof module==='object'&&module.exports)module.exports=helpers;if(root&&!root.BBPantryInline)root.BBPantryInline=Object.freeze({...helpers,...helpers.install(root)});})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const LOCATIONS=['cupboard','fridge','freezer'];
 const ROUND=value=>Math.round(value*1000000)/1000000;
 function stepFor(unit){return ({g:50,ml:50,kg:.25,l:.25,cup:.25,lb:.25,pint:.25})[unit]||1;}
 function stepped(value,unit,direction){const amount=value===null||value===undefined||value===''?0:Number(value);return Number.isFinite(amount)?ROUND(Math.max(0,amount+stepFor(unit)*(direction<0?-1:1))):null;}
 function preferredUnit(name,policy,fallback){
  try{const key=policy?.canonicalName(name),piece=policy?.countGrams?.[key],one=piece>0?policy.normalize(name,1,'each'):null;if(one?.unit==='g'&&one.quantity>0)return 'each';}catch{}
  return fallback;
 }
 function converted(row,unit,policy,market='UK'){
  if(row.qty===null||row.qty===undefined||row.qty==='')return null;
  if(!Number.isFinite(Number(row.qty))||Number(row.qty)<0)return null;
  if(row.unit===unit&&!(unit==='pint'&&row.inputMarket&&row.inputMarket!==market))return Number(row.qty);
  try{const options={market:row.inputMarket||market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit},from=policy?.normalize(row.name,Number(row.qty),row.unit,options),one=policy?.normalize(row.name,1,unit,unit==='pint'?{market}:{...options,market});if(from&&one&&from.unit===one.unit&&one.quantity>0)return ROUND(from.quantity/one.quantity);}catch{}
  return null;
 }
 function displayUnit(row,market='UK',policy){
  if(row.staple)return 'each';const preferred=preferredUnit(row.name,policy,row.unit);if(preferred==='each')return preferred;
  let base=null;try{base=policy?.normalize(row.name,row.qty===null||row.qty===undefined||row.qty===''?1:Number(row.qty),row.unit,{market:row.inputMarket||market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});}catch{}
  if(base?.unit==='g')return market==='US'?(base.quantity>=453.6?'lb':'oz'):'g';
  if(base?.unit==='ml')return market==='US'?(base.quantity>=60?'cup':'fl oz'):'ml';
  return row.unit;
 }
 function summaryAmount(row,market='UK',policy,formatter){
  const unit=displayUnit(row,market,policy),quantity=converted(row,unit,policy,market);if(quantity===null)return 'Amount unknown';
  const number=new Intl.NumberFormat(market==='US'?'en-US':'en-GB',{maximumFractionDigits:2});
  if(['each','clove','bulb','pack','bag','tin','can','bottle','jar','loaf','slice','whole','item','piece'].includes(unit))return number.format(quantity)+' '+unit;
  if(formatter?.format){
   if(['g','kg','ml','l'].includes(row.unit))return formatter.format(row.name,Number(row.qty),row.unit,market,{preferredUnit:unit});
   try{const measured=policy?.normalize(row.name,Number(row.qty),row.unit,{market:row.inputMarket||market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});if(measured&&['g','ml'].includes(measured.unit))return formatter.format(row.name,measured.quantity,measured.unit,market,{preferredUnit:unit});}catch{}
  }
  return number.format(quantity)+' '+unit;
 }
 function stepPatch(row,viewUnit,direction,policy,market='UK'){
  try{if(row.qty!==null&&row.qty!==undefined&&row.qty!==''){
   const options={market:row.inputMarket||market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit};
   const current=policy?.normalize(row.name,Number(row.qty),row.unit,options),delta=policy?.normalize(row.name,stepFor(viewUnit),viewUnit,viewUnit==='pint'?{market}:{...options,market});
   if(current&&delta&&current.unit===delta.unit)return {qty:ROUND(Math.max(0,current.quantity+delta.quantity*(direction<0?-1:1))),unit:current.unit};
  }}catch{}
  const value=stepped(converted(row,viewUnit,policy,market),viewUnit,direction);return value===null?null:{qty:value,unit:viewUnit};
 }
 function matchesInventory(row,{query='',filter='all',useSoon=false}={}){
  const fold=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(!fold(row.name).includes(fold(query).trim()))return false;
  if(filter==='use-soon')return useSoon;
  if(filter==='low')return ['low','out'].includes(row.stapleStatus)||(row.qty!==null&&row.qty!==undefined&&row.qty!==''&&Number(row.qty)===0);
  return true;
 }
 function install(win){
  const doc=win.document;if(!doc?.addEventListener)return {refresh(){},destroy(){}};
  let current=null,editor=null,queued=false,destroyed=false,observer,originalIntro=null,originalStatus=null;
  let toolbar=null,toolbarResize=null,query='',stockFilter='all',location='cupboard',openedLocation='cupboard',presentationActor=null,pendingReveal=null,scrollLock=null,viewportFrame=null;
  const sections=new Map();
  const el=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
  const market=()=>win.bb307ActiveMarket?.()||'UK';
  const reducedAllowed=()=>win.BBReducedFoodHost?.isPremium?.()===true;
  const reducedActor=()=>win.BBHome?.actor?.()||'guest';
  const urgent=row=>reducedAllowed()&&win.BBReducedStock?.isUrgent?.(row,{actor:reducedActor()})===true;
  const valid=api=>!!api&&api.card?.isConnected&&typeof api.isCurrent==='function'&&api.isCurrent();
  function btn(label,action,className){const node=el('button',className,label);node.type='button';node.addEventListener('click',action);return node;}
  function schedule(){if(queued||destroyed)return;queued=true;(win.requestAnimationFrame||win.setTimeout).call(win,refresh);}
  function safe(action){try{return action();}catch{return null;}}
  function notice(view,value,error=false){text(view.notice,value||'');view.notice.classList.toggle('is-error',error);view.notice.setAttribute('role',error?'alert':'status');}
  function activeTile(){return current?.card?.querySelector('[data-bbpi-active="true"]');}
  const actor=()=>win.BBHome?.actor?.()||'guest';
  function fitEditor(){viewportFrame=null;if(!editor)return;const viewport=win.visualViewport;editor.element.style.setProperty('--bbpi-viewport-height',(Number(viewport?.height)||win.innerHeight)+'px');editor.element.style.setProperty('--bbpi-viewport-top',Math.max(0,Number(viewport?.offsetTop)||0)+'px');}
  function scheduleFit(){if(editor&&viewportFrame===null)viewportFrame=win.requestAnimationFrame(fitEditor);}
  function lockEditor(){if(scrollLock)return;const html=doc.documentElement;scrollLock={x:win.scrollX||0,y:win.scrollY||0,value:html.style.getPropertyValue('--bbpi-scroll-top'),had:html.classList.contains('bbpi-modal-open')};html.style.setProperty('--bbpi-scroll-top',editor?.returnTo?.open?win.getComputedStyle(doc.body).top:-scrollLock.y+'px');html.classList.add('bbpi-modal-open');}
  function closeEditor(focus=true){if(!editor)return;const old=editor;editor=null;const view=sections.get(old.loc);if(view)view.stamp=null;if(old.element.contains(doc.activeElement))doc.activeElement.blur?.();try{old.element.close?.();}catch{}old.element.remove();if(viewportFrame!==null)win.cancelAnimationFrame(viewportFrame);viewportFrame=null;const saved=scrollLock;scrollLock=null;if(saved){const html=doc.documentElement;if(saved.value)html.style.setProperty('--bbpi-scroll-top',saved.value);else html.style.removeProperty('--bbpi-scroll-top');if(!saved.had)html.classList.remove('bbpi-modal-open');if(!old.returnTo?.open)win.scrollTo({top:saved.y,left:saved.x,behavior:'instant'});}win.BBKeyboardLayout?.releaseAfterDismissal?.();if(focus&&old.opener?.isConnected)old.opener.focus({preventScroll:true});safe(()=>old.onClose?.({saved:old.stockSaved===true}));}
  function teardown(keepEditor=false,keepView=false){if(!keepEditor)closeEditor(false);toolbarResize?.disconnect();toolbarResize=null;toolbar?.remove();toolbar=null;if(!keepView){query='';stockFilter='all';location='cupboard';openedLocation='cupboard';presentationActor=null;}pendingReveal=null;for(const view of sections.values()){view.form.remove();view.summary.remove();delete view.body.dataset.bbpiAdding;}sections.clear();current?.card?.classList.remove('bbpi-enhanced');current?.card?.style.removeProperty('--bbpi-toolbar-height');current?.card?.removeAttribute('data-bbpi-filters');if(originalIntro?.node?.isConnected)text(originalIntro.node,originalIntro.value);originalIntro=null;if(originalStatus){const{node,parent,next,value}=originalStatus;text(node,value);node.classList.remove('bbpi-save-status');if(parent.isConnected){if(next?.parentNode===parent)parent.insertBefore(node,next);else parent.append(node);}originalStatus=null;}current=null;}
  function rowUnit(row){return displayUnit(row,market(),win.BBPantryPolicy);}
  function rowAmount(row,unit=rowUnit(row)){const value=converted(row,unit,win.BBPantryPolicy,market());return value===null?'':String(value);}
  function unitLabel(row,unit){if(row.staple)return (win.BBPantryPolicy?.containerLabel(row.name)||'container')+(Number(row.qty)===1?'':'s');return unit==='each'?'each':unit==='l'?'litres':unit;}
  function matches(row){try{return !win.BBPantryGroupsUI||win.BBPantryGroupsUI.matches(row.loc,win.BBPantryGroups?.itemKey(row.name)||row.name.toLowerCase(),row.name);}catch{return true;}}
  function inventoryMatches(row){
   if(!matches(row))return false;
   // A quantity can stop matching Low/Out on its first digit. Keep its editor
   // mounted until Done so typing 200 cannot save only the initial 2.
   if(editor?.anchor==='summary'&&editor.key===row.key)return true;
   return matchesInventory(row,{query,filter:stockFilter,useSoon:urgent(row)});
  }
  function syncLocation(){
   if(!toolbar?.isConnected)return;
   for(const control of toolbar.querySelectorAll('[data-bbpi-location]'))control.setAttribute('aria-pressed',String(control.dataset.bbpiLocation===location));
  }
  function chooseMatchingLocation(){
   if(!valid(current))return;const rows=current.list().filter(inventoryMatches);
   if(!rows.some(row=>row.loc===location)&&rows.length)location=rows[0].loc;
   const area=current.card.querySelector('[data-bb76-store="'+location+'"]');if(area)openArea(area);syncLocation();
  }
  // Close the previous section in the same layout transaction. Waiting for
  // native toggle events would scroll to the old position, then move it again.
  function openArea(area){openedLocation=area.dataset.bb76Store;for(const other of current.card.querySelectorAll('[data-bb76-store]'))if(other!==area)other.open=false;area.open=true;}
  function jump(loc){
   if(!valid(current)||!LOCATIONS.includes(loc))return;location=loc;
   const area=current.card.querySelector('[data-bb76-store="'+loc+'"]');if(!area)return;openArea(area);syncLocation();
  }
  function addFood(loc){
   if(!valid(current))return;location=loc;openEditor(null,undefined,'manual',current.preview?.('',loc)||{name:'',loc,qty:null,unit:'each',totalNeeded:0});
  }
  function mountToolbar(){
   const panel=current.card.querySelector('#bbKitchenFoodPanel');if(!panel)return;
   if(toolbar?.parentNode===panel)return;
   toolbar?.remove();toolbarResize?.disconnect();toolbar=el('section','bbpi-toolbar bbpi-ui');toolbar.id='bbpiToolbar';toolbar.setAttribute('aria-label','Pantry tools');
   const actions=el('div','bbpi-toolbar-actions'),searchTag=el('label','bbpi-search-label'),search=el('input');search.id='bbpiSearch';search.type='search';search.placeholder='Search food';search.maxLength=100;search.value=query;search.setAttribute('aria-label','Search pantry');searchTag.append(search);
   const add=btn('+ Add item',()=>addFood(location),'bbpi-toolbar-add');add.id='bbpiAddItem';
   const filters=btn('View filters',()=>{const show=filterPanel.hidden;filterPanel.hidden=!show;filters.setAttribute('aria-expanded',String(show));current.card.dataset.bbpiFilters=String(show);measureToolbar();},'bbpi-toolbar-filters');filters.id='bbpiViewFilters';filters.setAttribute('aria-controls','bbpiViewFilterPanel');filters.setAttribute('aria-expanded','false');actions.append(searchTag,add,filters);
   const nav=el('nav','bbpi-location-nav');nav.setAttribute('aria-label','Pantry storage areas');
   for(const loc of LOCATIONS){const control=btn(loc[0].toUpperCase()+loc.slice(1),()=>jump(loc),'bbpi-location');control.dataset.bbpiLocation=loc;control.setAttribute('aria-pressed',String(loc===location));control.setAttribute('aria-controls','bbpi-area-'+loc);nav.append(control);}
   const filterPanel=el('div','bbpi-view-filters');filterPanel.id='bbpiViewFilterPanel';filterPanel.hidden=true;filterPanel.setAttribute('role','group');filterPanel.setAttribute('aria-label','Filter pantry stock');
   for(const [key,label]of[['all','All food'],['use-soon','Use soon'],['low','Low / Out']]){const control=btn(label,()=>{closeEditor();stockFilter=key;for(const button of filterPanel.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button===control));chooseMatchingLocation();schedule();},'bbpi-filter');control.dataset.bbpiFilter=key;control.setAttribute('aria-pressed',String(key===stockFilter));filterPanel.append(control);}
   search.addEventListener('input',()=>{closeEditor();query=search.value;chooseMatchingLocation();schedule();});
   toolbar.append(actions,nav,filterPanel);panel.prepend(toolbar);current.card.dataset.bbpiFilters='false';
   if(win.ResizeObserver){toolbarResize=new win.ResizeObserver(measureToolbar);toolbarResize.observe(toolbar);}measureToolbar();
  }
  function measureToolbar(){if(toolbar?.isConnected&&current?.card?.isConnected)current.card.style.setProperty('--bbpi-toolbar-height',Math.ceil(toolbar.getBoundingClientRect().height)+'px');}
  function unitOptions(select,values,selected,row){select.replaceChildren();for(const value of [...new Set(values.concat(selected))]){if(!value)continue;const option=el('option','',row?.staple?unitLabel(row,value):value==='l'?'litres':value);option.value=value;option.selected=value===selected;select.append(option);}}
  function tileFor(row){const tiles=[...current.card.querySelectorAll('[data-bb76-store="'+row.loc+'"] [data-bb5-food]')],exact=tiles.find(node=>node.dataset.bb5Food===row.name);if(exact)return exact;const policy=win.BBPantryPolicy,key=policy?.canonicalName(row.name,win.BBPriceV19?.canonical);return key?tiles.find(node=>policy.canonicalName(node.dataset.bb5Food,win.BBPriceV19?.canonical)===key)||null:null;}
  // The form lives outside #app. Typing never changes the pantry ledger.
  function anchorEditor(){}
  function physicalStamp(row){const normalized=row.qty===null||row.qty===undefined||row.qty===''?null:safe(()=>win.BBPantryPolicy?.normalize(row.name,Number(row.qty),row.unit,{market:row.inputMarket||market(),packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit}));return JSON.stringify([row.loc,row.staple===true,row.stapleStatus||null,row.inputMarket||market(),row.packReviewed===true,row.packQuantity??null,row.packUnit||null,normalized?normalized.quantity:row.qty??null,normalized?.unit||row.unit]);}
  function displayEditor(){
   if(!editor)return;
   if(editor.actor!==actor()||editor.market!==market()){closeEditor(false);return;}
   if(editor.busy)return;
   if(valid(current)&&editor.api!==current){
    if((editor.key||editor.matchedKey)&&!current.read(editor.key||editor.matchedKey)){notice(editor,'This item changed elsewhere. Close this panel and review the latest stock.',true);editor.done.disabled=true;return;}
    const latest=editor.key||editor.matchedKey?current.read(editor.key||editor.matchedKey):null;
    if(latest&&physicalStamp(latest)!==physicalStamp(editor.row)){notice(editor,'Stock changed elsewhere. Close this panel and review the latest amount before saving.',true);editor.done.disabled=true;return;}
    editor.api=current;
   }
  }
  function draftRow(view){
   return {...view.row,name:view.name?view.name.value.trim():view.row.name,qty:view.quantity.value,unit:view.units.value,
    ...(view.status?{stapleStatus:view.status.value}:{}),
    ...(view.packQuantity?.value.trim()&&view.packUnit?.value?{packQuantity:Number(view.packQuantity.value),packUnit:view.packUnit.value,packReviewed:true}:{})};
  }
  function refreshPreview(view=editor){
   if(!view)return;
   const owned=Number(view.quantity.value),needed=Number(view.needed.value),known=view.quantity.value.trim()!==''&&view.needed.value.trim()!==''&&Number.isFinite(owned)&&Number.isFinite(needed)&&owned>=0&&needed>=0;
   const unit=view.units.value,other=converted({...view.row,qty:view.row.otherOwned??0},unit,win.BBPantryPolicy,market())||0;
   const amount=known?ROUND(Math.max(0,needed-owned-other)):null;
   text(view.readout,amount===null?'Enter your amounts to see what to buy.':'Add to Shop: '+new Intl.NumberFormat(market()==='US'?'en-US':'en-GB',{maximumFractionDigits:2}).format(amount)+' '+(view.row.staple?unitLabel(view.row,unit):unit));
   if(view.otherOwned){view.otherOwned.hidden=!(other>0);text(view.otherOwned,other>0?'Also at home in another storage area: '+ROUND(other)+' '+unit+'.':'');}
   text(view.done,view.doneLabel||(amount>0?'Add to Shop':'Done'));
  }
  function localStep(field,direction){
   if(!editor||editor.busy)return;const next=stepped(field.value,editor.units.value,direction);if(next===null)return;
   field.value=String(next);if(field===editor.quantity&&editor.status){if(next===0)editor.status.value='out';else if(editor.status.value==='out')editor.status.value='in';}editor.dirty=true;notice(editor,'');refreshPreview();
  }
  function groupField(row){
   const api=win.BBPantryGroups;if(!api?.snapshot)return null;
   try{
    const label=el('label','bbpg-item-group','Subcategory'),select=el('select'),key=api.itemKey(row.name),pin=api.context(),previous=row.name?api.groupFor(row.loc,key,row.name):null;
    select.setAttribute('aria-label','Subcategory for '+(row.name||'new food'));
    for(const group of api.snapshot(row.loc).groups){const option=el('option','',group.name);option.value=group.id;option.selected=group.id===(previous||win.BBPantryGroupsUI?.active(row.loc));select.append(option);}
    select.addEventListener('change',()=>{if(editor){editor.groupDirty=true;editor.dirty=true;}});label.append(select);return {label,select,pin,previous};
   }catch{return null;}
  }
  function preparePanel(view){
   const row=draftRow(view),raw=view.quantity.value.trim(),neededRaw=view.needed.value.trim();
   if(!row.name)return {error:'Enter the food name.',field:view.name};
   if(view.group&&(view.groupDirty||view.newItem)){
    try{const pin=win.BBPantryGroups.context();if(pin.actor!==view.actor||pin.raw!==view.group.pin.raw)return {error:'Subcategories changed. Close this panel and review them before saving.'};view.group.pin=pin;}catch{return {error:'Reopen At home to review your subcategories before saving.'};}
   }
   if(raw===''||!view.quantity.validity.valid||!Number.isFinite(Number(raw))||Number(raw)<0)return {error:'Enter how much you have; use 0 for none.',field:view.quantity};
   if(neededRaw===''||!view.needed.validity.valid||!Number.isFinite(Number(neededRaw))||Number(neededRaw)<0)return {error:'Enter a valid total needed.',field:view.needed};
   const minimum=converted({...view.row,qty:view.row.minimumNeeded??view.row.mealNeeded??0},row.unit,win.BBPantryPolicy,market());
   if(minimum!==null&&Number(neededRaw)+.000001<minimum)return {error:'Your planned meals and existing Shop items need at least '+ROUND(minimum)+' '+row.unit+'.',field:view.needed};
   if(row.staple&&(!Number.isInteger(Number(raw))||!Number.isInteger(Number(neededRaw))))return {error:'Use whole container counts for this staple.',field:view.quantity};
   if(view.packQuantity&&(view.packQuantity.value.trim()||view.packUnit.value)&&(!view.packQuantity.validity.valid||!(Number(view.packQuantity.value)>0)||!view.packUnit.value))return {error:'Enter the container size and its unit.',field:view.packQuantity};
   const patch={qty:Number(raw),unit:row.unit,totalNeeded:Number(neededRaw)};
   if(view.status)patch.stapleStatus=view.status.value;
   if(view.packQuantity?.value.trim()&&view.packUnit?.value){patch.packQuantity=Number(view.packQuantity.value);patch.packUnit=view.packUnit.value;}
   // The six-decimal display must not change an untouched physical balance.
   // Carry its exact base-unit value back through the selected unit.
   try{
    const policy=win.BBPantryPolicy,options={market:view.row.inputMarket||market(),packReviewed:view.row.packReviewed===true,packQuantity:view.row.packQuantity,packUnit:view.row.packUnit};
    const samePack=!view.packQuantity||String(view.packQuantity.value)===(view.row.packReviewed?String(view.row.packQuantity??''):'')&&view.packUnit.value===(view.row.packUnit||'');
    const one=policy?.normalize(row.name,1,row.unit,{...options,market:row.unit==='pint'?market():options.market});
    if(samePack&&one?.quantity>0){
     const previous=policy.normalize(row.name,Number(view.row.qty),view.row.unit,options);
     if(view.row.qty!==null&&view.row.qty!==undefined&&view.row.qty!==''&&Number(raw)===converted(view.row,row.unit,policy,market())&&previous?.unit===one.unit)patch.qty=previous.quantity/one.quantity;
     const original=converted({...view.row,qty:view.row.totalNeeded??0},row.unit,policy,market());
     if(Number(neededRaw)===original&&Number.isFinite(view.row.totalQuantity)&&view.row.canonicalUnit===one.unit)patch.totalNeeded=view.row.totalQuantity/one.quantity;
    }
   }catch{}
   try{
    const info=win.BBHome?.foodTarget?.({...row,...patch,staple:view.row.staple===true},{otherRows:view.api.list().filter(item=>item.key!==(view.key||view.matchedKey))});
    if(info?.targetProblem)return {error:info.targetProblem,field:view.units};
    if(info&&Number(patch.totalNeeded)*info.quantityPerUnit+info.quantityTolerance<info.minimumQuantity)return {error:'Your meals and existing Shop items need a higher total. Review Total needed before saving.',field:view.needed};
   }catch{return {error:'Shopping totals are still loading. Your pantry has not changed.'};}
   return {row,patch};
  }
  async function commitPanel(view,remove=false){
   if(editor!==view||view.busy)return;
   displayEditor();const api=view.api;if(!valid(api)){notice(view,'Your pantry changed. Close this panel and reopen the item before saving.',true);return;}
   const ready=remove?{}:preparePanel(view);if(ready.error){notice(view,ready.error,true);ready.field?.focus({preventScroll:true});return;}
   view.busy=true;view.element.setAttribute('aria-busy','true');
   const controls=[...view.element.querySelectorAll('button,input,select')],disabled=controls.map(node=>node.disabled);controls.forEach(node=>node.disabled=true);notice(view,'Saving…');
   try{
    let key=view.key;
    if(!remove&&!key){key=api.select(ready.row.name,view.loc,{unit:ready.row.unit});if(!key)throw Error('This food could not be selected. Reopen At home to try again.');view.key=key;}
    const result=remove?api.remove(key):api.update(key,ready.patch);
    if(!result?.ok)throw Error(result?.message||'Check your amounts before saving.');
    if(result.row)view.row=result.row;
    const live=win.BBPantryLive;await api.flush();
    if(editor!==view||view.actor!==actor())return;
    if(live?.hasPending?.())throw Error(api.status?.()||'Your amounts could not be saved. Please try again.');
    view.stockSaved=true;
    if(!remove&&view.group&&(view.groupDirty||view.newItem)){
     const groups=win.BBPantryGroups,name=ready.row.name;
     groups.assign(view.loc,groups.itemKey(name),view.group.select.value,view.group.pin);
    }
    closeEditor();schedule();
   }catch(error){if(editor===view)notice(view,(view.stockSaved?'Amounts saved. ':'')+(error?.message||'Your changes could not be saved. Please try again.'),true);}
   finally{view.busy=false;if(editor===view){view.element.removeAttribute('aria-busy');controls.forEach((node,i)=>node.disabled=disabled[i]);refreshPreview(view);}}
  }
  function openEditor(key,preferred,anchor='tile',draft=null,options={}){
   if(!valid(current))return;const api=current,row=key?api.read(key):draft;if(!row)return;
   if([...doc.querySelectorAll('dialog[open]')].some(node=>node!==editor?.element&&node!==options.returnTo))return false;
   closeEditor(false);
   let unit=row.staple?'each':preferred||rowUnit(row)||row.unit||'each';
   if(row.qty!==null&&row.qty!==undefined&&row.qty!==''&&converted(row,unit,win.BBPantryPolicy,market())===null)unit=row.unit;
   const element=el('dialog','bbpi-editor bbpi-ui bbpi-panel');element.id='bbpi-current-editor';element.setAttribute('aria-modal','true');element.setAttribute('aria-labelledby','bbpiEditorTitle');
   const heading=el('header','bbpi-editor-heading'),title=el('h4','',row.name||'Add food'),caption=el('span','bbpi-eyebrow',row.loc[0].toUpperCase()+row.loc.slice(1)),close=btn('×',()=>{if(!editor?.busy)closeEditor();},'bbpi-close');title.id='bbpiEditorTitle';close.setAttribute('aria-label','Close pantry item');heading.append(caption,title,close);element.append(heading);
   const content=el('div','bbpi-editor-content'),controls=el('div','bbpi-editor-controls');element.append(content);
   let name=null;
   if(anchor==='manual'){
    const nameTag=el('label','bbpi-name-label','Food name');name=el('input');name.type='text';name.maxLength=70;name.autocomplete='off';name.placeholder='e.g. Tinned tomatoes';name.setAttribute('aria-label','Food name');nameTag.append(name);content.append(nameTag);
    const choices=el('datalist');choices.id='bbpiFoodNames';name.setAttribute('list',choices.id);
    for(const value of [...new Set([...api.card.querySelectorAll('[data-bb5-food]')].map(node=>node.dataset.bb5Food))]){const option=el('option');option.value=value;choices.append(option);}content.append(choices);
   }
   const quantityLabel=el('label','bbpi-quantity-label','At home'),quantity=el('input'),neededLabel=el('label','bbpi-needed-label','Total needed'),needed=el('input');
   const field=(label,input,value,aria)=>{input.type='number';input.inputMode='decimal';input.min='0';input.max=row.staple?'10000':'1000000';input.step=row.staple?'1':'any';input.placeholder='0';input.value=value;input.setAttribute('aria-label',aria);const stepper=el('div','bbpi-stepper'),less=btn('−',()=>localStep(input,-1),'bbpi-step'),more=btn('+',()=>localStep(input,1),'bbpi-step');less.setAttribute('aria-label','Less '+aria);more.setAttribute('aria-label','More '+aria);stepper.append(less,input,more);label.append(stepper);controls.append(label);};
   field(quantityLabel,quantity,rowAmount(row,unit),'Amount of '+(row.name||'food')+' at home');quantity.dataset.bbpiQuantity='';
   const defaultNeeded=converted({...row,qty:row.totalNeeded??0},unit,win.BBPantryPolicy,market());
   field(neededLabel,needed,defaultNeeded===null?'':String(defaultNeeded),'Total needed for '+(row.name||'food'));needed.dataset.bbpiNeeded='';
   const unitTag=el('label','bbpi-unit-label','Unit'),units=el('select');units.setAttribute('aria-label','Unit for '+(row.name||'food'));unitOptions(units,row.staple?['each']:(api.units?.()||['each','g','kg','ml','l','pack','bag','tin']),unit,row);unitTag.append(units);controls.append(unitTag);content.append(controls);
   const readout=el('p','bbpi-readout'),otherOwned=el('p','bbpi-notice'),noticeNode=el('p','bbpi-notice');noticeNode.setAttribute('role','status');noticeNode.setAttribute('aria-live','polite');content.append(readout,otherOwned,noticeNode);
   const actions=el('footer','bbpi-editor-actions'),remove=btn('Remove item',()=>commitPanel(view,true),'bbpi-remove'),done=btn('Done',()=>commitPanel(view),'bbpi-done');remove.hidden=!key;actions.append(remove,done);element.append(actions);
   const view={api,key,row,newItem:!key,loc:row.loc,actor:actor(),market:market(),anchor,element,title,name,quantity,needed,units,unit,readout,otherOwned,notice:noticeNode,done,opener:doc.activeElement,dirty:false,busy:false,returnTo:options.returnTo,onClose:options.onClose,doneLabel:options.doneLabel};editor=view;
   const edited=()=>{view.dirty=true;notice(view,'');refreshPreview(view);};quantity.addEventListener('input',()=>{if(view.status&&quantity.value.trim()!==''){if(Number(quantity.value)===0)view.status.value='out';else if(view.status.value==='out')view.status.value='in';}edited();});needed.addEventListener('input',edited);
   units.addEventListener('change',()=>{
    if(editor!==view||view.busy)return;const next=units.value,model=draftRow(view);model.unit=view.unit;const fromOwned=quantity.value.trim()===''?null:converted(model,next,win.BBPantryPolicy,market()),fromNeeded=needed.value.trim()===''?null:converted({...model,qty:needed.value},next,win.BBPantryPolicy,market());
    if((quantity.value.trim()!==''&&fromOwned===null)||(needed.value.trim()!==''&&fromNeeded===null)){units.value=view.unit;notice(view,'Set the container contents first, or clear the amount before choosing a different unit.',true);return;}
    view.unit=next;if(fromOwned!==null)quantity.value=String(fromOwned);if(fromNeeded!==null)needed.value=String(fromNeeded);edited();
   });
   if(row.staple){
    const label=el('label','bbpi-status-label','Stock status'),status=el('select');status.setAttribute('aria-label','Stock status for '+row.name);for(const[value,labelText]of[['in','In Stock'],['low','Low'],['out','Out']]){const option=el('option','',labelText);option.value=value;option.selected=value===(row.stapleStatus||'in');status.append(option);}label.append(status);content.prepend(label);view.status=status;
    status.addEventListener('change',()=>{if(status.value==='out')quantity.value='0';else if(!(Number(quantity.value)>0))quantity.value='1';edited();});
   }else{
    const details=el('details','bbpi-pack'),summary=el('summary','','Container size (optional)'),help=el('p','','Use the size on the label for packs, bags or tins.'),fields=el('div','bbpi-pack-fields'),packTag=el('label','','One container contains'),packQuantity=el('input');packQuantity.type='number';packQuantity.inputMode='decimal';packQuantity.min='0.000001';packQuantity.max='1000000';packQuantity.step='any';packQuantity.value=row.packReviewed?row.packQuantity??'':'';packQuantity.setAttribute('aria-label','Container size for '+(row.name||'food'));packTag.append(packQuantity);
    const packUnitTag=el('label','','Contents unit'),packUnit=el('select');packUnit.setAttribute('aria-label','Container contents unit');unitOptions(packUnit,['','g','ml','each','oz','lb','fl oz'],row.packUnit||'');if(!row.packUnit){const blank=el('option','','Choose unit');blank.value='';blank.selected=true;packUnit.prepend(blank);}packUnitTag.append(packUnit);fields.append(packTag,packUnitTag);details.append(summary,help,fields);content.append(details);view.packQuantity=packQuantity;view.packUnit=packUnit;packQuantity.addEventListener('input',edited);packUnit.addEventListener('change',edited);
   }
   view.group=groupField(row);if(view.group)content.append(view.group.label);
   name?.addEventListener('change',()=>{
    const preview=api.preview?.(name.value.trim(),row.loc);if(!preview)return;view.row={...preview};view.matchedKey=api.read(preview.key)?preview.key:null;text(title,preview.name||'Add food');
    if(!view.dirty){view.unit=preview.unit;unitOptions(units,api.units?.()||[preview.unit],preview.unit,preview);needed.value=String(preview.totalNeeded??0);}if(view.group&&!view.groupDirty)try{view.group.select.value=win.BBPantryGroups.groupFor(row.loc,win.BBPantryGroups.itemKey(preview.name),preview.name);}catch{}refreshPreview(view);
   });
   element.addEventListener('cancel',event=>{event.preventDefault();if(!view.busy)closeEditor();});element.addEventListener('close',()=>{if(editor===view&&!view.busy)closeEditor();});
   doc.body.append(element);lockEditor();fitEditor();try{element.showModal();}catch{element.setAttribute('open','');}fitEditor();close.focus({preventScroll:true});refreshPreview(view);return true;
  }
  function adjustSummary(key,direction){if(!valid(current))return teardown();const row=current.read(key);if(!row)return;const unit=rowUnit(row),patch=stepPatch(row,unit,direction,win.BBPantryPolicy,market());if(!patch)return;const result=safe(()=>current.update(key,patch));if(!result?.ok){openEditor(key,unit,'summary');if(editor)notice(editor,result?.message||'Review this amount.',true);}schedule();}
  async function freezeSummary(key,control){
   if(!valid(current)||!reducedAllowed())return;const api=current,row=api.read(key);if(!urgent(row)||typeof api.moveToFreezer!=='function')return;
   control.disabled=true;try{const result=await api.moveToFreezer(key);if(!result?.ok){const view=sections.get(row.loc);if(view)notice(view,result?.message||'Reopen At home to review this item.',true);}else{const view=sections.get(row.loc);if(view)notice(view,row.name+' moved to Freezer.');closeEditor();schedule();}}catch{const view=sections.get(row.loc);if(view)notice(view,'The item could not move safely. Your saved stock has been kept.',true);}finally{if(control.isConnected)control.disabled=false;}
  }
  function mountSection(area){
   const loc=area.dataset.bb76Store,body=area.querySelector('.bb76-store-body');if(!LOCATIONS.includes(loc)||!body)return;area.id='bbpi-area-'+loc;
   let view=sections.get(loc);if(view?.body===body&&view.form.isConnected)return;
   view?.form.remove();view?.summary.remove();area.open=loc===openedLocation;
   const form=el('form','bbpi-manual bbpi-ui');form.setAttribute('aria-label','Add food to '+loc);const title=el('h4','','Add your own food'),nameTag=el('label','bbpi-manual-name','Item name'),name=el('input');name.type='text';name.maxLength=70;name.required=true;name.placeholder=loc==='freezer'?'e.g. Frozen fish':loc==='fridge'?'e.g. Strawberries':'e.g. Brown rice';name.setAttribute('aria-label','Food name for '+loc);nameTag.append(name);const amountTag=el('label','bbpi-manual-qty','Quantity'),quantity=el('input');quantity.type='number';quantity.inputMode='decimal';quantity.required=true;quantity.min='0';quantity.max='1000000';quantity.step='any';quantity.placeholder='Amount';quantity.setAttribute('aria-label','Quantity to add to '+loc);amountTag.append(quantity);const unitTag=el('label','bbpi-manual-unit','Unit'),unit=el('select');unit.setAttribute('aria-label','Unit to add to '+loc);unitOptions(unit,current.units?.()||['each','g','kg','ml','l','pack','bag','tin'],'each');unitTag.append(unit);const add=el('button','bbpi-manual-add','Add');add.type='submit';const noticeNode=el('p','bbpi-notice');noticeNode.setAttribute('aria-live','polite');form.append(title,nameTag,amountTag,unitTag,add,noticeNode);
   const summary=el('section','bbpi-summary bbpi-ui'),header=el('header'),heading=el('h4','','Food at home'),count=el('span','bbpi-count'),list=el('ul','bbpi-summary-list'),footer=el('footer','bbpi-summary-footer'),addFoodButton=btn('+ Add food',()=>addFood(loc),'bbpi-add-food'),closeAdd=btn('Done adding',()=>{delete body.dataset.bbpiAdding;closeEditor();},'bbpi-close-add');footer.append(addFoodButton,closeAdd);header.append(heading,count);summary.append(header,list,footer,noticeNode);view={loc,body,form,summary,count,list,notice:noticeNode,stamp:null};sections.set(loc,view);body.prepend(form);body.prepend(summary);
   form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();if(!valid(current))return teardown();const result=safe(()=>current.add({name:name.value,loc,qty:quantity.value,unit:unit.value}));if(!result?.ok){notice(view,result?.message||'Enter the item, quantity and unit.',true);return;}name.value='';quantity.value='';notice(view,'Food added. Shopping updates automatically.');schedule();name.focus({preventScroll:true});});
  }
  function summaries(rows){for(const view of sections.values()){
   const all=rows.filter(row=>row.loc===view.loc),visible=all.filter(inventoryMatches);
   const own=reducedAllowed()&&win.BBReducedStock?.sort?win.BBReducedStock.sort(visible,{actor:reducedActor()}):visible;
   let prices=()=>null;try{prices=win.BBKitchenPrices?.read?.()||prices;}catch{}
   const labels=new Map(own.map(row=>[row.key,win.BBKitchenPrices?.label?.(prices(row.name))||'']));
   const stamp=JSON.stringify([market(),query,stockFilter,all.length,own.map(row=>[row.key,row.name,row.qty,row.unit,row.stapleStatus,row.readout,labels.get(row.key),urgent(row)])]);
   if(stamp===view.stamp)continue;view.stamp=stamp;
   text(view.count,(own.length===all.length?all.length:own.length+' of '+all.length)+' item'+(all.length===1?'':'s'));
   // Keep the active card connected. Detaching a focused number input resets
   // its caret on iOS even when focus is restored to the same DOM node.
   const active=editor?.anchor==='summary'&&editor.loc===view.loc?[...view.list.children].find(node=>node.dataset.bbpiKey===editor.key):null;
   const activeIndex=active?[...view.list.children].indexOf(active):-1;
   const existing=new Map([...view.list.children].filter(node=>node.dataset.bbpiKey).map(node=>[node.dataset.bbpiKey,node]));
   const items=own.map(row=>{
    const item=existing.get(row.key)||el('li','bbpi-summary-row');
    const main=el('div','bbpi-summary-main'),name=el('strong','',row.name),unit=rowUnit(row),value=rowAmount(row,unit);
    const amount=el('span','bbpi-summary-amount',row.staple?({in:'In Stock',low:'Low',out:'Out'}[row.stapleStatus]||'Review status')+(value!==''?' · '+value+' '+unitLabel(row,unit):''):summaryAmount(row,market(),win.BBPantryPolicy,win.BBPantryDisplay));
    item.dataset.bbpiKey=row.key;item.classList.toggle('bbpi-reduced-row',urgent(row));main.append(name,amount);
    if(urgent(row))main.append(el('span','bbpi-use-soon','🏷️ Use soon (Reduced)'));
    if(labels.get(row.key))main.append(el('small','bb-kitchen-last-price',labels.get(row.key)));
    const controls=el('div','bbpi-summary-actions'),less=btn('−',()=>adjustSummary(row.key,-1),'bbpi-step'),more=btn('+',()=>adjustSummary(row.key,1),'bbpi-step'),edit=btn('Edit',()=>openEditor(row.key,unit,'summary'),'bbpi-edit');
    less.setAttribute('aria-label','Less '+row.name+' in '+view.loc);more.setAttribute('aria-label','More '+row.name+' in '+view.loc);edit.setAttribute('aria-label','Edit '+row.name+' in '+view.loc);controls.append(less,more,edit);
    if(urgent(row)&&typeof current.moveToFreezer==='function'){const freeze=btn('❄️ Move to Freezer',()=>freezeSummary(row.key,freeze),'bbpi-freeze');freeze.setAttribute('aria-label','Move '+row.name+' to Freezer');controls.append(freeze);}
    const oldMain=item.querySelector(':scope>.bbpi-summary-main'),oldControls=item.querySelector(':scope>.bbpi-summary-actions');
    if(oldMain)oldMain.replaceWith(main);else item.append(main);
    if(oldControls)oldControls.replaceWith(controls);else item.append(controls);
    return item;
   });
   if(active&&items.includes(active)){
    // Temporarily pin the edited card's position too: urgent sorting must not
    // move its focused ancestor. A later refresh restores the ordinary order.
    items.splice(items.indexOf(active),1);items.splice(Math.min(activeIndex,items.length),0,active);
   }
   // Keep unchanged cards mounted while quantities/prices refresh, so WebKit
   // does not repeatedly discard the item beneath the user's thumb.
   const keep=new Set(items);for(const child of [...view.list.children])if(!keep.has(child))child.remove();
   for(const [index,item]of items.entries())if(view.list.children[index]!==item)view.list.insertBefore(item,view.list.children[index]||null);
   if(!items.length)view.list.append(el('li','bbpi-empty',all.length?'No food matches these filters.':'Add food to start your pantry.'));
  }}
  function refresh(){queued=false;if(destroyed)return;const api=win.BBPantryEditor;const stay=doc.body.dataset.bbnextView==='shop'&&presentationActor===actor(),keep=!!editor&&editor.actor===actor()&&editor.market===market()&&doc.body.dataset.bbnextView==='shop';if(!valid(api)){teardown(keep,stay);return;}
   if(current!==api){teardown(keep,true);presentationActor=actor();current=api;const node=current.card.querySelector('.bb76-title>div>p:last-child');if(node)originalIntro={node,value:node.textContent};const status=current.card.querySelector('#bb5StockStatus');if(status){originalStatus={node:status,parent:status.parentNode,next:status.nextSibling,value:status.textContent};text(status,'Confirm your amounts to update Shop.');status.classList.add('bbpi-save-status');current.card.querySelector('.bb76-kitchen-intro')?.after(status);}}
   try{if(originalIntro)text(originalIntro.node,'Enter what you have and what you need, then confirm.');for(const area of current.card.querySelectorAll('[data-bb76-store]')){mountSection(area);area.open=area.dataset.bb76Store===openedLocation;}summaries(current.list());displayEditor();mountToolbar();current.card.classList.add('bbpi-enhanced');}
   catch{teardown(keep,stay);if(editor)notice(editor,'The pantry is refreshing. Your entries are kept in this panel.',true);}
  }
  function click(event){
   if(!valid(current))return;
   const summary=event.target.closest?.('[data-bb76-store]>summary');
   if(summary&&current.card.contains(summary)&&!event.target.closest?.('button,input,select,a')){
    event.preventDefault();const area=summary.parentElement,opening=!area.open;
    if(opening){openArea(area);location=area.dataset.bb76Store;syncLocation();}else{area.open=false;openedLocation=null;}
    return;
   }
   const tile=event.target.closest?.('[data-bb5-food]');if(!tile||!current.card.contains(tile))return;const loc=tile.closest('[data-bb76-store]')?.dataset.bb76Store;if(!LOCATIONS.includes(loc))return;event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
   const name=tile.dataset.bb5Food,policy=win.BBPantryPolicy,canonical=value=>policy?.canonicalName(value,win.BBPriceV19?.canonical)||value.toLowerCase(),row=current.list().find(row=>row.loc===loc&&canonical(row.name)===canonical(name));
   if(row)openEditor(row.key,preferredUnit(name,policy,rowUnit(row)));else{const preview=current.preview?.(name,loc);if(preview)openEditor(null,preferredUnit(name,policy,preview.unit),'tile',preview);}
  }
  const reset=()=>{if(editor&&editor.actor===actor()&&editor.market===market()&&!win.BBAccountDeletion?.isDeleting?.()){schedule();return;}teardown();schedule();};
  const storageToggle=event=>{if(event.target?.matches?.('[data-bb76-store]')&&current?.card?.contains(event.target)){if(event.target.open!==(event.target.dataset.bb76Store===openedLocation))schedule();syncLocation();}};
  doc.addEventListener('click',click,true);doc.addEventListener('toggle',storageToggle,true);win.addEventListener('resize',measureToolbar);win.addEventListener('resize',scheduleFit);win.visualViewport?.addEventListener('resize',scheduleFit);win.visualViewport?.addEventListener('scroll',scheduleFit);win.addEventListener('bb:pantry-editor',schedule);win.addEventListener('basketboss:market-changed',schedule);win.addEventListener('basketboss:session-changed',reset);for(const event of['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener(event,reset);
  const storage=event=>{if(event.key==='basketboss_cloud_session_v1'||event.key===null)reset();};win.addEventListener('storage',storage);
  const keydown=event=>{if(event.key==='Escape'&&editor){event.preventDefault();if(!editor.busy)closeEditor();}};doc.addEventListener('keydown',keydown);
  if(win.MutationObserver){observer=new win.MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('.bbpi-ui')&&(record.target.id==='app'||record.target.matches?.('[data-bb76-tiles],#bb5SelectedRows')||record.target.closest?.('.bb76-kitchen-intro')||record.target.closest?.('.bbpg-controls')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.id==='bb173ShopFridge'||node.id==='bbKitchenFoodPanel'||node.querySelector?.('#bb173ShopFridge,#bbKitchenFoodPanel'))))))schedule();});observer.observe(doc.body,{childList:true,subtree:true});}
  schedule();return {refresh:schedule,open(key,options={}){if(!valid(current))refresh();return openEditor(key,options.unit,'review',null,options)===true;},destroy(){destroyed=true;observer?.disconnect();teardown();doc.removeEventListener('click',click,true);doc.removeEventListener('keydown',keydown);doc.removeEventListener('toggle',storageToggle,true);win.removeEventListener('resize',measureToolbar);win.removeEventListener('resize',scheduleFit);win.visualViewport?.removeEventListener('resize',scheduleFit);win.visualViewport?.removeEventListener('scroll',scheduleFit);win.removeEventListener('bb:pantry-editor',schedule);win.removeEventListener('basketboss:market-changed',schedule);win.removeEventListener('basketboss:session-changed',reset);for(const event of['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.removeEventListener(event,reset);win.removeEventListener('storage',storage);}};
 }
 return {install,stepFor,stepped,preferredUnit,converted,displayUnit,summaryAmount,stepPatch,matchesInventory};
});
