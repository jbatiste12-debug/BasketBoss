/* BasketBoss anonymous conversion funnel + optional Free account reminder.
 * No Supabase, Paddle, D1, camera or pantry-state writes. Events contain no
 * email, account token, user ID, recipe title or saved content.
 */
(()=>{'use strict';
  const SESSION_KEY='basketboss_cloud_session_v1';
  const EVENTS=new Set(['landing','free_click','recipe_open','nudge_shown','nudge_account','account_open','signup_click','signup_valid','confirmation_message','signed_in']);
  const emitted=new Set();
  const seenRecipes=new Set();
  let banner=null;
  let dismissed=false;
  let prompted=false;
  function signedIn(){
    try{
      const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      return !!(s?.user?.id&&typeof s.access_token==='string'&&Number(s.expires_at)*1000>Date.now()+5000);
    }catch(_){return false;}
  }
  function emit(step){
    if(!EVENTS.has(step)||emitted.has(step))return;
    emitted.add(step);
    try{
      void fetch('/api/funnel/'+step,{
        method:'POST',mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store',
        referrerPolicy:'no-referrer',keepalive:true
      }).catch(()=>{});
    }catch(_){/* marketing metrics must never affect the application */}
  }
  function hideBanner(){if(banner)banner.hidden=true;}
  function onSession(){
    if(signedIn()){
      hideBanner();
      emit('signed_in'); // Indicates an active session, not necessarily a new registration.
    }
  }
  function showNudge(){
    if(prompted||dismissed||signedIn()||seenRecipes.size<2)return;
    try{if(sessionStorage.getItem('bb_funnel_nudge_dismissed_v1')==='1')return;}catch(_){/* private mode */}
    prompted=true;
    if(!banner){
      banner=document.createElement('aside');
      banner.id='bbFunnelNudge';
      banner.setAttribute('aria-label','Optional free BasketBoss account');
      banner.innerHTML='<div class="bbf-copy"><strong>Enjoying the recipes?</strong><span>Keep your meal plan on another device with a free account. No card needed.</span></div><div class="bbf-actions"><button type="button" data-bbf-signup>Create free account</button><button type="button" data-bbf-dismiss aria-label="Dismiss account suggestion">Not now</button></div>';
      document.body.appendChild(banner);
      banner.querySelector('[data-bbf-signup]').addEventListener('click',()=>{
        emit('nudge_account');hideBanner();
        document.getElementById('cloud-open')?.click(); // Existing Supabase form; no replacement auth.
      });
      banner.querySelector('[data-bbf-dismiss]').addEventListener('click',()=>{
        dismissed=true;hideBanner();
        try{sessionStorage.setItem('bb_funnel_nudge_dismissed_v1','1');}catch(_){}
      });
    }
    banner.hidden=false;
    emit('nudge_shown');
  }
  function clicked(e){
    if(!(e.target instanceof Element))return;
    const t=e.target;
    if(t.closest('[data-bbc-free],[data-bbtrial-preview],[data-bbws-quickfree]'))emit('free_click');
    const recipe=t.closest('[data-recipe]');
    if(recipe&&!signedIn()){
      emit('recipe_open');
      const key=recipe.getAttribute('data-recipe');
      if(key)seenRecipes.add(key); // Memory only; NEVER transmitted or persisted.
      showNudge();
    }
    if(t.closest('#cloud-open,#bb16AccountShortcut,[data-bbtrial-account]'))emit('account_open');
    if(t.closest('#cloud-signup')){
      emit('signup_click');
      const email=document.getElementById('cloud-email');
      const password=document.getElementById('cloud-password');
      if(email&&password&&email.value.trim()&&password.value.length>=8&&email.checkValidity())emit('signup_valid');
    }
  }
  function watchConfirmation(){
    const message=document.getElementById('cloud-message');
    if(!message||typeof MutationObserver!=='function')return;
    const observer=new MutationObserver(()=>{
      if(/check your email for a confirmation link/i.test(message.textContent||'')){
        emit('confirmation_message'); // The UI text is NOT proof of confirmed signup.
      }
    });
    observer.observe(message,{childList:true,characterData:true,subtree:true});
  }
  function start(){
    if(!document.getElementById('bbColdVisitor'))return;
    if(!signedIn())emit('landing');
    document.addEventListener('click',clicked,true);
    watchConfirmation();
    window.addEventListener('basketboss:session-changed',onSession);
    window.addEventListener('storage',e=>{if(e.key===SESSION_KEY)onSession();});
    window.addEventListener('focus',onSession);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
