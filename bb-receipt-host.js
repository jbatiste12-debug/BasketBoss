/* Receipt inventory bridge. Cloud confirmation precedes stock changes. */
(function (root) {
  'use strict';
  const KEYS = Object.freeze({
    actor: 'basketboss_receipt_host_actor_v1',
    stock: 'basketboss_321_v7_measured_pantry',
    kitchen: 'basketboss_makeameal_v1_inventory',
    confirmed: 'basketboss_ui_next_confirmed_pantry_v1',
    ledger: 'basketboss_purchase_receipts_v1',
    owner: 'basketboss_receipt_projection_owner_v1'
  });
  const ACTIVE_KEYS = [KEYS.stock, KEYS.kitchen, KEYS.confirmed, KEYS.ledger, KEYS.owner];
  const CURRENCIES = {UK: 'GBP', Guernsey: 'GBP', Jersey: 'GBP', US: 'USD'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  const money = (amount, currency) => new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-GB', {style: 'currency', currency}).format(amount);
  const calendarDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  function actorOf(session) { return typeof session?.user?.id === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(session.user.id) ? session.user.id : 'guest'; }
  function safeDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
    if (value.length === 10) {
      const parsed = new Date(value + 'T12:00:00Z');
      return parsed.toISOString().slice(0, 10) === value ? value : null;
    }
    return calendarDate(new Date(value));
  }
  function weekBounds(now) {
    const date = new Date(now); if (!Number.isFinite(date.getTime())) throw Error('invalid_receipt_week');
    const day = date.getDay(), start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (day + 6) % 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return {start: calendarDate(start), end: calendarDate(end)};
  }
  function weeklyReceiptSummary(projection, context, now = Date.now()) {
    const currency = CURRENCIES[context?.market];
    if (!currency) return {currency: null, receipts: [], essentials: [], food: 0, nonFood: 0, paid: 0, unallocated: 0, incomplete: false};
    const bounds = weekBounds(now), seen = new Set(); let unallocated = 0, incomplete = false;
    const relevant = row => {
      if (row.market !== context.market || row.currency !== currency) return false;
      const purchased = safeDate(row.purchasedAt);
      if (!purchased) { unallocated++; return false; }
      return purchased >= bounds.start && purchased < bounds.end;
    };
    const receipts = (Array.isArray(projection?.receipts) ? projection.receipts : []).filter(row => {
      if (!isObject(row) || typeof row.receiptId !== 'string' || seen.has(row.receiptId) || !relevant(row)) return false;
      seen.add(row.receiptId); return true;
    });
    const essentialIds = new Set();
    const essentials = (Array.isArray(projection?.essentials) ? projection.essentials : []).filter(row => {
      if (!isObject(row) || typeof row.receiptId !== 'string' || typeof row.name !== 'string') return false;
      const id = row.receiptId + '|' + (row.lineId || row.id || row.name);
      if (essentialIds.has(id) || !relevant(row)) return false;
      essentialIds.add(id); return true;
    });
    const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000 ? value : null;
    let food = 0, nonFood = 0, paid = 0, knownTotals = 0;
    for (const row of receipts) {
      const f = amount(row.foodSubtotal), n = amount(row.essentialsSubtotal), total = typeof row.receiptTotal === 'number' && Number.isFinite(row.receiptTotal) && Math.abs(row.receiptTotal) <= 100000 ? row.receiptTotal : null;
      if (f === null || n === null || total === null) incomplete = true;
      food += f || 0; nonFood += n || 0; paid += total || 0;if (total !== null) knownTotals++;
    }
    if (!receipts.length) for (const row of essentials) { const n = amount(row.pricePaid); nonFood += n || 0; if (n === null) incomplete = true; }
    return {currency, receipts, essentials, food: Math.round(food * 100) / 100, nonFood: Math.round(nonFood * 100) / 100, paid: receipts.length && !knownTotals ? null : Math.round(paid * 100) / 100, unallocated, incomplete};
  }
  function createHost(initial = {}) {
    let options = {...initial}, availability = {available: false, premium: false}, lastChecked = 0, checkedActor = null, statusPromise = null;
    let isolationError = null, issue = null, observer = null, scheduled = false, rendering = false, reviewing = false, confirmingCurrent = false, activeDialog = null, lastTab = null, generation = 0, configured = false;
    const store = () => options.storage || root.localStorage;
    const doc = () => options.document || root.document;
    const session = () => options.getSession?.() || null;
    const context = () => options.getContext?.() || {};
    const adapter = () => options.inventory || root.BBReceiptInventory;
    const scanner = () => options.scanner || root.BBReceiptScanner;
    const clock = () => options.now?.() ?? Date.now();
    const actor = () => actorOf(session());
    const read = (key, fallback = {}) => {
      const value = store().getItem(key); if (value === null) return clone(fallback);
      let parsed; try { parsed = JSON.parse(value); } catch { throw Error('receipt_host_storage_unreadable'); }
      if (!isObject(parsed)) throw Error('receipt_host_storage_unreadable'); return parsed;
    };
    const notify = text => options.notify?.(text);
    const projection = () => { try { return actor() === 'guest' ? null : adapter()?.getCachedProjection?.() || null; } catch { return null; } };
    function writeAtomic(changes) {
      const before = Object.fromEntries(Object.keys(changes).map(key => [key, store().getItem(key)]));
      const after = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value === null ? null : JSON.stringify(value)]));
      const written = [];
      try {
        for (const [key, value] of Object.entries(after)) {
          if (store().getItem(key) !== before[key]) throw Error('receipt_host_storage_changed');
          value === null ? store().removeItem(key) : store().setItem(key, value); written.push(key);
          if (store().getItem(key) !== value) throw Error('receipt_host_storage_write_failed');
        }
      } catch (error) {
        for (const key of written.reverse()) try {
          if (store().getItem(key) === after[key]) before[key] === null ? store().removeItem(key) : store().setItem(key, before[key]);
        } catch {}
        throw error;
      }
    }
    function archiveKey(id) { return 'basketboss_receipt_host_snapshot_v1:' + encodeURIComponent(id); }
    function switchActor() {
      const next = actor();
      const marker = read(KEYS.actor), receiptOwner = read(KEYS.owner);
      const previous = marker.actorId || receiptOwner.actorId || next;
      if (previous === next) {
        if (!marker.actorId) writeAtomic({[KEYS.actor]: {version: 1, actorId: next}});
        return false;
      }
      if (typeof previous !== 'string' || !/^(?:guest|[A-Za-z0-9_-]{8,120})$/.test(previous)) throw Error('receipt_host_actor_invalid');
      const saved = Object.fromEntries(ACTIVE_KEYS.map(key => [key, store().getItem(key)]));
      const savedEssentials = options.getEssentials ? clone(options.getEssentials() || []) : [];
      const destination = read(archiveKey(next));
      if (Object.keys(destination).length && (destination.version !== 1 || destination.actorId !== next || !isObject(destination.values) || Object.keys(destination.values).length !== ACTIVE_KEYS.length || ACTIVE_KEYS.some(key => !Object.hasOwn(destination.values, key) || destination.values[key] !== null && typeof destination.values[key] !== 'string'))) throw Error('receipt_host_snapshot_invalid');
      const values = destination.values || Object.fromEntries(ACTIVE_KEYS.map(key => [key, null]));
      if (destination.essentials !== undefined && (!Array.isArray(destination.essentials) || destination.essentials.length > 60)) throw Error('receipt_host_snapshot_invalid');
      const changes = {[archiveKey(previous)]: {version: 1, actorId: previous, values: saved, essentials: savedEssentials}, [KEYS.actor]: {version: 1, actorId: next}};
      for (const key of ACTIVE_KEYS) changes[key] = values[key] === null ? null : JSON.parse(values[key]);
      if (options.setEssentials && options.setEssentials(clone(destination.essentials || [])) === false) throw Error('receipt_host_essentials_switch_failed');
      try {writeAtomic(changes);} catch (error) {try {options.setEssentials?.(savedEssentials);} catch {} throw error;}
      availability = {available: false, premium: false}; lastChecked = 0; checkedActor = null; statusPromise = null;generation++;
      options.onProjection?.({actorChanged: true});
      return true;
    }
    function isolate() {
      try {
        const changed = switchActor();isolationError = null;doc()?.body?.removeAttribute('data-bb-receipt-isolation-error');
        const app = doc()?.getElementById('app');if (app) {app.inert = false;app.style.removeProperty('visibility');}
        return changed;
      }
      catch {
        isolationError = 'Your pantry could not switch accounts safely. Free up device storage and reload before using Shopping.';
        doc()?.body?.setAttribute('data-bb-receipt-isolation-error', 'true');return false;
      }
    }
    function hasPendingConfirmation() {
      if (isolationError) return true;
      if (actor() === 'guest') return false;
      try { return !!store().getItem('basketboss_receipt_inventory_journal_v1:' + encodeURIComponent(actor())) || !!adapter()?.getPendingConfirmation?.()?.receiptId; } catch { return true; }
    }
    function requiresPantryReview() {
      if (isolationError || hasPendingConfirmation()) return true;
      const cached = projection(); if (!cached) return false;
      if (!availability.available && hasLocalReview(cached)) return false;
      if (issue?.includes('pantry_merge_required') || issue === 'receipt_household_scope_changed' || issue === 'receipt_refresh_required') return true;
      return cached.pantryReview?.required === true || !!(cached.lastReceiptId || cached.receipts?.length) && cached.pantryReview?.shopSessionId !== (context().shopSessionId || null);
    }
    function hasLocalReview(cached) {
      try {
        const ack = read(KEYS.confirmed).receiptLocalReview;
        return ack?.actorId === actor() && ack.shopSessionId === (context().shopSessionId || null) && ack.inventoryRevision === cached.inventoryRevision && ack.scope === cached.scope?.kind + ':' + cached.scope?.id;
      } catch {return false;}
    }
    function confirmLocalPantryReview() {
      if (availability.available || hasPendingConfirmation() || isolationError) return {ok: false, localOnly: true};
      const cached = projection();if (!cached) return {ok: true, localOnly: true};
      const confirmed = read(KEYS.confirmed), reviewedAt = Date.parse(confirmed.confirmedAt || '');
      if (confirmed.version !== 1 || !Array.isArray(confirmed.items) || !Number.isFinite(reviewedAt) || Math.abs(clock() - reviewedAt) > 60000) return {ok: false, localOnly: true};
      writeAtomic({[KEYS.confirmed]: {...confirmed, receiptLocalReview: {actorId: actor(), shopSessionId: context().shopSessionId || null, inventoryRevision: cached.inventoryRevision, scope: cached.scope.kind + ':' + cached.scope.id, confirmedAt: confirmed.confirmedAt}}});
      schedule();return {ok: true, localOnly: true};
    }
    function allowLegacyTransfer() {
      if (!hasPendingConfirmation() && !isolationError && !reviewing && !confirmingCurrent) return true;
      notify('Recover the pending receipt before finishing this shop. No leftovers have been transferred.');
      return false;
    }
    function handlesInventorySync() { return projection()?.scope?.kind === 'household'; }
    function coversLegacyCredit(receipt) {
      const cached = projection();
      return !!cached && !requiresPantryReview() && receipt?.receiptPantryConfirmedActor === actor() && receipt.receiptPantryConfirmedScope === cached.scope?.kind + ':' + cached.scope?.id && Number.isSafeInteger(receipt.receiptPantryConfirmedRevision) && receipt.receiptPantryConfirmedRevision <= cached.inventoryRevision && receipt.receiptPantryConfirmedShopSessionId === (context().shopSessionId || null);
    }
    async function fetchInventory(signal) {
      const current = session(), id = actor(), token = current?.access_token;
      if (id === 'guest' || !token) throw Error('Sign in to review your saved pantry.');
      const perform = options.fetch || root.fetch?.bind(root);
      const response = await perform('/api/receipt-inventory', {headers: {Accept: 'application/json', Authorization: 'Bearer ' + token}, credentials: 'same-origin', redirect: 'manual', cache: 'no-store', signal});
      const data = await response.json().catch(() => null);
      if (id !== actor() || token !== session()?.access_token) throw Error('Account changed. Reopen Pantry review.');
      if (!response.ok || data?.ok !== true) throw Error('The saved pantry is unavailable. Your quantities have not changed.');
      if (!isObject(data.stock) || !['user', 'household'].includes(data.scope?.kind) || typeof data.scope.id !== 'string' || data.scope.kind === 'user' && data.scope.id !== id || !Number.isSafeInteger(data.inventoryRevision) || data.inventoryRevision < 0 || typeof data.initialized !== 'boolean') throw Error('The saved pantry could not be verified.');
      return data;
    }
    async function refreshAvailability({force = false, synchronize = true} = {}) {
      isolate(); if (isolationError) { afterRender(); return {available: false}; }
      const id = actor();
      if (id === 'guest') { availability = {available: false, premium: false}; checkedActor = id; afterRender(); return availability; }
      if (statusPromise) return statusPromise;
      if (!force && checkedActor === id && clock() - lastChecked < 30000) return availability;
      const token = session()?.access_token, serial = generation;
      statusPromise = (async () => {
        try {
          const perform = options.fetch || root.fetch?.bind(root);
          const response = await perform('/api/receipt-inventory?mode=status', {headers: {Accept: 'application/json', Authorization: 'Bearer ' + token}, credentials: 'same-origin', redirect: 'manual', cache: 'no-store'});
          const data = await response.json().catch(() => null);
          if (serial !== generation || id !== actor() || token !== session()?.access_token) return {available: false};
          availability = {available: response.ok && data?.available === true, premium: response.ok && data?.premium === true, configured: data?.configured === true};
          checkedActor = id; lastChecked = clock();
          if (availability.available && synchronize) {
            adapter()?.recoverLocalTransaction?.();
            const result = await adapter().synchronize();
            if (id !== actor()) return {available: false};
            issue = result?.localApplied === false ? result.localError || 'receipt_refresh_required' : null;
          }
        } catch { if (id === actor() && (availability.available || projection())) issue = 'Receipt inventory is temporarily unavailable. Your local pantry is preserved.'; }
        finally { if (serial === generation && id === actor()) statusPromise = null;afterRender(); }
        return availability;
      })();
      return statusPromise;
    }
    function setupAdapter() {
      adapter()?.configure?.({getSession: session, getContext: context, getCatalog: options.getCatalog, canonicalize: options.canonicalize,
        getFinishShopCredits: options.getFinishShopCredits,
        onProjection: value => {issue = null; options.onProjection?.(value); schedule();}});
      scanner()?.configure?.({getSession: session, getContext: context, inventory: adapter()});
    }
    async function open(value = {}) {
      isolate(); if (isolationError) {notify(isolationError); return null;}
      if (reviewing || confirmingCurrent) {notify('Finish or close your Pantry review before scanning another receipt.');return null;}
      await refreshAvailability({synchronize: false});
      if (!(availability.premium || options.isPremium?.())) {options.openUpgrade?.(); return null;}
      if (!availability.available) return options.openLegacy?.(value);
      if (hasPendingConfirmation()) {await recoverReceipt(); return null;}
      const captured = context();
      if(!captured.retailer){notify('Choose your supermarket in Shop or region settings before scanning a receipt.');return null;}
      return scanner()?.open?.({...captured, ...value, onSaved: result => {options.onProjection?.(result?.projection || {}); value.onSaved?.(result); schedule();}});
    }
    async function recoverReceipt({retry = false} = {}) {
      try {
        adapter()?.recoverLocalTransaction?.();
        const result = await (retry ? adapter().retryPendingConfirmation() : adapter().synchronize());
        issue = result.localApplied === false ? result.localError || 'receipt_refresh_required' : null;
        notify(result.localApplied ? 'Receipt recovered. Review your pantry before the next shop.' : 'Receipt recovery is still pending. Keep this receipt and try again.');
        afterRender(); return result;
      } catch {issue = 'Receipt recovery could not complete. Its original confirmation is retained for retry.'; afterRender(); return {ok: false};}
    }
    function element(tag, text, className) {const e = doc().createElement(tag);if (text !== undefined) e.textContent = text;if (className) e.className = className;return e;}
    function recordLegacyCoverage(snapshot, currentContext, id) {
      const cached = projection(), ledger = read(KEYS.ledger);
      if (!cached) throw Error('receipt_refresh_required');
      for (const [key, old] of Object.entries(snapshot)) if (old?.week === (currentContext.shopSessionId || null) && JSON.stringify(ledger[key]) === JSON.stringify(old)) {
        ledger[key] = {...old, receiptPantryConfirmedActor: id, receiptPantryConfirmedScope: cached.scope.kind + ':' + cached.scope.id, receiptPantryConfirmedRevision: cached.inventoryRevision, receiptPantryConfirmedShopSessionId: currentContext.shopSessionId || null};
      }
      writeAtomic({[KEYS.ledger]: ledger});
    }
    async function confirmCurrentPantry({stock} = {}) {
      isolate();if (isolationError || hasPendingConfirmation() || reviewing || confirmingCurrent) return {ok: false, needsReview: true};
      await refreshAvailability({synchronize: false});
      if (!availability.available) return confirmLocalPantryReview();
      const cached = projection();
      if (!cached?.scope || !Number.isSafeInteger(cached.inventoryRevision) || issue?.includes('pantry_merge_required') || issue === 'receipt_household_scope_changed') return {ok: false, needsReview: true};
      const id = actor(), active = context(), ledger = read(KEYS.ledger);
      confirmingCurrent = true;
      try {
        const result = await adapter().confirmPantry({stock: clone(stock), expectedRevision: cached.inventoryRevision, expectedScope: clone(cached.scope), shopSessionId: active.shopSessionId || null});
        if (id !== actor()) return {ok: false, committed: result.committed === true, needsReview: true};
        if (!result.localApplied) {issue = 'receipt_refresh_required';return {...result, needsReview: true};}
        recordLegacyCoverage(ledger, active, id);issue = null;options.onProjection?.(result.projection);schedule();return {...result, needsReview: false, localOnly: false};
      } catch (error) {issue = error.status === 409 ? 'receipt_local_remote_pantry_merge_required' : 'receipt_refresh_required';schedule();return {ok: false, needsReview: true, conflict: error.status === 409};}
      finally {confirmingCurrent = false;}
    }
    async function reviewPantry() {
      if (reviewing) return null; isolate(); if (isolationError) {notify(isolationError);return null;}
      if (hasPendingConfirmation()) {await recoverReceipt();return null;}
      reviewing = true;
      let data;
      try {data = await fetchInventory();} catch (error) {reviewing = false;notify(error.message);return null;}
      const id = actor(), currentContext = context(), local = clone(options.getStock?.() || read(KEYS.stock));
      const ledgerAtReview = read(KEYS.ledger);
      const document = doc(); if (!document) {reviewing = false;return {data, local};}
      const dialog = element('dialog', undefined, 'bb-receipt-pantry-dialog');activeDialog = dialog;dialog.setAttribute('aria-labelledby', 'bbReceiptPantryTitle');
      const heading = element('h2', 'Confirm Your Pantry');heading.id = 'bbReceiptPantryTitle';
      const explanation = element('p', 'Check what is still in stock. Confirmed amounts will reduce your next shopping list.');
      const oldOwner = read(KEYS.owner), scopeChanged = !!oldOwner.scope && (oldOwner.scope.kind !== data.scope.kind || oldOwner.scope.id !== data.scope.id);
      if (scopeChanged || !oldOwner.actorId && data.initialized && Object.keys(local).length) explanation.textContent = 'You have two saved pantry lists. Review the quantities to keep; overlapping amounts are never added together.';
      const controls = element('div', undefined, 'bb-receipt-host-actions');
      const online = element('button', 'Use saved online amounts'), device = element('button', 'Use this device’s amounts');online.type = device.type = 'button';controls.append(online, device);
      const form = element('form'), rows = element('div', undefined, 'bb-receipt-pantry-rows'), message = element('p');message.setAttribute('role', 'status');message.setAttribute('aria-live', 'polite');
      const inputs = new Map(), allKeys = [...new Set([...Object.keys(local), ...Object.keys(data.stock)])].sort();
      for (const key of allKeys) {
        const split = key.lastIndexOf('|'); if (split < 1 || key.length > 180) continue;
        const unit = key.slice(split + 1), label = element('label', undefined, 'bb-receipt-pantry-row'), title = element('strong', key.slice(0, split));
        const detail = element('small', 'Online: ' + (data.stock[key] || 0) + ' ' + unit + ' · This device: ' + (local[key] || 0) + ' ' + unit);
        const input = element('input');input.type = 'number';input.min = '0';input.max = '1000000';input.step = ['g', 'ml'].includes(unit) ? 'any' : '1';input.value = String((data.initialized ? data.stock[key] : local[key]) || 0);input.setAttribute('aria-label', key.slice(0, split) + ' amount in ' + unit);input.dataset.stockKey = key;
        label.append(title, detail, input, element('span', unit));rows.append(label);inputs.set(key, input);
      }
      if (!inputs.size) rows.append(element('p', 'No measured foods are saved. Confirm an empty pantry to continue.'));
      online.onclick = () => {for (const [key, input] of inputs) input.value = String(data.stock[key] || 0);};
      device.onclick = () => {for (const [key, input] of inputs) input.value = String(local[key] || 0);};
      const buttons = element('div', undefined, 'bb-receipt-host-actions'), confirm = element('button', 'Confirm pantry & update shopping'), cancel = element('button', 'Review later');confirm.type = 'submit';cancel.type = 'button';buttons.append(confirm, cancel);
      form.append(rows, message, buttons);dialog.append(heading, explanation, controls, form);document.body.append(dialog);
      let busy = false;
      const close = () => {dialog.close?.();dialog.remove();reviewing = false;if (activeDialog === dialog) activeDialog = null;};cancel.onclick = () => {if (!busy) close();};
      dialog.addEventListener('cancel', event => {if (busy) event.preventDefault();});dialog.addEventListener('close', () => {reviewing = false;dialog.remove();if (activeDialog === dialog) activeDialog = null;});
      form.addEventListener('submit', async event => {
        event.preventDefault();if (busy) return;
        if (id !== actor() || currentContext.market !== context().market || currentContext.retailer !== context().retailer) {message.textContent = 'Your account or shopping region changed. Reopen this review.';return;}
        const stock = {};
        for (const [key, input] of inputs) {
          const value = Number(input.value), unit = key.slice(key.lastIndexOf('|') + 1);
          if (input.value.trim() === '' || !Number.isFinite(value) || value < 0 || value > 1000000 || !['g', 'ml'].includes(unit) && !Number.isInteger(value)) {message.textContent = 'Check the amount for ' + key.slice(0, key.lastIndexOf('|')) + '.';input.focus();return;}
          if (value > 0) stock[key] = value;
        }
        busy = true;confirm.disabled = cancel.disabled = true;message.textContent = 'Saving your confirmed pantry…';
        try {
          // The adapter adopts the verified scope only after reviewed CAS
          // success, preserving the previous owner/cache on conflict or failure.
          const result = await adapter().confirmPantry({stock, expectedRevision: data.inventoryRevision, expectedScope: clone(data.scope), shopSessionId: currentContext.shopSessionId || null});
          if (id !== actor()) return;
          if (!result.localApplied) {message.textContent = 'Pantry saved online. Refresh it before shopping on this device.';issue = 'receipt_refresh_required';return;}
          recordLegacyCoverage(ledgerAtReview, currentContext, id);
          issue = null;notify('Pantry confirmed. Your shopping list now includes only what is still needed.');close();options.onProjection?.(result.projection);schedule();
        } catch (error) {
          message.textContent = error.status === 409 ? 'This pantry changed on another device. Close and reopen the review to use the latest quantities.' : 'Your pantry could not be confirmed. Your local quantities are preserved.';
        } finally {busy = false;confirm.disabled = cancel.disabled = false;}
      });
      if (typeof dialog.showModal === 'function') dialog.showModal();else dialog.setAttribute('open', '');confirm.focus();return dialog;
    }
    function renderHostDOM() {
      const document = doc();if (!document) return;
      const app = document.getElementById('app');if (!app) return;
      const tab = options.getTab?.() || document.querySelector('.tab.active')?.dataset.tab;
      let mount = document.getElementById('bbReceiptHostMount');
      if (!['shop-list', 'shop'].includes(tab) && !isolationError) {if (mount) mount.hidden = true;lastTab = tab;return;}
      if (!mount) {mount = element('div', undefined, 'bb-receipt-host-mount');mount.id = 'bbReceiptHostMount';app.before(mount);}
      const entered = lastTab !== tab;lastTab = tab;
      if (entered && ['shop-list', 'shop'].includes(tab)) {isolate();void refreshAvailability({synchronize: tab === 'shop-list'});}
      if (isolationError) {
        mount.hidden = false;mount.replaceChildren(element('p', isolationError, 'bb-receipt-host-error'));
        document.body?.setAttribute('data-bb-receipt-isolation-error', 'true');
        app.inert = true;app.style.visibility = 'hidden';
        return;
      }
      document.body?.removeAttribute('data-bb-receipt-isolation-error');app.inert = false;app.style.removeProperty('visibility');
      if (tab !== 'shop-list') {mount.hidden = true;return;}
      mount.hidden = false;
      let toolbar = mount.querySelector('#bbReceiptToolbar');
      if (!toolbar) {toolbar = element('section', undefined, 'bb-receipt-host-toolbar bb-receipt-host-section');toolbar.id = 'bbReceiptToolbar';toolbar.setAttribute('aria-label', 'Receipt scanner');mount.prepend(toolbar);}
      const entryLabel = availability.available ? 'Scan Receipt' : (availability.premium || options.isPremium?.()) ? 'Review receipt prices' : 'Scan Receipt · Premium';
      if (toolbar && !toolbar.querySelector('[data-bb-receipt-entry]')) {
        const button = element('button', entryLabel, 'btn');button.type = 'button';button.dataset.bbReceiptEntry = '1';button.onclick = () => {void open();};toolbar.append(button);
      }
      const entry = toolbar?.querySelector('[data-bb-receipt-entry]');if (entry && entry.textContent !== entryLabel) entry.textContent = entryLabel;
      mount.querySelector('#bbReceiptReviewBanner')?.remove();
      if (requiresPantryReview() || hasPendingConfirmation() || issue) {
        const banner = element('section', undefined, 'bb-receipt-host-banner bb-receipt-host-section');banner.id = 'bbReceiptReviewBanner';
        banner.append(element('h3', hasPendingConfirmation() ? 'Recover your receipt' : 'Confirm Your Pantry'), element('p', hasPendingConfirmation() ? 'A receipt confirmation needs checking. Finish Shop is paused to prevent adding the same purchase twice.' : 'Check your current amounts before your pantry reduces the shopping list.'));
        if (issue) banner.append(element('p', issue.includes('pantry_merge_required') || issue === 'receipt_household_scope_changed' ? 'Review the saved and device quantities before syncing this pantry.' : issue.startsWith('receipt_') || issue.startsWith('pending_') ? 'Refresh your saved pantry before using it for this shop.' : issue));
        const button = element('button', hasPendingConfirmation() ? 'Check receipt status' : 'Review pantry');button.type = 'button';button.onclick = () => {void (hasPendingConfirmation() ? recoverReceipt() : reviewPantry());};banner.append(button);
        if (hasPendingConfirmation()) {const retry = element('button', 'Retry original confirmation');retry.type = 'button';retry.onclick = () => {void recoverReceipt({retry: true});};banner.append(retry);}
        mount.prepend(banner);
      }
      mount.querySelector('#bbReceiptWeeklyActuals')?.remove();
      const totals = weeklyReceiptSummary(projection(), context(), clock());
      if (totals.receipts.length || totals.essentials.length || totals.unallocated) {
        const section = element('section', undefined, 'bb-receipt-host-receipts bb-receipt-host-section');section.id = 'bbReceiptWeeklyActuals';section.append(element('h3', 'This week’s receipt spending'));
        section.append(element('p', 'Receipt spending is shown separately from estimates for planned shopping.'));
        if (totals.receipts.length) section.append(element('p', 'Food items: ' + money(totals.food, totals.currency)), element('p', 'Weekly Essentials / non-food: ' + money(totals.nonFood, totals.currency)), element('strong', totals.paid === null ? 'Receipt totals need review' : (totals.incomplete ? 'Known receipt totals: ' : 'Total paid: ') + money(totals.paid, totals.currency) + (totals.incomplete ? ' + totals needing review' : '')));
        else section.append(element('p', 'Weekly Essentials / non-food paid: ' + money(totals.nonFood, totals.currency)));
        for (const item of totals.essentials) section.append(element('p', item.name + ' · ' + (Number.isFinite(item.pricePaid) ? money(item.pricePaid, totals.currency) : 'Price needs review')));
        if (totals.unallocated) section.append(element('p', 'Some receipt dates need review before they can be included in a weekly subtotal.'));
        mount.append(section);
      }
    }
    function afterRender() {
      if (rendering) {schedule();return;}rendering = true;
      observer?.disconnect();
      try {renderHostDOM();}
      finally {rendering = false;const app = doc()?.getElementById('app');if (observer && app) observer.observe(app, {childList: true});}
    }
    function schedule() {if (scheduled) return;scheduled = true;(root.queueMicrotask || (fn => Promise.resolve().then(fn)))(() => {scheduled = false;afterRender();});}
    function configure(value = {}) {
      options = {...options, ...value};configured = true;setupAdapter();isolate();
      const document = doc();
      if (document && !observer && root.MutationObserver) {const app = document.getElementById('app');if (app) {observer = new root.MutationObserver(schedule);observer.observe(app, {childList: true});}}
      afterRender();return api;
    }
    const accountChanged = () => {if (!configured) return;generation++;activeDialog?.close?.();activeDialog?.remove();activeDialog = null;reviewing = false;lastChecked = 0;checkedActor = null;statusPromise = null;isolate();setupAdapter();schedule();};
    root.addEventListener?.('basketboss:session-changed', accountChanged);
    root.addEventListener?.('basketboss:supermarket-changed', () => {if (!configured) return;activeDialog?.close?.();activeDialog?.remove();activeDialog = null;reviewing = false;lastChecked = 0;schedule();});
    let externalTimer = null;
    function externalChange(event) {
      if (!configured || ![KEYS.actor, KEYS.owner, KEYS.stock, KEYS.confirmed, KEYS.ledger, 'basketboss_cloud_session_v1'].includes(event.key)) return;
      if (externalTimer !== null) {root.clearTimeout?.(externalTimer);externalTimer = null;}
      accountChanged();
      if (actor() !== 'guest' && store().getItem('basketboss_receipt_inventory_journal_v1:' + encodeURIComponent(actor()))) {
        if (root.setTimeout) externalTimer = root.setTimeout(() => {externalTimer = null;if (!store().getItem('basketboss_receipt_inventory_journal_v1:' + encodeURIComponent(actor()))) {options.onProjection?.({externalStorage: true});schedule();}}, 150);
        return;
      }
      options.onProjection?.({externalStorage: true});schedule();
    }
    root.addEventListener?.('storage', externalChange);
    const api = Object.freeze({configure, afterRender, refreshAvailability, open, reviewPantry, confirmCurrentPantry, confirmLocalPantryReview, recoverReceipt, requiresPantryReview, hasPendingConfirmation, allowLegacyTransfer, handlesInventorySync, coversLegacyCredit, switchActor, getAvailability: () => ({...availability}), getProjection: projection, weeklySummary: () => weeklyReceiptSummary(projection(), context(), clock()), keys: KEYS});
    return api;
  }
  root.BBReceiptHostFactory = createHost;
  root.BBReceiptHostHelpers = Object.freeze({actorOf, weeklyReceiptSummary, weekBounds});
  root.BBReceiptHost = createHost();
})(typeof window !== 'undefined' ? window : globalThis);
