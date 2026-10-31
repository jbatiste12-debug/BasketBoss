/* Native iOS uses bearer tokens, never cross-origin browser cookies. Trust the
 * exact Capacitor origin only on the official production HTTPS API endpoints.
 * CORS is transport permission, not authentication or a Premium entitlement. */
export const IOS_ORIGIN = 'capacitor://localhost';
const PRODUCTION_ORIGINS = new Set(['https://basketboss.co.uk', 'https://www.basketboss.co.uk']);
const NATIVE_METHODS = new Set(['GET', 'POST']);
const NATIVE_HEADERS = new Set(['accept', 'authorization', 'content-type', 'cache-control', 'pragma']);

export function isNativeApiRequest(request) {
  const url = new URL(request.url);
  return request.headers.get('Origin') === IOS_ORIGIN && PRODUCTION_ORIGINS.has(url.origin) && url.pathname.startsWith('/api/');
}

export function requestOriginAllowed(request, enforceFetchSite = false) {
  if (isNativeApiRequest(request)) return true;
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  return !enforceFetchSite || !site || site === 'same-origin';
}

export function nativeCorsResponse(request, response) {
  if (!isNativeApiRequest(request)) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', IOS_ORIGIN);
  // The native client sends its verified Bearer token. Cookie credentials are
  // deliberately not enabled, and browser-private response headers stay private.
  headers.delete('Access-Control-Allow-Credentials');
  const vary = (headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!vary.some(value => value.toLowerCase() === 'origin')) vary.push('Origin');
  headers.set('Vary', vary.join(', '));
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

export function nativePreflightResponse(request) {
  if (request.method !== 'OPTIONS' || !isNativeApiRequest(request)) return null;
  const method = request.headers.get('Access-Control-Request-Method');
  const requested = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const allowed = NATIVE_METHODS.has(method) && requested.every(value => NATIVE_HEADERS.has(value));
  const response = new Response(null, {status: allowed ? 204 : 403, headers: {'Cache-Control': 'no-store'}});
  if (allowed) {
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST');
    response.headers.set('Access-Control-Allow-Headers', 'Accept, Authorization, Content-Type, Cache-Control, Pragma');
    response.headers.set('Access-Control-Max-Age', '600');
  }
  return nativeCorsResponse(request, response);
}
