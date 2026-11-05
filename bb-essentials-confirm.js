/* Weekly essentials are confirmed purchases to plan, never pantry credits.
   Stock, pricing, settlement and account guards stay owned by BBHome. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root&&!root.BBEssentialsConfirm)root.BBEssentialsConfirm=api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const MAX=1000000,UNITS=['each','pack','bag','tin','bunch','loaf','g','ml','kg','l'];
 const clean=value=>String(value??'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').trim().replace(/\s+/g,' ').slice(0,70);
 const same=(a,b)=>clean(a).toLowerCase()===clean(b).toLowerCase();
 const amountLabel=(value,unit)=>value+' '+(value===1?unit:({pack:'packs',bag:'bags',tin:'tins',bunch:'bunches',loaf:'loaves'})[unit]||unit);
 function quantity(value,label){
  if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!/^\s*(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(value))throw Error('Enter '+label+'.');
  const n=Number(value);if(!Number.isFinite(n)||n<0||n>MAX)throw Error('Use 0 or more for '+label+'.');return n;
 }
 function defaults(item={}){return {name:clean(item.name),unit:item.unit||'each',targetQty:String(item.targetQty??item.qty??1),ownedQty:String(item.ownedQty??(item.owned?item.qty:0)??0)};}
 function prepare(input,{measured,unit}={}){
  if(measured){if(!['g','ml'].includes(measured.unit)||measured.packUnit!==measured.unit||measured.packReviewed!==true||quantity(measured.packQuantity,'the full container size')<=0)throw Error('Enter the full container size.');quantity(measured.targetQty,'the total needed');quantity(measured.ownedQty,'the amount at home');return measured;}
  const selected=unit||input.unit;if(!UNITS.includes(selected))throw Error('Review this saved unit before confirming.');
  const targetQty=quantity(input.targetQty,'the amount needed this week'),ownedQty=quantity(input.ownedQty,'the amount already at home');
  if(!['g','ml','kg','l'].includes(selected)&&(!Number.isInteger(targetQty)||!Number.isInteger(ownedQty)))throw Error('Use whole items or packs, or choose part of a bottle or pack.');
  return {targetQty,ownedQty,...(!unit?{unit:selected}:{})};
 }
 function createController(win){
  let busy=false,serial=0;
  const host=()=>win.BBHomeHost,home=()=>win.BBHome;
  const records=()=>host()?.household?.()||[];
  const rules=()=>win.BBKitchenChoiceRules;
  const validHousehold=name=>rules()?.isHousehold?.(name)===true;
  function open(source={}){
   const pin=host()?.householdAmountContext?.();if(!pin)throw Error('Weekly essentials are still loading. Please try again.');
   const item=source.id?records().find(row=>row.id===source.id):records().find(row=>same(row.name,source.name));
   return {serial:++serial,pin,item:item?{...item}:null,defaults:defaults(item||source),done:false};
  }
  function validate(view){if(!view||view.done)throw Error('This item is already confirmed. Open Amend to change it.');if(JSON.stringify(host()?.householdAmountContext?.())!==JSON.stringify(view.pin))throw Error('Your account or essentials changed. Close and reopen this item to review the latest amounts.');}
  async function confirm(view,input,{measured}={}){
   if(busy)return {ok:false,busy:true,message:'Wait for this confirmation to finish.'};busy=true;
   try{
    validate(view);const name=clean(input.name||view.item?.name);if(!name)throw Error('Enter the household item name.');
    if(!validHousehold(name))throw Error('Weekly essentials are for toiletries, cleaning and household items. Add food in Cupboard, Fridge or Freezer.');
    if(view.item&&!same(name,view.item.name))throw Error('Add a new item instead of renaming saved stock.');
    const existing=view.item||records().find(row=>same(row.name,name));
    if(existing&&!view.item)return {ok:false,existing:{...existing},message:'This item is already saved. Review its current amounts, then confirm.'};
    const patch=prepare(input,{measured,unit:existing?.unit});
    let result;if(existing){if(typeof home()?.confirmHousehold!=='function')throw Error('Essentials confirmation is still loading. Reload BasketBoss and try again.');result=await home().confirmHousehold(existing.id,patch,view.pin);}
    else{if(typeof home()?.confirmHouseholdEntry!=='function')throw Error('Essentials confirmation is still loading. Reload BasketBoss and try again.');result=await home().confirmHouseholdEntry({name,...patch},view.pin);}
    if(result?.ok!==true)throw Error(result?.message||'This essential could not be confirmed. Your saved amounts are unchanged.');
    view.done=true;return {...result,ok:true};
   }catch(error){return {ok:false,message:error?.message||'Could not confirm this item. Please try again.'};}
   finally{busy=false;}
  }
  async function remove(view){
   if(busy)return {ok:false,busy:true,message:'Wait for the current update to finish.'};busy=true;
   try{validate(view);if(!view.item||typeof home()?.removeHousehold!=='function')throw Error('This essential changed. Please reopen the list.');const result=await home().removeHousehold(view.item.id,view.pin);if(result?.ok!==true)throw Error(result?.message||'Could not remove this essential.');view.done=true;return {...result,ok:true};}
   catch(error){return {ok:false,message:error?.message||'Could not remove this essential.'};}finally{busy=false;}
  }
  return Object.freeze({open,confirm,remove,records,validHousehold,isBusy:()=>busy});
 }
 function install(win){
  const doc=win.document;if(!doc)return {open(){},refresh(){},destroy(){}};
  const controller=createController(win);let dialog=null,active=null,observer=null,queued=false,destroyed=false;
  const make=(tag,cls,value)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
  const button=(label,fn,cls='')=>{const n=make('button',cls,label);n.type='button';n.addEventListener('click',fn);return n;};
  const groups=()=>win.BBPantryGroups,groupUI=()=>win.BBPantryGroupsUI;
  function notice(text,error=false){const region=doc.getElementById('bbKitchenEssentials');if(!region)return;let n=region.querySelector('.bbec-notice');if(!n){n=make('p','bbec-notice');n.setAttribute('role','status');region.append(n);}n.textContent=text;n.setAttribute('role',error?'alert':'status');}
  function close(){if(!dialog)return;const state=active;state?.cleanup?.();dialog.remove();dialog=null;active=null;doc.body.style.overflow=state?.overflow||'';state?.focus?.focus?.({preventScroll:true});}
  function freeze(value){if(!active||!dialog)return;active.busy=value;dialog.setAttribute('aria-busy',String(value));for(const n of dialog.querySelectorAll('button,input,select'))n.disabled=value;if(!value){active.fields.name.readOnly=!active.allowNameChange;active.fields.unit.disabled=!!active.view.item;}}
  function status(text,error=false){if(!active)return;active.status.textContent=text;active.status.setAttribute('role',error?'alert':'status');}
  function fill(item){if(!active)return;active.view.item=item?{...item}:null;const values=defaults(item||{name:active.fields.name.value,unit:'each'});for(const key of ['name','targetQty','ownedQty','unit'])active.fields[key].value=values[key];active.fields.name.readOnly=!active.allowNameChange;active.fields.unit.disabled=!!item;draw();}
  function draw(){
   if(!active)return;const input=Object.fromEntries(Object.entries(active.fields).map(([key,n])=>[key,n.value]));
   try{
    const patch=active.measured.open?win.BBHouseholdAmount?.prepare?.({remaining:active.parts.remaining.value,capacity:active.parts.capacity.value,capacityUnit:active.parts.capacityUnit.value,neededContainers:active.parts.neededContainers.value}):prepare(input,{unit:active.view.item?.unit});
    if(!patch)throw Error('Enter the full container size and amounts.');
    active.preview.textContent=amountLabel(Math.max(0,patch.targetQty-patch.ownedQty),patch.unit||input.unit)+' to buy';active.confirm.disabled=active.busy||active.invalid;
   }catch{active.preview.textContent='Enter the amounts to see what goes to Shop.';active.confirm.disabled=true;}
  }
  function openDialog(source={}){
   if(destroyed||controller.isBusy()||dialog||doc.querySelector('dialog[open]'))return;
   let view;try{view=controller.open(source);}catch(error){notice(error.message,true);return;}
   dialog=make('dialog','bb-essentials-confirm-dialog');dialog.id='bbEssentialConfirm';dialog.setAttribute('aria-labelledby','bbEssentialConfirmTitle');
   const header=make('header'),title=make('h2','','Confirm weekly essential');title.id='bbEssentialConfirmTitle';title.tabIndex=-1;
   const cancel=button('Cancel',()=>{if(!active?.busy)close();},'bbec-cancel');header.append(title,cancel);
   const form=make('form'),body=make('div','bbec-body'),intro=make('p','bbec-intro','Confirm what you need this week and what you already have. Shop updates straight away.');body.append(intro);
   const fields={};function field(key,label,type='number'){const wrap=make('label','',label),input=make('input');input.type=type;input.name=key;input.required=true;if(type==='number'){input.min='0';input.max=String(MAX);input.step='any';input.inputMode='decimal';}else{input.maxLength=70;input.autocomplete='off';}fields[key]=input;wrap.append(input);body.append(wrap);return input;}
   field('name','Item','text');field('targetQty','Total needed this week');field('ownedQty','Already at home');
   const unitWrap=make('label','','Unit'),unit=make('select');unit.name='unit';fields.unit=unit;for(const value of UNITS){const n=make('option','',({each:'items',pack:'packs',bag:'bags',tin:'tins',bunch:'bunches',loaf:'loaves',g:'grams',ml:'ml',kg:'kg',l:'litres'})[value]);n.value=value;unit.append(n);}unitWrap.append(unit);body.append(unitWrap);
   const list=make('datalist');list.id='bbEssentialNames';const names=new Set([...(controller.records()||[]).map(row=>row.name),...(win.BBKitchenChoiceRules?.HOUSEHOLD_PREVIEWS||[]).map(row=>row.name),...[...doc.querySelectorAll('#bbKitchenEssentials [data-bbke-name]')].map(n=>n.dataset.bbkeName)].filter(Boolean));for(const name of names){const option=make('option');option.value=name;list.append(option);}fields.name.setAttribute('list',list.id);body.append(list);
   const measured=make('details','bbec-measured'),summary=make('summary','','Part of a bottle or pack?');measured.append(summary);
   const parts={};for(const [key,label]of [['remaining','Containers remaining'],['capacity','Full container size'],['neededContainers','Total containers needed']]){const labelNode=make('label','',label),input=make('input');input.type='number';input.min=key==='capacity'?'0.000001':'0';input.max=String(MAX);input.step='any';input.inputMode='decimal';parts[key]=input;labelNode.append(input);measured.append(labelNode);}
   const sizeWrap=make('label','','Container size unit'),size=make('select');for(const value of ['ml','g','l','kg']){const option=make('option','',value);option.value=value;size.append(option);}parts.capacityUnit=size;sizeWrap.append(size);measured.append(sizeWrap);body.append(measured);
   const groupWrap=make('label','','Subcategory'),group=make('select');let groupPin=null;let groupChosen=false;group.addEventListener('change',()=>{groupChosen=true;});
   try{const snapshot=groups()?.snapshot('essentials');groupPin=groups()?.context();if(snapshot){for(const row of snapshot.groups){const option=make('option','',row.name);option.value=row.id;group.append(option);}const activeGroup=groupUI()?.active('essentials');group.value=view.item?groups().groupFor('essentials',view.item.id,view.item.name):(activeGroup&&activeGroup!=='all'?activeGroup:groups().groupFor('essentials','name:'+groups().itemKey(view.defaults.name),view.defaults.name));groupWrap.append(group);body.append(groupWrap);}}catch{}
   const preview=make('output','bbec-preview');preview.setAttribute('aria-live','polite');body.append(preview);
   const footer=make('footer'),message=make('p','bbec-status');message.setAttribute('role','status');message.setAttribute('aria-live','polite');const confirm=make('button','bbec-confirm','Confirm & update Shop');confirm.type='submit';footer.append(message,confirm);form.append(body,footer);dialog.append(header,form);doc.body.append(dialog);
   active={view,fields,parts,measured,preview,confirm,status:message,busy:false,invalid:false,allowNameChange:!source.id&&!source.name,overflow:doc.body.style.overflow,focus:doc.activeElement};doc.body.style.overflow='hidden';
   const original=view.item;fill(original||{...source,...view.defaults});active.view.item=original;
   fields.name.readOnly=!active.allowNameChange;fields.unit.disabled=!!view.item;
   if(view.item&&win.BBHouseholdAmount?.defaultsFor){const values=win.BBHouseholdAmount.defaultsFor(view.item);for(const key of Object.keys(parts))parts[key].value=values[key]??'';}
   fields.name.addEventListener('input',()=>{if(!active?.allowNameChange||active?.busy)return;const existing=controller.records().find(row=>same(row.name,fields.name.value));if(existing&&existing.id!==active.view.item?.id)fill(existing);else if(!existing&&active.view.item)fill(null);if(!groupChosen&&groups()){try{const current=active.view.item,filter=groupUI()?.active('essentials');group.value=current?groups().groupFor('essentials',current.id,current.name):(filter&&filter!=='all'?filter:groups().groupFor('essentials','name:'+groups().itemKey(fields.name.value),fields.name.value));}catch{}}draw();});
   form.addEventListener('input',draw);form.addEventListener('change',draw);measured.addEventListener('toggle',draw);
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(!active||active.busy||active.invalid)return;
    let measuredPatch;try{if(measured.open)measuredPatch=win.BBHouseholdAmount?.prepare?.(Object.fromEntries(Object.entries(parts).map(([key,n])=>[key,n.value])));if(measured.open&&!measuredPatch)throw Error('Container controls could not load. Reload BasketBoss.');}catch(error){status(error.message,true);return;}
    const state=active,input=Object.fromEntries(Object.entries(fields).map(([key,n])=>[key,n.value]));freeze(true);confirm.textContent='Confirming…';status('Updating Shop…');
    const result=await controller.confirm(state.view,input,{measured:measuredPatch});if(active!==state)return;
    if(result.ok){let groupWarning='';const id=result.id||result.item?.id||state.view.item?.id||controller.records().find(row=>same(row.name,input.name))?.id;
     if(id&&groupPin&&group.value)try{groups().assign('essentials',id,group.value,groupPin);}catch{groupWarning=' You can amend its subcategory from the confirmed list.';}
     close();notice((result.message||'Essential confirmed. Shop is up to date.')+groupWarning);schedule();return;
    }
    freeze(false);confirm.textContent='Confirm & update Shop';status(result.message,true);
    if(result.existing){fill(result.existing);draw();return;}
    if(/account|changed|reopen|close and reopen|pending|review/i.test(result.message||'')){state.invalid=true;confirm.disabled=true;}
   });
   dialog.addEventListener('cancel',event=>{event.preventDefault();if(!active?.busy)close();});
   const fit=()=>{if(!dialog||!Number.isFinite(win.visualViewport?.height))return;const viewport=win.visualViewport,keyboard=viewport.height+80<win.innerHeight;dialog.style.maxHeight=keyboard?Math.max(160,viewport.height-24)+'px':'';dialog.style.top=keyboard?Math.max(12,(viewport.offsetTop||0)+12)+'px':'';dialog.style.bottom=keyboard?'auto':'';dialog.style.margin=keyboard?'0 auto':'';};
   win.visualViewport?.addEventListener?.('resize',fit);win.visualViewport?.addEventListener?.('scroll',fit);active.cleanup=()=>{win.visualViewport?.removeEventListener?.('resize',fit);win.visualViewport?.removeEventListener?.('scroll',fit);};
   try{dialog.showModal();}catch{dialog.setAttribute('open','');}fit();draw();title.focus?.({preventScroll:true});
  }
  function renderConfirmed(region){
   let section=region.querySelector('.bbec-confirmed');if(!section){section=make('section','bbec-confirmed');section.setAttribute('aria-label','Confirmed weekly essentials');region.append(section);}
   const records=controller.records().filter(row=>row.selected!==false&&controller.validHousehold(row.name)),activeGroup=groupUI()?.active('essentials');
   const own=records.filter(row=>!activeGroup||activeGroup==='all'||!groups()||groups().groupFor('essentials',row.id,row.name)===activeGroup);
   let prices=()=>null;try{prices=win.BBKitchenPrices?.read?.()||prices;}catch{}const labels=new Map(own.map(row=>[row.id,win.BBKitchenPrices?.label?.(prices(row.name))||'']));
   const stamp=JSON.stringify([own,activeGroup,[...labels]]);if(section.dataset.bbecStamp===stamp)return;section.dataset.bbecStamp=stamp;section.replaceChildren();
   const heading=make('h3','','Confirmed essentials · '+records.length),list=make('ul','bbec-list');section.append(heading,list);
   for(const item of own){const row=make('li'),info=make('div','bbec-item-info'),name=make('strong','',item.name),amount=defaults(item),reconciled=win.BBWeeklyEssentials?.reconcile?.(item),buy=reconciled?.valid?reconciled.toBuy:0;
    const detail=make('small','',!reconciled?.valid?'Review the saved amounts':buy>0?'On your Shop list · Buy '+amountLabel(buy,amount.unit):Number(amount.ownedQty)>=Number(amount.targetQty)?'Already at home · Nothing to buy':'No current Shop request · Amend to restock');info.append(name,detail);if(labels.get(item.id))info.append(make('small','bb-kitchen-last-price',labels.get(item.id)));
    const actions=make('div','bbec-item-actions'),amend=button('Amend',()=>openDialog({id:item.id}),'bbec-amend');amend.setAttribute('aria-label','Amend '+item.name);
    const remove=button('Delete',async()=>{if(controller.isBusy()||dialog)return;let view;try{view=controller.open({id:item.id});}catch(error){notice(error.message,true);return;}remove.disabled=amend.disabled=true;const result=await controller.remove(view);notice(result.message|| (result.ok?'Removed from weekly essentials.':'Could not remove this item.'),!result.ok);if(result.ok)schedule();else remove.disabled=amend.disabled=false;},'bbec-delete');remove.setAttribute('aria-label','Delete '+item.name+' from weekly essentials');actions.append(amend,remove);row.append(info,actions);list.append(row);
   }
   if(!own.length)list.append(make('li','bbec-empty',records.length?'No confirmed essentials in this subcategory.':'Tap a thumbnail or Add, then confirm your first essential.'));
  }
  function refresh(){queued=false;if(destroyed)return;const region=doc.getElementById('bbKitchenEssentials');if(!region)return;region.classList.add('bbec-enabled');renderConfirmed(region);}
  function schedule(){if(!queued&&!destroyed){queued=true;(win.requestAnimationFrame||win.setTimeout).call(win,refresh);}}
  function click(event){
   const target=event.target.closest?.('#bbKitchenEssentials [data-bbke-name],#bbKitchenEssentials .bbke-add-choice');if(!target)return;
   event.preventDefault();event.stopImmediatePropagation();if(target.dataset.bbkeName){const preset=win.BBKitchenChoiceRules?.HOUSEHOLD_PREVIEWS?.find(row=>same(row.name,target.dataset.bbkeName));openDialog({name:target.dataset.bbkeName,unit:preset?.unit||'each'});}else openDialog();
  }
  function submit(event){const form=event.target;if(form?.id!=='bb307EssentialsForm'||!form.closest?.('#bbKitchenEssentials'))return;event.preventDefault();event.stopImmediatePropagation();openDialog({name:form.querySelector('#bb307EssName')?.value,unit:form.querySelector('#bb307EssUnit')?.value||'each',targetQty:form.querySelector('#bb307EssQty')?.value||1});}
  function changed(){if(active&&!active.busy&&JSON.stringify(win.BBHomeHost?.householdAmountContext?.())!==JSON.stringify(active.view.pin)){active.invalid=true;active.confirm.disabled=true;status('Your account or essentials changed. Close and reopen this item.',true);}schedule();}
  doc.addEventListener('click',click,true);doc.addEventListener('submit',submit,true);
  for(const event of ['basketboss:session-changed','basketboss:account-deletion-started'])win.addEventListener?.(event,changed);
  win.addEventListener?.('storage',changed);
  if(win.MutationObserver){observer=new win.MutationObserver(schedule);observer.observe(doc.getElementById('app')||doc.documentElement,{subtree:true,childList:true});}
  schedule();return Object.freeze({open:openDialog,refresh:schedule,controller,destroy(){destroyed=true;observer?.disconnect();doc.removeEventListener('click',click,true);doc.removeEventListener('submit',submit,true);for(const event of ['basketboss:session-changed','basketboss:account-deletion-started'])win.removeEventListener?.(event,changed);win.removeEventListener?.('storage',changed);close();}});
 }
 return Object.freeze({defaults,prepare,createController,install});
});
