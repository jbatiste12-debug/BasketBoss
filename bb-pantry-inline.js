/* At home presentation. Every quantity action uses the guarded pantry editor;
   this module owns no stock, receipts, meal requirements or account storage. */
(function(root,factory){const helpers=factory();if(typeof module==='object'&&module.exports)module.exports=helpers;if(root&&!root.BBPantryInline)root.BBPantryInline=helpers.install(root);})(typeof window==='undefined'?null:window,function(){
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
  if(row.unit===unit)return Number(row.qty);
  try{const options={market:row.inputMarket||market,packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit},from=policy?.normalize(row.name,Number(row.qty),row.unit,options),one=policy?.normalize(row.name,1,unit,options);if(from&&one&&from.unit===one.unit&&one.quantity>0)return ROUND(from.quantity/one.quantity);}catch{}
  return null;
 }
 function install(win){
  const doc=win.document;if(!doc?.addEventListener)return {refresh(){},destroy(){}};
  let current=null,editor=null,queued=false,destroyed=false,observer,originalIntro=null,originalStatus=null;
  const sections=new Map();
  const el=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
  const market=()=>win.bb307ActiveMarket?.()||'UK';
  const valid=api=>!!api&&api.card?.isConnected&&typeof api.isCurrent==='function'&&api.isCurrent();
  function btn(label,action,className){const node=el('button',className,label);node.type='button';node.addEventListener('click',action);return node;}
  function schedule(){if(queued||destroyed)return;queued=true;(win.requestAnimationFrame||win.setTimeout).call(win,refresh);}
  function safe(action){try{return action();}catch{return null;}}
  function notice(view,value,error=false){text(view.notice,value||'');view.notice.classList.toggle('is-error',error);view.notice.setAttribute('role',error?'alert':'status');}
  function activeTile(){return current?.card?.querySelector('[data-bbpi-active="true"]');}
  function closeEditor(){if(!editor)return;editor.element.remove();const tile=activeTile();if(tile){delete tile.dataset.bbpiActive;tile.setAttribute('aria-expanded','false');tile.removeAttribute('aria-controls');}editor=null;}
  function teardown(){closeEditor();for(const view of sections.values()){view.form.remove();view.summary.remove();}sections.clear();current?.card?.classList.remove('bbpi-enhanced');if(originalIntro?.node?.isConnected)text(originalIntro.node,originalIntro.value);originalIntro=null;if(originalStatus){const{node,parent,next}=originalStatus;node.classList.remove('bbpi-save-status');if(parent.isConnected){if(next?.parentNode===parent)parent.insertBefore(node,next);else parent.append(node);}originalStatus=null;}current=null;}
  function rowUnit(row){return row.staple?'each':preferredUnit(row.name,win.BBPantryPolicy,row.unit);}
  function rowAmount(row,unit=rowUnit(row)){const value=converted(row,unit,win.BBPantryPolicy,market());return value===null?'':String(value);}
  function unitLabel(row,unit){if(row.staple)return (win.BBPantryPolicy?.containerLabel(row.name)||'container')+(Number(row.qty)===1?'':'s');return unit==='each'?'each':unit==='l'?'litres':unit;}
  function matches(row){try{return !win.BBPantryGroupsUI||win.BBPantryGroupsUI.matches(row.loc,win.BBPantryGroups?.itemKey(row.name)||row.name.toLowerCase(),row.name);}catch{return true;}}
  function unitOptions(select,values,selected,row){select.replaceChildren();for(const value of [...new Set(values.concat(selected))]){if(!value)continue;const option=el('option','',row?.staple?unitLabel(row,value):value==='l'?'litres':value);option.value=value;option.selected=value===selected;select.append(option);}}
  function tileFor(row){const tiles=[...current.card.querySelectorAll('[data-bb76-store="'+row.loc+'"] [data-bb5-food]')],exact=tiles.find(node=>node.dataset.bb5Food===row.name);if(exact)return exact;const policy=win.BBPantryPolicy,key=policy?.canonicalName(row.name,win.BBPriceV19?.canonical);return key?tiles.find(node=>policy.canonicalName(node.dataset.bb5Food,win.BBPriceV19?.canonical)===key)||null:null;}
  function anchorEditor(){if(!editor||!valid(editor.api))return;const row=editor.api.read(editor.key);if(!row){closeEditor();return;}
   const tile=tileFor(row);if(!tile)return;const previous=activeTile();if(previous&&previous!==tile){delete previous.dataset.bbpiActive;previous.setAttribute('aria-expanded','false');}
   tile.dataset.bbpiActive='true';tile.setAttribute('aria-expanded','true');tile.setAttribute('aria-controls','bbpi-current-editor');
   if(tile.nextElementSibling!==editor.element)tile.after(editor.element);if(editor.restoreTarget){const target=editor.restoreTarget;editor.restoreTarget=null;if(editor.element.contains(target))target.focus({preventScroll:true});}
  }
  function displayEditor(){if(!editor)return;if(!valid(editor.api)){teardown();return;}const row=editor.api.read(editor.key);if(!row||!matches(row)){closeEditor();return;}
   text(editor.title,row.name);text(editor.readout,row.readout||'Enter how much you already have.');
   if(!editor.rawDirty&&doc.activeElement!==editor.quantity)editor.quantity.value=rowAmount(row,editor.unit);
   if(editor.status&&doc.activeElement!==editor.status)editor.status.value=row.stapleStatus||'in';
   if(editor.packQuantity&&!editor.packDirty&&doc.activeElement!==editor.packQuantity)editor.packQuantity.value=row.packQuantity??'';
   if(editor.packUnit&&!editor.packDirty&&doc.activeElement!==editor.packUnit)editor.packUnit.value=row.packUnit||'';
   anchorEditor();
  }
  function quantityPatch(value){return editor.api.read(editor.key)?.unit===editor.unit?{qty:value}:{qty:value,unit:editor.unit};}
  function updateEditor(patch){if(!editor||!valid(editor.api))return teardown();const focused=editor.element.contains(doc.activeElement)?doc.activeElement:null;const result=safe(()=>editor.api.update(editor.key,patch));if(focused){editor.restoreTarget=focused;anchorEditor();}if(!result?.ok){editor.invalid=true;notice(editor,result?.message||'Review the amount before saving.',true);return false;}editor.invalid=false;notice(editor,'');return true;}
  function changeAmount(direction){if(!editor)return;const next=stepped(editor.quantity.value,editor.unit,direction);if(next===null)return notice(editor,'Enter a valid amount first.',true);editor.rawDirty=false;editor.quantity.value=String(next);updateEditor(quantityPatch(next));}
  function openEditor(key,preferred){
   if(!valid(current))return teardown();let row=current.read(key);if(!row)return;const api=current;let requested=row.staple?'each':preferred||rowUnit(row);if(requested!==row.unit){const converted=safe(()=>api.update(key,{unit:requested}));if(converted?.ok)row=api.read(key);else requested=row.unit;}
   if(editor?.key===key&&editor.api===api){anchorEditor();editor.quantity.focus({preventScroll:true});return;}
   closeEditor();const unit=requested,element=el('section','bbpi-editor bbpi-ui');element.id='bbpi-current-editor';element.setAttribute('aria-label','Edit '+row.name);
   const heading=el('header','bbpi-editor-heading'),title=el('h4','',row.name),caption=el('span','bbpi-eyebrow','Already at home');heading.append(caption,title);element.append(heading);
   const controls=el('div','bbpi-editor-controls'),quantityLabel=el('label','bbpi-quantity-label',row.staple?'Containers (optional)':'Quantity already at home'),stepper=el('div','bbpi-stepper'),quantity=el('input');quantity.type='number';quantity.inputMode=row.staple?'numeric':'decimal';quantity.min='0';quantity.max=row.staple?'10000':'1000000';quantity.step=row.staple?'1':'any';quantity.placeholder=row.staple?'Status only':'Enter amount';quantity.value=rowAmount(row,unit);quantity.setAttribute('aria-label','Amount of '+row.name+' at home');quantity.dataset.bbpiQuantity='';
   const less=btn('−',()=>changeAmount(-1),'bbpi-step'),more=btn('+',()=>changeAmount(1),'bbpi-step');less.setAttribute('aria-label','Less '+row.name);more.setAttribute('aria-label','More '+row.name);stepper.append(less,quantity,more);quantityLabel.append(stepper);controls.append(quantityLabel);
   const unitTag=el('label','bbpi-unit-label','Unit'),units=el('select');units.setAttribute('aria-label','Unit for '+row.name);unitOptions(units,row.staple?['each']:(api.units?.()||['each','g','kg','ml','l','pack','bag','tin']),unit,row);unitTag.append(units);controls.append(unitTag);element.append(controls);
   const readout=el('p','bbpi-readout',row.readout||''),noticeNode=el('p','bbpi-notice');noticeNode.setAttribute('aria-live','polite');element.append(readout,noticeNode);
   editor={api,key,loc:row.loc,element,title,quantity,units,unit,readout,notice:noticeNode,rawDirty:false};
   quantity.addEventListener('input',()=>{if(!editor||editor.element!==element)return;editor.rawDirty=true;updateEditor(quantityPatch(quantity.value));});
   quantity.addEventListener('blur',()=>{if(editor?.element===element&&!editor.invalid&&quantity.value.trim()!==''&&quantity.validity.valid&&Number.isFinite(Number(quantity.value))&&Number(quantity.value)>=0){editor.rawDirty=false;displayEditor();}});
   units.addEventListener('change',()=>{if(editor?.element!==element)return;const wanted=units.value,result=safe(()=>api.update(key,{unit:wanted}));if(!result?.ok){units.value=editor.unit;notice(editor,result?.message||'Review this unit first.',true);return;}editor.unit=wanted;editor.rawDirty=false;quantity.value=rowAmount(api.read(key),wanted);displayEditor();});
   if(row.staple){const label=el('label','bbpi-status-label','Stock status'),status=el('select');status.setAttribute('aria-label','Stock status for '+row.name);for(const[value,labelText]of[['in','In Stock'],['low','Low'],['out','Out']]){const option=el('option','',labelText);option.value=value;option.selected=value===(row.stapleStatus||'in');status.append(option);}label.append(status);controls.before(label);editor.status=status;status.addEventListener('change',()=>{if(editor?.element!==element)return;editor.rawDirty=false;updateEditor({stapleStatus:status.value});displayEditor();});}
   else{const details=el('details','bbpi-pack'),summary=el('summary','','Set container contents'),help=el('p','','For bags, packs or tins, use the size on the label. Unknown sizes stay saved for review.'),fields=el('div','bbpi-pack-fields'),packTag=el('label','','One container contains'),packQuantity=el('input');packQuantity.type='number';packQuantity.inputMode='decimal';packQuantity.min='0.000001';packQuantity.max='1000000';packQuantity.step='any';packQuantity.value=row.packReviewed?row.packQuantity??'':'';packQuantity.setAttribute('aria-label','Container size for '+row.name);packTag.append(packQuantity);const packUnitTag=el('label','','Contents unit'),packUnit=el('select');packUnit.setAttribute('aria-label','Container contents unit for '+row.name);unitOptions(packUnit,['g','ml','each','oz','lb','fl oz'],row.packUnit||'');if(!row.packUnit){const blank=el('option','','Choose unit');blank.value='';blank.selected=true;packUnit.prepend(blank);}packUnitTag.append(packUnit);fields.append(packTag,packUnitTag);details.append(summary,help,fields);element.append(details);editor.packQuantity=packQuantity;editor.packUnit=packUnit;
    const contents=()=>{if(editor?.element!==element)return;editor.packDirty=true;if(packQuantity.value.trim()===''||!packQuantity.validity.valid||!Number.isFinite(Number(packQuantity.value))||Number(packQuantity.value)<=0||!packUnit.value){editor.invalid=true;notice(editor,'Enter the container size and its unit. Your previous stock has been kept.',true);return;}if(updateEditor({packQuantity:packQuantity.value,packUnit:packUnit.value}))editor.packDirty=false;};packQuantity.addEventListener('input',contents);packUnit.addEventListener('change',contents);
   }
   const group=win.BBPantryGroupsUI?.picker?.(row.loc,win.BBPantryGroups?.itemKey(row.name)||row.name.toLowerCase(),row.name,schedule);if(group)element.append(group);
   const actions=el('div','bbpi-editor-actions'),remove=btn('Remove item',()=>{if(editor?.element!==element||!valid(api))return teardown();const result=safe(()=>api.remove(key));if(result?.ok){closeEditor();void api.flush();schedule();}else notice(editor,result?.message||'Reopen At home to edit this item.',true);},'bbpi-remove'),done=btn('Done',async()=>{if(editor?.element!==element)return;if(editor.invalid||editor.packDirty||quantity.value.trim()===''&&editor.rawDirty||quantity.value.trim()!==''&&(!quantity.validity.valid||!Number.isFinite(Number(quantity.value)))){notice(editor,'Enter a valid amount before saving. Your previous stock has been kept.',true);quantity.focus();return;}done.disabled=true;try{await api.flush();if(editor?.element===element){closeEditor();schedule();}}catch{if(editor?.element===element)notice(editor,'Your amount needs review before saving. Please try again.',true);}finally{done.disabled=false;}},'bbpi-done');actions.append(remove,done);element.append(actions);anchorEditor();quantity.focus({preventScroll:true});quantity.select?.();
  }
  function adjustSummary(key,direction){if(!valid(current))return teardown();const row=current.read(key);if(!row)return;const unit=rowUnit(row),quantity=stepped(rowAmount(row,unit),unit,direction);if(quantity===null)return;const result=safe(()=>current.update(key,{qty:quantity,unit}));if(!result?.ok){openEditor(key,unit);if(editor)notice(editor,result?.message||'Review this amount.',true);}schedule();}
  function mountSection(area){
   const loc=area.dataset.bb76Store,body=area.querySelector('.bb76-store-body');if(!LOCATIONS.includes(loc)||!body)return;
   let view=sections.get(loc);if(view?.body===body&&view.form.isConnected)return;
   view?.form.remove();view?.summary.remove();
   const form=el('form','bbpi-manual bbpi-ui');form.setAttribute('aria-label','Add food to '+loc);const title=el('h4','','Add your own food'),nameTag=el('label','bbpi-manual-name','Item name'),name=el('input');name.type='text';name.maxLength=70;name.required=true;name.placeholder=loc==='freezer'?'e.g. Frozen fish':loc==='fridge'?'e.g. Strawberries':'e.g. Brown rice';name.setAttribute('aria-label','Food name for '+loc);nameTag.append(name);const amountTag=el('label','bbpi-manual-qty','Quantity'),quantity=el('input');quantity.type='number';quantity.inputMode='decimal';quantity.required=true;quantity.min='0';quantity.max='1000000';quantity.step='any';quantity.placeholder='Amount';quantity.setAttribute('aria-label','Quantity to add to '+loc);amountTag.append(quantity);const unitTag=el('label','bbpi-manual-unit','Unit'),unit=el('select');unit.setAttribute('aria-label','Unit to add to '+loc);unitOptions(unit,current.units?.()||['each','g','kg','ml','l','pack','bag','tin'],'each');unitTag.append(unit);const add=el('button','bbpi-manual-add','Add');add.type='submit';const noticeNode=el('p','bbpi-notice');noticeNode.setAttribute('aria-live','polite');form.append(title,nameTag,amountTag,unitTag,add,noticeNode);
   const summary=el('section','bbpi-summary bbpi-ui'),header=el('header'),heading=el('h4','','Food at home'),count=el('span','bbpi-count'),list=el('ul','bbpi-summary-list');header.append(heading,count);summary.append(header,list);view={loc,body,form,summary,count,list,notice:noticeNode,stamp:null};sections.set(loc,view);body.prepend(form);body.append(summary);
   form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();if(!valid(current))return teardown();const result=safe(()=>current.add({name:name.value,loc,qty:quantity.value,unit:unit.value}));if(!result?.ok){notice(view,result?.message||'Enter the item, quantity and unit.',true);return;}name.value='';quantity.value='';notice(view,'Food added. Shopping updates automatically.');schedule();openEditor(result.key,unit.value);});
  }
  function summaries(rows){for(const view of sections.values()){
   const all=rows.filter(row=>row.loc===view.loc),own=all.filter(matches),stamp=JSON.stringify([all.length,own.map(row=>[row.key,row.name,row.qty,row.unit,row.stapleStatus,row.readout])]);if(stamp===view.stamp)continue;view.stamp=stamp;text(view.count,(own.length===all.length?all.length:own.length+' of '+all.length)+' item'+(all.length===1?'':'s'));view.list.replaceChildren();
   if(!own.length){view.list.append(el('li','bbpi-empty','Choose food above or add an item.'));continue;}
   for(const row of own){const item=el('li','bbpi-summary-row'),main=el('div','bbpi-summary-main'),name=el('strong','',row.name),unit=rowUnit(row),value=rowAmount(row,unit),amount=el('span','bbpi-summary-amount',row.staple?({in:'In Stock',low:'Low',out:'Out'}[row.stapleStatus]||'Review status')+(value!==''?' · '+value+' '+unitLabel(row,unit):''):value===''?'Amount unknown':value+' '+unit);main.append(name,amount);const controls=el('div','bbpi-summary-actions'),less=btn('−',()=>adjustSummary(row.key,-1),'bbpi-step'),more=btn('+',()=>adjustSummary(row.key,1),'bbpi-step'),edit=btn('Edit',()=>openEditor(row.key,unit),'bbpi-edit');less.setAttribute('aria-label','Less '+row.name+' in '+view.loc);more.setAttribute('aria-label','More '+row.name+' in '+view.loc);edit.setAttribute('aria-label','Edit '+row.name+' in '+view.loc);controls.append(less,more,edit);item.append(main,controls);view.list.append(item);}
  }}
  function refresh(){queued=false;if(destroyed)return;const api=win.BBPantryEditor;if(!valid(api)){teardown();return;}
   if(current!==api){teardown();current=api;const node=current.card.querySelector('.bb76-title>div>p:last-child');if(node)originalIntro={node,value:node.textContent};const status=current.card.querySelector('#bb5StockStatus');if(status){originalStatus={node:status,parent:status.parentNode,next:status.nextSibling};status.classList.add('bbpi-save-status');current.card.querySelector('.bb76-kitchen-intro')?.after(status);}}
   try{if(originalIntro)text(originalIntro.node,'Tap a food to enter how much you have beside it, or add your own below. Shopping updates automatically.');for(const area of current.card.querySelectorAll('[data-bb76-store]'))mountSection(area);summaries(current.list());displayEditor();current.card.classList.add('bbpi-enhanced');}
   catch{teardown();}
  }
  function click(event){const tile=event.target.closest?.('[data-bb5-food]');if(!tile||!valid(current)||!current.card.contains(tile))return;const loc=tile.closest('[data-bb76-store]')?.dataset.bb76Store;if(!LOCATIONS.includes(loc))return;event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
   const preferred=preferredUnit(tile.dataset.bb5Food,win.BBPantryPolicy,undefined),key=safe(()=>current.select(tile.dataset.bb5Food,loc,preferred?{unit:preferred}:{}));if(key)openEditor(key,preferred);else teardown();
  }
  const reset=()=>{teardown();schedule();};
  doc.addEventListener('click',click,true);win.addEventListener('bb:pantry-editor',schedule);win.addEventListener('basketboss:session-changed',reset);for(const event of['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener(event,reset);
  const storage=event=>{if(event.key==='basketboss_cloud_session_v1'||event.key===null)reset();};win.addEventListener('storage',storage);
  const keydown=event=>{if(event.key==='Escape'&&editor){event.preventDefault();const api=editor.api;closeEditor();if(valid(api))void api.flush();schedule();}};doc.addEventListener('keydown',keydown);
  if(win.MutationObserver){observer=new win.MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('.bbpi-ui')&&(record.target.id==='app'||record.target.matches?.('[data-bb76-tiles],#bb5SelectedRows')||record.target.closest?.('.bb76-kitchen-intro')||record.target.closest?.('.bbpg-controls')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.id==='bb173ShopFridge'||node.querySelector?.('#bb173ShopFridge'))))))schedule();});observer.observe(doc.body,{childList:true,subtree:true});}
  schedule();return {refresh:schedule,destroy(){destroyed=true;observer?.disconnect();teardown();doc.removeEventListener('click',click,true);doc.removeEventListener('keydown',keydown);win.removeEventListener('bb:pantry-editor',schedule);win.removeEventListener('basketboss:session-changed',reset);for(const event of['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.removeEventListener(event,reset);win.removeEventListener('storage',storage);}};
 }
 return {install,stepFor,stepped,preferredUnit,converted};
});
