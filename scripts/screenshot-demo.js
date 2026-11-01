/* Capture-only automation, injected by the isolated Debug simulator workflow.
 * Seeds fictional device-local data and drives the shipped UI/controllers.
 * This file is excluded from the normal app bundle and all Release builds.
 */
(() => {
  'use strict';
  const target = window.__BB_SCREENSHOT_TARGET__;
  if (!['plan', 'discover', 'recipe', 'kitchen', 'shop', 'receipt', 'cook', 'budget', 'instructions', 'shopping', 'meal'].includes(target)) return;
  const post = data => window.webkit?.messageHandlers?.bbScreenshot?.postMessage({ target, path: location.pathname, ...data });
  const errors = [];
  addEventListener('error', event => { if (event.error) errors.push(String(event.error.message || event.message)); });
  addEventListener('unhandledrejection', event => errors.push(String(event.reason?.message || event.reason)));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(test, description, timeout = 50000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = test(); if (result) return result;
      await sleep(100);
    }
    throw Error('Timed out waiting for ' + description);
  }
  const put = (key, value) => localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const meals = ['fajitas', 'creamy-pasta', 'chickpea-curry', 'salmon', 'beef-chilli', 'sausage-gnocchi', 'traybake-sausage'];
  const foods = [
    { name: 'Rice', key: 'rice', loc: 'cupboard', qty: 1000, unit: 'g' },
    { name: 'Pasta', key: 'pasta', loc: 'cupboard', qty: 500, unit: 'g' },
    { name: 'Tinned tomatoes', key: 'tinned tomatoes', loc: 'cupboard', qty: 800, unit: 'g' },
    { name: 'Chickpeas', key: 'chickpeas', loc: 'cupboard', qty: 400, unit: 'g' },
    { name: 'Garlic', key: 'garlic', loc: 'cupboard', qty: 6, unit: 'clove' },
    { name: 'Milk', key: 'milk', loc: 'fridge', qty: 2000, unit: 'ml' },
    { name: 'Eggs', key: 'egg', loc: 'fridge', qty: 6, unit: 'each' },
    { name: 'Spinach', key: 'spinach', loc: 'fridge', qty: 200, unit: 'g' },
    { name: 'Cheddar', key: 'cheddar', loc: 'fridge', qty: 300, unit: 'g' },
    { name: 'Frozen peas', key: 'pea', loc: 'freezer', qty: 500, unit: 'g' }
  ];
  // A fresh CI simulator has no customer account or saved data. Seed only this
  // disposable installation; never authorize Premium or contact a live backend.
  put('bb_onboarding_fresh_once_20261028_v1', { complete: true, step: 10, house: '3–4 people', region: 'UK', goals: ['Plan dinners faster'], diets: ['No specific preference'], partnerStepV2: true });
  put('basketboss_onboarding_seen_v1', 'true');
  put('basketboss_321_v7_market', 'UK');
  put('basketboss_v172_weekly_budget_target_v1', '120');
  put('basketboss_v172_weekly_budget_v1', '120');
  put('basketboss_321_unified_state_v1', { version: 2, planned: meals.map((recipeId, index) => ({ recipeId, day: days[index] })), pantry: {}, customPantry: [], dismissed: [], servings: 4, feedingSet: true });
  put('basketboss_321_v7_measured_pantry', Object.fromEntries(foods.map(food => [food.key + '|' + food.unit, food.qty])));
  put('basketboss_makeameal_v1_inventory', Object.fromEntries(foods.map(food => [food.loc + '|' + food.key, { ...food, selected: true, source: 'added', bb173StockKey: food.key + '|' + food.unit }])));
  put('basketboss_ui_next_confirmed_pantry_v1', { version: 1, items: foods, confirmedAt: new Date().toISOString() });
  window.__bbStartRandomised = true;
  post({ phase: 'seeded', ready: false });

  async function settle() {
    document.activeElement?.blur?.();
    await document.fonts?.ready;
    // Wait for visible photo tiles and recipe photographs, including lazy images.
    await Promise.all([...document.images].filter(img => {
      const r = img.getBoundingClientRect();
      return r.width && r.height && r.bottom > 0 && r.top < innerHeight;
    }).map(async img => {
      if (img.complete) return;
      await Promise.race([new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); }), sleep(10000)]);
    }));
    await sleep(2200);
    document.activeElement?.blur?.();
  }
  async function selectTab(tab) {
    const button = await until(() => document.querySelector('[data-tab="' + tab + '"]'), tab + ' tab');
    button.click();
    await until(() => document.body.dataset.bbnextView === tab, tab + ' view');
    await sleep(1000);
    scrollTo({ top: 0, behavior: 'instant' });
  }
  async function receiptReview() {
    await until(() => window.BBReceiptScannerFactory, 'receipt scanner');
    const core = await import(new URL('bb-receipt-inventory-core.mjs', location.href).href);
    const catalog = [{ key: 'pasta', name: 'Pasta', unit: 'g' }, { key: 'milk', name: 'Milk', unit: 'ml' }, { key: 'spinach', name: 'Spinach', unit: 'g' }];
    const receipt = {
      currency: 'GBP', retailer: 'Tesco', purchasedAt: '2026-11-01', receiptTotal: 7.25,
      items: [
        { lineId: 'demo-pasta', name: 'Penne pasta', kind: 'food', canonicalKey: 'pasta', quantity: 500, unit: 'g', pricePaid: 1.25, priceType: 'regular', confidence: 'high', location: 'cupboard' },
        { lineId: 'demo-milk', name: 'Semi-skimmed milk', kind: 'food', canonicalKey: 'milk', quantity: 2000, unit: 'ml', pricePaid: 1.65, priceType: 'regular', confidence: 'high', location: 'fridge' },
        { lineId: 'demo-spinach', name: 'Baby spinach', kind: 'food', canonicalKey: 'spinach', quantity: 200, unit: 'g', pricePaid: 1.35, priceType: 'regular', confidence: 'high', location: 'fridge' },
        { lineId: 'demo-washing-up', name: 'Washing-up liquid', kind: 'essential', quantity: 500, unit: 'ml', pricePaid: 3, priceType: 'regular', confidence: 'high' }
      ]
    };
    const scanner = window.BBReceiptScannerFactory({
      core,
      getSession: () => ({ access_token: 'offline-screenshot-fixture', expires_at: 4000000000, user: { id: 'screenshot_demo_household' } }),
      getContext: () => ({ market: 'UK', retailer: 'Tesco' }),
      inventory: {
        canonicalOptions: async () => catalog,
        normalizeDraft: async raw => ({ ...core.normalizeReceiptDraft(raw, { market: 'UK', retailer: 'Tesco', catalog }), receiptId: 'receipt-screenshot-demo' }),
        cancelDraft() {},
        commitReviewedReceipt: async () => { throw Error('Screenshot fixture cannot save receipts.'); }
      },
      preparePhoto: async () => ({ mimeType: 'image/jpeg', imageBase64: '/9j/demo-only-no-upload' }),
      fetch: async url => {
        const body = String(url).includes('/scan') ? { ok: true, reviewRequired: true, receiptInventory: receipt }
          : String(url).includes('/bb173/status') ? { status: 'available', premium_ai: true, turnstileRequired: false }
          : { ok: true, available: true, premium: true, migrationReady: true };
        return { ok: true, status: 200, json: async () => body };
      }
    });
    const dialog = await scanner.open({ market: 'UK', retailer: 'Tesco' });
    const fileInput = await until(() => { const input = dialog.querySelector('[data-receipt-action="file"]'); return input && !input.disabled && input; }, 'demo receipt input');
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 500;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 400, 500); context.fillStyle = '#222'; context.font = '22px monospace';
    ['TESCO', 'DEMO RECEIPT', '', 'Penne pasta       1.25', 'Milk 2L           1.65', 'Baby spinach      1.35', 'Washing-up liquid 3.00', '', 'TOTAL GBP         7.25'].forEach((line, i) => context.fillText(line, 20, 45 + i * 35));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'demo-receipt.jpg', { type: 'image/jpeg' })); fileInput.files = transfer.files; fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    const consent = dialog.querySelector('[data-receipt-top="consent"]'); consent.checked = true; consent.dispatchEvent(new Event('change', { bubbles: true }));
    const scan = await until(() => { const button = dialog.querySelector('[data-receipt-action="scan"]'); return button && !button.disabled && button; }, 'scan button'); scan.click();
    await until(() => { const review = dialog.querySelector('.bb-receipt-review'); return review && !review.hidden && review; }, 'receipt review');
    document.activeElement?.blur?.();
    for (const check of dialog.querySelectorAll('[data-receipt-top="storeReviewed"], [data-receipt-top="currencyReviewed"], [data-receipt-top="totalReviewed"]')) { check.checked = true; check.dispatchEvent(new Event('change', { bubbles: true })); }
    await sleep(1200);
    // Scroll the real modal to its editable review, leaving the first item visible.
    const review = dialog.querySelector('.bb-receipt-review');
    dialog.scrollTop = review.offsetTop - dialog.offsetTop - 16;
    document.activeElement?.blur?.();
  }
  (async () => {
    await until(() => document.readyState !== 'loading', 'document');
    if (location.pathname.endsWith('/make-a-meal.html')) {
      if (target !== 'cook') { location.href = 'index.html'; return; }
      await until(() => document.documentElement.classList.contains('bb-cook-ready') && document.querySelector('.bb-cook-studio'), 'Cook studio');
    } else {
      await until(() => window.BBNativeStartup?.phase === 'ready' && document.querySelector('#app')?.firstElementChild, 'native startup');
      if (target === 'cook') {
        const link = await until(() => document.querySelector('.bb173-make-meal-link'), 'Cook link'); link.click(); return;
      }
      if (target === 'plan' || target === 'budget') await selectTab('week');
      if (target === 'discover' || target === 'recipe' || target === 'instructions' || target === 'meal') {
        await selectTab('discover');
        if (target === 'recipe' || target === 'instructions') {
          const button = await until(() => document.querySelector('#cookRecipe'), 'View Recipe & Cook'); button.click();
          await until(() => document.querySelector('.cook-overlay .bb-kitchen'), 'recipe detail');
          if (target === 'instructions') {
            (await until(() => document.querySelector('#bbStart'), 'Start cooking')).click();
            await until(() => document.querySelector('#bbInstruction')?.textContent.trim(), 'cooking instructions');
            document.querySelector('.bb-kitchen').scrollTop = 0;
          }
        }
      }
      if (target === 'kitchen') await selectTab('shop');
      if (target === 'shop' || target === 'receipt' || target === 'shopping') await selectTab('shop-list');
      if (target === 'receipt') await receiptReview();
      if (target === 'shopping') {
        const begin = await until(() => {
          const button = document.querySelector('.bb-r6-begin') || document.querySelector('.bbm-begin');
          return button && !button.disabled && button.getBoundingClientRect().height > 0 && button;
        }, 'Begin shop button');
        begin.click();
        await until(() => document.body.classList.contains('bb172-storefront-visible') && document.querySelector('#bb172Storefront .bb172-storefront-checkbox'), 'actual shopping checklist');
        document.querySelector('#bb172Storefront').scrollTop = 250;
      }
    }
    if (target !== 'receipt') scrollTo({ top: 0, behavior: 'instant' });
    if (target === 'plan') {
      const firstDay = await until(() => document.querySelector('.bbnext-day'), 'planned meal cards');
      scrollTo({ top: Math.max(0, scrollY + firstDay.getBoundingClientRect().top - 30), behavior: 'instant' });
    }
    if (target === 'meal') {
      const cook = await until(() => document.querySelector('#cookRecipe'), 'View Recipe & Cook');
      scrollTo({top: Math.max(0, scrollY + cook.getBoundingClientRect().bottom - (innerHeight - 150)), behavior: 'instant'});
    }
    await settle();
    const missingVisibleImages = [...document.images].filter(img => { const r = img.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < innerHeight && img.complete && !img.naturalWidth; }).map(img => img.src.split('/').pop());
    let budget = null;
    if (target === 'budget') {
      const total = document.querySelector('#myWeekEstimatedTotal');
      const weeklyTarget = document.querySelector('.bbnext-plan-budget-line');
      const ring = document.querySelector('.bbnext-plan-donut[role="progressbar"]');
      const visible = element => {
        if (!element) return false;
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
      };
      budget = { estimatedTotal: total?.textContent.trim() || '', weeklyTarget: weeklyTarget?.textContent.trim() || '', ringValue: ring?.getAttribute('aria-valuenow') || '', ringLabel: ring?.getAttribute('aria-valuetext') || '', totalVisible: visible(total), targetVisible: visible(weeklyTarget), ringVisible: visible(ring) };
      if (budget.estimatedTotal !== '£107.80' || budget.weeklyTarget !== '£120.00 weekly target' || !budget.ringLabel.includes('£107.80 estimated of £120.00') || !budget.totalVisible || !budget.targetVisible || !budget.ringVisible) throw Error('Budget values or viewport visibility differ from the demo: ' + JSON.stringify(budget));
    }
    const screenPresent = target === 'shopping' ? document.body.classList.contains('bb172-storefront-visible') && document.querySelectorAll('#bb172Storefront .bb172-storefront-checkbox').length > 0
      : target === 'meal' ? document.body.dataset.bbnextView === 'discover' && !!document.querySelector('.bb-featured-card') && (() => { const button = document.querySelector('#cookRecipe'), r = button?.getBoundingClientRect(); return r && r.top >= 0 && r.bottom <= innerHeight - 70 && r.width > 0; })()
      : target === 'budget' ? document.body.dataset.bbnextView === 'week' && budget?.totalVisible && budget?.targetVisible && budget?.ringVisible
      : target === 'plan' ? document.body.dataset.bbnextView === 'week' && document.querySelectorAll('.bbnext-day').length === 7
      : target === 'discover' ? document.body.dataset.bbnextView === 'discover' && !!document.querySelector('.bb-featured-card')
      : target === 'instructions' ? !!document.querySelector('#bbInstruction')?.textContent.trim() && !!document.querySelector('#bbPhaseCook.active')
      : target === 'recipe' ? !!document.querySelector('.cook-overlay .bb-kitchen #bbTitle')
      : target === 'kitchen' ? document.body.dataset.bbnextView === 'shop'
      : target === 'shop' ? document.body.dataset.bbnextView === 'shop-list' && !!document.querySelector('#bbMobileShopPreview')
      : target === 'receipt' ? !!document.querySelector('.bb-receipt-review:not([hidden]) .bb-receipt-row')
      : !!document.querySelector('.bb-cook-studio') && document.documentElement.classList.contains('bb-cook-ready');
    if (!screenPresent) throw Error('Requested screen is not mounted: ' + target);
    if (missingVisibleImages.length) throw Error('Visible images failed to load: ' + missingVisibleImages.join(', '));
    post({ ready: true, screenPresent: true, ...(budget ? { budget } : {}), phase: 'ready', nativeOrigin: location.protocol === 'capacitor:', heading: document.querySelector('#bbTitle, #app h2, #app h3, .bb-cook-studio h1')?.textContent || '', errors: errors.slice(0, 6), missingVisibleImages, width: innerWidth, height: innerHeight });
  })().catch(error => post({ ready: false, failed: true, phase: 'failed', error: String(error.stack || error), errors: errors.slice(0, 6) }));
})();
