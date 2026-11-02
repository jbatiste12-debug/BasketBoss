/* Kitchen presentation only. Move the original essentials controls with their
   handlers; pantry quantities, prices and shopping state keep their owners. */
(()=>{'use strict';
 if(window.BBKitchenEssentials)return;
 const doc=document;let queued=false,essentialsOpen=false;
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 function button(label,target){
  const node=doc.createElement('button');node.type='button';node.textContent=label;
  node.addEventListener('click',()=>{
   const destination=doc.getElementById(target);if(!destination)return;
   if(destination.tagName==='DETAILS')destination.open=true;
   destination.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });return node;
 }
 function refresh(){
  queued=false;const app=doc.getElementById('app');if(!app)return;
  const tab=doc.body.dataset.bbnextView||doc.querySelector('.shell .tab.active')?.dataset.tab;
  if(tab==='week'){
   app.querySelector('#bb1756Essentials')?.remove();
   app.querySelectorAll('[data-bb1756-jump="bb1756Essentials"],[data-bb1759-jump="bb1756Essentials"]').forEach(node=>node.remove());
   const extra=app.querySelector('#bb1756PlannerExtras');
   text(extra?.querySelector('.bb1756-extras-header h2'),'School lunches');
   text(extra?.querySelector('.bb1756-extras-header p'),'Plan school lunches here. Your regular household top-ups are in Kitchen → Weekly essentials.');
   return;
  }
  if(tab!=='shop')return;
  const kitchen=app.querySelector('#bb173ShopFridge'),pantry=kitchen?.querySelector('#bb8WhatIHave');
  if(!kitchen||!pantry)return;
  text(kitchen.querySelector('.bb76-eyebrow'),'YOUR KITCHEN');
  text(kitchen.querySelector('.bb76-title h2'),'What’s in your pantry?');
  text(kitchen.querySelector('.bb76-title>div>p:last-child'),'Choose what you have in your cupboard, fridge and freezer. Review the amounts below, then confirm your pantry.');
  const pantryTitle=kitchen.querySelector('#bb76PantryHeading');
  if(pantryTitle?.firstChild?.nodeType===3&&pantryTitle.firstChild.textContent!=='Your pantry ')pantryTitle.firstChild.textContent='Your pantry ';
  let essentials=app.querySelector('#bbKitchenEssentials');
  if(!essentials){
   essentials=doc.createElement('details');essentials.id='bbKitchenEssentials';essentials.open=essentialsOpen;
   const summary=doc.createElement('summary');summary.innerHTML='<span class="bbke-essentials-icon" aria-hidden="true">🧺</span><span><strong>Weekly essentials</strong><small>Everyday items for your shopping list</small></span><span class="bbke-chevron" aria-hidden="true">⌄</span>';
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
  text(original?.querySelector('.bb16-essentials-heading h3'),'Your regular top-ups');
  text(original?.querySelector('.bb16-essentials-heading p'),'Add the everyday food and household items you need this week. These go on your shopping list; they do not add pantry stock.');
  if(!kitchen.querySelector('#bbKitchenSections')){
   const nav=doc.createElement('nav');nav.id='bbKitchenSections';nav.setAttribute('aria-label','Kitchen sections');
   nav.append(button('Choose food','bb76StorageSections'));
   const pantryJump=kitchen.querySelector('#bb76JumpPantry');
   if(pantryJump){
    if(pantryJump.firstChild?.nodeType===3)pantryJump.firstChild.textContent='Your pantry ';
    nav.append(pantryJump);
   }else nav.append(button('Your pantry','bb8WhatIHave'));
   nav.append(button('Weekly essentials','bbKitchenEssentials'));
   kitchen.querySelector('.bb76-kitchen-intro').after(nav);
  }
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
 function start(){
  refresh();const app=doc.getElementById('app');if(!app)return;
  new MutationObserver(records=>{
   if(records.some(record=>record.target===app||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('#bb173ShopFridge,[data-bb307-extras="shop"],#bb1756PlannerExtras,#bb1756Essentials')||node.querySelector?.('#bb173ShopFridge,#bb1756Essentials')))))schedule();
  }).observe(app,{childList:true,subtree:true});
 }
 window.BBKitchenEssentials=Object.freeze({refresh});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
