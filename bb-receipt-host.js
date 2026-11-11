/* Receipt inventory bridge. Cloud confirmation precedes stock changes. */
(function (root) {
  'use strict';
  const KEYS = Object.freeze({
    actor: 'basketboss_receipt_host_actor_v1',
    stock: 'basketboss_321_v7_measured_pantry',
    kitchen: 'basketboss_makeameal_v1_inventory',
    confirmed: 'basketboss_ui_next_confirmed_pantry_v1',
    ledger: 'basketboss_purchase_receipts_v1',
    owner: 'basketboss_receipt_projection_owner_v1',
    prices: 'basketboss_ui_next_local_shelf_prices_v1',
    paidPrices: 'basketboss_321_v15_recorded_prices_v1',
    packSizes: 'basketboss_beta_actual_pack_sizes_v1',
    shop: 'basketboss_active_shop_session_v7',
    shopArchive: 'basketboss_shop_session_archive_v7',
    ticks: 'basketboss_321_v11_shop_ticks',
    purchases: 'basketboss_ui_next_bought_quantity_v1',
    choices: 'basketboss_purchase_choices_v1',
    partials: 'basketboss_partial_purchases_v1',
    plan: 'basketboss_321_unified_state_v1',
    lunch: 'basketboss_321_v8_school_lunchboxes_v1',
    notes: 'basketboss_v172_custom_dinners_v1'
  });
  const LEGACY_ACTIVE_KEYS = [KEYS.stock, KEYS.kitchen, KEYS.confirmed, KEYS.ledger, KEYS.owner];
  const ACTIVE_KEYS = [...LEGACY_ACTIVE_KEYS, KEYS.prices, KEYS.paidPrices, KEYS.packSizes, KEYS.shop, KEYS.shopArchive, KEYS.ticks, KEYS.purchases, KEYS.choices, KEYS.partials, KEYS.plan, KEYS.lunch, KEYS.notes];
  const BACKUP_KEYS = ACTIVE_KEYS.filter(key => ![KEYS.owner, KEYS.plan].includes(key));
  const HOME_KEY = 'basketboss_at_home_requirements_v1';
  const FEATURES_KEY = 'basketboss_321_features_v1';
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
  function validTripId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{4,120}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
  }
  // A shop is selected by its recorded identity, never by inferred matching of
  // product names, quantities or receipt totals. Only labels use the date.
  function recordedTrips(credits, current = {}) {
    if (!isObject(credits) || Array.isArray(credits)) return [];
    const trips = new Map(), rawTotals = new Map();
    const identity = (row, id) => {
      const aliases = {eggs: 'egg', potatoes: 'potato', tomatoes: 'tomato', onions: 'onion', peppers: 'pepper', carrots: 'carrot', bananas: 'banana', apples: 'apple', lemons: 'lemon', limes: 'lime', mushrooms: 'mushroom', courgettes: 'courgette', scallops: 'scallop', wraps: 'wrap'};
      let name = typeof (row?.canonicalKey || row?.name) === 'string' ? (row.canonicalKey || row.name).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() : '';
      name = aliases[name] || name;
      const rawUnit = typeof row?.unit === 'string' ? row.unit.trim().toLowerCase() : '', unit = rawUnit === 'kg' ? 'g' : rawUnit === 'l' ? 'ml' : rawUnit;
      if (!name || name.length > 160 || name.includes('|') || ['__proto__', 'prototype', 'constructor'].includes(name) || !['g', 'ml', 'each', 'clove', 'bulb', 'tin', 'pack', 'bag', 'bunch', 'loaf', 'slice', 'tsp', 'tbsp'].includes(unit)) return null;
      return {key: id + '|' + name + '|' + unit, unit, quantity: row.credited * (rawUnit === 'kg' || rawUnit === 'l' ? 1000 : 1)};
    };
    for (const [key, row] of Object.entries(credits).slice(0, 5000)) {
      if (!isObject(row) || typeof row.credited !== 'number' || !Number.isFinite(row.credited) || row.credited <= 0 || row.credited > 1000000) continue;
      const id = row.shopSessionId || row.week;
      if (!validTripId(id) || id === current.shopSessionId || row.market && row.market !== current.market || row.retailer && row.retailer !== current.retailer) continue;
      const value = typeof row.purchasedAt === 'number' ? row.purchasedAt : typeof row.purchasedAt === 'string' && /^\d{4}-\d\d-\d\d(?:T[^\r\n]{1,60})?$/.test(row.purchasedAt) ? Date.parse(row.purchasedAt) : NaN;
      const at = Number.isFinite(value) && Math.abs(value) <= 8640000000000000 ? value : 0;
      const trip = trips.get(id) || {id, at: 0, count: 0, covered: true, linkable: true};trip.at = Math.max(trip.at, at);trips.set(id, trip);
      const expected = identity(row, id);
      if (row.canonicalCreditId && key !== row.canonicalCreditId) {
        const aggregate = credits[row.canonicalCreditId], aggregateIdentity = identity(aggregate, id);
        const aggregateTrip = aggregate?.shopSessionId || aggregate?.week;
        if (!expected || row.canonicalCreditId !== expected.key || aggregateTrip !== id || aggregate?.market && aggregate.market !== current.market || aggregate?.retailer && aggregate.retailer !== current.retailer || !aggregateIdentity || aggregateIdentity.key !== expected.key || typeof aggregate.credited !== 'number' || !Number.isFinite(aggregate.credited) || aggregate.credited <= 0 || aggregate.credited > 1000000) trip.linkable = false;
        else {
          const total = (rawTotals.get(expected.key) || 0) + expected.quantity;rawTotals.set(expected.key, total);
          if (total > aggregateIdentity.quantity + 0.000001) trip.linkable = false;
        }
        // Raw source rows remain an audit/replay record. Only the matching
        // canonical aggregate participates in receipt credit and its UI count.
        continue;
      }
      if (!expected || key !== expected.key || row.canonicalCreditId && row.canonicalCreditId !== expected.key) trip.linkable = false;
      const covered = typeof row.receiptInventoryReceiptId === 'string' && !!row.receiptInventoryReceiptId || typeof row.receiptCoveredQuantity === 'number' && row.receiptCoveredQuantity >= row.credited;
      trip.count++;trip.covered = trip.covered && !!covered;
    }
    return [...trips.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 20);
  }
  function createHost(initial = {}) {
    let options = {...initial}, availability = {available: false, premium: false}, lastChecked = 0, checkedActor = null, statusPromise = null;
    let isolationError = null, issue = null, observer = null, scheduled = false, rendering = false, reviewing = false, confirmingCurrent = false, activeDialog = null, lastTab = null, generation = 0, configured = false;
    let deletionPaused = false, choosingTrip = false, observedActor = null;
    let activePantryReview = null, purchaseSyncPromise = null;
    const inlineReviews = new Set(), projectionHolds = new Set();
    const blocked = () => deletionPaused || root.BBAccountDeletion?.isDeleting?.() === true;
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
    const projection = () => { try { return blocked() || actor() === 'guest' ? null : adapter()?.getCachedProjection?.() || null; } catch { return null; } };
    function projectionPin() {const active = context();return {actorId: actor(), generation, market: active.market, retailer: active.retailer};}
    function sameProjectionPin(pin) {const active = context();return !blocked() && pin.actorId === actor() && pin.generation === generation && pin.market === active.market && pin.retailer === active.retailer;}
    function notifyProjection(value) {
      let held = false;
      for (const hold of projectionHolds) if (sameProjectionPin(hold.pin)) {hold.pending = value;hold.hasPending = true;held = true;}
      if (!held) options.onProjection?.(value);
    }
    function holdProjection() {const hold = {pin: projectionPin(), pending: null, hasPending: false};projectionHolds.add(hold);return hold;}
    function releaseProjection(hold, refresh) {
      if (!hold || !projectionHolds.delete(hold) || !refresh || !hold.hasPending || !sameProjectionPin(hold.pin)) return;
      notifyProjection(hold.pending);
    }
    function discardInlineReviews() {for (const review of [...inlineReviews]) review.dispose({refresh: false});projectionHolds.clear();}
    function writeAtomic(changes, expected = {}) {
      if (blocked()) throw Error('account_deletion_in_progress');
      const before = Object.fromEntries(Object.keys(changes).map(key => [key, store().getItem(key)]));
      for (const [key, value] of Object.entries(expected)) if ((Object.hasOwn(before, key) ? before[key] : store().getItem(key)) !== value) throw Error('receipt_host_storage_changed');
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
    function backupJSON(value) {
      const bytes = JSON.stringify(value);
      if (typeof bytes !== 'string' || bytes.length > 2500000) throw Error('pantry_backup_too_large');
      let count = 0;
      const visit = (item, depth = 0) => {
        if (++count > 60000 || depth > 22) throw Error('pantry_backup_invalid');
        if (typeof item === 'number' && !Number.isFinite(item)) throw Error('pantry_backup_invalid');
        if (typeof item === 'string' && item.length > 500000) throw Error('pantry_backup_invalid');
        if (item && typeof item === 'object') {
          if (Array.isArray(item)) {if (item.length > 5000) throw Error('pantry_backup_invalid');for (const row of item) visit(row, depth + 1);}
          else for (const [key, row] of Object.entries(item)) {if (['__proto__','prototype','constructor','access_token','refresh_token','authorization','service_role','anonkey','premiumaccess','entitlement'].includes(key.toLowerCase())) throw Error('pantry_backup_private_field');visit(row, depth + 1);}
        }
      };
      visit(value);return JSON.parse(bytes);
    }
    function backupHasData(snapshot) {
      const values = snapshot.values || {}, nonempty = value => isObject(value) && Object.keys(value).length > 0;
      if (Object.values(values[KEYS.stock] || {}).some(amount => typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) return true;
      if (Object.values(values[KEYS.kitchen] || {}).some(row => isObject(row) && row.selected !== false && (Number(row.qty) > 0 || row.qty == null && typeof row.name === 'string' && row.name.trim() || ['in','low','out','in_stock'].includes(row.stapleStatus)))) return true;
      if (snapshot.essentials.some(row => row?.selected !== false && (Number(row.ownedQty) > 0 || Number(row.targetQty) > 0 || row.manualPending !== false && Number(row.qty) > 0))) return true;
      if ([KEYS.prices, KEYS.paidPrices, KEYS.packSizes, KEYS.ledger, KEYS.shopArchive, KEYS.purchases, KEYS.choices, KEYS.partials].some(key => nonempty(values[key]))) return true;
      if (Object.values(values[KEYS.lunch]?.days || {}).some(rows => Array.isArray(rows) && rows.length) || Object.values(values[KEYS.notes] || {}).some(value => typeof value === 'string' && value.trim())) return true;
      if (Object.values(values[KEYS.ticks] || {}).some(Boolean)) return true;
      if (['bought','purchases','partials','reducedPurchases','reducedSuperseded'].some(key => nonempty(values[KEYS.shop]?.[key]))) return true;
      return Object.values(snapshot.home || {}).some(value => isObject(value) ? Object.keys(value).length > 0 : Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined);
    }
    function validateBackupBalances(snapshot) {
      const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000;
      const stock = snapshot.values[KEYS.stock];
      if (stock !== null && (!isObject(stock) || Object.entries(stock).some(([key,value]) => !key || key.length > 240 || !validAmount(value)))) throw Error('pantry_backup_invalid_quantity');
      const kitchen = snapshot.values[KEYS.kitchen];
      if (kitchen !== null && (!isObject(kitchen) || Object.values(kitchen).some(row => !isObject(row) || ['qty','bb173StockValue'].some(key => row[key] !== undefined && row[key] !== null && (!['number','string'].includes(typeof row[key]) || String(row[key]).trim() === '' || !validAmount(Number(row[key]))))))) throw Error('pantry_backup_invalid_quantity');
      if (snapshot.essentials.some(row => !isObject(row) || ['qty','ownedQty','targetQty'].some(key => row[key] !== undefined && row[key] !== null && (!['number','string'].includes(typeof row[key]) || String(row[key]).trim() === '' || !validAmount(Number(row[key])))))) throw Error('pantry_backup_invalid_quantity');
    }
    function exportBackup() {
      if (blocked() || isolationError || hasPendingConfirmation()) throw Error('pantry_backup_paused');
      const who = actor(), marker = read(KEYS.actor), owner = read(KEYS.owner);
      if (marker.actorId && marker.actorId !== who || owner.actorId && owner.actorId !== who) throw Error('pantry_backup_account_changed');
      const values = Object.fromEntries(BACKUP_KEYS.map(key => {const raw = store().getItem(key);return [key, raw === null ? null : JSON.parse(raw)];}));
      const all = read(HOME_KEY), home = all.byActor?.[who] || {};
      if (!isObject(home)) throw Error('pantry_backup_invalid');
      const result = backupJSON({version: 1, actorId: who, values, essentials: clone(options.getEssentials?.() || []), home});
      if (!Array.isArray(result.essentials) || result.essentials.length > 60) throw Error('pantry_backup_invalid');
      validateBackupBalances(result);
      result.hasData = backupHasData(result);return result;
    }
    function hasLocalData() {return exportBackup().hasData;}
    function prepareBackupRestore(payload) {
      if (blocked() || isolationError || hasPendingConfirmation()) throw Error('pantry_backup_paused');
      const who = actor(), saved = backupJSON(payload);
      if (who === 'guest' || !isObject(saved) || saved.version !== 1 || saved.actorId !== who || !isObject(saved.values) || !isObject(saved.home) || !Array.isArray(saved.essentials) || saved.essentials.length > 60 || Object.keys(saved.values).some(key => !BACKUP_KEYS.includes(key))) throw Error('pantry_backup_account_invalid');
      for (const key of BACKUP_KEYS) if (!Object.hasOwn(saved.values, key) || saved.values[key] !== null && !isObject(saved.values[key])) throw Error('pantry_backup_invalid');
      validateBackupBalances(saved);
      const local = exportBackup(), comparable = value => JSON.stringify(stableBackup(value));
      const desired = {values: saved.values, essentials: saved.essentials, home: saved.home}, current = {values: local.values, essentials: local.essentials, home: local.home};
      if (comparable(desired) === comparable(current)) return {updates: {}, expected: {}, requiresReview: false, restored: false};
      if (local.hasData) return {updates: {}, expected: {}, requiresReview: true, restored: false};
      const expected = Object.fromEntries([...BACKUP_KEYS, KEYS.owner, HOME_KEY, FEATURES_KEY, 'basketboss_cloud_session_v1'].map(key => [key, store().getItem(key)]));
      const all = read(HOME_KEY), features = read(FEATURES_KEY);all.version ??= 1;all.byActor ??= {};all.byActor[who] = clone(saved.home);
      features.essentials = clone(saved.essentials);features.version ??= 1;
      const updates = {...clone(saved.values), [KEYS.owner]: null, [HOME_KEY]: all, [FEATURES_KEY]: features};
      return {updates, expected, requiresReview: false, restored: true};
    }
    function stableBackup(value) {return Array.isArray(value) ? value.map(stableBackup) : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableBackup(value[key])])) : value;}
    function claimGuestMetadata(value, who) {
      if (Array.isArray(value)) return value.map(row => claimGuestMetadata(row, who));
      if (!isObject(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, ['actor','actorId'].includes(key) && row === 'guest' ? who : claimGuestMetadata(row, who)]));
    }
    function switchActor() {
      if (blocked()) return false;
      const next = actor();
      const marker = read(KEYS.actor), receiptOwner = read(KEYS.owner);
      const previous = marker.actorId || receiptOwner.actorId || next;
      if (previous === next) {
        if (!marker.actorId) writeAtomic({[KEYS.actor]: {version: 1, actorId: next, ...(next !== 'guest' ? {localAccountSeen: true} : {})}});
        const previousView = observedActor;observedActor = next;
        // Another tab may have completed the shared-storage profile switch
        // before this tab receives its session event. Its in-memory plan still
        // needs replacement even though the persisted marker is already right.
        if (previousView !== null && previousView !== next) {
          discardInlineReviews();
          const handled = options.onActorChanged?.({previous: previousView, actor: next, guestClaimed: false}) === true;
          if (!handled) options.onProjection?.({actorChanged: true});
        }
        return false;
      }
      discardInlineReviews();
      if (typeof previous !== 'string' || !/^(?:guest|[A-Za-z0-9_-]{8,120})$/.test(previous)) throw Error('receipt_host_actor_invalid');
      const saved = Object.fromEntries(ACTIVE_KEYS.map(key => [key, store().getItem(key)]));
      const savedEssentials = options.getEssentials ? clone(options.getEssentials() || []) : [];
      const destination = read(archiveKey(next));
      if (Object.keys(destination).length && (destination.version !== 1 || destination.actorId !== next || !isObject(destination.values) || LEGACY_ACTIVE_KEYS.some(key => !Object.hasOwn(destination.values, key)) || Object.keys(destination.values).some(key => !ACTIVE_KEYS.includes(key) || destination.values[key] !== null && typeof destination.values[key] !== 'string'))) throw Error('receipt_host_snapshot_invalid');
      if (destination.essentials !== undefined && (!Array.isArray(destination.essentials) || destination.essentials.length > 60)) throw Error('receipt_host_snapshot_invalid');
      const home = read(HOME_KEY), actorHome = home.byActor?.[next];
      const hasAccountHistory = isObject(actorHome) && Object.values(actorHome).some(value => isObject(value) ? Object.keys(value).length > 0 : value !== null && value !== undefined);
      // Only the first unclaimed guest profile moves into a signed-in account.
      // Later account switches restore their own snapshots; no quantities or
      // previous-account purchase ledgers are silently summed together.
      const claimGuest = previous === 'guest' && next !== 'guest' && marker.localAccountSeen !== true && !marker.guestClaimedBy && !receiptOwner.actorId && !Object.keys(destination).length && store().getItem(archiveKey('guest')) === null && !hasAccountHistory;
      const values = claimGuest ? saved : destination.values || {};
      const nextEssentials = claimGuest ? savedEssentials : clone(destination.essentials || []);
      const archived = {version: 1, actorId: previous, values: saved, essentials: savedEssentials};
      if (claimGuest) {
        archived.claimedBy = next;archived.claimedValues = saved;archived.claimedEssentials = savedEssentials;
        archived.values = Object.fromEntries(ACTIVE_KEYS.map(key => [key, null]));archived.essentials = [];
      }
      const changes = {[archiveKey(previous)]: archived, [KEYS.actor]: {version: 1, actorId: next, localAccountSeen: marker.localAccountSeen === true || previous !== 'guest' || next !== 'guest', ...(claimGuest ? {guestClaimedBy: next} : marker.guestClaimedBy ? {guestClaimedBy: marker.guestClaimedBy} : {})}};
      if (claimGuest && isObject(home.byActor?.guest)) {
        archived.claimedHome = clone(home.byActor.guest);
        home.byActor[next] = claimGuestMetadata(home.byActor.guest, next);delete home.byActor.guest;changes[HOME_KEY] = home;
      }
      for (const key of ACTIVE_KEYS) {const value = values[key] === null || values[key] === undefined ? null : JSON.parse(values[key]);changes[key] = claimGuest ? claimGuestMetadata(value, next) : value;}
      if (options.setEssentials && options.setEssentials(nextEssentials) === false) throw Error('receipt_host_essentials_switch_failed');
      try {writeAtomic(changes);} catch (error) {try {options.setEssentials?.(savedEssentials);} catch {} throw error;}
      observedActor = next;
      availability = {available: false, premium: false}; lastChecked = 0; checkedActor = null; statusPromise = null;generation++;
      const handled = options.onActorChanged?.({previous, actor: next, guestClaimed: claimGuest}) === true;
      if (!handled) options.onProjection?.({actorChanged: true});
      return true;
    }
    function isolate() {
      if (blocked()) return false;
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
      if (isolationError || hasPendingConfirmation() || purchaseNeedsReview()) return true;
      const cached = projection(); if (!cached) return false;
      if (hasCookReview(cached)) return true;
      if (!availability.available && hasLocalReview(cached)) return false;
      if (issue?.includes('pantry_merge_required') || issue === 'receipt_household_scope_changed' || issue === 'receipt_refresh_required') return true;
      return cached.pantryReview?.required === true;
    }
    function hasCookReview(cached = projection()) {
      if (!cached?.scope) return false;
      try {
        const marker = read(KEYS.confirmed).receiptCookReview;
        return marker?.required === true && marker.actorId === actor() && marker.scope === cached.scope.kind + ':' + cached.scope.id;
      } catch { return true; }
    }
    function clearCookReview() {
      const confirmed = read(KEYS.confirmed);
      if (!Object.hasOwn(confirmed, 'receiptCookReview')) return;
      delete confirmed.receiptCookReview;writeAtomic({[KEYS.confirmed]: confirmed});
    }
    // Purchases become physically owned in the local shop transaction. Keep its
    // absolute pantry and the last verified server baseline together until CAS
    // acknowledges them. This is actor-scoped metadata, never a second ledger.
    function purchaseSyncKey(id = actor()) {return 'basketboss_purchase_pantry_sync_v1:' + encodeURIComponent(id);}
    function purchaseStock(value) {
      if (!isObject(value) || Object.keys(value).length > 2000) throw Error('invalid_purchase_pantry_stock');
      const result = {};
      for (const key of Object.keys(value).sort()) {
        const amount = value[key];
        if (!key || key.length > 240 || ['__proto__', 'prototype', 'constructor'].includes(key) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1000000) throw Error('invalid_purchase_pantry_stock');
        if (amount > 0) result[key] = amount;
      }
      return result;
    }
    const samePurchaseStock = (a, b) => JSON.stringify(purchaseStock(a)) === JSON.stringify(purchaseStock(b));
    const samePurchaseScope = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;
    function purchasedPantrySnapshot() {
      if (actor() === 'guest') return {raw: null, row: null};
      const raw = store().getItem(purchaseSyncKey());
      if (raw === null) return {raw, row: null};
      const row = JSON.parse(raw);
      // The app's existing multi-key journal serializes deletion proposals as
      // JSON null. Both representations mean this metadata has no pending job.
      if (row === null) return {raw, row: null};
      if (!isObject(row)) throw Error('invalid_purchase_pantry_sync');
      if (!Object.keys(row).length) return {raw, row: null};
      if (row.version !== 1 || row.actorId !== actor() || !['user', 'household'].includes(row.scope?.kind) || typeof row.scope.id !== 'string' || row.scope.kind === 'user' && row.scope.id !== actor() || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0) throw Error('invalid_purchase_pantry_sync');
      purchaseStock(row.stock);purchaseStock(row.baselineStock);
      if (row.attempt) {
        if (!Number.isSafeInteger(row.attempt.expectedRevision) || row.attempt.expectedRevision < 0) throw Error('invalid_purchase_pantry_sync');
        purchaseStock(row.attempt.stock);
      }
      return {raw, row};
    }
    function purchasedPantry() {return purchasedPantrySnapshot().row;}
    function purchaseNeedsReview() {
      try {const pending = purchasedPantry();return pending?.needsReview === true && (pending.remoteConflict === true || availability.available);}
      catch {return true;}
    }
    function clearPurchasedPantry(expected) {
      const key = purchaseSyncKey();
      if (store().getItem(key) === expected) writeAtomic({[key]: null}, {[key]: expected});
    }
    function preparePurchasedPantry({stock, beforeStock, shopSessionId} = {}) {
      if (blocked() || isolationError) throw Error('purchase_pantry_sync_paused');
      const target = purchaseStock(stock), baseline = purchaseStock(beforeStock), id = actor();
      if (id === 'guest') return {updates: {}, expected: {}, queued: false, localOnly: true};
      const key = purchaseSyncKey(), {raw, row: pending} = purchasedPantrySnapshot(), ownerRaw = store().getItem(KEYS.owner), markerRaw = store().getItem(KEYS.actor), owner = ownerRaw === null ? {} : JSON.parse(ownerRaw), marker = markerRaw === null ? {} : JSON.parse(markerRaw), active = context();
      if (!isObject(owner) || !isObject(marker) || owner.actorId && owner.actorId !== id || marker.actorId !== id) throw Error('purchase_pantry_account_changed');
      // An unowned/Free pantry has no verified online balance to replace.
      if (!pending && (!owner.actorId || !owner.scope || !Number.isSafeInteger(owner.inventoryRevision))) return {updates: {}, expected: {}, queued: false, localOnly: true};
      let next;
      if (pending) {
        next = {...pending, stock: target, shopSessionId: shopSessionId ?? active.shopSessionId ?? null};
        if (!samePurchaseStock(baseline, pending.stock) && !samePurchaseStock(target, pending.stock) || !samePurchaseScope(pending.scope, owner.scope) || pending.market !== active.market || pending.retailer !== (active.retailer || null)) next.needsReview = true;
      } else {
        next = {version: 1, actorId: id, scope: clone(owner.scope), market: active.market, retailer: active.retailer || null, expectedRevision: owner.inventoryRevision, baselineStock: purchaseStock(owner.serverStock || {}), stock: target, shopSessionId: shopSessionId ?? active.shopSessionId ?? null, queuedAt: clock()};
        if (!samePurchaseStock(baseline, next.baselineStock) || issue?.includes('pantry_merge_required') || issue === 'receipt_household_scope_changed') next.needsReview = true;
      }
      if (!next.attempt && !next.needsReview && samePurchaseStock(next.stock, next.baselineStock)) return {updates: {[key]: null}, expected: {[key]: raw, [KEYS.owner]: ownerRaw, [KEYS.actor]: markerRaw}, queued: false, localOnly: false};
      return {updates: {[key]: next}, expected: {[key]: raw, [KEYS.owner]: ownerRaw, [KEYS.actor]: markerRaw}, queued: true, localOnly: false, needsReview: next.needsReview === true};
    }
    async function confirmPurchasedPantry(value = {}) {
      let prepared;
      try {
        prepared = preparePurchasedPantry(value);
        writeAtomic(prepared.updates, prepared.expected);
      } catch (error) {return {ok: false, queued: false, needsReview: true, code: error.message};}
      if (!prepared.queued) return {ok: true, localOnly: prepared.localOnly, queued: false, needsReview: false};
      return retryPurchasedPantry();
    }
    async function retryPurchasedPantry() {
      if (purchaseSyncPromise) return purchaseSyncPromise;
      const pin = tripPin();
      const current = () => sameTripPin(pin);
      const run = async () => {
        if (!current() || isolationError) return {ok: false, queued: true, needsReview: true};
        let queued;
        try {queued = purchasedPantry();} catch {return {ok: false, queued: true, needsReview: true};}
        if (!queued) return {ok: true, queued: false, localOnly: true, needsReview: false};
        if (queued.remoteConflict) return {ok: false, queued: true, needsReview: true, conflict: true};
        if (reviewing || confirmingCurrent || choosingTrip || hasPendingConfirmation()) return {ok: false, queued: true, needsReview: false, pending: true};
        // A reconnect may arrive inside the unavailable-status cache window.
        // An explicit queued retry must check that state again immediately.
        await refreshAvailability({synchronize: false, force: availability.available === false});
        if (!current()) return {ok: false, queued: true, needsReview: true};
        if (!availability.available) return {ok: true, queued: true, localOnly: true, needsReview: false};
        if (queued.needsReview) return {ok: false, queued: true, needsReview: true, conflict: false};
        const markReview = () => {
          if (current()) {
            const latest = purchasedPantrySnapshot();
            if (latest.row) writeAtomic({[purchaseSyncKey()]: {...latest.row, needsReview: true, remoteConflict: true}}, {[purchaseSyncKey()]: latest.raw});
            issue = 'receipt_local_remote_pantry_merge_required';schedule();
          }
          return {ok: false, queued: true, needsReview: true, conflict: true};
        };
        const reconcile = async () => {
          // An interrupted request may already have committed. Only balances
          // recorded before that request can prove a safe retry revision.
          const remote = await fetchInventory();
          if (!current()) return false;
          const latest = purchasedPantrySnapshot();queued = latest.row;
          if (!queued || !samePurchaseScope(remote.scope, queued.scope) || remote.inventoryRevision < queued.expectedRevision || !samePurchaseStock(remote.stock, queued.baselineStock) && !samePurchaseStock(remote.stock, queued.attempt?.stock || queued.stock)) return false;
          writeAtomic({[purchaseSyncKey()]: {...queued, expectedRevision: remote.inventoryRevision, baselineStock: purchaseStock(remote.stock), attempt: null}}, {[purchaseSyncKey()]: latest.raw});
          return true;
        };
        confirmingCurrent = true;
        try {
          if (queued.market !== context().market || queued.retailer !== (context().retailer || null) || !samePurchaseScope(queued.scope, projection()?.scope) || !samePurchaseStock(queued.stock, options.getStock?.() || read(KEYS.stock))) return markReview();
          if (queued.attempt && !await reconcile()) return current() ? markReview() : {ok: false, queued: true, needsReview: true};
          for (let conflicts = 0; conflicts < 4;) {
            if (!current()) return {ok: false, queued: true, needsReview: true};
            const beforeAttempt = purchasedPantrySnapshot();queued = beforeAttempt.row;
            if (!queued) return {ok: true, queued: false, needsReview: false};
            if (queued.needsReview || !samePurchaseStock(queued.stock, options.getStock?.() || read(KEYS.stock))) return markReview();
            if (hasPendingConfirmation()) return {ok: false, queued: true, pending: true, needsReview: false};
            const attempt = {stock: clone(queued.stock), expectedRevision: queued.expectedRevision};
            writeAtomic({[purchaseSyncKey()]: {...queued, attempt}}, {[purchaseSyncKey()]: beforeAttempt.raw});
            let result;
            try {result = await adapter().confirmPantry({stock: clone(attempt.stock), expectedRevision: attempt.expectedRevision, expectedScope: clone(queued.scope), shopSessionId: queued.shopSessionId});}
            catch (error) {
              if (!current()) return {ok: false, queued: true, needsReview: true};
              if (error.status === 409) {conflicts++;if (await reconcile()) continue;return markReview();}
              return {ok: false, queued: true, needsReview: false, retryable: true};
            }
            if (!current()) return {ok: false, queued: true, committed: result.committed === true, needsReview: true};
            if (!result.localApplied) return {ok: false, queued: true, committed: result.committed === true, needsReview: false, retryable: true};
            conflicts = 0;
            const latest = purchasedPantrySnapshot(), saved = projection();
            if (!latest.row || !samePurchaseScope(latest.row.scope, saved?.scope) || !Number.isSafeInteger(saved.inventoryRevision) || !samePurchaseStock(saved.serverStock || {}, attempt.stock)) return markReview();
            if (samePurchaseStock(latest.row.stock, attempt.stock)) {
              writeAtomic({[purchaseSyncKey()]: null}, {[purchaseSyncKey()]: latest.raw});issue = null;notifyProjection(result.projection);schedule();return {...result, queued: false, localOnly: false, needsReview: false};
            }
            writeAtomic({[purchaseSyncKey()]: {...latest.row, expectedRevision: saved.inventoryRevision, baselineStock: clone(attempt.stock), attempt: null}}, {[purchaseSyncKey()]: latest.raw});
          }
          return {ok: true, queued: true, needsReview: false};
        } catch {return {ok: false, queued: true, needsReview: false, retryable: true};}
        finally {confirmingCurrent = false;schedule();}
      };
      const locks = options.locks || root.navigator?.locks;
      purchaseSyncPromise = (async () => {try {return await (locks?.request ? locks.request('basketboss-purchase-pantry-sync:' + pin.actorId, {mode: 'exclusive'}, run) : run());} finally {purchaseSyncPromise = null;}})();
      return purchaseSyncPromise;
    }
    function getConsumptionStatus() {
      const review = (reason, message, canReviewInline = false) => {
        const permitted = canReviewInline && actor() !== 'guest' && !!session()?.access_token;
        return {ready: false, reason, message: canReviewInline && !permitted ? message + ' Sign in to review your saved pantry.' : message, canReviewInline: permitted};
      };
      if (blocked()) return review('account_deletion', 'Finish the pending account review before confirming ingredients used.');
      if (isolationError) return review('account_isolation', isolationError);
      if (hasPendingConfirmation()) return review('receipt_pending', 'A receipt confirmation needs checking before ingredients can be deducted. Check its receipt status before confirming ingredients, so the same purchase is not added twice.');
      if (reviewing) return review('review_open', 'Finish or close the open pantry review, then check these ingredients again.');
      if (confirmingCurrent) return review('confirmation_pending', 'Your pantry confirmation is still saving. Check these ingredients again when it finishes.');
      if (choosingTrip) return review('trip_choice_open', 'Finish or close the receipt shopping-trip choice before confirming ingredients used.');
      if (purchaseNeedsReview()) return review('pantry_merge', 'Your saved online pantry and this device need checking. Review the amounts to keep before confirming ingredients used.', true);
      if (issue?.includes('pantry_merge_required')) return review('pantry_merge', 'Your saved online pantry and this device need checking. Review the amounts to keep before confirming ingredients used.', true);
      if (issue === 'receipt_household_scope_changed') return review('scope_changed', 'Your shared pantry changed. Review the saved and device amounts before confirming ingredients used.', true);
      if (issue === 'receipt_refresh_required') return review('refresh_required', 'Your saved pantry needs checking before ingredients can be deducted. Review its current amounts here.', true);
      try {
        const cached = projection(), owner = read(KEYS.owner), marker = read(KEYS.actor);
        read(KEYS.confirmed);
        if (owner.actorId && owner.actorId !== actor() || marker.actorId && marker.actorId !== actor()) return review('account_mismatch', 'Your saved pantry belongs to a different account. Reopen BasketBoss with the intended account before confirming ingredients used.');
        if (cached?.scope?.kind === 'user' && cached.scope.id !== actor()) return review('account_mismatch', 'Your saved pantry belongs to a different account. Reopen BasketBoss with the intended account before confirming ingredients used.');
        // A confirmed receipt already supplies measured stock. Its routine next-
        // shop review must not prevent using that stock for a confirmed meal.
        if (availability.available && cached?.pantryReview?.required === true && cached.initialized !== true) return review('pantry_uninitialized', 'Confirm your starting pantry amounts before recording ingredients used. Review the saved and device amounts here.', true);
        return {ready: true, reason: null, message: '', canReviewInline: false};
      } catch { return review('storage_unreadable', 'Your saved pantry records could not be read safely. Reload BasketBoss and review device storage before confirming ingredients used.'); }
    }
    function canConsumePantry() {return getConsumptionStatus().ready;}
    function hasLocalReview(cached) {
      try {
        const ack = read(KEYS.confirmed).receiptLocalReview;
        return ack?.actorId === actor() && ack.inventoryRevision === cached.inventoryRevision && ack.scope === cached.scope?.kind + ':' + cached.scope?.id;
      } catch {return false;}
    }
    function confirmLocalPantryReview() {
      if (blocked()) return {ok: false, localOnly: true};
      if (availability.available || hasPendingConfirmation() || isolationError) return {ok: false, localOnly: true};
      const cached = projection();if (!cached) return {ok: true, localOnly: true};
      const confirmed = read(KEYS.confirmed), reviewedAt = Date.parse(confirmed.confirmedAt || '');
      if (confirmed.version !== 1 || !Array.isArray(confirmed.items) || !Number.isFinite(reviewedAt) || Math.abs(clock() - reviewedAt) > 60000) return {ok: false, localOnly: true};
      delete confirmed.receiptCookReview;
      writeAtomic({[KEYS.confirmed]: {...confirmed, receiptLocalReview: {actorId: actor(), shopSessionId: context().shopSessionId || null, inventoryRevision: cached.inventoryRevision, scope: cached.scope.kind + ':' + cached.scope.id, confirmedAt: confirmed.confirmedAt}}});
      schedule();return {ok: true, localOnly: true};
    }
    function allowLegacyTransfer() {
      if (blocked()) return false;
      if (!hasPendingConfirmation() && !isolationError && !reviewing && !confirmingCurrent) return true;
      notify('Recover the pending receipt before finishing this shop. No leftovers have been transferred.');
      return false;
    }
    function allowPurchaseTransfer() {
      if (blocked() || isolationError || hasPendingConfirmation() || reviewing || choosingTrip || purchaseNeedsReview()) return false;
      if (issue?.includes('pantry_merge_required') || issue === 'receipt_household_scope_changed' || issue === 'receipt_refresh_required') return false;
      // Local purchases can join the durable queue while its earlier CAS is in
      // flight. A user-entered pantry confirmation still owns its whole form.
      return !confirmingCurrent || purchaseSyncPromise !== null;
    }
    function handlesInventorySync() { return projection()?.scope?.kind === 'household'; }
    function coversLegacyCredit(receipt) {
      const cached = projection();
      return !!cached && !requiresPantryReview() && receipt?.receiptPantryConfirmedActor === actor() && receipt.receiptPantryConfirmedScope === cached.scope?.kind + ':' + cached.scope?.id && Number.isSafeInteger(receipt.receiptPantryConfirmedRevision) && receipt.receiptPantryConfirmedRevision <= cached.inventoryRevision && receipt.receiptPantryConfirmedShopSessionId === (context().shopSessionId || null);
    }
    async function fetchInventory(signal) {
      if (blocked()) throw Error('Account deletion is in progress.');
      const serial = generation;
      const current = session(), id = actor(), token = current?.access_token;
      if (id === 'guest' || !token) throw Error('Sign in to review your saved pantry.');
      const perform = options.fetch || root.fetch?.bind(root);
      const response = await perform('/api/receipt-inventory', {headers: {Accept: 'application/json', Authorization: 'Bearer ' + token}, credentials: 'same-origin', redirect: 'manual', cache: 'no-store', signal});
      const data = await response.json().catch(() => null);
      if (blocked() || serial !== generation || id !== actor() || token !== session()?.access_token) throw Error('Account changed. Reopen Pantry review.');
      if (!response.ok || data?.ok !== true) throw Error('The saved pantry is unavailable. Your quantities have not changed.');
      if (!isObject(data.stock) || !['user', 'household'].includes(data.scope?.kind) || typeof data.scope.id !== 'string' || data.scope.kind === 'user' && data.scope.id !== id || !Number.isSafeInteger(data.inventoryRevision) || data.inventoryRevision < 0 || typeof data.initialized !== 'boolean') throw Error('The saved pantry could not be verified.');
      return data;
    }
    async function refreshAvailability({force = false, synchronize = true} = {}) {
      if (blocked()) return {available: false, premium: false};
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
          if (blocked() || serial !== generation || id !== actor() || token !== session()?.access_token) return {available: false};
          availability = {available: response.ok && data?.available === true, premium: response.ok && data?.premium === true, configured: data?.configured === true};
          checkedActor = id; lastChecked = clock();
          if (availability.available && synchronize) {
            adapter()?.recoverLocalTransaction?.();
            const result = await adapter().synchronize();
            if (blocked() || serial !== generation || id !== actor()) return {available: false};
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
        pantryPolicy:options.pantryPolicy===true,
        getFinishShopCredits: options.getFinishShopCredits, getArchivedShop:options.getArchivedShop,getPurchaseCosts:options.getPurchaseCosts,receiptSaveKeys: options.receiptSaveKeys, prepareReceiptSave: options.prepareReceiptSave,
        onProjection: value => {if (blocked()) return;issue = null; notifyProjection(value); schedule();}});
      scanner()?.configure?.({getSession: session, getContext: context, getShoppingItems: options.getShoppingItems, getKitchen:options.getKitchen, pantryPolicy:options.pantryPolicy===true, inventory: adapter()});
    }
    function tripPin() {
      const active = context(), scope = projection()?.scope;
      return {actorId: actor(), token: session()?.access_token, market: active.market, retailer: active.retailer || null, shopSessionId: active.shopSessionId || null, scope: scope ? scope.kind + ':' + scope.id : null, generation};
    }
    function sameTripPin(pin) {
      const active = tripPin();
      return !blocked() && ['actorId', 'token', 'market', 'retailer', 'shopSessionId', 'scope', 'generation'].every(key => active[key] === pin[key]);
    }
    function chooseReceiptTrip(captured, trips) {
      const document = doc();if (!document) {notify('Reopen receipt scanning to choose the recorded shopping trip.');return Promise.resolve(null);}
      const pin = tripPin();choosingTrip = true;
      return new Promise(resolve => {
        const dialog = element('dialog', undefined, 'bb-receipt-pantry-dialog');dialog.id = 'bbReceiptTripChoice';activeDialog = dialog;
        dialog.setAttribute('aria-labelledby', 'bbReceiptTripTitle');
        const title = element('h2', 'Which shopping trip?');title.id = 'bbReceiptTripTitle';
        const help = element('p', 'Choose the trip shown on this receipt. Purchases already added to At home are linked so they are not added twice.');
        const form = element('form'), label = element('label', 'Receipt for'), select = element('select');select.dataset.bbReceiptTrip = 'select';select.required = true;select.setAttribute('aria-label', 'Shopping trip on this receipt');
        select.style.cssText = 'display:block;box-sizing:border-box;width:100%;max-width:100%;min-height:44px;margin:8px 0 12px;padding:10px;border:1px solid #b6cdbf;border-radius:10px;background:#fff;color:#214e36;font:16px/1.4 system-ui';
        const add = (value, text) => {const option = element('option', text);option.value = value;select.append(option);};
        add('', 'Choose a trip');if (validTripId(captured.shopSessionId)) add('current', 'Current shopping trip');
        for (const trip of trips) {
          let date = 'date not available';if (trip.at) {try {date = new Date(trip.at).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});} catch {}}
          add('recorded:' + trip.id, (!trip.linkable ? 'Stock review needed' : trip.covered ? 'Receipt already recorded' : 'Finished shop') + ' · ' + date);
        }
        add('unrecorded', 'Another purchase not recorded in Shop');select.value = '';label.append(select);
        const message = element('p');message.setAttribute('role', 'status');message.setAttribute('aria-live', 'polite');
        const actions = element('div', undefined, 'bb-receipt-host-actions'), proceed = element('button', 'Continue to receipt'), cancel = element('button', 'Cancel');
        proceed.type = 'submit';proceed.disabled = true;proceed.dataset.bbReceiptTrip = 'continue';cancel.type = 'button';cancel.dataset.bbReceiptTrip = 'cancel';actions.append(proceed, cancel);
        let finished = false;
        const finish = value => {if (finished) return;finished = true;choosingTrip = false;if (activeDialog === dialog) activeDialog = null;if (dialog.open) dialog.close?.();dialog.remove();resolve(value);};
        const selected = () => trips.find(trip => 'recorded:' + trip.id === select.value);
        select.addEventListener('change', () => {const trip = selected();message.textContent = trip && !trip.linkable ? 'This older stock record needs review before receipt food can be added safely. Review At home or use receipt price learning only.' : trip?.covered ? 'A receipt has already been recorded for this trip. Review it in receipt history instead of adding the same purchase again.' : '';proceed.disabled = !select.value || !!trip?.covered || trip?.linkable === false;});
        cancel.onclick = () => finish(null);dialog.addEventListener('close', () => finish(null));dialog.addEventListener('cancel', event => {event.preventDefault();finish(null);});
        form.addEventListener('submit', event => {
          event.preventDefault();if (finished) return;
          if (!sameTripPin(pin)) {notify('Your account or shopping context changed. Reopen receipt scanning.');finish(null);return;}
          if (select.value === 'current' && validTripId(captured.shopSessionId)) {finish({shopSessionId: captured.shopSessionId, shopSessionConfirmed: true});return;}
          if (select.value === 'unrecorded') {finish({shopSessionId: null, shopSessionConfirmed: false});return;}
          const trip = selected(), latest = recordedTrips(options.getFinishShopCredits?.() || read(KEYS.ledger), captured).find(row => row.id === trip?.id);
          if (!trip || !latest || latest.covered || !latest.linkable) {message.textContent = 'This recorded trip changed. Close and reopen receipt scanning to review it.';proceed.disabled = true;return;}
          finish({shopSessionId: trip.id, shopSessionConfirmed: true});
        });
        form.append(label, message, actions);dialog.append(title, help, form);document.body.append(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();else dialog.setAttribute('open', '');select.focus?.();
      });
    }
    async function open(value = {}) {
      if (blocked()) return null;
      const serial = generation;
      isolate(); if (isolationError) {notify(isolationError); return null;}
      if (reviewing || confirmingCurrent || choosingTrip) {notify('Finish or close your receipt or Pantry review before scanning another receipt.');return null;}
      const openingActor = actor(), openingToken = session()?.access_token;
      await refreshAvailability({synchronize: false});
      if (blocked() || serial !== generation || actor() !== openingActor || session()?.access_token !== openingToken || choosingTrip) return null;
      if (!(availability.premium || options.isPremium?.())) {options.openUpgrade?.(); return null;}
      if (!availability.available) return options.openLegacy?.(value);
      if (hasPendingConfirmation()) {await recoverReceipt(); return null;}
      const captured = {...context()};
      if(!captured.retailer){notify('Choose your supermarket in Shop or region settings before scanning a receipt.');return null;}
      const explicitTrip = Object.hasOwn(value, 'shopSessionId') && value.shopSessionId !== undefined;
      if (explicitTrip && value.shopSessionId !== null && !validTripId(value.shopSessionId)) {notify('The shopping trip could not be verified. Reopen receipt scanning.');return null;}
      let trip = {shopSessionId: captured.shopSessionId || null, shopSessionConfirmed: false};
      if (explicitTrip) {
        let previous;try {previous = recordedTrips(options.getFinishShopCredits?.() || read(KEYS.ledger), {...captured, shopSessionId: null}).find(row => row.id === value.shopSessionId);} catch {notify('Your recorded shopping trips need review before scanning this receipt.');return null;}
        if (previous && !previous.linkable) {notify('This older stock record needs review before receipt food can be added safely. Review At home or use receipt price learning only.');return null;}
        if (previous?.covered) {notify('A receipt has already been recorded for this trip. Review it in receipt history instead of adding the same purchase again.');return null;}
        trip = {shopSessionId: value.shopSessionId, shopSessionConfirmed: value.shopSessionId !== null};
      } else {
        let trips;try {trips = recordedTrips(options.getFinishShopCredits?.() || read(KEYS.ledger), captured);} catch {notify('Your recorded shopping trips need review before scanning this receipt.');return null;}
        if (trips.length) {trip = await chooseReceiptTrip(captured, trips);if (!trip || blocked() || serial !== generation || actor() !== openingActor || session()?.access_token !== openingToken) return null;}
      }
      return scanner()?.open?.({...captured, ...value, ...trip, onSaved: result => {if (blocked() || serial !== generation) return;notifyProjection(result?.projection || {}); value.onSaved?.(result); schedule();}});
    }
    async function recoverReceipt({retry = false} = {}) {
      if (blocked()) return {ok: false};
      const serial = generation;
      try {
        adapter()?.recoverLocalTransaction?.();
        const result = await (retry ? adapter().retryPendingConfirmation() : adapter().synchronize());
        if (blocked() || serial !== generation) return {ok: false};
        issue = result.localApplied === false ? result.localError || 'receipt_refresh_required' : null;
        notify(result.localApplied ? 'Receipt recovered. Review your pantry before the next shop.' : 'Receipt recovery is still pending. Keep this receipt and try again.');
        afterRender(); return result;
      } catch {issue = 'Receipt recovery could not complete. Its original confirmation is retained for retry.'; afterRender(); return {ok: false};}
    }
    async function saveLegacyReceipt(packet) {
      if (blocked()) throw Error('account_deletion_in_progress');
      isolate();
      if (isolationError || hasPendingConfirmation() || reviewing || confirmingCurrent) throw Error('receipt_refresh_required');
      if (issue?.includes('pantry_merge_required') || issue === 'receipt_household_scope_changed' || issue === 'receipt_refresh_required') throw Error('receipt_refresh_required');
      if (!options.prepareReceiptSave) throw Error('receipt_app_transaction_unavailable');
      const result = await adapter().commitLocalReceipt(packet);
      afterRender();return result;
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
    async function confirmCurrentPantry({stock, preserveCookReview = false} = {}) {
      if (blocked()) return {ok: false, needsReview: true};
      const serial = generation;
      isolate();if (isolationError || hasPendingConfirmation() || reviewing || confirmingCurrent || choosingTrip) return {ok: false, needsReview: true};
      await refreshAvailability({synchronize: false});
      if (blocked() || serial !== generation) return {ok: false, needsReview: true};
      // Cooking has already committed its measured local deduction. It is not
      // an explicit weekly review and must not acknowledge that review offline.
      if (!availability.available) return preserveCookReview ? {ok: true, localOnly: true, needsReview: false} : confirmLocalPantryReview();
      const cached = projection();
      if (!cached?.scope || !Number.isSafeInteger(cached.inventoryRevision) || issue?.includes('pantry_merge_required') || issue === 'receipt_household_scope_changed') return {ok: false, needsReview: true};
      const id = actor(), active = context(), ledger = read(KEYS.ledger), purchaseAtReview = store().getItem(purchaseSyncKey());
      confirmingCurrent = true;
      try {
        const result = await adapter().confirmPantry({stock: clone(stock), expectedRevision: cached.inventoryRevision, expectedScope: clone(cached.scope), shopSessionId: active.shopSessionId || null});
        if (blocked() || serial !== generation || id !== actor()) return {ok: false, committed: result.committed === true, needsReview: true};
        if (!result.localApplied) {issue = 'receipt_refresh_required';return {...result, needsReview: true};}
        recordLegacyCoverage(ledger, active, id);
        if (!preserveCookReview) {clearCookReview();clearPurchasedPantry(purchaseAtReview);}
        issue = null;notifyProjection(result.projection);schedule();return {...result, needsReview: false, localOnly: false};
      } catch (error) {issue = error.status === 409 ? 'receipt_local_remote_pantry_merge_required' : 'receipt_refresh_required';schedule();return {ok: false, needsReview: true, conflict: error.status === 409,...(error.message==='inventory_ambiguous_package_sources'?{code:error.message}:{})};}
      finally {confirmingCurrent = false;}
    }
    async function confirmCookedPantry({stock} = {}) {
      if (!canConsumePantry()) return {ok: false, needsReview: true};
      const cached = projection(), keepReview = !!cached && requiresPantryReview();
      if (keepReview) {
        // Persist before the server call: a successful stock sync clears its
        // review flag, but cannot replace the user's next-shop pantry review.
        const confirmed = read(KEYS.confirmed);
        writeAtomic({[KEYS.confirmed]: {...confirmed, receiptCookReview: {
          required: true, actorId: actor(), scope: cached.scope.kind + ':' + cached.scope.id
        }}});
      }
      const pendingPurchase = purchasedPantry();
      // A confirmed meal or undo can change an already synchronized pantry
      // without any new purchase. Reuse its verified CAS baseline so closing
      // offline cannot leave that deduction outside the durable retry queue.
      const owner = read(KEYS.owner);
      const verifiedBaseline = !pendingPurchase && cached?.initialized === true && owner.actorId === actor() &&
        samePurchaseScope(owner.scope, cached.scope) && owner.inventoryRevision === cached.inventoryRevision && isObject(owner.serverStock)
        ? purchaseStock(owner.serverStock) : null;
      const result = pendingPurchase || verifiedBaseline
        ? await confirmPurchasedPantry({stock, beforeStock: pendingPurchase?.stock || verifiedBaseline, shopSessionId: pendingPurchase?.shopSessionId})
        : await confirmCurrentPantry({stock, preserveCookReview: true});
      return {...result, weeklyReviewRequired: !!projection() && requiresPantryReview()};
    }
    async function reviewPantry({container, onConfirmed, onCancel, deferProjection = false} = {}) {
      if (blocked()) return null;
      if (reviewing || choosingTrip) return null; isolate(); if (isolationError) {notify(isolationError);return null;}
      if (hasPendingConfirmation()) {await recoverReceipt();return null;}
      const serial = generation, priorProjection = projection(), trustedBeforeReview = getConsumptionStatus().ready;
      reviewing = true;
      const inline = !!container, hold = inline && deferProjection ? holdProjection() : null;
      const id = actor(), token = session()?.access_token, currentContext = {...context()};
      const current = () => !blocked() && serial === generation && id === actor() && token === session()?.access_token && currentContext.market === context().market && currentContext.retailer === context().retailer;
      let data;
      try {data = await fetchInventory();} catch (error) {if (serial === generation) reviewing = false;releaseProjection(hold, current());if (current()) notify(error.message);return null;}
      if (!current() || inline && container.isConnected === false) {if (serial === generation) reviewing = false;releaseProjection(hold, false);return null;}
      let local, ledgerAtReview, oldOwner, purchaseAtReview;
      try {local = clone(options.getStock?.() || read(KEYS.stock));ledgerAtReview = read(KEYS.ledger);oldOwner = read(KEYS.owner);purchaseAtReview = store().getItem(purchaseSyncKey());}
      catch {reviewing = false;releaseProjection(hold, true);notify('Your saved pantry records could not be read safely. Reload BasketBoss before reviewing these amounts.');return null;}
      const document = doc(); if (!document) {reviewing = false;releaseProjection(hold, true);return {data, local};}
      const dialog = element(inline ? 'section' : 'dialog', undefined, 'bb-receipt-pantry-dialog' + (inline ? ' bb-receipt-pantry-inline' : ''));
      if (!inline) activeDialog = dialog;
      dialog.setAttribute('aria-labelledby', inline ? 'bbReceiptPantryInlineTitle' : 'bbReceiptPantryTitle');
      const heading = element(inline ? 'h3' : 'h2', inline ? 'Review pantry amounts' : 'Confirm Your Pantry');heading.id = inline ? 'bbReceiptPantryInlineTitle' : 'bbReceiptPantryTitle';
      const explanation = element('p', 'Check what is still in stock. Confirmed amounts will reduce your next shopping list.');
      const scopeChanged = !!oldOwner.scope && (oldOwner.scope.kind !== data.scope.kind || oldOwner.scope.id !== data.scope.id);
      let equalStock = false;try {equalStock = samePurchaseStock(local, data.stock);} catch {}
      const trustedLocal = trustedBeforeReview && priorProjection?.initialized === true && oldOwner.actorId === id && samePurchaseScope(oldOwner.scope, data.scope) && samePurchaseScope(priorProjection.scope, data.scope) && priorProjection.inventoryRevision === data.inventoryRevision;
      const initialStock = equalStock || trustedLocal || !data.initialized ? local : data.stock;
      if (!equalStock && (scopeChanged || data.initialized)) explanation.textContent = 'Some saved amounts differ. Check the amount to keep for each food, then confirm. Amounts are never added together.';
      const shownNumber = (value, unit) => Number.isFinite(Number(value)) && Number(value) >= 0 ? new Intl.NumberFormat('en-GB', {maximumFractionDigits: ['g', 'ml'].includes(unit) ? 0 : 1, useGrouping: false}).format(Number(value)) : '';
      const shownAmount = (value, unit) => {
        const amount = Number(value);if (!Number.isFinite(amount) || amount < 0) return 'Check amount';
        const formatter = root.BBShopPurchaseUI?.formatDisplayQty || root.formatDisplayQty;
        if (typeof formatter === 'function') {const shown = formatter(amount, unit, {countMode: 'balance', compact: false});if (!/^Check\b/.test(shown)) return shown;}
        if (amount > 0 && amount < (['g', 'ml'].includes(unit) ? 1 : .1)) return (['g', 'ml'].includes(unit) ? '<1 ' : '<0.1 ') + unit;
        return shownNumber(amount, unit) + ' ' + unit;
      };
      const form = element('form'), rows = element('div', undefined, 'bb-receipt-pantry-rows'), message = element('p');message.setAttribute('role', 'status');message.setAttribute('aria-live', 'polite');
      const inputs = new Map(), originalAmounts = new Map(), allKeys = [...new Set([...Object.keys(local), ...Object.keys(data.stock)])].sort();
      for (const key of allKeys) {
        const split = key.lastIndexOf('|'); if (split < 1 || key.length > 180) continue;
        const unit = key.slice(split + 1), label = element('label', undefined, 'bb-receipt-pantry-row'), title = element('strong', key.slice(0, split));
        const localAmount = local[key] || 0, savedAmount = data.stock[key] || 0;
        const detail = element('small', Number(localAmount) === Number(savedAmount) ? 'At home: ' + shownAmount(initialStock[key] || 0, unit) : 'At home: ' + shownAmount(localAmount, unit) + ' · Saved: ' + shownAmount(savedAmount, unit));
        const input = element('input');input.type = 'number';input.min = '0';input.max = '1000000';input.step = 'any';input.value = shownNumber(initialStock[key] || 0, unit);input.setAttribute('aria-label', key.slice(0, split) + ' amount in ' + unit);input.dataset.stockKey = key;
        const original = {quantity: Number(initialStock[key] || 0), shown: input.value, edited: false};originalAmounts.set(key, original);
        input.addEventListener('input', () => {original.edited = true;});
        label.append(title, detail, input, element('span', unit));rows.append(label);inputs.set(key, input);
      }
      if (!inputs.size) rows.append(element('p', 'No measured foods are saved. Confirm an empty pantry to continue.'));
      const buttons = element('div', undefined, 'bb-receipt-host-actions'), confirm = element('button', 'Confirm pantry & update shopping'), cancel = element('button', 'Review later');confirm.type = 'submit';cancel.type = 'button';buttons.append(confirm, cancel);
      form.append(rows, message, buttons);dialog.append(heading, explanation, form);
      let busy = false, disposed = false, removed = false, settled = false;
      const closeForm = () => {
        if (removed) return;removed = true;
        if (activePantryReview === controller) {activePantryReview = null;reviewing = false;}
        if (activeDialog === dialog) activeDialog = null;
        if (!inline) dialog.close?.();dialog.remove();
      };
      const controller = {element: dialog, dispose({refresh = true} = {}) {
        if (disposed) return;disposed = true;closeForm();inlineReviews.delete(controller);releaseProjection(hold, refresh);
      }};
      activePantryReview = controller;if (inline) inlineReviews.add(controller);
      (inline ? container : document.body).append(dialog);
      const cancelReview = () => {
        if (busy || disposed || settled) return;settled = true;
        if (inline) closeForm();else controller.dispose();
        if (current()) onCancel?.();
      };
      cancel.onclick = cancelReview;
      if (!inline) {
        dialog.addEventListener('cancel', event => {if (busy) event.preventDefault();else {event.preventDefault();cancelReview();}});
        dialog.addEventListener('close', () => controller.dispose());
      }
      form.addEventListener('submit', async event => {
        event.preventDefault();if (busy || disposed || settled) return;
        if (!current()) {message.textContent = 'Your account or shopping region changed. Reopen this review.';return;}
        const stock = {};
        for (const [key, input] of inputs) {
          const original = originalAmounts.get(key), value = original && !original.edited && input.value === original.shown ? original.quantity : Number(input.value);
          if (input.value.trim() === '' || !Number.isFinite(value) || value < 0 || value > 1000000) {message.textContent = 'Check the amount for ' + key.slice(0, key.lastIndexOf('|')) + '.';input.focus();return;}
          if (value > 0) stock[key] = value;
        }
        busy = true;confirm.disabled = cancel.disabled = true;message.textContent = 'Saving your confirmed pantry…';
        try {
          // The adapter adopts the verified scope only after reviewed CAS
          // success, preserving the previous owner/cache on conflict or failure.
          const result = await adapter().confirmPantry({stock, expectedRevision: data.inventoryRevision, expectedScope: clone(data.scope), shopSessionId: currentContext.shopSessionId || null});
          if (disposed || !current()) return;
          if (!result.localApplied) {message.textContent = 'Pantry saved online. Refresh it before shopping on this device.';issue = 'receipt_refresh_required';return;}
          clearCookReview();
          clearPurchasedPantry(purchaseAtReview);
          recordLegacyCoverage(ledgerAtReview, currentContext, id);
          issue = null;notify('Pantry confirmed. Your shopping list now includes only what is still needed.');
          // The adapter can emit its projection before resolving this call.
          // Keep both notifications behind the outer Ingredients used panel.
          notifyProjection(result.projection);settled = true;
          if (inline) closeForm();else controller.dispose();
          schedule();if (current()) onConfirmed?.(result);
        } catch (error) {
          if (!disposed && current()) message.textContent = error.status === 409 ? 'This pantry changed on another device. Close and reopen the review to use the latest quantities.' : 'Your pantry could not be confirmed. Your local quantities are preserved.';
        } finally {busy = false;confirm.disabled = cancel.disabled = false;}
      });
      if (!inline) {if (typeof dialog.showModal === 'function') dialog.showModal();else dialog.setAttribute('open', '');}
      confirm.focus();return inline ? controller : dialog;
    }
    function openReceiptEntry() {
      if (blocked()) return;
      // The visible Premium entry must not probe the receipt service or open a
      // photo picker for Free/unverified accounts. Paid clicks still use the
      // original open() path and its fresh account, availability and review gates.
      const membership = root.BasketBossMembershipUI;
      const state = membership?.state?.();
      const premium = state ? state === 'premium' : typeof root.BasketBossVerifiedPremium?.isActive === 'function' ? root.BasketBossVerifiedPremium.isActive() === true : options.isPremium?.() === true;
      if (!premium) {
        if (typeof membership?.open === 'function') return membership.open();
        return options.openUpgrade?.();
      }
      return open();
    }
    function renderHostDOM() {
      const document = doc();if (!document) return;
      const app = document.getElementById('app');if (!app) return;
      const tab = options.getTab?.() || document.querySelector('.tab.active')?.dataset.tab;
      let mount = document.getElementById('bbReceiptHostMount');
      let toolbar = document.getElementById('bbReceiptToolbar');
      if (!['shop-list', 'shop'].includes(tab) && !isolationError) {if (mount) mount.hidden = true;if (toolbar) toolbar.hidden = true;lastTab = tab;return;}
      if (!mount) {mount = element('div', undefined, 'bb-receipt-host-mount');mount.id = 'bbReceiptHostMount';app.before(mount);}
      const entered = lastTab !== tab;lastTab = tab;
      if (entered && ['shop-list', 'shop'].includes(tab)) {isolate();void refreshAvailability({synchronize: tab === 'shop-list'});}
      if (isolationError) {
        if (toolbar) toolbar.hidden = true;
        mount.hidden = false;mount.replaceChildren(element('p', isolationError, 'bb-receipt-host-error'));
        document.body?.setAttribute('data-bb-receipt-isolation-error', 'true');
        app.inert = true;app.style.visibility = 'hidden';
        return;
      }
      document.body?.removeAttribute('data-bb-receipt-isolation-error');app.inert = false;app.style.removeProperty('visibility');
      if (tab !== 'shop-list') {mount.hidden = true;if (toolbar) toolbar.hidden = true;return;}
      mount.hidden = false;
      if (!toolbar) {toolbar = element('section', undefined, 'bb-receipt-host-toolbar bb-receipt-host-section');toolbar.id = 'bbReceiptToolbar';toolbar.setAttribute('aria-label', 'Shopping list tools');mount.prepend(toolbar);}
      // Mobile replaces #app with a separate snapshot. Promote only the same
      // compact toolbar above it; pantry recovery and receipt history retain
      // their original position. Stay outside the snapshot's replaced subtree.
      toolbar.hidden = false;
      const overview = document.getElementById('bbReleaseShopOverview');
      const anchor = overview && overview.parentNode === app.parentNode ? overview : mount;
      if (toolbar.nextElementSibling !== anchor) anchor.before(toolbar);
      const entryLabel = 'Scan receipt · Premium';
      if (toolbar && !toolbar.querySelector('[data-bb-receipt-entry]')) {
        const button = element('button', undefined, 'btn bb-receipt-scan-tab');button.type = 'button';button.dataset.bbReceiptEntry = '1';button.setAttribute('aria-label', entryLabel);
        button.append(element('span', 'Scan receipt', 'bb-receipt-entry-label'), element('span', ' · ', 'bb-receipt-entry-separator'), element('span', 'Premium', 'bb-receipt-entry-badge'));
        button.onclick = () => {void openReceiptEntry();};toolbar.append(button);
      }
      const entry = toolbar?.querySelector('[data-bb-receipt-entry]');if (entry && entry.textContent !== entryLabel) entry.textContent = entryLabel;
      mount.querySelector('#bbReceiptReviewBanner')?.remove();
      if (requiresPantryReview() || hasPendingConfirmation() || issue) {
        const banner = element('section', undefined, 'bb-receipt-host-banner bb-receipt-host-section');banner.id = 'bbReceiptReviewBanner';
        const counted = !hasPendingConfirmation() && requiresPantryReview() && getConsumptionStatus().ready;
        banner.append(element('h3', hasPendingConfirmation() ? 'Recover your receipt' : counted ? 'At home stock included' : 'Confirm Your Pantry'), element('p', hasPendingConfirmation() ? 'A receipt confirmation needs checking. Finish Shop is paused to prevent adding the same purchase twice.' : counted ? 'Your At home amounts are already included in this list. Review them if they have changed.' : 'Check your current amounts before your pantry reduces the shopping list.'));
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
      if (blocked()) return;
      if (rendering) {schedule();return;}rendering = true;
      observer?.disconnect();
      try {renderHostDOM();}
      finally {rendering = false;const app = doc()?.getElementById('app');if (observer && app) observer.observe(app, {childList: true});}
    }
    function schedule() {if (blocked()) return;if (scheduled) return;scheduled = true;(root.queueMicrotask || (fn => Promise.resolve().then(fn)))(() => {scheduled = false;afterRender();});}
    function configure(value = {}) {
      options = {...options, ...value};configured = true;setupAdapter();isolate();
      const document = doc();
      if (document && !observer && root.MutationObserver) {const app = document.getElementById('app');if (app) {observer = new root.MutationObserver(schedule);observer.observe(app, {childList: true});}}
      afterRender();return api;
    }
    const accountChanged = () => {if (!configured) return;generation++;discardInlineReviews();activeDialog?.close?.();activeDialog?.remove();activeDialog = null;reviewing = false;lastChecked = 0;checkedActor = null;statusPromise = null;isolate();setupAdapter();schedule();};
    const pauseDeletion = () => {
      deletionPaused = true;generation++;availability = {available: false, premium: false};statusPromise = null;checkedActor = null;lastChecked = 0;
      discardInlineReviews();activeDialog?.close?.();activeDialog?.remove();activeDialog = null;reviewing = false;scanner()?.close?.();
      if (externalTimer !== null) {root.clearTimeout?.(externalTimer);externalTimer = null;}
    };
    root.addEventListener?.('basketboss:account-deletion-started', pauseDeletion);
    root.addEventListener?.('basketboss:account-deletion-deleted', pauseDeletion);
    root.addEventListener?.('basketboss:account-deletion-cancelled', () => {deletionPaused = false;accountChanged();});
    root.addEventListener?.('basketboss:session-changed', accountChanged);
    root.addEventListener?.('pageshow', () => {if (configured && observedActor !== actor()) accountChanged();});
    const regionChanged = () => {if (!configured) return;generation++;discardInlineReviews();activeDialog?.close?.();activeDialog?.remove();activeDialog = null;reviewing = false;lastChecked = 0;checkedActor = null;statusPromise = null;schedule();};
    root.addEventListener?.('basketboss:supermarket-changed', regionChanged);
    root.addEventListener?.('basketboss:market-changed', regionChanged);
    let externalTimer = null;
    function externalChange(event) {
      if (blocked()) return;
      if (!configured || ![KEYS.actor, KEYS.owner, KEYS.stock, KEYS.confirmed, KEYS.ledger, 'basketboss_cloud_session_v1'].includes(event.key)) return;
      if (externalTimer !== null) {root.clearTimeout?.(externalTimer);externalTimer = null;}
      accountChanged();
      if (actor() !== 'guest' && store().getItem('basketboss_receipt_inventory_journal_v1:' + encodeURIComponent(actor()))) {
        if (root.setTimeout) externalTimer = root.setTimeout(() => {externalTimer = null;if (!blocked() && !store().getItem('basketboss_receipt_inventory_journal_v1:' + encodeURIComponent(actor()))) {options.onProjection?.({externalStorage: true});schedule();}}, 150);
        return;
      }
      options.onProjection?.({externalStorage: true});schedule();
    }
    root.addEventListener?.('storage', externalChange);
    const api = Object.freeze({configure, afterRender, refreshAvailability, open, saveLegacyReceipt, reviewPantry, confirmCurrentPantry, confirmCookedPantry, preparePurchasedPantry, confirmPurchasedPantry, retryPurchasedPantry, canConsumePantry, getConsumptionStatus, confirmLocalPantryReview, recoverReceipt, requiresPantryReview, hasPendingConfirmation, allowLegacyTransfer, allowPurchaseTransfer, handlesInventorySync, coversLegacyCredit, switchActor, exportBackup, prepareBackupRestore, hasLocalData, getAvailability: () => ({...availability}), getProjection: projection, weeklySummary: () => weeklyReceiptSummary(projection(), context(), clock()), keys: KEYS});
    return api;
  }
  root.BBReceiptHostFactory = createHost;
  root.BBReceiptHostHelpers = Object.freeze({actorOf, weeklyReceiptSummary, weekBounds, recordedTrips});
  root.BBReceiptHost = createHost();
})(typeof window !== 'undefined' ? window : globalThis);
