/* Cook presentation only. Ingredient state, requests and Premium checks belong
 * to the existing Make a Meal controllers; this view never writes user data. */
(function(root){
 'use strict';
 const mounted=new WeakMap();
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const paths={
  sparkle:'<path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z"/><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7L20 2Z"/>',
  camera:'<path d="M8 5 9.5 3h5L16 5h4a2 2 0 0 1 2 2v12H2V7a2 2 0 0 1 2-2h4Z"/><circle cx="12" cy="12" r="4"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="m5 12 4 4L19 6"/>'
 };
 const icon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths[name]+'</svg>';
 function mount({hub,workspace,getIngredients}={}){
  if(!hub||!workspace||typeof getIngredients!=='function')return null;
  if(mounted.has(hub)){const controller=mounted.get(hub);controller.refresh();return controller;}
  hub.classList.add('bb-cook-studio');
  root.document.body.classList.add('bb-cook-studio-page');
  hub.setAttribute('aria-label','Cook and Premium AI tools');
  hub.innerHTML=`<div class="bbcs-intro"><p class="bbcs-eyebrow">YOUR EVERYDAY KITCHEN</p><h1>What’s cooking?</h1><p>A little inspiration. A lot less food waste.</p></div>
   <section class="bbcs-hero" aria-label="Premium AI tools">
    <div class="bbcs-hero-top"><span class="bbcs-studio">${icon('sparkle')} BASKETBOSS AI STUDIO</span><span class="bbcs-premium">Premium tools</span></div>
    <div class="bbcs-hero-body"><div class="bbcs-hero-copy"><h2>Make a little<br>kitchen <em>magic.</em></h2><p>Turn the food you have into your next great meal.</p></div><div class="bbcs-food-orbit"><img class="bbcs-hero-food" src="release-assets/basketboss-v17/images/existing/creamy-pasta.webp" alt="" width="174" height="174" decoding="async"><span class="bbcs-spark bbcs-spark-one" aria-hidden="true">✦</span><span class="bbcs-spark bbcs-spark-two" aria-hidden="true">✧</span></div><span class="bbcs-orbit-caption" aria-hidden="true">A pinch of inspiration ✦</span></div>
    <div class="bbcs-actions"><label class="bbcs-action bbcs-scan bb-ai-native-trigger" data-ai-scan-btn for="ai-photo-input" role="button" tabindex="0" aria-controls="bbToolStage" aria-expanded="false"><span class="bbcs-action-icon">${icon('camera')}</span><span class="bbcs-action-arrow">${icon('arrow')}</span><strong>Scan my food</strong><small>Photo → ingredient suggestions</small></label><button class="bbcs-action bbcs-create" type="button" data-ai-meal-btn data-open-tool="meal" aria-controls="bbToolStage" aria-expanded="false"><span class="bbcs-action-icon">${icon('sparkle')}</span><span class="bbcs-action-arrow">${icon('arrow')}</span><strong>Create a meal</strong><small>Your ingredients → a fresh idea</small></button></div>
   </section>
   <p class="bbcs-review-note">${icon('check')}You review every suggestion before anything is saved.</p>
   <section class="bbcs-selected" aria-labelledby="bbcsIngredientsTitle"><div class="bbcs-section-heading"><h2 id="bbcsIngredientsTitle">Your ingredients <span data-bbcs-count></span></h2><button class="bbcs-text-button" type="button" data-bbcs-edit>Edit →</button></div><div class="bbcs-ingredients" data-bbcs-ingredients></div></section>
   <button class="bbcs-find-recipes" type="button" data-bbcs-find><span><strong>Find recipes with what I have</strong><small>Review your ingredients for recipe-library matches.</small></span>${icon('arrow')}</button>
   <p class="bbcs-limits">AI tools require Premium and an internet connection.<br>Daily limits and service availability apply.</p>`;
  const strip=hub.querySelector('[data-bbcs-ingredients]');
  const count=hub.querySelector('[data-bbcs-count]');
  let queued=false;
  const selected=()=>{
   try{return (getIngredients()||[]).filter(item=>item&&typeof item.name==='string'&&item.name.trim());}
   catch{return [];}
  };
  function refresh(){
   const items=selected();
   count.textContent=items.length?items.length+' selected':'None selected';
   strip.style.setProperty('--bbcs-columns',String(Math.min(items.length,4)+1));
   const add=`<button class="bbcs-ingredient bbcs-add" type="button" data-bbcs-edit><span class="bbcs-plus">${icon('plus')}</span><strong>Add food</strong></button>`;
   if(!items.length){strip.innerHTML='<p class="bbcs-empty">Choose what you have, or scan your food.</p>'+add;return;}
   strip.innerHTML=items.slice(0,4).map(item=>{
    const name=item.name.trim();
    const visual=root.BBFoodVisuals?.html(name,{context:'cook',variant:'tile',emoji:'🥣'})||'<span class="bbcs-fallback" aria-hidden="true">🥣</span>';
    return '<button class="bbcs-ingredient" type="button" data-bbcs-edit aria-label="Review '+escape(name)+'">'+visual+'<strong title="'+escape(name)+'">'+escape(name)+'</strong></button>';
   }).join('')+add;
  }
  function schedule(){if(queued)return;queued=true;root.requestAnimationFrame(()=>{queued=false;if(hub.isConnected)refresh();});}
  function showIngredients(review){
   const hasFoods=selected().length>0;
   const target=review&&hasFoods?root.document.getElementById('bb5MealReview'):workspace;
   if(!target)return;
   const first=workspace.querySelector('details.bb82-ingredient-location');
   if(!review&&first)first.open=true;
   target.scrollIntoView({behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
   const focus=review&&hasFoods?root.document.getElementById('bb5GenerateFromReview'):first?.querySelector('summary');
   focus?.focus({preventScroll:true});
  }
  hub.addEventListener('click',event=>{
   if(event.target.closest('[data-bbcs-edit]'))showIngredients(false);
   else if(event.target.closest('[data-bbcs-find]'))showIngredients(true);
  });
  workspace.addEventListener('input',schedule);
  workspace.addEventListener('change',schedule);
  const observer=new root.MutationObserver(schedule);
  observer.observe(workspace,{childList:true,subtree:true,characterData:true});
  const controller=Object.freeze({refresh});mounted.set(hub,controller);refresh();return controller;
 }
 root.BBCookStudio=Object.freeze({mount});
})(typeof window==='undefined'?globalThis:window);
