/* Compact per-dinner replacement control; loaded only by the700 client. */
(function(win){
 'use strict';if(!win?.document||!win.BBPlanSwapCore||!win.BBPlanSwapHost)return;
 const doc=win.document,host=win.BBPlanSwapHost,icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1.7L20 8M4 16l2.3 2.7A7 7 0 0 0 17.9 17"/></svg>';
 let observer,scheduled=false;
 function paintBusy(){for(const button of doc.querySelectorAll('[data-bb-plan-swap]')){button.disabled=controller.busy;button.setAttribute('aria-busy',String(controller.busy));}}
 const controller=win.BBPlanSwapCore.createController(host,{onBusy:paintBusy});
 function mount(){
  scheduled=false;
  for(const day of win.BBPlanSwapCore.DAYS){
   const card=doc.querySelector('#app.bbnext-plan .bbnext-day[data-bbnext-day="'+day+'"]');if(!card)continue;
   const slot=host.visibleSlot(day);if(!slot)continue;
   const existing=card.querySelector('[data-bb-plan-swap]');if(existing)continue;
   const anchor=card.querySelector(':scope > summary .bbfeed-control')||card.querySelector(':scope > summary .bbnext-day-description');if(!anchor)continue;
   const button=doc.createElement('button');button.type='button';button.className='bb-plan-swap-button';button.dataset.bbPlanSwap=day;button.setAttribute('aria-label','Find another dinner for '+day);button.title='Find another dinner';button.innerHTML=icon;
   for(const type of ['pointerdown','keydown'])button.addEventListener(type,event=>event.stopPropagation());
   button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void controller.swap(day);});anchor.after(button);
  }
  paintBusy();
 }
 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(mount);}
 function start(){mount();const app=doc.getElementById('app');if(app){observer=new MutationObserver(schedule);observer.observe(app,{childList:true,subtree:true});}}
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else queueMicrotask(start);
 win.addEventListener('beforeunload',()=>observer?.disconnect(),{once:true});
 win.BBPlanSwapUI=Object.freeze({refresh:schedule,swap:day=>controller.swap(day)});
})(typeof window==='undefined'?null:window);
