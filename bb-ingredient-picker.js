/* Ingredient preferences for the next Auto-fill. The original planner owns
 * recipe selection; this disclosure only edits BBIngredientPreferences. */
(function(root){
 'use strict';
 const doc=root.document;
 if(!doc||root.BBIngredientPicker)return;
 let expanded=false,query='',current=null,subscribed=false,lastScope=null,scrollLock=null,viewportFrame=null;
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
 function lockBackground(){
  if(scrollLock)return;
  const html=doc.documentElement;if(!html?.style)return;
  const y=Number(root.scrollY)||0,x=Number(root.scrollX)||0;
  scrollLock={x,y,hadClass:html.classList.contains('bb-avoid-modal-open'),value:html.style.getPropertyValue('--bb-avoid-scroll-top'),priority:html.style.getPropertyPriority?.('--bb-avoid-scroll-top')||''};
  html.style.setProperty('--bb-avoid-scroll-top',-y+'px');html.classList.add('bb-avoid-modal-open');
 }
 function unlockBackground(){
  const previous=scrollLock;if(!previous)return;scrollLock=null;
  const html=doc.documentElement;
  if(previous.value)html.style.setProperty('--bb-avoid-scroll-top',previous.value,previous.priority);else html.style.removeProperty('--bb-avoid-scroll-top');
  if(!previous.hadClass)html.classList.remove('bb-avoid-modal-open');
  try{root.scrollTo?.({top:previous.y,left:previous.x,behavior:'instant'});}catch{root.scrollTo?.(previous.x,previous.y);}
 }
 function sizeViewport(){
  viewportFrame=null;if(!expanded||!current?.panel?.isConnected)return;
  const viewport=root.visualViewport,height=Number(viewport?.height)||Number(root.innerHeight),top=Math.max(0,Number(viewport?.offsetTop)||0);
  if(height>0)current.panel.style.setProperty('--bb-avoid-viewport-height',height+'px');
  current.panel.style.setProperty('--bb-avoid-viewport-top',top+'px');
 }
 function scheduleViewport(){
  if(!expanded||viewportFrame!==null)return;
  if(root.requestAnimationFrame)viewportFrame=root.requestAnimationFrame(sizeViewport);else sizeViewport();
 }
 function cancelViewport(){if(viewportFrame!==null)root.cancelAnimationFrame?.(viewportFrame);viewportFrame=null;}
 function ensureModal(){
  const view=current,panel=view?.panel;if(!expanded||!panel?.isConnected||panel.hidden)return;
  if(panel.open){
   try{if(typeof panel.matches!=='function'||panel.matches(':modal'))return;}catch{
    // Older dialog implementations lack :modal. showModal is a no-op for an
    // already-modal dialog and rejects an open non-modal one.
    try{panel.showModal?.();return;}catch{}
   }
  }
  const active=doc.activeElement,remembered=view.lastFocus;
  const restore=panel.contains?.(active)?active:(active===doc.body||active===doc.documentElement)&&remembered?.isConnected&&panel.contains?.(remembered)?remembered:null;
  // Moving the holder can remove its dialog from the browser's top layer
  // while leaving [open] set. Removing that attribute queues no close event;
  // calling close() instead could later close the repaired dialog again.
  if(panel.open)panel.removeAttribute('open');
  try{if(panel.showModal)panel.showModal();else{panel.setAttribute('open','');panel.open=true;}}catch{panel.setAttribute('open','');panel.open=true;}
  if(restore?.isConnected&&panel.contains?.(restore))restore.focus({preventScroll:true});
 }
 function outsidePanel(panel,event){
  if(event.target!==panel||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY)||!panel.getBoundingClientRect)return false;
  const r=panel.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;
 }
 function retireCurrent(keepLock){
  const old=current;if(!old){if(!keepLock){cancelViewport();unlockBackground();}return;}current=null;
  if(old.panel.contains?.(doc.activeElement))doc.activeElement?.blur?.();
  try{if(old.panel.open)old.panel.close?.();}catch{}
  old.panel.hidden=true;
  if(!keepLock){cancelViewport();unlockBackground();root.BBKeyboardLayout?.releaseAfterDismissal?.();}
 }
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
  const header=create('div','bb-avoid-panel-heading'),heading=create('h2','bb-avoid-heading','Foods to avoid');heading.id='bbAvoidIngredientHeading';
  const close=create('button','bb-avoid-close','×');close.type='button';close.setAttribute('aria-label','Close foods to avoid');close.addEventListener('click',()=>setExpanded(false,true));header.append(heading,close);current.close=close;
  const intro=create('p','bb-avoid-intro','Auto-fill skips these ingredients. Your existing meals stay the same.');
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
  const content=create('div','bb-avoid-content');content.append(intro,current.chips,current.results,current.grid,current.status);
  current.panel.append(header,tools,content,footer);
  current.search=search;renderChoices();
 }
 function setExpanded(value,focus){
  if(!current)return;
  expanded=Boolean(value);
  current.button.setAttribute('aria-expanded',String(expanded));
  current.panel.hidden=!expanded;
  if(expanded){
   buildPanel();lockBackground();sizeViewport();
   ensureModal();
   if(focus)current.close.focus({preventScroll:true});
  }else{
   cancelViewport();if(current.panel.contains?.(doc.activeElement))doc.activeElement?.blur?.();
   try{if(current.panel.open)current.panel.close?.();}catch{}
   unlockBackground();if(focus&&current.button.isConnected)current.button.focus({preventScroll:true});
   root.BBKeyboardLayout?.releaseAfterDismissal?.();
  }
 }
 function mount(){
  const app=doc.querySelector('#app.bbnext-plan'),actions=app?.querySelector('.bbnext-plan-actions');
  if(!app||!actions){expanded=false;query='';retireCurrent(false);return;}
  if(!api())return;
  if(current?.holder.isConnected){if(current.panel.open)ensureModal();return;}
  if(current)retireCurrent(expanded);
  const holder=create('section','bb-ingredient-picker');holder.id='bbIngredientPicker';
  const button=create('button','bb-avoid-tab');button.type='button';button.id='bbAvoidIngredientTab';button.setAttribute('aria-controls','bbAvoidIngredientPanel');button.setAttribute('aria-expanded','false');
  const icon=create('span','bb-avoid-tab-icon');icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const label=create('span','bb-avoid-tab-label','Foods to avoid'),count=create('span','bb-avoid-count'),chevron=create('span','bb-avoid-chevron','⌄');chevron.setAttribute('aria-hidden','true');
  button.append(icon,label,count,chevron);
  const panel=create('dialog','bb-avoid-panel');panel.id='bbAvoidIngredientPanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','bbAvoidIngredientHeading');
  let backdropStart=false;
  panel.addEventListener('pointerdown',event=>{backdropStart=outsidePanel(panel,event);});
  panel.addEventListener('pointercancel',()=>{backdropStart=false;});
  panel.addEventListener('click',event=>{const started=backdropStart;backdropStart=false;if(current?.panel!==panel||!expanded||!outsidePanel(panel,event)||root.PointerEvent&&event.detail>0&&!started)return;event.preventDefault?.();setExpanded(false,true);});
  panel.addEventListener('cancel',event=>{if(current?.panel!==panel)return;event.preventDefault?.();setExpanded(false,true);});
  panel.addEventListener('close',()=>{if(current?.panel===panel&&expanded)setExpanded(false,true);});
  panel.addEventListener('focusin',event=>{if(current?.panel===panel&&panel.contains(event.target))current.lastFocus=event.target;});
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
  root.visualViewport?.addEventListener?.('resize',scheduleViewport);root.visualViewport?.addEventListener?.('scroll',scheduleViewport);root.addEventListener?.('resize',scheduleViewport);
  const app=doc.querySelector('#app');
  if(app&&root.MutationObserver)new root.MutationObserver(mount).observe(app,{childList:true,subtree:true});
 }
 root.BBIngredientPicker=Object.freeze({mount});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window==='undefined'?globalThis:window);
