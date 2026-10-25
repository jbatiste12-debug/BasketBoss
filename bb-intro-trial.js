/* BasketBoss: ONE-TIME post-introduction Premium offer. SANDBOX ONLY.
 * This is marketing UI, NOT authentication or subscription entitlement.
 * Payment only begins after an explicit plan choice on pricing-sandbox.html.
 */
(() => {
  'use strict';
  const dialog = document.getElementById('bbIntroTrialDialog');
  if (!dialog) return;
  const SEEN = 'basketboss_premium_trial_intro_shown_v1';
  const close = dialog.querySelector('[data-bbtrial-close]');
  const continueFree = dialog.querySelector('[data-bbtrial-free]');
  let previousFocus = null;
  let shownInMemory = false;

  function alreadySeen() {
    try { return shownInMemory || localStorage.getItem(SEEN) === '1'; }
    catch (_) { return shownInMemory; }
  }
  function remember() {
    shownInMemory = true;
    try { localStorage.setItem(SEEN, '1'); } catch (_) {}
  }
  function openOffer(force = false) {
    if (!force && alreadySeen()) return;
    // Do not interrupt or overlap the three-slide introduction.
    if (document.getElementById('bb172Onboarding')) return;
    previousFocus = document.activeElement;
    remember();
    if (!dialog.open) dialog.showModal();
    close?.focus({preventScroll:true});
  }
  function dismiss() {
    if (dialog.open) dialog.close();
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  }
  window.addEventListener('basketboss:welcome-finished', () => openOffer());
  close?.addEventListener('click', dismiss);
  continueFree?.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) dismiss(); });

  // Safe test mechanism for a returning tester in the protected preview.
  // It never activates in production and doesn't erase onboarding/app data.
  if (location.hostname === 'basketboss-preview.basketboss-site.pages.dev' &&
      new URLSearchParams(location.search).get('bb_trial_offer_preview') === '1') {
    const attempt = () => { if (!document.getElementById('bb172Onboarding')) openOffer(true); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attempt, {once:true});
    else attempt();
  }
})();
