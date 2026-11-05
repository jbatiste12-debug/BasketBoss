/* BasketBoss v1768 - QA release polish. Visual state/scroll/error recovery only.
   The underlying Kitchen/Shop model, pricing, paid access, localStorage and plan
   handlers remain owned by the existing BasketBoss application. */
(()=>{'use strict';
  const body=document.body;
  const nav=document.querySelector('.shell nav.tabs');
  if(nav){
    const refresh=()=>{
      const live=body.classList.contains('bb172-storefront-visible') && !!document.getElementById('bb172Storefront');
      body.classList.toggle('bb-qa-shop-nav-active',live);
      const kitchen=nav.querySelector('[data-tab="shop"]'), shop=nav.querySelector('[data-tab="shop-list"]');
      if(live){if(kitchen)kitchen.removeAttribute('aria-current'); if(shop)shop.setAttribute('aria-current','page');}
      else if(shop && shop.getAttribute('aria-current')==='page')shop.removeAttribute('aria-current');
    };
    let queued=false;
    const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;refresh();});};
    new MutationObserver(schedule).observe(body,{attributes:true,attributeFilter:['class']});
    const app=document.getElementById('app');
    if(app)new MutationObserver(schedule).observe(app,{childList:true});
    // BBTabViewport owns navigation resets and cancels stale navigation work.
    // This visual decorator must not schedule a second, delayed scroll.
    refresh();
  }
  // Recover visibly from invalid personal photo URLs and genuine asset load failures.
  // Do not persist a replacement over the user's own image preference.
  const fallback='icons/basketboss-crowned-v1766-512.png';
  document.addEventListener('error',event=>{
    const image=event.target;
    if(!(image instanceof HTMLImageElement)||image.dataset.bbQaImageFallback)return;
    // Don't hijack a non-recipe image in some other site component.
    if(!image.closest('.recipe-image,.mini-recipe,.mini-img,.bb-day-photo,.bb14-meal-card,.photo-manager-row,.swipe-card,.bb-dessert-day-image'))return;
    image.dataset.bbQaImageFallback='1';
    image.onerror=null;
    image.src=fallback;
    image.alt=(image.alt||'Recipe')+' — BasketBoss image placeholder';
    image.classList.add('bb-qa-recipe-image-fallback');
  },true);
})();
