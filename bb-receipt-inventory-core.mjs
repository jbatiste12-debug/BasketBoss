/* Shared receipt rules. Pure ESM: no browser, database, filesystem or network access. */
export const RECEIPT_SCHEMA_VERSION = 1;
export const SUPPORTED_MARKETS = Object.freeze({ UK: 'GBP', Guernsey: 'GBP', Jersey: 'GBP', US: 'USD' });
const MAX_QUANTITY = 1_000_000;
const COUNT_UNITS = new Set(['each', 'clove', 'bulb', 'tin', 'pack', 'bag', 'bunch', 'loaf', 'slice']);
const BASE_UNITS = new Set(['g', 'ml', 'tsp', 'tbsp', ...COUNT_UNITS]);
const PACKAGE_UNITS = new Set(['tin', 'pack', 'bag', 'bunch', 'loaf']);
const ALIASES = Object.freeze({ eggs: 'egg', potatoes: 'potato', tomatoes: 'tomato', onions: 'onion', peppers: 'pepper', carrots: 'carrot', bananas: 'banana', apples: 'apple', lemons: 'lemon', limes: 'lime', mushrooms: 'mushroom', courgettes: 'courgette', scallops: 'scallop', wraps: 'wrap' });
const HOUSEHOLD = /\b(?:soap|detergent|washing[ -]up|washing[ -]powder|laundry|fabric[ -](?:softener|conditioner)|dishwasher|dish[ -]?soap|toilet|loo[ -]roll|kitchen[ -](?:roll|towel)|paper[ -]towels?|facial[ -]tissues?|tissues|razors?|shaving[ -](?:foam|gel|cream)|sanitary[ -](?:pads|towels|products)|tampons?|panty[ -]liners?|menstrual[ -](?:pads|cups)|bleach|cleaner|cleaning|disinfectant|saniti[sz]er|shampoo|conditioner|toothpaste|toothbrush|deodorant|shower[ -]gel|body[ -]wash|hand[ -]wash|face[ -]cream|hand[ -]cream|moisturi[sz]er|napp(?:y|ies)|diapers?|wipes|bin[ -](?:bags?|liners?)|foil|cling[ -]film|baking[ -]paper|batter(?:y|ies)|light[ -]bulb|pet[ -]food|cat[ -]food|dog[ -]food|litter|cigarettes?|tobacco)\b/i;
const ADJUSTMENT = /\b(?:refund|returned?|discount|coupon|voucher|loyalty|saving|promotion[ -]discount|subtotal|sub[ -]total|grand[ -]total|vat|tax|change[ -]due|cash[ -]back|deposit[ -]return)\b/i;
const clean = (v, max = 160) => typeof v === 'string' ? v.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const finite = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.length > 40 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())) return null;
  return Number.isFinite(Number(v)) ? Number(v) : null;
};
const round = n => Math.round((n + Number.EPSILON) * 1000) / 1000;
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export function canonicalIngredientKey(value, canonicalize) {
  let key = clean(value).toLowerCase();
  if (!key || key.includes('|') || /^(?:__proto__|constructor|prototype)$/.test(key)) return null;
  if (typeof canonicalize === 'function') key = clean(canonicalize(key)).toLowerCase();
  key = ALIASES[key] || key;
  if (typeof canonicalize === 'function') key = clean(canonicalize(key)).toLowerCase();
  return key && !key.includes('|') && !/^(?:__proto__|constructor|prototype)$/.test(key) ? key : null;
}
export function normalizeUnit(value) {
  const u = clean(value, 30).toLowerCase();
  const aliases = { gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', litre: 'l', litres: 'l', liter: 'l', liters: 'l', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml', pc: 'each', pcs: 'each', item: 'each', items: 'each', piece: 'each', pieces: 'each', whole: 'each', eggs: 'each', cloves: 'clove', bulbs: 'bulb', tins: 'tin', can: 'tin', cans: 'tin', packs: 'pack', bags: 'bag', bunches: 'bunch', loaves: 'loaf', slices: 'slice' };
  const unit = aliases[u] || u;
  return BASE_UNITS.has(unit) || unit === 'kg' || unit === 'l' ? unit : null;
}
export function normalizeMeasuredQuantity(quantity, inputUnit) {
  const q = finite(quantity), rawUnit = normalizeUnit(inputUnit);
  if (q === null || q <= 0 || q > MAX_QUANTITY || !rawUnit) return null;
  const unit = rawUnit === 'kg' ? 'g' : rawUnit === 'l' ? 'ml' : rawUnit;
  const amount = round(q * (rawUnit === 'kg' || rawUnit === 'l' ? 1000 : 1));
  if (amount <= 0 || amount > MAX_QUANTITY || COUNT_UNITS.has(unit) && !Number.isInteger(amount)) return null;
  return { quantity: amount, unit };
}
function packFromText(value) {
  const text = clean(value, 300).toLowerCase();
  const multi = text.match(/(?:^|\s)(\d{1,4})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|litres?|liters?|l)\b/);
  if (multi) return { packCount: Number(multi[1]), packQuantity: Number(multi[2]), packUnit: multi[3] };
  const single = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(kg|g|ml|litres?|liters?|l)\b/);
  return single ? { packQuantity: Number(single[1]), packUnit: single[2] } : {};
}
export function normalizePack(input = {}) {
  if (!object(input)) throw new Error('invalid_receipt_pack');
  const text = packFromText(input.packText || input.description || input.name);
  const pack = normalizeMeasuredQuantity(input.packQuantity ?? input.packSize ?? text.packQuantity, input.packUnit ?? input.packSizeUnit ?? text.packUnit);
  const quantityIsPackCount = !!pack && normalizeUnit(input.unit) === 'pack';
  const rawCount = input.packCount ?? input.count ?? text.packCount ?? (quantityIsPackCount ? input.quantity : null);
  const packCount = finite(rawCount);
  const direct = quantityIsPackCount ? null : normalizeMeasuredQuantity(input.quantity, input.unit);
  if (packCount !== null && (!Number.isInteger(packCount) || packCount <= 0 || packCount > 10_000)) return { quantity: null, unit: null, packCount: null, packQuantity: pack?.quantity ?? null, packUnit: pack?.unit ?? null, issue: 'invalid_pack_count' };
  // A clearly measured total does not require a guessed pack count or a catalogue pack.
  if (direct && !pack) return { ...direct, packCount, packQuantity: null, packUnit: null, issue: null };
  if (pack && packCount !== null) {
    const total = normalizeMeasuredQuantity(pack.quantity * packCount, pack.unit);
    if (!total) return { quantity: null, unit: null, packCount, packQuantity: pack.quantity, packUnit: pack.unit, issue: 'quantity_out_of_range' };
    if (direct && (direct.unit !== total.unit || Math.abs(direct.quantity - total.quantity) > .001)) return { quantity: null, unit: null, packCount, packQuantity: pack.quantity, packUnit: pack.unit, issue: 'conflicting_pack_and_total' };
    return { ...total, packCount, packQuantity: pack.quantity, packUnit: pack.unit, issue: null };
  }
  if (direct) return { ...direct, packCount, packQuantity: pack?.quantity ?? null, packUnit: pack?.unit ?? null, issue: null };
  return { quantity: null, unit: pack?.unit ?? null, packCount, packQuantity: pack?.quantity ?? null, packUnit: pack?.unit ?? null, issue: pack ? 'pack_count_required' : 'measured_quantity_required' };
}
export function classifyReceiptLine(line = {}) {
  if (!object(line)) throw new Error('invalid_receipt_line');
  const description = clean(line.description || line.name || line.rawName, 300);
  const paid = finite(line.lineTotal ?? line.pricePaid ?? line.price);
  const source = clean(line.sourceKind || line.type || line.kind, 30).toLowerCase();
  const totalLine = /^(?:grand[ -])?total(?: due| amount| paid)?(?:\s+[$£€]?\d.*)?$/i.test(description);
  if (['refund', 'return', 'discount', 'coupon', 'tax', 'total', 'subtotal'].includes(source) || paid !== null && paid < 0 || totalLine || ADJUSTMENT.test(description)) {
    const refund = ['refund', 'return'].includes(source) || /\b(?:refund|returned?)\b/i.test(description);
    const discount = ['discount', 'coupon'].includes(source) || /\b(?:discount|coupon|voucher|loyalty|saving)\b/i.test(description);
    const sourceKind = refund ? 'refund' : source === 'tax' || /\b(?:tax|vat)\b/i.test(description) ? 'tax' : totalLine || /total/.test(source) || /\b(?:total|subtotal)\b/i.test(description) ? 'total' : discount ? 'discount' : paid < 0 ? 'refund' : 'discount';
    return { classification: 'ignore', sourceKind, hardExcluded: true };
  }
  if (HOUSEHOLD.test(description) || HOUSEHOLD.test(clean(line.canonicalKey || line.ingredientKey))) return { classification: 'essential', sourceKind: 'purchase', hardExcluded: true };
  const kind = line.classification || line.kind;
  return { classification: ['food', 'essential', 'ignore', 'pending'].includes(kind) ? kind : kind === 'unknown' ? 'pending' : line.canonicalKey || line.ingredientKey ? 'food' : 'pending', sourceKind: 'purchase', hardExcluded: false };
}
function catalogHas(catalog, key, unit, canonicalize) {
  if (!catalog) return true;
  const values = catalog.ingredients || catalog;
  if (Array.isArray(values)) return values.some(x => canonicalIngredientKey(x.key || x.ingredient || x.canonicalKey, canonicalize) === key && (x.unit === unit || x.units?.includes(unit)));
  if (Object.prototype.hasOwnProperty.call(values, `${key}|${unit}`)) return true;
  // Resolve explicit Pantry aliases against actual catalogue records, never a guessed pack.
  return Object.keys(values).some(pair => {
    const divider = pair.lastIndexOf('|');
    if (divider < 1) return false;
    const declared = normalizeUnit(pair.slice(divider + 1)), base = declared === 'kg' ? 'g' : declared === 'l' ? 'ml' : declared;
    return base === unit && canonicalIngredientKey(pair.slice(0, divider), canonicalize) === key;
  });
}
export function normalizeReceiptLine(raw = {}, context = {}, index = 0) {
  if (!object(raw) || !object(context)) throw new Error('invalid_receipt_line');
  const description = clean(raw.description || raw.name || raw.rawName, 200);
  const classified = classifyReceiptLine(raw), pack = normalizePack({ ...raw, description });
  const canonicalKey = canonicalIngredientKey(raw.canonicalKey || raw.ingredientKey, context.canonicalize);
  const paid = finite(raw.lineTotal ?? raw.pricePaid ?? raw.price), unitPaid = finite(raw.unitPrice);
  const pricePaid = paid !== null ? money(paid) : unitPaid !== null && pack.packCount !== null ? money(unitPaid * pack.packCount) : null;
  const issues = [];
  if (!description) issues.push('description_required');
  if (classified.classification === 'food') {
    if (!canonicalKey) issues.push('canonical_ingredient_required');
    if (!pack.quantity || !pack.unit) issues.push(pack.issue || 'measured_quantity_required');
    if (canonicalKey && pack.quantity && !catalogHas(context.catalog, canonicalKey, pack.unit, context.canonicalize)) issues.push('canonical_unit_not_in_catalog');
  }
  if (pricePaid !== null && (Math.abs(pricePaid) > 100_000)) issues.push('invalid_price');
  if (pack.issue && pack.issue !== 'measured_quantity_required' && classified.classification === 'food' && !issues.includes(pack.issue)) issues.push(pack.issue);
  return {
    id: clean(raw.id || raw.lineId, 100) || `line-${index + 1}`, description, name: description,
    brand: clean(raw.brand, 80), classification: classified.classification, sourceKind: classified.sourceKind, hardExcluded: classified.hardExcluded,
    canonicalKey, quantity: pack.quantity, unit: pack.unit, packCount: pack.packCount, packQuantity: pack.packQuantity, packUnit: pack.packUnit,
    unitPrice: unitPaid !== null ? money(unitPaid) : pricePaid !== null && pack.packCount > 0 ? money(pricePaid / pack.packCount) : null,
    lineTotal: pricePaid, pricePaid, priceType: ['regular', 'promotion', 'unknown'].includes(raw.priceType) ? raw.priceType : 'unknown',
    location: ['cupboard', 'fridge', 'freezer'].includes(raw.location || raw.loc) ? raw.location || raw.loc : 'cupboard',
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low', notes: clean(raw.notes, 500),
    selected: raw.selected !== false && classified.sourceKind === 'purchase', reviewed: raw.reviewed === true, issues
  };
}
export function receiptTotals(lines, receiptTotal = null) {
  const result = { food: 0, essentials: 0, adjustments: 0, taxLines: 0, reviewedSpend: 0, receiptTotal: finite(receiptTotal), difference: null };
  for (const line of lines) {
    const price = finite(line.lineTotal ?? line.pricePaid);
    if (price === null) continue;
    if (line.sourceKind === 'tax') result.taxLines += price;
    else if (line.sourceKind === 'total') continue;
    else if (line.sourceKind !== 'purchase') result.adjustments += price;
    else if (line.selected !== false && line.classification === 'food') result.food += price;
    else if (line.selected !== false && line.classification === 'essential') result.essentials += price;
  }
  for (const key of ['food', 'essentials', 'adjustments', 'taxLines']) result[key] = money(result[key]);
  result.reviewedSpend = money(result.food + result.essentials + result.adjustments);
  if (result.receiptTotal !== null) result.difference = money(result.receiptTotal - result.reviewedSpend);
  return result;
}
export function normalizeReceiptDraft(raw = {}, context = {}) {
  if (!object(raw) || !object(context)) throw new Error('invalid_receipt_draft');
  if (raw.addToPantry !== undefined && typeof raw.addToPantry !== 'boolean') throw new Error('invalid_receipt_stock_policy');
  const market = context.market || context.region || raw.market;
  const expected = SUPPORTED_MARKETS[market];
  if (!expected) throw new Error('unsupported_market');
  const currency = clean(raw.currency || expected, 3).toUpperCase();
  if (currency !== expected) throw new Error('receipt_currency_mismatch');
  const items = Array.isArray(raw.lines) ? raw.lines : Array.isArray(raw.items) ? raw.items : [];
  if (items.length > 200) throw new Error('too_many_receipt_lines');
  const lines = items.map((line, i) => normalizeReceiptLine(line, context, i));
  if (new Set(lines.map(x => x.id)).size !== lines.length) throw new Error('duplicate_receipt_line_id');
  const receiptTotal = finite(raw.receiptTotal ?? raw.total);
  if (receiptTotal !== null && Math.abs(receiptTotal) > 100000) throw new Error('receipt_total_limit');
  return { version: 1, receiptId: clean(raw.receiptId, 120) || null, market, retailer: clean(context.retailer ?? context.store ?? raw.retailer, 100) || null, currency,
    purchasedAt: clean(raw.purchasedAt || raw.transactionAt, 50) || null, transactionAt: clean(raw.purchasedAt || raw.transactionAt, 50) || null,
    shopSessionId: clean(raw.shopSessionId || context.shopSessionId, 120) || null, addToPantry: raw.addToPantry !== false, receiptTotal, lines,
    totals: receiptTotals(lines, receiptTotal), pendingLineIds: lines.filter(x => x.classification === 'pending' || x.issues.length).map(x => x.id) };
}
export function computeReceiptCredit(line, credits = [], { shopSessionId, receiptId = null, claimedCreditIds = [], creditUsedById = {} } = {}) {
  const measured = normalizeMeasuredQuantity(line.quantity, line.unit), key = canonicalIngredientKey(line.canonicalKey || line.name);
  if (!measured || !key) throw new Error('invalid_measured_receipt_food');
  const claimed = new Set(claimedCreditIds), candidates = Array.isArray(credits) ? credits : Object.entries(credits).map(([id, x]) => ({ ...x, id }));
  let credit = null;
  for (const entry of candidates) {
    const id = clean(entry.id, 300), session = entry.shopSessionId || entry.week;
    // FinishShop's original surplus credit can net against one physical receipt only.
    // Its same-receipt retry keeps identical semantics; a later receipt adds new stock.
    let availableCredit = entry.credited ?? entry.quantity;
    if (entry.receiptInventoryReceiptId) {
      if (receiptId && Object.hasOwn(entry.receiptLegacyCreditById || {}, receiptId)) availableCredit = entry.receiptLegacyCreditById[receiptId];
      else if (entry.receiptInventoryReceiptId !== receiptId || Object.keys(entry.receiptCoverageById || {}).length > 1) continue;
    }
    const name = canonicalIngredientKey(entry.canonicalKey || entry.name), amount = normalizeMeasuredQuantity(availableCredit, entry.unit);
    if (!shopSessionId || session !== shopSessionId || id !== `${shopSessionId}|${key}|${measured.unit}` || claimed.has(id) || name !== key || !amount || amount.unit !== measured.unit) continue;
    const remaining = Math.max(0, amount.quantity - (finite(creditUsedById[id]) || 0));
    if (!remaining) continue;
    credit = { id, quantity: round(Math.min(remaining, measured.quantity)), unit: measured.unit }; break;
  }
  const priorCreditedQuantity = credit?.quantity || 0;
  return { purchasedQuantity: measured.quantity, priorCreditedQuantity, addedQuantity: round(measured.quantity - priorCreditedQuantity), legacyCredit: credit };
}
export function prepareReceiptConfirmation(input, { requestId, catalog, canonicalize, finishShopCredits = [] } = {}) {
  if (!object(input)) throw new Error('invalid_receipt_draft');
  const draft = normalizeReceiptDraft(input, { market: input.market, retailer: input.retailer, catalog, canonicalize });
  const id = clean(requestId, 160), receiptId = clean(draft.receiptId, 120);
  if (!id || !receiptId) throw new Error('receipt_identity_required');
  if (typeof requestId !== 'string' || requestId.length > 160 || typeof input.receiptId !== 'string' || input.receiptId.length > 120) throw new Error('receipt_identity_limit');
  const accepted = [], creditUsedById = {}, quantitiesByStockKey = new Map(); let acceptedSpend = 0;
  for (const line of draft.lines) {
    if (!line.selected || line.sourceKind !== 'purchase' || line.classification === 'ignore') continue;
    if (line.classification === 'pending') throw new Error('classify_or_deselect_pending_lines');
    if (!line.reviewed) throw new Error('review_receipt_line_first');
    const issues = draft.addToPantry ? line.issues : line.issues.filter(x => !['measured_quantity_required', 'pack_count_required', 'canonical_unit_not_in_catalog'].includes(x));
    if (issues.length) throw new Error(`invalid_receipt_line:${line.id}:${issues.join(',')}`);
    if (line.pricePaid === null || line.pricePaid < 0) throw new Error(`nonnegative_receipt_price_required:${line.id}`);
    acceptedSpend = money(acceptedSpend + line.pricePaid);
    if (acceptedSpend > 100000) throw new Error('receipt_total_limit');
    const out = { lineId: line.id, kind: line.classification, canonicalKey: line.classification === 'food' ? line.canonicalKey : null, name: line.description, brand: line.brand,
      quantity: line.quantity, unit: line.unit, packCount: line.packCount, packQuantity: line.packQuantity, packUnit: line.packUnit,
      pricePaid: line.pricePaid, priceType: line.priceType, location: line.location };
    if (line.classification === 'food' && draft.addToPantry) {
      const stockKey = `${line.canonicalKey}|${line.unit}`, total = round((quantitiesByStockKey.get(stockKey) || 0) + line.quantity);
      if (total > MAX_QUANTITY) throw new Error('receipt_food_quantity_limit');
      quantitiesByStockKey.set(stockKey, total);
      const credit = computeReceiptCredit(line, finishShopCredits, { shopSessionId: draft.shopSessionId, receiptId: draft.receiptId, creditUsedById });
      if (credit.legacyCredit) { out.legacyCredit = credit.legacyCredit; creditUsedById[credit.legacyCredit.id] = round((creditUsedById[credit.legacyCredit.id] || 0) + credit.legacyCredit.quantity); }
    }
    accepted.push(out);
  }
  if (!accepted.length) throw new Error('no_reviewed_receipt_lines');
  const adjustments = draft.lines.filter(line => line.reviewed && ['discount', 'refund', 'tax'].includes(line.sourceKind)).map(line => {
    if (line.lineTotal === null || Math.abs(line.lineTotal) > 100000) throw new Error('invalid_receipt_adjustment');
    return { lineId: line.id, kind: line.sourceKind, amount: line.lineTotal, description: line.description };
  });
  return { action: 'confirm_receipt', addToPantry: draft.addToPantry, requestId: id, receiptId, shopSessionId: draft.shopSessionId, market: draft.market, currency: draft.currency, retailer: draft.retailer, purchasedAt: draft.purchasedAt, receiptTotal: draft.receiptTotal, adjustments, lines: accepted };
}
export function normalizeInventoryScope(value) {
  if (!object(value) || Object.keys(value).some(key => !['kind', 'id'].includes(key)) || !['user', 'household'].includes(value.kind) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{4,120}$/.test(value.id)) throw new Error('invalid_expected_inventory_scope');
  return { kind: value.kind, id: value.id };
}
/* HTTP confirmation rows are already user-confirmed by this action; no UI-only
   `reviewed` flag is accepted as an authorization substitute. Backend still owns auth. */
export function validateReceiptConfirmation(input, { catalog, canonicalize } = {}) {
  const allow = (value, fields, label) => {
    if (!object(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error(`invalid_receipt_${label}_shape`);
  };
  const text = (value, max, label, nullable = false) => {
    if (nullable && (value === null || value === undefined)) return null;
    if (typeof value !== 'string' || !value || value.length > max || clean(value, max) !== value || /data:image\/|base64,/i.test(value)) throw new Error(`invalid_receipt_${label}`);
    return value;
  };
  const amount = (value, max = 100000) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;
  allow(input, ['action', 'addToPantry', 'requestId', 'receiptId', 'shopSessionId', 'market', 'currency', 'retailer', 'purchasedAt', 'receiptTotal', 'adjustments', 'expectedScope', 'inventoryBaseline', 'lines'], 'body');
  if (input.addToPantry !== undefined && typeof input.addToPantry !== 'boolean') throw new Error('invalid_receipt_stock_policy');
  const addToPantry = input.addToPantry !== false;
  if (input.action !== 'confirm_receipt' || !Object.hasOwn(SUPPORTED_MARKETS, input.market) || input.currency !== SUPPORTED_MARKETS[input.market]) throw new Error('invalid_receipt_action_market_or_currency');
  if (!catalog) throw new Error('canonical_catalog_required');
  const requestId = text(input.requestId, 160, 'request_id'), receiptId = text(input.receiptId, 120, 'id');
  const expectedScope = normalizeInventoryScope(input.expectedScope);
  const shopSessionId = text(input.shopSessionId, 120, 'shop_session', true);
  const retailer = text(input.retailer, 100, 'retailer', true), purchasedAt = text(input.purchasedAt, 50, 'purchased_at', true);
  if (input.receiptTotal !== null && input.receiptTotal !== undefined && !amount(input.receiptTotal)) throw new Error('invalid_receipt_total');
  allow(input.inventoryBaseline, ['stock', 'expectedRevision', 'initialize'], 'baseline');
  if (!Number.isSafeInteger(input.inventoryBaseline.expectedRevision) || input.inventoryBaseline.expectedRevision < 0 || typeof input.inventoryBaseline.initialize !== 'boolean') throw new Error('invalid_receipt_baseline_revision');
  const inventoryBaseline = { stock: normalizeStockMap(input.inventoryBaseline.stock, { canonicalize }), expectedRevision: input.inventoryBaseline.expectedRevision, initialize: input.inventoryBaseline.initialize };
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 200) throw new Error('invalid_receipt_lines');
  const ids = new Set(), quantities = new Map(); let spend = 0;
  const lines = input.lines.map((line, index) => {
    allow(line, ['lineId', 'kind', 'canonicalKey', 'name', 'brand', 'quantity', 'unit', 'packCount', 'packQuantity', 'packUnit', 'pricePaid', 'priceType', 'location', 'legacyCredit'], 'line');
    const lineId = text(line.lineId, 100, 'line_id'), name = text(line.name, 200, 'line_name');
    if (ids.has(lineId)) throw new Error('duplicate_receipt_line_id'); ids.add(lineId);
    if (!['food', 'essential'].includes(line.kind) || !amount(line.pricePaid) || line.pricePaid < 0 || !['regular', 'promotion', 'unknown'].includes(line.priceType) || !['cupboard', 'fridge', 'freezer'].includes(line.location)) throw new Error('invalid_receipt_line_type_price_or_location');
    const category = classifyReceiptLine(line);
    if (category.sourceKind !== 'purchase' || category.classification !== line.kind) throw new Error('receipt_line_classification_conflict');
    for (const key of ['quantity', 'packQuantity']) if (line[key] !== null && line[key] !== undefined && (typeof line[key] !== 'number' || !Number.isFinite(line[key]) || line[key] <= 0 || line[key] > MAX_QUANTITY)) throw new Error('invalid_receipt_numeric_quantity');
    if (line.packCount !== null && line.packCount !== undefined && (!Number.isInteger(line.packCount) || line.packCount < 1 || line.packCount > 10000)) throw new Error('invalid_receipt_pack_count');
    const brand = line.brand === '' || line.brand === null || line.brand === undefined ? '' : text(line.brand, 80, 'brand');
    const normalized = normalizeReceiptLine({ ...line, id: lineId, reviewed: true }, { market: input.market, catalog, canonicalize }, index);
    const issues = addToPantry ? normalized.issues : normalized.issues.filter(x => !['measured_quantity_required', 'pack_count_required', 'canonical_unit_not_in_catalog'].includes(x));
    if (line.kind === 'food' && issues.length) throw new Error(`invalid_receipt_food:${issues.join(',')}`);
    if (line.kind === 'essential' && line.canonicalKey !== null && line.canonicalKey !== undefined) throw new Error('essential_cannot_claim_food_key');
    const out = { lineId, kind: line.kind, canonicalKey: line.kind === 'food' ? normalized.canonicalKey : null, name, brand, quantity: normalized.quantity, unit: normalized.unit, packCount: normalized.packCount, packQuantity: normalized.packQuantity, packUnit: normalized.packUnit, pricePaid: money(line.pricePaid), priceType: line.priceType, location: line.location };
    if (line.kind === 'food' && addToPantry) {
      const key = `${out.canonicalKey}|${out.unit}`, total = round((quantities.get(key) || 0) + out.quantity);
      if (total > MAX_QUANTITY) throw new Error('receipt_food_quantity_limit'); quantities.set(key, total);
    }
    if (line.legacyCredit !== null && line.legacyCredit !== undefined) {
      allow(line.legacyCredit, ['id', 'quantity', 'unit'], 'legacy_credit');
      if (!addToPantry || line.kind !== 'food' || !shopSessionId || line.legacyCredit.id !== `${shopSessionId}|${out.canonicalKey}|${out.unit}` || line.legacyCredit.unit !== out.unit || !amount(line.legacyCredit.quantity, MAX_QUANTITY) || line.legacyCredit.quantity <= 0 || line.legacyCredit.quantity > out.quantity) throw new Error('invalid_receipt_legacy_credit');
      out.legacyCredit = { id: line.legacyCredit.id, quantity: line.legacyCredit.quantity, unit: out.unit };
    }
    spend = money(spend + out.pricePaid); if (spend > 100000) throw new Error('receipt_total_limit');
    return out;
  });
  const rawAdjustments = input.adjustments || [];
  if (!Array.isArray(rawAdjustments) || rawAdjustments.length > 200) throw new Error('invalid_receipt_adjustments');
  const adjustments = rawAdjustments.map(row => {
    allow(row, ['lineId', 'kind', 'amount', 'description'], 'adjustment');
    const lineId = text(row.lineId, 100, 'adjustment_id'), description = text(row.description, 200, 'adjustment_description');
    if (ids.has(lineId)) throw new Error('duplicate_receipt_line_id'); ids.add(lineId);
    if (!['discount', 'refund', 'tax'].includes(row.kind) || !amount(row.amount) || (row.kind === 'tax' ? row.amount < 0 : row.amount > 0)) throw new Error('invalid_receipt_adjustment_amount');
    return { lineId, kind: row.kind, amount: money(row.amount), description };
  });
  if (lines.length + adjustments.length > 200) throw new Error('too_many_receipt_lines');
  return { action: 'confirm_receipt', ...(input.addToPantry === undefined ? {} : {addToPantry}), requestId, receiptId, shopSessionId, market: input.market, currency: input.currency, retailer, purchasedAt, receiptTotal: input.receiptTotal ?? null, adjustments, expectedScope, inventoryBaseline, lines };
}
export function normalizePriceObservation(line, { scope, market, retailer, currency, receiptId } = {}) {
  if (!object(line)) return null;
  const kind = classifyReceiptLine(line), pack = normalizePack(line), price = finite(line.pricePaid ?? line.lineTotal);
  const scopeId = clean(typeof scope === 'string' ? scope : scope?.id, 120), store = clean(retailer, 100).toLowerCase();
  if (kind.classification !== 'food' || kind.sourceKind !== 'purchase' || !scopeId || !SUPPORTED_MARKETS[market] || SUPPORTED_MARKETS[market] !== currency || !store || !pack.packQuantity || !pack.packCount || !pack.quantity || price === null || price <= 0 || price > 100_000) return null;
  const canonicalKey = canonicalIngredientKey(line.canonicalKey || line.ingredientKey);
  if (!canonicalKey) return null;
  const priceType = ['regular', 'promotion'].includes(line.priceType) ? line.priceType : 'unknown';
  return { scopeId, market, retailer: store, currency, receiptId: clean(receiptId, 120), canonicalKey, brand: clean(line.brand, 80),
    packQuantity: pack.packQuantity, packUnit: pack.packUnit, packCount: pack.packCount, packPrice: money(price / pack.packCount), priceType,
    eligibleForRegularPrice: priceType === 'regular', source: 'reviewed_receipt' };
}
// Stock balances differ from purchase lines: partial physical items are valid.
export function normalizeStockQuantity(quantity, inputUnit) {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) return null;
  const rawUnit = normalizeUnit(inputUnit);
  if (!rawUnit) return null;
  const unit = rawUnit === 'kg' ? 'g' : rawUnit === 'l' ? 'ml' : rawUnit;
  const amount = quantity * (rawUnit === 'kg' || rawUnit === 'l' ? 1000 : 1);
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_QUANTITY ? {quantity: amount, unit} : null;
}
export function normalizeStockMap(value, { canonicalize, maxEntries = 2000 } = {}) {
  if (!object(value)) throw new Error('invalid_inventory_stock_map');
  const entries = Object.entries(value);
  const limit = Number.isInteger(maxEntries) && maxEntries >= 0 ? Math.min(2000, maxEntries) : 2000;
  if (entries.length > limit) throw new Error('inventory_stock_map_limit');
  const out = Object.create(null);
  for (const [id, quantity] of entries) {
    const split = id.lastIndexOf('|');
    if (id.length > 180 || split < 1 || id.indexOf('|') !== split || typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 || quantity > MAX_QUANTITY) throw new Error('invalid_inventory_stock_key_or_quantity');
    const name = canonicalIngredientKey(id.slice(0, split), canonicalize), rawUnit = normalizeUnit(id.slice(split + 1));
    if (!name || !rawUnit || HOUSEHOLD.test(name)) throw new Error('invalid_inventory_food_or_unit');
    if (quantity === 0) continue;
    const measured = normalizeStockQuantity(quantity, rawUnit);
    if (!measured) throw new Error('invalid_inventory_quantity');
    const key = `${name}|${measured.unit}`;
    // Distinct physical packages can have different reviewed contents. Cloud stock
    // has one value per canonical key and cannot retain both package identities.
    // Refuse consolidation before a write; measured metric aliases remain safe.
    if (PACKAGE_UNITS.has(measured.unit) && Object.hasOwn(out, key)) throw new Error('inventory_ambiguous_package_sources');
    const total = (out[key] || 0) + measured.quantity;
    if (!Number.isFinite(total) || total > MAX_QUANTITY) throw new Error('inventory_quantity_limit');
    out[key] = total;
  }
  return { ...out };
}
export function projectReceiptInventory(currentStock = {}, previousServerStock = {}, nextServerStock = {}) {
  currentStock = normalizeStockMap(currentStock);
  previousServerStock = normalizeStockMap(previousServerStock);
  nextServerStock = normalizeStockMap(nextServerStock);
  const out = { ...currentStock };
  const keys = new Set([...Object.keys(previousServerStock), ...Object.keys(nextServerStock)]);
  for (const key of keys) {
    if (key.length > 180 || !key.includes('|') || /^(?:__proto__|constructor|prototype)\|/.test(key)) throw new Error('invalid_inventory_stock_key');
    const previous = finite(previousServerStock[key]) ?? 0, next = finite(nextServerStock[key]) ?? 0, local = finite(currentStock[key]) ?? 0;
    if ([previous, next, local].some(x => x < 0 || x > MAX_QUANTITY)) throw new Error('invalid_inventory_quantity');
    const quantity = Math.max(0, next === previous ? local : local === previous ? next : local + (next - previous));
    if (quantity > MAX_QUANTITY) throw new Error('inventory_quantity_limit');
    if (quantity > 0) out[key] = quantity; else delete out[key];
  }
  return out;
}
