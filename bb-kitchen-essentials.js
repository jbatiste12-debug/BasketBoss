/* Kitchen presentation only. Move the original essentials controls with their
   handlers; pantry quantities, prices and shopping state keep their owners. */
(()=>{'use strict';
 if(window.BBKitchenEssentials)return;
 const doc=document;let queued=false,selectedSection='food',rules=null,rulesLoading=null,rulesAttempts=0;
 const choices=new Map(),legacyOpen={value:false};
 const helperURL=new URL('./bb-kitchen-choice-rules.mjs',doc.currentScript?.src||location.href).href;
 function loadRules(){
  if(rules)return Promise.resolve(rules);
  if(rulesLoading)return rulesLoading;
  const url=new URL(helperURL);if(rulesAttempts++)url.searchParams.set('bbRulesRetry',String(rulesAttempts));
  rulesLoading=import(url.href).then(value=>{
   if(typeof value?.isHousehold!=='function'||typeof value?.previewOrder!=='function'||!value.FOOD_PREVIEWS||!Array.isArray(value.HOUSEHOLD_PREVIEWS))return null;
   rules=value;window.BBKitchenChoiceRules=value;schedule();return value;
  }).catch(()=>null).finally(()=>{rulesLoading=null;});
  return rulesLoading;
 }
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 function readableQuantity(value){try{return window.BBShopPurchaseUI?.formatDisplayQuantityText?.(String(value),{market:window.bb307ActiveMarket?.()||'UK'})??String(value);}catch{return String(value);}}
 function readableAmount(raw,unit,noun=false){if(String(raw).trim())try{const value=window.BBShopPurchaseUI?.formatDisplayQty?.(Number(raw),noun?'each':unit,{market:window.bb307ActiveMarket?.()||'UK',countMode:'balance'});if(value&&!/^Check\b/.test(value))return noun?value.replace(/ each$/,' '+unit+(Number(raw)===1?'':'s')):value;}catch{}return readableQuantity(raw+' '+unit);}
 function readableHouseholdOutputs(container){for(const output of container?.querySelectorAll('.bb-home-quantities output')||[])text(output,readableQuantity(output.textContent));}
 function sectionButton(label,key,panel){
  const node=doc.createElement('button');node.type='button';node.textContent=label;
  node.id=key==='food'?'bbKitchenFoodTab':'bbKitchenEssentialsTab';node.dataset.bbkeSection=key;
  node.setAttribute('role','tab');node.setAttribute('aria-controls',panel);
  const select=()=>{
   if(selectedSection===key&&node.getAttribute('aria-selected')==='true')return;
   selectedSection=key;void window.BBPantryLive?.flush?.();refresh();
   if(window.BBTabViewport?.reset)window.BBTabViewport.reset({view:'shop'});
   else{window.scrollTo?.({top:0,left:0,behavior:'instant'});if(doc.scrollingElement)doc.scrollingElement.scrollTop=0;}
  };
  node.addEventListener('click',select);
  node.addEventListener('keydown',event=>{
   const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key))return;
   event.preventDefault();const target=event.key==='Home'?'food':event.key==='End'?'essentials':key==='food'?'essentials':'food';
   doc.getElementById(target==='food'?'bbKitchenFoodTab':'bbKitchenEssentialsTab')?.click();
   doc.getElementById(target==='food'?'bbKitchenFoodTab':'bbKitchenEssentialsTab')?.focus({preventScroll:true});
  });return node;
 }
 function sections(kitchen,essentials){
  let nav=kitchen.querySelector('#bbKitchenSections');
  if(!nav){
   nav=doc.createElement('nav');nav.id='bbKitchenSections';nav.setAttribute('aria-label','At home sections');nav.setAttribute('role','tablist');
   nav.append(sectionButton('Choose food','food','bbKitchenFoodPanel'),sectionButton('Weekly essentials','essentials','bbKitchenEssentials'));
   kitchen.querySelector('.bb76-kitchen-intro').after(nav);
  }
  let food=kitchen.querySelector('#bbKitchenFoodPanel');
  if(!food){food=doc.createElement('section');food.id='bbKitchenFoodPanel';food.setAttribute('role','tabpanel');food.setAttribute('aria-labelledby','bbKitchenFoodTab');nav.after(food);}
  // Reuse the original controls. Hiding a panel never removes its draft input,
  // handlers or selected foods, and later legacy renders can be adopted again.
  for(const node of [...kitchen.children])if(node!==food&&node!==nav&&!node.classList.contains('bb76-kitchen-intro'))food.append(node);
  const pantryJump=kitchen.querySelector('#bb76JumpPantry');
  if(pantryJump?.firstChild?.nodeType===3)pantryJump.firstChild.textContent='Your pantry ';
  food.hidden=selectedSection!=='food';essentials.hidden=selectedSection!=='essentials';
  kitchen.dataset.bbkeSection=selectedSection;
  essentials.setAttribute('role','tabpanel');essentials.setAttribute('aria-labelledby','bbKitchenEssentialsTab');
  for(const control of nav.querySelectorAll('[role="tab"]')){const active=control.dataset.bbkeSection===selectedSection;control.setAttribute('aria-selected',String(active));control.tabIndex=active?0:-1;}
 }
 function state(key){if(!choices.has(key))choices.set(key,{expanded:false,search:''});return choices.get(key);}
 const groupUI=()=>window.BBPantryGroupsUI;
 const groupKey=(name)=>window.BBPantryGroups?.itemKey(name)||name.toLowerCase().trim();
 const householdKey=(name)=>{
  const saved=window.BBHomeHost?.household?.().find(row=>row.name.toLowerCase()===name.toLowerCase());
  return saved?.id||'name:'+groupKey(name);
 };
 function show(node,visible){if(node.hidden===visible)node.hidden=!visible;}
 function thumb(control,name,emoji){
  if(control.dataset.bbkeThumbnail)return;
  const label=doc.createElement('span');label.className='bbke-choice-label';label.textContent=name;
  const visual=doc.createElement('span');visual.innerHTML=window.BBFoodVisuals?.html(name,{context:'pantry',variant:'tile',emoji})||'';
  if(!visual.firstElementChild){visual.textContent=emoji;visual.className='bbke-fallback';}
  control.replaceChildren(...visual.childNodes,label);control.dataset.bbkeThumbnail='true';
 }
 function controls(host,key,grid,draw){
  let bar=host.querySelector(':scope>.bbke-picker-controls');if(bar)return bar;
  bar=doc.createElement('div');bar.className='bbke-picker-controls';
  const search=doc.createElement('input');search.type='search';search.placeholder='Search choices';search.setAttribute('aria-label','Search '+key+' choices');search.value=state(key).search;
  const add=doc.createElement('button');add.type='button';add.className='bbke-add-choice';add.setAttribute('aria-label','Add from all '+key+' choices');
  const id='bbke-catalogue-'+key;grid.id=id;add.setAttribute('aria-controls',id);
  const empty=doc.createElement('p');empty.className='bbke-search-empty';empty.textContent='No matching choices. Add your own below.';empty.hidden=true;
  search.addEventListener('input',()=>{state(key).search=search.value;draw();});
  add.addEventListener('click',()=>{const current=state(key);current.expanded=!current.expanded;current.search='';search.value='';draw();if(current.expanded)search.focus();else void window.BBPantryLive?.flush?.();});
  grid.before(bar);bar.append(search,grid,add,empty);return bar;
 }
 function foodChoices(area){
  const key=area.dataset.bb76Store,grid=area.querySelector('[data-bb76-tiles]'),body=area.querySelector('.bb76-store-body');if(!grid||!body)return;
  const draw=()=>{
   const current=state(key),items=[...grid.querySelectorAll('[data-bb5-food]')];
   const ordered=rules.previewOrder(items,rules.FOOD_PREVIEWS[key]||[],node=>node.dataset.bb5Food);
   ordered.forEach((node,index)=>{const tiles=[...grid.children].filter(child=>child.matches('[data-bb5-food]'));if(tiles[index]!==node)grid.insertBefore(node,tiles[index]||null);});
   const query=current.search.trim().toLowerCase();let visible=0,eligible=0;
   ordered.forEach(node=>{
    const name=node.dataset.bb5Food,inGroup=!groupUI()||groupUI().matches(key,groupKey(name),name);
    const available=inGroup&&(!query||name.toLowerCase().includes(query));
    const visibleHere=available&&(current.expanded||eligible<4);if(available)eligible++;
    node.toggleAttribute('data-bbke-choice-hidden',!visibleHere);if(visibleHere)visible++;
   });
   body.dataset.bbkeExpanded=String(current.expanded);grid.classList.add('bbke-choice-grid');
   const bar=body.querySelector(':scope>.bbke-picker-controls');if(!bar)return;
   show(bar.querySelector('input'),current.expanded);show(bar.querySelector('.bbke-search-empty'),!visible);
   const add=bar.querySelector('.bbke-add-choice');text(add,current.expanded?'Done':'＋ Add');add.setAttribute('aria-expanded',String(current.expanded));
  };
  controls(body,key,grid,draw);
  groupUI()?.mount(body,key,()=>{refresh();});
  draw();
 }
 function selectedReadout(area,kitchen){
  const key=area.dataset.bb76Store,body=area.querySelector('.bb76-store-body');if(!body)return;
  let details=body.querySelector('.bbke-selected-readout');
  if(!details){
   details=doc.createElement('details');details.className='bbke-selected-readout';details.open=state('selected-'+key).expanded;
   const summary=doc.createElement('summary');summary.textContent='Selected here';const list=doc.createElement('ul');
   const edit=doc.createElement('button');edit.type='button';edit.textContent='Edit pantry quantities';
   edit.addEventListener('click',()=>{const pantry=doc.getElementById('bbSimplePantry');if(pantry)pantry.open=true;doc.getElementById('bb76PantryHeading')?.focus({preventScroll:true});doc.getElementById('bb8WhatIHave')?.scrollIntoView({block:'start',behavior:'smooth'});});
   details.append(summary,list,edit);details.addEventListener('toggle',()=>{if(details.isConnected)state('selected-'+key).expanded=details.open;});body.append(details);
  }
  const rows=[...kitchen.querySelectorAll('#bb5SelectedRows [data-pantry-location="'+key+'"] .bb5-review-row')];
  const values=rows.map(row=>{
   const name=row.querySelector('strong').textContent,amount=row.querySelector('[data-bb5-qty]').value,unit=row.querySelector('[data-bb5-unit]').value,needed=row.querySelector('[data-bb5-needed]')?.value,buy=row.querySelector('output')?.textContent;
   const status=row.querySelector('[data-bb5-staple-status]')?.value,container=window.BBPantryPolicy?.containerLabel(name)||'unit';
   return {name,description:readableQuantity(status?({in:'In Stock',low:'Low',out:'Out',unknown:'Review status'}[status]||'Review status')+(amount.trim()?' · '+readableAmount(amount,container,true):'')+' · container tracking':(amount.trim()?readableAmount(amount,unit)+' already got':'Amount unknown — enter an amount to reduce Shopping')+(needed!==undefined?' · '+readableAmount(needed,unit)+' needed':'')+(buy?' · '+buy:''))};
  });
  let groups=null,pin=null;try{groups=window.BBPantryGroups?.snapshot(key);pin=window.BBPantryGroups?.context();}catch{}
  const stamp=JSON.stringify([values,pin,groupUI()?.active(key)]);
  if(details.dataset.bbkeValues!==stamp){
   details.dataset.bbkeValues=stamp;
   const filtered=values.filter(value=>!groupUI()||groupUI().matches(key,groupKey(value.name),value.name));
   text(details.querySelector('summary'),'Selected here ('+filtered.length+(filtered.length!==values.length?' of '+values.length:'')+')');
   const list=details.querySelector('ul');list.replaceChildren();
   const categories=groups?.groups||[{id:'all',name:''}];
   for(const category of categories){
    const own=filtered.filter(value=>!groups||window.BBPantryGroups.groupFor(key,groupKey(value.name),value.name)===category.id);if(!own.length)continue;
    if(category.name){const title=doc.createElement('li');title.className='bbpg-group-title';const heading=doc.createElement('h4');heading.textContent=category.name;title.append(heading);list.append(title);}
    for(const value of own){
     const li=doc.createElement('li');li.className='bbpg-selected-item';const name=doc.createElement('strong');name.textContent=value.name;
     const description=doc.createElement('small');description.textContent=value.description;li.append(name,description);
     const picker=groupUI()?.picker(key,groupKey(value.name),value.name,()=>{refresh();});if(picker)li.append(picker);list.append(li);
    }
   }
   if(!filtered.length){const li=doc.createElement('li');li.textContent=values.length?'No selected items in this subcategory. Choose items above or switch to All.':'Nothing selected here yet.';list.append(li);}
  }
 }
 function refreshGroupPickers(kitchen){
  if(!kitchen||!groupUI())return;
  let pin;try{pin=JSON.stringify(window.BBPantryGroups.context());}catch{return;}
  for(const row of kitchen.querySelectorAll('#bb5SelectedRows [data-bb5-row]')){
   if(row.dataset.bbpgRevision===pin)continue;
   const section=row.closest('[data-pantry-location]')?.dataset.pantryLocation,name=row.querySelector('strong')?.textContent;
   if(!section||!name)continue;
   const picker=groupUI().picker(section,groupKey(name),name,()=>{refresh();});if(!picker)continue;
   row.querySelector('.bbpg-item-group')?.remove();row.append(picker);row.dataset.bbpgRevision=pin;
  }
 }
 function householdChoices(region,kitchen){
  let full=region.querySelector('#bbkeHouseholdMore'),grid=region.querySelector('.bbke-household-choices');
  if(!full){
   const heading=region.querySelector('.bb16-essentials-heading');
   grid=doc.createElement('div');grid.className='bbke-household-choices bbke-choice-grid';
   full=doc.createElement('div');full.id='bbkeHouseholdMore';full.className='bbke-household-more';
   for(const node of [...region.children])if(node!==heading)full.append(node);
   region.append(grid,full);
   const presetList=full.querySelector('.bb1749-essential-preset-list');
   const oldPresets=[...presetList?.querySelectorAll('button')||[]];
   for(const node of oldPresets){const name=node.textContent.replace(/^\s*\+\s*/,'').trim();if(!rules.isHousehold(name))node.remove();else{node.dataset.bbkeName=name;grid.append(node);}}
   const form=full.querySelector('#bb307EssentialsForm');
   for(const item of rules.HOUSEHOLD_PREVIEWS){
    let control=[...grid.children].find(node=>node.dataset.bbkeName===item.name);
    if(!control){control=doc.createElement('button');control.type='button';control.dataset.bbkeName=item.name;
     control.addEventListener('click',()=>{
      const saved=window.BBHomeHost?.household?.().find(row=>row.name.toLowerCase()===item.name.toLowerCase());
      if(saved){try{if(window.BBHome?.addHousehold?.(saved.id))return;}catch(error){let notice=region.querySelector('.bbke-household-error');if(!notice){notice=doc.createElement('p');notice.className='bbke-household-error';notice.setAttribute('role','status');region.prepend(notice);}notice.textContent=error.message||'Check the household amounts and try again.';return;}}
      const existing=[...full.querySelectorAll('.bb1749-topup-row')].find(row=>row.querySelector('.bb1749-topup-name')?.textContent.trim().toLowerCase()===item.name.toLowerCase());
      if(existing){existing.querySelector('.bb1749-topup-add').click();return;}
      if(!form)return;form.querySelector('#bb307EssName').value=item.name;form.querySelector('#bb307EssQty').value='1';form.querySelector('#bb307EssUnit').value=item.unit;
      for(const id of['bb307EssProduct','bb307EssBrand','bb307EssPackQty','bb307EssPrice'])form.querySelector('#'+id).value='';form.querySelector('#bb307EssPackUnit').value='';form.requestSubmit();
     });grid.append(control);
    }
   }
   const ordered=rules.previewOrder([...grid.children],rules.HOUSEHOLD_PREVIEWS.map(item=>item.name),node=>node.dataset.bbkeName);
   ordered.forEach(node=>grid.append(node));
   for(const node of grid.children){const item=rules.HOUSEHOLD_PREVIEWS.find(item=>item.name===node.dataset.bbkeName);thumb(node,node.dataset.bbkeName,item?.emoji||'🧼');node.setAttribute('aria-label','Add '+node.dataset.bbkeName+' to shopping list');}
   const selected=full.querySelector('.bb16-ess-selected');if(selected){const details=doc.createElement('details');details.className='bbke-selected-here';details.innerHTML='<summary>Selected household items</summary>';region.append(details);details.append(selected);}
   const draw=()=>{
    const current=state('household'),query=current.search.trim().toLowerCase();let visible=0,eligible=0;
    [...grid.children].forEach(node=>{
     const name=node.dataset.bbkeName,inGroup=!groupUI()||groupUI().matches('essentials',householdKey(name),name),available=inGroup&&(!query||name.toLowerCase().includes(query));
     const on=available&&(current.expanded||eligible<4);if(available)eligible++;
     node.toggleAttribute('data-bbke-choice-hidden',!on);if(on)visible++;
    });
    const bar=region.querySelector(':scope>.bbke-picker-controls');show(full,current.expanded);show(bar.querySelector('input'),current.expanded);show(bar.querySelector('.bbke-search-empty'),!visible);
    text(bar.querySelector('.bbke-add-choice'),current.expanded?'Done':'＋ Add');bar.querySelector('.bbke-add-choice').setAttribute('aria-expanded',String(current.expanded));
   };
   region.bbGroupDraw=draw;controls(region,'household',grid,draw);draw();
   if(form){
    const name=form.querySelector('#bb307EssName');name.placeholder='e.g. shower gel, toothpaste';
    form.addEventListener('submit',event=>{
     if(rules.isHousehold(name.value,form.querySelector('#bb307EssProduct').value)){
      const category=groupUI()?.active('essentials'),api=window.BBPantryGroups,typed=name.value.trim(),before=new Set(window.BBHomeHost?.household?.().map(item=>item.id));
      if(api&&category&&category!=='all'){
       let pin;try{pin=api.context();}catch{}
       if(pin)requestAnimationFrame(()=>{
        const added=window.BBHomeHost?.household?.().find(item=>!before.has(item.id)&&item.name.toLowerCase()===typed.toLowerCase());
        if(!added)return;
        try{api.assign('essentials',added.id,category,pin);}catch{const notice=doc.querySelector('#bbKitchenEssentials .bbpg-status');if(notice)notice.textContent='Item saved. Choose its subcategory again in the item menu.';}
        schedule();
       });
      }
      return;
     }
     event.preventDefault();event.stopImmediatePropagation();let notice=form.querySelector('.bbke-household-error');
     if(!notice){notice=doc.createElement('p');notice.className='bbke-household-error';notice.setAttribute('role','status');form.prepend(notice);}
     notice.textContent='Weekly essentials are for household items, such as toiletries, cleaning products and nappies. Add food or drink in Cupboard, Fridge or Freezer.';name.focus();
    },true);
   }
  }
  groupUI()?.mount(region,'essentials',()=>{region.bbGroupDraw?.();refresh();});
  const heading=region.querySelector('.bb16-essentials-heading'),groupBar=region.querySelector(':scope>.bbpg-controls');
  if(heading&&groupBar&&heading.nextElementSibling!==groupBar)heading.after(groupBar);
  region.bbGroupDraw?.();
  // Older records have no kind field. Keep their ORIGINAL rows and actions
  // accessible in the food area; never delete records or credit pantry stock.
  const legacyRows=[...region.querySelectorAll('.bb1749-topup-row,.bb16-essential-row')].filter(row=>{
   const name=row.querySelector('.bb1749-topup-name,.bb16-essential-info strong')?.textContent||'';return name&&!rules.isHousehold(name);
  });
  let legacy=kitchen.querySelector('#bbKitchenLegacyTopups');
  if(legacyRows.length&&!legacy){legacy=doc.createElement('details');legacy.id='bbKitchenLegacyTopups';legacy.className='bbke-legacy-topups';legacy.open=legacyOpen.value;
   const summary=doc.createElement('summary');summary.textContent='Saved food & other top-ups';const note=doc.createElement('p');note.textContent='Shopping extras saved earlier. Manage their shopping quantities here; these do not add pantry stock.';
   legacy.append(summary,note);legacy.addEventListener('toggle',()=>{if(legacy.isConnected)legacyOpen.value=legacy.open;});kitchen.append(legacy);
  }
  if(legacy)for(const row of legacyRows){const skip=row.querySelector('[data-bb307-skip]');if(skip)text(skip,'Remove from list');legacy.append(row);}
  if(groupUI()){
   let pin;try{pin=JSON.stringify(window.BBPantryGroups.context());}catch{}
   for(const row of region.querySelectorAll('.bb1749-topup-row,.bb16-essential-row')){
    const name=row.querySelector('.bb1749-topup-name,.bb16-essential-info strong')?.textContent.trim(),source=row.querySelector('[data-bb307-skip],[data-bb307-owned],[data-bb307-select],[data-bb307-unown]');
    const id=row.dataset.bbpgEssentialId||source?.dataset.bb307Skip||source?.dataset.bb307Owned||source?.dataset.bb307Select||source?.dataset.bb307Unown;
    if(!name||!id)continue;
    const item=window.BBHomeHost?.household?.().find(item=>item.id===id);
    if(item&&Object.hasOwn(item,'ownedQty')){
     text(row.querySelector('.bb16-essential-info small'),item.ownedQty+' '+item.unit+' at home · '+item.targetQty+' '+item.unit+' needed');
     text(row.querySelector('.bb1749-topup-status'),item.ownedQty+' '+item.unit+' at home');
    }
    row.toggleAttribute('data-bbpg-hidden',!groupUI().matches('essentials',id,name));
    if(pin&&row.dataset.bbpgRevision!==pin){
     const picker=groupUI().picker('essentials',id,name,()=>{refresh();});if(picker){row.querySelector('.bbpg-item-group')?.remove();row.append(picker);row.dataset.bbpgRevision=pin;}
    }
   }
  }
  const selected=region.querySelector('.bb16-ess-selected');if(selected)show(selected,!!selected.querySelector('.bb16-essential-row'));
  const count=region.querySelector('.bb16-ess-count');text(count,(selected?.querySelectorAll('.bb16-essential-row').length||0)+' household items');
  text(region.querySelector('.bb16-essentials-heading h3'),'Household essentials');
  text(region.querySelector('.bb16-essentials-heading p'),'Toiletries, cleaning and baby essentials. Food and drink belong in Cupboard, Fridge or Freezer.');
  const topup=region.querySelector('.bb1749-topup-list');if(topup&&!topup.querySelector('.bb1749-topup-row'))topup.hidden=true;
 }
 function refresh(){
  queued=false;const app=doc.getElementById('app');if(!app)return;
  const tab=doc.body.dataset.bbnextView||doc.querySelector('.shell .tab.active')?.dataset.tab;
  if(tab!=='shop')selectedSection='food';
  if(tab==='week'){
   app.querySelector('#bb1756Essentials')?.remove();
   app.querySelectorAll('[data-bb1756-jump="bb1756Essentials"],[data-bb1759-jump="bb1756Essentials"]').forEach(node=>node.remove());
   const extra=app.querySelector('#bb1756PlannerExtras');
   text(extra?.querySelector('.bb1756-extras-header h2'),'School lunches');
   text(extra?.querySelector('.bb1756-extras-header p'),'Plan school lunches here. Your regular household top-ups are in At home → Weekly essentials.');
   return;
  }
  if(tab!=='shop')return;
  const kitchen=app.querySelector('#bb173ShopFridge'),pantry=kitchen?.querySelector('#bb8WhatIHave');
  if(!kitchen||!pantry)return;
  text(kitchen.querySelector('.bb76-eyebrow'),'AT HOME');
  text(kitchen.querySelector('.bb76-title h2'),'What have you already got?');
  text(kitchen.querySelector('.bb76-title>div>p:last-child'),kitchen.classList.contains('bbpi-enhanced')?'Enter what you have and what you need, then confirm.':'Choose food you have. Set staple status or measured quantities. Valid changes update Shopping automatically.');
  const pantryTitle=kitchen.querySelector('#bb76PantryHeading');
  if(pantryTitle?.firstChild?.nodeType===3&&pantryTitle.firstChild.textContent!=='Review amounts ')pantryTitle.firstChild.textContent='Review amounts ';
  let essentials=app.querySelector('#bbKitchenEssentials');
  if(!essentials){
   essentials=doc.createElement('section');essentials.id='bbKitchenEssentials';
   const summary=doc.createElement('header');summary.className='bbke-essentials-heading';summary.innerHTML='<span class="bbke-essentials-icon" aria-hidden="true">🧺</span><span><strong>Weekly essentials</strong><small>Toiletries, cleaning & baby essentials</small></span>';
   essentials.append(summary);
   essentials.setAttribute('data-bb307-extras','shop');
   kitchen.after(essentials);
  }
  const original=app.querySelector('[data-bb307-extras="shop"].bb16-essentials,[data-bb-kitchen-essentials-controls]');
  if(original&&original.parentNode!==essentials){
   // The legacy ordering pass treats data-bb307-extras as the whole section.
   // Give that marker to its new disclosure so it moves the section together.
   original.removeAttribute('data-bb307-extras');original.setAttribute('data-bb-kitchen-essentials-controls','');
   essentials.append(original);
  }
  if(rules){for(const area of kitchen.querySelectorAll('.bb76-store[data-bb76-store]')){foodChoices(area);selectedReadout(area,kitchen);}refreshGroupPickers(kitchen);if(original)householdChoices(original,kitchen);}
  window.BBHome?.decorate?.(original);
  window.BBHouseholdAmount?.decorate?.(original);
  readableHouseholdOutputs(original);
  kitchen.querySelector('#bb5Reconcile')?.classList.add('bbke-reconcile-top');
  sections(kitchen,essentials);
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
 function start(){
  refresh();const app=doc.getElementById('app');if(!app)return;
  app.addEventListener('input',event=>{if(event.target.matches('[data-bb5-qty],[data-bb5-needed]')||event.target.closest?.('#bbKitchenEssentials .bb-home-quantities'))schedule();});
  app.addEventListener('change',event=>{if(event.target.matches('[data-bb5-unit],[data-bb5-staple-status],[data-bb5-pack-unit]'))schedule();});
  new MutationObserver(records=>{
   if(records.some(record=>record.target===app||record.target.matches?.('[data-bb76-tiles],#bb5SelectedRows')||record.target.closest?.('#bbKitchenEssentials .bb-home-quantities')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('#bb173ShopFridge,[data-bb307-extras="shop"],#bb1756PlannerExtras,#bb1756Essentials,[data-bb5-food]')||node.querySelector?.('#bb173ShopFridge,#bb1756Essentials')))))schedule();
  }).observe(app,{childList:true,subtree:true});
  new MutationObserver(schedule).observe(doc.body,{attributes:true,attributeFilter:['data-bbnext-view']});
  const reset=()=>{selectedSection='food';choices.clear();window.BBPantryGroupsUI?.reset();app.querySelectorAll('[data-bbpg-revision],[data-bbke-values]').forEach(node=>{delete node.dataset.bbpgRevision;delete node.dataset.bbkeValues;});schedule();};
  window.addEventListener('basketboss:session-changed',reset);
  for(const event of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted','basketboss:account-deletion-cancelled'])window.addEventListener(event,reset);
  window.addEventListener('storage',event=>{if(event.key==='basketboss_cloud_session_v1'||event.key==='basketboss_pantry_groups_v1'||event.key===null)reset();});
 }
 window.BBKitchenEssentials=Object.freeze({refresh,loadRules});
 void loadRules();
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
