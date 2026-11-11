/* Kitchen presentation only. Move the original essentials controls with their
   handlers; pantry quantities, prices and shopping state keep their owners. */
(()=>{'use strict';
 if(window.BBKitchenEssentials)return;
 const doc=document;let queued=false,selectedSection='food',rules=null,rulesLoading=null,rulesAttempts=0,rulesGeneration=0,rulesDeadline=null,rulesRelease=null,rulesState='idle',rulesSource=null;
 const choices=new Map(),legacyOpen={value:false};
 const helperURL=new URL('./bb-kitchen-choice-rules.mjs',doc.currentScript?.src||location.href).href;
 const validRules=value=>typeof value?.isHousehold==='function'&&typeof value?.previewOrder==='function'&&!!value.FOOD_PREVIEWS&&Array.isArray(value.HOUSEHOLD_PREVIEWS);
 function rulesStatus(){return Object.freeze({state:rulesState,ready:validRules(rules),source:rulesSource,attempts:rulesAttempts});}
 function announceRules(){try{if(window.CustomEvent&&window.dispatchEvent)window.dispatchEvent(new window.CustomEvent('basketboss:household-rules-state',{detail:rulesStatus()}));}catch{}}
 function publishRules(value,source){
  if(!validRules(value)||source==='fallback'&&rulesSource==='module')return false;
  rules=value;rulesSource=source;rulesState='ready';window.BBKitchenChoiceRules=value;schedule();announceRules();return true;
 }
 function clearRulesDeadline(){if(rulesDeadline!==null){clearTimeout(rulesDeadline);rulesDeadline=null;}}
 function ensureRulesDeadline(){
  if(rulesDeadline!==null)return;
  rulesDeadline=setTimeout(()=>{
   rulesDeadline=null;
   if(!validRules(rules)&&!publishRules(window.BBKitchenChoiceRulesFallback,'fallback')){rulesState='unavailable';announceRules();}
   // Release only the current waiter. An unresolved import cannot trap later
   // explicit/online retries; late imports retain their generation checks.
   rulesRelease?.(validRules(rules)?rules:null);
  },8000);
  rulesDeadline?.unref?.();
 }
 function loadRules(options={}){
  if(rules&&options.refresh!==true)return Promise.resolve(rules);
  if(rulesLoading)return rulesLoading;
  const generation=++rulesGeneration;
  const url=new URL(helperURL);if(rulesAttempts++)url.searchParams.set('bbRulesRetry',String(rulesAttempts));
  let release;
  const pending=new Promise(resolve=>{release=value=>{if(rulesLoading===pending){rulesLoading=null;rulesRelease=null;}resolve(value);};});
  rulesLoading=pending;rulesRelease=release;if(!rules)rulesState='loading';announceRules();ensureRulesDeadline();
  void import(url.href).then(value=>{
   if(generation!==rulesGeneration)return;
   if(validRules(value)){publishRules(value,'module');clearRulesDeadline();release(value);}
   else{if(!rules){rulesState='unavailable';announceRules();}release(rules||null);}
  }).catch(()=>{if(generation!==rulesGeneration)return;if(!rules){rulesState='unavailable';announceRules();}release(rules||null);});
  return pending;
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
 Object.defineProperty(loadRules,'status',{value:rulesStatus});
 window.BBKitchenEssentials=Object.freeze({refresh,loadRules});
 window.addEventListener?.('online',()=>{if(!rules||rulesSource==='fallback')void loadRules({refresh:true});});
 void loadRules();
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

/* BB_KITCHEN_RULES_FALLBACK_GENERATED_START */
(function(realWindow){if(!realWindow)return;const isolated=Object.create(null);(function(window,globalThis,self){
(()=>{var ge=Object.create;var Z=Object.defineProperty;var ke=Object.getOwnPropertyDescriptor;var we=Object.getOwnPropertyNames;var _e=Object.getPrototypeOf,qe=Object.prototype.hasOwnProperty;var ve=(s,u)=>()=>{try{return u||s((u={exports:{}}).exports,u),u.exports}catch(f){throw u=0,f}};var Ce=(s,u,f,y)=>{if(u&&typeof u=="object"||typeof u=="function")for(let m of we(u))!qe.call(s,m)&&m!==f&&Z(s,m,{get:()=>u[m],enumerable:!(y=ke(u,m))||y.enumerable});return s};var Se=(s,u,f)=>(f=s!=null?ge(_e(s)):{},Ce(u||!s||!s.__esModule?Z(f,"default",{value:s,enumerable:!0}):f,s));var Y=ve((Te,$)=>{(function(s,u){"use strict";let f=u();typeof $=="object"&&$.exports&&($.exports=f),s&&(s.BBPantryPolicy=f)})(typeof window>"u"?typeof globalThis>"u"?null:globalThis:window,function(){"use strict";let u=e=>e!==null&&typeof e=="object"&&!Array.isArray(e),f=e=>typeof e=="string"?e.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g," ").toLowerCase().replace(/[–—]/g,"-").replace(/\s+/g," ").trim():"",y=e=>e!=null&&e!==""&&typeof e!="boolean"&&Number.isFinite(Number(e))&&Number(e)>=0&&Number(e)<=1e6?Number(e):null,m=e=>Math.round(e*1e6)/1e6,q={gram:"g",grams:"g",kilogram:"kg",kilograms:"kg",millilitre:"ml",millilitres:"ml",milliliter:"ml",milliliters:"ml",litre:"l",litres:"l",liter:"l",liters:"l",counts:"each",count:"each",unit:"each",units:"each",piece:"each",pieces:"each",item:"each",items:"each",pcs:"each",pc:"each",cloves:"clove",tins:"tin",can:"tin",cans:"tin",packs:"pack",packets:"pack",packet:"pack",bags:"bag",bottles:"bottle",jars:"jar",pouches:"pouch",bunches:"bunch",teaspoon:"tsp",teaspoons:"tsp",tablespoon:"tbsp",tablespoons:"tbsp",pints:"pint",pinches:"pinch",dashes:"dash",cups:"cup",ounce:"oz",ounces:"oz",pound:"lb",pounds:"lb",lbs:"lb","fluid ounce":"fl oz","fluid ounces":"fl oz",floz:"fl oz","us cup":"cup","us cups":"cup","us fl oz":"fl oz"},w=e=>{let i=f(e).replace(/^fl\.?\s*oz\.?$/,"fl oz");return q[i]||i},S=e=>!!e&&!e.includes("|")&&!["__proto__","constructor","prototype"].includes(e)&&e.length<=200,z="(?:\\d+(?:\\.\\d+)?|\\.\\d+)",h="(?:kg|g|ml|l|kilograms?|grams?|millilitres?|milliliters?|litres?|liters?)\\b",K=new RegExp("^(?:(?:about|approx(?:imately)?\\.?|around|roughly|[~≈])\\s*)?(?:"+z+"\\s*[x×]\\s*)?"+z+"(?:\\s*"+h+")?(?:\\s*(?:-|to)\\s*"+z+")?\\s*"+h+"(?:\\s*(?:each|in total|total))?(?:\\s+(tins?|cans?|packs?|packets?|bags?|bottles?|jars?|pouches?))?$");function v(e,i){let n=f(e);if(!S(n))return"";let r=[...new Set(n.match(/\b(?:cooked|frozen|dried|raw|fresh)\b/g)||[])];n=n.replace(/\(([^()]*)\)/g,(b,c)=>{let C=!1,T=c.split(/[,;]/).map(be=>{let G=be.trim(),X=G.match(K);return X?(C=!0,X[1]||""):G}).filter(Boolean);return C?T.length?"("+T.join(", ")+")":" ":"("+c+")"}),n=n.replace(/(?:\b\d+(?:\.\d+)?\s*[x×]\s*)?\b\d+(?:\.\d+)?\s*(?:kg|g|ml|litres?|liters?|l)\b/g," ").replace(/\s+/g," ").trim();let t=[],a=/^(?:optional(?: (?:topping|garnish))?|(?:optional )?(?:to serve|for serving|for (?:the )?(?:topping|garnish|decoration|dusting|greasing)|to garnish|divided)(?: optional)?)$/,l=/^(?:from )?\d+(?:\.\d+)?\s*(?:fillets?|pieces?|slices?|packs?|packets?|bags?|bottles?|jars?|pouches?)$/;n=n.replace(/\(([^)]*)\)/g,(b,c)=>{let C=f(c).replace(/,/g," ").replace(/\s+/g," ").trim(),T=C.match(/^(?:from )?(?:\d+(?:\.\d+)?\s*)?(tins?|cans?)$/);return T?t.push(T[1].startsWith("tin")?"tinned":"canned"):C&&!a.test(C)&&!l.test(C)&&t.push(C)," "}).replace(/\s+/g," ").trim();let k=(b,c)=>(" "+b+" ").includes(" "+c+" "),_=[];for(let b of t){if(k(n,b))continue;let c=n&&k(b,n)?(" "+b+" ").replace(" "+n+" "," ").trim():b;c&&!_.some(C=>k(C,c))&&_.push(c)}if(n=[..._,n].filter(Boolean).join(" "),!S(n))return"";let p=/^fresh tomato(?:es)?$/.test(n),o=r.filter(b=>!(p&&b==="fresh")),d=!o.includes("fresh")&&/^(?:(?:tinned|canned|tin) (?:chopped |whole |plum )?tomato(?:es)?|chopped (?:tinned |canned )?tomato(?:es)?|(?:chopped |whole |plum )?tomato(?:es)? (?:tinned|canned))$/.test(n),I=b=>p?"tomato":d?"chopped tomatoes":b.replace(/^(?:tinned|canned) ((?:(?:red |white |black |kidney |baked |butter |cannellini |borlotti )?beans?|chickpeas?|lentils?))$/,"$1").replace(/^tomato ketchup$/,"ketchup").replace(/^(?:runny|clear) honey$/,"honey"),j=b=>b.replace(/^extra[ -]virgin olive oil$/,"olive oil").replace(/\bground beef\b/g,"beef mince").replace(/\bground turkey\b/g,"turkey mince").replace(/\bzucchini\b/g,"courgette").replace(/\beggplant\b/g,"aubergine").replace(/\bscallions?\b/g,"spring onion"),g=j(I(n));if(typeof i=="function")try{let b=f(i(g));S(b)&&(g=I(b))}catch{}let O={potatoes:"potato",tomatoes:"tomato",carrots:"carrot",onions:"onion","red onions":"red onion","spring onions":"spring onion",courgettes:"courgette",aubergines:"aubergine",cucumbers:"cucumber",shallots:"shallot",eggs:"egg",apples:"apple",bananas:"banana",lemons:"lemon",limes:"lime",oranges:"orange"};g=O[g]||g;for(let b of _){let c=j(b);k(g,c)||(g=c+" "+g)}for(let b of o)new RegExp("\\b"+b+"\\b").test(g)||(g=b+" "+g);return g=j(I(g)),g=O[g]||g,g=g.replace(/^((?:brown|red|white|yellow) )onions$/,"$1onion").replace(/^((?:white|red|yellow|baking|new|baby|maris piper|king edward|charlotte) )potatoes$/,"$1potato"),S(g)?g:""}let se=e=>({leaves:"leaf",knives:"knife",loaves:"loaf",tomatoes:"tomato",potatoes:"potato"})[e]||(/ies$/.test(e)?e.slice(0,-3)+"y":/(?:ches|shes|sses|xes|zes)$/.test(e)?e.slice(0,-2):/s$/.test(e)&&!/(?:ss|us|is)$/.test(e)?e.slice(0,-1):e),A=e=>String(e||"").replace(/^\s*\d+(?:\.\d+)?(?:\s*[x×]\s*)?\s+(?=[\p{L}])/u,"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim().split(/\s+/).filter(Boolean).map(se),oe=new Set(["pork","beef","chicken","fresh","large","medium","small","whole","unsalted","salted","mature","mild","light","dark","white","brown","red","yellow","green","organic","british","unsmoked","smoked","skimmed"]),F=new Set(["vegan","vegetarian","plant","glutenfree","dairyfree","lactosefree","oat","almond","soy","coconut","tinned","dried","frozen","powder","granule","paste","puree","stock","broth","mince","sausage","breast","thigh","rasher","streaky","cooked","raw","leftover","ground","grated","chopped","sliced","diced"]),D=new Set(["cheddar","mozzarella","parmesan","gruyere","gouda","edam","stilton","feta","brie","camembert","manchego","halloumi","ricotta","mascarpone","gorgonzola","roquefort","emmental","pecorino"]);function N(e,i){let n=v(e,i);if(!n)return null;let r=c=>A(c).join(" ").replace(/\b(gluten|dairy|lactose) free\b/g,"$1free").replace(/\bcanned\b/g,"tinned").split(" ").filter(Boolean),t=r(e),a=r(n);n==="chopped tomatoes"&&t.push("tinned");let l=[...new Set([...t,...a].filter(c=>F.has(c)))].sort(),k="";a.at(-1)==="cheese"&&a.slice(0,-1).some(c=>D.has(c))?(k="cheese",a.pop()):a.length===1&&D.has(a[0])&&(k="cheese");let _=a.join(" "),p=a.at(-1)||"",o=a.length>0&&a.every(c=>c===p||F.has(c)),d=a.join(" ").replace(/\b(?:extra virgin|free range|semi skimmed|full fat)\b/g," ").split(/\s+/).filter(c=>c&&!oe.has(c));!d.length&&p&&d.push(p);let j=[t.includes("fresh")&&a.some(c=>/^(?:pasta|penne|fusilli|spaghetti|rigatoni|macaroni|tagliatelle|linguine|farfalle|conchiglie|orecchiette|fettuccine|orzo)$/.test(c))?"wet pasta":"",p==="sugar"&&t.includes("brown")?"brown sugar":""].filter(Boolean).join("|"),g=/\bpeppers?\b/.test(f(e))?R(e,"g",{})?"whole":"seasoning":"";g==="whole"&&d.every(c=>["bell","mixed","pepper"].includes(c))&&d.splice(0,d.length,"pepper");let O=[...l.filter(c=>!d.includes(c)),...d].join(" "),b=p==="butter"&&d.some(c=>["peanut","cashew","cocoa","garlic","nut","seed"].includes(c))||p==="cheese"&&d.some(c=>["cream","cottage"].includes(c))||p==="cream"&&d.some(c=>["ice","soured","sour","clotted","whipping"].includes(c))||p==="potato"&&d.includes("sweet")||p==="onion"&&d.includes("spring")||p==="flour"&&(d.includes("bread")||d.join(" ").includes("self raising"))?d.join(" "):"";return{canonical:n,identity:_,key:O,head:p,category:k,generic:o,protectedKey:l.join("|"),pepperRole:g,compound:b,form:j}}function ce(e,i){return N(e,i)?.key||""}function x(e,i){let n=v(e,i);if(!n)return"";let r=n.replace(/^(?:dry|dried|uncooked) /,"").replace(/ (?:dry|uncooked)$/,"");if(/^(?:(?:basmati|jasmine|white|brown|long[- ]grain|short[- ]grain|easy[- ]cook|arborio|risotto|sushi|pudding) )?rice$/.test(r))return"rice";if(/^(?:pasta|(?:(?:penne|fusilli|spaghetti|rigatoni|macaroni|tagliatelle|linguine|farfalle|conchiglie|orecchiette|fettuccine|orzo)(?: pasta)?))$/.test(r))return"pasta";if(/^(?:(?:brown|red|white|yellow) )?onion$/.test(n))return"onion";if(/^(?:(?:white|red|yellow|baking|new|baby|maris piper|king edward|charlotte) )?potato(?:es)?$/.test(n))return"potato";if(/^(?:(?:whole|semi[- ]skimmed|skimmed|full[- ]fat|fresh) )?milk$/.test(n))return"milk";if(/^(?:(?:grated )?(?:mild |mature |extra mature )?)cheddar$/.test(n))return"cheddar";if(/^(?:(?:plain|all[- ]purpose|plain white) )?flour$/.test(n))return"flour";if(/^(?:(?:white|granulated|white granulated|caster|castor) )?sugar$/.test(n))return"sugar";if(/^(?:(?:sea|table|rock|kosher) )?salt$/.test(n))return"salt";if(/^(?:(?:boneless |skinless |fresh )?chicken breast(?:s| fillets?)?|chicken fillets?)$/.test(n))return"chicken breast";let t=N(e,i);return t&&!t.generic&&t.head?t.head:n}function ue(e,i,n){let r=A(e.canonical),t=A(i.canonical),a=d=>d.length>1&&/^(?:fillet|portion)$/.test(d.at(-1)),l=a(r),k=a(t);if(l===k)return!1;let _=d=>d.filter(I=>/^(?:breaded|battered|crumbed|stuffed)$/.test(I)).sort().join("|");if(_(r)!==_(t))return!1;let p=N((l?r:t).slice(0,-1).join(" "),n),o=l?i:e;return!p||p.protectedKey!==o.protectedKey||p.pepperRole!==o.pepperRole||p.compound!==o.compound||p.form!==o.form?!1:p.identity===o.identity?!0:(p.generic||o.generic)&&(p.key===o.key||p.head===o.head)}function le(e,i,n){let r=N(e,n),t=N(i,n);if(!r||!t||r.protectedKey!==t.protectedKey||r.pepperRole!==t.pepperRole||r.compound!==t.compound||r.form!==t.form)return!1;if(r.identity===t.identity||(r.generic||t.generic)&&(r.key===t.key||r.head===t.head||r.generic&&r.head==="cheese"&&t.category==="cheese"||t.generic&&t.head==="cheese"&&r.category==="cheese"))return!0;let a=x(e,n);return a===x(i,n)&&(r.canonical===a||t.canonical===a)||ue(r,t,n)}function E(e){let i=v(e);return!i||/\b(?:bell peppers?|red peppers?|green peppers?|yellow peppers?|mixed peppers?|chilli peppers?|chili peppers?|peppercorn chicken|peppered (?:beef|steak))\b/.test(i)&&!/\b(?:flakes?|powder|ground|dried)\b/.test(i)||/\b(?:beans?|tomato(?:es)?|meat|chicken|beef|pork|fish|pasta|rice|noodles?|potatoes?)\s+(?:in|with)\s+.*sauce\b/.test(i)||/\b(?:chicken|beef|pork|lamb|turkey|bacon|ham|salmon|fish|tofu|sausages?)\b/.test(i)&&!/(?:^| )fish sauce$/.test(i)&&!/\b(?:powder|seasoning|spice)\b/.test(i)?!1:/^(?:salt|pepper|black pepper|white pepper|ground pepper|sea salt|table salt|rock salt|kosher salt)$/.test(i)||/\b(?:ketchup|mustard|mayonnaise|mayo|honey|vinegar|soy sauce|tamari|worcestershire|worcester sauce|fish sauce|oyster sauce|hot sauce|sriracha|tabasco|barbecue sauce|bbq sauce|brown sauce|sweet chilli sauce|sweet chili sauce|teriyaki sauce|hoisin sauce|salad dressing|condiment)\b/.test(i)||/\b(?:olive|cooking|vegetable|sunflower|rapeseed|sesame|coconut|groundnut|peanut|corn|canola|avocado) oil\b/.test(i)||i==="oil"||/\b(?:dried herbs?|mixed herbs?|dried (?:basil|oregano|thyme|rosemary|parsley|mint|sage)|spices?|seasoning|paprika|ground cumin|cumin|turmeric|ground coriander|coriander powder|cinnamon|nutmeg|allspice|garam masala|curry powder|chilli powder|chili powder|red pepper flakes?|cayenne|ground ginger|garlic powder|onion powder|peppercorns?)\b/.test(i)||!/^fresh /.test(i)&&/\b(?:dressing|herbs?)$/.test(i)?!0:/\bsauce$/.test(i)&&!/^fresh /.test(i)}function R(e,i,n={}){if(n?.staple===!0)return!1;let r=f(e).replace(/([a-z])(\d)/g,"$1 $2");return!/\b(?:peppers?|capsicums?)\b/.test(r)||/\b(?:black|white|ground|cracked|corns?|peppercorns?|powder|dried|flakes?|seasoning|sauce|spice)\b/.test(r)?!1:n?.staple===!1||w(i)==="each"?!0:/\b(?:peppers|capsicums?)\b|\b(?:bell|red|green|yellow|orange|sweet|fresh|whole)\s+pepper\b/.test(r)}function H(e){let i=v(e);return/\b(?:salt|pepper|peppercorns?|paprika|cumin|turmeric|coriander powder|cinnamon|nutmeg|allspice|masala|powder|spice|herb|honey|mustard|jam|paste|peanut butter|pesto)\b/.test(i)?"jar":E(i)?"bottle":"unit"}function de(e){if(!u(e))return!1;let i=e.name||e.key||e.canonicalKey;if(!E(i)||R(i,e.unit,e))return!1;if(e.trackingMode==="measured"&&e.measurementReviewed===!0){let n=J(i,1,e.unit,{market:e.inputMarket||e.market,packReviewed:e.packReviewed===!0,packQuantity:e.packQuantity,packUnit:e.packUnit});if(n&&["g","ml"].includes(n.unit)&&n.estimated!==!0)return!1}return!0}function pe(e,i){if(!u(e)||e.trackingMode!=="measured"||e.measurementReviewed!==!0)return"";let n=e.name||e.key||e.canonicalKey;return E(n)&&v(n,i)==="pepper"?"Name this seasoning separately from whole peppers before saving a measured amount. Its existing stock has been kept.":""}let Ue=e=>e==null||["UK","GB","Guernsey","Jersey"].includes(e),W=Object.freeze({"plain flour":120,"all purpose flour":120,"all-purpose flour":120,"strong white bread flour":120,"self raising flour":120,"self-raising flour":120,flour:120,rice:185,"dry rice":185,"long-grain rice dry":185,"risotto rice":200,"cooked rice":158,oats:90,"rolled oats":90,breadcrumbs:108,"panko breadcrumbs":60,"caster sugar":190,"granulated sugar":200,"icing sugar":120,"light brown sugar":200,"soft brown sugar":200,butter:227,"unsalted butter":227,"cold butter":227,cheddar:113,"grated cheddar":113,"grated cheese":113,parmesan:100,"grated parmesan":100,mozzarella:112,ricotta:246,"cottage cheese":226,"cream cheese":225,"soured cream":240,"greek yoghurt":245,"natural yoghurt":245,yoghurt:245,pesto:240,"chopped tomatoes":240,passata:240,"chopped onion":160,onion:160,"red onion":160,carrot:128,carrots:128,"chopped carrot":128,celery:101,courgette:124,aubergine:82,"mixed peppers":149,"bell peppers":149,peppers:149,mushrooms:70,broccoli:91,spinach:30,"fresh spinach":30,"salad leaves":35,lettuce:36,"romaine lettuce":47,parsley:60,"fresh parsley":60,basil:24,"fresh basil":24,chives:48,cabbage:89,cucumber:104,tomato:180,"cherry tomatoes":149,potato:150,potatoes:150,"sweet potato":133,"frozen peas":145,peas:145,sweetcorn:164,"frozen sweetcorn":164,"kidney beans":177,"mixed beans":177,"butter beans":177,chickpeas:164,chickpea:164,"red lentils":192,"green lentils":192,couscous:173,quinoa:170,"penne pasta":100,penne:100,"dried pasta":100,pasta:100,orzo:180,"pitted dates":147,"chocolate chips":170,"cocoa powder":85,cornflour:128,cornflakes:28,blueberries:148,"dried apricots":130,"sesame seeds":144,"bicarbonate of soda":220,"baking powder":192,"vanilla ice cream":132,"ice cream":132}),P=Object.freeze({aubergine:250,courgette:200,"mixed peppers":160,"bell peppers":160,peppers:160,onion:150,"red onion":150,cucumber:300,"sweet potato":200,"baking potato":200,avocado:150,carrot:80,potato:180,tomato:120,"spring onion":15,shallot:40,lettuce:300,apple:180,banana:120,lemon:100,lime:70,orange:180,broccoli:350,mushroom:20,"cherry tomatoes":15,parsnip:150});function M(e){let i=v(e),n=W[i];return n?{grams:n,estimated:!0,assumption:"Approximate ingredient-specific kitchen weight: 1 US cup (240 ml) "+i+" ≈ "+n+" g. Check preparation and packing."}:null}function Q(e){let i=v(e);return i?E(i)?"staple":/^(?:whole )?eggs?$/.test(i)||/\bgarlic(?: cloves?)?$/.test(i)||/\b(?:wraps?|buns?|pitta breads?|flatbreads?|bread slices?)$/.test(i)?"each":/\b(?:milk|cream|juice|liquid stock|stock|gravy|custard|syrup|extract|water)\b/.test(i)&&!/\b(?:powder|cube|cream cheese|ice cream|soured cream)\b/.test(i)?"ml":"g":null}function V(e,i,n={}){n=u(n)?n:{};let r=v(e,n.canonicalize),t=w(i);if(!r)return null;let a=null,l="g";return t==="tin"&&!/\b(?:fresh|frozen|dried|dry|raw)\b/.test(r)&&/\b(?:tomato(?:es)?|beans?|chickpeas?|lentils?)\b/.test(r)?a=n.market==="US"?411:400:t==="bag"&&!/\b(?:frozen|cooked|dried|dry)\b/.test(r)&&/\b(?:spinach|salad(?: leaves)?|mixed leaves|lettuce)\b/.test(r)?a=200:t==="pack"&&!/\b(?:cooked|ready|dried|dry)\b/.test(r)&&/\b(?:mince|minced (?:beef|pork|lamb|turkey))\b/.test(r)?a=n.market==="US"?454:500:t==="pint"&&/\bmilk\b/.test(r)&&(a=n.market==="US"?473:568,l="ml"),a===null?null:{quantity:a,unit:l,estimated:!0,assumption:"Standard "+(n.market==="US"?"US":"UK")+" default: 1 "+t+" = "+a+" "+l+" for "+r+". Check the actual container size."}}function U(e,i){let n=y(e),r=w(i);if(n===null)return null;let t={g:1,kg:1e3,ml:1,l:1e3,each:1,tbsp:15,tsp:5,oz:28.35,lb:453.6,"fl oz":30},a=t[r];if(a===void 0)return null;let l=m(n*a);return l>1e6||n>0&&l===0?null:{quantity:l,unit:["kg","oz","lb"].includes(r)?"g":["l","tbsp","tsp","fl oz"].includes(r)?"ml":r,estimated:!1,assumption:["tbsp","tsp"].includes(r)?"Standard culinary volume: 1 "+r+" = "+a+" ml.":""}}function fe(e,i,n,r={}){r=u(r)?r:{};let t=v(e,r.canonicalize),a=w(n),l=y(i);if(!t||l===null)return null;if(a==="each"&&(t==="pepper"||t==="peppers")&&(r.wholePepper===!0||R(e,"g",r)))return{quantity:m(l*P.peppers),unit:"g",estimated:!0,assumption:"Estimated "+P.peppers+" g per whole pepper. Review the actual size."};if(a==="cup"){let o=M(t);return o?l*o.grams<=1e6?{quantity:m(l*o.grams),unit:"g",estimated:!0,assumption:o.assumption}:null:(Q(t)==="ml"||E(t))&&l*240<=1e6?{quantity:m(l*240),unit:"ml",estimated:!1,assumption:"US kitchen cup: 1 cup = 240 ml."}:null}if(["loaf","loaves"].includes(a)&&/\bbread\b/.test(t))return{quantity:l*(r.market==="US"?567:800),unit:"g",estimated:!0,assumption:"Estimated regional loaf weight; check the actual loaf."};if(["slice","slices"].includes(a)&&/\bbread\b/.test(t))return{quantity:l*(r.market==="US"?28:50),unit:"g",estimated:!0,assumption:"Estimated regional bread slice weight; check the actual slice."};let k=U(l,a);if(k){if(k.unit==="g"&&(/^(?:whole )?eggs?$/.test(t)||t==="garlic")){let o=t==="garlic"?5:50;return{quantity:m(k.quantity/o),unit:"each",estimated:!0,assumption:"Estimated "+o+" g per "+(t==="garlic"?"garlic clove":"egg")+". Check the actual size."}}if(k.unit==="each"&&P[t])return{quantity:m(l*P[t]),unit:"g",estimated:!0,assumption:"Estimated "+P[t]+" g per whole "+t+". Review the actual size."};if(k.unit==="ml"&&Q(t)==="g"){let o=M(t);return o?{quantity:m(k.quantity*o.grams/240),unit:"g",estimated:!0,assumption:o.assumption}:null}return k}if(["stalk","stalks","stick","sticks"].includes(a)&&t==="celery")return{quantity:l*40,unit:"g",estimated:!0,assumption:"Estimated 40 g per celery stalk. Check the actual size."};if(a==="clove"&&/\bgarlic\b/.test(t))return{quantity:l,unit:"each",estimated:!1,assumption:"1 garlic clove = 1 counted clove."};if(a==="pint"){let o=r.market==="US"?473:568,d=m(l*o);return d<=1e6&&(l===0||d>0)?{quantity:d,unit:"ml",estimated:!1,assumption:(r.market==="US"?"US":"UK")+" pint: 1 pint = "+o+" ml."}:null}if(a==="bulb"&&/\bgarlic\b/.test(t))return{quantity:l*10,unit:"each",estimated:!0,assumption:"Estimated 10 cloves per garlic bulb. Check the actual bulb."};if(!["tin","pack","bag","bottle","jar","pouch","bunch"].includes(a))return null;if(r.reviewed===!0||r.packReviewed===!0){let o=U(r.packQuantity,r.packUnit);if(!o||!(o.quantity>0))return null;let d=m(l*o.quantity);return d>1e6||l>0&&d===0?null:{quantity:d,unit:o.unit,estimated:!1,assumption:"Reviewed contents: 1 "+a+" = "+o.quantity+" "+o.unit+".",packQuantity:o.quantity,packUnit:o.unit}}let _=V(t,a,r);if(!_)return null;let p=m(l*_.quantity);return p>1e6||l>0&&p===0?null:{..._,quantity:p,packQuantity:_.quantity,packUnit:_.unit}}function J(e,i,n,r={}){let t=fe(e,i,n,r);return t&&Number.isFinite(t.quantity)&&t.quantity>=0&&t.quantity<=1e6&&(Number(i)===0||t.quantity>0)?t:null}function me(e,i,n){if(!E(e))return!1;let r=w(n),t=y(i);if(["to taste","as needed"].includes(r))return!0;if(t===null||t<=0)return!1;if(["pinch","dash"].includes(r))return t<=4;let a=U(t,r);return!!a&&(a.unit==="ml"?a.quantity<=60:a.unit==="g"&&a.quantity<=30)}function ye(e={}){if(!u(e))return null;let i=e.name||e.canonicalKey||e.key||e.description;if(!E(i))return null;let n=w(e.unit),r=y(e.quantity),t=null,a=!1;return e.packCount!==void 0&&e.packCount!==null&&e.packCount!==""?t=y(e.packCount):["each","pack","bottle","jar","pouch"].includes(n)?t=r:(r!==null&&r>0&&(U(r,n)||n==="cup")||y(e.packQuantity)>0&&U(e.packQuantity,e.packUnit))&&(t=1,a=!0),t===null||!Number.isInteger(t)||t<=0||t>1e4?null:{quantity:t,unit:"each",label:H(i),estimated:a,assumption:a?"One purchased container assumed for this measured receipt line. Check the container count.":"Purchased container count; contents are tracked by stock status."}}function he(e,i){if(e==null)return"unknown";typeof e=="string"&&(e={status:e});let n=f(e.stapleStatus??e.stockStatus??e.status).replace(/[ _-]+/g," ");if(["in","in stock","available","on hand"].includes(n))return"in";if(["low","running low"].includes(n))return"low";if(["out","out of stock","empty"].includes(n))return"out";if(["unknown","review","needs review"].includes(n))return"unknown";let r=y(e.stapleCount??e.containerCount??e.count??e.qty);if(r!==null)return r>0?"in":"out";if(typeof i=="number"){let t=y(i);if(t!==null)return t>0?"in":"out"}if(i&&typeof i=="object"&&e.bb173StockKey&&Object.hasOwn(i,e.bb173StockKey)){let t=y(i[e.bb173StockKey]);if(t!==null)return t>0?"in":"out"}return"unknown"}return Object.freeze({canonicalName:v,getCanonicalMatchKey:ce,stockFamily:x,stockCompatible:le,isStaple:E,isWholePepper:R,isContainerTracked:de,measuredIdentityProblem:pe,containerLabel:H,defaultPack:V,normalize:J,smallUse:me,staplePurchase:ye,stapleStatus:he,baseUnit:Q,cupGrams:M,cupTable:W,countGrams:P})})});var te=Se(Y(),1),Ke=te.default||globalThis.BBPantryPolicy;var Re=Object.freeze({UK:"GBP",Guernsey:"GBP",Jersey:"GBP",US:"USD"});var Ee=new Set(["each","clove","bulb","tin","pack","bag","bunch","loaf","slice"]),Oe=new Set(["g","ml","tsp","tbsp",...Ee]);var $e=Object.freeze({eggs:"egg",potatoes:"potato",tomatoes:"tomato",onions:"onion",peppers:"pepper",carrots:"carrot",bananas:"banana",apples:"apple",lemons:"lemon",limes:"lime",mushrooms:"mushroom",courgettes:"courgette",scallops:"scallop",wraps:"wrap"}),ee=/\b(?:soap|detergent|washing[ -]up|washing[ -]powder|laundry|fabric[ -](?:softener|conditioner)|dishwasher|dish[ -]?soap|toilet|loo[ -]roll|kitchen[ -](?:roll|towel)|paper[ -]towels?|facial[ -]tissues?|tissues|razors?|shaving[ -](?:foam|gel|cream)|sanitary[ -](?:pads|towels|products)|tampons?|panty[ -]liners?|menstrual[ -](?:pads|cups)|bleach|cleaner|cleaning|disinfectant|saniti[sz]er|shampoo|conditioner|toothpaste|toothbrush|deodorant|shower[ -]gel|body[ -]wash|hand[ -]wash|face[ -]cream|hand[ -]cream|moisturi[sz]er|napp(?:y|ies)|diapers?|wipes|bin[ -](?:bags?|liners?)|foil|cling[ -]film|baking[ -]paper|batter(?:y|ies)|light[ -]bulb|pet[ -]food|cat[ -]food|dog[ -]food|litter|cigarettes?|tobacco)\b/i,ze=/\b(?:refund|returned?|discount|coupon|voucher|loyalty|saving|promotion[ -]discount|subtotal|sub[ -]total|grand[ -]total|vat|tax|change[ -]due|cash[ -]back|deposit[ -]return)\b/i;var L=(s,u=160)=>typeof s=="string"?s.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,u):"",Pe=s=>typeof s=="number"?Number.isFinite(s)?s:null:typeof s!="string"||s.length>40||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s.trim())?null:Number.isFinite(Number(s))?Number(s):null;var Ie=s=>s&&typeof s=="object"&&!Array.isArray(s);function ne(s={}){if(!Ie(s))throw new Error("invalid_receipt_line");let u=L(s.description||s.name||s.rawName,300),f=Pe(s.lineTotal??s.pricePaid??s.price),y=L(s.sourceKind||s.type||s.kind,30).toLowerCase(),m=/^(?:grand[ -])?total(?: due| amount| paid)?(?:\s+[$£€]?\d.*)?$/i.test(u);if(["refund","return","discount","coupon","tax","total","subtotal"].includes(y)||f!==null&&f<0||m||ze.test(u)){let w=["refund","return"].includes(y)||/\b(?:refund|returned?)\b/i.test(u),S=["discount","coupon"].includes(y)||/\b(?:discount|coupon|voucher|loyalty|saving)\b/i.test(u);return{classification:"ignore",sourceKind:w?"refund":y==="tax"||/\b(?:tax|vat)\b/i.test(u)?"tax":m||/total/.test(y)||/\b(?:total|subtotal)\b/i.test(u)?"total":S?"discount":f<0?"refund":"discount",hardExcluded:!0}}if(ee.test(u)||ee.test(L(s.canonicalKey||s.ingredientKey)))return{classification:"essential",sourceKind:"purchase",hardExcluded:!0};let q=s.classification||s.kind;return{classification:["food","essential","ignore","pending"].includes(q)?q:q==="unknown"?"pending":s.canonicalKey||s.ingredientKey?"food":"pending",sourceKind:"purchase",hardExcluded:!1}}var ie=Object.freeze({cupboard:["Rice","Pasta","Cooking oil","Tinned tomatoes"],fridge:["Milk","Eggs","Cheddar","Butter"],freezer:["Frozen peas","Frozen mixed vegetables","Frozen chips","Frozen fish"]}),B=Object.freeze([{name:"Toilet rolls",unit:"pack",emoji:"🧻"},{name:"Toothpaste",unit:"each",emoji:"🪥"},{name:"Laundry detergent",unit:"pack",emoji:"🧺"},{name:"Nappies",unit:"pack",emoji:"👶"}]);function re(s,u=""){let f=String(s||"")+" "+String(u||""),y=h=>{let K=ne({description:h});return K.classification==="essential"&&K.hardExcluded===!0};if(y(f))return!0;let m=f.slice(0,300).normalize("NFKC").replace(/([\p{Ll}\p{N}])(\p{Lu})/gu,"$1 $2").toLowerCase().replace(/[-–—_/]+/g," ").replace(/[^\p{L}\p{N}\s']/gu," ").replace(/\s+/g," ").trim(),q=h=>/ies$/.test(h)?h.slice(0,-3)+"y":/(?:ches|shes|sses|xes|zes)$/.test(h)?h.slice(0,-2):/s$/.test(h)&&!/(?:ss|us|is)$/.test(h)?h.slice(0,-1):h,w=m.split(" ").filter(Boolean).map(q),S=new Set([m,w.join(" ")]);for(let h=0;h<w.length-1;h++)S.add([...w.slice(0,h),w[h]+w[h+1],...w.slice(h+2)].join(" "));let z=new Set(B.map(h=>h.name.toLowerCase().split(/\s+/).map(q).join("")));return z.has(w.join(""))||w.some(h=>z.has(h))?!0:[...S].some(y)}function ae(s,u,f){let y=u.map(m=>s.find(q=>f(q).toLowerCase()===m.toLowerCase())).filter(Boolean);return[...y,...s.filter(m=>!y.includes(m))]}window.BBKitchenChoiceRulesFallback=Object.freeze({isHousehold:re,previewOrder:ae,FOOD_PREVIEWS:ie,HOUSEHOLD_PREVIEWS:B});})();

})(isolated,isolated,isolated);const rules=isolated.BBKitchenChoiceRulesFallback;if(rules)realWindow.BBKitchenChoiceRulesFallback=rules;})(typeof window!=="undefined"?window:null);
/* BB_KITCHEN_RULES_FALLBACK_GENERATED_END */
