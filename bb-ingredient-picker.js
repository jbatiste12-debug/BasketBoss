/* Ingredient preferences for the next Auto-fill. The original planner owns
 * recipe selection; this disclosure only edits BBIngredientPreferences. */
(function(root){
 'use strict';
 const doc=root.document;
 if(!doc||root.BBIngredientPicker)return;
 let expanded=false,query='',current=null,subscribed=false,lastScope=null;
 const create=(tag,className,text)=>{
  const node=doc.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
 };
 const api=()=>root.BBIngredientPreferences;
 const selected=()=>new Set(api()?.getSelected()||[]);
 const catalogue=()=>api()?.CATALOG||[];
 const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('en-GB').trim();
 function artwork(food){
  const photo=create('span','bb-avoid-photo');photo.setAttribute('aria-hidden','true');
  if(typeof food.image==='string'&&/^food-thumbs\/[a-z0-9_/-]+\.(?:webp|png|avif)$/.test(food.image)){
   const image=create('img');image.src=food.image;image.alt='';image.loading='lazy';image.decoding='async';image.width=64;image.height=64;photo.append(image);
  }else if(root.BBFoodVisuals?.html){
   photo.innerHTML=root.BBFoodVisuals.html(food.thumbnail||food.name,{emoji:food.emoji||'🥣'});
  }else photo.textContent=food.emoji||'🥣';
  return photo;
 }
 function announce(message,error=false){
  if(!current)return;
  current.status.textContent=message;
  current.status.classList.toggle('is-error',error);
 }
 function save(ids,message){
  let result;
  try{result=api()?.setSelected(ids);}catch(_){result=null;}
  if(!result?.ok){announce('Could not save your ingredients. Please try again.',true);return false;}
  updateSelection();
  announce(message);
  return true;
 }
 function toggleIngredient(food){
  const ids=selected(),wasSelected=ids.has(food.id);
  if(wasSelected)ids.delete(food.id);else ids.add(food.id);
  save([...ids],wasSelected?food.name+' can be used in future Auto-fill.':food.name+' will be left out of future Auto-fill.');
 }
 function updateSelection(){
  if(!current)return;
  const ids=selected(),count=ids.size;
  current.count.textContent=count?count+' selected':'None selected';
  current.button.classList.toggle('has-selection',count>0);
  current.clear.disabled=count===0;
  if(!current.built)return;
  current.chips.replaceChildren();
  current.chips.hidden=count===0;
  for(const food of catalogue().filter(item=>ids.has(item.id))){
   const chip=create('button','bb-avoid-chip',food.name+' ×');chip.type='button';
   chip.setAttribute('aria-label','Allow '+food.name+' in Auto-fill');
   chip.addEventListener('click',()=>toggleIngredient(food));current.chips.append(chip);
  }
  for(const tile of current.grid.querySelectorAll('[data-bb-avoid-id]')){
   const active=ids.has(tile.dataset.bbAvoidId);
   tile.setAttribute('aria-pressed',String(active));
   const state=tile.querySelector('.bb-avoid-tile-state');
   if(state)state.textContent=active?'✓ Avoiding':'Tap to avoid';
  }
 }
 function renderChoices(){
  if(!current?.built)return;
  const term=normalize(query),foods=catalogue().filter(food=>!term||normalize(food.name+' '+food.group+' '+(food.searchTerms||[]).join(' ')).includes(term));
  current.grid.replaceChildren();
  const groups=new Map();
  for(const food of foods){
   const group=food.group||'Ingredients';
   if(!groups.has(group))groups.set(group,[]);
   groups.get(group).push(food);
  }
  for(const [group,items]of groups){
   const section=create('section','bb-avoid-group'),heading=create('h4','bb-avoid-group-title',group),tiles=create('div','bb-avoid-tiles');
   for(const food of items){
    const tile=create('button','bb-avoid-tile');tile.type='button';tile.dataset.bbAvoidId=food.id;
    tile.setAttribute('aria-pressed','false');tile.setAttribute('aria-label','Avoid '+food.name+' in Auto-fill');
    tile.append(artwork(food),create('span','bb-avoid-tile-name',food.name),create('span','bb-avoid-tile-state','Tap to avoid'));
    tile.addEventListener('click',()=>toggleIngredient(food));tiles.append(tile);
   }
   section.append(heading,tiles);current.grid.append(section);
  }
  current.results.textContent=foods.length?foods.length+' ingredient'+(foods.length===1?'':'s')+' shown.':'No ingredients found. Try a different name.';
  updateSelection();
 }
 function buildPanel(){
  if(!current||current.built)return;
  current.built=true;
  const intro=create('p','bb-avoid-intro','Choose ingredients you don’t eat or enjoy. Auto-fill will leave out recipes containing them. Your existing meals stay in your plan.');
  const tools=create('div','bb-avoid-tools'),label=create('label','bb-avoid-search-label','Find an ingredient');
  label.htmlFor='bbAvoidIngredientSearch';
  const search=create('input','bb-avoid-search');search.type='search';search.id='bbAvoidIngredientSearch';search.placeholder='Search ingredients';search.autocomplete='off';search.value=query;
  search.addEventListener('input',()=>{query=search.value;renderChoices();});
  tools.append(label,search);
  current.chips=create('div','bb-avoid-selected');current.chips.setAttribute('aria-label','Ingredients to avoid');
  current.results=create('p','bb-avoid-results');current.results.setAttribute('role','status');current.results.setAttribute('aria-live','polite');
  current.grid=create('div','bb-avoid-options');
  const footer=create('div','bb-avoid-footer');
  const done=create('button','bb-avoid-done','Done');done.type='button';done.addEventListener('click',()=>setExpanded(false,true));
  footer.append(current.clear,done);
  current.panel.append(intro,tools,current.chips,current.results,current.grid,current.status,footer);
  current.search=search;renderChoices();
 }
 function setExpanded(value,focus){
  if(!current)return;
  expanded=Boolean(value);
  current.button.setAttribute('aria-expanded',String(expanded));
  current.panel.hidden=!expanded;
  if(expanded){buildPanel();if(focus)current.search.focus({preventScroll:true});}
  else if(focus)current.button.focus({preventScroll:true});
 }
 function mount(){
  const app=doc.querySelector('#app.bbnext-plan'),actions=app?.querySelector('.bbnext-plan-actions');
  if(!app||!actions){expanded=false;query='';current=null;return;}
  if(!api())return;
  if(current?.holder.isConnected)return;
  const holder=create('section','bb-ingredient-picker');holder.id='bbIngredientPicker';
  const button=create('button','bb-avoid-tab');button.type='button';button.id='bbAvoidIngredientTab';button.setAttribute('aria-controls','bbAvoidIngredientPanel');button.setAttribute('aria-expanded','false');
  const icon=create('span','bb-avoid-tab-icon');icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const label=create('span','bb-avoid-tab-label','Ingredients to avoid'),count=create('span','bb-avoid-count'),chevron=create('span','bb-avoid-chevron','⌄');chevron.setAttribute('aria-hidden','true');
  button.append(icon,label,count,chevron);
  const panel=create('div','bb-avoid-panel');panel.id='bbAvoidIngredientPanel';panel.hidden=true;panel.setAttribute('role','region');panel.setAttribute('aria-labelledby',button.id);
  const clear=create('button','bb-avoid-clear','Clear all');clear.type='button';clear.disabled=true;clear.addEventListener('click',()=>save([],'All ingredients can be used in future Auto-fill.'));
  const status=create('p','bb-avoid-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  current={holder,button,count,panel,clear,status,built:false};holder.append(button,panel);actions.after(holder);
  button.addEventListener('click',()=>setExpanded(!expanded,true));
  holder.addEventListener('keydown',event=>{if(event.key==='Escape'&&expanded){event.preventDefault();setExpanded(false,true);}});
  updateSelection();if(expanded)setExpanded(true,false);
  if(!subscribed){
   subscribed=true;lastScope=api().scope?.();
   api().subscribe?.(change=>{
    if(change.scope!==lastScope){lastScope=change.scope;query='';if(current){setExpanded(false,false);if(current.search)current.search.value='';if(current.built)renderChoices();}}
    updateSelection();
   });
  }
 }
 function start(){
  mount();
  const app=doc.querySelector('#app');
  if(app&&root.MutationObserver)new root.MutationObserver(mount).observe(app,{childList:true,subtree:true});
 }
 root.BBIngredientPicker=Object.freeze({mount});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window==='undefined'?globalThis:window);
