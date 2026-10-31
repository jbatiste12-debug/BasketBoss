/* BasketBoss v17.2 release-candidate scoped offline shell.
 * Caches app pages and assets only; no personal localStorage or sync data is transmitted.
 * Food photographs outside the preview are cached only after being viewed, where supported.
 */
const CACHE = 'basketboss-premium-secure-shell-20261030-v14-beta-live-meal-pricing-20261031';
const IMAGE_CACHE = 'basketboss-v17513-owner-qa-images-v1';
const APP_BASE = new URL(self.registration.scope);
const CORE = ['bb-price-scan.js','bb-supermarkets.js','supermarket-price-observations.json','bb-funnel.css','bb-funnel.js','bb-consolidated-qa.css','bb-consolidated-qa.js','bb-culinary-enhancements.js','bb-culinary.css','index.html','tutorial.html','bb-real-app-tour.css','bb-real-app-tour.js','bb-cloudflare-qa.js','privacy.html','make-a-meal.html','make-a-meal.css','bb174-trial-ux.css','bb174-trial-ux.js','bb-premium-features.css','bb-premium-preview-config.js','bb-premium-features.js','bb-light-meal.css','make-a-meal.js','premium-upgrade.js','premium-upgrade.css','bb-intro-trial.js','bb-intro-trial.css','bb-us-market.js','bb-us-market.css','bb173-final-polish.css','bb-welcome-splash.js','bb-welcome-splash.css','bb-install.js','bb-install.css','shopping-inventory.js','bb-beta-launch-polish.js','bb-beta-launch-polish.css','bb-beta-six-fixes.css','bb-beta-six-fixes.js','bb-beta-five.css','bb-beta-five-nav.js','bb-purchase-choice.css',
              'icons/basketboss-crowned-v1766-180.png','icons/basketboss-crowned-v1766-192.png','icons/basketboss-crowned-v1766-512.png',
              'icons/basketboss-silver-192-v1755.png','icons/basketboss-silver-512-v1755.png','icons/basketboss-silver-180-v1755.png',
              'food-thumbs/tomato.webp','food-thumbs/lettuce.webp','food-thumbs/red-onion.webp',
              'food-thumbs/parmesan.webp','food-thumbs/eggs.webp','food-thumbs/chicken-breast.webp',
              'food-thumbs/rice.webp','food-thumbs/broccoli.webp','food-thumbs/yellow-pepper.webp',
              'food-thumbs/onion.webp','food-thumbs/red-pepper.webp','food-thumbs/courgette.webp',
  './basketboss-pricing-v19.js',
  './basketboss-pricing-v19.js?v=bb82-aisle-20261024',
  './basketboss-aisles-v20.js',
  './basketboss-aisles-v20.js?v=bb82-aisle-20261024',
  './ingredient-pack-catalog.json',
  './make-a-meal.js?v=bb83-20261024',
  './make-a-meal.js?v=bb717-20261024'
]
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
  const releaseAssets = new Set([
    'bb-onboarding-v2.js','bb-onboarding-v2.css',
    'bb-household-sharing.js','bb-household-sharing.css',
    'bb-serving-scale.js','basketboss-pricing-v19.js','ingredient-pack-catalog.json','bb-us-market.js','bb-us-market.css','bb-supermarkets.js','bb-price-scan.js','supermarket-price-observations.json','bb-beta-landing.js',
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
