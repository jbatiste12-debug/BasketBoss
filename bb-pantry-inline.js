/* At home presentation. Every quantity action uses the guarded pantry editor;
   this module owns no stock, receipts, meal requirements or account storage. */
(function(root,factory){const helpers=factory();if(typeof module==='object'&&module.exports)module.exports=helpers;if(root&&!root.BBPantryInline)root.BBPantryInline=Object.freeze({...helpers,...helpers.install(root)});})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const LOCATIONS=['cupboard','fridge','freezer'];
 const ROUND=value=>Math.round(value*1000000)/1000000;
 const foodFold=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 function readableNumber(value,market='UK',useGrouping=false){
  const locale=market==='US'?'en-US':'en-GB',text=new Intl.NumberFormat(locale,{maximumFractionDigits:2,useGrouping}).format(value);
  if(!(Number(value)>0)||Number(text)!==0)return text;
  const tiny=new Intl.NumberFormat(locale,{maximumFractionDigits:6,useGrouping:false}).format(value);
  return Number(tiny)>0?tiny:Number(value).toExponential(2);
 }
 function matchedFood(value,foods,location,canonicalize){
  const wanted=foodFold(value);if(!wanted)return null;
  const exact=food=>[food.name,...food.aliases||[]].some(name=>foodFold(name)===wanted);
  const preferred=foods.filter(food=>food.loc===location),candidates=[...preferred,...foods.filter(food=>food.loc!==location)];
  const direct=candidates.find(exact);if(direct)return direct;
  if(typeof canonicalize==='function'){const key=canonicalize(value);if(key)return candidates.find(food=>canonicalize(food.name)===key)||null;}
  return null;
 }
 function matchingFoods(value,foods,location,limit=4){
  const wanted=foodFold(value);if(!wanted)return [];
  const rank=food=>{const names=[food.name,...food.aliases||[]].map(foodFold);return (names.includes(wanted)?0:names.some(name=>name.startsWith(wanted))?2:4)+(food.loc===location?0:1);};
  return foods.filter(food=>[food.name,...food.aliases||[]].some(name=>foodFold(name).includes(wanted))).sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name)).slice(0,limit);
 }
 function stepFor(unit){return ({g:50,ml:50,kg:.25,l:.25,cup:.25,lb:.25,pint:.25})[unit]||1;}
 function stepped(value,unit,direction){const amount=value===null||value===undefined||value===''?0:Number(value);return Number.isFinite(amount)?ROUND(Math.max(0,amount+stepFor(unit)*(direction<0?-1:1))):null;}
 function preferredUnit(name,policy,fallback,options={}){
  // A measured pantry amount stays measured. Piece weights are estimates,
  // so converting it to a count would present a guessed fractional item.
  if(options.preferMeasured===true&&['g','kg','ml','l','oz','lb','fl oz','cup','pint','tsp','tbsp'].includes(fallback))return fallback;
  try{const key=policy?.canonicalName(name),piece=policy?.countGrams?.[key],one=piece>0?policy.normalize(name,1,'each'):null;if(one?.unit==='g'&&one.quantity>0)return 'each';}catch{}
  return fallback;
 }
 function converted(row,unit,policy,market='UK'){
  if(row.qty===null||row.qty===undefined||row.qty==='')return null;
  if(!Number.isFinite(Number(row.qty))||Number(row.qty)<0)return null;
  if(row.unit===unit&&!(unit==='pint'&&row.inputMarket&&row.inputMarket!==market))return Number(row.qty);
  try{const options={market:row.inputMarket||market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit},from=policy?.normalize(row.name,Number(row.qty),row.unit,options),one=policy?.normalize(row.name,1,unit,unit==='pint'?{market}:{...options,market});if(from&&one&&from.unit===one.unit&&one.quantity>0){const value=from.quantity/one.quantity,rounded=ROUND(value);return value>0&&rounded===0?value:rounded;}}catch{}
  return null;
 }
 function displayUnit(row,market='UK',policy,options={}){
  if(row.staple)return 'each';const preferred=preferredUnit(row.name,policy,row.unit,options);if(preferred==='each')return preferred;
  let base=null;try{base=policy?.normalize(row.name,row.qty===null||row.qty===undefined||row.qty===''?1:Number(row.qty),row.unit,{market:row.inputMarket||market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});}catch{}
  if(base?.unit==='g')return market==='US'?(base.quantity>=453.6?'lb':'oz'):'g';
  if(base?.unit==='ml')return market==='US'?(base.quantity>=60?'cup':'fl oz'):'ml';
  return row.unit;
 }
 function summaryAmount(row,market='UK',policy,formatter,options={}){
  const unit=displayUnit(row,market,policy,options),quantity=converted(row,unit,policy,market);if(quantity===null)return 'Amount unknown';
  const number=new Intl.NumberFormat(market==='US'?'en-US':'en-GB',{maximumFractionDigits:2});
  if(['each','clove','bulb','pack','bag','tin','can','bottle','jar','loaf','slice','whole','item','piece'].includes(unit)||quantity>0&&Number(number.format(quantity))===0)return readableNumber(quantity,market,true)+' '+unit;
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
 function purchaseUnits(row,policy,market='UK'){
  if(row.staple)return ['each'];
  const options={market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit};
  let base;try{base=policy?.normalize(row.name,1,row.unit,options);}catch{}
  if(!base)return row.unit?[row.unit]:['each'];
  return ['each','g','kg','ml','l','oz','lb','fl oz','cup','pint'].filter(unit=>{try{return policy.normalize(row.name,1,unit,options)?.unit===base.unit;}catch{return false;}});
 }
 function purchasePresets(row,policy,market='UK',standard=null){
  const options={market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit};
  let base;try{base=policy?.normalize(row.name,1,row.unit,options);}catch{}
  const counted=row.staple||preferredUnit(row.name,policy,row.unit)==='each'||base?.unit==='each';
  const values=counted?(row.staple?[[1,'each'],[2,'each'],[3,'each']]:[[1,'each'],[6,'each'],[12,'each']]):base?.unit==='ml'?(market==='US'?[[16,'fl oz'],[32,'fl oz'],[64,'fl oz']]:[[500,'ml'],[1,'l'],[2,'l']]):base?.unit==='g'?(market==='US'?[[8,'oz'],[1,'lb'],[2,'lb']]:[[250,'g'],[500,'g'],[1,'kg']]):[];
  const choices=values.map(([quantity,unit])=>({quantity,unit}));
  if(!row.staple&&Number(standard?.quantity)>0&&Number(standard.quantity)<=1000000)try{
   const candidate=policy?.normalize(row.name,Number(standard.quantity),standard.unit,options);
   if(candidate?.unit===base?.unit&&!choices.some(value=>{const normalized=policy.normalize(row.name,value.quantity,value.unit,options);return normalized?.unit===candidate.unit&&Math.abs(normalized.quantity-candidate.quantity)<=.000001;}))choices.unshift({quantity:Number(standard.quantity),unit:standard.unit});
  }catch{}
  return choices;
 }
 function install(win){
  const doc=win.document;if(!doc?.addEventListener)return {refresh(){},destroy(){}};
  let current=null,editor=null,queued=false,destroyed=false,observer,originalIntro=null,originalStatus=null,originalHeading=null,originalNav=null,heroCount=null,globalActions=null;
  let toolbar=null,toolbarResize=null,query='',stockFilter='all',location='cupboard',openedLocation='cupboard',presentationActor=null,pendingReveal=null,scrollLock=null,viewportFrame=null;
  const sections=new Map(),summaryStamps=new WeakMap(),exactAmounts=new WeakMap();
  const el=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
  const market=()=>win.bb307ActiveMarket?.()||'UK';
  const amountText=value=>readableNumber(value,market());
  // Programmatic display rounding never becomes a new physical balance.
  // A real input event discards this backing, even when the text is retyped.
  function setAmount(input,value){
   const raw=value===null||value===undefined?'':String(value);
   if(raw.trim()===''||!Number.isFinite(Number(raw))){exactAmounts.delete(input);input.value=raw;return;}
   input.value=amountText(Number(raw));exactAmounts.set(input,{text:input.value,value:raw});
  }
  function amountValue(input){const saved=exactAmounts.get(input);return saved&&input.value===saved.text?saved.value:input.value;}

  const reducedAllowed=()=>win.BBReducedFoodHost?.isPremium?.()===true;
  const reducedActor=()=>win.BBHome?.actor?.()||'guest';
  const urgent=row=>reducedAllowed()&&win.BBReducedStock?.isUrgent?.(row,{actor:reducedActor()})===true;
  const valid=api=>!!api&&api.card?.isConnected&&typeof api.isCurrent==='function'&&api.isCurrent();
  function btn(label,action,className){const node=el('button',className,label);node.type='button';node.addEventListener('click',action);return node;}
  function schedule(){if(queued||destroyed)return;queued=true;(win.requestAnimationFrame||win.setTimeout).call(win,refresh);}
  function safe(action){try{return action();}catch{return null;}}
  function notice(view,value,error=false){if(view.conflict){if(value&&error)view.conflictNotice=value;if(!value){value=view.conflictNotice||'This item changed elsewhere. Reopen it before saving.';error=true;}}text(view.notice,value||'');view.notice.classList.toggle('is-error',error);view.notice.setAttribute('role',error?'alert':'status');}
  function activeTile(){return current?.card?.querySelector('[data-bbpi-active="true"]');}
  const actor=()=>win.BBHome?.actor?.()||'guest';
  function fitEditor(){viewportFrame=null;if(!editor)return;const viewport=win.visualViewport;editor.element.style.setProperty('--bbpi-viewport-height',(Number(viewport?.height)||win.innerHeight)+'px');editor.element.style.setProperty('--bbpi-viewport-top',Math.max(0,Number(viewport?.offsetTop)||0)+'px');}
  function scheduleFit(){if(editor&&viewportFrame===null)viewportFrame=win.requestAnimationFrame(fitEditor);}
  function lockEditor(){if(scrollLock)return;const html=doc.documentElement;scrollLock={x:win.scrollX||0,y:win.scrollY||0,value:html.style.getPropertyValue('--bbpi-scroll-top'),had:html.classList.contains('bbpi-modal-open')};html.style.setProperty('--bbpi-scroll-top',editor?.returnTo?.open?win.getComputedStyle(doc.body).top:-scrollLock.y+'px');html.classList.add('bbpi-modal-open');}
  function closeEditor(focus=true){if(!editor)return;const old=editor;editor=null;const view=sections.get(old.loc);if(view)view.stamp=null;if(old.element.contains(doc.activeElement))doc.activeElement.blur?.();try{old.element.close?.();}catch{}old.element.remove();if(viewportFrame!==null)win.cancelAnimationFrame(viewportFrame);viewportFrame=null;const saved=scrollLock;scrollLock=null;if(saved){const html=doc.documentElement;if(saved.value)html.style.setProperty('--bbpi-scroll-top',saved.value);else html.style.removeProperty('--bbpi-scroll-top');if(!saved.had)html.classList.remove('bbpi-modal-open');if(!old.returnTo?.open)win.scrollTo({top:saved.y,left:saved.x,behavior:'instant'});}win.BBKeyboardLayout?.releaseAfterDismissal?.();if(focus&&old.opener?.isConnected)old.opener.focus({preventScroll:true});safe(()=>old.onClose?.({saved:old.stockSaved===true}));}
  function teardown(keepEditor=false,keepView=false){if(!keepEditor)closeEditor(false);toolbarResize?.disconnect();toolbarResize=null;toolbar?.remove();toolbar=null;globalActions?.remove();globalActions=null;heroCount?.remove();heroCount=null;if(originalHeading?.node?.isConnected)text(originalHeading.node,originalHeading.value);originalHeading=null;if(originalNav){const {node,parent,next}=originalNav;if(parent.isConnected){if(next?.parentNode===parent)parent.insertBefore(node,next);else parent.append(node);}originalNav=null;}for(const area of current?.card?.querySelectorAll('[data-bb76-store]')||[]){delete area.dataset.bbpiVisible;area.removeAttribute('role');area.removeAttribute('aria-labelledby');}current?.card?.removeAttribute('data-bbpi-storage');if(!keepView){query='';stockFilter='all';location='cupboard';openedLocation='cupboard';presentationActor=null;}pendingReveal=null;for(const view of sections.values()){view.form.remove();view.summary.remove();delete view.body.dataset.bbpiAdding;}sections.clear();current?.card?.classList.remove('bbpi-enhanced');current?.card?.style.removeProperty('--bbpi-toolbar-height');current?.card?.removeAttribute('data-bbpi-filters');if(originalIntro?.node?.isConnected)text(originalIntro.node,originalIntro.value);originalIntro=null;if(originalStatus){const{node,parent,next,value}=originalStatus;text(node,value);node.classList.remove('bbpi-save-status');if(parent.isConnected){if(next?.parentNode===parent)parent.insertBefore(node,next);else parent.append(node);}originalStatus=null;}current=null;}
  function rowUnit(row){return displayUnit(row,market(),win.BBPantryPolicy,{preferMeasured:true});}
  // Keep the source precision; form fields retain it behind readable text.
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
  const locationName=loc=>loc==='all'?'All':loc[0].toUpperCase()+loc.slice(1);
  function syncLocation(){
   if(!toolbar?.isConnected||!valid(current))return;
   const rows=current.list();
   for(const control of toolbar.querySelectorAll('[data-bbpi-storage]')){
    const loc=control.dataset.bbpiStorage,selected=loc===openedLocation;
    control.setAttribute('aria-selected',String(selected));control.tabIndex=selected?0:-1;
    const count=rows.filter(row=>(loc==='all'||row.loc===loc)&&inventoryMatches(row)).length;
    text(control.querySelector('.bbpi-tab-count'),String(count));control.setAttribute('aria-label',locationName(loc)+', '+count+' item'+(count===1?'':'s'));
   }
   if(heroCount){text(heroCount,String(rows.length));heroCount.setAttribute('aria-label',rows.length+' food'+(rows.length===1?'':'s')+' at home');}
  }
  function compactHeader(){
   const intro=current.card.querySelector('.bb76-kitchen-intro'),heading=intro?.querySelector('h2'),nav=current.card.querySelector('#bbKitchenSections');
   if(heading){if(!originalHeading)originalHeading={node:heading,value:heading.textContent};text(heading,'At home');if(!heroCount?.isConnected){heroCount=el('span','bbpi-hero-count');heading.after(heroCount);}}
   if(intro&&nav&&nav.parentNode!==intro){if(!originalNav)originalNav={node:nav,parent:nav.parentNode,next:nav.nextSibling};intro.append(nav);}
  }
  function applyStorageView(){
   if(!valid(current))return;
   current.card.dataset.bbpiStorage=openedLocation||location;
   for(const area of current.card.querySelectorAll('[data-bb76-store]')){
    const loc=area.dataset.bb76Store,visible=openedLocation==='all'||loc===openedLocation;
    area.dataset.bbpiVisible=String(visible);if(area.open!==visible)area.open=visible;area.setAttribute('role','tabpanel');
    area.setAttribute('aria-labelledby','bbpi-tab-'+(openedLocation==='all'?'all':loc));
    const header=sections.get(loc)?.summary.querySelector(':scope>header');
    if(header){header.hidden=openedLocation!=='all';text(header.querySelector('h4'),locationName(loc));}
   }
   syncLocation();syncScans();
  }
  function chooseMatchingLocation(){
   if(!valid(current))return;const rows=current.list().filter(inventoryMatches);
   if(!rows.some(row=>row.loc===location)&&rows.length)location=rows[0].loc;
   if(openedLocation==='all'){syncLocation();return;}
   const area=current.card.querySelector('[data-bb76-store="'+location+'"]');if(area)openArea(area);syncLocation();
  }
  function openArea(area){openedLocation=area.dataset.bb76Store;applyStorageView();}
  function revealLocation(){syncLocation();}
  function jump(loc){
   if(!valid(current)||!LOCATIONS.includes(loc)&&loc!=='all')return;
   if(loc!=='all')location=loc;openedLocation=loc;
   const choices=globalActions?.querySelector('.bbpi-location-choices');if(choices)choices.hidden=true;
   // The original sections stay mounted; a tab changes visibility in place.
   applyStorageView();
  }
  function originalScan(loc){return current?.card?.querySelector('.bb-pantry-camera-button[aria-label="Scan '+loc+' ingredients with Premium AI"]')||null;}
  function scanFood(loc){if(valid(current)&&['fridge','cupboard'].includes(loc))originalScan(loc)?.click();}
  function syncScans(){
   const scan=globalActions?.querySelector('.bbpi-ai-scan'),help=globalActions?.querySelector('.bbpi-scan-help');if(!scan)return;
   const loc=openedLocation||location,supported=loc!=='freezer';
   scan.disabled=!supported||(loc==='all'?!originalScan('fridge')&&!originalScan('cupboard'):!originalScan(loc));
   scan.title=supported?'Scan '+(loc==='all'?'Fridge or Cupboard':locationName(loc))+' ingredients with Premium AI':'AI photo scanning supports Fridge and Cupboard only.';
   scan.setAttribute('aria-label',scan.title);help.hidden=supported;
  }
  function mountGlobalActions(){
   const storage=current.card.querySelector('#bb76StorageSections');if(!storage)return;
   if(globalActions?.parentNode===storage)return;
   globalActions?.remove();globalActions=el('div','bbpi-global-actions bbpi-ui');
   const choices=el('div','bbpi-location-choices');choices.hidden=true;choices.id='bbpiScanLocationChoices';choices.setAttribute('role','group');choices.setAttribute('aria-label','Choose where to scan');
   choices.append(el('span','bbpi-location-prompt','Where are you scanning?'));
   for(const loc of ['fridge','cupboard'])choices.append(btn(locationName(loc),()=>{choices.hidden=true;scanFood(loc);},'bbpi-location-choice'));
   const add=btn('+ Add food',event=>{event.stopPropagation();addFood(openedLocation==='all'?'cupboard':openedLocation||location);},'bbpi-add-food');
   const scan=btn('',event=>{event.stopPropagation();if(openedLocation==='all')choices.hidden=!choices.hidden;else scanFood(openedLocation||location);},'bbpi-ai-scan');
   scan.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6.5h4l1.5-2h5l1.5 2h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="4"/></svg>';
   scan.append(el('small','bbpi-scan-premium','Premium'));
   const help=el('p','bbpi-scan-help','AI photo scanning supports Fridge and Cupboard only. Add Freezer food manually.');help.id='bbpiScanHelp';help.hidden=true;scan.setAttribute('aria-describedby',help.id);scan.setAttribute('aria-controls',choices.id);
   globalActions.append(add,scan,help,choices);storage.append(globalActions);syncScans();
  }
  function knownFoods(){
   const foods=[],byId=new Map(),catalogue=Object.values(win.BBPriceV19?.catalog||{}),canonical=value=>win.BBPantryPolicy?.canonicalName(value,win.BBPriceV19?.canonical)||foodFold(value);
   const put=(name,loc,aliases=[])=>{if(!name||!LOCATIONS.includes(loc)||win.BBKitchenChoiceRules?.isHousehold?.(name))return;const id=loc+'|'+canonical(name),old=byId.get(id);if(old){old.aliases.push(...aliases,name);return;}const food={id,name,loc,aliases};byId.set(id,food);foods.push(food);};
   for(const row of current.list())put(row.name,row.loc);
   for(const tile of current.card.querySelectorAll('[data-bb5-food]')){
    const loc=tile.closest('[data-bb76-store]')?.dataset.bb76Store,name=tile.dataset.bb5Food;
    // The cupboard tile is tinned tuna. Keep fresh/frozen tuna distinct, and
    // keep an existing saved name rather than silently moving old stock.
    const tinned=loc==='cupboard'&&foodFold(name)==='tuna'&&!byId.has('cupboard|'+canonical(name))&&catalogue.some(food=>foodFold(food.ingredient)==='tinned tuna');
    put(tinned?'Tinned tuna':name,loc,tinned?[name]:[]);
   }
   const place=(name,aisle)=>/^frozen\b/i.test(name)||/frozen/i.test(aisle||'')?'freezer':/dairy|chilled|produce|meat|fish/i.test(aisle||'')?'fridge':'cupboard';
   for(const food of catalogue)if(typeof food.ingredient==='string')put(food.ingredient[0].toUpperCase()+food.ingredient.slice(1),place(food.ingredient,food.aisle));
   for(const row of win.BBHomeHost?.requirements?.()||[]){const name=row.key||row.name;if(typeof name==='string'&&!foods.some(food=>canonical(food.name)===canonical(name)))put(name,place(name,win.BBPriceV19?.aisle?.(name)));}
   return foods;
  }
  function previewFood(name,loc,foods=knownFoods()){
   const match=matchedFood(name,foods,loc,value=>win.BBPantryPolicy?.canonicalName(value,win.BBPriceV19?.canonical)||foodFold(value));
   return current.preview?.(match?.name||name.trim(),loc)||null;
  }
  function packChoices(row){
   let standard=null;
   if(!row.staple)try{
    const pricing=win.BBPriceV19,key=pricing?.canonical?.(row.name),declared=Object.values(pricing?.catalog||{}).find(food=>pricing.canonical(food.ingredient)===key);
    // Only an existing ingredient-specific catalogue entry can suggest a
    // pack. A generic pricing fallback must not invent a custom food's size.
    const pack=declared&&pricing.getPack?.(row.name,declared.standard_pack_unit,market());
    if(pack)standard={quantity:pack.standard_pack_size,unit:pack.standard_pack_unit};
   }catch{}
   return purchasePresets(row,win.BBPantryPolicy,market(),standard);
  }
  function addFood(loc,name=query){
   if(!valid(current))return;location=loc;const row=previewFood(String(name||''),loc)||{name:String(name||'').trim(),loc,qty:null,unit:'each',totalNeeded:0};openEditor(null,undefined,'manual',row);
  }
  function searchChoices(){
   const choices=toolbar?.querySelector('.bbpi-search-matches');if(!choices||!valid(current))return;
   choices.replaceChildren();if(!query.trim()){choices.hidden=true;return;}
   const foods=matchingFoods(query,knownFoods(),location);
   for(const food of foods){const control=btn('+ '+food.name,()=>{jump(food.loc);addFood(food.loc,food.name);},'bbpi-search-choice');control.setAttribute('aria-label','Add '+food.name+' to '+food.loc);choices.append(control);}
   choices.hidden=!query.trim();if(!foods.length&&query.trim())choices.append(el('span','bbpi-search-empty','No match — add your own food.'));
  }
  function mountToolbar(){
   const panel=current.card.querySelector('#bbKitchenFoodPanel');if(!panel)return;
   if(toolbar?.parentNode===panel)return;
   toolbar?.remove();toolbarResize?.disconnect();toolbar=el('section','bbpi-toolbar bbpi-ui');toolbar.id='bbpiToolbar';toolbar.setAttribute('aria-label','Pantry tools');
   const actions=el('div','bbpi-toolbar-actions'),searchTag=el('label','bbpi-search-label'),search=el('input');search.id='bbpiSearch';search.type='search';search.placeholder='Search food';search.maxLength=100;search.value=query;search.setAttribute('aria-label','Search pantry');searchTag.append(search);
   const filters=btn('',()=>{const show=filterPanel.hidden;filterPanel.hidden=!show;filters.setAttribute('aria-expanded',String(show));current.card.dataset.bbpiFilters=String(show);measureToolbar();},'bbpi-toolbar-filters');filters.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/></svg>';filters.setAttribute('aria-label','Filters');filters.id='bbpiViewFilters';filters.setAttribute('aria-controls','bbpiViewFilterPanel');filters.setAttribute('aria-expanded','false');actions.append(searchTag,filters);
   const tabs=el('nav','bbpi-storage-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Pantry storage');
   const order=['fridge','cupboard','freezer','all'];
   for(const loc of order){const control=btn(locationName(loc),()=>jump(loc),'bbpi-storage-tab');control.id='bbpi-tab-'+loc;control.dataset.bbpiStorage=loc;control.setAttribute('role','tab');control.setAttribute('aria-controls',loc==='all'?LOCATIONS.map(value=>sections.get(value)?.body.closest('[data-bb76-store]')?.id).filter(Boolean).join(' '):sections.get(loc)?.body.closest('[data-bb76-store]')?.id||'bbpi-area-'+loc);control.append(el('span','bbpi-tab-count','0'));tabs.append(control);}
   tabs.addEventListener('keydown',event=>{const control=event.target.closest('[data-bbpi-storage]');if(!control||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=order.indexOf(control.dataset.bbpiStorage),next=event.key==='Home'?0:event.key==='End'?3:(index+(event.key==='ArrowRight'?1:3))%4;tabs.querySelector('[data-bbpi-storage="'+order[next]+'"]').focus({preventScroll:true});jump(order[next]);});
   const filterPanel=el('div','bbpi-view-filters');filterPanel.id='bbpiViewFilterPanel';filterPanel.hidden=true;filterPanel.setAttribute('role','group');filterPanel.setAttribute('aria-label','Filter pantry stock');
   for(const [key,label]of[['all','All food'],['use-soon','Use soon'],['low','Low / Out']]){const control=btn(label,()=>{closeEditor();stockFilter=key;for(const button of filterPanel.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button===control));chooseMatchingLocation();pendingReveal=location;schedule();},'bbpi-filter');control.dataset.bbpiFilter=key;control.setAttribute('aria-pressed',String(key===stockFilter));filterPanel.append(control);}
   search.addEventListener('input',()=>{closeEditor();query=search.value;chooseMatchingLocation();searchChoices();schedule();});
   const choices=el('div','bbpi-search-matches');choices.setAttribute('aria-label','Matching foods');choices.hidden=true;
   toolbar.append(actions,tabs,choices,filterPanel);panel.prepend(toolbar);current.card.dataset.bbpiFilters='false';searchChoices();
   if(win.ResizeObserver){toolbarResize=new win.ResizeObserver(measureToolbar);toolbarResize.observe(toolbar);}measureToolbar();
  }
  function measureToolbar(){if(toolbar?.isConnected&&current?.card?.isConnected)current.card.style.setProperty('--bbpi-toolbar-height','0px');}
  function unitOptions(select,values,selected,row){select.replaceChildren();for(const value of [...new Set(values.concat(selected))]){if(!value)continue;const option=el('option','',row?.staple?unitLabel(row,value):value==='l'?'litres':value);option.value=value;option.selected=value===selected;select.append(option);}}
  function tileFor(row){const tiles=[...current.card.querySelectorAll('[data-bb76-store="'+row.loc+'"] [data-bb5-food]')],exact=tiles.find(node=>node.dataset.bb5Food===row.name);if(exact)return exact;const policy=win.BBPantryPolicy,key=policy?.canonicalName(row.name,win.BBPriceV19?.canonical);return key?tiles.find(node=>policy.canonicalName(node.dataset.bb5Food,win.BBPriceV19?.canonical)===key)||null:null;}
  // The form lives outside #app. Typing never changes the pantry ledger.
  function anchorEditor(){}
  function physicalStamp(row){const normalized=row.qty===null||row.qty===undefined||row.qty===''?null:safe(()=>win.BBPantryPolicy?.normalize(row.name,Number(row.qty),row.unit,{market:row.inputMarket||market(),packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit}));return JSON.stringify([row.loc,row.staple===true,row.stapleStatus||null,row.inputMarket||market(),row.packReviewed===true,row.packQuantity??null,row.packUnit||null,normalized?normalized.quantity:row.qty??null,normalized?.unit||row.unit]);}
  function preferenceStamp(row){
   const normalized=(field,canonicalField,unitField)=>{
    if(Number.isFinite(row[canonicalField]))return [row[canonicalField],row.canonicalUnit||row.unit];
    if(row[field]===null||row[field]===undefined||row[field]==='')return [0,row.canonicalUnit||row.unit];
    const unit=row[unitField]||row.unit,value=safe(()=>win.BBPantryPolicy?.normalize(row.name,Number(row[field]),unit,{market:row.inputMarket||market(),packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit}));
    return value?[value.quantity,value.unit]:[row[field],unit];
   };
   return JSON.stringify([normalized('extraBuffer','extraBufferQuantity'),normalized('buyMultiple','buyMultipleQuantity','buyMultipleUnit')]);
  }
  function displayEditor(){
   if(!editor)return;
   if(editor.actor!==actor()||editor.market!==market()){closeEditor(false);return;}
   if(editor.busy)return;
   if(valid(current)){
    const latest=editor.key||editor.matchedKey?current.read(editor.key||editor.matchedKey):null;
    if(latest&&preferenceStamp(latest)!==preferenceStamp(editor.row)){editor.conflict=true;notice(editor,'Your saved stock buffer or pack size changed elsewhere. Reopen this item to review it before saving.',true);editor.done.disabled=true;return;}
   }
   if(valid(current)&&editor.api!==current){
    if((editor.key||editor.matchedKey)&&!current.read(editor.key||editor.matchedKey)){editor.conflict=true;notice(editor,'This item changed elsewhere. Close this panel and review the latest stock.',true);editor.done.disabled=true;return;}
    const latest=editor.key||editor.matchedKey?current.read(editor.key||editor.matchedKey):null;
    if(latest&&physicalStamp(latest)!==physicalStamp(editor.row)){editor.conflict=true;notice(editor,'Stock changed elsewhere. Close this panel and review the latest amount before saving.',true);editor.done.disabled=true;return;}
    editor.api=current;
   }
   refreshPreview(editor);
  }
  function draftRow(view){
   const typed=view.name?.value.trim();
   const name=view.name?(typed&&foodFold(typed)===view.resolvedInput?view.row.name:typed):view.row.name;
   const stapleFood=win.BBPantryPolicy?.isStaple(name)&&(view.row.trackingMode==='measured'||view.row.staple===true||!win.BBPantryPolicy?.isWholePepper?.(name,view.units.value,view.row));
   const measured=stapleFood&&view.tracking?.value==='measured',staple=!!stapleFood&&!measured;
   return {...view.row,name,qty:amountValue(view.quantity),unit:view.units.value,inputMarket:market(),staple,
    ...(stapleFood?{trackingMode:measured?'measured':'containers',measurementReviewed:measured}:{}),
    ...(staple&&view.status?{stapleStatus:view.status.value}:{}),
    ...(view.packQuantity?.value.trim()&&view.packUnit?.value?{packQuantity:Number(amountValue(view.packQuantity)),packUnit:view.packUnit.value,packReviewed:true}:{})};
  }
  function multipleDraft(view){
   if(!view.buySelect||view.buySelect.value==='off')return {quantity:draftRow(view).staple?1:0,unit:view.units.value};
   if(view.buySelect.value==='custom')return {quantity:view.buyQuantity.value.trim()===''?null:Number(amountValue(view.buyQuantity)),unit:view.buyUnit.value};
   return view.buyOptions.find(option=>option.value===view.buySelect.value)||{quantity:null,unit:view.units.value};
  }
  function automaticNeeded(view){
   let info;
   // Base demand is independent of the editable buffer and pack preference.
   // Recalculate it in the current unit rather than reusing a rounded input.
   try{info=win.BBHome?.foodTarget?.({...draftRow(view),inputMarket:market(),automaticNeeded:true,extraBuffer:0,buyMultiple:0},{otherRows:view.api.list().filter(item=>item.key!==(view.key||view.matchedKey))});}catch{}
   const problem=info?.targetProblem||(!info?'Shopping totals are still loading. Please try again.':'');
   const displayNeeded=info?.quantityPerUnit>0?info.totalQuantity/info.quantityPerUnit:info?.totalNeeded;
   view.needed.value=problem?'':info.plannedNeedsReview&&info.totalQuantity===0?'Needs review':amountText(displayNeeded);
   let help=problem;
   if(!problem){
    const number=new Intl.NumberFormat(market()==='US'?'en-US':'en-GB',{maximumFractionDigits:2});
    help=info.plannedNeedsReview?(info.plannedReviewMessage||'Planned meal quantities need a unit check; only compatible amounts are included.'):info.mealQuantity>0?'From your planned meals: '+number.format(info.mealNeeded)+' '+view.units.value+'.':'Not needed for your planned meals.';
    if(info.totalQuantity>info.mealQuantity+info.quantityTolerance)help+=' Includes your saved restock target.';
    if(info.manualQuantity>0)help+=' Extra already on Shop: '+number.format(info.manualNeeded)+' '+view.units.value+'.';
    if(info.otherRequestsNeedReview)help+=' Some existing Shop items use different units and need review.';
    help+=' Use Extra stock buffer to keep more on hand.';
   }
   text(view.neededHelp,help);return problem?null:info;
  }
  function refreshPreview(view=editor){
   if(!view)return;
   const target=automaticNeeded(view);
   const owned=Number(amountValue(view.quantity)),needed=target?.totalNeeded??NaN,buffer=Number(amountValue(view.buffer)),known=!!target&&view.quantity.value.trim()!==''&&view.buffer.value.trim()!==''&&[owned,needed,buffer].every(value=>Number.isFinite(value)&&value>=0);
   const unit=view.units.value,model=draftRow(view),other=Number(view.row.otherOwned||0)===0?0:converted({...view.row,qty:view.row.otherOwned},unit,win.BBPantryPolicy,market()),buy=multipleDraft(view);
   let calculation=null;
   if(target&&known&&!target.otherOwnedNeedsReview&&other!==null&&buy.quantity!==null)try{
    const policy=win.BBPantryPolicy,options={market:market(),packReviewed:model.packReviewed===true,packQuantity:model.packQuantity,packUnit:model.packUnit},originalOptions={market:view.row.inputMarket||market(),packReviewed:view.row.packReviewed===true,packQuantity:view.row.packQuantity,packUnit:view.row.packUnit},samePack=!view.packQuantity||String(amountValue(view.packQuantity))===(view.row.packReviewed?String(view.row.packQuantity??''):'')&&view.packUnit.value===(view.row.packUnit||''),one=model.staple?{quantity:1,unit:'each'}:policy?.normalize(model.name,1,unit,options);
    if(one?.quantity>0){
     const canonical=(quantity,from=unit)=>{if(model.staple)return from==='each'?quantity:null;const value=policy.normalize(model.name,quantity,from,options);return value?.unit===one.unit?value.quantity:null;};
     const exact=(quantity,field,canonicalField)=>samePack&&!view.touched.has('buffer')&&quantity===converted({...view.row,qty:view.row[field]??0},unit,policy,market())&&view.row.canonicalUnit===one.unit&&Number.isFinite(view.row[canonicalField])?view.row[canonicalField]:canonical(quantity);
     const old=view.row.staple?{quantity:Number(view.row.qty),unit:'each'}:policy.normalize(view.row.name,Number(view.row.qty),view.row.unit,originalOptions);
     const ownedCanonical=samePack&&!view.touched.has('quantity')&&owned===converted(view.row,unit,policy,market())&&old?.unit===one.unit?old.quantity:canonical(owned),neededCanonical=target.totalQuantity,bufferCanonical=exact(buffer,'extraBuffer','extraBufferQuantity');
     const otherValue=view.row.staple?{quantity:Number(view.row.otherOwned??0),unit:'each'}:policy.normalize(view.row.name,view.row.otherOwned??0,view.row.unit,originalOptions),otherCanonical=Number(view.row.otherOwned||0)===0?0:otherValue?.unit===one.unit?otherValue.quantity:null;
     const multipleCanonical=buy.quantity===0?0:samePack&&!view.touched.has('buy-quantity')&&buy.quantity===converted({...view.row,qty:view.row.buyMultiple??0},buy.unit,policy,market())&&view.row.canonicalUnit===one.unit&&Number.isFinite(view.row.buyMultipleQuantity)?view.row.buyMultipleQuantity:canonical(buy.quantity,buy.unit);
     if([ownedCanonical,neededCanonical,bufferCanonical,otherCanonical,multipleCanonical].every(value=>value!==null)){
      const missing=ROUND(Math.max(0,neededCanonical+bufferCanonical-ownedCanonical-otherCanonical)+target.manualQuantity);
      const result=win.BBHome?.purchaseAmounts?.({needed:missing,owned:0,multiple:multipleCanonical,unit:one.unit});
      if(result)calculation={...result,shortfall:result.shortfall/one.quantity,purchaseQuantity:result.purchaseQuantity/one.quantity,unit};
     }
    }
   }catch{}
   const amount=calculation?.purchaseQuantity??null,number=value=>new Intl.NumberFormat(market()==='US'?'en-US':'en-GB',{maximumFractionDigits:2}).format(value);
   const label=model.staple?unitLabel({...model,qty:amount},unit):unit;
   const packLabel=buy.unit==='l'?(buy.quantity===1?'litre':'litres'):model.staple?unitLabel({...model,qty:buy.quantity},buy.unit):buy.unit;
   text(view.readout,amount===null?!model.name?'Enter a food name to get started.':view.quantity.value.trim()===''?'Enter how much you have; use 0 for none.':'Enter valid amounts to see what to buy.':amount>0&&buy.quantity>0?'Add to Shop: '+calculation.packCount+' × '+number(buy.quantity)+' '+packLabel:'Add to Shop: '+number(amount)+' '+label);
   const shortfallLabel=model.staple?unitLabel({...model,qty:calculation?.shortfall},unit):unit;
   text(view.roundingNote,calculation?.rounded?'Shortfall '+number(calculation.shortfall)+' '+shortfallLabel+' · rounded to full packs.':'');
   if(view.bufferHelp)text(view.bufferHelp,buffer>0&&amount===0?'Your food at home already covers your meal needs and this buffer. Nothing needs adding to Shop.':'Added to your meal needs. Food already at home counts first.');
   if(view.otherOwned){view.otherOwned.hidden=!(other>0);text(view.otherOwned,other>0?'Also at home in another storage area: '+ROUND(other)+' '+unit+'.':'');}
   text(view.done,view.doneLabel||(amount>0?'Add to Shop':'Done'));
  }
  function localStep(field,direction){
   if(!editor||editor.busy)return;const next=stepped(amountValue(field),editor.units.value,direction);if(next===null)return;
   setAmount(field,next);editor.touched.add(field===editor.quantity?'quantity':field===editor.needed?'needed':'buffer');if(field===editor.quantity&&editor.status){if(next===0)editor.status.value='out';else if(editor.status.value==='out')editor.status.value='in';}editor.dirty=true;notice(editor,'');refreshPreview();
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
   const target=automaticNeeded(view);
   const row=draftRow(view),raw=amountValue(view.quantity).trim(),neededRaw=target?String(target.totalNeeded):'',bufferRaw=amountValue(view.buffer).trim(),buy=multipleDraft(view);
   if(!row.name)return {error:'Enter the food name.',field:view.name};
   if(view.group&&(view.groupDirty||view.newItem)){
    try{const pin=win.BBPantryGroups.context();if(pin.actor!==view.actor||pin.raw!==view.group.pin.raw)return {error:'Subcategories changed. Close this panel and review them before saving.'};view.group.pin=pin;}catch{return {error:'Reopen At home to review your subcategories before saving.'};}
   }
   if(raw===''||!view.quantity.validity.valid||!Number.isFinite(Number(raw))||Number(raw)<0)return {error:'Enter how much you have; use 0 for none.',field:view.quantity};
   if(!target)return {error:view.neededHelp.textContent,field:view.units};
   if(bufferRaw===''||!view.buffer.validity.valid||!Number.isFinite(Number(bufferRaw))||Number(bufferRaw)<0)return {error:'Enter a valid extra stock buffer; use 0 for none.',field:view.buffer};
   if(buy.quantity===null||!Number.isFinite(buy.quantity)||buy.quantity<0||buy.quantity>1000000||view.buySelect.value==='custom'&&(!(buy.quantity>0)||!view.buyQuantity.validity.valid||!buy.unit))return {error:'Enter a positive pack size, or choose Exact amount.',field:view.buyQuantity};
   if(row.staple&&(!Number.isInteger(Number(neededRaw))||!Number.isInteger(Number(bufferRaw))||!Number.isInteger(buy.quantity)))return {error:'Use whole container counts for extra stock and purchases.',field:view.buffer};
   if(view.packQuantity&&(view.packQuantity.value.trim()||view.packUnit.value)&&(!view.packQuantity.validity.valid||!(Number(amountValue(view.packQuantity))>0)||!view.packUnit.value))return {error:'Enter the container size and its unit.',field:view.packQuantity};
   const patch={qty:Number(raw),unit:row.unit,totalNeeded:Number(neededRaw),automaticNeeded:true,extraBuffer:Number(bufferRaw),buyMultiple:buy.quantity,buyMultipleUnit:buy.unit};
   if(row.trackingMode){patch.trackingMode=row.trackingMode;patch.measurementReviewed=row.measurementReviewed;patch.staple=row.staple;}
   if(row.staple&&view.status)patch.stapleStatus=view.status.value;
   if(view.packQuantity?.value.trim()&&view.packUnit?.value){patch.packQuantity=Number(amountValue(view.packQuantity));patch.packUnit=view.packUnit.value;}
   // The rounded display must not change an untouched physical balance.
   // Carry its exact base-unit value back through the selected unit.
   try{
    const policy=win.BBPantryPolicy,options={market:view.row.inputMarket||market(),packReviewed:view.row.packReviewed===true,packQuantity:view.row.packQuantity,packUnit:view.row.packUnit};
    const samePack=!view.packQuantity||String(amountValue(view.packQuantity))===(view.row.packReviewed?String(view.row.packQuantity??''):'')&&view.packUnit.value===(view.row.packUnit||'');
    const one=policy?.normalize(row.name,1,row.unit,{...options,market:row.unit==='pint'?market():options.market});
    if(samePack&&one?.quantity>0){
     const previous=policy.normalize(row.name,Number(view.row.qty),view.row.unit,options);
     if(!view.touched.has('quantity')&&view.row.qty!==null&&view.row.qty!==undefined&&view.row.qty!==''&&Number(raw)===converted(view.row,row.unit,policy,market())&&previous?.unit===one.unit)patch.qty=previous.quantity/one.quantity;
     const originalBuffer=converted({...view.row,qty:view.row.extraBuffer??0},row.unit,policy,market());
     if(!view.touched.has('buffer')&&Number(bufferRaw)===originalBuffer&&Number.isFinite(view.row.extraBufferQuantity)&&view.row.canonicalUnit===one.unit)patch.extraBuffer=view.row.extraBufferQuantity/one.quantity;
     const buyOne=policy.normalize(row.name,1,buy.unit,{...options,market:market()}),originalMultiple=converted({...view.row,qty:view.row.buyMultiple??0},buy.unit,policy,market());
     if(!view.touched.has('buy-quantity')&&buy.quantity>0&&buy.quantity===originalMultiple&&buyOne?.quantity>0&&Number.isFinite(view.row.buyMultipleQuantity)&&view.row.canonicalUnit===buyOne.unit)patch.buyMultiple=view.row.buyMultipleQuantity/buyOne.quantity;
    }
   }catch{}
   try{
    const info=win.BBHome?.foodTarget?.({...row,...patch,inputMarket:market(),staple:row.staple===true},{otherRows:view.api.list().filter(item=>item.key!==(view.key||view.matchedKey))});
    if(!info||info.targetProblem)return {error:info?.targetProblem||'Shopping totals are still loading. Your pantry has not changed.',field:view.units};
    patch.totalNeeded=info.totalQuantity/info.quantityPerUnit;
   }catch{return {error:'Shopping totals are still loading. Your pantry has not changed.'};}
   return {row,patch};
  }
  async function commitPanel(view,remove=false){
   if(editor!==view||view.busy)return;
   displayEditor();if(editor!==view||view.conflict)return;const api=view.api;if(!valid(api)){notice(view,'Your pantry changed. Close this panel and reopen the item before saving.',true);return;}
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
    const nameTag=el('label','bbpi-name-label','Food name');name=el('input');name.type='text';name.maxLength=70;name.autocomplete='off';name.placeholder='e.g. Tinned tomatoes';name.value=row.name||'';name.setAttribute('aria-label','Food name');nameTag.append(name);content.append(nameTag);
    const choices=el('datalist');choices.id='bbpiFoodNames';name.setAttribute('list',choices.id);
    for(const value of [...new Set([...api.card.querySelectorAll('[data-bb5-food]')].map(node=>node.dataset.bb5Food))]){const option=el('option');option.value=value;choices.append(option);}content.append(choices);
   }
   const trackingLabel=el('label','bbpi-tracking-label','Track amount as'),tracking=el('select');tracking.setAttribute('aria-label','How to track this food');tracking.dataset.bbpiTracking='';
   for(const [value,label]of[['containers','Jars or bottles'],['measured','Weight or volume']]){const option=el('option','',label);option.value=value;tracking.append(option);}tracking.value=row.trackingMode==='measured'&&row.measurementReviewed===true?'measured':'containers';trackingLabel.append(tracking);trackingLabel.hidden=!win.BBPantryPolicy?.isStaple(row.name)||win.BBPantryPolicy?.isWholePepper?.(row.name,row.unit,row)&&row.trackingMode!=='measured';controls.append(trackingLabel);
   const quantityLabel=el('label','bbpi-quantity-label','At home'),quantity=el('input'),neededLabel=el('label','bbpi-needed-label','Total needed (automatic)'),needed=el('input'),neededHelp=el('small','bbpi-needed-help'),bufferLabel=el('label','bbpi-buffer-label','Extra stock buffer'),buffer=el('input');
   const field=(label,input,value,aria)=>{input.type='number';input.inputMode='decimal';input.min='0';input.max=row.staple?'10000':'1000000';input.step=row.staple?'1':'any';input.placeholder='0';setAmount(input,value);input.setAttribute('aria-label',aria);const stepper=el('div','bbpi-stepper'),less=btn('−',()=>localStep(input,-1),'bbpi-step'),more=btn('+',()=>localStep(input,1),'bbpi-step');less.setAttribute('aria-label','Less '+aria);more.setAttribute('aria-label','More '+aria);stepper.append(less,input,more);label.append(stepper);controls.append(label);};
   field(quantityLabel,quantity,rowAmount(row,unit),'Amount of '+(row.name||'food')+' at home');quantity.step='any';quantity.dataset.bbpiQuantity='';
   const defaultNeeded=converted({...row,qty:row.totalNeeded??0},unit,win.BBPantryPolicy,market());
   needed.type='text';needed.readOnly=true;needed.value=defaultNeeded===null?'':amountText(defaultNeeded);needed.setAttribute('aria-label','Total needed for '+(row.name||'food'));needed.setAttribute('aria-describedby','bbpiNeededHelp');needed.dataset.bbpiNeeded='';neededHelp.id='bbpiNeededHelp';neededHelp.setAttribute('aria-live','polite');neededLabel.append(needed,neededHelp);controls.append(neededLabel);
   const defaultBuffer=converted({...row,qty:row.extraBuffer??0},unit,win.BBPantryPolicy,market());
   field(bufferLabel,buffer,defaultBuffer===null?'':String(defaultBuffer),'Extra stock buffer for '+(row.name||'food'));buffer.dataset.bbpiBuffer='';
   const bufferHelp=el('small','bbpi-needed-help bbpi-buffer-help');bufferHelp.id='bbpiBufferHelp';bufferHelp.setAttribute('aria-live','polite');buffer.setAttribute('aria-describedby',bufferHelp.id);bufferLabel.append(bufferHelp);
   const unitTag=el('label','bbpi-unit-label','Unit'),units=el('select');units.setAttribute('aria-label','Unit for '+(row.name||'food'));unitOptions(units,row.staple?['each']:(api.units?.()||['each','g','kg','ml','l','pack','bag','tin']),unit,row);unitTag.append(units);controls.append(unitTag);content.append(controls);
   const buyLabel=el('label','bbpi-buy-label','Buy in multiples of (optional)'),buySelect=el('select'),buyOptions=packChoices(row).map((option,index)=>({...option,value:'pack-'+index}));buySelect.dataset.bbpiBuyMultiple='';buySelect.setAttribute('aria-label','Buy '+(row.name||'food')+' in multiples of');
   const off=el('option','',row.staple?'Whole containers':'Exact amount (no rounding)');off.value='off';buySelect.append(off);
   const number=value=>new Intl.NumberFormat(market()==='US'?'en-US':'en-GB',{maximumFractionDigits:2}).format(value);
   for(const option of buyOptions){const suffix=option.unit==='l'?(option.quantity===1?'litre':'litres'):row.staple?unitLabel({...row,qty:option.quantity},option.unit):option.unit,label=el('option','',number(option.quantity)+' '+suffix);label.value=option.value;buySelect.append(label);}
   const custom=el('option','','Custom pack size');custom.value='custom';buySelect.append(custom);buyLabel.append(buySelect);controls.append(buyLabel);
   const buyFields=el('div','bbpi-buy-fields'),buyQuantityLabel=el('label','','Pack size'),buyQuantity=el('input'),buyUnitLabel=el('label','','Pack unit'),buyUnit=el('select');buyQuantity.type='number';buyQuantity.inputMode='decimal';buyQuantity.min=row.staple?'1':'0.000001';buyQuantity.max='1000000';buyQuantity.step=row.staple?'1':'any';buyQuantity.placeholder='e.g. 500';buyQuantity.setAttribute('aria-label','Purchase pack size for '+(row.name||'food'));buyQuantity.dataset.bbpiBuyQuantity='';setAmount(buyQuantity,Number(row.buyMultiple)>0?row.buyMultiple:'');buyQuantityLabel.append(buyQuantity);buyUnit.setAttribute('aria-label','Purchase pack unit for '+(row.name||'food'));buyUnit.dataset.bbpiBuyUnit='';unitOptions(buyUnit,purchaseUnits(row,win.BBPantryPolicy,market()),row.buyMultipleUnit||row.unit||unit,row);buyUnitLabel.append(buyUnit);buyFields.append(buyQuantityLabel,buyUnitLabel);controls.append(buyFields);
   let savedChoice=null;
   if(Number(row.buyMultiple)>0){
    const saved=converted({...row,qty:row.buyMultiple,unit:row.buyMultipleUnit||row.unit},row.unit,win.BBPantryPolicy,market());
    savedChoice=buyOptions.find(option=>{const value=converted({...row,qty:option.quantity,unit:option.unit,inputMarket:market()},row.unit,win.BBPantryPolicy,market());return value!==null&&saved!==null&&Math.abs(value-saved)<=.000001;});
   }
   buySelect.value=Number(row.buyMultiple)>0?savedChoice?.value||'custom':'off';buyFields.hidden=buySelect.value!=='custom';
   const readout=el('p','bbpi-readout'),roundingNote=el('p','bbpi-rounding-note'),otherOwned=el('p','bbpi-notice'),noticeNode=el('p','bbpi-notice');readout.setAttribute('aria-live','polite');noticeNode.setAttribute('role','status');noticeNode.setAttribute('aria-live','polite');content.append(readout,roundingNote,otherOwned,noticeNode);
   const actions=el('footer','bbpi-editor-actions'),remove=btn('Remove item',()=>commitPanel(view,true),'bbpi-remove'),done=btn('Done',()=>commitPanel(view),'bbpi-done');remove.hidden=!key;actions.append(remove,done);element.append(actions);
   const view={api,key,row,newItem:!key,matchedKey:!key&&api.read(row.key)?row.key:null,loc:row.loc,actor:actor(),market:market(),anchor,element,title,name,tracking,trackingLabel,quantity,needed,neededHelp,buffer,bufferHelp,units,unit,buySelect,buyOptions,buyFields,buyQuantity,buyUnit,readout,roundingNote,otherOwned,notice:noticeNode,done,opener:doc.activeElement,dirty:false,touched:new Set(),resolvedInput:foodFold(row.name),busy:false,returnTo:options.returnTo,onClose:options.onClose,doneLabel:options.doneLabel};editor=view;
   const edited=field=>{view.dirty=true;if(typeof field==='string')view.touched.add(field);notice(view,'');refreshPreview(view);};quantity.addEventListener('input',()=>{exactAmounts.delete(quantity);if(view.status&&quantity.value.trim()!==''){if(Number(quantity.value)===0)view.status.value='out';else if(view.status.value==='out')view.status.value='in';}edited('quantity');});buffer.addEventListener('input',()=>{exactAmounts.delete(buffer);edited('buffer');});
   buySelect.addEventListener('change',()=>{buyFields.hidden=buySelect.value!=='custom';edited('buy');});buyQuantity.addEventListener('input',()=>{exactAmounts.delete(buyQuantity);view.touched.add('buy-quantity');edited('buy');});buyUnit.addEventListener('change',()=>edited('buy'));
   units.addEventListener('change',()=>{
    if(editor!==view||view.busy)return;const next=units.value,model=draftRow(view),samePack=!view.packQuantity||String(amountValue(view.packQuantity))===(view.row.packReviewed?String(view.row.packQuantity??''):'')&&view.packUnit.value===(view.row.packUnit||'');model.unit=view.unit;
    const source=(input,field,canonicalField)=>{
     const original=field==='qty'?view.row:{...view.row,qty:view.row[field]??0};
     if(samePack&&!view.touched.has(field==='qty'?'quantity':'buffer')&&input.value.trim()!==''&&Number(amountValue(input))===converted(original,view.unit,win.BBPantryPolicy,market()))return canonicalField&&Number.isFinite(view.row[canonicalField])?{...view.row,qty:view.row[canonicalField],unit:view.row.canonicalUnit,inputMarket:market()}:original;
     return {...model,qty:amountValue(input)};
    };
    const fromOwned=quantity.value.trim()===''?null:Number(amountValue(quantity))===0?0:converted(source(quantity,'qty'),next,win.BBPantryPolicy,market()),fromBuffer=buffer.value.trim()===''?null:Number(amountValue(buffer))===0?0:converted(source(buffer,'extraBuffer','extraBufferQuantity'),next,win.BBPantryPolicy,market());
    if((quantity.value.trim()!==''&&fromOwned===null)||(buffer.value.trim()!==''&&fromBuffer===null)){units.value=view.unit;notice(view,'Set the container contents first, or clear the amount before choosing a different unit.',true);return;}
    view.unit=next;if(fromOwned!==null)setAmount(quantity,fromOwned);if(fromBuffer!==null)setAmount(buffer,fromBuffer);edited('unit');
   });
   if(row.staple||!trackingLabel.hidden||anchor==='manual'){
    const label=el('label','bbpi-status-label','Stock status'),status=el('select');status.setAttribute('aria-label','Stock status for '+row.name);for(const[value,labelText]of[['in','In Stock'],['low','Low'],['out','Out']]){const option=el('option','',labelText);option.value=value;option.selected=value===(row.stapleStatus||'in');status.append(option);}label.hidden=!row.staple;label.append(status);content.prepend(label);view.status=status;view.statusLabel=label;
    status.addEventListener('change',()=>{if(status.value==='out')setAmount(quantity,0);else if(!(Number(amountValue(quantity))>0))setAmount(quantity,1);edited('quantity');});
   }
   if(!row.staple||!trackingLabel.hidden||anchor==='manual'){
    const details=el('details','bbpi-pack'),summary=el('summary','','Container size (optional)'),help=el('p','','Use the size on the label for one jar, bottle, pack or tin.'),fields=el('div','bbpi-pack-fields'),packTag=el('label','','One container contains'),packQuantity=el('input');view.packDetails=details;packQuantity.type='number';packQuantity.inputMode='decimal';packQuantity.min='0.000001';packQuantity.max='1000000';packQuantity.step='any';setAmount(packQuantity,row.packReviewed?row.packQuantity??'':'');packQuantity.setAttribute('aria-label','Container size for '+(row.name||'food'));packTag.append(packQuantity);
    const packUnitTag=el('label','','Contents unit'),packUnit=el('select');packUnit.setAttribute('aria-label','Container contents unit');unitOptions(packUnit,['','g','ml','each','oz','lb','fl oz'],row.packUnit||'');if(!row.packUnit){const blank=el('option','','Choose unit');blank.value='';blank.selected=true;packUnit.prepend(blank);}packUnitTag.append(packUnit);fields.append(packTag,packUnitTag);details.append(summary,help,fields);content.append(details);view.packQuantity=packQuantity;view.packUnit=packUnit;packQuantity.addEventListener('input',()=>{exactAmounts.delete(packQuantity);edited('pack');});packUnit.addEventListener('change',()=>edited('pack'));
   }
   if(Array.isArray(row.scanProductLots)&&row.scanProductLots.length){
    const details=el('details','bbpi-scan-products'),summary=el('summary','','Scanned product details ('+row.scanProductLots.length+')'),list=el('ul');details.append(summary);
    for(const lot of row.scanProductLots.slice(0,20)){
     const item=el('li'),name=el('strong','',String(lot.productName||lot.brand||'Scanned product')),known=typeof lot.checkedQuantity==='number'&&Number.isFinite(lot.checkedQuantity),amount=known?lot.checkedQuantity+' '+String(lot.unit||''):'Amount to confirm';
     item.append(name,el('span','',amount+(lot.quantityBasis?' · '+(lot.quantityBasis==='drained'?'drained weight':'net weight'):'')+(lot.packQuantity>0?' · '+lot.packQuantity+' '+String(lot.packUnit||'')+' per container':'')));list.append(item);
    }
    details.append(list,el('p','','These are the last reviewed scan details. At home shows the total currently available.'));
    if(row.scanNeedsReview)details.append(el('p','bbpi-scan-review',row.scanReviewMessage||'Review product amounts before combining them.'));
    content.append(details);
   }
   view.group=groupField(row);if(view.group)content.append(view.group.label);
   function configureTracking(reset=false){
    let model=draftRow(view);
    trackingLabel.hidden=!win.BBPantryPolicy?.isStaple(model.name)||win.BBPantryPolicy?.isWholePepper?.(model.name,model.unit,view.row)&&view.row.trackingMode!=='measured'&&view.row.staple!==true;
    const measuredUnits=(api.units?.()||['g','kg','ml','l']).filter(value=>['g','kg','ml','l','oz','lb','fl oz','cup','pint','tsp','tbsp'].includes(value));
    if(reset){
     const next=model.staple?'each':/\b(?:oil|vinegar|soy sauce|fish sauce)\b/i.test(model.name)?'ml':'g';
     setAmount(quantity,'');setAmount(buffer,0);view.unit=next;
     unitOptions(units,model.staple?['each']:measuredUnits,next,{...model,unit:next});model=draftRow(view);
     view.buyOptions=packChoices(model).map((option,index)=>({...option,value:'pack-'+index}));buySelect.replaceChildren(off);
     for(const option of view.buyOptions){const suffix=option.unit==='l'?(option.quantity===1?'litre':'litres'):model.staple?unitLabel({...model,qty:option.quantity},option.unit):option.unit,item=el('option','',number(option.quantity)+' '+suffix);item.value=option.value;buySelect.append(item);}buySelect.append(custom);buySelect.value='off';buyFields.hidden=true;setAmount(buyQuantity,'');unitOptions(buyUnit,purchaseUnits(model,win.BBPantryPolicy,market()),next,model);
     for(const field of ['tracking','quantity','unit','buffer','buy'])view.touched.add(field);
    }
    if(!reset&&!trackingLabel.hidden)unitOptions(units,model.staple?['each']:measuredUnits,view.unit,model);
    quantity.max=model.staple?'10000':'1000000';quantity.step='any';buffer.max=quantity.max;buffer.step=model.staple?'1':'any';buyQuantity.min=model.staple?'1':'0.000001';buyQuantity.step=model.staple?'1':'any';
    if(view.statusLabel)view.statusLabel.hidden=!model.staple;
    text(off,model.staple?'Whole containers':'Exact amount (no rounding)');
   }
   tracking.addEventListener('change',()=>{if(editor!==view||view.busy)return;configureTracking(true);edited('tracking');notice(view,'Enter the amount remaining and its unit. Your saved stock changes only when you confirm.');});
   const foods=name?knownFoods():[];
   const recognizeName=()=>{
    if(editor!==view||view.busy)return;
    const value=name.value.trim(),preview=previewFood(value,row.loc,foods);view.resolvedInput=preview?foodFold(value):null;
    if(!preview){text(title,value||'Add food');refreshPreview(view);return;}view.row={...preview};view.matchedKey=api.read(preview.key)?preview.key:null;text(title,preview.name||'Add food');
    if(!view.touched.has('tracking'))tracking.value=preview.trackingMode==='measured'&&preview.measurementReviewed===true?'measured':'containers';
    if(!view.touched.has('unit')&&!view.touched.has('quantity')){view.unit=preview.staple?'each':rowUnit(preview)||preview.unit;unitOptions(units,api.units?.()||[view.unit],view.unit,preview);}
    if(!view.touched.has('quantity'))setAmount(quantity,rowAmount(preview,view.unit));
    for(const input of [quantity,needed,buffer]){input.max=preview.staple?'10000':'1000000';input.step=preview.staple?'1':'any';}
    quantity.step='any';text(off,preview.staple?'Whole containers':'Exact amount (no rounding)');
    if(view.statusLabel){view.statusLabel.hidden=!preview.staple;if(preview.staple)view.status.value=quantity.value.trim()!==''&&Number(quantity.value)===0?'out':preview.stapleStatus||'in';}
    if(!view.touched.has('buffer')){const value=converted({...preview,qty:preview.extraBuffer??0},view.unit,win.BBPantryPolicy,market());setAmount(buffer,value);}
    if(!view.touched.has('buy')){
     view.buyOptions=packChoices(preview).map((option,index)=>({...option,value:'pack-'+index}));buySelect.replaceChildren(off);
     for(const option of view.buyOptions){const suffix=option.unit==='l'?(option.quantity===1?'litre':'litres'):preview.staple?unitLabel({...preview,qty:option.quantity},option.unit):option.unit,item=el('option','',number(option.quantity)+' '+suffix);item.value=option.value;buySelect.append(item);}buySelect.append(custom);
     unitOptions(buyUnit,purchaseUnits(preview,win.BBPantryPolicy,market()),preview.buyMultipleUnit||preview.unit,preview);setAmount(buyQuantity,Number(preview.buyMultiple)>0?preview.buyMultiple:'');buySelect.value=Number(preview.buyMultiple)>0?'custom':'off';buyFields.hidden=buySelect.value!=='custom';
    }
    if(!view.touched.has('pack')&&view.packQuantity){setAmount(view.packQuantity,preview.packReviewed?preview.packQuantity??'':'');view.packUnit.value=preview.packUnit||'';}
    if(view.group&&!view.groupDirty)try{view.group.select.value=win.BBPantryGroups.groupFor(row.loc,win.BBPantryGroups.itemKey(preview.name),preview.name);}catch{}configureTracking();notice(view,'');refreshPreview(view);
   };
   name?.addEventListener('input',recognizeName);name?.addEventListener('change',recognizeName);
   element.addEventListener('cancel',event=>{event.preventDefault();if(!view.busy)closeEditor();});element.addEventListener('close',()=>{if(editor===view&&!view.busy)closeEditor();});
   configureTracking();doc.body.append(element);lockEditor();fitEditor();try{element.showModal();}catch{element.setAttribute('open','');}fitEditor();close.focus({preventScroll:true});refreshPreview(view);return true;
  }
  function adjustSummary(key,direction){if(!valid(current))return teardown();const row=current.read(key);if(!row)return;const unit=rowUnit(row),patch=stepPatch(row,unit,direction,win.BBPantryPolicy,market());if(!patch)return;const result=safe(()=>current.update(key,patch));if(!result?.ok){openEditor(key,unit,'summary');if(editor)notice(editor,result?.message||'Review this amount.',true);}schedule();}
  async function freezeSummary(key,control){
   if(!valid(current)||!reducedAllowed())return;const api=current,row=api.read(key);if(!urgent(row)||typeof api.moveToFreezer!=='function')return;
   control.disabled=true;try{const result=await api.moveToFreezer(key);if(!result?.ok){const view=sections.get(row.loc);if(view)notice(view,result?.message||'Reopen At home to review this item.',true);}else{const view=sections.get(row.loc);if(view)notice(view,row.name+' moved to Freezer.');closeEditor();schedule();}}catch{const view=sections.get(row.loc);if(view)notice(view,'The item could not move safely. Your saved stock has been kept.',true);}finally{if(control.isConnected)control.disabled=false;}
  }
  function mountSection(area){
   const loc=area.dataset.bb76Store,body=area.querySelector('.bb76-store-body');if(!LOCATIONS.includes(loc)||!body)return;if(!area.id)area.id='bbpi-area-'+loc;
   let view=sections.get(loc);if(view?.body===body&&view.form.isConnected)return;
   view?.form.remove();view?.summary.remove();area.open=loc===openedLocation;
   const form=el('form','bbpi-manual bbpi-ui');form.setAttribute('aria-label','Add food to '+loc);const title=el('h4','','Add your own food'),nameTag=el('label','bbpi-manual-name','Item name'),name=el('input');name.type='text';name.maxLength=70;name.required=true;name.placeholder=loc==='freezer'?'e.g. Frozen fish':loc==='fridge'?'e.g. Strawberries':'e.g. Brown rice';name.setAttribute('aria-label','Food name for '+loc);nameTag.append(name);const amountTag=el('label','bbpi-manual-qty','Quantity'),quantity=el('input');quantity.type='number';quantity.inputMode='decimal';quantity.required=true;quantity.min='0';quantity.max='1000000';quantity.step='any';quantity.placeholder='Amount';quantity.setAttribute('aria-label','Quantity to add to '+loc);amountTag.append(quantity);const unitTag=el('label','bbpi-manual-unit','Unit'),unit=el('select');unit.setAttribute('aria-label','Unit to add to '+loc);unitOptions(unit,current.units?.()||['each','g','kg','ml','l','pack','bag','tin'],'each');unitTag.append(unit);const add=el('button','bbpi-manual-add','Add');add.type='submit';const noticeNode=el('p','bbpi-notice');noticeNode.setAttribute('aria-live','polite');form.append(title,nameTag,amountTag,unitTag,add,noticeNode);
   const summary=el('section','bbpi-summary bbpi-ui'),header=el('header'),heading=el('h4','','Food at home'),count=el('span','bbpi-count'),list=el('ul','bbpi-summary-list'),footer=el('footer','bbpi-summary-footer'),addFoodButton=btn('+ Add food',()=>addFood(loc),'bbpi-add-food'),closeAdd=btn('Done adding',()=>{delete body.dataset.bbpiAdding;closeEditor();},'bbpi-close-add');footer.append(addFoodButton,closeAdd);header.append(heading,count);header.hidden=!!body.closest('.bb76-store')?.querySelector(':scope>summary');summary.append(header,list,footer,noticeNode);view={loc,body,form,summary,count,list,notice:noticeNode,stamp:null};sections.set(loc,view);body.prepend(form);body.prepend(summary);
   form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();if(!valid(current))return teardown();const result=safe(()=>current.add({name:name.value,loc,qty:quantity.value,unit:unit.value}));if(!result?.ok){notice(view,result?.message||'Enter the item, quantity and unit.',true);return;}name.value='';quantity.value='';notice(view,'Food added. Shopping updates automatically.');schedule();name.focus({preventScroll:true});});
  }
  function summaries(rows){for(const view of sections.values()){
   const all=rows.filter(row=>row.loc===view.loc),visible=all.filter(inventoryMatches);
   const own=reducedAllowed()&&win.BBReducedStock?.sort?win.BBReducedStock.sort(visible,{actor:reducedActor()}):visible;
   let prices=()=>null;try{prices=win.BBKitchenPrices?.read?.()||prices;}catch{}
   const labels=new Map(own.map(row=>[row.key,win.BBKitchenPrices?.label?.(prices(row.name))||'']));
   const rowStamp=row=>JSON.stringify([market(),row.name,row.qty,row.unit,row.inputMarket,row.staple,row.stapleStatus,row.packReviewed,row.packQuantity,row.packUnit,row.readout,labels.get(row.key),urgent(row),row.scanNeedsReview===true]);
   const stamp=JSON.stringify([query,stockFilter,all.length,own.map(row=>[row.key,rowStamp(row)])]);
   if(stamp===view.stamp)continue;view.stamp=stamp;
   text(view.count,(own.length===all.length?all.length:own.length+' of '+all.length)+' item'+(all.length===1?'':'s'));
   // Keep the active card connected. Detaching a focused number input resets
   // its caret on iOS even when focus is restored to the same DOM node.
   const active=editor?.anchor==='summary'&&editor.loc===view.loc?[...view.list.children].find(node=>node.dataset.bbpiKey===editor.key):null;
   const activeIndex=active?[...view.list.children].indexOf(active):-1;
   const existing=new Map([...view.list.children].filter(node=>node.dataset.bbpiKey).map(node=>[node.dataset.bbpiKey,node]));
   const items=own.map(row=>{
    const item=existing.get(row.key)||el('li','bbpi-summary-row');
    const stamp=rowStamp(row);if(summaryStamps.get(item)===stamp)return item;summaryStamps.set(item,stamp);
    const main=el('div','bbpi-summary-main'),name=el('strong','',row.name),unit=rowUnit(row),value=rowAmount(row,unit);
    const amount=el('span','bbpi-summary-amount',row.staple?({in:'In Stock',low:'Low',out:'Out'}[row.stapleStatus]||'Review status')+(value!==''?' · '+value+' '+unitLabel(row,unit):''):summaryAmount(row,market(),win.BBPantryPolicy,win.BBPantryDisplay,{preferMeasured:true}));
    item.dataset.bbpiKey=row.key;item.classList.toggle('bbpi-reduced-row',urgent(row));main.append(name,amount);
    if(urgent(row))main.append(el('span','bbpi-use-soon','🏷️ Use soon (Reduced)'));
    if(labels.get(row.key))main.append(el('small','bb-kitchen-last-price',labels.get(row.key)));
    if(row.scanNeedsReview)main.append(el('small','bbpi-scan-review','Scanned product details need review.'));
    const controls=el('div','bbpi-summary-actions'),less=btn('−',event=>{event.stopPropagation();adjustSummary(row.key,-1);},'bbpi-step'),more=btn('+',event=>{event.stopPropagation();adjustSummary(row.key,1);},'bbpi-step'),edit=btn('Edit ›',event=>{event.stopPropagation();openEditor(row.key,unit,'summary');},'bbpi-edit');
    less.setAttribute('aria-label','Less '+row.name+' in '+view.loc);more.setAttribute('aria-label','More '+row.name+' in '+view.loc);edit.setAttribute('aria-label','Edit '+row.name+' in '+view.loc);controls.append(less,more);
    const titleLine=el('div','bbpi-summary-title');titleLine.append(name,edit);main.prepend(titleLine);
    // The explicit Edit button remains the keyboard action. A row tap uses its
    // existing handler; selection captures long-press release before this stage.
    item.onclick=event=>{if(event.defaultPrevented||item.closest('.bbps-active')||event.target?.closest?.('button,input,select,textarea,a,summary,label'))return;edit.click();};
    if(urgent(row)&&typeof current.moveToFreezer==='function'){const freeze=btn('❄️ Move to Freezer',()=>freezeSummary(row.key,freeze),'bbpi-freeze');freeze.setAttribute('aria-label','Move '+row.name+' to Freezer');main.append(freeze);}
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
   try{if(originalIntro)text(originalIntro.node,'Enter what you have and what you need, then confirm.');for(const area of current.card.querySelectorAll('[data-bb76-store]'))mountSection(area);summaries(current.list());displayEditor();mountToolbar();compactHeader();mountGlobalActions();current.card.classList.add('bbpi-enhanced');applyStorageView();if(pendingReveal){const loc=pendingReveal;pendingReveal=null;revealLocation(loc);}}
   catch{teardown(keep,stay);if(editor)notice(editor,'The pantry is refreshing. Your entries are kept in this panel.',true);}
  }
  function click(event){
   if(!valid(current))return;
   const summary=event.target.closest?.('[data-bb76-store]>summary');
   if(summary&&current.card.contains(summary)&&!event.target.closest?.('button,input,select,a')){
    event.preventDefault();const area=summary.parentElement,opening=!area.open;
    if(opening)jump(area.dataset.bb76Store);else{area.open=false;openedLocation=null;}
    return;
   }
   const group=event.target.closest?.('[data-bbpg-group]');if(group&&current.card.contains(group)){pendingReveal=location;schedule();}
   const tile=event.target.closest?.('[data-bb5-food]');if(!tile||!current.card.contains(tile))return;const loc=tile.closest('[data-bb76-store]')?.dataset.bb76Store;if(!LOCATIONS.includes(loc))return;event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
   const name=tile.dataset.bb5Food,policy=win.BBPantryPolicy,canonical=value=>policy?.canonicalName(value,win.BBPriceV19?.canonical)||value.toLowerCase(),row=current.list().find(row=>row.loc===loc&&canonical(row.name)===canonical(name));
   if(row)openEditor(row.key,preferredUnit(name,policy,rowUnit(row),{preferMeasured:true}));else{const preview=previewFood(name,loc);if(preview)openEditor(null,preferredUnit(name,policy,preview.unit,{preferMeasured:true}),'tile',preview);}
  }
  const reset=()=>{if(editor&&editor.actor===actor()&&editor.market===market()&&!win.BBAccountDeletion?.isDeleting?.()){schedule();return;}teardown();schedule();};
  const storageToggle=event=>{if(event.target?.matches?.('[data-bb76-store]')&&current?.card?.contains(event.target)){/* The legacy accordion closes siblings at its target. All owns only this presentation event. */if(openedLocation==='all'&&current.card.classList.contains('bbpi-enhanced'))event.stopPropagation();if(event.target.open!==(openedLocation==='all'||event.target.dataset.bb76Store===openedLocation))schedule();syncLocation();}};
  doc.addEventListener('click',click,true);doc.addEventListener('toggle',storageToggle,true);win.addEventListener('resize',measureToolbar);win.addEventListener('resize',scheduleFit);win.visualViewport?.addEventListener('resize',scheduleFit);win.visualViewport?.addEventListener('scroll',scheduleFit);win.addEventListener('bb:pantry-editor',schedule);win.addEventListener('basketboss:market-changed',schedule);win.addEventListener('basketboss:session-changed',reset);for(const event of['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener(event,reset);
  const storage=event=>{if(event.key==='basketboss_cloud_session_v1'||event.key===null)reset();};win.addEventListener('storage',storage);
  const keydown=event=>{if(event.key==='Escape'&&editor){event.preventDefault();if(!editor.busy)closeEditor();}};doc.addEventListener('keydown',keydown);
  if(win.MutationObserver){observer=new win.MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('.bbpi-ui')&&(record.target.id==='app'||record.target.matches?.('[data-bb76-tiles],#bb5SelectedRows')||record.target.closest?.('.bb76-kitchen-intro')||record.target.closest?.('.bbpg-controls')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.id==='bb173ShopFridge'||node.id==='bbKitchenFoodPanel'||node.classList?.contains('bb-pantry-camera-bar')||node.querySelector?.('#bb173ShopFridge,#bbKitchenFoodPanel'))))))schedule();});observer.observe(doc.body,{childList:true,subtree:true});}
  schedule();return {refresh:schedule,open(key,options={}){if(!valid(current))refresh();return openEditor(key,options.unit,'review',null,options)===true;},destroy(){destroyed=true;observer?.disconnect();teardown();doc.removeEventListener('click',click,true);doc.removeEventListener('keydown',keydown);doc.removeEventListener('toggle',storageToggle,true);win.removeEventListener('resize',measureToolbar);win.removeEventListener('resize',scheduleFit);win.visualViewport?.removeEventListener('resize',scheduleFit);win.visualViewport?.removeEventListener('scroll',scheduleFit);win.removeEventListener('bb:pantry-editor',schedule);win.removeEventListener('basketboss:market-changed',schedule);win.removeEventListener('basketboss:session-changed',reset);for(const event of['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.removeEventListener(event,reset);win.removeEventListener('storage',storage);}};
 }
 return {install,stepFor,stepped,preferredUnit,converted,displayUnit,summaryAmount,stepPatch,matchesInventory,purchaseUnits,purchasePresets,matchedFood,matchingFoods};
});
