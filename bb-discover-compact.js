/* Discover presentation only. Original controls, recipe data, filtering and
   swipe handlers stay with their existing owners. No account or stock writes. */
(()=>{'use strict';
 const win=window,doc=document;if(win.BBDiscoverCompact)return;
 const panels=new WeakSet(),photos=new WeakSet();let queued=false;
 const make=(tag,cls,text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
 function searchPanel(app){
  const panel=app.querySelector('.bb16-filter-panel');if(!panel||panels.has(panel))return;
  const browse=panel.querySelector('.bb16-filter-categories'),toggle=panel.querySelector('.bb16-toggle-filters');
  if(!browse||!toggle)return;
  // Show the existing category rail initially; its original Browse/Hide
  // handler continues to own all subsequent disclosure interactions.
  panels.add(panel);browse.hidden=false;toggle.textContent='Hide categories';toggle.setAttribute('aria-expanded','true');
  const rail=panel.querySelector('.bb16-category-grid'),selected=rail?.querySelector('.btn.primary');
  if(rail&&selected){const outer=rail.getBoundingClientRect(),inner=selected.getBoundingClientRect();rail.scrollLeft+=inner.left-outer.left-(outer.width-inner.width)/2;}
 }
 function hero(app){
  const card=app.querySelector('.bb-featured-card'),photo=card?.querySelector('#swipeCard');
  const body=card?.querySelector('.recipe-body'),title=body?.querySelector('h3'),cook=card?.querySelector('#cookRecipe');
  if(!photo||!title||!cook)return;
  let copy=photo.querySelector(':scope>.bbdc-hero-copy');
  if(!copy){
   copy=make('div','bbdc-hero-copy');copy.setAttribute('aria-hidden','true');
   copy.append(make('div','bbdc-hero-title'),make('div','bbdc-hero-meta'));photo.append(copy);
  }
  text(copy.querySelector('.bbdc-hero-title'),title.textContent.trim());
  const duration=photo.querySelector(':scope>.time-pill')?.textContent.trim()||'';
  const ingredients=[...body.querySelectorAll(':scope>.chips>.chip')].find(node=>/ingredients?/i.test(node.textContent));
  text(copy.querySelector('.bbdc-hero-meta'),[duration,ingredients?.textContent.trim()].filter(Boolean).join(' · '));
  // Favourites still reads .recipe-body h3. Keep that original node and all
  // other bound recipe text in place; only its visual duplicate is hidden.
  title.classList.add('bbdc-duplicate');
  body.querySelector(':scope>.eyebrow')?.classList.add('bbdc-duplicate');
  ingredients?.parentElement.classList.add('bbdc-duplicate');
  photo.querySelector(':scope>.time-pill')?.classList.add('bbdc-duplicate');
  photo.querySelector(':scope>.pill')?.classList.add('bbdc-duplicate');
  // Exact duration already appears on the photo. Remove only redundant
  // time/category labels, retaining distinct benefit information and tips.
  const category=photo.querySelector(':scope>.pill')?.textContent.trim().toLowerCase();
  for(const badge of card.querySelectorAll('.bb-discover-benefit')){
   if(/^\d+\s*mins? or less$/i.test(badge.textContent.trim())||badge.textContent.trim().toLowerCase()===category)badge.classList.add('bbdc-duplicate');
  }
  if(!body.querySelector(':scope>.bbdc-recipe-notes')){
   const notes=[...body.children].filter(node=>node.matches('.bb-discover-benefits,.tip,.swipe-guide'));
   if(notes.length){
    const disclosure=make('details','bbdc-recipe-notes');disclosure.append(make('summary','', 'Recipe notes & swipe tips'));
    for(const node of notes)disclosure.append(node);body.append(disclosure);
   }
  }
  if(photos.has(photo))return;photos.add(photo);
  const open=make('button','bbdc-photo-open');open.type='button';
  open.setAttribute('aria-label','View recipe and cook '+title.textContent.trim());
  let gesture=null;
  // These observers do not prevent or replace the original swipe listeners.
  // A cancelled drag, vertical scroll or horizontal swipe cannot become Cook.
  open.addEventListener('pointerdown',event=>{gesture=event.isPrimary!==false&&event.button===0?{id:event.pointerId,x:event.clientX,y:event.clientY,moved:false}:null;},true);
  const track=event=>{if(gesture&&event.pointerId===gesture.id&&(Math.abs(event.clientX-gesture.x)>12||Math.abs(event.clientY-gesture.y)>12))gesture.moved=true;};
  open.addEventListener('pointermove',track,true);open.addEventListener('pointerup',track,true);
  open.addEventListener('pointercancel',()=>{gesture=null;},true);
  open.addEventListener('click',event=>{
   const tap=event.detail===0||gesture&&!gesture.moved;gesture=null;
   if(!tap||!photo.isConnected||!cook.isConnected||doc.body.dataset.bbnextView!=='discover')return;
   cook.click();
  });
  photo.append(open);
 }
 function gallery(app){
  for(const card of app.querySelectorAll('.grid-recipes>.mini-recipe')){
   const photo=card.querySelector(':scope>.mini-img'),time=card.querySelector('.bb18-recipe-meta');
   if(photo&&time&&time.parentElement!==photo)photo.append(time);
   // Category and time repeat the browsing rail / photo. Other benefits stay.
   for(const badge of card.querySelectorAll('.bb-discover-benefit.bb-discover-editorial'))badge.classList.add('bbdc-duplicate');
   for(const badge of card.querySelectorAll('.bb-discover-benefit'))if(/^\d+\s*mins? or less$/i.test(badge.textContent.trim()))badge.classList.add('bbdc-duplicate');
  }
 }
 function refresh(){
  queued=false;if(doc.body.dataset.bbnextView!=='discover')return;
  const app=doc.getElementById('app');if(!app)return;
  searchPanel(app);hero(app);gallery(app);
 }
 // These wrappers read the already-rendered recipe. They must settle before
 // paint rather than briefly showing the unstyled legacy card on each visit.
 function schedule(){if(queued)return;queued=true;win.queueMicrotask(refresh);}
 function start(){
  const app=doc.getElementById('app');if(!app)return;
  new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
  new MutationObserver(schedule).observe(doc.body,{attributes:true,attributeFilter:['data-bbnext-view']});refresh();
 }
 win.BBDiscoverCompact=Object.freeze({refresh});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
