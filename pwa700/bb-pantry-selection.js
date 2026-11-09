/* Food-only multi-selection. Stock is changed only by the existing pantry save. */
(function(root,factory){'use strict';const core=factory();if(typeof module==='object'&&module.exports)module.exports=core;if(root?.document)root.BBPantrySelection=Object.freeze({...core,...core.install(root)});})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const LOCATIONS=new Set(['cupboard','fridge','freezer']),MAX=2000;
 const sameContext=(a,b)=>!!a&&!!b&&a.actor===b.actor&&a.market===b.market&&a.card===b.card;
 const rowProof=row=>JSON.stringify([row.key,row.name,row.loc,row.qty,row.unit,row.staple,row.stapleStatus,row.trackingMode,row.measurementReviewed,row.packQuantity,row.packUnit,row.packReviewed]);
 const foodRows=editor=>(editor?.list?.()||[]).filter(row=>row&&typeof row.key==='string'&&row.key.length>0&&row.key.length<=300&&typeof row.name==='string'&&LOCATIONS.has(row.loc));
 function createRemovalHost(adapter){
  let busy=false;
  const context=()=>adapter.context(),current=pin=>sameContext(pin,context())&&adapter.editor.isCurrent()===true;
  function ready(){try{return busy?'Wait for the current deletion to finish.':adapter.ready()||(!adapter.editor.isCurrent()?'Reopen At home to select the current foods.':'');}catch{return 'Reopen At home to select the current foods.';}}
  function preview(keys){
   const blocked=ready();if(blocked)return {ok:false,message:blocked};
   if(!Array.isArray(keys)||!keys.length||keys.length>MAX||new Set(keys).size!==keys.length)return {ok:false,message:'Select the foods you want to delete.'};
   const rows=new Map(foodRows(adapter.editor).map(row=>[row.key,row]));
   if(keys.some(key=>typeof key!=='string'||!rows.has(key)))return {ok:false,message:'Your pantry changed. Review the selected foods again.'};
   const selected=keys.map(key=>rows.get(key));
   return {ok:true,context:context(),keys:keys.slice(),rows:selected.map(row=>({key:row.key,name:row.name,loc:row.loc})),proof:selected.map(rowProof)};
  }
  async function remove(proposal){
   if(busy)return {ok:false,message:'Wait for the current deletion to finish.'};
   const latest=preview(proposal?.keys);
   if(!proposal?.ok||!latest.ok||!sameContext(proposal.context,latest.context)||JSON.stringify(proposal.proof)!==JSON.stringify(latest.proof))return {ok:false,message:latest.message||'Your pantry changed. Review the selected foods again.'};
   const pin=latest.context;let saved;
   try{saved=adapter.snapshot();}catch{return {ok:false,message:'Your pantry could not be checked. Nothing was deleted.'};}
   busy=true;
   try{
    for(const key of latest.keys){
     if(!current(pin))throw Error('context');
     if(adapter.editor.remove(key)?.ok!==true)throw Error('remove');
    }
    if(!current(pin))throw Error('context');
    await adapter.editor.flush();
    if(!sameContext(pin,context()))return {ok:false,stale:true,message:'Your account changed. Reopen At home.'};
    if(adapter.committed(latest.keys)!==true)throw Error('save');
    return {ok:true,removed:latest.keys.length,message:adapter.message()||'Selected foods deleted.'};
   }catch{
    if(!sameContext(pin,context()))return {ok:false,stale:true,message:'Your account changed. Reopen At home.'};
    // A later online-confirmation error must not resurrect already-saved food.
    if(adapter.committed(latest.keys)===true)return {ok:true,removed:latest.keys.length,message:adapter.message()||'Foods deleted on this device. Check online pantry confirmation.'};
    const restored=adapter.restore(saved)===true;
    return {ok:false,message:restored?'Could not save safely. Your foods are kept; try again.':'Your pantry changed elsewhere. Reopen At home before trying again.'};
   }finally{busy=false;}
  }
  return Object.freeze({editor:adapter.editor,context,ready,preview,remove,rows:()=>foodRows(adapter.editor),isBusy:()=>busy});
 }
 function install(win){
  const doc=win.document;let host=null,selected=new Set(),active=false,dialog=null,bar=null,toolbar=null,press=null,suppressed=null,queued=false,busy=false,historyMark=null,previousHistory=null,sequence=0;
  const make=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const button=(text,fn,className)=>{const node=make('button',className,text);node.type='button';node.addEventListener('click',fn);return node;};
  const valid=()=>!!host&&host.editor.isCurrent()===true&&host.context().card?.isConnected;
  const rowNode=target=>target?.closest?.('.bbpi-summary-row[data-bbpi-key]');
  function cancelPress(){if(press){win.clearTimeout(press.timer);press.node.classList.remove('bbps-pressing');press=null;}}
  function closeDialog(){if(!dialog)return;const old=dialog;dialog=null;try{old.close();}catch{}old.remove();}
  function leave({history=true}={}){
   cancelPress();active=false;selected.clear();if(!busy)closeDialog();
   if(history&&historyMark&&win.history?.state?.bbPantrySelection===historyMark){historyMark=null;win.history.back();}else historyMark=null;
   schedule();
  }
  function enter(key){
   if(!valid())return;const blocked=host.ready();if(blocked){status(blocked);return;}
   if(!active){active=true;previousHistory=win.history?.state;historyMark='bb-pantry-selection-'+(++sequence);try{win.history.pushState({...previousHistory,bbPantrySelection:historyMark},'',win.location.href);}catch{historyMark=null;}}
   if(key)selected.add(key);schedule();
  }
  function status(text){let node=doc.getElementById('bbPantrySelectionStatus');if(!node){node=make('p','bbps-status');node.id='bbPantrySelectionStatus';node.setAttribute('role','status');host?.context().card?.querySelector('#bbpiToolbar')?.after(node);}if(node)node.textContent=text;}
  function shown(){return [...doc.querySelectorAll('.bbpi-summary-row[data-bbpi-key]')].filter(node=>host?.context().card?.contains(node)&&node.getClientRects().length&&win.getComputedStyle(node).visibility!=='hidden').map(node=>node.dataset.bbpiKey);}
  function toggle(key){if(busy||!valid())return;const exists=host.rows().some(row=>row.key===key);if(!exists)return;if(selected.has(key))selected.delete(key);else selected.add(key);schedule();}
  function confirm(){
   if(!active||busy||dialog||!valid())return;const proposal=host.preview([...selected]);if(!proposal.ok){status(proposal.message);return;}
   const owner=host,element=make('dialog','bbps-confirm');dialog=element;element.setAttribute('aria-labelledby','bbPantrySelectionTitle');
   const title=make('h2','',`Delete ${proposal.keys.length} food${proposal.keys.length===1?'':'s'}?`);title.id='bbPantrySelectionTitle';
   const hint=make('p','','Removes these foods from At home. Your meals stay saved and shopping needs update.');
   const list=make('ul','bbps-confirm-list');for(const row of proposal.rows)list.append(make('li','',row.name+' · '+row.loc));
   const message=make('p','bbps-confirm-status');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
   const actions=make('div','bbps-confirm-actions'),cancel=button('Keep foods',()=>{closeDialog();schedule();}),remove=button('Delete '+proposal.keys.length+' food'+(proposal.keys.length===1?'':'s'),async()=>{
    if(busy||dialog!==element||host!==owner)return;busy=true;element.setAttribute('aria-busy','true');cancel.disabled=remove.disabled=true;message.textContent='Deleting selected foods…';schedule();
    let result;
    try{result=await owner.remove(proposal);}catch{result={ok:false,message:'Could not save safely. Review your pantry and try again.'};}finally{busy=false;}
    if(host!==owner||!active||!valid()){closeDialog();schedule();return;}
    if(result.ok){closeDialog();leave();status(result.message);}
    else{message.textContent=result.message;cancel.disabled=remove.disabled=false;element.removeAttribute('aria-busy');if(result.stale)leave();schedule();}
   },'bbps-delete');actions.append(cancel,remove);element.append(title,hint,list,message,actions);doc.body.append(element);
   element.addEventListener('cancel',event=>{if(busy)event.preventDefault();});element.addEventListener('close',()=>{if(dialog===element){dialog=null;element.remove();schedule();}});
   try{element.showModal();}catch{element.setAttribute('open','');}cancel.focus({preventScroll:true});
  }
  function render(){
   queued=false;
   if(!valid()||!host.context().card.getClientRects().length){active=false;selected.clear();if(!busy)closeDialog();bar?.remove();bar=null;toolbar?.remove();toolbar=null;return;}
   const card=host.context().card;
   const target=card.querySelector('#bbpiToolbar');if(target&&!target.querySelector('[data-bbps-start]')){const start=button('Select items',()=>enter(),'bbps-start');start.dataset.bbpsStart='';target.append(start);}
   card.classList.toggle('bbps-active',active);card.querySelectorAll('[data-bbps-start]').forEach(node=>{if(node.hidden!==active)node.hidden=active;});
   if(!active){for(const label of card.querySelectorAll('.bbps-check'))if(!label.hidden)label.hidden=true;for(const node of card.querySelectorAll('.bbps-selected'))node.classList.remove('bbps-selected');bar?.remove();bar=null;return;}
   const rows=new Map(host.rows().map(row=>[row.key,row]));for(const key of selected)if(!rows.has(key))selected.delete(key);
   for(const node of card.querySelectorAll('.bbpi-summary-row[data-bbpi-key]')){
    const row=rows.get(node.dataset.bbpiKey);if(!row)continue;let label=node.querySelector(':scope>.bbps-check');
    if(!label){label=make('label','bbps-check');const input=make('input');input.type='checkbox';input.dataset.bbpsKey=row.key;input.addEventListener('change',()=>{if(input.checked)selected.add(input.dataset.bbpsKey);else selected.delete(input.dataset.bbpsKey);schedule();});label.append(input);node.prepend(label);}
    if(label.hidden)label.hidden=false;const input=label.firstElementChild;input.checked=selected.has(row.key);input.disabled=busy;input.setAttribute('aria-label','Select '+row.name+' in '+row.loc);node.classList.toggle('bbps-selected',selected.has(row.key));
   }
   if(!bar){bar=make('section','bbps-bar');bar.setAttribute('aria-label','Selected pantry foods');const count=make('strong','bbps-count');count.setAttribute('role','status');count.setAttribute('aria-live','polite');
    bar.append(count,button('Select all shown',()=>{for(const key of shown())selected.add(key);schedule();},'bbps-all'),button('Cancel',()=>{leave();},'bbps-cancel'),button('Delete',confirm,'bbps-delete'));doc.body.append(bar);}
   const countText=selected.size+' selected',count=bar.querySelector('.bbps-count');if(count.textContent!==countText)count.textContent=countText;for(const node of bar.querySelectorAll('button'))node.disabled=busy;bar.querySelector('.bbps-delete').disabled=busy||!selected.size;
  }
  function schedule(){if(queued)return;queued=true;(win.requestAnimationFrame||win.setTimeout).call(win,render);}
  function click(event){const node=rowNode(event.target);if(!node||!valid()||!host.context().card.contains(node))return;
   if(suppressed&&suppressed.key===node.dataset.bbpiKey&&Date.now()<suppressed.until){suppressed=null;event.preventDefault();event.stopImmediatePropagation();return;}
   if(!active||event.target.closest('.bbps-check'))return;event.preventDefault();event.stopImmediatePropagation();toggle(node.dataset.bbpiKey);
  }
  function pointerDown(event){if(active||busy||!valid()||event.button>0||event.target.closest?.('button,input,select,a,summary,label'))return;const node=rowNode(event.target);if(!node||!host.context().card.contains(node))return;cancelPress();const pin=host;
   const candidate={id:event.pointerId,key:node.dataset.bbpiKey,node,x:event.clientX,y:event.clientY,timer:null};press=candidate;node.classList.add('bbps-pressing');candidate.timer=win.setTimeout(()=>{if(press!==candidate||host!==pin||!valid())return cancelPress();press=null;node.classList.remove('bbps-pressing');enter(candidate.key);suppressed={key:candidate.key,until:Date.now()+900};},450);
  }
  doc.addEventListener('pointerdown',pointerDown,true);doc.addEventListener('pointermove',event=>{if(press&&(event.pointerId!==press.id||Math.hypot(event.clientX-press.x,event.clientY-press.y)>10))cancelPress();},true);
  for(const name of ['pointerup','pointercancel','scroll'])doc.addEventListener(name,cancelPress,true);
  doc.addEventListener('contextmenu',event=>{if(rowNode(event.target)&&(press||active))event.preventDefault();},true);doc.addEventListener('click',click,true);
  doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&active&&!dialog&&!busy){event.preventDefault();leave();}});
  const reset=()=>{if(host&&!sameContext(host.context(),boundContext)){closeDialog();active=false;selected.clear();cancelPress();}schedule();};let boundContext=null;
  for(const name of ['basketboss:session-changed','basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener(name,()=>{leave();schedule();});
  win.addEventListener('storage',event=>{if(event.key==='basketboss_cloud_session_v1'||event.key===null){leave();schedule();}});win.addEventListener('popstate',()=>{if(active&&!busy)leave({history:false});});win.addEventListener('bb:pantry-editor',schedule);
  const own=node=>node.nodeType===1&&node.matches?.('.bbps-check,.bbps-start,.bbps-bar,.bbps-confirm,.bbps-status');
  const observer=new win.MutationObserver(records=>{const card=host?.context().card;if(!card)return;if(!card.isConnected){schedule();return;}if(records.some(record=>card.contains(record.target)&&!record.target.closest?.('.bbps-check')&&[...record.addedNodes,...record.removedNodes].some(node=>!own(node))))schedule();});observer.observe(doc.body||doc.documentElement,{childList:true,subtree:true});
  return {bind(adapter){const next=createRemovalHost(adapter);if(!host||!sameContext(boundContext,next.context())){leave();host=next;boundContext=next.context();}else host=next;reset();},refresh:schedule};
 }
 return Object.freeze({createRemovalHost,install});
});
