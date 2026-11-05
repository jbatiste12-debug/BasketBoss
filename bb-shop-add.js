/* A direct shopping intent: Item + Quantity to buy. No pantry or purchase writes. */
(function(root){'use strict';
 let sequence=0;
 function mount({container,win=root,onSaved=()=>{}}){
  const doc=container.ownerDocument||win.document;let disposed=false,active=null;
  const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const wrap=make('div','bb-shop-add'),open=make('button','btn bb-shop-add-open','Add item to buy'),notice=make('p','bb-shop-add-notice');
  open.type='button';notice.setAttribute('role','status');wrap.append(open,notice);container.append(wrap);
  const actor=()=>{try{return win.BBHome?.actor?.()||null;}catch{return null;}};
  const identity=()=>{try{if(win.crypto?.randomUUID)return win.crypto.randomUUID();}catch{}return 'manual-buy-'+Date.now()+'-'+(++sequence);};
  function close(state){
   if(!state||state.closed)return;state.closed=true;state.cleanup?.();if(state.dialog.contains(doc.activeElement))doc.activeElement.blur?.();state.dialog.close?.();state.dialog.remove();doc.body.style.overflow=state.overflow;
   if(active===state)active=null;win.BBKeyboardLayout?.releaseAfterDismissal?.();if(!disposed&&open.isConnected)open.focus?.({preventScroll:true});
  }
  function openDialog(){
   if(disposed||active)return;const home=win.BBHome,who=actor();
   if(!who||typeof home?.addShoppingBuy!=='function'){notice.textContent='Shopping entry is still loading. Reopen it in a moment.';return;}
   if(win.BBAccountDeletion?.isDeleting?.()){notice.textContent='Finish account deletion before changing your shopping list.';return;}
   if(doc.querySelector?.('dialog[open]')){notice.textContent='Finish or close the current form before adding an item.';return;}
   notice.textContent='';
   const dialog=make('dialog','bb-shop-add-dialog'),title=make('h2','','Add item to buy');title.id='bbShopAddTitle'+(++sequence);dialog.setAttribute('aria-labelledby',title.id);dialog.setAttribute('aria-modal','true');
   const form=make('form','bb-shop-add-form'),intro=make('p','bb-shop-add-intro','Add an item and the amount you want to buy.');
   const field=(text,control)=>{const label=make('label','bb-shop-add-field',text);label.append(control);form.append(label);return control;};
   const name=make('input');name.type='text';name.name='name';name.required=true;name.maxLength=70;name.autocomplete='off';name.placeholder='e.g. milk or bin bags';field('Item',name);
   const quantity=make('input');quantity.type='text';quantity.name='quantityText';quantity.required=true;quantity.maxLength=60;quantity.autocomplete='off';quantity.value='1';quantity.placeholder='e.g. 2, 2 packs or 500 g';field('Quantity to buy',quantity);
   let reduced=null,reducedPrice=null;
   if(win.BBReducedFoodHost?.isPremium?.()===true){
    const choice=make('label','bb-shop-add-reduced-toggle'),toggle=make('input');toggle.type='checkbox';toggle.name='boughtReduced';choice.append(toggle,make('span','','🏷️ Bought reduced'));
    const paid=make('label','bb-shop-add-field bb-shop-add-reduced-price','Total yellow-sticker price paid'),price=make('input');price.type='number';price.name='reducedPrice';price.min='0.01';price.max='100000';price.step='0.01';price.inputMode='decimal';price.placeholder='e.g. 1.25';paid.hidden=true;paid.append(price);form.append(choice,paid);reduced=toggle;reducedPrice=price;
    toggle.addEventListener('change',()=>{paid.hidden=!toggle.checked;price.required=toggle.checked;save.textContent=toggle.checked?'Record reduced purchase':'Add item';update();});
   }
   const hint=make('p','bb-shop-add-hint','Enter 500 g, 2 packs, or known contents such as 1 bag (500 g).');
   const status=make('p','bb-shop-add-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
   const actions=make('div','bb-shop-add-actions'),cancel=make('button','btn','Cancel'),save=make('button','btn primary','Add item');cancel.type='button';save.type='submit';save.disabled=true;actions.append(cancel,save);
   form.append(hint,status,actions);dialog.append(title,intro,form);doc.body.append(dialog);
   const state={dialog,who,closed:false,busy:false,invalid:false,intent:null,overflow:doc.body.style.overflow};active=state;doc.body.style.overflow='hidden';
   const inputs=[name,quantity,...(reduced?[reduced,reducedPrice]:[])],alive=()=>!disposed&&!state.closed&&active===state;
   const viewport=win.visualViewport;
   const fit=()=>{
    if(!alive()||!Number.isFinite(viewport?.height))return;
    const keyboard=Math.abs(Number(viewport.scale||1)-1)<.05&&Number.isFinite(win.innerHeight)&&viewport.height+80<win.innerHeight;
    dialog.style.maxHeight=keyboard?Math.max(160,viewport.height-24)+'px':'';dialog.style.top=keyboard?Math.max(12,(viewport.offsetTop||0)+12)+'px':'';dialog.style.bottom=keyboard?'auto':'';dialog.style.margin=keyboard?'0 auto':'';
    const input=doc.activeElement;if(keyboard&&dialog.contains(input)&&input.matches?.('input,select,textarea')){const box=dialog.getBoundingClientRect(),field=input.getBoundingClientRect();if(field.bottom>box.bottom-12)dialog.scrollTop+=field.bottom-box.bottom+12;else if(field.top<box.top+12)dialog.scrollTop+=field.top-box.top-12;}
   };
   viewport?.addEventListener?.('resize',fit);viewport?.addEventListener?.('scroll',fit);win.addEventListener?.('resize',fit);dialog.addEventListener('focusin',fit);
   state.cleanup=()=>{viewport?.removeEventListener?.('resize',fit);viewport?.removeEventListener?.('scroll',fit);win.removeEventListener?.('resize',fit);};
   const current=()=>alive()&&!state.invalid&&actor()===who&&win.BBAccountDeletion?.isDeleting?.()!==true;
   const freeze=()=>{if(!alive())return;state.invalid=true;inputs.forEach(node=>node.disabled=true);save.disabled=true;status.textContent='Your account changed. Close this form and reopen Add item to buy.';cancel.disabled=state.busy;};
   state.checkContext=()=>{if(alive()&&(actor()!==who||win.BBAccountDeletion?.isDeleting?.()===true))freeze();};
   const update=()=>{if(!alive()||state.busy)return;state.checkContext();if(!current())return;status.textContent='';save.disabled=!name.value.trim()||!quantity.value.trim()||(reduced?.checked&&(!(Number(reducedPrice.value)>0)||Number(reducedPrice.value)>100000));};
   for(const node of inputs)node.addEventListener('input',update);
   cancel.onclick=()=>{if(!state.busy)close(state);};
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(state.busy||!alive())return;state.checkContext();if(!current())return;
    const item=name.value.trim(),amount=quantity.value.trim();
    if(!item||!amount){status.textContent='Enter an item and the quantity you want to buy.';save.disabled=true;return;}
    const reducedValue=reduced?.checked?Number(reducedPrice.value):null;
    if(reducedValue!==null&&(win.BBReducedFoodHost?.isPremium?.()!==true||!(reducedValue>=.01)||reducedValue>100000||!Number.isFinite(reducedValue))){status.textContent='Premium and a valid total paid are required for a reduced purchase.';return;}
    if(!state.intent||state.intent.name!==item||state.intent.quantityText!==amount||state.intent.reduced?.pricePaid!== (reducedValue??undefined))state.intent={name:item,quantityText:amount,actorId:who,requestId:identity(),...(reducedValue!==null?{reduced:{pricePaid:reducedValue}}:{})};
    const request={...state.intent};state.busy=true;dialog.setAttribute('aria-busy','true');inputs.forEach(node=>node.disabled=true);save.disabled=cancel.disabled=true;status.textContent=reducedValue!==null?'Recording reduced purchase…':'Adding item…';
    try{
     const result=await home.addShoppingBuy(request);if(!alive())return;state.checkContext();if(!current())return;
     if(result?.ok===true){notice.textContent=result.message||'Item added to shopping.';close(state);try{onSaved(result);}catch{}return;}
     status.textContent=result?.message||'The item could not be added. Check the name and quantity, then try again.';
    }catch{if(alive()&&current())status.textContent='Your shopping update needs checking. Try adding the same item again.';}
    finally{state.busy=false;if(alive()){dialog.removeAttribute('aria-busy');cancel.disabled=false;if(!state.invalid){inputs.forEach(node=>node.disabled=false);save.disabled=!name.value.trim()||!quantity.value.trim()||(reduced?.checked&&(!(Number(reducedPrice.value)>0)||Number(reducedPrice.value)>100000));}}}
   });
   dialog.addEventListener('cancel',event=>{event.preventDefault();if(!state.busy)close(state);});dialog.addEventListener('close',()=>close(state));
   dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;const focusable=[...dialog.querySelectorAll('button,input')].filter(node=>!node.disabled&&!node.hidden),first=focusable[0],last=focusable.at(-1);if(!first)return;
    if(event.shiftKey&&(doc.activeElement===first||!dialog.contains(doc.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(doc.activeElement===last||!dialog.contains(doc.activeElement))){event.preventDefault();first.focus();}
   });
   try{dialog.showModal?.();}catch{dialog.setAttribute('open','');}if(!dialog.open)dialog.setAttribute('open','');fit();name.focus();update();
  }
  open.onclick=openDialog;const contextChanged=()=>active?.checkContext?.();
  for(const name of ['basketboss:session-changed','basketboss:account-changed','basketboss:account-deletion-started'])win.addEventListener?.(name,contextChanged);
  return {dispose(){if(disposed)return;disposed=true;close(active);wrap.remove();for(const name of ['basketboss:session-changed','basketboss:account-changed','basketboss:account-deletion-started'])win.removeEventListener?.(name,contextChanged);}};
 }
 if(root)root.BBShopAdd=Object.freeze({mount});
})(typeof window==='undefined'?null:window);
