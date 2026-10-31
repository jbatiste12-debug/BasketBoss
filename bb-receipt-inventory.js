/* Receipt orchestration only. The app host supplies its authenticated account/context bridge.
   Load as a normal script. Public async methods wait for the shared ESM core. */
(function (root) {
  'use strict';
  const scriptURL = root.document?.currentScript?.src;
  const moduleURL = scriptURL ? new URL('./bb-receipt-inventory-core.mjs', scriptURL).href : './bb-receipt-inventory-core.mjs';
  const KEYS = Object.freeze({ stock: 'basketboss_321_v7_measured_pantry', kitchen: 'basketboss_makeameal_v1_inventory', confirmed: 'basketboss_ui_next_confirmed_pantry_v1', finishShop: 'basketboss_purchase_receipts_v1', owner: 'basketboss_receipt_projection_owner_v1', session: 'basketboss_cloud_session_v1' });
  function createReceiptInventoryAdapter(initial = {}) {
    let options = { ...initial }, corePromise, memoryDrafts = new Map();
    const inFlight = new Map();
    let deletionPaused = false, generation = 0;
    const deleting = () => deletionPaused || root.BBAccountDeletion?.isDeleting?.() === true;
    const pauseDeletion = () => { deletionPaused = true; generation++; memoryDrafts.clear(); };
    root.addEventListener?.('basketboss:account-deletion-started', pauseDeletion);
    root.addEventListener?.('basketboss:account-deletion-deleted', pauseDeletion);
    root.addEventListener?.('basketboss:account-deletion-cancelled', () => { deletionPaused = false; generation++; });
    const storage = () => options.storage || root.localStorage;
    const now = () => (options.now ? new Date(options.now()) : new Date()).toISOString();
    const clone = value => JSON.parse(JSON.stringify(value));
    const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    const json = (key, fallback) => {
      const raw = storage().getItem(key);
      if (raw === null) return clone(fallback);
      let value; try { value = JSON.parse(raw); } catch { throw Error('receipt_local_data_unreadable'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('receipt_local_data_unreadable');
      return value;
    };
    const core = () => options.core ? Promise.resolve(options.core) : (corePromise ||= import(moduleURL));
    function session() {
      if (deleting()) throw Error('account_deletion_in_progress');
      const value = options.getSession ? options.getSession() : json(KEYS.session, {});
      const actorId = value?.user?.id || value?.actorId;
      const token = value?.access_token || value?.accessToken;
      if (typeof actorId !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(actorId) || typeof token !== 'string' || !token || token.length > 16000 || /[\r\n]/.test(token)) throw Error('verified_receipt_account_required');
      if (value.expires_at !== undefined && (!Number.isFinite(Number(value.expires_at)) || Number(value.expires_at) * 1000 <= Date.now() + 5000)) throw Error('receipt_session_expired');
      return { actorId, token, generation };
    }
    function activeContext() {
      const value = options.getContext?.();
      if (!value || !['UK', 'Guernsey', 'Jersey', 'US'].includes(value.market)) throw Error('receipt_host_context_required');
      return { market: value.market, retailer: value.retailer || null, shopSessionId: value.shopSessionId || null };
    }
    function sameSession(captured) { if (deleting() || captured.generation !== generation) return false; try { const current = session(); return current.actorId === captured.actorId && current.token === captured.token; } catch { return false; } }
    function sameContext(captured) { const current = activeContext(); return current.market === captured.market && current.retailer === captured.retailer; }
    const catalog = () => options.getCatalog ? options.getCatalog() : root.BBPriceV19?.catalog;
    const canonicalize = value => options.canonicalize ? options.canonicalize(value) : root.BBPriceV19?.canonical ? root.BBPriceV19.canonical(value) : value;
    function cacheKey(actorId, scope) {
      if (!scope || !['user', 'household'].includes(scope.kind) || typeof scope.id !== 'string' || !/^[a-zA-Z0-9_-]{4,120}$/.test(scope.id)) throw Error('invalid_receipt_server_scope');
      return `basketboss_receipt_inventory_v1:${encodeURIComponent(actorId)}:${scope.kind}:${encodeURIComponent(scope.id)}`;
    }
    function actorJournal(actorId) { return `basketboss_receipt_inventory_journal_v1:${encodeURIComponent(actorId)}`; }
    function pendingKey(actorId) { return `basketboss_receipt_pending_confirmation_v1:${encodeURIComponent(actorId)}`; }
    function pendingConfirmation(actorId) {
      const value = json(pendingKey(actorId), {});
      if (!Object.keys(value).length) return value;
      if (value.version !== 1 || value.actorId !== actorId || typeof value.receiptId !== 'string' || !value.receiptId || value.receiptId.length > 120 || typeof value.requestId !== 'string' || value.requestId.length > 160 || !value.body || value.body.action !== 'confirm_receipt' || value.body.receiptId !== value.receiptId || value.body.requestId !== value.requestId || JSON.stringify(value).length > 750000) throw Error('invalid_pending_receipt_confirmation');
      return value;
    }
    function equalStock(left, right) {
      const keys = Object.keys(left);
      return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && left[key] === right[key]);
    }
    async function withInventoryLock(work) {
      const captured = session(), locks = options.locks || root.navigator?.locks;
      const run = () => { if (!sameSession(captured)) throw Error('receipt_account_changed'); return work(); };
      if (locks?.request) return locks.request(`basketboss-receipt-inventory:${captured.actorId}`, { mode: 'exclusive' }, run);
      return run();
    }
    function atomicWrite(changes, actorId) {
      if (deleting()) throw Error('account_deletion_in_progress');
      const store = storage(), before = Object.fromEntries(Object.keys(changes).map(key => [key, store.getItem(key)]));
      const journalKey = actorJournal(actorId), previousJournal = store.getItem(journalKey);
      if (previousJournal !== null) throw Error('receipt_recovery_required');
      const serialized = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value === null ? null : JSON.stringify(value)]));
      const journal = JSON.stringify({ version: 1, actorId, before, after: serialized, createdAt: now() });
      store.setItem(journalKey, journal);
      if (store.getItem(journalKey) !== journal) throw Error('receipt_storage_verification_failed');
      const written = [];
      try {
        for (const key of Object.keys(changes)) if (store.getItem(key) !== before[key]) throw Error('receipt_local_data_changed');
        for (const [key, value] of Object.entries(serialized)) {
          if (value === null) store.removeItem(key); else store.setItem(key, value);
          written.push(key);
          if (store.getItem(key) !== value) throw Error('receipt_storage_verification_failed');
        }
        store.removeItem(journalKey);
      } catch (error) {
        let restored = true;
        for (const key of written.reverse()) {
          try {
            // Never overwrite another tab's newer value while rolling back our own write.
            if (store.getItem(key) !== serialized[key]) { restored = false; continue; }
            before[key] === null ? store.removeItem(key) : store.setItem(key, before[key]);
            if (store.getItem(key) !== before[key]) restored = false;
          } catch { restored = false; }
        }
        if (restored) { try { store.removeItem(journalKey); } catch {} }
        error.rollbackComplete = restored;
        throw error;
      }
    }
    function recoverLocalTransaction() {
      const current = session(), key = actorJournal(current.actorId), raw = storage().getItem(key);
      if (!raw) return { recovered: false };
      const journal = JSON.parse(raw);
      const allowed = target => [KEYS.stock, KEYS.kitchen, KEYS.confirmed, KEYS.finishShop, KEYS.owner, pendingKey(current.actorId)].includes(target) || target.startsWith(`basketboss_receipt_inventory_v1:${encodeURIComponent(current.actorId)}:`) && /^basketboss_receipt_inventory_v1:[A-Za-z0-9_-]+:(?:user|household):[A-Za-z0-9_-]{4,120}$/.test(target);
      if (journal.actorId !== current.actorId || journal.version !== 1 || !journal.before || !journal.after || Array.isArray(journal.before) || Array.isArray(journal.after) || Object.keys(journal.before).length > 7 || Object.keys(journal.before).length !== Object.keys(journal.after).length || !Object.keys(journal.before).every(target => allowed(target) && Object.hasOwn(journal.after, target) && [journal.before[target], journal.after[target]].every(x => x === null || typeof x === 'string' && x.length <= 2_500_000))) throw Error('invalid_receipt_recovery_journal');
      for (const [target, before] of Object.entries(journal.before)) {
        const currentRaw = storage().getItem(target);
        if (currentRaw !== before && currentRaw !== journal.after[target]) throw Error('receipt_recovery_conflict');
      }
      for (const [target, before] of Object.entries(journal.before)) before === null ? storage().removeItem(target) : storage().setItem(target, before);
      for (const [target, before] of Object.entries(journal.before)) if (storage().getItem(target) !== before) throw Error('receipt_recovery_storage_failed');
      storage().removeItem(key); return { recovered: true };
    }
    async function request(method, captured, body, signal, query = null) {
      if (!sameSession(captured)) throw Error('receipt_account_changed');
      const perform = options.fetch || root.fetch?.bind(root);
      if (!perform) throw Error('receipt_network_unavailable');
      const path = '/api/receipt-inventory' + (query?.receiptId ? '?receiptId=' + encodeURIComponent(query.receiptId) : '');
      const response = await perform(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${captured.token}` }, body: body ? JSON.stringify(body) : undefined, signal, credentials: 'same-origin', redirect: 'manual', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) { const error = Error(String(data.error || 'receipt_cloud_request_failed').slice(0, 200)); error.status = response.status; throw error; }
      return data;
    }
    function safeServerRecord(value, fields) {
      const out = {};
      for (const field of fields) {
        const x = value?.[field];
        if (typeof x === 'string') { if (/^data:image\//i.test(x) || x.length > 1000) throw Error('invalid_receipt_projection_data'); out[field] = x; }
        else if (typeof x === 'number' && Number.isFinite(x) || typeof x === 'boolean' || x === null) out[field] = x;
      }
      return out;
    }
    async function applyProjection(response, captured, body = null) {
      const c = await core();
      if (!sameSession(captured)) throw Error('receipt_account_changed');
      const scope = { kind: response.scope?.kind, id: response.scope?.id };
      const key = cacheKey(captured.actorId, scope), owner = json(KEYS.owner, {});
      const explicitScopeAdoption = body?.action === 'confirm_pantry' && body.expectedScope?.kind === scope.kind && body.expectedScope?.id === scope.id;
      if (scope.kind === 'user' && scope.id !== captured.actorId) throw Error('receipt_server_actor_mismatch');
      if (owner.actorId && owner.actorId !== captured.actorId) throw Error('receipt_projection_belongs_to_other_account');
      if (owner.cacheKey && owner.cacheKey !== key && !explicitScopeAdoption) throw Error('receipt_household_scope_changed');
      const cached = json(key, {});
      if (!Number.isSafeInteger(response.inventoryRevision) || response.inventoryRevision < 0) throw Error('receipt_inventory_revision_missing');
      if (typeof response.initialized !== 'boolean') throw Error('receipt_inventory_initialization_missing');
      if ((!owner.cacheKey || owner.cacheKey === key) && Number.isSafeInteger(owner.inventoryRevision) && owner.inventoryRevision > response.inventoryRevision) throw Error('receipt_stale_server_projection');
      if (!response.stock || typeof response.stock !== 'object' || Array.isArray(response.stock)) throw Error('receipt_server_stock_missing');
      const nextServerStock = c.normalizeStockMap(response.projectionMode === 'patch' ? { ...(cached.serverStock || {}), ...response.stock } : response.stock, { canonicalize });
      const currentStock = c.normalizeStockMap(json(KEYS.stock, {}), { canonicalize });
      if (!owner.actorId && response.initialized === true && Object.keys(currentStock).length && !body?.localProjectionBaseline) throw Error('receipt_initial_pantry_merge_required');
      if (!body && owner.actorId && response.inventoryRevision > owner.inventoryRevision && !equalStock(currentStock, c.normalizeStockMap(owner.serverStock || {}, { canonicalize }))) throw Error('receipt_local_remote_pantry_merge_required');
      let priorServerStock = owner.serverStock || {};
      if (body?.action === 'confirm_receipt') {
        if (!Number.isSafeInteger(response.receiptRevision) || response.receiptRevision < 1 || response.receiptRevision > response.inventoryRevision) throw Error('receipt_commit_revision_missing');
        // A GET or an earlier successful retry may already have projected this receipt.
        // Otherwise the transaction reconciled the captured full local baseline first.
        if (!(Number(owner.inventoryRevision) >= response.receiptRevision)) priorServerStock = body.inventoryBaseline?.stock || {};
      } else if (body?.localProjectionBaseline) priorServerStock = body.localProjectionBaseline;
      const nextStock = c.projectReceiptInventory(currentStock, priorServerStock, nextServerStock);
      const currentKitchen = json(KEYS.kitchen, {}), kitchen = clone(currentKitchen);
      for (const [field, limit] of [['inventory', 2000], ['essentials', 500], ['priceObservations', 2000], ['receipts', 500]]) if (response[field] !== undefined && (!Array.isArray(response[field]) || response[field].length > limit)) throw Error('receipt_projection_payload_limit');
      const inventory = (response.inventory || []).map(x => safeServerRecord(x, ['stockKey', 'canonicalKey', 'quantity', 'unit', 'location', 'revision']));
      for (const item of inventory) {
        if (typeof item.stockKey !== 'string' || item.stockKey.length > 180 || item.stockKey !== `${item.canonicalKey}|${item.unit}` || !Number.isFinite(item.quantity) || item.quantity < 0 || item.quantity > 1000000 || item.quantity > 0 && nextServerStock[item.stockKey] !== item.quantity || !Number.isInteger(item.revision) || item.revision < 0 || !['cupboard', 'fridge', 'freezer'].includes(item.location)) throw Error('invalid_receipt_inventory_projection');
      }
      for (const stockKey of new Set([...Object.keys(priorServerStock), ...Object.keys(nextServerStock)])) {
        const split = stockKey.lastIndexOf('|'), name = stockKey.slice(0, split), unit = stockKey.slice(split + 1);
        const existing = Object.entries(kitchen).find(([, x]) => x?.selected && x.name && c.canonicalIngredientKey(x.name, canonicalize) === name && c.normalizeMeasuredQuantity(x.qty, x.unit)?.unit === unit);
        const item = inventory.find(x => x.stockKey === stockKey), location = existing?.[1]?.loc || item?.location || 'cupboard';
        const id = existing?.[0] || `${location}|${name}`, previous = existing?.[1] || {};
        const quantity = nextStock[stockKey] || 0;
        if (quantity > 0) kitchen[id] = { ...previous, name: previous.name || name, loc: location, selected: true, qty: quantity, unit, bb173StockKey: stockKey, bb173StockValue: quantity, receiptActorId: captured.actorId };
        else if (existing) { kitchen[id] = { ...previous, selected: false, qty: null }; delete kitchen[id].bb173StockKey; delete kitchen[id].bb173StockValue; }
      }
      const essentials = (response.essentials || []).slice(0, 500).map(x => safeServerRecord(x, ['id', 'lineId', 'receiptId', 'name', 'productName', 'brand', 'quantity', 'unit', 'packQuantity', 'packUnit', 'packCount', 'pricePaid', 'currency', 'market', 'retailer', 'shopSessionId', 'confirmedAt', 'purchasedAt']));
      const receipts = (response.receipts || []).map(x => safeServerRecord(x, ['receiptId', 'shopSessionId', 'market', 'currency', 'retailer', 'purchasedAt', 'confirmedAt', 'foodSubtotal', 'essentialsSubtotal', 'receiptTotal', 'adjustmentTotal']));
      for (const receipt of receipts) for (const field of ['foodSubtotal', 'essentialsSubtotal', 'receiptTotal', 'adjustmentTotal']) if (receipt[field] !== undefined && receipt[field] !== null && (!Number.isFinite(receipt[field]) || Math.abs(receipt[field]) > 100000 || ['foodSubtotal', 'essentialsSubtotal'].includes(field) && receipt[field] < 0)) throw Error('invalid_receipt_summary_amount');
      const priceObservations = (response.priceObservations || []).map(x => safeServerRecord(x, ['id', 'scopeId', 'market', 'retailer', 'currency', 'receiptId', 'canonicalKey', 'brand', 'packQuantity', 'packUnit', 'packCount', 'packPrice', 'pricePaid', 'priceType', 'eligibleForRegularPrice', 'source', 'observedAt', 'purchasedAt'])).filter(x => x.scopeId === scope.id && c.SUPPORTED_MARKETS[x.market] === x.currency && typeof x.retailer === 'string' && x.retailer.trim() && c.canonicalIngredientKey(x.canonicalKey) === x.canonicalKey && c.normalizeMeasuredQuantity(x.packQuantity, x.packUnit)?.quantity === x.packQuantity && Number.isInteger(x.packCount) && x.packCount > 0 && x.packCount <= 10000 && Number.isFinite(x.packPrice) && x.packPrice > 0 && x.packPrice <= 100000 && ['regular', 'promotion', 'unknown'].includes(x.priceType));
      const pantryReview = { required: response.pantryReview?.required !== false, shopSessionId: response.pantryReview?.shopSessionId || body?.shopSessionId || null, confirmedAt: response.pantryReview?.confirmedAt || null };
      const nextCache = { version: 1, actorId: captured.actorId, scope, initialized: response.initialized === true, inventoryRevision: response.inventoryRevision, serverStock: nextServerStock, inventory, essentials, receipts, priceObservations, pantryReview, lastReceiptId: response.receiptId || cached.lastReceiptId || null, syncedAt: now() };
      const ledger = json(KEYS.finishShop, {});
      if (body?.shopSessionId) {
        const purchasedByKey = new Map();
        for (const line of body.lines || []) {
          if (line.kind !== 'food') continue;
          const id = `${body.shopSessionId}|${line.canonicalKey}|${line.unit}`;
          purchasedByKey.set(id, { ...line, quantity: (purchasedByKey.get(id)?.quantity || 0) + line.quantity });
        }
        for (const [id, line] of purchasedByKey) {
          const prior = ledger[id], coverage = { ...(prior?.receiptCoverageById || {}), [body.receiptId]: line.quantity };
          // Receipt stock already covers this purchase. FinishShop's existing existence guard
          // must skip it later; preserve any historical surplus credit for audit/netting.
          ledger[id] = { ...(prior || {}), name: line.canonicalKey, unit: line.unit, qty: prior?.qty ?? line.quantity, week: body.shopSessionId, mode: prior?.mode || 'receipt_inventory', credited: prior?.credited || 0, receiptInventoryReceiptId: body.receiptId, receiptCoverageById: coverage, receiptCoveredQuantity: Object.values(coverage).reduce((n, x) => n + Number(x || 0), 0), purchasedAt: prior?.purchasedAt || body.purchasedAt || now() };
        }
      }
      const confirmed = json(KEYS.confirmed, {});
      const changes = { [key]: nextCache, [KEYS.stock]: nextStock, [KEYS.kitchen]: kitchen, [KEYS.owner]: { version: 1, actorId: captured.actorId, scope, cacheKey: key, initialized: response.initialized === true, inventoryRevision: response.inventoryRevision, serverStock: nextServerStock, appliedAt: now() }, [KEYS.confirmed]: { ...confirmed, receiptReviewRequired: pantryReview.required, receiptId: response.receiptId || null, receiptChangedAt: now() } };
      if (body?.shopSessionId) changes[KEYS.finishShop] = ledger;
      if (body?.action === 'confirm_receipt' && pendingConfirmation(captured.actorId).receiptId === body.receiptId) changes[pendingKey(captured.actorId)] = null;
      if (!sameSession(captured)) throw Error('receipt_account_changed');
      atomicWrite(changes, captured.actorId);
      try { options.onProjection?.({ stock: nextStock, inventory: kitchen, essentials, receipts, pantryReview, scope }); } catch { /* Stored projection remains valid if rendering fails. */ }
      return { stock: nextStock, inventory: kitchen, essentials, receipts, pantryReview, scope };
    }
    function uuid() { const value = options.createId?.() || root.crypto?.randomUUID?.(); if (!value) throw Error('receipt_identity_generator_unavailable'); return value; }
    async function normalizeDraft(raw, context = {}) {
      const c = await core(), captured = session(), active = activeContext();
      const market = context.market || active.market, retailer = context.retailer ?? active.retailer;
      if (market !== active.market || retailer !== active.retailer) throw Error('receipt_context_changed');
      const draft = c.normalizeReceiptDraft(raw, { ...context, market, retailer, catalog: catalog(), canonicalize });
      draft.receiptId ||= `receipt-${uuid()}`;
      memoryDrafts.set(draft.receiptId, { actorId: captured.actorId, draft: clone(draft), context: active });
      return draft;
    }
    async function commitReviewedReceiptInternal(draft, { idempotencyKey, signal } = {}) {
      const c = await core(), captured = session(), context = activeContext();
      if (signal?.aborted) throw Error('receipt_confirmation_cancelled');
      const owned = memoryDrafts.get(draft?.receiptId);
      if (!owned || owned.actorId !== captured.actorId) throw Error('receipt_draft_not_owned_by_account');
      if (!sameContext(owned.context) || context.market !== draft.market || context.retailer !== draft.retailer) throw Error('receipt_context_changed');
      let owner = json(KEYS.owner, {});
      if (owner.actorId && owner.actorId !== captured.actorId) throw Error('receipt_projection_belongs_to_other_account');
      let requestId = idempotencyKey || `${draft.receiptId}:confirm`;
      const credits = options.getFinishShopCredits ? options.getFinishShopCredits() : json(KEYS.finishShop, {});
      let body = c.prepareReceiptConfirmation(draft, { requestId, catalog: catalog(), canonicalize, finishShopCredits: credits });
      requestId = body.requestId;
      const pending = pendingConfirmation(captured.actorId);
      if (pending.receiptId && pending.receiptId !== draft.receiptId) throw Error('another_receipt_confirmation_pending');
      if (!owner.actorId) {
        const initial = await request('GET', captured, null, signal);
        if (!sameSession(captured) || !sameContext(context) || signal?.aborted) throw Error('receipt_context_changed');
        await applyProjection(initial, captured);
        owner = json(KEYS.owner, {});
      }
      if (!Number.isSafeInteger(owner.inventoryRevision)) throw Error('receipt_inventory_revision_missing');
      body.expectedScope = c.normalizeInventoryScope(owner.scope);
      body.inventoryBaseline = { stock: c.normalizeStockMap(json(KEYS.stock, {}), { canonicalize }), expectedRevision: owner.inventoryRevision, initialize: owner.initialized !== true };
      if (pending.receiptId) {
        const semantic = value => { const { inventoryBaseline, ...rest } = value; return JSON.stringify(stable(rest)); };
        if (pending.actorId !== captured.actorId || !pending.body || semantic(pending.body) !== semantic(body)) throw Error('pending_receipt_payload_changed');
        const baseline = pending.body.inventoryBaseline;
        if (!baseline || !Number.isSafeInteger(baseline.expectedRevision) || baseline.expectedRevision < 0 || typeof baseline.initialize !== 'boolean') throw Error('invalid_pending_receipt_baseline');
        body.inventoryBaseline = { stock: c.normalizeStockMap(baseline.stock, { canonicalize }), expectedRevision: baseline.expectedRevision, initialize: baseline.initialize };
      }
      body = c.validateReceiptConfirmation(body, { catalog: catalog(), canonicalize });
      const operationKey = `${captured.actorId}|${requestId}`, digest = JSON.stringify(body);
      if (inFlight.has(operationKey)) { const other = inFlight.get(operationKey); if (other.digest !== digest) throw Error('receipt_request_in_progress_with_different_payload'); return other.promise; }
      if ([...inFlight.keys()].some(key => key.startsWith(captured.actorId + '|'))) throw Error('another_receipt_confirmation_in_progress');
      if (!pending.receiptId) {
        const value = JSON.stringify({ version: 1, actorId: captured.actorId, receiptId: body.receiptId, requestId, context, body, createdAt: now() });
        storage().setItem(pendingKey(captured.actorId), value);
        if (storage().getItem(pendingKey(captured.actorId)) !== value) throw Error('receipt_pending_confirmation_save_failed');
      }
      const operation = (async () => {
        let response;
        try { response = await request('POST', captured, body, signal); }
        catch (error) {
          if (!deleting() && sameSession(captured) && error.status >= 400 && error.status < 500 && error.status !== 408) {
            try { if (pendingConfirmation(captured.actorId).receiptId === body.receiptId) storage().removeItem(pendingKey(captured.actorId)); } catch {}
          } else { error.commitUnknown = true; error.receiptId = body.receiptId; error.recoveryRequired = true; }
          throw error;
        }
        const base = { ok: true, committed: true, duplicate: response.duplicate === true, receiptId: response.receiptId || draft.receiptId, needsPantryConfirmation: response.pantryReview?.required !== false, summary: { foodLines: body.lines.filter(x => x.kind === 'food').length, essentialLines: body.lines.filter(x => x.kind === 'essential').length, totals: c.receiptTotals(draft.lines, draft.receiptTotal) } };
        if (!sameSession(captured) || !sameContext(context) || signal?.aborted || !memoryDrafts.has(draft.receiptId)) return { ...base, localApplied: false, syncRequired: true, localError: 'receipt_context_changed_after_cloud_commit' };
        try { return { ...base, localApplied: true, projection: await applyProjection(response, captured, body) }; }
        catch (error) { return { ...base, localApplied: false, syncRequired: true, localError: error.message }; }
      })();
      inFlight.set(operationKey, { digest, promise: operation });
      try { return await operation; } finally { inFlight.delete(operationKey); }
    }
    async function synchronizeInternal({ signal } = {}) {
      const captured = session(), context = activeContext(), pending = pendingConfirmation(captured.actorId), response = await request('GET', captured, null, signal, pending.receiptId ? { receiptId: pending.receiptId } : null);
      if (!sameSession(captured) || !sameContext(context) || signal?.aborted) throw Error('receipt_context_changed');
      if (pending.receiptId && (response.receiptId !== pending.receiptId || !Number.isSafeInteger(response.receiptRevision) || response.receiptRevision < 1)) return { ok: true, localApplied: false, syncRequired: true, pendingReceipt: true, localError: 'pending_receipt_not_yet_confirmed' };
      try { return { ok: true, localApplied: true, projection: await applyProjection(response, captured, pending.receiptId ? pending.body : null), needsPantryConfirmation: response.pantryReview?.required !== false }; }
      catch (error) { return { ok: true, localApplied: false, syncRequired: true, localError: error.message }; }
    }
    async function retryPendingConfirmationInternal({ signal } = {}) {
      const c = await core(), captured = session(), context = activeContext(), pending = pendingConfirmation(captured.actorId);
      if (signal?.aborted) throw Error('receipt_confirmation_cancelled');
      if (!pending.receiptId) throw Error('no_pending_receipt_confirmation');
      const owner = json(KEYS.owner, {});
      if (owner.actorId && owner.actorId !== captured.actorId) throw Error('receipt_projection_belongs_to_other_account');
      const body = c.validateReceiptConfirmation(pending.body, { catalog: catalog(), canonicalize });
      let response;
      try { response = await request('POST', captured, body, signal); }
      catch (error) {
        if (!deleting() && sameSession(captured) && error.status >= 400 && error.status < 500 && error.status !== 408) {
          try { if (pendingConfirmation(captured.actorId).receiptId === body.receiptId) storage().removeItem(pendingKey(captured.actorId)); } catch {}
        } else { error.commitUnknown = true; error.receiptId = body.receiptId; error.recoveryRequired = true; }
        throw error;
      }
      const rows = body.lines.map(line => ({ ...line, classification: line.kind, sourceKind: 'purchase', lineTotal: line.pricePaid }));
      rows.push(...body.adjustments.map(row => ({ sourceKind: row.kind, lineTotal: row.amount })));
      const base = { ok: true, committed: true, duplicate: response.duplicate === true, receiptId: response.receiptId || body.receiptId, needsPantryConfirmation: response.pantryReview?.required !== false, summary: { foodLines: body.lines.filter(x => x.kind === 'food').length, essentialLines: body.lines.filter(x => x.kind === 'essential').length, totals: c.receiptTotals(rows, body.receiptTotal) } };
      if (!sameSession(captured) || !sameContext(context) || signal?.aborted) return { ...base, localApplied: false, syncRequired: true, localError: 'receipt_context_changed_after_cloud_commit' };
      try { return { ...base, localApplied: true, projection: await applyProjection(response, captured, body) }; }
      catch (error) { return { ...base, localApplied: false, syncRequired: true, localError: error.message }; }
    }
    async function confirmPantryInternal({ stock, expectedRevision, shopSessionId, expectedScope, signal } = {}) {
      if (!stock || typeof stock !== 'object' || Array.isArray(stock) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('reviewed_pantry_stock_and_revision_required');
      const c = await core(); stock = c.normalizeStockMap(stock, { canonicalize });
      if (pendingConfirmation(session().actorId).receiptId) throw Error('receipt_confirmation_recovery_required_first');
      const captured = session(), context = activeContext(), owner = json(KEYS.owner, {}), scope = c.normalizeInventoryScope(expectedScope || owner.scope), baseline = c.normalizeStockMap(json(KEYS.stock, {}), { canonicalize }), response = await request('POST', captured, { action: 'confirm_pantry', stock, expectedRevision, expectedScope: scope, shopSessionId }, signal);
      if (!sameSession(captured) || !sameContext(context) || signal?.aborted) return { ok: true, committed: true, localApplied: false, syncRequired: true };
      try { return { ok: true, committed: true, localApplied: true, projection: await applyProjection(response, captured, { action: 'confirm_pantry', expectedScope: scope, localProjectionBaseline: baseline }), needsPantryConfirmation: false }; }
      catch (error) { return { ok: true, committed: true, localApplied: false, syncRequired: true, localError: error.message }; }
    }
    function cancelDraft(value) { const id = typeof value === 'string' ? value : value?.receiptId; if (id) memoryDrafts.delete(id); let pending = false; try { pending = pendingConfirmation(session().actorId).receiptId === id; } catch {} return { cancelled: true, inventoryChanged: false, cloudConfirmationPending: pending }; }
    async function canonicalOptions() {
      const c = await core(), source = catalog()?.ingredients || catalog() || {}, grouped = new Map();
      for (const pair of Object.keys(source)) { const i = pair.lastIndexOf('|'); if (i <= 0) continue; const key = c.canonicalIngredientKey(pair.slice(0, i), canonicalize), unit = c.normalizeUnit(pair.slice(i + 1)); if (!key || !unit) continue; const item = grouped.get(key) || { key, name: key, units: [] }; if (!item.units.includes(unit)) item.units.push(unit); grouped.set(key, item); }
      return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    function getCachedProjection() {
      const captured = session(), owner = json(KEYS.owner, {});
      if (owner.actorId !== captured.actorId || !owner.cacheKey) return null;
      if (owner.cacheKey !== cacheKey(captured.actorId, owner.scope) || owner.scope.kind === 'user' && owner.scope.id !== captured.actorId) throw Error('invalid_receipt_projection_owner');
      return json(owner.cacheKey, {});
    }
    function getLearnedPrice({ canonicalKey, market, retailer, currency, packQuantity, packUnit, brand = '' } = {}) {
      const cached = getCachedProjection(); if (!cached) return null;
      const samples = (cached.priceObservations || []).filter(x => x.canonicalKey === canonicalKey && x.market === market && String(x.retailer || '').toLowerCase() === String(retailer || '').toLowerCase() && x.currency === currency && x.packQuantity === packQuantity && x.packUnit === packUnit && String(x.brand || '').toLowerCase() === String(brand).toLowerCase() && x.priceType === 'regular' && x.eligibleForRegularPrice !== false && Number(x.packPrice) > 0).slice(-21).map(x => Number(x.packPrice)).sort((a, b) => a - b);
      if (!samples.length) return null;
      const median = xs => xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
      const center = median(samples), robust = samples.length >= 3 ? samples.filter(x => x >= center / 3 && x <= center * 3) : samples;
      return { packPrice: Math.round(median(robust) * 100) / 100, packQuantity, packUnit, currency, samples: robust.length, source: 'account_store_receipt_regular_price', verifiedRetailQuote: false };
    }
    const commitReviewedReceipt = (draft, value) => withInventoryLock(() => commitReviewedReceiptInternal(draft, value));
    const synchronize = value => withInventoryLock(() => synchronizeInternal(value));
    const retryPendingConfirmation = value => withInventoryLock(() => retryPendingConfirmationInternal(value));
    const confirmPantry = value => withInventoryLock(() => confirmPantryInternal(value));
    return Object.freeze({ configure(value) { options = { ...options, ...value }; return this; }, normalizeDraft, commitReviewedReceipt, cancelDraft, canonicalOptions, synchronize, retryPendingConfirmation, confirmPantry, getCachedProjection, getLearnedPrice, recoverLocalTransaction, withInventoryLock, getPendingConfirmation: () => clone(pendingConfirmation(session().actorId)), keys: KEYS });
  }
  root.BBReceiptInventoryFactory = createReceiptInventoryAdapter;
  root.BBReceiptInventory = createReceiptInventoryAdapter();
})(typeof window !== 'undefined' ? window : globalThis);
