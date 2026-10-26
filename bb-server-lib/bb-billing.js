/* BasketBoss Paddle SANDBOX billing helpers. No browser-provided entitlements. */
export const json = (body, status=200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Vary':'Authorization' }
});
export const isSandbox = env => env.BB_BILLING_MODE === 'sandbox' && env.BB_BILLING_ENABLED === 'true';
// Live API and webhook processing have separate enablement gates from checkout.
export const isLive = env => env.BB_BILLING_MODE === 'live' && env.BB_BILLING_ENABLED === 'true';
export const isBillingEnabled = env => isSandbox(env) || isLive(env);
export const billingMode = env => isLive(env) ? 'live' : 'sandbox';
export const isConfigured = env => !!(env.BILLING_DB && env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
export function requireSameOrigin(request) {
  const origin=request.headers.get('Origin');
  return !!origin && origin===new URL(request.url).origin;
}
export async function authenticatedUser(request,env) {
  const value=request.headers.get('Authorization')||'';
  if (!/^Bearer [^\s]+$/.test(value)) return null;
  const url=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!env.SUPABASE_PUBLISHABLE_KEY) return null;
  try {
    const r=await fetch(url+'/auth/v1/user', {
      headers:{'apikey':env.SUPABASE_PUBLISHABLE_KEY,'Authorization':value},
      redirect:'error', signal:AbortSignal.timeout(6500)
    });
    if (!r.ok) return null;
    const u=await r.json();
    return typeof u?.id==='string' && u.email_confirmed_at && typeof u.email==='string' ? {id:u.id,email:u.email} : null;
  } catch { return null; }
}
export function expectedPrice(env,plan) {
  if(!isBillingEnabled(env)) return null;
  const live=isLive(env);
  const value= plan==='founder' ? (live?env.PADDLE_LIVE_FOUNDER_PRICE_ID:env.PADDLE_SANDBOX_FOUNDER_PRICE_ID) :
    plan==='standard' ? (live?env.PADDLE_LIVE_STANDARD_PRICE_ID:env.PADDLE_SANDBOX_STANDARD_PRICE_ID) : null;
  return typeof value==='string' && /^pri_[a-z0-9]{26}$/.test(value) ? value : null;
}
export async function digestHex(input) {
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
  return [...new Uint8Array(raw)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function paddleApi(env,path,method='GET',body=undefined) {
  if(!isBillingEnabled(env)) throw Error('Paddle billing mode disabled');
  const live=isLive(env);
  const key=live?env.PADDLE_LIVE_API_KEY:env.PADDLE_SANDBOX_API_KEY;
  if(!key) throw Error('Paddle API credential not configured');
  const host=live?'https://api.paddle.com':'https://sandbox-api.paddle.com';
  const r=await fetch(host+path,{
    method,headers:{ Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(9000),redirect:'error'
  });
  const payload=await r.json().catch(()=>null);
  if(!r.ok || !payload?.data) throw Error('Paddle API response not successful: '+r.status);
  return payload.data;
}
export function entitlementForStatus(status) { return status==='active'||status==='trialing'; }
export function iso(value) {return typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;}
export function recognizedSubscriptionEvent(type){return /^subscription\.(created|updated|trialing|activated|past_due|paused|resumed|canceled)$/.test(type);}
export async function verifyPaddleSignature(request,raw,secret,nowMs=Date.now()) {
  const h=request.headers.get('Paddle-Signature')||'';
  const entries=h.split(';').map(s=>s.trim());
  const ts=entries.find(e=>e.startsWith('ts='))?.slice(3);
  const provided=entries.filter(e=>e.startsWith('h1=')).map(e=>e.slice(3));
  if(!/^\d{10,12}$/.test(ts||'')||provided.length===0 || !secret) return false;
  if(Math.abs(nowMs-Number(ts)*1000)>5*60*1000) return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+':'+raw));
  const expected=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  // Check all candidates without short-circuiting comparisons.
  let found=0;
  for(const signature of provided){
    if(!/^[a-f0-9]{64}$/.test(signature))continue;
    let diff=0;for(let i=0;i<64;i++)diff|=signature.charCodeAt(i)^expected.charCodeAt(i);
    found|=Number(diff===0);
  }
  return found===1;
}
