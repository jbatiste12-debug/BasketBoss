/* BB-BETA-FIVE-20261025 — nav icon recovery and one-tap replay. */
(()=>{'use strict';
 const kitchenSvg='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16l-1.2 9H5.2L4 10Z"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M8 14v2m8-2v2"/></svg>';
 let busy=false;
 function polish(){
  busy=false;
  for(const nav of document.querySelectorAll('.shell nav.tabs,nav.bb-r6-cook-nav,nav[aria-label="Bottom navigation"]')){
   nav.dataset.bbBetaDock='1';
   for(const tab of nav.querySelectorAll('button,a')){
    const label=(tab.querySelector('.nav-label')?.textContent||tab.textContent||'').trim();
    if(!/^Kitchen$/i.test(label))continue;
    let icon=tab.querySelector('.nav-icon');
    if(!icon){icon=document.createElement('span');icon.className='nav-icon';icon.setAttribute('aria-hidden','true');tab.prepend(icon);}
    if(!icon.querySelector('svg'))icon.innerHTML=kitchenSvg;
   }
  }
  const settings=document.querySelector('#bbuiLinksSection')||document.querySelector('[data-settings-content]');
  if(settings&&!settings.querySelector('#bbBetaWelcomeReplay')){
   const button=document.createElement('button');button.type='button';button.id='bbBetaWelcomeReplay';button.className='bb-beta-replay';
   button.textContent='▶ Replay welcome animation';
   button.addEventListener('click',()=>{
    const api=window.BB173WelcomeSplash;
    if(api&&typeof api.show==='function')api.show();else alert('Welcome animation is unavailable on this page. Return to the BasketBoss home screen.');
   });settings.append(button);
  }
 }
 function schedule(){if(busy)return;busy=true;requestAnimationFrame(polish)}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
 const watcher=new MutationObserver(schedule);
 watcher.observe(document.documentElement,{childList:true,subtree:true});
})();
