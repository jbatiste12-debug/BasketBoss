/* BasketBoss first-party conversion steps and optional account reminder.
 * Only allowlisted event names are sent: no request body, tracking identifier,
 * email, account token, error message, recipe identity or saved content.
 * Local once-only flags are not visitor identifiers and never leave the device.
 */
(()=>{'use strict';
  if(window.BBFunnel)return;
  const SESSION_KEY='basketboss_cloud_session_v1';
  const ONCE_PREFIX='bb_funnel_once_v1_';
  const EVENTS=new Set(['landing','free_click','recipe_open','nudge_shown','nudge_account','account_open','signup_click','signup_valid','confirmation_message','signed_in',
    'first_app_open','onboarding_viewed','signup_screen_viewed','signup_method_selected','signup_method_email','signup_method_apple','signup_attempted','signup_confirmation_pending','signup_succeeded','signup_failed',
    'signup_failed_network','signup_failed_rate_limited','signup_failed_validation','signup_failed_unavailable','signup_failed_verification','signup_failed_unknown','first_meal_plan_created','first_shopping_list_created']);
  // Auth's synchronous submission guard owns deduplication of actual requests.
  // Separate legitimate attempts and their outcomes must remain countable.
  const repeat=step=>step==='signup_attempted'||step==='signup_confirmation_pending'||step==='signup_succeeded'||step==='signup_failed'||step.startsWith('signup_failed_');
  const emitted=new Set(),onceEmitted=new Set(),seenRecipes=new Set();
  let banner=null,dismissed=false,prompted=false,pendingNudge='',started=false;
  function signedIn(){
    try{
      if(window.BasketBossSession?.state?.().remembered===true)return true;
      const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      return !!(s?.user?.id&&typeof s.access_token==='string'&&Number(s.expires_at)*1000>Date.now()+5000);
    }catch(_){return false;}
  }
  function send(step){
    // At-most-once transport: an ambiguous/lost response is never retried and
    // counted twice. Metrics are best-effort request counts, not unique users.
    try{
      void fetch('/api/funnel/'+step,{
        method:'POST',mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store',
        referrerPolicy:'no-referrer',keepalive:true
      }).catch(()=>{});
    }catch(_){/* Metrics must never affect authentication or saving. */}
  }
  function track(step){
    if(typeof step!=='string'||!EVENTS.has(step)||(!repeat(step)&&emitted.has(step)))return false;
    emitted.add(step);send(step);
    // Retain existing aggregate paths while replacing fragile DOM-text reads
    // with actual controller lifecycle signals. Pending is not verified signup.
    if(step==='signup_attempted')track('signup_valid');
    if(step==='signup_confirmation_pending')track('confirmation_message');
    if(step==='signup_method_email'||step==='signup_method_apple')track('signup_method_selected');
    if(step.startsWith('signup_failed_'))track('signup_failed');
    return true;
  }
  function once(step){
    if(typeof step!=='string'||!EVENTS.has(step)||onceEmitted.has(step))return false;
    const key=ONCE_PREFIX+step;
    try{if(localStorage.getItem(key)==='1'){onceEmitted.add(step);return false;}}catch(_){}
    onceEmitted.add(step);
    try{localStorage.setItem(key,'1');}catch(_){/* Memory dedup still works in private mode. */}
    return track(step);
  }
  window.BBFunnel=Object.freeze({track,once});
  function hideBanner(){if(banner)banner.hidden=true;}
  function onSession(){
    if(signedIn()){
      pendingNudge='';hideBanner();
      track('signed_in'); // Active account, including returning users; never signup success.
    }
  }
  function surfaceBusy(){
    return document.documentElement?.classList?.contains('bb-onboarding-open')===true||
      document.documentElement?.classList?.contains('bb-native-starting')===true||
      document.getElementById('cloud-panel')?.classList?.contains('open')===true||
      !!document.querySelector?.('#modalRoot > *,dialog[open],.cook-overlay');
  }
  function showNudge(){
    if(prompted||dismissed||signedIn()||(!pendingNudge&&seenRecipes.size<2)||surfaceBusy())return;
    try{if(sessionStorage.getItem('bb_funnel_nudge_dismissed_v1')==='1')return;}catch(_){/* private mode */}
    if(!document.body)return;
    prompted=true;
    if(!banner){
      banner=document.createElement('aside');
      banner.id='bbFunnelNudge';
      banner.setAttribute('aria-label','Optional free BasketBoss account');
      const title=pendingNudge==='plan'?'Like what you’ve planned?':pendingNudge==='shop'?'Your shopping list is ready.':'Enjoying the recipes?';
      const copy=pendingNudge?'Create your free account to save and sync it across your devices.':'Keep your meal plan on another device with a free account. No card needed.';
      banner.innerHTML='<div class="bbf-copy"><strong>'+title+'</strong><span>'+copy+'</span></div><div class="bbf-actions"><button type="button" data-bbf-signup>Create free account</button><button type="button" data-bbf-dismiss aria-label="Dismiss account suggestion">Not now</button></div>';
      document.body.appendChild(banner);
      banner.querySelector('[data-bbf-signup]').addEventListener('click',()=>{
        track('nudge_account');hideBanner();
        document.getElementById('cloud-open')?.click();
        window.BBAuthFlow?.open?.('sign-up');
      });
      banner.querySelector('[data-bbf-dismiss]').addEventListener('click',()=>{
        dismissed=true;hideBanner();
        try{sessionStorage.setItem('bb_funnel_nudge_dismissed_v1','1');}catch(_){}
      });
    }
    banner.hidden=false;pendingNudge='';
    track('nudge_shown');
  }
  function deferNudge(){
    if(typeof window.setTimeout==='function')window.setTimeout(showNudge,0);else showNudge();
  }
  function milestone(step,kind){
    if(!once(step))return;
    if(!signedIn()){pendingNudge=pendingNudge||kind;deferNudge();}
  }
  // The app dispatches these only after genuine successful user-origin saves,
  // never while rendering/restoring a plan. No event detail is read or sent.
  window.addEventListener('basketboss:first-meal-plan-created',()=>milestone('first_meal_plan_created','plan'));
  window.addEventListener('basketboss:first-shopping-list-created',()=>milestone('first_shopping_list_created','shop'));
  function clicked(e){
    if(!(e.target instanceof Element))return;
    const t=e.target;
    if(t.closest('[data-bbc-free],[data-bbtrial-preview],[data-bbws-quickfree]'))track('free_click');
    const recipe=t.closest('[data-recipe]');
    if(recipe&&!signedIn()){
      track('recipe_open');
      const key=recipe.getAttribute('data-recipe');
      if(key)seenRecipes.add(key); // Memory only, never transmitted or persisted.
      showNudge();
    }
    if(t.closest('#cloud-open,#bb16AccountShortcut,[data-bbtrial-account]')){hideBanner();track('account_open');}
    if(t.closest('#cloud-signup'))track('signup_click'); // Intent, not an API attempt.
    if(pendingNudge)deferNudge();
  }
  function start(){
    if(started||!document.getElementById('bbColdVisitor'))return;started=true;
    once('first_app_open'); // First instrumented app open on this installation.
    if(!signedIn())track('landing');
    document.addEventListener('click',clicked,true);
    window.addEventListener('basketboss:session-changed',onSession);
    window.addEventListener('storage',e=>{if(e.key===SESSION_KEY)onSession();});
    window.addEventListener('focus',onSession);
    window.addEventListener('basketboss:welcome-finished',deferNudge);
    if(pendingNudge)deferNudge();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
