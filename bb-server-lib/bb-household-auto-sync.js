/* Server-only adapter for the household deliberate-edit protocol. The caller
 * must retain the existing verified identity, newest session, Premium and
 * membership gates. inventoryAllowed is derived by the existing receipt
 * authorizer; a browser field can never enable inventory access. */
import {normalizeStockMap} from '../bb-receipt-inventory-core.mjs';

export const HOUSEHOLD_SYNC_PREFIX = '__bb_sync_v2:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAYS = new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
const LOCATIONS = new Set(['cupboard','fridge','freezer']);
const SECTIONS = new Set(['planned_day','servings','household_servings','budget_target','shopping_checked']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const clock = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
const servings = value => Number.isInteger(value) && value >= 1 && value <= 12;
const deleted = value => fields(value, ['deleted']) && value.deleted === true;
const utf8Bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const failure = (error, status = 400) => ({body: {ok: false, error}, status});
const sameStock = (left, right) => object(left) && object(right) && Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => Object.hasOwn(right, key) && right[key] === value);

function dinnerValue(value) {
  return fields(value, ['recipeId','servings']) &&
    (value.recipeId === null || typeof value.recipeId === 'string' && value.recipeId.length >= 1 && value.recipeId.length <= 256) &&
    (value.servings === null || servings(value.servings)) && (value.recipeId !== null || value.servings === null);
}
function settingValue(key, value) {
  if (deleted(value)) return true;
  if (key === 'household_servings:default') return fields(value, ['count']) && servings(value.count);
  if (key === 'budget_target:weekly') return fields(value, ['amount']) && typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 1 && value.amount <= 10000;
  return typeof value === 'boolean';
}
function stockKey(key) {
  if (typeof key !== 'string' || key.length < 1 || key.length > 180) return false;
  try {
    // Quantity one validates a deletion key too. Require canonical identity;
    // normalizing a key here could redirect a deliberately queued operation.
    const normalized = normalizeStockMap({[key]: 1});
    return Object.keys(normalized).length === 1 && Object.hasOwn(normalized, key) && normalized[key] === 1;
  } catch {return false;}
}
function targetValue(target, value) {
  if (!fields(target, ['kind','key']) || typeof target.key !== 'string') return false;
  if (target.kind === 'dinner') return DAYS.has(target.key) && dinnerValue(value);
  if (target.kind === 'pantry') return stockKey(target.key) && fields(value, ['quantity','location']) && amount(value.quantity) && LOCATIONS.has(value.location);
  if (target.kind !== 'setting') return false;
  const key = target.key;
  if (key !== 'household_servings:default' && key !== 'budget_target:weekly' &&
      !(key.startsWith('shopping_checked:') && key.slice(17).length >= 1 && key.slice(17).length <= 180 && !key.slice(17).startsWith(HOUSEHOLD_SYNC_PREFIX))) return false;
  return settingValue(key, value);
}

export function validateHouseholdSyncInput(data, householdId) {
  if (!object(data) || !UUID.test(householdId || '')) throw Error('household_sync_invalid');
  if (data.action === 'sync_read') {
    if (!fields(data, ['action'])) throw Error('household_sync_invalid');
    return {action: 'get', payload: {}};
  }
  if (!UUID.test(data.operationId || '') || data.expectedHouseholdId !== householdId) throw Error('household_sync_invalid');
  const common = {expectedHouseholdId: householdId, operationId: data.operationId.toLowerCase()};
  if (data.action === 'sync_reserve') {
    if (!fields(data, ['action','expectedHouseholdId','operationId','baseClock','target','value']) ||
        !clock(data.baseClock) || !targetValue(data.target, data.value)) throw Error('household_sync_invalid');
    const payload = {...common, baseClock: data.baseClock, target: data.target, value: data.value};
    if (utf8Bytes(payload) > 4096) throw Error('household_sync_invalid');
    return {action: 'reserve', payload};
  }
  if (data.action === 'sync_apply' && fields(data, ['action','expectedHouseholdId','operationId','order']) && clock(data.order) && data.order >= 1)
    return {action: 'apply', payload: {...common, order: data.order}};
  throw Error('household_sync_invalid');
}

function validEntry(row) {
  if (!object(row) || !SECTIONS.has(row.section) || typeof row.entry_key !== 'string' || row.entry_key.length < 1 || row.entry_key.length > 180 ||
      row.entry_key.startsWith(HOUSEHOLD_SYNC_PREFIX) || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.updated_at !== 'string') return false;
  if (row.section === 'planned_day') return DAYS.has(row.entry_key) && (deleted(row.value) || fields(row.value, ['recipeId']) && typeof row.value.recipeId === 'string' && row.value.recipeId.length >= 1 && row.value.recipeId.length <= 256);
  if (row.section === 'servings') return DAYS.has(row.entry_key) && (deleted(row.value) || fields(row.value, ['count']) && servings(row.value.count));
  if (row.section === 'household_servings') return row.entry_key === 'default' && settingValue('household_servings:default', row.value);
  if (row.section === 'budget_target') return row.entry_key === 'weekly' && settingValue('budget_target:weekly', row.value);
  return settingValue('shopping_checked:' + row.entry_key, row.value);
}
function validProjection(result, householdId, inventoryAllowed, input) {
  if (!object(result) || result.ok !== true || result.protocol !== 2 || result.household_id !== householdId ||
      !clock(result.clock) || !clock(result.pruneFloor) || result.pruneFloor > result.clock ||
      !object(result.state) || !Array.isArray(result.state.entries) || !result.state.entries.every(validEntry)) return false;
  const keys = result.state.entries.map(row => row.section + ':' + row.entry_key);
  if (new Set(keys).size !== keys.length) return false;
  if (input.action !== 'get') {
    const op = result.operation;
    if (!fields(op, ['id','order','status']) || op.id !== input.payload.operationId ||
        !['reserved','applied','superseded','expired'].includes(op.status) ||
        (op.status === 'expired' ? op.order !== null : !clock(op.order) || op.order < 1 || op.order > result.clock) ||
        input.action === 'apply' && op.status === 'reserved' ||
        input.action === 'apply' && op.status !== 'expired' && op.order !== input.payload.order) return false;
  } else if (Object.hasOwn(result, 'operation')) return false;
  if (!inventoryAllowed) return !['stock','locations','inventoryRevision','initialized','inventory'].some(key => Object.hasOwn(result.state, key));
  const state = result.state;
  if (typeof state.initialized !== 'boolean' || !clock(state.inventoryRevision) || !object(state.stock) || !object(state.locations)) return false;
  try {
    const normalized = normalizeStockMap(state.stock);
    if (Object.keys(normalized).length !== Object.keys(state.stock).length ||
        Object.entries(state.stock).some(([key, value]) => !Object.hasOwn(normalized, key) || normalized[key] !== value)) return false;
  } catch {return false;}
  if (!Object.entries(state.locations).every(([key, value]) => Object.hasOwn(state.stock, key) && LOCATIONS.has(value))) return false;
  const inventory = state.inventory;
  if (!object(inventory) || inventory.ok !== true || inventory.scope?.kind !== 'household' || inventory.scope.id !== householdId ||
      inventory.initialized !== state.initialized || inventory.inventoryRevision !== state.inventoryRevision || !sameStock(inventory.stock, state.stock) ||
      !Array.isArray(inventory.inventory) || inventory.inventory.length !== Object.keys(state.stock).length ||
      !Array.isArray(inventory.essentials) || inventory.essentials.length > 500 || !Array.isArray(inventory.priceObservations) || inventory.priceObservations.length > 2000 ||
      !Array.isArray(inventory.receipts) || inventory.receipts.length > 500 || !object(inventory.pantryReview) || typeof inventory.pantryReview.required !== 'boolean') return false;
  const items = new Set();
  for (const item of inventory.inventory) {
    if (!object(item) || items.has(item.stockKey) || !Object.hasOwn(state.stock, item.stockKey) ||
        item.stockKey !== item.canonicalKey + '|' + item.unit || item.quantity !== state.stock[item.stockKey] ||
        item.revision !== state.inventoryRevision || item.location !== (state.locations[item.stockKey] || 'cupboard')) return false;
    items.add(item.stockKey);
  }
  return true;
}

export async function householdAutoSync({data, actor, household, inventoryAllowed = false, supa}) {
  const actorId = typeof actor === 'string' ? actor : actor?.id;
  const householdId = typeof household === 'string' ? household : household?.id;
  if (!UUID.test(actorId || '') || !UUID.test(householdId || '') || typeof inventoryAllowed !== 'boolean' || typeof supa !== 'function')
    return failure('household_sync_forbidden', 403);
  if (object(data) && ['sync_reserve','sync_apply'].includes(data.action) && UUID.test(data.expectedHouseholdId || '') && data.expectedHouseholdId !== householdId)
    return failure('household_sync_scope_changed', 409);
  let input;
  try {input = validateHouseholdSyncInput(data, householdId);} catch {return failure('household_sync_invalid');}
  if (input.payload.target?.kind === 'pantry' && !inventoryAllowed) return failure('household_sync_inventory_forbidden', 403);
  try {
    const result = await supa('rpc/bb_hh_service_sync_v2', 'POST', {
      p_actor: actorId, p_household: householdId, p_action: input.action, p_payload: input.payload, p_inventory_allowed: inventoryAllowed
    });
    if (object(result) && result.ok === false) {
      const allowed = new Set(['household_sync_forbidden','household_sync_inventory_forbidden','household_sync_invalid','household_sync_identity_mismatch','household_sync_initialization_pending','household_sync_unavailable']);
      const error = allowed.has(result.error) ? result.error : 'household_sync_unavailable';
      const status = result.forbidden === true ? 403 : result.invalid === true ? 400 : 503;
      return {body: {ok: false, error, ...(result.retryable === true ? {retryable: true} : {})}, status};
    }
    if (!validProjection(result, householdId, inventoryAllowed, input)) return failure('household_sync_unavailable', 503);
    return {body: result, status: 200};
  } catch {return failure('household_sync_unavailable', 503);}
}
