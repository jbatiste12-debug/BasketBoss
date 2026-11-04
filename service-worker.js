/* BasketBoss v17.2 release-candidate scoped offline shell.
 * Caches app pages and assets only; no personal localStorage or sync data is transmitted.
 * Food photographs outside the preview are cached only after being viewed, where supported.
 */
const CACHE = 'basketboss-premium-secure-shell-20261104-v49-mentor-stream1';
const IMAGE_CACHE = 'basketboss-v20261102-audited-images-v2';
const APP_BASE = new URL(self.registration.scope);
const CORE = ['bb-saved-weeks.js','bb-saved-weeks.css','bb-saved-weeks.js?v=20261103-weeks1','bb-saved-weeks.css?v=20261103-weeks1','bb-pantry-camera.js','bb-pantry-camera.js?v=20261102-camera1','bb-pantry-camera.css','bb-pantry-camera.css?v=20261102-camera1','bb-cook-experience.css','bb-cook-experience.css?v=20261103-feedback1','bb-account-deletion.css?v=20261101-recovery1','bb-account-deletion.js?v=20261101-apple1','bb-food-visuals.css?v=20261031-food2','bb-food-visuals.js?v=20261031-food2','bb-navigation-polish.js?v=20261101-polish1','bb-ux-cleanup.css?v=20261028-ux1','bb-cold-preview.css?v=20261028-conversion-1','bb-funnel.css?v=20261028-v1','bb-intro-trial.css?v=bb-account-first-20261027-v1','bb-us-market.css?v=173us1','bb-install.css?v=173install1','bb-welcome-splash.css?v=20261101-brand4','bb173-final-polish.css?v=173polish1','bb-premium-features.css?v=bbprodmodal20261027','bb-premium-preview-config.js?v=1743leftoverpremium','bb174-trial-ux.css?v=174trial1','bb174-trial-ux.js?v=bbprodmodal20261027','bb-real-app-tour.css?v=17513real1','bb-beta-six-fixes.css?v=1767','bb-beta-launch-polish.css?v=1768','bb-consolidated-qa.css?v=20261025-r1','bb-beta-five.css?v=20261025-five','bb-purchase-choice.css?v=20261025-choice-v2','bb-membership-settings.css?v=bbsecure1','bb-membership-settings.js?v=20261101-apple1','basketboss-aisles-v20.js?v=bb82-aisle-20261024','bb-supermarkets.js?v=bb-stores-20261031','bb-receipt-quantity.js?v=20261102-pantry1','bb-duration.js?v=20261102-duration2','bb-price-scan.js?v=20261102-loop2','basketboss-pricing-v19.js?v=20261103-units1','bb-serving-scale.js?v=20261103-kitchen2','bb-recipe-measures.js?v=20261102-measures1','bb-cook-step-layout.js?v=20261102-clarity1','bb-cook-pantry.js?v=20261102-pantry1','bb-cook-clarity.css?v=20261102-loop2','bb-weekly-essentials.js?v=20261031-receipt-pantry','bb-receipt-inventory.js?v=20261102-loop2','bb-receipt-scanner.js?v=20261102-loop2','bb-receipt-scanner.css?v=20261031-receipt-pantry','shopping-inventory.js?v=20261103-feedback1','bb-intro-trial.js?v=bb-account-first-20261027-v1','bb-how-it-works.css?v=20261102-guide1','bb-how-it-works.js?v=20261102-guide1','bb-cold-preview.js?v=20261028-conversion-1','bb-funnel.js?v=20261028-v1','bb-ux-cleanup.js?v=20261028-ux1','bb-us-market.js?v=20261102-loop2','bb-install.js?v=173install1','bb-welcome-splash.js?v=20261101-signin2','bb-real-app-tour-v82.js?v=20261102-athome-receipts1','bb-cloudflare-qa.js?v=17513-owner1','bb-mobile-beta-polish.js?v=20261024-1','bb-beta-six-fixes.js?v=1767','bb-beta-launch-polish.js?v=1768','bb-consolidated-qa.js?v=20261025-r1','bb-beta-five-nav.js?v=20261025-five','bb-settings-premium-polish.css?v=20261026a','bb-mobile-three-20261027.css?v=20261027-mobile-3','bb-shop-cook-clarity.css?v=20261028-r1','bb-servings-mobile-polish.css?v=20261029-preview2','bb-partner-signup-prompt.css?v=partner-main1','bb-partner-signup-prompt.js?v=partner-main1','bb-household-sharing.css?v=20261030-rc1','bb-household-sharing.js?v=20261031-account-compliance','bb-recipe-ingredient-layout.css?v=20261031-sidebar','bb-pantry-deduction.js?v=20261102-pantry1','bb-featured-framing.js?v=20261102-frame1','bb-account-deletion.js?v=20261101-recovery1','make-a-meal.css?v=17.3-unified3','premium-upgrade.css?v=bb173premium1','bb-light-meal.css?v=173-light-1','bb-premium-features.css?v=173premiumfree1','bb-premium-preview-config.js?v=173premiumfree1','bb174-trial-ux.js?v=174trial1','bb-mobile-beta-polish.css?v=20261024-1','bb-servings-mobile-polish.css?v=20261029-preview1','bb-premium-feature-badges.js?v=20261101-badge1','bb-cook-studio.css?v=20261101-cook1','bb-cook-studio.js?v=20261101-cook1','bb-cook-result.css?v=20261101-cook1','bb-cook-result.js?v=20261102-loop2','bb-meal-image.css?v=20261101-cook1','bb-meal-image.js?v=20261101-cook1','bb-account-polish.css?v=20261101-keyboard1','bb-premium-preview-config.js?v=1743-premium-leftovers','make-a-meal.js?v=20261102-camera2','premium-upgrade.js?v=bb-native-ai-open-20261027-v1','bb-real-app-tour.js?v=17513real1','bb-beta-landing.css?v=20261030-finalmobile4','bb-smart-receipt-landing.css?v=20261031-family-preview','bb-family-landing.css?v=20261101-athome1','bb-family-landing.js?v=20261101-athome1','basketboss-aisles-v20.js?v=bb-meal-packs-20261031','bb-duration.js?v=20261102-durations1','bb-beta-landing.js?v=20261103-feedback1','bb-featured-framing.js','bb-duration.js','bb-recipe-measures.js','bb-cook-step-layout.js','bb-cook-pantry.js','bb-cook-clarity.css','bb-receipt-quantity.js','bb-pantry-deduction.js','bb-how-it-works.js','bb-how-it-works.css','bb-cook-speech-text.js','bb-cook-speech-text.js?v=20261103-kitchen1','bb-cook-tts.js','bb-cook-assistant.js','bb-cook-assistant.js?v=20261104-mentor-stream1','bb-cook-tts.js?v=20261104-mentor-stream1','bb-session.js','bb-session.js?v=20261102-session1','bb-plan-move.js','bb-plan-move.js?v=20261102-drag1','bb-plan-drag.js','bb-plan-drag.js?v=20261103-drag2','bb-plan-drag.css','bb-plan-drag.css?v=20261103-drag2','bb-recipe-editorial.js','bb-recipe-editorial.js?v=20261102-editorial4','bb-recipe-planning.js?v=20261102-editorial3','bb-shared-shopping.js','bb-shared-shopping.css','bb-shared-shopping.js?v=20261102-loop2','bb-shared-shopping.css?v=20261102-loop2','bb-home.js','bb-home.js?v=20261103-feedback1','bb-kitchen-choice-rules.mjs','bb-navigation-polish.css?v=20261102-loop3','bb-simple-layout.js','bb-simple-layout.css','bb-simple-layout.js?v=20261101-simple1','bb-simple-layout.css?v=20261102-loop2','bb-weekly-shop.js','bb-weekly-shop.css','bb-weekly-shop.js?v=20261101-weeklyshop1','bb-weekly-shop.css?v=20261101-weeklyshop1','bb-kitchen-essentials.js','bb-kitchen-essentials.css','bb-keyboard-layout.js','bb-keyboard-layout.css','bb-kitchen-essentials.js?v=20261103-feedback1','bb-kitchen-essentials.css?v=20261102-fourchoices1','bb-keyboard-layout.js?v=20261101-keyboard1','bb-keyboard-layout.css?v=20261101-keyboard1','bb-onboarding-v2.js?v=20261103-keyboard3','bb-onboarding-v2.css?v=20261101-signin3','bb-premium-features.js?v=20261101-weeklyshop1','bb-premium-feature-badges.js','bb-premium-feature-badges.css','bb-premium-feature-badges.js?v=20261101-weeklyshop1','bb-premium-feature-badges.css?v=20261101-badge1','bb-receipt-host.js?v=20261102-loop2','bb-receipt-host.css?v=20261101-receipt-tab1','bb-membership-compare.js?v=20261101-weeklyshop1','bb-membership-compare.css?v=20261101-member1','bb-verified-premium-ui.js?v=20261101-member1','bb-plan-premium-polish.js?v=20261101-autofill3','bb-plan-premium-polish.css?v=20261103-plan1','bb-account-polish.js?v=20261101-keyboard2','bb-account-polish.css?v=20261101-header2','bb-cook-plan-hotfix.css?v=20261101-corner2','bb-membership-compare.js','bb-membership-compare.css','bb-verified-premium-ui.js','bb-cook-plan-hotfix.css','basketboss-latest-guide.html','bb-real-app-tour-v82.js','bb-plan-premium-polish.js','bb-plan-premium-polish.css','bb-cook-studio.js','bb-cook-studio.js?v=20261103-photo-premium1','bb-cook-studio.css','bb-cook-studio.css?v=20261103-photo-premium1','bb-cook-result.js','bb-cook-result.css','bb-meal-image.js','bb-meal-image.css','bb-navigation-polish.js','bb-navigation-polish.css','bb-account-polish.js','bb-account-polish.css','bb-food-visuals.js','bb-food-visuals.css','bb-account-deletion.js','bb-account-deletion.css','terms.html','bb-receipt-host.js','bb-receipt-host.css','bb-receipt-inventory.js','bb-receipt-inventory-core.mjs','bb-receipt-scanner.js','bb-receipt-scanner.css','bb-weekly-essentials.js','bb-price-scan.js','bb-supermarkets.js','supermarket-price-observations.json','bb-funnel.css','bb-funnel.js','bb-consolidated-qa.css','bb-consolidated-qa.js','bb-culinary-enhancements.js','bb-culinary.css','index.html','tutorial.html','bb-real-app-tour.css','bb-real-app-tour.js','bb-cloudflare-qa.js','privacy.html','make-a-meal.html','make-a-meal.css','bb174-trial-ux.css','bb174-trial-ux.js','bb-premium-features.css','bb-premium-preview-config.js','bb-premium-features.js','bb-light-meal.css','make-a-meal.js','make-a-meal.js?v=20261103-photo-premium1','premium-upgrade.js','premium-upgrade.css','bb-intro-trial.js','bb-intro-trial.css','bb-us-market.js','bb-us-market.css','bb173-final-polish.css','bb-welcome-splash.js','bb-welcome-splash.css','bb-install.js','bb-install.css','shopping-inventory.js','bb-beta-launch-polish.js','bb-beta-launch-polish.css','bb-beta-six-fixes.css','bb-beta-six-fixes.js','bb-beta-five.css','bb-beta-five-nav.js','bb-recipe-planning.js','bb-recipe-ingredient-layout.css','bb-purchase-choice.css',
              'bb-ingredient-preferences.js','bb-ingredient-picker.js','bb-ingredient-picker.css',
              'bb-evening-pivot.js','bb-evening-pivot-app.js','bb-evening-pivot-ui.js','bb-evening-pivot-ui.css','bb-cook-voice.js','bb-cook-voice.css',
              'bb-evening-pivot.js?v=20261101-pivot1','bb-evening-pivot-app.js?v=20261103-feedback1','bb-evening-pivot-ui.js?v=20261102-loop2','bb-evening-pivot-ui.css?v=20261101-pivot2','bb-cook-voice.js?v=20261104-mentor-stream1','bb-cook-voice.css?v=20261103-mentor1',
              'bb-ingredient-preferences.js?v=20261101-avoid1','bb-ingredient-picker.js?v=20261101-avoid1','bb-ingredient-picker.css?v=20261101-avoid1',
              'icons/basketboss-crowned-v1766-180.png','icons/basketboss-crowned-v1766-192.png','icons/basketboss-crowned-v1766-512.png',
              'icons/basketboss-silver-192-v1755.png','icons/basketboss-silver-512-v1755.png','icons/basketboss-silver-180-v1755.png',
              'food-thumbs/tomato.webp','food-thumbs/lettuce.webp','food-thumbs/red-onion.webp',
              'food-thumbs/parmesan.webp','food-thumbs/eggs.webp','food-thumbs/chicken-breast.webp',
              'food-thumbs/rice.webp','food-thumbs/broccoli.webp','food-thumbs/yellow-pepper.webp',
              'food-thumbs/onion.webp','food-thumbs/red-pepper.webp','food-thumbs/courgette.webp',
  './basketboss-pricing-v19.js',

  './basketboss-aisles-v20.js',

  './ingredient-pack-catalog.json']
  .map(path => new URL(path, APP_BASE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => (key.startsWith('basketboss-v')||key.startsWith('basketboss-premium-secure-')) && ![CACHE, IMAGE_CACHE].includes(key))
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const target = new URL(req.url);
  if (target.origin !== self.location.origin) return;
  // Cloudflare Access may redirect this PWA asset to another origin.
  // Never cache the Access login page as a web manifest.
  if (target.pathname === new URL('manifest.webmanifest', APP_BASE).pathname) return;
  // Security: recipe catalogue must be refreshed from the public 100-only asset.
  // Do not fall back to potentially stale offline caches containing Premium content.
  if (target.pathname === new URL('recipes.json',APP_BASE).pathname) {
    event.respondWith(fetch(req,{cache:'no-store'}));
    return;
  }
  // Never cache live AI status or responses, even when served under our PWA scope.
  if (target.pathname.startsWith(new URL('api/', APP_BASE).pathname)) return;
  // Beta stability: browser installations on basketboss.co.uk and www each
  // have their own PWA cache. Always ask the network for these release-critical
  // STATIC assets, falling back to the cached file only while offline.
  // No account, plan, API or billing response may be cached by this exception.
  const releaseAssets = new Set(['bb-saved-weeks.js','bb-saved-weeks.css','bb-pantry-camera.js','bb-pantry-camera.css','bb-cook-experience.css','bb-featured-framing.js','bb-duration.js','bb-recipe-measures.js','bb-cook-step-layout.js','bb-cook-pantry.js','bb-cook-clarity.css','bb-receipt-quantity.js','bb-pantry-deduction.js','bb-how-it-works.js','bb-how-it-works.css','bb-cook-speech-text.js','bb-cook-tts.js','bb-cook-assistant.js','bb-session.js','bb-plan-move.js','bb-plan-drag.js','bb-plan-drag.css','bb-recipe-editorial.js','bb-shared-shopping.js','bb-shared-shopping.css','bb-home.js','bb-kitchen-choice-rules.mjs','bb-simple-layout.js','bb-simple-layout.css','bb-weekly-shop.js','bb-weekly-shop.css','bb-kitchen-essentials.js','bb-kitchen-essentials.css','bb-keyboard-layout.js','bb-keyboard-layout.css','bb-premium-features.js','bb-premium-feature-badges.js','bb-premium-feature-badges.css','bb-membership-compare.js','bb-membership-compare.css','bb-verified-premium-ui.js','bb-cook-plan-hotfix.css',
    'tutorial.html','basketboss-latest-guide.html','bb-real-app-tour-v82.js','bb-plan-premium-polish.js','bb-plan-premium-polish.css',
    'bb-cook-studio.js','bb-cook-studio.css','bb-cook-result.js','bb-cook-result.css','bb-meal-image.js','bb-meal-image.css','bb-navigation-polish.js','bb-navigation-polish.css','bb-account-polish.js','bb-account-polish.css',
    'make-a-meal.js','make-a-meal.css','bb-welcome-splash.js','bb-welcome-splash.css','bb-account-deletion.js','bb-account-deletion.css','bb-food-visuals.js','bb-food-visuals.css',
    'bb-onboarding-v2.js','bb-onboarding-v2.css',
    'bb-ingredient-preferences.js','bb-ingredient-picker.js','bb-ingredient-picker.css',
    'bb-evening-pivot.js','bb-evening-pivot-app.js','bb-evening-pivot-ui.js','bb-evening-pivot-ui.css','bb-cook-voice.js','bb-cook-voice.css',
    'bb-household-sharing.js','bb-household-sharing.css','bb-membership-settings.js','bb-membership-settings.css','privacy.html','terms.html','subscriptions.html',
    'bb-serving-scale.js','basketboss-pricing-v19.js','ingredient-pack-catalog.json','bb-us-market.js','bb-us-market.css','bb-supermarkets.js','bb-price-scan.js','supermarket-price-observations.json','bb-beta-landing.js',
    'bb-receipt-host.js','bb-receipt-host.css','bb-receipt-inventory.js','bb-receipt-inventory-core.mjs','bb-receipt-scanner.js','bb-receipt-scanner.css','bb-weekly-essentials.js',
    'bb-recipe-planning.js','bb-recipe-ingredient-layout.css',
    'bb-partner-signup-prompt.js','bb-partner-signup-prompt.css'
  ].map(path => new URL(path, APP_BASE).pathname));
  if (releaseAssets.has(target.pathname)) {
    event.respondWith(fetch(req, {cache:'no-store'}).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
      }
      return response;
    }).catch(async () => (await caches.match(req)) || Response.error()));
    return;
  }
  if (target.pathname.startsWith(APP_BASE.pathname)) {
    if (req.mode === 'navigate') {
      event.respondWith(fetch(req).then(response => {
        if (response.ok) { const copy=response.clone(); event.waitUntil(caches.open(CACHE).then(c=>c.put(req,copy))); }
        return response;
      }).catch(async () => {
        const cached = await caches.match(req, {ignoreSearch: true});
        if (cached) return cached;
        const pathname = new URL(req.url).pathname;
        if (pathname === APP_BASE.pathname || pathname === new URL('index.html',APP_BASE).pathname)
          return (await caches.match(new URL('index.html',APP_BASE).href)) || Response.error();
        return Response.error();
      }));
      return;
    }
    event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(response => {
      if (response.ok) { const copy=response.clone(); event.waitUntil(caches.open(CACHE).then(c=>c.put(req,copy))); }
      return response;
    })));
    return;
  }
  // Only same-origin recipe images that the user has opened; not blanket cache of all 321.
  if (req.destination === 'image') {
    event.respondWith(caches.open(IMAGE_CACHE).then(async cache => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try { const response = await fetch(req); if (response.ok) event.waitUntil(cache.put(req,response.clone())); return response; }
      catch (_) { return Response.error(); }
    }));
  }
});
