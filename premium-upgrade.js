/* BasketBoss Premium upgrade modal — SANDBOX UI ONLY.
 * Intentionally denies access to AI controls for every visitor while verified
 * subscription entitlement and account sign-in have not yet been implemented.
 * IMPORTANT: A browser modal is NOT an authorization boundary. The server-side
 * /api/bb173 endpoints must verify paid entitlements before public launch.
 */
(() => {
  'use strict';
  const dialog = document.getElementById('bbPremiumDialog');
  if (!dialog) return;
  const feature = document.getElementById('bbPremiumFeature');
  const close = dialog.querySelector('[data-premium-dismiss]');
  const browse = dialog.querySelector('[data-premium-free-recipes]');
  let opener = null;
  const premiumSelector = '[data-open-tool="scan"], [data-open-tool="meal"], #scanBtn, #generate';

  function showPremium(trigger) {
    opener = trigger;
    const isScan = trigger.matches('[data-open-tool="scan"], #scanBtn');
    if (feature) feature.textContent = isScan ? 'AI ingredient scanning' : 'Personalised AI meal ideas';
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    close?.focus({preventScroll: true});
  }

  function hidePremium() {
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    opener?.focus({preventScroll: true});
  }

  // Intercept before existing delegated action handlers run. This is only a
  // preview demonstration and does NOT prevent direct requests to the AI API.
  document.addEventListener('click', event => {
    const trigger = event.target.closest?.(premiumSelector);
    if (!trigger || !document.getElementById('bbToolStage')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showPremium(trigger);
  }, true);

  close?.addEventListener('click', hidePremium);
  browse?.addEventListener('click', () => {
    hidePremium();
    const recipes = document.getElementById('bbRecipesDrawer');
    if (recipes) {
      recipes.open = true;
      recipes.scrollIntoView({behavior: 'smooth', block: 'start'});
      recipes.querySelector('summary')?.focus({preventScroll:true});
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); hidePremium(); });
  dialog.addEventListener('click', event => {
    // Click outside the content, on the native modal backdrop area.
    if (event.target === dialog) hidePremium();
  });
})();
