import {livePaidBillingEnabled,readPersonalPaidAccess,testFlightBetaEnabled} from '../../bb-server-lib/bb-paid-access.js';
/* Authenticated receipt inventory. Supabase is reached only with the server
 * service credential; the browser never chooses its user/household scope. */
import {receiptCanonicalPairs} from '../../bb-server-lib/bb-receipt-canonical-pairs.js';
import {json, authenticatedUser, isLive, expectedPrice, entitlementForStatus, requireSameOrigin, digestHex} from '../../bb-server-lib/bb-billing.js';
import {seatGateEnabled, isNewestVerifiedSession} from '../../bb-server-lib/bb-premium-seat.js';
import {partnerBenefitsEnabled, sharedHouseholdPremiumOwner} from '../../bb-server-lib/bb-household-premium.js';
import {validateReceiptConfirmation, normalizeStockMap, canonicalIngredientKey, normalizeUnit, normalizePriceObservation} from '../../bb-receipt-inventory-core.mjs';

const LIVE_SUPABASE = 'https://kbhyosxuvlcazyzzinqv.supabase.co';
const LIVE_HOSTS = new Set(['basketboss.co.uk', 'www.basketboss.co.uk', 'basketboss-site.pages.dev']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 768 * 1024;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const serviceKey = env => env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
const unavailable = () => json({ok: false, error: 'receipt_inventory_unavailable'}, 503);
const status = (overrides = {}) => json({ok: true, configured: false, available: false, premium: false, migrationReady: false, ...overrides});
const canonicalPairs = new Set(receiptCanonicalPairs.flatMap(pair => {
  const split = pair.lastIndexOf('|'), name = canonicalIngredientKey(pair.slice(0, split)), unit = normalizeUnit(pair.slice(split + 1));
  return name && unit && !['kg', 'l'].includes(unit) ? [name + '|' + unit] : [];
}));
const canonicalCatalog = Object.fromEntries([...canonicalPairs].map(pair => [pair, true]));

export function receiptInventoryConfigured(request, env) {
  const url = new URL(request.url);
  return env.BB_RECEIPT_INVENTORY_ENABLED === 'true' && url.protocol === 'https:' && LIVE_HOSTS.has(url.hostname) &&
    (!env.CF_PAGES_BRANCH || env.CF_PAGES_BRANCH === 'main') && seatGateEnabled(env) && (livePaidBillingEnabled(env)||testFlightBetaEnabled(env)) &&
    env.SUPABASE_URL === LIVE_SUPABASE && typeof env.SUPABASE_PUBLISHABLE_KEY === 'string' && env.SUPABASE_PUBLISHABLE_KEY.length > 20 &&
    typeof serviceKey(env) === 'string' && serviceKey(env).length > 30 && typeof env.BILLING_DB?.prepare === 'function';
}
function headers(env) {
  const key = serviceKey(env);
  return /^sb_secret_/.test(key) ? {apikey: key, 'Content-Type': 'application/json'} : {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'};
}
async function supabase(env, resource, body) {
  const response = await fetch(LIVE_SUPABASE + '/rest/v1/' + resource, {
    method: body === undefined ? 'GET' : 'POST', headers: {...headers(env), 'Cache-Control': 'no-store'},
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw Error('receipt_database_unavailable');
  return response.json();
}
async function authorized(request, env) {
  const user = await authenticatedUser(request, env);
  if (!user || !UUID.test(user.id)) return {error: json({ok: false, error: 'receipt_sign_in_required'}, 401)};
  if (!await isNewestVerifiedSession(request, env, user)) return {error: json({ok: false, error: 'receipt_newer_session_exists'}, 403)};
  let personal,personalError;
  try{personal=await readPersonalPaidAccess(env,user.id);}
  catch(error){personalError=error;personal={premiumAccess:false};}
  const personalPaid = personal.premiumAccess;
  const shareablePaid = personalPaid && (personal.provider==='paddle' || personal.provider==='testflight_beta' || personal.apple?.environment==='Production');
  // Match existing catalogue/AI owner access only for the authenticated server ID.
  // This exception is never inherited by a partner or accepted from the browser.
  const owner = typeof env.BB_OWNER_USER_ID === 'string' && user.id === env.BB_OWNER_USER_ID;
  let premium = personalPaid || owner, scope = {kind: 'user', id: user.id};
  if (partnerBenefitsEnabled(request, env)) {
    const rows = await supabase(env, 'bb_households?select=id,owner_user_id,partner_user_id,partner_email,invite_status&or=' + encodeURIComponent('(owner_user_id.eq.' + user.id + ',and(partner_user_id.eq.' + user.id + ',invite_status.eq.accepted))') + '&limit=3');
    if (!Array.isArray(rows) || rows.length > 1) throw Error('receipt_household_scope_unavailable');
    if (rows.length === 1) {
      const household = rows[0];
      if (!UUID.test(household.id || '') || household.owner_user_id !== user.id && household.partner_user_id !== user.id) throw Error('receipt_household_scope_invalid');
      if (household.owner_user_id === user.id && shareablePaid) scope = {kind: 'household', id: household.id};
      else if (household.invite_status === 'accepted' && household.partner_user_id === user.id && typeof household.partner_email === 'string' && household.partner_email.trim().toLowerCase() === user.email.trim().toLowerCase()) {
        const sharedOwner = await sharedHouseholdPremiumOwner(request, env, user);
        if (sharedOwner && sharedOwner === household.owner_user_id) {premium = true; scope = {kind: 'household', id: household.id};}
      }
    }
  }
  if(!premium&&personalError)throw personalError;
  return premium ? {user, scope} : {error: json({ok: false, error: 'receipt_premium_required'}, 403)};
}
function fullStock(value) {
  // Existing manual Kitchen stock may include custom foods. Preserve those
  // measured amounts without inventing a price/pack mapping. Scanned food
  // lines still pass the separate strict canonical catalogue validator.
  return normalizeStockMap(value);
}
function plainText(value, maximum, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value || /[\u0000-\u001f\u007f]|data:image\/|base64,/i.test(value)) throw Error('receipt_invalid_text');
  return value;
}
export function validatePantryConfirmation(body) {
  if (!object(body) || Object.keys(body).some(key => !['action', 'stock', 'expectedRevision', 'expectedScope', 'shopSessionId'].includes(key)) || body.action !== 'confirm_pantry' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw Error('receipt_invalid_pantry_confirmation');
  const expectedScope = body.expectedScope;
  if (!object(expectedScope) || Object.keys(expectedScope).length !== 2 || !['user', 'household'].includes(expectedScope.kind) || !UUID.test(expectedScope.id || '')) throw Error('receipt_invalid_expected_scope');
  return {action: 'confirm_pantry', stock: fullStock(body.stock), expectedRevision: body.expectedRevision, expectedScope: {kind: expectedScope.kind, id: expectedScope.id}, shopSessionId: plainText(body.shopSessionId, 120, true)};
}
export function semanticReceiptPayload(body) {
  const {inventoryBaseline, requestId, expectedScope, ...semantic} = body;
  return semantic;
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
async function boundedJson(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return {error: json({ok: false, error: 'receipt_body_too_large'}, 413)};
  const reader = request.body?.getReader();
  if (!reader) return {error: json({ok: false, error: 'receipt_invalid_body'}, 400)};
  const chunks = [];let bytes = 0;
  try {
    for (;;) {const next = await reader.read();if (next.done) break;bytes += next.value.byteLength;if (bytes > MAX_BODY_BYTES) {await reader.cancel();return {error: json({ok: false, error: 'receipt_body_too_large'}, 413)};}chunks.push(next.value);}
    const joined = new Uint8Array(bytes);let offset = 0;for (const chunk of chunks) {joined.set(chunk, offset);offset += chunk.byteLength;}
    return {body: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(joined))};
  } catch {return {error: json({ok: false, error: 'receipt_invalid_body'}, 400)};}
}
async function rpc(env, auth, action, body = {}, receiptId = null, hash = null) {
  return supabase(env, 'rpc/bb_receipt_inventory_service', {
    p_actor: auth.user.id, p_scope_kind: auth.scope.kind, p_scope_id: auth.scope.id, p_action: action,
    p_request_id: body.requestId || null, p_receipt_id: receiptId || body.receiptId || null, p_payload_hash: hash, p_payload: body
  });
}
function rpcResponse(result, auth) {
  if (!object(result) || typeof result.ok !== 'boolean') throw Error('receipt_database_response_invalid');
  if (!result.ok) {
    const error = typeof result.error === 'string' && /^receipt_[a-z0-9_]{1,90}$/.test(result.error) ? result.error : 'receipt_inventory_unavailable';
    return json({ok: false, error, conflict: result.conflict === true}, result.conflict === true ? 409 : result.forbidden === true || error === 'receipt_forbidden' ? 403 : result.invalid === true ? 400 : 503);
  }
  if (result.scope?.kind !== auth.scope.kind || result.scope?.id !== auth.scope.id || typeof result.initialized !== 'boolean' || !Number.isSafeInteger(result.inventoryRevision) || result.inventoryRevision < 0) throw Error('receipt_database_response_invalid');
  const stock = fullStock(result.stock);
  if (stable(stock) !== stable(result.stock) || !Array.isArray(result.inventory) || result.inventory.length !== Object.keys(stock).length || !Array.isArray(result.essentials) || result.essentials.length > 500 || !Array.isArray(result.priceObservations) || result.priceObservations.length > 2000) throw Error('receipt_database_response_invalid');
  const keys = new Set();
  for (const row of result.inventory) {
    if (!object(row) || keys.has(row.stockKey) || !own(stock, row.stockKey) || row.stockKey !== row.canonicalKey + '|' + row.unit || stock[row.stockKey] !== row.quantity || row.revision !== result.inventoryRevision || !['cupboard', 'fridge', 'freezer'].includes(row.location)) throw Error('receipt_database_response_invalid');
    keys.add(row.stockKey);
  }
  return json(result);
}

export async function onRequestGet({request, env}) {
  const url = new URL(request.url), checking = url.searchParams.get('mode') === 'status';
  if (!receiptInventoryConfigured(request, env)) return checking ? status({reason: 'not_configured'}) : unavailable();
  if ([...url.searchParams.keys()].some(key => !['mode', 'receiptId'].includes(key) || url.searchParams.getAll(key).length !== 1) || url.searchParams.has('mode') && !checking || checking && url.searchParams.has('receiptId')) return json({ok: false, error: 'receipt_invalid_query'}, 400);
  let receiptId = null;
  try {receiptId = url.searchParams.has('receiptId') ? plainText(url.searchParams.get('receiptId'), 120) : null;}
  catch {return json({ok: false, error: 'receipt_invalid_query'}, 400);}
  let auth;
  try {
    auth = await authorized(request, env);
    if (auth.error) return checking ? status({configured: true, reason: auth.error.status === 401 ? 'sign_in_required' : 'premium_or_current_session_required'}) : auth.error;
    const result = await rpc(env, auth, checking ? 'status' : 'get', {}, receiptId);
    if (checking) return result?.ok === true && result.autoStockReady === true ? status({configured: true, available: true, premium: true, migrationReady: true}) : status({premium: true, reason: 'migration_unavailable'});
    return rpcResponse(result, auth);
  } catch {return checking ? status({premium: !!auth?.user, reason: auth?.user ? 'migration_unavailable' : 'temporarily_unavailable'}) : unavailable();}
}
export async function onRequestPost({request, env}) {
  if (!receiptInventoryConfigured(request, env)) return unavailable();
  if (!requireSameOrigin(request, true)) return json({ok: false, error: 'receipt_origin_not_allowed'}, 403);
  let auth;
  try {auth = await authorized(request, env);} catch {return unavailable();}
  if (auth.error) return auth.error;
  const parsed = await boundedJson(request);if (parsed.error) return parsed.error;
  let body, hash = null;
  try {
    if (parsed.body?.action === 'confirm_pantry') body = validatePantryConfirmation(parsed.body);
    else {
      body = validateReceiptConfirmation(parsed.body, {catalog: canonicalCatalog});
      body.inventoryBaseline.stock = fullStock(body.inventoryBaseline.stock);
      if (body.purchasedAt !== null && !Number.isFinite(Date.parse(body.purchasedAt))) throw Error('receipt_invalid_purchase_date');
      hash = await digestHex(stable(semanticReceiptPayload(body)));
      body.priceObservations = body.lines.map(line => normalizePriceObservation(line, {...body, scope: auth.scope})).filter(Boolean);
    }
  } catch {return json({ok: false, error: 'receipt_invalid_confirmation'}, 400);}
  // This is a CAS precondition, never an authorization source. A simultaneous
  // household join/unlink must not apply an old baseline to a newly derived scope.
  if (body.expectedScope?.kind !== auth.scope.kind || body.expectedScope?.id !== auth.scope.id) return json({ok: false, error: 'receipt_scope_conflict', conflict: true}, 409);
  try {return rpcResponse(await rpc(env, auth, body.action, body, null, hash), auth);} catch {return unavailable();}
}
export function onRequestOptions() {return json({ok: false, error: 'receipt_method_not_allowed'}, 405);}
