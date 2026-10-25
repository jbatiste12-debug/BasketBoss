/* BasketBoss v17.4: Sandbox subscription/trial UX ONLY.
 * This code NEVER grants Premium access. The server must enforce user identity,
 * entitlements, protected recipe delivery, Paddle webhook state and AI quotas.
 * No localStorage, URL parameter or browser timestamp is proof of paid access.
 */
(() => {
  'use strict';
  const API = '/api/subscription/status';
  const VERSION = 'bb174-trial-ux-preview-v1';
  const $$ = selector => document.querySelector(selector);
  const allowedStatus = new Set(['trialing','active','past_due','paused','canceled']);
  let statusSupported = true;
  let lastFetchTime = 0;
  const formatDate = value => {
    if (!value || typeof value !== 'string') return null;
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) return null;
    return new Intl.DateTimeFormat(document.documentElement.lang || 'en-GB',
      { day:'numeric', month:'short', year:'numeric' }).format(new Date(millis));
  };
  function el(tag, classname, text) {
    const node = document.createElement(tag);
    if (classname) node.className = classname;
    if (text) node.textContent = text;
    return node;
  }
  const terms = 'Sandbox preview: the first 25 eligible Founding Members may choose a 7-day free trial, followed by £1.99/month unless canceled before billing. Standard Premium is £4.99/month; any Standard trial or annual plan requires separate approval. Payment details are collected during checkout. Verify the exact terms in Paddle checkout. Nothing here activates Premium without a verified subscription.';
  function addTerms() {
    const comparison = $$('.bb173-tier-comparison');
    if (comparison && !$$('#bb174PricingTerms')) {
      const p = el('p','bb174-billing-terms',terms);
      p.id = 'bb174PricingTerms';
      comparison.appendChild(p);
    }
    const plans = $$('.bb173-tier-plans');
    if (plans && !$$('#bb174ModalTerms')) {
      const p = el('p','bb174-billing-terms',terms);
      p.id = 'bb174ModalTerms';
      plans.insertAdjacentElement('beforebegin',p);
    }
  }
  function validPortalUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 2048) return null;
    try {
      const uri = new URL(value, location.origin);
      // External billing links must resolve to Paddle domains; local links must be same-origin.
      if (uri.origin === location.origin && uri.protocol === 'https:') return uri.href;
      if (uri.protocol === 'https:' && /(^|\.)(paddle\.com|paddle\.net)$/.test(uri.hostname)) return uri.href;
    } catch (_) {}
    return null;
  }
  function readVerifiedState(raw) {
    if (!raw || typeof raw !== 'object' || raw.authenticated !== true) return null;
    if(raw.tier==='owner' && raw.premiumAccess===true && raw.mode==='sandbox') return {status:'owner',premiumAccess:true,mode:'sandbox',owner:true};
    if(!raw.subscription || typeof raw.subscription !== 'object') return null;
    if (!allowedStatus.has(raw.subscription.status)) return null;
    if (raw.premiumAccess !== true && raw.premiumAccess !== false) return null;
    if (raw.mode !== 'sandbox' && raw.mode !== 'live') return null;
    const sub = raw.subscription;
    return {
      status:sub.status, premiumAccess:raw.premiumAccess, mode:raw.mode,
      trialEnd:formatDate(sub.trialEndsAt), periodEnd:formatDate(sub.currentPeriodEndsAt),
      cancelEffective:formatDate(sub.cancellationEffectiveAt),
      cancelPending:sub.cancelAtPeriodEnd === true,
      subscriptionId:typeof sub.id === 'string' ? sub.id.slice(0,100) : '',
      portalUrl:validPortalUrl(raw.portalUrl)
    };
  }
  function statusCopy(state) {
    if(state.owner)return {title:'Owner Premium (verified)',message:'Permanent Owner entitlement confirmed by the server. No Paddle purchase required.'};
    if (state.premiumAccess && state.status === 'trialing') {
      const trialText = state.trialEnd ? ` through ${state.trialEnd}` : '';
      return { title:'Premium trial active'+trialText,
        message:state.cancelPending
          ? `Cancellation scheduled${state.cancelEffective ? ` for ${state.cancelEffective}` : ''}. Check billing management for the effective access end date.`
          : 'Your trial is set to convert to a paid, automatically renewing subscription unless canceled before billing.' };
    }
    if (state.premiumAccess && state.status === 'active') {
      return { title:'Premium subscription active',
        message:state.cancelPending
          ? `Cancellation scheduled${state.cancelEffective ? ` for ${state.cancelEffective}` : ''}. Your server-verified access continues only while eligible.`
          : `Your subscription renews automatically${state.periodEnd ? ` after ${state.periodEnd}` : ''} unless canceled.` };
    }
    if (state.premiumAccess && state.status === 'past_due') {
      return { title:'Premium payment needs attention',
        message:'Your Premium access currently continues, but please check your payment details promptly to avoid an interruption.' };
    }
    if (!state.premiumAccess && state.status === 'past_due') {
      return { title:'Premium needs a billing update',
        message:'Your Premium access is currently unavailable. Check your subscription and payment details. BasketBoss Free remains available.' };
    }
    if (!state.premiumAccess && (state.status === 'canceled' || state.status === 'paused')) {
      return { title: state.status === 'paused' ? 'Premium is paused' : 'Premium access has ended',
        message:'BasketBoss Free is still available. Keep your saved plans and continue with 100 starter recipes, manual ingredients and basic shopping.' };
    }
    if (!state.premiumAccess) return { title:'BasketBoss Free', message:'Premium is not currently available on your verified subscription. Basic Free features remain available.' };
    return { title:'Premium billing update', message:'Check secure billing management for your current trial or subscription terms.' };
  }
  function makeBanner(state) {
    const target = $$('.bb173-leftover-card') || $$('.bb173-recipe-tier-banner') || $$('main') || $$('#app');
    if (!target) return;
    let banner = $$('#bb174SubscriptionBanner');
    if (!banner) {
      banner = el('aside','bb174-subscription-banner');
      banner.id='bb174SubscriptionBanner';
      banner.setAttribute('aria-live','polite');
      target.insertAdjacentElement('beforebegin',banner);
    }
    banner.replaceChildren();
    const copy = statusCopy(state);
    const heading = el('strong',null,copy.title);
    const message = el('p',null,copy.message);
    banner.append(heading,message);
    if(!state.owner && state.subscriptionId){
      const manage=el('button','bb174-billing-link','Manage billing / cancellation →');
      manage.type='button';
      manage.addEventListener('click', async()=>{
        manage.disabled=true;
        try{
          const session=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
          if(!session?.access_token)throw Error('Sign in again to manage billing');
          const response=await fetch('/api/subscription/portal',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
          const data=await response.json();
          if(!response.ok || !validPortalUrl(data?.url))throw Error('Billing portal unavailable. Please contact support.');
          location.assign(data.url);
        }catch(err){manage.textContent=err.message||'Billing portal unavailable';manage.disabled=false;}
      });
      banner.append(manage);
    }
    const sandboxNote = state.mode === 'sandbox' ? el('small',null,'Sandbox account state · No real payment') : null;
    if (sandboxNote) banner.append(sandboxNote);
  }
  function clearBanner(){ $$('#bb174SubscriptionBanner')?.remove(); }
  function remindOnce(state) {
    if (state.premiumAccess || !['canceled','paused','past_due'].includes(state.status)) return;
    if (!state.subscriptionId) return;
    const key='bb174-reminded-'+state.subscriptionId+'-'+state.status;
    try { if (sessionStorage.getItem(key)) return; } catch (_) { return; }
    // The reminder is shown only when the backend reports an ineligible subscription.
    const modal = el('dialog','bb174-expiry-dialog');
    const needsPayment = state.status === 'past_due';
    const h2 = el('h2',null,needsPayment ? 'Check your Premium billing' : (state.status === 'paused' ? 'Your Premium access is paused' : 'Your Premium access has ended'));
    h2.id='bb174ExpiryTitle';
    const p = el('p',null,needsPayment ? 'Review your payment details to restore eligible access. Your BasketBoss Free features are still here.' : 'Keep enjoying BasketBoss Free and your saved plans. Unlock all Premium features again whenever you wish.');
    p.id='bb174ExpiryDescription';
    modal.setAttribute('aria-labelledby',h2.id);
    modal.setAttribute('aria-describedby',p.id);
    const btn = el('button',null,'Stay with BasketBoss Free');
    btn.type='button';
    btn.addEventListener('click',()=>modal.close());
    const link=el('a',null,needsPayment && state.portalUrl ? 'Review payment / subscription →' : 'Unlock Premium options →');
    link.href=needsPayment && state.portalUrl ? state.portalUrl : 'pricing-sandbox.html';
    if (state.portalUrl && needsPayment) link.rel='noopener noreferrer';
    modal.append(h2,p,link,btn);
    document.body.appendChild(modal);
    modal.addEventListener('close',()=>modal.remove(),{once:true});
    try { sessionStorage.setItem(key,'1'); } catch (_) {}
    if (typeof modal.showModal === 'function') {
      try { modal.showModal(); btn.focus({preventScroll:true}); } catch (_) { modal.remove(); }
    } else { modal.remove(); }
  }
  async function refresh() {
    if (!statusSupported || Date.now() - lastFetchTime < 60000) return;
    lastFetchTime = Date.now();
    try {
      let session=null;try{session=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null')}catch{}
      if(!session?.access_token || (session.expires_at||0)*1000 < Date.now()+5000){clearBanner();return;}
      const response = await fetch(API, {cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+session.access_token}});
      if (response.status === 404 || response.status === 501) { statusSupported=false;clearBanner();return; }
      if (response.status === 401 || response.status === 403) { clearBanner();return; }
      if (!response.ok) return; // Offline/500 is not proof of an active subscription.
      const state = readVerifiedState(await response.json());
      if (!state) { clearBanner();return; }
      makeBanner(state);
      remindOnce(state);
    } catch (_) { /* Preview may lack the backend. Never grant access on failure. */ }
  }
  function init(){addTerms();refresh();}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
  // The v17.3 tier dialog is injected by another deferred script on DOMContentLoaded.
  window.addEventListener('load',addTerms,{once:true});
  document.addEventListener('visibilitychange',()=>{if (!document.hidden) refresh();});
  window.addEventListener('focus',refresh);
  // Intentional no public subscription-state setters: server-side only.
  window.BasketBossTrialUI = Object.freeze({version:VERSION});
})();
