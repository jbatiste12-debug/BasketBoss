/* Receipt orchestration only. The app host supplies its authenticated account/context bridge.
   Load as a normal script. Public async methods wait for the shared ESM core. */
(function (root) {
  'use strict';
  const scriptURL = root.document?.currentScript?.src;
  const moduleURL = scriptURL ? new URL('./bb-receipt-inventory-core.mjs?v=20261105-business1', scriptURL).href : './bb-receipt-inventory-core.mjs?v=20261105-business1';
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
    // A measured receipt must not replace an independent package source with
    // the same display name. Keep both until their contents can be reviewed.
    const kitchenRecordId = (kitchen, base, stockKey) => {
      let id=base,index=0;
      while(Object.hasOwn(kitchen,id)&&kitchen[id]?.bb173StockKey!==stockKey){id=base+'|'+stockKey+(index?'|'+index:'');index++;}
      return id;
    };
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
    function localSavesKey(actorId) { return `basketboss_receipt_local_saves_v1:${encodeURIComponent(actorId)}`; }
    const extraKeys = () => Array.isArray(options.receiptSaveKeys) ? options.receiptSaveKeys.filter(x => typeof x === 'string' && /^basketboss_[a-z0-9_:-]{1,160}$/.test(x) && !/auth|cloud_session|account|token|delet/i.test(x)) : [];
    function preparedChanges(packet) {
      const prepared = options.prepareReceiptSave?.(clone(packet)) || {}, changes = prepared.changes || {};
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).some(key => !extraKeys().includes(key))) throw Error('invalid_receipt_app_transaction');
      for (const key of Object.keys(changes)) if (!prepared.expected || !Object.hasOwn(prepared.expected, key) || storage().getItem(key) !== prepared.expected[key]) throw Error('receipt_local_data_changed');
      return changes;
    }
    function pendingKey(actorId) { return `basketboss_receipt_pending_confirmation_v1:${encodeURIComponent(actorId)}`; }
    const reducedEnabled = () => root.BBReducedFoodHost?.isPremium?.() === true;
    function reducedLineIds(body, values = []) {
      if (!Array.isArray(values) || values.length > 200 || new Set(values).size !== values.length || values.some(id => typeof id !== 'string' || !body?.lines?.some(line => line.lineId === id && line.kind === 'food' && line.priceType === 'promotion'))) throw Error('invalid_reduced_receipt_metadata');
      return [...values];
    }
    function reducedItems(body, values = []) {
      const selected = new Set(reducedLineIds(body, values));
      return (body?.lines || []).filter(line => selected.has(line.lineId)).map(line => ({...line, key: line.canonicalKey, classification: 'food', reduced: true, legacyCreditQuantity: Number(line.legacyCredit?.quantity || 0)}));
    }
    function acceptedPurchaseCosts(body, reduced = []) {
      const selected = new Set(reduced);
      return (body?.lines || []).filter(line => ['food','essential'].includes(line.kind) && Number.isFinite(line.pricePaid) && line.pricePaid >= 0).map(line => ({...line, key: line.canonicalKey || line.name, classification: line.kind, reduced: selected.has(line.lineId), legacyCreditQuantity: Number(line.legacyCredit?.quantity || 0)}));
    }
    function archivedReceiptContext(packet, captured, active) {
      const id = packet.shopSessionId || null;
      if (id === active.shopSessionId) return true;
      // Explicitly unlinked, reviewed receipts are new purchases, with no
      // old-trip quantity credit to spend.
      if (id === null) return Object.hasOwn(packet,'shopSessionId');
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,120}$/.test(id)) return false;
      const archive = options.getArchivedShop?.(id), proof = archive?.receiptContext;
      return !!archive && archive.version === 7 && archive.id === id && typeof archive.closedAt === 'string' && Number.isFinite(Date.parse(archive.closedAt)) && proof?.actorId === captured.actorId && proof.market === active.market && (proof.retailer || null) === active.retailer;
    }
    function inferPurchaseAnnotations(lines, receiptId, shopSessionId, c, pending = null) {
      const result = lines.map(line => ({...line})), inferredPromotionLineIds = [], inferredReducedLineIds = [];
      const savedPromotion = new Set(pending?.inferredPromotionLineIds || []), savedReduced = new Set(pending?.inferredReducedLineIds || []);
      const known = options.getPurchaseCosts?.(shopSessionId) || [];
      const measure = line => c.normalizeMeasuredQuantity(line.quantity,line.unit);
      const name = line => c.canonicalIngredientKey(line.canonicalKey || line.key || line.name || line.description,canonicalize);
      const pools = [];
      for(const row of Array.isArray(known)?known:[]){
        if(!row||typeof row!=='object'||Array.isArray(row))continue;
        if(row?.reduced === false || row?.receiptId && row.receiptId !== receiptId)continue;
        const amount=measure(row);if(!amount)continue;
        const remaining=row.kind==='receipt'?amount.quantity:Math.max(0,amount.quantity-(Number(row.receiptCoveredQuantity)||0));
        if(remaining>0)pools.push({name:name(row),unit:amount.unit,quantity:remaining,original:amount.quantity,price:row.pricePaid,lineId:row.receiptId===receiptId?row.lineId:null});
      }
      const eligible=line=>line.selected!==false&&line.sourceKind==='purchase'&&['food','essential'].includes(line.classification);
      // Spend explicit reduced annotations first; a later ordinary line cannot
      // inherit the same reduced quantity a second time.
      const ordered=[...result.filter(line=>line.reduced===true),...result.filter(line=>line.reduced!==true)];
      for(const line of ordered){
        if(!eligible(line))continue;
        const amount=measure(line),key=name(line),id=line.id;if(!amount||!key)continue;
        if(savedPromotion.has(id)){
          line.priceType='promotion';if(savedReduced.has(id))line.reduced=true;
          inferredPromotionLineIds.push(id);if(savedReduced.has(id))inferredReducedLineIds.push(id);continue;
        }
        const matching=pools.filter(pool=>pool.name===key&&pool.unit===amount.unit&&pool.quantity>0);
        if(!matching.length)continue;
        const wasReduced=line.reduced===true, paid=Number(line.pricePaid??line.lineTotal);
        const proof=matching.find(pool=>(!pool.lineId||pool.lineId===id)&&pool.quantity+1e-7>=amount.quantity&&(wasReduced||Number.isFinite(pool.price)&&Number.isFinite(paid)&&Math.abs(paid-pool.price*amount.quantity/pool.original)<.011));
        // A partial/ambiguous match still must not teach a discounted price as
        // the future standard price. It does not mark the full line Use soon.
        if(line.priceType!=='promotion'){line.priceType='promotion';inferredPromotionLineIds.push(id);}
        if(proof){proof.quantity=Math.max(0,proof.quantity-amount.quantity);if(!wasReduced&&line.classification==='food'&&reducedEnabled()){line.reduced=true;inferredReducedLineIds.push(id);if(!inferredPromotionLineIds.includes(id))inferredPromotionLineIds.push(id);}}
      }
      return {lines:result,inferredPromotionLineIds,inferredReducedLineIds};
    }
    function receiptConfirmedAt(response, receiptId, fallback) {
      const value = response.receipts?.find(row => row?.receiptId === receiptId)?.confirmedAt;
      return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : response.duplicate === true ? null : fallback;
    }
    function reportReducedReceipt(body, values, captured, context, confirmedAt) {
      if (!reducedEnabled() || !values?.length || !sameSession(captured) || !sameContext(context)) return;
      // The banner owns date/freshness checks and its persistent receipt dedup.
      // This runs only after confirmation, never inside the stock transaction.
      try { Promise.resolve(root.BBYellowStickersUI?.reportReceipt?.({receiptId: body.receiptId, region: body.market, retailer: body.retailer, purchasedAt: body.purchasedAt, confirmedAt, reduced: true, source: 'receipt'})).catch(() => {}); } catch {}
    }
    function pendingConfirmation(actorId) {
      const value = json(pendingKey(actorId), {});
      if (!Object.keys(value).length) return value;
      if (value.version !== 1 || value.actorId !== actorId || typeof value.receiptId !== 'string' || !value.receiptId || value.receiptId.length > 120 || typeof value.requestId !== 'string' || value.requestId.length > 160 || !value.body || value.body.action !== 'confirm_receipt' || value.body.receiptId !== value.receiptId || value.body.requestId !== value.requestId || JSON.stringify(value).length > 750000) throw Error('invalid_pending_receipt_confirmation');
      reducedLineIds(value.body, value.reducedLineIds || []);
      for(const ids of [value.inferredPromotionLineIds,value.inferredReducedLineIds])if(ids!==undefined&&(!Array.isArray(ids)||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!value.body.lines.some(line=>line.lineId===id&&line.priceType==='promotion'))))throw Error('invalid_pending_receipt_annotations');
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
      const allowed = target => [KEYS.stock, KEYS.kitchen, KEYS.confirmed, KEYS.finishShop, KEYS.owner, pendingKey(current.actorId), localSavesKey(current.actorId), ...extraKeys()].includes(target) || target.startsWith(`basketboss_receipt_inventory_v1:${encodeURIComponent(current.actorId)}:`) && /^basketboss_receipt_inventory_v1:[A-Za-z0-9_-]+:(?:user|household):[A-Za-z0-9_-]{4,120}$/.test(target);
      if (journal.actorId !== current.actorId || journal.version !== 1 || !journal.before || !journal.after || Array.isArray(journal.before) || Array.isArray(journal.after) || Object.keys(journal.before).length > 32 || Object.keys(journal.before).length !== Object.keys(journal.after).length || !Object.keys(journal.before).every(target => allowed(target) && Object.hasOwn(journal.after, target) && [journal.before[target], journal.after[target]].every(x => x === null || typeof x === 'string' && x.length <= 2_500_000))) throw Error('invalid_receipt_recovery_journal');
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
      // A lost supermarket connection must release the form's busy state.
      // POST timeouts keep the existing pending journal for same-ID recovery.
      const Controller = options.AbortController || root.AbortController || globalThis.AbortController;
      const controller = typeof Controller === 'function' ? new Controller() : null, abort = () => controller?.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener?.('abort', abort, { once: true });
      const schedule = options.setTimeout || root.setTimeout || globalThis.setTimeout;
      const timer = controller && schedule ? schedule(abort, 20000) : null;
      try {
        const response = await perform(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${captured.token}` }, body: body ? JSON.stringify(body) : undefined, signal: controller?.signal || signal, credentials: 'same-origin', redirect: 'manual', cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (controller?.signal.aborted) throw Error('receipt_request_cancelled');
        if (!response.ok || data.ok !== true) { const error = Error(String(data.error || 'receipt_cloud_request_failed').slice(0, 200)); error.status = response.status; throw error; }
        return data;
      } finally { if (timer !== null) (options.clearTimeout || root.clearTimeout || globalThis.clearTimeout)?.(timer); signal?.removeEventListener?.('abort', abort); }
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
    async function applyProjection(response, captured, body = null, reducedReview = {}) {
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
      const rawServerStock = c.normalizeStockMap(response.projectionMode === 'patch' ? { ...(cached.serverStock || {}), ...response.stock } : response.stock, { canonicalize });
      const currentKitchen=json(KEYS.kitchen,{}),tracking=options.pantryPolicy===true;
      const local=tracking?c.normalizePantryState(json(KEYS.stock,{}),currentKitchen,{canonicalize,market:activeContext().market}):{stock:json(KEYS.stock,{}),inventory:currentKitchen};
      const serverKitchen=clone(currentKitchen),pepperLines=tracking&&body?.action==='confirm_receipt'&&body.addToPantry!==false?(body.lines||[]).filter(line=>line.kind==='food'&&c.canonicalIngredientKey(line.canonicalKey,canonicalize)==='pepper'):[];
      // The confirmed receipt carries the description that distinguishes whole
      // peppers from a spice jar. Old local unit metadata predates this receipt.
      for(const line of pepperLines){const stockKey='pepper|'+line.unit,quantity=rawServerStock[stockKey];if(!(quantity>0))continue;
        for(const [id,row]of Object.entries(serverKitchen))if(row?.bb173StockKey===stockKey)delete serverKitchen[id];
        const whole=c.pantryTrackingPolicy.isWholePepper(line.name,line.unit,line);
        serverKitchen['receipt-context|'+stockKey]={name:whole?'Peppers':line.name||'Pepper',unit:line.unit,qty:quantity,bb173StockKey:stockKey,bb173StockValue:quantity,selected:true,staple:!whole,loc:line.location||'cupboard'};
      }
      const nextServerStock = tracking?c.normalizePantryState(rawServerStock,serverKitchen,{canonicalize,market:activeContext().market}).stock:rawServerStock;
      const currentStock = c.normalizeStockMap(local.stock, { canonicalize });
      if (!owner.actorId && response.initialized === true && Object.keys(currentStock).length && !body?.localProjectionBaseline) throw Error('receipt_initial_pantry_merge_required');
      const normalizedPrior=tracking?c.normalizePantryState(owner.serverStock||{},currentKitchen,{canonicalize,market:activeContext().market}).stock:owner.serverStock||{};
      if (!body && owner.actorId && response.inventoryRevision > owner.inventoryRevision && !equalStock(currentStock, c.normalizeStockMap(normalizedPrior, { canonicalize }))) throw Error('receipt_local_remote_pantry_merge_required');
      let priorServerStock = normalizedPrior;
      if (body?.action === 'confirm_receipt') {
        if (!Number.isSafeInteger(response.receiptRevision) || response.receiptRevision < 1 || response.receiptRevision > response.inventoryRevision) throw Error('receipt_commit_revision_missing');
        // A GET or an earlier successful retry may already have projected this receipt.
        // Otherwise the transaction reconciled the captured full local baseline first.
        if (!(Number(owner.inventoryRevision) >= response.receiptRevision)) priorServerStock = body.inventoryBaseline?.stock || {};
      } else if (body?.localProjectionBaseline) priorServerStock = body.localProjectionBaseline;
      if(tracking)priorServerStock=c.normalizePantryState(priorServerStock,currentKitchen,{canonicalize,market:activeContext().market}).stock;
      const nextStock = c.projectReceiptInventory(currentStock, priorServerStock, nextServerStock);
      let kitchen = clone(local.inventory);
      for (const [field, limit] of [['inventory', 2000], ['essentials', 500], ['priceObservations', 2000], ['receipts', 500]]) if (response[field] !== undefined && (!Array.isArray(response[field]) || response[field].length > limit)) throw Error('receipt_projection_payload_limit');
      const inventory = (response.inventory || []).map(x => safeServerRecord(x, ['stockKey', 'canonicalKey', 'quantity', 'unit', 'location', 'revision']));
      for (const item of inventory) {
        if (typeof item.stockKey !== 'string' || item.stockKey.length > 180 || item.stockKey !== `${item.canonicalKey}|${item.unit}` || !Number.isFinite(item.quantity) || item.quantity < 0 || item.quantity > 1000000 || item.quantity > 0 && rawServerStock[item.stockKey] !== item.quantity || !Number.isInteger(item.revision) || item.revision < 0 || !['cupboard', 'fridge', 'freezer'].includes(item.location)) throw Error('invalid_receipt_inventory_projection');
      }
      for (const stockKey of new Set([...Object.keys(priorServerStock), ...Object.keys(nextServerStock)])) {
        const split = stockKey.lastIndexOf('|'), name = stockKey.slice(0, split), unit = stockKey.slice(split + 1);
        const matches = Object.entries(kitchen).filter(([, x]) => x?.selected && (x.bb173StockKey===stockKey||x.name && c.canonicalIngredientKey(x.name, canonicalize) === name && c.normalizeStockQuantity(x.qty, x.unit)?.unit === unit));
        const bucketed=root.BBReducedStock?.projectFrozenBuckets?.({inventory:kitchen,stockKey,currentQuantity:Number(currentStock[stockKey])||0,nextQuantity:nextStock[stockKey]||0,location:inventory.find(row=>row.stockKey===stockKey)?.location||'cupboard',actor:captured.actorId,canonicalize,market:activeContext().market});
        if(bucketed){kitchen=bucketed;continue;}
        const existing = matches[0];
        // A merged cloud balance cannot inherit whichever reviewed conversion
        // happened to be first when the local physical entries disagree.
        const conversionSignature = entry => {
          const pack = entry.packReviewed === true ? c.normalizeStockQuantity(entry.packQuantity, entry.packUnit) : null;
          const food = entry.measurementReviewed === true ? [entry.densityGPerMl ?? null, entry.gramsPerEach ?? null] : null;
          return JSON.stringify([pack, food]);
        };
        const conversionConflict = matches.length > 1 && new Set(matches.map(([, entry]) => conversionSignature(entry))).size > 1;
        const reviewConversion = previous => conversionConflict ? {...previous, packReviewed: false, measurementReviewed: false, conversionNeedsReview: true, conversionReviewSource: {quantity: previous.qty ?? null, unit: previous.unit ?? null, stockKey: previous.bb173StockKey ?? null, packQuantity: previous.packQuantity ?? null, packUnit: previous.packUnit ?? null, packReviewed: previous.packReviewed === true, measurementReviewed: previous.measurementReviewed === true, densityGPerMl: previous.densityGPerMl ?? null, gramsPerEach: previous.gramsPerEach ?? null}} : previous;
        for (const [oldId, previous] of matches.slice(1)) { kitchen[oldId] = {...reviewConversion(previous), selected: false, qty: null}; delete kitchen[oldId].bb173StockKey; delete kitchen[oldId].bb173StockValue; }
        const item = inventory.find(x => x.stockKey === stockKey), location = existing?.[1]?.loc || item?.location || 'cupboard';
        const id = existing?.[0] || kitchenRecordId(kitchen,`${location}|${name}`,stockKey), previous = reviewConversion(existing?.[1] || {});
        const quantity = nextStock[stockKey] || 0;
        const pepperLine=pepperLines.find(line=>line.canonicalKey===name&&line.unit===unit);
        const ambiguousPepper=name==='pepper'&&unit==='each'&&!pepperLine&&!existing;
        const wholePepper=name==='pepper'&&!ambiguousPepper&&(unit==='g'||c.pantryTrackingPolicy.isWholePepper(pepperLine?.name||previous.name||name,unit,pepperLine||previous));
        const purchasedStaple=tracking&&body?.action==='confirm_receipt'&&!cached.appliedReceiptIds?.[body.receiptId]&&(body.lines||[]).some(line=>line.kind==='food'&&c.pantryTrackingPolicy.canonicalName(line.canonicalKey,canonicalize)===c.pantryTrackingPolicy.canonicalName(name,canonicalize)&&line.quantity>0);
        if (quantity > 0) {kitchen[id] = { ...previous, name: wholePepper?'Peppers':previous.name || name, loc: location, selected: true, qty: quantity, unit, bb173StockKey: stockKey, bb173StockValue: quantity, receiptActorId: captured.actorId,...(tracking&&c.pantryTrackingPolicy.isStaple(name)&&!wholePepper&&!ambiguousPepper?{staple:true,stapleCount:quantity,stapleStatus:purchasedStaple?'in':previous.stapleStatus||'in',containerLabel:c.pantryTrackingPolicy.containerLabel(name)}:{}) };
          if(wholePepper){kitchen[id].staple=false;delete kitchen[id].stapleStatus;delete kitchen[id].stapleCount;delete kitchen[id].containerLabel;}
          if(ambiguousPepper){kitchen[id].conversionNeedsReview=true;kitchen[id].staple=true;kitchen[id].stapleStatus='unknown';}
        }
        else if (existing) { kitchen[id] = { ...previous, selected: false, qty: null }; delete kitchen[id].bb173StockKey; delete kitchen[id].bb173StockValue; }
      }
      if (root.BBReducedStock?.settleInventory) kitchen = root.BBReducedStock.settleInventory({before: currentKitchen, after: kitchen, actor: captured.actorId});
      const essentials = (response.essentials || []).slice(0, 500).map(x => safeServerRecord(x, ['id', 'lineId', 'receiptId', 'name', 'productName', 'brand', 'quantity', 'unit', 'packQuantity', 'packUnit', 'packCount', 'pricePaid', 'currency', 'market', 'retailer', 'shopSessionId', 'confirmedAt', 'purchasedAt', 'addToPantry', 'kind', 'priceType', 'eligibleForRegularPrice']));
      const receipts = (response.receipts || []).map(x => safeServerRecord(x, ['receiptId', 'shopSessionId', 'market', 'currency', 'retailer', 'purchasedAt', 'confirmedAt', 'foodSubtotal', 'essentialsSubtotal', 'receiptTotal', 'adjustmentTotal']));
      for (const receipt of receipts) for (const field of ['foodSubtotal', 'essentialsSubtotal', 'receiptTotal', 'adjustmentTotal']) if (receipt[field] !== undefined && receipt[field] !== null && (!Number.isFinite(receipt[field]) || Math.abs(receipt[field]) > 100000 || ['foodSubtotal', 'essentialsSubtotal'].includes(field) && receipt[field] < 0)) throw Error('invalid_receipt_summary_amount');
      const priceObservations = (response.priceObservations || []).map(x => safeServerRecord(x, ['id', 'scopeId', 'market', 'retailer', 'currency', 'receiptId', 'canonicalKey', 'brand', 'packQuantity', 'packUnit', 'packCount', 'packPrice', 'pricePaid', 'priceType', 'eligibleForRegularPrice', 'source', 'observedAt', 'purchasedAt'])).filter(x => x.scopeId === scope.id && c.SUPPORTED_MARKETS[x.market] === x.currency && typeof x.retailer === 'string' && x.retailer.trim() && c.canonicalIngredientKey(x.canonicalKey) === x.canonicalKey && c.normalizeMeasuredQuantity(x.packQuantity, x.packUnit)?.quantity === x.packQuantity && Number.isInteger(x.packCount) && x.packCount > 0 && x.packCount <= 10000 && Number.isFinite(x.packPrice) && x.packPrice > 0 && x.packPrice <= 100000 && ['regular', 'promotion', 'unknown'].includes(x.priceType));
      const pantryReview = { required: response.pantryReview?.required !== false, shopSessionId: response.pantryReview?.shopSessionId || body?.shopSessionId || null, confirmedAt: response.pantryReview?.confirmedAt || null };
      const nextCache = { version: 1, actorId: captured.actorId, scope, initialized: response.initialized === true, inventoryRevision: response.inventoryRevision, serverStock: nextServerStock, inventory, essentials, receipts, priceObservations, pantryReview, lastReceiptId: response.receiptId || cached.lastReceiptId || null, syncedAt: now() };
      const ledger = tracking?c.normalizeFinishShopCredits(json(KEYS.finishShop,{}),{canonicalize,market:activeContext().market,inventory:currentKitchen}):json(KEYS.finishShop, {});
      if (body?.shopSessionId && body.addToPantry !== false) {
        const purchasedByKey = new Map();
        for (const line of body.lines || []) {
          if (line.kind !== 'food') continue;
          const id = `${body.shopSessionId}|${line.canonicalKey}|${line.unit}`;
          purchasedByKey.set(id, { ...line, quantity: (purchasedByKey.get(id)?.quantity || 0) + line.quantity, legacyCreditQuantity: (purchasedByKey.get(id)?.legacyCreditQuantity || 0) + Number(line.legacyCredit?.quantity || 0) });
        }
        for (const [id, line] of purchasedByKey) {
          const prior = ledger[id], coverage = { ...(prior?.receiptCoverageById || {}), [body.receiptId]: line.quantity };
          // Receipt stock already covers this purchase. FinishShop's existing existence guard
          // must skip it later; preserve any historical surplus credit for audit/netting.
          ledger[id] = { ...(prior || {}), name: line.canonicalKey, unit: line.unit, qty: prior?.qty ?? line.quantity, week: body.shopSessionId, mode: prior?.mode || 'receipt_inventory', credited: prior?.credited || 0,...(Object.hasOwn(prior||{},'policyAvailableCredit')?{policyAvailableCredit:0}:{}), receiptInventoryReceiptId: body.receiptId, receiptLegacyCreditById: {...(prior?.receiptLegacyCreditById || {}), [body.receiptId]: line.legacyCreditQuantity}, receiptCoverageById: coverage, receiptCoveredQuantity: Object.values(coverage).reduce((n, x) => n + Number(x || 0), 0), purchasedAt: prior?.purchasedAt || body.purchasedAt || now() };
        }
      }
      const confirmed = json(KEYS.confirmed, {});
      const changes = { [key]: nextCache, [KEYS.stock]: nextStock, [KEYS.kitchen]: kitchen, [KEYS.owner]: { version: 1, actorId: captured.actorId, scope, cacheKey: key, initialized: response.initialized === true, inventoryRevision: response.inventoryRevision, serverStock: nextServerStock, appliedAt: now() }, [KEYS.confirmed]: { ...confirmed, receiptReviewRequired: pantryReview.required, receiptId: response.receiptId || null, receiptChangedAt: now() } };
      if (body?.shopSessionId && body.addToPantry !== false) changes[KEYS.finishShop] = ledger;
      const appliedEssentialIds = {...(cached.appliedEssentialIds || {})}, newEssentials = essentials.filter(x => x.addToPantry === true && typeof x.id === 'string' && !appliedEssentialIds[x.id]);
      const appliedPriceIds = {...(cached.appliedPriceIds || {})}, newPrices = priceObservations.filter(x => typeof x.id === 'string' && !appliedPriceIds[x.id]);
      const appliedReceiptIds = {...(cached.appliedReceiptIds || {})}, freshReceipt = body?.action === 'confirm_receipt' && !appliedReceiptIds[body.receiptId];
      const reduced = freshReceipt ? reducedItems(body, reducedReview.reducedLineIds || []) : [];
      if (reduced.length && body.addToPantry !== false && root.BBReducedStock?.prepareInventory) {
        const credits = reduced.map(line => {
          const saved = currentStock[line.canonicalKey + '|' + line.unit] || 0, prior = line.legacyCredit, proof = prior && ledger[prior.id];
          const verified = proof?.receiptInventoryReceiptId === body.receiptId && proof.receiptLegacyCreditById?.[body.receiptId] >= prior.quantity;
          return {name: line.canonicalKey, unit: line.unit, quantity: line.quantity, sourceId: 'receipt:' + body.receiptId + ':' + line.lineId, ...(verified && saved > 0 ? {previouslyCreditedQuantity: prior.quantity, legacyCreditId: prior.id} : {})};
        });
        kitchen = root.BBReducedStock.prepareInventory({before: currentKitchen, after: kitchen, credits, actor: captured.actorId, sourceId: 'receipt:' + body.receiptId, at: reducedReview.confirmedAt || now()});
        changes[KEYS.kitchen] = kitchen;
      }
      const packet = {actorId: captured.actorId, source: 'cloud', stockAfter: nextStock, priceUpdates: newPrices, receiptId: body?.receiptId || response.receiptId || null, stockPantry: body?.addToPantry !== false, addToPantry: body?.addToPantry !== false, market: body?.market, retailer: body?.retailer, shopSessionId: body?.shopSessionId || null, purchasedAt: body?.purchasedAt || null, confirmedAt: body ? receiptConfirmedAt(response, body.receiptId, reducedReview.confirmedAt) : null, reducedItems: reduced, items: (freshReceipt ? body.lines || [] : []).filter(x => x.kind === 'food').map(x => ({...x, key: x.canonicalKey, classification: x.kind})), essentials: newEssentials};
      packet.purchaseCosts = freshReceipt ? acceptedPurchaseCosts(body,reducedReview.reducedLineIds || []) : [];
      // The app's household reconciliation joins this same atomic transaction.
      // Pass the prepared food proof rather than making it reread an older
      // ledger and overwrite this receipt's coverage when it nets essentials.
      packet.finishShopCredits = clone(ledger);
      Object.assign(changes, preparedChanges(packet));
      for (const row of newEssentials) appliedEssentialIds[row.id] = true;
      for (const row of newPrices) appliedPriceIds[row.id] = true;
      if (freshReceipt) appliedReceiptIds[body.receiptId] = true;
      nextCache.appliedEssentialIds = appliedEssentialIds;
      nextCache.appliedPriceIds = appliedPriceIds;
      nextCache.appliedReceiptIds = appliedReceiptIds;
      if (body?.action === 'confirm_receipt' && pendingConfirmation(captured.actorId).receiptId === body.receiptId) changes[pendingKey(captured.actorId)] = null;
      if (!sameSession(captured)) throw Error('receipt_account_changed');
      atomicWrite(changes, captured.actorId);
      try { options.onProjection?.({ stock: nextStock, inventory: kitchen, essentials, receipts, pantryReview, scope }); } catch { /* Stored projection remains valid if rendering fails. */ }
      return { stock: nextStock, inventory: kitchen, essentials, receipts, pantryReview, scope };
    }
    async function commitLocalReceiptInternal(packet) {
      const c = await core(), captured = session(), active = activeContext();
      if (!packet || typeof packet !== 'object' || typeof packet.receiptId !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(packet.receiptId) || !Array.isArray(packet.items) || !packet.items.length || packet.items.length > 200) throw Error('invalid_local_receipt');
      if (packet.market !== active.market || packet.retailer !== active.retailer || !archivedReceiptContext(packet,captured,active)) throw Error('receipt_context_changed');
      const receiptShopSessionId=packet.shopSessionId||null;
      const owner = json(KEYS.owner, {});
      if (owner.actorId && owner.actorId !== captured.actorId) throw Error('receipt_projection_belongs_to_other_account');
      if (pendingConfirmation(captured.actorId).receiptId) throw Error('another_receipt_confirmation_pending');
      const stockPantry = packet.stockPantry !== false, savesKey = localSavesKey(captured.actorId), saves = json(savesKey, {});
      const signature = JSON.stringify(stable({...packet, source: undefined}));
      if (saves[packet.receiptId]) {
        if (saves[packet.receiptId].signature !== signature) throw Error('receipt_identity_conflict');
        return {ok: true, saved: 0, stocked: 0, duplicate: true, localOnly: true, message: 'This receipt has already been saved on this device.'};
      }
      if (Object.keys(saves).length >= 2000) throw Error('local_receipt_history_limit');
      const currentKitchen = json(KEYS.kitchen,{}), initial=options.pantryPolicy===true?c.normalizePantryState(json(KEYS.stock,{}),currentKitchen,{canonicalize,market:active.market}):{stock:json(KEYS.stock,{}),inventory:currentKitchen};
      const currentStock = c.normalizeStockMap(initial.stock, {canonicalize}), nextStock = {...currentStock}, ledger = options.pantryPolicy===true?c.normalizeFinishShopCredits(json(KEYS.finishShop,{}),{canonicalize,market:active.market,inventory:currentKitchen}):json(KEYS.finishShop, {});
      let kitchen = clone(initial.inventory);
      const items = [], purchased = new Map(), credited = new Map();
      const normalizedLines=packet.items.map((raw,index)=>{
        const line=c.normalizeReceiptLine({...raw,id:'line-'+index,...(options.pantryPolicy===true?{}:{packQuantity:null,packUnit:null,packCount:null}),canonicalKey:raw.key||raw.canonicalKey,reviewed:true},{catalog:catalog(),canonicalize,market:active.market,pantryPolicy:options.pantryPolicy===true});
        const guide=c.normalizeMeasuredQuantity(raw.guidePackQuantity,raw.guidePackUnit||raw.unit),bought=c.normalizeMeasuredQuantity(line.quantity,line.unit);
        // The legacy editor labels price per guide pack; keep that baseline
        // untouched while recording the cost of all packs actually bought.
        const guidePrice=typeof raw.price==='number'||typeof raw.price==='string'&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.price.trim())?Number(raw.price):null;
        if(raw.pricePaid===undefined&&raw.lineTotal===undefined&&guide&&bought&&guide.unit===bought.unit&&guidePrice!==null&&Number.isFinite(guidePrice))line.pricePaid=Math.round((guidePrice*bought.quantity/guide.quantity+Number.EPSILON)*100)/100;
        if(line.pricePaid!==null&&(!Number.isFinite(line.pricePaid)||line.pricePaid<0||line.pricePaid>100000))throw Error('invalid_local_receipt_price');
        return line;
      });
      const annotated=inferPurchaseAnnotations(normalizedLines,packet.receiptId,receiptShopSessionId,c);
      for (const [index, raw] of packet.items.entries()) {
        const line = annotated.lines[index];
        if (!['food', 'essential'].includes(line.classification) || line.sourceKind !== 'purchase') throw Error('invalid_local_receipt_item');
        if (line.reduced && !reducedEnabled()) throw Error('premium_reduced_food_required');
        const issues = stockPantry ? line.issues : line.issues.filter(x => !['measured_quantity_required', 'pack_count_required', 'canonical_unit_not_in_catalog'].includes(x));
        if (issues.length || stockPantry && !c.normalizeMeasuredQuantity(line.quantity, line.unit)) throw Error('invalid_local_receipt_quantity');
        items.push({...raw, lineId: line.id, key: line.classification === 'food' ? line.canonicalKey : raw.key || null, name: line.description, classification: line.classification, quantity: line.quantity, unit: line.unit, pricePaid: line.pricePaid, priceType: line.priceType, reduced: line.reduced});
        if (!stockPantry || line.classification !== 'food') continue;
        const stockKey = line.canonicalKey + '|' + line.unit;
        purchased.set(stockKey, (purchased.get(stockKey) || 0) + line.quantity);
      }
      for (const [stockKey, quantity] of purchased) {
        const split = stockKey.lastIndexOf('|'), name = stockKey.slice(0, split), unit = stockKey.slice(split + 1), id = receiptShopSessionId + '|' + stockKey;
        const credit = c.computeReceiptCredit({canonicalKey: name, quantity, unit}, ledger, {shopSessionId: receiptShopSessionId, receiptId: packet.receiptId});
        credited.set(stockKey, credit);
        nextStock[stockKey] = (nextStock[stockKey] || 0) + credit.addedQuantity;
        if (nextStock[stockKey] > 1000000) throw Error('inventory_quantity_limit');
        const prior = ledger[id] || {}, coverage = {...(prior.receiptCoverageById || {}), [packet.receiptId]: quantity};
        if(receiptShopSessionId)ledger[id] = {...prior, name, unit, qty: prior.qty ?? quantity, week: receiptShopSessionId, mode: prior.mode || 'receipt_inventory', credited: prior.credited || 0,...(Object.hasOwn(prior,'policyAvailableCredit')?{policyAvailableCredit:0}:{}), receiptInventoryReceiptId: packet.receiptId, receiptLegacyCreditById: {...(prior.receiptLegacyCreditById || {}), [packet.receiptId]: credit.priorCreditedQuantity}, receiptCoverageById: coverage, receiptCoveredQuantity: Object.values(coverage).reduce((n, x) => n + Number(x || 0), 0), purchasedAt: prior.purchasedAt || now()};
        const existing = Object.entries(kitchen).filter(([, x]) => x?.selected && (x.bb173StockKey===stockKey||c.canonicalIngredientKey(x.name, canonicalize) === name && c.normalizeStockQuantity(x.qty, x.unit)?.unit === unit));
        const bucketed=root.BBReducedStock?.projectFrozenBuckets?.({inventory:kitchen,stockKey,currentQuantity:nextStock[stockKey]-credit.addedQuantity,nextQuantity:nextStock[stockKey],location:items.find(line=>line.key+'|'+line.unit===stockKey)?.location||'cupboard',actor:captured.actorId,canonicalize,market:active.market});
        if(bucketed){kitchen=bucketed;continue;}
        const entry = existing[0], location = entry?.[1]?.loc || 'cupboard', kitchenId = entry?.[0] || kitchenRecordId(kitchen,location+'|'+name,stockKey);
        for (const [oldId, row] of existing.slice(1)) { kitchen[oldId] = {...row, selected: false, qty: null}; delete kitchen[oldId].bb173StockKey; delete kitchen[oldId].bb173StockValue; }
        const incoming=items.find(line=>line.key+'|'+line.unit===stockKey),wholePepper=c.pantryTrackingPolicy.isWholePepper?.(incoming?.name||name,unit,incoming||{})===true;
        kitchen[kitchenId] = {...(entry?.[1] || {}), name: wholePepper?'Peppers':entry?.[1]?.name || name, loc: location, selected: true, qty: nextStock[stockKey], unit, bb173StockKey: stockKey, bb173StockValue: nextStock[stockKey], receiptActorId: captured.actorId,...(wholePepper?{staple:false,containerLabel:undefined,stapleCount:undefined,stapleStatus:undefined}:options.pantryPolicy===true&&c.pantryTrackingPolicy.isStaple(name)?{staple:true,stapleCount:nextStock[stockKey],stapleStatus:'in',containerLabel:c.pantryTrackingPolicy.containerLabel(name)}:{})};
      }
      if (root.BBReducedStock?.settleInventory) kitchen = root.BBReducedStock.settleInventory({before: currentKitchen, after: kitchen, actor: captured.actorId});
      const reduced = items.filter(line => line.classification === 'food' && line.reduced === true), savedAt = now();
      const remainingCredit = new Map([...credited].map(([key, value]) => [key, value.priorCreditedQuantity]));
      for (const line of reduced) {const key = line.key + '|' + line.unit, amount = Math.min(line.quantity || 0, remainingCredit.get(key) || 0);line.legacyCreditQuantity = amount;remainingCredit.set(key, Math.max(0, (remainingCredit.get(key) || 0) - amount));}
      if (stockPantry && reduced.length && root.BBReducedStock?.prepareInventory) {
        const reducedCredits = reduced.map(line => {const prior = credited.get(line.key + '|' + line.unit);return {name: line.key, unit: line.unit, quantity: line.quantity, sourceId: 'receipt:' + packet.receiptId + ':' + line.lineId, ...(line.legacyCreditQuantity > 0 && prior?.legacyCredit?.id ? {previouslyCreditedQuantity: line.legacyCreditQuantity, legacyCreditId: prior.legacyCredit.id} : {})};});
        kitchen = root.BBReducedStock.prepareInventory({before: currentKitchen, after: kitchen, credits: reducedCredits, actor: captured.actorId, sourceId: 'receipt:' + packet.receiptId, at: savedAt});
      }
      // A one-off yellow sticker (or other known promotion) is never saved as
      // the standard shelf price for following weeks, even on the local path.
      const priceUpdates = (packet.priceUpdates || []).filter(update => !items.some(line => c.canonicalIngredientKey(line.key||line.name,canonicalize) === c.canonicalIngredientKey(update.name,canonicalize) && (line.reduced || line.priceType === 'promotion')));
      const normalizedPacket = {...packet, actorId: captured.actorId, source: 'legacy', stockPantry, addToPantry: stockPantry, stockAfter: nextStock, items, priceUpdates, reducedItems: reduced, confirmedAt: savedAt, essentials: stockPantry ? items.filter(x => x.classification === 'essential') : []};
      normalizedPacket.purchaseCosts=items.filter(line=>Number.isFinite(line.pricePaid)&&line.pricePaid>=0).map(line=>({...line,legacyCreditQuantity:credited.get(line.key+'|'+line.unit)?.priorCreditedQuantity||0}));
      normalizedPacket.finishShopCredits = clone(ledger);
      const changes = preparedChanges(normalizedPacket);
      saves[packet.receiptId] = {signature, savedAt, stocked: stockPantry};
      Object.assign(changes, {[savesKey]: saves});
      if (stockPantry) {
        Object.assign(changes, {[KEYS.stock]: c.normalizeStockMap(nextStock, {canonicalize}), [KEYS.kitchen]: kitchen});
        // A reviewed household credit may have augmented the prepared food
        // ledger through the app hook. Keep that combined journal on commit.
        if (!Object.hasOwn(changes, KEYS.finishShop)) changes[KEYS.finishShop] = ledger;
      }
      if (!sameSession(captured) || !sameContext(active)) throw Error('receipt_account_changed');
      atomicWrite(changes, captured.actorId);
      reportReducedReceipt({receiptId: packet.receiptId, market: packet.market, retailer: packet.retailer, purchasedAt: packet.purchasedAt}, reduced.map(line => line.lineId), captured, active, savedAt);
      try {options.onProjection?.({source: 'legacy', stock: nextStock, inventory: kitchen, essentials: normalizedPacket.essentials});} catch {}
      return {ok: true, saved: items.length, stocked: stockPantry ? items.length : 0, localOnly: true, message: stockPantry ? 'Prices saved and bought items added to At Home on this device.' : 'Reviewed prices saved on this device.'};
    }
    async function commitLocalReceipt(packet) { return withInventoryLock(() => commitLocalReceiptInternal(packet)); }
    function uuid() { const value = options.createId?.() || root.crypto?.randomUUID?.(); if (!value) throw Error('receipt_identity_generator_unavailable'); return value; }
    async function normalizeDraft(raw, context = {}) {
      const c = await core(), captured = session(), active = activeContext();
      const market = context.market || active.market, retailer = context.retailer ?? active.retailer;
      if (market !== active.market || retailer !== active.retailer) throw Error('receipt_context_changed');
      const draft = c.normalizeReceiptDraft(raw, { ...context, market, retailer, catalog: catalog(), canonicalize,pantryPolicy:options.pantryPolicy===true });
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
      const rawCredits = options.getFinishShopCredits ? options.getFinishShopCredits() : json(KEYS.finishShop, {}),credits=options.pantryPolicy===true?c.normalizeFinishShopCredits(rawCredits,{canonicalize,market:context.market,inventory:json(KEYS.kitchen,{})}):rawCredits;
      const pending = pendingConfirmation(captured.actorId),annotations=inferPurchaseAnnotations(draft.lines||[],draft.receiptId,draft.shopSessionId,c,pending.receiptId===draft.receiptId?pending:null);
      let body = c.prepareReceiptConfirmation({...draft,lines:annotations.lines}, { requestId, catalog: catalog(), canonicalize, finishShopCredits: credits,pantryPolicy:options.pantryPolicy===true });
      const reviewedReducedIds = reducedLineIds(body, annotations.lines.filter(line => line.reduced === true && line.reviewed === true && line.selected !== false && line.classification === 'food' && line.sourceKind === 'purchase').map(line => line.id));
      if (reviewedReducedIds.length && !reducedEnabled()) throw Error('premium_reduced_food_required');
      requestId = body.requestId;
      if (pending.receiptId && pending.receiptId !== draft.receiptId) throw Error('another_receipt_confirmation_pending');
      if (!owner.actorId) {
        const initial = await request('GET', captured, null, signal);
        if (!sameSession(captured) || !sameContext(context) || signal?.aborted) throw Error('receipt_context_changed');
        await applyProjection(initial, captured);
        owner = json(KEYS.owner, {});
      }
      if (!Number.isSafeInteger(owner.inventoryRevision)) throw Error('receipt_inventory_revision_missing');
      body.expectedScope = c.normalizeInventoryScope(owner.scope);
      const baselineStock=options.pantryPolicy===true?c.normalizePantryState(json(KEYS.stock,{}),json(KEYS.kitchen,{}),{canonicalize,market:context.market}).stock:json(KEYS.stock,{});
      body.inventoryBaseline = { stock: c.normalizeStockMap(baselineStock, { canonicalize }), expectedRevision: owner.inventoryRevision, initialize: owner.initialized !== true };
      if (pending.receiptId) {
        const semantic = value => { const { inventoryBaseline, ...rest } = value; return JSON.stringify(stable(rest)); };
        if (pending.actorId !== captured.actorId || !pending.body || semantic(pending.body) !== semantic(body)) throw Error('pending_receipt_payload_changed');
        if (JSON.stringify(pending.reducedLineIds || []) !== JSON.stringify(reviewedReducedIds)) throw Error('pending_reduced_receipt_metadata_changed');
        const baseline = pending.body.inventoryBaseline;
        if (!baseline || !Number.isSafeInteger(baseline.expectedRevision) || baseline.expectedRevision < 0 || typeof baseline.initialize !== 'boolean') throw Error('invalid_pending_receipt_baseline');
        body.inventoryBaseline = { stock: c.normalizeStockMap(baseline.stock, { canonicalize }), expectedRevision: baseline.expectedRevision, initialize: baseline.initialize };
      }
      body = c.validateReceiptConfirmation(body, { catalog: catalog(), canonicalize });
      const operationKey = `${captured.actorId}|${requestId}`, digest = JSON.stringify(body);
      if (inFlight.has(operationKey)) { const other = inFlight.get(operationKey); if (other.digest !== digest) throw Error('receipt_request_in_progress_with_different_payload'); return other.promise; }
      if ([...inFlight.keys()].some(key => key.startsWith(captured.actorId + '|'))) throw Error('another_receipt_confirmation_in_progress');
      if (!pending.receiptId) {
        const value = JSON.stringify({ version: 1, actorId: captured.actorId, receiptId: body.receiptId, requestId, context, body, createdAt: now(), ...(reviewedReducedIds.length ? {reducedLineIds: reviewedReducedIds} : {}),...(annotations.inferredPromotionLineIds.length?{inferredPromotionLineIds:annotations.inferredPromotionLineIds}:{}),...(annotations.inferredReducedLineIds.length?{inferredReducedLineIds:annotations.inferredReducedLineIds}:{}) });
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
        const reviewed = {reducedLineIds: reviewedReducedIds, confirmedAt: receiptConfirmedAt(response, body.receiptId, pending.createdAt || pendingConfirmation(captured.actorId).createdAt)};
        reportReducedReceipt(body, reviewedReducedIds, captured, context, reviewed.confirmedAt);
        try { return { ...base, localApplied: true, projection: await applyProjection(response, captured, body, reviewed) }; }
        catch (error) { return { ...base, localApplied: false, syncRequired: true, localError: error.message }; }
      })();
      inFlight.set(operationKey, { digest, promise: operation });
      try { return await operation; } finally { inFlight.delete(operationKey); }
    }
    async function synchronizeInternal({ signal } = {}) {
      const captured = session(), context = activeContext(), pending = pendingConfirmation(captured.actorId), response = await request('GET', captured, null, signal, pending.receiptId ? { receiptId: pending.receiptId } : null);
      if (!sameSession(captured) || !sameContext(context) || signal?.aborted) throw Error('receipt_context_changed');
      if (pending.receiptId && (response.receiptId !== pending.receiptId || !Number.isSafeInteger(response.receiptRevision) || response.receiptRevision < 1)) return { ok: true, localApplied: false, syncRequired: true, pendingReceipt: true, localError: 'pending_receipt_not_yet_confirmed' };
      const confirmedAt = pending.receiptId ? receiptConfirmedAt(response, pending.receiptId, null) : null;
      if (pending.receiptId) reportReducedReceipt(pending.body, pending.reducedLineIds || [], captured, context, confirmedAt);
      try { return { ok: true, localApplied: true, projection: await applyProjection(response, captured, pending.receiptId ? pending.body : null, {reducedLineIds: pending.reducedLineIds || [], confirmedAt}), needsPantryConfirmation: response.pantryReview?.required !== false }; }
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
      const confirmedAt = receiptConfirmedAt(response, body.receiptId, pending.createdAt);
      reportReducedReceipt(body, pending.reducedLineIds || [], captured, context, confirmedAt);
      try { return { ...base, localApplied: true, projection: await applyProjection(response, captured, body, {reducedLineIds: pending.reducedLineIds || [], confirmedAt}) }; }
      catch (error) { return { ...base, localApplied: false, syncRequired: true, localError: error.message }; }
    }
    async function confirmPantryInternal({ stock, expectedRevision, shopSessionId, expectedScope, signal } = {}) {
      if (!stock || typeof stock !== 'object' || Array.isArray(stock) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('reviewed_pantry_stock_and_revision_required');
      const c = await core();if(options.pantryPolicy===true)stock=c.normalizePantryState(stock,json(KEYS.kitchen,{}),{canonicalize,market:activeContext().market}).stock; stock = c.normalizeStockMap(stock, { canonicalize });
      if (pendingConfirmation(session().actorId).receiptId) throw Error('receipt_confirmation_recovery_required_first');
      const captured = session(), context = activeContext(), owner = json(KEYS.owner, {}), scope = c.normalizeInventoryScope(expectedScope || owner.scope), baseline = c.normalizeStockMap(options.pantryPolicy===true?c.normalizePantryState(json(KEYS.stock,{}),json(KEYS.kitchen,{}),{canonicalize,market:context.market}).stock:json(KEYS.stock, {}), { canonicalize }), response = await request('POST', captured, { action: 'confirm_pantry', stock, expectedRevision, expectedScope: scope, shopSessionId }, signal);
      if (!sameSession(captured) || !sameContext(context) || signal?.aborted) return { ok: true, committed: true, localApplied: false, syncRequired: true };
      try { return { ok: true, committed: true, localApplied: true, projection: await applyProjection(response, captured, { action: 'confirm_pantry', expectedScope: scope, localProjectionBaseline: baseline }), needsPantryConfirmation: false }; }
      catch (error) { return { ok: true, committed: true, localApplied: false, syncRequired: true, localError: error.message }; }
    }
    function cancelDraft(value) { const id = typeof value === 'string' ? value : value?.receiptId; if (id) memoryDrafts.delete(id); let pending = false; try { pending = pendingConfirmation(session().actorId).receiptId === id; } catch {} return { cancelled: true, inventoryChanged: false, cloudConfirmationPending: pending }; }
    async function canonicalOptions() {
      const c = await core(), source = catalog()?.ingredients || catalog() || {}, grouped = new Map();
      for (const pair of Object.keys(source)) { const i = pair.lastIndexOf('|'); if (i <= 0) continue; let key = c.canonicalIngredientKey(pair.slice(0, i), canonicalize), unit = c.normalizeUnit(pair.slice(i + 1)); if (!key || !unit) continue;if(options.pantryPolicy===true){key=c.pantryTrackingPolicy.canonicalName(key,canonicalize);unit=c.pantryTrackingPolicy.isStaple(key)?'each':c.pantryTrackingPolicy.normalize(key,1,unit,{market:activeContext().market})?.unit||unit;} const item = grouped.get(key) || { key, name: key, units: [] }; if (!item.units.includes(unit)) item.units.push(unit); grouped.set(key, item); }
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
      const samples = (cached.priceObservations || []).filter(x => x.canonicalKey === canonicalKey && x.market === market && String(x.retailer || '').toLowerCase() === String(retailer || '').toLowerCase() && x.currency === currency && x.packQuantity === packQuantity && x.packUnit === packUnit && String(x.brand || '').toLowerCase() === String(brand).toLowerCase() && x.priceType === 'regular' && x.eligibleForRegularPrice !== false && Number(x.packPrice) > 0).map((value,index)=>({value,index,time:Date.parse(value.purchasedAt||value.observedAt||'')||0})).sort((a,b)=>b.time-a.time||a.index-b.index).slice(0,21).map(x => Number(x.value.packPrice)).sort((a, b) => a - b);
      if (!samples.length) return null;
      const median = xs => xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
      const center = median(samples), robust = samples.length >= 3 ? samples.filter(x => x >= center / 3 && x <= center * 3) : samples;
      return { packPrice: Math.round(median(robust) * 100) / 100, packQuantity, packUnit, currency, samples: robust.length, source: 'account_store_receipt_regular_price', verifiedRetailQuote: false };
    }
    const commitReviewedReceipt = (draft, value) => withInventoryLock(() => commitReviewedReceiptInternal(draft, value));
    const synchronize = value => withInventoryLock(() => synchronizeInternal(value));
    const retryPendingConfirmation = value => withInventoryLock(() => retryPendingConfirmationInternal(value));
    const confirmPantry = value => withInventoryLock(() => confirmPantryInternal(value));
    return Object.freeze({ configure(value) { options = { ...options, ...value }; return this; }, normalizeDraft, commitLocalReceipt, commitReviewedReceipt, cancelDraft, canonicalOptions, synchronize, retryPendingConfirmation, confirmPantry, getCachedProjection, getLearnedPrice, recoverLocalTransaction, withInventoryLock, getPendingConfirmation: () => clone(pendingConfirmation(session().actorId)), keys: KEYS });
  }
  root.BBReceiptInventoryFactory = createReceiptInventoryAdapter;
  root.BBReceiptInventory = createReceiptInventoryAdapter();
})(typeof window !== 'undefined' ? window : globalThis);
