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
  // AI tool opening and file-picker gestures are handled directly by Kitchen.
  // Protected AI POSTs still enforce Premium entitlement on the server.

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


  // No capture-phase AI interception: the native Safari picker and original
  // scan/generate handlers must receive their real user click. The protected
  // server endpoints enforce entitlement and return visible errors.

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
