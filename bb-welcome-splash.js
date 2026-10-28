/* BasketBoss v17.3 — first-visit animated splash: welcome -> existing intro -> trial.
   Free to skip; does not create an account, charge money, or change pantry data.
   The install button is wired by the existing bb-install.js (native prompt or guidance).
*/
(()=>{
 'use strict';
 const KEY='basketboss_welcome_splash_seen_v1';
 const PARAM='bb_welcome_preview';
 const previewHost='basketboss-preview.basketboss-site.pages.dev';
 let seenInMemory=false, overlay=null, lastFocus=null, previousOverflow='', complete=false;
 const isPreview=()=>location.hostname===previewHost&&new URLSearchParams(location.search).get(PARAM)==='1';
 const seen=()=>{
   try{return seenInMemory||sessionStorage.getItem(KEY)==='1';}
   catch(_){return seenInMemory;}
 };
 const shouldShow=()=>isPreview()||!seen();
 // Only a valid signed-in session counts as an existing authenticated visitor.
 const signedIn=()=>{try{const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');return !!(s?.user?.id&&typeof s.access_token==='string'&&Number(s.expires_at)*1000>Date.now()+5000);}catch(_){return false;}};
 const remember=()=>{seenInMemory=true;try{sessionStorage.setItem(KEY,'1');}catch(_){}};
 function finish(){
   if(!overlay||complete)return;
   complete=true;
   remember();
   overlay.remove();overlay=null;
   document.body.style.overflow=previousOverflow;
   window.dispatchEvent(new Event('basketboss:splash-finished'));
   // After finishing, the existing 3-step introduction will normally take focus.
   // If the tour was already completed (replay case), return to previous focus.
   if(window.BB172Welcome?.completed()&&lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
 }
 function replay(){if(overlay){overlay.classList.remove('bbws-play');void overlay.offsetWidth;overlay.classList.add('bbws-play');}}
 function show(force=false){
   if(overlay||(!force&&!shouldShow()))return;
   complete=false;lastFocus=document.activeElement;previousOverflow=document.body.style.overflow;
   const host=document.createElement('div');host.id='bb173WelcomeSplash';host.className='bbws-play';
   host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');
   host.setAttribute('aria-label','Welcome to BasketBoss');
   host.innerHTML=`<main class="bbws-scene">
    <button type="button" class="bbws-skip" data-bbws-close>Skip animation ↗</button>
    <section class="bbws-board" aria-labelledby="bbwsTitle">
      <span class="bbws-corner">WELCOME TO SOMETHING DELICIOUS</span>
      <span class="bbws-spark bbws-spark-a" aria-hidden="true">✦</span><span class="bbws-spark bbws-spark-b" aria-hidden="true">✧</span><span class="bbws-spark bbws-spark-c" aria-hidden="true">✦</span>
      <div class="bbws-logo-pad" role="img" aria-label="Crowned BasketBoss basket logo">
        <div class="bbws-logo-square"></div><div class="bbws-logo-ring"></div>
        <svg class="bbws-mark" viewBox="0 0 64 64" aria-hidden="true" fill="none">
         <g class="bbws-basket"><path d="M18 30 25 23M46 30 39 23" fill="none" stroke="#44484B" stroke-width="4" stroke-linecap="round"/><path d="M11 31h42l-5 24H16l-5-24Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path class="bbws-slots" d="M22 38v10M32 38v10M42 38v10" stroke="#F8F8F8" stroke-width="4" stroke-linecap="round"/></g>
         <g class="bbws-crown"><path d="M22 18 18 10 27 14 32 6 37 14 46 10 42 18Z" fill="#44484B" stroke="#44484B" stroke-width="2" stroke-linejoin="round"/><path class="bbws-crown-base" d="M21 21h22" stroke="#44484B" stroke-width="3" stroke-linecap="round"/></g>
        </svg>
      </div>
      <h1 class="bbws-wordmark" id="bbwsTitle">Basket<span>Boss</span></h1>
      <div class="bbws-line" aria-hidden="true"></div><p class="bbws-tagline">Plan Smarter. Eat Better. Less Waste.</p>
      <p class="bbws-intro">Your recipes, ingredients and meal plans — right where you need them.</p>
      <button type="button" class="bbws-quickfree" data-bbws-quickfree>Explore 100 Free Recipes — No Email →</button>
      <p class="bbws-free-note" data-bbws-free-note>No account or card needed to look around.</p>
      <button type="button" class="bbws-install" data-bb173-install-open>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 18v3h16v-3"/></svg>Install BasketBoss
      </button>
      <button type="button" class="bbws-continue" data-bbws-close>Continue to BasketBoss →</button>
      <div class="bbws-markets">🇬🇧 UK &nbsp;·&nbsp; 🇯🇪 Jersey &nbsp;·&nbsp; 🇬🇬 Guernsey &nbsp;·&nbsp; 🇺🇸 United States</div>
    </section></main>`;
   document.body.appendChild(host);overlay=host;
   document.body.style.overflow='hidden';
   if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)host.classList.add('bbws-reduced');
   host.querySelectorAll('[data-bbws-close]').forEach(btn=>btn.addEventListener('click',finish));
   const free=host.querySelector('[data-bbws-quickfree]');
   if(signedIn()){
     free.hidden=true;
     host.querySelector('[data-bbws-free-note]').hidden=true;
   }else free.addEventListener('click',()=>{
     // User explicitly opted to explore; skip the separate intro, not the real app.
     // This is presentation state only: never seed a sample pantry or an account.
     try{localStorage.setItem('basketboss_onboarding_seen_v1','true');}
     catch(_){try{sessionStorage.setItem('basketboss_onboarding_seen_v1','true');}catch(__){}}
     finish();
   });
   host.addEventListener('keydown',e=>{
     if(e.key==='Escape'){e.preventDefault();finish();return;}
     if(e.key==='Tab'){
       const controls=[...host.querySelectorAll('button:not([disabled])')];
       if(!controls.length)return;
       if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1).focus();}
       else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0].focus();}
     }
   });
   // New buttons are created after bb-install.js may have initialized.
   // Use its public binder if available, otherwise wire a single fallback.
   const install=host.querySelector('[data-bb173-install-open]');
   const installed=(()=>{try{return matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;}catch(_){return navigator.standalone===true;}})();
   if(installed)install.hidden=true;
   if(window.BB173Install?.wire)window.BB173Install.wire();
   else install.addEventListener('click',()=>{
     const existing=document.querySelector('.bb173-install-banner [data-bb173-install-open]');
     if(existing){existing.click();return;}
     // In the unlikely event the regular installer has not loaded yet, prompt honestly.
     window.alert('Use your browser menu to install BasketBoss, or Safari Share → Add to Home Screen on iPhone.');
   });
   host.querySelector('[data-bbws-close]')?.focus({preventScroll:true});
 }
 window.BB173WelcomeSplash={shouldShow,isPreview,show:()=>show(true),replay};
 const init=()=>{
   if(shouldShow())show();
   const footer=document.querySelector('footer');
   if(footer&&!footer.querySelector('#bb173WelcomeReplay')){
     const btn=document.createElement('button');btn.type='button';btn.id='bb173WelcomeReplay';btn.textContent='Replay BasketBoss logo animation';
     btn.addEventListener('click',()=>show(true));footer.appendChild(btn);
   }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
