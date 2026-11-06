/* Weekly stock review delegates all balances and buying intents to their
   existing owners. It never maintains another pantry or purchase ledger. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root&&!root.BBKitchenReview)root.BBKitchenReview=api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000;
 const amount=value=>value===null||value===undefined||String(value).trim()===''?null:Number(value);
 const token=row=>JSON.stringify([row.kind,row.key,row.name,row.qty??null,row.unit,row.staple===true,row.stapleStatus||'',row.targetQty??null,row.packQuantity??null,row.packUnit||'',row.packReviewed===true]);
 function createController(win){
  let busy=false,sequence=0;const intents=new Map();
  const manualFingerprint=rows=>JSON.stringify(rows.map(row=>[row.id,row.quantity,row.unit,row.sourceQuantity,row.sourceUnit,row.pending!==false]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  const host=()=>win.BBHomeHost,home=()=>win.BBHome;
  function identity(){return {actor:home()?.actor?.()||'guest',session:win.localStorage.getItem('basketboss_cloud_session_v1')};}
  function blocked(){return win.BBAccountDeletion?.isDeleting?.()===true||home()?.blocked?.()===true;}
  function canonical(name){try{return win.BBPantryPolicy?.canonicalName(name,win.BBPriceV19?.canonical)||String(name).trim().toLowerCase();}catch{return String(name).trim().toLowerCase();}}
  function snapshot(){
   const context=identity(),editor=win.BBPantryEditor,foodReady=!!editor?.isCurrent?.();
   const foods=foodReady?(editor.list?.()||[]).filter(row=>row&&row.key&&row.name).map(row=>({...row,kind:'food',context})):[];
   // Unknown legacy ledger units may be deliberately absent from the editable
   // picker. Keep them visible for review without inventing an editable amount.
   let stockIssue=false;
   if(foodReady)try{for(const [key,quantity]of Object.entries(host()?.stock?.()||{})){
    if(quantity===0)continue;const at=key.lastIndexOf('|');if(at<1){stockIssue=true;continue;}
    const name=key.slice(0,at),unit=key.slice(at+1);
    if(foods.some(row=>row.bb173StockKey===key||host()?.id?.(row.name,row.unit)===key||canonical(row.name)===canonical(name)&&row.unit===unit))continue;
    foods.push({key:'review-ledger:'+key,name,unit,qty:quantity,kind:'food',loc:'Needs unit review',readOnly:true,context});stockIssue=true;
   }}catch{stockIssue=true;}
   const households=(host()?.household?.()||[]).filter(row=>row?.id&&row.name&&(row.selected||Number(row.ownedQty)>0||row.owned===true||Number(row.targetQty)>0)).map(row=>({...row,kind:'household',key:row.id,qty:row.ownedQty??(row.owned?row.qty:0),context}));
   const rows=[...foods,...households].map(row=>({...row,token:token(row)}));
   return {context,foodReady,rows,stockIssue,blocked:blocked()};
  }
  function current(row){
   const context=identity();if(!row?.context||context.actor!==row.context.actor||context.session!==row.context.session)throw Error('Your account changed. Close and reopen the weekly kitchen check.');
   if(blocked())throw Error('Finish the pending account or receipt review before changing stock.');
   const fresh=snapshot().rows.find(value=>value.kind===row.kind&&value.key===row.key);
   if(!fresh||fresh.token!==row.token)throw Error('This stock changed. Refresh the amounts before updating it.');
   return fresh;
  }
  function shopping(row){
   const key=canonical(row.name),same=name=>canonical(name)===key;
   let automatic=[];
   if(row.kind==='food')automatic=(host()?.requirements?.()||[]).filter(item=>same(item.key||item.name)&&Number(item.toBuy)>0).map(item=>({quantity:Number(item.toBuy),unit:item.unit}));
   else{const item=(host()?.household?.()||[]).find(item=>item.id===row.key),owned=Number(item?.ownedQty??(item?.owned?item?.qty:0)),needed=Number(item?.targetQty??item?.qty);if(item&&item.manualPending!==false&&Number.isFinite(needed)&&Number.isFinite(owned)&&needed>owned)automatic=[{quantity:needed-owned,unit:item.unit}];}
   const manual=(home()?.shoppingBuys?.()||[]).filter(item=>item.kind===row.kind&&same(item.displayName||item.name)&&Number(item.quantity)>0);
   return {automatic,manual,onList:automatic.length>0||manual.length>0};
  }
  async function remaining(row,raw,status,inputUnit=row.unit){
   if(busy)return {ok:false,message:'Wait for the current update to finish.'};busy=true;
   try{
    current(row);if(row.readOnly)throw Error('Review this saved unit in At home before changing its amount. Existing stock has been kept.');const quantity=amount(raw);
    if((quantity===null&&!row.staple)||quantity!==null&&!finite(quantity))throw Error('Enter the amount left, or use 0 for none.');
    if(row.kind==='food'){
     const editor=win.BBPantryEditor,live=win.BBPantryLive;
     if(typeof editor?.update!=='function'||typeof editor?.flush!=='function'||typeof live?.hasPending!=='function')throw Error('Pantry editing is still loading. Close and reopen this check.');
     const patch={...(quantity!==null?{qty:quantity}:{}),...(inputUnit!==row.unit?{unit:inputUnit}:{}),...(row.staple&&status?{stapleStatus:status}:{})};
     const result=editor.update(row.key,patch);if(!result?.ok)throw Error(result?.message||'Check this pantry amount.');
     await editor.flush();
     const latest=identity();if(latest.actor!==row.context.actor||latest.session!==row.context.session)throw Error('Your account changed. Reopen this check.');
     if(live.hasPending())throw Error(editor.status?.()||'This amount still needs review. Your saved stock has been kept.');
     return {ok:true,message:editor.status?.()||'Amount saved. Shopping uses what is left.'};
    }
    const pin=host()?.householdAmountContext?.();
    const result=await home()?.setHouseholdBalance?.(row.key,quantity,pin);
    if(!result?.ok)throw Error(result?.message||'Household editing is still loading. Reopen this check.');
    return result;
   }catch(error){return {ok:false,message:error?.message||'Could not update this amount. Your saved stock has been kept.'};}
   finally{busy=false;}
  }
  async function restock(row,quantityText,{extra=false}={}){
   if(busy)return {ok:false,message:'Wait for the current update to finish.'};busy=true;
   try{
    current(row);const existing=shopping(row);
    if(existing.onList&&!extra)return {ok:true,already:true,message:'This item is already on Shop. Its existing quantity has been kept.'};
    const value=String(quantityText??'').trim();if(!value)throw Error('Enter the quantity to buy.');
    const id=row.context.actor+':'+row.kind+':'+row.key,previous=intents.get(id),fingerprint=manualFingerprint(existing.manual);
    const reuse=previous?.quantityText===value&&(!previous.saved||existing.manual.length>0&&previous.fingerprint===fingerprint);
    const intent=reuse?previous:{name:row.name,quantityText:value,actorId:row.context.actor,requestId:win.crypto?.randomUUID?.()||'weekly-kitchen-'+Date.now()+'-'+(++sequence),saved:false};
    intents.set(id,intent);
    const result=await home()?.addShoppingBuy?.({name:intent.name,quantityText:intent.quantityText,actorId:intent.actorId,requestId:intent.requestId});if(!result?.ok)throw Error(result?.message||'Could not add this item to Shop.');intent.saved=true;intent.fingerprint=manualFingerprint(shopping(row).manual);return result;
   }catch(error){return {ok:false,message:error?.message||'Could not update Shop. Your pantry amount has been kept.'};}
   finally{busy=false;}
  }
  return Object.freeze({snapshot,shopping,remaining,restock,beginReview(){if(busy)return false;intents.clear();return true;},isBusy:()=>busy});
 }
 function install(win){
  const doc=win.document;if(!doc?.createElement)return {refresh(){},open(){},destroy(){}};
  const controller=createController(win);let card=null,dialog=null,state=null,queued=false,destroyed=false,observer;
  const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,action,cls='')=>{const n=make('button',cls,text);n.type='button';n.onclick=action;return n;};
  const actor=()=>{try{return win.BBHome?.actor?.()||'guest';}catch{return 'guest';}};
  function schedule(){if(queued||destroyed)return;queued=true;(win.requestAnimationFrame||win.setTimeout).call(win,()=>{queued=false;refresh();});}
  function refresh(){
   if(destroyed)return;const kitchen=doc.getElementById('bb173ShopFridge'),intro=kitchen?.querySelector('.bb76-kitchen-intro');
   if(!kitchen?.isConnected||!intro){card?.remove();card=null;return;}
   if(!card?.isConnected){card=make('section','bb-kitchen-review-card');card.id='bbKitchenWeeklyReview';const text=make('div'),heading=make('strong','','Weekly kitchen check'),copy=make('p','','Update what’s left, then choose what to restock.');text.append(heading,copy);const open=button('Review & restock →',openDialog,'bb-kitchen-review-open');open.id='bbKitchenReviewOpen';card.append(text,open);intro.after(card);}
   if(dialog&&!state?.busy&&!state?.child)paintRows();
  }
  function close(){if(!dialog)return;const previous=state;previous?.cleanup?.();if(dialog.contains(doc.activeElement))doc.activeElement.blur?.();dialog.remove();dialog=null;state=null;doc.body.style.overflow=previous?.overflow||'';doc.documentElement.classList.remove('bb-kitchen-check-open');doc.documentElement.style.removeProperty('--bb-kitchen-review-scroll-top');win.scrollTo?.({top:previous?.scrollY||0,left:previous?.scrollX||0,behavior:'instant'});win.BBKeyboardLayout?.releaseAfterDismissal?.();card?.querySelector('button')?.focus?.({preventScroll:true});}
  function format(row,quantity=amount(row.qty),unit=row.unit){
   if(quantity===null)return 'Amount unknown';if(!finite(quantity))return 'Amount needs review';
   if(arguments.length===1&&row.kind==='food'&&!row.staple&&win.BBPantryInline?.summaryAmount)try{return win.BBPantryInline.summaryAmount(row,win.bb307ActiveMarket?.()||'UK',win.BBPantryPolicy,win.BBPantryDisplay);}catch{}
   if(row.staple)return ({in:'In stock',low:'Low',out:'Out'}[row.stapleStatus]||'Review status')+(quantity>0?' · '+quantity+' container'+(quantity===1?'':'s'):'');
   try{if(['g','ml'].includes(unit)&&win.BBPantryDisplay?.format)return win.BBPantryDisplay.format(row.name,quantity,unit,win.bb307ActiveMarket?.()||'UK');}catch{}
   return new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(quantity)+' '+(unit||'each');
  }
  function freeze(value){if(!dialog)return;state.busy=value;dialog.setAttribute('aria-busy',String(value));if(value){state.lockedControls=[...dialog.querySelectorAll('button,input,select')].map(node=>({node,disabled:node.disabled}));state.lockedControls.forEach(({node})=>node.disabled=true);}else{for(const {node,disabled}of state.lockedControls||[])if(node.isConnected)node.disabled=disabled;state.lockedControls=null;}}
  function message(value,error=false){if(!dialog)return;state.status.textContent=value;state.status.setAttribute('role',error?'alert':'status');}
  function field(label,input){const tag=make('label','',label);tag.append(input);return tag;}
  function paintRows(){
   if(!dialog||state.busy||state.child)return;
   let snapshot;try{snapshot=controller.snapshot();}catch{message('Your saved stock could not be read. Close and reopen this check.',true);return;}
   if(snapshot.context.actor!==state.actor){close();return;}
   if(!snapshot.foodReady&&state.list.querySelector('[data-review-item^="food:"]'))return;
   let prices=()=>null;try{prices=win.BBKitchenPrices?.read?.()||prices;}catch{}
   const query=state.search.value.trim().toLowerCase(),rows=snapshot.rows.filter(row=>(state.section==='all'||state.section===row.kind)&&(!query||row.name.toLowerCase().includes(query)));
   const top=state.body.scrollTop;state.list.replaceChildren();state.count.textContent=rows.length+' item'+(rows.length===1?'':'s');
   for(const row of rows){
    const item=make('section','bb-kitchen-review-item');item.dataset.reviewItem=row.kind+':'+row.key;
    const open=button('',()=>editItem(row),'bb-kitchen-review-item-open');open.setAttribute('aria-label','Edit '+row.name+' in weekly kitchen check');open.disabled=row.readOnly===true;
    open.append(make('strong','',row.name),make('span','bb-kitchen-review-balance',format(row)),make('small','',row.kind==='food'?(row.loc||'Food'):'Weekly essentials'));item.append(open);
    const paid=win.BBKitchenPrices?.label?.(prices(row.name));if(paid)item.append(make('p','bb-kitchen-last-price',paid));
    if(!row.readOnly){
     let unit=row.unit,qty=amount(row.qty);
     if(row.kind==='food'&&!row.staple&&win.BBPantryInline?.displayUnit)try{unit=win.BBPantryInline.displayUnit(row,win.bb307ActiveMarket?.()||'UK',win.BBPantryPolicy);qty=win.BBPantryInline.converted(row,unit,win.BBPantryPolicy,win.bb307ActiveMarket?.()||'UK');}catch{}
     const controls=make('div','bb-kitchen-review-quick'),less=button('−',()=>step(-1),'bb-kitchen-review-step'),more=button('+',()=>step(1),'bb-kitchen-review-step'),out=button('Out',()=>save(0,row.staple?'out':undefined),'bb-kitchen-review-used');less.disabled=qty===null||qty===0;less.setAttribute('aria-label','Less '+row.name+' remaining');more.setAttribute('aria-label','More '+row.name+' remaining');out.setAttribute('aria-label',row.name+' is used up');controls.append(less,more,out);item.append(controls);
     function step(direction){const next=win.BBPantryInline?.stepped?.(qty,unit,direction);if(next!==null&&next!==undefined)void save(next,row.staple?(next===0?'out':row.stapleStatus==='low'?'low':'in'):undefined);}
     async function save(quantity,status){
      if(state?.busy||state?.child)return;const review=state;freeze(true);message('Updating '+row.name+'…');const result=await controller.remaining(row,String(quantity),status,unit);
      if(!dialog||state!==review)return;freeze(false);message(result.message,!result.ok);if(result.ok)paintRows();
     }
    }
    state.list.append(item);
   }
   if(!rows.length)state.list.append(make('p','bb-kitchen-review-empty',snapshot.foodReady?'No matching stock yet. Add foods or essentials in At home, then review them here.':'Your food amounts are still loading. Refresh this check in a moment.'));
   state.body.scrollTop=top;
  }
  function editItem(row){
   if(!dialog||state.busy||state.child||row.readOnly)return;
   const parent=dialog,review=state,top=review.body.scrollTop;
   const options={returnTo:parent,doneLabel:'Save & back to check',onClose:result=>{
    if(dialog!==parent||state!==review||actor()!==review.actor)return;
    review.child=false;paintRows();review.body.scrollTop=top;
    const fresh=[...review.list.querySelectorAll('[data-review-item]')].find(node=>node.dataset.reviewItem===row.kind+':'+row.key);
    (fresh?.querySelector('button')||parent.querySelector('.bb-kitchen-review-close'))?.focus({preventScroll:true});
    if(result?.saved)message(row.name+' saved. Shop is up to date.');
   }};
   review.child=true;let opened=false;
   if(row.kind==='food')opened=win.BBPantryInline?.open?.(row.key,options)===true;
   else opened=win.BBEssentialsConfirm?.open?.({id:row.key,...options})===true;
   if(!opened){review.child=false;message('The item editor is still loading. Close and reopen this check.',true);}
  }
  function goShop(){if(state?.busy)return;close();doc.querySelector('.shell nav.tabs [data-tab="shop-list"]')?.click();}
  function openDialog(){
   if(dialog||destroyed)return;let snapshot;try{snapshot=controller.snapshot();}catch{return;}
   if(doc.querySelector('dialog[open]'))return;
   controller.beginReview();
   const previousOverflow=doc.body.style.overflow;
   dialog=make('dialog','bb-kitchen-review-dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','bbKitchenReviewTitle');
   const header=make('header'),heading=make('h2','','Weekly kitchen check');heading.id='bbKitchenReviewTitle';const dismiss=button('Close',()=>{if(!state?.busy)close();},'bb-kitchen-review-close');header.append(heading,dismiss);
   const body=make('div','bb-kitchen-review-body'),intro=make('p','bb-kitchen-review-intro','Meals marked cooked are already deducted. Enter what’s left after snacks, cleaning and other use.');
   const toolbar=make('div','bb-kitchen-review-toolbar'),search=make('input');search.type='search';search.placeholder='Find an item';search.setAttribute('aria-label','Find stock to review');const section=make('select');section.setAttribute('aria-label','Stock section');for(const [value,label]of[['all','All stock'],['food','Food'],['household','Weekly essentials']]){const option=make('option','',label);option.value=value;section.append(option);}const refresh=button('Refresh amounts',()=>{controller.beginReview();paintRows();},'bb-kitchen-review-refresh');toolbar.append(search,section,refresh);
   const count=make('p','bb-kitchen-review-count'),list=make('div','bb-kitchen-review-list'),status=make('p','bb-kitchen-review-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');body.append(intro,toolbar,count,list);const footer=make('footer');footer.append(status,button('Continue to Shop →',goShop,'bb-kitchen-review-primary'));
   dialog.append(header,body,footer);state={actor:snapshot.context.actor,session:snapshot.context.session,body,search,section:'all',list,count,status,expanded:new Set(),busy:false,overflow:previousOverflow,scrollY:win.scrollY||0,scrollX:win.scrollX||0,child:false};dialog.id='bbKitchenReviewDialog';doc.body.append(dialog);doc.documentElement.style.setProperty('--bb-kitchen-review-scroll-top',-state.scrollY+'px');doc.documentElement.classList.add('bb-kitchen-check-open');doc.body.style.overflow='hidden';
   search.oninput=paintRows;section.onchange=()=>{state.section=section.value;paintRows();};dialog.addEventListener('cancel',event=>{event.preventDefault();if(!state?.busy)close();});dialog.addEventListener('close',close);
   const viewport=win.visualViewport;
   const fit=()=>{
    if(!dialog||!state||!Number.isFinite(viewport?.height))return;
    const keyboard=Math.abs(Number(viewport.scale||1)-1)<.05&&viewport.height+80<win.innerHeight;
    dialog.style.maxHeight=keyboard?Math.max(160,viewport.height-24)+'px':'';
    dialog.style.top=keyboard?Math.max(12,(viewport.offsetTop||0)+12)+'px':'';dialog.style.bottom=keyboard?'auto':'';dialog.style.margin=keyboard?'0 auto':'';
    const active=doc.activeElement;if(keyboard&&state.body.contains(active)){
     const bounds=state.body.getBoundingClientRect(),field=active.getBoundingClientRect();
     if(field.bottom>bounds.bottom-12)state.body.scrollTop+=field.bottom-bounds.bottom+12;
     else if(field.top<bounds.top+12)state.body.scrollTop+=field.top-bounds.top-12;
    }
   };
   viewport?.addEventListener?.('resize',fit);viewport?.addEventListener?.('scroll',fit);win.addEventListener?.('resize',fit);
   dialog.addEventListener('focusin',fit);state.cleanup=()=>{viewport?.removeEventListener?.('resize',fit);viewport?.removeEventListener?.('scroll',fit);win.removeEventListener?.('resize',fit);};
   try{dialog.showModal();}catch{dialog.setAttribute('open','');}paintRows();dismiss.focus?.({preventScroll:true});fit();
  }
  const changed=()=>{if(dialog&&(actor()!==state.actor||win.BBAccountDeletion?.isDeleting?.()))close();schedule();};
  for(const event of['bb:pantry-editor','basketboss:market-changed'])win.addEventListener?.(event,schedule);
  for(const event of['basketboss:session-changed','basketboss:account-deletion-started'])win.addEventListener?.(event,changed);
  if(win.MutationObserver){observer=new win.MutationObserver(schedule);observer.observe(doc.getElementById('app')||doc.documentElement,{childList:true,subtree:true});}
  schedule();return {open:openDialog,refresh:schedule,destroy(){destroyed=true;observer?.disconnect();close();card?.remove();for(const event of['bb:pantry-editor','basketboss:market-changed'])win.removeEventListener?.(event,schedule);for(const event of['basketboss:session-changed','basketboss:account-deletion-started'])win.removeEventListener?.(event,changed);}};
 }
 return Object.freeze({createController,install,token});
});
