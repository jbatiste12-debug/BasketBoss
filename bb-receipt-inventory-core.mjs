/* Shared receipt rules. Pure ESM: no browser, database, filesystem or network access. */
import * as pantryPolicyModule from './bb-pantry-policy.js';
const pantryPolicy = pantryPolicyModule.default || globalThis.BBPantryPolicy;
export const pantryTrackingPolicy = pantryPolicy;
export const RECEIPT_SCHEMA_VERSION = 1;
export const SUPPORTED_MARKETS = Object.freeze({ UK: 'GBP', Guernsey: 'GBP', Jersey: 'GBP', US: 'USD' });
const MAX_QUANTITY = 1_000_000;
const COUNT_UNITS = new Set(['each', 'clove', 'bulb', 'tin', 'pack', 'bag', 'bunch', 'loaf', 'slice']);
const BASE_UNITS = new Set(['g', 'ml', 'tsp', 'tbsp', ...COUNT_UNITS]);
const PACKAGE_UNITS = new Set(['tin', 'pack', 'bag', 'bunch', 'loaf']);
const REGIONAL_UNITS = new Set(['cup','fl oz','oz','lb','pint']);
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
  const u = clean(value, 30).toLowerCase().replace(/^fl\.?\s*oz\.?$/,'fl oz');
  const aliases = { gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', litre: 'l', litres: 'l', liter: 'l', liters: 'l', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml', pc: 'each', pcs: 'each', item: 'each', items: 'each', piece: 'each', pieces: 'each', whole: 'each', eggs: 'each', cloves: 'clove', bulbs: 'bulb', tins: 'tin', can: 'tin', cans: 'tin', packs: 'pack', bags: 'bag', bunches: 'bunch', loaves: 'loaf', slices: 'slice', cups:'cup',pints:'pint',floz:'fl oz','fl. oz.':'fl oz','fluid ounce':'fl oz','fluid ounces':'fl oz',ounces:'oz',ounce:'oz',lbs:'lb',pound:'lb',pounds:'lb' };
  const unit = aliases[u] || u;
  return BASE_UNITS.has(unit) || REGIONAL_UNITS.has(unit) || unit === 'kg' || unit === 'l' ? unit : null;
}
export function normalizeMeasuredQuantity(quantity, inputUnit) {
  const q = finite(quantity), rawUnit = normalizeUnit(inputUnit);
  if (q === null || q <= 0 || q > MAX_QUANTITY || !rawUnit||REGIONAL_UNITS.has(rawUnit)) return null;
  const unit = rawUnit === 'kg' ? 'g' : rawUnit === 'l' ? 'ml' : rawUnit;
  const amount = round(q * (rawUnit === 'kg' || rawUnit === 'l' ? 1000 : 1));
  if (amount <= 0 || amount > MAX_QUANTITY || COUNT_UNITS.has(unit) && !Number.isInteger(amount)) return null;
  return { quantity: amount, unit };
}
function packFromText(value) {
  const text = clean(value, 300).toLowerCase();
  const multi = text.match(/(?:^|\s)(\d{1,4})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|fluid\s+ounces?|floz|lbs?|pounds?|oz|ounces?|cups?|pints?|kg|g|ml|litres?|liters?|l)\b/);
  if (multi) return { packCount: Number(multi[1]), packQuantity: Number(multi[2]), packUnit: multi[3] };
  const single = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|fluid\s+ounces?|floz|lbs?|pounds?|oz|ounces?|cups?|pints?|kg|g|ml|litres?|liters?|l)\b/);
  return single ? { packQuantity: Number(single[1]), packUnit: single[2] } : {};
}
export function normalizePack(input = {}, context = {}) {
  if (!object(input)) throw new Error('invalid_receipt_pack');
  const text = packFromText(input.packText || input.description || input.name);
  const measured=(quantity,unit)=>context.pantryPolicy===true?pantryPolicy.normalize(input.canonicalKey||input.ingredientKey||input.name||input.description,quantity,normalizeUnit(unit)||unit,{market:context.market}):normalizeMeasuredQuantity(quantity,unit);
  const pack = measured(input.packQuantity ?? input.packSize ?? text.packQuantity, input.packUnit ?? input.packSizeUnit ?? text.packUnit);
  const quantityIsPackCount = !!pack && (normalizeUnit(input.unit)==='pack'||context.pantryPolicy===true&&PACKAGE_UNITS.has(normalizeUnit(input.unit)));
  const rawCount = input.packCount ?? input.count ?? text.packCount ?? (quantityIsPackCount ? input.quantity : null);
  const packCount = finite(rawCount);
  const direct = quantityIsPackCount ? null : measured(input.quantity, input.unit);
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
  if (Array.isArray(values)) return values.some(x => {
    const label=x.key||x.ingredient||x.canonicalKey,matched=canonicalIngredientKey(label,canonicalize)===key||pantryPolicy.canonicalName(label,canonicalize)===pantryPolicy.canonicalName(key,canonicalize);
    return matched&&(x.unit===unit||x.units?.includes(unit)||unit==='each'&&pantryPolicy.isStaple(key)||[x.unit,...(x.units||[])].some(from=>pantryPolicy.normalize(key,1,from,{market:'UK'})?.unit===unit));
  });
  if (Object.prototype.hasOwnProperty.call(values, `${key}|${unit}`)) return true;
  // Resolve explicit Pantry aliases against actual catalogue records, never a guessed pack.
  return Object.keys(values).some(pair => {
    const divider = pair.lastIndexOf('|');
    if (divider < 1) return false;
    const declared = normalizeUnit(pair.slice(divider + 1)), base = declared === 'kg' ? 'g' : declared === 'l' ? 'ml' : declared;
    const matched=canonicalIngredientKey(pair.slice(0, divider), canonicalize)===key||pantryPolicy.canonicalName(pair.slice(0,divider),canonicalize)===pantryPolicy.canonicalName(key,canonicalize);
    if(!matched)return false;
    if(base===unit)return true;
    if(unit==='each'&&pantryPolicy?.isStaple(key))return true;
    const normalized=pantryPolicy?.normalize(key,1,declared,{market:'UK'});
    return !!normalized&&normalized.unit===unit;
  });
}
export function normalizeReceiptLine(raw = {}, context = {}, index = 0) {
  if (!object(raw) || !object(context)) throw new Error('invalid_receipt_line');
  const description = clean(raw.description || raw.name || raw.rawName, 200);
  const classified = classifyReceiptLine(raw);let pack = normalizePack({ ...raw, description },context);
  let canonicalKey = canonicalIngredientKey(raw.canonicalKey || raw.ingredientKey, context.canonicalize);
  if(context.pantryPolicy===true&&canonicalKey){
    canonicalKey=canonicalIngredientKey(pantryPolicy.canonicalName(canonicalKey,context.canonicalize),context.canonicalize);
    if(classified.classification==='food'&&pantryPolicy.isStaple(canonicalKey)){
      const container=pantryPolicy.staplePurchase({name:canonicalKey,quantity:pack.quantity??raw.quantity??pack.packQuantity,unit:pack.unit??raw.unit??pack.packUnit,packCount:raw.packCount??pack.packCount,packQuantity:pack.packQuantity,packUnit:pack.packUnit});
      if(container)pack={quantity:container.quantity,unit:'each',packCount:null,packQuantity:null,packUnit:null,issue:null};
    }else if(classified.classification==='food'){
      const amount=pantryPolicy.normalize(canonicalKey,pack.quantity??raw.quantity,pack.unit??raw.unit,{market:context.market,packQuantity:raw.packQuantity,packUnit:raw.packUnit,reviewed:raw.packReviewed===true||raw.reviewed===true&&raw.packQuantity>0&&!!raw.packUnit});
      if(amount)pack={...pack,quantity:amount.quantity,unit:amount.unit,issue:null};
    }
  }
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
    let availableCredit = entry.policyAvailableCredit ?? entry.credited ?? entry.quantity;
    if (entry.receiptInventoryReceiptId) {
      if (receiptId && Object.hasOwn(entry.receiptLegacyCreditById || {}, receiptId)) availableCredit = entry.receiptLegacyCreditById[receiptId];
      else if (!(entry.policyAvailableCredit>0)&&(entry.receiptInventoryReceiptId !== receiptId || Object.keys(entry.receiptCoverageById || {}).length > 1)) continue;
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
export function prepareReceiptConfirmation(input, { requestId, catalog, canonicalize, finishShopCredits = [], pantryPolicy: usePantryPolicy = false } = {}) {
  if (!object(input)) throw new Error('invalid_receipt_draft');
  const draft = normalizeReceiptDraft(input, { market: input.market, retailer: input.retailer, catalog, canonicalize,pantryPolicy:usePantryPolicy });
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
  if (!rawUnit||REGIONAL_UNITS.has(rawUnit)) return null;
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

// Explicit policy migration used by pantry confirmation and receipt commits.
// It changes representation, never invents a conversion for an unknown source.
export function normalizePantryState(stock = {}, inventory = {}, {canonicalize, market = 'UK'} = {}) {
  if(!object(stock)||!object(inventory))throw Error('invalid_inventory_stock_map');
  const records=JSON.parse(JSON.stringify(inventory)),out={},issues=[],contributions=[];
  const policyName=value=>canonicalIngredientKey(pantryPolicy.canonicalName(value,canonicalize),canonicalize);
  const add=(key,quantity)=>{const total=(out[key]||0)+quantity;if(!Number.isFinite(total)||total>MAX_QUANTITY)throw Error('inventory_quantity_limit');if(total>0)out[key]=total;};
  for(const [stockKey,quantity]of Object.entries(stock)){
    const at=stockKey.lastIndexOf('|'),rawName=stockKey.slice(0,at),rawUnit=stockKey.slice(at+1),name=policyName(rawName);
    if(at<1||!name||typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<0||quantity>MAX_QUANTITY)throw Error('invalid_inventory_stock_key_or_quantity');
    if(quantity===0)continue;
    const base=normalizeStockQuantity(1,rawUnit)?.unit;
    const linked=Object.entries(records).filter(([,row])=>row?.selected!==false&&(row?.bb173StockKey===stockKey||!row?.bb173StockKey&&policyName(row?.name)===name&&(base&&normalizeStockQuantity(1,row?.unit)?.unit===base||clean(row?.unit,30).toLowerCase()===clean(rawUnit,30).toLowerCase())));
    const reviewed=linked.filter(([,row])=>row.packReviewed===true),signatures=new Set(reviewed.map(([,row])=>JSON.stringify([row.packQuantity,row.packUnit])));
    const conflict=signatures.size>1||reviewed.length>0&&reviewed.length!==linked.length;
    const metadata=reviewed[0]?.[1];
    const wholePepper=name==='pepper'&&normalizeUnit(rawUnit)==='each'&&!linked.some(([,row])=>row.staple===true);
    const staple=pantryPolicy.isStaple(name)&&!wholePepper,status=linked.some(([,row])=>pantryPolicy.stapleStatus(row)==='low')?'low':linked.some(([,row])=>pantryPolicy.stapleStatus(row)==='out')?'out':'in';
    let normalized;
    if(staple){
      const purchase=pantryPolicy.staplePurchase({name,quantity,unit:rawUnit});
      normalized=purchase||(['each','pack'].includes(normalizeUnit(rawUnit))&&quantity>0?{quantity:Math.ceil(quantity),unit:'each',estimated:true,assumption:'Partly used staple containers kept in stock; review the container count.'}:null);
    }else if(!conflict)normalized=pantryPolicy.normalize(name,quantity,rawUnit,{market,canonicalize,reviewed:metadata?.packReviewed===true,packQuantity:metadata?.packQuantity,packUnit:metadata?.packUnit});
    if(!normalized){
      add(stockKey,quantity);issues.push({stockKey,name,unit:rawUnit,message:conflict?'Container sizes disagree. Existing stock has been kept for review.':'Unknown container or unit. Existing stock has been kept for review.'});continue;
    }
    const nextKey=name+'|'+normalized.unit;
    const allocated=linked.reduce((sum,[,row])=>sum+(Number(row.bb173StockValue??row.qty)||0),0);
    if(linked.length>1&&Math.abs(allocated-quantity)>1e-7){add(stockKey,quantity);issues.push({stockKey,name,unit:rawUnit,message:'Location amounts need review. Existing stock has been kept.'});continue;}
    add(nextKey,normalized.quantity);
    const entries=linked.length?linked:[[null,{name:rawName,loc:'cupboard',selected:true}]];
    for(const [id,row]of entries){
      const amount=linked.length>1?(Number(row.bb173StockValue??row.qty)||0)/quantity*normalized.quantity:normalized.quantity;
      contributions.push({id,row,name,key:nextKey,unit:normalized.unit,quantity:amount,source:{stockKey,quantity:linked.length>1?Number(row.bb173StockValue??row.qty)||0:quantity,unit:rawUnit,assumption:normalized.assumption||''},estimated:normalized.estimated===true,staple,status});
    }
  }
  const grouped=new Map();
  for(const item of contributions){const loc=['cupboard','fridge','freezer'].includes(item.row.loc)?item.row.loc:'cupboard',group=loc+'|'+item.key,list=grouped.get(group)||[];list.push({...item,loc});grouped.set(group,list);}
  for(const list of grouped.values()){
    const first=list[0];let id=first.id||first.loc+'|'+first.name,index=0;
    while(Object.hasOwn(records,id)&&!list.some(item=>item.id===id)){id=first.loc+'|'+first.name+'|'+first.key+(index?'|'+index:'');index++;}
    const quantity=list.reduce((sum,item)=>sum+item.quantity,0),previous=records[id]||first.row;
    const sources=list.filter(item=>item.source.stockKey!==item.key).map(item=>item.source),history=[...(Array.isArray(previous.pantrySourceHistory)?previous.pantrySourceHistory:[]),...sources].slice(-30);
    const row={...previous,name:previous.name||first.name,loc:first.loc,selected:true,qty:quantity,unit:first.unit,bb173StockKey:first.key,bb173StockValue:quantity};
    if(history.length)row.pantrySourceHistory=history;
    if(first.staple){row.staple=true;row.stapleStatus=list.some(item=>item.status==='low')?'low':list.some(item=>item.status==='in')?'in':'out';row.stapleCount=quantity;row.containerLabel=pantryPolicy.containerLabel(first.name);}
    else if(list.some(item=>item.estimated)){row.packEstimated=true;row.packAssumption=list.filter(item=>item.estimated).map(item=>item.source.assumption).filter(Boolean).join(' ');}
    records[id]=row;
    for(const item of list)if(item.id&&item.id!==id){records[item.id]={...records[item.id],selected:false,qty:null,policyMergedInto:id};delete records[item.id].bb173StockKey;delete records[item.id].bb173StockValue;}
  }
  return {stock:out,inventory:records,issues};
}

// Existing Finish shop credits need the same unit representation as a newly
// reviewed receipt. Keep original ledger records for audit and remember moved
// source IDs so a later receipt cannot import the same credit a second time.
export function normalizeFinishShopCredits(credits = {}, {canonicalize,market='UK',inventory={}}={}) {
  const entries=Array.isArray(credits)?credits.map(row=>[row.id,row]):Object.entries(credits),out=Object.fromEntries(entries.map(([id,row])=>[id,JSON.parse(JSON.stringify(row))]));
  for(const [id,row]of entries){
    if(!id||!object(row))continue;const session=row.shopSessionId||row.week,name=canonicalIngredientKey(row.canonicalKey||row.name,canonicalize),unit=normalizeUnit(row.unit);
    if(!session||!name||!unit||id!==session+'|'+name+'|'+unit)continue;
    const available=row.receiptInventoryReceiptId?Number(row.policyAvailableCredit)||0:Number(row.policyAvailableCredit??row.credited??row.quantity)||0;
    if(!(available>0))continue;
    const canonical=pantryPolicy.canonicalName(name,canonicalize),facts=Object.values(inventory).filter(record=>record?.packReviewed===true&&pantryPolicy.canonicalName(record.name,canonicalize)===canonical),signatures=new Set(facts.map(record=>JSON.stringify([record.packQuantity,record.packUnit])));
    if(signatures.size>1)continue;
    const metadata=facts[0],converted=pantryPolicy.isStaple(canonical)?pantryPolicy.staplePurchase({name:canonical,quantity:available,unit}):pantryPolicy.normalize(canonical,available,unit,{market,canonicalize,reviewed:metadata?.packReviewed===true,packQuantity:metadata?.packQuantity,packUnit:metadata?.packUnit});
    if(!converted)continue;
    const stockKey=canonical+'|'+converted.unit,quantity=converted.quantity,at=stockKey.lastIndexOf('|'),nextId=session+'|'+stockKey;if(nextId===id)continue;
    const target=out[nextId],sources=Array.isArray(target?.policyCreditSourceIds)?target.policyCreditSourceIds:[];
    if(sources.includes(id)||row.policyCreditMovedTo===nextId&&target)continue;
    const targetAvailable=target?target.receiptInventoryReceiptId?Number(target.policyAvailableCredit)||0:Number(target.policyAvailableCredit??target.credited??target.quantity)||0:0;
    out[nextId]={...(target||row),name:stockKey.slice(0,at),unit:stockKey.slice(at+1),week:session,credited:target?.credited??quantity,policyAvailableCredit:targetAvailable+quantity,policyCreditSourceIds:[...new Set([...sources,id])]};
    out[id]={...out[id],policyCreditMovedTo:nextId};
  }
  return out;
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
