/* Kitchen presentation only. Move the original essentials controls with their
   handlers; pantry quantities, prices and shopping state keep their owners. */
(()=>{'use strict';
 if(window.BBKitchenEssentials)return;
 const doc=document;let queued=false,essentialsOpen=false,rules=null;
 const choices=new Map(),legacyOpen={value:false};
 const helperURL=new URL('./bb-kitchen-choice-rules.mjs',doc.currentScript?.src||location.href).href;
 import(helperURL).then(value=>{rules=value;window.BBKitchenChoiceRules=value;schedule();}).catch(()=>{});
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 function button(label,target){
  const node=doc.createElement('button');node.type='button';node.textContent=label;
  node.addEventListener('click',()=>{
   const destination=doc.getElementById(target);if(!destination)return;
   if(destination.tagName==='DETAILS')destination.open=true;
   destination.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });return node;
 }
 function state(key){if(!choices.has(key))choices.set(key,{expanded:false,search:''});return choices.get(key);}
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
  add.addEventListener('click',()=>{const current=state(key);current.expanded=!current.expanded;current.search='';search.value='';draw();if(current.expanded)search.focus();});
  grid.before(bar);bar.append(search,grid,add,empty);return bar;
 }
 function foodChoices(area){
  const key=area.dataset.bb76Store,grid=area.querySelector('[data-bb76-tiles]'),body=area.querySelector('.bb76-store-body');if(!grid||!body)return;
  const draw=()=>{
   const current=state(key),items=[...grid.querySelectorAll('[data-bb5-food]')];
   const ordered=rules.previewOrder(items,rules.FOOD_PREVIEWS[key]||[],node=>node.dataset.bb5Food);
   ordered.forEach((node,index)=>{if(grid.children[index]!==node)grid.insertBefore(node,grid.children[index]||null);});
   const query=current.search.trim().toLowerCase();let visible=0;
   ordered.forEach((node,index)=>{const show=current.expanded?(!query||node.dataset.bb5Food.toLowerCase().includes(query)):index<4;node.toggleAttribute('data-bbke-choice-hidden',!show);if(show)visible++;});
   body.dataset.bbkeExpanded=String(current.expanded);grid.classList.add('bbke-choice-grid');
   const bar=body.querySelector(':scope>.bbke-picker-controls');if(!bar)return;
   show(bar.querySelector('input'),current.expanded);show(bar.querySelector('.bbke-search-empty'),current.expanded&&!visible);
   const add=bar.querySelector('.bbke-add-choice');text(add,current.expanded?'Done':'＋ Add');add.setAttribute('aria-expanded',String(current.expanded));
  };
  controls(body,key,grid,draw);draw();
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
  const values=rows.map(row=>{const name=row.querySelector('strong').textContent,amount=row.querySelector('[data-bb5-qty]').value,unit=row.querySelector('[data-bb5-unit]').value;const needed=row.querySelector('[data-bb5-needed]')?.value,buy=row.querySelector('output')?.textContent;return name+' · '+(amount.trim()?amount+' '+unit+' already got':'Amount unknown')+(needed!==undefined?' · '+needed+' '+unit+' needed':'')+(buy?' · '+buy+' '+unit:'');});
  const stamp=JSON.stringify(values);
  if(details.dataset.bbkeValues!==stamp){details.dataset.bbkeValues=stamp;text(details.querySelector('summary'),'Selected here ('+values.length+')');const list=details.querySelector('ul');list.replaceChildren();for(const value of values){const li=doc.createElement('li');li.textContent=value;list.append(li);}if(!values.length){const li=doc.createElement('li');li.textContent='Nothing selected here yet.';list.append(li);}}
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
    const current=state('household'),query=current.search.trim().toLowerCase();let visible=0;
    [...grid.children].forEach((node,index)=>{const on=current.expanded?(!query||node.dataset.bbkeName.toLowerCase().includes(query)):index<4;node.toggleAttribute('data-bbke-choice-hidden',!on);if(on)visible++;});
    const bar=region.querySelector(':scope>.bbke-picker-controls');show(full,current.expanded);show(bar.querySelector('input'),current.expanded);show(bar.querySelector('.bbke-search-empty'),current.expanded&&!visible);
    text(bar.querySelector('.bbke-add-choice'),current.expanded?'Done':'＋ Add');bar.querySelector('.bbke-add-choice').setAttribute('aria-expanded',String(current.expanded));
   };
   controls(region,'household',grid,draw);draw();
   if(form){
    const name=form.querySelector('#bb307EssName');name.placeholder='e.g. shower gel, toothpaste';
    form.addEventListener('submit',event=>{
     if(rules.isHousehold(name.value,form.querySelector('#bb307EssProduct').value))return;
     event.preventDefault();event.stopImmediatePropagation();let notice=form.querySelector('.bbke-household-error');
     if(!notice){notice=doc.createElement('p');notice.className='bbke-household-error';notice.setAttribute('role','status');form.prepend(notice);}
     notice.textContent='Weekly essentials are for household items, such as toiletries, cleaning products and nappies. Add food or drink in Cupboard, Fridge or Freezer.';name.focus();
    },true);
   }
  }
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
  const selected=region.querySelector('.bb16-ess-selected');if(selected)show(selected,!!selected.querySelector('.bb16-essential-row'));
  const count=region.querySelector('.bb16-ess-count');text(count,(selected?.querySelectorAll('.bb16-essential-row').length||0)+' household items');
  text(region.querySelector('.bb16-essentials-heading h3'),'Household essentials');
  text(region.querySelector('.bb16-essentials-heading p'),'Toiletries, cleaning and baby essentials. Food and drink belong in Cupboard, Fridge or Freezer.');
  const topup=region.querySelector('.bb1749-topup-list');if(topup&&!topup.querySelector('.bb1749-topup-row'))topup.hidden=true;
 }
 function refresh(){
  queued=false;const app=doc.getElementById('app');if(!app)return;
  const tab=doc.body.dataset.bbnextView||doc.querySelector('.shell .tab.active')?.dataset.tab;
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
  text(kitchen.querySelector('.bb76-title>div>p:last-child'),'Choose what you have in your cupboard, fridge and freezer. Review the amounts below, then confirm your pantry.');
  const pantryTitle=kitchen.querySelector('#bb76PantryHeading');
  if(pantryTitle?.firstChild?.nodeType===3&&pantryTitle.firstChild.textContent!=='Review amounts ')pantryTitle.firstChild.textContent='Review amounts ';
  let essentials=app.querySelector('#bbKitchenEssentials');
  if(!essentials){
   essentials=doc.createElement('details');essentials.id='bbKitchenEssentials';essentials.open=essentialsOpen;
   const summary=doc.createElement('summary');summary.innerHTML='<span class="bbke-essentials-icon" aria-hidden="true">🧺</span><span><strong>Weekly essentials</strong><small>Toiletries, cleaning & baby essentials</small></span><span class="bbke-chevron" aria-hidden="true">⌄</span>';
   essentials.append(summary);
   essentials.addEventListener('toggle',()=>{if(essentials.isConnected)essentialsOpen=essentials.open;});
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
  if(rules){for(const area of kitchen.querySelectorAll('.bb76-store[data-bb76-store]')){foodChoices(area);selectedReadout(area,kitchen);}if(original)householdChoices(original,kitchen);}
  window.BBHome?.decorate?.(original);
  if(!kitchen.querySelector('#bbKitchenSections')){
   const nav=doc.createElement('nav');nav.id='bbKitchenSections';nav.setAttribute('aria-label','At home sections');
   nav.append(button('Choose food','bb76StorageSections'));
   const pantryJump=kitchen.querySelector('#bb76JumpPantry');
   if(pantryJump){
    if(pantryJump.firstChild?.nodeType===3)pantryJump.firstChild.textContent='Your pantry ';
    nav.append(pantryJump);
   }else nav.append(button('Your pantry','bb8WhatIHave'));
   nav.append(button('Weekly essentials','bbKitchenEssentials'));
   kitchen.querySelector('.bb76-kitchen-intro').after(nav);
  }
  const reconcile=kitchen.querySelector('#bb5Reconcile'),nav=kitchen.querySelector('#bbKitchenSections');
  if(reconcile&&nav&&nav.nextElementSibling!==reconcile){nav.after(reconcile);reconcile.classList.add('bbke-reconcile-top');}
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
 function start(){
  refresh();const app=doc.getElementById('app');if(!app)return;
  app.addEventListener('input',event=>{if(event.target.matches('[data-bb5-qty],[data-bb5-needed]'))schedule();});
  app.addEventListener('change',event=>{if(event.target.matches('[data-bb5-unit]'))schedule();});
  new MutationObserver(records=>{
   if(records.some(record=>record.target===app||record.target.matches?.('[data-bb76-tiles]')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('#bb173ShopFridge,[data-bb307-extras="shop"],#bb1756PlannerExtras,#bb1756Essentials,[data-bb5-food]')||node.querySelector?.('#bb173ShopFridge,#bb1756Essentials')))))schedule();
  }).observe(app,{childList:true,subtree:true});
 }
 window.BBKitchenEssentials=Object.freeze({refresh});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
